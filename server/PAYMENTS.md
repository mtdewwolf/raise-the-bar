# Payment foundation — test only

## Scope and safety boundaries

This foundation is disabled by default and **does not support live payments**. The official Stripe Node SDK is lockfile-pinned. No external account, credential, product, webhook or payment was created during implementation. Automated tests use synthetic offline fixtures, with real SDK signature verification, not actual Stripe sandbox transactions.

One permanent cosmetic SKU (`supporter_pack`) grants a supporter headband, provisionally USD4.99 in test mode. No paid Chalk, stamina, upgrades or physics advantage exists. The simulation block is unchanged. Other proposed packs/final pricing are not implemented.

Server catalog, orders, inventory and equip validation are authoritative. Redirect/query strings, local browser storage, client amounts and achievement claims cannot grant paid ownership. Public replay and challenge looks are sanitized. Existing legacy achievement sync remains **client-reported but allowlisted** to preserve free achievement rewards; it is not anti-cheat proof, and is isolated from paid entitlements. Existing earned Chalk/upgrades remain backed by verified runs.

## Accounts and recovery

- Registration explicitly links the existing player ID and requires the existing legacy bearer plus `confirmLink:true`. It retains runs, Chalk, upgrades and earned rewards and invalidates the old sync code.
- Passwords: 12–128 characters, scrypt N32768/r8/p1, random128-bit salt,256-bit output. Only hashes are stored.
- Random256-bit bearer sessions are hashed server-side, expire after24h, and are kept in browser sessionStorage rather than persistent localStorage. Logout revokes all sessions. Recovery and code rotation revoke/replace sessions.
- A separate single-use recovery code replaces a forgotten password and rotates itself. **There is no email reset.** Losing both password and saved recovery code means automated recovery is impossible. Knowing the password lets a signed-in player replace a lost code, including after an interrupted registration response.
- Checkout requires proof that the current recovery code was saved. Recovery resets that confirmation. No raw password/code/token is put in a URL or intentionally logged.
- Per-IP/per-username throttles and generic login/recovery failures are included. The limiter is in-memory/single-process; restart resets it. Persistent/shared abuse protection remains a production requirement.
- Existing cross-origin web/native API uses bearer auth, not ambient cookies; no cookie-based CSRF behavior. XSS can still read sessionStorage, so production CSP/XSS review is required. Use HTTPS and correct trusted-proxy configuration.

## Payment handling

- Server constructs the fixed SKU/amount/currency and uses a configured reusable Stripe sandbox Price. Inline `product_data`/`price_data` is not used. Before creating an order, the server retrieves the mapped Price and Product and requires test mode, active one-time pricing, the exact provisional amount/currency and matching `metadata.sku`. The approved Price/Product IDs are snapshotted on the order and rechecked during reconciliation. A missing, changed or mismatched mapping fails closed.
- Checkout omits `payment_method_types`, allowing Stripe's sandbox payment-method configuration to decide eligible methods. Every order gets one stable `raise_the_bar_web_` integration label with eight random letters and one stable idempotency key; both survive concurrent/retried creation. Ownership and active-order selection are rechecked transactionally after provider awaits.
- Known sessions are retrieved, never recreated using aged keys. An uncertain order with no saved session ID older23h fails closed for support reconciliation rather than risking an idempotency-key-pruning duplicate.
- A completed but still unpaid Session is explicitly `processing`. It grants nothing, returns no redirect, and cannot open a second checkout. Authenticated refresh/restore reconciles it until `checkout.session.async_payment_succeeded` or `checkout.session.async_payment_failed` makes the outcome authoritative. UI changes or closure while a request is in flight do not change server ownership or order identity.
- Webhooks read bounded raw bytes and verify Stripe signature/timestamp. Current trusted Session, line-item product metadata, player/order mapping, amount, currency, PaymentIntent and Charge are verified before fulfilling.
- Unpaid/failed/expired sessions grant nothing. Failed/expired orders can retry. Duplicate events/requests are idempotent.
- Refunds/disputes leave terminal revocation tombstones; late payment events cannot resurrect them. Full or partial refund or any dispute conservatively revokes the entire pack. Dispute closure does not regrant automatically. Support/refund policy must be finalized before launch.
- Restore authenticates the player and reconciles only that player's stored sessions; client-submitted receipt/session/player IDs are never trusted. The app does not initiate refunds or charges outside Checkout creation.
- Android web checkout remains blocked. The separate native Play foundation shares the authoritative entitlement ledger; see [Google Play setup](GOOGLE-PLAY.md) and [Android safety](../android/PAYMENT-SAFETY.md).

