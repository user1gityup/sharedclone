---
name: handoff-2026-09-28-0417-pm-completion-operational
description: Project Manager completion - PM now PREPARES runs and the user picks seats and starts them; no council defect is established, no run has been allowed to finish
metadata:
  type: project
---

Handoff id: pm-completion-2026-09-28-0417
Updated: 2026-09-28 06:25
Host: vmixlaptop2x6 (ndi2)
Session: local_ba748b7e-9017-4cdf-b7b9-9c2e91abc8c6
Model: Claude Opus 5 (claude-opus-5)
Owner: Claude Opus 5 (claude-opus-5), ndi2 session local_8fda2108 "Continue PM completion build [dffa44]", claimed 2026-09-28 05:05 (Remote Control ON). Prior owner local_ba748b7e released.
Collaborating agents: vmixer2o2 "Remote control standby for project manager agent [1d0410]" - delivered its full read-only inventory (20 lines), holding Remote Control ON, waiting for the pm/runner.mjs install request
Remote Control: ON (turned on this session, keep it on)
Repo: ~/.claude/shared-brain (branch main); pm lives at shared-brain/pm, data at ~/.claude/pm-data/pm.db (outside git)
Ask: ~/Downloads/project-manager-completion-dsh-run.md - make PM the operational control point (see, launch, resume, continue), reconcile all open work into PM first, then run the completion itself as a DSH run, then UI samples behind a user approval gate
Plan file: ~/.claude/plans/sharded-coalescing-bonbon.md (approved by user)

Verified: PM server running on 4480, /api/health ok
Verified: node --test test.mjs in pm/ = 10 pass 0 fail, run before and after the schema change
Verified: live pm.db migrated in place - tasks now carry lifecycle, kind, origin_machine, execution_machine, run_ref, session_ref, agent, provider, model_id, checkpoint, next_action, blockers, source_ref, meta
Verified: DSH has no council/pipeline API - start = POST /api/session.prompt with PipelineControl.tsx startPrompt(); continue = CONTINUE_PROMPT; settings plane loopback-only; autoAdvance is a browser loop only
GATE 1 DONE. Reconciliation tally: PM went from 8 projects / 55 tasks to 11 projects / 127 tasks. Discovered 99 ndi2 items (70 open handoffs, 2 open push-queue entries, 8 brain project notes, 18 DSH council runs, 3 live sessions) + 16 vmixer2o2 items. Added 72, corrected 45 in place, ignored 28 handoff notes whose own frontmatter or MEMORY.md index line says closed/done/resolved.
Verified: every import is idempotent - the second run of the ndi2 sweep created 0 and left 79 of 80 unchanged
Verified: lifecycle spread READY 65, VERIFY 25, BLOCKED 14, FAILED 7, PAUSED 7, WAITING 6, RUNNING 3; origin ndi2 114, vmixer2o2 12, vmixlaptop2x6 1
Verified: only 2 non-archived Claude Code sessions on ndi2 besides this one; vmixer2o2 has exactly 1 (all its others archived 2026-09-28 03:15, so every "resume in session X" handle written in the handoffs is DEAD)
Verified: DSH is NOT running on ndi2 (3080 closed); it IS running on vmixer2o2, pid 43640 on build 4f28bd4e47 - a newer pid and build than any handoff records, and currently unowned

Re-verified 2026-09-28 05:05 by local_8fda2108 (Claude Opus 5): pm /api/health ok on 4480; node --test test.mjs 10 pass 0 fail; 127 tasks / 11 projects live; lifecycle spread READY 65 VERIFY 25 BLOCKED 14 FAILED 7 PAUSED 7 WAITING 6 RUNNING 3 - exact match. TWO CORRECTIONS: (1) the "uncommitted" pm changes are NOT uncommitted - the brain sync hook auto-committed them as "brain: vmixlaptop2x6 session changes" fb0fcfd4..cc82fac9 (04:15-04:24); shared-brain working tree is clean at a3ed02da. (2) DSH IS NOW RUNNING on ndi2 - 127.0.0.1:3080 LISTENING pid 31252, HTTP 200 - so ~/.dsh/launch-dsh.cmd is not needed. pm/drivers, pm/actions.mjs, pm/brief.mjs, pm/runner.mjs, pm/ui-samples still absent, as claimed; pm/connectors/dsh-connector.mjs is the old 09-21 file, not new work.

