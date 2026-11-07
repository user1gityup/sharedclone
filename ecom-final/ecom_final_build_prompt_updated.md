# ECOM — FINAL BUILD PROMPT
## COPY BILLBOARD + REUSE SOLAR FEATURES + MODIFY EXISTING ECOM — DO NOT REBUILD

## PRIMARY DIRECTIVE

Build the existing **Ecom** project into a fully functional multi-vendor marketplace with a working frontend, backend, database, authentication, authorization, APIs, test users, role-based portals, commerce workflows, inventory, membership logic, accounting integration points, and end-to-end browser-tested user flows.

**DO NOT BUILD ECOM FROM SCRATCH.**

The correct strategy is:

**EXISTING ECOM**
+
**WORKING BILLBOARD CODE**
+
**WORKING SOLAR / GREEN-ENERGY FEATURES**
+
**ECOM-SPECIFIC COMMERCE FUNCTIONALITY**
=
**FINAL WORKING ECOM**

The goal is not to reproduce functionality independently.

The goal is to find the working implementation that already exists in Billboard or Solar, copy/reuse it into Ecom, and modify only what Ecom actually requires.

If Billboard already solves something, use the Billboard implementation.

If Solar has a tool or feature Billboard does not have, use the Solar implementation.

Do not waste time creating a Billboard-vs-Solar comparison simply for comparison's sake.

Use the correct source for each capability. Preserve valid existing Ecom code before importing anything. Review the **original build prompts and subsequent update/fix instructions for Billboard and Solar** when available, in addition to working source code, to identify proven implementations and user requirements. Never replace a working feature just to recreate it.

**DECISION PRECEDENCE:** These are the consolidated later user decisions. They override older interview drafts or previously completed Ecom prompts wherever inconsistent. Do not restart the interview or ask already-answered questions.

- Separate wholesale and retail catalogs; wholesale MOQ, case packs, and quantity price breaks; wholesale eligibility requires membership/account status **and** admin approval.
- Retail and Vendor can coexist on one non-admin account; Admin is a **separate privileged account**.
- Vendors **apply** and must receive **admin approval** before selling; onboarding is **not invitation-only**. Existing invitations can remain an optional mechanism, not a prerequisite.
- Membership: **Free, Bronze, Silver, Gold, Platinum**, with administrator-configurable benefits and pricing rules.
- **Full functional payments** built from existing integrations and only the missing additions. Use safe test/sandbox transactions for verification; do not charge real customers without separate explicit go-live authorization.
- **Advanced distributed inventory** and **advanced multi-vendor fulfillment**, not basic stock and order-status stubs.
- Browser/E2E tests are mandatory with the lightest existing compatible toolset; hybrid 2FA test strategy.
- After inspections, create a reuse map **and DSH execution plan**, and stop for approval before changing Ecom code.
- Protect Billboard/Solar read-only. Use existing Git workflow safely, keep the required docs/test/handoff artifacts, preserve the current stack, stop and ask on material unknowns, and propose optional refactors **one A/B/C/D decision at a time**.

---

# 1. SOURCE PROJECT RULES

## Ecom

Ecom already exists.

Do not create a new Ecom project or invent a new location.

Before making changes:

1. Locate the existing Ecom project in the current Claude/environment context.
2. Confirm the exact filesystem/repository path.
3. Inspect its current git state, branch, working tree, and existing structure.
4. Preserve any valid existing Ecom work.

If the exact Ecom path cannot be confidently located, **STOP AND ASK**.

## Billboard

Primary working reference implementation:

`~/Documents/claudecode/billboard-platform`

Billboard is **READ-ONLY**.

You may inspect it, run it if needed, copy code from it, reuse patterns from it, and reference its git history if useful.

You may **not modify Billboard**.

## Solar

`green-energy-platform` is the Solar project.

Locate and confirm its exact path automatically before use.

Solar is **READ-ONLY**.

You may inspect and copy from Solar but may not modify the original Solar project.

## Original prompts and updates

Locate and read the actual original prompts, subsequent updates, handoffs, fix notes, and existing build plans used for both projects **when present in accessible history/files**. Use them to determine what a proven capability does and its constraints. If history is missing, do not fabricate or delay the build for speculative reconstruction; inspect the working implementation. Copy only the needed capabilities from the right source. Keep an evidence/path pointer to each reused source.

---

