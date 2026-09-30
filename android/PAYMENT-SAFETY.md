# Android payment gate and signing

Native Play Billing is not implemented. Android builds must not offer or launch
web checkout, even when the hosted web shop is enabled.

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
- This is a temporary product capability gate, not a native billing integration.
  Server-side purchase verification, acknowledgement and entitlement handling must
  be implemented and tested before Android purchases can be enabled.

## Build variants

`./gradlew assembleDebug` creates a debug APK. `./gradlew assembleInternalTest`
creates a release-like minified APK with a `(Test)` launcher name and
`-internal-test` version suffix. Both intentionally use the public checked-in
test key. The test APK is at
`app/build/outputs/apk/internalTest/app-internalTest.apk`. It retains the existing
application ID to update older test builds without discarding their local saves.
These APKs are for testing only and must not be published as production builds.

`./gradlew assembleRelease` and `bundleRelease` require all four private signing
settings, provided locally as Gradle properties or environment variables:

- `RTB_KEYSTORE_FILE`
- `RTB_KEYSTORE_PASSWORD`
- `RTB_KEY_ALIAS`
- `RTB_KEY_PASSWORD`

Release validation rejects missing configuration, missing/unreadable keys, and
the public test certificate even if its keystore has been renamed or copied.
There is no test-key fallback. Keep private keys and passwords out of the repo.
Lint/test checks for public-key builds should target
`lintDebug lintInternalTest testDebugUnitTest` rather than implicitly preparing a
release build.

## Verification

`sh android/test-payment-policy.sh` (from the repository root) compiles and runs
49 native URL policy assertions on a plain JDK, without an Android SDK. The server
test suite also verifies the asset marker, wiring and signing guard statically.
Run Android assembly, unit tests and lint on a machine with JDK 17 and Android
SDK 35. Verify the final APK on a device, including external links, POST forms,
popups, restored activity state, and offline/online gameplay.
