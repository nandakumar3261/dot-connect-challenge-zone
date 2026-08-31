// Pure-logic tests (no MongoDB needed). Run with: npm test
const assert = require('assert');
const { compareResults, isBetter, rankTop } = require('../lib/ranking');
const { maskMobile } = require('../lib/mask');
const { CHALLENGES, summariseMetrics, EVENT_ID_PREFIX } = require('../challengeConfig');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

console.log('Ranking — Speed Cube (lower time is better):');
test('faster time ranks above slower', () => {
  assert.ok(isBetter('speedcube', { timeSeconds: 12.3 }, { timeSeconds: 15.0 }));
  assert.ok(!isBetter('speedcube', { timeSeconds: 20 }, { timeSeconds: 15 }));
});

console.log('Ranking — Chess (more puzzles, then fewer mistakes, then faster):');
test('more puzzles wins', () => {
  assert.ok(isBetter('chess', { puzzlesSolved: 30, mistakes: 5, timeSeconds: 180 },
                              { puzzlesSolved: 25, mistakes: 0, timeSeconds: 120 }));
});
test('tie on puzzles -> fewer mistakes wins', () => {
  assert.ok(isBetter('chess', { puzzlesSolved: 25, mistakes: 1, timeSeconds: 180 },
                              { puzzlesSolved: 25, mistakes: 3, timeSeconds: 120 }));
});
test('tie on puzzles & mistakes -> faster time wins', () => {
  assert.ok(isBetter('chess', { puzzlesSolved: 25, mistakes: 2, timeSeconds: 100 },
                              { puzzlesSolved: 25, mistakes: 2, timeSeconds: 140 }));
});

console.log('Ranking — Typing (higher WPM, accuracy tie-break):');
test('higher WPM wins', () => {
  assert.ok(isBetter('typing', { wpm: 90, accuracy: 95 }, { wpm: 80, accuracy: 99 }));
});
test('tie on WPM -> higher accuracy wins', () => {
  assert.ok(isBetter('typing', { wpm: 90, accuracy: 98 }, { wpm: 90, accuracy: 95 }));
});

console.log('Best-result rule (§9): inferior must not replace superior:');
test('inferior result is NOT better', () => {
  // existing best cube time 10s; new attempt 14s -> not better
  assert.strictEqual(isBetter('speedcube', { timeSeconds: 14 }, { timeSeconds: 10 }), false);
});

console.log('rankTop assigns 1-based ranks best-first:');
test('cube top sorted ascending by time', () => {
  const rows = [
    { name: 'C', metrics: { timeSeconds: 30 } },
    { name: 'A', metrics: { timeSeconds: 10 } },
    { name: 'B', metrics: { timeSeconds: 20 } }
  ];
  const top = rankTop('speedcube', rows, 10);
  assert.deepStrictEqual(top.map(r => r.name), ['A', 'B', 'C']);
  assert.deepStrictEqual(top.map(r => r.rank), [1, 2, 3]);
});
test('limit is respected', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ metrics: { wpm: i, accuracy: 100 } }));
  assert.strictEqual(rankTop('typing', rows, 10).length, 10);
});

console.log('General Tie Rule (§4, PDF): ties share a rank, next rank skips ahead:');
test('two tied for rank 5 -> next student is rank 7 (PDF Speed Cube example)', () => {
  const rows = [
    { name: 'Arjun', metrics: { timeSeconds: 11.482 } },
    { name: 'Rahul', metrics: { timeSeconds: 12.136 } },
    { name: 'Kiran', metrics: { timeSeconds: 13.027 } },
    { name: 'Sai', metrics: { timeSeconds: 13.841 } },
    { name: 'Vikram', metrics: { timeSeconds: 14.205 } },
    { name: 'Aditya', metrics: { timeSeconds: 14.205 } },
    { name: 'Nikhil', metrics: { timeSeconds: 14.891 } }
  ];
  const top = rankTop('speedcube', rows, 10);
  const byName = Object.fromEntries(top.map(r => [r.name, r.rank]));
  assert.strictEqual(byName.Arjun, 1);
  assert.strictEqual(byName.Vikram, 5);
  assert.strictEqual(byName.Aditya, 5);
  assert.strictEqual(byName.Nikhil, 7);
});
test('complete tie (chess) also shares a rank', () => {
  const rows = [
    { name: 'A', metrics: { puzzlesSolved: 23, mistakes: 3, timeSeconds: 161 } },
    { name: 'B', metrics: { puzzlesSolved: 23, mistakes: 3, timeSeconds: 161 } },
    { name: 'C', metrics: { puzzlesSolved: 22, mistakes: 1, timeSeconds: 180 } }
  ];
  const top = rankTop('chess', rows, 10);
  const byName = Object.fromEntries(top.map(r => [r.name, r.rank]));
  assert.strictEqual(byName.A, 1);
  assert.strictEqual(byName.B, 1);
  assert.strictEqual(byName.C, 3);
});

console.log('Debug Challenge (seconds + milliseconds, not a score):');
test('lower total time wins, milliseconds break the tie within the same second', () => {
  assert.ok(isBetter('debug', { timeSeconds: 12, timeMillis: 100 }, { timeSeconds: 12, timeMillis: 500 }));
  assert.ok(isBetter('debug', { timeSeconds: 11, timeMillis: 999 }, { timeSeconds: 12, timeMillis: 0 }));
});
test('debug primary display combines seconds + milliseconds', () => {
  const { formatPrimaryMetric } = require('../challengeConfig');
  assert.strictEqual(formatPrimaryMetric('debug', { timeSeconds: 12, timeMillis: 5 }), '12.005s');
});

console.log('Mobile masking (§5/§15): never reveal the middle:');
test('keeps first 2 and last 2', () => {
  assert.strictEqual(maskMobile('9876543210'), '98••••••10');
});
test('short numbers fully masked', () => {
  assert.strictEqual(maskMobile('123'), '•••');
});

console.log('summariseMetrics produces readable lines:');
test('chess summary', () => {
  const s = summariseMetrics('chess', { puzzlesSolved: 24, timeSeconds: 118, mistakes: 3 });
  assert.strictEqual(s, '24 · 3 · 118s');
});

console.log('Config sanity:');
test('exactly four challenges', () => {
  assert.strictEqual(Object.keys(CHALLENGES).length, 4);
});
test('event id prefix is DOTT26', () => {
  assert.strictEqual(EVENT_ID_PREFIX, 'DOTT26');
});
test('only debug flagged provisional; speedcube/chess/typing finalised (§21, PDF)', () => {
  assert.strictEqual(CHALLENGES.debug.provisional, true);
  assert.strictEqual(CHALLENGES.chess.provisional, false);
  assert.strictEqual(CHALLENGES.speedcube.provisional, false);
  assert.strictEqual(CHALLENGES.typing.provisional, false);
});

console.log(`\n${passed} checks passed.`);
