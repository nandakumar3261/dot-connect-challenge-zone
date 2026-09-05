const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const Student = require('../models/Student');
const VideoSubmission = require('../models/VideoSubmission');

const router = express.Router();

// PUBLIC (no sign-in) routes — used by public-web/upload-video.html so a
// student can upload their own video from their phone. Mirrors the auth'd
// version in routes/videos.js but:
//   - never requires a staff token
//   - requires the picked file's name (minus extension) to equal the roll
//     number that was entered, so people can't accidentally attach the
//     wrong clip to someone else's roll number
//   - is rate-limited, since it's open to the public
// Videos still land in the SAME VideoSubmission collection, tagged
// source: 'public', so admins see everything (staff + self-uploads) in one
// place (GET /api/videos, admin-only).

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'videos');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = [
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
  'video/3gpp', 'video/3gpp2', 'video/ogg', 'video/x-msvideo'
];
const MAX_BYTES = (parseInt(process.env.VIDEO_MAX_MB, 10) || 250) * 1024 * 1024;

// Keep this open door from being hammered — a handful of uploads/lookups
// per student is normal, dozens per minute from one IP is not.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many uploads from this device — please try again later.' }
});
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many lookups from this device — please try again later.' }
});

// "DOTT26-0001.mp4" -> "DOTT26-0001"; strips the extension and any
// surrounding whitespace so we compare like-for-like against the roll number.
function stripExt(fileName) {
  return String(fileName || '').replace(/\.[^./\\]+$/, '').trim();
}

// ---------------------------------------------------------------------------
// GET /api/public-videos/lookup/:rollNumber — confirm the roll number is
// registered and show the student their own details before they upload.
// ---------------------------------------------------------------------------
router.get('/lookup/:rollNumber', lookupLimiter, async (req, res) => {
  try {
    const rollNumber = String(req.params.rollNumber || '').trim();
    if (!rollNumber) return res.status(400).json({ error: 'Roll number is required.' });

    const student = await Student.findOne({ rollNumber }).lean();
    if (!student) {
      return res.status(404).json({ error: 'No student found with that roll number. Please register first.' });
    }

    res.json({
      student: {
        dotId: student.dotId,
        rollNumber: student.rollNumber || '',
        name: student.name,
        branch: student.branch,
        section: student.section
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/public-videos — self-upload.
// Body: { rollNumber, fileName, mimeType, videoBase64 }
// Rejects the upload unless the file's own name (without extension) matches
// the roll number that was entered.
// ---------------------------------------------------------------------------
router.post('/', uploadLimiter, async (req, res) => {
  try {
    const rollNumber = String(req.body.rollNumber || '').trim();
    const fileName = req.body.fileName || '';
    const mimeType = req.body.mimeType || '';
    const videoBase64 = req.body.videoBase64 || '';

    if (!rollNumber) return res.status(400).json({ error: 'Roll number is required.' });
    if (!videoBase64) return res.status(400).json({ error: 'A video file is required.' });

    const student = await Student.findOne({ rollNumber });
    if (!student) {
      return res.status(404).json({ error: 'No student found with that roll number. Please register first.' });
    }

    // The check the person asked for: file name must equal the roll number.
    if (stripExt(fileName).toLowerCase() !== rollNumber.toLowerCase()) {
      return res.status(400).json({
        error: `File name must match your roll number. Rename the file to "${rollNumber}" (e.g. ${rollNumber}.mp4) and try again.`
      });
    }

    if (mimeType && !ALLOWED_MIME.includes(mimeType)) {
      return res.status(400).json({ error: 'Unsupported video format.' });
    }

    const base64Payload = videoBase64.includes(',') && videoBase64.trim().startsWith('data:')
      ? videoBase64.slice(videoBase64.indexOf(',') + 1)
      : videoBase64;

    let buffer;
    try {
      buffer = Buffer.from(base64Payload, 'base64');
    } catch (e) {
      return res.status(400).json({ error: 'Could not decode the uploaded file.' });
    }
    if (!buffer.length) return res.status(400).json({ error: 'Uploaded file is empty.' });
    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: `Video exceeds the ${Math.round(MAX_BYTES / (1024 * 1024))}MB limit.` });
    }

    const rawExt = path.extname(fileName || '').replace(/[^.\w]/g, '').slice(0, 10);
    const safeExt = rawExt || '.mp4';
    const storedFileName = `${student.dotId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedFileName), buffer);

    await VideoSubmission.create({
      student: student._id,
      dotId: student.dotId,
      rollNumber: student.rollNumber || rollNumber,
      name: student.name,
      gender: student.gender,
      branch: student.branch,
      section: student.section,
      fileName,
      storedFileName,
      mimeType: mimeType || 'application/octet-stream',
      sizeBytes: buffer.length,
      uploadedBy: 'Self-upload (public)',
      source: 'public'
    });

    res.status(201).json({ uploaded: true, name: student.name, rollNumber: student.rollNumber || rollNumber });
  } catch (err) {
    res.status(500).json({ error: 'Could not save video. Please try again or see a volunteer.' });
  }
});

module.exports = router;
