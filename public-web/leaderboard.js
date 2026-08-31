const API = '/api';
const REFRESH_MS = 10000;
const PAGE_SIZE = 10;

// Short per-challenge tagline for the panel header (mirrors the ranking rule).
const RULE_NOTE = {
  speedcube: 'Fastest official time',
  chess: 'Most puzzles solved',
  typing: 'Highest WPM',
  debug: 'Fastest time'
};

let config = null;      // { challenges: [...] }
let current = 'all';    // selected tab key
let detailCache = null; // { key, challenge, rows }
let detailPage = 0;     // current page in the detailed view (§2)

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function hintFor(key) {
  const c = config && config.challenges.find(x => x.key === key);
  return c ? c.hint : '';
}
// A small "what's this score?" button + popover (§3).
function infoButton(key) {
  return `<button class="info-btn" data-hint="${esc(hintFor(key))}" title="What does this score mean?" aria-label="What does this score mean?">🔍</button>`;
}

// ---- search (§4): filters whichever rows are currently rendered, by name,
// roll number, or DoTT ID. Works across both the All Challenges grid and a
// single-challenge detail table since both use the same row markup.
let searchQuery = '';
function applySearchFilter() {
  const q = searchQuery.trim().toLowerCase();
  const rows = document.querySelectorAll('#board tbody tr:not(.empty)');
  let shown = 0;
  rows.forEach(tr => {
    if (!q) { tr.style.display = ''; shown++; return; }
    const hay = `${tr.querySelector('.name')?.textContent || ''} ${tr.querySelector('.ident')?.textContent || ''}`.toLowerCase();
    const match = hay.includes(q);
    tr.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  const note = document.getElementById('searchEmpty');
  if (note) {
    note.hidden = !(q && rows.length && shown === 0);
    if (!note.hidden) note.textContent = `No students match "${searchQuery.trim()}" on this board.`;
  }
}
function wireSearch() {
  const input = document.getElementById('boardSearch');
  const btn = document.getElementById('boardSearchBtn');
  if (!input) return;
  input.addEventListener('input', () => { searchQuery = input.value; applySearchFilter(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') applySearchFilter(); });
  if (btn) btn.addEventListener('click', () => { searchQuery = input.value; applySearchFilter(); input.focus(); });
}

// ---- clock ----
function tickClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(tickClock, 1000); tickClock();

// ---- tabs ----
function buildTabs() {
  const tabs = document.getElementById('tabs');
  const items = [{ key: 'all', name: 'All Challenges', icon: '▦' }]
    .concat(config.challenges.map(c => ({ key: c.key, name: c.name, icon: c.icon })));
  tabs.innerHTML = items.map(it =>
    `<button class="tab" role="tab" data-key="${it.key}" aria-selected="${it.key === current}">
       <span aria-hidden="true">${esc(it.icon)}</span>${esc(it.name)}
     </button>`
  ).join('');
  tabs.querySelectorAll('.tab').forEach(btn =>
    btn.addEventListener('click', () => {
      current = btn.dataset.key;
      detailPage = 0; detailCache = null;
      syncTabs(); render();
    })
  );
}
function syncTabs() {
  document.querySelectorAll('.tab').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.key === current)));
}

// ---- info popover: toggle a floating bubble under the clicked button ----
function wireInfoButtons(root) {
  root.querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.querySelector('.info-pop');
      const wasForThis = existing && existing._owner === btn;
      if (existing) existing.remove();
      if (wasForThis) return;
      const pop = document.createElement('div');
      pop.className = 'info-pop';
      pop.textContent = btn.dataset.hint || '';
      pop._owner = btn;
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      pop.style.top = `${window.scrollY + r.bottom + 8}px`;
      pop.style.left = `${Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - 300)}px`;
    });
  });
}
document.addEventListener('click', () => {
  const p = document.querySelector('.info-pop'); if (p) p.remove();
});

