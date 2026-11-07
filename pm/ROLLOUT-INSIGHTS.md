# Insights (goals, usage ledger, budgets): validation, rollout, review gate

Written by Claude Sonnet 5.5, branch `build/r3-pmD`. Nothing here is deployed; each step below is gated.

## What is built
- `goals.mjs`, `usage-ledger.mjs`, `budgets.mjs` (standalone) wired by `insights.mjs`; tables are created additively in `store.mjs` migrate.
- HTTP: `/api/insights/dashboard`, `/api/projects/:id/insights`, `/api/goals*`, `/api/goal-*`, `/api/usage/*`, `/api/budgets*`, `/api/budget-*`.
- UI: Insights section (dashboard, project detail) in `public/index.html`.
- Router side (separate repo, branch `build/r3-pmD-harness`): advisory goal metadata in `tool-council/src/router/goal-alignment.ts`.

## Validation matrix (all run in `node --test` over pm/)
| Area | Test |
|---|---|
| KPI math, history, failure recovery, reconciliation, zero-priced, subscription, rollback, accessibility | `insights-validation.test.mjs` |
| Role isolation, double ingestion, budget concurrency, human-proof raise | `insights.test.mjs` |
| Module rules | `goals.test.mjs`, `usage-ledger.test.mjs`, `budgets.test.mjs` |
| Router ordering, launch gate, proposed vs actual | harness `router-goal-alignment.spec.ts` |

## Rollout plan (each step needs its own go)
1. Review the branch diff (`insights.mjs` authority table, UI).
2. Dry run: start a copy of pm on another port with a copy of `pm.db` (`PM_PORT=4491`, db path copied), load `/` and open Insights; confirm existing tabs unchanged. The live server on :4480 is not touched.
3. Deploy: merge to the brain, restart pm (user-gated; migration is additive, existing rows and ids untouched).
4. Seed: org goal, project goals, budgets; point collectors at `POST /api/usage/events` (idempotent by event_id and provider request key).
5. Observe a week before any budget is set to `hard`; start with `soft`.

## Rollback
Code: revert the merge and restart; old pm ignores the extra tables. Data: the new tables are independent; dropping them leaves the original store working (tested). Ledger and history are append-only, so export before dropping if the record matters.

## Review gate
- Authority: roles come from the server (loopback/peer = admin; others via `role_assignments`); client sees goals only; budget raises need an approvals.mjs one-time code from a trusted principal. Reviewer should confirm the OTP delivery channel: `challenge` returns the code in the HTTP response to a loopback caller, so an agent on loopback can obtain it. A separate delivery channel (toast/ntfy) is the hardening option.
- Design review: no PM UI variant selection was visible to this worker, so three variants were not staged. If selection is still pending, treat this UI as variant A.
- Not done: pm does not yet feed goal signals into router roles; allocations are set manually via the API.
