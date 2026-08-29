const express = require('express');
const Student = require('../models/Student');
const Result = require('../models/Result');
const { CHALLENGE_KEYS, CHALLENGES, GENDERS, summariseMetrics } = require('../challengeConfig');
const { rankTop } = require('../lib/ranking');

const router = express.Router();

// All routes here are PUBLIC (no auth) and must never expose mobile numbers (§15).

// ---------------------------------------------------------------------------
// GET /api/config  — challenge metadata so the frontend renders generically.
// (keys, names, icons, fields, units, primary field, provisional flags)
// ---------------------------------------------------------------------------
router.get('/config', (req, res) => {
  const challenges = CHALLENGE_KEYS.map(key => {
    const c = CHALLENGES[key];
    return {
      key: c.key, name: c.name, icon: c.icon,
      fields: c.fields.map(f => ({ key: f.key, label: f.label, unit: f.unit })),
      primaryField: c.primaryField,
      primaryUnit: (c.fields.find(f => f.key === c.primaryField) || {}).unit || '',
      provisional: c.provisional
    };
  });
  res.json({ challenges, genders: GENDERS });
});

// Minimal public row: rank, name, identifier, primary score only (§11).
function minimalRow(challengeKey, r) {
  const cfg = CHALLENGES[challengeKey];
  return {
    rank: r.rank,
    name: r.name,
    identifier: r.rollNumber || r.dotId,
    score: r.metrics[cfg.primaryField],
    unit: (cfg.fields.find(f => f.key === cfg.primaryField) || {}).unit || ''
  };
}

async function activeRankedTop(challengeKey, limit = 10) {
  const rows = await Result.find({ challenge: challengeKey, status: 'active' }).lean();
  return rankTop(challengeKey, rows, limit);
}

// ---------------------------------------------------------------------------
// GET /api/leaderboard  — All Challenges view: Top 10 of EACH of the four (§11).
// The four boards are independent; there is no combined ranking (§14).
// ---------------------------------------------------------------------------
router.get('/leaderboard', async (req, res) => {
  try {
    const boards = {};
    for (const key of CHALLENGE_KEYS) {
      const top = await activeRankedTop(key, 10);
      boards[key] = top.map(r => minimalRow(key, r));
    }
    res.json({ challenges: CHALLENGE_KEYS, boards });
  } catch (err) {
    res.status(500).json({ error: 'Could not load leaderboard.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/leaderboard/:challenge  — detailed board for one challenge (§12).
// Includes academic details + full performance + record date/time + who
// recorded it. Never includes mobile numbers.
// ---------------------------------------------------------------------------
router.get('/leaderboard/:challenge', async (req, res) => {
  try {
    const key = req.params.challenge;
    if (!CHALLENGES[key]) return res.status(404).json({ error: 'Unknown challenge.' });

    const top = await activeRankedTop(key, 50);
    const rows = top.map(r => ({
      rank: r.rank,
      name: r.name,
      identifier: r.rollNumber || r.dotId,
      dotId: r.dotId,
      rollNumber: r.rollNumber || '',
      branch: r.branch,
      section: r.section,
      metrics: r.metrics,
      summary: summariseMetrics(key, r.metrics),
      recordedAt: r.createdAt,
      recordedBy: r.recordedBy || ''
    }));

    const cfg = CHALLENGES[key];
    res.json({
      challenge: {
        key: cfg.key, name: cfg.name, icon: cfg.icon,
        fields: cfg.fields.map(f => ({ key: f.key, label: f.label, unit: f.unit })),
        provisional: cfg.provisional
      },
      rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load detailed leaderboard.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats  — quick public counts (registered + participants per challenge).
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const totalStudents = await Student.countDocuments();
    const rows = await Result.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$challenge', count: { $sum: 1 } } }
    ]);
    const participants = {};
    CHALLENGE_KEYS.forEach(k => { participants[k] = 0; });
    rows.forEach(r => { participants[r._id] = r.count; });
    res.json({ totalStudents, participants });
  } catch (err) {
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

module.exports = router;
