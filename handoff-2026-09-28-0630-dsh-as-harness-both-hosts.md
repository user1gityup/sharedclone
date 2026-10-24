---
name: handoff-2026-09-28-0630-dsh-as-harness-both-hosts
description: Make DSH the harness for all work on ndi2 AND vmixer2o2 - prove every piece end to end, then run the pm UI build through it
metadata:
  type: project
---

Handoff id: dsh-as-harness-2026-09-28-0630
Updated: 2026-09-28 (re-verified by owner)
Host: vmixlaptop2x6 (ndi2)
Session: local_ba748b7e-9017-4cdf-b7b9-9c2e91abc8c6
Model: Claude Opus 5 (claude-opus-5)
Owner: CLAIMED 2026-09-28 by Claude Opus 5 (claude-opus-5), host vmixlaptop2x6 (ndi2), session local_ede626cd-75f4-40a1-bcca-46c4499fe0be, Remote Control ON
Collaborating agents: local_8fda2108 [dffa44] on ndi2 owns pm/ and is building brief/claude-code driver/runner; vmixer2o2 [1d0410] holds Remote Control open
Remote Control: ON - keep it on, reach vmixer2o2 agent-to-agent, never through the user
Read first: pm-live.md, then pm itself (128 tasks) - do not reconstruct state from handoff notes

Ask (user, verbatim intent): ensure DSH can run for ALL tasks on BOTH hosts, so DSH becomes the harness going forward instead of desktop apps. Then create a DSH run that builds the pm UI - the user supplies the design prompt for that run separately.

## The standing rules this work runs under
User picks the council and swarm seats EVERY run; a roster is never defaulted, inferred or carried over. pm PREPARES runs and never dispatches one. A stalled run is amended in place (same run id, council.pipeline* kept, journal reused); restart is refused unless the user names it. Never set council.autoApprove. Ask one step at a time and wait.

## State, verified this session
pm: live, LAN mode, bound 0.0.0.0 on 10.0.0.241:4480. Non-loopback without token = 401, with token = 200/11 projects. 128 tasks, 11 projects, both machines.
pm remote creds: ~/.claude/pm-remote.env, sealed to the fleet as fleet/secrets/pm-remote-env.enc (commit 487471c1). vmixer2o2 gets it by syncing the brain.
NOT a blocker after all (corrected 2026-09-28 by Claude Opus 5, session local_ba748b7e, who wrote the wrong line): pm cross-machine is DONE and PROVEN. vmixer2o2 ran `node cli.mjs projects` against http://10.0.0.241:4480 with its sealed token and got exit 0 and all 11 projects / 128 tasks, no timeout. There is still no named inbound firewall rule for TCP 4480 on ndi2, but it is evidently not blocking that host, and neither firewall was touched. Do not ask the user for the rule unless a call actually times out. Step 2 of the work list below is therefore already complete.
Known, small, unfixed: pm/cli.mjs:12 attaches the bearer header whenever PM_TOKEN is set rather than when the base is remote (BASE defaults to loopback at cli.mjs:8). Harmless - the host ignores a token on loopback - but it is "token is set", not "base is remote".
DSH ndi2: running, pid 31252, under the FCC monitor (fcc-status.json dshPid 31252). FCC healthy on 8082.
DSH vmixer2o2: running, pid 43640, .built-commit 4f28bd4e47 - newer build than any handoff records, and currently UNOWNED.
Council seats enabled on ndi2: free-claude, kimi only. Disabled: openai, deepseek, claude, openrouter-free, llama-local, seven agy-*.
free-claude WORKS: run exactly as seats.ts:226-265 defines it it answered "SEAT OK", exit 0. There is NO seat fault and NO established council defect - do not claim one.

## The one real unknown, and the first thing to settle
Three pipeline runs (035e2892, 9316dc35, 23253634) all ended without completing. 23253634 cleared its council.pipelineId at ~45s with nobody stopping it. A seat grinding through free-tier 529 retries would leave the run RUNNING at stage council, not clear it, and free-claude's ceiling is 420s (seats.ts:258). So the timeout explanation does not cover it and nothing else has been established.
Settling test: with the user's chosen seats enabled, start ONE run and leave it strictly alone past 420s. Watch council.pipelineId, pipelineStoppedId, pipelineStage, and whether a second journal entry appears under ~/.dsh/council-runs/journal/<id>.jsonl. Do not stop it. If it still clears at ~45s, the timeout theory is dead too and the next place to look is what writes pipelineStoppedId.

