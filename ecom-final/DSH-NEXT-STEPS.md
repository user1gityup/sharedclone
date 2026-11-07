# Ecom final build — DSH next-steps plan

Source prompt: `~/Downloads/ecom_final_build_prompt_updated.md`
Written: 2026-10-05 by Claude Opus 5.5 (claude-opus-5-5), host vmixlaptop2x6 (ndi2)
Status: PLAN ONLY. No Ecom code changed, no run launched, no seats picked.

This plan covers prompt Phases 1–2 (inspect, reuse map, DSH execution plan) and how
Phases 3–18 will be cut into DSH runs after the approval gate. The prompt's hard stop
after Phase 2 is kept: nothing in Phase 3+ starts without the user's go.

---

## 0. What exists today (verified 2026-10-05)

| Item | Path | State |
|---|---|---|
| Ecom repo `users` | `~/Documents/claudecode/users` | git main 039842b, clean, only `BUILD-BRIEF.md` + `README.md` |
| Ecom repo `commerce` | `~/Documents/claudecode/commerce` | git main 34701f7, clean, brief only |
| Ecom repo `canna` | `~/Documents/claudecode/canna` | git main e54c912, clean, brief only |
| Built code — users | `dsh-runs/build-ecomm-users-preview` | not git; 9 Prisma models (User, Credential, TotpSecret, BackupCode, OAuthIdentity, Session, …); 39/39 node tests; was live :5190 |
| Built code — commerce | `dsh-runs/build-ecomm-commerce-preview` | not git; 18 models incl. Vendor, Product, Variant, InventoryItem, Cart, Order, OrderLine, PaymentRequest, Payout, Shipment, HouseRevenue; tsc 0, next build 0, 37/37 tests; was live :5191 |
| Built code — canna | `dsh-runs/build-ecomm-canna-preview` | not git; 19 models incl. CannabisLicense, VendorApplication, ComplianceRecord; tsc 0, 27/27 tests; was live :5192 |
| Billboard (read-only) | `~/Documents/claudecode/billboard-platform` | main 60e5607; JS Next + Prisma MySQL; `lib/auth.js session.js totp.js googleAuth.js metaAuth.js settings.js stripe.js stripeConnect.js paymentConfirm.js houseRevenue.js notifications/ nav/ uploads.js rateLimit.js roleAccess.js devOnly.js` |
| Solar (read-only) | `~/Documents/claudecode/green-energy-platform` | main 88e8796; `middleware.js clientIpFor()` (non-spoofable XFF), `lib/compliance/ finance/ referrals.js rewards/ resellers/ payments.js` |
| pm | T-61212c5c (project P-d561489c) | ecomm canna+commerce builds, `uncertain` |

Gaps against the new prompt, from the schemas on disk:
- No wholesale catalog, MOQ, case pack or quantity breaks anywhere (0 matches in commerce/users).
- No membership tiers (Free/Bronze/Silver/Gold/Platinum), no benefit/rule model, no platform pricing override.
- Inventory is a single `InventoryItem` per variant; no locations, owners, reservations or movement ledger.
- Orders are single-level; no master order / per-seller child order split.
- No wholesale-buyer approval; vendor application exists only in canna.
- No browser/E2E tool in Billboard or Solar (both use `vitest run` only; no Playwright).

## 1. Gate 0 — decisions needed before the reuse map is final

These are material per prompt §29. One at a time, A/B/C/D, in this order:

