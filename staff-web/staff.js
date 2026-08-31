/* ============================================================================
   staff.js — shared auth + sign-in redirect + the volunteer/admin CONSOLE.
   Loaded by login.html and console.html.
   ============================================================================ */
const API = '/api';

// --- session helpers ---
const store = {
  get token() { return sessionStorage.getItem('dc_token'); },
  set token(v) { sessionStorage.setItem('dc_token', v); },
  get role() { return sessionStorage.getItem('dc_role'); },
  set role(v) { sessionStorage.setItem('dc_role', v); },
  get name() { return sessionStorage.getItem('dc_name'); },
  set name(v) { sessionStorage.setItem('dc_name', v); },
  get perms() { try { return JSON.parse(sessionStorage.getItem('dc_perms') || '[]'); } catch { return []; } },
  set perms(v) { sessionStorage.setItem('dc_perms', JSON.stringify(v || [])); },
  clear() { sessionStorage.clear(); }
};

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// A short "(0–59)", "(max 3)", "(min 88)" hint shown next to a metric field.
function rangeHint(f) {
  if (f.min != null && f.max != null) return `(${f.min}\u2013${f.max})`;
  if (f.max != null) return `(max ${f.max})`;
  if (f.min != null && f.min > 0) return `(min ${f.min})`;
  return '';
}
// One <input> for a metric field, carrying its numeric constraints (§17).
function metricInputHtml(f) {
  const step = f.integer ? '1' : (f.decimals ? (1 / Math.pow(10, f.decimals)) : 'any');
  const attrs = [
    `id="m_${f.key}"`, 'type="number"', `step="${step}"`, 'inputmode="decimal"',
    f.min != null ? `min="${f.min}"` : '',
    f.max != null ? `max="${f.max}"` : ''
  ].filter(Boolean).join(' ');
  const hint = rangeHint(f);
  return `<div class="field">
      <label for="m_${f.key}">${esc(f.label)}${hint ? ` <span class="muted">${hint}</span>` : ''}</label>
      <input ${attrs}>
    </div>`;
}
// Validate a typed value against a field; returns an error string or null.
function metricError(f, raw) {
  if (raw === '' || raw == null) return `${f.label} is required.`;
  const v = Number(raw);
  if (Number.isNaN(v)) return `${f.label} must be a number.`;
  if (f.integer && !Number.isInteger(v)) return `${f.label} must be a whole number.`;
  if (f.min != null && v < f.min) return `${f.label} cannot be below ${f.min}.`;
  if (f.max != null && v > f.max) return `${f.label} cannot exceed ${f.max}.`;
  return null;
}

async function authedFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${store.token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (res.status === 401) { store.clear(); window.location.href = 'login.html'; throw new Error('Session expired'); }
  return res;
}

// ============================================================================
// SIGN-IN PAGE
// ============================================================================
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) { errorEl.textContent = data.error || 'Sign-in failed.'; return; }
      store.token = data.token; store.role = data.role;
      store.name = data.displayName || data.username; store.perms = data.permissions || [];
      // Land on the console for your role (§3). Admins get the admin dashboard.
      window.location.href = data.role === 'admin' ? 'admin.html' : 'console.html';
    } catch (err) {
      errorEl.textContent = 'Could not reach the server.';
    }
  });
}