# 2. SOURCE-SPECIFIC REUSE — NO UNNECESSARY DELTA EXERCISE

Do not perform a large Billboard-versus-Solar comparison just to create a report.

Instead, identify which project already contains each capability Ecom needs.

For every reused subsystem, record:

| Capability | Source project | Source path | Ecom destination | Action | Notes |
|---|---|---|---|---|---|
| Auth | Billboard | `...` | `...` | copy/modify | preserve behavior |
| Feature X | Solar | `...` | `...` | copy/modify | Solar-only feature |
| Commerce Y | New | — | `...` | build new | no source equivalent |

Allowed Action values:

- `copy unchanged`
- `copy and rename`
- `copy and modify`
- `extend`
- `new`

The source/reuse map replaces any requirement for a generic `solar-deltas.md` comparison.

---

# 3. PHASE GATE — REUSE MAP + DSH EXECUTION PLAN

Before changing Ecom application code:

1. Inspect existing Ecom and source projects read-only.
2. Create a concrete `docs/reuse-map.md` with **existing Ecom / Billboard / Solar / new** ownership and exact source/destination paths.
3. Create `docs/dsh-execution-plan.md` describing task breakdown, dependencies, safe parallel pipelines, DSH/project-manager routing, suitable local/subscription/paid seats selected by the existing weight checker, tests, rollback/checkpoints, and validation evidence.
4. Present **both artifacts together** for the user's approval. **STOP AND WAIT FOR APPROVAL.** Do not make Ecom implementation changes before that gate.

Do not modify DSH's architecture or its existing rules to execute this plan. Do not start code-writing swarms before approval. After approval, run independent tasks in parallel when safe, retain functional integration checkpoints, and never allow competing migrations/edits to collide. This approval is a hard gate, not an invitation to reopen answered requirements.

---

# 4. ECOM DOMAIN

Ecom is a:

- multi-vendor marketplace
- B2B wholesale marketplace
- B2C retail marketplace
- membership-based store

B2B and B2C are both first-class parts of the platform.

Membership is structural to the business model.

The buyer pays membership fees to **Ecom/platform**, not to individual vendors.

---

# 5. V1 CORE COMMERCE AREAS

V1 must include working implementations for:

1. Product
2. Brand
3. Customer
4. Membership
5. Cart
6. Accounting
7. Inventory
8. API tie-ins

Additional objects needed to make these work correctly — such as Orders, Order Items, Vendor/Organization relationships, pricing rules, inventory records, fulfillment states, membership benefits, and payment records — should be added only as required by the approved architecture.

Do not create unnecessary speculative systems.

---

# 6. WHOLESALE AND RETAIL CATALOGS

Wholesale and retail use **separate catalogs**.

Do not model wholesale as merely a second price field on the retail product.

The system should support:

```text
RETAIL CATALOG
├── Retail Product A
├── Retail Product B
└── Member-only Product C

WHOLESALE CATALOG
├── Wholesale Product A / Case Pack
├── Wholesale Product B / Bulk Pack
└── Wholesale-only Product C
```

Shared underlying data may be reused where appropriate, but the catalog experiences and business rules remain distinct.

---

# 7. WHOLESALE QUANTITY AND PRICING RULES

Wholesale v1 must support:

- MOQ / minimum order quantity
- case packs
- tiered quantity price breaks

Example:

```text
Wholesale SKU

MOQ: 12
Case Pack: 6

12–47 units   → $8.00 each
48–99 units   → $7.25 each
100+ units    → $6.50 each
```

These rules must be enforced in backend validation and pricing logic, not just displayed in the UI.

---

# 8. WHOLESALE ACCESS

Wholesale access requires BOTH:

1. the correct membership/account type
2. admin approval

A user should not gain wholesale access simply by toggling a frontend setting.

Wholesale eligibility and approval must be enforced server-side.

---

# 9. USER ROLE MODEL — RETAIL + VENDOR COMBINED, ADMIN SEPARATE

A single non-admin user account **may hold both Retail/Member and Vendor roles**. Do not force separate Retail and Vendor logins/accounts when a person legitimately needs both experiences. Access and organizations remain explicit and enforced on the server.

```text
Regular user identity
├── Retail / Member role and tier
└── Vendor role and vendor-organization membership (when approved)

Separate privileged administrator identity
└── Admin role (not combined with Retail or Vendor on that account)
```

