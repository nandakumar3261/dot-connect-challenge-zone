const express = require('express');
const QRCode = require('qrcode');
const Student = require('../models/Student');
const Result = require('../models/Result');
const { CHALLENGE_KEYS, CHALLENGES, GENDERS, summariseMetrics, formatColumns } = require('../challengeConfig');
const { rankTop } = require('../lib/ranking');

const router = express.Router();

// All routes here are PUBLIC (no auth) and must never expose mobile numbers (§15).

// ---------------------------------------------------------------------------
// GET /api/config  — challenge metadata so the frontend renders generically.
// Sends the raw input fields (with limits, for the record form) AND the display
// columns + a plain-English "hint" for the "what's this score?" icon.
// ---------------------------------------------------------------------------
router.get('/config', (req, res) => {
  const challenges = CHALLENGE_KEYS.map(key => {
    const c = CHALLENGES[key];
    return {
      key: c.key, name: c.name, icon: c.icon,
      fields: c.fields.map(f => ({
        key: f.key, label: f.label, unit: f.unit,
        min: f.min, max: f.max, integer: !!f.integer, decimals: f.decimals || 0
      })),
      columns: c.columns.map(col => ({ label: col.label, primary: !!col.primary })),
      hint: c.hint,
      provisional: c.provisional
    };
  });
  res.json({ challenges, genders: GENDERS });
});

async function activeRankedTop(challengeKey, limit) {
  const rows = await Result.find({ challenge: challengeKey, status: 'active' }).lean();
  return rankTop(challengeKey, rows, limit);
}

// Row for the All Challenges board: rank, name, roll/ID, and each of that
// challenge's own display columns (§8) — e.g. Chess shows Puzzles, Mistakes,
// and Time; Speed Cube and Debug show just Time; Typing shows WPM + Accuracy.
function minimalRow(challengeKey, r) {
  return {
    rank: r.rank,
    name: r.name,
    identifier: r.rollNumber || r.dotId,
    columns: formatColumns(challengeKey, r.metrics)
  };
}

// ---------------------------------------------------------------------------
// GET /api/leaderboard  — All Challenges view: Top 10 of EACH of the four (§11).
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
// Full academic details + formatted score columns + record time + who recorded
// it. Returns up to 200 rows so the page can paginate client-side (§2).
// Never includes mobile numbers.
// ---------------------------------------------------------------------------
router.get('/leaderboard/:challenge', async (req, res) => {
  try {
    const key = req.params.challenge;
    if (!CHALLENGES[key]) return res.status(404).json({ error: 'Unknown challenge.' });

    const top = await activeRankedTop(key, 200);
    const rows = top.map(r => ({
      rank: r.rank,
      name: r.name,
      identifier: r.rollNumber || r.dotId,
      dotId: r.dotId,
      rollNumber: r.rollNumber || '',
      branch: r.branch,
      section: r.section,
      columns: formatColumns(key, r.metrics),           // [{label,value}] formatted
      summary: summariseMetrics(key, r.metrics),
      recordedAt: r.createdAt,
      recordedBy: r.recordedBy || ''
    }));

    const cfg = CHALLENGES[key];
    res.json({
      challenge: {
        key: cfg.key, name: cfg.name, icon: cfg.icon,
        columns: cfg.columns.map(col => ({ label: col.label })),
        hint: cfg.hint,
        provisional: cfg.provisional
      },
      rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load detailed leaderboard.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/qr?data=<url>  — SVG QR code for the leaderboard URL (§15, feature).
// The frontend passes its own origin so the QR always points at wherever the
// board is being served (localhost while testing, the LAN IP on event day).
// ---------------------------------------------------------------------------
router.get('/qr', async (req, res) => {
  try {
    const data = String(req.query.data || '').slice(0, 512);
    if (!data) return res.status(400).json({ error: 'Missing data.' });
    const svg = await QRCode.toString(data, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 220,
      color: { dark: '#0b0d12', light: '#ffffff' }
    });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=300').send(svg);
  } catch (err) {
    res.status(500).json({ error: 'Could not generate QR code.' });
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

// ---------------------------------------------------------------------------
// POST /api/public-register  — STUDENT SELF-REGISTRATION (public-web/register.html).
// No sign-in. Same validation as the staff console (§4, §6); duplicate roll
// numbers rejected (§4, §17). No rollNumber -> a DoTT Connect ID is auto-assigned.
// ---------------------------------------------------------------------------
router.post('/public-register', async (req, res) => {
  try {
    const { name, mobile, gender, branch, section } = req.body;
    let { rollNumber } = req.body;

    if (!name || !mobile || !gender || !branch || !section) {
      return res.status(400).json({ error: 'Name, mobile, gender, branch and section are required.' });
    }
    if (!GENDERS.includes(gender)) {
      return res.status(400).json({ error: `Gender must be one of: ${GENDERS.join(', ')}` });
    }
    rollNumber = rollNumber && String(rollNumber).trim() ? String(rollNumber).trim() : undefined;

    if (rollNumber) {
      const clash = await Student.findOne({ rollNumber });
      if (clash) return res.status(409).json({ error: 'A student with that roll number already exists.' });
    }

    const student = await Student.create({
      name: String(name).trim(),
      mobile: String(mobile).trim(),
      gender,
      branch: String(branch).trim(),
      section: String(section).trim(),
      rollNumber,
      registeredBy: 'self-registration'
    });

    res.status(201).json({ name: student.name, dotId: student.dotId, rollNumber: student.rollNumber || '' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate student (roll number or DoTT ID already exists).' });
    }
    res.status(500).json({ error: 'Could not register. Please see a volunteer at the help desk.' });
  }
});

module.exports = router;
