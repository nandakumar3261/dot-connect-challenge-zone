const express = require('express');
const Student = require('../models/Student');
const Result = require('../models/Result');
const { CHALLENGES, CHALLENGE_KEYS, isChallenge, summariseMetrics } = require('../challengeConfig');
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
// GET /api/results/stats/daywise  — day-by-day breakdown for the "Day wise
// statistics" tab (visible to admin AND volunteer logins — just requireAuth,
// same as the rest of this file). Everything here is read from the Results
// collection only (not Student.createdAt): for each calendar day, "Total
// Registrations" is the count of DISTINCT students who have at least one
// active result recorded that day — a student who did 3 challenges the same
// day still counts once — plus, separately, how many results were recorded
// that day in each individual challenge. Days are numbered "Day 1, Day 2,
// ..." in chronological order from the first day with any activity, each
// paired with its actual date — not hardcoded to a fixed event start date.
// ---------------------------------------------------------------------------
router.get('/stats/daywise', async (req, res) => {
  try {
    const dayKey = (date) => new Date(date).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

    const filter = { status: 'active' };
    if (req.query.from) filter.createdAt = { ...(filter.createdAt || {}), $gte: new Date(`${req.query.from}T00:00:00.000Z`) };
    if (req.query.to) filter.createdAt = { ...(filter.createdAt || {}), $lte: new Date(`${req.query.to}T23:59:59.999Z`) };

    const results = await Result.find(filter, 'student challenge createdAt').lean();

    const days = new Map(); // 'YYYY-MM-DD' -> { studentSet, participants: {key: Set}, hourlyTotal:[24], hourlyByChallenge:{key:[24]} }
    function dayBucket(key) {
      if (!days.has(key)) {
        const participants = {};
        const hourlyByChallenge = {};
        CHALLENGE_KEYS.forEach(k => { participants[k] = new Set(); hourlyByChallenge[k] = new Array(24).fill(0); });
        days.set(key, { studentSet: new Set(), participants, hourlyTotal: new Array(24).fill(0), hourlyByChallenge });
      }
      return days.get(key);
    }

    results.forEach(r => {
      const created = new Date(r.createdAt);
      const bucket = dayBucket(dayKey(created));
      const hour = created.getUTCHours();
      bucket.studentSet.add(String(r.student));
      if (bucket.participants[r.challenge]) bucket.participants[r.challenge].add(String(r.student));
      bucket.hourlyTotal[hour] += 1;
      if (bucket.hourlyByChallenge[r.challenge]) bucket.hourlyByChallenge[r.challenge][hour] += 1;
    });

    const sortedKeys = [...days.keys()].sort();
    const dayList = sortedKeys.map((key, i) => {
      const b = days.get(key);
      const participantCounts = {};
      CHALLENGE_KEYS.forEach(k => { participantCounts[k] = b.participants[k].size; });
      return {
        day: i + 1,
        date: key,
        dateLabel: new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
        }),
        isFirstDay: i === 0,
        registrations: b.studentSet.size,
        participants: participantCounts,
        // Hourly counts (raw attempt counts per UTC hour, not de-duplicated by
        // student) — used only to draw the small activity sparkline per cell.
        hourly: { total: b.hourlyTotal, ...b.hourlyByChallenge }
      };
    });

    // Range-wide totals, de-duplicated the SAME way as each day (a student
    // active on both Day 1 and Day 2 counts once per day above, but still
    // only once here overall) — so "17 across 2 days" is a real distinct count.
    const allStudents = new Set();
    const allByChallenge = {};
    CHALLENGE_KEYS.forEach(k => { allByChallenge[k] = new Set(); });
    results.forEach(r => {
      allStudents.add(String(r.student));
      if (allByChallenge[r.challenge]) allByChallenge[r.challenge].add(String(r.student));
    });
    const totals = { total: allStudents.size };
    CHALLENGE_KEYS.forEach(k => { totals[k] = allByChallenge[k].size; });

    res.json({
      days: dayList,
      totals,
      rangeStart: sortedKeys[0] || null,
      rangeEnd: sortedKeys[sortedKeys.length - 1] || null,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load day-wise stats.' });
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
