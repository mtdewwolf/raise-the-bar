'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSim, verifyReplay } = require('../sim');
const R = loadSim(), dt = R.CFG.DT;

test('opening gaps restore the wide classic ladder, including assisted weekly spacing', () => {
  for (const seed of [11, 77, 1234]) {
    for (const rules of [undefined, { kind: 'weekly', day: 285 }]) {
      const g = R.newGame(seed, 'play', {}, rules);
      for (let i = 1; i <= 4; i++) {
        assert.ok(Math.abs(g.bars[i].y - g.bars[i - 1].y - (rules ? 0.44 : 0.55)) < 1e-10);
      }
    }
  }
});

test('pulls respond immediately with a two-arm bonus and an early release cue', () => {
  const single = R.newGame(11), both = R.newGame(11);
  single.hands[0].key = true;
  both.hands.forEach(h => h.key = true);
  for (const g of [single, both]) R.stepSim(g, dt);
  assert.ok(single.hands[0].pullF > 500, 'full force on the first input step');
  assert.ok(both.hands[0].pullF > single.hands[0].pullF * 1.25);
  let readyStep = 0;
  for (let i = 2; i <= 40; i++) {
    R.stepSim(both, dt);
    if (both.hands.some(h => R.throwReady(both, h) === 2)) { readyStep = i; break; }
  }
  assert.ok(readyStep >= 20 && readyStep <= 30, 'release cue around 0.2 seconds');
});

test('timed release restores hop impulse and Spring Hop increases the climb', () => {
  function hop(up) {
    const g = R.newGame(11, 'play', up);
    for (let i = 0; i < 24; i++) { g.hands.forEach(h => h.key = true); R.stepSim(g, dt); }
    g.hands.forEach(h => h.key = false); R.stepSim(g, dt);
    assert.equal(g.hops, 1);
    assert.ok(g.events.some(e => e.type === 'throw' && e.hop));
    for (let i = 0; i < 120; i++) R.stepSim(g, dt);
    return g;
  }
  const base = hop({}), spring = hop({ spring: 5 });
  assert.ok(base.maxBar >= 1, 'short classic pull reaches the next wider bar');
  assert.ok(spring.maxHeight > base.maxHeight + 0.1, 'Spring Hop restores an upward kick');
});

test('recovery uses new replay versions and rejects all legacy physics without reinterpretation', () => {
  assert.equal(R.REPLAY_VERSION, 6); assert.equal(R.WEEKLY_REPLAY_VERSION, 7);
  for (const kind of ['endless', 'daily', 'weekly']) {
    const rec = { seed: 11, kind, day: 271, steps: 500, changes: [[0, 3], [24, 0]] };
    const code = R.encodeReplay(rec);
    assert.equal(R.decodeReplay(code).kind, kind);
    for (const version of [1, 2, 3, 4, 5]) {
      const bytes = Buffer.from(code, 'base64url'); bytes[0] = version;
      assert.throws(() => R.decodeReplay(bytes.toString('base64url')), /unsupported replay version/);
      assert.throws(() => verifyReplay(R, bytes.toString('base64url')), /unsupported replay version/);
    }
  }
});

test('coached releases climb several bars and reproduce exactly through replay verification', () => {
  for (const seed of [11, 77, 1234]) {
    const g = R.newGame(seed), changes = []; let on = true, rest = 0, last = 0;
    while (g.n < 14400 && !(g.state === 'dying' && g.deathT > 1)) {
      if (g.maxBar < 5) {
        if (on && g.hands.some(h => R.throwReady(g, h) === 2)) { on = false; rest = 0; }
        if (!on && g.hands.every(h => h.grip)) { if (++rest >= 100) { on = true; rest = 0; } }
      } else on = true; // finish by exhausting the grip after the required climbs
      const bits = g.state === 'play' && on ? 3 : 0;
      if (bits !== last) { changes.push([g.n, bits]); last = bits; }
      g.hands.forEach(h => h.key = !!bits); R.stepSim(g, dt); g.events.length = 0;
      assert.ok(g.body.pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    }
    assert.ok(g.maxBar >= 5, 'seed ' + seed + ' should remain climbable');
    const rec = { seed, kind: 'endless', day: 0, up: {}, steps: g.n, changes };
    const verified = verifyReplay(R, R.encodeReplay(rec));
    assert.equal(verified.finished, true); assert.equal(verified.bars, g.maxBar);
    assert.equal(verified.height, Math.round(g.maxHeight * 100) / 100);
  }
});
