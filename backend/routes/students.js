const express = require('express');
const Student = require('../models/Student');
const Result = require('../models/Result');
const { CHALLENGE_KEYS, CHALLENGES, GENDERS, summariseMetrics } = require('../challengeConfig');
const { maskMobile } = require('../lib/mask');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Everything here needs a signed-in staff member (volunteer or admin).
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helper: build the participation history for one student (§7).
// Returns, per challenge: participated?, the ACTIVE (best) result metrics,
// a readable summary, and the recorded date. Never includes mobile.
// ---------------------------------------------------------------------------
async function participationHistory(studentId) {
  const results = await Result.find({
    student: studentId,
    status: { $in: ['active', 'superseded', 'invalid'] }
  }).lean();

  const history = {};
  for (const key of CHALLENGE_KEYS) {
    const active = results.find(r => r.challenge === key && r.status === 'active');
    const attempts = results.filter(r => r.challenge === key).length;
    history[key] = {
      challenge: key,
      name: CHALLENGES[key].name,
      participated: !!active,
      attempts,
      best: active
        ? {
            metrics: active.metrics,
            summary: summariseMetrics(key, active.metrics),
            recordedAt: active.createdAt,
            recordedBy: active.recordedBy
          }
        : null
    };
  }
  return history;
}

// Shape a student for staff display: masked mobile for volunteers, full for
// admins (admins need it for prize contact, §16). Never leak the hash of nothing.
function publicStudent(student, role) {
  return {
    _id: student._id,
    dotId: student.dotId,
    rollNumber: student.rollNumber || '',
    name: student.name,
    gender: student.gender,
    branch: student.branch,
    section: student.section,
    mobileMasked: maskMobile(student.mobile),
    // Full number only for admins.
    mobile: role === 'admin' ? student.mobile : undefined,
    createdAt: student.createdAt
  };
}

// ---------------------------------------------------------------------------
// GET /api/students/search?q=...   (§6 SEARCH, §19)
// Matches permanent roll number, DoTT Connect ID, or name (partial, case-insensitive).
// ---------------------------------------------------------------------------
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const students = await Student.find({
      $or: [{ rollNumber: rx }, { dotId: rx }, { name: rx }]
    }).sort({ createdAt: -1 }).limit(25).lean();

    res.json(students.map(s => publicStudent(s, req.user.role)));
  } catch (err) {
    res.status(500).json({ error: 'Search failed.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/students/:id   — full profile + participation history (§7)
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id).lean();
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    const history = await participationHistory(student._id);
    res.json({ student: publicStudent(student, req.user.role), history });
  } catch (err) {
    res.status(500).json({ error: 'Could not load student.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/students   — REGISTER (§4, §6). Any authorised volunteer may do this.
// Body: { name, mobile, gender, branch, section, rollNumber? }
// If no rollNumber is supplied, a DoTT Connect ID is generated automatically.
// Duplicate roll numbers are rejected (§4, §17).
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { name, gender, branch, section } = req.body;
    let { rollNumber } = req.body;
    const mobile = String(req.body.mobile || '').trim();

    if (!name || !mobile || !gender || !branch || !section) {
      return res.status(400).json({ error: 'Name, mobile, gender, branch and section are required.' });
    }
    if (!/^[0-9]{10}$/.test(mobile)) {
      return res.status(400).json({ error: 'Mobile number must be exactly 10 digits.' });
    }
    if (!GENDERS.includes(gender)) {
      return res.status(400).json({ error: `Gender must be one of: ${GENDERS.join(', ')}` });
    }
    rollNumber = rollNumber && String(rollNumber).trim() ? String(rollNumber).trim() : undefined;

    const mobileClash = await Student.findOne({ mobile });
    if (mobileClash) return res.status(409).json({ error: 'A student with that mobile number is already registered.' });

    if (rollNumber) {
      const rollClash = await Student.findOne({ rollNumber });
      if (rollClash) return res.status(409).json({ error: 'A student with that roll number already exists.' });
    }

    const student = await Student.create({
      name: name.trim(),
      mobile,
      gender,
      branch: branch.trim(),
      section: section.trim(),
      rollNumber,
      registeredBy: req.user.username
    });

    res.status(201).json(publicStudent(student, req.user.role));
  } catch (err) {
    if (err.code === 11000) {
      const field = err.keyPattern ? Object.keys(err.keyPattern)[0] : null;
      const label = field === 'mobile' ? 'mobile number' : field === 'rollNumber' ? 'roll number' : 'DoTT Connect ID';
      return res.status(409).json({ error: `A student with that ${label} already exists.` });
    }
    res.status(500).json({ error: 'Could not register student.' });
  }
});

// ---------------------------------------------------------------------------
// The routes below are ADMINISTRATOR-only (§16).
// ---------------------------------------------------------------------------

// GET /api/students   — full roster (admin table). Full mobile included.
router.get('/', requireAdmin, async (req, res) => {
  try {
    const students = await Student.find().sort({ createdAt: -1 }).lean();
    res.json(students.map(s => publicStudent(s, 'admin')));
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch students.' });
  }
});

// PUT /api/students/:id   — edit a profile (admin correction).
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, mobile, gender, branch, section } = req.body;
    if (gender && !GENDERS.includes(gender)) {
      return res.status(400).json({ error: 'Invalid gender value.' });
    }
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { name, mobile, gender, branch, section },
      { new: true, runValidators: true }
    );
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    res.json(publicStudent(student, 'admin'));
  } catch (err) {
    res.status(500).json({ error: 'Could not update student.' });
  }
});

// DELETE /api/students/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete student.' });
  }
});

module.exports = router;
