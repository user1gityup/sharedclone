# Neighborhood Tech — WP0 read-only audit + plan

pm: P-4cd7e573 / master T-506a5100 · Author: Claude Opus 5.5 (claude-code, vmixer2o2) · 2026-10-26 ~14:00Z
Scope: read-only. Nothing was edited, installed, deployed, started, or sent to a live external API. No credentials printed.
Status key: **PASS** = ran it myself, output quoted · **FAIL** = ran it, failed · **NOT_TESTED** = not run · **UNVERIFIED** = code exists, never proven live.

## 1. Integration audit

| System | Finding | Test status |
|---|---|---|
| Ecom `commerce` (build/ecom-final d5b26aa, clean, Next14/Prisma/MySQL) | Orders, seller split, full+partial refunds, ledger, admin, Stripe webhook sig check exist | **PASS** `node --test --test-isolation=none tests/**/*.test.ts tests/*.test.ts` → `# tests 255 # pass 255 # fail 0` |
| Ecom payments | Registry points at `src/lib/payments/adapters/*.ts` — **directory does not exist**; every rail silently falls back to the mock adapter. No Stripe keys in .env | **FAIL** (`ls src/lib/payments/adapters` → No such file or directory). No real rail exists. |
| Ecom `users` (85bc0b8, EdDSA token issuer) | Register, email verify, TOTP 2FA, sessions, Google/Meta OAuth stubs. No SMS/phone field. Single `SESSION_AUDIENCE` | **PASS** crypto+lib → `# tests 34 # pass 34 # fail 0`; DB test NOT_TESTED |
| Ecom `canna` | Cannabis-specific (licenses, jurisdiction, ID verification). Do NOT reuse for NT | 115/116; the 1 failure (purchase-limit, order-dependent) is Blitz task T-fb8244ff — not ours |
| Billboard `billboard-platform` (wp0-solar-sam 60e5607) | **No Meta Marketing/Lead Ads/Messenger/WhatsApp/IG/Pixel/CAPI/insights code.** Only "Continue with Facebook" login, scopes `email,public_profile`, Graph **v19.0** (`lib/metaAuth.js:47-48`). Its "campaigns" are internal DOOH records. META_APP_ID/SECRET absent from .env | **UNVERIFIED** (commit e75cc31: "nobody has created a real Meta app yet"); 8 unit tests NOT_TESTED (node_modules absent) |
| DSH (`deepseek-harness` feat/heterogeneous-teammates 2e5bc65663, DIRTY) | Headless one-shot profile, free/local model routing (llama seat disabled), budget/quota gates, permission tiers. **No authenticated customer-facing HTTP chat API**; 0.0.0.0 webserver has no auth → must never be exposed | NOT_TESTED |
| pm | `approvals.mjs` (pending→approved, OTP/TTL, audit) reusable pattern for "technician approves fix"; `notify.mjs` = bridge inbox + Windows toast only | approvals.test.mjs exists, NOT_TESTED here |
| Technician push | Self-hosted ntfy in NVR stack (Tailscale-bound) proven for NVR alerts (handoff-2026-10-15 wyze-frigate note: e2e 12/0) | PASS per note, not re-run; NT topic not created |
| NAS | **None exists.** vmixer-facts: "No NAS, no SMB maps." NAS/JBOD tasks T-125d882d (+SAS/HDD/USB) all TBD hardware. Local disks only (E: 3.7 TB etc.) | N/A — WP6 blocked |
| SMS / WhatsApp / Messenger / IG DM | **Missing everywhere** (no Twilio, no WABA, no Graph messaging) | N/A |
| Email | `SMTP_URL` declared in commerce env.example, absent in .env | NOT_TESTED |
| Remote access | TeamViewer 15.82.6 installed on vmixer2o2, registry **LicenseType 10000** (not a commercial licence as far as evidenced) → commercial use **not licensed**; iOS = screen-share/guided only | NOT_TESTED; licence purchase = user decision |
| Voice EN/ES (TTS/STT) | No TTS anywhere; Whisper only inside third-party FCC repo | N/A |
| i18n / a11y | `<html lang="en">` hard-coded in all three Ecom apps; ~17 aria attrs in commerce | N/A |

## 2. Reuse / build matrix

