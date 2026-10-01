# Play App Signing and the upload key

One-time steps for the owner. Do them in a password manager and in Play Console. Do not commit the upload keystore, its passwords, or a Play artifact signed with `android/app/test-signing.keystore`.

The committed test keystore is for **debug APKs only**. `assembleRelease` and `bundleRelease` fail until `RTB_KEYSTORE_FILE`, `RTB_KEYSTORE_PASSWORD`, `RTB_KEY_ALIAS`, and `RTB_KEY_PASSWORD` are set. Pointing those variables at the test keystore will sign a release build, but that certificate is public and must not be enrolled as the Play upload key.

Test certificate (do not register this with Play):

- DN: `CN=Raising the Bar Test, O=Raising the Bar, C=US`
- SHA-256: `6E:7F:72:B6:68:C4:48:FF:5E:38:8D:10:89:4E:B4:73:09:87:79:BD:C3:1F:CE:E9:AC:B5:1F:94:4D:C5:F0:CC`

## 1. Create an upload keystore outside the repo

Use RSA 2048 (or EC P-256) and an expiry after 22 October 2033. 10000 days is past that date. Pick your own alias and password.

Java’s default PKCS12 keystore uses one password for the store and the key. Put that same value in both `RTB_KEYSTORE_PASSWORD` and `RTB_KEY_PASSWORD`.

```bash
keytool -genkeypair -v \
  -keystore "$HOME/raising-the-bar-upload.jks" \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12
```

Keep the `.jks` file and the password somewhere that is not this git repository. `android/.gitignore` already ignores `*.jks` and `*.keystore` except the public test key.

## 2. Enroll in Play App Signing

In Play Console, create the app with package name `com.raisethebar.game` if it does not exist yet.

1. Open **Test and release → App signing** (or **Play App Signing** on older consoles).
2. Enroll. Let Google generate the **app signing key**. That key stays with Google and is what devices install.
3. Register the keystore from step 1 as the **upload key**. Choose the option to use a key you export from a Java keystore, and upload the certificate from that keystore (not the private key file itself, if the console asks for a PEM certificate):

   ```bash
   keytool -export -rfc \
     -keystore "$HOME/raising-the-bar-upload.jks" \
     -alias upload \
     -file upload_certificate.pem
   ```

4. The first binary you upload must be an **Android App Bundle** signed with this upload key. Play then re-signs the device APKs with the app signing key.

If the upload key is ever lost, use Play Console’s upload-key reset. That only works if this private key was never the app signing key. Do not opt out of Play App Signing, and do not upload a bundle signed by the test keystore “just once.” The first upload certificate becomes the upload key.

## 3. GitHub Actions secrets

Repository **Settings → Secrets and variables → Actions**. Create all four. If any one is missing, the Play bundle step fails. If all four are empty, that step is skipped and CI still uploads the debug APK.

| Secret | Value |
| --- | --- |
| `RTB_KEYSTORE_BASE64` | Base64 of the upload keystore file (not a path) |
| `RTB_KEYSTORE_PASSWORD` | Store password |
| `RTB_KEY_ALIAS` | Alias from step 1 (`upload` in the command above) |
| `RTB_KEY_PASSWORD` | Key password |

Linux:

```bash
base64 -w 0 "$HOME/raising-the-bar-upload.jks"
```

macOS:

```bash
base64 -i "$HOME/raising-the-bar-upload.jks" | tr -d '\n'
```

Paste the single line into `RTB_KEYSTORE_BASE64`. The workflow decodes it and passes the path as `RTB_KEYSTORE_FILE`.

The **Android** workflow then:

- always builds `app-debug.apk`, signed with the test key, for sideload testing (artifact `raising-the-bar-debug-apk`)
- builds `app-release.aab`, signed with the upload key, when the four secrets are set (artifact `raising-the-bar-play-aab`)

Upload the AAB to Play. Do not upload the debug APK or a release APK as the store artifact.

## 4. Local release builds

```bash
export RTB_KEYSTORE_FILE="$HOME/raising-the-bar-upload.jks"
export RTB_KEYSTORE_PASSWORD='your-store-password'
export RTB_KEY_ALIAS='upload'
export RTB_KEY_PASSWORD='your-key-password'
cd android
./gradlew bundleRelease
```

The bundle is `android/app/build/outputs/bundle/release/app-release.aab`. The same variables work as Gradle properties (`-PRTB_KEYSTORE_FILE=...`). `./gradlew assembleDebug` does not need them.

`RTB_API` (or `-PrtbApi`) is optional and separate. Set it to the HTTPS origin of the leaderboard server when the Play build should enable online profiles. It also becomes the host for shared links.

## 5. Digital Asset Links, after enrollment

Friend invites are `https://<share-host>/challenge/<code>`. Replay links are `https://<share-host><share-path>#r=...`. The share host is the host of `RTB_API`, or `mtdewwolf.github.io` with path `/raise-the-bar/` when `RTB_API` is unset. The app claims both shapes. Android 12 and newer only open those https links without a chooser when verification succeeds.

Verification uses the **app signing** certificate SHA-256 from Play Console (**App signing → App signing key certificate**), not the upload certificate and not the test certificate above.

Publish this file at `https://<share-host>/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.raisethebar.game",
      "sha256_cert_fingerprints": [
        "REPLACE_WITH_PLAY_APP_SIGNING_SHA256"
      ]
    }
  }
]
```

Serve it as `Content-Type: application/json` over HTTPS, with no redirect to another host. A GitHub **project** site (`https://mtdewwolf.github.io/raise-the-bar/`) cannot serve `/.well-known/assetlinks.json` at the host root. Put the file on a host you control (the public game origin, the same host as `RTB_API`). A GitHub user site can serve it only from the `username.github.io` repository root, which is a different repo.

Check with [Google’s statement list tester](https://developers.google.com/digital-asset-links/tools/generator) after the file is live, then reinstall the Play-signed build so Android retries verification.

## Still done in Play Console, not in this repo

Account deletion, the privacy-policy URL, user-generated-content reporting, and the Data safety form are separate owner steps. This repo does not implement them.
