<!-- Copied 2026-09-15T10:15:42.527Z from ~/Documents/Codex/2026-09-13/can-2/outputs/dsh-granular-agent-permissions-council-prompt.md on vmixlaptop2x6 (redacted). -->
# DSH council prompt: select the permission architecture for unattended agents

Run a council decision on the permission architecture for councils, swarms, and unattended workers on this Windows machine.

This run is research, planning, and voting only. Do not edit files, change settings, launch workers, run a swarm, install software, commit, or push. Stop after the council verdict and implementation plan.

## Decision to make

Select the direction that lets authorized agents complete work inside their assigned environments without granting broad automatic approval that allows agents to interfere with one another, alter protected state, or bypass the existing approval gates.

The available building blocks are:

- Antigravity native/headless agents and their current language-server transport.
- Claude Code native permissions, Agent SDK, subagents/teams, hooks, and sandboxing.
- Codex native CLI/app-server permissions, permission profiles, approval review, and Windows sandboxing.
- DSH-native permission, workspace, staging, approval, journal, and orchestration controls.
- A deliberately selected hybrid, if no single native system can enforce the complete boundary.

Do not return a feature-comparison article. Research each building block only as evidence needed to select one architecture. The council must commit to a direction.

## Current environment and constraints

- Host: Windows 11, primarily native Windows rather than WSL.
- DSH repository: `~\Documents\claudecode\deepseek-harness`.
- Shared memory: `~\.claude\shared-brain`.
- DSH launches heterogeneous council seats and swarm workers through local CLIs, SDK/app-server providers, hosted providers, and Antigravity headless seats.
- Unattended children cannot answer an interactive permission dialog. Current fail-closed callbacks can therefore block legitimate work.
- Broad auto-approval is unacceptable because concurrent agents can collide, modify the wrong workspace, weaken configuration, or cross an approval boundary.
- The existing council and swarm approval gates remain authoritative: button press plus a later user message, single-use approval, expiry, and execution bound to the exact approved plan or graph.
- Agents cannot approve themselves, widen their own permissions, rewrite the approval state, or treat a saved run as execution authorization.
- Git pushes remain owned by the separate gatekeeper. No permission design may authorize direct pushes.
- Concurrent writers must not share one mutable checkout or candidate directory.
- Shared-brain access must avoid concurrent corruption and preserve attributable, ordered records.
- The monthly model budget and existing seat selection still apply. Research should use configured/included access where possible and report any unavailable seat.

## Required independent research

Every enabled and reachable council seat must independently investigate all four execution families below before proposing a direction. Use current primary documentation and inspect the installed/local implementation where relevant. Clearly separate documented behavior, observed local behavior, and inference.

1. **Antigravity**
   - What filesystem, command, network, workspace, and per-agent permission boundaries its native or headless interfaces actually expose.
   - Whether those controls are enforceable for unattended parallel workers on this host.
   - Whether Antigravity should enforce permissions, merely execute inside a DSH-provided boundary, or be excluded from writing roles.

2. **Claude Code**
   - Path-scoped `Read`/`Edit` rules, command allow/ask/deny rules, hooks, Agent SDK permission callbacks, subagent/team inheritance, and per-agent restrictions.
   - OS sandbox support and the consequence that Anthropic's documented sandbox supports macOS, Linux, and WSL2 rather than native Windows.
   - Whether native Windows tool rules alone provide sufficient enforcement for arbitrary subprocesses.

3. **Codex**
   - `workspace-write`, primary working roots, additional directories, approval policies, automatic review, permission profiles, and app-server thread configuration.
   - What is enforced on native Windows and what can be fixed per unattended child.
   - Whether automatic review is acceptably deterministic, or whether a pre-authorized workspace envelope with fail-closed escalation is safer.

4. **DSH native**
   - Existing council/swarm gates, session permissions, staging roots, candidate isolation, write validation, journals, and provider configuration.
   - Current Claude and Codex subagent-provider behavior, especially unattended denial and which workspace/path information is or is not passed to children.
   - Whether DSH should become the policy authority and issue a short-lived capability envelope to every worker.

## Variables the selection must resolve

The council must explicitly decide:

