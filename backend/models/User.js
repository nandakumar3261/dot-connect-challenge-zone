const mongoose = require('mongoose');
const { CHALLENGE_KEYS } = require('../challengeConfig');

// A single account model covers both roles from §3:
//   role: 'admin'     -> full access (permissions ignored; treated as all)
//   role: 'volunteer' -> may only record for challenges listed in `permissions`
//
// Speed Cube and Chess are separate permissions even though they may share a
// stall (§2, §10) — they are just two independent entries in `permissions`.
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  displayName: { type: String, trim: true },
  role: { type: String, enum: ['admin', 'volunteer'], default: 'volunteer' },

  // Only meaningful for volunteers. Each value must be a valid challenge key.
  permissions: [{ type: String, enum: CHALLENGE_KEYS }],

  active: { type: Boolean, default: true }
}, { timestamps: true });

// Convenience: does this account may-record the given challenge? (§10)
userSchema.methods.canRecord = function (challengeKey) {
  if (!this.active) return false;
  if (this.role === 'admin') return true;
  return this.permissions.includes(challengeKey);
};

module.exports = mongoose.model('User', userSchema);
