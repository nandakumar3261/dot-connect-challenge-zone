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

// ---- search (§4): a real lookup across the FULL dataset, not just whatever
// rows happen to be rendered on the current page — a student's whole point
// in searching is to find their rank even when it's on page 4, or outside
// the Top 10 shown on the All Challenges board.
let searchQuery = '';
let fullBoardCache = {}; // lazy, per-challenge: full (up to 200) rows, used only when searching from "All Challenges"

function matchesQuery(row, q) {
  const hay = `${row.name || ''} ${row.identifier || ''} ${row.rollNumber || ''} ${row.dotId || ''}`.toLowerCase();
  return hay.includes(q);
}

async function loadFullBoard(key) {
  if (fullBoardCache[key]) return fullBoardCache[key];
  const data = await fetch(`${API}/leaderboard/${key}`).then(r => r.json());
  fullBoardCache[key] = data.rows;
  return data.rows;
}

function clearSearchHighlights() {
  document.querySelectorAll('#board tbody tr.search-hit').forEach(tr => tr.classList.remove('search-hit'));
}

function renderSearchSummary(payload) {
  let box = document.getElementById('searchSummary');
  if (!payload) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'searchSummary';
    box.className = 'search-summary';
  }
  document.getElementById('board').prepend(box);
  const rows = payload.results.map(({ challenge, hit }) => hit
    ? `<div class="ss-row"><span class="ss-ch">${esc(challenge.icon)} ${esc(challenge.name)}</span><span class="ss-val">Rank #${hit.rank} — ${esc(hit.summary || '')}</span></div>`
    : `<div class="ss-row"><span class="ss-ch">${esc(challenge.icon)} ${esc(challenge.name)}</span><span class="ss-val muted">Not yet recorded</span></div>`
  ).join('');
  box.innerHTML = `<div class="ss-head">Results for "${esc(payload.query)}"</div>${rows}`;
}

function highlightAndReveal(row) {
  requestAnimationFrame(() => {
    document.querySelectorAll('#board tbody tr').forEach(tr => {
      const name = tr.querySelector('.name')?.textContent;
      const ident = tr.querySelector('.ident')?.textContent;
      if (name === row.name && ident === row.identifier) {
        tr.classList.add('search-hit');
        tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
}

// Runs a real search: within the full dataset of the current detail board,
// or — from "All Challenges" — across all four full boards at once, so the
// answer to "where do I stand?" is never limited by what's on screen.
async function runSearch() {
  const input = document.getElementById('boardSearch');
  const note = document.getElementById('searchEmpty');
  const raw = input.value.trim();
  const q = raw.toLowerCase();

  clearSearchHighlights();

  if (!q) {
    note.hidden = true;
    renderSearchSummary(null);
    return;
  }

  if (current === 'all') {
    note.hidden = false;
    note.textContent = `Searching all ${config.challenges.length} challenges…`;
    try {
      const results = [];
      for (const c of config.challenges) {
        const rows = await loadFullBoard(c.key);
        results.push({ challenge: c, hit: rows.find(r => matchesQuery(r, q)) || null });
      }
      renderSearchSummary({ query: raw, results });
      const anyHit = results.some(r => r.hit);
      note.hidden = anyHit;
      if (!anyHit) note.textContent = `No student matching "${raw}" found in any challenge.`;
    } catch (err) {
      note.hidden = false;
      note.textContent = 'Could not search right now — try again in a moment.';
    }
  } else {
    renderSearchSummary(null);
    if (!detailCache || !detailCache.rows.length) {
      note.hidden = false;
      note.textContent = detailCache ? 'No results recorded yet on this board.' : 'Still loading…';
      return;
    }
    const idx = detailCache.rows.findIndex(r => matchesQuery(r, q));
    if (idx === -1) {
      note.hidden = false;
      note.textContent = `No student matching "${raw}" found among all ${detailCache.rows.length} recorded results.`;
      return;
    }
    const hit = detailCache.rows[idx];
    note.hidden = false;
    note.textContent = `Found ${hit.name} — rank #${hit.rank} of ${detailCache.rows.length}.`;
    detailPage = Math.floor(idx / PAGE_SIZE);
    paintDetail();
    highlightAndReveal(hit);
  }
}

function wireSearch() {
  const input = document.getElementById('boardSearch');
  const btn = document.getElementById('boardSearchBtn');
  if (!input) return;
  // Deliberate, not as-you-type: a full-database search does real network
  // work (especially from "All Challenges"), so it fires on Enter/click only.
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  if (btn) btn.addEventListener('click', () => runSearch());
  input.addEventListener('input', () => {
    searchQuery = input.value;
    if (!searchQuery.trim()) { document.getElementById('searchEmpty').hidden = true; renderSearchSummary(null); clearSearchHighlights(); }
  });
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
      // switching context invalidates whatever search was showing
      document.getElementById('boardSearch').value = '';
      document.getElementById('searchEmpty').hidden = true;
      renderSearchSummary(null);
      clearSearchHighlights();
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
          <span class="panel-title">${esc(c.name)}</span>
          ${infoButton(c.key)}
          <span class="panel-note">Top 10 · ${esc(RULE_NOTE[c.key] || '')}</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>#</th><th>Name</th><th>Roll / ID</th>${colHeads}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>`;
  }).join('');

  board.innerHTML = `<div class="grid-all">${panels}</div>`;
  wireInfoButtons(board);
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
          </tr>`;
      }).join('')
    : `<tr class="empty"><td colspan="${4 + c.columns.length}">No results recorded yet.</td></tr>`;

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
        <span class="panel-title">${esc(c.name)}</span>
        ${infoButton(c.key)}
        <span class="panel-note">${esc(RULE_NOTE[c.key] || '')}</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Name</th><th>Roll / ID</th><th>Branch / Sec</th>
              ${colHeads}<th style="text-align:right">Recorded</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      ${pager}
    </section>`;

  wireInfoButtons(board);
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
    // Keep an active search live across the 10s auto-refresh (e.g. someone
    // watching their own name/rank update) rather than freezing it in place.
    const box = document.getElementById('boardSearch');
    if (box && box.value.trim()) {
      fullBoardCache = {}; // don't show a stale rank on a refreshed board
      await runSearch();
    }
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
