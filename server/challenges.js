'use strict';
const crypto = require('node:crypto');

// Challenges have their own results: archived event races never change public boards or wallets.
function challengeRoutes({ db, q, RTB, pool, now, auth, readJson, limit, HttpError, sanitizeLook }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS challenges (
      code TEXT PRIMARY KEY, creator_id INTEGER NOT NULL REFERENCES players(id),
      kind TEXT NOT NULL, day INTEGER NOT NULL, seed INTEGER NOT NULL, version INTEGER NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      parent_code TEXT REFERENCES challenges(code)
    );
    CREATE TABLE IF NOT EXISTS challenge_members (
      code TEXT NOT NULL REFERENCES challenges(code), player_id INTEGER NOT NULL REFERENCES players(id),
      joined_at INTEGER NOT NULL, PRIMARY KEY(code, player_id)
    );
    CREATE TABLE IF NOT EXISTS challenge_attempts (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL REFERENCES challenges(code),
      player_id INTEGER NOT NULL REFERENCES players(id), replay TEXT NOT NULL, replay_hash TEXT NOT NULL,
      height REAL NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(code, player_id, replay_hash)
    );
    CREATE INDEX IF NOT EXISTS challenges_member_player ON challenge_members(player_id, code);
    CREATE INDEX IF NOT EXISTS challenge_attempts_rank ON challenge_attempts(code, player_id, height DESC);
  `);
  const get = db.prepare('SELECT * FROM challenges WHERE code = ?');
  const member = db.prepare('SELECT 1 FROM challenge_members WHERE code = ? AND player_id = ?');
  const join = db.prepare('INSERT OR IGNORE INTO challenge_members VALUES (?, ?, ?)');
  const insert = db.prepare('INSERT INTO challenges(code,creator_id,kind,day,seed,version,created_at,expires_at,parent_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const add = db.prepare('INSERT OR IGNORE INTO challenge_attempts(code,player_id,replay,replay_hash,height,created_at) VALUES(?,?,?,?,?,?)');
  const duplicate = db.prepare('SELECT 1 FROM challenge_attempts WHERE code=? AND player_id=? AND replay_hash=?');
  const roster = db.prepare(`SELECT m.player_id, p.name, p.look, p.achievements,
    a.height, a.replay, a.created_at FROM challenge_members m JOIN players p ON p.id=m.player_id
    LEFT JOIN challenge_attempts a ON a.id=(SELECT id FROM challenge_attempts
      WHERE code=m.code AND player_id=m.player_id ORDER BY height DESC, created_at, id LIMIT 1)
    WHERE m.code=? ORDER BY a.height DESC, a.created_at, m.joined_at, m.player_id`);
  const count = db.prepare('SELECT COUNT(*) AS n FROM challenge_members WHERE code=?');
  const version = kind => kind === 'weekly' ? RTB.WEEKLY_REPLAY_VERSION : RTB.REPLAY_VERSION;
  function lookup(code) {
    const c = get.get(String(code).toUpperCase());
    if (!c) throw new HttpError(404, 'This invite was not found. Ask your friend for a new invite.');
    return c;
  }
  function active(c) {
    if (c.version !== version(c.kind)) throw new HttpError(409, 'This challenge uses an older game version. Start a rematch.');
    if (now() >= c.expires_at) throw new HttpError(410, 'This challenge has ended. Start a rematch.');
  }
  function snapshot(c, p) {
    const rows = roster.all(c.code); let rank = 0, previous = null;
    const entries = rows.map((r, i) => {
      if (r.height !== null && r.height !== previous) rank = i + 1;
      previous = r.height;
      const look = sanitizeLook({...r,id:r.player_id});
      return { name: r.name, look, height: r.height, replay: r.replay, rank: r.height === null ? null : rank,
        you: !!p && r.player_id === p.id, creator: r.player_id === c.creator_id };
    });
    const expired = now() >= c.expires_at, compatible = c.version === version(c.kind);
    return { code: c.code, kind: c.kind, day: c.day, seed: c.seed, version: c.version,
      title: c.kind === 'weekly' ? RTB.weeklyEvent(c.day).name : c.kind === 'daily' ? 'Daily Ladder #' + c.day : 'Friends Ladder',
      createdAt: c.created_at, expiresAt: c.expires_at, time: now(),
      status: !compatible ? 'outdated' : expired ? 'finished' : 'active',
      joined: !!p && !!member.get(c.code, p.id), owner: !!p && c.creator_id === p.id,
      parentCode: c.parent_code, entries,
      rematches: db.prepare('SELECT code FROM challenges WHERE parent_code=? ORDER BY created_at DESC LIMIT 10').all(c.code).map(r => r.code) };
  }
  function create(p, rules, parent = null) {
    let code;
    do { code = crypto.randomBytes(6).toString('hex').toUpperCase(); } while (get.get(code));
    const t = now();
    insert.run(code, p.id, rules.kind, rules.day || 0, rules.seed, version(rules.kind), t, t + 86400000, parent);
    join.run(code, p.id, t);
    return get.get(code);
  }
  function decode(code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{8,60000}$/.test(code)) throw new HttpError(400, 'Missing or malformed replay');
    try { return RTB.decodeReplay(code); } catch (e) { throw new HttpError(422, 'Invalid replay: ' + e.message); }
  }
  async function verify(code, c) {
    const r = decode(code);
    if (!RTB.noUpgrades(r.up)) throw new HttpError(422, 'Friend challenges use no upgrades. Set a new score with equal rules.');
    if (c && (r.kind !== c.kind || r.day !== c.day || r.seed !== c.seed)) throw new HttpError(422, 'This run does not match the challenge ladder and rules.');
    if (r.kind === 'weekly' && r.seed !== RTB.weeklySeed(r.day)) throw new HttpError(422, 'Invalid weekly ladder');
    if (r.kind === 'daily' && r.seed !== RTB.dailySeed(r.day)) throw new HttpError(422, 'Invalid daily ladder');
    if (r.kind === 'endless' && r.day !== 0) throw new HttpError(422, 'Invalid ladder period');
    let v; try { v = await pool.verify(code); } catch (e) { throw new HttpError(422, 'Replay could not be verified: ' + e.message); }
    if (!v.finished) throw new HttpError(422, 'Finish your run before submitting it.');
    return v;
  }
  const hash = code => crypto.createHash('sha256').update(code).digest('hex');
  const save = (c, p, code, height) => add.run(c.code, p.id, code, hash(code), height, now());
  function rate(p, ip) { limit('challenge:' + p.id, 12, 60000); limit('challengeip:' + ip, 40, 60000); }
  function newRules(kind) {
    if (!['endless', 'daily', 'weekly'].includes(kind)) throw new HttpError(400, 'Choose endless, daily, or weekly');
    const day = kind === 'weekly' ? RTB.weekDay(now()) : kind === 'daily' ? RTB.dayNumber(now()) : 0;
    return { kind, day, seed: kind === 'weekly' ? RTB.weeklySeed(day) : kind === 'daily' ? RTB.dailySeed(day) : crypto.randomInt(0x100000000) };
  }
  const routes = {
    'GET /api/challenges': req => {
      const p = auth(req, true);
      return { challenges: db.prepare(`SELECT c.* FROM challenges c JOIN challenge_members m ON m.code=c.code
        WHERE m.player_id=? ORDER BY c.created_at DESC LIMIT 50`).all(p.id).map(c => {
          const s = snapshot(c, p); s.entries.forEach(e => delete e.replay); return s;
        }) };
    },
    'POST /api/challenges': async (req, ip) => {
      const p = auth(req, true); rate(p, ip);
      limit('challengecreate:' + p.id, 30, 3600000);
      const b = await readJson(req);
      const v = b.replay ? await verify(b.replay) : null;
      const rules = v || newRules(b.kind || 'endless');
      const c = create(p, rules);
      if (v) save(c, p, b.replay, v.height);
      return snapshot(c, p);
    },
  };
  function resolve(method, path) {
    const m = /^\/api\/challenges\/([A-Fa-f0-9]{12})(?:\/(join|attempts|rematch))?$/.exec(path);
    if (!m) return null;
    if (method === 'GET' && !m[2]) return req => snapshot(lookup(m[1]), auth(req, false));
    if (method !== 'POST' || !m[2]) return null;
    return async (req, ip) => {
      const p = auth(req, true), c = lookup(m[1]); rate(p, ip);
      const action = m[2];
      if (action === 'join') {
        active(c);
        if (!member.get(c.code, p.id) && count.get(c.code).n >= 50) throw new HttpError(409, 'This challenge is full (50 players).');
        join.run(c.code, p.id, now());
      } else {
        if (!member.get(c.code, p.id)) throw new HttpError(403, 'Join this challenge first.');
        if (action === 'attempts') {
          const b = await readJson(req); decode(b.replay);
          // Network retries of an accepted attempt remain safe after expiry.
          if (!duplicate.get(c.code, p.id, hash(b.replay))) {
            active(c); const v = await verify(b.replay, c);
            active(lookup(c.code)); // recheck the deadline after async verification
            save(c, p, b.replay, v.height);
          }
        } else if (action === 'rematch') {
          limit('challengecreate:' + p.id, 30, 3600000);
          const existing = db.prepare('SELECT * FROM challenges WHERE parent_code=? AND creator_id=? AND expires_at>? AND version=? ORDER BY created_at DESC LIMIT 1').get(c.code, p.id, now(), version(c.kind));
          if (existing) return snapshot(existing, p);
          const next = create(p, c.kind === 'endless' ? newRules('endless') : c, c.code);
          return snapshot(next, p);
        }
      }
      return snapshot(lookup(c.code), p);
    };
  }
  return { routes, resolve, invite: code => snapshot(lookup(code), null) };
}
module.exports = { challengeRoutes };
