// ============================================================================
// lib/ranking.js — ordering and "best result" logic (§9, §13).
//
// Result metrics differ per challenge and can have multi-field tie-breaks, so
// rather than fight MongoDB's aggregation for a multi-key mixed-direction sort,
// we fetch the (event-sized) set of active results and sort in JS using the
// rank spec from challengeConfig. This is exact, easy to read, and fine for a
// few hundred participants.
// ============================================================================

const { CHALLENGES } = require('../challengeConfig');

// Compare two metric bags for a challenge using its ordered rank spec.
// Returns < 0 if A ranks ABOVE B, > 0 if A ranks BELOW B, 0 if equal.
function compareResults(challengeKey, aMetrics, bMetrics) {
  const cfg = CHALLENGES[challengeKey];
  if (!cfg) throw new Error(`Unknown challenge: ${challengeKey}`);

  for (const { field, dir } of cfg.rank) {
    const a = Number(aMetrics?.[field]);
    const b = Number(bMetrics?.[field]);

    // Push missing/NaN values to the bottom regardless of direction.
    const aBad = Number.isNaN(a);
    const bBad = Number.isNaN(b);
    if (aBad && bBad) continue;
    if (aBad) return 1;
    if (bBad) return -1;

    if (a === b) continue;
    if (dir === 'asc') return a < b ? -1 : 1;   // smaller is better
    return a > b ? -1 : 1;                       // 'desc' -> larger is better
  }
  return 0; // genuinely tied on every ranked field
}

// True if `candidate` is strictly better than `current` for the challenge.
// Used to decide whether a new attempt should replace the active result (§9:
// "An inferior result must not replace a superior result").
function isBetter(challengeKey, candidateMetrics, currentMetrics) {
  return compareResults(challengeKey, candidateMetrics, currentMetrics) < 0;
}

// Sort a list of {metrics, ...} objects best-first and return the top N,
// each tagged with a 1-based rank. Does not mutate the input array.
function rankTop(challengeKey, rows, limit = 10) {
  const sorted = [...rows].sort((x, y) =>
    compareResults(challengeKey, x.metrics, y.metrics)
  );
  return sorted.slice(0, limit).map((row, i) => ({ rank: i + 1, ...row }));
}

module.exports = { compareResults, isBetter, rankTop };