## Seats the user picked (recorded on pm T-34c6db4e, comment #22, UNAPPLIED)
kimi + deepseek, codex (openai), cheaperinference on Claude Opus, the agy-* pool, openrouter-free, free-claude kept.
Two cannot be honoured as asked and must be put back to the user, not guessed:
- openai is kinds ["review"] - it would sit out council PLANNING unless that widens.
- cheaperinference is not in the seat list at all. Open item: handoff-2026-09-21-1715-cheaperinference-key-entry.
Enabling any disabled seat is a settings change. Do not make it without the user.

## Work, in order
1. Claim this note. Verify every claim above against live filesystem, git and processes first - several were wrong when written by earlier sessions.
2. Get the firewall rule from the user (one line, elevated, theirs), then have vmixer2o2 prove `node cli.mjs projects` against 10.0.0.241:4480 with its sealed token. That closes pm cross-machine.
3. Put the two unresolvable seat questions to the user, one at a time. Then let THEM enable the seats.
4. Run the settling test above. Report what actually happened; assert nothing you did not watch.
5. Only once a council run completes end to end on ndi2, repeat the proof on vmixer2o2 - its DSH is unowned and on a newer build, so re-verify rather than assume parity.
6. Then, and only then, prepare the pm UI run: pm prepare on a new task, roster left empty, and wait for the user's design prompt before the query is written. The three UI directions already offered are Operations Dashboard / Project-Centric / Compact Command Center; the user has NOT chosen and the samples were never built.

## Do not
Do not start a run to "see what happens" - every run spends on paid seats and the user picks the roster.
Do not relaunch or restart DSH on either host, and do not edit launch-dsh.cmd. ndi2's DSH is under the FCC monitor.
Do not touch the stale push-queue entry at push-requests.md line 830 - agents denied twice.
Do not pull ndi2's harness checkout: 0 ahead / 3 behind origin 4f28bd4e47, with 8 verified colliding files (apps/cli/composition.md, docs/config-catalog.md, docs/module-graph.md, packages/bundle/base/cordis.patch.yml, packages/bundle/base/package.json, packages/council/tool-council/src/index.ts, pnpm-lock.yaml, tsconfig.host.json). The untracked AWS quota work does not collide. User decides.
Do not start OpenClaw layer 2 on ndi2 - vmixer2o2 has the user's go and holds the partial tree; both hosts building it diverges them.
Do not hand-edit pm.db. Do not push.

## Verification pass by the owning session (Claude Opus 5, session local_ede626cd)

Checked live against filesystem, git, processes and pm before any edit.