- Where the authoritative permission policy lives.
- Whether enforcement is provider-native, DSH-owned, operating-system-owned, or layered.
- How each agent receives exact readable roots, one writable root, allowed command families, network destinations, protected paths, expiry, run ID, agent ID, and approved-plan ID.
- Whether researchers, writers, reviewers, integrators, and memory writers receive different fixed roles.
- How workers operate without prompts while every ungranted capability fails closed.
- How a blocked worker reports one precise escalation without silently retrying or broadening access.
- How concurrent workers get isolated candidate roots or worktrees.
- Who alone may integrate accepted work into the real checkout.
- How shared-brain updates are serialized or brokered.
- How settings, credentials, `.git`, approval records, gatekeeper files, and unrelated repositories remain protected.
- How the design works on native Windows today, including any WSL2/container dependency it would introduce.
- How the same policy maps onto Antigravity, Claude, Codex, hosted seats, council rounds, swarm execution, and final review.
- What is configuration-only versus what requires new DSH code.

## Council process

1. Each enabled seat performs its own research across all four execution families.
2. Each seat proposes one complete direction. A hybrid is allowed only when the seat identifies one authoritative policy owner and an unambiguous enforcement chain.
3. Each proposal includes concrete data structures, lifecycle, trust boundaries, failure behavior, migration path, and verification plan.
4. The review round tests every proposal against native Windows, unattended execution, concurrency, provider differences, shared-brain ordering, approval integrity, and Git isolation.
5. Every seat casts one vote for the strongest proposal and may not vote for its own proposal.
6. Use the existing confidence-weighted council selection and citation audit. Report unavailable seats and abstentions.
7. Produce one winning architecture and one binding implementation plan. Do not merge incompatible proposals into an unreviewed compromise. Borrow a specific element only when the winning author incorporates it explicitly and the council records its source.

## Required verdict

Return:

1. The selected direction in one sentence.
2. The vote tally, confidence, participating models, unavailable seats, and dissent.
3. Why the selected direction satisfies the stated variables.
4. The authoritative permission/capability schema.
5. The lifecycle from approved plan to worker launch, execution, escalation, review, integration, memory update, and expiry.
6. Role profiles for research, implementation, review, integration, and shared-memory maintenance.
7. Exact provider mappings for Antigravity, Claude Code, Codex, hosted agents, and DSH itself.
8. Protected resources and operations that remain impossible without a new human approval.
9. A migration plan from the current provider behavior.
10. Verification and adversarial tests proving both useful autonomy and containment.
11. Any unresolved decision that genuinely requires the user.

## Build recommendation boundary

There is no swarm in this saved run.

If the selected direction is achievable entirely through existing configuration, provide the exact configuration plan but do not apply it.

If anything must be built locally, state **RECOMMEND A FOLLOW-UP SWARM BUILD** and the final answer must return all of the following:

1. **The code.** Complete, ready-to-apply code for every new or changed file — full file contents for new files, exact unified diffs against the current tree for changed files, plus tests. Placeholders, stubs, and "implement here" are not acceptable. The code is returned in the verdict only; nothing is written to disk in this session.
2. **The fastest swarm path.** A collision-free build DAG ordered for the shortest wall-clock completion: maximum parallelism, no two tasks writing the same file, each task on its own candidate root or worktree, sequential edges only where one task truly consumes another's output. For each task give task ID, goal, the code block(s) it applies, dependencies, allowed files, forbidden files, acceptance test command, worker class (use the `fastest` swarm profile), integration owner, and verification stage. State the expected critical path.
3. **A ready-to-save run.** One saved-run definition for DSH, in this exact shape:
   - `id`: `area/name`, lowercase kebab (e.g. `dsh/agent-permissions-build`)
   - `name`: short label
   - `stages`: `swarm,review`
   - `mode`: `fastest`
   - `autoAdvance`: `false`
   - `query`: the full swarm request — it must point at this council run's record (`~/.dsh/council-runs/<this run id>.json`) as the authoritative code and DAG, and restate: no pushes, commit locally and queue for the gatekeeper, every agent names its model.

**Saving the run is gated.** Do not save it before approval. Only after the user approves this verdict at the council gate (button press plus a later message) save the definition with `save_pipeline_preset`, read it back, and report the id. Saving it starts nothing; the swarm still runs only when the user presses that saved run and passes its own swarm execution gate. Nothing from the build runs during this council session.

Do not weaken or bypass an approval mechanism to demonstrate the design. Do not make real metered provider calls merely for testing. Do not push or commit. Every agent identifies itself by its actual model name in user-visible output.
