# Blitz runbook (BLITZ-08)

Written by Claude Opus 5.5. How to run a Blitz campaign headless end to end, and what proves each Phase-1 gate item. Contract for the state machine: `CONTROLLER.md`.

## Modules

| File | Task | Role |
|---|---|---|
| `rank.mjs`, `discovery.mjs`, `qa.mjs`, `discovery-routes.mjs` | BLITZ-02 | Top-N ranking, work discovery, project Q&A |
| `gate.mjs`, `rating.mjs`, `routes.mjs` | BLITZ-03 | Per-task approval gate (`assertTaskApproved`), ratings |
| `agents.mjs`, `capacity.mjs`, `agent-routes.mjs` | BLITZ-04 | Named agent registry (no default roster), quota snapshots |
| `campaigns.mjs`, `controller.mjs`, `dag.mjs`, `campaign-routes.mjs` | BLITZ-05 | Campaign store, state machine, waves, REST |
| `recovery.mjs` | BLITZ-06 | Retry / reassignment / recovery policy |
| `verify.mjs`, `integrate.mjs` | BLITZ-07 | Verification and integration |
| `guard.mjs` | BLITZ-08 | Quota stop (Claude 95%), global / provider / agent ceilings |
| `dispatch.mjs` | BLITZ-08 | Adapters `dsh-run`, `codex`, `bridge-claude`; worktrees; briefs; poller; `createBlitzEngine` |
| `runner.mjs` | BLITZ-08 | Driver: `recoverAll` at start, then recover / tick / poll per pass |
| `status.mjs`, `status-routes.mjs` | BLITZ-08 | Monitoring, measured throughput and ETAs, final report |
| `engine.mjs` | Phase 1 | `createEngine`: the one composed engine pm runs (guard over recovery over the controller, real adapters, BLITZ-07 verifier, BLITZ-06 escalation), its routes, its runner |

## Safety locks (all must hold before anything starts)

1. The campaign was **launched** with `authorizedBy` (the controller refuses 400 otherwise). Draft and preflighted campaigns are never touched by the runner.
2. pm runs with **`BLITZ_DISPATCH_ENABLED=1`**. Without it every adapter throws `dispatch disabled` before any git or process call; the task goes `failed` with that reason.
3. The task has a **`task_scope` approval** in the bridge ledger (BLITZ-03). Unapproved tasks go `blocked` with an `approval:` reason.
4. The **guard** allows the agent's provider: Claude stops at 95% session or weekly (and on the quota-guard exhausted marker); an unknown or stale reading refuses for Claude, Codex and Antigravity. The task stays `pending` with a `deferred:` reason.
5. The **ceilings** allow it: global concurrent leased/running tasks across all campaigns (default 4), optional per provider and per agent, on top of each agent's `max_concurrent`.
6. **Verification fails closed.** pm's engine has no `review` function, so every finished task stays `awaiting_verification` ("verifier review not wired") and no campaign completes until one is configured and the task is re-verified (`POST .../tasks/:task/verify`). A task also needs `meta.blitz.checks`, `meta.blitz.acceptance` and an enabled `verifier`-role agent in the roster that did not build it.

## Agent setup per transport

| Transport | Needs | Command the adapter builds |
|---|---|---|
| `dsh-run` | `model_policy.pin` or `allow` naming the seats; a lane home with `settings.yaml` that enables exactly those seats, via `BLITZ_DSH_HOME__<AGENT_NAME>` (or `dshHomes`). dsh-run has no roster flag; the lane is the roster, the default `~/.dsh` is never used. | `node <harness>/packages/council/tool-council/bin/dsh-run.mjs start <ws>/BRIEF.md --out <ws>/repo --run BLITZ-<campaign>-<task>-a<n> --auto --max-attempts 1 [--stages s] [--mode m]` with `DSH_HOME=<lane>`. Polled with `dsh-run.mjs list --json`, stopped with `dsh-run.mjs stop <runId>`. |
| `codex` | Codex logged in on the machine; optional `model_policy.pin` (passed as `-m`). | `node pm/blitz/dispatch.mjs wrap --exit <ws>/<ref>.exit.json --stdin <ws>/BRIEF.md --stdout <ws>/<ref>.out.jsonl --stderr <ws>/<ref>.err.log -- node <npm>/@openai/codex/bin/codex.js exec --cd <ws>/repo --sandbox workspace-write --json --output-last-message <ws>/<ref>.last-message.md [-m <pin>] -` (detached; `ref = codex-<campaign>-<task>-a<n>`). |
| `bridge-claude` | pm bridge on (`PM_BRIDGE` not `0`); the workspace root listed in `BRIDGE_EXEC_ROOTS` on the target machine. | Bridge `submit` to `claude-code` on the agent's machine, `id = dedupe_key = blitz-<campaign>-<task>-a<n>`, `body {prompt: BRIEF.md, model: pin, cwd: <ws>/repo, permission_mode: acceptEdits, max_turns: 50}`. Polled by correlation id; cancel sends a bridge `cancel`. |

