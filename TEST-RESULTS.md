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

## Stripe and Google Play payment foundation - 2026-10-01

Current implementation is on `feat/payment-foundation` / PR13. The Stripe hardening checkpoint `c2c1cd0` was pushed and its exact GitHub server/Android/security checks passed before the Play integration was added.

Fresh verification:
- Clean lockfile install (`npm ci`) succeeded; full Node suite **61/61 passing**
- Stripe Node SDK remains pinned at22.6.2 and API `2026-08-26.dahlia`; real SDK raw-body signature/timestamp handling is exercised with synthetic offline fixtures only
- Reusable configured sandbox Price/Product identity, amount and currency fail closed; `rk_test_` and `sk_test_` are accepted while live keys are rejected
- Dynamic payment methods, stable per-order integration labels/idempotency, delayed `processing` state, authenticated refresh, async success/failure, duplicate/concurrent retries, terminal refunds/disputes and source-aware ownership are covered
- Play backend adapter covers ProductPurchaseV2 state/product/package/account binding, globally unique token ownership, transactional grant-before-acknowledge, durable acknowledgement retry, authenticated/deduplicated RTDN, periodic reconciliation and source-specific revocation
- Android targets API36, uses Billing9.1.0 only in the `playStore` flavor, and keeps the `direct` flavor Billing-free. The Play release ID is `com.groves.rtb`; the direct release retains `com.raisethebar.game`, while debug/internal-test IDs are suffixed to avoid replacing either release install. After the final origin-channel refactor, both debug APKs, both minified internal-test APKs and the Play internal-test AAB built; both flavor unit suites and debug/internal-test lints passed
- Android standalone Java navigation policy **49 assertions passed**. Sensitive purchase/account messages use an exact-origin, main-frame-only WebMessage channel; Stripe checkout remains blocked in every Android flavor
- Release/AAB signing and Play configuration checks fail closed when private signing/backend/Product configuration is absent
- Reproducible DOM-state tests cover account interruption/owner isolation and the delayed-payment UI before redirect parsing
- Pure simulation/physics were not modified; `git diff --check` passed

Storage evidence:
- Railway volume `e6871e4c-f37e-4f7c-8093-de84eb45da2a` is mounted at `/data`
- It was restored from an integrity/hash-verified export, and a normal redeploy retained the expected records on2026-09-30
- A private manual PC snapshot exists. The operator declined Railway's paid scheduled-backup option, so automated off-site backup/restore drills remain an operational gap

Still unverified/blocked:
- Real Stripe sandbox Checkout/webhook/refund flow: no authorized credential was configured and no transaction was made
- Real Play Console/internal-track/device flow: no Product, service account, Pub/Sub subscription, signing key, upload, license-tester purchase, refund or revocation was created/performed
- Payment-specific persistence across a live provider flow, missed-notification recovery against the real APIs, and full mobile visual/accessibility QA
- Play account-deletion request UX/public web resource, privacy/Data Safety declarations, agreements, support/refund/tax/legal decisions and any applicable closed-test eligibility requirement
- Production launch: live Stripe mode is rejected; no deployment, real charge, secret creation/entry or external provider configuration occurred

See `server/PAYMENTS.md`, `server/GOOGLE-PLAY.md` and `android/PAYMENT-SAFETY.md` for operational requirements.
