# Classic gameplay recovery: test results

Tested 2026-09-30 in the cloud workspace with Node 24.19.0.

## Implemented

- Restored the pre-PR10 simulation and original visual baseline from `be8e455bd5c6535706243b3d3f4f4fb04403747b`.
- Opening gaps are 0.55m instead of 0.28m; immediate pulling, the two-arm bonus, release impulse, Spring Hop, classic catch forgiveness and release cue are restored together.
- Weekly events, friend challenges, direct invites/QR, profile sync, cosmetics, upgrades and other pre-existing features remain.
- New replay versions 6/7 isolate the recovery from older physics. Local records and public boards remain versioned; older runs are never reinterpreted.
- Legacy challenges remain outdated even when expired. Rematches no longer reuse an outdated still-open child challenge.

## Passed

- `cd server && npm test`: **29/29**, independently rerun by a second reviewer
- Physics regression checks: wider opening gaps and assisted weekly spacing; immediate force/two-arm bonus; release cue within 20–30 simulation steps; short-pull hop and upgraded Spring Hop; rejection of legacy versions 1–5; coached multi-bar climbs with exact replay verification
- API, rankings, malformed/forged replay rejection, profile/upgrades, all three weekly modes, friend lifecycle/rematches, invite previews and QR
- Migration regression: legacy boards excluded, old rows and earned Chalk retained, profile/cosmetics/achievements/Spring levels preserved, expired legacy challenges stay outdated and rematches use compatible versions
- Additional baseline comparison: identical complete game state across **32 scenarios**, 1,200 steps each, using four seeds, normal/all three weekly modes, and base/upgraded loadouts
- All server and test JavaScript passed `node --check`; the complete inline game script parsed successfully
- `git diff --check`

## Not verified

- Interactive browser play and visual screenshots: the browser route to the local preview was blocked (`ERR_BLOCKED_BY_CLIENT`). No alternate transport was used to bypass it. Code comparison confirms visual code is unchanged from the requested earlier baseline, but this is not hands-on playtesting.
- Android APK assembly, unit tests and lint: `GRADLE_USER_HOME=/tmp/rtb-gradle ./gradlew assembleDebug assembleRelease testDebugUnitTest lint` stopped before compilation while fetching the official Gradle 8.14.3 distribution (`Network is unreachable`). No Android SDK was available in the inspected standard locations/environment. No APK was built.
- Remote CI, publication and deployment: not run; work remains local as requested.

## Run locally

Use Node >=22.13, then `cd server && npm test` and `npm start`. Open the printed localhost address for manual playtesting. The web game is a single HTML file with no asset compilation step; the server has no npm dependencies.