Implement role-scoped navigation, portals, memberships, organization isolation, least-privilege authorization, and server-side enforcement. A Retail+Vendor user can switch between permitted experiences without gaining Admin permissions. Preserve the working existing auth/session architecture; extend role associations only where required.

Wholesale buyer eligibility is separate from being a vendor/seller: wholesale catalog access still requires the correct membership/account type **and** admin approval. A vendor may have multiple permitted organizational users as the existing organization/permission architecture allows.

---

# 10. VENDOR ONBOARDING — APPLICATION + ADMIN APPROVAL

**Vendor onboarding requires Ecom admin approval, not invitation-only registration.**

```text
Prospective vendor applies / registers
       ↓
Vendor application + organization data persisted
       ↓
Pending administrative review
       ├── Approved → activate selling privileges and vendor portal
       └── Rejected / needs info → no selling privileges
```

No applicant may publish live listings, sell, receive vendor payouts, or use protected seller functions until approved server-side. Support approved/rejected/pending states, status visibility and admin review. An existing admin-invite feature may be retained as an optional alternate entry path, but **an invitation must not be required to apply**. Do not confuse vendor selling approval with wholesale buyer approval; they are distinct permissions and processes.

---

# 11. RETAIL MEMBERSHIP MODEL — FIVE CONFIGURABLE TIERS

Retail supports Free plus paid membership tiers:

```text
Free → Bronze → Silver → Gold → Platinum
```

All **five tiers** must exist in v1 as administrator-configurable membership offerings; do not hardcode benefits/discount amounts or infer automatic values from tier names. The buyer pays membership fees to **Ecom/platform**. Free registered users can shop eligible retail products; paid membership may confer pricing/benefits and access to member-only items.

Membership must control **both** (a) benefits/pricing and (b) eligible products/catalog access; enforce eligibility in server/API logic, not only by hiding UI elements. Follow the platform-owned tier pricing and product-level override policy in Sections 12–13. Support legitimate tier changes and the membership/payment state needed for a real end-to-end membership flow.

---

# 12. MEMBERSHIP BENEFITS SYSTEM

Membership benefits must be configurable by platform administrators.

Benefits may include:

- tier pricing discounts
- member-only products
- shipping benefits
- early access
- exclusive drops
- purchase limits
- special promotions

Do not hard-code every benefit into separate UI logic.

Use a structured benefit/rule model where appropriate.

---

# 13. MEMBERSHIP PRICING CONTROL

Membership discounts are controlled by **Ecom/platform**, not by vendors.

The platform may define default discounts by tier.

Platform administrators may also configure product-level pricing overrides.

Example:

```text
Gold default discount = 15%

Product A
→ uses Gold default = 15%

Product B
→ platform product override = 25%

Product C
→ no membership discount
```

Product-level platform rules override general tier defaults when configured.

Vendors do not set membership-tier discounts.

---

# 14. ADVANCED DISTRIBUTED INVENTORY

Inventory must use an **advanced distributed model** across sellers, platform-owned stock, and distinct storage/fulfillment locations. It is more than a simple SKU-level quantity field or in-stock badge.

Preserve the previously selected **hybrid ownership**: inventory can be vendor-owned or Ecom/platform-owned. The approved design must accommodate, using the existing implementation wherever possible:

- Vendor/organization, owner, SKU/variant, stock location / warehouse association, available and reserved stock.
- Real-time/transactionally safe allocation and decrement, restock, corrections, release of reservations, and stock consistency during concurrent purchases.
- Multiple locations or vendor-controlled fulfillment sources; visibility scoped to the authorized organization/location.
- Low-stock thresholds, out-of-stock handling, stock-change audit/history, stock movements/transfers where applicable, and replenishment workflows where required by the existing business model.
- Cross-vendor carts/orders that reserve and consume **the correct vendor's or platform location's** stock, without overselling or exposing another vendor's inventory.
- Working administrative/vendor management screens tied to real APIs and database persistence.

Do not silently choose an external inventory service or fabricate warehouse/business rules. Reuse the right Billboard/Solar/Ecom tools first; log material unknowns for the required one-question-at-a-time stop/approval process. Add E2E and concurrency/integration tests for multi-owner and multi-location cases.

---

# 15. ADVANCED MULTI-VENDOR ORDERS AND FULFILLMENT

