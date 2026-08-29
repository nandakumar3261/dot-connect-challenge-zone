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

// Event identifier prefix used when auto-generating DoT Connect IDs (§4).
const EVENT_ID_PREFIX = 'DOT26';

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
    // §8: one official solve time in seconds. The app stores only the final
    // official time — it never computes single/Ao3 itself (that is §20 scope).
    fields: [
      { key: 'timeSeconds', label: 'Official time (seconds)', unit: 's',
        type: 'number', min: 0, required: true, decimals: 2 }
    ],
    // §13: lower official time is better.
    rank: [{ field: 'timeSeconds', dir: 'asc' }],
    // Field shown as the headline number on the public board.
    primaryField: 'timeSeconds',
    provisional: false
  },

  chess: {
    key: 'chess',
    name: 'Chess Puzzle Rush',
    icon: '♟️',
    // §8: puzzles solved, time taken (seconds), mistakes count.
    fields: [
      { key: 'puzzlesSolved', label: 'Puzzles solved', unit: '',
        type: 'number', min: 0, required: true, integer: true },
      { key: 'timeSeconds', label: 'Time taken (seconds)', unit: 's',
        type: 'number', min: 0, required: true, decimals: 2 },
      { key: 'mistakes', label: 'Mistakes', unit: '',
        type: 'number', min: 0, required: true, integer: true }
    ],
    // §13: more puzzles solved is better. Tie-break rule "to be finalised" —
    // provisional order: fewer mistakes, then faster time. Change here once set.
    rank: [
      { field: 'puzzlesSolved', dir: 'desc' },
      { field: 'mistakes', dir: 'asc' },     // provisional tie-break (§21)
      { field: 'timeSeconds', dir: 'asc' }   // provisional tie-break (§21)
    ],
    primaryField: 'puzzlesSolved',
    provisional: true // tie-break not finalised
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
    // §8 & §21: final format/scoring NOT finalised. Implemented with a single
    // provisional score field so the system is usable now; swap the `fields`
    // and `rank` below for the official format before production release.
    fields: [
      { key: 'score', label: 'Score (provisional)', unit: 'pts',
        type: 'number', min: 0, required: true, decimals: 1 }
    ],
    // §13: ranking rule to be finalised. Provisional: higher score is better.
    rank: [{ field: 'score', dir: 'desc' }],
    primaryField: 'score',
    provisional: true // whole format not finalised
  }
};

// Controlled gender selection (§5 — required controlled value).
const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

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

module.exports = {
  EVENT_ID_PREFIX,
  CHALLENGE_KEYS,
  CHALLENGES,
  GENDERS,
  isChallenge,
  summariseMetrics
};
