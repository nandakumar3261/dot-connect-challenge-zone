// ============================================================================
// challengeConfig.js — SINGLE SOURCE OF TRUTH for the four Challenge Zone events.
//
// Everything else (result validation, ranking, leaderboards, the volunteer
// record form, permission lists) reads from here. To change a scoring field,
// ranking rule, an input limit, or how a score is displayed, edit ONLY this file.
//
//   fields   -> the raw values a volunteer types (drives the record form + validation)
//   rank     -> ordered comparisons that decide leaderboard order
//   columns  -> how the score is DISPLAYED on the leaderboard (can combine fields,
//               e.g. minutes+seconds+milliseconds shown as one "Time" column)
//   hint     -> plain-English explanation shown by the "what's this score?" icon
// ============================================================================

// Event identifier prefix used when auto-generating DoTT Connect IDs (§4).
const EVENT_ID_PREFIX = 'DOTT26';

// Ordered list of challenge keys. Order drives the leaderboard layout (§11).
const CHALLENGE_KEYS = ['speedcube', 'chess', 'typing', 'debug'];

const CHALLENGES = {
  speedcube: {
    key: 'speedcube',
    name: 'Speed Cube',
    icon: '🧩',
    // Solve time entered as minutes : seconds : milliseconds (three fields).
    fields: [
      { key: 'minutes', label: 'Minutes', unit: 'm', type: 'number', min: 0, max: 59, integer: true, required: true },
      { key: 'seconds', label: 'Seconds', unit: 's', type: 'number', min: 0, max: 59, integer: true, required: true },
      { key: 'milliseconds', label: 'Milliseconds', unit: 'ms', type: 'number', min: 0, max: 999, integer: true, required: true }
    ],
    // Lower total time is better. Comparing minutes, then seconds, then
    // milliseconds reproduces "lowest total time" exactly (each part is bounded).
    rank: [
      { field: 'minutes', dir: 'asc' },
      { field: 'seconds', dir: 'asc' },
      { field: 'milliseconds', dir: 'asc' }
    ],
    // Displayed as one combined time column, which is also the headline score.
    columns: [{ label: 'Time', type: 'cubeTime', primary: true }],
    hint: 'Official solve time, shown as m:ss.mmm (minutes:seconds.milliseconds). Lower time ranks higher.',
    provisional: false
  },

  chess: {
    key: 'chess',
    name: 'Chess Puzzle Rush',
    icon: '\u265F\uFE0F',
    // Puzzles solved, mistakes (max 3 — session ends on the 3rd), and the time
    // taken entered as minutes + seconds.
    fields: [
      { key: 'puzzlesSolved', label: 'Puzzles solved', unit: '', type: 'number', min: 0, integer: true, required: true },
      { key: 'mistakes', label: 'Mistakes', unit: '', type: 'number', min: 0, max: 3, integer: true, required: true },
      { key: 'minutes', label: 'Minutes', unit: 'm', type: 'number', min: 0, max: 59, integer: true, required: true },
      { key: 'seconds', label: 'Seconds', unit: 's', type: 'number', min: 0, max: 59, integer: true, required: true }
    ],
    // 1) more puzzles is better; 2) fewer mistakes; 3) faster time (tie-break).
    rank: [
      { field: 'puzzlesSolved', dir: 'desc' },
      { field: 'mistakes', dir: 'asc' },
      { field: 'minutes', dir: 'asc' },
      { field: 'seconds', dir: 'asc' }
    ],
    columns: [
      { label: 'Puzzles', type: 'int', field: 'puzzlesSolved', primary: true },
      { label: 'Mistakes', type: 'int', field: 'mistakes' },
      { label: 'Time', type: 'clock' }
    ],
    hint: 'Score is puzzles solved (higher ranks higher). Ties broken by fewer mistakes, then faster time (m:ss). Mistakes cannot exceed 3.',
    provisional: false
  },

  typing: {
    key: 'typing',
    name: 'Keyboard Killers',
    icon: '\u2328\uFE0F',
    // WPM and accuracy % from the agreed one-minute typing test.
    // Accuracy below 88% is not accepted.
    fields: [
      { key: 'wpm', label: 'WPM', unit: 'WPM', type: 'number', min: 0, required: true, decimals: 1 },
      { key: 'accuracy', label: 'Accuracy (%)', unit: '%', type: 'number', min: 88, max: 100, required: true, decimals: 1 }
    ],
    rank: [
      { field: 'wpm', dir: 'desc' },
      { field: 'accuracy', dir: 'desc' }
    ],
    columns: [
      { label: 'WPM', type: 'num', field: 'wpm', primary: true },
      { label: 'Accuracy', type: 'pct', field: 'accuracy' }
    ],
    hint: 'Score is words per minute (higher ranks higher); accuracy (%) breaks ties. Accuracy below 88% is not accepted.',
    provisional: false
  },

  debug: {
    key: 'debug',
    name: 'Debug Challenge',
    icon: '\uD83D\uDC1E',
    // §21: final rules not fully finalised. Recorded as a time (seconds +
    // milliseconds); lower total time is better.
    fields: [
      { key: 'timeSeconds', label: 'Time \u2014 seconds', unit: 's', type: 'number', min: 0, integer: true, required: true },
      { key: 'timeMillis', label: 'Time \u2014 milliseconds', unit: 'ms', type: 'number', min: 0, max: 999, integer: true, required: true }
    ],
    rank: [
      { field: 'timeSeconds', dir: 'asc' },
      { field: 'timeMillis', dir: 'asc' }
    ],
    columns: [{ label: 'Time', type: 'debugTime', primary: true }],
    hint: 'Recorded as time in seconds.milliseconds. Lower time ranks higher. Format is provisional.',
    provisional: true
  }
};

