# P-b150c82a / T-e66fe030 — Reuse audit, UX research, pilot architecture

Author: Claude Opus 5.5 (claude-opus-5-5), vmixer2o2, 2026-10-26. Read-only audit: no source repo was edited.
`git status --porcelain` was empty before and after in every git repo audited.

## 1. Existing work and repo state

There is no parking repo, and no parking project in pm other than P-b150c82a (pm `projects`, checked 13:45Z).
Nothing would be duplicated.

| Repo (`~/Documents/claudecode/…`) | Branch @ commit | Dirty | Stack | Tests run here |
|---|---|---|---|---|
| commerce | build/ecom-final @ d5b26aa | 0 | Next 14, Prisma 5.22/MySQL, `node --test` | `npm test`: 255 pass / 0 fail. `src/**/__tests__` needs MySQL and is not in the npm glob, so it is unverified |
| users | build/ecom-final @ 85bc0b8 | 0 | Next 15, Prisma/MySQL, EdDSA JWT IdP | 34 pass / 1 skip (DB) |
| canna | build/ecom-final @ 3ac132e | 0 | Next 15, Prisma 6 | 115 pass / **1 fail** (`test/checkout-wiring.test.ts:311` purchase-limit) |
| billboard-platform | wp0-solar-sam @ 60e5607 | 0 | Next 14.2.35, Prisma 5.17/MySQL, vitest | not run (no node_modules; installing would write) |
| green-energy-platform | main @ d9b5533 | 0 | Next, Prisma/MySQL, vitest | `npx vitest run`: 16 files pass, 1 skipped; 212 tests pass / 4 skipped |
| location-prospecting-tracking-app (= `./src`, identical per `diff -rq`) | not a git repo | – | Express + dotenv | no tests exist |

The DSH reports in commerce/users/canna end in BLOCKED or FAILED states. They are not completion reports.

## 2. Capability check: what really works

| Capability | Best source | Status |
|---|---|---|
| Password hashing | users `src/lib/crypto.ts:150-175` (scrypt, salted, versioned string) | works (unit tests) |
| Field encryption (AES-256-GCM, scrypt KDF + context) | green-energy-platform `lib/crypto.js:1-40` | works; small and pure |
| Rate limiting | green-energy-platform `lib/rateLimit.js:1-55` | works (tests); per-process only |
| RBAC | commerce `src/lib/roles.ts:30` (CUSTOMER/VENDOR/ADMIN) | works, but has **no tenant or site scoping anywhere** |
| Multi-tenancy | none in any repo | build new |
| Integer money | commerce `src/lib/money.ts:1-61` | works (`tests/money.test.ts`); defaults to USD |
| Order state machine | commerce `src/lib/orderStates.ts:14` (pure table) + CAS updates `src/lib/orders/store.ts:86,115` | works (tests) |
| Idempotent payment claim | commerce `src/lib/paymentConfirm.ts:27-31` (updateMany WHERE PENDING) | works (`tests/webhooks.test.ts`) |
| Double-entry ledger | commerce `src/lib/ledger/post.ts:1-206` (balanced lines, unique sourceKey) | works (29 fake-DB tests) |
| Payment provider interface | commerce `src/lib/payments/adapter.ts:1-131` | interface only. `adapters/` dir does not exist; everything runs on the mock |
| Real PSP (PayMongo/GCash/Maya) | none | **not built anywhere** (GrabPay held for ChatGPT) |
| Inventory holds / double-booking | commerce `inventory/stock.ts:62` (stock decrement; `reservedQty` is never written); billboard `lib/energy/capacity.js:6-19` | **no working hold logic.** billboard `app/api/energy/orders/route.js:42-64` has a read-then-insert **oversell race** |
| Geocoding / Places / Routes | `src/services/googleMapsService.js:14-262` (location app); billboard `lib/googleMaps.js:43-279` | real REST code, not run (no key here). Location app reads the key once at import (:5) |
| Map UI for drivers | none | build new |
| QR sign / scan / verify | none (the `qrcode` package is only used for 2FA and Solana Pay) | build new |
| Notifications | billboard `lib/notifications/dispatch.js` (in-app/SES/push); commerce `notifications.ts:50` (in-memory) | partial; no SMS |
| Operator / admin portals | commerce `app/(vendor-portal)`, `app/admin`; billboard dashboards | UI shells only, domain-specific |
| Audit log | commerce `src/lib/compliance/auditLog.ts` | pattern |
| PHP currency / Asia/Manila | none (grep: no `PHP`, `Asia/Manila`, `timeZone`) | build new |
| PWA / offline | none (billboard `public/sw.js` is push-only) | build new |
| Deployment | green-energy-platform `Dockerfile` (node:20-alpine, multi-stage) works; billboard Dockerfile is marked BROKEN | adapt |
| Location app admin / vault | `src/routes/admin.js:23-47`, `src/services/keyVaultService.js:10-13` | **do not reuse**: default `admin123`, constant bearer token, hardcoded fallback master key |

