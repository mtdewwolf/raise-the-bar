'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { loadSim, verifyReplay } = require('../sim');
const RTB = loadSim();
function play(c, hops = 2, up = {}) {
  const g = RTB.newGame(c.seed, 'play', up, c), changes = []; let last = 0;
  while (!(g.state === 'dying' && g.deathT > 1.5) && g.n < 14400) {
    const bits = g.state === 'play' && (g.n < hops * 205 ? g.n % 205 < 60 : true) ? 3 : 0;
    if (bits !== last) { changes.push([g.n, bits]); last = bits; }
    g.hands[0].key = !!(bits & 1); g.hands[1].key = !!(bits & 2);
    RTB.stepSim(g, RTB.CFG.DT); g.events.length = 0;
  }
  return RTB.encodeReplay({ kind: c.kind, day: c.day, seed: c.seed, up, steps: g.n, changes });
}
async function server(fn, options = {}) {
  let clock = Date.UTC(2026, 9, 4, 23, 30); // Sunday: a challenge can span Monday rollover.
  const app = createApp({ dbFile: ':memory:', now: () => clock, ...options });
  await new Promise(r => app.listen(0, r));
  const base = 'http://127.0.0.1:' + app.address().port;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const player = async name => (await call('POST', '/api/player', { name })).body.token;
  try { await fn(call, player, n => { clock += n; }); } finally { await app.closeAll(); }
}

test('friend lifecycle: invite, join, verified ranking, ties, retry, deadline and rematch', () => server(async (call, player, advance) => {
  const alice = await player('Alice'), bob = await player('Bob'), eve = await player('Eve');
  const created = await call('POST', '/api/challenges', { kind: 'endless' }, alice);
  assert.equal(created.status, 200);
  const c = created.body, path = '/api/challenges/' + c.code;
  assert.match(c.code, /^[A-F0-9]{12}$/); assert.equal(c.expiresAt - c.createdAt, 86400000);
  assert.equal(c.joined, true); assert.equal(c.entries[0].height, null);
  assert.equal((await call('GET', path)).body.joined, false);
  const replay = play(c, 3);
  assert.equal((await call('POST', path + '/attempts', { replay }, bob)).status, 403);
  assert.equal((await call('POST', path + '/join', {}, bob)).status, 200);
  assert.equal((await call('POST', path + '/join', {}, bob)).body.entries.length, 2);
  const res = await call('POST', path + '/attempts', { replay, height: 999999 }, bob);
  assert.equal(res.status, 200); assert.equal(res.body.entries[0].height, verifyReplay(RTB, replay).height);
  assert.equal(res.body.entries[0].name, 'Bob');
  // Identical input sequences can happen naturally. Deduplication is player-scoped.
  const tie = await call('POST', path + '/attempts', { replay }, alice);
  assert.deepEqual(tie.body.entries.map(e => e.rank), [1, 1]);
  assert.equal((await call('GET', '/api/leaderboard')).body.total, 0);
  assert.equal((await call('GET', '/api/me', null, alice)).body.earned, 0);
  assert.equal((await call('GET', '/api/challenges', null, bob)).body.challenges.length, 1);
  assert.equal((await call('POST', path + '/rematch', {}, eve)).status, 403);
  advance(86400000);
  assert.equal((await call('GET', path)).body.status, 'finished');
  assert.equal((await call('POST', path + '/join', {}, eve)).status, 410);
  assert.equal((await call('POST', path + '/attempts', { replay: play(c, 1) }, bob)).status, 410);
  assert.equal((await call('POST', path + '/attempts', { replay }, bob)).status, 200);
  const rematch = (await call('POST', path + '/rematch', {}, alice)).body;
  assert.equal(rematch.parentCode, c.code); assert.notEqual(rematch.code, c.code);
  assert.equal(rematch.entries.length, 1); assert.equal(rematch.entries[0].height, null);
  assert.equal((await call('POST', path + '/rematch', {}, alice)).body.code, rematch.code);
  assert.deepEqual((await call('GET', path)).body.rematches, [rematch.code]);
}));

test('weekly friend challenge preserves rules over rollover but never enters weekly public board', () => server(async (call, player, advance) => {
  const token = await player('Weekly Pal');
  const c = (await call('POST', '/api/challenges', { kind: 'weekly' }, token)).body;
  advance(3600000);
  const replay = play(c, 2);
  const r = await call('POST', '/api/challenges/' + c.code + '/attempts', { replay }, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.day, c.day); assert.equal(r.body.title, 'Butter Bars');
  assert.equal((await call('GET', '/api/leaderboard?board=weekly')).body.total, 0);
  assert.equal((await call('POST', '/api/runs', { replay }, token)).status, 422);
}));

test('challenge validation rejects forged settings, upgrades, wrong ladder, unfinished and unauthenticated submissions', () => server(async (call, player) => {
  const token = await player('Validator');
  assert.equal((await call('POST', '/api/challenges', {})).status, 401);
  assert.equal((await call('POST', '/api/challenges', { kind: 'bad' }, token)).status, 400);
  const c = (await call('POST', '/api/challenges', {}, token)).body;
  const path = '/api/challenges/' + c.code + '/attempts';
  assert.equal((await call('POST', path, { replay: play({ ...c, seed: c.seed ^ 1 }) }, token)).status, 422);
  assert.equal((await call('POST', path, { replay: play(c, 2, { spring: 1 }) }, token)).status, 422);
  const short = RTB.encodeReplay({ ...c, steps: 240, changes: [] });
  assert.equal((await call('POST', path, { replay: short }, token)).status, 422);
  assert.equal((await call('POST', path, { replay: 'bad!' }, token)).status, 400);
  assert.equal((await call('GET', '/api/challenges/FFFFFFFFFFFF')).status, 404);
  const fromRun = await call('POST', '/api/challenges', { replay: play(c) }, token);
  assert.equal(fromRun.status, 200); assert.ok(fromRun.body.entries[0].height > 0);
}));

test('mock endpoints cannot be enabled', () => server(async (call, player) => {
  const token = await player('No Mocks');
  assert.equal((await call('GET', '/api/health')).body.challengeDemo, undefined);
  assert.equal((await call('POST', '/api/challenges/demo', {}, token)).status, 404);
  const c = (await call('POST', '/api/challenges', {}, token)).body;
  assert.equal((await call('POST', '/api/challenges/' + c.code + '/mock-turn', {}, token)).status, 404);
  assert.equal((await call('POST', '/api/challenges/' + c.code + '/finish', {}, token)).status, 404);
  assert.equal(c.entries.length, 1);
}, { demo: true }));
