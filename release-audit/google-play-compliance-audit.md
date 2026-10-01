# Google Play compliance audit — Raising the Bar (Android)

**Audit date:** 1 October 2026  
**Scope:** Android package only (`android/`, plus `index.html`, which the Android build copies into the APK). Other platforms were not audited except where the Android app sends data to the first-party leaderboard server (`server/`), because that transmission is part of what the Play Data safety form must describe.  
**App identity in the repo:** `com.raisethebar.game`, versionName `1.2.0`, versionCode `4`, minSdk 26, targetSdk **35**, compileSdk 35.  
**This is an audit.** No app code was changed.

**Policy sources retrieved 1 October 2026**

| Instrument | Where it was read |
| --- | --- |
| Google Play Developer Program Policies | [Play Console Help, Developer Program Policy](https://support.google.com/googleplay/android-developer/answer/17517561) |
| Google Play Developer Distribution Agreement, effective 15 September 2025 | [play.google.com/about/developer-distribution-agreement.html](https://play.google.com/about/developer-distribution-agreement.html) |
| Target API level requirements | [Play Console Help 11926878](https://support.google.com/googleplay/android-developer/answer/11926878) |
| Data safety form | [Play Console Help 10787469](https://support.google.com/googleplay/android-developer/answer/10787469) |
| Account deletion | [Play Console Help 13327111](https://support.google.com/googleplay/android-developer/answer/13327111) |
| Families policy and target audience | [9893335](https://support.google.com/googleplay/android-developer/answer/9893335), [9867159](https://support.google.com/googleplay/android-developer/answer/9867159) |
| Content ratings | [9898843](https://support.google.com/googleplay/android-developer/answer/9898843) |
| App bundles and technical quality (64-bit / 16 KB) | [9859152](https://support.google.com/googleplay/android-developer/answer/9859152), [17492799](https://support.google.com/googleplay/android-developer/answer/17492799), [Android 16 KB page-size guide](https://developer.android.com/guide/practices/page-sizes) |

Every finding below names the policy. Developer Distribution Agreement sections are cited as **DDA**.

## Release configuration this audit uses

The Gradle default leaves the leaderboard URL empty (`android/app/build.gradle`, `rtbApi`). With that default, the installed app does not create a server profile. The product described in `README.md` (profiles, leaderboards, friend challenges) is enabled by building with `RTB_API` / `-PrtbApi`, which the Android workflow already forwards from the `RTB_API` repository variable (`.github/workflows/android.yml`).

Findings marked **Online release** apply when that URL is baked into the store build. Findings marked **Every release** apply even if the store build stays permanently offline. A Play listing must match the binary that is actually uploaded. Data safety answers must describe every version distributed under this package name.

---

## Prioritized findings

### Blocker

#### B1. New-app target API is 35; Play requires 36

**Every release.**

`android/app/build.gradle` sets `targetSdk 35` and `compileSdk 35`. This package is not published on Google Play, so it is a **new app**.

**Policy:** Google Play's Target API Level Policy, and [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878), retrieved 1 October 2026: “Starting August 31, 2026: New apps and app updates must target Android 16 (API level 36) or higher to be submitted to Google Play.” An extension to 1 November 2026 is described for apps that are already out of compliance and receive a Play Console form. It is not a reason to submit a new app at API 35.

**Fix:** Raise `compileSdk` and `targetSdk` to 36, rebuild, and retest immersive mode, back handling, WebView, and fold layout on Android 16 before upload. Do not submit the current API 35 binary.

#### B2. No privacy policy in the app or the repository

**Every release.**

There is no privacy-policy URL, in-app privacy screen, or policy document anywhere in the repo. `index.html` and `android/app/src/main/res/values/strings.xml` contain no privacy link. Play Console has nowhere in this repo to point at.

**Policy:** Developer Program Policy, **Privacy Policy** (under User Data): “All apps must post a privacy policy link in the designated field within Play Console, and a privacy policy link or text within the app itself.” The same section says apps that do not access personal or sensitive user data must still submit a privacy policy. The policy must be a public, non-geofenced, non-PDF URL, labeled as a privacy policy, name the app or the developer shown on the store listing, and cover contact, data types, sharing, security, retention, and deletion. **DDA 4.8** requires a legally adequate privacy notice when users provide, or the product accesses, personal information, and requires that information to be stored securely and only as long as needed.

**Fix:** Publish an HTML privacy policy at a stable HTTPS URL. Link it from the game menu (visible without creating a profile) and paste the same URL into Play Console. The policy text must match the Data safety draft in this report for the build you actually ship. Include a contact method and, for the online release, the deletion steps in B3.

#### B3. Online profiles cannot be deleted

**Online release.**

Finishing a run while a server is configured calls `ensureProfile()` and `POST /api/player` (`index.html`). The server stores a token hash, display name, achievements, locker look, upgrades, runs, and challenge membership (`server/db.js`, `server/challenges.js`). There is no delete-account control in the game and no delete route on the server. Clearing local data leaves the server profile in place. The sync code is the only credential (`server/README.md`).

**Policy:** Developer Program Policy, **Account Deletion Requirement**: if the app lets users create an account inside the app, users must have a readily discoverable in-app way to request deletion and a web page where they can request the same thing without reinstalling. The web URL goes in the Data safety form. Deletion must remove the account and associated user data. Freezing the account does not qualify. [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111) say the same, and note that accounts created and used only offline are outside this requirement. These profiles are created on the server. **DDA 4.8** limits storage to as long as the information is needed.

**Fix:** Add a server operation that deletes the player row and dependent runs, bests, and challenge rows, and invalidates the token. Expose it from the profile UI with a clear “Delete account” label, and publish a web form that accepts the sync code (or another proof of control) and performs the same deletion. Put that URL in the Data safety deletion field and describe retention, if any, in the privacy policy. Do not ship the online build until both paths work.

#### B4. Public display names are user-generated content without the required safeguards

**Online release.**

Players can set a 2–16 character name (`index.html` name fields; `cleanName` in `server/server.js`). That name is shown on leaderboards and friend challenge boards to other players. A short server-side word list blocks some profanity. The app does not:

- ask the user to accept terms before the name is saved or shown
- define objectionable content in terms the user must accept
- offer in-app report or block
- give a moderator a queue or a removal tool

The filter strips non-letters before matching, so some obfuscations still fail to match the short list, and there is no report path when a name gets through.

**Policy:** Developer Program Policy, **User Generated Content**. UGC is content users contribute that at least some other users can see. Apps that contain UGC must require acceptance of terms that prohibit objectionable content, moderate in a way that fits the UGC, provide in-app reporting and blocking, and act on reports. Publicly accessible UGC specifically requires in-app report and block. The same policy points at the **Content Ratings** policy for accurate UGC answers. **Bullying and Harassment** prohibits apps that contain or facilitate threats, harassment, or bullying.

**Fix:** Before the first name save or automatic profile creation, require an affirmative accept of terms that ban harassment, hate, and sexual content involving minors. Add “Report name” on leaderboard and challenge rows and a block that hides that player’s name locally. Store reports and remove or rename violating profiles. Keep the filter as a backstop, not as the moderation system. Answer the content-rating questionnaire to say that users can share names with other users.

#### B5. The release build is an APK signed with a public test key

**Every release.**

`.github/workflows/android.yml` runs `assembleRelease` and uploads `app-release.apk`. `android/app/build.gradle` signs release with the upload keystore only when `RTB_KEYSTORE_FILE` is set; otherwise it uses `android/app/test-signing.keystore` (passwords are the well-known `android` / `androiddebugkey` values, and `.gitignore` forces that keystore to stay in git). `README.md` already says that key must not be used for Play.

**Policy:** [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152): Google Play uses Android App Bundles and generates device APKs from the bundle. New apps are submitted as bundles, enrolled in Play App Signing. **DDA 4.1** requires the product to adhere to Developer Program Policies. **DDA 4.8** and the **User Data** policy require personal and sensitive data (here, the profile token, once online) to be handled securely. Publishing an upload key whose private key is in a public repository lets anyone produce an update Play would accept as coming from you.

**Fix:** Generate a new upload key that has never been committed. Enroll the Play app in Play App Signing. Change the release build type so it fails when the upload keystore is missing, instead of falling back to `signingConfigs.test`. Add a `bundleRelease` task (or equivalent) and upload the `.aab`, not the APK artifact, to Play Console.

#### B6. Online data collection has no in-app disclosure that matches what must be declared

**Online release.**

When `RTB_API` is set, the first successful health check marks the app online. The menu then says runs go on the leaderboards. The next finished run creates a profile and uploads the replay with no separate accept control (`ensureProfile`, `flushRuns` in `index.html`). The upload includes the bearer token, display name, replay, height, upgrades, and later achievements and locker selections.

**Policy:** Developer Program Policy, **User Data** and **Data safety section**: collection, use, and sharing must be disclosed, limited to purposes the user can reasonably expect, and kept consistent between the privacy policy and the Data safety form. **Personal and Sensitive User Data** includes personally identifiable information and authentication information, must be transmitted with modern cryptography, and must not be sold. **DDA 4.8** and **DDA 11.4** require the notice to be adequate and the information given to Google and users to be accurate. The Data safety help article defines “collect” as transmitting data off the device, including from a WebView whose code the app controls. This WebView loads packaged `index.html` and that page calls the developer’s API, so those calls are collection by the app.

HTTPS is required for `RTB_API` at build time (`android/app/build.gradle`), which satisfies encryption in transit for that URL. The missing piece is the disclosure and the user’s chance to decline before the first `POST`.

**Fix:** On first online session, show an in-app notice that states the app sends display name, account/sync code, scores, replays, achievements, and cosmetic choices to the developer’s server to run leaderboards and challenges, then require an explicit accept before `POST /api/player`. Link the privacy policy from that notice. Complete Data safety with the draft below. A form that says the app collects nothing would violate the Data safety section policy for this build.

### High

#### H1. The profile credential is stored in WebView local storage, and backup is allowed

**Online release.**

The profile `{ token, name }` is written to `localStorage` key `rtb_profile` (`index.html`). `AndroidManifest.xml` sets `android:allowBackup="true"` and does not set `fullBackupContent` or `dataExtractionRules` to exclude WebView storage. The token is the bearer secret and the sync code (`server/server.js`). The UI tells the player that anyone with the code can play as them. There is no server-side revoke short of a deletion API that does not exist (B3).

**Policy:** **User Data**, Personal and Sensitive User Data: handle authentication information securely, including modern cryptography for data in transit. **DDA 4.8**: if the product stores personal or sensitive information, store it securely and only as long as needed. **Mobile Unwanted Software**: do not collect or transmit private information without the user’s knowledge or without secure handling.

**Fix:** Keep the token out of Auto Backup (backup rules that exclude WebView / `localStorage`, or `android:allowBackup="false"` until those rules exist). Prefer Android Keystore or encrypted storage for the token on device. After B3 exists, add “Sign out on this device” (local only) and “Revoke sync code” (server rotates the token). Transport is already HTTPS when `RTB_API` is set; do not add a cleartext override.

#### H2. Declaring “no data collected” would be false for the online build

**Online release.** This is the Play Console half of B6.

Nothing in the repo fills out Data safety. The online app collects the types in the draft below. AndroidX dependencies do not add a separate ad or analytics pipeline (see SDK section).

**Policy:** **Data safety section**: every app needs a clear, accurate, up-to-date Data safety section, including data handled by libraries and SDKs, consistent with the privacy policy. The developer is responsible for the label.

**Fix:** Enter the draft in this report in Play Console for the build you ship. If you later ship an offline-only track and an online track under the same package name, the form must cover the sum of both ([Data safety help](https://support.google.com/googleplay/android-developer/answer/10787469): one global form per package name).

### Medium

#### M1. Cartoon blood is on by default and must be reflected in the rating and in listing art

**Every release.**

`index.html` defaults `blood` to on unless `rtb_blood` is `"0"`. On a hard floor impact, `bleed()` sprays red droplets and grows a pool under the body. The menu control is `Blood: ON` / `Blood: OFF`. The fall is a ragdoll tumble, not a realistic injury scene. A commentator-style line can say `MOMMY!`. Quips are sarcastic and include words such as “BARF”; the first-party script has no sexual content and no strong profanity list of its own.

**Policy:** **Violence**: fictional violence in a game, including cartoons, is generally allowed; graphic realistic violence is not. **Content Ratings**: the IARC questionnaire must be accurate, and misrepresentation can lead to removal. **Metadata**: graphic violence prominently depicted in icons, promotional images, or videos is called out as inappropriate listing content. Store listing imagery should stay suitable for a general audience.

**Fix:** Answer the questionnaire that the game includes cartoon violence and cartoon blood (see the rating guide). Do not use a blood-heavy frame as the icon or feature graphic. The in-repo launcher icon (`android/app/src/main/res/drawable/ic_launcher_foreground.xml`) is a rung and an arrow, which is fine.

#### M2. The presentation can be read as appealing to children, while online social features and blood are a poor fit for the Families rules

**Every release.** The online features make the mismatch sharper.

The UI is bright, uses emoji, and coaches the player with short prompts. It also has optional cartoon blood, fall screams, public names, and no age gate.

**Policy:** [Manage target audience and app content settings](https://support.google.com/googleplay/android-developer/answer/9867159) and the **Families** policy: if any selected age group includes children, the app must follow the Families requirements (privacy, data, social-feature adult controls, and only self-certified ads SDKs where ads exist). Google may disagree with a “not for children” declaration if imagery and wording look child-directed. **Age-Restricted Content and Functionality** requires blocking minors for real-money gambling, core matchmaking/dating, random stranger connections, and anonymous chat. This game is none of those. Friend challenges are invite links, not random matchmaking.

**Fix:** In Play Console, set the target age groups to teens and adults and answer that the app is not designed for children. Do not opt into Designed for Families. If you instead include under-13, treat that as a separate compliance project: Families policy, neutral age handling, no public names for children, and adult controls before any social feature. This audit does not recommend that path for the current build.

#### M3. There is no store-listing copy in the repo to review

**Every release.**

The only consumer-facing description of the Android app is `README.md` and the in-game title “Raising the Bar” (`strings.xml`, `index.html`). There is no short description, full description, screenshot set, or feature-graphic source checked in for Play.

**Policy:** **Metadata**: title, icon, developer name, description, screenshots, and promotional images must not be misleading, keyword-stuffed, or inappropriate. Title length limit is 30 characters. No emoji, emoticons, or repeated special characters in the title, icon, or developer name. **Deceptive Behavior**: functionality, description, and images must match. **DDA 11.4**: information given to Google or users must be current, true, accurate, and complete. **DDA 4.7**: the listing must show valid contact information.

**Fix:** Write the listing from what the binary does. For an online build, say that display names and scores are public to other players. For an offline build, do not advertise live leaderboards. Keep the title “Raising the Bar” (16 characters, mixed case, no emoji). Use the existing adaptive icon. Put a support email on the store listing.

### Low

#### L1. Launched as a free download, the download must stay free

**Every release.** There is no price, Play Billing dependency, or external checkout.

**Policy:** **DDA 3.7**: a product offered free of charge stays free of charge. Additional charges have to be an alternative or supplemental version of the product. **Payments**: digital goods inside a Play-distributed app use Google Play’s billing system, with the stated exceptions. Earned Chalk spent on fixed-price upgrades is not a purchase.

**Fix:** Keep the Play download free. If you later sell a cosmetic, extra Chalk, or an ad-free mode, add Play Billing for that digital item and describe it on the store listing. Do not send players to another payment page for those items.

#### L2. Title and parody lines were not cleared against a trademark search

**Every release.**

The in-app title is “Raising the Bar”. One achievement is named “Houston, We Have a Climber”. The launcher art is an original vector. No third-party character, team logo, or cover art is bundled.

**Policy:** **Intellectual Property** (copyright, trademark, counterfeit) and **Impersonation**: do not imply a relationship the app does not have, and do not use marks in a way that confuses users about source. **DDA 11.1** and **11.2**: you warrant that you have the rights, including rights to third-party material.

**Fix:** Do a trademark search for the title in the countries you will distribute, and keep records. The achievement line is a joke about a famous phrase; if counsel is unhappy with it, rename that achievement before release. No code change is required for copyright of the bundled art based on what is in the repo.

#### L3. Upcoming Play quality thresholds are not in force yet

**Every release.**

**Policy:** [Play Console technical quality requirements](https://support.google.com/googleplay/android-developer/answer/17492799), retrieved 1 October 2026, lists memory and code-optimization thresholds from February 2027 and zero-tap sign-in restoration from April 2027 as upcoming, not current blockers.

**Fix:** None for this submission. Revisit before those dates. This app has no Google account sign-in today; the 2027 sign-in item needs a reading against the final help text when you next update.

---

## Reviewed areas with no policy violation found

These are included so the release owner can see they were checked.

### Permissions and sensitive APIs

`android/app/src/main/AndroidManifest.xml` requests `VIBRATE` and `INTERNET` only. Both are normal permissions. The game calls `navigator.vibrate` for slips and falls. The network permission is used for the leaderboard API and for loading a challenge QR image. There is no location, camera, microphone, contacts, SMS, call log, storage, photos, nearby devices, accessibility, exact alarm, full-screen intent, install-packages, package-visibility, advertising-ID, or health permission. The QR code is an image the other person scans with their own camera; this app does not read the camera.

**Policy:** **Permissions and APIs that Access Sensitive Information**: request only permissions needed for current, disclosed features. **Photo and Video Permissions**, **SMS and Call Log Permissions**, **Location Permissions**, **Package (App) Visibility**, **Advertising ID** (under Ads): not used. No `AD_ID` permission is merged from a dependency in the Gradle files.

### Ads

No ad SDK, ad unit, or rewarded-ad call appears in `android/` or `index.html`.

**Policy:** **Ads**, **Families Ads Requirements**, **Deceptive Ads**, **Ad Fraud**, **Usage of Android Advertising ID**. Nothing to declare as ads. Answer “No” to “Contains ads” and “Does your app use advertising ID?”.

### Payments, real-money gambling, simulated gambling, loot boxes

Chalk is earned from climbs (10 per metre, 2 per bar) and spent on five upgrades with published fixed prices (`index.html` shop copy and upgrade tables). Locker items unlock from achievements. Weekly events rotate on a fixed calendar. There is no cash prize, stake, casino mechanic, or paid random item. No Play Billing library is on the classpath. Share links do not lead to a checkout.

**Policy:** **Payments** (Play Billing for digital goods; odds disclosure “in advance of, and in close and timely proximity to,” a purchase of randomized virtual items). **Real-Money Gambling, Games, and Contests** (no wagering for a prize of real-world value). This app does not need the gambling application, an AO rating, or a loot-box odds disclosure.

### User-generated content when the server is off

With an empty `RTB_API`, names are not published to other players. Share uses the Android share sheet (`MainActivity.GameBridge.share`), which leaves the user in the system chooser. Friend-panel WhatsApp, SMS, and mailto links are user taps and do not send a message by themselves.

**Policy:** **Spam**, Message Spam: the app must not send SMS or email on the user’s behalf without a chance to confirm content and recipients. The share sheet and the `sms:` / `mailto:` links meet that. **User Generated Content** does not attach until names are visible to other users (B4).

### Deceptive behavior, malware, and unwanted software

The packaged page is the game. Release builds turn WebView debugging off (`WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)`). External main-frame navigations leave the WebView (`shouldOverrideUrlLoading`). JavaScript is the game shipped inside the APK, which the **Device and Network Abuse** policy allows for code that runs in a WebView interpreter and is packaged with the app. The JavaScript interface exposes only `shareBaseUrl` and `share`, and the methods are annotated for ProGuard (`android/app/proguard-rules.pro`). No dex download, install-from-unknown-sources, hidden ad, or cloaking path was found. ProGuard minify on release is ordinary.

**Policy:** **Malware**, **Mobile Unwanted Software**, **Device and Network Abuse**, **Deceptive Behavior**, **Behavior Transparency**. No violation found in the current source. B6 is a disclosure gap, not a hidden feature: the leaderboard behavior is visible once the server is configured.

### Minimum functionality

The APK embeds a full game (physics, input, audio, save, fold layout, back button, share). It is not a shell around someone else’s website.

**Policy:** **Spam, Functionality, and User Experience**, including **Webviews and Affiliate Spam** and **Limited Functionality and Content**. The WebView hosts first-party packaged content. No affiliate redirect was found.

### Intellectual property inside the Android package

| Asset | What the repo shows |
| --- | --- |
| Game code and canvas art | Original, in `index.html`. No separate image, music, or font files are copied into the APK. |
| Fonts | CSS names system families (`Trebuchet MS`, `Segoe UI`, `Impact`, `Arial Black`). They are not embedded font files. |
| Audio | Synthesized in the page with WebAudio. No licensed tracks. |
| Launcher icon | Original vector, `ic_launcher_foreground.xml`. |
| AndroidX | `androidx.webkit:webkit:1.12.1`, `androidx.window:window-java:1.3.0`. Apache-2.0. On-device UI and fold posture. No ad or analytics product. |
| QR images | The Android package does not contain `server/vendor/qrcode.js`. The page loads `/qr.svg` from the first-party server. That generator is MIT (Kazuhiko Arase); the license file lives with the server, not in the APK. |

**Policy:** **Intellectual Property**, **DDA 11.2**. No third-party art, music, or font file was found in the Android package. L2 remains for the title as a trademark question, which cannot be closed from the repo alone.

### SDK policy status

Declared runtime dependencies are the two AndroidX libraries above. Test-only JUnit and Robolectric are not in the release app. No Firebase, Google Play services, Play Billing, AdMob, Facebook, Adjust, AppsFlyer, or crash SDK is declared.

**Policy:** **SDK Requirements** and **Use of SDKs In Apps**: the developer is responsible for SDK data practices. These libraries are not ads SDKs and are not Families Self-Certified Ads SDKs, which only matters if you target children (M2). No SDK in this app requests a sensitive permission or sells user data, based on the app manifest and the absence of those products in Gradle. Play SDK Index entries for these exact AndroidX versions were not opened during this audit (see “Could not verify”).

### Account deletion when the store build has no server

If the uploaded build has an empty API URL and no way for a user to point the app at a server, it does not create an app account. The Account Deletion Requirement then does not apply. B2, B1, and B5 still do. Do not answer the Data safety account questions as “users can create an account” for that build.

---

## Draft Data safety answers

Use **Draft A** if the uploaded app is built with `RTB_API`. Use **Draft B** if the uploaded app is permanently offline. Do not mix them. If both binaries will be on the same package name, use Draft A.

Definitions follow [Provide information for Google Play's Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469):

- **Collected** means transmitted off the device, including by a WebView the app controls.
- **Shared** means transferred to a third party. The developer’s own server is first party. A host that only stores the database on the developer’s instructions is a service provider, which is not “sharing.”
- User-initiated share-sheet, WhatsApp, SMS, and email actions are not declared as sharing, because the user sends them and can see the text.
- On-device-only `localStorage` (best height, settings, blood toggle, local Chalk) is not collected.

### Draft A — online release

**Does the app collect or share any of the required user data types?** Yes, it collects. It does not share with third parties.

**Is all of the user data collected by your app encrypted in transit?** Yes. `RTB_API` must be HTTPS or the build fails. Keep it that way for every host you ship.

**Do you provide a way for users to request that their data be deleted?** No, until B3 is implemented. After B3: Yes, and enter the public deletion URL. You may also say data is deleted on request. Do not claim the badge before the in-app path and the web path both delete the server profile.

**Committed to follow the Families policy?** No, if you follow M2.

**Independent security review?** No.

**UPI badge?** No.

| Data type | Collected | Shared | Optional or required | Ephemeral | Purposes | Why |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info → **Name** | Yes | No | Required until you add a real opt-in; Optional after users can play the online build without a profile | No | App functionality, Account management | Display name, random at creation, editable, shown on boards. Data safety “Name” includes a nickname. |
| Personal info → **User IDs** | Yes | No | Same as Name | No | App functionality, Account management, Fraud prevention, security, and compliance | Sync code / bearer token. Stored as a hash on the server. Identifies the profile. |
| App activity → **Other actions** | Yes | No | Same as Name | No | App functionality, Account management | Replays (gameplay inputs), height, score, upgrade levels, achievement ids, locker selections. The form’s example for this type includes gameplay. |
| Location, email, phone, messages, photos, audio, files, calendar, contacts, web browsing, crash logs, diagnostics, Device or other IDs, financial, health | No | No | — | — | — | Not accessed. IP handling is below. |

**IP addresses.** The server reads the connection address for an in-memory rate limit (`server/server.js`) and does not write it to SQLite. The app does not use IP to infer location. In the form, treat that use as **ephemeral processing** for **Fraud prevention, security, and compliance**. Ephemeral processing is included in the form response and, if it meets Google’s definition (memory only, no longer than needed to serve the request, not used to build a profile), is not shown on the public Data safety label. If the host, proxy, or future logging stores IP addresses, stop calling that use ephemeral and declare the matching data type. Do not declare approximate location unless you actually derive a place from the IP.

**Not collected:** vibration, fold/hinge geometry, screen size, and the rest of local play state. They stay on device.

**After B3 and an opt-in exist,** change Name, User IDs, and Other actions to Optional, because players can use the game without an account, and set the deletion question to Yes.

### Draft B — permanently offline release

**Does the app collect or share any of the required user data types?** No.

**Encryption in transit / deletion request:** The security questions that follow a “Yes” on collection do not apply. Still publish the privacy policy (B2) and say that progress stays on the device until the user clears app storage.

**Do not use Draft B** if `RTB_API` is set in the build you upload, or if a user can point the shipped app at a server.

---

## Content rating questionnaire answer guide

**Policy:** **Content Ratings**. Ratings come from IARC via the Play Console questionnaire. This guide is the accurate input set. It is not the certificate. Submit the questionnaire, check the calculated ESRB, PEGI, USK, and other ratings, and appeal to IARC if you disagree. Retake the questionnaire if you add chat, purchases, ads, or turn blood into realistic gore.

Play Console category: **Game**. Reference: [Content ratings](https://support.google.com/googleplay/android-developer/answer/9898843) and the rating descriptions in [Content rating requirements](https://support.google.com/googleplay/android-developer/answer/9859655).

Answer the on-screen question, not a paraphrase, if the wording differs. Expected band from these answers: cartoon violence plus cartoon blood often lands at **Everyone 10+** or **Teen** (ESRB) and **PEGI 7** or **PEGI 12**, and user interaction can add a “Users Interact” style descriptor on the online build. The certificate is authoritative.

| Topic | Answer | Evidence |
| --- | --- | --- |
| Violence | Yes. Fantasy or cartoon. The climber slips and falls. No realistic weapons, no injury of a real person. | Fall handling and ragdoll in `index.html`. |
| Blood or gore | Yes, cartoon blood. Not realistic gore, not dismemberment. It can appear on hard landings and is **on by default**. Players can turn it off. | `bleed()`, default `blood = true`. |
| Sexual content or nudity | No. | No such content in the script or listing assets. |
| Language | No strong profanity in the first-party script. Mild crude humor (sarcastic failure lines, “BARF”, a yelled “MOMMY!”). | `QUIPS` and the fall voice line. |
| Controlled substances, tobacco, alcohol | No. | — |
| Horror | No. Falls are slapstick. | — |
| Gambling, real money | No. | No stakes or cash prizes. |
| Simulated gambling, casino, loot boxes, paid random items | No. Chalk buys fixed upgrades. Locker items are achievement unlocks. Weekly rules are on a calendar, not a paid draw. | Shop and `ITEMS` in `index.html`. |
| Users can interact or see each other’s content | **Yes** on the online release (public names and scores). **No** on a permanently offline release. | Leaderboard and challenge name rendering. |
| Users can share their location | No. | No location permission or location field. |
| Digital purchases | No. | No billing library. |
| Unrestricted web browsing | No. Links the user taps open WhatsApp, SMS, email, or a challenge URL. The WebView does not browse the open web. | `shouldOverrideUrlLoading`, friend invite links. |
| Shares user info with other users | Online: the display name and score. Offline: no. | — |

Online release: the questionnaire’s user-interaction and user-generated-content questions must be **Yes**. That is the same fact as B4.

---

## Play Console checklist (owner, not in this repo)

Complete these in Play Console before production review. Items that match a finding are labeled.

1. Create the app with package name `com.raisethebar.game`. Confirm you own that application id and that it is not already used on another account.
2. Enroll in **Play App Signing**. Register a new upload key. Do not register `android/app/test-signing.keystore`. (**B5**)
3. Upload an **Android App Bundle** with **targetSdk 36**. (**B1, B5**)
4. Store listing: title “Raising the Bar”, short and full description that match the binary, icon from the adaptive icon, feature graphic, phone screenshots of real gameplay, at least the required tablet screenshots if you do not opt out of tablets. No emoji in the title. No blood-heavy promo stills. (**M1, M3**, **Metadata**)
5. Developer name, support email, and a website. (**DDA 4.7**)
6. **Privacy policy URL**, same page linked inside the app. (**B2**, **Privacy Policy**)
7. **Ads** declaration: No. Advertising ID: No.
8. **App access**: the game is playable without a login. If the review build has a server, say so and explain that a profile is created automatically, and give any test instructions. If login becomes required, provide credentials.
9. **Ads**, **News**, **COVID-19 contact tracing / health**, **Financial features**: the financial-features declaration should be that the app does not provide financial features. Government, VPN, and health forms: not applicable.
10. **Data safety**: paste Draft A or Draft B. Data deletion URL only after B3 works. (**H2, B3**)
11. **Target audience and content**: 13 and up (or older), not designed for children, not in Designed for Families. Appeal or change the app if Play says the creative is child-directed. (**M2**, Families policy)
12. **Content rating**: submit the questionnaire using the guide above. Save the certificate email. (**Content Ratings**)
13. **Account deletion** URL in the Data safety / data deletion field, for the online release, after the web form is live. (**B3**)
14. Countries and regions. This app is not a licensed gambling product, so do not file the gambling application.
15. Content declarations that match the binary: no ads, free app, no in-app products until Play Billing exists.
16. Internal testing on a non-public track before production. Confirm a release build signed with the upload key installs, plays offline, and, if online, creates a profile only after the new consent screen.
17. Store the privacy policy, terms of use (required once UGC ships), and deletion page on a host you control. GitHub Pages is acceptable only if the URL stays public and is not a PDF.

---

## What this audit could not verify

- Play Console itself: no listing, Data safety form, rating certificate, or policy-status page exists in the repo, and this audit had no Play Console login.
- Whether `RTB_API` is already set as a GitHub Actions repository variable. The workflow reads it; the value is not in git. The binary you upload depends on that value.
- A built APK or AAB. 16 KB page-size and 64-bit rules apply to native code. This project ships no NDK module. Android Gradle Plugin is 8.9.1, which is in the range that can align uncompressed native libraries. Transitive `.so` files inside `androidx.webkit` or `androidx.window` were not unpacked. [Technical quality requirements](https://support.google.com/googleplay/android-developer/answer/17492799) say Java/Kotlin apps are compatible with 16 KB by default. Confirm on the App bundle explorer after the first upload.
- Play SDK Index pages for `androidx.webkit:webkit:1.12.1` and `androidx.window:window-java:1.3.0` were not opened. Gradle does not pull an ads or analytics SDK.
- Trademark clearance for “Raising the Bar” against live registrations and existing Play apps.
- The IARC certificate. The guide is an input sheet; IARC calculates the rating.
- Server hosting details: TLS configuration beyond the HTTPS URL check, database encryption at rest, log retention, and whether a proxy stores IP addresses. If it does, update the IP row in Draft A.
- A privacy policy or terms page that might already exist outside this repository.
- Runtime behavior on a device. The audit is source review.
- UK CAP/ASA store-listing loot-box disclosure. That is an advertising-standards rule, not a Play Developer Program Policy. It does not attach here, because the game has no paid loot box. It is listed so it is not mistaken for a Play blocker.
- Upcoming February 2027 memory and optimization thresholds, which are not yet submission blockers.

---

## Top blockers before a production submission

1. **targetSdk 36** for a new app (current value is 35).
2. **Privacy policy** URL in the app and in Play Console.
3. **Account deletion** in the app and on the web, if the build creates profiles.
4. **UGC safeguards** (terms, report, block, moderation) if names are public.
5. **App bundle and a private upload key**. The committed test keystore must not be the Play upload key.
6. **In-app notice and an accurate Data safety form** for whatever the uploaded build actually sends off the device.
