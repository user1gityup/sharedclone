# Ecom / Cannabis — Production Event Manager Build Prompt

**Status:** Approved requirements captured from a 36-question, one-at-a-time design interview.
**Target:** Existing Ecom/Cannabis platform and Shared Brain / DSH ecosystem.
**Instruction to implementation agents:** Build a complete, working event tool, not a mockup, disconnected prototype, or fresh replacement application.

> **Revision note (Claude Opus 5.5, 2026-10-08, host vmixer2o2):** Reviewed against the live `users`, `commerce`, and `canna` repos (branch `build/ecom-final`), the `commerce-lanes/*` worktrees, the billboard-platform Lead Intelligence code, and the Shared Brain decisions (`ecom-final/GATE0-DECISIONS.md`, `ecom-final/ecom_final_build_prompt_updated.md`, `solar-sam-integration-decisions.md`, and the lead-hub/LeadForge handoffs). Everything in the original text is kept as approved. New material is marked **[Added]**. Section 0 is new. The questions at the end cover only decisions that the code and prior decisions do not settle.

## 0. [Added] Verified current state — what the build must reuse and what is missing

Read this before Phase 0 and confirm it again against live git state, because ecom-final is still being built.

**Platform shape (locked in GATE0-DECISIONS):**
- There are three independent repos on branch `build/ecom-final`:

  | Repo | Port | Role |
  |---|---|---|
  | `users` | :5190 | Identity. Issues EdDSA JWTs, publishes JWKS. Account flags `isAdmin`, `retailEnabled`, `vendorEnabled`. |
  | `commerce` | :5191 | Nonregulated merchandise marketplace. Next 14, Prisma 5, MySQL DB `ecom_commerce`. |
  | `canna` | :5192 | Regulated cannabis. Next 15, Prisma 6, MySQL 8.4 DB `ecom_canna`. Members-only, California, Metrc CA. |

- **280E data separation is binding.** commerce and canna share no code, no database, and no cross-repo joins. They have only one thing in common: both trust `users` tokens. Every Event Manager entity must therefore be placed deliberately:
  - regulated inventory, sales, and settlement go in canna
  - merchandise goes in commerce
  - anything else goes where the answer to E1 puts it
- Deploy target is a DreamHost VPS, using billboard's pattern: GitHub Actions, `migrate.php`, PM2, a dedicated deploy user and DB, and MySQL with Prisma. Locally, everything runs in the Docker container `ecom-final-mysql`.
- **ecom-final build state on 2026-10-08:** 16 of 21 DAG steps done. L-frontend and L-canna are being re-run; S5-commerce, S5-canna, and S6-e2e have not started. canna has **no regulated lane code merged yet**, and its catalog, cart, and order results are still in memory (`src/lib/catalog.ts`, `cartStore.ts`, `orderResults.ts`). The Event Manager's festival work depends on L-canna landing.

**Exists and must be reused:**
- **Auth:** `src/lib/auth.ts` in both apps (`verifyEdDsaToken`, `hasTwoFactor` via `amr`). Commerce RBAC uses `requireRole()` in `commerce/src/lib/roles.ts`. The contract is `USERS-CONTRACT.md`.
- **Vendors:** Vendor and VendorApplication exist in both apps. Product and Variant have unique SKUs; canna adds THC/CBD % and mg.
- **Commerce inventory ledger:** InventoryItem, Reservation, InventoryMovement (`commerce/src/lib/inventory/stock.ts`), with `ownerType` VENDOR or PLATFORM.
- **Commerce money and accounting:**
  - Payout and HouseRevenue
  - Double-entry Account / JournalEntry / JournalEntryLine
  - QuickBooks Online sandbox sync
  - Membership tiers: Free, Bronze, Silver, Gold, Platinum
  - Wholesale `priceBreaks`, `moq`, `casePack` (`commerce/src/lib/wholesale/*`)
- **Canna compliance:** CannabisLicense (number, issuingState, type, expiry, verification status), ComplianceRecord written on pass and on fail, VendorIntegrationCredential.
- **Settings vault:** AES-256-GCM IntegrationSetting in both apps (`commerce/src/lib/settings.ts`, `canna/src/lib/vault.ts`).
- **Canna drivers (sandbox only):**
  - POS: `DutchiePosDriver` and `TreezPosDriver` (syncCatalog, syncInventory, pushOrder) in `canna/src/drivers/pos.ts`
  - ERP: Distru and LeafLink
  - Compliance: `MetrcComplianceDriver` for California
  - Payments: DutchiePay, TreezPay, ACH, Crypto, Terms, and an in-memory `SettlementLedger`
- **Commerce payments:**
  - Adapter registry: stripe, paymongo, coinbase_commerce, btcpay, nowpayments, treez, dutchie_pay.
  - Working pieces: Stripe and Stripe Connect code, a Stripe webhook, and the atomic `claimPaymentRequest` / `confirmOrderPayment` pattern (`paymentConfirm.ts`).
  - Commerce audit log: `commerce/src/lib/compliance/auditLog.ts`.
  - Uploads: S3-compatible storage or local disk, with SVG blocked (`commerce/src/lib/uploads.ts`).
  - Notifications: Notification, NotificationRule, and PushSubscription models exist; the `EVENT_REGISTRY` that drives them works in memory only.
- **Lead tooling (two copies):**
  - The **standalone Lead Intelligence hub**: repo `~/Documents/claudecode/lead-intelligence`, root `server.mjs` on :5180, per-app feeds tagged with `appTag`.
    - Includes an `ecomm` feed, `/api/review/owners` bulk assign, and `#leads/<id>` detail routes.
    - Lives on vmixlaptop2x6 only; commits 1a211b9 and d02c4db are local.
  - The **embedded copy** in `billboard-platform/lead-intelligence-platform/`.
  - Both use the record type `UniversalRecord` in `shared/types/record.ts`. Fields: status enum, single `assigned_agent` owner, `keywords[]`, `qualification_score`, contact fields, and source/provenance fields.
  - Dedupe: `engine/pipeline/deduplication.js` keys on organization plus the first of solicitation number, website, or source URL. It merges duplicates and never deletes them.
  - Storage is JSON stores; there is no database yet. Prisma plus MySQL is planned per solar-sam Q8.
