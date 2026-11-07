---
name: blitz-03-approval-request
description: BLITZ-03 (T-b6781685) per-task approval request (Q1) - rating schema, task_scope/task_merge approval ledger, start gate; files, base, permissions, tests, merge limit
metadata:
  type: project
---

# BLITZ-03 approval request: rating + per-task approval ledger

- **Author:** Claude Opus 5.5 (Claude Code, vmixer2o2)
- **Date:** 2026-10-19 ~06:40Z (pm clock)
- **pm:** task T-b6781685, project P-03a8c18b. Claimed rev 2, set RUNNING, execution_machine vmixer2o2 (rev 3).
- **Inputs:** BLITZ-01 audit (`blitz/BLITZ-01-audit.md`), master spec T-2df5e988 (Q1=C, Q7=D), task body of T-b6781685.
- **Status:** design only. No source file changed. Nothing is built until the user approves this request in the BLITZ-03 session.

## 1. Code location (verified)

| Checkout | What it is | Use for BLITZ-03 |
|---|---|---|
| `~/.claude/shared-brain/pm` (brain git repo) | **Authoritative live pm code.** `DEPLOY-PM-UPDATE.cmd/.ps1` deploys it on each host: brain-sync, run `test.mjs` + `bridge/test.mjs`, stop pm, restart by watchdog, readiness check. | **Base.** |
| `~/Documents/claudecode/dsh-sandbox/pm` (branch `integrate` @ fa45449, origin = a git bundle) | Step-3 staging sandbox, now **stale**. `server.mjs`, `store.mjs`, `actions.mjs` and `cli.mjs` differ from the brain by hash. `approvals.mjs`, `access.mjs` and `roles.mjs` are identical. | Not used. BLITZ-01 read this copy. Its findings for approvals, access and roles still hold. |

- **Base version:** brain HEAD `09d57653`. pm files last changed in `8a6cc9fb` (2026-10-15).
- **How it reaches ndi2 (the code master):** commit to the brain → gatekeeper push (the brain is currently 4 commits ahead of origin) → ndi2 brain-sync → DEPLOY-PM-UPDATE on ndi2. The live pm at 10.0.0.241:4480 does **not** get BLITZ-03 until then. Deploying to the vmixer2o2 or ndi2 pm is **not** part of this request; it needs its own go.
- **Build location:** a git worktree of the brain repo at `~/Documents/claudecode/blitz-03-wt` (branch `blitz-03`). The live `~/.claude/shared-brain/pm` is not edited until the reviewed diff is applied and committed.

## 2. Design

### 2.1 Rating (Q7): `meta.blitz.rating`

Schema (all required unless marked optional):

| Field | Type | Meaning |
|---|---|---|
| `priority` | int 1-5 | Urgency plus business impact (1 = highest) |
| `effort` | int 1-5 | Size of work |
| `complexity` | int 1-5 | Technical difficulty |
| `resources` | `{machine?: string, model_class?: 'local'\|'free'\|'paid', quota_cost?: 'low'\|'med'\|'high', seats?: string[]}` | Machine and model suitability, plus quota cost (task body asks for these) |
| `risk` | int 1-5 | Blast radius if wrong |
| `dependency` | `{depends_on: taskId[], blocks?: taskId[]}` | Feeds the BLITZ-05 DAG (audit contract 6) |
| `verification` | `{level: 'unit'\|'integration'\|'manual'\|'independent_review', tests?: string[]}` | Testing requirements (Q10) |
| `rationale` | string, 1-2000 chars | Why |
| `rated_by`, `rated_at`, `rated_model` | set by the server, never by the client | Audit |

- **Validation:** pure `validateRating(obj)` in `pm/blitz/rating.mjs`. It rejects unknown keys, out-of-range ints and over-long strings, and returns normalized JSON.
- **Route:** `PUT /api/tasks/:id/rating {rev, ...rating}`.
  1. Read the task.
  2. Deep-merge into `meta` (keep every other meta key: `prepared run`, `rosterRestore`, …).
  3. Call `store.updateTask(w, id, {rev, meta})`. A stale `rev` returns 409, as every other write does.
  - **Why merge:** a plain PATCH replaces `meta` wholesale (`store.mjs coerce`), so a client that writes the rating through PATCH can erase a prepared run.
- **Read:** `GET /api/tasks/:id` already returns `meta`. No new read route.
- **MCP gap (verified in the brain `cli.mjs`):** `pm_create_task` and `pm_update_task` never send `meta`.
  - Add a `pm_rate_task` tool that calls the PUT route.
  - Add an optional `meta` (object) to `pm_update_task`, documented as "replaces meta; prefer pm_rate_task".

### 2.2 Per-task approval ledger (Q1)

This extends `pm/approvals.mjs`, in the same `approvals` table in `bridge.db`.

- **New kinds:** `APPROVAL_KINDS += 'task_scope', 'task_merge'`.
- **New status:** `revoked`, for an approved record that is withdrawn after a material scope change or by an admin or manager.
- **Scope, validated in `requestApproval` for the two new kinds:**

```json
{ "project": "P-…", "task_id": "T-…", "task_rev": 7,
  "scope_hash": "sha256 of material task fields (server-computed)",
  "scope": { "repo": "abs path or url", "branch": "blitz/T-…", "files": ["glob", …], "summary": "…" },
  "permissions": ["fs_write:<repo>", "run_tests", "git_commit_local", …],
  "version": "<base commit sha>",
  "merge_limit": "none" | "local_commit" | "queue_gatekeeper",
  "supersedes": "<approval id>?" }
```

- **Validation rules:**
  - `merge_limit` never accepts `push`, `merge_main` or `*`.
  - `files` must be non-empty and cannot be `**` alone.
  - `project` must equal the task's project.
  - `task_merge` requires a valid approved `task_scope` for the same `task_id`.
- **Request route:** `POST /api/blitz/tasks/:id/approvals {kind, scope, permissions, version, merge_limit}`.
  - The server reads the live task and fills in `project`, `task_id`, `task_rev` and `scope_hash` itself. A client cannot bind an approval to a rev or hash it chose.
  - A token principal is recorded as `requested_by`.
  - **Why this route matters:** it is the first REST issuance path for these kinds. BLITZ-01 gap: approvals and grants had none.
- **Decide:** the existing `POST /api/bridge/approvals/:id/decide`, unchanged.
  - `decideAs` already forces a token principal (for example chatgpt) to `{via: principal}`, so its decision stays `pending_user_confirm`.
  - Only otp, pm_ui, interactive or link from the human approver finalizes it.
- **Revoke:** `POST /api/blitz/approvals/:id/revoke {reason}`. Admin, or a manager of the project, moves it from `approved` to `revoked`, with an audit entry.
- **Renew:** a new request with `supersedes`. When the new one is approved, the old one is revoked automatically.
- **Default validity:** `task_scope` 7 days and `task_merge` 2 days, instead of the 30-day default. Either can be overridden at decide (`validSeconds`) and is capped at 30 days.

### 2.3 Enforcement: `assertTaskApproved(db, task, kind, now)` in `pm/blitz/gate.mjs`

The gate refuses with 409 `APPROVAL_REQUIRED` plus reasons when any of these holds:

1. No `task_scope` approval exists for the `task_id`.
2. The approval's status is not `approved`, or `isApprovalValid` is false. That function also marks a lapsed approval `expired`.
3. The approval's `scope_hash` differs from the hash of the task now. This covers "bound to an older task_rev" in the material sense.
4. `approval.task_rev` is greater than the current `rev`, which is impossible and treated as forged.
5. For a merge or queue: `task_merge` is missing or invalid, or the requested merge action exceeds `merge_limit`.

