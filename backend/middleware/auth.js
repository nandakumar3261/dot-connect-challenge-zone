const jwt = require('jsonwebtoken');

// Verifies the Bearer token and attaches the account to req.user:
//   { id, username, role, permissions }
// Volunteers and admins both authenticate; the role/permissions drive access.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing sign-in token.' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session — please sign in again.' });
  }
}

// Administrator-only routes (§3, §16).
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required.' });
  }
  next();
}

// Enforces that the signed-in account may record for a specific challenge
// (§10). Admins pass automatically; volunteers must have the permission.
// The challenge key is read from req.body.challenge or req.params.challenge.
function requireChallengePermission(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  const challenge = req.body.challenge || req.params.challenge;

  if (req.user.role === 'admin') return next();

  const perms = req.user.permissions || [];
  if (!challenge || !perms.includes(challenge)) {
    return res.status(403).json({
      error: 'You are not authorised to record results for this challenge.'
    });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireChallengePermission };
