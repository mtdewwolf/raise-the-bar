'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../server');
const { loadSim } = require('../sim');
const R = loadSim();

test('recovery separates legacy boards, retains wallet/profile data and rematches outdated challenges', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtb-recovery-'));
  const file = path.join(dir, 'test.sqlite');
  let clock = Date.UTC(2026, 8, 30, 12);
  const app = createApp({ dbFile: file, now: () => clock });
  await new Promise(r => app.listen(0, r));
  const base = 'http://127.0.0.1:' + app.address().port;
  const call = async (method, route, body, token) => {
    const res = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const db = new DatabaseSync(file);
  try {
    const { token } = (await call('POST', '/api/player', { name: 'Returning Player' })).body;
    const player = db.prepare('SELECT id FROM players').get().id;
    db.prepare('UPDATE players SET look=?, upgrades=?, achievements=? WHERE id=?').run('{"hat":"crown"}', '{"spring":1}', '["first_hop","top10"]', player);
    for (const [kind, day, version] of [['endless', 0, 4], ['daily', 273, 4], ['weekly', 271, 5]]) {
      clock += 61000; // each migration case gets an independent rate-limit window
      const replay = R.encodeReplay({ kind, day, seed: 11, steps: 500, changes: [] });
      const bytes = Buffer.from(replay, 'base64url'); bytes[0] = version;
      const id = db.prepare('INSERT INTO runs(player_id,kind,day,seed,height,score,bars,hops,replay,replay_hash,created_at,coins) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(player, kind, day, 11, 999, 99900, 100, 100, bytes.toString('base64url'), kind, 1, 100).lastInsertRowid;
      const board = kind === 'endless' ? 'alltime' : kind;
      db.prepare('INSERT INTO bests VALUES(?,?,?,?,?,?)').run(board + '@v' + version, day, player, id, 999, 1);
      const result = await call('GET', '/api/leaderboard?board=' + board + '&day=' + day, null, token);
      assert.equal(result.status, 200); assert.equal(result.body.total, 0);
      const c = (await call('POST', '/api/challenges', { kind }, token)).body;
      db.prepare('UPDATE challenges SET version=? WHERE code=?').run(version, c.code);
      const route = '/api/challenges/' + c.code;
      assert.equal((await call('GET', route, null, token)).body.status, 'outdated');
      assert.equal((await call('POST', route + '/join', {}, token)).status, 409);
      // A pre-recovery rematch must not trap the player on obsolete rules.
      const legacyNext = (await call('POST', route + '/rematch', {}, token)).body;
      db.prepare('UPDATE challenges SET version=? WHERE code=?').run(version, legacyNext.code);
      const next = await call('POST', route + '/rematch', {}, token);
      assert.equal(next.status, 200); assert.equal(next.body.status, 'active');
      assert.equal(next.body.version, kind === 'weekly' ? 7 : 6);
      assert.equal(next.body.parentCode, c.code);
      assert.notEqual(next.body.code, legacyNext.code);
      assert.equal((await call('POST', route + '/rematch', {}, token)).body.code, next.body.code);
      db.prepare('UPDATE challenges SET expires_at=1 WHERE code=?').run(c.code);
      assert.equal((await call('GET', route, null, token)).body.status, 'outdated', 'expired legacy replay must remain disabled');
    }
    const me = (await call('GET', '/api/me', null, token)).body;
    assert.equal(me.name, 'Returning Player'); assert.equal(me.earned, 300);
    assert.equal(me.upgrades.spring, 1); assert.equal(me.look.hat, 'crown');
    assert.deepEqual(me.achievements, ['first_hop','top10']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bests').get().n, 3);
  } finally {
    db.close(); await app.closeAll(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
