'use strict';
// Loads the game's simulation straight out of ../index.html (between the @sim-begin and
// @sim-end markers), so the server verifies replays with exactly the code players ran.
const fs = require('node:fs');
const path = require('node:path');

const GAME_FILE = process.env.RTB_GAME_FILE || path.join(__dirname, '..', 'index.html');

function loadSim(file = GAME_FILE) {
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf('// @sim-begin'), b = html.indexOf('// @sim-end');
  if (a < 0 || b < 0 || b < a) throw new Error('simulation markers not found in ' + file);
  const scope = {};
  // The block assigns globalThis.RTB; give it a private "globalThis" so nothing leaks.
  new Function('globalThis', '"use strict";\n' + html.slice(a, b))(scope);
  if (!scope.RTB || typeof scope.RTB.stepSim !== 'function') throw new Error('simulation did not export RTB');
  return scope.RTB;
}

const MAX_STEPS = 120 * 60 * 30; // 30 minutes of play is plenty for any honest run

// Re-simulate a replay and report what it actually achieved.
function verifyReplay(RTB, code) {
  const rec = RTB.decodeReplay(code);
  if (!Number.isFinite(rec.steps) || rec.steps <= 0 || rec.steps > MAX_STEPS) throw new Error('replay length out of range');
  let last = -1;
  for (const [step, bits] of rec.changes) {
    if (step < last || step > rec.steps || bits < 0 || bits > 3) throw new Error('malformed replay');
    last = step;
  }
  const g = RTB.newGame(rec.seed, 'play'), pb = RTB.makePlayback(rec);
  const cap = rec.steps + 600;
  while (g.n < cap && !(g.state === 'dying' && g.deathT > 0.2)) {
    RTB.applyPlayback(g, pb); RTB.stepSim(g, RTB.CFG.DT); g.events.length = 0;
  }
  return {
    seed: rec.seed, kind: rec.kind, day: rec.day, steps: rec.steps,
    height: Math.round(g.maxHeight * 100) / 100, score: RTB.score(g), bars: g.maxBar, hops: g.hops,
    finished: g.state === 'dying',
  };
}

module.exports = { loadSim, verifyReplay, MAX_STEPS };