CONFIRMED:
- pm on ndi2: loopback GET /api/projects = 200; 10.0.0.241:4480 without token = 401. Bound LAN, token enforced.
- No inbound Windows Firewall rule for TCP 4480 exists (enumerated every enabled inbound rule's port filter). Still user-only.
- DSH ndi2 pid 31252 alive; fcc-status.json ready:true, monitoring:true, dshPid 31252, monitorPid 30428.
- Harness checkout: branch feat/heterogeneous-teammates at 478ebb005f, 0 ahead / 3 behind origin, dirty (17 modified, 6 untracked incl. packages/quota/quota-aws and ui-aws-quota). Matches the handoff.
- The three short journals exist: 035e2892 (1622 B), 9316dc35 (2087 B), 23253634 (1456 B). 23253634 holds exactly one entry, seat kimi, ms 7738, a complete PLAN. No second entry, no council-runs record.
- Council seats enabled on ndi2: free-claude, kimi. All others false.
- Collaborating sessions live: Continue PM completion build [dffa44], Remote control standby for project manager agent [1d0410].

WRONG IN THE HANDOFF AND IN pm T-34c6db4e comment #22 - both "unresolvable seat questions" rest on false facts:
1. "openai is kinds [review], so it would sit out council planning" - false twice over.
   council.seats.openai is {enabled: false, args: [exec, --skip-git-repo-check, {prompt}], model: ""}; it carries no kinds at all.
   `kinds` exists only on the SWARM roster (roster.ts:272 seatRoster overrides), and settings.yaml swarmRoster.openai is
   {enabled: true, kinds: [code, tests, docs, research, review]} - not [review]. Council participation is governed by
   council.seats.<id>.enabled alone, so kinds cannot exclude a seat from council planning. This question is void.
2. "cheaperinference is not in the seat list at all" - false. council.seats.cheaperinference exists
   (settings.yaml:389) with model deepseek-v4-flash-0731, enabled: false, and the provider block is fully defined
   (settings.yaml:91, apiKeyEnv CHEAPERINFERENCE_API_KEY, baseURL https://api.cheaperinference.com/v1, 12+ models).
   It can be rostered by flipping enabled. This question is void as asked.

THE ONE REAL SEAT QUESTION THAT REMAINS: the user asked for "cheaperinference using Claude Opus". The CheaperInference
model catalog in settings.yaml contains NO Anthropic model - deepseek-v4-flash-0731/-v4-flash/-v4.1-flash, gpt-oss-120b,
glm-5.3-flash, glm-4.5-air, gpt-5-nano, gpt-4.1-nano, gpt-5.6-luna, qwen3-6-35b-a3b, qwen3-5-35b-a3b, minimax-m2.7.
So "cheaperinference on Claude Opus" cannot be honoured literally and must go back to the user. Also unverified: whether
CHEAPERINFERENCE_API_KEY is actually present in DSH's credential state (it is not exported by launch-dsh.cmd;
~/.dsh/cheaperinference-control.ps1 is the only file naming it).

## Correction to my own verification pass, and the fix that followed

My first reading of the CheaperInference catalogue was WRONG and is withdrawn: I read only the first
50 lines of the provider block and reported 12 models with no Anthropic entry. The provider block
actually carried 60, including claude-opus-5, claude-opus-4.8, claude-fable-5.1 and claude-opus-5-fast.
The user was right.

The real defect, found by opening the running DSH at 127.0.0.1:3080 and comparing both lists:
- council.cheaperInferenceModels (published live by the budget publisher, cheaperinference-budget.ts
  readBudget -> textModels) held 65 ids.
- providers.cheaperinference.models (what the per-session model picker renders) held 60.
- Six the picker was missing: claude-opus-5.5, gemma-4-31b-it, gpt-6-luna, mimo-v2.6-flash,
  mimo-v2.6-pro, minimax-m2.5. claude-opus-5.5 is the one the user could see in the council budget
  panel and not in the individual selector.

FIXED through the app's own path, not by hand-editing settings.yaml: Settings -> Models -> CheaperInference
-> Customized settings -> Fetch available models -> Add selected -> Apply. The picker pre-checks exactly
the ids not already configured, so capacities came from the provider's own GET /v1/models rather than a guess.
The API key was already configured (the field reads "Configured - enter a new value to replace"), which
also retires the "CHEAPERINFERENCE_API_KEY may not be wired" note above.

VERIFIED AFTER, live in the UI: the per-session model picker now lists all 65 text models, claude-opus-5.5
included. providers.cheaperinference.models is 72 entries; nothing the live catalogue holds is missing.

ONE THING FOR THE USER TO DECIDE: the adopt also brought in seven ids the council's own text-model filter
excludes because they cannot serve chat - gpt-image-2, grok-imagine, nano-banana, nano-banana-2,
nano-banana-pro, seedance-2.0 (image/video), and gpt-5.5-pro was already there but is not in the live text
list. They were kept because the ask was "all the models"; say the word and they come out.

So the user's seat pick "cheaperinference using Claude Opus" IS honourable - claude-opus-5, claude-opus-5.5,
claude-opus-5-fast, claude-opus-4.8 and others are all selectable. pm T-34c6db4e comment #23's closing
paragraph is superseded on that point.

