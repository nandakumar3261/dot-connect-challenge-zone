const API = '/api';
const REFRESH_MS = 10000;

// Short per-challenge tagline for the panel header (mirrors the ranking rule).
const RULE_NOTE = {
  speedcube: 'Fastest official time',
  chess: 'Most puzzles solved',
  typing: 'Highest WPM',
  debug: 'Fastest time'
};

let config = null;      // { challenges: [...] }
let current = 'all';    // selected tab key

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
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
    btn.addEventListener('click', () => { current = btn.dataset.key; syncTabs(); render(); })
  );
}
function syncTabs() {
  document.querySelectorAll('.tab').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.key === current)));
}

// ---- All Challenges view: Top 10 of each of the four (§11) ----
async function renderAll() {
  const board = document.getElementById('board');
  const data = await fetch(`${API}/leaderboard`).then(r => r.json());

  const panels = config.challenges.map(c => {
    const rows = data.boards[c.key] || [];
    const body = rows.length
      ? rows.map(r => `
          <tr class="${r.rank === 1 ? 'top1' : ''}">
            <td class="rank">${r.rank}</td>
            <td class="name">${esc(r.name)}</td>
            <td class="ident">${esc(r.identifier)}</td>
            <td class="score">${esc(r.score)}<span class="unit">${esc(r.unit)}</span></td>
          </tr>`).join('')
      : `<tr class="empty"><td colspan="4">No results recorded yet.</td></tr>`;

    return `
      <section class="panel c-${c.key}">
        <div class="panel-head">
          <span class="panel-icon">${esc(c.icon)}</span>
          <span class="panel-title">${esc(c.name)}${c.provisional ? '<span class="provisional">provisional</span>' : ''}</span>
          <span class="panel-note">Top 10 · ${esc(RULE_NOTE[c.key] || '')}</span>
        </div>
        <table>
          <thead><tr><th>#</th><th>Name</th><th>Roll / ID</th><th style="text-align:right">Score</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </section>`;
  }).join('');

  board.innerHTML = `<div class="grid-all">${panels}</div>`;
}

// ---- Detailed single-challenge view (§12) ----
async function renderDetail(key) {
  const board = document.getElementById('board');
  const data = await fetch(`${API}/leaderboard/${key}`).then(r => r.json());
  const c = data.challenge;

  const metricCols = c.fields.map(f => `<th style="text-align:right">${esc(f.label)}</th>`).join('');
  const rows = data.rows.length
    ? data.rows.map(r => {
        const cells = c.fields.map(f =>
          `<td class="score">${esc(r.metrics[f.key])}<span class="unit">${esc(f.unit)}</span></td>`).join('');
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
    : `<tr class="empty"><td colspan="${5 + c.fields.length}">No results recorded yet.</td></tr>`;

  board.innerHTML = `
    <section class="panel detail c-${c.key}">
      <div class="panel-head">
        <span class="panel-icon">${esc(c.icon)}</span>
        <span class="panel-title">${esc(c.name)}${c.provisional ? '<span class="provisional">rules to be finalised</span>' : ''}</span>
        <span class="panel-note">${esc(RULE_NOTE[c.key] || '')}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Name</th><th>Roll / ID</th><th>Branch / Sec</th>
            ${metricCols}<th style="text-align:right">Recorded</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
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
    config = await fetch(`${API}/config`).then(r => r.json());
    buildTabs();
    await render();
    setInterval(render, REFRESH_MS);
  } catch (err) {
    document.getElementById('board').innerHTML = '<p class="loading">Could not load the leaderboard.</p>';
  }
}
init();
