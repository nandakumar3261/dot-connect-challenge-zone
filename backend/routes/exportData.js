const express = require('express');
const Student = require('../models/Student');
const Result = require('../models/Result');
const { CHALLENGES, CHALLENGE_KEYS, summariseMetrics } = require('../challengeConfig');
const { rankTop } = require('../lib/ranking');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// Minimal CSV encoder — quotes fields and escapes embedded quotes.
function toCsv(headers, rows) {
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return lines.join('\r\n');
}

// GET /api/export/students.csv  — includes mobile (admin prize contact, §16).
router.get('/students.csv', async (req, res) => {
  const students = await Student.find().sort({ createdAt: 1 }).lean();
  const csv = toCsv(
    ['DoTT Connect ID', 'Roll Number', 'Name', 'Mobile', 'Gender', 'Branch', 'Section', 'Registered'],
    students.map(s => [
      s.dotId, s.rollNumber || '', s.name, s.mobile, s.gender, s.branch, s.section,
      new Date(s.createdAt).toISOString()
    ])
  );
  res.type('text/csv').send(csv);
});

// Split one challenge's results into leaderboard-ranked rows (active, best
// first, ties sharing a rank — same rule as the public board) followed by
// the non-active rows (superseded/invalid) kept for audit with a blank rank,
// sorted oldest-first as before.
function rankForExport(challengeKey, rows) {
  const active = rows.filter(r => r.status === 'active');
  const rest = rows.filter(r => r.status !== 'active')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const ranked = rankTop(challengeKey, active, active.length);
  return [
    ...ranked.map(r => ({ ...r, rank: r.rank })),
    ...rest.map(r => ({ ...r, rank: '' }))
  ];
}

// GET /api/export/results.csv?challenge=<key|all>
//
// Includes each student's mobile number (looked up from the Student
// collection, since Result rows never store it — for prize/winner contact).
//
// challenge=<speedcube|chess|typing|debug>  -> one column PER FIELD the
//   volunteer actually typed into the record form for that game (e.g. Chess:
//   separate "Puzzles solved", "Mistakes", "Minutes", "Seconds" columns) —
//   not a single mashed-together summary string. Rows follow the same "top
//   order" as the public leaderboard for that game (best result first, ties
//   sharing a rank), with any superseded/invalid attempts listed after.
// challenge=all (or omitted)                -> every challenge in one file,
//   grouped by challenge (in leaderboard order) and ranked within each
//   group the same way, kept as a combined "Result" summary column since the
//   games don't share the same fields and can't be lined up column-for-column.
router.get('/results.csv', async (req, res) => {
  const challenge = req.query.challenge || 'all';

  if (challenge !== 'all' && !CHALLENGES[challenge]) {
    return res.status(400).json({ error: 'Unknown challenge.' });
  }

  const filter = challenge === 'all' ? {} : { challenge };
  const results = await Result.find(filter).lean();

  // Mobile lookup keyed by Student _id (Result rows don't carry it).
  const studentIds = [...new Set(results.map(r => String(r.student)))];
  const students = await Student.find({ _id: { $in: studentIds } }, 'mobile').lean();
  const mobileById = new Map(students.map(s => [String(s._id), s.mobile]));

  let csv, filename;

  if (challenge === 'all') {
    const rows = CHALLENGE_KEYS.flatMap(key =>
      rankForExport(key, results.filter(r => r.challenge === key))
    );
    csv = toCsv(
      ['Rank', 'Challenge', 'DoTT ID', 'Roll Number', 'Name', 'Mobile', 'Branch', 'Section', 'Result', 'Status', 'Recorded By', 'Recorded At'],
      rows.map(r => [
        r.rank,
        CHALLENGES[r.challenge] ? CHALLENGES[r.challenge].name : r.challenge,
        r.dotId, r.rollNumber || '', r.name, mobileById.get(String(r.student)) || '', r.branch, r.section,
        summariseMetrics(r.challenge, r.metrics), r.status, r.recordedBy || '',
        new Date(r.createdAt).toISOString()
      ])
    );
    filename = 'dotconnect-results-all.csv';
  } else {
    const cfg = CHALLENGES[challenge];
    const rows = rankForExport(challenge, results);
    // One column per raw input field, in the exact order the record form
    // asks for them — header includes the unit, e.g. "Minutes (m)".
    const fieldHeaders = cfg.fields.map(f => f.unit ? `${f.label} (${f.unit})` : f.label);
    csv = toCsv(
      ['Rank', 'DoTT ID', 'Roll Number', 'Name', 'Mobile', 'Branch', 'Section', ...fieldHeaders, 'Status', 'Recorded By', 'Recorded At'],
      rows.map(r => [
        r.rank,
        r.dotId, r.rollNumber || '', r.name, mobileById.get(String(r.student)) || '', r.branch, r.section,
        ...cfg.fields.map(f => (r.metrics && r.metrics[f.key] != null ? r.metrics[f.key] : '')),
        r.status, r.recordedBy || '',
        new Date(r.createdAt).toISOString()
      ])
    );
    filename = `dotconnect-results-${challenge}.csv`;
  }

  res.type('text/csv').set('Content-Disposition', `attachment; filename="${filename}"`).send(csv);
});

// GET /api/export/daywise.csv?from=&to=  — mirrors GET /api/results/stats/daywise.
router.get('/daywise.csv', async (req, res) => {
  const dayKeyOf = (date) => new Date(date).toISOString().slice(0, 10);

  const filter = { status: 'active' };
  if (req.query.from) filter.createdAt = { ...(filter.createdAt || {}), $gte: new Date(`${req.query.from}T00:00:00.000Z`) };
  if (req.query.to) filter.createdAt = { ...(filter.createdAt || {}), $lte: new Date(`${req.query.to}T23:59:59.999Z`) };

  const results = await Result.find(filter, 'student challenge createdAt').lean();

  const days = new Map();
  results.forEach(r => {
    const key = dayKeyOf(r.createdAt);
    if (!days.has(key)) {
      const perChallenge = {};
      CHALLENGE_KEYS.forEach(k => { perChallenge[k] = new Set(); });
      days.set(key, { studentSet: new Set(), perChallenge });
    }
    const b = days.get(key);
    b.studentSet.add(String(r.student));
    if (b.perChallenge[r.challenge]) b.perChallenge[r.challenge].add(String(r.student));
  });

  const sortedKeys = [...days.keys()].sort();
  const headers = ['Day', 'Date', 'Total Registrations', ...CHALLENGE_KEYS.map(k => CHALLENGES[k].name)];
  const rows = sortedKeys.map((key, i) => {
    const b = days.get(key);
    return [`Day ${i + 1}`, key, b.studentSet.size, ...CHALLENGE_KEYS.map(k => b.perChallenge[k].size)];
  });

  const allStudents = new Set();
  const allByChallenge = {};
  CHALLENGE_KEYS.forEach(k => { allByChallenge[k] = new Set(); });
  results.forEach(r => {
    allStudents.add(String(r.student));
    if (allByChallenge[r.challenge]) allByChallenge[r.challenge].add(String(r.student));
  });
  rows.push(['TOTAL', '', allStudents.size, ...CHALLENGE_KEYS.map(k => allByChallenge[k].size)]);

  const csv = toCsv(headers, rows);
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="dotconnect-day-wise-stats.csv"').send(csv);
});

module.exports = router;
