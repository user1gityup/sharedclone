# BUILD BRIEF — `commerce`

Phase 1, **Lane A**. Runs in parallel with `canna`. Starts only after `users` passes its Phase 0
gate (a token verifying against the published JWKS).

Re-cut from `~/Downloads/members-only-wholesale-retail-network-FOCUSED-build-prompt.md` for the
three-repo design. **The vertical-adapter contract in that file's §2 is dead** — see §8.

---

## 1. Scope

A complete, standalone merch and general-ecommerce storefront. Native catalog, native inventory,
native payments. **No external POS or ERP anywhere in this repo.**

It shares exactly one thing with `canna`: both trust a session token minted by `users`. They share
no code, no database, no deployment, and no package.

---

## 2. Port sources (verified present on disk)

Port from `~/Documents/claudecode/billboard-platform`. **Copy into this repo and own the copy
permanently** — do not import from billboard, do not create a shared package.

| Module | Source | Note |
|---|---|---|
| **Payment engine — the centrepiece** | `lib/stripe.js`, `lib/stripeConnect.js`, `lib/solana.js`, `lib/manualCrypto.js`, `lib/paymentConfirm.js` | The `PaymentRequest` model + the atomic-claim dispatcher `confirmPaymentRequest()` at `lib/paymentConfirm.js:442`. This generalizes directly to multi-vendor cart checkout. |
| Encrypted settings vault | `lib/settings.js` + `IntegrationSetting` model | DB-backed, AES-256-GCM, env fallback, 5s cache, admin rotate UI. Holds the Stripe keys. |
| Notification centre | `lib/notifications/dispatch.js`, `Notification` / `NotificationRule` / `PushSubscription` | `EVENT_REGISTRY` extends cleanly to `order.placed`, `order.confirmed_by_vendor`, `order.shipped`, `vendor.application_approved`. |
| File uploads | `lib/uploads.js` | Keep the SVG-blocking validation. |
| Admin nav | `lib/nav/*`, `NavSection` / `NavItem` | Role-scoped sidebars. |
| House revenue split | `lib/houseRevenue.js` | Already models the platform's cut. |
| Rate limiting | `lib/rateLimit.js` | |
| Deploy pattern | `.github/workflows/deploy.yml`, `deploy/migrate.php`, PM2 + DreamHost VPS | Own deploy user, own MySQL DB. |

### Port the FIX, not the bug
`billboard-platform/middleware.js:28` has the spoofable `X-Forwarded-For` parser
(`.split(",")[0]`). Port `green-energy-platform/middleware.js:41` `clientIpFor(request)` instead.

### Inherited TODO — do not inherit it as debt
`lib/uploads.js` stores to the local filesystem and billboard's own comments flag object storage as
a pre-deploy TODO. Resolve it here (S3 or equivalent) rather than carrying the note forward.

---

## 3. Authentication

Do **not** port billboard's session minting. This repo is a **verifier only**:

- Fetch and cache the JWKS from `users`; verify the token's signature, `iss`, `aud`, `exp`.
  Signature is **EdDSA / Ed25519 only** — reject any other `alg` (decided 2026-09-26).
- Never hold a signing key. Never mint a session.
- Call `users`' `/introspect` for revocation on sensitive actions only (payout changes, order
  placement above a threshold), not on every request.
- Implement against `users/CONTRACT.md`. `canna` implements the same contract separately — that
  duplication is intended, so do not try to share the verifier.

Authorization is **this repo's own**: customer / vendor / admin, defined here, stored here. `users`
never knows these roles.

---

## 4. Payments — all four rails

- **Stripe Checkout** (card) and **Stripe Connect** (vendor payouts).
- **Solana Pay** (SOL/USDC) — **devnet, decided.** Keep it devnet; mainnet is a later, separate call.
- **Manual ETH/BTC** via `lib/manualCrypto.js`.

Generalize billboard's per-type confirms (`confirmTopup`, `confirmAdStudioPurchase`) into a single
`confirmOrderPayment(order)` that credits, notifies, and writes the house-revenue split — following
`confirmPaymentRequest()`'s exact atomic-claim-then-confirm pattern. **Do not loosen that pattern**;
it is what makes double-confirmation from a webhook retry impossible.