V1 requires **advanced multi-vendor fulfillment**, not just a single status field. A buyer may purchase across independent vendors and platform-held inventory in one checkout.

```text
Buyer cart (vendor A + vendor B + platform stock)
                      ↓
              Master order / payment
                      ↓
        Split into authorized seller/location fulfillments
           ├── Vendor A order/lines → fulfillment A
           ├── Vendor B order/lines → fulfillment B
           └── Platform order/lines → fulfillment C
                      ↓
        Track line items, shipments and status separately
                      ↓
        Reconcile buyer-facing master status and settlement
```

Implement the actual models and UI/backend workflows needed for order lines, seller ownership, allocated inventory, shipping/fulfillment responsibility, tracking, partial shipments, holds, cancellations, returns/refunds and relevant accounting/payout states. Prevent vendors from reading or mutating other vendors' items or addresses beyond authorized scope.

Use a persisted status workflow (e.g., Pending → Paid → Processing → Shipped → Delivered, plus On Hold / Rejected / Cancelled / Refunded) and extend to **partial/mixed** fulfillment states where needed. Keep payment, inventory, fulfillment, and vendor settlement transitions consistent, retry-safe, and auditable.

Do not claim completion based on mocked shipment data or a single order record with no working split or fulfillment behavior. Where a shipping carrier or regulatory requirement is genuinely unspecified, stop for that **specific** material decision; do not invent a carrier or live integration.

---

# 16. AGE-RESTRICTED PRODUCT WORKFLOW

Age-restricted products must not follow the exact same flow as ordinary products.

The system must support a separate compliance workflow that can include:

```text
Product added to cart
        ↓
Age-restriction detected
        ↓
Required eligibility / age verification
        ↓
Order eligibility decision
        ↓
Allowed fulfillment path OR blocked/on-hold path
```

Implement only lawful/compliant mechanisms appropriate to the operating jurisdiction and integrations available.

Do not invent legal requirements.

If a required compliance rule is not defined or cannot be determined from the existing project requirements, **STOP AND ASK**.

---

# 17. REGULATED CANNABIS PRODUCT WORKFLOW

Regulated cannabis products require a **separate regulated workflow** from ordinary products and from generic age-restricted products.

Architecture must support compliance gates such as:

```text
Regulated product
      ↓
Eligibility checks
      ↓
Jurisdiction / account / age / compliance gates
      ↓
Approved regulated order path
      OR
blocked / on-hold / admin-review path
```

The implementation must not assume that ordinary shipping, payment, fulfillment, or interstate commerce rules apply.

Do not invent legal/compliance rules.

Do not implement any bypass.

Where compliance requirements are underspecified, **STOP AND ASK** before implementing that portion.

---

# 18. FULL PAYMENTS — REUSE EXISTING INTEGRATIONS, ADD WHAT IS MISSING

Payments are **in scope as functional commerce capabilities**, not merely a cart or an order stub. Reuse any working payments, billing, invoicing, payout, webhook, and refund primitives from Billboard/Solar/Ecom; extend only what is needed to handle:

- Retail and approved wholesale checkout, including multi-vendor carts and order breakdowns.
- Ecom membership fees, tier changes, renewals/cancellations as supported by approved membership rules.
- Payment authorization/capture, success/failure/pending handling, durable transaction records and idempotent callbacks/webhooks.
- Refunds/adjustments and applicable vendor splits, payout/settlement/accounting states.
- UI ↔ server/API ↔ authorization ↔ payment processor/test adapter ↔ database ↔ order/inventory/membership state.

**Testing and safety boundary:** Implement the full functional paths but validate through **TESTNET/SANDBOX MODE ONLY** for this build. No real charges, production payment credentials, live payouts or live merchant processing without **separate explicit go-live authorization**. Sandbox-only testing is *not* permission to omit refunds, membership fees, splits, order accounting, or required payment flows.

```text
Cart / membership checkout → validated payable amount
→ sandbox processor / existing reusable gateway
→ verified payment event
→ persisted payment + accounting records
→ membership activation / order + vendor lines + inventory update
→ complete buyer/vendor/admin UI state
```

Do not invent payment processors. If existing payment tooling is insufficient, identify the precise missing integration and stop for any materially new provider or contractual decision.

---

# 19. AUTHENTICATION STACK

