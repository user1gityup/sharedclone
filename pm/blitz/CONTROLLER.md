# pm/blitz run controller (BLITZ-05)

Written by Claude Opus 5.5. The contract BLITZ-06/07/08 code against. Files: `campaigns.mjs` (tables), `controller.mjs` (state machine), `dag.mjs` (waves), `campaign-routes.mjs` (REST). Nothing here dispatches real work.

## Build one

```js
import { createController } from './blitz/controller.mjs'
const ctl = createController({
  store,                                   // pm store; tasks read from store.db
  db,                                      // blitz tables; default store.db
  ledgerDb: () => bridge?.queue?.db ?? null, // approval ledger (bridge db); null = every task blocked
  registry,                                // BLITZ-04 registry; default createAgentRegistry(db, {store, clock, machines})
  dispatch, verify, escalate,              // injectable, see below
  clock: () => new Date(), onEvent: (e) => {}, leaseSeconds: 900, maxAttempts: 1,
  canLease,                                // optional ({agent, task, row, campaign}) => true | {ok, reason}
})
```

pm does not call this directly: `engine.mjs` `createEngine()` builds the one composed engine per pm process (see "Composition" below and `RUNBOOK.md`).

| dep | signature | default |
|---|---|---|
| `dispatch` | `async (task, ctx) => ({ ref?, result? })` | throws `dispatch not wired (BLITZ-05 build only)`; the task goes `failed` |
| `verify` | `async (task, result, ctx) => ({ verified, failed?, reason?, evidence? })` | `{verified:false, reason:'verifier not wired'}`, so nothing is ever marked verified |
| `escalate` | `async (problem, ctx) => ({ escalated?, ref? })` | records the event only (`{escalated:false, recorded:true}`) |
| `onEvent` | `(event) => void` | none. Runs after the event's transaction commits. Errors are swallowed. |

- **dispatch `ctx`:** `{campaign:{id,title}, agent, attempt, lease_until, idempotencyKey, resumeFrom, actor, now, once(step, fn), reported(n), checkpoint({stage, artifacts}), heartbeat({stage?, artifacts?, leaseSeconds?}), cancelRequested()}`.
  - `resumeFrom` is the last checkpoint from a reclaimed attempt.
  - `reported(n)` is true when attempt `n`'s result or failure was already recorded. The BLITZ-08 dispatcher adopts a prior run only when it was never reported (crash, expired lease), so a run whose failure was reported (for example a quota error) is never adopted again.