## Persistence and actual sandbox verification

Railway volume `e6871e4c-f37e-4f7c-8093-de84eb45da2a` is mounted at `/data`. On2026-09-30 it was restored from an integrity/hash-verified export; a normal redeploy retained the database and existing records. A private manual snapshot also exists on the operator's PC. The operator declined Railway's paid scheduled-backup option, so automated off-site backups and a recurring restore drill remain operational gaps. `RTB_PAYMENT_STORAGE_READY=1` remains an explicit operator attestation, not an automatic mount detector.

Authorized operator checklist:
1. Before payment-specific migrations or risky operations, take another consistent SQLite snapshot using online backup/`.backup`, or stop writes/checkpoint before copying. Copying only a live `.sqlite` file while ignoring WAL is unsafe. Keep a single server writer; this SQLite design is not distributed/multi-replica storage.
2. Reconfirm the `/data` mount, absolute `RTB_DB` path, restored records, and restart/redeploy persistence. Payment-order persistence itself has not yet been exercised against Stripe end to end.
3. Configure `RTB_PAYMENT_STORAGE_READY=1`, `RTB_PAYMENTS_MODE=test`, `RTB_PUBLIC_URL=https://<approved-web-origin>`, `STRIPE_PRICE_SUPPORTER_PACK=price_...`, an authorized `STRIPE_SECRET_KEY` beginning `rk_test_` (preferred) or `sk_test_`, and `STRIPE_WEBHOOK_SECRET` through secure platform secret management. `rk_live_` and `sk_live_` are rejected. Never provide secrets in chat, browser assets, source code or URLs.
4. Provision the reusable sandbox Product/Price separately in the selected sandbox, then record its Price ID. The product must be active, carry `metadata.sku=supporter_pack`, and have a one-time USD4.99 (499-cent) Price. This repository does not create or mutate Stripe catalog objects.
5. Register sandbox `/api/payments/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `refund.created`, `refund.updated`. Keep retries enabled and monitor errors without secret-bearing request logging.
6. Verify HTTPS/domain/port routing and `RTB_TRUST_PROXY` against the actual trusted proxy, plus CORS/security headers. Exercise real sandbox account recovery, cancel/retry, delayed fulfillment, webhook retries/duplicates, refund/dispute, restore/reinstall and persistent restart with sandbox test details only.

The runtime restricted key should start with: Checkout Sessions Write; PaymentIntents, Charges, Products and Prices Read. It does not need Refund Write, Customers Write, payouts, Connect or subscriptions. Validate the actual restricted-key permission set in the sandbox request logs before enabling checkout; no real sandbox transaction has been run yet.

Not production-ready until those checks, real visual/mobile QA, Play Console/device verification/private signing, operational monitoring, legal/refund/tax/privacy decisions, catalog/pricing, and account-abuse hardening are complete. Define separate live/test environments and ledger partitioning before adding live mode; do not silently migrate test entitlements into live purchases.

## API

Private routes require `Authorization: Bearer <legacy sync code or account session>`.

- `POST /api/account/register`: `{username,password,confirmLink:true}` with legacy auth → profile, new token, one-time recoveryCode
- `POST /api/account/login`: `{username,password}` → profile + token
- `POST /api/account/recover`: `{username,password,recoveryCode}` → profile + token + replacement code
- `POST /api/account/rotate-recovery`: account auth + `{password}` → profile + new token/code
- `POST /api/account/confirm-recovery`: `{recoveryCode}` → profile
- `POST /api/account/logout`: revoke all sessions
- `GET /api/me`: playerId, account, inventory, purchases and sanitized look
- `GET /api/shop`: availability and provisional test catalog
- `POST /api/shop/checkout`: `{sku:'supporter_pack',channel:'web'}` → hosted URL
- `POST /api/shop/restore`: reconcile own orders → profile
- `POST /api/payments/stripe/webhook`: raw signed test event
- `POST /api/shop/google-play/verify`: authenticated Play purchase-token verification and entitlement response
- `POST /api/shop/google-play/reconcile`: authenticated retry/reconciliation for the account's known Play tokens
- `POST /api/payments/google-play/rtdn`: authenticated Pub/Sub RTDN push

Run `cd server && npm ci && npm test`. Test fixtures never call external provider APIs. Sources: [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [webhooks](https://docs.stripe.com/webhooks), [refunds](https://docs.stripe.com/refunds), [OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