- **Billboard:** `LocationType.TEMPORARY`, which means "special-event setup", is a precedent for event locations.

**Missing or broken — the build must close these gaps, not assume them:**
- No event, booth, ticket, badge, tradeshow, festival, exhibitor, organizer, or staff-shift model anywhere.
- No **Brand** model. Tenancy is `vendorId` only.
- No **locations/warehouses** table. Commerce `InventoryItem.location` is free text, and canna inventory is one row per variant with no location.
- No **migrations**. Both apps use `prisma db push`, and commerce's `prisma:migrate` script has no migrations folder. Production deploy via `migrate.php` needs real, reviewable migrations before any event tables ship.
- No **role enforcement in canna**. `canna/app/api/checkout/route.ts` hard-codes `hasTwoFactor: true` and `licenceVerified: true`. This must be fixed, and covered by tests, before festival regulated flows depend on canna authorization.
- `prisma.priceOverride` is called by `commerce/src/lib/membership/overrides.ts` and `api/admin/pricing-overrides`, but the model is **not in the schema**, so retail price overrides fail silently. Event retail pricing (§6.3) needs this fixed or replaced.
- No wholesale **agreement / price-list** model. Today there are only per-product `priceBreaks`, and §6.3 requires dated, SKU-level, event-scoped agreements.
- No promotions, invoices, fee model, or tax calculation (only a `taxId` field). California cannabis excise, sales, and local taxes, and merchandise sales tax, are unimplemented.
- The commerce payment `adapters/` directory does not exist, so every registry provider except the Stripe pieces falls back to the mock. There is no processor-eligibility or category gating.
- No email or SMS provider (SMTP_URL and MAIL_FROM are planned only).
- No CSV/XLSX import pipeline.
- No QR or barcode support, no PWA/offline layer, no display/menu-screen code, no reporting beyond the commerce admin dashboard.
- Age and jurisdiction rule engines exist only as unmerged staging files under `canna/.dsh-staging/`. Commerce `Product.ageRestricted` is a flag with no enforcement.
- The lead record has **no consent / opt-in / unsubscribe field**, and the lead hub has **no authentication** (loopback-only writes), so authenticated event-staff capture needs auth added first.
- No real POS, Metrc, or payment credentials are configured. All drivers are sandbox or mock.

## 1. Mission and non-negotiable instructions

Implement a fully functional **Event Manager** in the current Ecom/Cannabis application for two *separate* event types:

1. **Tradeshow** — exhibitor/brand participation, booth assignment, event management, attendee check-in, and live lead collection integrated with the existing lead system.
2. **Festival** — participating brands, central event product marketplace and display menus, regulated cannabis POS inventory visibility, optionally independent nonregulated merchandise commerce, inventory custody, multi-POS reconciliation, and post-event brand settlements.

Do **not** create a hybrid third event type. Each type has its predefined workflow; use permitted per-event configuration *within* that type. Admins and approved event organizers can create and manage events.

**Reuse, do not rebuild:** First inspect the *actual* Ecom, Billboard, Solar, lead tooling, authentication, data schema, storefront, POS connectors, permissions, reporting, and existing UI components available in Shared Brain and source repositories. Reuse proven working Ecom/Billboard/Solar code and patterns, extending them only where necessary. Do not invent repository paths, API capabilities, integrations, credentials, or schemas. If a requested integration does not exist, identify that gap and implement an adapter or contract against the actual interfaces. Preserve compatibility with running deployments and do not overwrite unrelated functionality.

**Real data only:** The user has actual historical event data to upload. Never create or populate fake brands, contacts, attendees, events, products, inventory, transactions, lead records, financial results, or analytics *in production*. Do not silently fill missing data with guesses, extrapolation, fabricated sales, or placeholders treated as real. Isolated and clearly tagged synthetic test fixtures are allowed **only** in test databases/automated tests, never the production database, actual reports, or customer-visible data. Empty states must show as empty. Retain original uploaded files and provenance.

**Do the implementation work:** Discover the architecture, construct a dependency map, implement database changes safely, frontend and backend, connectors, tests, migration/import pipelines, documentation, and functional verification. Parallelize independent work through existing DSH/agent capabilities where available without creating merge conflicts or bypassing real dependency gates. Report verified accomplishments versus unresolved external access or compliance blockers; do not claim an integration works without exercising it.

**[Added]**
- **Data placement follows 280E separation:**
  - Regulated-cannabis entities live in canna's database: festival cannabis inventory, custody ledger, POS sales imports, cannabis settlements, and Metrc references.
  - Merchandise entities live in commerce's database.
  - Event core lives where E1 decides: event, schedule, booths, tickets, staff, equipment, and leads.
  - Cross-boundary links use opaque IDs and signed API calls with an outbox/inbox, idempotency keys, and audit, following solar-sam Q24. Never use foreign keys or joins across the two databases.
- **Synthetic-data flag:** every record type carries an `isSynthetic` flag, as solar-sam Q9 already set. Synthetic rows are excluded from all counts and reports, and the production deploy must reject them. Uploaded source files get an Evidence/provenance row: source, SHA-256, method, actor, and parent import.
- **Placeholders ledger:** maintain `PLACEHOLDERS.md` in every touched repo, as GATE0 requires. Every sandbox/mock adapter in use is listed there until it is replaced by a verified real integration.
- **Git:** commit locally on a dedicated branch, with no push. Route pushes through the gatekeeper queue only (shared rules).

## 2. Roles, permissions, and entry points

