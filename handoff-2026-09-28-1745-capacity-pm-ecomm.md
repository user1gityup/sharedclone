---
name: handoff-2026-09-28-1745-capacity-pm-ecomm
description: pm UI sample run is parked at its plan gate; next scope is a SWARM_SELECT_BUILD run strategy the user has specced
metadata:
  type: project
---

Handoff id: capacity-pm-ecomm-2026-09-28-1745
Updated: 2026-09-28 19:25Z
Host: vmixlaptop2x6 (ndi2)
Session: local_17d17931-61fd-4b8e-b1fc-7f6d7627a3a0
Model: Claude Opus 5 (claude-opus-5)
Owner: Claude Opus 5, session local_4e480160-314d-4da1-870e-14d53704f9f6 (vmixlaptop2x6), CLAIMED 2026-09-28 20:0xZ, Remote Control ON
Remote Control: ON - resume with it ON
Reason for handoff: quota-handoff FINISH NOW threshold, not a blocker

RESOLVED-2026-09-28 (verified by the claiming session): run 47a0584f was STOPPED from the panel, not approved. ~/.dsh/settings.yaml now carries pipelineStoppedId: 47a0584f-71d5-45a4-91a8-8ce5f0f7c123 with pipelineId, pipelineStage, pipelineStages, pendingPlanId all cleared - stopWrites() in PipelineControl.tsx:116 writes exactly that set and retires pending gates, so gate bb5acff6 no longer exists. The journal is frozen at 102,111 bytes / 12:24. Do not wait on it. Original claim below, superseded.
STALE-WAITING-ON-USER-1: run 47a0584f-71d5-45a4-91a8-8ce5f0f7c123 is parked at ITS OWN plan gate bb5acff6-51ba-4142-9754-7f66988d8b3b (stale false), stage council of council,swarm, revision 143, journal 36 entries / 102,111 bytes, idle 31 min. It is NOT hung - it is waiting for approval. Approving advances it to the swarm stage, which is where the HTML files get written.
RUN-CONTENT (corrected): the council stage DID produce full HTML samples in several seat replies - kimi and agy-gpt-oss both returned three standalone samples inline in the journal. The earlier 'planning answers, not HTML' reading was wrong. That is correct for this stage; the judging seat noted it and was right to.
SEATS-ANSWERING on it: deepseek, kimi, agy-gpt-oss, claude-work, openai, cheaperinference, openrouter-free, free-claude, claude.

NEW-ASK-NOT-STARTED: the user sent DSH_Swarm_First_Run_Workflow_Amendment.md and said "complete this". NOTHING has been built for it. Archived at ~/.claude/shared-brain/pm/runs/dsh-swarm-select-build-amendment.md (the original is in ~/Downloads, outside every DSH read root).
NEW-ASK-SUMMARY: add a configurable run strategy named SWARM_SELECT_BUILD that skips the council entirely. Stage 1 parallel swarm, every agent independently produces its own full sample, no debate/vote/merge/critique before presentation, each result preserved separately. Stage 2 present samples to the user ONE AT A TIME, naming the agent that produced each, recording which agents won AND which specific elements the user picked from each. Stage 3 a SECOND swarm builds the real product, assigned primarily to the winning agents, decomposed into parallel components, winning agents may fan out to parallel sub-agents, integrate at the end. Optimise for wall-clock time. The USER selects - never a council vote, automatic ranking or merged consensus. Must not break existing run modes; the council stays available for other workflows.
NEW-ASK-LIFECYCLE: parallel_sample_swarm, sequential_user_review, capture_winners_and_selected_elements, decompose_production_work, parallel_winner_swarm, parallel_subagent_fanout, integrate, deliver.
NEW-ASK-STARTING-POINTS (measured this session, not guessed): stage order is read by readStages and stored in council.pipelineStages; the pipeline tool is packages/council/tool-council/src/index.ts (pipelineQuery written verbatim at :2108, no preset lookup); swarm routing is roster.ts assignWorkers/takesKind/inferKind plus route-swarm.ts; the panel is packages/client/ui-council-budget/src/client/PipelineControl.tsx, which substitutes chosen.query for a saved run; candidate picking already exists (pickCandidates, pipelineCandidates, pipelinePicked) and is the closest thing to Stage 2 that is already built.

DONE-fix: 3dae333595 fix(council) let narrowed swarm seats take unclassified units, and serve READ from every root. PUSHED (4f28bd4e47..3dae333595, carrying 7908358d65). VERIFIED live: .built-commit = 3dae333595, lib/types/roster.js carries the new takesKind, lib/index.js carries readRoots.
DONE-run-saved: pipelinePresets["pm/ui-samples"], stages council,swarm, autoAdvance false, query 7,528 chars, written through settings.mutate and read back byte-identical. Text at ~/.claude/shared-brain/pm/runs/pm-ui-samples.query.md, spec at pm/runs/pm-ui-design-specification.md.
VERIFIED-launch-route: the saved-run list expands the query correctly - 47a0584f carries the full brief, not the preset id. Sending a preset id as a composer message does NOT expand; that is what broke 14ab3f9e.
DONE-pm-server: was down (ECONNREFUSED 4480), restarted with pm/START-PM.cmd, answers 200.

BLOCKER-user-only-1: no inbound firewall rule for TCP 4480 on ndi2; both agent routes to create it are refused by the classifier.
BLOCKER-3: vmixer2o2's harness branch DIVERGES - 99df2c5899 and 3dae333595 are one fix as two commits. That host must MERGE, not fast-forward, and keep one implementation. Its 2 queue entries are NOT satisfied by the push.

NEXT: build SWARM_SELECT_BUILD per the amendment, starting from the files named above. The gate half of the old NEXT is dead - the run was stopped.
DO-NOT: restart 47a0584f; approve its gate for the user; set council.autoApprove; hand-edit pm.db or settings.yaml; push; touch the stale queue entry at push-requests.md line 830; start OpenClaw layer 2 on ndi2.
QUEUE: 3 requests open for the git gatekeeper.
TREE: harness is 0 ahead / 0 behind origin, dirty with another agent's uncommitted AWS quota-ledger work - leave it.