---

## 5. Data model

Native and complete in this repo: `Product`, `Variant`, `InventoryItem`, `Vendor`, `Cart`,
`CartLine`, `Order`, `OrderLine`, `Shipment`, `PaymentRequest`, `Payout`, `Notification`,
`NotificationRule`, `PushSubscription`, `IntegrationSetting`, plus this repo's own role/permission
tables.

Vendor onboarding is core KYC only — no licence capture, no compliance records. That is `canna`'s
problem and none of it belongs here.

---

## 6. Build order — independent swarm units

Once `users` gates green, these are genuinely parallel within this repo:
1. Schema + migrations; JWKS verifier; role model. *(unblocks the rest)*
2. Catalog + inventory + vendor management.
3. Multi-vendor cart + checkout skeleton.
4. Payment engine port: Stripe → Connect → Solana devnet → manual crypto, behind
   `confirmOrderPayment`.
5. Storefront pages, search, responsive.
6. Notification registry expansion; admin ops; vendor approval queue.
7. Uploads → object storage; deploy pipeline.

Units 2, 4 and 6 touch disjoint files and can run concurrently after unit 1.

**Definition of done:** a signed-in user (token from `users`) completes a multi-vendor checkout on
each of the four rails, the house split is written exactly once per order under webhook retry, and
vendor payouts settle through Connect.

---

## 7. Already decided — do NOT re-ask

Solana **devnet**. Repo name `commerce`. Shared login via `users`. Independent from `canna` forever.

## 8. Superseded design — do NOT build

The FOCUSED prompt's §0-§2 (core platform + `VerticalAdapter` interface + an `EcommerceAdapter`
wrapping the payment engine) is **replaced**. There is no adapter, no core, no registry, no shared
package. The payment engine is simply this application's payment code. `allowedPaymentMethods()`,
`complianceCheck()` and `pushOrder()` do not exist here — the first is a constant, and the other two
were always no-ops for this vertical. Do not build interfaces whose only implementation is this repo.

---

## 9. LOCAL-SEAT UNITS — pre-written for the vmixer llama lane

The build runs on **vmixer2o2** (GTX 1070 8 GB VRAM, 128 GB RAM). Its llama.cpp seat
(`llama-local`, Qwen3.6-35B-A3B through the `:8090` router) is **one serial lane**, not a pool —
one model in VRAM at a time, so units naming it queue. Measured: decode **20-25 tok/s**, prefill
**~81 tok/s at 8k**, cold load **41-52 s**; a **57.5k-token prompt cost ~15.6 min of prefill** on
that box on 2026-09-25.

**Rules for the local lane:**
1. **Nothing may depend on a local unit.**
2. **`detail` self-contained and small** — under 3k tokens, ceiling 8k. The seat never reads the repo.
3. **One file per unit, <=400 lines**, no shared files.
4. **Transcription, not design.** The payment engine port, `confirmOrderPayment`, the schema and the
   Connect/Solana paths stay on paid seats.
5. Seat timeout **>= 420 s**; thinking **off**.
6. These four units ~= **10 min serial**.

Paste verbatim into the swarm query for this repo:

```json
[
  {
    "id": "commerce-local-money",
    "title": "Money and split helpers, pure functions",
    "detail": "Create src/lib/money.ts in TypeScript with no dependencies and no I/O. Money is integer minor units only. Export: toMinor(amount string) parsing a decimal string with at most 2 fraction digits, throwing RangeError otherwise; fromMinor(minor number) returning a string with exactly 2 fraction digits; addMinor and subMinor guarding Number.MAX_SAFE_INTEGER; splitMinor(total number, weights number array) distributing an integer total by weight, remainder to the largest weight, parts always summing exactly to the total; houseSplit(total number, houseBasisPoints number) returning an object with house and vendor where houseBasisPoints is 0 to 10000 and the two parts always sum exactly to total. Every export gets a JSDoc line. No display formatting, no Intl, no console output. Output the single file only.",
    "dependsOn": [],
    "provider": "llama-local"
  },
  {
    "id": "commerce-local-env-example",
    "title": ".env.example for the commerce storefront",
    "detail": "Create .env.example for a multi-vendor ecommerce app. One var per line, each preceded by a one-line comment saying what it is and whether it is required. Include: DATABASE_URL; APP_BASE_URL; USERS_JWKS_URL; USERS_ISSUER; USERS_AUDIENCE; STRIPE_SECRET_KEY; STRIPE_WEBHOOK_SECRET; STRIPE_CONNECT_CLIENT_ID; SOLANA_CLUSTER set to devnet; SOLANA_RPC_URL; SOLANA_TREASURY_PUBKEY; MANUAL_CRYPTO_CONFIRMATIONS_REQUIRED; OBJECT_STORAGE_ENDPOINT; OBJECT_STORAGE_BUCKET; OBJECT_STORAGE_KEY; OBJECT_STORAGE_SECRET; SMTP_URL; MAIL_FROM; RATE_LIMIT_TRUSTED_PROXY_COUNT; NODE_ENV. The header comment must state that this service verifies session tokens with the users service public key only and holds no signing key, that Solana runs on devnet, and that no cannabis or licence configuration belongs in this file. Placeholders must be obviously fake. Output the single file only.",
    "dependsOn": [],
    "provider": "llama-local"
  },
  {
    "id": "commerce-local-order-states",
    "title": "Order and payment state tables",
    "detail": "Create src/lib/orderStates.ts in TypeScript, constants and pure helpers only, no imports. Export type OrderState = 'draft' | 'awaiting_payment' | 'payment_processing' | 'paid' | 'partially_fulfilled' | 'fulfilled' | 'cancelled' | 'refunded' | 'partially_refunded'. Export a frozen ORDER_TRANSITIONS record giving the allowed next states: draft to awaiting_payment or cancelled; awaiting_payment to payment_processing or cancelled; payment_processing to paid, awaiting_payment or cancelled; paid to partially_fulfilled, fulfilled, refunded or partially_refunded; partially_fulfilled to fulfilled, partially_refunded or refunded; fulfilled to refunded or partially_refunded; partially_refunded to refunded; cancelled and refunded terminal with empty arrays. Export canTransition(from, to) returning boolean, TERMINAL_ORDER_STATES, type PaymentRail = 'stripe' | 'stripe_connect' | 'solana_devnet' | 'manual_crypto', and a frozen RAIL_IS_ASYNC record saying which rails settle asynchronously through a webhook or a chain confirmation. Output the single file only.",
    "dependsOn": [],
    "provider": "llama-local"
  },
  {
    "id": "commerce-local-webhook-fixtures",
    "title": "Webhook replay fixtures",
    "detail": "Create tests/fixtures/webhooks.ts in TypeScript exporting plain-object fixtures used to prove a payment webhook handler is idempotent. No network, no crypto, no imports. Export FIXED_NOW as a fixed epoch-seconds number and derive every timestamp from it. Export STRIPE_PAYMENT_INTENT_SUCCEEDED shaped with id, type 'payment_intent.succeeded', created, and data.object holding id, amount, currency 'usd' and metadata.orderId. Then STRIPE_DUPLICATE_DELIVERY, byte-identical to it with the same id, to prove a second delivery changes nothing; STRIPE_OUT_OF_ORDER_REFUND with type 'charge.refunded' and a created value EARLIER than the success event; STRIPE_UNKNOWN_ORDER whose metadata.orderId names an order that does not exist; SOLANA_CONFIRMATION shaped with signature, slot, confirmations, orderId and lamports; and SOLANA_REORG_REPLAY reusing the same signature at a different slot. Put a one-line comment over each fixture naming the single property that makes it interesting. Output the single file only.",
    "dependsOn": [],
    "provider": "llama-local"
  }
]
```

**Not for the local lane here** (paid seats only): the schema and migrations, the JWKS verifier, the
Stripe/Connect/Solana engine port, `confirmOrderPayment`, payouts, and the deploy pipeline.