- **Company administrators:** Global financial oversight, retail prices, event fees and receipts, licensing policies, master inventory reports, configuration and audit access.
- **Approved event organizers:** May create/manage events, invite **existing Ecom brands and vendors directly** (this is the selected onboarding method), control event logistics, review/approve/reject/waitlist invitees, ask for documents, manage central staffing, permissions, POS/screen assignments, inventory, check-in, and closeout, subject to role policy.
- **Brand/vendor users:** Access their existing Ecom profile and permitted event dashboard for inventory, fees, lead management, sales visibility, staff registration, and settlement statements. They may nominate/manage associated staff identities and permissions to the extent allowed by the organizer; **event-wide shift/location/POS/station assignment is organizer-controlled**.
- **Event staff and attendees:** Least-privilege event-scoped access to tools/QR badges and areas as authorized; configurable registration types, requirements, and fees per event. Public attendees may purchase admission tickets where enabled, but participating brands/vendors are onboarded by organizer invitation rather than an open vendor self-application flow.
- Reuse existing Ecom identity, account and role systems, including any verified upstream Shared Brain/DSH Project Manager authorization mechanism. Enforce permissions in the backend as well as UI; audit sensitive actions. Cross-brand private data must not leak.

**[Added]**
- **Organizer role is new.** Today `users` has only `isAdmin`, `retailEnabled`, and `vendorEnabled`, and canna's enum is RETAIL_CUSTOMER / WHOLESALE_BUYER / VENDOR / ADMIN.
  - Add organizer, event staff, and attendee capabilities as **event-scoped grants** (an EventRoleAssignment-style table keyed by user and event), not as new global account types.
  - Keep `users` as the only identity issuer.
  - Event roles appear as JWT claims only if the users contract is extended, and the contract must be versioned.
- **Event invitation does not replace Ecom vendor onboarding.** Under GATE0, vendors apply and admin approves after a manual licence check. A brand can be invited to an event only if it is already an approved Ecom vendor; for cannabis, its `CannabisLicense` must also be verified and unexpired for the event dates.
- **Brand vs vendor:** no Brand entity exists yet (see E7).
- **Fix canna authorization first:** remove the hard-coded `hasTwoFactor` and `licenceVerified` from canna checkout and add `requireRole` parity with commerce. No festival endpoint may sit behind canna's current unenforced routes.

## 3. Event creation and operating model

- Event creation methods: **(A)** guided blank-event wizard and **(C)** predefined Tradeshow and Festival templates. **Do not make cloning previous events a required creation path**.
- Required metadata: title, description, type, dates/time zones, venue(s), locations/zones, organizer, jurisdiction(s), public/private/member visibility, capacity, schedules, booth/floor-plan configuration, staffing, required documents, compliance requirements, fees, admission, equipment/POS, brand participation, and status.
- Multiple days and locations are supported. Partition staff, inventory, POS results, leads, check-ins, sales and equipment by time/location while also providing consolidated event-level analytics and reconciliation.
- Provide per-event operational dashboards, schedules, setup/breakdown windows, delivery/receiving windows, staff shifts, site access, equipment lists, tasks, deadlines, logistics checklists, status, and alerts; support reusable *templates* and equipment profiles.
- Event lifecycle: draft -> configured -> registration/invitations -> approved/readiness -> active -> reconciliation/settlement -> **manual closeout**. Do not allow final closeout while required inventory reconciliation, settlements, or tracked unresolved issues remain outstanding. Record approvals and audit changes.

**[Added]**
- **Locations:** add a real Venue -> Zone -> Location model, with booths and POS stations as Location subtypes. Migrate commerce's free-text `InventoryItem.location` compatibly; do not break existing rows.
- **State machine:** implement the lifecycle as a server-enforced state machine. Every transition writes an AuditLog row. Canna does not have an AuditLog model yet: add one, or extend ComplianceRecord to cover it.
- **Readiness gate:** an event cannot enter `active` until every regulated location has a verified operator licence, event permit, and POS assignment for its dates. The readiness checklist must be computed, not just shown.
- **Time zones:** store UTC plus an IANA zone for each venue. Business-day partitions use venue local time, because POS end-of-day exports are local.

## 4. Brand participation, booths, and ticketing

- Organizer invites pre-existing Ecom brands/vendors; invitation outcomes include **approve, reject, waitlist, or request additional documentation**.
- Participation requirements/fees vary per event and role; allow invitations, registrations, document submission, organizer review, booth/space assignment and auditability.
- Booth/space tools: manually assign spaces, visualize/edit interactive floor plans, map booth dimensions and pricing, offer optional space selection when enabled, waitlist and approve applications/requests, manage sponsors and premium placements. Events can opt out of assigned spaces.
- Participant credentials, attendee tickets, VIP/exhibitor/staff badges, free or paid admission, restricted zones, QR/barcode issuance, scans and check-in/out; prevent credential reuse and handle capacity/permission enforcement. Public ticket sales do not imply public vendor applications.
- Event-specific web pages and a searchable event calendar/directory with details, schedule, brand rosters (public only where approved), registration/ticketing links, maps and branding; member-only/private configuration supported.

**[Added]**
- **Documents:** commerce `VendorApplication.documents` is a comma-separated string. Event documents need a proper EventDocument table:
  - type, status, reviewer, expiry, file hash
  - a pointer to storage through the existing `uploads.ts` (S3-compatible, SVG blocked)
- **Credentials:** QR codes carry opaque signed tokens. They never contain PII or a raw user ID. Each scan is recorded as a single-use or per-zone check-in event with device, time, and location. Server-side replay detection catches screenshots and shared codes.
- **Age gate:** GATE0 requires 21+, checked by DOB at entry and ID at checkout. For 21+ events, run the same check at ticket purchase and at the gate. Scanned-ID data follows §8 minimisation: store the verification result, not the image, unless law requires otherwise.
- **Membership tiers** (Free through Platinum) may gate member-only events or ticket discounts. Reuse `commerce/src/lib/membership/*`; do not create a second tier system.

