'use strict';
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  achievements TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id),
  kind        TEXT NOT NULL,
  day         INTEGER NOT NULL,
  seed        INTEGER NOT NULL,
  height      REAL NOT NULL,
  score       INTEGER NOT NULL,
  bars        INTEGER NOT NULL,
  hops        INTEGER NOT NULL,
  replay      TEXT NOT NULL,
  replay_hash TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);
-- one row per player per board: their best run. board = 'alltime' (day 0) or 'daily' (day N)
CREATE TABLE IF NOT EXISTS bests (
  board      TEXT NOT NULL,
  day        INTEGER NOT NULL,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  run_id     INTEGER NOT NULL REFERENCES runs(id),
  height     REAL NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (board, day, player_id)
);
CREATE INDEX IF NOT EXISTS bests_rank ON bests (board, day, height DESC, achieved_at);
`;

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const q = {
    insertPlayer: db.prepare('INSERT INTO players (token_hash, name, created_at) VALUES (?, ?, ?)'),
    playerByToken: db.prepare('SELECT id, name, achievements FROM players WHERE token_hash = ?'),
    playerById: db.prepare('SELECT id, name, achievements FROM players WHERE id = ?'),
    renamePlayer: db.prepare('UPDATE players SET name = ? WHERE id = ?'),
    setAchievements: db.prepare('UPDATE players SET achievements = ? WHERE id = ?'),
    runByHash: db.prepare('SELECT id, player_id FROM runs WHERE replay_hash = ?'),
    insertRun: db.prepare(`INSERT INTO runs (player_id, kind, day, seed, height, score, bars, hops, replay, replay_hash, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    runById: db.prepare('SELECT r.id, r.replay, r.height, r.kind, r.day, p.name FROM runs r JOIN players p ON p.id = r.player_id WHERE r.id = ?'),
    best: db.prepare('SELECT height, run_id FROM bests WHERE board = ? AND day = ? AND player_id = ?'),
    upsertBest: db.prepare(`INSERT INTO bests (board, day, player_id, run_id, height, achieved_at) VALUES (?, ?, ?, ?, ?, ?)
                            ON CONFLICT (board, day, player_id) DO UPDATE SET run_id = excluded.run_id, height = excluded.height, achieved_at = excluded.achieved_at`),
    // ties go to whoever got there first
    rankOf: db.prepare(`SELECT COUNT(*) + 1 AS rank FROM bests WHERE board = ? AND day = ? AND (height > ? OR (height = ? AND achieved_at < ?))`),
    count: db.prepare('SELECT COUNT(*) AS n FROM bests WHERE board = ? AND day = ?'),
    top: db.prepare(`SELECT b.player_id, b.run_id, b.height, b.achieved_at, p.name FROM bests b JOIN players p ON p.id = b.player_id
                     WHERE b.board = ? AND b.day = ? ORDER BY b.height DESC, b.achieved_at ASC LIMIT ?`),
    myBest: db.prepare(`SELECT b.player_id, b.run_id, b.height, b.achieved_at, p.name FROM bests b JOIN players p ON p.id = b.player_id
                        WHERE b.board = ? AND b.day = ? AND b.player_id = ?`),
  };
  return { db, q };
}

module.exports = { openDb };
