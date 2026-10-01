# Android release audit: Raising the Bar

Audit date: 2026-10-01. Scope is the Android app that ships the game (`android/` plus the `index.html` asset it copies in, and the leaderboard server only where the app calls it). No app code was changed. iOS, desktop, and the web/server projects were not modified.

This is a production-readiness review for a first Google Play submission. The app is a single-module WebView shell around the browser game. It builds. It is not ready to upload.

## Prioritized findings

### Blocker

1. **`targetSdk` is 35. Play currently requires 36 for a new app.**
   - Where: `android/app/build.gradle` (`compileSdk 35`, `targetSdk 35`). Confirmed in the built release manifest: `targetSdkVersion=35`, `compileSdkVersion=35`, platform name `15`.
   - Why it blocks release: Google Play’s target API policy, effective 31 August 2026, requires new phone/tablet/foldable apps and updates to target Android 16 (API 36) or higher. Today is 1 October 2026, so a new `com.raisethebar.game` upload at API 35 will be rejected. The one-time extension to 1 November 2026 is offered in Play Console to existing impacted apps; a never-published app should not count on it. Source: [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878).
   - Recommended fix: set `compileSdk 35` and `targetSdk` both to **36** in `android/app/build.gradle`. Install `platforms;android-36` (the package exists; it was installed in this environment and not used, because the Gradle file still asks for 35). Android Gradle Plugin 8.9.1 is already the minimum AGP that supports API 36, and Gradle 8.14.3 is new enough. Then retest edge-to-edge (already implemented: `setDecorFitsSystemWindows(false)`, hidden system bars, `viewport-fit=cover`, and `env(safe-area-inset-*)` in `index.html`), the back callback, fold/split-screen resize, and both orientations. Do not add a portrait or landscape lock while doing this. API 36 ignores fixed orientation on large screens (smallest width ≥ 600dp). `android:screenOrientation="fullUser"` is already not a portrait lock; see the Low lint note below.

2. **Every release artifact is signed with a public test key that is committed to the repo.**
   - Where: `android/app/build.gradle` (`signingConfigs.test`, and `release` uses `signingConfigs.findByName('upload') ?: signingConfigs.test`), `android/app/test-signing.keystore`, `android/.gitignore` (the keystore is force-added), `.github/workflows/android.yml` (no `RTB_KEYSTORE_*` secrets).
   - What was built: debug APK, release APK, and release AAB all verify as the same self-signed cert.
     - DN: `CN=Raising the Bar Test, O=Raising the Bar, C=US`
     - Alias `androiddebugkey`, store password `android`, key password `android` (written in the Gradle file)
     - RSA 2048, SHA384withRSA, serial `6f15df60f8c22229`
     - SHA-256: `6E:7F:72:B6:68:C4:48:FF:5E:38:8D:10:89:4E:B4:73:09:87:79:BD:C3:1F:CE:E9:AC:B5:1F:94:4D:C5:F0:CC`
     - SHA-1: `84:26:9B:EF:8C:7C:43:E2:B6:F0:F9:B1:DD:7D:16:B3:D1:25:95:EA`
     - Valid 2026-09-25 through 2054-02-10
   - Release APK signature schemes: v2 yes; v1, v3, v3.1, and v4 no. Debug is debuggable; release is not. The AAB is JAR-signed with the same cert (`jarsigner -verify` exit 0). The “invalid certificate chain” line is the self-signed cert, which Play accepts for an upload key. The problem is that the private key and its password are in the git history.
   - Why it blocks release: new apps must use Play App Signing. The first upload certificate becomes the upload key. Uploading this AAB registers a key that anyone with the repository can use. Key size and expiry (past 22 October 2033) would otherwise be acceptable. Sideload builds from CI are also updatable by anyone who rebuilds with this key.
   - Recommended fix: generate a new upload keystore outside the repo (RSA 2048 or EC P-256, expiry after 2033). Pass it only through `RTB_KEYSTORE_FILE`, `RTB_KEYSTORE_PASSWORD`, `RTB_KEY_ALIAS`, and `RTB_KEY_PASSWORD`. Change the release `signingConfig` so the build fails when those are absent, instead of falling back to `signingConfigs.test`. Keep the test key for debug only. Enroll in Play App Signing on the first upload and never upload an artifact signed by `test-signing.keystore`. After enrollment, Digital Asset Links must use the **app signing** certificate SHA-256 from Play Console, not this test fingerprint.

