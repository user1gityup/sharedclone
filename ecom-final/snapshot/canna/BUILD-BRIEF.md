# BUILD BRIEF — `canna`

Phase 1, **Lane B**. Runs in parallel with `commerce`. Starts only after `users` passes its Phase 0
gate (a token verifying against the published JWKS).

Re-cut from `~/Downloads/members-only-wholesale-retail-network-FOCUSED-build-prompt.md` for the
three-repo design. **The vertical-adapter contract in that file's §2 is dead** — see §10.

---

## 1. Scope

A complete, standalone regulated-cannabis marketplace for **California**: retail (B2C) and
wholesale/distribution (B2B), with POS and ERP integration and Metrc compliance reporting.

It shares exactly one thing with `commerce`: both trust a session token minted by `users`. No shared
code, database, deployment or package — and that separation is not merely architectural here. Keeping
cannabis transaction data out of `commerce` is the **280E data separation** this split exists for.
Do not add a cross-repo join, a shared analytics table, or a reporting job that reads both.

---

## 2. Port sources (verified present on disk)

Port from `~/Documents/claudecode/billboard-platform`. **Copy in and own the copy permanently** —
`commerce` holds its own separate copy of several of these, which is intended.

| Module | Source | Note |
|---|---|---|
| **Encrypted credential vault — load-bearing here** | `lib/settings.js` + `IntegrationSetting` model | DB-backed, AES-256-GCM, env fallback, 5s cache, admin rotate UI. This is how every Dutchie / Treez / Distru / LeafLink / Metrc key is stored. **Do not invent a second secret store.** |
| Notification centre | `lib/notifications/dispatch.js`, `Notification` / `NotificationRule` / `PushSubscription` | `EVENT_REGISTRY` extends to `order.placed`, `order.confirmed_by_vendor`, `order.shipped`, `vendor.application_approved`, `compliance.sync_failed`. |
| Crypto / ACH payment rails | `lib/manualCrypto.js`, `lib/paymentConfirm.js` | The atomic-claim dispatcher at `lib/paymentConfirm.js:442` is the pattern for B2B settlement. **Do not port `lib/stripe.js`** — see §4. |
| File uploads | `lib/uploads.js` | Keep SVG-blocking. Resolve the local-filesystem to object-storage TODO rather than inheriting it. |
| Admin nav | `lib/nav/*`, `NavSection` / `NavItem` | Retail / wholesale-buyer / vendor / admin sidebars. |
| Rate limiting | `lib/rateLimit.js` | |
| Deploy pattern | `.github/workflows/deploy.yml`, `deploy/migrate.php`, PM2 + DreamHost VPS | Own deploy user, own MySQL DB. |

### Port the FIX, not the bug

`billboard-platform/middleware.js:28` has the spoofable `X-Forwarded-For` parser
(`.split(",")[0]`). Port `green-energy-platform/middleware.js:41` `clientIpFor(request)` instead.

---

## 3. Authentication

Verifier only, exactly as in `commerce` and implemented **separately** against `users/CONTRACT.md`:
fetch and cache the JWKS, verify signature (**EdDSA / Ed25519 only** — reject any other `alg`,
decided 2026-09-26) / `iss` / `aud` / `exp`, never hold a signing key, call
`/introspect` for revocation on sensitive actions only.

Gate wholesale (B2B) access on the token's `amr` showing 2FA was satisfied. Authorization —
retail customer / wholesale buyer / vendor / admin — is defined and stored **in this repo**.

---

## 4. Payments — decided, and deliberately not Stripe

Card networks restrict cannabis, so there is no Stripe card checkout in this repo.

- **B2C retail:** **Dutchie Pay** and **Treez Pay**. Two drivers behind one internal payment
  interface, selected per vendor org by which processor that vendor actually uses — the same
  two-driver shape as the POS layer.
- **B2B wholesale:** **crypto or ACH**, plus invoiced/terms settlement. Reuse
  `lib/paymentConfirm.js`'s atomic-claim-then-confirm pattern so a webhook retry cannot
  double-settle an invoice.

---

## 5. Integrations — two drivers per layer, never assume one

Every vendor org names which driver it uses; nothing may hard-code a single vendor.

- **Retail POS:** `DutchiePosDriver`, `TreezPosDriver` — catalog, inventory, order sync.
- **Wholesale/distribution ERP:** `DistruErpDriver`, `LeafLinkErpDriver`.
- **Compliance:** `MetrcComplianceDriver` behind a `ComplianceDriver` interface.
  **State: California, decided.** Metrc is per-state — its own base URL, and credentials issued
  per-licence through the state portal, not a global signup. Build against CA's instance only. A
  second provider (BioTrackTHC) stays unbuilt behind the interface until a non-Metrc state is real.

`complianceCheck(order)` runs **before** an order is released, and every call writes a
`ComplianceRecord` whether it passes or fails. That table is the audit trail if a regulator asks, so
it is written on the failure path too — never only on success.

---

## 6. Vendor vetting

