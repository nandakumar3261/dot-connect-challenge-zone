const express = require('express');
const Student = require('../models/Student');
const Result = require('../models/Result');
const { summariseMetrics } = require('../challengeConfig');
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

// GET /api/export/results.csv  — never includes mobile (§15).
router.get('/results.csv', async (req, res) => {
  const filter = {};
  if (req.query.challenge) filter.challenge = req.query.challenge;
  const results = await Result.find(filter).sort({ challenge: 1, createdAt: 1 }).lean();
  const csv = toCsv(
    ['Challenge', 'DoTT ID', 'Roll Number', 'Name', 'Branch', 'Section', 'Result', 'Status', 'Recorded By', 'Recorded At'],
    results.map(r => [
      r.challenge, r.dotId, r.rollNumber || '', r.name, r.branch, r.section,
      summariseMetrics(r.challenge, r.metrics), r.status, r.recordedBy || '',
      new Date(r.createdAt).toISOString()
    ])
  );
  res.type('text/csv').send(csv);
});

module.exports = router;