**Why a hash, not a raw rev compare.** pm bumps `rev` on every write: claim, PATCH of `next_action`, `checkpoint`, `lifecycle`, and release. A strict `rev ==` rule would void every approval the moment the worker claims the task.

- **Material fields:** `project_id`, `title`, `body`, `kind`, `meta.blitz.scope`.
- **Not material:** lease, lifecycle, `next_action`, `checkpoint`, `meta.blitz.rating`.
- A material edit makes the hash mismatch. The gate then fails closed and auto-marks the approval `revoked` with reason `scope_changed`. This is the "revoke/renew after material scope changes" from the task body.

**Open choice, user decides at approval.** Option A, recommended: hash binding as above. Option B: strict `task_rev` equality, which means re-approving after every claim.

**Where the gate is called (no-bypass):**

- `POST /api/tasks/:id/(start|resume|continue)` and `POST /api/tasks/:id/runs`, for tasks under Blitz governance.
- **Governed means either:**
  - the task's project is in `blitz_governed_projects`, a new table in `bridge.db` with admin-only writes, so a PATCH that strips `meta` cannot escape it; or
  - the task has `meta.blitz`.
- Other pm tasks behave as today. Nothing changes for current DSH/pm users.
- **Exported for later tasks:** `assertTaskApproved` and `GET /api/blitz/tasks/:id/approval-status`. BLITZ-05 (controller) and BLITZ-07 (`queue-build` merge step) call them. `runners/claim` is left to BLITZ-05 because the runner already refuses auto-launch.

### 2.4 Roles

`access.approvalAuthorizer` is reused unchanged: `roles.assertAllowed(…, 'approve', {project: scope.project})`.

- **admin:** any project.
- **manager:** only a project it was itself assigned.
- **worker and client:** never.
- **Other actions:** revoke and the governed-projects admin use the same check. Adding a project to governance is admin only.
- **Live state, not changed here:** no roles are seeded (handoff 10-13). Until an admin assignment exists, only `loopback` and `peer` can decide. Seeding is out of scope and would need its own go.

## 3. Exact files

All paths are relative to the brain-repo worktree.

| File | Change | Owner / sequencing |
|---|---|---|
| `pm/approvals.mjs` | +2 kinds, +`revoked` status, `validateTaskScope`, `revokeApproval`, supersede, per-kind default TTL | BLITZ-03 |
| `pm/blitz/rating.mjs` (new) | `validateRating`, `mergeRating(task, rating, w)` | BLITZ-03 |
| `pm/blitz/gate.mjs` (new) | `scopeHash(task)`, `assertTaskApproved`, `isGoverned`, `blitz_governed_projects` migrate | BLITZ-03 |
| `pm/blitz/routes.mjs` (new) | `blitzApprovalRoutes(store, bridgeDb)`: rating PUT, approval request, revoke, approval-status, governed-projects admin | BLITZ-03 |
| `pm/cli.mjs` | `pm_rate_task` tool, `meta` on `pm_update_task` | **Shared.** BLITZ-02 may add Q&A tools. Sequence: whoever lands second rebases. |
| `pm/server.mjs` | ~6 lines: import, register blitz routes (they need `store` + `bridge.queue.db`), call the gate before `act(start/resume/continue)` and `startRun` | **Shared.** BLITZ-02 and BLITZ-04 may register routes too. Sequence BLITZ-03 first or merge by hand. |
| `pm/store.mjs` | **No change.** Rating uses `updateTask` with read-merge-write. | none |
| `pm/actions.mjs` | **No change.** The gate sits in `server.mjs` so `refusals()` stays pure. | none |
| Tests (new): `pm/blitz/rating.test.mjs`, `pm/blitz/gate.test.mjs`, `pm/blitz/routes.test.mjs`; additions in `pm/approvals.test.mjs` | see §5 | BLITZ-03 |

**Not touched** (owned by BLITZ-02 and BLITZ-04): discovery, Q&A, top-N, the router, the agent registry, the quota poller, `bridge/weight.mjs` and the runner.

