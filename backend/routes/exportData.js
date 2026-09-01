const express = require('express');
const Student = require('../models/Student');
const Result = require('../models/Result');
const { CHALLENGES, CHALLENGE_KEYS, summariseMetrics } = require('../challengeConfig');
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

// GET /api/export/results.csv?challenge=<key|all>  — never includes mobile (§15).
//
// challenge=<speedcube|chess|typing|debug>  -> one column PER FIELD the
//   volunteer actually typed into the record form for that game (e.g. Chess:
//   separate "Puzzles solved", "Mistakes", "Minutes", "Seconds" columns) —
//   not a single mashed-together summary string.
// challenge=all (or omitted)                -> every challenge in one file,
//   kept as a combined "Result" summary column since the games don't share
//   the same fields and can't be lined up column-for-column.
router.get('/results.csv', async (req, res) => {
  const challenge = req.query.challenge || 'all';

  if (challenge !== 'all' && !CHALLENGES[challenge]) {
    return res.status(400).json({ error: 'Unknown challenge.' });
  }

  const filter = challenge === 'all' ? {} : { challenge };
  const results = await Result.find(filter).sort({ challenge: 1, createdAt: 1 }).lean();

  let csv, filename;

  if (challenge === 'all') {
    csv = toCsv(
      ['Challenge', 'DoTT ID', 'Roll Number', 'Name', 'Branch', 'Section', 'Result', 'Status', 'Recorded By', 'Recorded At'],
      results.map(r => [
        CHALLENGES[r.challenge] ? CHALLENGES[r.challenge].name : r.challenge,
        r.dotId, r.rollNumber || '', r.name, r.branch, r.section,
        summariseMetrics(r.challenge, r.metrics), r.status, r.recordedBy || '',
        new Date(r.createdAt).toISOString()
      ])
    );
    filename = 'dotconnect-results-all.csv';
  } else {
    const cfg = CHALLENGES[challenge];
    // One column per raw input field, in the exact order the record form
    // asks for them — header includes the unit, e.g. "Minutes (m)".
    const fieldHeaders = cfg.fields.map(f => f.unit ? `${f.label} (${f.unit})` : f.label);
    csv = toCsv(
      ['DoTT ID', 'Roll Number', 'Name', 'Branch', 'Section', ...fieldHeaders, 'Status', 'Recorded By', 'Recorded At'],
      results.map(r => [
        r.dotId, r.rollNumber || '', r.name, r.branch, r.section,
        ...cfg.fields.map(f => (r.metrics && r.metrics[f.key] != null ? r.metrics[f.key] : '')),
        r.status, r.recordedBy || '',
        new Date(r.createdAt).toISOString()
      ])
    );
    filename = `dotconnect-results-${challenge}.csv`;
  }

  res.type('text/csv').set('Content-Disposition', `attachment; filename="${filename}"`).send(csv);
});

module.exports = router;
