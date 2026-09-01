// Full end-to-end test against a REAL MongoDB. Exercises the real routes.
// Not part of `npm test`. Run it against a throwaway database:
//   MONGO_URI=mongodb://127.0.0.1:27017/dotconnect_test node test/integration.test.js
// It drops that database at the end, so never point it at production data.
const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = 'test_secret_key_for_integration';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dotconnect_test';
const createApp = require('../app');
const User = require('../models/User');

let base, server;

// Tiny fetch helper over the running http server.
function api(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.stack || e.message}`); process.exitCode = 1; }
}

(async () => {
  await mongoose.connect(MONGO_URI);
  // Start from a clean slate.
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})));

  // Seed one admin directly.
  await User.create({
    username: 'admin', passwordHash: await bcrypt.hash('adminpass', 10),
    role: 'admin', displayName: 'Administrator', active: true
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  let adminToken, cubeVolToken, cubeVolId, studentA, studentB;

  await test('admin can sign in and gets role admin', async () => {
    const r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'adminpass' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.role, 'admin');
    adminToken = r.body.token;
  });

  await test('admin creates a volunteer authorised for Speed Cube only', async () => {
    const r = await api('POST', '/api/volunteers', {
      token: adminToken,
      body: { username: 'cubevol', password: 'cubepass', displayName: 'Cube Vol', permissions: ['speedcube'] }
    });
    assert.strictEqual(r.status, 201);
    assert.deepStrictEqual(r.body.permissions, ['speedcube']);
    cubeVolId = r.body._id;
  });

  await test('volunteer signs in and sees their permission', async () => {
    const r = await api('POST', '/api/auth/login', { body: { username: 'cubevol', password: 'cubepass' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.role, 'volunteer');
    assert.deepStrictEqual(r.body.permissions, ['speedcube']);
    cubeVolToken = r.body.token;
  });

  await test('volunteer registers a student WITHOUT roll number -> auto DoTT ID (§4)', async () => {
    const r = await api('POST', '/api/students', {
      token: cubeVolToken,
      body: { name: 'Asha Rao', mobile: '9876543210', gender: 'Female', branch: 'CSE', section: 'A' }
    });
    assert.strictEqual(r.status, 201);
    assert.match(r.body.dotId, /^DOTT26-\d{4}$/);
    // Volunteer sees masked mobile only (§7/§15)
    assert.strictEqual(r.body.mobile, undefined);
    assert.strictEqual(r.body.mobileMasked, '98••••••10');
    studentA = r.body;
  });

  await test('second auto DoTT ID increments (0001 -> 0002)', async () => {
    const r = await api('POST', '/api/students', {
      token: cubeVolToken,
      body: { name: 'Ravi Kumar', mobile: '9000000001', gender: 'Male', branch: 'ECE', section: 'B' }
    });
    assert.strictEqual(r.status, 201);
    studentB = r.body;
    const nA = Number(studentA.dotId.split('-')[1]);
    const nB = Number(studentB.dotId.split('-')[1]);
    assert.strictEqual(nB, nA + 1);
  });

  await test('search finds a student by name (§6)', async () => {
    const r = await api('GET', '/api/students/search?q=asha', { token: cubeVolToken });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.some(s => s.dotId === studentA.dotId));
  });

  await test('volunteer records a Speed Cube result (§8)', async () => {
    const r = await api('POST', '/api/results', {
      token: cubeVolToken,
      body: { studentId: studentA._id, challenge: 'speedcube', metrics: { minutes: 0, seconds: 18, milliseconds: 500 } }
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.becameActive, true);
  });

  await test('a WORSE second attempt does NOT replace the best (§9)', async () => {
    const r = await api('POST', '/api/results', {
      token: cubeVolToken,
      body: { studentId: studentA._id, challenge: 'speedcube', metrics: { minutes: 0, seconds: 25, milliseconds: 0 } }
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.becameActive, false); // kept 18.5 as best
  });

  await test('a BETTER attempt DOES replace the best (§9)', async () => {
    const r = await api('POST', '/api/results', {
      token: cubeVolToken,
      body: { studentId: studentA._id, challenge: 'speedcube', metrics: { minutes: 0, seconds: 12, milliseconds: 0 } }
    });
    assert.strictEqual(r.body.becameActive, true);
  });

  await test('precheck warns that student already participated (§7)', async () => {
    const r = await api('GET', `/api/results/precheck?studentId=${studentA._id}&challenge=speedcube`, { token: cubeVolToken });
    assert.strictEqual(r.body.alreadyParticipated, true);
    assert.strictEqual(r.body.best.metrics.seconds, 12);
    assert.strictEqual(r.body.best.metrics.minutes, 0);
  });

  await test('volunteer CANNOT record an unauthorised challenge (§10/§17)', async () => {
    const r = await api('POST', '/api/results', {
      token: cubeVolToken,
      body: { studentId: studentA._id, challenge: 'chess', metrics: { puzzlesSolved: 10, mistakes: 1, minutes: 1, seconds: 0 } }
    });
    assert.strictEqual(r.status, 403);
  });

  await test('accuracy > 100 is rejected (§17)', async () => {
    const r = await api('POST', '/api/results', {
      token: adminToken,
      body: { studentId: studentA._id, challenge: 'typing', metrics: { wpm: 80, accuracy: 120 } }
    });
    assert.strictEqual(r.status, 400);
  });

  await test('accuracy below 88 is rejected (§17)', async () => {
    const r = await api('POST', '/api/results', {
      token: adminToken,
      body: { studentId: studentA._id, challenge: 'typing', metrics: { wpm: 80, accuracy: 80 } }
    });
    assert.strictEqual(r.status, 400);
  });

  await test('chess mistakes above 3 is rejected (§17)', async () => {
    const r = await api('POST', '/api/results', {
      token: adminToken,
      body: { studentId: studentA._id, challenge: 'chess', metrics: { puzzlesSolved: 12, mistakes: 5, minutes: 1, seconds: 30 } }
    });
    assert.strictEqual(r.status, 400);
  });

  await test('leaderboard shows Speed Cube best (12.0), no mobile exposed (§11/§15)', async () => {
    const r = await api('GET', '/api/leaderboard');
    assert.strictEqual(r.status, 200);
    const cube = r.body.boards.speedcube;
    assert.strictEqual(cube[0].columns[0].value, '00:12:000');
    assert.ok(!JSON.stringify(r.body).includes('9876543210'));
  });

  await test('duplicate roll number is rejected (§17)', async () => {
    const first = await api('POST', '/api/students', {
      token: adminToken,
      body: { name: 'Original', mobile: '9111111111', gender: 'Male', branch: 'IT', section: 'C', rollNumber: 'CS23-101' }
    });
    assert.strictEqual(first.status, 201);

    const dup = await api('POST', '/api/students', {
      token: adminToken,
      body: { name: 'Dup', mobile: '9222222222', gender: 'Male', branch: 'IT', section: 'C', rollNumber: 'CS23-101' }
    });
    assert.strictEqual(dup.status, 409);
  });

  await test('mobile number must be exactly 10 digits', async () => {
    const tooShort = await api('POST', '/api/students', {
      token: adminToken,
      body: { name: 'Short Mobile', mobile: '12345', gender: 'Male', branch: 'IT', section: 'C' }
    });
    assert.strictEqual(tooShort.status, 400);

    const nonDigits = await api('POST', '/api/students', {
      token: adminToken,
      body: { name: 'Bad Mobile', mobile: '98765abc10', gender: 'Male', branch: 'IT', section: 'C' }
    });
    assert.strictEqual(nonDigits.status, 400);
  });

  await test('duplicate mobile number is rejected', async () => {
    const first = await api('POST', '/api/students', {
      token: adminToken,
      body: { name: 'Mobile Owner', mobile: '9333333333', gender: 'Female', branch: 'IT', section: 'D' }
    });
    assert.strictEqual(first.status, 201);

    const dup = await api('POST', '/api/students', {
      token: adminToken,
      body: { name: 'Mobile Reuser', mobile: '9333333333', gender: 'Male', branch: 'IT', section: 'D' }
    });
    assert.strictEqual(dup.status, 409);
    assert.match(dup.body.error, /mobile/i);
  });

  await test('roll number stays optional -> DoTT ID auto-assigned when blank', async () => {
    const r = await api('POST', '/api/students', {
      token: adminToken,
      body: { name: 'No Roll Yet', mobile: '9444444444', gender: 'Female', branch: 'IT', section: 'E' }
    });
    assert.strictEqual(r.status, 201);
    assert.match(r.body.dotId, /^DOTT26-\d{4}$/);
    assert.strictEqual(r.body.rollNumber, '');
  });

  await test('admin invalidates the active result -> next best promoted (§16/§18)', async () => {
    // Current active is 12.0; the 18.5 and 25.0 attempts still exist as superseded.
    const list = await api('GET', '/api/results?challenge=speedcube&status=active', { token: adminToken });
    const activeId = list.body.find(x => x.metrics.seconds === 12 && x.metrics.minutes === 0)._id;
    const inv = await api('PATCH', `/api/results/${activeId}/invalidate`, { token: adminToken, body: { note: 'DQ' } });
    assert.strictEqual(inv.status, 200);
    const lb = await api('GET', '/api/leaderboard/speedcube');
    assert.strictEqual(lb.body.rows[0].columns[0].value, '18.500s'); // promoted next best
  });

  await test('participation history reflects Speed Cube participated, others not (§7)', async () => {
    const r = await api('GET', `/api/students/${studentA._id}`, { token: adminToken });
    assert.strictEqual(r.body.history.speedcube.participated, true);
    assert.strictEqual(r.body.history.chess.participated, false);
    // Admin sees full mobile
    assert.strictEqual(r.body.student.mobile, '9876543210');
  });

  await test('config endpoint returns four challenges (§2)', async () => {
    const r = await api('GET', '/api/config');
    assert.strictEqual(r.body.challenges.length, 4);
  });

  await test('students CSV export works for admin (§16)', async () => {
    const r = await api('GET', '/api/export/students.csv', { token: adminToken });
    assert.strictEqual(r.status, 200);
    assert.ok(String(r.body).includes('DoTT Connect ID'));
  });

  console.log(`\n${passed} integration checks passed.`);

  await new Promise(r => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(process.exitCode || 0);
})().catch(async (e) => {
  console.error('Integration harness error:', e);
  process.exit(1);
});
