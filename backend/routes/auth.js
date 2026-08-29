const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Slow down brute-force sign-in attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many sign-in attempts — try again later.' }
});

// POST /api/auth/login  { username, password }
// Returns a token plus the role & permissions so the staff app can show the
// right console (volunteer vs admin) and the authorised challenges (§3, §10).
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await User.findOne({ username: username.trim() });
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const payload = {
      id: user._id,
      username: user.username,
      role: user.role,
      permissions: user.role === 'admin' ? [] : user.permissions
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '10h' });

    res.json({
      token,
      username: user.username,
      displayName: user.displayName || user.username,
      role: user.role,
      permissions: payload.permissions
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error during sign-in.' });
  }
});

// GET /api/auth/me — lets the frontend re-confirm role/permissions on load.
router.get('/me', requireAuth, (req, res) => {
  res.json({
    username: req.user.username,
    role: req.user.role,
    permissions: req.user.permissions || []
  });
});

module.exports = router;