Cannabis vendor applications capture a **state licence number** (issuing state, expiry). Admin
approval includes a **manual licence-validity check as a hard gate** before the vendor may list
products. Do not automate lookup against the state register for MVP.

---

## 7. Data model

`Product`, `Variant`, `InventoryItem`, `Vendor`, `Cart`, `CartLine`, `Order`, `OrderLine`,
`Shipment`, `PaymentRequest`, `Notification`, `NotificationRule`, `PushSubscription`,
`IntegrationSetting`, this repo's own role/permission tables, plus the cannabis-specific:

- `VendorIntegrationCredential` — which POS/ERP driver a vendor uses, credentials encrypted through
  the `IntegrationSetting` vault pattern, **not** a new secret store.
- `ComplianceRecord` — one row per order per check: system used, request, response, pass/fail,
  timestamp.
- `CannabisLicense` — licence number, issuing state, expiry, verification status.

---

## 8. Build order — independent swarm units

Once `users` gates green:

1. Schema + migrations; JWKS verifier; role model. *(unblocks the rest)*
2. Vault port + `VendorIntegrationCredential` + admin credential rotation UI. *(unblocks 3-5)*
3. POS drivers: Dutchie, then Treez, behind one interface.
4. ERP drivers: Distru, then LeafLink, behind one interface.
5. `MetrcComplianceDriver` (CA) + `ComplianceRecord` + the pre-release gate.
6. Catalog / cart / checkout; Dutchie Pay + Treez Pay (B2C); crypto + ACH + terms (B2B).
7. Vendor application, licence capture, admin approval queue with the licence gate.
8. Storefront pages, notifications, deploy pipeline.

Units 3, 4 and 5 touch disjoint files and run concurrently once unit 2 lands. Each driver ships with
a recorded-fixture test — the swarm must not require live Dutchie/Treez/Distru/LeafLink/Metrc
credentials to make progress, and no unit may block on a credential that has not been issued yet.

**Definition of done:** a wholesale buyer signed in through `users` places a B2B order that passes a
Metrc CA compliance check, is pushed to the vendor's ERP, settles by ACH exactly once under webhook
retry, and writes a `ComplianceRecord`; plus the same for a B2C retail order through Dutchie Pay.

---

## 9. Already decided — do NOT re-ask

State **CA**. Compliance **Metrc**. POS **Dutchie + Treez**. ERP **Distru + LeafLink**. Payments
**Dutchie Pay + Treez Pay** (B2C), **crypto or ACH** (B2B). Repo name `canna`. Shared login via
`users`. Independent from `commerce` forever.

## 10. Superseded design — do NOT build

The FOCUSED prompt's §0-§2 (core platform + `VerticalAdapter` interface + a `CannabisAdapter`
plugged into it) is **replaced**. There is no adapter, no core, no registry, no shared package. This
is simply a cannabis marketplace application. The POS, ERP and compliance driver interfaces above
are real and stay — they exist because there are genuinely two implementations of each. An interface
with one implementation is not wanted.

---

## 11. LOCAL-SEAT UNITS — pre-written for the vmixer llama lane

The build runs on **vmixer2o2** (GTX 1070 8 GB VRAM, 128 GB RAM). Its llama.cpp seat
(`llama-local`, Qwen3.6-35B-A3B through the `:8090` router) is **one serial lane**, not a pool —
the router holds ONE model in VRAM at a time, so every unit naming it queues behind the last.
Measured: decode **20-25 tok/s**, prefill **~81 tok/s at 8k**, cold load **41-52 s**, swap ~41 s;
and on that box on 2026-09-25 a **57.5k-token prompt cost ~15.6 min of prefill alone**.

**Rules for the local lane:**
1. **Nothing may depend on a local unit.** No paid unit's `dependsOn` may name one.
2. **`detail` is self-contained and small** — target under 3k tokens, ceiling 8k. The seat does not
   read the repo and is not given this brief.
3. **One file per unit, <=400 lines.** No two units touch the same file.
4. **Transcription, not design.** The POS/ERP/compliance driver interfaces, the schema and the
   payment paths stay on paid seats — other units code against them.
5. Seat timeout **>= 420 s**; thinking **off** or `content` comes back empty.
6. These five units ~= **12 min serial**, hidden behind the paid waves.

Paste verbatim into the swarm query for this repo:

```json
[
  {
    "id": "canna-local-compliance-types",
    "title": "Compliance and licence types",
    "detail": "Create src/types/compliance.ts in TypeScript, types and constants only, no imports and no runtime logic beyond frozen objects. Export: type ComplianceSystem = 'metrc'; type ComplianceCheckKind = 'pre_release' | 'inventory_sync' | 'transfer' | 'sale_report'; interface ComplianceRecord with id, orderId, system, kind, requestBody unknown, responseBody unknown, passed boolean, failureReason optional, checkedAt ISO-8601 UTC string, retryCount number; type LicenceVerificationStatus = 'unverified' | 'pending' | 'verified' | 'expired' | 'revoked'; interface CannabisLicence with id, vendorId, licenceNumber, issuingState two-letter uppercase, licenceType, issuedAt, expiresAt, verificationStatus, verifiedAt optional. Add a JSDoc line on every field. Add a frozen LICENCE_TERMINAL_STATUSES array naming the statuses that block ordering. Output the single file only.",
    "dependsOn": [],
    "provider": "llama-local"
  },
  {
    "id": "canna-local-env-example",
    "title": ".env.example for the canna storefront",
    "detail": "Create .env.example for a cannabis marketplace app. One var per line, each preceded by a one-line comment saying what it is and whether it is required. Include: DATABASE_URL; APP_BASE_URL; USERS_JWKS_URL; USERS_ISSUER; USERS_AUDIENCE; INTEGRATION_VAULT_KEY (AES-256-GCM key encrypting per-vendor POS/ERP credentials); DUTCHIE_API_BASE; DUTCHIE_API_KEY; TREEZ_API_BASE; TREEZ_CLIENT_ID; TREEZ_CLIENT_SECRET; DISTRU_API_BASE; DISTRU_API_KEY; LEAFLINK_API_BASE; LEAFLINK_API_KEY; METRC_API_BASE; METRC_VENDOR_KEY; METRC_USER_KEY; METRC_STATE defaulting to CA; ACH_PROVIDER_BASE; ACH_PROVIDER_KEY; RATE_LIMIT_TRUSTED_PROXY_COUNT; NODE_ENV. The header comment must state that this service verifies session tokens with the users service public key only, holds no signing key of its own, and that per-vendor integration credentials live encrypted in the database rather than in this file. Placeholders must be obviously fake. Output the single file only.",
    "dependsOn": [],
    "provider": "llama-local"
  },
  {
    "id": "canna-local-money",
    "title": "Money and weight helpers, pure functions",
    "detail": "Create src/lib/units.ts in TypeScript, no dependencies, no I/O. Money is handled in integer minor units only. Export: toMinor(amount string) parsing a decimal string with at most 2 fraction digits and throwing RangeError otherwise; fromMinor(minor number) always with 2 fraction digits; addMinor and subMinor with overflow guards against Number.MAX_SAFE_INTEGER; splitMinor(total number, weights number array) distributing an integer total by weight with the remainder given to the largest weight so the parts always sum exactly to the total. Also export GRAMS_PER_OUNCE = 28.349523125 and toGrams(value number, unit 'g' or 'oz' or 'lb' or 'kg') rounding to 4 decimal places. Every exported function gets a JSDoc line. No console output. Output the single file only.",
    "dependsOn": [],
    "provider": "llama-local"
  },
  {
    "id": "canna-local-order-states",
    "title": "Order and compliance state tables",
    "detail": "Create src/lib/orderStates.ts in TypeScript, constants and pure helpers only. Export type OrderState = 'draft' | 'submitted' | 'compliance_pending' | 'compliance_failed' | 'awaiting_payment' | 'paid' | 'fulfilling' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'. Export a frozen ORDER_TRANSITIONS record mapping each state to the array of states it may move to: draft to submitted or cancelled; submitted to compliance_pending or cancelled; compliance_pending to compliance_failed or awaiting_payment; compliance_failed to submitted or cancelled; awaiting_payment to paid or cancelled; paid to fulfilling or refunded; fulfilling to shipped or refunded; shipped to delivered; delivered to refunded; cancelled and refunded terminal with empty arrays. Export canTransition(from, to) returning boolean and TERMINAL_ORDER_STATES. Export a second frozen table B2B_REQUIRES_LICENCE listing the states that must not be entered while the buyer licence verification status is anything other than verified. No imports, no database code. Output the single file only.",
    "dependsOn": [],
    "provider": "llama-local"
  },
  {
    "id": "canna-local-readme",
    "title": "Repo README",
    "detail": "Write README.md for a repository named canna: a members-only cannabis retail and wholesale marketplace for California. Sections in order: what it is (B2C retail plus B2B wholesale, one repo); what it is NOT (not a shared platform, no adapter layer, general merch lives in a separate repo named commerce); authentication (sessions are issued by a separate users service and verified here with its public key over JWKS; this repo never mints tokens and holds no signing key); integrations (POS Dutchie and Treez behind one interface; ERP Distru and LeafLink behind one interface; compliance Metrc, California); payments (Dutchie Pay and Treez Pay for retail, crypto or ACH for wholesale, deliberately not Stripe); local development (env vars in .env.example, recorded fixtures mean no live vendor credentials are needed to run the tests); and a short repository layout list. Plain Markdown, no badges, no licence section, no marketing language, under 120 lines. Output the single file only.",
    "dependsOn": [],
    "provider": "llama-local"
  }
]
```

**Not for the local lane here** (paid seats only): the Prisma schema and migrations, the JWKS
verifier, the credential vault port, every POS/ERP/Metrc driver, checkout and payment paths, and the
admin approval queue.
