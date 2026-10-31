---
name: project_dsh_team_platform
description: "Plan to host DSH for multiple users on a private server, with a pooled local-model tier, a project manager built inside council/swarm, and free-only swarms — drafted 2026-09-11, NOT approved, nothing built"
metadata:
  node_type: memory
  type: project
  modified: 2026-09-11T00:00:00.000Z
---

Handoff written 2026-09-11 by Claude Opus 5 (session in `~/Documents/claudecode`)
for Codex / GPT-6 and for any later session. **Status: a plan on paper only.**
Nothing was installed, written to a repo, committed or pushed. The user has not
approved it yet, and the agreed sequence is: approve the plan, then Claude Opus 5
writes a council prompt, the user approves that, and it is saved as a council
preset. Do not start building from this note.

## What the user asked for

DSH, hosted publicly behind a private password login, where a task goes first to
a **local model running on a pooled set of team machines**, then to free models,
then through **council rounds**, then to a **project manager**, and finally to
**agent swarms** that do the work, with every user seeing their own tasks
filtered. Needed alongside it: user profiles and permissions, a one-click way to
install a DSH pool node on many machines, a capacity ("power quota") tool for
local models whose limit is workload rather than tokens, and per-user token
budgets.

Council for this work: Claude CLI, Codex CLI, DeepSeek, Kimi and all free agents.
**Swarm: free agents only.** Council review after the swarm stays paid — that is
the existing economy-profile rule in [[dsh-swarm-profiles]] and it survives here.

## Hard gate before anything else (P0)

**vMixer's DSH is not fully working, so the project manager has never run.**
Every later phase lives on that server, so P0 is "vMixer DSH green", and its exit
test is `~/.dsh/verify-council.cmd` exiting 0 there — 16 checks including the
compiled `lib/index.js`, `codex` resolving from the bare name, FCC listening and
a live round per CLI seat.

First suspect, from [[project_clone_migration_vmixer]]: the secrets restore was
never confirmed on vMixer (the run stalled on bootstrap's Docker/WSL prompt,
fixed with `--yes`, unverified), and the RUN-ALL result has never been seen from
ndi2. An unrestored `free-claude-code\.env` explains a DSH that boots with failing
seats and a short FCC catalog. The exact symptom was not yet reported by the user
when this note was written.

## Decisions already made — do not relitigate

- **The project manager is built inside DSH**, in the council/swarm packages, not
  as a separate app.
- **Identity is borrowed from the Beacon app** (`~/Documents/claudecode/billboard-platform`),
  which `green-energy-platform` already shares: `lib/auth.js` (bcryptjs, then
  AES-256-GCM over the hash, JWT session cookie, pending-2FA cookie), Google and
  Meta OAuth linked onto one User row, `lib/session.js` capability helpers,
  `middleware.js` rate limiting that reads the X-Forwarded-For chain from the
  right, Prisma on MySQL. Extract those into one shared package used by all three
  apps; Beacon issues the JWT and DSH only verifies it. Two additions: a
  `DshRole` claim separate from the marketplace `UserRole`, and machine tokens
  (`aud: "dsh-node"`, revocable rows) for node agents and headless CLIs. Better
  Auth was considered and dropped.
- **Pool nodes serve inference only.** No tools, no shell, no file writes on a
  teammate's machine. Tool execution happens in a sandboxed runner (Docker).
- **Replicas by default, sharding as one tier.** No Ethernet-level VRAM merge
  exists. Pipeline parallel across machines is viable (only the hidden state
  crosses the wire); tensor parallel across Ethernet is not (two all-reduces per
  layer). Sharding is LAN-only — over Tailscale/WAN the per-token round trips
  make it unusable. So: `pool-s` (7-14B), `pool-m` (one node, 70B Q4, the normal
  council/swarm seat), `pool-xl` (2-4 co-located nodes, pipeline parallel,
  235B-400B Q4, used only for plan and review).
- **One seat broker for every scarce seat.** Generalize the agy router from
  [[project_antigravity_seat_pool]] — lease, park on quota with `resetTime`,
  replay the prompt on hand-off — to cover Claude CLI, Codex CLI, the agy pool,
  FCC and local pool nodes.
- **Model-facing PM tools are read-mostly**, built the way `presets.ts` is: the
  schema cannot express an approval, a budget change or a paid-seat assignment.
  That construction is the only reason the approval gate holds.
- Approval moves from the global `approvedPlanId` settings key to
  `(userId, jobId, planHash)` in the database, with a role check. Keep the
  existing shape: button press plus a later user turn, single-use, 15-minute TTL.

## What the PM is built from (existing code)

- `decompose.ts` `SubTask` (`id`, `title`, `detail`, `dependsOn`, `provider`,
  `tier`, `acceptance`, `files`) is already the PM task record.
- `experimental/agent-team/src/task-board.ts` (`TeamTaskBoard`) already has DAG
  commands, authorization, transitions, derived views and cycle/duplicate/missing
  detection. Lift the code into a supported package; do **not** mount
  `agent-team`, which carries `spawn_teammate` and stays `disabled: true`.