// Controlled gender selection (§5 — required controlled value).
const GENDERS = ['Male', 'Female'];

// --- formatting -------------------------------------------------------------

function pad(n, w) { return String(n == null ? 0 : n).padStart(w, '0'); }

// Turn a display column + a metrics bag into a human string.
function formatColumnValue(type, metrics, field) {
  const m = metrics || {};
  switch (type) {
    case 'int': return String(m[field] != null ? m[field] : 0);
    case 'num': return String(m[field] != null ? m[field] : 0);
    case 'pct': return `${m[field] != null ? m[field] : 0}%`;
    case 'cubeTime': {
      const mm = +m.minutes || 0, ss = +m.seconds || 0, ms = +m.milliseconds || 0;
      return mm > 0 ? `${mm}:${pad(ss, 2)}.${pad(ms, 3)}` : `${ss}.${pad(ms, 3)}s`;
    }
    case 'clock': {
      const mm = +m.minutes || 0, ss = +m.seconds || 0;
      return `${mm}:${pad(ss, 2)}`;
    }
    case 'debugTime': {
      const ss = +m.timeSeconds || 0, ms = +m.timeMillis || 0;
      return `${ss}.${pad(ms, 3)}s`;
    }
    default: return String(m[field] != null ? m[field] : '');
  }
}

// --- helpers used across the backend ---------------------------------------

function isChallenge(key) {
  return Object.prototype.hasOwnProperty.call(CHALLENGES, key);
}

// Formatted display columns for one result: [{ label, value }, ...] (§12).
function formatColumns(challengeKey, metrics) {
  const cfg = CHALLENGES[challengeKey];
  if (!cfg) return [];
  return cfg.columns.map(col => ({
    label: col.label,
    value: formatColumnValue(col.type, metrics || {}, col.field)
  }));
}

// The headline score for the "All Challenges" board (§11) — the column
// flagged `primary` (falls back to the first column).
function formatPrimaryMetric(challengeKey, metrics) {
  const cfg = CHALLENGES[challengeKey];
  if (!cfg) return '';
  const col = cfg.columns.find(c => c.primary) || cfg.columns[0];
  return formatColumnValue(col.type, metrics || {}, col.field);
}

// One-line audit summary, e.g. "24 · 1 · 1:58". Used by admin tables & exports.
function summariseMetrics(challengeKey, metrics) {
  return formatColumns(challengeKey, metrics || {}).map(c => c.value).join(' \u00B7 ');
}

module.exports = {
  EVENT_ID_PREFIX,
  CHALLENGE_KEYS,
  CHALLENGES,
  GENDERS,
  isChallenge,
  formatColumns,
  formatPrimaryMetric,
  summariseMetrics
};
