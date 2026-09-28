# Weekly events

Weekly ladders rotate automatically every Monday at 00:00 UTC. No scheduler, cron job,
database migration, or destructive deletion is needed. Each Monday day number selects
a deterministic seed, a modifier, and its own leaderboard partition.

Starting September 28, 2026 the repeating rotation is:

1. **Butter Bars:** golden slippery bars, 70% normal grip capacity, +4 stamina drain
   per gripping hand per second.
2. **Low Gravity:** 55% of the usual zone gravity from the first bar.
3. **One Hand Only:** the left hand alone pulls and catches; either keyboard key or
   touch pad controls it. The arm has double normal single-arm pulling strength and
   bar gaps are 20% closer so the event remains climbable.

Everyone plays without upgrades. Weekly heights never enter daily or all-time boards,
including local all-time bests. Coins are still earned through verified weekly runs.

## Player flow

The menu shows the current event, its rules, a countdown, and the local weekly best.
Press W or tap Play weekly event. Retry starts the currently active week.
Personal ghosts, shared challenges, leaderboard ghosts, and replay playback all retain
the original week's modifier. Local weekly bests are saved per week and replay version.
The leaderboard has a This week tab, and finished runs display their weekly rank.

Online clients use the health endpoint's server time to correct their clock. The menu
and open weekly leaderboard roll over without reloading the page. A run keeps the rules
it started with across rollover. New submissions must reach verification before that
week ends; expired/future runs are rejected with an explanation, not moved to all-time.
An already accepted submission remains safe to retry after rollover. Old boards and
replays stay readable; racing an old weekly ghost is practice and cannot rank in the
current event.

## API and compatibility

- GET /api/events/weekly returns id, name, description, day (Monday day number),
  seed, startsAt, endsAt, and server time (timestamps in milliseconds).
- GET /api/leaderboard?board=weekly defaults to the current week.
  An explicit &day=N can retrieve an archived Monday period.
- POST /api/runs uses the existing replay submission and verification pipeline.
  Its weekly response contains event metadata, rank, total, best, runId and improved.
  Its alltime and daily fields are null for weekly submissions.

Weekly runs use replay version 3 and board key weekly@v3. Endless and daily runs retain
their version 2 format, physics, queued replays, and boards. An older server rejects v3
runs instead of accidentally ranking modified physics as endless. Deploy the server
and game together; Android packages copy index.html at build time and need a rebuild.

Keep the weekly rotation order and rules stable. Future changes to weekly physics need
their own replay version and board namespace, just as normal physics changes do.

## Verification

From server/: bun run test (Bun invokes the established Node 22 SQLite test runner).
weekly.test.js covers UTC rollover, year/DST boundaries, rotation, physics/replay
agreement, one-hand enforcement, board isolation, duplicate submissions, archived boards,
and rejection of invalid seeds, upgrades and periods.