- `goal/goal` is the event-sourced fold plus compare-and-set idiom to copy.
- `storage/storage-domain` + `storage-sqlite` for rows; pipeline state lives in
  `settings.yaml` `pipeline*` keys today, which is one run per home, overwritten.
- `jobs/jobs` + `jobs-local` for run lifecycle and cancellation.
- `staging.ts` / `writes.ts` candidate roots as the artifact store.
- New packages: `pm/pm`, `pm/tool-pm`, `client/ui-pm-board` (derive client state
  from the host — the client/host drift bug already hit `SwarmRoster` and the
  budget panel).
- Pipeline stage boundaries write into PM: `planVerdict` becomes an Epic, the
  validated `Decomposition` becomes Tasks, each swarm wave opens Runs, review
  writes the verdict, and a quota hold sets status `held` with its `resetTime`.

## Phases, each with the test that proves it

| Phase | Exit test |
|---|---|
| P0 vMixer DSH green | `verify-council.cmd` exits 0 on vMixer; every enabled seat answers |
| P1 PM package | Epic and Task graph survive a restart; `tool-pm` cannot express an approval |
| P2 Pipeline writes into PM | A full council-swarm-review run appears on the board with costs and seats |
| P3 Identity | Beacon JWT verified by DSH, `DshRole` claim, machine tokens; user A cannot see user B's tasks |
| P4 Pool + seat broker | A node joins in one click; leases cover Claude CLI, Codex CLI and local nodes |
| P5 Router + ledger | Local first, free second, escalation capped; budgets reserve then settle |
| P6 Public gateway + hardening | Unauthenticated request gets 401; swarm writes stay inside the sandbox |

Node install is one double-click (`JOIN-DSH-POOL.cmd`) per
[[feedback_one_click_bundling]]: hardware probe, Tailscale and runtime install,
tier-pinned model pull, benchmark, enrollment with a one-time code, service
install, self-test, and a `LEAVE-DSH-POOL.cmd` beside it.

## Capacity and budgets

Local capacity is measured in GPU-seconds, not tokens: slots free, queue depth,
measured tokens/sec, VRAM free, KV headroom, other processes' GPU utilization (so
a node yields to its owner), the owner's schedule window and a daily cap. KV
cache, not weights, is the binding constraint — this user's sessions run 99%
above 150k context, so a 70B Q4 at long context can spend 15-25 GB on KV alone.

Per-user budgets run per cost class, extending `CostClass` to
`local | free | included | metered`: `execution-cost.ts` estimates, the ledger
reserves before the run, `token-meter` settles actuals. `included` (Claude and
Codex subscriptions) is one quota shared by every user and needs the tightest cap.

## Measured environment facts (2026-09-11)

- ndi2 (this laptop): RTX 3050 Laptop 4 GB VRAM, 8 GB RAM — a dev box, not a pool
  node. Tailscale and Docker installed; Ollama, llama.cpp, LM Studio and vLLM all
  absent.
- vMixer: 128 GB RAM, at least 32 GB VRAM in this generation; the target is 64 GB
  VRAM per machine going forward. It hosts the headless CLIs.
- DSH today has no auth at all: `host/webserver` binds `127.0.0.1` or `0.0.0.0`
  with no token or CORS code, and `identity/anonymous-user-id` is one UUID per
  `$DSH_HOME`. Exposing it as-is would hand `tool-bash` and `tool-fs` to anyone
  with the URL. `api/gateway` and `sdk/server` carry no authentication either.
- vLLM has no native Windows build; 64 GB nodes should serve from Linux or WSL2.

## Open questions the user has not answered

1. Users: the team only, or outside people through Beacon accounts too?
2. Public host: a small VPS (~$6/month) or a Cloudflare Tunnel from vMixer?
3. May non-admin users trigger paid seats (Claude, Codex, DeepSeek, Kimi)?
4. Will the 64 GB machines share one LAN? That decides whether `pool-xl` exists.
5. The exact vMixer symptom for P0.

## Standing constraints for whoever picks this up

Nothing without permission — no installs, no repo writes, no spending. Commit
locally only and file a push request; never push. Name your model in anything the
user reads. See [[nothing-without-permission]], [[no-live-git-pushes]],
[[feedback_test_before_instructing_user]], [[dsh-council-plugin]],
[[dsh-pipeline-chain]], [[dsh-swarm-profiles]], [[project_clone_migration_vmixer]],
[[project_antigravity_seat_pool]], [[user-budget-parameters]].

**2026-09-17 reconciliation (Claude Opus 5):** The decision "PM is built inside DSH" is superseded by PM v1 as a standalone service ([[project_agent_project_manager]]). The 2026-09-15 amendment covering the team operating surface, dynamic resolver, profiles and completion bar now lives in [[dsh-target-architecture]], [[dsh-runtime-routing]], [[dsh-user-profiles]] and [[dsh-platform-completion]].
