# Raising the Bar server

Leaderboards, replay verification and cross-device profiles for the game. The web version and the Android app talk to the same server, so your scores and achievements follow you between them.

- **Node22.13+ plus the official Stripe SDK and Google authentication library.** HTTP, SQLite and workers otherwise use Node built-ins. Run `npm ci` before starting. Both payment providers remain disabled by default.
- **Scores are verified, not trusted.** A player uploads their run's replay code, not a height. The server re-runs the replay through the game's own physics, which it loads from `../index.html`, and ranks the height it gets itself. Tampered, unfinished or impossible replays are rejected.
- **It can host the game too.** `GET /` serves `index.html`, so the game, the API and challenge links all share one address.

## Run it

```sh
cd server
npm ci
npm start                 # http://localhost:8787, with the game at /
npm test                  # API tests using real replays
```

Or with Docker, built from the repository root:

```sh
docker build -f server/Dockerfile -t rtb-server .
docker run -p 8787:8787 -v rtb-data:/data rtb-server
```

This runs on any host that can run Node or Docker and keep a small disk (the SQLite file), for example Fly.io, Railway, Render with a persistent disk, or a VPS. Verification costs about 200 ms of CPU per minute of play, so the default of 2 verification workers wants a host with 2 CPU cores. That rules out edge "worker" platforms that cap CPU at around 10 ms per request.

## Railway deployment

The repository-root `Dockerfile` runs the game and API together. In Railway, set the service's **root directory to `/`** and build with the root Dockerfile (remove any static-site build or start command overrides). Attach a persistent volume at `/data` for `RTB_DB=/data/rtb.sqlite`; without it, profiles and scores disappear on redeploy. Set `RTB_TRUST_PROXY=1` for accurate rate limiting behind Railway's proxy. Keep the existing volume if the service already holds player data; do not replace or detach it during migration.

After deployment, check `https://<your-domain>/api/health` returns JSON with `"ok":true`, then load `/` and open the Leaderboard in the game. A Railway 404 at `/api/health` means the domain is still routed to a static deployment or another service. A 200 HTML response there is also incorrect: the game needs the API process. Android releases need `RTB_API` set to this same URL when built.

## Point the game at it

- **Game hosted by this server:** nothing to do. The game uses its own origin automatically.
- **Game hosted elsewhere** (GitHub Pages, itch.io and so on): set the meta tag in `index.html`:
  `<meta name="rtb-api" content="https://your-server.example">`
- **Android direct release:** build with `./gradlew assembleDirectRelease -PrtbApi=https://your-server.example`. A Play release uses `bundlePlayStoreRelease` and additionally requires its Console Product ID; see [Google Play setup](GOOGLE-PLAY.md). In CI, set a repository variable named `RTB_API`.
- **Testing:** in the browser console, `localStorage.rtb_api = 'http://localhost:8787'`, then reload.

If no server is configured, or it can't be reached, the game still works fully. Finished runs wait in a small queue and upload the next time the server is reachable.

## Settings (environment variables)

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8787` | |
| `RTB_DB` | `server/data/rtb.sqlite` | SQLite file. Keep it on a persistent disk |
| `RTB_VERIFY_WORKERS` | `2` | Replay verification threads. Give the server at least 2 CPU cores to match |
| `RTB_SERVE_GAME` | `1` | Set to `0` to serve only the API |
| `RTB_ALLOWED_ORIGIN` | `*` | CORS origin. `*` is safe because auth uses bearer tokens, not cookies |
| `RTB_TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For` |

Stripe and Play variables are intentionally omitted from the general runtime table because partial configuration fails closed. Follow [Stripe setup](PAYMENTS.md) and [Google Play setup](GOOGLE-PLAY.md), and keep all provider credentials in the hosting platform's secret facility.

## API

All endpoints return JSON. Authenticated endpoints need `Authorization: Bearer <sync code or account session>`. Account migration revokes the old sync code. See [accounts/payment API and blockers](PAYMENTS.md).

| | |
| --- | --- |
| `GET /api/health` | `{ ok, day }` |
| `POST /api/player` `{ name? }` | Creates an anonymous profile: `{ token, name, achievements }`. The token is also the **sync code** shown in the game |
| `GET /api/me` 🔒 | Profile. This is also how "link another device" checks a sync code |
| `PATCH /api/me` 🔒 `{ name?, look? }` | Rename (2–16 characters) and/or save the Locker look (`{ hat, jersey, band, back, suit }`) |
| `PUT /api/me/achievements` 🔒 `{ ids }` | Merges allowlisted legacy achievements, never paid inventory |
| `PUT /api/me/upgrades` 🔒 `{ upgrades }` | Saves upgrade levels if the Chalk earned by verified runs covers them (409 if not yet) |
| `POST /api/runs` 🔒 `{ replay }` | Verifies and ranks a run: `{ height, alltime: { rank, total, best, improved }, daily }` |
| `GET /api/leaderboard?board=daily\|alltime&day=N&limit=50` | Top entries, plus your own row if you're outside them (send the token) |
| `GET /api/runs/:id` | A run's replay and its player's look, for watching it or racing its ghost |

## How ranking works

- **All-time:** every verified run counts. Each player's best height is ranked; if two heights tie, whoever reached it first ranks higher.
- **Daily:** only runs on that day's real daily seed count, accepted for today or yesterday to allow for time zones, and only runs played without upgrades.
- **Upgrades:** Chalk is earned only by verified runs (`runs.coins`). A run is rejected if the upgrade levels recorded in its replay cost more than the player's verified runs had earned before it.
- Resubmitting your own run is harmless, because the offline queue retries. A replay that someone else already submitted is rejected.

## Known limits

- **Bots can't be stopped.** Verification proves a run really happened in the game's physics. It can't prove a human played it, so a bot or a perfectly computed input sequence would be accepted. Watch the ▶ replays of top runs if anything looks off.
- **Endless runs can use any seed**, so players could in principle search for friendly ladders. Every ladder follows the same difficulty rules, so the advantage is small.
- **Rate limits** allow each player 8 run submissions a minute (20 per IP address), because verifying a long run takes real CPU. Add workers (`RTB_VERIFY_WORKERS`) if a busy server's queue grows.
- **Names aren't unique.** Profiles are anonymous, and the sync code is the only credential. If someone loses it, they lose access to that profile.
- **Leaderboards are kept per physics version.** Changing the simulation changes how old replays play out, so each `REPLAY_VERSION` (in `index.html`) has its own boards: increasing it starts fresh leaderboards automatically, and the server rejects replays from other versions. Old runs stay in the database but are no longer shown. Increase `REPLAY_VERSION` whenever you change the physics or the ladder generator.
