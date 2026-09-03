/* ============================================================================
   admin.js — administrator dashboard (§16).
   Students · Results (correct/invalidate) · Volunteers & permissions · Exports.
   ============================================================================ */
const API = '/api';

const store = {
  get token() { return sessionStorage.getItem('dc_token'); },
  get role() { return sessionStorage.getItem('dc_role'); },
  get name() { return sessionStorage.getItem('dc_name'); },
  clear() { sessionStorage.clear(); }
};
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// Small icon set for row-action buttons. Each button keeps its text as a
// native `title` tooltip (shown on hover) instead of visible label text —
// keeps busy tables (Students/Results/Volunteers) compact and scannable.
const ICONS = {
  trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m-9 0l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none"><path d="M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.4 2.6a1.9 1.9 0 012.7 2.7L12 14.4l-4 1 1-4 9.4-9.4z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 5.5l13 13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v6c0 4.5-3 8.5-7 9-4-.5-7-4.5-7-9V6l7-3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6.3 6.3a9 9 0 1011.4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M11 12l9-9M17 6l2.5 2.5M14 9l2 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
// Wrap an icon as a titled/labelled span so it renders identically inside
// any existing button markup — hover (or focus, for keyboard users) shows
// the action name via the native title tooltip.
function iconLabel(icon, label) {
  return `<span class="btn-icon" title="${esc(label)}" aria-label="${esc(label)}">${ICONS[icon]}</span>`;
}

function initialsAvatar(name) {
  const initials = (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return `<span class="row-avatar">${esc(initials || '?')}</span>`;
}

async function authedFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${store.token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (res.status === 401) { store.clear(); window.location.href = 'login.html'; throw new Error('Session expired'); }
  return res;
}

// Gate: admins only.
if (!store.token) window.location.href = 'login.html';
if (store.role && store.role !== 'admin') window.location.href = 'console.html';

document.getElementById('whoami').textContent = `${store.name} · admin`;
document.getElementById('logoutBtn').addEventListener('click', () => { store.clear(); window.location.href = 'login.html'; });
{
  const initials = (store.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const av = document.getElementById('avatarInitials');
  if (av) av.textContent = initials || '?';
}

let config = null;
let challengeByKey = {};

// ---- tabs ----
document.querySelectorAll('.atab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.atab').forEach(t => t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    document.querySelectorAll('.view').forEach(v => v.hidden = true);
    document.getElementById(`view-${tab.dataset.view}`).hidden = false;
  });
});

// ============================================================================
// STUDENTS
// ============================================================================
let allStudents = [];

async function loadStats() {
  try {
    const s = await fetch(`${API}/stats`).then(r => r.json());
    const parts = config.challenges
      .map(c => `<span><strong>${s.participants[c.key] || 0}</strong>${esc(c.name)}</span>`).join('');
    document.getElementById('statsBar').innerHTML =
      `<span><strong>${s.totalStudents}</strong>registered</span>${parts}`;
  } catch (err) { document.getElementById('statsBar').innerHTML = ''; }
}

async function loadStudents() {
  const tbody = document.getElementById('studentsBody');
  tbody.innerHTML = '<tr><td colspan="8" class="muted">Loading…</td></tr>';
  try {
    allStudents = await authedFetch('/students').then(r => r.json());
    renderStudents();
  } catch (err) { /* handled */ }
}

function renderStudents() {
  const q = document.getElementById('studentSearch').value.trim().toLowerCase();
  const rows = allStudents.filter(s =>
    !q || [s.name, s.rollNumber, s.dotId].some(v => (v || '').toLowerCase().includes(q)));
  const tbody = document.getElementById('studentsBody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">No students.</td></tr>'; return; }
  tbody.innerHTML = rows.map(s => `
    <tr>
      <td class="mono">${esc(s.dotId)}</td>
      <td class="mono">${s.rollNumber ? esc(s.rollNumber) : '<span class="muted">—</span>'}</td>
      <td>${initialsAvatar(s.name)}${esc(s.name)}</td>
      <td class="mono">${esc(s.mobile || '')}</td>
      <td>${esc(s.gender)}</td>
      <td>${esc(s.branch)}</td>
      <td>${esc(s.section)}</td>
      <td class="row-actions">
        <button class="link-btn danger" data-act="del-student" data-id="${s._id}">${iconLabel('trash', 'Delete')}</button>
      </td>
    </tr>`).join('');
}

