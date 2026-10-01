# Google Play internal publishing

This repository can build the signed `com.groves.rtb` app bundle and, after a
separate credential grant, upload that bundle only to Google Play's internal
testing track. Publishing is an explicit `workflow_dispatch` action. Push and
pull-request builds never authenticate to Google or upload to Play.

The automation intentionally does not manage the store listing, screenshots,
changelogs, testers, products, policy declarations, pricing, financial data, or
production releases. The Play Console identity used to publish builds must also
be separate from the backend identity that verifies purchases at runtime.

## Before the API workflow can run

Fastlane requires an existing Play application with at least one build uploaded
through Play Console. For this new app, first configure Play App Signing and
manually upload the first correctly signed `bundlePlayStoreRelease` AAB in the
Console. Do not run the API publishing job until that prerequisite is complete.

Creating identities or granting access is intentionally not performed by this
repository. When the owner is ready to grant publishing access:

1. In a dedicated or selected Google Cloud project, enable **Google Play Android
   Developer API** (`androidpublisher.googleapis.com`).
2. Create a publisher service account used only by this workflow. Do not reuse
   the backend's runtime purchase-verification identity and do not create a JSON
   key for CI.
3. In Play Console **Users and permissions**, invite that service account for
   only `com.groves.rtb`. Grant **View app information (read-only)** and
   **Release apps to testing tracks**. Do not grant **Release to production,
   exclude devices, and use Play App Signing**, financial/order permissions,
   policy permissions, Admin, or **Manage store presence**. The last permission
   is unnecessary because fastlane is configured to skip all listing content.
4. Create a Google Cloud Workload Identity Pool and GitHub OIDC provider. Map
   `google.subject=assertion.sub`,
   `attribute.repository=assertion.repository`,
   `attribute.ref=assertion.ref`, and
   `attribute.environment=assertion.environment`. Require all of the following
   in the provider attribute condition:
   `assertion.repository == 'mtdewwolf/raise-the-bar'`,
   `assertion.event_name == 'workflow_dispatch'`, the repository's default
   branch ref, and `assertion.environment == 'play-internal'`.
5. Allow only the matching federated principal to impersonate the publisher
   service account with `roles/iam.workloadIdentityUser`. The member should be
   `principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.repository/mtdewwolf/raise-the-bar`;
   use the numeric project number, not the project ID. Do not grant that service
   account project-wide Editor/Owner roles; Play permissions are granted
   separately in Play Console.
6. Create the GitHub environment `play-internal`, restrict it to the default
   branch, and add a required reviewer if the repository plan supports it. Add
   these environment variables (not secrets):
   - `RTB_PLAY_WIF_PROVIDER`: full provider resource name, such as
     `projects/123456789/locations/global/workloadIdentityPools/github/providers/raise-the-bar`
   - `RTB_PLAY_PUBLISHER_SERVICE_ACCOUNT`: publisher service-account email
7. Confirm the existing signing secrets `RTB_KEYSTORE_BASE64`,
   `RTB_KEYSTORE_PASSWORD`, `RTB_KEY_ALIAS`, and `RTB_KEY_PASSWORD`, and the
   `RTB_API` (HTTPS only) and `RTB_PLAY_SUPPORTER_PRODUCT` repository variables.

Then run **Android APK** from the default branch, enable `publish_internal`, and
leave `play_release_status` at `draft` for the safest first API run. The workflow
builds with `bundlePlayStoreRelease`, preserves the AAB as an artifact, obtains a
short-lived Google credential through OIDC, and runs:

```sh
bundle exec fastlane android publish_internal release_status:draft
```

Selecting `completed` makes the internal-test release available according to the
track's tester configuration. Neither option can target production. Increase
`versionCode` in `android/app/build.gradle` before every uploaded build; the
workflow deliberately does not invent or auto-increment release versions.

## Local alternative

The CI path should use Workload Identity Federation. For an exceptional local
run, keep an authorized-user, external-account, or service-account JSON file
outside the repository and point Application Default Credentials at it:

```sh
export GOOGLE_APPLICATION_CREDENTIALS=/private/path/play-publisher.json
bundle install
bundle exec fastlane android publish_internal release_status:draft
```

Use Ruby 3.3.12 and the exact fastlane version in `Gemfile`. A local run expects
the signed AAB at
`android/app/build/outputs/bundle/playStoreRelease/app-playStore-release.aab`.
The repository ignores common Play credential filenames, plus `*.keystore` and
`*.jks`; keep the private JSON and upload keystore outside the checkout anyway.

## References

- Fastlane Android setup: https://docs.fastlane.tools/getting-started/android/setup/
- Fastlane supply: https://docs.fastlane.tools/actions/upload_to_play_store/
- Android Publisher API setup: https://developers.google.com/android-publisher/getting_started
- Play Console permissions: https://support.google.com/googleplay/android-developer/answer/9844686
- Google WIF for deployment pipelines: https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- Google GitHub auth action: https://github.com/google-github-actions/auth
