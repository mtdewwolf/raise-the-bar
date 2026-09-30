'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { loadSim, verifyReplay } = require('../sim');
const RTB = loadSim();
const MONDAY = Date.UTC(2026, 8, 28);
const WEEK = 7 * 86400000;

// Use the real game and raw keyboard/touch bit masks, just like the client recorder.
function playWeekly(day, { seed = RTB.weeklySeed(day), up = {}, bits = 3, hold = 30 } = {}) {
  const rules = { kind: 'weekly', day };
  const g = RTB.newGame(seed, 'play', up, rules);
  const changes = []; let previous = 0, maxHands = 0;
  while (!(g.state === 'dying' && g.deathT > 1.5) && g.n < 14400) {
    const on = g.state === 'play' && (g.n < 615 ? g.n % 205 < hold : true);
    const input = on ? bits : 0;
    if (input !== previous) { changes.push([g.n, input]); previous = input; }
    g.hands[0].key = !!(input & 1); g.hands[1].key = !!(input & 2);
    RTB.stepSim(g, RTB.CFG.DT);
    maxHands = Math.max(maxHands, g.hands.filter((h) => h.grip).length);
    g.events.length = 0;
  }
  assert.equal(g.state, 'dying', 'scripted run must finish');
  const rec = { ...rules, seed, steps: g.n, changes, up };
  return { code: RTB.encodeReplay(rec), g, rec, maxHands };
}

async function withWeeklyServer(fn) {
  let clock = MONDAY + 3600000;
  const app = createApp({ dbFile: ':memory:', now: () => clock });
  await new Promise((resolve) => app.listen(0, resolve));
  const base = 'http://127.0.0.1:' + app.address().port;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  try { await fn(call, (t) => { clock = t; }); } finally { await app.closeAll(); }
}

test('weekly calendar rolls over exactly Monday UTC, including year and DST boundaries', () => {
  const day = RTB.weekDay(MONDAY);
  assert.equal(day, 271);
  assert.equal(RTB.weekDay(MONDAY - 1), day - 7);
  assert.equal(RTB.weekDay(MONDAY + WEEK - 1), day);
  assert.equal(RTB.weekDay(MONDAY + WEEK), day + 7);
  for (const date of ['2026-12-31T23:59:59Z', '2027-01-01T00:00:00Z', '2027-03-14T08:00:00Z', '2026-11-01T07:00:00Z']) {
    const ms = Date.parse(date), event = RTB.weeklyEvent(RTB.weekDay(ms));
    assert.equal(new Date(event.startsAt).getUTCDay(), 1);
    assert.equal(new Date(event.startsAt).getUTCHours(), 0);
    assert.ok(ms >= event.startsAt && ms < event.endsAt);
    assert.equal(event.endsAt - event.startsAt, WEEK);
  }
  assert.equal(RTB.weekDay(Date.UTC(2027, 0, 1)), RTB.weekDay(Date.UTC(2026, 11, 31)));
  assert.deepEqual([0, 7, 14, 21].map((n) => RTB.weeklyEvent(day + n).id), ['butter', 'low-gravity', 'one-hand', 'butter']);
  assert.notEqual(RTB.weeklySeed(day), RTB.weeklySeed(day + 21));
  for (const invalid of [0, day + 1, NaN, Infinity, day + 0.5]) assert.throws(() => RTB.weeklyEvent(invalid), /period/);
});

test('all weekly modifiers are climbable and reproduce through the server verifier', () => {
  for (const day of [271, 278, 285]) {
    const { code, g, rec, maxHands } = playWeekly(day);
    const decoded = RTB.decodeReplay(code), result = verifyReplay(RTB, code);
    assert.equal(decoded.kind, 'weekly'); assert.equal(decoded.day, day);
    assert.equal(decoded.seed, RTB.weeklySeed(day));
    assert.equal(result.finished, true);
    assert.ok(g.maxBar >= 1, RTB.weeklyEvent(day).name + ' must be climbable');
    assert.equal(result.height, Math.round(g.maxHeight * 100) / 100);
    assert.equal(result.bars, g.maxBar);
    assert.equal(RTB.simulateReplay(decoded).maxHeight, g.maxHeight);
    if (day === 271) assert.ok(g.bars.every((b) => b.type === 'butter'));
    if (day === 278) assert.equal(g.grav, 0.55);
    if (day === 285) assert.equal(maxHands, 1);
    assert.equal(RTB.encodeReplay(decoded), RTB.encodeReplay(rec));
  }
});

