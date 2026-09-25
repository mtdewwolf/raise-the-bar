'use strict';
// Run with: node --test server/test   (Node 22+)
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { loadSim } = require('../sim');

const RTB = loadSim();
let clock = Date.UTC(2026, 8, 25, 12);
const now = () => clock;

// Plays a scripted run with the real simulation and returns its replay code + local result.
function playRun(seed, { kind = 'endless', day = 0, hops = 3 } = {}) {
  const g = RTB.newGame(seed, 'play'); const changes = []; let last = 0, done = 0, t = 0;
  while (!(g.state === 'dying' && g.deathT > 1.5) && g.n < 120 * 120) {
    // hop: pull ~0.2s, release, rest 1.5s; after `hops` hops hang on until the grip gives out
    const phase = t % 205, pulling = done < hops ? phase < 24 : true;
    if (done < hops && phase === 204) done++;
    const on = g.state === 'play';
    g.hands[0].key = g.hands[1].key = on && pulling;
    const bits = g.hands[0].key ? 3 : 0;
    if (bits !== last) { changes.push([g.n, bits]); last = bits; }
    RTB.stepSim(g, RTB.CFG.DT); g.events.length = 0; t++;
  }
  const code = RTB.encodeReplay({ seed, kind, day, steps: g.n, changes });
  return { code, height: Math.round(g.maxHeight * 100) / 100 };
}

async function withServer(fn) {
  const app = createApp({ dbFile: ':memory:', now, serveGame: true });
  await new Promise((r) => app.listen(0, r));
  const base = 'http://127.0.0.1:' + app.address().port;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  };
  try { await fn(call); } finally { await app.closeAll(); }
}

test('profiles: create, rename, sync code works in any format', () => withServer(async (call) => {
  const a = await call('POST', '/api/player', {});
  assert.equal(a.status, 200);
  assert.match(a.body.token, /^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.ok(a.body.name.length >= 2);
  const me = await call('GET', '/api/me', null, a.body.token.toLowerCase().replace(/-/g, ' ')); // typed sloppily on another device
  assert.equal(me.status, 200); assert.equal(me.body.name, a.body.name);
  assert.equal((await call('PATCH', '/api/me', { name: '  Gravity   Fan ' }, a.body.token)).body.name, 'Gravity Fan');
  assert.equal((await call('PATCH', '/api/me', { name: 'x' }, a.body.token)).status, 400);
  assert.equal((await call('PATCH', '/api/me', { name: '<script>' }, a.body.token)).status, 400);
  assert.equal((await call('GET', '/api/me', null, 'AAAAA-BBBBB-CCCCC')).status, 401);
  assert.equal((await call('GET', '/api/me')).status, 401);
}));

test('achievements merge across devices', () => withServer(async (call) => {
  const { token } = (await call('POST', '/api/player', { name: 'Hopper' })).body;
  await call('PUT', '/api/me/achievements', { ids: ['first_hop', 'h10'] }, token);
  const r = await call('PUT', '/api/me/achievements', { ids: ['clutch', 'first_hop', 'BAD ID!', 5] }, token);
  assert.deepEqual(r.body.achievements, ['clutch', 'first_hop', 'h10']);
  assert.deepEqual((await call('GET', '/api/me', null, token)).body.achievements, ['clutch', 'first_hop', 'h10']);
}));

test('runs are verified by re-simulation and ranked', () => withServer(async (call) => {
  const alice = (await call('POST', '/api/player', { name: 'Alice' })).body.token;
  const bob = (await call('POST', '/api/player', { name: 'Bob' })).body.token;
  const good = playRun(11, { hops: 3 }), meh = playRun(12, { hops: 1 });
  assert.ok(good.height > meh.height, 'test setup: more hops should climb higher');

  const r1 = await call('POST', '/api/runs', { replay: good.code }, alice);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.height, good.height);           // server got exactly what the client simulated
  assert.equal(r1.body.alltime.rank, 1); assert.equal(r1.body.alltime.improved, true);
  const r2 = await call('POST', '/api/runs', { replay: meh.code }, bob);
  assert.equal(r2.body.alltime.rank, 2);

  // resubmitting your own run is harmless (offline retry queue); someone else's is rejected
  assert.equal((await call('POST', '/api/runs', { replay: good.code }, alice)).body.runId, r1.body.runId);
  assert.equal((await call('POST', '/api/runs', { replay: good.code }, bob)).status, 409);

  const lb = await call('GET', '/api/leaderboard?board=alltime', null, bob);
  assert.deepEqual(lb.body.entries.map((e) => [e.rank, e.name, e.you]), [[1, 'Alice', false], [2, 'Bob', true]]);
  const rep = await call('GET', '/api/runs/' + r1.body.runId);
  assert.equal(rep.body.replay, good.code); assert.equal(rep.body.name, 'Alice');

  // a worse run doesn't replace your best
  const worse = playRun(13, { hops: 0 });
  const r3 = await call('POST', '/api/runs', { replay: worse.code }, alice);
  assert.equal(r3.body.alltime.improved, false); assert.equal(r3.body.alltime.best, good.height);
}));

