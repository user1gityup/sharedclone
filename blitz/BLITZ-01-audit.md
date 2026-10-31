---
name: blitz-01-audit
description: BLITZ-01 read-only audit of pm, bridge and DSH: reuse matrix, gaps, proposed API contracts, dependency map for Blitz Complete (P-03a8c18b)
metadata:
  type: project
---

# BLITZ-01: DSH/PM architecture audit and reuse points

- **Author:** Claude Opus 5.5 (Claude Code, vmixer2o2)
- **Date:** 2026-10-19 ~06:20Z
- **pm references:** task T-99b43380, project P-03a8c18b
- **Scope:** read-only. No source files changed. The only things written are this report, the pm claim and task fields, and a pm comment.

## Sources inspected

- **pm checkout:** `~/Documents/claudecode/dsh-sandbox/pm` on vmixer2o2. Its enclosing repo HEAD is fa45449.
- **Live pm:** `10.0.0.241:4480` (ndi2/vmixlaptop2x6), read with GET requests only.
- **DSH:** `deepseek-harness` on `feat/heterogeneous-teammates` @ d02f20492e, package `packages/council/tool-council`.
- **Brain notes** on routing, swarm, machines and the gatekeeper.
- **Caveat:** the live pm runs on ndi2, so this checkout may differ from the code that is running. Confirmed example: the local `actions.mjs:35` is `ALIAS_GROUPS = [['ndi2','vmixlaptop2x6']]`, and the vmixer pair is absent here.

## Machines (verified)

There are 2 physical hosts. ndi2 and vmixlaptop2x6 are the same machine, alias-grouped in pm.

- **vmixlaptop2x6/ndi2**
  - LAN address: 10.0.0.241
  - Roles: pm master and bridge host. Peer: vmixer2o2.
  - No local LLM.
- **vmixer2o2**
  - LAN address: 10.0.0.244
  - Hardware: GTX 1070 8 GB, 128 GB RAM, local llama on port 8090.
  - Runs all DSH runs (policy `feedback_runs_on_vmixer`).
- **Endpoint ports** (`fleet/endpoints/*.json`): pm 4480, dsh 3080, fcc 8082, llama 8090, relay 8091.
- **Live state:**
  - `/api/runners` is `[]`; no runner daemon is registered anywhere.
  - Bridge `running` is `[]`.
  - 2 permission_resume approvals are stale and still pending, from 10-13 and 10-14.

## Reuse matrix

