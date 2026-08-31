// ============================================================================
// challengeConfig.js — SINGLE SOURCE OF TRUTH for the four Challenge Zone events.
//
// Everything else (result validation, ranking, leaderboards, the volunteer
// record form, permission lists) reads from here. To change a scoring field,
// ranking rule, or add the finalised Debug format, edit ONLY this file.
//
// Requirements mapping:
//   §2  four separate challenges (Speed Cube, Chess Puzzle Rush,
//       Keyboard Killers, Debug Challenge)
//   §8  per-challenge recorded fields
//   §13 ranking rules (with the tie-breaks flagged as "to be finalised")
//   §21 open decisions — Debug format + tie-breaks are marked `provisional`
// ============================================================================

// Event identifier prefix used when auto-generating DoTT Connect IDs (§4).
const EVENT_ID_PREFIX = 'DOTT26';

// Ordered list of challenge keys. Order drives the leaderboard layout (§11).
const CHALLENGE_KEYS = ['speedcube', 'chess', 'typing', 'debug'];

// A "rank spec" is an ordered list of { field, dir } comparisons.
//   dir: 'asc'  -> smaller value ranks higher (e.g. faster time)
//   dir: 'desc' -> larger value ranks higher (e.g. more puzzles)
// The list is applied left-to-right, so later entries are the tie-breakers.
const CHALLENGES = {
  speedcube: {
    key: 'speedcube',
    name: 'Speed Cube',
    icon: '🧩',
    // §8, finalized (PDF): one official solve time, seconds + milliseconds,
    // as recorded by CS Timer (e.g. 14.205 s). The app stores only the final
    // official time — it never computes single/Ao3 itself (that is §20 scope).
    fields: [
      { key: 'timeSeconds', label: 'Official time (seconds)', unit: 's',
        type: 'number', min: 0, required: true, decimals: 3 }
    ],
    // §13, finalized: lower official time is better. Equal times share the
    // same rank (§4 General Tie Rule — handled by rankTop, not here).
    rank: [{ field: 'timeSeconds', dir: 'asc' }],
    // Field shown as the headline number on the public board.
    primaryField: 'timeSeconds',
    provisional: false
  },

  chess: {
    key: 'chess',
    name: 'Chess Puzzle Rush',
    icon: '♟️',
    // §8, finalized (PDF): puzzles solved, mistakes, time taken (seconds).
    // Field order here drives the display column order on the leaderboard
    // and record form — kept matching the PDF's sample table (Puzzles, Mistakes, Time).
    fields: [
      { key: 'puzzlesSolved', label: 'Puzzles solved', unit: '',
        type: 'number', min: 0, required: true, integer: true },
      { key: 'mistakes', label: 'Mistakes', unit: '',
        type: 'number', min: 0, required: true, integer: true },
      { key: 'timeSeconds', label: 'Time taken (seconds)', unit: 's',
        type: 'number', min: 0, required: true, decimals: 2 }
    ],
    // §13, finalized (PDF): 1) more puzzles solved is better; 2) fewer
    // mistakes is better; 3) lower time is better — only used when puzzles
    // and mistakes are tied (e.g. a session cut short by the 3rd mistake).
    rank: [
      { field: 'puzzlesSolved', dir: 'desc' },
      { field: 'mistakes', dir: 'asc' },
      { field: 'timeSeconds', dir: 'asc' }
    ],
    primaryField: 'puzzlesSolved',
    provisional: false
  },

  typing: {
    key: 'typing',
    name: 'Keyboard Killers',
    icon: '⌨️',
    // §8: WPM and accuracy % from the agreed one-minute typing test.
    fields: [
      { key: 'wpm', label: 'WPM', unit: 'WPM',
        type: 'number', min: 0, required: true, decimals: 1 },
      { key: 'accuracy', label: 'Accuracy (%)', unit: '%',
        type: 'number', min: 0, max: 100, required: true, decimals: 1 }
    ],
    // §13: higher WPM is better, accuracy as the tie-breaker.
    rank: [
      { field: 'wpm', dir: 'desc' },
      { field: 'accuracy', dir: 'desc' }
    ],
    primaryField: 'wpm',
    provisional: false
  },

  debug: {
    key: 'debug',
    name: 'Debug Challenge',
    icon: '🐞',
    // §8 & §21: final rules NOT fully finalised. Recorded as a time — seconds
    // and milliseconds as two separate fields (not a single score) — so the
    // system is usable now; adjust below if the official format changes.
    fields: [
      { key: 'timeSeconds', label: 'Time — seconds', unit: 's',
        type: 'number', min: 0, required: true, integer: true },
      { key: 'timeMillis', label: 'Time — milliseconds', unit: 'ms',
        type: 'number', min: 0, max: 999, required: true, integer: true }
    ],
    // §13: lower total time is better. Comparing seconds first, then
    // milliseconds as the tie-break, reproduces ordering by total time
    // exactly (milliseconds is always 0–999, never carries into seconds).
    rank: [
      { field: 'timeSeconds', dir: 'asc' },
      { field: 'timeMillis', dir: 'asc' }
    ],
    primaryField: 'timeSeconds',
    // Composite display for the public board headline, e.g. "12.345s".
    formatPrimary: (m) => `${m.timeSeconds}.${String(m.timeMillis ?? 0).padStart(3, '0')}s`,
    provisional: true // whole format not finalised
  }
};

// Controlled gender selection (§5 — required controlled value).
const GENDERS = ['Male', 'Female'];

// --- small helpers used across the backend --------------------------------

function isChallenge(key) {
  return Object.prototype.hasOwnProperty.call(CHALLENGES, key);
}

// Human-readable one-line summary of a result's metrics, e.g.
// "24 solved · 118.4s · 3 mistakes". Used by admin tables & audit views.
function summariseMetrics(challengeKey, metrics = {}) {
  const cfg = CHALLENGES[challengeKey];
  if (!cfg) return '';
  return cfg.fields
    .map(f => {
      const v = metrics[f.key];
      if (v === undefined || v === null) return null;
      return `${v}${f.unit ? f.unit : ''}`;
    })
    .filter(Boolean)
    .join(' · ');
}

// Headline number shown on the public "All Challenges" board for one result.
// Most challenges just show `value + unit` of their primaryField. A challenge
// can define `formatPrimary(metrics)` to render a composite value instead
// (e.g. Debug Challenge combines seconds + milliseconds into "12.345s").
function formatPrimaryMetric(challengeKey, metrics = {}) {
  const cfg = CHALLENGES[challengeKey];
  if (!cfg) return '';
  if (typeof cfg.formatPrimary === 'function') return cfg.formatPrimary(metrics);
  const f = cfg.fields.find(x => x.key === cfg.primaryField);
  const v = metrics[cfg.primaryField];
  if (v === undefined || v === null) return '';
  return `${v}${f && f.unit ? f.unit : ''}`;
}

module.exports = {
  EVENT_ID_PREFIX,
  CHALLENGE_KEYS,
  CHALLENGES,
  GENDERS,
  isChallenge,
  summariseMetrics,
  formatPrimaryMetric
};