test('forged and unfinished replays are rejected', () => withServer(async (call) => {
  const t = (await call('POST', '/api/player', {})).body.token;
  assert.equal((await call('POST', '/api/runs', { replay: 'not a replay!' }, t)).status, 400);
  assert.equal((await call('POST', '/api/runs', { replay: 'AQAAAAAAAAAA' }, t)).status, 422);
  // claims to last 10 hours
  assert.equal((await call('POST', '/api/runs', { replay: RTB.encodeReplay({ seed: 1, kind: 'endless', day: 0, steps: 120 * 3600 * 10, changes: [] }) }, t)).status, 422);
  // just hangs there and never falls: not a finished run
  assert.equal((await call('POST', '/api/runs', { replay: RTB.encodeReplay({ seed: 1, kind: 'endless', day: 0, steps: 240, changes: [] }) }, t)).status, 422);
  // inputs out of order
  assert.equal((await call('POST', '/api/runs', { replay: RTB.encodeReplay({ seed: 1, kind: 'endless', day: 0, steps: 900, changes: [[500, 3], [100, 0]] }) }, t)).status, 422);
}));

test('daily board only accepts the real daily seed for today or yesterday', () => withServer(async (call) => {
  const t = (await call('POST', '/api/player', { name: 'Daily Dan' })).body.token;
  const day = RTB.dayNumber(clock);
  const real = playRun(RTB.dailySeed(day), { kind: 'daily', day, hops: 2 });
  const r = await call('POST', '/api/runs', { replay: real.code }, t);
  assert.equal(r.body.daily.day, day); assert.equal(r.body.daily.rank, 1);
  // a daily run on a made-up seed, and one from last week, only count all-time
  const fake = await call('POST', '/api/runs', { replay: playRun(999, { kind: 'daily', day, hops: 1 }).code }, t);
  assert.equal(fake.body.daily, null);
  const old = await call('POST', '/api/runs', { replay: playRun(RTB.dailySeed(day - 7), { kind: 'daily', day: day - 7, hops: 1 }).code }, t);
  assert.equal(old.body.daily, null);
  const lb = await call('GET', '/api/leaderboard?board=daily&day=' + day);
  assert.equal(lb.body.total, 1); assert.equal(lb.body.entries[0].name, 'Daily Dan');
}));

test('your own row is returned even when outside the top N', () => withServer(async (call) => {
  const runs = [3, 2, 1].map((h, i) => playRun(40 + i, { hops: h }));
  const tokens = [];
  for (let i = 0; i < runs.length; i++) {
    const tk = (await call('POST', '/api/player', { name: 'P' + i })).body.token; tokens.push(tk);
    await call('POST', '/api/runs', { replay: runs[i].code }, tk);
  }
  const lb = await call('GET', '/api/leaderboard?limit=1', null, tokens[2]);
  assert.equal(lb.body.entries.length, 1);
  assert.equal(lb.body.me.name, 'P2'); assert.ok(lb.body.me.rank >= 2);
}));

test('serves the game and answers CORS preflight', () => withServer(async (call) => {
  const page = await call('GET', '/');
  assert.equal(page.status, 200); assert.match(page.body, /Raising the Bar/);
  assert.equal((await call('GET', '/api/health')).body.ok, true);
  assert.equal((await call('OPTIONS', '/api/runs')).status, 204);
  assert.equal((await call('GET', '/api/nope')).status, 404);
}));