1. **ANSWERED 2026-10-05: A — keep three repos.** `commerce` = marketplace (retail, wholesale, tiers,
   inventory, payments, fulfillment); `canna` = regulated path; `users` = identity. Lane write targets
   in §4 apply to `commerce` unless marked otherwise. Original question: the prompt describes one marketplace (retail + wholesale +
   regulated cannabis as a workflow). Disk holds a three-repo design (users / commerce / canna,
   separate DBs, shared only by a JWKS token).
   - A: Keep three repos; `commerce` becomes the marketplace, `canna` keeps the regulated path, `users` owns identity.
   - B: Merge into one Ecom app (commerce as base, canna's compliance + vendor-application folded in, users kept as identity service).
   - C: One Ecom app including identity (users folded in too).
   - D: Other.
2. **ANSWERED 2026-10-05: copy to branch.** Each preview is copied into its repo on `build/ecom-final`
   as the first checkpoint commit, after its gate (tsc, build, tests) passes again. Original question: the working code lives in untracked `dsh-runs/*-preview`; the repos hold briefs only. Proposed default: copy preview into the repo on a `build/ecom-final` branch as the first checkpoint commit.
3. **Browser E2E tool.** None exists in any source. Options: Playwright (one dev dependency), DSH/Claude browser pane driven manually with recorded evidence, or vitest + supertest only (fails the prompt's "real browser" rule).
4. **Payment sandbox provider.** Billboard has Stripe + Stripe Connect + Solana devnet + manual crypto. Which rails are in Ecom v1 sandbox (Stripe test mode is the obvious fit for splits/payouts)?
5. **Regulated/age-restricted rules.** Jurisdiction and gates for cannabis and age-restricted SKUs (prompt §16–17 require STOP AND ASK). Canna preview has `ComplianceRecord` / `CannabisLicense` — confirm whether its rules are the approved ones.
6. **Shipping/fulfillment carrier.** Prompt forbids inventing one. Manual tracking-number entry vs a named carrier.
7. **Accounting scope.** Reuse Billboard `Transaction` + `HouseRevenue` + `Payout` as the ledger, or a defined double-entry ledger.

## 2. Phase 1 — inspection runs (read-only, parallel-safe)

All three are read-only; they can run in parallel on separate lanes because nothing writes to a shared tree.

| Run | Output | Lane / seats (user picks) | Notes |
|---|---|---|---|
| I-1 Billboard inspection | `docs/inspection-billboard.md` | free/cheap seat | Auth, session, 2FA, OAuth, settings vault, payments, payouts, notifications, nav, uploads, roleAccess, devOnly, seed users. Read `CONTINUE.md`, `WORKFLOW.md`, `PRISMA-CHANGES.md`, git log for original prompts/fixes. |
| I-2 Solar inspection | `docs/inspection-solar.md` | free/cheap seat | `middleware.js clientIpFor`, `lib/compliance`, `lib/finance`, `rewards`, `referrals`, `resellers` (tier/benefit patterns), KYC route. |
| I-3 Existing Ecom inspection | `docs/inspection-ecom.md` | free/cheap seat | The three preview trees + three briefs + `USERS-CONTRACT.md`; list what passes, what is stub. |

Billboard/Solar read-only check: record `git -C <repo> rev-parse HEAD` and `git status --short` before and after each run; any diff fails the run.

## 3. Phase 2 — reuse map + DSH execution plan (the approval gate)

One council run (plan only, no writes outside `docs/`) consumes I-1..I-3 and writes:
- `docs/reuse-map.md` — columns `Capability | Source project | Source path | Action | Ecom destination | Dependencies | Risk | Test`.
- `docs/dsh-execution-plan.md` — this file's §4–§6 made concrete with exact paths.
- `docs/assumptions.md`, empty `PLACEHOLDERS.md`.

Seed rows already known (from the commerce brief and the gap list above):

| Capability | Source | Source path | Action | Ecom destination |
|---|---|---|---|---|
| Auth / session / JWT cookie / pending-2FA | Billboard | `lib/auth.js`, `lib/session.js`, `lib/totp.js`, `middleware.js` | copy and modify (already ported in users preview — verify) | users |
| Google / Meta OAuth | Billboard | `lib/googleAuth.js`, `lib/metaAuth.js` | copy unchanged | users |
| Client IP for rate limit | Solar | `green-energy-platform/middleware.js` `clientIpFor` | copy unchanged | users + commerce |
| Encrypted settings vault | Billboard | `lib/settings.js`, `IntegrationSetting` | copy unchanged | commerce |
| Payment engine | Billboard | `lib/stripe.js`, `stripeConnect.js`, `paymentConfirm.js` (`confirmPaymentRequest`) | extend (multi-seller split, membership fees, refunds) | commerce |
| Platform cut | Billboard | `lib/houseRevenue.js` | extend | commerce |
| Notifications | Billboard | `lib/notifications/dispatch.js` | extend (`order.*`, `vendor.*`, `wholesale.*`) | commerce |
| Role nav | Billboard | `lib/nav/*`, `roleAccess.js` | copy and modify (Retail+Vendor switch, separate Admin) | commerce |
| Dev-only login shortcut | Billboard | `lib/devOnly.js` | copy unchanged | users |
| Membership tiers + benefits | Solar? (`rewards/`, `referrals.js`) | inspect | extend or new | commerce |
| Vendor application | Ecom canna | `build-ecomm-canna-preview` `VendorApplication` | copy and modify | commerce |
| Compliance gates | Ecom canna + Solar `lib/compliance` | inspect | extend | canna / commerce |
| Wholesale catalog, MOQ, case pack, price breaks | — | — | new | commerce |
| Distributed inventory (locations, reservations, ledger) | — | — | new (extend `InventoryItem`) | commerce |
| Master/child orders, split fulfillment | — | — | new (extend `Order`/`OrderLine`/`Shipment`) | commerce |

**HARD STOP.** Present `reuse-map.md` + `dsh-execution-plan.md` together. No Phase 3 run is prepared until the user approves both.

## 4. Phase 3–18 — DSH task graph after approval

Sequential spine (schema owners; never two at once on the same Prisma schema):

```
S1 working base: promote preview -> repo branch, boots, tests green        (Phase 3)
S2 identity: Retail+Vendor roles, separate Admin, 2FA hybrid, seed users     (Phase 4)
S3 schema migration A: catalogs, tiers, benefits, pricing rules, vendor/wholesale approval  (Phase 5)
S4 schema migration B: inventory locations/reservations/ledger, master/child orders, payment/ledger records (Phase 5)
S5 integration checkpoint: migrate on clean DB, seed, full test suite, browser smoke
S6 final E2E + handoff                                                     (Phase 16, 18)
```

Parallel lanes, each starts only after the schema step it depends on is committed:

| Lane | After | Work (prompt phase) | Writes only to |
|---|---|---|---|
| L-retail | S3 | Five tiers, admin-configurable benefits, member-only products, platform overrides (8) | `src/lib/membership/*`, retail catalog routes/pages |
| L-wholesale | S3 | Separate catalog, eligibility = tier + admin approval, MOQ/case pack/breaks server-side (9) | `src/lib/wholesale/*`, wholesale routes/pages |
| L-vendor | S3 | Application -> review -> approve/reject; no selling before approval (10) | `src/lib/vendors/*`, vendor portal |
| L-inventory | S4 | Owner/location stock, reservations, decrement/release/restock, concurrency tests (11) | `src/lib/inventory/*` |
| L-payments | S4 | Sandbox checkout, membership billing, refunds, split + payout/ledger states (12) | `src/lib/payments/*`, webhooks |
| L-fulfillment | S4 + L-inventory | Master order split, per-seller shipments, partial/hold/cancel/refund (13) | `src/lib/orders/*`, `src/lib/fulfillment/*` |
| L-restricted | S4 + Gate 0 #5 | Age/cannabis gates within approved rules only (14) | `src/lib/compliance/*` |
| L-admin | all lanes | Review queues, tiers, policies, inventory, payments, orders (15) | `src/app/admin/*` |
| L-frontend | per lane | Wire each lane's pages to live APIs, no dead buttons (7) | lane-owned pages only |

Collision rules:
- Only the spine (S3/S4) touches `prisma/schema.prisma` and migrations. A lane that needs a field files a request back to the spine instead of editing the schema.
- Each lane owns its directory; shared files (`middleware.ts`, nav config, seed) change only in spine steps or at S5.
- DSH holds one pipeline per lane settings file; use the existing `~/.dsh-lane-claude`, `~/.dsh-lane-codex`, `~/.dsh-lane-deepseek` lanes. Max 2 heavy runs at once on ndi2 (8 GB RAM; the 2026-10-02 note says do not run canna and commerce together here).

## 5. Routing and seats

- pm prepares each run (`pm_prepare_run`) as a task under a new pm project `ecom-final`; pm never dispatches. **The user picks council and swarm seats for every run; no roster is defaulted or carried over.**
- **User seat pick for ecomm (2026-10-05):** harness main agent = `free-claude`; every other DSH role
  (council, swarm, review) = `openai`, `claude`, `claude-work`. pm project `ecom-final` (P-93fd4cf2):
  I-1 T-e5767e72, I-2 T-d0f635d7, I-3 T-5fa83509 prepared with this roster. Saved runs for vmixer2o2: presets `ecomm/final-i1-billboard`, `ecomm/final-i2-solar`, `ecomm/final-i3-ecom` (brain dsh-presets/ecomm/).
- Weight check: the council plan's `SCALE` / `EST_OUTPUT_TOKENS` line (`deepseek-harness/packages/council/tool-council/src/estimate.ts`) decides swarm vs single-seat per run, unchanged.
- Seat policy (brain `feedback_dsh_seat_policy.md`): paid = deepseek + codex (+ claude) for plans, schema and review; free seats for inspection and grunt units.
- Runs go through `dsh-run --auto` with the task-file generator pattern already used (`dsh-runs/tasks/mk-ecomm2.cjs`), with the write root pinned to the target repo branch, not a stray `dsh-runs` dir (the 2026-09-29 wrong-root bug).
- No change to DSH architecture, rules, routing config or `council.autoApprove`.

## 6. Checkpoints, tests, rollback

| Checkpoint | Gate to pass | Rollback |
|---|---|---|
| After S1 | `npm install`, `prisma generate`, `tsc --noEmit` 0, `next build` 0, existing tests green, app serves 200 | delete branch |
| After S3, S4 | `prisma migrate dev` on a fresh DB 0, seed 0, all tests green; migration reviewed for destructive ops (stop if any) | revert commit; drop dev DB |
| After each lane | lane unit/integration tests + one browser flow recorded in `docs/test-plan.md` | revert lane commit |
| S5 | full suite + concurrency test (parallel purchase of last unit) + browser smoke for every seeded account | revert to S4 |
| S6 | prompt §30 matrix executed; failures listed, not hidden | — |

Commits: local only, on `build/ecom-final`, one per checkpoint, then queued with the gatekeeper helper. No push from any run.

Test accounts (prompt §21) are seeded in S2 and documented in `docs/test-accounts.md` with credentials kept in the seed/example-config file, never in chat.

## 7. Exact next action

1. Gate 0 #1 (three repos) and #2 (copy previews to `build/ecom-final`) answered. #3–#7 can be asked
   before the Phase 2 council run; they block only their lanes, not Phase 1 inspection.
2. Claude Opus 5.5 creates pm project `ecom-final` and prepares runs I-1, I-2, I-3 (read-only) with an empty roster.
3. User picks seats and starts them.
4. After I-1..I-3 land, prepare the Phase 2 council run; present reuse map + execution plan; stop.

Do not: modify Billboard or Solar; write into `users`/`commerce`/`canna` before Gate 0 #1–2; start Phase 3+ before approval; push; pick seats.
