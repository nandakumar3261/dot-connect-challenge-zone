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

// Sort a list of {metrics, ...} objects best-first and return the top N.
// Ties (identical on every ranked field) share the same rank, and the next
// distinct result's rank skips ahead accordingly — e.g. two students tied
// for rank 5 are both shown as Rank 5, and the next student is Rank 7
// (§4 General Tie Rule). Registration time, ID, or any other arbitrary field
// is never used to force unique ranks.
function rankTop(challengeKey, rows, limit = 10) {
  const sorted = [...rows].sort((x, y) =>
    compareResults(challengeKey, x.metrics, y.metrics)
  );

  const ranked = sorted.map((row, i) => {
    const rank = (i === 0 || compareResults(challengeKey, row.metrics, sorted[i - 1].metrics) !== 0)
      ? i + 1
      : null; // filled in below from the previous row's rank
    return { rank, ...row };
  });
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].rank === null) ranked[i].rank = ranked[i - 1].rank;
  }

  return ranked.slice(0, limit);
}

module.exports = { compareResults, isBetter, rankTop };
