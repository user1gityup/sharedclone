# Agent Project Manager — consolidated architecture, task graph and delivery plan

Produced by **Claude Opus 5** (subagent, AGENT 1 of 4), 2026-09-15.
Source: DSH council run `9d32f748-2bc2-4737-a2e1-44164e6e2491` (2026-09-15 05:13Z) — kimi draft
(12,834 chars) + deepseek draft (25,034 chars), three reviews, all voting deepseek.
The run died at the council planning gate. No swarm stage ran, no code exists.

**This document is a proposal. Nothing has been built, no repository created, no file written
outside this scratchpad, nothing spent.**

---

## 0. What this document is

The council was supposed to produce one artifact: architecture, task graph, acceptance criteria,
cost/concurrency limits, stack decision, and the list of decisions the user must make. It produced
two partial drafts and three reviews instead, then stopped. This reconciles them into the single
artifact, and — critically — **replaces the parts both drafts got wrong about DSH** with what the
DSH source actually does (section 8, verified against
`~\Documents\claudecode\deepseek-harness\packages\council\tool-council\src`).

### Provenance of each section

| Section | From |
|---|---|
| Architecture, components, deployment form | deepseek (winner), sharpened |
| Data model | deepseek's relational tables + kimi's relationship tree (kimi is clearer on nesting; deepseek is correct on `candidate_group_id`, `approved_plan_hash`, instruction states) |
| DSH integration boundary table | kimi (deepseek has no equivalent table; kimi's is the better artifact) |
| State machines | deepseek |
| Task graph + gates | deepseek |
| Acceptance criteria | deepseek, with kimi's concrete latency/scale targets folded in |
| DSH behavior claims | **neither draft — rewritten from source** |
| Decisions list | both, deduplicated, each with a recommendation |

---

## 1. Where the reviews said the winner was thin or wrong

The three reviews voted deepseek 0.9 / 0.92 / 0.9. They named these defects:

1. **deepseek hallucinated its evidence.** It claimed evidence documents [1]–[4] were "King County
   council budget meetings, Cal State LA council expansion, and a Carlsbad ballot" and concluded
   from that the DSH seat roster could not be determined. Kimi's review called this out directly:
   those were DSH shared-brain references, not government documents. deepseek's own self-review
   admitted the hallucination and waved it off. **The conclusion deepseek drew from the
   hallucination — "read the live panel" — happens to be right, but for the wrong reason, and it
   is wrong about how.** See section 8.1.
2. **kimi assumed a seat roster** (Claude, Codex, Kimi, DeepSeek v4) from the shared brain rather
   than requiring live capture. Reviews correctly preferred deepseek here.
3. **kimi collapsed the gates** — three gates, no G0 for decisions, no separation of approval gate
   from verification gate.
4. **kimi never said the economy estimate must be rendered at the swarm gate**, only that a cost
   estimate exists.
5. **Neither draft priced anything.** Both said the estimate must be produced at runtime. That is
   true and unavoidable, but both missed that DSH already computes and renders this estimate
   (`execution-cost.ts`), so the platform must *display DSH's* estimate, not invent one.
6. **Not raised by any review, but real:** neither draft checked the DSH source. Both described DSH
   behavior from shared-brain prose. Six of those descriptions are wrong (section 8).

---

## 2. Product in one paragraph

A standalone web application that is the durable source of truth for work done by a small team of
humans together with CLI agents, DSH councils, and DSH swarms, across sessions and machines. It owns
tasks, requirements, ownership, approvals, runs, assignments, artifacts, decisions, and verification
evidence. It does **not** orchestrate models — DSH is one execution connector among several, and the
application stays fully useful with DSH switched off. Its reason to exist is that today the state of
agent work lives in transcripts and scratchpads that die with the session.

---

## 3. Architecture

### 3.1 Deployment form — one deployable service

```
┌──────────────────────────────────────────────────────────────────┐
│ apm (one process, one container, one systemd unit)               │
│                                                                  │
│  Web UI (server-rendered + islands)                              │
│  REST API  ──────┬─────────────────────────────────────────────  │
│  MCP adapter ────┤ same service layer, same authz, same events   │
│  CLI (separate   │                                               │
│   binary, talks  │                                               │
│   to REST)  ─────┘                                               │
│                                                                  │
│  Core domain: tasks, plans, runs, assignments, artifacts, events │
│  Reconciler (in-process timer): lease expiry, stale workers      │
│  Connector layer: DshConnector, ManualCliConnector               │
└───────────────┬──────────────────────────────────────────────────┘
                │
        ┌───────┴────────┐
        │  PostgreSQL    │   artifacts: local disk (phase 1-3),
        └────────────────┘   object storage later
```

Rejections, stated so they are not relitigated:

- **No message broker, no Redis, no worker pool** in phases 1–3. Lease reconciliation is a table
  scan on a timer. A team of this size will never need more.
- **No microservices.** The API, MCP adapter, and UI share one service layer; splitting them
  guarantees three authorization implementations that drift.
- **No event-sourcing.** An append-only `events` table alongside mutable current-state tables gives
  attributable history without rebuilding state from a log.

### 3.2 Stack decision — and why

Both drafts refused to name a stack, correctly noting hosting/OS/team size were unresolved. But
refusing forever is how this project has stalled for four days. Here is a recommendation with its
reasoning, to be accepted or overridden at G0:

**Recommended: TypeScript on Node 22, Fastify, PostgreSQL 16, Drizzle migrations, server-rendered
UI with htmx-style islands (or SvelteKit if a richer board is wanted), `@modelcontextprotocol/sdk`
for the MCP adapter, single CLI binary via `tsx`/`pkg`.**

Reasoning:

| Factor | Consequence |
|---|---|
| The MCP adapter is mandatory (spec §"Agent access") | The reference MCP SDK is TypeScript. Python has a good SDK too; Go and Rust do not. This alone eliminates Go/Rust. |
| DSH itself is TypeScript | A DSH connector that must track `SubTask`, `SwarmUnitResult`, `RunRecord` shapes can import the actual types rather than re-declare them. This is the single largest correctness lever in phase 3. |
| Dev machine is Windows 11, target may be Linux | Node is the least painful cross-platform runtime here; `better-sqlite3`-style native deps are the usual Windows trap, avoided by using `pg`. |
| Team is small and part-human/part-agent | One language across UI, API, CLI, MCP, connector means an agent worker holds the whole thing in context. |
| Budget is ~$60/mo total | Rules out anything needing managed infrastructure. |

**PostgreSQL over SQLite**, despite SQLite being tempting for a small team: the spec requires
atomic claims under concurrency, `FOR UPDATE SKIP LOCKED` for the claim path, and multi-machine
access. SQLite's single-writer model makes the claim path a lock convoy and makes multi-machine
access impossible without a network filesystem. Postgres in a container is not "unnecessary
infrastructure" here; it is the cheapest correct answer.

**Where the drafts disagreed:** deepseek said "PostgreSQL, SQLite may be enough for single-machine
piloting." kimi listed both as an open decision. Resolved above in favour of Postgres from day one,
because migrating a claim path from SQLite to Postgres in phase 2 costs more than starting on
Postgres in phase 1.

### 3.3 Components

| Component | Owns | Never does |
|---|---|---|
| Core service | All shared state; permission checks; state transitions; idempotency; atomic claims; lease expiry; conflict detection; audit history | Model routing, prompt construction, council voting |
| Web UI | Human interaction, review, approval | Direct DB access |
| REST API | The single mutation surface | Bypass the service layer |
| MCP adapter | Same capabilities as CLI, as MCP tools/resources | Expose anything the CLI cannot do |
| CLI | Manually-launched agents reporting in | Hold state of its own beyond a token |
| Reconciler | Expired leases → `uncertain`, not `failed`; stale-worker rejection | Reassign without reconciliation |
| DSH connector | Translating an authorized request into DSH tool calls; recording DSH plans/runs/reviews | Duplicate DSH orchestration; weaken a DSH gate |
| Machine runner (phase 4) | Outbound connect, capability registration, isolated workspace, process launch, heartbeat, cancellation ack | Own task truth |

---

## 4. Data model

Relational. Every mutating write is idempotent by key where a retry is plausible. `events` is
append-only and immutable after insert.

### 4.1 Tables

```
workspace(id, name, slug, settings_json, created_at)

membership(workspace_id, subject_id, subject_type[human|agent], role,
           project_permissions_json)
  -- agents are members too; that is how scoped credentials get their authority

project(id, workspace_id, name, objective, status,
        continuation_brief_id, created_at, updated_at)

project_repository(id, project_id, url, local_path, connector_type, status)
project_instruction(id, project_id, version, content, authorized_by, created_at)
milestone(id, project_id, name, target_date, criteria)

task(id, project_id, parent_task_id, title, description, priority,
     accountable_owner_id, current_revision, lifecycle_state,
     created_at, updated_at)

task_requirement_version(task_id, revision, requirements, acceptance_criteria,
                         change_summary, material_change bool,
                         authorized_by, created_at)
  -- PRIMARY KEY (task_id, revision). material_change=true invalidates
  -- authorizations bound to earlier revisions.

task_dependency(blocked_task_id, blocking_task_id, kind)
  -- cycle validation on insert, not on read

plan_revision(id, project_id, parent_task_id, source[council|human],
              proposal, decomposition_json, attributed_decisions_json,
              approval_status, approval_scope_json,
              approved_plan_hash, approved_graph_hash,
              limits_json, expires_at, approved_by, approved_at, created_at)
  -- approved_graph_hash is what binds an approval to an exact graph.
  -- limits_json carries concurrency, spend and time ceilings.

run(id, task_id, plan_revision_id, connector_type, executor, model,
    agent_instance, machine, state, started_at, ended_at,
    usage_json, cost_json, usage_certainty[known|partial|unknown],
    quota_hold_resume_at, external_ref)
  -- external_ref holds the DSH run id / journal id.
  -- usage_certainty defaults to 'unknown'. There is no zero default. See 8.6.

assignment(id, task_id, run_id, worker_ref, candidate_group_id, revision,
           state, lease_expires_at, heartbeat_at, claim_token,
           acknowledgment_status)
  -- candidate_group_id groups competing candidates for one unit.
  -- UNIQUE (task_id, state) WHERE state='active' enforces one winner.

artifact(id, task_id, run_id, assignment_id, artifact_type, ref, checksum,
         verification_result_json, created_at)

event(id, entity_type, entity_id, actor_type, actor_ref, model,
      agent_instance, run_id, action, summary, payload_json, created_at)
  -- append-only; no UPDATE, no DELETE grant on this table

instruction(id, project_id, task_id, target_assignment_id, version,
            state[queued|delivered|acknowledged|applied],
            body, created_at, updated_at)
  -- a comment becomes an instruction only through an explicit action

comment(id, task_id, author_ref, body, promoted_instruction_id, created_at)

review(id, target_type, target_id, reviewer_ref, reviewer_model,
       verdict, comments, requested_corrections_json, created_at)
  -- reviewer_model is separate from reviewer_ref: DSH does not report the
  -- reviewing seat id (see 8.5), so it will often be NULL and must display
  -- as "reviewer not reported", never as a guess.

continuation_brief(id, project_id, snapshot_json, updated_at)

agent_token(id, workspace_id, project_id, subject_id, scopes_json,
            expires_at, revoked_at, last_used_at)
```

### 4.2 Attribution rule

Every agent-authored row records **model + instance + run**, with role as *additional* information,
never as a replacement. This is the user's standing rule ("Name the model, never 'me'") expressed as
a schema constraint: `event.model` is NOT NULL when `actor_type='agent'`.

### 4.3 State machines

**Task:** `Draft → Ready → In progress → In review → Done`; `Blocked` enterable from any active
state and returning to `Ready`/`In progress`; `Cancelled` from any active state with a reason.
`In review → In progress` on requested revision. An agent can move a task to `In review`; **only an
authorized human or configured reviewer can move it to `Done`.**

**Run:** `queued | running | quota-held | disconnected-uncertain | failed | cancelled | completed`.
Heartbeat loss produces `disconnected-uncertain` — never `failed`, never `completed`. Cancellation
sets a `cancellation_requested_at` and the run stays in its current state until the executor
acknowledges; the UI says "cancellation requested", never "cancelled", until then.

**Assignment lease:** `available → claimed → active`, renewed by heartbeat. Expiry →
`reconciling`. Reassignment only after reconciliation. A write from a worker whose
`claim_token` no longer matches the active assignment is rejected with 409, never applied.

---

## 5. DSH integration boundary

The boundary table is kimi's contribution and is the right shape. Corrected against source:

| Platform owns | DSH owns | Contract |
|---|---|---|
| Task lifecycle, ownership, durable history | Plan generation, candidate execution, model routing, voting | Platform publishes task context; DSH returns a decomposition the platform stores as a `plan_revision` |
| Approval scope binding, revision hashing | Its own two-factor gate (button + following user message) | **Both gates must pass.** Platform approval is not DSH approval. See 8.2 for what actually enforces DSH's gate. |
| Assignment claims, leases, reconciliation | Worker selection within a unit, contest, review | Platform records the winner DSH reports; platform does not pick it |
| Artifact storage, verification evidence, review attribution | Candidate file staging under `.dsh-staging` | Platform copies staged candidate trees in; DSH never writes to the platform's repository (8.4) |
| Progress timeline, blockers | Wave execution, quota holds | Platform polls / is fed the DSH report; there is no webhook (8.7) |
| Cost display with certainty labels | Pre-run estimate (`execution-cost.ts`) | Platform **renders DSH's estimate verbatim** at the gate; it does not compute its own |

**The invariant:** the platform is the authorization and durability layer DSH lacks. It never
implements council voting, swarm orchestration, or model routing.

---

## 6. Task graph

```
G0  decisions: repo path, hosting, stack, team size, budget ceiling
    + verified DSH source inspection  ◄── (this document does the inspection half)
      │
      ▼
P1  team / project / task / requirements / comments / review / history
      │ acceptance: two-human collaboration, conflict detection, backup-restore
      ▼
V1  verification gate
      │
      ▼
P2  REST API + CLI + MCP + scoped tokens + atomic claims + leases +
    heartbeats + artifacts + continuation briefs + instruction queue
      │ acceptance: real CLI task, contested claim, interrupted handoff
      ▼
V2  verification gate
      │
      ├──────────────► P4 machine runner        (independent of P3; can run in parallel)
      ▼                     │
P3  DSH connector           ▼
      ├─ seat roster read from council settings (8.1)
      ├─ plan_revision mapping from DSH decomposition
      ├─ DSH estimate rendered at the swarm gate
      ├─ run / artifact / review sync
      │
      ▼
G3  swarm gate: exact approved graph hash + seat roster + repo path +
    DSH's own estimate + concurrency/spend limits
      │
      ▼
V3  verification gate (real DSH run, not mocked)
      │
      ▼
P5  ongoing authorized work, meaningful-change notifications,
    capacity and usage views
      │
      ▼
V5 ──► Final end-to-end scenario
```

**Change from deepseek's linear graph:** P4 (machine runner) does not depend on P3 (DSH connector).
deepseek chained them; nothing in the spec requires it, and P4's reconciliation work is more
valuable earlier than the DSH connector is. Making them parallel removes the DSH connector — the
riskiest, most externally-blocked phase — from the critical path.

---

## 7. Phases with acceptance criteria

Each phase has an **approval gate before** (nothing is built until approved) and a **verification
gate after** (nothing is claimed done until proven).

### Phase 1 — Team, project, task, history, comments, review

Build: workspace + membership; project lifecycle; task CRUD with versioned requirements;
discussion comments distinct from execution instructions; task review; append-only event history;
optimistic concurrency on task edits; tested backup/restore.

Acceptance:
- [ ] Two humans in separate sessions collaborate on one project; both see each other's changes.
- [ ] Two humans edit the same task concurrently; the second save is rejected with a 409 naming the
      conflicting revision. **No silent overwrite, and the rejected content is not lost** — it is
      offered back for merge.
- [ ] A comment stays a comment until an explicit "submit as instruction" action; the UI renders the
      two differently, and not by colour alone.
- [ ] Every change carries actor + model (when agent) and appears in history.
- [ ] Backup taken, database dropped, restore performed, all data present. Real commands, real exit
      codes, captured.
- [ ] Task list filters return in under 200 ms with 1,000 tasks seeded (kimi's target, kept).

### Phase 2 — API, CLI, MCP, claims, leases, artifacts, continuation

Build: REST API with `Idempotency-Key` on mutations and `If-Match` on requirement updates; CLI;
MCP adapter; scoped project/action tokens; atomic claim via `SELECT … FOR UPDATE SKIP LOCKED`;
renewable leases; heartbeat; reconciler; artifact attachment; completion reports; continuation
briefs; instruction queue states.

API surface: `/workspaces`, `/projects`, `/tasks`, `/tasks/{id}/requirements`,
`/tasks/{id}/comments`, `/tasks/{id}/instructions`, `/plan-revisions`, `/runs`, `/assignments`,
`/assignments/{id}/claim|heartbeat|release|fail`, `/artifacts`, `/events`, `/reviews`,
`/continuation-briefs`.

Token scopes: `project:read`, `task:read`, `assignment:claim`, `run:report`, `artifact:write`,
`instruction:ack`, `review:request`. **No scope grants approval or accepts work.** An agent cannot
mint a token, widen a scope, or accept its own completion.

CLI: `apm login|task list|task brief|task claim|assignment heartbeat|assignment report|
assignment block|assignment request-review|assignment release|assignment fail|instruction list|
instruction ack|continuation-brief`.

MCP tools mirror the CLI one-for-one: `list_eligible_tasks`, `get_task_brief`, `claim_task`,
`heartbeat`, `report_progress`, `report_blocker`, `get_instructions`, `ack_instruction`,
`attach_artifact`, `request_review`, `release_task`, `fail_task`.

Acceptance:
- [ ] A real CLI agent claims, works, reports, attaches an artifact, and requests review.
- [ ] Two agents race for one task; exactly one wins; the loser gets a clean 409, not an error.
- [ ] A CLI agent is `kill -9`'d; after lease expiry the run shows `disconnected-uncertain`, not
      `failed` and not `completed`.
- [ ] After reconciliation a second agent claims it and resumes from the continuation brief.
- [ ] The killed agent is restarted and its stale write is rejected.
- [ ] No duplicate execution occurs — proven by run records, not by assertion.
- [ ] An agent cannot accept its own completion (403, tested).

### Phase 3 — DSH council/swarm connector

Build against **verified DSH behavior** (section 8), not against shared-brain prose.

- Read the seat roster from the council settings namespace (`seats` / `extraSeats` overrides), which
  is exactly what the Council Budget panel writes. Report every selected seat by model id, and
  report any seat that is disabled or fails.
- Map a DSH decomposition (`SubTask[]`) into `plan_revision.decomposition_json` and draft tasks.
- Render **DSH's own execution estimate** at the swarm gate; do not compute a second number.
- Record `external_ref` = DSH run id; capture the swarm report because swarm results are not
  persisted to disk (8.7).
- Record every candidate's staged tree per unit; record that the reviewing seat is unreported (8.5).
- Surface a quota hold as `run.state='quota-held'` with `quota_hold_resume_at`, and do not
  reassign the work.

Acceptance:
- [ ] A **real** authorized DSH council run publishes a plan into the platform, with each seat
      recorded by model id. Mock integration is explicitly not accepted as evidence.
- [ ] A disabled or erroring seat halts the stage and is named in the report.
- [ ] Platform approval alone does not run DSH; DSH's own button+message gate still fires.
- [ ] The swarm gate shows DSH's estimate with its caveats, including the free/subscription/unpriced
      split and the `unknown`, never `zero`, labelling.
- [ ] Per-candidate staged files are recorded per unit with the producing seat id.
- [ ] A quota hold is shown with its resume time and the run is not reassigned.

### Phase 4 — Machine runner and managed dispatch

Build: runner process; outbound connection; capability registration; authorized dispatch; isolated
repository workspace per assignment; process launch; heartbeat; instruction delivery at supported
checkpoints; cancellation acknowledgment; exit/results reporting; restart recovery.

Isolation recommendation: **separate working directory + separate git clone per assignment, no
containers, in the first cut.** Docker is the reflex answer and it is wrong for a Windows-primary,
$60/month, small-team setup; it adds a daemon, an image pipeline, and a Windows filesystem
performance problem, in exchange for isolation that a per-assignment clone already provides against
the actual threat (two agents editing the same tree). Revisit if untrusted code ever runs.

Acceptance:
- [ ] Two assignments on the same repository run in separate clones; neither sees the other's
      working tree.
- [ ] Cancellation stays `requested` until the runner acknowledges; the UI never claims termination
      it has not observed.
- [ ] Runner killed and restarted: it reconciles, relaunches nothing already completed or running.
- [ ] A stale runner's write after reassignment is rejected.

### Phase 5 — Ongoing authorized work, notifications, capacity, usage

Build: requirement revision notification + acknowledgment; material-scope-change authorization
invalidation; meaningful-change notification filtering; capacity view; usage view; dispatch limits;
spend/time ceilings for automatic continuation.

Acceptance:
- [ ] A human revises a requirement; the revision increments; every affected active assignment is
      notified and must acknowledge before continuing.
- [ ] A material scope change invalidates the bound authorization; work queues rather than
      continuing.
- [ ] Dispatch limits are enforced (proven by attempting to exceed them).
- [ ] Usage views distinguish `unknown` from `0`. A DSH swarm unit shows `unknown` (8.6).
- [ ] Capacity view reflects real concurrency limits, not configured intent.

### Final scenario

Two humans submit a feature → council publishes a dependent plan → a valid approval permits swarm
execution alongside an independent CLI assignment → one worker hits quota → another requests
clarification → a human revises a requirement → the affected worker acknowledges → the machine
restarts without duplicate execution → workers attach verification → the council requests one
correction, reviews the fix, records acceptance → the entire history is visible in the project.

Evidence required: real exit codes, real API responses, real DSH run ids, artifacts, timestamps.
Anything unverified is labelled unverified.

---

## 8. Where the council drafts contradict the actual DSH source

Verified in `deepseek-harness/packages/council/tool-council/src` and
`deepseek-harness/packages/client/ui-council-budget`. **Every item below is a place a draft
described DSH behavior that the code does not support.**

### 8.1 deepseek: "Open the live Council Budget panel and capture the seat set"

The panel exists (`packages/client/ui-council-budget/src/client/CouncilBudget.tsx`) but it is a
*view over settings*. Toggling a seat calls `settings.set('seats', overrides)`, writing
`seats.<id>.enabled`. The council itself never reads a panel: `currentSeats()` in `index.ts:759`
calls `resolveSeats(now.seats, now.extraSeats)` straight from settings.

**Consequence:** a connector reads the seat roster from the council settings namespace. Any design
that "opens the panel" or scrapes UI is unbuildable and unnecessary. deepseek reached the right
policy (capture live, do not assume) via a hallucinated premise about King County budget documents
and a wrong mechanism.

### 8.2 Both drafts: the two-factor approval gate is absolute

It is not. `index.ts:1081` — `const autoApproved = settingsNow.autoApprove === true` — and
`autoApproved` short-circuits the gate at every call site (`const approved = autoApproved ||
approval.allowed`, line 1380). A settings flag disables button-plus-message entirely.

The gate itself (`approval.ts`) is well built and fails closed, with a hard **15-minute plan TTL**
(`PLAN_TTL_MS = 15 * 60 * 1000`) that neither draft knew about, and approval state that is
**global, not per-conversation**. A newly issued graph voids any earlier approval
(`approvedSwarmId: ''` on issue).

**Consequence for the platform:** "Preserve DSH's gates" cannot be asserted — it must be *checked*.
The connector must read `autoApprove` before dispatching and refuse to treat a DSH run as gated
when that flag is on. And any platform-side approval that takes longer than 15 minutes to reach DSH
will find the plan expired.

### 8.3 deepseek: "Fallback is bounded by an explicit cap on tokens, cost, or attempts. If the cap is exceeded, the unit goes to quota-held or failed"

The cap is structural and hardcoded, not configurable. `swarm-contest.ts:106-117`: on a failed
review, economy mode tries **exactly one** paid fallback candidate, reviews it once, and if that
fails returns `Unit did not pass paid review; escalation cap reached`. The declared shape
(`index.ts:474`) is "at most one paid fallback candidate and two paid reviews per unit."

There is no token cap, no dollar cap, no attempt counter. The outcome is `failed` — never
`quota-held`. Quota holds come from a different mechanism entirely (8.8).

### 8.4 Both drafts: the swarm builds into the target repository

It does not. `index.ts:765-776` — `proposalWorkspace` returns
`workRoot: join(access.workspaceRoot, '.dsh-staging')`, and every candidate writes to
`unitCandidateRoot(workRoot, run, unit, seat)` (`swarm-contest.ts:16`). The prompt tells seats
plainly that "nothing it writes reaches the real repository" (`writes.ts`). Candidate files stay in
staging.

Two further constraints neither draft mentions:
- Staging requires `sandboxMode` set, `workspace-write` approval, **and** the literal message `go`
  in the session (`staging.ts:24`, `index.ts:771`).
- A unit that names files but has no configured `fileRoots` fails outright:
  `Candidate files require approved workspace staging and source roots.`

**Consequence — and this reshapes the biggest open question:** the "build repository path" the run
policy treats as the blocker is not a path DSH writes to. What DSH needs is (a) `fileRoots` — source
directories units may *read*, and (b) a session workspace root under which `.dsh-staging` is
created. The platform must copy staged candidate trees into the real repository itself, under its
own authorization, and that copy is a platform feature nobody has specified yet. **It belongs in
Phase 3 scope and is currently missing from both drafts.**

### 8.5 deepseek: "retain per-candidate artifacts and review attribution"

Half right. Per-candidate artifacts are real: `Candidate { seat, root, files, refused }`
(`writes.ts:60`) with per-run/unit/seat directories.

Review attribution is **not** retained. `SwarmUnitResult` (`swarm.ts:114`) carries
`review?: string` — the review *text* only. The reviewing seat's id and model are nowhere in the
result. The reviewer is chosen at `swarm-contest.ts:35` and then discarded.

**Consequence:** `review.reviewer_model` will be NULL for DSH swarm reviews. The UI must say
"reviewer not reported by DSH", never infer one. This is why the schema in §4.1 separates
`reviewer_ref` from `reviewer_model`.

### 8.6 Both drafts: cost and usage will be trackable per unit

`SeatReply` carries `usage?: SeatUsage` (`seats.ts:168`), but `SwarmUnitResult` drops it — no usage,
no cost, no token counts survive the unit boundary. Per-unit actual spend is genuinely unavailable
from DSH.

What DSH *does* provide is a pre-run estimate (`execution-cost.ts`) built on hardcoded assumptions:
`TOKENS_PER_TASK = 6_000` output tokens and `PROMPT_RATIO = 4` input, deliberately generous, with
an explicit three-way split (`free` / `included` / `metered`) and printed caveats. That estimate is
what the swarm gate renders.

**Consequence:** the spec's rule "unknown usage/cost is unknown, not zero" is not a nicety here —
it is the *normal case* for every DSH swarm unit. `run.usage_certainty` defaults to `unknown` in
§4.1 for exactly this reason.

### 8.7 Both drafts: progress synchronization / "DSH pushes to a PMP webhook" (kimi's table)

There is no webhook and no push channel. Worse for a connector: **swarm results are never persisted
to disk.** `saveRun` is called only from the two council paths (`index.ts:997`, `index.ts:1265`);
nothing in `swarm.ts` or the swarm branch of `index.ts` files a record. Council runs land in
`~/.dsh/council-runs/*.json`; swarm runs land nowhere.

Additional durability limits neither draft knew:
- `RUN_HISTORY = 20` — the 21st run prunes the oldest council record.
- `runs.ts readRecord()` silently drops `terminalState`, `quorumConfig`, `promptMetrics`, and
  `schemaVersion` on load. They are declared on `RunRecord` and written by `saveRun`, but the
  reader never restores them. **Anything reading a council run through `loadRun()` will never see
  whether the run was `completed`, `partial`, `cancelled`, `failed` or `awaiting_resume`** — it
  must parse the JSON itself. This looks like a genuine bug in DSH, not a design choice.

**Consequence:** the connector captures the DSH tool report at call time and writes its own record
immediately. It must not rely on reading DSH state back later. This is a material design change from
both drafts, which assumed a readable/pushed DSH state store.

### 8.8 Quota holds and resumability — mostly as described, with limits

`quota-hold.ts` is real and good: exhaustion is matched on prose and HTTP 429, distinguished from
401/403 configuration errors, and turned into a `resumeAt` with `DEFAULT_HOLD_MS = 30 min`,
`MAX_HOLD_MS = 8 h`. `holdElapsed` can release a hold *early* if a fresh reading shows session usage
under 90%.

Resumability (`journal.ts`) is real but bounded in ways neither draft mentions:
- The journal is keyed by **seat routing + exact prompt hash**. A prompt that changes by one
  character misses the cache and is paid for again.
- `JOURNAL_MAX_AGE_MS = 24 h`. A resume attempted tomorrow pays in full.
- `JOURNAL_HISTORY = 20`.
- Council amendment is capped: `MAX_AMENDMENTS = 3` (`runs.ts:36`).

**Consequence:** the platform must not promise indefinite resumability. A continuation brief that
rewords the task brief between attempts *defeats* the DSH journal. Phase 3 should keep the brief
byte-stable across a resume.

### 8.9 Economy mode — what it actually is

Neither draft described this correctly end to end. From `swarm-contest.ts` and `index.ts:474`:

1. Proposers = **all eligible free seats**. `fastest` is the inverse: free seats are filtered *out*
   (`index.ts:350`).
2. **Economy requires at least two eligible free seats per unit** or the unit fails outright
   (`swarm-contest.ts:41`, and graph validation at `index.ts:393`).
3. **Economy requires an enabled paid reviewer** — `if (reviewer === undefined) return fail('This
   mode requires an enabled paid reviewer.')`. This directly contradicts the run policy recorded in
   the brain note ("swarm implementation and its internal reviews use free agents only, with no
   paid fallback"): **a free-only roster cannot run economy mode at all.**
4. The winner is selected by **the free proposers voting among themselves**, not by a paid judge
   (`swarm-contest.ts:90`). Self-votes are down-weighted by `SELF_VOTE_WEIGHT` in `tally()`.
5. Then one paid review; on rejection, one paid fallback candidate and one more review; then fail.
6. Cost shape per unit: one candidate call + one selection call per free seat, at most one paid
   fallback candidate, at most two paid reviews, plus one optional source-read call per candidate.
7. Free seats are slow — the code's own caveat says "free seats may take 420 seconds per call."

---

## 9. Cost and concurrency limits

| Limit | Value | Source |
|---|---|---|
| Total monthly budget | ~$60 | user's standing context |
| Measured baseline | ~51M tokens/month | user's standing context |
| Platform's own running cost | ~$0 metered — one Node process + Postgres, self-hosted | this design |
| DSH per-unit estimate basis | 6,000 output tokens, 4× input | `execution-cost.ts` |
| Economy per-unit call shape | N candidate + N selection (N free seats) + ≤1 paid fallback + ≤2 paid reviews + ≤N source reads | `index.ts:474` |
| Free-seat call latency | up to 420 s | DSH's own caveat |
| Council plan TTL | 15 min | `approval.ts` |
| Quota hold default / max | 30 min / 8 h | `quota-hold.ts` |
| Journal validity | 24 h, exact-prompt keyed | `journal.ts` |
| Council amendments | max 3 | `runs.ts` |
| Run record history | 20, then pruned | `runs.ts` |
| Platform dispatch concurrency | **recommend 2 per project, 4 per workspace** — pending user decision | proposed |
| Automatic continuation | **recommend: off by default**; requires explicit scope + concurrency + time + spend ceilings to enable | spec + proposed |

Cost discipline note grounded in the user's own measured data: session length drives cost far more
than question difficulty (~99% of usage above 150k context, ~83% from sessions over 8 hours). The
platform's continuation brief is therefore not a nicety — it is the mechanism that lets a fresh,
cheap session replace a long, expensive one. That should be treated as a primary design goal of
Phase 2, not a phase-5 convenience.

---

## 10. Human interface

Taken from deepseek (the stronger draft here), condensed.

- **Project overview:** objective, milestones, progress **computed from accepted units, not task
  counts**, blockers, open inbox items, current continuation brief.
- **Task board and list:** filters on status, assignee, priority, dependency, revision, project.
- **Task detail:** tabs for Requirements / Discussion / Runs / Artifacts / Review / History.
  Comments and execution instructions are **visually distinct and require different actions**.
- **Swarm/dependency view:** the approved plan as a directed graph — plan revision, draft tasks,
  dependent tasks, runs, assignments, review state.
- **Action inbox:** approvals, clarifications, blocked tasks, review requests, expired
  authorizations.
- **Activity feed:** every event attributed to human, or to agent **model + instance + run +
  machine**.
- **Empty states** that say what to do next: no project → create one; no tasks → add one or connect
  an agent; no runs → authorize eligible work; no artifacts → explain where results will appear.
- **Accessibility:** semantic HTML, keyboard navigation, managed focus, ARIA on status and progress,
  sufficient contrast, reduced-motion support, reflow at small widths, **never colour alone** as a
  status signal.
- **Honesty in the UI:** estimates labelled as estimates; unknown cost shown as "unknown", never
  "$0.00"; "cancellation requested" until acknowledged; "disconnected — outcome unknown" rather than
  failed or done.

---

## 11. Risks

1. **The DSH connector is the weakest link and it is external.** Six of this document's corrections
   are about DSH behavior that differs from what the council believed. Keeping P4 off P3's critical
   path (section 6) is the mitigation.
2. **Staged-candidate-to-repository copying is unspecified work** (8.4) that both drafts missed. It
   is real Phase 3 scope and carries its own authorization question.
3. **`autoApprove` can silently disable DSH's gate** (8.2). The platform must check it, not assume.
4. **Economy mode cannot run on a free-only roster** (8.9.3), which contradicts the run policy
   recorded in the project's own brain note. This must be settled before any swarm stage.
5. **Prescribing a stack** — mitigated by recommending one with reasoning and putting it at G0 for
   override rather than deferring indefinitely.
6. **Treating this document as execution authorization.** It is not. Nothing here has been built.
7. **Scope.** This is a five-phase product for a team that may be two people. Phase 1 and 2 alone
   may be the whole useful product; phases 3–5 should each be re-justified at their own gate rather
   than assumed.

---

## 12. Decisions required before anything is built

See the numbered list returned with this deliverable. Each carries a recommendation. **No code is
written, no repository is created, and nothing is spent until these are answered.**
