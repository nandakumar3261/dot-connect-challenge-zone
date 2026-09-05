const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Student = require('../models/Student');
const VideoSubmission = require('../models/VideoSubmission');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Everything here needs a signed-in staff member (volunteer or admin), same
// as the other staff-facing routes.
router.use(requireAuth);

// Videos are written to disk here (not into Mongo — GridFS/BSON isn't a good
// fit for large binaries served straight to a <video> tag). Only the file's
// name + metadata live in the VideoSubmission collection.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'videos');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Accept the common formats a phone/camera export would produce.
const ALLOWED_MIME = [
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
  'video/3gpp', 'video/3gpp2', 'video/ogg', 'video/x-msvideo'
];

// No multer/formidable dependency is available in this environment, so the
// browser sends the file as a base64 data URL inside a normal JSON body
// (see the frontend's use of FileReader.readAsDataURL). VIDEO_MAX_MB caps
// the decoded size; app.js raises the JSON body-parser limit to match.
const MAX_BYTES = (parseInt(process.env.VIDEO_MAX_MB, 10) || 250) * 1024 * 1024;

// Shape a submission for the client; never leaks the on-disk file name.
function publicSubmission(v) {
  return {
    _id: v._id,
    dotId: v.dotId,
    rollNumber: v.rollNumber,
    name: v.name,
    branch: v.branch,
    section: v.section,
    gender: v.gender,
    fileName: v.fileName,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    note: v.note,
    uploadedBy: v.uploadedBy,
    source: v.source || 'staff',
    createdAt: v.createdAt,
    fileUrl: `/api/videos/file/${v._id}`
  };
}

// ---------------------------------------------------------------------------
// GET /api/videos/lookup/:rollNumber
// The "enter roll number, get the student's data back" step. Also returns any
// videos already on file for them.
// ---------------------------------------------------------------------------
router.get('/lookup/:rollNumber', async (req, res) => {
  try {
    const rollNumber = String(req.params.rollNumber || '').trim();
    if (!rollNumber) return res.status(400).json({ error: 'Roll number is required.' });

    const student = await Student.findOne({ rollNumber }).lean();
    if (!student) {
      return res.status(404).json({ error: 'No student found with that roll number.' });
    }

    const submissions = await VideoSubmission.find({ student: student._id })
      .sort({ createdAt: -1 }).lean();

    res.json({
      student: {
        _id: student._id,
        dotId: student.dotId,
        rollNumber: student.rollNumber || '',
        name: student.name,
        gender: student.gender,
        branch: student.branch,
        section: student.section
      },
      submissions: submissions.map(publicSubmission)
    });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/videos
// Body: { rollNumber, fileName, mimeType, videoBase64, note? }
// Stores the decoded video on disk and records it, with the student's
// details, as a new document in the videosubmissions collection.
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const rollNumber = String(req.body.rollNumber || '').trim();
    const { fileName, note } = req.body;
    const mimeType = req.body.mimeType || '';
    const videoBase64 = req.body.videoBase64 || '';

    if (!rollNumber) return res.status(400).json({ error: 'Roll number is required.' });
    if (!videoBase64) return res.status(400).json({ error: 'A video file is required.' });

    const student = await Student.findOne({ rollNumber });
    if (!student) {
      return res.status(404).json({ error: 'No student found with that roll number. Register them first.' });
    }

    if (mimeType && !ALLOWED_MIME.includes(mimeType)) {
      return res.status(400).json({ error: 'Unsupported video format.' });
    }

    // Strip a data: URL prefix if the browser sent one, e.g. "data:video/mp4;base64,...."
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

    const submission = await VideoSubmission.create({
      student: student._id,
      dotId: student.dotId,
      rollNumber: student.rollNumber || rollNumber,
      name: student.name,
      gender: student.gender,
      branch: student.branch,
      section: student.section,
      fileName: fileName || storedFileName,
      storedFileName,
      mimeType: mimeType || 'application/octet-stream',
      sizeBytes: buffer.length,
      note: note || '',
      uploadedBy: req.user.username,
      source: 'staff'
    });

    res.status(201).json(publicSubmission(submission));
  } catch (err) {
    res.status(500).json({ error: 'Could not save video.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/videos/file/:id — stream the stored video (supports Range so the
// <video> player can seek/scrub instead of downloading the whole file).
// ---------------------------------------------------------------------------
router.get('/file/:id', async (req, res) => {
  try {
    const submission = await VideoSubmission.findById(req.params.id).lean();
    if (!submission) return res.status(404).json({ error: 'Not found.' });

    const filePath = path.join(UPLOAD_DIR, submission.storedFileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk.' });

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    // ?download=1 -> force "Save as" with the original file name, instead of
    // playing inline. Used by the admin table's Download button.
    const disposition = req.query.download
      ? `attachment; filename="${encodeURIComponent(submission.fileName || submission.storedFileName)}"`
      : 'inline';

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range) || [];
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': submission.mimeType || 'video/mp4',
        'Content-Disposition': disposition
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Type': submission.mimeType || 'video/mp4',
        'Content-Disposition': disposition
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: 'Could not stream file.' });
  }
});

// ---------------------------------------------------------------------------
// The routes below are ADMINISTRATOR-only.
// ---------------------------------------------------------------------------

// GET /api/videos — every submission, newest first (admin review table).
router.get('/', requireAdmin, async (req, res) => {
  try {
    const rows = await VideoSubmission.find().sort({ createdAt: -1 }).lean();
    res.json(rows.map(publicSubmission));
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch videos.' });
  }
});

// DELETE /api/videos/:id — remove the record and its file on disk.
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const submission = await VideoSubmission.findByIdAndDelete(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Not found.' });
    fs.unlink(path.join(UPLOAD_DIR, submission.storedFileName), () => {});
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete video.' });
  }
});

module.exports = router;
