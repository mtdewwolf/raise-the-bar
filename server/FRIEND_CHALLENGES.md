# Friend challenges

- Open **Challenge friends**, choose a ladder, and create a 24-hour challenge; or use **Challenge your friends** after a finished run.
- Share the invite link or the 12-character join code. Players can preview before joining and use their existing anonymous profile. Codes are bearer invitations: anyone with the code may view and join (up to 50 players).
- All participants play without upgrades. Sharing an upgraded run prompts a new equal-rules challenge instead of reusing that score.
- Best verified height wins; exact ties at the server's two-decimal precision share a rank. Retry as often as you want before the deadline.
- Challenge attempts have separate storage and do not award Chalk or alter public boards. Event rules are pinned to the original day/week even across a reset.
- Pending uploads are saved on the device and retried on reconnect or with **Retry saved results**. The server must receive and finish verifying new submissions before the deadline; already accepted attempts may be retried safely after expiry.
- Rematches start a fresh 24-hour scoreboard. Endless uses a new ladder; daily/weekly retains the original challenge's rules. Other participants join the new invite; the old board links to rematches.
- Replay verification checks physics and results, not human authorship. This is a casual challenge feature, not a cheat-proof tournament system.

## Isolated test site

Deploy this branch as a separate Railway service with its own database. Set `RTB_CHALLENGE_DEMO=1` only on that service. Never point it at the live service's database.

**Load mock challenge** creates a challenge owned by your current test profile with two labeled mock opponents. Their scores come from real scripted physics replays. Race their ghosts, use **Mock friend takes a turn**, then **Finish mock challenge** to inspect final standings and rematches. These controls are restricted to the creator of a mock challenge. All mock endpoints are disabled by default.

Open an invite in a private browser window or on a second device to test a separate real participant. Rename each profile in the challenge screen. The test service's SQLite data resets on redeployment unless a dedicated volume is attached; use a fresh mock challenge after a reset. Production requires a persistent volume as with the existing leaderboard service.

Android builds use `RTB_API` (or `-PrtbApi`) as the share-link host when configured. Both `#c=<code>` and legacy `#r=<replay>` links are understood. Build a test APK with the test server URL to keep app testing isolated. Android may ask users which app to open; verified app links require a separately configured owned domain and assetlinks.json.

## API

Authenticated routes use the existing profile bearer token, never an invite code as a profile credential.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/challenges` | Latest 50 joined/created challenges |
| POST | `/api/challenges` | Create from `{kind}` or a finished `{replay}` |
| GET | `/api/challenges/:code` | Invite, pinned rules, best results and ghost replays |
| POST | `/api/challenges/:code/join` | Idempotently join |
| POST | `/api/challenges/:code/attempts` | Verify `{replay}` and update standings |
| POST | `/api/challenges/:code/rematch` | New challenge; safe to retry while rematch is active |
| POST | `/api/challenges/demo` | Test-only mock challenge |
| POST | `/api/challenges/:code/mock-turn` | Test-only mock opponent |
| POST | `/api/challenges/:code/finish` | Test-only early finish |

Run regression coverage with `bun run --cwd server test` (Bun task runner, Node 22+ runtime for the existing `node:sqlite` server).
