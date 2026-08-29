const mongoose = require('mongoose');
const { CHALLENGE_KEYS } = require('../challengeConfig');

// One recorded attempt for one student in one challenge (§8, §18).
//
// `metrics` is a flexible bag whose shape depends on the challenge (defined in
// challengeConfig). Student identity fields are copied in (denormalised) so the
// public leaderboard reads with one fast query and never exposes the mobile
// number (§12, §15).
//
// `status` implements the best-result rule (§9):
//   'active'     -> the current leaderboard result for this student+challenge
//   'superseded' -> a valid attempt that was not the best (kept for audit)
//   'invalid'    -> voided by an admin correction (§16, §18)
// Invariant: at most ONE 'active' result per (student, challenge).
const resultSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },

  // Identity snapshot for fast, join-free public reads. No mobile number here.
  dotId: { type: String, required: true },
  rollNumber: { type: String, default: '' },
  name: { type: String, required: true },
  gender: { type: String, default: '' },
  branch: { type: String, required: true },
  section: { type: String, required: true },

  challenge: { type: String, required: true, enum: CHALLENGE_KEYS },

  // e.g. { timeSeconds: 24.31 }  or  { puzzlesSolved: 27, timeSeconds: 118, mistakes: 2 }
  metrics: { type: mongoose.Schema.Types.Mixed, required: true },

  status: { type: String, enum: ['active', 'superseded', 'invalid'], default: 'active' },

  // Audit trail (§18): who entered it, and any admin correction note.
  recordedBy: { type: String },       // username
  recordedByRole: { type: String },   // 'admin' | 'volunteer'
  invalidatedBy: { type: String },    // admin username, when voided
  note: { type: String, default: '' }
}, { timestamps: true });

// Fast lookups for the leaderboard and "already participated?" checks.
resultSchema.index({ challenge: 1, status: 1 });
resultSchema.index({ student: 1, challenge: 1, status: 1 });

module.exports = mongoose.model('Result', resultSchema);
