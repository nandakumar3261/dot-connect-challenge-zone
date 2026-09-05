/* ============================================================================
   video.js — "look up a roll number, then upload a video for that student"
   page. Self-contained (doesn't share staff.js's DOM hooks) so it can't clash
   with console.html's search box, but reuses the same session storage keys
   and API base so a signed-in staff member is already authenticated here.
   ============================================================================ */
const API = '/api';

const store = {
  get token() { return sessionStorage.getItem('dc_token'); },
  get role() { return sessionStorage.getItem('dc_role'); },
  get name() { return sessionStorage.getItem('dc_name'); },
  clear() { sessionStorage.clear(); }
};

if (!store.token) window.location.href = 'login.html';

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

async function authedFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${store.token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (res.status === 401) { store.clear(); window.location.href = 'login.html'; throw new Error('Session expired'); }
  return res;
}

// header
document.getElementById('whoami').textContent = `${store.name} · ${store.role}`;
if (store.role === 'admin') document.getElementById('adminLink').hidden = false;
document.getElementById('logoutBtn').addEventListener('click', () => { store.clear(); window.location.href = 'login.html'; });
{
  const initials = (store.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const av = document.getElementById('avatarInitials');
  if (av) av.textContent = initials || '?';
}

let currentStudent = null;
let pickedFile = null;

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function renderStudent(s) {
  const item = (k, v, mono) => `<div class="sd-item"><span class="k">${k}</span><span class="v ${mono ? 'mono' : ''}">${esc(v || '—')}</span></div>`;
  document.getElementById('studentDetail').innerHTML =
    item('Name', s.name) + item('DoTT ID', s.dotId, true) + item('Roll No.', s.rollNumber, true) +
    item('Branch', s.branch) + item('Section', s.section) + item('Gender', s.gender);
}

function renderSubmissions(list) {
  const wrap = document.getElementById('historyCard');
  const box = document.getElementById('submissionList');
  if (!list.length) { wrap.hidden = true; box.innerHTML = ''; return; }
  wrap.hidden = false;
  box.innerHTML = list.map(v => {
    // Plain <a> navigation can't send an Authorization header, so the
    // signed-in token is passed as ?token=... instead (middleware/auth.js
    // accepts either). &download=1 makes the download link "Save as"
    // instead of playing inline.
    const tok = encodeURIComponent(store.token);
    const playUrl = `${v.fileUrl}?token=${tok}`;
    const downloadUrl = `${v.fileUrl}?token=${tok}&download=1`;
    return `
    <div class="submission-item">
      <div>
        <div class="r-name">${esc(v.fileName)}</div>
        <div class="r-meta">${esc(fmtBytes(v.sizeBytes))} · ${new Date(v.createdAt).toLocaleString()} · uploaded by ${esc(v.uploadedBy || '—')}</div>
        ${v.note ? `<div class="r-meta">${esc(v.note)}</div>` : ''}
      </div>
      <div class="row-actions">
        <a class="btn btn-ghost btn-sm" href="${playUrl}" target="_blank" rel="noopener">Play</a>
        <a class="btn btn-ghost btn-sm" href="${downloadUrl}">Download</a>
      </div>
    </div>`;
  }).join('');
}

function resetUploadForm() {
  pickedFile = null;
  document.getElementById('videoFile').value = '';
  document.getElementById('videoNote').value = '';
  document.getElementById('videoPreviewWrap').hidden = true;
  document.getElementById('videoPreview').removeAttribute('src');
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('uploadMsg').textContent = '';
  document.getElementById('uploadMsg').className = 'form-msg';
  document.getElementById('uploadProgressWrap').hidden = true;
}

// ---- LOOKUP ----
async function doLookup() {
  const roll = document.getElementById('rollInput').value.trim();
  const msg = document.getElementById('lookupMsg');
  msg.className = 'form-msg';
  if (!roll) { msg.textContent = 'Enter a roll number first.'; msg.classList.add('err'); return; }

  msg.textContent = 'Looking up…';
  try {
    const res = await authedFetch(`/videos/lookup/${encodeURIComponent(roll)}`);
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || 'Student not found.';
      msg.classList.add('err');
      document.getElementById('studentCard').hidden = true;
      document.getElementById('uploadCard').hidden = true;
      document.getElementById('historyCard').hidden = true;
      currentStudent = null;
      return;
    }
    msg.textContent = '';
    currentStudent = data.student;
    renderStudent(data.student);
    renderSubmissions(data.submissions || []);
    document.getElementById('studentCard').hidden = false;
    document.getElementById('uploadCard').hidden = false;
    document.getElementById('noStudentNote').hidden = true;
    resetUploadForm();
  } catch (err) { /* handled by authedFetch on 401 */ }
}
document.getElementById('lookupBtn').addEventListener('click', doLookup);
document.getElementById('rollInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLookup(); });

document.getElementById('clearBtn').addEventListener('click', () => {
  currentStudent = null;
  document.getElementById('studentCard').hidden = true;
  document.getElementById('uploadCard').hidden = true;
  document.getElementById('historyCard').hidden = true;
  document.getElementById('noStudentNote').hidden = false;
});

// ---- FILE PICK + PREVIEW ----
document.getElementById('videoFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  const uploadBtn = document.getElementById('uploadBtn');
  if (!file) { pickedFile = null; uploadBtn.disabled = true; document.getElementById('videoPreviewWrap').hidden = true; return; }
  if (!file.type.startsWith('video/')) {
    document.getElementById('uploadMsg').textContent = 'Please choose a video file.';
    document.getElementById('uploadMsg').className = 'form-msg err';
    e.target.value = '';
    pickedFile = null;
    uploadBtn.disabled = true;
    return;
  }
  pickedFile = file;
  uploadBtn.disabled = false;
  document.getElementById('uploadMsg').textContent = '';
  document.getElementById('uploadMsg').className = 'form-msg';

  const preview = document.getElementById('videoPreview');
  preview.src = URL.createObjectURL(file);
  document.getElementById('videoPreviewWrap').hidden = false;
  document.getElementById('fileMeta').textContent = `${file.name} · ${fmtBytes(file.size)}`;
});

// ---- UPLOAD (base64 JSON body, with a progress bar via XHR) ----
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // "data:video/mp4;base64,...."
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function postJsonWithProgress(path, payload, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}${path}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${store.token}`);
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
    const data = await postJsonWithProgress('/videos', {
      rollNumber: currentStudent.rollNumber,
      fileName: pickedFile.name,
      mimeType: pickedFile.type,
      videoBase64,
      note: document.getElementById('videoNote').value.trim()
    }, (frac) => { progBar.style.width = `${Math.round(frac * 100)}%`; });

    msg.textContent = 'Video uploaded and stored.';
    msg.classList.add('ok');
    progWrap.hidden = true;

    // Refresh the "previously uploaded" list and reset the form for the next one.
    const res = await authedFetch(`/videos/lookup/${encodeURIComponent(currentStudent.rollNumber)}`);
    const fresh = await res.json();
    if (res.ok) renderSubmissions(fresh.submissions || []);
    resetUploadForm();
  } catch (err) {
    msg.textContent = err.message || 'Upload failed.';
    msg.classList.add('err');
    progWrap.hidden = true;
    btn.disabled = false;
  }
});