| Need (decision) | Reuse | Build new |
|---|---|---|
| Accounts, verification (Q22,Q23) | users token service, email verify, TOTP | guest identity, SMS verification, household/member accounts, per-brand `aud` |
| Catalog + price book (Q3,Q12-17) | commerce Product/order/ledger | service fields: duration estimate, minimum fee, $150/h reference, $25 AI intake SKU, customer-approved quote |
| Payments (Q21) | registry + ledger + refund hooks | **real Stripe adapter (test mode first)**, cash/in-person rail via ledger, receipts EN/ES; kill silent mock fallback for NT |
| Refund rules (Q16) | partialRefund + refundHook | 20-min plan-review clock, objective start/stop, logged refund decision |
| Credits/referrals (Q31) | ledger, Stripe Connect | referral codes, family credits, partner commissions, fraud rules |
| Brand isolation (Q32) | — | `brandId` on users/products/orders, cannabis age-gate/Treez/Dutchie flagged OFF for NT brand |
| AI intake/orchestration (Q5,Q34,Q35) | DSH headless + free/local routing + budget gates; pm approvals pattern | NT gateway (auth, rate limit, per-case session, per-customer cost cap), risk-tier action policy, tech-approval workflow |
| Tech dispatch (Q19,Q20) | ntfy (new topic) | duty state (on/busy/sleeping), slot calendar, callback booking |
| Channels (Q10,Q28) | — | SMS, WhatsApp, Messenger, IG — each only after provider access verified |
| Remote access (Q18) | TeamViewer installed | commercial licence decision, consent/session-code flow, OS limits table |
| Backups (Q36-38) | — | everything; blocked on NAS hardware + cloud provider + grace days |
| Meta marketing (Q26-28) | metaAuth OAuth shape, admin integrations settings UI, Approve-Ads queue pattern | MetaAdapter: Marketing API (DRY_RUN default, forced PAUSED, $100 lifetime cap, approval queue), leadgen webhook (X-Hub-Signature-256), CAPI w/ event_id dedupe + test_event_code, insights; Graph version bump from v19.0 |
| Bilingual/voice/a11y (Q9,Q33) | — | i18n framework + ES copy, large-target UI, TTS/STT EN/ES, WCAG AA audit |

## 3. Dependency graph

```
WP0 audit ──► WP1 storefront ──► WP2 catalog+commerce ──► WP3 AI orchestration ──► WP4 human+scheduling
                     │                    │                        │                       │
                     │                    └──► WP8 growth ◄────────┤                       │
                     └──► WP5 channels+remote (needs licence/provider access) ◄────────────┘
WP6 backups  ◄── NAS hardware (T-125d882d) + cloud provider + grace days (all TBD)
WP7 Meta     ◄── Meta app/business/Page/IG/ad account access (user) — code can be built offline with fake transport
WP9 QA/launch ◄── all of the above
```

## 4. Per-WP effort / risk (estimates, not measured)

| WP | Effort | Risk | Free-first assignment | Hard blockers |
|---|---|---|---|---|
| WP1 Storefront | M (3-5 d) | Low | Claude Code local; DSH free seats for ES copy drafts | domain TBD; brand assets |
| WP2 Catalog+commerce | L (5-8 d) | **High** — touches shared Ecom engine, collides with `commerce-lanes` | Claude Code | approval to modify shared Ecom; Stripe test keys |
| WP3 AI orchestration | L | High (customer data to LLMs) | DSH local/free seats behind gateway | which models may see customer PII (user) |
| WP4 Human+scheduling | M | Medium | Claude Code | technician hours/availability |
| WP5 Channels+remote | M-L | High (licensing, provider approvals) | — | TeamViewer commercial licence; Twilio/WABA accounts |
| WP6 Backups | L | **High** (customer files, legal) | — | NAS hardware, cloud provider, grace days, security/legal review |
| WP7 Meta | M | High (spend) | Claude Code, fake transport | Meta business/app/ad account; spend approval ($100 total) |
| WP8 Growth | M | Medium | DSH free seats for content | WP2 ledger, WP7 |
| WP9 QA/launch | M | — | Claude Code + Playwright | all |

## 5. Open TBDs (not guessed)
Domain; in-person venue; technician working hours; backup subscription prices; cloud backup provider; cancellation grace days; Meta business/Page/IG/ad-account IDs and permission review; Twilio/WhatsApp accounts; TeamViewer (or alternative) commercial licence; which LLM providers may process customer PII; where NT code lives (new repo vs. inside commerce).

## 6. Approval gates (nothing past WP0 starts without them)
G1 — approve WP1 start: new independent repo `neighborhood-tech` (local only, no deploy), consuming Ecom via its APIs; **no edits to shared Ecom yet**.
G2 — approve changes to shared Ecom (brandId, service fields, Stripe adapter in test mode) — coordinate with commerce-lanes owner.
G3 — Stripe test keys; G4 — remote-access licence; G5 — SMS/WhatsApp/Meta accounts; G6 — NAS hardware + cloud; G7 — any spend (Meta $100 total); G8 — beta stages per Q39/Q40.

## 7. KPI instrumentation (WP2/WP3/WP8)
Events to emit from day one: lead_created(source), intake_paid, ai_resolved, human_handoff, tech_minutes, booking_created/completed, refund_issued(reason), referral_redeemed, backup_attached/cancelled, meta_cost (from insights). No personal attributes in ad audiences.