Each task needs `meta.blitz.repo` or `meta.repo` (the git repo). The workspace is `BLITZ_WORKSPACE_ROOT` (default `~/Documents/claudecode/blitz-runs`)`/<campaign>/<task>/`, with `BRIEF.md` (task body redacted of tokens and keys) and a worktree at `./repo` on branch `blitz/<campaign>/<task>`. Agents commit locally there; nothing pushes.

## Run a campaign

All writes need `x-pm-actor`; campaign writes take the current `rev`.

1. **Agents.** `POST /api/blitz/agents` per agent (name, role, machine, transport, model_policy, max_concurrent).
2. **Create.** `POST /api/blitz/campaigns {projects, roster:[names], tasks?}`. The roster is never defaulted.
3. **Approve tasks.** One `task_scope` approval per task (BLITZ-03 routes).
4. **Preflight.** `POST /api/blitz/campaigns/:id/preflight {rev}`. Read `preflight.problems` (roster, cycle, approval) and `preflight.waves`.
5. **Launch.** `POST /api/blitz/campaigns/:id/launch {rev, authorizedBy}`. The runner picks it up on its next pass (default 15 s).
6. **Monitor.**
   - `GET /api/blitz/campaigns/:id/monitor`: tasks by state; per agent, machine and model; quota snapshot and the guard's last decision; cost (measured, estimated, unknown); wave progress; escalations and failures; throughput (measured from events); ETA per task and overall in UTC and Pacific, marked `measured` or `estimated`.
   - `GET /api/blitz/campaigns/:id/report`: final markdown report (verified, unverified, rejected, failed, blocked, cancelled, with evidence pointers).
   - `GET /api/blitz/monitor`, `GET /api/blitz/runner`, and BLITZ-05's `/status`, `/events`, `/dag`.
7. **Pause / resume.** `POST .../pause {rev}` stops new leases; running work continues and is still polled. `POST .../resume {rev}`.
8. **Cancel (two-phase).** `POST .../cancel {rev, reason}`. Idle tasks cancel at once. Running tasks get `cancel_requested`; the poller stops the run (`dsh-run stop`, process-tree kill, or bridge `cancel`) and acks. The campaign turns `cancelled` when no lease remains.
9. **Recover.** Automatic. The runner calls `recoverAll` at start-up and `recover` on every pass, so expired leases return to `pending`. On re-lease, the adapter first adopts the run named in the task's last checkpoint (if it is alive or done) instead of starting a second one. Manual: `POST .../recover`.
10. **Requeue** a failed, escalated or blocked task: `POST .../tasks/:task/requeue {reason}`.

## server.mjs wiring (applied)

```js
import { createEngine } from './blitz/engine.mjs'

// createServer(store, { token, bridge, sync, blitz = null }): mounts every blitz route set on ONE engine
const engine = blitz ?? createEngine({ store, ledgerDb: () => bridge?.queue?.db ?? null, bridge }) // no runner when built here (tests)
routes.push(...engine.routes()) // campaign + recovery + verify + status routes, shared controller/recovery/verifier

// main(), after the bridge exists:
const blitz = createEngine({ store, ledgerDb: () => bridge?.queue?.db ?? null, bridge })
blitz.start()            // runner: recoverAll now, then every 15 s: recover, recovery.tick (pump + guarded tick), poll
const server = createServer(store, { token, bridge, sync, blitz })
// stop(): await blitz.stop() before closing the store
```