Preserve the existing authentication/session implementation from Billboard/Solar unless the approved reuse map demonstrates a different existing Ecom implementation that must remain.

Inspect and reuse where applicable:

- `lib/auth.js`
- `lib/session.js`
- `middleware.js`
- Prisma
- MySQL
- `bcryptjs`
- AES-256-GCM encryption
- JWT session cookies
- pending-2FA cookies
- Google OAuth
- Meta OAuth
- shared User identity handling
- X-Forwarded-For-aware rate limiting

Do **not** replace this with Better Auth or another authentication framework without explicit user approval.

Authentication and authorization remain separate.

Permissions must be enforced server-side.

---

# 20. 2FA TEST STRATEGY

Use a mixed 2FA testing model.

Most development/test accounts may bypass 2FA for speed.

At least one dedicated test user must exercise the full 2FA flow, including where applicable:

```text
Login
 ↓
Pending 2FA state/cookie
 ↓
Code entry
 ↓
Verification
 ↓
Normal authenticated session
```

The test plan must include this dedicated full-flow test.

---

# 21. WORKING TEST USERS

Reuse the working Billboard test-user/development-user approach wherever possible. Inspect its user, organization, seed, password, session, role, email/verification, 2FA and permission mechanisms.

Seed and **actually sign in with** working Ecom users for:

- A separate privileged Admin account.
- An applicant/pending Vendor account and an approved Vendor account.
- Retail **Free**, **Bronze**, **Silver**, **Gold**, and **Platinum** accounts.
- A combined Retail + Vendor non-admin account.
- Approved and non-approved **wholesale buyers** with the account/membership gate independently exercised.
- At least one dedicated **full 2FA** account (routine dev users may use a safe test-only simplified login).
- Tests across two separate vendor organizations and platform-owned inventory/fulfillment.
- Age-restricted/regulated-product scenarios where the compliance design permits a lawful test boundary.

Document safe development setup, seeded identities, tier, approval/organization state, how to exercise them, and evidence of real login. Do not place production secrets in artifacts. All routine dev-only auth shortcuts must be inaccessible in production.

---

# 22. FULL FRONTEND + BACKEND REQUIREMENT

A feature does not count as complete unless the full path works:

```text
UI
 ↓
API / server action
 ↓
authentication
 ↓
authorization
 ↓
validation
 ↓
business rules
 ↓
database
 ↓
response
 ↓
updated UI
```

Do not mark something complete simply because a screen renders.

No major feature may consist of a button with no connected backend behavior.

Avoid:

- dead buttons
- fake counters
- fake dashboards
- hard-coded inventory pretending to be live
- fake users presented as real test accounts
- mocked production behavior
- frontend-only forms
- TODO backend handlers
- placeholder API results presented as complete

---

# 23. DATABASE STRATEGY

Do not design an unrelated database from scratch.

Start from the approved existing code and models.

Identify:

### A. Models that can be reused unchanged
### B. Models that can be extended
### C. Billboard/Solar-specific models that should be transformed
### D. New Ecom models genuinely required

Preserve existing conventions where possible for:

- IDs
- timestamps
- ownership
- organizations
- memberships
- relationships
- indexes
- uniqueness
- foreign keys
- audit records
- encryption
- soft deletion if already used

Use migrations properly.

Do not perform destructive migrations without stopping for approval.

---

# 24. ACCOUNTING

Accounting is in scope for v1.

Before building anything new, inspect Billboard and Solar for reusable:

- ledger patterns
- invoices
- transaction records
- payout records
- payment records
- settlement logic
- reporting utilities

If the exact accounting scope required to finish a feature is not defined by existing Ecom requirements or source implementations:

**STOP AND ASK.**

Do not invent a full accounting system.

---

# 25. API TIE-INS

API integration capability is in scope.

Reuse existing API architecture and utilities first.

Do not create a new API framework if the existing stack already handles the requirement.

If a specific external API/integration is required but not specified:

**STOP AND ASK.**

Do not invent external vendors or dependencies.

---

# 26. SECURITY

Carry forward existing security practices.

At minimum preserve:

- server-side authorization
- secure session cookies
- password hashing
- rate limiting
- CSRF protection where applicable
- input validation
- protected admin APIs
- organization isolation
- user data isolation
- OAuth state protection
- 2FA handling
- encryption of sensitive information
- upload validation
- audit logging
- database constraints
- no committed secrets