## 4. Permissions needed

- **Read and write** `~/Documents/claudecode/blitz-03-wt/` (a new brain worktree): `git worktree add` on the brain repo.
- **Run:** `node` for the test files and suites (`pm/test.mjs`, `pm/bridge/test.mjs`, `pm/*.test.mjs`, `pm/blitz/*.test.mjs`) against temp databases only.
- **After review, apply** the diff into `~/.claude/shared-brain/pm`, then `git commit` in the brain repo (local).
- **Queue:** `queue-build.mjs` helper for the brain repo.
- **pm REST:** comments, artifacts and fields on T-b6781685.
- **Not requested:** live pm restart or deploy on either host, writes to live `bridge.db` or `pm.db`, role seeding, deciding the 2 stale permission_resume approvals, any push, any Blitz run.

## 5. Tests to add

1. **Rating:** valid object accepted and normalized. Each field out of range or unknown key gives 400. Server-set fields from the client are ignored. The merge keeps other meta keys. Stale rev gives 409.
2. **Approval request:** the server binds `task_rev` and `scope_hash`, and client-supplied values are ignored. `merge_limit:'push'` gives 400. Empty `files` or `**` gives 400. Project mismatch gives 400. `task_merge` without an approved `task_scope` gives 409.
3. **Decide (no-bypass):**
   - A token principal (chatgpt) gives `pending_user_confirm`, never `approved`.
   - A worker or client role gives 403.
   - A manager of another project gives 403.
   - A manager of its own project with pm_ui gives `approved`.
   - An admin can approve in any project.
   - Replayed OTP gives 409.
4. **Gate:**
   - Missing approval: refused.
   - Pending, rejected or `pending_user_confirm`: refused.
   - Expired: refused, and the record is marked expired.
   - Body edited after approval: refused, and the approval is auto-revoked.
   - Non-material edits (claim, `next_action`, lifecycle, rating): still allowed.
   - Forged higher `task_rev`: refused.
   - Revoked: refused.
   - Superseded and renewed: the new approval passes and the old one is revoked.
5. **Governance:** stripping `meta.blitz` from a task in a governed project is still gated. A non-governed task without `meta.blitz` is unaffected. A non-admin adding a governed project gets 403.
6. **HTTP integration (temp server):** `start`, `resume`, `continue` and `POST /runs` return 409 `APPROVAL_REQUIRED` for an unapproved governed task, and pass once approved.
7. **Regression:** all existing suites are still green (`test.mjs`, `bridge/test.mjs`, the 9 `*.test.mjs`).

## 6. Merge limit

- Commit locally in the brain repo only, one commit for BLITZ-03 with a Co-Authored-By line.
- Queue through `node "~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/queue-build.mjs" "<brain repo>" "Claude Opus 5.5" "<checks run>"`.
- **Never push.** No deploy or restart of any pm.
- Evidence (test output and commit sha) goes to T-b6781685 as artifacts. The task moves to VERIFY, not done, until it is independently reviewed (Q10).

## 7. ETA (estimated, no prior run)

- Build plus tests: ~2.5 h after approval.
- Review and apply to the brain: ~20 min.
- Total about 3 h wall clock from the go.

## 8. Decisions for the user at approval

1. Approve this request as written: scope, files, permissions, merge limit.
2. Rev binding: **A** (material-scope hash; recommended) or **B** (strict `task_rev`).
3. Governance trigger: a governed-projects table plus `meta.blitz` (as above), or `meta.blitz` only.

## Out of scope / noted

- The 2 stale pending permission_resume approvals (10-13, 10-14) are left untouched.
- The `claimInTx` lifecycle bug is confirmed again on this task: claim left lifecycle READY, and a manual PATCH set it to RUNNING. Not fixed here because it is in `store.mjs`, a shared file.
- The dsh-sandbox staleness is recorded so that BLITZ-02 and BLITZ-04 also base on the brain repo.
