# PM 101-question interview — Q57 historical Parking decision reconciliation
Timestamp 2026-11-02 UTC. Append-only Shared Brain audit delta; DO NOT overwrite canonical reports/pm/qa-101-progress-2026-11-01.md which has concurrent changes. Full reconciliation requires reading live canonical material and retaining all intervening user/agent entries.

## Q57/101 — PRIOR USER DECISIONS REUSED; NO NEW PSP CHOICE INVENTED
Original task **T-be2407f6**, parking real payment provider adapter, project P-b150c82a, PM comment **#1180**. The user explicitly said they already answered and demanded use of previous priorities, not another multiple-choice vote.

Confirmed existing business requirements:
- Historical Metro Manila Parking Q5=D: FULL HYBRID, operator- and location-configurable **GCash, Maya, cards, cash, QR, wallets, subscriptions, prepaid and pay-at-arrival/exit**, including at-site attendant reconciliation. The previous enumerated method order is retained as listed; a strict ranking of PSP/merchant providers was NOT proven.
- Historical Parking Q11=D: **REUSE** existing compatible Ecom/commerce checkout/payment adapters first; modular provider-agnostic extension points; preserve independently deployable parking stack.
- User separately confirmed the specific **GrabPay acceptance at checkout** and **Grab Maps parking-site listing** goals. Treat payment acceptance and POI submission as separate workstreams; DO NOT infer in-app Grab bookings/inventory or authorize site submission.
- The phone/attendant pilot may preserve cash/QR methods, merchant settlement and role-aware audit independently of merchant activation.
- No confirmed historical selection of **PayMongo exclusively**, **GrabPay direct exclusively**, both providers by contract, or mock-only pilot: do not invent such a choice. Reconcile PSP implementation through technical support/availability for required payment methods, Philippines eligibility, live merchant onboarding, operator needs, costs and protected sandbox evidence. Actual provider activation separately approved.

Q57 resolution is **historical requirements applied; no new A/B/C/D provider selection**, not 'A' or 'C'. Preserve original PM task ID and history, full Parking Q1–Q12, all earlier PM Q1–Q56 and their code/provenance, separate past LinkedIn Q1–Q35 and Event Manager E1–E15/F1–F29 decisions. No actual PSP onboarding, account access, user charge, provider fee, code merge, production payment, Grab Maps submission or deployment authorized.

## Prior audited deltas
- reports/pm/qa-101-decisions-q50-q52-2026-11-02.md PM #1172/#1174/#1175
- reports/pm/qa-101-decision-q53-2026-11-02.md PM #1176
- reports/pm/qa-101-decision-q54-2026-11-02.md PM #1177
- reports/pm/qa-101-decision-q55-2026-11-02.md PM #1178
- reports/pm/qa-101-decision-q56-2026-11-02.md PM #1179
All user selections and distinct per-run/authentication, provider costs, DB migration, PII, code-review/merge and live deployment approvals preserved.

## Next truly distinct unasked blocker proposed Q58
Original PM task **T-3e91fd6c**, ledger journal backfill for pre-ledger orders. Script `scripts/ledger-backfill.ts` tested in fixtures only; shared S6 database would be WRITTEN to by actual run. Choice A plan isolated/approved snapshot and dry-run first, then separately authorize apply; B accept tests-only and retain real backfill pending; C defer; D alternative. Avoid changes to shared/production financial records without explicit DB credentials, read-only audit, backup, dry-run review and separate authorization.