Do not rely on client-side role checks for security.

---

# 27. LIBRARY / FRAMEWORK RULE

Use the existing stack first.

Small supporting packages may be added where genuinely necessary.

Claude must **ASK FOR APPROVAL BEFORE**:

- replacing the ORM
- replacing database tooling
- replacing auth
- upgrading a major framework version
- replacing the CSS/UI framework
- adding/replacing a major state-management system
- introducing a new backend framework
- making another major architectural stack change

Do not modernize the stack just because a newer option exists.

---

# 28. PROPOSED DESIGN / REFACTOR UPDATE PROTOCOL

This rule is mandatory.

When Claude identifies a possible **design change, refactor, UI redesign, architecture improvement, or non-required cleanup**, do not silently implement it.

Present proposed updates to the user in the same one-question-at-a-time format used during the design interview.

## Required format

- ONE decision per turn
- No essays
- Use concise **A / B / C / D** choices
- Give a short explanation for each option
- Show a **live working example, mockup, or functional example** whenever the decision can be demonstrated
- Wait for the user's answer before presenting the next proposed update
- The user may answer with only `A`, `B`, `C`, `D`, or a combination

Example:

```text
PROPOSED UPDATE — Vendor Dashboard Navigation

A — Keep current navigation
[working example]

B — Sidebar navigation
[working example]

C — Top navigation
[working example]

D — Hybrid
[working example]

A, B, C, or D?
```

Do not bundle multiple proposed design decisions into one question.

Do not provide long design essays.

Do not implement the proposed update until the user selects/approves it.

Required Ecom functionality may proceed according to the approved build plan.

This approval protocol specifically applies to optional redesigns, refactors, cleanup, or alternative design choices that go beyond the approved requirements.

---

# 29. WHEN REQUIREMENTS ARE UNDERSPECIFIED

If an important requirement is underspecified:

**STOP AND ASK.**

Do not guess.

Do not silently choose a conservative default for material decisions.

This applies especially to:

- architecture
- database structure
- security
- permissions
- payments
- compliance
- regulated products
- age-restricted products
- destructive changes
- new major dependencies
- unclear business behavior

Use the one-question-at-a-time A/B/C/D format when the question represents a design decision.

---

# 30. TESTING STRATEGY — REAL BROWSER/E2E VALIDATION

**Real browser E2E testing is mandatory** for critical workflows; use the **lightest compatible existing** unit/integration/browser toolset available in Ecom/Billboard/Solar. Do not add unnecessary testing frameworks. Inspect and run the actual available scripts, record commands and results in `docs/test-plan.md`.

Cover at least:

- Signup/login/logout, session persistence, separate Admin identity, combined Retail+Vendor identity, wrong-role and unauthorized API access.
- Free, Bronze, Silver, Gold, Platinum tier access, configurable benefits, product access overrides and membership checkout.
- Vendor application, pending/approved/rejected state; no selling before approval.
- Wholesale eligibility **plus** approval, distinct catalogs, MOQ, case packs, quantity breaks, prohibited-price access.
- Vendor and admin portals, buyer cart and working payment processor **sandbox** checkout, decline/retry, memberships, refunds, multi-vendor financial state.
- Distributed inventory ownership/location tracking, reservations, decrement/release/restock, simultaneous purchases and organization isolation.
- Cross-vendor master order, child seller orders/shipments, partial delivery, status changes, holds/cancellations/refunds, vendor visibility isolation.
- Routine simplified dev 2FA plus **one complete production-equivalent 2FA flow**.
- Invalid login, validation failures, audit/security checks, age-restricted and regulated-product paths at their approved legal/test boundary.
- Responsive/mobile core workflows.

Do not stop at compilation or claim unexecuted tests as passing. Each required feature must survive real UI → API/business logic → persistence → UI verification. Document failures, blockers and remaining tests honestly.

---

# 31. GIT / CHECKPOINT STRATEGY

Continue the **existing Ecom** project's proven branch/repository workflow safely. First inspect the current working tree, active runs, pending changes, current branch, and history; do not assume the project is empty or overwrite concurrent work. If there is no established workflow, use a dedicated Ecom build branch rather than making destructive main-branch changes.

Make stable, documented checkpoint commits after approved logical phases; never commit generated secrets, production credentials, or broken/unchecked work. Do not change Billboard or Solar, perform destructive git operations, force push, or modify a shared remote without express permission. Include exact commit/branch evidence in the handoff. Do not change DSH routing/configuration implicitly.

