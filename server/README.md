# Raising the Bar server

Leaderboards, replay verification and cross-device profiles for the game. The web version and the Android app talk to the same server, so your scores and achievements follow you between them.

- **No dependencies.** Plain Node 22.13+, using the built-in `node:http`, `node:sqlite` and `worker_threads`. Nothing to `npm install`.
- **Scores are verified, not trusted.** A player uploads their run's replay code, not a height. The server re-runs the replay through the game's own physics, which it loads from `../index.html`, and ranks the height it gets itself. Tampered, unfinished or impossible replays are rejected.
- **It can host the game too.** `GET /` serves `index.html`, so the game, the API and challenge links all share one address.

## Run it

```sh
cd server
npm start                 # http://localhost:8787, with the game at /
npm test                  # API tests using real replays
```

Or with Docker, built from the repository root:

```sh
docker build -f server/Dockerfile -t rtb-server .
docker run -p 8787:8787 -v rtb-data:/data rtb-server
```

This runs on any host that can run Node or Docker and keep a small disk (the SQLite file), for example Fly.io, Railway, Render with a persistent disk, or a VPS. Verification costs about 200 ms of CPU per minute of play, which rules out edge "worker" platforms that cap CPU at around 10 ms per request.

## Point the game at it

- **Game hosted by this server:** nothing to do. The game uses its own origin automatically.
- **Game hosted elsewhere** (GitHub Pages, itch.io and so on): set the meta tag in `index.html`:
  `<meta name="rtb-api" content="https://your-server.example">`
- **Android:** build with `./gradlew assembleRelease -PrtbApi=https://your-server.example`. In CI, set a repository variable named `RTB_API`.
- **Testing:** in the browser console, `localStorage.rtb_api = 'http://localhost:8787'`, then reload.

If no server is configured, or it can't be reached, the game still works fully. Finished runs wait in a small queue and upload the next time the server is reachable.

## Settings (environment variables)

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8787` | |
| `RTB_DB` | `server/data/rtb.sqlite` | SQLite file. Keep it on a persistent disk |
| `RTB_VERIFY_WORKERS` | `1` | Replay verification threads |
| `RTB_SERVE_GAME` | `1` | Set to `0` to serve only the API |
| `RTB_ALLOWED_ORIGIN` | `*` | CORS origin. `*` is safe because auth uses bearer tokens, not cookies |
| `RTB_TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For` |

## API

All endpoints return JSON. Authenticated endpoints need `Authorization: Bearer <sync code>`.

| | |
| --- | --- |
| `GET /api/health` | `{ ok, day }` |
| `POST /api/player` `{ name? }` | Creates an anonymous profile: `{ token, name, achievements }`. The token is also the **sync code** shown in the game |
| `GET /api/me` 🔒 | Profile. This is also how "link another device" checks a sync code |
| `PATCH /api/me` 🔒 `{ name }` | Rename (2–16 characters) |
| `PUT /api/me/achievements` 🔒 `{ ids }` | Merges achievements and returns the combined list |
| `POST /api/runs` 🔒 `{ replay }` | Verifies and ranks a run: `{ height, alltime: { rank, total, best, improved }, daily }` |
| `GET /api/leaderboard?board=daily\|alltime&day=N&limit=50` | Top entries, plus your own row if you're outside them (send the token) |
| `GET /api/runs/:id` | A run's replay, for watching it or racing its ghost |

## How ranking works

- **All-time:** every verified run counts. Each player's best height is ranked; if two heights tie, whoever reached it first ranks higher.
- **Daily:** only runs on that day's real daily seed count, accepted for today or yesterday to allow for time zones.
- Resubmitting your own run is harmless, because the offline queue retries. A replay that someone else already submitted is rejected.

## Known limits

- **Bots can't be stopped.** Verification proves a run really happened in the game's physics. It can't prove a human played it, so a bot or a perfectly computed input sequence would be accepted. Watch the ▶ replays of top runs if anything looks off.
- **Endless runs can use any seed**, so players could in principle search for friendly ladders. Every ladder follows the same difficulty rules, so the advantage is small.
- **Rate limits** allow each player 8 run submissions a minute (20 per IP address), because verifying a long run takes real CPU. Add workers (`RTB_VERIFY_WORKERS`) if a busy server's queue grows.
- **Names aren't unique.** Profiles are anonymous, and the sync code is the only credential. If someone loses it, they lose access to that profile.
- **A physics change affects ranked runs.** Changing the simulation changes how old replays play out, so existing verified runs would no longer reproduce. If you change the physics, increase `REPLAY_VERSION` in `index.html` and start a fresh database (or keep the old rankings frozen).