## 5. Tradeshow: lead capture and lead governance

- Embed the **existing working lead tool**, not a parallel orphaned CRM.
- Support live lead capture by contact details, notes/tags, badge or QR scan, staff attribution, brand booth/location/day, follow-up status, and offline capture where feasible.
- Brands see and manage their **own** captured leads according to existing lead permissions. Organizers have event-wide dashboards, reporting, routing and management subject to established data access policies.
- Lead collection/assignment options, scanning, import/export and syncing are event-configurable. Deduplicate cautiously and log source, consent, handoffs, attribution and any assignments. No silent ownership changes. Respect existing Shared Brain/lead-assignment rules if present in real code.
- Reporting includes leads by brand, staff, venue/day, quality/status, and follow-up conversion if verifiable with existing records.

**[Added]**
- **Which lead tool:** the existing tool is the Lead Intelligence hub (:5180, `appTag` feeds, `ecomm` feed already present, `/api/review/owners`), on the `UniversalRecord` model. E4 decides where event leads attach.
- **Gaps the build must close in that tool, not around it:**
  - **Authentication:** the hub currently allows loopback-only writes. Event staff on the floor need authenticated writes using `users` JWTs.
  - **Consent fields:** add consent fields (see E5).
  - **Event attribution:** add `eventId`, `boothId`, `day`, and `capturedBy`.
  - **Brand-scoped read permissions:** brands see only their own leads.
- **Governance already decided** (solar-sam Q36–Q47); apply it:
  - New leads land in a Pending Review queue. Updates are flagged and never overwrite decisions.
  - Qualify, Reject, Duplicate, and Assign actions work individually or in bulk. Nothing is auto-rejected.
  - Each lead has **one responsible owner**; others get read-only access. Ownership changes are logged, admin can override, and reassignment is manual unless admin sets rules.
- **Dedupe:** event leads are people, not organizations, so the hub's org+website key needs a person-level key, such as normalized email or phone within the brand scope. Merge duplicates, never delete them, and keep a merge log.
- **Storage dependency:** the hub stores data in JSON. Its planned Prisma/MySQL database (solar-sam Q8) must land before multi-user event capture, or capture must write through a single-writer API with idempotency keys.

## 6. Festival: regulated cannabis vs nonregulated merchandise

### 6.1 Central marketplace and menus

- Use **one centrally managed event marketplace** aggregating authorized products from all participating brands, *not* independent checkout marketplaces per brand.
- Two explicitly partitioned product and transaction tracks:
  - **Regulated cannabis**: public/authorized-facing browse-only menus. Support responsive web pages, QR links, fullscreen event monitors, branded layouts, brand/category menus, specials/rotation and multi-screen remote management. **Do not implement web cannabis checkout/cart/reservation as an assumed capability. Actual sales and customer checkout happen exclusively using the appropriately licensed and authorized POS/operator process.**
  - **Nonregulated merchandise**: independent POS can be used, with full authorized web cart, checkout, QR ordering, reservations and promotions where configured, appropriate and supported. It can operate separately from cannabis POS and have its own reports/settlement path.
- Screens can show a common menu, brand-specific subsets, category-specific products, merchandise, specials, or custom schedule-based rotations. Include remote screen assignments, layouts, pricing, accessibility, content approval and auto-refresh.
- Integrate directly with **actual approved licensed POS systems** so cannabis menus receive validated available/sold-out signals, ideally SKU/location-aware and resilient to connectivity interruptions. Show a deliberate stale-data state when feeds become unavailable; never claim inventory is current when it is not. An unavailable or inconsistent status must not be interpreted as permission to sell.
- Events may use a participating regulated operator's POS, or **our company may bring and use its own license and POS where valid and permitted**. Model operating entity/license/POS assignment explicitly for each venue/date and transaction source. Do not assume one jurisdiction or licensing arrangement.

**[Added]**
- **Which systems back each track:**
  - Cannabis menus read from canna's catalog and its `DutchiePosDriver` / `TreezPosDriver` interface. GATE0 says POS is chosen per vendor org, behind one interface, and never hard-coded. Add an event/location-scoped availability read through that interface; do not write a new POS client beside it.
  - Merchandise checkout reuses commerce Cart/Order/ChildOrder and the payment adapter.
- **The festival cannabis menu is not a canna storefront.** canna's existing web checkout is for its members-only delivery/wholesale business. The festival menu must not link into the canna cart, because the browse-only rule in this section takes precedence for events.
- **Merchandise web checkout at an event** must not list or bundle cannabis SKUs, because the two catalogs live in separate databases by design.
- **Display screens:** no display code exists, so this is net-new.
  - Screens run as signed, device-bound kiosk URLs: an event-scoped token is revocable and carries no admin session.
  - Each screen sends a heartbeat. The admin screen manager shows last-seen and data age, using only the real heartbeat, never simulated telemetry.
  - When POS data is older than the configured threshold, the screen shows "availability not current" and hides sold-out/available badges.
- **California specifics, if the event is in California (verify current law before activation):**
  - Event sales need a state temporary cannabis event licence held by the event organizer, and only licensees authorized for retail sale at that event may sell.
  - Sales and inventory are tracked in Metrc under the event licence.
  - Product moves to and from the venue through licensed distribution and transport.
  - Model this as an EventLicence entity linked to the venue and dates, the operating licensee, and the Metrc facility/licence identifiers.
  - `MetrcComplianceDriver` must be extended for event-licence package movements and sales reporting, and stays sandbox until real credentials exist.

### 6.2 Inventory, custody, and reconciliation

