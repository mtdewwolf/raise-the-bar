# Google Play Billing foundation

## Implemented boundary

The Play Store flavor uses Google Play Billing Library9.1.0 for one permanent, nonconsumable cosmetic. It never consumes the purchase. The direct-install flavor retains the existing no-native-purchase behavior, and the Play flavor does not expose Stripe hosted checkout.

The device discovers the localized Play price and eligible one-time offer, sends a purchase token only to the authenticated backend, handles `PENDING` without granting or acknowledging, restores with `queryPurchasesAsync`, and retries across BillingClient reconnect/resume. The backend is authoritative:

- `POST /api/shop/google-play/verify` checks the token with `purchases.productsv2.getproductpurchasev2`, exact package/Product mapping, a single unconsumed quantity, `PURCHASED` state/completion, and `obfuscatedExternalAccountId`.
- Account binding is the64-character lowercase SHA-256 hex of `rtb-play:<canonical username>`; it contains no PII. A purchase token is globally unique in the durable ledger and cannot move between accounts.
- Entitlement is granted transactionally before acknowledgement. Failed server acknowledgement stays durable and is retried by device restore, authenticated reconciliation, RTDN, and the six-hour known-purchase reconciliation pass. Permanent products are never consumed.
- Pending/canceled/refunded/voided Play purchases do not grant. Source ledgers are independent: revoking Play removes only the Play grant, and the cosmetic remains while an active Stripe source exists. An equipped item is reset only after its final active source disappears.
- Authenticated Pub/Sub push at `POST /api/payments/google-play/rtdn` verifies OIDC audience and service-account email, package allowlist, message shape and durable message ID. One-time and voided notifications always cause an authoritative Developer API lookup before the ledger changes.

No Play Console product, service account, credential, Pub/Sub topic, legal agreement, release, or real/test purchase was created here. No subscription is implemented.

## Fail-closed server configuration

All values are required before `playBillingEnabled` becomes true:

- `RTB_GOOGLE_PLAY_ENABLED=1`
- `RTB_GOOGLE_PLAY_PACKAGE=com.raisethebar.game`
- `GOOGLE_PLAY_PRODUCT_SUPPORTER_PACK=<active Play one-time product ID>`
- `RTB_GOOGLE_PLAY_PUBSUB_AUDIENCE=https://<exact public RTDN endpoint audience>`
- `RTB_GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT=<exact Pub/Sub push identity email>`
- Application Default Credentials for a narrowly scoped service account authorized for the Google Play Developer API. Store credentials only in the hosting platform's secret facility; do not commit or place them in the WebView/app.

The Play Console product ID must match the server and Play-flavor BuildConfig values. Console price is authoritative and localized; the web-only USD4.99 Stripe test price is not a Play offer.

## Owner setup and launch blockers

Before an internal Play test, the owner still must:

1. Create/activate the permanent one-time Product and purchase option, configure license testers/internal testing, and grant the minimum Developer API permissions to the runtime service account.
2. Configure RTDN for one-time products and voided purchases, an authenticated Pub/Sub push subscription, exact OIDC audience/service-account allowlist, retry policy, and monitoring. Confirm the six-hour reconciliation works against the real API.
3. Supply private Play App Signing/upload signing and build the `playStoreRelease` AAB. Release builds fail closed without approved private signing. Never upload the public repository test certificate.
4. Exercise a real license-tester device flow: localized offer, purchase, pending completion/cancel, app/process restart, reinstall/restore, acknowledgement, duplicate callbacks, refund/revoke, offline recovery, account mismatch and RTDN retries. Current automated tests use offline adapters only.
5. Publish an in-app account-deletion request flow and a public web deletion-request resource before launch. No autonomous hard-delete was added because retention, fraud/ledger tombstones and verified deletion policy require owner/legal decisions.
6. Complete owner review of the privacy policy, Data Safety declarations, refunds/support terms and applicable tax/legal requirements. If this is a personal developer account created after2023-11-13, determine whether Google's closed-test requirement (currently12testers for14continuous days) applies.

Google Play currently requires new phone/tablet submissions and updates to target Android16/API36. The project is configured for API36 and Billing9.1.0, but Play Console acceptance, internal testing, device behavior and policy review remain unverified.

Official references: [Billing9 migration](https://developer.android.com/google/play/billing/migrate-gpblv9), [one-time lifecycle](https://developer.android.com/google/play/billing/lifecycle/one-time), [purchase security](https://developer.android.com/google/play/billing/security), [ProductPurchaseV2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2), [RTDN](https://developer.android.com/google/play/billing/rtdn-reference), and [WebView bridge risks](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges).
