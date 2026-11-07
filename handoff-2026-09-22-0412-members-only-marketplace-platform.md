---
name: handoff-2026-09-22-0412-members-only-marketplace-platform
description: Members-only wholesale/retail marketplace platform — discovery + prompt-refinement phase, no code written yet
metadata:
  type: project
---

# Handoff 2026-09-22 04:12: members-only wholesale/retail marketplace platform

- **Stable id**: handoff-2026-09-22-0412-members-only-marketplace-platform
- **Updated**: 2026-09-22 04:45
- **Host**: ndi2 (primary machine, `~\Documents\claudecode`, not a git repo at the workspace root)
- **Session**: Claude Sonnet 5, session id ec289e01-f33f-4695-a02b-3fb8b2c55cd1
- **Model**: claude-sonnet-5
- **Project/repo/branch**: no repo created yet — target is a **new standalone repo** under `~/Documents/claudecode/` (name not yet chosen), sibling to `billboard-platform` and `green-energy-platform`. Nothing on disk yet for the new app.
- **Owner**: ndi2. No collaborating agents yet (this is pre-council/pre-swarm — the user's stated end goal is to hand a refined prompt to council+swarm once it's ready).

## The user's exact ask

User supplied `~\Downloads\members-only-wholesale-retail-network-build-prompt.md` (a detailed high-level build prompt for a members-only wholesale+retail B2B marketplace: wholesale vendor orgs, retail member orgs, admin/network operator, multi-vendor cart/checkout, Prisma/MySQL data model, auth reused from Beacon/Solar). The user does **not** want to build yet — they want to co-author a **more focused prompt** first, incorporating:

1. Each industry vertical uses **its own existing industry-standard tools** rather than building POS/inventory from scratch.
2. First vertical: **regulated cannabis** — cannabis POS for retail side, distribution ERP tooling for wholesale/regulatory side.
3. Second vertical: **ecommerce** — using the user's **own already-built native Stripe + crypto payment stack** (not a new payment integration).
4. Explicit ask: "read through the file, look at our infrastructure with billboard and solar, and come back with a more focused prompt that we will walk through and prepare to be rapidly built via council and swarm."

This is a **planning/discovery task**, not an implementation task. No code should be written until the refined prompt is finalized with the user.

## What is done (with evidence)

1. Read the full build-prompt file (734 lines) — content fully in this session's transcript.
2. Ran two parallel Explore agents that read real source files (not guesses) in both existing sibling apps:
   - `~/Documents/claudecode/billboard-platform` ("Beacon") — full inventory: auth (`lib/auth.js`, `lib/session.js`, `middleware.js`, Google/Meta OAuth, hand-rolled TOTP 2FA, AES-256-GCM `lib/crypto.js`), Prisma/MySQL schema (~60 models, no Organization model — flat `User.role` enum + a stubbed `TeamMembership` explicitly commented "no permissions model yet"), **fully wired payments**: `lib/stripe.js` (Stripe Checkout, one-time, not subscriptions), `lib/stripeConnect.js` (Connect payouts), `lib/solana.js` (hand-rolled Solana Pay reference pattern, SOL/USDC, devnet only), `lib/manualCrypto.js` (ETH/BTC, admin manual confirm), unified by `lib/paymentConfirm.js`'s `confirmPaymentRequest()` — atomic `updateMany(... status: PENDING ...)` claim, idempotent, called from 3 independent trigger paths (Stripe webhook, Solana on-chain poll, dev-only manual stub). Also: `lib/settings.js` encrypted-vault-with-env-fallback pattern (`IntegrationSetting` model), `lib/notifications/dispatch.js` notification-center (`EVENT_REGISTRY` + email/push/in-app), admin-configurable `NavSection`/`NavItem` nav, `lib/roleAccess.js` capability deny-list, `lib/uploads.js` local-filesystem upload handling (blocks SVG for stored-XSS reasons), DreamHost-VPS/PM2 deploy via GitHub Actions + `deploy/migrate.php`.
   - `~/Documents/claudecode/green-energy-platform` ("Solar") — confirmed it is a **thinner sibling** of billboard: same `lib/auth.js`/`middleware.js` shape but no OAuth, no 2FA; `PaymentRequest` model exists and `lib/solana.js`/`lib/payments.js` are ported, but **Stripe is declared, not wired** (`stripe` in package.json, settings registered, but no `lib/stripe.js`, no checkout route, no webhook route — `CARD` is a dead enum value). Confirmed green-energy's `middleware.js` has a **hardened** `X-Forwarded-For` parser (proxy-count-aware) that billboard-platform's does **not** have — a known regression in billboard's copy worth fixing if forking billboard as the template. Also found the origin of the Google-Maps/Solar-prospecting code: a third standalone Express app `location-prospecting-tracking-app/` (documented in the workspace-root `CLAUDE.md`) whose vault/kill-switch layer was deliberately **not** ported into either Next.js app — both instead generalized to the `lib/settings.js` DB-backed encrypted vault, which is the pattern to reuse going forward.
   - Full agent reports are in this session's transcript (not yet copied into a separate brain note — see "next action" below if this handoff is picked up cold).