- Brand submits initial product/SKU and expected quantities; organizer receives, verifies, counts, assigns locations and custody; log movements, restocks, samples, waste, damages, returns, and unsold stock.
- Capture opening count, received/transferred, adjustment reason, POS-recorded sold quantity, physical closing count, expected vs actual balance, discrepancies and operator signoff. Maintain a traceable inventory/custody ledger appropriate to local regulations and existing track-and-trace integrations.
- Support direct POS APIs when verified, import of real CSV/XLSX/POS reports, and manual count/adjustment with source and operator audit trail. **Never synthesize absent POS transactions to force balanced results.**
- Support distinct licensed cannabis and independent merchandise POS feeds, event/day/location/terminal separation, idempotent repeated imports, mapping and deduplication. Preserve source-file hash and origin.
- Reconciliation must be performed **after comparing inventory to actual sales reports**. Flag mismatches, duplicate SKU mappings, unaccounted movements, missing reports, returns, tax differences, rounding and unsupported POS fields. Prevent settlement approval until discrepancies are resolved or explicitly adjudicated with documented authorized reason.

**[Added]**
- **Two ledgers, by design:**
  - The **merchandise ledger** extends commerce's existing InventoryMovement: add event/location/custody columns and new movement reasons (received, transferred, sample, waste, damage, return, count-adjust).
  - The **cannabis ledger** is net-new in canna, because canna inventory today is one row per variant with no location and no movements. It is append-only. Each movement carries the Metrc package tag when one applies.
  - The two ledgers never join. Event-level dashboards aggregate them through an API.
- **Ledger rules:**
  - Ledger rows are immutable. Corrections are compensating entries with a reason and the approver.
  - Physical counts are their own record type: counter, witness, device, and time. They are never overwritten.
- **Import identity and mapping:**
  - Imports are keyed on (source system, file SHA-256, row natural key), so a re-import is a no-op.
  - The SKU mapping table between POS SKUs and Ecom Variant SKUs is versioned and reviewed. A POS SKU that maps to two Variants blocks reconciliation.
- **Sample/waste/damage** quantities in the cannabis ledger must be reportable in the form Metrc expects (adjustment reasons). Unmapped reasons block closeout.

### 6.3 Wholesale economics and brand payments

- Brands maintain **wholesale** relationships; ordinarily **they have no authority over final retail price**. They may offer suggestions, but **our company controls/configures retail prices and promotions**. Specific exceptions may be approved and scoped to a special event; no default delegation to brands.
- Track dated wholesale agreements, agreed SKU costs, special-event wholesale terms, allowances and authorized promotions. Financial calculations must use the applicable recorded agreement, not retail revenue split assumptions.
- Brand payouts/amounts owed are calculated **after confirmed sales-to-inventory reconciliation**, applying applicable negotiated wholesale prices/terms and documented adjustments. Record review, discrepancy resolution, approval, deductions, partial payouts, actual payment status, outstanding balances and exportable statements.
- Brand settlement statements include opening/received/returned/sold quantities, source POS references, negotiated wholesale prices, costs/credits, applicable charges/taxes where authorized, final owed amount, approval history and payment references.
- Do not automatically split cannabis retail card receipts among brands or infer that settlements can use consumer-card processor payouts. Account for actual merchant of record and payout channel eligibility.

**[Added]**
- **Pricing control is consistent with GATE0**, which already makes discounts platform-controlled and keeps vendors from setting tier discounts.
  - Implement event retail prices as event-scoped price overrides.
  - First add the missing `PriceOverride` model, which commerce code already calls without schema, and the equivalent in canna.
  - Brand "suggested price" is a separate, non-binding field with its own approval record.
- **New WholesaleAgreement model** with effective-from/to dates, per-SKU cost, event scope, allowances, and a signed/approved-by record.
  - The existing `priceBreaks`/`moq`/`casePack` stay for normal wholesale ordering.
  - Settlement math reads the agreement in force on the sale date.
  - If no agreement covers a sold SKU, settlement is blocked.
- **Settlement ledger:**
  - Cannabis settlements post to a persisted settlement ledger in canna. Today's `SettlementLedger` exists only in memory and must be made durable.
  - Merchandise settlements post through commerce's double-entry Journal and Payout models.
  - Both use the atomic claim-once pattern from `paymentConfirm.ts`, so no payout is recorded twice.
- **Payout rail:** canna wholesale rails decided in GATE0 are crypto, ACH, or invoiced terms. Stripe is rejected for cannabis. E10 decides which rail brand payouts use.

## 7. Event fees, payments, accounting, and profitability

- **Our company centrally collects** event registration, booth, sponsor/participation, admission and other permitted fees; event organizers do not independently collect these fees by default.
- Fees/pricing structures configurable per event and participant class. Manage invoices, deposits, discounts, refunds, tax handling, payment reminders, chargebacks, sponsorships, expenses, settlements, and P&L; integrate existing Ecom finance/accounting tools.
- **Payment processor suitability is a mandatory gate.** Reuse existing Ecom processors where allowed. Integrate Stripe **only for transaction/business categories that Stripe has explicitly approved for this company, jurisdiction, and use**. In particular, cannabis-related events, ancillary services, conferences and trade shows may be restricted even where cannabis is not sold via Stripe. Never assume cannabis retail payments, ticket fees or exhibitor fees can automatically go through Stripe, nor mislabel transactions to evade underwriting. Where approval is unavailable, mark provider unsupported and route to an actually authorized pathway or leave payment disabled pending compliance confirmation. Keep processor selection configurable by fee type and event.
- Maintain strict separation of cannabis POS receipts, merchandise POS receipts, company-collected event fees, wholesale settlement liabilities and operating expenses. Support actual bank/accounting reconciliation when connectors exist. Use auditable calculation logic, currency/tax definitions and refunds rather than display-only totals.

**[Added]**
- **Processor configuration:**
  - Implement processor eligibility as data: a ProcessorEligibility table keyed by (processor, fee type, event type, jurisdiction), with status `approved` / `pending` / `unsupported`, an evidence document, and who approved it.
  - The payment adapter refuses to create a charge unless the row is `approved`.
  - Seed nothing as approved. An admin records it with evidence.