test('one-hand event accepts either key and never grips with the right hand', () => {
  const left = playWeekly(285, { bits: 1 }), right = playWeekly(285, { bits: 2 }), both = playWeekly(285);
  assert.equal(left.maxHands, 1); assert.equal(right.maxHands, 1); assert.equal(both.maxHands, 1);
  assert.equal(left.g.maxHeight, right.g.maxHeight); assert.equal(left.g.maxHeight, both.g.maxHeight);
  assert.equal(right.g.hands[1].grip, null);
});

test('weekly replays use a distinct version with the current daily/endless physics version', () => {
  const { code } = playWeekly(271);
  const bytes = Buffer.from(code, 'base64url');
  assert.equal(bytes[0], RTB.WEEKLY_REPLAY_VERSION);
  bytes[0] = RTB.REPLAY_VERSION; // cannot relabel a weekly replay as an endless run
  assert.throws(() => RTB.decodeReplay(bytes.toString('base64url')), /kind/);
  for (const kind of ['daily', 'endless']) {
    const old = RTB.encodeReplay({ kind, day: 271, seed: 5, steps: 500, changes: [[0, 3], [24, 0]] });
    assert.equal(Buffer.from(old, 'base64url')[0], RTB.REPLAY_VERSION);
    assert.equal(RTB.decodeReplay(old).kind, kind);
  }
});

test('weekly scores rank separately, retry safely, reset and preserve the previous board', () => withWeeklyServer(async (call, setClock) => {
  const { token } = (await call('POST', '/api/player', { name: 'Weekly Wren' })).body;
  const event = (await call('GET', '/api/events/weekly')).body;
  assert.equal(event.day, 271); assert.equal(event.id, 'butter');
  const run = playWeekly(event.day);
  const submit = await call('POST', '/api/runs', { replay: run.code }, token);
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  assert.equal(submit.body.weekly.rank, 1); assert.equal(submit.body.weekly.improved, true);
  assert.equal(submit.body.alltime, null); assert.equal(submit.body.daily, null);
  const ranked = await call('GET', '/api/leaderboard?board=weekly', null, token);
  assert.equal(ranked.body.total, 1); assert.equal(ranked.body.entries[0].you, true);
  assert.equal(ranked.body.event.id, 'butter');
  assert.equal((await call('GET', '/api/leaderboard?board=daily')).body.total, 0);
  assert.equal((await call('GET', '/api/leaderboard?board=alltime')).body.total, 0);
  assert.equal((await call('GET', '/api/runs/' + submit.body.runId)).body.replay, run.code);
  const retry = await call('POST', '/api/runs', { replay: run.code }, token);
  assert.equal(retry.body.runId, submit.body.runId); assert.equal(retry.body.weekly.improved, false);
  assert.equal(retry.body.earned, submit.body.earned);

  setClock(MONDAY + WEEK);
  const next = await call('GET', '/api/leaderboard?board=weekly');
  assert.equal(next.body.day, 278); assert.equal(next.body.total, 0); assert.equal(next.body.event.id, 'low-gravity');
  assert.equal((await call('GET', '/api/leaderboard?board=weekly&day=271')).body.total, 1);
  assert.equal((await call('POST', '/api/runs', { replay: run.code }, token)).body.runId, submit.body.runId);
  const nextRun = playWeekly(278);
  assert.equal((await call('POST', '/api/runs', { replay: nextRun.code }, token)).body.weekly.rank, 1);
  setClock(MONDAY + WEEK * 3); // the same modifier gets a fresh seed AND a fresh board
  const rotated = await call('GET', '/api/leaderboard?board=weekly');
  assert.equal(rotated.body.event.id, 'butter'); assert.equal(rotated.body.total, 0);
  assert.notEqual(rotated.body.event.seed, event.seed);
}));

test('weekly API rejects forged seeds, upgrades, expired/future periods and malformed period queries', () => withWeeklyServer(async (call) => {
  const { token } = (await call('POST', '/api/player', { name: 'Fair Play' })).body;
  const invalid = [
    playWeekly(271, { seed: 999 }).code,
    playWeekly(271, { up: { spring: 1 } }).code,
    playWeekly(264).code,
    playWeekly(278).code,
  ];
  for (const replay of invalid) {
    const res = await call('POST', '/api/runs', { replay }, token);
    assert.equal(res.status, 422, JSON.stringify(res.body));
  }
  assert.equal((await call('GET', '/api/leaderboard?board=weekly')).body.total, 0);
  assert.equal((await call('GET', '/api/leaderboard?board=alltime')).body.total, 0);
  for (const day of ['oops', '272', 'Infinity', '271.5', '']) {
    assert.equal((await call('GET', '/api/leaderboard?board=weekly&day=' + day)).status, 400);
  }
}));