// ---- All Challenges view: Top 10 of each of the four (§11) ----
async function renderAll() {
  const board = document.getElementById('board');
  const data = await fetch(`${API}/leaderboard`).then(r => r.json());

  const panels = config.challenges.map(c => {
    const rows = data.boards[c.key] || [];
    const colHeads = c.columns.map(col => `<th style="text-align:right">${esc(col.label)}</th>`).join('');
    const body = rows.length
      ? rows.map(r => {
          const cells = r.columns.map(col => `<td class="score">${esc(col.value)}</td>`).join('');
          return `
          <tr class="${r.rank === 1 ? 'top1' : ''}">
            <td class="rank">${r.rank}</td>
            <td class="name">${esc(r.name)}</td>
            <td class="ident">${esc(r.identifier)}</td>
            ${cells}
          </tr>`;
        }).join('')
      : `<tr class="empty"><td colspan="${3 + c.columns.length}">No results recorded yet.</td></tr>`;

    return `
      <section class="panel c-${c.key}">
        <div class="panel-head">
          <span class="panel-icon">${esc(c.icon)}</span>
          <span class="panel-title">${esc(c.name)}${c.provisional ? '<span class="provisional">provisional</span>' : ''}</span>
          ${infoButton(c.key)}
          <span class="panel-note">Top 10 · ${esc(RULE_NOTE[c.key] || '')}</span>
        </div>
        <table>
          <thead><tr><th>#</th><th>Name</th><th>Roll / ID</th>${colHeads}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </section>`;
  }).join('');

  board.innerHTML = `<div class="grid-all">${panels}</div>`;
  wireInfoButtons(board);
  applySearchFilter();
}

// ---- Detailed single-challenge view (§12) with pagination (§2) ----
function paintDetail() {
  const board = document.getElementById('board');
  const { challenge: c, rows } = detailCache;

  const colHeads = c.columns.map(col => `<th style="text-align:right">${esc(col.label)}</th>`).join('');
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (detailPage >= pages) detailPage = pages - 1;
  const start = detailPage * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

  const bodyRows = total
    ? slice.map(r => {
        const cells = r.columns.map(col => `<td class="score">${esc(col.value)}</td>`).join('');
        const when = r.recordedAt ? new Date(r.recordedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return `
          <tr class="${r.rank === 1 ? 'top1' : ''}">
            <td class="rank">${r.rank}</td>
            <td class="name">${esc(r.name)}</td>
            <td class="ident">${esc(r.identifier)}</td>
            <td>${esc(r.branch)} / ${esc(r.section)}</td>
            ${cells}
            <td class="meta">${esc(when)}</td>
            <td class="by">${esc(r.recordedBy)}</td>
          </tr>`;
      }).join('')
    : `<tr class="empty"><td colspan="${5 + c.columns.length}">No results recorded yet.</td></tr>`;

  const from = total ? start + 1 : 0;
  const to = Math.min(start + PAGE_SIZE, total);
  const pager = total > PAGE_SIZE ? `
    <div class="pager">
      <button class="pg-btn" data-pg="prev" ${detailPage === 0 ? 'disabled' : ''}>← Prev</button>
      <span class="pg-info">Showing ${from}–${to} of ${total}</span>
      <button class="pg-btn" data-pg="next" ${detailPage >= pages - 1 ? 'disabled' : ''}>Next →</button>
    </div>` : '';

  board.innerHTML = `
    <section class="panel detail c-${c.key}">
      <div class="panel-head">
        <span class="panel-icon">${esc(c.icon)}</span>
        <span class="panel-title">${esc(c.name)}${c.provisional ? '<span class="provisional">rules to be finalised</span>' : ''}</span>
        ${infoButton(c.key)}
        <span class="panel-note">${esc(RULE_NOTE[c.key] || '')}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Name</th><th>Roll / ID</th><th>Branch / Sec</th>
            ${colHeads}<th style="text-align:right">Recorded</th><th>By</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
      ${pager}
    </section>`;

  wireInfoButtons(board);
  applySearchFilter();
  board.querySelectorAll('.pg-btn').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.pg === 'prev' && detailPage > 0) detailPage--;
    if (btn.dataset.pg === 'next') detailPage++;
    paintDetail();
  }));
}

async function renderDetail(key) {
  const data = await fetch(`${API}/leaderboard/${key}`).then(r => r.json());
  detailCache = { key, challenge: data.challenge, rows: data.rows };
  paintDetail();
}

async function render() {
  try {
    if (current === 'all') await renderAll();
    else await renderDetail(current);
  } catch (err) {
    document.getElementById('board').innerHTML = '<p class="loading">Could not reach the server — retrying…</p>';
  }
}

async function init() {
  try {
    const qrImg = document.getElementById('qrHeaderImg');
    if (qrImg) qrImg.src = `${API}/qr?data=${encodeURIComponent(location.origin + '/')}`;
    wireSearch();

    config = await fetch(`${API}/config`).then(r => r.json());
    buildTabs();
    await render();
    setInterval(render, REFRESH_MS);
  } catch (err) {
    document.getElementById('board').innerHTML = '<p class="loading">Could not load the leaderboard.</p>';
  }
}
init();