document.getElementById('studentSearch').addEventListener('input', renderStudents);
document.getElementById('refreshStudentsBtn').addEventListener('click', () => { loadStudents(); loadStats(); });

document.getElementById('studentsBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'del-student') {
    if (!confirm('Delete this student profile? Past results remain on record.')) return;
    await authedFetch(`/students/${id}`, { method: 'DELETE' });
    loadStudents(); loadStats();
  }
});

// ============================================================================
// RESULTS
// ============================================================================
async function loadResults() {
  const challenge = document.getElementById('resultChallengeFilter').value;
  const status = document.getElementById('resultStatusFilter').value;
  const tbody = document.getElementById('resultsBody');
  tbody.innerHTML = '<tr><td colspan="8" class="muted">Loading…</td></tr>';
  const qs = new URLSearchParams();
  if (challenge) qs.set('challenge', challenge);
  if (status) qs.set('status', status);
  try {
    const rows = await authedFetch(`/results?${qs}`).then(r => r.json());
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">No results.</td></tr>'; return; }
    tbody.innerHTML = rows.map(r => {
      const cname = (challengeByKey[r.challenge] || {}).name || r.challenge;
      const when = new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <tr>
          <td>${esc(cname)}</td>
          <td>${esc(r.name)}</td>
          <td class="mono">${esc(r.rollNumber || r.dotId)}</td>
          <td class="mono">${esc(r.summary)}</td>
          <td><span class="tag ${r.status}">${esc(r.status)}</span></td>
          <td>${esc(r.recordedBy || '')}</td>
          <td class="muted">${esc(when)}</td>
          <td class="row-actions">
            <button class="link-btn" data-act="correct" data-id="${r._id}" data-ch="${r.challenge}" data-metrics='${esc(JSON.stringify(r.metrics))}'>${iconLabel('edit', 'Correct')}</button>
            ${r.status !== 'invalid' ? `<button class="link-btn danger" data-act="invalidate" data-id="${r._id}">${iconLabel('ban', 'Invalidate')}</button>` : ''}
            <button class="link-btn danger" data-act="del-result" data-id="${r._id}">${iconLabel('trash', 'Delete')}</button>
          </td>
        </tr>`;
    }).join('');
  } catch (err) { /* handled */ }
}

document.getElementById('refreshResultsBtn').addEventListener('click', loadResults);
document.getElementById('resultChallengeFilter').addEventListener('change', loadResults);
document.getElementById('resultStatusFilter').addEventListener('change', loadResults);

document.getElementById('resultsBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'invalidate') {
    const note = prompt('Reason for invalidating (optional):') || '';
    if (note === null) return;
    await authedFetch(`/results/${id}/invalidate`, { method: 'PATCH', body: JSON.stringify({ note }) });
    loadResults(); loadStats();
  }
  if (btn.dataset.act === 'del-result') {
    if (!confirm('Delete this result permanently?')) return;
    await authedFetch(`/results/${id}`, { method: 'DELETE' });
    loadResults(); loadStats();
  }
  if (btn.dataset.act === 'correct') {
    openCorrectModal(id, btn.dataset.ch, JSON.parse(btn.dataset.metrics));
  }
});

// ---- correction modal (built on the fly) ----
function openCorrectModal(id, challengeKey, metrics) {
  const c = challengeByKey[challengeKey];
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `
    <div class="modal-card">
      <h3>Correct result</h3>
      <p class="muted">${esc(c.name)} — update the recorded values.</p>
      <div class="rec-fields">
        ${c.fields.map(f => {
          const step = f.integer ? '1' : (f.decimals ? (1 / Math.pow(10, f.decimals)) : 'any');
          const hint = (f.min != null && f.max != null) ? `(${f.min}\u2013${f.max})`
                     : (f.max != null) ? `(max ${f.max})`
                     : (f.min != null && f.min > 0) ? `(min ${f.min})` : '';
          const attrs = [`type="number"`, `step="${step}"`, `data-key="${f.key}"`,
            f.min != null ? `min="${f.min}"` : '', f.max != null ? `max="${f.max}"` : '',
            `value="${esc(metrics[f.key] ?? '')}"`].filter(Boolean).join(' ');
          return `<div class="field">
            <label>${esc(f.label)}${hint ? ` <span class="muted">${hint}</span>` : ''}</label>
            <input ${attrs}>
          </div>`;
        }).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-x="cancel">Cancel</button>
        <button class="btn btn-primary" data-x="save">Save correction</button>
      </div>
      <p class="form-msg" data-msg></p>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('[data-x="cancel"]').addEventListener('click', close);
  wrap.querySelector('[data-x="save"]').addEventListener('click', async () => {
    const msg = wrap.querySelector('[data-msg]'); msg.textContent = ''; msg.className = 'form-msg';
    const newMetrics = {};
    for (const inp of wrap.querySelectorAll('input[data-key]')) {
      const f = c.fields.find(x => x.key === inp.dataset.key) || {};
      const raw = inp.value;
      if (raw === '') { msg.textContent = `${f.label || 'All fields'} is required.`; msg.className = 'form-msg err'; return; }
      const v = Number(raw);
      if (Number.isNaN(v)) { msg.textContent = `${f.label} must be a number.`; msg.className = 'form-msg err'; return; }
      if (f.integer && !Number.isInteger(v)) { msg.textContent = `${f.label} must be a whole number.`; msg.className = 'form-msg err'; return; }
      if (f.min != null && v < f.min) { msg.textContent = `${f.label} cannot be below ${f.min}.`; msg.className = 'form-msg err'; return; }
      if (f.max != null && v > f.max) { msg.textContent = `${f.label} cannot exceed ${f.max}.`; msg.className = 'form-msg err'; return; }
      newMetrics[inp.dataset.key] = v;
    }
    const res = await authedFetch(`/results/${id}`, { method: 'PUT', body: JSON.stringify({ metrics: newMetrics }) });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || 'Could not save.'; msg.className = 'form-msg err'; return; }
    close(); loadResults(); loadStats();
  });
}

// ============================================================================
// VOLUNTEERS & PERMISSIONS
// ============================================================================
function buildPermChips(containerId, selected = []) {
  const box = document.getElementById(containerId);
  box.innerHTML = config.challenges.map(c => `
    <label class="perm-chip ${selected.includes(c.key) ? 'on' : ''}">
      <input type="checkbox" value="${c.key}" ${selected.includes(c.key) ? 'checked' : ''}>
      ${esc(c.icon)} ${esc(c.name)}
    </label>`).join('');
  box.querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => cb.closest('.perm-chip').classList.toggle('on', cb.checked)));
}
function readPermChips(containerId) {
  return [...document.querySelectorAll(`#${containerId} input:checked`)].map(cb => cb.value);
}

async function loadVolunteers() {
  const tbody = document.getElementById('volBody');
  tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
  try {
    const users = await authedFetch('/volunteers').then(r => r.json());
    tbody.innerHTML = users.map(u => {
      const perms = u.role === 'admin'
        ? '<span class="muted">All challenges</span>'
        : (u.permissions.length
            ? `<div class="perm-mini">${u.permissions.map(k => `<span class="m">${esc((challengeByKey[k] || {}).name || k)}</span>`).join('')}</div>`
            : '<span class="muted">None</span>');
      return `
        <tr>
          <td>${esc(u.displayName || u.username)}<div class="muted mono">${esc(u.username)}</div></td>
          <td><span class="tag role-${u.role}">${esc(u.role)}</span></td>
          <td>${perms}</td>
          <td><span class="tag ${u.active ? 'on' : 'off'}">${u.active ? 'active' : 'disabled'}</span></td>
          <td class="row-actions">
            ${u.role === 'volunteer' ? `<button class="link-btn" data-act="perms" data-id="${u._id}" data-perms='${esc(JSON.stringify(u.permissions))}' data-name="${esc(u.displayName || u.username)}">${iconLabel('shield', 'Permissions')}</button>` : ''}
            <button class="link-btn" data-act="toggle" data-id="${u._id}" data-active="${u.active}">${iconLabel('power', u.active ? 'Disable' : 'Enable')}</button>
            <button class="link-btn" data-act="reset" data-id="${u._id}">${iconLabel('key', 'Reset password')}</button>
            ${u.role === 'volunteer' ? `<button class="link-btn danger" data-act="del-vol" data-id="${u._id}">${iconLabel('trash', 'Delete')}</button>` : ''}
          </td>
        </tr>`;
    }).join('');
  } catch (err) { /* handled */ }
}

document.getElementById('refreshVolBtn').addEventListener('click', loadVolunteers);

document.getElementById('addVolBtn').addEventListener('click', async () => {
  const msg = document.getElementById('volMsg'); msg.textContent = ''; msg.className = 'form-msg';
  const payload = {
    username: document.getElementById('volUser').value.trim(),
    displayName: document.getElementById('volName').value.trim(),
    password: document.getElementById('volPass').value,
    permissions: readPermChips('volPerms')
  };
  if (!payload.username || !payload.password) { msg.textContent = 'Username and password are required.'; msg.className = 'form-msg err'; return; }
  const res = await authedFetch('/volunteers', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || 'Could not create.'; msg.className = 'form-msg err'; return; }
  msg.textContent = `Created volunteer ${data.username}.`; msg.className = 'form-msg ok';
  document.getElementById('volUser').value = ''; document.getElementById('volName').value = ''; document.getElementById('volPass').value = '';
  buildPermChips('volPerms', []);
  loadVolunteers();
});

document.getElementById('volBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'toggle') {
    await authedFetch(`/volunteers/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active: btn.dataset.active !== 'true' }) });
    loadVolunteers();
  }
  if (btn.dataset.act === 'reset') {
    const pw = prompt('New password for this account:');
    if (!pw) return;
    await authedFetch(`/volunteers/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: pw }) });
    alert('Password reset.');
  }
  if (btn.dataset.act === 'del-vol') {
    if (!confirm('Delete this volunteer account?')) return;
    await authedFetch(`/volunteers/${id}`, { method: 'DELETE' });
    loadVolunteers();
  }
  if (btn.dataset.act === 'perms') {
    openPermsModal(id, btn.dataset.name, JSON.parse(btn.dataset.perms));
  }
});