### High

3. **The release pipeline publishes an APK. Play requires an AAB for a new app.**
   - Where: `.github/workflows/android.yml` runs `assembleDebug assembleRelease` and uploads `app-debug.apk` and `app-release.apk`. README tells players to install `app-release.apk`. There is no `bundleRelease` step.
   - This audit did produce an AAB locally (`bundleRelease` succeeded; 302,582 bytes). The project can emit the right format. CI and the documented artifact do not.
   - Recommended fix: add `bundleRelease` to the workflow, upload `android/app/build/outputs/bundle/release/app-release.aab`, and stop treating the APK as the Play artifact. Sign that AAB with the private upload key from finding 2. Keep a debug APK only for sideload testing.

4. **Shared challenge links will not open the app in the default build.**
   - Where: `android/app/build.gradle` (share host/path), `android/app/src/main/AndroidManifest.xml` (VIEW/BROWSABLE filter), `index.html` `friendUrl()` (around the `new URL('/challenge/' + code, …)` call), `MainActivity.replayCode` / `onNewIntent`.
   - The release manifest baked by this build (no `RTB_API`) is:
     - `android:scheme="https"`
     - `android:host="mtdewwolf.github.io"`
     - `android:pathPrefix="/raise-the-bar/"`
     - no `android:autoVerify`
   - Replay links are `https://mtdewwolf.github.io/raise-the-bar/#r=…`, so the path matches the filter. Friend invite links are built with an absolute path. `new URL('/challenge/ABCDEF123456', 'https://mtdewwolf.github.io/raise-the-bar/')` is `https://mtdewwolf.github.io/challenge/ABCDEF123456`, which does **not** match `pathPrefix="/raise-the-bar/"`. `MainActivity` would accept that path (`/challenge/` + 12 hex digits) if an intent arrived, but the filter never delivers it.
   - From Android 12, an https VIEW filter without `android:autoVerify="true"` and a matching `https://<host>/.well-known/assetlinks.json` does not open the app from a click. Lint reports this as `AppLinkWarning`. A GitHub project site at `/raise-the-bar/` cannot serve `/.well-known/assetlinks.json` at the host root.
   - `onNewIntent` loads the new URL but does not call `setIntent`. After process death Android redelivers the original intent, so a later challenge link can be lost.
   - Recommended fix: serve the game from one https origin you control (the same origin as `RTB_API` is the natural choice). Set `pathPrefix` to `/` (or add an explicit `/challenge` path). Build friend URLs on that origin without stripping a project subpath you still depend on. Add `android:autoVerify="true"`. Publish `assetlinks.json` with package `com.raisethebar.game` and the Play app-signing certificate SHA-256. Call `setIntent(intent)` at the start of `onNewIntent`.

5. **Auto Backup will include the profile credential.**
   - Where: `android/app/src/main/AndroidManifest.xml` has `android:allowBackup="true"` and no `android:fullBackupContent` or `android:dataExtractionRules`. Confirmed on the release binary manifest (`allowBackup=true`).
   - The game stores `rtb_profile` (bearer token that is also the sync code), plus wallet, pending runs, and cosmetics, in `localStorage` on `https://appassets.androidplatform.net`. That data lives in the app WebView directory. Auto Backup includes app-private directories created for the app, and nothing in this manifest excludes the WebView store. A cloud backup or device transfer can restore the account token onto another device.
   - Recommended fix: set `android:allowBackup="false"`, or add backup rules that exclude the WebView data directory (`app_webview`) and any other directory holding the token. Progress is already designed to move with the sync code, so a full backup is the wrong transfer mechanism. This was inferred from the manifest and Android’s backup rules, not from taking a device backup.

