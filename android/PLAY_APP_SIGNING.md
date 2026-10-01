# Play App Signing and the upload key

One-time steps for the owner. Do them in a password manager and in Play Console. Never commit the upload keystore, its passwords, or a Play artifact signed with `android/app/test-signing.keystore`.

The committed test keystore is for debug and explicitly named internal-test builds only. Release variants require all four `RTB_KEYSTORE_*` values and reject the public test certificate, even if it has been renamed. Use `bundlePlayStoreInternalTest` to build a test-signed Play integration artifact.

Test certificate (do not register this with Play):

- DN: `CN=Raising the Bar Test, O=Raising the Bar, C=US`
- SHA-256: `6E:7F:72:B6:68:C4:48:FF:5E:38:8D:10:89:4E:B4:73:09:87:79:BD:C3:1F:CE:E9:AC:B5:1F:94:4D:C5:F0:CC`

## 1. Create an upload keystore outside the repo

Use RSA 2048 (or EC P-256) and an expiry after 22 October 2033. Pick your own alias and password.

Java's default PKCS12 keystore uses one password for the store and key. Put that same value in both `RTB_KEYSTORE_PASSWORD` and `RTB_KEY_PASSWORD`.

```bash
keytool -genkeypair -v \
  -keystore "$HOME/raising-the-bar-upload.jks" \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12
```

Keep the `.jks` file and password outside this git repository. `android/.gitignore` ignores private keystore files.

## 2. Enroll in Play App Signing

Create the Play Console app with package name `com.groves.rtb`. The `direct` flavor keeps the separate sideload package `com.raisethebar.game`.

1. Open **Test and release > App signing** (or **Play App Signing** on older consoles).
2. Enroll and let Google generate the **app signing key**. That key stays with Google and signs the APKs installed by users.
3. Register the keystore from step 1 as the **upload key**. Export its certificate, not its private key:

   ```bash
   keytool -export -rfc \
     -keystore "$HOME/raising-the-bar-upload.jks" \
     -alias upload \
     -file upload_certificate.pem
   ```

4. The first bundle uploaded to Play must be signed with this upload key. Play then signs device APKs with the app signing key.

If the upload key is lost, request an upload-key reset in Play Console. Do not opt out of Play App Signing or upload a bundle signed with the public test key.

## 3. GitHub Actions configuration

The Android workflow builds direct and Play Store debug and internal-test variants on pushes. The signed Play release job runs only through a manual workflow dispatch on the default branch and is protected by the `play-internal` environment.

Configure the environment-scoped secrets `RTB_KEYSTORE_BASE64`, `RTB_KEYSTORE_PASSWORD`, `RTB_KEY_ALIAS`, and `RTB_KEY_PASSWORD`. `RTB_KEYSTORE_BASE64` is the base64 encoding of the keystore file. Also configure repository variables `RTB_API` and `RTB_PLAY_SUPPORTER_PRODUCT`; the Play release requires an HTTPS API URL and a valid product ID. Workload Identity and Fastlane publishing setup are documented in [Play publishing](PLAY-PUBLISHING.md) and [Google Play backend setup](../server/GOOGLE-PLAY.md).

## 4. Local release builds

```bash
export RTB_KEYSTORE_FILE="$HOME/raising-the-bar-upload.jks"
export RTB_KEYSTORE_PASSWORD='your-store-password'
export RTB_KEY_ALIAS='upload'
export RTB_KEY_PASSWORD='your-key-password'
export RTB_API='https://your-api.example'
export RTB_PLAY_SUPPORTER_PRODUCT='supporter'
cd android
./gradlew bundlePlayStoreRelease
```

The bundle is `android/app/build/outputs/bundle/playStoreRelease/app-playStore-release.aab`. `bundlePlayStoreRelease` requires SDK 36, a private upload key, `RTB_API`, and `RTB_PLAY_SUPPORTER_PRODUCT`. To build the direct sideload release, use `bundleDirectRelease`; both release variants require private signing. `assembleDirectInternalTest` builds the standard sideload test APK without the upload key.

## 5. Digital Asset Links

Friend invites use `https://<share-host>/challenge/<code>`. Replay links use `https://<share-host><share-path>#r=...`. The share host comes from `RTB_API`; otherwise the default is `mtdewwolf.github.io` with the project path `/raise-the-bar/`. The app claims both link shapes.

Android verifies links using the **app signing** certificate SHA-256 from Play Console (**App signing > App signing key certificate**), not the upload or test certificate. Publish this file at `https://<share-host>/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.groves.rtb",
      "sha256_cert_fingerprints": ["REPLACE_WITH_PLAY_APP_SIGNING_SHA256"]
    }
  }
]
```

Serve it as `Content-Type: application/json` over HTTPS without redirecting to another host. A GitHub project site cannot serve `/.well-known/assetlinks.json` at the host root; use a host you control. Verify it with [Google's statement list tester](https://developers.google.com/digital-asset-links/tools/generator), then reinstall the Play-signed build so Android retries link verification.

## Also required in Play Console

Account deletion, the privacy-policy URL, user-generated-content reporting, and the Data safety form are separate owner steps. They are outside this guide.