---
name: handoff-2026-09-28-2020-swarm-select-build
description: SWARM_SELECT_BUILD run strategy built and green; pm council run f8be04b5 live with two dead Antigravity seats
metadata:
  type: project
---

Handoff id: swarm-select-build-2026-09-28-2020
Updated: 2026-09-28 21:05Z
Host: vmixlaptop2x6 (ndi2)
Session: local_4e480160-314d-4da1-870e-14d53704f9f6
Model: Claude Opus 5 (claude-opus-5)
Owner: Claude Opus 5, this session, ACTIVE
Remote Control: ON - resume with it ON
Repo: ~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates, HEAD 3dae333595, 0 ahead / 0 behind
Reason for handoff: context checkpoint at the hook threshold, not a blocker

PRIOR-NOTE-CORRECTION: handoff-2026-09-28-1745-capacity-pm-ecomm.md said run 47a0584f waited at gate bb5acff6. It did not - it was STOPPED from the panel (settings.yaml pipelineStoppedId), gate retired by stopWrites() in PipelineControl.tsx:116. Journal frozen at 102,111 bytes. That note is amended in place.

DONE-SWARM_SELECT_BUILD: built, typechecks, 36/36 new tests green, all uncommitted.
NEW-FILE: packages/council/tool-council/src/sample-select.ts - verdict record, next-sample walk, one-sample render, winners, selection brief. Spends nothing, ranks nothing.
NEW-TESTS: tests/sample-select.spec.ts (15), tests/swarm-select-build.spec.ts (21). Both green.
EDIT-pipeline.ts: stages sample + select added to ALL_PIPELINE_STAGES; SWARM_SELECT_BUILD_STAGES = sample,select,swarm; PIPELINE_STRATEGIES map; parseStages resolves a strategy NAME case-insensitively; selections carried on state/StageInput/StageOutput INCLUDING the not-complete gate branch (select stops once per sample - without that every verdict was lost).
EDIT-propose.ts: vote?: boolean option. false = same parallel writing round, no runSelection ballot, no voting calls, sample-round wording.
EDIT-index.ts: config key pipelineSelections; tool params select (keep|pass) and elements; stage runners for sample (rides the propose gate) and select (no gate - it spends nothing); swarmQuery prefers selectionBrief over the pick list; swarm stage gets chosen = winners().
EDIT-swarm.ts: chosen?: readonly string[]; chosenSpecialists() earns first refusal on every kind, in ANY profile, and forces ignoreCost (speed-first).
EDIT-roster.ts: exported chosenSpecialists(chosen, roster) - per-kind, skips kinds a kept agent refuses, skips disabled agents.
EDIT-PipelineControl.tsx: KNOWN_STAGES + STAGE_LABEL gain sample/select; STRATEGIES map so readStages expands a strategy name instead of falling back to the council chain. 47/47 panel tests green.
DOCS-REGENERATED: docs/tool-catalog.md + .zh.md patched both sides, pair RE-RECORDED green. docs/config-catalog.md + .zh.md patched both sides.
GATE-LEFT-RED-ON-PURPOSE: docs/config-catalog pair is out of sync AT HEAD (proven by stashing my edits and re-running). Its zh side is missing the whole llm-openclaw-chatgpt section - heading #124, code block #40, link target #68. Pre-existing, not mine. I un-recorded my --write on config-catalog.i18n.yaml (git checkout HEAD) rather than falsely certify it.
LINT-OUTSTANDING: pipeline.ts 522-535 stylistic indent on the new nested ternary in the handover block. The rest of the repo lint errors are pre-existing. Autofix was interrupted; run it.
TEST-FLAKES-NOT-MINE: settings-api-key-env.spec.ts and quota-ledger.spec.ts time out only under the full parallel run; each passes alone. quota-ledger is another agent's untracked work.

LIVE-RUN-f8be04b5: pm UI sample run, stages council,swarm,review, started 16:13 local. ALIVE and advancing - journal 13,575 bytes at 16:13 grew to 23,037 at 16:21. Round 1 = plan (10 seats), round 2 = vote (in flight). No seat errors.
DEFECT-1-AGY-SEATS: agy-gpt-oss returned 117 chars - "I am Antigravity, running on GPT-OSS 120B (Medium). How can I assist you today?" - and agy-gemini-pro returned 515 chars saying the task "may have been truncated due to length limits". Both Antigravity seats got the preamble (rules + brain index + memory digest) and NOT the 7,528-char task. The other 8 seats restated the task correctly. Two paid calls, nothing contributed, both rounds.
DEFECT-1-NOT-ROOT-CAUSED: no truncation/maxChars setting found in the agy seat config or packages/llm. Limit is on the Antigravity language-server side. Next step is to measure the prompt actually sent to an agy seat.
OBSERVATION: f8be04b5 runs the DEFAULT council chain on a brief whose whole point is user-chosen HTML samples. That is the shape that produced planning prose last time. SWARM_SELECT_BUILD is the chain for it.

TREE: dirty. Mine = sample-select.ts, 2 new specs, pipeline/propose/index/swarm/roster.ts, PipelineControl.tsx, docs/tool-catalog*.{md,i18n.yaml}, docs/config-catalog.{md,zh.md}. NOT mine, leave alone = packages/client/ui-aws-quota/, quota-ledger*.ts + spec, docs/module-graph.md and the tsconfig/knip/bundle churn.
QUEUE: 3 requests open for the git gatekeeper. Nothing of mine is committed or queued.
BLOCKER-user-only-1: still no inbound firewall rule for TCP 4480 on ndi2.
PM-SERVER: DOWN again on 4480 (curl refused). Restart with pm/START-PM.cmd when pm is needed.
DO-NOT: push; commit another agent's files; approve a gate for the user; set council.autoApprove; hand-edit pm.db or settings.yaml; touch push-requests.md line 830.

PEER-THREAD: handoff-2026-09-28-1632-ecomm-swarm-only-and-select-build.md, now owned by session local_c5043f62 [2c4f48] (51100d confirmed and stopped 17:20). It is writing six ecomm presets into ~/.dsh/settings.yaml, then brain-sync, then the vmixer2o2 delivery path. It is NOT touching my files.
PEER-ASK-1-ZERO-COST-PROFILE: accepted in principle, NOT STARTED, awaiting the user. Mirror the fastest filter with costClass === 'free' and let the contest reviewer fall back to free unconditionally under that profile. Needed because the sample stage has NO seat filter - runPropose uses every seat where enabled is true - so free-only and paid-only sampling cannot be expressed today.
PEER-ASK-2-GATELESS-FLAG: REFUSED on peer authorization. It removes a two-factor spend gate. A user .md held by another session is not this user's approval reaching this session; building it on a relayed instruction is permission laundering. Put to the user directly, with the peer's framing intact. Only build it on the user's own yes, naming the flag and its scope.
VERIFIED-FOR-THE-PEER (read-only, this session): swarm.ts:394 - fastest already filters costClass !== 'free', so PAID-ONLY is expressible today. swarm-contest.ts:55-56 - paidReviewers.length > 0 ? paidReviewers : reviewPool, so economy reviews with a paid seat whenever one is enabled and is NOT zero-cost here. Both peer claims confirmed.
BLOCKER-vmixer2o2 (peer-reported, unverified from here): its deepseek-harness is DIVERGED at 9b4db91659, 2 behind / 2 ahead, and its DSH build is that same commit - no sample stage, no select stage, no SWARM_SELECT_BUILD, no image-kind routing. Its 2 ahead commits must be read before any merge. Nothing reaches it until this work is committed AND the user releases the push queue to the gatekeeper.
PUSH-POSITION: told the peer plainly that no push comes from this session - git-gatekeeper only, and only when the user says the session is ending. The peer must not size its delivery path on me pushing.

NEXT: on the user's word only - fix the oxlint indent at pipeline.ts 522-535 (the autofix was interrupted, so do it as an edit, not a retry of the rejected command), re-run the council suite, commit the SWARM_SELECT_BUILD work alone, and decide the zero-cost profile and the gateless flag.