- **Current reality:** only the Stripe pieces have real code, and it runs in test mode. The other registry providers fall back to the mock because the `adapters/` directory does not exist. GATE0 forbids live charges without separate go-live authorization. Event fees therefore stay sandbox until E9 is answered and the eligibility evidence is recorded.
- **New models:**
  - Invoice and Fee, attached to an event and participant.
  - Tax: no tax engine exists. Store tax rates as dated, jurisdiction-scoped configuration with source evidence; never hard-code them.
  - **Ledger placement:** event fees post to the commerce Journal unless E1 places event core elsewhere. Cannabis receipts never post to the commerce ledger.
- **QuickBooks:** reuse the existing QuickBooks Online sandbox sync. Map event fee, merchandise, and settlement accounts explicitly, and keep cannabis on its own books under 280E.

## 8. Legal/compliance and operator checks

- Configurable by jurisdiction, venue/event date, license holder and product category: relevant license types and expiration, temporary event permits, approved vendor/operator lists, local rules, age/identity verification where legally required, restricted-area permissions, required documents, waste/sampling policies, reporting obligations and retention.
- Track verification status and evidence. Disallow regulated POS assignment or active selling state without required operator/license approval; do not substitute the event tool for the licensed POS or state-required reporting system. Respect existing cannabis tracking infrastructure and verified approved integrations.
- Treat compliance requirements as **externally verifiable controls**; research/confirm current local and processor-specific requirements before activation. Flag unverified policies as blockers instead of claiming universal cannabis legality or payment eligibility. Protect customer data, scanned IDs and contact consent; store minimum necessary data and enforce encryption and retention access controls.

**[Added]**
- **Reuse:** CannabisLicense for operator and brand licences (add event-licence and local-permit types), and ComplianceRecord, written on pass and on fail.
- **Rules engines:** merge the per-jurisdiction rules engine and age rules from `canna/.dsh-staging/` once they are reviewed. Do not write a second engine.
- **Scope:** the canna jurisdiction is **California only** today. A festival in any other jurisdiction is out of scope until a rules pack and a track-and-trace driver exist for it (see E2).
- **Encryption:** credentials for POS, Metrc, and processors go only in the existing AES-256-GCM IntegrationSetting vault. PII fields in event tables (attendee contact data, ID verification results) are encrypted at the field level with the same key-management approach.

## 9. Messaging, staffing and equipment

- Reuse Ecom communication channels for role-targeted transactional messages: invitations, required documents, approval/rejection, payment reminders, event changes, schedules, operational alerts and emergency messages; honor opt-in/opt-out/consent rules and provider availability.
- Organizers centrally schedule and assign staff to booths, POS, intake, inventory, sales areas, check-in, screens and shifts, with clock/check-in data and permissions. Brands can register eligible staff but should not overrule organizer's event-wide assignments.
- Track POS units, scanners, tablets, printers, screens, connectivity equipment, custody/owner, maintenance, setup, inventory, deployment location and return. Manage remote screen/POS configuration using real connector features, never simulated device telemetry.
- Offline operations: queue authorized lead capture, check-in and inventory counts securely, sync with conflict resolution and idempotency; enable offline POS only where the **actual** POS supports it and the jurisdiction/processor permits it. Show unsynced and stale states prominently. Do not bypass licensing/payment compliance due to connectivity loss.

**[Added]**
- **Messaging:** "Ecom communication channels" today means the Notification / NotificationRule / PushSubscription models plus an in-memory `EVENT_REGISTRY`. No email or SMS provider is wired.
  - Make the registry durable: an outbox table with a retry worker.
  - Add the provider through the same adapter pattern used for payments.
  - Until a provider is configured, messages queue and show "not sent — no provider". They never show as delivered.
- **Offline:** no PWA or offline layer exists, so this is net-new.
  - Use a service worker plus an IndexedDB queue on capture devices. Each queued record has a client-generated UUID idempotency key.
  - The server merges by key and records conflicts for review; it never auto-overwrites.
  - Offline queues are encrypted at rest on the device and cleared after a confirmed sync.

## 10. Historical data imports and reporting — strict provenance

- User will supply **live historical records from previous events**. Build import interfaces for actual CSV, XLSX and supported original formats, mapped to existing Ecom brands, users, products, locations, POS and events.
- Stage imports for review; inspect source structure, detect duplicates and conflicts, validate links and totals, preview every change, then commit only after authorized approval. Preserve original files, checksums, import versions, row-level failures, actor/time, mapped fields and corrections. Provide rollback/compensation strategy without destructive overwrites.
- Historical dashboards and comparisons: event revenues, expenses/profit, attendance, ticketing, wholesale margin, inventory shrink/returns, brand/SKU performance, lead volume and lead conversions only where substantiated by real linked data. Allow day/location/brand breakdowns and cross-event comparison with data-quality and missing-source indicators.
- **No mock or inferred data in production. No arbitrary example customers, tickets, leads, sales or financial figures.** Analytics with incomplete records must show incomplete coverage, not invented totals. Clearly separate any calculations derived from verified raw inputs from raw measurements.

**[Added]**
- **No import pipeline exists.** Build one shared staging framework:
  - ImportBatch, ImportRow, FieldMapping (versioned), and Evidence (file SHA-256 and storage pointer).
  - Each target database (commerce, canna, event core) uses that framework but commits only into its own tables, which preserves 280E separation.
  - XLSX parsing runs server-side with formula evaluation disabled. Read cached values only; never execute macros.
- **Historical entities that do not match existing records** (a past brand that is not an Ecom vendor, or a past attendee) are staged as **unmatched**. They are never auto-created as vendors or users. An admin either links them or creates them explicitly.
- **Rollback** is a compensating batch that reverses a committed ImportBatch's ledger effects and marks its rows superseded. Nothing is hard-deleted.

## 11. Frontend and backend acceptance scope

