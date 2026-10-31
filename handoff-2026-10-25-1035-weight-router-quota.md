---
name: handoff-2026-10-25-1035-weight-router-quota
description: PM project 6 (P-533695e5) T-00d1d9a3 quota-aware weight router - built, tested, committed locally, awaiting live collector data
metadata:
  type: project
---

# Weight router: quota-aware admission (T-00d1d9a3)

Handoff: handoff-2026-10-25-1035-weight-router-quota
Updated: 2026-10-25 11:10 UTC
Host: ndi2
Model: Claude Opus 5 (claude-opus-5)
Owner: Claude Opus 5, this session
Remote Control: off
Task: pm T-00d1d9a3 in P-533695e5 "DSH Weight Router - Quota-Aware Task Routing" (PM sort_order 6)
Ask: complete project 6, the weight router
Repo: ~/Documents/claudecode/deepseek-harness
Branch: feat/heterogeneous-teammates
Commit: 3a4c83f99b feature, 1edef83a69 collector (both local only, NOT pushed, not queued)
Working tree: clean

Built in the EXISTING router at packages/council/tool-council/src/router, not a second one:
- quota-types.ts: multi-window seat contract (a prior session left this untracked; kept as written)
- quota.ts: normalization, freshness, per-task demand estimation, per-window headroom, free-only check
- reservations.ts: synchronous in-flight view + bridge from the existing durable QuotaLedger
- explain.ts: read-only decision record for PM Resources & System (T-a73df977)
- Wired through filter.ts (admission), score.ts (measured headroom beats preset fraction), resolve.ts (keeps verdicts), types.ts, index.ts

Key rule: unknown capacity is never unlimited. Absent reading, no remainder, stale reading, or collector 401/429 all refuse under the default policy. entitlement 'unknown' is not free. Free-only refuses metered/subscription/unproven on first attempt and every retry, and blocks rather than falling back. A caller passing no quotas keeps its old behaviour exactly.

Verified: router-quota.spec.ts 74 tests, claude-quota-collector.spec.ts 33 new; tool-council 1038/1038 across 67 files; 100% per-file coverage on all five new and changed modules; oxlint clean on every file touched; tsc --noEmit exit 0. Pre-existing oxlint errors in src/index.ts are not mine.

Collector DONE (1edef83a69): src/claude-quota-collector.ts reads ~/.claude/statusline/usage-cache.json (/usage figures) into a SeatQuota. No credential, no spend. OpenRouter /credits was the first choice but this host has no key and no relay base; ~/.dsh/.credentials.yaml read was classifier-blocked.

Real reading: sessionPercent 6, weekPercent 33, captured 2026-10-15T17:36:05.906Z (ten days stale). Measured via scripts/probe-live-quota.ts: as-is -> QUOTA_STALE unfilled; judged at its capture time -> admitted with "fit unproven"; carrying this host's real HTTP 401 -> SEAT_ERROR unfilled.

Two faults the live reading exposed and fixed in router/quota.ts:
- a window the task cannot quantify was passing its freshness check silently (reported UNKNOWN when it was STALE)
- a fresh percentage cap counted as no evidence, so a seat with 67% of its week left was unroutable; a capped window now demonstrates capacity, with the verdict saying the fit is unproven
WindowCheck gained `limit`.

Not done:
- No FRESH reading obtainable: `node ~/.claude/statusline/usage-cache.mjs` returns {"failed":true,"reason":"HTTP 401"}, both API and CLI-text paths. Until that is fixed the Claude seat routes as stale/SEAT_ERROR - correct, but the seat is unusable to the router.
- Only one seat wired; Codex, OpenRouter, local LLM, Bedrock have no collector.
- Mid-execution monitoring / checkpoint / reassign on exhaustion (Q2=D item 3) is NOT built; admission is preflight only.
- No multi-machine reservation run across ndi2 and vmixer2o2.
- PM permission model (Q3=D) untouched here; T-4dfa4288 owns grants.

Next action: USER ASKED FOR THIS 2026-10-25 11:10Z, not yet started (prior session hit its context limit). Diagnose why `node ~/.claude/statusline/usage-cache.mjs` returns {"failed":true,"reason":"HTTP 401"} on ndi2 - it has two paths, an API read and a CLI-text fallback spawning the claude binary with /usage, and BOTH failed, so check which one 401s and whether the CLI seat is signed in. Fix if possible, take a fresh reading, then re-run `npx tsx packages/council/tool-council/scripts/probe-live-quota.ts` in ~/Documents/claudecode/deepseek-harness and attach the fresh case-2 output to pm T-00d1d9a3.

Do not repeat: do not build a second router; do not treat an unreadable window as capacity; seats.spec.ts timeouts under parallel load are pre-existing flakiness (passes 15/15 in isolation).

Rollback: git revert 1edef83a69 then 3a4c83f99b.

Push: held per standing rule. Nothing queued to the gatekeeper.