// ============================================================================
// CONSOLE PAGE
// ============================================================================
const consoleRoot = document.getElementById('searchInput');
if (consoleRoot) {
  if (!store.token) window.location.href = 'login.html';

  let config = null;
  let selectedStudent = null;

  // header
  document.getElementById('whoami').textContent = `${store.name} · ${store.role}`;
  if (store.role === 'admin') document.getElementById('adminLink').hidden = false;
  document.getElementById('logoutBtn').addEventListener('click', () => { store.clear(); window.location.href = 'login.html'; });
  {
    const initials = (store.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const av = document.getElementById('avatarInitials');
    if (av) av.textContent = initials || '?';
  }

  // ---- tabs: Post Result / Register Student (kept separate, not shown together) ----
  document.querySelectorAll('#consoleTabs .atab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#consoleTabs .atab').forEach(t => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      document.querySelectorAll('main.console > .view').forEach(v => v.hidden = true);
      document.getElementById(`view-${tab.dataset.view}`).hidden = false;
    });
  });

  // Which challenges may this account record for?
  function myChallenges() {
    if (!config) return [];
    if (store.role === 'admin') return config.challenges;
    return config.challenges.filter(c => store.perms.includes(c.key));
  }

  // ---- load config, then wire up ----
  (async () => {
    config = await fetch(`${API}/config`).then(r => r.json());

    // gender dropdown
    const g = document.getElementById('regGender');
    g.innerHTML = '<option value="">Select…</option>' + config.genders.map(x => `<option>${esc(x)}</option>`).join('');

    // challenge dropdown (only authorised ones)
    const sel = document.getElementById('recChallenge');
    const list = myChallenges();
    if (!list.length) {
      sel.innerHTML = '<option value="">No challenges assigned to you</option>';
      sel.disabled = true;
    } else {
      sel.innerHTML = '<option value="">Select challenge…</option>' +
        list.map(c => `<option value="${c.key}">${esc(c.icon)} ${esc(c.name)}</option>`).join('');
    }

    // sidebar: "All Challenges" jumps to Post Result with nothing preselected;
    // each challenge shortcut jumps to Post Result with that challenge chosen
    // (only for challenges this account is actually authorised to record).
    const sideBox = document.getElementById('sidebarChallenges');
    if (sideBox) {
      const goToPost = (key) => {
        document.querySelectorAll('#consoleTabs .atab').forEach(t => t.setAttribute('aria-selected', 'false'));
        document.querySelector('#consoleTabs .atab[data-view="post"]').setAttribute('aria-selected', 'true');
        document.querySelectorAll('main.console > .view').forEach(v => v.hidden = true);
        document.getElementById('view-post').hidden = false;
        if (key && list.some(c => c.key === key)) {
          sel.value = key;
          sel.dispatchEvent(new Event('change'));
        }
      };
      sideBox.innerHTML = `<button class="side-item" data-key="">
          <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.6"/></svg>
          All Challenges
        </button>` +
        config.challenges.map(c => {
          const authorised = list.some(x => x.key === c.key);
          return `<button class="side-item" data-key="${c.key}" ${authorised ? '' : 'style="opacity:.4" title="Not authorised"'}>
            <span class="icon">${esc(c.icon || '•')}</span> ${esc(c.name)}
          </button>`;
        }).join('');
      sideBox.querySelectorAll('.side-item').forEach(btn => {
        btn.addEventListener('click', () => goToPost(btn.dataset.key));
      });
    }
  })();

  // ---- SEARCH ----
  async function doSearch() {
    const q = document.getElementById('searchInput').value.trim();
    const box = document.getElementById('searchResults');
    if (!q) { box.innerHTML = '<p class="muted">Type a roll number, DoTT ID, or name.</p>'; return; }
    box.innerHTML = '<p class="muted">Searching…</p>';
    try {
      const rows = await authedFetch(`/students/search?q=${encodeURIComponent(q)}`).then(r => r.json());
      if (!rows.length) {
        box.innerHTML = '<p class="muted">No matching student. Switch to the <b>Register Student</b> tab to add them.</p>';
        return;
      }
      box.innerHTML = rows.map(s => `
        <div class="result-item" data-id="${s._id}">
          <div>
            <div class="r-name">${esc(s.name)}</div>
            <div class="r-meta">${esc(s.branch)} / ${esc(s.section)} · ${esc(s.mobileMasked)}</div>
          </div>
          <div class="r-id">${esc(s.rollNumber || s.dotId)}</div>
        </div>`).join('');
      box.querySelectorAll('.result-item').forEach(el =>
        el.addEventListener('click', () => selectStudent(el.dataset.id)));
    } catch (err) { /* handled */ }
  }
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  // ---- SELECT STUDENT + HISTORY ----
  async function selectStudent(id) {
    try {
      const data = await authedFetch(`/students/${id}`).then(r => r.json());
      selectedStudent = data.student;
      renderStudent(data.student, data.history);
      document.getElementById('studentCard').hidden = false;
      document.getElementById('recordCard').hidden = false;
      document.getElementById('noStudentNote').hidden = true;
      resetRecordForm();
      document.getElementById('studentCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { /* handled */ }
  }

  function renderStudent(s, history) {
    const item = (k, v, mono) => `<div class="sd-item"><span class="k">${k}</span><span class="v ${mono ? 'mono' : ''}">${esc(v || '—')}</span></div>`;
    document.getElementById('studentDetail').innerHTML =
      item('Name', s.name) + item('DoTT ID', s.dotId, true) + item('Roll No.', s.rollNumber, true) +
      item('Branch', s.branch) + item('Section', s.section) + item('Mobile', s.mobileMasked, true);

    const map = Object.fromEntries(config.challenges.map(c => [c.key, c]));
    document.getElementById('historyGrid').innerHTML = config.challenges.map(c => {
      const h = history[c.key];
      const done = h && h.participated;
      return `
        <div class="hist-item">
          <div class="h-name">${esc(c.icon)} ${esc(c.name)}</div>
          <div class="h-status ${done ? 'done' : 'none'}">${done ? 'Participated' : 'Not attempted'}</div>
          ${done && h.best ? `<div class="h-best">Best: ${esc(h.best.summary)}</div>` : ''}
        </div>`;
    }).join('');
  }

  document.getElementById('clearStudentBtn').addEventListener('click', () => {
    selectedStudent = null;
    document.getElementById('studentCard').hidden = true;
    document.getElementById('recordCard').hidden = true;
  });

  // ---- RECORD ----
  function resetRecordForm() {
    document.getElementById('recChallenge').value = '';
    document.getElementById('recFields').innerHTML = '';
    document.getElementById('dupWarning').hidden = true;
    document.getElementById('recordMsg').textContent = '';
    document.getElementById('saveResultBtn').disabled = true;
  }

  function currentChallenge() {
    const key = document.getElementById('recChallenge').value;
    return config.challenges.find(c => c.key === key) || null;
  }

  async function onChallengeChange() {
    const c = currentChallenge();
    const fieldsBox = document.getElementById('recFields');
    const warn = document.getElementById('dupWarning');
    const saveBtn = document.getElementById('saveResultBtn');
    warn.hidden = true; document.getElementById('recordMsg').textContent = '';
    if (!c) { fieldsBox.innerHTML = ''; saveBtn.disabled = true; return; }

    fieldsBox.innerHTML = c.fields.map(metricInputHtml).join('');
    saveBtn.disabled = false;

    // Warn if already participated, and show current best (§7, §9).
    try {
      const pc = await authedFetch(`/results/precheck?studentId=${selectedStudent._id}&challenge=${c.key}`).then(r => r.json());
      if (pc.alreadyParticipated) {
        warn.hidden = false;
        warn.innerHTML = `<b>Already participated.</b> Current best: <b>${esc(pc.best.summary)}</b>. A new result only replaces it if it is better.`;
      }
    } catch (err) { /* non-blocking */ }
  }
  document.getElementById('recChallenge').addEventListener('change', onChallengeChange);

  document.getElementById('saveResultBtn').addEventListener('click', async () => {
    const c = currentChallenge();
    const msg = document.getElementById('recordMsg');
    msg.textContent = ''; msg.className = 'form-msg';
    if (!c || !selectedStudent) return;

    const metrics = {};
    for (const f of c.fields) {
      const raw = document.getElementById(`m_${f.key}`).value;
      const err = metricError(f, raw);
      if (err) { msg.textContent = err; msg.className = 'form-msg err'; return; }
      metrics[f.key] = Number(raw);
    }

    try {
      const res = await authedFetch('/results', {
        method: 'POST',
        body: JSON.stringify({ studentId: selectedStudent._id, challenge: c.key, metrics })
      });
      const data = await res.json();
      if (!res.ok) { msg.textContent = data.error || 'Could not save.'; msg.className = 'form-msg err'; return; }

      if (data.becameActive) {
        msg.textContent = `Saved — ${data.summary} is now ${selectedStudent.name}'s best in ${c.name}.`;
      } else {
        msg.textContent = `Saved for the record, but ${data.previousBest.summary} remains the better result, so the leaderboard is unchanged.`;
      }
      msg.className = 'form-msg ok';

      // Refresh the history + warning to reflect the new state.
      const fresh = await authedFetch(`/students/${selectedStudent._id}`).then(r => r.json());
      renderStudent(fresh.student, fresh.history);
      c.fields.forEach(f => { document.getElementById(`m_${f.key}`).value = ''; });
      onChallengeChange();
    } catch (err) { /* handled */ }
  });

  // ---- REGISTER ----
  document.getElementById('registerBtn').addEventListener('click', async () => {
    const msg = document.getElementById('registerMsg');
    msg.textContent = ''; msg.className = 'form-msg';
    const payload = {
      name: document.getElementById('regName').value.trim(),
      mobile: document.getElementById('regMobile').value.trim(),
      gender: document.getElementById('regGender').value,
      branch: document.getElementById('regBranch').value.trim(),
      section: document.getElementById('regSection').value.trim(),
      rollNumber: document.getElementById('regRoll').value.trim()
    };
    if (!payload.name || !payload.mobile || !payload.gender || !payload.branch || !payload.section) {
      msg.textContent = 'Name, mobile, gender, branch and section are required.'; msg.className = 'form-msg err'; return;
    }
    try {
      const res = await authedFetch('/students', { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) { msg.textContent = data.error || 'Could not register.'; msg.className = 'form-msg err'; return; }
      msg.textContent = `Registered ${data.name} as ${data.dotId}${data.rollNumber ? ' (roll ' + data.rollNumber + ')' : ''}.`;
      msg.className = 'form-msg ok';
      ['regName', 'regMobile', 'regBranch', 'regSection', 'regRoll'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('regGender').value = '';
      // Switch to the Post Result tab and jump straight to recording for the new student.
      document.querySelector('#consoleTabs .atab[data-view="post"]').click();
      selectStudent(data._id);
    } catch (err) { /* handled */ }
  });
}
