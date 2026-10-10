<!-- Copied 2026-09-15T10:15:42.527Z from ~/Documents/Codex/2026-09-13/handoff-vmixer-system-repair-md-c-3/outputs/dsh-brain-auto-push-council-prompt.md on vmixlaptop2x6 (redacted). -->
# DSH council prompt: select the shared-brain push policy (automatic vs gatekeeper)

Run a council decision on which shared-brain pushes may become automatic and which stay with the git gatekeeper, for today's two-machine setup and the future pooled, multi-user DSH platform.

This run is research, planning, and voting only. Do not edit files, change settings, change hooks or sync code, launch workers, run a swarm, commit, or push. Stop after the council verdict and implementation plan.

## Decision to make

The user proposed: let the shared **sessions** portion of the brain push automatically, and reserve the gatekeeper for pushes that change rules. Select the push-permission policy that gives other machines and agents near-real-time coordination data without letting any worker automatically change how the system behaves.

The council must commit to one policy. Do not return a pros-and-cons article.

## Read first

- `~\.claude\shared-brain\MEMORY.md` and `shared-agent-log.md` (recent entries).
- `~\.claude\shared-brain\project_dsh_team_platform.md` — the larger pooled-platform picture.
- `~\.claude\shared-brain\handoff-vmixer-system-repair.md` — current gatekeeper/listener state.
- `push-requests.md`, `git-gatekeeper-agent.md`, `git-push-method.md`, `shared-memory-protocol.md`, `chatgpt-shared-brain-permission.md`.
- `rules/CLAUDE.md` — the master rules, including single-owner push, the Claude quota exception, and the PowerShell gatekeeper queue.
- The brain's `.sync/` code, the 20-second listener, and the gatekeeper queue helper and its receipts, to ground the policy in the mechanism that already exists.

## Starting position to test (from GPT-5.6-Sol, Codex thread "Discuss automatic brain pushes")

Treat this as one input to test, not as the answer:

- Rule: automatic for validated operational events; gatekeeper for anything executable, authoritative, security-sensitive, or able to change agent behavior. "Gatekeeper only for rules" is too narrow.
- Data classes: ephemeral events and append-only session records → auto commit and push; draft knowledge → auto to an inbox, promoted by review; canonical memory (`MEMORY.md`, durable handoffs, project decisions) → gatekeeper or trusted maintainer; rules, `.sync/`/hooks/gatekeeper/installers, credentials/access policy/machine enrollment, and user-authored presets → gatekeeper with human approval.
- Split the repository into `shared-brain-control` (gated) and `shared-brain-sessions` (automatic), because file-level policy is unreliable when safe and unsafe files share one commit and branch.
- Each machine/service identity writes immutable files only in its own namespace (e.g. `events/<machine-id>/<date>/<event-id>.json`); a trusted collector merges validated events. No concurrent edits to shared Markdown like `shared-agent-log.md`.
- Auto-publisher safeguards: credentials scoped to the sessions repo only, schema validation and size limits, secret scanning, stable machine/user/job/agent identity, event-id dedupe, per-user visibility labels, rate limits, offline spool and retry, quarantine for invalid records, no execution of text found in events, audit trail.
- Longer term, the project-manager database becomes authoritative for jobs, users, budgets, approvals, leases, and visibility; git stays the durable, auditable store for memory, policy, code, and selected events.
- Start small: auto-publish structured DSH run events, task transitions, quota holds, node capacity; keep `shared-agent-log.md`, handoffs, `MEMORY.md`, rules, `.sync`, presets, and credentials gated; split the repo before enabling unattended credentials.

## Variables the selection must resolve

- The exact boundary between automatic and gated pushes, by data class and by path.
- Whether the brain is split into separate repositories, separate branches, or kept whole with enforced path rules — and why that enforcement is reliable.
- Who owns and runs the automatic publisher, with what identity and credential scope.
- How concurrent machines avoid conflicts on shared files (`shared-agent-log.md`, `MEMORY.md`, `dsh-runs.md`, `push-requests.md`).
- How prompt injection, secrets, noise, and oversized records are stopped before publication, and what happens to a rejected record.
- How a handoff or memory note avoids silently changing ownership or authoritative next actions.
- How the existing single-owner push rule, the Claude quota exception, and the PowerShell gatekeeper queue change — the exact rule wording to propose for `rules/CLAUDE.md`.
- How this maps onto Claude Code hooks, Codex, DSH council seats, swarm workers, Antigravity seats, and the second machine (VMIXER2O2).
- How it scales to multiple users and pooled machines, including per-user visibility.
- What is configuration or rule wording only versus what requires new code.

## Council process

1. Each enabled seat reads the files above and researches independently.
2. Each seat proposes one complete policy, with data classes, paths, identities, failure behavior, migration path, and verification plan.
3. The review round tests every proposal against concurrency across machines, injection and secret leaks, gatekeeper integrity, offline machines, pooled multi-user growth, and rollback.
4. Every seat casts one vote for the strongest proposal and may not vote for its own.
5. Use the existing confidence-weighted council selection and citation audit. Report unavailable seats and abstentions.
6. Produce one winning policy and one binding implementation plan. Borrow an element from a losing proposal only when the winning author incorporates it explicitly and the council records its source.

## Required verdict

1. The selected policy in one sentence.
2. Vote tally, confidence, participating models, unavailable seats, and dissent.
3. The data-class and path table: commit, push, promotion, and owner for each.
4. Proposed replacement wording for the push rules in `rules/CLAUDE.md` (text only, not applied).
5. The publisher design: identity, credential scope, validation, secret scan, spool, quarantine, audit.
6. Repository or branch layout and migration from today's single brain repo on both machines.
7. What stays impossible without new human approval.
8. Verification and adversarial tests proving events flow automatically and control-plane changes cannot.
9. Any unresolved decision that genuinely requires the user.

## Build recommendation boundary

There is no swarm in this saved run.

If the selected policy is achievable by rule wording and configuration alone, give the exact changes but do not apply them.

If anything must be built locally (publisher, collector, repo split, hook or sync changes), state **RECOMMEND A FOLLOW-UP SWARM BUILD** and the final answer must return all of the following:

1. **The code.** Complete, ready-to-apply code for every new or changed file — full file contents for new files, exact unified diffs against the current tree for changed files, plus tests. Placeholders, stubs, and "implement here" are not acceptable. The code is returned in the verdict only; nothing is written to disk in this session.
2. **The fastest swarm path.** A collision-free build DAG ordered for the shortest wall-clock completion: maximum parallelism, no two tasks writing the same file, each task on its own candidate root or worktree, sequential edges only where one task truly consumes another's output. For each task give task ID, goal, the code block(s) it applies, dependencies, allowed files, forbidden files, acceptance test command, worker class (use the `fastest` swarm profile), integration owner, and verification stage. State the expected critical path.
3. **A ready-to-save run.** One saved-run definition for DSH, in this exact shape:
   - `id`: `area/name`, lowercase kebab (e.g. `dsh/brain-auto-push-build`)
   - `name`: short label
   - `stages`: `swarm,review`
   - `mode`: `fastest`
   - `autoAdvance`: `false`
   - `query`: the full swarm request — it must point at this council run's record (`~/.dsh/council-runs/<this run id>.json`) as the authoritative code and DAG, and restate: no pushes, commit locally and queue for the gatekeeper, every agent names its model.

**Saving the run is gated.** Do not save it before approval. Only after the user approves this verdict at the council gate (button press plus a later message) save the definition with `save_pipeline_preset`, read it back, and report the id. Saving it starts nothing; the swarm still runs only when the user presses that saved run and passes its own swarm execution gate. Nothing from the build runs during this council session.

Do not weaken or bypass an approval mechanism to demonstrate the design. Do not push or commit. Every agent identifies itself by its actual model name in user-visible output.