Provide an integrated, production-grade solution including:

1. Ecom Admin/Event Manager landing page, event creation wizard and template selection.
2. Per-event organizer operations dashboard; brand/vendor event view; scoped staff and attendee views.
3. Invitation and review workflows; document/compliance screens; booth editor/floor plan; tickets, badge/QR check-in and restricted access.
4. Tradeshow lead capture and original lead system integration.
5. Festival centrally aggregated menu/remote display management, licensed-POS stock syncing, and separate nonregulated merchandise commerce.
6. Receiving/inventory/custody ledger; POS import/connectors; variance detection; reconciliation and controlled brand settlement approval.
7. Company-wide fee collection/payment routing and accounting, compliant processor eligibility checks and per-event financial reports.
8. Equipment, scheduling, task and communication tools; offline sync/status.
9. Secure historical upload/import review and real-data analytics.
10. Responsive, accessible interface reusing existing components, routes, design and authentication; backend authorization, validation, API tests and audit trail.

**[Added]** Use the shared frontend output of the ecom-final L-frontend lane. It is still in flight, so do not fork a new design system before it lands. Reuse its component library and routes.

## 12. Execution order and parallel build strategy

**Phase 0 — Inspect first.** Locate source-of-truth code and Shared Brain references. Produce a factual inventory showing what already exists vs missing for Ecom, Billboard, Solar, leads, POS, auth, finance, displays and design. Define an explicit reuse map and constraints. Do **not** initiate a greenfield rebuild.

**Phase 1 — Contract/design.** Implement minimal compatible data models, shared domain types, role permissions, event-type separation, compliance/payment gates, integration adapters, migration and audit design. Account for legacy/historical records and multi-day/location scope.

**Phase 2 — Parallel implementation, with isolated file ownership:**
- Workstream A: event management, invitation/booth/ticketing, staffing/ops and portal UI.
- Workstream B: tradeshow lead integrations and reporting.
- Workstream C: festival menus, screen manager, POS connectivity and product availability.
- Workstream D: inventory, importing, custody, reconciliation and settlement.
- Workstream E: company-collected fees, payment eligibility, accounting, licensing controls and reporting.
- Workstream F: historical import framework, QA, test harnesses, documentation, observability.

Share actual integration contracts first and coordinate merges; choose agent/model routing and paid/free seats through existing DSH tooling where available. Run independent work concurrently only after dependency boundaries are explicit.

**Phase 3 — Integrate end to end.** Wire actual user accounts, databases, APIs, existing tools and UI routes; validate referential and permission correctness. Avoid a set of visual pages with dummy endpoints.

**Phase 4 — Verify with isolated fixtures and real uploaded records when provided.** Automated unit, integration, API, UI/E2E, permission, accessibility, offline/reconnect, POS sync/outage, duplicate import, inventory variance, accounting and closeout tests. Synthetic fixtures are isolated to tests and cannot appear in production. Historical data validation only after actual files are provided; report honestly when absent.

**Phase 5 — Deploy and handoff.** Deploy only through the existing authorized deployment/test process. Provide evidence of tests, successful routes, real backend read/write operations, database migrations, integration status by provider, compliance prerequisites, and reproducible rollout/rollback notes.

**[Added]**
- **Phase 0.5 — prerequisite fixes.** These are small, gated, and go before Phase 2:
  1. Introduce real Prisma migrations in commerce and canna. The baseline migration is generated from the current schema and must show zero drift.
  2. Fix canna role enforcement and the hard-coded checkout flags.
  3. Add the missing `PriceOverride` model.
  4. Persist canna's SettlementLedger and catalog (L-canna may already cover part of this; check first).
  5. Add authentication and consent fields to the lead hub.
- **Dependency gates:**
  - Workstreams C and D (cannabis side) start only after ecom-final L-canna is merged.
  - All UI starts only after L-frontend is merged.
  - Workstream B needs the lead hub repo present on the build host. Today it exists only on vmixlaptop2x6.
- **Owners and conflicts:**
  - Schema files have **one owner per database**: commerce schema, canna schema, and event-core schema each have a single owning workstream. Other workstreams request changes through that owner, which prevents Prisma merge conflicts.
  - DSH seats follow the standing seat policy, and the user picks the roster per run. pm prepares runs and never dispatches them.
- **Tests:** Playwright E2E for user-facing flows, signing in with the seeded test identities (18 in users, 5 in canna; credentials in seed/example config only). `node --test` and vitest for unit tests, matching each repo's existing runner.

## 13. Explicit acceptance criteria

- Existing production Ecom functionality remains intact; no parallel recreated user, brand, product or lead databases.
- A tradeshow can be created from wizard/template, invite existing brands, assign booths/staff, issue credentials and capture leads in the actual lead tool, with brand-level and organizer-level reporting.
- A festival can aggregate participating-brand menus, render web/fullscreen displays, obtain sold-out status from an actual authorized POS or clearly mark sync as not configured/stale, maintain distinct regulated and merchandise workflows, and import/manually reconcile inventory versus actual POS sales.
- Admin/company has retail pricing control by default; brands have wholesale agreements and can suggest prices without editing retail prices.
- Finance produces documented per-brand wholesale settlements only after actual reconciliation and approvals; company centrally collects eligible event fees through approved pathways.
- Real prior-event records can be staged, mapped, approved, audited and compared without fake production data.
- Multi-day/multi-location, configurable access, offline status, inventory traceability, licensing/payment checks, staff/equipment management and manual final closeout work end to end.
- Missing licenses, unsupported Stripe usage, absent POS API access, unverified historical source files, or real integration blockers must be explicitly reported and **never silently mocked as complete**.

