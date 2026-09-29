'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSim, verifyReplay } = require('../sim');
const R = loadSim(), dt = R.CFG.DT;
const centre = g => {
  const P = g.body.pts, mass = P.reduce((v, p) => v + p.m, 0);
  return { x: P.reduce((v, p) => v + p.m * p.x, 0) / mass,
    y: P.reduce((v, p) => v + p.m * p.y, 0) / mass };
};

test('releasing either base or upgraded arms preserves momentum without a launch impulse', () => {
  for (const up of [{}, { spring: 5, pull: 5 }]) {
    const actual = R.newGame(77, 'play', up), free = R.newGame(77, 'play', up);
    for (let i = 0; i < 54; i++) for (const g of [actual, free]) {
      g.hands.forEach(h => h.key = true); R.stepSim(g, dt);
    }
    for (const h of free.hands) {
      h.exclBar = h.grip.bar; h.exclT = 0.15; h.grip = null;
      h.holdT = 0; h.reachT = R.CFG.REACH_TIME; h.prevKey = false;
    }
    for (const g of [actual, free]) { g.hands.forEach(h => h.key = false); R.stepSim(g, dt); }
    assert.equal(actual.hops, 1);
    assert.deepEqual(actual.body.pts, free.body.pts);
    assert.equal(actual.stam, free.stam, 'letting go does not spend artificial launch energy');
  }
});

test('reaching and leg motors exert no net internal force or torque in midair', () => {
  for (const bits of [0, 1, 2, 3]) {
    const g = R.newGame(11);
    for (const p of g.body.pts) { p.y += 8; p.py += 8; }
    g.hands.forEach((h, i) => { h.grip = null; h.cool = 2; h.key = !!(bits & (1 << i)); });
    R.stepSim(g, dt);
    const P = g.body.pts;
    let fx = 0, fy = 0, torque = 0;
    for (const p of P) {
      const internalY = p.fy + p.m * R.CFG.G;
      fx += p.fx; fy += internalY;
      // Forces were calculated at the pre-integration positions.
      torque += p.px * internalY - p.py * p.fx;
    }
    assert.ok(Math.abs(fx) < 1e-9); assert.ok(Math.abs(fy) < 1e-9);
    assert.ok(Math.abs(torque) < 1e-8);
  }
});

test('airborne limb movements leave the centre of mass on its gravity/drag trajectory', () => {
  const g = R.newGame(11);
  for (const p of g.body.pts) { p.y += 8; p.py = p.y - 1.2 * dt; p.px = p.x - 0.3 * dt; }
  g.hands.forEach(h => { h.grip = null; h.cool = 2; });
  let expected = centre(g), vx = 0.3 * dt, vy = 1.2 * dt;
  for (let i = 0; i < 80; i++) {
    g.hands[0].key = i % 24 < 18; g.hands[1].key = i % 30 < 20;
    vx *= R.CFG.DAMP; vy = vy * R.CFG.DAMP - R.CFG.G * dt * dt;
    expected.x += vx; expected.y += vy;
    R.stepSim(g, dt);
  }
  const actual = centre(g);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-8);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-8);
});

test('muscle force decreases with faster shortening and fatigue', () => {
  function pull(stam, speed) {
    const g = R.newGame(11); g.stam = stam;
    for (const p of g.body.pts) p.py = p.y - speed * dt;
    for (const h of g.hands) { const hp = g.body.pts[h.idx]; hp.py = hp.y; h.key = true; h.prevKey = true; h.activation = 1; }
    R.stepSim(g, dt); return g.hands[0].pullF;
  }
  const fresh = pull(100, 0);
  assert.ok(pull(100, 2) < fresh * 0.6);
  assert.ok(pull(25, 0) < fresh * 0.6);
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