---

# 32. REQUIRED BUILD ARTIFACTS

Keep requested records in the **existing Ecom project** under its current documentation convention when already established; otherwise use the following suggested `docs/` layout. Do not invent a new repo/folder or move existing working files merely to satisfy this layout.

```text
docs/
├── inspection-billboard.md
├── inspection-solar.md
├── reuse-map.md              # exact capability owners/source/destination paths
├── dsh-execution-plan.md     # task graph, machines/seats, parallel pipeline plan
├── test-accounts.md
├── assumptions.md
├── test-plan.md
└── handoff.md
PLACEHOLDERS.md
```

**Inspections:** document source paths and relevant original prompts/build updates where available, rather than dumping irrelevant repositories. **Reuse map:** `Capability | Source project (Billboard/Solar/Ecom/new) | Source path | Action | Ecom destination | Dependencies | Risk | Test`. **DSH plan:** explicitly identify independent and sequential tasks; reuse existing weight checker/free-first/paid policies without changing DSH itself. Include how tasks will be synchronized and the project-manager execution gate.

**Test accounts:** record real seeded roles, membership tiers, organization, approval state, the specific flow, and safe test credential/configuration method (never production secrets).

**Assumptions:** `# | Minor nonmaterial assumption | Evidence | Where used | Impact if wrong`. Material unknowns must instead produce a one-question-at-a-time stop.

**Test plan:** `Role | Workflow | Steps | Expected outcome | Automated/browser/manual | Actual result/evidence`.

**PLACEHOLDERS:** `File | Placeholder | Reason | Blocking? | Corrective plan`. No hidden stub/TODO represented as finished functionality.

**Handoff:** what was reused from each source, what Ecom code remained unchanged, changed/new files, tested commands/evidence, remaining issues, security/compliance limits, checkpoints, branch/commit state, next steps, and unresolved blockers.

---

# 33. IMPLEMENTATION ORDER / PHASE GATES

**Phase 1 — Locate and inspect:** Find the existing Ecom repository and original build/update instructions; inspect current code/state. Inspect Billboard read-only and Solar (`green-energy-platform`) read-only. Inventory only relevant features and paths.

**Phase 2 — Reuse map and DSH execution plan:** Map needed capabilities to existing Ecom, Billboard, Solar, or truly new code. Create `docs/reuse-map.md` and `docs/dsh-execution-plan.md` including the safe parallel task graph, test matrix and rollback points. **HARD STOP: present both to the user and WAIT FOR APPROVAL before making Ecom code changes.**

**Phase 3 — Working base:** Copy approved working source into Ecom without overwriting valuable existing work or touching either source project. Check the site still runs.

**Phase 4 — Identity and test users:** Preserve auth stack; build combined Retail+Vendor permissions, separate Admin identity, 2FA hybrid test flows, seeded usable accounts and admin-gated wholesale/vendor states.

**Phase 5 — Database and business objects:** Add approved migrations for retail/wholesale catalogs, products/brands, vendor orgs, membership tiers, pricing, inventory locations, payments, master/child orders, accounting and fulfillment. Never destructively migrate without permission.

**Phase 6 — Backend commerce:** Wire and test real APIs/actions, price/permission validation, catalog rules, payments, inventory reservations and supplier fulfillment.

**Phase 7 — Frontend:** Connect the copied/adapted UI to live backend actions and persistence; no dead buttons or fake dashboards.

**Phase 8 — Retail:** Free/Bronze/Silver/Gold/Platinum tiers, configurable membership benefits, member-only product rules, membership billing.

**Phase 9 — Wholesale:** Separate catalog, two-factor eligibility (account tier plus approval), MOQ, case packs, quantity price breaks.

**Phase 10 — Vendor onboarding:** Application → approval/rejection → seller access. Invitation path may remain optional, but not the only entry point.

**Phase 11 — Distributed inventory:** Vendor-owned/platform-owned stock, locations, reservations, concurrency, movement/adjustment, and admin/vendor visibility.

**Phase 12 — Payments/accounting:** End-to-end multi-vendor checkout and membership billing with sandbox processor testing; persisted transactions, reversals and settlement ledger/payout states, no live charges.