**[Added]**
- No foreign key, join, or shared table between the commerce and canna databases. An automated test asserts this.
- A synthetic row cannot be committed to a production database. A deploy-time check fails on any row with `isSynthetic = true`.
- Re-importing the same file twice changes nothing. This is tested.
- A charge attempt against a processor whose eligibility row is not `approved` is refused. This is tested.
- Festival screens show the stale state when the POS feed is stopped. This is tested by actually stopping the sandbox feed.
- `PLACEHOLDERS.md` lists every sandbox or mock adapter still in use at handoff.

## 14. Required completion report

Provide a compact evidence-based report: changed/added modules, what was actually reused, migrations, endpoints, UI routes, integrations and approval status, test commands/results, unresolved external prerequisites (including actual Stripe/cannabis payment eligibility), data provenance safeguards, known limitations, and next real validation steps. Prefer links or file paths and verified outputs over broad claims. Do not claim deployment or processor/POS certification without evidence.

**[Added]**
- Name the model that produced each claim, as the shared rules require.
- Append the result to `shared-agent-log.md`.
- Update the pm task; do not hand-edit `pm.db`.
- Commits stay local and go to the gatekeeper queue; no push.

---

**Requirement source:** User-approved 36-question design interview. Key superseding corrections: Q24 = organizer invites existing Ecom brands/vendors (**A**, not public self-applications); Q20 = cannabis display/browse-only with licensed POS sale, while merchandise may offer full independent commerce; Q31 = company sets retail prices because brand relationships are wholesale; Q34 = manual final closeout **only after** reconciliation/settlements/issues are resolved; Q36 = full reuse, implementation and testing. Always prioritize these explicit final user clarifications over generic option wording.

**[Added] Binding prior decisions that also apply:**
- `ecom-final/GATE0-DECISIONS.md`:
  - three repos, with 280E separation between commerce and canna
  - canna is California / Metrc CA only
  - Stripe is rejected for cannabis
  - POS is Dutchie and Treez behind one interface
  - platform-controlled discounts
  - 21+ age gate
  - MySQL with Prisma
  - deploy to DreamHost VPS with PM2
  - no live charges without go-live authorization
- `solar-sam-integration-decisions.md`:
  - Q8 lead DB
  - Q9 evidence and `isSynthetic`
  - Q24 cross-DB sync
  - Q36–Q47 lead review queue and single owner

---

## Questions for ChatGPT Q&A Review

Ask one at a time. Combinations such as `A & C` are allowed wherever they make sense. "Other" always accepts a custom answer.

**E1. Where should the Event Manager core live?** It covers events, schedules, booths, tickets, staff, equipment, and fees. Cannabis inventory and sales must stay in canna; merchandise stays in commerce.
- A) Inside `commerce`, as a new module
- B) A new `events` repo/service with its own DB, linked to commerce and canna by API
- C) Split: tradeshow and festival core in `commerce`, festival cannabis parts in `canna`
- D) Other (describe)

**E2. Which jurisdictions must festivals support at launch?** canna supports California / Metrc only today.
- A) California only
- B) Philippines
- C) Other U.S. states (name them)
- D) Other (describe)

**E3. Does the company currently hold a cannabis licence it would use to sell at festivals?**
- A) Yes, a retailer licence
- B) Yes, a microbusiness or other sales-authorized licence
- C) Yes, a temporary cannabis event organizer licence
- D) None yet; festivals will use participating operators' licences
- E) Other (describe)

**E4. Which lead tool should tradeshow leads go into?**
- A) The standalone Lead Intelligence hub (:5180), with authentication added
- B) The copy embedded in billboard-platform
- C) Event lead tables that sync into the hub's ecomm feed
- D) Other (describe)

**E5. How is lead consent captured at the booth?** The lead tool has no consent field today.
- A) Explicit opt-in checkbox at capture, recorded per brand
- B) Implied by ticket or badge terms when the badge is scanned
- C) A, with B as a fallback for badge scans
- D) Other (describe)

**E6. Who can be an "approved event organizer"?**
- A) Internal company staff only
- B) External partner organizations as well
- C) Both, with external organizers limited to their own events
- D) Other (describe)

**E7. How should "brand" relate to "vendor"?** No Brand model exists, and tenancy is per vendor.
- A) Treat each vendor as one brand
- B) Add Brand under Vendor (one vendor, many brands)
- C) Other (describe)

**E8. Which licensed POS do you have real API access to, or can get it for?** Dutchie and Treez drivers exist in sandbox form.
- A) Dutchie
- B) Treez
- C) Another POS (name it)
- D) None yet; use real CSV/XLSX POS exports only

**E9. Which processor should collect event fees?** These are tickets, booth, and sponsor fees.
- A) Stripe, once the company records approval for this category
- B) PayMongo
- C) Crypto, ACH, or invoice
- D) Manual or offline invoicing at first, with online payment disabled
- E) Other (describe)

**E10. How are brand wholesale settlements paid out?**
- A) ACH
- B) Check or manual bank transfer, with the payment reference recorded
- C) Crypto
- D) Invoiced terms (net-X)
- E) Other (describe)

**E11. What runs merchandise sales at the festival?** commerce has no POS.
- A) commerce web checkout on staff tablets
- B) Square
- C) Another POS (name it)
- D) Other (describe)

**E12. What hardware will run the festival menu screens?**
- A) Smart TVs with a built-in browser
- B) Streaming sticks or Chromebox-style players
- C) Laptops or tablets driving monitors
- D) Other (describe)

**E13. Must ticket buyers and attendees have a `users` account?**
- A) Yes, always
- B) No; guest purchase with email, account optional
- C) Account required only for 21+ or member-only events
- D) Other (describe)

**E14. What formats is your historical event data in?**
- A) CSV / XLSX spreadsheets
- B) POS exports (name the system)
- C) PDFs or scanned paper records
- D) Other (describe)

**E15. When should the event build start, relative to ecom-final (16/21 done)?**
- A) After ecom-final finishes all 21 steps
- B) Phase 0–1 (inventory and contracts) now; implementation after L-canna and L-frontend merge
- C) Now, in parallel
- D) Other (describe)
