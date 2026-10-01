# Android Play Billing and signing

The `playStore` flavor uses Google Play Billing 9.1.0 for the permanent,
non-consumable Supporter cosmetic. The `direct` flavor has no Billing dependency.
Neither flavor offers or launches Stripe/web checkout, even when the hosted web
shop is enabled.

- The asset copy always injects `rtb-platform=android` before scripts run, including
  offline builds without `RTB_API`. `window.RTBAndroid` also exposes `platform()`
  and `supportsWebCheckout()` (always `false`).
- An Android-only content policy blocks frames, forms, objects and base overrides.
- The WebView permits only the bundled game document. It never forwards remote
  URLs, custom payment domains, redirects or intent URLs to an external browser.
  Popups are disabled. Incoming challenge intents still open the bundled game.
- Resource interception blocks Stripe hosts and `/api/shop/checkout`, including
  POST requests which do not invoke the navigation callback. Normal game API
  requests still work.
- The Play product ID has no source-controlled default. It is supplied with
  `RTB_PLAY_SUPPORTER_PRODUCT` (or `-PrtbPlaySupporterProduct`) and must identify a
  one-time INAPP product provisioned separately in Play Console.
- Prices and eligible offers come only from `ProductDetails`; the WebView does not
  invent or cache a price. Pending purchases remain locked.
- The native client queries purchases at connection/foreground and on Restore.
  Purchased tokens are sent over HTTPS to authenticated
  `POST /api/shop/google-play/verify`. A response must explicitly include
  `purchaseVerified: true` and `band:supporter` in `inventory` or `entitlements`.
  Only then does the client acknowledge the non-consumable purchase. Duplicate
  callbacks are coalesced in memory; durable idempotency belongs to the server.
- Account tokens and billing commands cross from the bundled main frame through
  `WebViewCompat.addWebMessageListener`, restricted to the exact
  `https://appassets.androidplatform.net` origin. Sensitive methods are not exposed
  through `addJavascriptInterface`; subframes and untrusted origins are rejected.
- The Play purchase is bound with
  `SHA-256("rtb-play:" + canonicalUsername)`. The backend must derive and compare
  the same obfuscated account ID from the authenticated account and must verify
  package name, exact Play product, purchase state, acknowledgement state, and
  purchase token using the Google Play Developer API. The client never grants an
  entitlement from BillingClient data.
- Refunds and revocations require Real-time Developer Notifications plus backend
  reconciliation. Restore also calls authenticated
  `POST /api/shop/google-play/reconcile`; device purchase queries remain a recovery
  path, not a replacement for server-side lifecycle handling.

## Build variants

`./gradlew assembleDirectDebug` creates a direct-distribution debug APK.
`./gradlew assemblePlayStoreDebug -PrtbApi=https://your-server \
-PrtbPlaySupporterProduct=your.product.id` creates an installable Play-Billing
test APK, but purchases work only when Play installs a build associated with a
configured Play Console app and licensed tester. `assembleDirectInternalTest` and
`assemblePlayStoreInternalTest` create release-like minified test APKs. Debug and
internal-test variants intentionally use the public checked-in key and must never
be uploaded to a production Play track.

`./gradlew bundlePlayStoreRelease` creates the Play Store AAB. All release flavors
require the four private signing settings below; the Play Store release also
requires fixed `RTB_API` and `RTB_PLAY_SUPPORTER_PRODUCT` values:

The Play Store release application ID is the existing Console identity
`com.groves.rtb`. The direct/sideload release stays `com.raisethebar.game` for
compatibility. Debug and internal-test builds use `.debug` and `.internaltest`
suffixes so public-key test artifacts cannot replace either release install.

- `RTB_KEYSTORE_FILE`
- `RTB_KEYSTORE_PASSWORD`
- `RTB_KEY_ALIAS`
- `RTB_KEY_PASSWORD`

The GitHub Android workflow has an opt-in `build_signed_play_release` manual
input. The four signing values must exist only as secrets on the protected
`play-internal` environment: `RTB_KEYSTORE_BASE64`, `RTB_KEYSTORE_PASSWORD`,
`RTB_KEY_ALIAS`, and `RTB_KEY_PASSWORD`. Remove any repository- or
organization-level copies accessible to this repository after adding the
environment secrets; otherwise a workflow changed on another branch could read
those broader secrets without passing the environment gate. `RTB_API` plus
`RTB_PLAY_SUPPORTER_PRODUCT` remain non-secret repository variables.

Configure the environment to allow only the repository's default branch,
require a reviewer, prevent self-review, and disallow administrator bypass. The
workflow also compares `github.ref` with
`github.event.repository.default_branch` before the signing job can start. It
materializes the keystore only in the runner's temporary directory and builds
`bundlePlayStoreRelease`, removes the file even on failure, and never runs for
ordinary pushes or pull requests. Prefer Google Play App Signing with a
separate upload key. Creating that key and adding these secrets are deliberate
owner actions and are not performed by this repository.

After the mandatory first Play Console upload, the same manual workflow can
optionally send the signed AAB only to the internal-testing track with fastlane
and short-lived GitHub OIDC credentials. This publisher identity is separate
from the backend runtime billing identity and is intended to receive no
production, financial, policy, or store-listing permission. See
[Google Play internal publishing](PLAY-PUBLISHING.md).

Release validation rejects missing configuration, missing/unreadable keys, and
the public test certificate even if its keystore has been renamed or copied.
There is no test-key fallback. Keep private keys and passwords out of the repo.
Use `testDirectDebugUnitTest testPlayStoreDebugUnitTest lintDirectDebug
lintPlayStoreDebug` for public-key checks rather than preparing a release build.

## External setup still required

Code integration does not provision or publish anything. Before internal testing:

1. Create the permanent non-consumable product in Play Console and keep it inactive
   until its listing and regional prices are reviewed.
2. Configure the backend's Google Play Developer API service account with only the
   permissions needed to verify/acknowledge this app's products. Do not put its
   credentials in the APK or repository.
3. Configure and test the implemented authenticated verification provider,
   durable idempotent entitlement ledger, account-binding check, RTDN
   refund/revocation processing, and periodic reconciliation against the real API.
4. Accept required Play agreements, configure app signing/upload keys, upload the
   AAB to an internal test track, and test purchase, pending, cancel, reinstall,
   restore, refund, and revocation on licensed physical devices.

There are no subscriptions, consumables, alternative billing, external payment
links, or live transactions in this implementation.

## Verification

`sh android/test-payment-policy.sh` (from the repository root) compiles and runs
49 native URL policy assertions on a plain JDK, without an Android SDK. The server
test suite also verifies the asset marker, wiring and signing guard statically.
Run Android assembly, unit tests and lint on a machine with JDK 17 and Android
SDK 36. Verify the final AAB through Play internal testing on a device, including
localized price, pending/cancel/success callbacks, account switching, duplicate
delivery, restore/reinstall, refund/revocation, external links, POST forms, popups,
restored activity state, and offline/online gameplay. Mock/unit tests do not count
as end-to-end Google Play or backend verification.

Official references checked October 1, 2026:

- https://support.google.com/googleplay/android-developer/answer/11926878
- https://developer.android.com/google/play/billing/integrate
- https://developer.android.com/google/play/billing/deprecation-faq
- https://developer.android.com/google/play/billing/release-notes
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2
- https://developer.android.com/google/play/billing/rtdn-reference
- https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges
