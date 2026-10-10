<!-- Copied 2026-09-15T10:24:15.919Z from ~/Documents/Codex/2026-09-11/i-m/outputs/project-management-saved-run.md on vmixer2o2 (redacted). -->
RUN POLICY — USER REQUEST
Council planning and final council review: use Claude CLI, Codex CLI, and ALL configured free agents that are available. No other paid/metered council seats. Identify models and report unavailable seats; do not silently substitute or omit seats.
Swarm implementation: FREE AGENTS ONLY. No Claude subscription, Codex subscription, paid/metered worker, paid fallback, or paid implementation candidate. Paid CLI council participation does not authorize paid swarm execution. Review inside swarm must also use free agents; the separate final council review uses the council roster above.
Before any model call, verify and enforce stage-specific rosters against actual runtime configuration. A preset's prose is not a routing control. Economy mode is NOT sufficient: its paid fallback/reviewer path violates this policy. If the current harness cannot enforce this split, STOP before launching and report the exact missing capability; do not weaken this restriction or modify the harness without authorization.
Make the product enjoyable and easy to use: clear visual hierarchy, responsive interactions, useful live progress, approachable empty states, and accessible controls.
Save only for now. Build repository/swarm path is still pending; obtain it before execution. Saving grants no launch, spending, workspace, or approval permission. Do not change global seat configuration when saving.

# Council + swarm build specification

Build a standalone project management application for a multi-human team coordinating CLI agents, councils, and swarms across projects, sessions, and machines. It must run independently of DSH; DSH is one execution connector. Deliver working software, verified end to end, in a separate repository.

## Execution boundary
- This saved specification is not execution authorization. Target repository/swarm path, hosting, and execution authorization are pending.
- Before implementation, inspect applicable project instructions and current DSH integration code; shared notes are context, not proof of current behavior. Present the architecture, task graph, acceptance criteria, dependencies, cost/concurrency limits, and required decisions through the existing approval flow.
- Preserve DSH's council/swarm gates: button plus subsequent user message, single-use approval, expiry, exact approved plan/graph. Platform approval cannot substitute for DSH authorization. Creating tasks, publishing plans, or saving a preset starts no work and spends nothing.
- Honor workspace permissions and existing git gatekeeper rules. Deployment and push require their existing authorization. Never bypass gates or silently expand scope.

## Product contract
One shared source for objectives, requirements, ownership, progress, blockers, decisions, artifacts, and verified outcomes. Humans must continue and redirect authorized work without reconstructing agent transcripts. Sessions and machine restarts must not erase project state.

Data model:
- Workspace: team, membership, project-scoped human/agent permissions.
- Project: objective, repositories, instructions, milestones, continuation brief.
- Task: requirements, acceptance criteria, priority, dependencies, accountable owner, revision, lifecycle.
- Plan revision: council proposal, decomposition, attributed decisions, approval scope/status.
- Run: execution attempt; executor, model, agent instance, machine, state, timestamps, usage.
- Assignment: task-to-run/worker relationship, renewable lease; support separate competing candidates.
- Artifact: document, patch, commit, screenshot, test evidence, or other result.
- Decision/event: attributed human instructions, council verdicts, approvals, transitions, review and activity history.

Tasks survive retries and worker changes; runs record individual attempts. Attribute agent updates to actual model + instance + run, with role as additional information.

## Human interface
Provide project overview; task board/list with filters; task detail with requirements, discussion, runs, artifacts and review; swarm/dependency view; action inbox; team activity feed. Support create, assign, prioritize, clarify, request revision, pause/cancel, and hand off. Detect concurrent edit conflicts.

Comments are discussion unless explicitly submitted as execution instructions. Track instructions as queued/delivered/acknowledged/applied. Version requirements; notify affected active assignments and require acknowledgment. Material scope changes invalidate affected authorization. Provide a concise continuation brief: objective, decisions, accepted work, blockers, next actions.

## Council + swarm integration
Authorized request → link/create parent task → record request/context → publish proposed plan and draft dependent tasks → record approval for exact revision → dispatch only authorized work → synchronize assignments/progress/blockers/artifacts → attach council review → create linked corrections → accept completed work.

Represent economy/fastest profiles and candidate selection where the current DSH implementation supports them; retain per-candidate artifacts and review attribution. Preserve quota holds and resumability. Do not duplicate DSH orchestration inside the platform.

## Agent access + execution
Provide a documented API, small CLI and MCP interface over the same service. Agents can fetch bounded task briefs, discover authorized eligible work, atomically claim assignments, renew leases, report progress/blockers/questions, receive instructions, attach results, request review, and release/fail attempts. Scope credentials by project/action; agents cannot self-approve or enlarge access.

First support manually launched CLI agents reporting to the service. Later add an optional machine runner: outbound connection, capability registration, authorized dispatch, isolated repository workspace, process launch, heartbeat, instruction delivery at supported checkpoints, cancellation acknowledgment, exit/results reporting and restart recovery. Central service owns tasks/decisions/history; executors own observed process state. Validate incoming state transitions.

## State + evidence
Task: Draft → Ready → In progress → In review → Done; also Blocked/Cancelled.
Run: distinguish queued, running, quota-held, disconnected/uncertain, failed, cancelled and completed.
Agent completion submits for review; authorized human/configured reviewer accepts Done. Require changed-work summary, artifact/commit references, actual verification results, limitations and acceptance-criterion evidence. Show progress from accepted units/milestones; label estimates as estimates. Unknown usage/cost is unknown, not zero.

## Reliability
- Idempotent events and dispatch; atomic claims; dependency/cycle validation.
- Expired leases/disconnections trigger reconciliation before reassignment; prevent stale workers from overwriting a newer assignment.
- Heartbeat loss means uncertain/disconnected, not proven failure or success.
- Cancellation remains requested until acknowledged; no silent claim of process termination.
- Preserve work through quota limits, offline reporting and restart; reconcile without duplicate launches.
- Isolate concurrent repository work and competing candidates.
- Approval binds revision, scope and limits. Automatic continuation requires explicit scope plus concurrency/time/spending limits; otherwise queue work.
- Persist shared state with access controls, attributable history and tested backup/restore.

## Implementation + delivery
Use a separate repository with web UI, API, relational database migrations, CLI/MCP adapter, optional runner and connector contracts. Prefer one deployable application initially. Select stack after resolving hosting, OS support, team size and budget; avoid unnecessary infrastructure. Application must remain useful with DSH unavailable.

Deliver in independently verified phases:
1. Team/project/task management, history, comments and review. Prove two-human collaboration and edit conflict handling.
2. API + CLI/MCP, scoped access, claims, heartbeats, artifacts and continuation. Prove a real CLI task and interrupted-task handoff.
3. DSH council/swarm connector. Prove an authorized real run publishes plan/tasks/progress/review without weakening gates.
4. Machine runner and managed dispatch. Prove isolation, cancellation, restart/disconnection reconciliation and duplicate prevention.
5. Authorized ongoing work, meaningful-change notifications, capacity and usage views. Prove human instruction delivery and dispatch limits.

Final scenario: two humans submit a feature; council publishes a dependent plan; valid approval permits swarm execution alongside an independent CLI assignment; one worker hits quota and another requests clarification; human revises a requirement and affected worker acknowledges; machine restarts without duplicate execution; workers attach verification; council requests one correction, reviews the fix, then records acceptance. Entire history is visible in the project.

Deliver source, migrations, setup/operation documentation, connector/API contracts, relevant automated tests and actual end-to-end evidence. Test built artifacts and capture real exit codes. Label anything unverified. Do not claim mock integration proves real integration. Report completed phases, evidence, remaining blockers and exact decisions needed.
