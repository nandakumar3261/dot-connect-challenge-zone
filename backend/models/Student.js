const mongoose = require('mongoose');
const Counter = require('./Counter');
const { EVENT_ID_PREFIX, GENDERS } = require('../challengeConfig');

// Student profile (§4, §5). Every participant has EXACTLY ONE profile.
//   - dotId: required, unique, system-generated (e.g. DOT26-0001). This is an
//     event identifier, NOT a university roll number.
//   - rollNumber: the permanent university roll number. Optional at first;
//     unique when present. Linked in later by an admin (§4) — a new record is
//     never created for the same person.
const studentSchema = new mongoose.Schema({
  dotId: { type: String, unique: true, trim: true },

  // `sparse` so many students can have NO roll number yet while the ones that
  // do are still guaranteed unique (§5, §17).
  rollNumber: { type: String, unique: true, sparse: true, trim: true, default: undefined },

  name: { type: String, required: true, trim: true },

  // Required, used for prize communication, never shown on public boards (§5).
  mobile: { type: String, required: true, trim: true },

  // Required controlled selection (§5).
  gender: { type: String, required: true, enum: GENDERS },

  branch: { type: String, required: true, trim: true },
  section: { type: String, required: true, trim: true },

  // Who created the profile — any authorised volunteer may register (§4).
  registeredBy: { type: String }
}, { timestamps: true });

// Auto-assign a DoT Connect ID on first save if one wasn't supplied.
studentSchema.pre('validate', async function assignDotId(next) {
  try {
    if (!this.dotId) {
      const n = await Counter.next('dotId');
      // DOT26-0001, DOT26-0002, ... (§4 example format).
      this.dotId = `${EVENT_ID_PREFIX}-${String(n).padStart(4, '0')}`;
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Student', studentSchema);