## 3. Reuse map (direct reuse first)

| Component | From (repo:path @ commit) | Adaptation | Target module | Risk |
|---|---|---|---|---|
| money helpers | commerce:src/lib/money.ts @ d5b26aa | TS→JS, PHP centavos, `formatPHP` via Intl `en-PH` | `src/lib/money.js` | low |
| state-transition table + CAS update | commerce:src/lib/orderStates.ts | booking states: held→confirmed→checked_in→completed / cancelled / expired / no_show | `src/lib/bookingStates.js` | low |
| atomic claim pattern | commerce:src/lib/paymentConfirm.ts:27 | `UPDATE … WHERE status='pending'` inside the booking transaction | `src/services/payments.js` | low |
| double-entry ledger | commerce:src/lib/ledger/post.ts | same invariants (assertBalanced, unique source_key); SQLite instead of Prisma | `src/lib/ledger.js` | medium |
| PSP adapter interface | commerce:src/lib/payments/adapter.ts | createIntent/capture/refund only; ship `sandbox` + `cash_at_site` adapters; GrabPay/PayMongo slots left empty | `src/payments/` | none (no real PSP) |
| password hashing | users:src/lib/crypto.ts:150 @ 85bc0b8 | verbatim port | `src/lib/auth.js` | low |
| AES-GCM field crypto | green-energy-platform:lib/crypto.js @ d9b5533 | inject secret instead of `getSecret` | `src/lib/crypto.js` | low |
| rate limiter | green-energy-platform:lib/rateLimit.js | verbatim | `src/lib/rateLimit.js` | low |
| geocode / haversine | location app `src/services/googleMapsService.js:14,262` | key read per call; disabled with a clean error when no key is set | `src/services/geo.js` | Google billing (feature-flagged off by default) |
| Dockerfile | green-energy-platform:Dockerfile | single-stage node:24-alpine, no Prisma | `Dockerfile` | low |

The source repos stay read-only. Code is **copied with a provenance header**, never imported across repos, so the parking
app deploys on its own (Q11-D).

## 4. Parking data domain

Operator (tenant) → Site (address, lat/lng, timezone Asia/Manila, policy: grace minutes, no-show cutoff, overstay rate)
→ Space pool (vehicle type, capacity) → Rate plan (hourly/daily/overnight/monthly in centavos).
Users carry a global role (driver / admin) plus memberships `(user, operator, role ∈ owner|manager|attendant)`.
Users have vehicles (plate). A **Booking** has pool, start/end (UTC instants, displayed in Manila time),
status, price, a payment method (prepaid/at_site), a booking code and a signed QR token.
**Holds** are bookings in `held` with `hold_expires_at`; expired holds free capacity at read time.
Payments (intent, provider, status, idempotency key) and refunds; ledger entries/lines; check-in events (scan/manual/walk-in, by attendant);
exceptions (late arrival, extension, overstay fee, no-show, refund); an append-only audit log.

**No double-booking:** every booking write runs in `BEGIN IMMEDIATE` (SQLite takes the write lock up front). Inside it,
occupancy in the window (held+confirmed+checked_in, unexpired) is counted against capacity before insert. Idempotency keys
are UNIQUE, so a retried checkout returns the original booking. The pilot is single-node. The module keeps the DB behind
one file, so a later Postgres move can use `SELECT … FOR UPDATE` or an exclusion constraint.

## 5. UX research (design reference only)

