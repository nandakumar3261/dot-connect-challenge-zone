const express = require('express');
const Student = require('../models/Student');
const Result = require('../models/Result');
const { CHALLENGES, isChallenge, summariseMetrics } = require('../challengeConfig');
const { isBetter } = require('../lib/ranking');
const { requireAuth, requireAdmin, requireChallengePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Validate the submitted metrics against the challenge's field spec (§8, §17).
// Returns { ok, metrics } or { ok:false, error }.
// ---------------------------------------------------------------------------
function validateMetrics(challengeKey, raw = {}) {
  const cfg = CHALLENGES[challengeKey];
  const metrics = {};

  for (const f of cfg.fields) {
    let v = raw[f.key];
    if (v === '' || v === undefined || v === null) {
      if (f.required) return { ok: false, error: `${f.label} is required.` };
      continue;
    }
    v = Number(v);
    if (Number.isNaN(v)) return { ok: false, error: `${f.label} must be a number.` };
    if (f.integer && !Number.isInteger(v)) return { ok: false, error: `${f.label} must be a whole number.` };
    if (f.min !== undefined && v < f.min) return { ok: false, error: `${f.label} cannot be below ${f.min}.` };
    if (f.max !== undefined && v > f.max) return { ok: false, error: `${f.label} cannot exceed ${f.max}.` };
    metrics[f.key] = v;
  }
  return { ok: true, metrics };
}

// ---------------------------------------------------------------------------
// GET /api/results/precheck?studentId=..&challenge=..   (§7, §9 warning)
// Tells the volunteer, BEFORE they record, whether this student already has a
// result for this challenge, and what their current best is.
// ---------------------------------------------------------------------------
router.get('/precheck', async (req, res) => {
  try {
    const { studentId, challenge } = req.query;
    if (!isChallenge(challenge)) return res.status(400).json({ error: 'Unknown challenge.' });

    const active = await Result.findOne({ student: studentId, challenge, status: 'active' }).lean();
    res.json({
      alreadyParticipated: !!active,
      best: active
        ? { metrics: active.metrics, summary: summariseMetrics(challenge, active.metrics), recordedAt: active.createdAt }
        : null
    });
  } catch (err) {
    res.status(500).json({ error: 'Pre-check failed.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/results   — RECORD (§6, §8, §9, §10)
// Body: { studentId, challenge, metrics: {..} }
// Permission enforced by requireChallengePermission (reads body.challenge).
// ---------------------------------------------------------------------------
router.post('/', requireChallengePermission, async (req, res) => {
  try {
    const { studentId, challenge, metrics: rawMetrics } = req.body;
    if (!isChallenge(challenge)) return res.status(400).json({ error: 'Unknown challenge.' });

    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const { ok, metrics, error } = validateMetrics(challenge, rawMetrics);
    if (!ok) return res.status(400).json({ error });

    const base = {
      student: student._id,
      dotId: student.dotId,
      rollNumber: student.rollNumber || '',
      name: student.name,
      gender: student.gender,
      branch: student.branch,
      section: student.section,
      challenge,
      metrics,
      recordedBy: req.user.username,
      recordedByRole: req.user.role
    };

    const currentActive = await Result.findOne({ student: student._id, challenge, status: 'active' });

    let becameActive;
    let saved;
    if (!currentActive) {
      // First attempt for this challenge — it becomes the active result.
      saved = await Result.create({ ...base, status: 'active' });
      becameActive = true;
    } else if (isBetter(challenge, metrics, currentActive.metrics)) {
      // Better than the existing best — promote the new one (§9).
      currentActive.status = 'superseded';
      await currentActive.save();
      saved = await Result.create({ ...base, status: 'active' });
      becameActive = true;
    } else {
      // Not better — keep it for audit but do NOT replace the superior result (§9, §17).
      saved = await Result.create({ ...base, status: 'superseded' });
      becameActive = false;
    }

    res.status(201).json({
      result: saved,
      becameActive,
      previousBest: currentActive
        ? { metrics: currentActive.metrics, summary: summariseMetrics(challenge, currentActive.metrics) }
        : null,
      summary: summariseMetrics(challenge, metrics)
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not save result.' });
  }
});

// ---------------------------------------------------------------------------
// The routes below are ADMINISTRATOR-only (§16).
// ---------------------------------------------------------------------------

// GET /api/results?challenge=..&status=..  — management table.
router.get('/', requireAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query.challenge) filter.challenge = req.query.challenge;
    if (req.query.status) filter.status = req.query.status;
    const rows = await Result.find(filter).sort({ createdAt: -1 }).limit(1000).lean();
    res.json(rows.map(r => ({ ...r, summary: summariseMetrics(r.challenge, r.metrics) })));
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch results.' });
  }
});

// PATCH /api/results/:id/invalidate  — void a result (§16, §18).
// If it was the active one, the next-best remaining attempt is promoted.
router.patch('/:id/invalidate', requireAdmin, async (req, res) => {
  try {
    const result = await Result.findById(req.params.id);
    if (!result) return res.status(404).json({ error: 'Result not found.' });

    const wasActive = result.status === 'active';
    result.status = 'invalid';
    result.invalidatedBy = req.user.username;
    result.note = (req.body.note || '').trim();
    await result.save();

    if (wasActive) await repromoteBest(result.student, result.challenge);
    res.json({ invalidated: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not invalidate result.' });
  }
});

// PUT /api/results/:id  — correct the metrics of a result (§16).
// Re-evaluates which attempt should be active afterwards.
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await Result.findById(req.params.id);
    if (!result) return res.status(404).json({ error: 'Result not found.' });

    const { ok, metrics, error } = validateMetrics(result.challenge, req.body.metrics || {});
    if (!ok) return res.status(400).json({ error });

    result.metrics = metrics;
    if (req.body.note !== undefined) result.note = String(req.body.note).trim();
    await result.save();

    await repromoteBest(result.student, result.challenge);
    res.json({ ...result.toObject(), summary: summariseMetrics(result.challenge, metrics) });
  } catch (err) {
    res.status(500).json({ error: 'Could not update result.' });
  }
});

// DELETE /api/results/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await Result.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Result not found.' });
    if (result.status === 'active') await repromoteBest(result.student, result.challenge);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete result.' });
  }
});

// Recompute the active (best) result for a student+challenge from the remaining
// valid attempts. Keeps the "one active per student+challenge" invariant (§9).
async function repromoteBest(studentId, challenge) {
  const candidates = await Result.find({
    student: studentId, challenge, status: { $in: ['active', 'superseded'] }
  });
  // Demote everything, then pick the best and promote it.
  let best = null;
  for (const c of candidates) {
    if (c.status === 'active') { c.status = 'superseded'; await c.save(); }
    if (!best || isBetter(challenge, c.metrics, best.metrics)) best = c;
  }
  if (best) { best.status = 'active'; await best.save(); }
}

module.exports = router;