**Phase 13 — Multi-vendor fulfillment:** Master buyer order → seller lines/shipments → per-vendor fulfillment, tracking, partial status, cancellation/refund, reconciliation.

**Phase 14 — Restricted products:** Only approved lawful age-restricted/cannabis gates; no assumed shipping, payment, or interstate permissions.

**Phase 15 — Admin:** Review sellers and wholesale access, organizations, five tiers, policies, catalog/pricing, distributed inventory, payments/refunds and order statuses.

**Phase 16 — Full E2E:** Actually run and test all critical multi-role workflows with real test accounts. Record test evidence and blockers.

**Phase 17 — Optional cleanup:** Only required bug fixes; propose other modernization/refactoring **one A/B/C/D decision at a time**, with sample/working examples, before implementation.

**Phase 18 — Handoff:** Complete approved artifact list with evidence of functionality, risks, limitations and work remaining.

After Phase 2 approval, DSH may parallelize nonconflicting tasks to maximize throughput, but protect database/branch integration ordering and continue following user's existing DSH seat/permission rules.

---

# 34. DEFINITION OF DONE

**A rendered website, working login screen, or fake prototype is not completion.** Completion requires verified, persisted, server-authorized workflows:

1. The **existing** Ecom frontend/backend/database boots and runs without unreported blockers.
2. Reused Billboard/Solar implementations and preserved Ecom code are accurately mapped; original projects remain unchanged.
3. Retail and Vendor coexist on permitted **one** user account; Admin has a **separate privileged identity**; server-side role and organization isolation works.
4. Vendor **application + admin approval** governs selling privileges; wholesale access separately requires membership/account eligibility + admin approval.
5. Retail and wholesale **separate catalogs**, MOQ, case packs and tiered volume pricing work in the backend and UI.
6. All **Free/Bronze/Silver/Gold/Platinum** membership tiers, configurable admin benefits, member-only access and platform-managed discounts/product overrides work.
7. Real product, brand, cart, and external API tie-in behavior meets the approved business spec.
8. Advanced distributed vendor/platform inventory across owners/locations, reservations, decrements, corrections, visibility and safety under contention works.
9. Mixed-vendor checkout creates the correct master order, seller splits, fulfillment assignments and persistent per-seller/partial status updates.
10. Complete sandbox-tested payment, membership billing, refund and seller settlement/accounting flows are linked to actual database records and UI behavior; no live charges have been made.
11. Seeded Admin, Vendor, combined Retail+Vendor, all five tiers, approved/unapproved wholesale buyers and full-2FA test users actually sign in and exercise their workflows.
12. Real browser/E2E and relevant integration/concurrency tests pass or failures are **explicitly listed**, never misrepresented.
13. Required regulated/age-restricted flows are implemented only within approved legal/compliance boundaries; unknown rules trigger a stop, not silent guesses.
14. No dead buttons, fake production responses, unauthorized data access, undisclosed major placeholders or untested claimed features.
15. `docs/reuse-map.md`, `docs/dsh-execution-plan.md`, `docs/test-plan.md`, `docs/test-accounts.md`, `docs/handoff.md`, inspections, assumptions and `PLACEHOLDERS.md` are complete.
16. Source-project read-only verification, phase-approval evidence, checkpoint/branch details, and known issues are recorded.
17. Optional redesign/refactors have not been silently applied; any desired deviation uses **one question per turn with A/B/C/D and a useful example** and is approved before coding.

Any unmet item is a disclosed **incomplete/blocking** feature, not a reason to falsely claim the whole site is complete.

---

# 35. CRITICAL DIRECTIVE

**Do not treat Billboard or Solar merely as design references. Treat them as read-only libraries of working source code that Ecom can inherit from.**

Do not rebuild proven functionality.

Do not rewrite a working subsystem just because you would design it differently today.

Do not create a new architecture just because it appears cleaner.

Do not create a new Ecom repository.

Do not modify Billboard.

Do not modify Solar.

Do not guess on important unanswered requirements.

Do not silently implement optional redesigns or refactors.

The operating rule is:

> **Find the working implementation → identify the correct source → copy/reuse it → modify only what Ecom requires → connect frontend and backend → test it as real users → document the result.**

And for any proposed design/refactor improvement:

> **Present ONE update at a time → show A/B/C/D choices → include a live working example where possible → wait for the user's decision → only then implement it.**
