/* ============================================================================
   upload-video.js — public, no sign-in required. Look up a roll number, then
   upload a video whose FILE NAME must equal that roll number (checked both
   here, for a fast/friendly error, and again on the server, which is the
   check that actually counts).
   ============================================================================ */
const API = '/api/public-videos';

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// "21A091.mp4" -> "21A091"
function stripExt(name) {
  return String(name || '').replace(/\.[^./\\]+$/, '').trim();
}

let currentStudent = null;
let pickedFile = null;

function renderStudent(s) {
  const item = (k, v, mono) => `<div class="sd-item"><span class="k">${k}</span><span class="v ${mono ? 'mono' : ''}">${esc(v || '—')}</span></div>`;
  document.getElementById('studentDetail').innerHTML =
    item('Name', s.name) + item('DoTT ID', s.dotId, true) + item('Roll No.', s.rollNumber, true) +
    item('Branch', s.branch) + item('Section', s.section);
}

function resetUploadForm() {
  pickedFile = null;
  document.getElementById('videoFile').value = '';
  document.getElementById('videoPreviewWrap').hidden = true;
  document.getElementById('videoPreview').removeAttribute('src');
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('fileNameCheck').textContent = '';
  document.getElementById('fileNameCheck').className = 'form-msg';
  document.getElementById('uploadMsg').textContent = '';
  document.getElementById('uploadMsg').className = 'form-msg';
  document.getElementById('uploadProgressWrap').hidden = true;
}

// ---- LOOKUP ----
document.getElementById('lookupBtn').addEventListener('click', doLookup);
document.getElementById('rollInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLookup(); });

async function doLookup() {
  const roll = document.getElementById('rollInput').value.trim();
  const msg = document.getElementById('lookupMsg');
  msg.className = 'form-msg';
  if (!roll) { msg.textContent = 'Enter your roll number first.'; msg.classList.add('err'); return; }

  msg.textContent = 'Looking up…';
  document.getElementById('lookupBtn').disabled = true;
  try {
    const res = await fetch(`${API}/lookup/${encodeURIComponent(roll)}`);
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || 'Roll number not found.';
      msg.classList.add('err');
      document.getElementById('studentBox').hidden = true;
      document.getElementById('uploadCard').hidden = true;
      currentStudent = null;
      return;
    }
    msg.textContent = '';
    currentStudent = data.student;
    renderStudent(data.student);
    document.getElementById('studentBox').hidden = false;
    document.getElementById('uploadCard').hidden = false;
    resetUploadForm();
    document.getElementById('uploadCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    msg.textContent = 'Could not reach the server. Please try again.';
    msg.classList.add('err');
  } finally {
    document.getElementById('lookupBtn').disabled = false;
  }
}

// ---- FILE PICK: check the file name against the roll number up front ----
document.getElementById('videoFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  const checkMsg = document.getElementById('fileNameCheck');
  const uploadBtn = document.getElementById('uploadBtn');
  checkMsg.className = 'form-msg';

  if (!file) { pickedFile = null; uploadBtn.disabled = true; document.getElementById('videoPreviewWrap').hidden = true; return; }

  if (!file.type.startsWith('video/')) {
    checkMsg.textContent = 'Please choose a video file.';
    checkMsg.classList.add('err');
    e.target.value = ''; pickedFile = null; uploadBtn.disabled = true;
    return;
  }

  const expected = (currentStudent && currentStudent.rollNumber || '').toLowerCase();
  const got = stripExt(file.name).toLowerCase();
  if (got !== expected) {
    checkMsg.textContent = `File name "${stripExt(file.name)}" doesn't match your roll number "${currentStudent.rollNumber}". Rename the file to "${currentStudent.rollNumber}" and re-select it.`;
    checkMsg.classList.add('err');
    pickedFile = null;
    uploadBtn.disabled = true;
    document.getElementById('videoPreviewWrap').hidden = true;
    return;
  }

  checkMsg.textContent = `File name matches your roll number. (${fmtBytes(file.size)})`;
  checkMsg.classList.add('ok');
  pickedFile = file;
  uploadBtn.disabled = false;

  const preview = document.getElementById('videoPreview');
  preview.src = URL.createObjectURL(file);
  document.getElementById('videoPreviewWrap').hidden = false;
});

// ---- UPLOAD (base64 JSON body, with a progress bar via XHR) ----
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function postJsonWithProgress(url, payload, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Could not reach the server.'));
    xhr.send(JSON.stringify(payload));
  });
}

document.getElementById('uploadBtn').addEventListener('click', async () => {
  if (!pickedFile || !currentStudent) return;
  const msg = document.getElementById('uploadMsg');
  const btn = document.getElementById('uploadBtn');
  const progWrap = document.getElementById('uploadProgressWrap');
  const progBar = document.getElementById('uploadProgressBar');

  btn.disabled = true;
  msg.className = 'form-msg';
  msg.textContent = 'Reading file…';
  progWrap.hidden = false;
  progBar.style.width = '0%';

  try {
    const videoBase64 = await fileToBase64(pickedFile);
    msg.textContent = 'Uploading…';
    await postJsonWithProgress(API, {
      rollNumber: currentStudent.rollNumber,
      fileName: pickedFile.name,
      mimeType: pickedFile.type,
      videoBase64
    }, (frac) => { progBar.style.width = `${Math.round(frac * 100)}%`; });

    msg.textContent = 'Video uploaded! Thanks — you can close this page.';
    msg.classList.add('ok');
    progWrap.hidden = true;
    resetUploadForm();
  } catch (err) {
    msg.textContent = err.message || 'Upload failed.';
    msg.classList.add('err');
    progWrap.hidden = true;
    btn.disabled = false;
  }
});
