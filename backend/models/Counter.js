const mongoose = require('mongoose');

// A tiny sequence store so DoT Connect IDs (§4) are unique even under
// concurrent registrations from multiple volunteer laptops. One document per
// named counter; `$inc` inside findOneAndUpdate is atomic in MongoDB.
const counterSchema = new mongoose.Schema({
  _id: { type: String },       // e.g. "dotId"
  seq: { type: Number, default: 0 }
});

// Returns the next integer in the named sequence, creating it if needed.
counterSchema.statics.next = async function (name) {
  const doc = await this.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
