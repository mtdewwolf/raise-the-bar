'use strict';
// Raising the Bar leaderboard + achievements server.
// Dependency-free: Node 22+ (node:http, node:sqlite, worker_threads). See server/README.md.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb } = require('./db');
const { VerifierPool } = require('./verifier');
const { loadSim } = require('./sim');

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, easy to type from another device
const ADJ = ['Noodle', 'Wobbly', 'Mighty', 'Sweaty', 'Brave', 'Chalky', 'Floppy', 'Plucky', 'Gritty', 'Soggy', 'Jolly', 'Tiny'];
const NOUN = ['Arms', 'Climber', 'Gibbon', 'Salmon', 'Hopper', 'Dangler', 'Grip', 'Monkey', 'Sloth', 'Lifter', 'Swinger', 'Rung'];
const BLOCKED = /(fuck|shit|cunt|nigg|fag|rape|hitler|nazi|slut|whore)/i;

function newToken() {
  let t = '';
  for (let i = 0; i < 15; i++) t += TOKEN_ALPHABET[crypto.randomInt(TOKEN_ALPHABET.length)];
  return t.slice(0, 5) + '-' + t.slice(5, 10) + '-' + t.slice(10);
}
const normToken = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashToken = (t) => crypto.createHash('sha256').update(normToken(t)).digest('hex');
function randomName() { return ADJ[crypto.randomInt(ADJ.length)] + ' ' + NOUN[crypto.randomInt(NOUN.length)] + ' ' + crypto.randomInt(10, 100); }
function cleanName(raw) {
  const n = String(raw || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 16) return { error: 'Name must be 2–16 characters' };
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(n)) return { error: 'Letters, numbers, spaces and _ . \' - only' };
  if (BLOCKED.test(n.replace(/[^a-z]/gi, ''))) return { error: 'Please pick a different name' };
  return { name: n };
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function createApp(opts = {}) {
  const dbFile = opts.dbFile || process.env.RTB_DB || path.join(__dirname, 'data', 'rtb.sqlite');
  if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const { db, q } = openDb(dbFile);
  const RTB = loadSim(opts.gameFile);
  const pool = opts.pool || new VerifierPool(Number(process.env.RTB_VERIFY_WORKERS) || 1);
  const now = opts.now || (() => Date.now());
  const serveGame = opts.serveGame ?? process.env.RTB_SERVE_GAME !== '0';
  const gameFile = opts.gameFile || path.join(__dirname, '..', 'index.html');
  const allowOrigin = process.env.RTB_ALLOWED_ORIGIN || '*'; // bearer tokens, no cookies, so * is safe
  const trustProxy = opts.trustProxy ?? process.env.RTB_TRUST_PROXY === '1';

  // ---- tiny in-memory rate limiter (per IP, per minute) ----
  const hits = new Map();
  function limit(key, max, windowMs) {
    const t = now(), h = hits.get(key);
    if (!h || t - h.start > windowMs) { hits.set(key, { start: t, n: 1 }); return; }
    if (++h.n > max) throw new HttpError(429, 'Slow down a little');
  }
  setInterval(() => { const t = now(); for (const [k, h] of hits) if (t - h.start > 120000) hits.delete(k); }, 60000).unref();

  const today = () => RTB.dayNumber(now());
  function auth(req, required) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    const p = m ? q.playerByToken.get(hashToken(m[1])) : undefined;
    if (!p && required) throw new HttpError(401, 'Unknown player. Create a profile or check your sync code');
    return p;
  }
  function boardStatus(board, day, playerId) {
    const b = q.myBest.get(board, day, playerId);
    if (!b) return null;
    const { rank } = q.rankOf.get(board, day, b.height, b.height, b.achieved_at);
    return { rank, total: q.count.get(board, day).n, best: b.height, runId: b.run_id };
  }
  const achievementsOf = (p) => { try { return JSON.parse(p.achievements); } catch (e) { return []; } };
  const profile = (p, token) => ({ name: p.name, achievements: achievementsOf(p), ...(token ? { token } : {}) });

  async function readJson(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new HttpError(413, 'Request too large'); chunks.push(c); }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { throw new HttpError(400, 'Invalid JSON'); }
  }

  const routes = {
    'GET /api/health': () => ({ ok: true, day: today(), time: now() }),

    // Create an anonymous profile. The token doubles as the "sync code" for other devices.
    'POST /api/player': async (req, ip) => {
      limit('create:' + ip, 10, 3600000);
      const body = await readJson(req);
      let name = randomName();
      if (body.name) { const c = cleanName(body.name); if (c.error) throw new HttpError(400, c.error); name = c.name; }
      const token = newToken();
      const r = q.insertPlayer.run(hashToken(token), name, now());
      return profile(q.playerById.get(Number(r.lastInsertRowid)), token);
    },
    'GET /api/me': (req) => profile(auth(req, true)),
    'PATCH /api/me': async (req) => {
      const p = auth(req, true), body = await readJson(req);
      const c = cleanName(body.name); if (c.error) throw new HttpError(400, c.error);
      q.renamePlayer.run(c.name, p.id);
      return profile(q.playerById.get(p.id));
    },
    // Achievements are unlocked on the device; the server keeps the union so every device sees them.
    'PUT /api/me/achievements': async (req) => {
      const p = auth(req, true), body = await readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string' && /^[a-z0-9_]{1,32}$/.test(x)) : [];
      const merged = [...new Set([...achievementsOf(p), ...ids])].slice(0, 200).sort();
      q.setAchievements.run(JSON.stringify(merged), p.id);
      return { achievements: merged };
    },

    // Submit a finished run. The server re-simulates the replay and ranks the height it verified.
    'POST /api/runs': async (req, ip) => {
      const p = auth(req, true);
      // verifying a long run costs seconds of CPU, so keep submissions to what a human can produce
      limit('run:' + p.id, 8, 60000); limit('runip:' + ip, 20, 60000);
      const body = await readJson(req);
      const code = String(body.replay || '');
      if (!/^[A-Za-z0-9_-]{8,60000}$/.test(code)) throw new HttpError(400, 'Missing or malformed replay');
      const hash = crypto.createHash('sha256').update(code).digest('hex');
      const dup = q.runByHash.get(hash);
      if (dup && dup.player_id !== p.id) throw new HttpError(409, 'That run was already submitted by someone else');

      let runId, v;
      if (dup) { runId = dup.id; v = q.runById.get(runId); v = { height: v.height, kind: v.kind, day: v.day }; }
      else {
        try { v = await pool.verify(code); } catch (e) { throw new HttpError(422, 'Replay could not be verified: ' + e.message); }
        if (!v.finished) throw new HttpError(422, 'Replay does not end in a fall');
        // daily runs only count on the daily board for today/yesterday (timezones) and the real daily seed
        const dailyOk = v.kind === 'daily' && v.seed === RTB.dailySeed(v.day) && v.day >= today() - 1 && v.day <= today();
        v.kind = dailyOk ? 'daily' : 'endless'; if (!dailyOk) v.day = 0;
        const t = now();
        runId = Number(q.insertRun.run(p.id, v.kind, v.day, v.seed, v.height, v.score, v.bars, v.hops, code, hash, t).lastInsertRowid);
        const boards = [['alltime', 0]]; if (v.kind === 'daily') boards.push(['daily', v.day]);
        for (const [board, day] of boards) {
          const prev = q.best.get(board, day, p.id);
          v['improved_' + board] = !prev || v.height > prev.height;
          if (v['improved_' + board]) q.upsertBest.run(board, day, p.id, runId, v.height, t);
        }
      }
      return {
        runId, height: v.height, score: v.score, bars: v.bars, hops: v.hops,
        alltime: { ...boardStatus('alltime', 0, p.id), improved: !!v.improved_alltime },
        daily: v.kind === 'daily' ? { day: v.day, ...boardStatus('daily', v.day, p.id), improved: !!v.improved_daily } : null,
      };
    },

    'GET /api/leaderboard': (req, ip, url) => {
      const board = url.searchParams.get('board') === 'daily' ? 'daily' : 'alltime';
      const day = board === 'daily' ? Number(url.searchParams.get('day')) || today() : 0;
      const lim = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const me = auth(req, false);
      const entries = q.top.all(board, day, lim).map((r, i) => ({ rank: i + 1, name: r.name, height: r.height, runId: r.run_id, you: !!me && r.player_id === me.id }));
      let mine = null;
      if (me && !entries.some((e) => e.you)) {
        const s = boardStatus(board, day, me.id);
        if (s) mine = { rank: s.rank, name: me.name, height: s.best, runId: s.runId, you: true };
      }
      return { board, day, total: q.count.get(board, day).n, entries, me: mine };
    },
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    // The server can host the game too, so challenge links and the API share one address.
    if (serveGame && req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(gameFile).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    try {
      limit('ip:' + ip, 120, 60000);
      let fn = routes[req.method + ' ' + url.pathname], arg = null;
      const m = /^\/api\/runs\/(\d+)$/.exec(url.pathname);
      if (!fn && m && req.method === 'GET') {
        fn = () => { const r = q.runById.get(Number(m[1])); if (!r) throw new HttpError(404, 'Run not found'); return { runId: r.id, name: r.name, height: r.height, replay: r.replay }; };
      }
      if (!fn) throw new HttpError(404, 'Not found');
      send(200, await fn(req, ip, url, arg));
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      send(e.status || 500, { error: e instanceof HttpError ? e.message : 'Server error' });
    }
  }

  const server = http.createServer(handle);
  server.closeAll = async () => { await new Promise((r) => server.close(r)); await pool.close(); db.close(); };
  return server;
}

module.exports = { createApp, cleanName, newToken, normToken };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  createApp().listen(port, () => console.log('Raising the Bar server on http://localhost:' + port));
}
