// Pure-logic tests (no MongoDB needed). Run with: npm test
const assert = require('assert');
const { compareResults, isBetter, rankTop } = require('../lib/ranking');
const { maskMobile } = require('../lib/mask');
const { CHALLENGES, summariseMetrics, formatPrimaryMetric, formatColumns, EVENT_ID_PREFIX } = require('../challengeConfig');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// helpers to build metric bags
const cube = (m, s, ms) => ({ minutes: m, seconds: s, milliseconds: ms });
const chess = (p, mis, m, s) => ({ puzzlesSolved: p, mistakes: mis, minutes: m, seconds: s });

console.log('Speed Cube — minutes:seconds:milliseconds, lower is better:');
test('fewer seconds ranks above more', () => {
  assert.ok(isBetter('speedcube', cube(0, 12, 300), cube(0, 15, 0)));
});
test('milliseconds break a tie', () => {
  assert.ok(isBetter('speedcube', cube(0, 14, 205), cube(0, 14, 890)));
});
test('minutes dominate seconds', () => {
  assert.ok(isBetter('speedcube', cube(0, 59, 999), cube(1, 0, 0)));
});
test('primary display formats as m:ss.mmm / s.mmm', () => {
  assert.strictEqual(formatPrimaryMetric('speedcube', cube(1, 5, 70)), '1:05.070');
  assert.strictEqual(formatPrimaryMetric('speedcube', cube(0, 14, 205)), '14.205s');
});

console.log('Chess — more puzzles, then fewer mistakes, then faster m:ss:');
test('more puzzles wins', () => {
  assert.ok(isBetter('chess', chess(30, 3, 2, 0), chess(25, 0, 1, 0)));
});
test('tie on puzzles -> fewer mistakes wins', () => {
  assert.ok(isBetter('chess', chess(25, 1, 2, 0), chess(25, 3, 1, 0)));
});
test('tie on puzzles+mistakes -> faster time wins', () => {
  assert.ok(isBetter('chess', chess(25, 2, 1, 40), chess(25, 2, 2, 10)));
});
test('chess columns format puzzles / mistakes / clock', () => {
  const cols = formatColumns('chess', chess(24, 1, 1, 58));
  assert.deepStrictEqual(cols.map(c => c.value), ['24', '1', '1:58']);
});

console.log('Typing — higher WPM, accuracy tie-break; accuracy floor 88:');
test('higher WPM wins', () => {
  assert.ok(isBetter('typing', { wpm: 90, accuracy: 95 }, { wpm: 80, accuracy: 99 }));
});
test('tie on WPM -> higher accuracy wins', () => {
  assert.ok(isBetter('typing', { wpm: 90, accuracy: 98 }, { wpm: 90, accuracy: 95 }));
});
test('accuracy field carries a min of 88 and max of 100', () => {
  const acc = CHALLENGES.typing.fields.find(f => f.key === 'accuracy');
  assert.strictEqual(acc.min, 88);
  assert.strictEqual(acc.max, 100);
});

console.log('Chess mistakes are capped at 3:');
test('mistakes field max is 3', () => {
  const mis = CHALLENGES.chess.fields.find(f => f.key === 'mistakes');
  assert.strictEqual(mis.max, 3);
});

console.log('Best-result rule (§9): inferior must not replace superior:');
test('slower cube time is NOT better', () => {
  assert.strictEqual(isBetter('speedcube', cube(0, 14, 0), cube(0, 10, 0)), false);
});

console.log('Debug — seconds.milliseconds, lower is better:');
test('fewer millis break a tie', () => {
  assert.ok(isBetter('debug', { timeSeconds: 12, timeMillis: 100 }, { timeSeconds: 12, timeMillis: 500 }));
});
test('debug primary formats seconds.mmm', () => {
  assert.strictEqual(formatPrimaryMetric('debug', { timeSeconds: 12, timeMillis: 5 }), '12.005s');
});

console.log('rankTop assigns 1-based ranks best-first:');
test('cube top sorted by total time', () => {
  const rows = [
    { name: 'C', metrics: cube(0, 30, 0) },
    { name: 'A', metrics: cube(0, 10, 0) },
    { name: 'B', metrics: cube(0, 20, 0) }
  ];
  const top = rankTop('speedcube', rows, 10);
  assert.deepStrictEqual(top.map(r => r.name), ['A', 'B', 'C']);
  assert.deepStrictEqual(top.map(r => r.rank), [1, 2, 3]);
});
test('limit is respected', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ metrics: { wpm: i, accuracy: 100 } }));
  assert.strictEqual(rankTop('typing', rows, 10).length, 10);
});

console.log('Mobile masking (§5/§15): never reveal the middle:');
test('keeps first 2 and last 2', () => {
  assert.strictEqual(maskMobile('9876543210'), '98\u2022\u2022\u2022\u2022\u2022\u202210');
});
test('short numbers fully masked', () => {
  assert.strictEqual(maskMobile('123'), '\u2022\u2022\u2022');
});

console.log('summariseMetrics produces readable lines:');
test('chess summary', () => {
  assert.strictEqual(summariseMetrics('chess', chess(24, 1, 1, 58)), '24 \u00B7 1 \u00B7 1:58');
});

console.log('Config sanity:');
test('exactly four challenges', () => {
  assert.strictEqual(Object.keys(CHALLENGES).length, 4);
});
test('event id prefix is DOTT26', () => {
  assert.strictEqual(EVENT_ID_PREFIX, 'DOTT26');
});
test('debug flagged provisional (§21)', () => {
  assert.strictEqual(CHALLENGES.debug.provisional, true);
  assert.strictEqual(CHALLENGES.speedcube.provisional, false);
});

console.log(`\n${passed} checks passed.`);
