const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { CHALLENGE_KEYS } = require('../challengeConfig');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Managing volunteers is administrator-only (§16).
router.use(requireAuth, requireAdmin);

function publicUser(u) {
  return {
    _id: u._id,
    username: u.username,
    displayName: u.displayName || u.username,
    role: u.role,
    permissions: u.permissions || [],
    active: u.active
  };
}

function cleanPermissions(list) {
  if (!Array.isArray(list)) return [];
  // Keep only valid, de-duplicated challenge keys. Speed Cube and Chess are
  // independent entries here even though they share a stall (§2, §10).
  return [...new Set(list.filter(k => CHALLENGE_KEYS.includes(k)))];
}

// GET /api/volunteers  — list all staff accounts (volunteers + admins).
router.get('/', async (req, res) => {
  try {
    const users = await User.find().sort({ role: 1, username: 1 }).lean();
    res.json(users.map(publicUser));
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch volunteers.' });
  }
});

// POST /api/volunteers  { username, password, displayName?, permissions[] }
router.post('/', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: username.trim(),
      passwordHash,
      displayName: (displayName || '').trim(),
      role: 'volunteer',
      permissions: cleanPermissions(req.body.permissions),
      active: true
    });
    res.status(201).json(publicUser(user));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'That username is already taken.' });
    res.status(500).json({ error: 'Could not create volunteer.' });
  }
});

// PATCH /api/volunteers/:id/permissions  { permissions[] }  — assign/revoke (§10).
router.patch('/:id/permissions', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Volunteer not found.' });
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Admins already have access to all challenges.' });
    }
    user.permissions = cleanPermissions(req.body.permissions);
    await user.save();
    res.json(publicUser(user));
  } catch (err) {
    res.status(500).json({ error: 'Could not update permissions.' });
  }
});

// PATCH /api/volunteers/:id/active  { active }  — enable/disable an account.
router.patch('/:id/active', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Volunteer not found.' });
    user.active = !!req.body.active;
    await user.save();
    res.json(publicUser(user));
  } catch (err) {
    res.status(500).json({ error: 'Could not update account.' });
  }
});

// POST /api/volunteers/:id/reset-password  { password }
router.post('/:id/reset-password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'A new password is required.' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Volunteer not found.' });
    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    res.json({ reset: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not reset password.' });
  }
});

// DELETE /api/volunteers/:id
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Volunteer not found.' });
    if (user.role === 'admin') {
      const admins = await User.countDocuments({ role: 'admin' });
      if (admins <= 1) return res.status(400).json({ error: 'Cannot delete the only administrator.' });
    }
    await user.deleteOne();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete volunteer.' });
  }
});

module.exports = router;