function openPermsModal(id, name, current) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `
    <div class="modal-card">
      <h3>Authorised challenges</h3>
      <p class="muted">${esc(name)} may record results only for the challenges ticked below (§10). Speed Cube and Chess are separate.</p>
      <div class="perm-row" id="modalPerms"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-x="cancel">Cancel</button>
        <button class="btn btn-primary" data-x="save">Save permissions</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  // reuse chip builder against the modal container
  const box = wrap.querySelector('#modalPerms');
  box.innerHTML = config.challenges.map(c => `
    <label class="perm-chip ${current.includes(c.key) ? 'on' : ''}">
      <input type="checkbox" value="${c.key}" ${current.includes(c.key) ? 'checked' : ''}>
      ${esc(c.icon)} ${esc(c.name)}
    </label>`).join('');
  box.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => cb.closest('.perm-chip').classList.toggle('on', cb.checked)));

  wrap.querySelector('[data-x="cancel"]').addEventListener('click', () => wrap.remove());
  wrap.querySelector('[data-x="save"]').addEventListener('click', async () => {
    const permissions = [...box.querySelectorAll('input:checked')].map(cb => cb.value);
    await authedFetch(`/volunteers/${id}/permissions`, { method: 'PATCH', body: JSON.stringify({ permissions }) });
    wrap.remove(); loadVolunteers();
  });
}

// ============================================================================
// EXPORTS (§16)
// ============================================================================
async function downloadCsv(path, filename) {
  const res = await authedFetch(path);
  const text = await res.text();
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
document.getElementById('exportStudentsBtn').addEventListener('click', () => downloadCsv('/export/students.csv', 'dotconnect-students.csv'));
document.getElementById('exportResultsBtn').addEventListener('click', () => {
  const challenge = document.getElementById('exportChallengeSelect').value || 'all';
  const filename = challenge === 'all' ? 'dotconnect-results-all.csv' : `dotconnect-results-${challenge}.csv`;
  downloadCsv(`/export/results.csv?challenge=${encodeURIComponent(challenge)}`, filename);
});

// ============================================================================
// DAY WISE STATISTICS — visible to admin and volunteer logins alike
// ============================================================================

// ---- tiny inline-SVG chart helpers (no chart library needed) ----
function sparklinePoints(values, w, h, pad) {
  const n = values.length;
  const max = Math.max(1, ...values);
  if (n <= 1) {
    const y = h - pad - ((values[0] || 0) / max) * (h - 2 * pad);
    return [[pad, y], [w - pad, y]];
  }
  return values.map((v, i) => [
    pad + (i / (n - 1)) * (w - 2 * pad),
    h - pad - (v / max) * (h - 2 * pad)
  ]);
}
// Smooth area+line trend chart, used on each summary card (one point per day).
function sparklineArea(values, color, w = 150, h = 46) {
  const pad = 4;
  const pts = sparklinePoints(values, w, h, pad);
  const line = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.3" fill="${color}"/>`).join('');
  return `<svg class="dw-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="${area}" fill="${color}" opacity="0.15"></polygon>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
    ${dots}
  </svg>`;
}
// Thin 24-bar hourly-activity chart, used under each number in the table.
function sparklineBars(values, color, w = 92, h = 22) {
  const max = Math.max(1, ...values);
  const n = values.length || 1;
  const gap = 1.4;
  const barW = (w - gap * (n - 1)) / n;
  const bars = values.map((v, i) => {
    const bh = Math.max(1, (v / max) * (h - 2));
    const x = i * (barW + gap);
    return `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="0.5" fill="${color}" opacity="${v > 0 ? 0.9 : 0.22}"/>`;
  }).join('');
  return `<svg class="dw-cell-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}

function renderDaywiseCards(data) {
  const box = document.getElementById('dwCards');
  if (!box) return;
  const nDays = data.days.length;
  const dayWord = `Across ${nDays} day${nDays === 1 ? '' : 's'}`;
  const orderedKeys = config.challenges.map(c => c.key);

  let html = `
    <div class="dw-card">
      <div class="dw-card-top">
        <span class="dw-card-icon" style="background:var(--accent-soft);color:var(--accent)">${ICONS.users}</span>
        <div>
          <div class="dw-card-label">Total Registrations</div>
          <div class="dw-card-num" style="color:var(--accent)">${data.totals.total}</div>
          <div class="dw-card-sub muted">${dayWord}</div>
        </div>
      </div>
      ${sparklineArea(data.days.map(d => d.registrations), 'var(--accent)')}
    </div>`;

  orderedKeys.forEach(key => {
    const c = challengeByKey[key];
    if (!c) return;
    html += `
      <div class="dw-card">
        <div class="dw-card-top">
          <span class="dw-card-icon" style="background:color-mix(in srgb, var(--${key}) 16%, transparent);color:var(--${key})">${esc(c.icon)}</span>
          <div>
            <div class="dw-card-label">${esc(c.name)}</div>
            <div class="dw-card-num" style="color:var(--${key})">${data.totals[key] || 0}</div>
            <div class="dw-card-sub muted">${dayWord}</div>
          </div>
        </div>
        ${sparklineArea(data.days.map(d => d.participants[key] || 0), `var(--${key})`)}
      </div>`;
  });

  box.innerHTML = html;
}

function dwCell(num, hourly, color) {
  const bars = (hourly && hourly.length ? hourly : new Array(24).fill(0));
  return `<div class="dw-cell-num" style="color:${color}">${num}</div>${sparklineBars(bars, color)}`;
}

function renderDaywiseTable(data) {
  const tbody = document.querySelector('#daywiseTable tbody');
  if (!tbody) return;
  if (!data.days.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">No registrations or results recorded yet.</td></tr>';
    return;
  }
  const orderedKeys = config.challenges.map(c => c.key);
  tbody.innerHTML = data.days.map(d => `
    <tr>
      <td>
        <div class="dw-day-name">Day ${d.day}</div>
        ${d.isFirstDay ? '<span class="dw-badge">First Activity Day</span>' : ''}
      </td>
      <td>${esc(d.dateLabel)}</td>
      <td>${dwCell(d.registrations, d.hourly.total, 'var(--accent)')}</td>
      ${orderedKeys.map(k => `<td>${dwCell(d.participants[k] || 0, d.hourly[k], `var(--${k})`)}</td>`).join('')}
    </tr>`).join('');
}

async function loadDaywise() {
  const tbody = document.querySelector('#daywiseTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="muted">Loading…</td></tr>';

  const fromInput = document.getElementById('dwFrom');
  const toInput = document.getElementById('dwTo');
  const params = new URLSearchParams();
  if (fromInput && fromInput.value) params.set('from', fromInput.value);
  if (toInput && toInput.value) params.set('to', toInput.value);

  try {
    const data = await authedFetch(`/results/stats/daywise${params.toString() ? '?' + params : ''}`).then(r => r.json());
    renderDaywiseCards(data);
    renderDaywiseTable(data);

    // Default the date pickers to the detected activity range, but don't
    // clobber a range the admin deliberately chose.
    if (fromInput && !fromInput.value && data.rangeStart) fromInput.value = data.rangeStart;
    if (toInput && !toInput.value && data.rangeEnd) toInput.value = data.rangeEnd;

    const foot = document.getElementById('dwFootNote');
    if (foot) {
      const nDays = data.days.length;
      const updated = data.lastUpdated
        ? new Date(data.lastUpdated).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '—';
      foot.textContent = `${nDays} Day${nDays === 1 ? '' : 's'} of Activity  ·  Last updated: ${updated}`;
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Could not load day-wise stats.</td></tr>';
  }
}

document.getElementById('dwApplyBtn')?.addEventListener('click', loadDaywise);
document.getElementById('dwResetBtn')?.addEventListener('click', () => {
  document.getElementById('dwFrom').value = '';
  document.getElementById('dwTo').value = '';
  loadDaywise();
});
document.getElementById('dwExportBtn')?.addEventListener('click', () => {
  const fromInput = document.getElementById('dwFrom');
  const toInput = document.getElementById('dwTo');
  const params = new URLSearchParams();
  if (fromInput && fromInput.value) params.set('from', fromInput.value);
  if (toInput && toInput.value) params.set('to', toInput.value);
  downloadCsv(`/export/daywise.csv${params.toString() ? '?' + params : ''}`, 'dotconnect-day-wise-stats.csv');
});

// ============================================================================
// INIT
// ============================================================================
(async () => {
  config = await fetch(`${API}/config`).then(r => r.json());
  challengeByKey = Object.fromEntries(config.challenges.map(c => [c.key, c]));

  // populate challenge filters + permission chips
  const optHtml = config.challenges.map(c => `<option value="${c.key}">${esc(c.name)}</option>`).join('');
  document.getElementById('resultChallengeFilter').insertAdjacentHTML('beforeend', optHtml);
  buildPermChips('volPerms', []);

  // Results export: default to the first game (a proper per-field export),
  // with "All challenges" as an explicit fallback option at the end.
  document.getElementById('exportChallengeSelect').innerHTML =
    optHtml + `<option value="all">All challenges (combined summary)</option>`;

  // sidebar: "All Challenges" + one shortcut per challenge, jumping to the
  // Results tab pre-filtered to that challenge (or reset for "All").
  const sideBox = document.getElementById('sidebarChallenges');
  if (sideBox) {
    const goToResults = (key) => {
      document.querySelectorAll('.atab').forEach(t => t.setAttribute('aria-selected', 'false'));
      document.querySelector('.atab[data-view="results"]').setAttribute('aria-selected', 'true');
      document.querySelectorAll('.view').forEach(v => v.hidden = true);
      document.getElementById('view-results').hidden = false;
      const filter = document.getElementById('resultChallengeFilter');
      filter.value = key;
      filter.dispatchEvent(new Event('change'));
    };
    sideBox.innerHTML = `<button class="side-item" data-key="">
        <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.6"/></svg>
        All Challenges
      </button>` +
      config.challenges.map(c => `<button class="side-item" data-key="${c.key}"><span class="icon">${esc(c.icon || '•')}</span> ${esc(c.name)}</button>`).join('');
    sideBox.querySelectorAll('.side-item').forEach(btn => {
      btn.addEventListener('click', () => goToResults(btn.dataset.key));
    });
  }

  loadStats();
  loadStudents();
  loadResults();
  loadVolunteers();
  loadDaywise();
})();