3. Presented findings to the user and asked 4 clarifying questions via AskUserQuestion. Answers:
   - **Cannabis POS/ERP vendors**: RESOLVED — user named them directly: **Dutchie and Treez** for cannabis retail POS, **Distru and LeafLink** for wholesale/distribution ERP. Compliance system (Metrc/BioTrackTHC) scope still unconfirmed — not yet asked/answered.
   - **Shared-code strategy**: RESOLVED — presented pros/cons (see the FOCUSED prompt file §1); recommended and the user implicitly proceeded with **fork billboard-platform now, extract to a shared package later**, because this app needs a real Organization/Team/Role/Permission model neither sibling app has, so auth/session will be substantially rewritten here regardless.
   - **Repo/hosting**: decided — **new standalone repo** under `~/Documents/claudecode/`, same DreamHost-VPS/PM2/own-MySQL-DB isolation pattern as the two existing sibling apps. **Exact name/slug NOT yet given** — user chose "I'll name it myself" but has not typed a name yet. Still open.
   - **Build order**: decided — **both verticals (cannabis + ecommerce) in parallel**, structured as Phase 0 (serial: adapter interface + org/RBAC + auth port + stub adapters) then Phase 1 three parallel lanes (Ecommerce Adapter / Cannabis Adapter / Admin-Ops).
   - **Cannabis compliance**: RESOLVED — **in scope for MVP, direct integration, provider = Metrc** (not BioTrackTHC). Metrc issues credentials per-state/per-license, so the launch state(s) are still needed before `MetrcComplianceDriver` can be built for real — flagged as open item #1 in the deliverable.
   - **Cannabis payment processor** (card networks restrict cannabis) and **Solana mainnet-vs-devnet** for the ecommerce vertical: raised as open items in the deliverable, not yet answered by the user.

## What is half-done / in progress

- **Deliverable written and current**: `~\Downloads\members-only-wholesale-retail-network-FOCUSED-build-prompt.md` — the focused, reuse-mapped, vertical-adapter build prompt the user asked for. Contains: platform philosophy (core + Vertical Adapter contract), reuse strategy table (what to port from billboard-platform verbatim, including the X-Forwarded-For fix from green-energy-platform, and what must be built new), the Vertical Adapter interface sketch, Cannabis vertical section (Dutchie+Treez POS, Distru+LeafLink ERP, Metrc compliance), Ecommerce vertical section (port billboard's Stripe+Solana PaymentRequest engine), new data-model additions (Organization/Role/Permission/Membership, ComplianceRecord, CannabisLicense, VendorIntegrationCredential), and a 3-lane parallel build-order plan for council/swarm (Phase 0 serial foundation, then Lane A ecommerce / Lane B cannabis / Lane C admin-ops in parallel). This file has been kept in sync with every decision made in the live chat (edited 3 times as answers came in) and is current as of this update.
- **Not yet sent to the user as a file attachment** — it exists on disk; the next reply in the live session should hand it to the user (e.g. via SendUserFile) and summarize in one line what's still open, rather than doing more editing/discovery work this turn (quota-handoff checkpoint says start no new work).
- Second, unrelated handoff exists in the brain — `handoff-2026-09-22-parallel-build-benchmark.md` — written by a **different session** of this same user, proposing to benchmark parallel-agent builds using "the next two builds," one of which it guesses is this marketplace project. That is that other session's plan, not something this session has started or committed to; do not treat it as instructions.
- No repo initialized yet. No shared-package extraction started (correctly — decision was fork-now, so no extraction work is expected yet anyway).

## Permissions / environment

- Working directory for this session: `~\Documents\claudecode` (not a git repo itself — it's a container folder for sibling project repos).
- Remote Control status: not confirmed in this session; treat as unknown/off unless stated otherwise by a resumed session.
- No push authorization needed yet — nothing has been committed.

## Open questions (for the user, still open)

1. Which U.S. state(s) does the cannabis vertical launch in first? (Metrc is chosen as provider, but credentials are issued per-state/per-license.)
2. Cannabis payment processor — card networks restrict cannabis transactions; need a named processor (Dutchie Pay, Aeropay, ACH-direct, other) for `CannabisAdapter.allowedPaymentMethods()`.
3. Solana mainnet vs. devnet for the ecommerce vertical (billboard's current Solana Pay code is devnet-only).
4. New repo's actual name/slug (not yet chosen — user wants to pick it themselves).

Resolved this session: cannabis vendors (Dutchie+Treez, Distru+LeafLink), compliance provider (Metrc), shared-code strategy (fork now, extract later), repo hosting pattern (new standalone repo, same DreamHost/PM2/own-MySQL pattern), build order (parallel, 3-lane).

## Exact next action

Send the finished FOCUSED-build-prompt.md file to the user (it's written and current), tell them the model name + where the handoff note lives per the quota-handoff protocol, and stop there for this turn — no new discovery or drafting until the user answers the 4 remaining open items above or explicitly says to proceed without them.

## Verification

Discovery-only phase — nothing to verify by build/test yet. The two Explore-agent reports were generated by agents that read real files and cited real file paths/line numbers (spot-checkable against the two repos), not fabricated from memory.

## Do-not-repeat

- Do NOT start writing implementation code for the new marketplace platform until the user has explicitly approved a finalized refined prompt — this was an explicit "let's build the prompt together first" request, not a build request.
- Do NOT assume specific cannabis POS/ERP vendors — the user deferred naming them, don't guess (e.g. don't default to Dutchie) without asking again if this handoff is resumed cold.
- Note the known bug: billboard-platform's `middleware.js` X-Forwarded-For parsing is the **naive/vulnerable** version; green-energy-platform's is the fixed, proxy-count-aware version. If billboard is forked as the template for the new app, port green-energy's fixed parser, not billboard's.