The runner calls `recovery.pump()` for campaigns it does not tick (paused or cancelling), so escalations keep being delivered and answered. `createBlitzEngine` in `dispatch.mjs` is the BLITZ-08-only engine kept for its own tests; pm uses `createEngine`.

Escalations: `GET /api/blitz/escalations?campaign=<id>`, `POST /api/blitz/escalations/:id/answer {choice}` (a direct caller's answer applies at once), `POST /api/blitz/escalations/:id/confirm` for a relayed answer. Recovery view: `GET /api/blitz/campaigns/:id/recovery`.

## Steps left for a live run

1. **Restart pm** on the machine that runs it, so `server.mjs` loads the engine. The runner starts with it and does nothing until a campaign is launched.
2. **`BLITZ_DISPATCH_ENABLED=1`** in pm's environment. Without it every dispatch is refused and escalated.
3. **A review function.** `createEngine` takes `review` (plus optional `run`, `levelChecks`, `pickVerifier`); server.mjs passes none, so nothing verifies until one is wired.
4. **Repo merge rules** for integration (`rules` in `createEngine`); `{}` means nothing ever merges. Nothing pushes either way.
5. **A named roster**: register the agents (`POST /api/blitz/agents`) including one `verifier`, set lane homes (`BLITZ_DSH_HOME__<NAME>`), approve each task's `task_scope`, then preflight and launch with `authorizedBy`.

## Phase-1 acceptance gate

| # | Item | Proven by |
|---|---|---|
| 1 | Nothing runs without launch + `authorizedBy` | `pilot.test.mjs` controlled pilot (runner idle before launch; launch 400 without it); `controller.test.mjs` launch tests |
| 2 | Nothing starts without `BLITZ_DISPATCH_ENABLED=1` | `dispatch.test.mjs` "dispatch refuses..." (no spawn, no git); `pilot.test.mjs` "dispatch refused end to end" |
| 3 | Per-task approvals enforced | `pilot.test.mjs` (F blocked `approval:` until approved, then dispatched); `controller.test.mjs` unapproved-task test; `gate.test.mjs` |
| 4 | Dependency order | `pilot.test.mjs` (B waits for A verified; E blocked when C failed, `dependency_failed` escalation); `dag.test.mjs` |
| 5 | Concurrency ceilings | `pilot.test.mjs` (max 2 active across every pass); `dispatch.test.mjs` "guard ceilings" (global, provider, agent, round robin) |
| 6 | Quota refusal (Claude stop at 95%, unknown refuses) | `pilot.test.mjs` (D deferred at 97%, dispatched at 50%); `dispatch.test.mjs` guard tests |
| 7 | No duplicate dispatch on retry | `pilot.test.mjs` (extra passes + direct tick: start and submit counts unchanged); `dispatch.test.mjs` full dispatch (ctx.once replay) |
| 8 | Recovery after crash | `pilot.test.mjs` (new engine on the same db, `recoverAll` reclaims A and C, runs adopted, no new start) |
| 9 | Two-phase cancel | `pilot.test.mjs` (F keeps its lease, poller stops the run and acks, campaign `cancelled`); `controller.test.mjs` cancel tests |
| 10 | Retry / failure handling | `pilot.test.mjs` (C failed run -> `failed`, `task_failed` escalation); `controller.test.mjs` retry tests; BLITZ-06 `recovery` tests |
| 11 | Messaging | `dispatch.test.mjs` bridge adapter (one deduped submit, result, error, cancel); pilot D over the fake bridge |
| 12 | Monitoring and final report | `pilot.test.mjs` (`buildStatus` + `finalReport` sections, measured throughput and ETAs, routes) |
| 13 | Real launch on a test repo | **Not done.** Needs the user's go: a throwaway repo, one approved task, one builder and one verifier, `BLITZ_DISPATCH_ENABLED=1`, a review function, pm restart. |
| 14 | One composed engine, shared by every route set | `engine.test.mjs`: end to end through the runner (approvals, deps, ceiling, rate-limit park without a retry loop, transport reassign, verification pass and fail, escalation with a relayed answer and a direct confirm, crash recovery with a fresh engine, two-phase cancel, final report), and an HTTP test hitting campaign, recovery, verify and status routes on one engine |

Run the tests: from the worktree root `node --test "pm/blitz/*.test.mjs"`; from `pm/` `node --test` and `node test.mjs`.