| Blitz capability (Q#) | Existing component | Verdict |
|---|---|---|
| Task store, claim/lease, rev, events | pm `store.mjs` (tasks, runs, runners, comments, artifacts, events) | **Reuse** |
| Top-10 priority projects (Q2) | Only task `priority` 1-3; projects have no priority column | **Extend**: new aggregate query and endpoint |
| Hybrid discovery: pm, linked issues, repo audit (Q2) | pm `upsert` by `source_ref` (idempotent); connectors/ | **Extend**: no GitHub/`gh` client anywhere; repo audit absent |
| Project-by-project Q&A (Q8) | pm comments, plus `instruction` comments with ack | **Absent** as an object; build on comments |
| Comprehensive rating (Q7) | `priority` plus free `meta` JSON | **Extend**: schema and validation in `meta.blitz.rating`; the MCP create/update tools drop `meta` |
| Per-task individual approval (Q1) | bridge `approvals.mjs` (kind, scope JSON, audit, OTP/pm_ui proof, pending_user_confirm for relayed decisions), plus `roles.mjs` | **Extend**: add kinds `task_scope`/`task_merge`, bind to `task_id` and `rev`, enforce at claim and merge |
| Named agent roster (Q3) | DSH seats (`seats.ts`), swarm workers (`roster.ts`), bridge `claude-code` worker | **Absent**: seats are model endpoints, not named agents |
| User-picked roster | pm `actions.mjs` prepare/start refuses empty slots | **Reuse** (enforced in code) |
| Quota-aware routing (Q4) | `router/resolveRoster` (cost classes, policies, quota factor); bridge `weight.mjs` quota gate (fail-closed 95%) | **Reuse** the resolver. **Extend**: `buildRegistry`/`MachineProfile` are unwired (only referenced inside router/); throughput is a 50 tok/s placeholder |
| Quota feed (Q4) | Claude `usage-cache.json` + `quota-guard/exhausted.json`; quota-codex, quota-antigravity, quota-aws packages; `quota-ledger.ts` (reserve/commit/release CAS) | **Extend**: no single machine-wide poller; ledger unwired and single-host |
| Isolated workspaces (Q5) | DSH host-commit worktrees `~/.dsh/worktrees/<repo>/<runId>`; pm runner per-claim clone; per-run seat cwd | **Reuse** |
| Dependency-aware scheduling (Q5) | `decompose.ts` waves (in-run only); pm `blockers` free text | **Extend**: task-level DAG absent |
| Durable headless runs (Q12) | `dsh-run.mjs` (slots, atomic run file, detached supervisor, resume/stop, `maxPipelineRuns` = 4); pm runs (heartbeat, fence, reattach, 2-phase cancel, finish); bridge `bridge_runs` | **Reuse** the executors. **Extend**: pm runs and bridge_runs are unlinked; checkpoints are one string; pause works only before start |
| Agentic coding worker | bridge `startClaude` (`claude -p`, stream-json, permission park/resume, quota gate, 2 slots) | **Reuse**. DSH seats are text-only with `WRITE:` blocks |
| Execution trigger | pm `runner.mjs` refuses auto-launch and DSH kinds by design; `actions.mjs` has no `claude-code` driver (501) | **Extend**: the Blitz controller needs an authorized launch path. Must stay gated by the Q1 approval |
| Retries and reassignment (Q6) | Auto Mode `judge` (5 attempts, same-signature stop, 6 h hold); bridge single retry; failover chain | **Extend**: failover rewrites the shared lane `settings.yaml`, so use per-run `DSH_HOME` lanes |
| Human escalation (Q6) | bridge `sweepOverdue` → pm event plus `escalate_to` (empty in live policy); approvals park | **Extend**: link pm question comments to bridge threads; set `escalate_to` |
| CI and verification (Q9, Q10) | host-commit checks + secret scan + denied paths; `judge`; lefthook; GitHub `ci.yml` | **Reuse** the local gates. **Absent**: PR/CI polling |
| Controlled merge/release (Q9) | host-commit → `queue-build.mjs` → Gatekeeper (human-approved push) | **Reuse as-is**; agents never push |
| Live status (Q11) | pm `/api/events`, `/api/bridge/health`; UI views for Projects, Tasks, Runs, Machines, Routines | **Extend**: no aggregate swarm status; no notify read API; no pm version field |

## Proposed API contracts (for BLITZ-02..08; not implemented)

All of these sit under pm REST and reuse the bearer token and role checks (`access.mjs`). Every write takes `rev`.

1. **Campaign**
   - Routes: `POST /api/blitz/campaigns {projects?:[id], top_n?:10, roster:[agent], schedule?:{at|cron}}`, `GET /api/blitz/campaigns/:id`, and `POST …/:id/(preflight|launch|pause|resume|cancel)`.
   - `launch` refuses without explicit user authorization (Q12) and with any empty roster slot.
2. **Top-N**: `GET /api/blitz/top-projects?n=10`.
   - Rank by min open-task priority, then the count of priority-1 open tasks, then age, unless an explicit `projects.priority` column is added.
   - Returns the ranking inputs so the order is auditable.
3. **Q&A**
   - Routes: `POST /api/blitz/campaigns/:id/qa {project, question, options?}` and `POST /api/blitz/qa/:qid/answer`.
   - Stored as pm comments with `kind:'question'` and mirrored to a bridge thread (`correlation_id` = qid).
   - Runs one project at a time (Q8).
4. **Rating**: `PUT /api/tasks/:id/rating {priority, effort, complexity, resources, risk, dependency, verification, rationale}` writes `meta.blitz.rating` with schema validation.
5. **Approval ledger**
   - Reuse the `approvals` table with new kinds `task_scope` and `task_merge`.
   - Scope is `{project, task_id, task_rev, scope, permissions, version, merge_limit}`.
   - Decisions use the existing `/api/bridge/approvals/:id/decide`. Relayed decisions stay in `pending_user_confirm`.
   - The controller refuses to start a task whose approval is missing, expired, or bound to an older `task_rev`.
6. **Dependencies**: `meta.blitz.depends_on:[taskId]`, plus `GET /api/blitz/campaigns/:id/dag` to return the waves.
7. **Agents**
   - Registry routes: `GET/POST /api/blitz/agents`, records `{name, role, machine, transport: bridge-claude|dsh-run|codex, model_policy, max_concurrent}`.
   - Machine capacity and quota come from a new poller writing `GET /api/blitz/capacity` (per machine: slots free, quota % per provider, local LLM up).
8. **Status**: `GET /api/blitz/campaigns/:id/status` returns tasks by lifecycle, agents, machines, quotas/costs, DAG, failures and escalations. The Phase 2 GUI reads the same endpoint.

## Gaps / missing capabilities (ranked)

1. **No authorized auto-execution path.** The runner and actions refuse it by design. Blitz must add one, gated by per-task approval.
2. **No per-task approval binding** (task_id + rev + scope + merge).
3. **No named-agent registry or cross-machine scheduler.** Machine data never reaches the router.
4. **No unified quota poller.** The quota ledger is unwired.
5. **No task-level dependency DAG.**
6. **No Q&A object and no comment↔bridge-thread link.** `escalate_to` is empty.
7. **pm runs and bridge_runs are unlinked.** Checkpoints are an unstructured string. There is no mid-run pause.
8. **No GitHub/CI polling client.**
9. **No aggregate status endpoint or pm version stamp.** The MCP tools lack runs, runners, approvals and `meta`.

## Bugs and risks found

- **`claimInTx` lifecycle bug.** It sets `status` but leaves a stored `lifecycle` unchanged. Live, BLITZ-01 reads `in_progress` with lifecycle `READY`.
- **DSH failover rewrites the shared lane settings.** Concurrent runs in one lane can disturb each other.
- **One pipeline per DSH instance** via the web UI and pm driver. Only `DSH_RUN_ID` runs are parallel.
- **Local headless profile drift.** `~/.dsh/profiles/headless/cordis.patch.yml` forces gateless mode, which differs from the repo.
- **Push permission is policy only.** `fleet/apps.json` allows `git push` in Claude permissions, so the no-push rule is not enforced by tooling.
- **Stale pending approvals.** 2 pending permission_resume approvals (10-13, 10-14).

## Dependency map

```
BLITZ-01 audit (this)
 ├─ BLITZ-04 agent registry + capacity/quota poller + router wiring
 ├─ BLITZ-03 rating + per-task approval ledger
 ├─ BLITZ-02 top-N discovery + Q&A ──needs── BLITZ-03 (rate after Q&A)
 └─ BLITZ-05 durable run controller ──needs── 03 (approval gate), 04 (who/where)
      ├─ BLITZ-06 recovery + escalation (needs 05, bridge escalate_to)
      └─ BLITZ-07 CI/verify/merge via host-commit → queue-build (needs 05)
           └─ BLITZ-08 status + controlled pilot (needs 02-07)
                └─ Phase 2: BLITZ-09 picker/Q&A/approval UI, BLITZ-10 mission control (same API)
```

Parallel-safe after BLITZ-01: 02, 03 and 04 touch separate modules (discovery, approvals/meta, router/registry). 05 waits on 03 and 04.

## Next

The Phase 1 implementation tasks need separate user authorization. Each coding task also needs its individual approval (Q1).
