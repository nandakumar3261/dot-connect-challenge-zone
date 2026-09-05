const mongoose = require('mongoose');

// A video uploaded for one student, looked up by roll number (new feature).
// Lives in its OWN collection ("videosubmissions") — separate from Student and
// Result — but links back to the Student record and carries a denormalised
// identity snapshot (same pattern as Result) so submissions can be listed or
// audited without a join.
//
// The actual video bytes are written to disk under backend/uploads/videos/;
// only the stored file's name + metadata are kept in Mongo. `storedFileName`
// is what's on disk; `fileName` is the original name the uploader saw.
const videoSubmissionSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },

  // Identity snapshot at time of upload (no mobile number — same privacy rule
  // as Result).
  dotId: { type: String, required: true },
  rollNumber: { type: String, required: true, trim: true },
  name: { type: String, required: true },
  gender: { type: String, default: '' },
  branch: { type: String, default: '' },
  section: { type: String, default: '' },

  fileName: { type: String, required: true },       // original filename
  storedFileName: { type: String, required: true }, // name on disk, unique
  mimeType: { type: String, default: 'application/octet-stream' },
  sizeBytes: { type: Number, required: true },

  note: { type: String, default: '' },
  uploadedBy: { type: String }, // staff username, or a label for self-uploads

  // 'staff'  -> uploaded by a signed-in volunteer/admin via /api/videos (video.html)
  // 'public' -> uploaded by the student themselves via /api/public-videos,
  //             no sign-in required (public-web/upload-video.html)
  source: { type: String, enum: ['staff', 'public'], default: 'staff' },
}, { timestamps: true });

videoSubmissionSchema.index({ rollNumber: 1 });
videoSubmissionSchema.index({ student: 1 });

module.exports = mongoose.model('VideoSubmission', videoSubmissionSchema);