- **verify `ctx`:** `{campaign, attempt, actor, now, agent, escalate(problem)}`. `agent` is the builder (the row's agent). `escalate` raises through the controller (deduped per task, reason and attempt; parks the task when the hook says `escalated:true`).
  - `ctx.once(step, fn)` runs `fn` at most once per (campaign, task, step) across all attempts. A repeat call returns the stored result with `replayed:true`. Wrap every commit, merge or pm write in it.
- **Returned `result`:** if dispatch returns one, the task is reported at once, as if the worker had called `reportResult`. Otherwise the task stays `running` until a worker reports.
- **escalate `problem`:**
  - Shape: `{kind, campaign_id, task_id, reason, attempt?}`.
  - Kinds: `approval`, `cycle`, `dependency_failed`, `dispatch_failed`, `task_failed`, `verification_failed`, and `verifier_unavailable` (from the verifier via `ctx.escalate`).
  - Each (task, reason, attempt) is raised once, so a retry that fails with the identical text is raised again.
  - If escalate returns `escalated:true`, the task is parked as `escalated` and dependents wait. Unrelated tasks continue.

## States

- **Campaign:** `draft -> preflighted -> launched -> running <-> paused -> completed | cancelled | failed`.
  - A campaign is cancelling while `cancel_requested_at` is set.
  - `update` on a preflighted campaign returns it to `draft`.
- **Task (row in `blitz_campaign_tasks`):**
  - States: `pending`, `blocked` (reason prefix `deps:`, `approval:` or `cycle:`), `leased`, `running`, `awaiting_verification`, `verified`, `failed`, `escalated`, `cancelled`.
  - Settling: the campaign completes when every task is verified or cancelled. It fails when no task is open and some task is failed with `attempt >= maxAttempts`. It stays running while any task is blocked, escalated or awaiting verification.

## Calls

All calls take `w = {actor, model}`.

| call | notes |
|---|---|
| `create(w, {id?, title?, projects \| top_n, tasks?, roster, schedule?, idempotencyKey?})` | Roster may be empty in draft. It is never defaulted. |
| `update(w, id, {rev, roster?, projects?, schedule?, title?})` | Only in draft or preflighted. |
| `preflight(w, id, {rev})` | Snapshots the open coding tasks (or the `tasks` given) and their DAG waves. Reports roster, cycle and approval problems in `preflight.problems`. |
| `launch(w, id, {rev, authorizedBy})` | Refuses (400) without `authorizedBy`, or on an empty roster, an empty slot, or an unknown or disabled agent. Uses BLITZ-04 `selectRoster`. |
| `pause` / `resume` / `cancel(w, id, {rev, reason?})` | Cancel is two-phase: idle tasks cancel at once, and leased tasks get `cancel_requested`. |
| `ackCancel(w, id, {taskId, owner})` | Phase 2. The campaign cancels when no lease remains. |
| `tick(w, id, {rev?})` | One deterministic round, described below. |
| `recover(w, id)` / `recoverAll(w)` | Reclaims expired leases: the task goes back to `pending`, or to `cancelled` when a cancel is pending. Then the campaign settles. |
| `heartbeat` / `checkpoint` / `reportResult` / `reportFailure` `(w, id, {taskId, owner, attempt?, ...})` | Worker calls, fenced by lease owner, attempt and lease expiry (409 otherwise). |
| `requeue(w, id, {taskId, reason, rev?, avoidAgents?})` | Moves a failed, escalated, blocked or awaiting_verification task back to `pending`. `avoidAgents` is added to the task's `avoid_agents` (BLITZ-06 per-task reassignment). |
| `park(w, id, {taskId, reason, rev?, ref?})` | Moves an idle task (pending, blocked, failed, awaiting_verification) to `escalated` and writes `task_escalated`. A given `rev` must match the task row (409 otherwise). Returns the row, or `null` when the task is not idle. |
| `reverify(w, id, taskId)` | Re-runs `verify` on an `awaiting_verification` task with the same attempt fence, raises `verification_failed` like a first verification, then settles. 409 when the task is not awaiting verification or changed meanwhile. |
| `once(id, key, fn)` | The idempotent side-effect primitive behind `ctx.once`. |
| `status(id)` / `dag(id)` / `events(id, {since, limit, task, kind})` | Read-only. |

**Each `tick`:**
1. Moves `launched` to `running`.
2. Re-queues failed tasks that have attempts left.
3. Refreshes `deps:` blocks. An in-campaign dependency must be `verified`; an outside one must be pm `done`.
4. Orders the ready tasks by wave, then priority, then `created_at`, then id.
5. For each one, until the roster's `max_concurrent` slots are full:
   - picks the first free agent that fits the task: `meta.blitz.role` must match; a task with no role never goes to a `verifier`-role agent. Agents in the task's `avoid_agents` are skipped while another fitting agent exists (if only avoided agents fit, they are used, so a task is never stuck). `canLease`, when given, can refuse an agent;
   - calls BLITZ-03 `assertTaskApproved(ledger, task, 'task_scope')` (a failure becomes `blocked` with an `approval:` reason, and an event);
   - takes the lease;
   - dispatches under the key `<campaign>:<task>:dispatch:<attempt>`.
6. Settles the campaign.
7. Returns `{campaign, leased, dispatched, failed, skipped?}`.

## Rules

- **Writes and rev:** every campaign write checks `rev`; a stale rev returns 409 with `extra.current`. Task-row writes are fenced by the row's own rev.
- **Idempotency:**
  - Public writes accept `idempotencyKey`. A repeat returns the first result with `replayed:true` and is not rev-checked.
  - `reportResult` and `reportFailure` are idempotent per (task, attempt) even without a key.
- **Checkpoints:** structured `{stage, attempt, artifacts[], at}`, kept on the task row and written as `checkpoint` events.
- **Events:** `blitz_run_events` is append-only; SQLite triggers refuse UPDATE and DELETE.
- **Gate:** the controller never calls pm's `/api/tasks/:id/(start|resume|continue|runs)` routes. It reads tasks directly and checks the approval gate itself.

## Composition (`engine.mjs`)

`createEngine({store, ledgerDb, bridge, ...})` builds ONE engine per pm process: `guard(recovery(controller))`.

- The controller gets the real BLITZ-08 dispatcher (wrapped by BLITZ-06 `wrapDispatch`), `verify` = the BLITZ-07 verifier, `escalate` = BLITZ-06, `maxAttempts: 1`, and `registry` = guard-narrowed (BLITZ-08) over held-provider-filtered (BLITZ-06) BLITZ-04 registry.
- The exposed controller's `tick` is `recovery.tick` (pump, then the guarded tick). Its `reportResult` turns a quota error reported as success (`looksRateLimited`, poller pointer artifacts ignored) into `reportFailure`, so it is classified `RATE_LIMIT` and parked; a `quota_as_success` event records it.
- Campaign, recovery, verify and status routes, the poller and the runner all share that controller, recovery and verifier.
- The guard stays on its narrowed registry rather than `canLease`: its round-robin allocation across the roster (exact global/provider ceilings, per-agent deferral reasons) is what `dispatch.test.mjs` and `pilot.test.mjs` prove. `canLease` exists for per-lease vetoes.

**Who requeues what.** With `maxAttempts: 1` the controller never retries on its own. A `verification_failed` (TEST_FAILURE) is requeued only by BLITZ-06 `pump()` after its backoff, once per decision; the verifier never requeues and integration never requeues. Transport and timeout failures are reassigned per task (`avoidAgents`), never by a global agent cooldown. A rate limit parks the task and holds the provider until the parsed reset (or a human answer); nothing retries inside that window.

## REST (`campaign-routes.mjs`, mounted in server.mjs after BLITZ-02)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/blitz/campaigns` | list / create |
| GET/PATCH | `/api/blitz/campaigns/:id` | read / edit |
| POST | `/api/blitz/campaigns/:id/(preflight\|launch\|pause\|resume\|cancel\|tick\|recover)` | campaign actions |
| GET | `/api/blitz/campaigns/:id/(dag\|status\|events)` | reads |
| POST | `/api/blitz/campaigns/:id/tasks/:task/(heartbeat\|checkpoint\|result\|failure\|cancel-ack\|requeue)` | worker and recovery calls |

The patterns are anchored, so BLITZ-02's `/campaigns/:id/qa*` routes still match the same campaign id. Re-verification is BLITZ-07's `POST /api/blitz/campaigns/:id/tasks/:task/verify`, which calls `controller.reverify`.