Changed (uncommitted): pm/store.mjs (LIFECYCLES/RUN_KINDS/RUN_STATES/OP_FIELDS, lifecycleFor, migrate(), runs table, opFields/coerce/checkLifecycle, upsertBySource, startRun/updateRun/listRuns, listTasks filters, getTask returns runs), pm/server.mjs (POST /api/tasks/upsert, GET /api/runs, POST /api/tasks/:id/runs, PATCH /api/runs/:id)
Added (uncommitted): pm/connectors/lib.mjs, import-inventory.mjs, scan-brain.mjs, scan-dsh-runs.mjs, backfill-source-refs.mjs
Not started: pm/brief.mjs, pm/drivers/claude-code.mjs, pm/runner.mjs, pm/ui-samples/*  (pm/actions.mjs and pm/drivers/dsh.mjs are DONE - see below)
DONE: cli.mjs tool table entries for the new verbs (one table drives CLI + MCP); test.mjs cases for the new surface

PHASE 2 + PHASE 3 CORE DONE, THEN RESHAPED to the user's 2026-09-28 amendment.
User's amendment (relayed through local_ba748b7e): pm CREATES runs, it does not dispatch them; the USER picks the council and swarm seats per run; ask one step at a time while building a run; the user starts it; a run that does not complete is FIXED IN PLACE, not stopped and restarted.
Added: pm/drivers/dsh.mjs - loopback DSH driver. Panel startPrompt/CONTINUE_PROMPT/stopWrites verbatim, gate approval as settings-write-then-prompt, amend() (in-place repair, keeps run id and journal), restart() refused unless confirm is passed by name, stop() retries the optimistic-revision race (a live run rewrites council constantly and the stop that loses that race is the one that matters), stale-gate and already-running refusals, fresh-session option, its own CLI.
Added: pm/actions.mjs - prepare|start|resume|continue|amend|stop|archive over a lifecycle + machine-ownership state machine. WAITING is where a prepared run sits. prepare contacts no DSH and leaves the roster EMPTY on purpose; start refuses while it is empty; a roster is never defaulted, inferred, or carried over without an explicit keepRoster. The prepared run lives in tasks.meta, so it survives a restart.
Changed: pm/server.mjs (GET /api/tasks/:id/actions, POST /api/tasks/:id/{prepare,start,resume,continue,amend,stop,archive}; routes awaited), pm/cli.mjs (the one table that drives CLI + MCP), pm/test.mjs.
Verified: node --test test.mjs 10 pass -> 19 pass 0 fail
Verified live after restart: prepare T-34c6db4e -> WAITING, missing [council, swarm], question "Who should sit on the council?"; start refused with "the user picks the seats"
Verified live: a READY task offers only prepare+archive; T-c67c2752 (vmixer2o2) refused on this host naming both reasons
Verified: MACHINE ALIASING - the brain calls this host ndi2, Windows calls it vmixlaptop2x6, and 114 reconciled rows say ndi2; actions.mjs ALIAS_GROUPS treats them as one machine, or every action on a reconciled task would have refused.

THREE RUNS WERE STARTED BEFORE THE AMENDMENT ARRIVED, AND ALL THREE DIED THE SAME WAY:
035e2892 (produced a plan, never approved - it misread loopback as IPC and re-specified built modules), 9316dc35 (reused the old session: the PM server was still on the pre-patch actions.mjs, so fresh was ignored), 23253634 (fresh session, corrected scoped request). Each reached stage council, then cleared itself; none is recoverable and pm records all three cancelled with why. Nothing was ever approved; council.autoApprove is false.
WHY THEY DIED IS NOT ESTABLISHED. An earlier "no quorum, dead free-claude seat" reading was recorded and is now RETRACTED (task comment #21 withdraws comment #20). Verified against source: free-claude is a CLI seat (tool-council/src/seats.ts:226-265) that spawns the claude binary at the local FCC proxy; it never reads the free-claude-code provider block, so FCC_DSH_API_KEY is irrelevant and the free-claude / free-claude-code naming is two different things. seats.ts:258 sets timeoutMs 420_000, and the comment above it records a MEASURED 84s spent on free-tier 529 refusals plus an earlier kill at the run's 180s default. CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1 (seats.ts:249) is why the FCC log shows a startup GET /v1/models and no completion - expected, not damning. Session local_ba748b7e ran the seat by hand with that exact command and env: "SEAT OK", exit 0.
So: the journals show one seat because the runs were cut short, not because a seat failed. Do NOT tell the user the council is defective on this DSH.
ONE DATUM STILL UNEXPLAINED: 23253634 was not stopped by anyone - its council.pipelineId went empty roughly 40-50s in, far short of 420s. Something cleared that run rather than it waiting on a slow seat. The settling test must account for it.
SETTLING TEST, whenever the user starts a run: let it sit past 420s unstopped and watch for a second journal entry from free-claude.
Live seat roster on ndi2: enabled free-claude, kimi. Disabled openai, deepseek, claude, openrouter-free, llama-local, agy-flash-lite, agy-flash, agy-pro, agy-gemini-flash, agy-gemini-pro, agy-claude-sonnet, agy-gpt-oss. council.openai = {enabled true, kinds [review]}. Profiles economy.
USER'S SEAT PICKS (their choice, NOT applied - enabling a seat is a settings change and theirs to make): kimi + deepseek, codex (openai), cheaperinference on Claude Opus, the agy-* pool, openrouter-free, free-claude kept.
Two unresolved, surface rather than guess: the openai seat is kinds [review] only, so it would sit out council planning unless that widens; and cheaperinference is not in the seat list at all - handoff-2026-09-21-1715-cheaperinference-key-entry is the open item for its key, and it cannot be rostered until that lands.

Not started: pm/brief.mjs, pm/drivers/claude-code.mjs, pm/runner.mjs, pm/ui-samples/*  (pm/actions.mjs and pm/drivers/dsh.mjs are DONE - see below)
DONE: cli.mjs tool table entries for the new verbs (one table drives CLI + MCP); test.mjs cases for the new surface

PHASE 2 + PHASE 3 CORE DONE, THEN RESHAPED to the user's 2026-09-28 amendment.
User's amendment (relayed through local_ba748b7e): pm CREATES runs, it does not dispatch them; the USER picks the council and swarm seats per run; ask one step at a time while building a run; the user starts it; a run that does not complete is FIXED IN PLACE, not stopped and restarted.
Added: pm/drivers/dsh.mjs - loopback DSH driver. Panel startPrompt/CONTINUE_PROMPT/stopWrites verbatim, gate approval as settings-write-then-prompt, amend() (in-place repair, keeps run id and journal), restart() refused unless confirm is passed by name, stop() retries the optimistic-revision race (a live run rewrites council constantly and the stop that loses that race is the one that matters), stale-gate and already-running refusals, fresh-session option, its own CLI.
Added: pm/actions.mjs - prepare|start|resume|continue|amend|stop|archive over a lifecycle + machine-ownership state machine. WAITING is where a prepared run sits. prepare contacts no DSH and leaves the roster EMPTY on purpose; start refuses while it is empty; a roster is never defaulted, inferred, or carried over without an explicit keepRoster. The prepared run lives in tasks.meta, so it survives a restart.
Changed: pm/server.mjs (GET /api/tasks/:id/actions, POST /api/tasks/:id/{prepare,start,resume,continue,amend,stop,archive}; routes awaited), pm/cli.mjs (the one table that drives CLI + MCP), pm/test.mjs.
Verified: node --test test.mjs 10 pass -> 19 pass 0 fail
Verified live after restart: prepare T-34c6db4e -> WAITING, missing [council, swarm], question "Who should sit on the council?"; start refused with "the user picks the seats"
Verified live: a READY task offers only prepare+archive; T-c67c2752 (vmixer2o2) refused on this host naming both reasons
Verified: MACHINE ALIASING - the brain calls this host ndi2, Windows calls it vmixlaptop2x6, and 114 reconciled rows say ndi2; actions.mjs ALIAS_GROUPS treats them as one machine, or every action on a reconciled task would have refused.

THREE RUNS WERE STARTED BEFORE THE AMENDMENT ARRIVED, AND ALL THREE DIED THE SAME WAY:
035e2892 (produced a plan, never approved - it misread loopback as IPC and re-specified built modules), 9316dc35 (reused the old session: the PM server was still on the pre-patch actions.mjs, so fresh was ignored), 23253634 (fresh session, corrected scoped request). Each reached stage council, then cleared itself; none is recoverable and pm records all three cancelled with why. Nothing was ever approved; council.autoApprove is false.
ROOT CAUSE, from evidence on disk: no quorum. The journals for 23253634 and 9316dc35 hold exactly ONE entry each, both seat kimi, which answered fully. free-claude - the only other enabled seat - produced nothing, and ~/.dsh/fcc-server.stdout.log shows FCC getting only GET /health and GET /v1/models, never a POST /v1/responses. FCC itself is healthy and needs no key, so the failure is on the DSH side of that seat.
NOT PROVEN, do not repeat as fact: WHY free-claude does not fire. settings.yaml:7 declares provider free-claude-code with apiKeyEnv FCC_DSH_API_KEY, which appears in no launcher - but apiKeyEnv is a credential REFERENCE here, not necessarily an OS env var, so the decisive check is DSH's own credential state. Also unruled-out: council seat id is free-claude while the provider id is free-claude-code. Same class as the vmixer2o2 OpenRouter relay seat defect (handoff-2026-09-27-1857).
Live seat roster on ndi2: enabled free-claude, kimi. Disabled openai, deepseek, claude, openrouter-free, llama-local, agy-flash-lite, agy-flash, agy-pro, agy-gemini-flash, agy-gemini-pro, agy-claude-sonnet, agy-gpt-oss. council.openai = {enabled true, kinds [review]}. Profiles economy.

Not started: pm/brief.mjs, pm/drivers/claude-code.mjs, pm/runner.mjs, pm/ui-samples/*
Next: build pm/brief.mjs, then pm/drivers/claude-code.mjs (verify the spawn command live before writing it), then pm/runner.mjs - none needs DSH
Blocker: none proven. The user's roster needs seats enabled (a settings change only they make), and two of their picks are not rosterable yet - see the openai kinds and cheaperinference items above
Open question for user: whether to widen the openai seat past kinds [review], what to do about cheaperinference not being a seat, and the UI sample direction (Phase 6) - hard stop there
Do not start a run: pm prepares, the user starts. Do not relaunch DSH or edit its launcher - pid 31252 is under the FCC monitor.

Do not repeat: do not hand-edit pm.db; every write goes through the store API / REST / CLI
Do not repeat: do not reintroduce npm deps or Postgres - pm is dependency-free on purpose
Do not repeat: do not replace the `status` vocabulary; `lifecycle` was added alongside it because test.mjs, the board UI and the MCP tool table depend on status
Do not repeat: do not set council.autoApprove to clear the DSH gate; the two-factor approval is deliberate (drivers/dsh.mjs has no path that writes it, and a test asserts stopWrites never names it)
Do not repeat: do not "fix" a machine mismatch by rewriting execution_machine - ndi2 and vmixlaptop2x6 are the same host, handled by ALIAS_GROUPS in actions.mjs
Do not repeat: do not use restart to clear a stalled run - amend repairs it in place; restart discards the journal and resets lastUserTurnAt
Do not repeat: do not re-scan the brain with a case-sensitive "closed" test - the MEMORY.md index line is the user's own status and outranks the note's frontmatter (scan-brain.mjs already does both)
Do not touch: the stale ndi2 push-queue entry at push-requests.md line 830 - agents have been denied its close twice; pm records it, pm never closes it
Live risk recorded in pm: the OpenClaw layer-2 partial tree is uncommitted on vmixer2o2 right now; if ndi2 starts L2 the two hosts diverge
Do not push. Commit locally; append to push-requests.md if a push is warranted.