| App | Documented flow | Source |
|---|---|---|
| LuvPark (PH) | Reserve a slot near the destination (driver must be within 20 km), enter plate, pick payment (GCash/Maya/card/wallet), confirm; **an attendant guides you to the slot on arrival**; senior/PWD discounts; rates from ₱30 base, ₱300 overnight | [Interaksyon/Philstar 2025-12-04](https://interaksyon.philstar.com/trends-spotlights/2025/12/04/305955/drivers-secure-parking-advance-how/), [Wheels.ph](https://back.wheels.ph/industry/2025/12/04/70055/luvpark-a-smart-parking-app-is-set-to-transform-how-the-metro-parks/) |
| SpotHero (US) | Search by destination + arrive/leave times → map of options with the price for that window → prepay → digital parking pass; redemption differs per facility; attendant-only lots: **show the pass to the attendant**, who may scan it | [thetraveler.org](https://www.thetraveler.org/spothero-explained-how-this-parking-platform-really-works/), [SpotHero blog: redeem](https://blog.spothero.com/redeem-spothero-reservation) |
| UPark (PH) | Car-park **operator** in Metro Manila; no documented consumer booking app found; spaces appear on third-party listings (Parksy) | [burket.ph](https://www.burket.ph/company/upark), [Parksy listing](https://www.parksy.com/parking/ph/ncr/manila/secure-parking-space-at-upark-in-manila-metro-mani-149072) |
| Parada, ParkDito, OROSYSTEM | **No documented source found** (search 2026-10-26); not used as reference. Adjacent PH app: Dibz (advance reservations at partner lots) | [Inquirer](https://newsinfo.inquirer.net/?p=1212663) |

**Driver wireflow (Q7-A basic):** search address or "near me" + date/time window → map pins + list (price for the window,
spots left, distance) → site sheet → choose pool/rate → plate → pay (prepaid sandbox / pay-at-site) → confirmation
(booking code + QR) → My bookings (extend / cancel) → receipt.

**Attendant wireflow (phone):** login → site picker → Scan QR (camera via BarcodeDetector) or type the code / plate →
verify card (valid / wrong site / too early / expired) → Check in → … → Check out (overstay fee computed, collect at site) →
Walk-in (plate + pool, capacity-checked) → live occupancy counter. Offline: a queue of check-in/out actions with client
idempotency keys, replayed on reconnect.

**Role dashboards:** operator owner/manager: sites, pools/capacity, rates, policy, staff, bookings, occupancy, collections by method.
Platform admin: operators, all sites, ledger trial balance, audit log.

## 6. Pilot constraints (confirmed)

Phones plus human attendants, QR credentials, pay-at-site allowed. No gate, ANPR or sensor hardware. A hardware adapter
interface is left unimplemented on purpose. No PSP credentials exist in the audited repos (grep of `.env*`: no PayMongo entry anywhere; the only Stripe
entries, in billboard `.env.local`, are empty, and that code is USD), so checkout runs on a **sandbox adapter** and the real-PSP
choice is held for the ChatGPT thread. Google Maps: geocoding is feature-flagged off without a key; the driver map uses
OpenStreetMap tiles via Leaflet (CDN, no key, no spend).

## 7. Implementation order (T-bf279623)

1. Scaffold the standalone repo `~/Documents/claudecode/parking-marketplace` (git init, local commits only).
2. Copied libs + tests (money, crypto, auth, rateLimit, ledger, bookingStates).
3. Schema + migrations (node:sqlite, zero external DB) + tagged seed (`[SEED]`).
4. Booking engine: quote, hold, confirm, cancel, extend, expire, no-show, overstay; idempotency.
5. Payments: sandbox + cash-at-site adapters, ledger posting, refunds.
6. Attendant: verify QR/code/plate, check-in/out, walk-in, offline replay.
7. Operator/admin APIs with server-side tenant scoping.
8. Web/PWA UI: driver, attendant, operator, admin (one responsive app + manifest + service worker).
9. Tests: unit + HTTP integration + concurrency race + tenant isolation + browser click-through.

## 8. Acceptance tests

- N parallel checkouts for 1 remaining spot → exactly 1 succeeds, the rest get 409; capacity never negative.
- Same idempotency key twice → same booking id, one payment.
- Expired hold frees capacity; a confirmed booking does not expire.
- A QR signed for site A is rejected at site B; a tampered QR is rejected; a code entered twice → second check-in refused.
- An attendant of operator A gets 403 on operator B's sites, bookings and reports.
- Prices in centavos, rendered `₱1,234.50`; windows computed and shown in Asia/Manila.
- Cancel before cutoff → refund + reversing ledger entry; trial balance stays at 0.
- Overstay → fee computed from the policy; walk-in blocked when full.
- Offline-queued check-in replayed twice → applied once.
- Rollback: the app is isolated (own dir, own DB file); rollback = stop the process and restore `data/parking.db` from its pre-deploy copy.

## 9. Next approval checkpoint

Production deploy, real PSP (GrabPay/PayMongo), GrabMaps listings and hardware all stay unapproved and are not
implemented. The base build (T-bf279623) proceeds under the existing user instruction ("work on preliminary and base build now").