6. **The app creates an account and has no way to delete it.**
   - Where: `index.html` calls `POST /api/player` and stores the returned token. `server/server.js` exposes `POST /api/player`, `GET /api/me`, and `PATCH /api/me`. No delete route exists, and the profile UI has no delete control. The Android app ships that page as `assets/index.html`.
   - Play requires apps that let users create an account to offer in-app account deletion and a web deletion URL ([account deletion policy](https://support.google.com/googleplay/android-developer/answer/13327111)). The sync code is the credential for a named profile, scores, achievements, and cosmetics.
   - Recommended fix: add a delete control in the profile panel of `index.html` (it is the file the APK copies) and a server endpoint that deletes the profile and its runs. Put the same deletion URL in the Play Console Data safety / account section. An offline-only build that never sets `RTB_API` does not create a server account; a Play build with leaderboards does.

7. **No privacy policy for the data the Play build will send.**
   - Where: permissions are only `VIBRATE` and `INTERNET` (`AndroidManifest.xml`). There is no privacy-policy URL in the manifest, the WebView UI, or the repo. With `RTB_API` set, the game uploads a display name, bearer token, replays, scores, achievements, cosmetics, and upgrade levels to that server (`index.html` `api()` / `ensureProfile()`).
   - Recommended fix: host a privacy policy and link it from the in-game profile panel and from the Play listing. Complete Data safety: account identifier (sync token), user-generated name, gameplay/score data, stored on device and sent to the developer’s server when online; no ads, no location, no advertising ID. The built APK does not declare `com.google.android.gms.permission.AD_ID` and does not request `com.android.vending.BILLING`. Keep it that way unless those features are actually added.

### Medium

8. **A Play build with an empty API ships a game that cannot reach leaderboards.**
   - Where: `android/app/build.gradle` (`rtbApi` from `-PrtbApi` or `RTB_API`, default `""`), `copyGame` filter, `.github/workflows/android.yml` (`RTB_API: ${{ vars.RTB_API }}`).
   - The release APK from this audit contains `<meta name="rtb-api" content="">`. On the WebView origin the game does not fall back to `location.origin` (`appassets.androidplatform.net` is excluded), so profiles, boards, and friend challenges stay offline. CI only injects a URL if the `RTB_API` repository variable is set. That variable was not visible from this checkout.
   - Recommended fix: make the Play `bundleRelease` pass the production https URL. Fail that build if the URL is missing. If production CORS is tightened (`RTB_ALLOWED_ORIGIN` in `server/server.js`, default `*`), allow `https://appassets.androidplatform.net`. Bearer tokens are sent as headers, not cookies; a reflected `*` works with the current `fetch` calls, and a specific allow-list that omits the WebView origin will break online play only inside the app.

9. **Some in-page invite links never leave the WebView.**
   - Where: `MainActivity` `shouldOverrideUrlLoading` opens non-asset URLs with `ACTION_VIEW` and swallows `ActivityNotFoundException`. There is no `WebChromeClient`. In `index.html`, the WhatsApp link and “Open invite link” use `target="_blank"`. SMS and mailto links do not.
   - WebView does not deliver `target="_blank"` navigations to `shouldOverrideUrlLoading` unless `setSupportMultipleWindows(true)` and `onCreateWindow` are implemented. Those taps can do nothing. `sms:` and `mailto:` depend on a visible handler; with no `<queries>` element, Android 11+ package visibility can make `startActivity` throw, and the catch block ignores it. The native share sheet (`GameBridge.share` → `ACTION_SEND` chooser) is the path that should work, and it does not need a queries declaration.
   - Recommended fix: drop `target="_blank"` so those https links hit `shouldOverrideUrlLoading`, or implement `onCreateWindow` and forward the URL outside. Add `<queries>` intent declarations for `sms` and `mailto` if those links stay. Surface a failure instead of swallowing `ActivityNotFoundException`.

10. **Renderer recovery drops the open challenge and can restart the WebView from inside the crash callback.**
    - Where: `MainActivity.recoverFromRendererLoss` and `onRenderProcessGone`.
    - The reload URL is always `GAME_URL`, with no hash, so a shared challenge or replay is discarded. The first crash replaces the WebView; a second crash within 10 seconds calls `finish()`, which is a reasonable loop guard. `createWebView()` runs directly from `onRenderProcessGone` and calls `setContentView` before `destroy()` on the dead instance. That matches the platform guidance to detach before destroy, but doing it inside the callback can still throw if the view hierarchy is mid-layout.
    - Recommended fix: post the replacement to the next main-thread turn, remove the dead WebView from its parent, then `destroy()`. Reload `gameUrlFor(getIntent())` (after finding 4’s `setIntent` fix) so the challenge survives.

11. **Accessibility of the shipped game UI is below what a production app should meet.**
    - Where: `index.html` viewport `maximum-scale=1, user-scalable=no`; `MainActivity` `setTextZoom(100)` while `configChanges` includes `fontScale`; canvas pause hit box `pauseBtn()` is 48×40 CSS pixels; `.close` is `padding: 4px 12px`; `.lblist button` is `padding: 4px 8px` at 12px type. The climb itself is a canvas with no accessibility node. `configChanges` includes `fontScale`, so the activity does not restart when the user changes font size, and text zoom is then forced to 100%.
    - Recommended fix: allow a modest pinch-zoom on menus (keep `touch-action: none` on the canvas only), stop forcing `textZoom` to 100 or document it as an exception and still scale menu text with `fontScale`, and enlarge close, leaderboard, and pause controls to at least 48×48dp. Canvas gameplay will remain mostly opaque to TalkBack; the menus and pause control should still have names and hit targets. This was reviewed from source, not with TalkBack on a device.

12. **Tests do not cover the release app or the game.**
    - Where: `android/app/src/test/java/com/raisethebar/game/MainActivityTest.java` only. No `androidTest` sources.
    - `testDebugUnitTest` passed: 6 tests, 0 failures, about 13.1s. One test checks `gameUrlFor` for friend and replay URIs. The other launches `MainActivity` under Robolectric at SDK 29, 30, 33, 34, and 35 and walks pause/stop/start/resume, a configuration change, and destroy. Robolectric’s WebView shadow does not run the game, the JS bridge, fold geometry, back-press handling, or R8. Release minify was checked only by reading `mapping.txt`: `GameBridge.share` and `shareBaseUrl` keep those names (class is renamed to `w.f`), which is what `addJavascriptInterface` needs. The keep rule in `android/app/proguard-rules.pro` is doing that job. Nothing executed the release APK.
    - Recommended fix: add tests for the friend-URL versus manifest path, `setIntent`, backup exclusions, and a release build that loads `assets/index.html` and calls `RTBAndroid.shareBaseUrl()`. Add at least one instrumented smoke test on an API 36 image before submission.

13. **There is no crash or ANR reporting.**
    - Where: dependencies in `android/app/build.gradle`. No Crashlytics, Play Integrity, or analytics SDK is present (confirmed by the release APK’s `META-INF/*.version` files and by the absence of those libraries in source).
    - A WebView renderer death is handled locally and then discarded. Play Console will show crashes and ANRs after release, with no symbol upload step and no breadcrumb for which challenge URL was open.
    - Recommended fix: add a crash reporter that does not pull in the advertising ID, and upload the R8 mapping (`app/build/outputs/mapping/release/mapping.txt`, also embedded in the AAB) with each Play release.

### Low

14. **`versionCode` 4 / `versionName` 1.2.0 are hardcoded.**
    - Where: `android/app/build.gradle` `defaultConfig`. Both values are in the release APK (`aapt dump badging`).
    - Recommended fix: confirm Play Console has no draft or internal artifact with versionCode ≥ 4 (including old sideload experiments uploaded by mistake). Bump `versionCode` for every upload. The name `1.2.0` is fine for a first store listing if it matches the notes you publish.

15. **The screen stays on for the whole process, and there is no memory-pressure handler.**
    - Where: `MainActivity.onCreate` sets `FLAG_KEEP_SCREEN_ON` and never clears it. No `onTrimMemory` / `onLowMemory`.
    - The game already pauses on `visibilitychange`, and `onPause` calls `webView.onPause()`, so a backgrounded activity should stop the loop. The flag still holds the screen on whenever the activity is visible, including the menu. Canvas pixels are capped (`sqrt(6e6 / (W*H))`, device pixel ratio at most 3), so a large foldable should stay near 24MB for the bitmap plus the WebView.
    - Recommended fix: clear the keep-screen-on flag when `mode !== 'play'`, if that state is visible to Java, or accept the drain and mention it in the Play battery review. On trim, avoid destroying a running climb; the existing renderer-gone path already reloads.

16. **Lint flags `screenOrientation="fullUser"`.**
    - Where: `AndroidManifest.xml`. Debug lint: `DiscouragedApi` (“Should not restrict activity to fixed orientation”). `fullUser` is orientation value `0xd`, which follows the user’s rotation, including reverse landscape. The activity is `resizeableActivity="true"` and lists the fold/split-screen `configChanges`, so a run is not restarted on resize.
    - Recommended fix: remove the attribute if you want a clean lint, and leave rotation to the default. Do not replace it with `portrait` or `landscape`.

17. **No minimum WebView version check.**
    - Where: `index.html` uses `globalThis`, `Object.fromEntries`, and `Element.replaceChildren` (Chrome 86 for `replaceChildren`). `MainActivity` never reads `WebView.getCurrentWebViewPackage()`.
    - `minSdk` 26 can still be running a years-old System WebView if Play updates were disabled. Current devices in 2026 are far past Chrome 86. The script does not use `?.`, `??`, or `replaceAll`.
    - Recommended fix: if `WebView` package version is below 86, show a screen that sends the user to update Android System WebView instead of loading the game.

18. **Release APKs are v2-signed only.**
    - Where: `apksigner` on `app-release.apk`. Play App Signing re-signs the APKs it generates from the AAB, so this does not block the store. Sideload release APKs cannot rotate keys later (no v3).
    - Recommended fix: once the private upload key exists, enable APK Signature Scheme v3 for any APK you still distribute outside Play. The store path only needs a valid upload signature on the AAB.

19. **`enableOnBackInvokedCallback` is unused below API 33.**
    - Where: manifest attribute, lint `UnusedAttribute`. `onCreate` registers `OnBackInvokedCallback` only when `SDK_INT >= 33`, and `onBackPressed` handles older devices. The attribute is correctly ignored on API 26–32.
    - Recommended fix: optional `tools:targetApi="33"`. No behavior change.

## What passed

| Play / release check | Result |
| --- | --- |
| Debug APK, release APK, release AAB | All three Gradle tasks succeeded with no source changes |
| Unit tests | 6/6 passed (`testDebugUnitTest`) |
| Lint | 0 errors, 4 warnings (the warnings are findings 4, 16, 19, and the expected `SetJavaScriptEnabled` note) |
| AAB format | `bundleRelease` works locally. CI does not run it (finding 3) |
| 64-bit | No `.so` in the debug APK, release APK, or AAB. The 64-bit native-library rule does not apply. ART runs the Java/Kotlin bytecode on 64-bit devices |
| 16 KB pages | No native code to realign. `zipalign -c -v 4` and `zipalign -c -P 16 -v 4` both exited 0 on the release APK. AGP 8.9.1 is above the 8.5.1 packaging floor if native libraries are added later |
| Play Billing | No `com.android.billingclient` dependency and no `com.android.vending.BILLING` permission. The Billing Library 7 cutoff (31 August 2026) and the current 8.x/9.x requirement do not apply. Adding chalk or cosmetics as IAP later means Billing Library 8 or newer (7 is past its new-app deadline; 9.1.0 was current as of mid-2026) |
| Cleartext and debug surface | Release manifest has no `debuggable` and no `usesCleartextTraffic`. Target 35 defaults cleartext to off. `RTB_API` with a non-https scheme fails the build. `setWebContentsDebuggingEnabled` is `BuildConfig.DEBUG` only. `setAllowFileAccess(false)` and `setAllowContentAccess(false)`. No API keys, private keys, or passwords in the release APK strings |
| JS bridge vs R8 | `minifyEnabled true`, `shrinkResources true`. Mapping keeps `share(String,String)` and `shareBaseUrl()` |
| Exported components | One activity, `exported=true`, with MAIN/LAUNCHER and the https VIEW filter. Appropriate |
| Permissions | `VIBRATE`, `INTERNET` only |
| App size | Release APK 183,308 bytes; release AAB 302,582 bytes; debug APK 2,085,058 bytes. Uncompressed release payload 445,555 bytes, of which `assets/index.html` is 188,094 bytes and `classes.dex` is 212,184 bytes. Download size is not a Play problem |
| Large screens | `supports-screens` small through xlarge, any density, resizable activity, density and smallest-width in `configChanges`. Fold half-open posture is sent to `window.rtbSetFold`. Not run on a foldable |
| Signing scheme properties other than secrecy | RSA 2048 and expiry in 2054 meet Play’s technical certificate rules. Secrecy does not (finding 2) |

## Android map

Single Gradle project, one application module.

```
android/
  build.gradle                 AGP 8.9.1
  settings.gradle              :app, Google + Maven Central
  gradle.properties            AndroidX, non-transitive R, -Xmx2048m
  gradle/wrapper/              Gradle 8.14.3
  app/build.gradle             SDK levels, signing, asset copy, dependencies
  app/proguard-rules.pro       keep JavascriptInterface methods
  app/test-signing.keystore    public test key (finding 2)
  app/src/main/AndroidManifest.xml
  app/src/main/java/com/raisethebar/game/MainActivity.java
  app/src/main/res/            adaptive icon, theme, two strings
  app/src/test/.../MainActivityTest.java
.github/workflows/android.yml  debug + release APK, unit test, lint
```

The game is not duplicated. `copyGame` copies `../index.html` into the generated assets directory and, when `RTB_API` / `-PrtbApi` is set, rewrites `<meta name="rtb-api" content="">`. `preBuild` depends on that task. Java source and target are 17. The build ran on JDK 21.0.10 (Temurin/Ubuntu OpenJDK), which AGP 8.9 accepted.

| Setting | Value |
| --- | --- |
| Namespace / applicationId | `com.raisethebar.game` |
| minSdk / targetSdk / compileSdk | 26 / 35 / 35 |
| versionCode / versionName | 4 / 1.2.0 |
| Modules / flavors | `:app` only, no product flavors, no NDK |
| Engine | Android WebView loading `https://appassets.androidplatform.net/assets/index.html` via `androidx.webkit.WebViewAssetLoader` |
| UI toolkit | One full-screen `WebView`. No Compose, no Fragments, no native layouts beyond the theme |
| Direct dependencies | `androidx.webkit:webkit:1.12.1`, `androidx.window:window-java:1.3.0` |
| Test dependencies | JUnit 4.13.2, Robolectric 4.14.1 |
| Transitive versions packed in the release APK | core 1.8.0, lifecycle-runtime 2.3.1, coroutines 1.7.3, annotation-experimental 1.4.1, arch core-runtime 2.1.0, versionedparcelable 1.1.1, window 1.3.0, window-extensions-core 1.0.0 |
| Ads, analytics, IAP, auth SDKs | None |
| Native ABIs | None shipped |

`MainActivity` keeps the screen on, hides system bars, pauses the WebView with the activity, saves WebView state, registers a predictive-back callback on API 33+, and listens to `WindowInfoTracker` for a horizontal half-open fold. `GameBridge` exposes `shareBaseUrl()` and `share()` to JavaScript. External navigations leave the WebView. A dead renderer is replaced once, then the activity finishes if it dies again within 10 seconds.

The release manifest also merges optional `uses-library` entries for `androidx.window.extensions` and `androidx.window.sidecar` (`required=false`), so missing fold OEM libraries do not block install. `extractNativeLibs=false`.

Launcher icon is a vector adaptive icon in `mipmap-anydpi` (foreground, background, monochrome). Densities in the APK are 160 and anydpi (`65534`). That is valid for minSdk 26. The 512×512 Play listing icon is not in the repo; it is uploaded in Play Console.

## Build and test log

Environment for this run: Linux, JDK `21.0.10`, no preinstalled Android SDK. Command-line tools were installed under `$HOME/android-sdk` (not committed): `platforms;android-35`, `platforms;android-36`, `build-tools;35.0.0`.

```bash
export ANDROID_HOME="$HOME/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64"
cd android
chmod +x ./gradlew
./gradlew assembleDebug assembleRelease bundleRelease testDebugUnitTest lint --stacktrace --no-daemon
```

Result: **BUILD SUCCESSFUL in 1m 5s**, 98 tasks, no compilation or test failures. Gradle downloaded `gradle-8.14.3-bin.zip` on first run. Deprecated Gradle features were warned (Gradle 9 incompatibility). No fix was required to make the current sources build.

Follow-up inspection, all against those outputs:

```bash
aapt dump badging app/build/outputs/apk/release/app-release.apk
aapt dump xmltree app/build/outputs/apk/release/app-release.apk AndroidManifest.xml
apksigner verify --print-certs --verbose app-debug.apk
apksigner verify --print-certs --verbose app-release.apk
jarsigner -verify app/build/outputs/bundle/release/app-release.aab
zipalign -c -v 4 app-release.apk
zipalign -c -P 16 -v 4 app-release.apk
unzip -l  # no .so in debug APK, release APK, or AAB
```

| Artifact | Bytes | Notes |
| --- | --- | --- |
| `app/build/outputs/apk/debug/app-debug.apk` | 2,085,058 | debuggable, test key, v2, three dex files |
| `app/build/outputs/apk/release/app-release.apk` | 183,308 | not debuggable, test key, v2, R8 |
| `app/build/outputs/bundle/release/app-release.aab` | 302,582 | test key, R8 mapping embedded |

CI command (not re-run on GitHub from this audit): `./gradlew assembleDebug assembleRelease testDebugUnitTest lint` from `android/` on Temurin 17. It does not build an AAB and does not pass a keystore.

No source change is required to compile, unit-test, or bundle the current tree. The failures that matter are policy and configuration, not the compiler.

## Play requirement summary

| Requirement | Status on 2026-10-01 |
| --- | --- |
| Target API 36 for a new phone/tablet app | Fail. Built artifacts target 35 (Blocker 1) |
| Android App Bundle | Task works; the workflow that produces the release file does not (High 3) |
| Play App Signing, private upload key | Not ready. Release falls back to the committed test key (Blocker 2) |
| 64-bit | Pass. No native libraries |
| 16 KB page size | Pass for this binary. No `.so` files. Re-check if a native SDK is added |
| Play Billing library | Not used. Requirement does not apply |
| Account deletion, privacy policy, Data safety | Missing for a build that enables the leaderboard server (High 6 and 7) |

## What this audit could not verify

- Install, cold start, gameplay, pause/back, share sheet, haptics, audio, or offline/online leaderboards on a real device or emulator. `/dev/kvm` exists here, but no system image was installed and there are no instrumented tests to run. Robolectric does not execute the WebView game.
- Frame time, ANRs, memory, and battery on phone, tablet, small display, or a Galaxy Z Fold (cover, inner, and tabletop flex).
- TalkBack, font scale, and display-size behavior on device.
- Whether `target="_blank"` and `sms:`/`mailto:` actually fail on a current WebView (code-path review only).
- A backup/restore proving the sync token is in the backup set.
- That `https://mtdewwolf.github.io/.well-known/assetlinks.json` is absent in production, beyond the repo containing no assetlinks file and the manifest having no `autoVerify`.
- Play Console state: applicationId availability, existing versionCodes, Data safety, content rating (the game has optional cartoon blood), privacy URL, and the app-signing certificate Google would generate.
- The value of the GitHub Actions repository variable `RTB_API`.
- Behavior after changing `targetSdk` to 36. The platform package is installable; the Gradle file was left at 35 so this audit would not change the app.
- Server deployment CORS and TLS for the production host. The in-repo server allows `*` unless `RTB_ALLOWED_ORIGIN` is set.
