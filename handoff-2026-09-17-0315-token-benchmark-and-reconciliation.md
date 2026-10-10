---
name: handoff-2026-09-17-0315-token-benchmark-and-reconciliation
description: Handoff for the ChatGPT-built shared-brain handoff package (r2) - BEFORE CORE benchmark done, Task 01 shared-brain reconciliation not started
metadata:
  type: project
---

# Handoff 2026-09-17 03:15: token benchmark + shared-brain reconciliation

- Handoff id: handoff-2026-09-17-0315-token-benchmark-and-reconciliation
- Updated: 2026-09-17 14:35 (local)
- Host: VMIXLAPTOP2X6 (ndi2)
- Session: c1d7b77c-58a7-45c9-aadb-41f24c20f644 (Claude Code desktop, cwd ~/Documents/claudecode)
- Model: Claude Opus 5 (claude-opus-5)
- Owner: Claude Opus 5 in this session. Collaborator: ChatGPT authored the package.
- Claimed: 2026-09-17 by Claude Opus 5, session 27bd87a6-00df-4e2b-a715-8e582c0777d2. Verified: BEFORE results and package present; brain HEAD now ae8e44d (moved from freeze a68c7d1 by other sessions).
- Claimed: 2026-09-17 by Claude Opus 5, session 53da21ff-9c75-4d7d-9884-6b6fe4a0141c, for next action 1 (router wiring). Verified: harness clean at 07d17746f6 on feat/heterogeneous-teammates.
- Claimed: 2026-09-17 by Claude Opus 5, session d7ac0afa-a6be-4bc3-ba43-a7897bdf9e12, for next action (a) council wiring. Verified: harness clean at a7ff882d49 on feat/heterogeneous-teammates.
- Claimed: 2026-09-17 by Claude Opus 5, session b076174a-13a8-49ec-a8ab-4159836462fe, for NEXT FIRST (live rebuild + live test). Verified: harness clean at c4ac90ab97 on feat/heterogeneous-teammates. Released 17:40 at 150k context; harness now clean at bda0033b79.
- Claimed: 2026-09-17 18:08 by Claude Opus 5, session e12cd60e-b45e-46d1-bd4a-25824d9163cd, for the swarm contest live run. Verified: harness clean at bda0033b79; DSH host 26144 on 3080, FCC 15204 on 8082, openrouter 30596 on 8080; pendingPlanId empty. Council live test PASSED: `~/.dsh/council-runs/0159642f-0022-4264-a212-06fb6ac4f1f5.json` (17:51:17, same query) carries `plannerRoute: {"roleId":"planner","chosen":"kimi","routerPick":"free-claude","policy":"TOKEN_EFFICIENT","rejections":[]}`, identical to the held route.
- Claimed: 2026-09-17 19:43 by Claude Opus 5, session 5215a0c3-3c51-48c9-bb9c-1d43c896d341, for NEXT (rebuild + contest Route line). Verified: harness clean at ee758e9770; lib 17:25 has 0 hits for renderUnitRoute; DSH 26144 on 3080, FCC 15204 on 8082, openrouter 30596 on 8080.
- Claimed: 2026-09-17 by Claude Opus 5, session 3298bad6-4d32-434a-9f14-031f33938cfd, for (b) tests/suite/commit/rebuild. Verified: harness ee758e9770 + 3 modified files (index.ts, route-swarm.ts, swarm.ts) matching the (b) section; DSH 17176 on 3080, FCC 14024 on 8082, openrouter 28328 on 8080.
- Repos: none changed. The benchmark work lives in `~/Documents/claudecode/token-benchmark/`, which is not a git repo.

## Ask
The user supplied ChatGPT's handoff package `Downloads/shared-brain-claude-handoff-final-r2.zip` (plus `claude-token-benchmark-revised.zip`, which is identical to its `benchmark/` folder). The package sets this order:
1. BEFORE benchmark, CORE E01-E04 only.
2. Task 01: reconcile `proposed-shared-brain/` against the live brain. Prepare everything with no push.
3. Mandatory user review of all proposed changes before any push.
4. Push after explicit approval.
5. Task 02: weight router.
6. MIDPOINT benchmark.
7. Task 03: Project Manager completion.
8. Create PM tasks and saved DSH runs for 04-07 (Council + PAID_FASTEST).
9. Task 08: final sync, with a review gate before its push.
10. AFTER benchmark.

The superseded 12-case suite (B01-B12) must NOT be run, and no fixtures may be created.

## Done (evidence)
- Freeze recorded in `token-benchmark/runs/BEFORE/freeze.txt`:
  - brain a68c7d10 clean
  - harness 6787fa3e8c clean
  - plugins 4d52673 clean
  - claude 2.1.263
- Runner `token-benchmark/run-core.mjs <PHASE> [ids]`:
  - fresh `claude -p` per case in a fixture copy, stream-json output, `--model claude-opus-5`, acceptEdits
  - E04 sends all 3 turn_script replies
- BEFORE results are in `token-benchmark/runs/BEFORE/results-before.csv`. Transcripts and summary.json are in each case folder.

| Case | Total tokens | Output tokens | Result |
|---|---|---|---|
| E01 | 174414 | 1153 | fail (1): read reference.md |
| E02 | 381156 | 1668 | pass (2) |
| E03 | 135992 | 502 | pass (2) |
| E04 | 307883 | 1599 | fail (1): skipped re-presenting revised Rule 2 |

- Aggregate: 999445 tokens, about $1.85. Every fresh session pays roughly 23-60k tokens of injected context before any work starts.

## Task 01 progress (session 27bd87a6)
- All 15 `proposed-shared-brain/` docs read and compared with live notes (package copy: `token-benchmark/handoff-r2/`).
- Findings: proposed shared-memory-protocol and project-manager amendments sit on stale bases (live has the 2026-09-16 fleet section and PM v1 built standalone in `shared-brain/pm`). team-platform base matches live, but `project_dsh_team_platform.md` is missing from MEMORY.md. Proposed A17 "PM implemented inside DSH" contradicts PM v1 as built. Resolver order appears 4 times across runtime-routing, distributed-team-routing, team-platform and weight-router-policy. profile-policy and user-profile-access duplicate each other. The efficiency delta mentions earlier rules 1-38 and `later-review.md`, but neither exists in the package or the brain. Rule 42 (auto-advance) conflicts with feedback_step_by_step_one_at_a_time.
- Staging: `~/Documents/claudecode/token-benchmark/task01-staging/`. The live brain is untouched.
- Staging is complete: `RECONCILIATION.md` (classification table, 5 open decisions, apply plan), 6 new notes, and `patches/existing-notes.md` (3 appends plus index lines). Every wiki link resolves.
- Review: decisions 1-3 DECIDED, staging updated for each.
  1. PM stays standalone in `shared-brain/pm`; it needs no DSH call and DSH is only a client. The ChatGPT-to-Claude bridge (PM records the task, DSH dispatches) is recorded as a target in `dsh-target-architecture.md`, with its three missing pieces: a remote HTTPS MCP endpoint for PM with a token, a DSH connector reading PM, and Claude as a DSH-dispatchable agent.
  2. Rule 42 adopted: after the user answers a review item, present the next one without waiting for "next", one item per message.
  3. ChatGPT supplied the full rule status list (`Downloads/rules-1-110-complete-status.md`, staged as `rules/efficiency-review-1-110-status.md`). Rules 1-35 merged into `rules/efficiency.md`; 23/26/28/36 merged per ChatGPT; rule 32 only sequence-reconstructed. The request file sent to the user was `token-benchmark/request-to-chatgpt-missing-rules.md`.
  4. Flat structure kept: existing notes do not move, new notes go at the top level, only the efficiency rules go in `rules/`.
  5. DEFERRED by the user: no vmixer throughput figure while the local model is still being wired into DSH. machines.md records the deferral; measure after that plumbing.

## Caveats
- Other Claude sessions were writing the live brain during the BEFORE window, for example the 03:02 P9 log entry.
- E04's turn script expects the model to re-present the changed rule. The runner sends the replies blindly, so keep it identical at MIDPOINT and AFTER.

## Task 02 (2026-09-17)
Weight router BUILT in the harness at `packages/council/tool-council/src/router/` (types, registry, filter, score, resolve, index), tests at `tests/router.spec.ts` 23/23, oxlint clean, `tsc -b` clean, committed 07d17746f6 (local only, not pushed). User chose the harness over the brain so it reuses CostClass, roster, quota and seat state instead of copying them. Not yet wired into council, swarm or PM. `dsh-runtime-routing.md` records what is built.

## Swarm wiring DONE (session 53da21ff, 2026-09-17)
Committed a7ff882d49 in the harness, local only. The commit adds `src/route-swarm.ts` and `tests/route-swarm.spec.ts` (15 tests) and changes `src/swarm.ts` to call `routeSwarm` in place of `assignWorkers`. Checks: the full council suite passes 33 files and 518 tests; `tsc -b packages/council/tool-council` exits 0; oxlint is clean; lefthook pre-commit passed. The DSH live build was not rebuilt, so the running DSH still has the old swarm. Not tested in a live DSH swarm run.
Remaining, in this order:
- (a) Council wiring. In `src/select.ts` and `src/council.ts`, map seats to Candidates the same way. Give the reviewer role `independentFrom: ['coder']`, run shadow first, and put the trace in RunRecord (`src/runs.ts`).
- (b) Live seat state for `SwarmRunOptions.seatState` in `src/index.ts`, at both `runSwarm` calls: claude CLI seat headroom from `statuslineSessionPercent()`, and seats failing `probeSeat`. Before gating on quota, decide whether a gated-out seat should park the run resumably, as a quota hold does, rather than block it.
- (c) Once the shadow trace shows agreement, let the router decide.
Design: new `src/route-swarm.ts` maps enabled Workers to Candidates and each SubTask to a RoleRequirement (capability = inferred kind). A seat the caller marks unavailable or quota-exhausted is gated out before `assignWorkers`. `assignWorkers` still picks, so existing behavior holds. `resolveRoster` then runs in shadow mode per unit, and its pick, factors and rejections go to `SwarmResult.routes` and a "Routing" section of the plan report. No live seat state is passed yet. Session-percent headroom for the claude seat is a later step, because a gated-out seat would block where today it parks resumably.

## Council wiring in progress (session d7ac0afa, 2026-09-17)
Findings, so nothing is re-derived: council has no coder/reviewer role pair; every enabled seat drafts and reviews. Its one routing decision is the planner (`plannerOrder`/`choosePlanner`, council.ts:341-379, called at council.ts:1028). The coder/reviewer pair lives in `src/swarm-contest.ts:39-52` (assigned proposer plus reviewer). Plan: (1) new `src/route-council.ts`: shadow-route planner role over `seatRoster(seats)` candidates via `workerCandidate`; `CouncilResult.plannerRoute`; (2) contest: shadow-resolve roles [coder, reviewer independentFrom coder]; `SwarmUnitResult.route`; (3) `RunRecord.routing` in runs.ts (write + readRecord). No code written yet at 106k context.

Updated 2026-09-17 (session d7ac0afa, stopped at 150k context). UNCOMMITTED in the harness, on top of a7ff882d49:
- NEW `src/route-council.ts`: `RoleRoute`, `routePlanner(seats, chosen, pricing?, state?)` (role 'planner', no capability, TOKEN_EFFICIENT, candidates from `seatRoster` via `workerCandidate`), `routeContest(task, workers, seats, coder, reviewer, profile, pricing, state)` (coder pinned via `requiredRoster`, reviewer `independentFrom: ['coder']`, `fastest` = PAID_FASTEST).
- `src/council.ts`: imports; `RunOptions.pricing?`; `CouncilResult.plannerRoute?`; single-planner branch builds seatState from `dead` probes, calls `routePlanner` after the planner loop; `plannerRoute` spread into all three returns after `planSeat`. Council-vote planning (planMode 'council') gets no plannerRoute on purpose.
- `src/swarm-contest.ts`: computes `route` via `routeContest` once `chosen` exists; attached to success and review-fail results.
- `src/swarm.ts`: `SwarmUnitResult.route?: readonly RoleRoute[]`.
Evidence: `npx tsc -b packages/council/tool-council` exit 0. `npx vitest run packages/council/tool-council` 517/518; the one failure `seats.spec.ts > substitutes the CLI's own stdin token` passes 13/13 when rerun alone (load flake, untouched code). Unpriced metered seats still rank last (costFactor 0.3), so index.ts need not fetch pricing before the council.

## Council wiring DONE (session d7ac0afa, 2026-09-17)
Committed c4ac90ab97 in the harness, local only, not pushed. Adds `RunRecord.plannerRoute` (written in index.ts, validated in `readRecord`) and `tests/route-council.spec.ts` (9 tests; run-record test mocks homedir and DSH_BRAIN_DIR to scratch). Evidence: `tsc -b` exit 0; full council suite 34 files 527/527; lefthook staged lint passed. Unrelated pre-existing oxlint errors at index.ts:~2177-2200 (no-unnecessary-condition/assertion) exist at a7ff882d49 too. Not rebuilt into live DSH; not run in a live council. Step 0 below is done.

## Live rebuild (session b076174a, 2026-09-17 17:17)
- `npm run build:lib:host` at c4ac90ab97 exit 0; `packages/council/tool-council/lib/*.js` 17:17, 352533 bytes, 13 hits for routePlanner/routeContest/plannerRoute/routeSwarm. Profile junction dsh-tool-council points into the repo, so no link step.
- Old DSH (host 25168 from 2026-09-16 22:16) stopped; relaunched via `~/.dsh/launch-dsh.cmd` (Start-Process cmd /c). HTTP 200.
- BUG FOUND + FIXED: the gated flow dropped `plannerRoute`. The plan phase computes it, the approved full run skips planning, and only full runs are filed, so the filed record never carried it. Fix = commit bda0033b79 (local, not pushed): new flat setting `pendingPlanRoute` (JSON) written beside `pendingPlanText` at both plan-issue sites (main path + pipeline stage), cleared with the gate state at both retire sites, read back via new `parseHeldRoute` (runs.ts) when the approved run is filed. Tests +2 (route-council.spec "held planner route"), config.spec accepts the field. tsc -b 0; council suite 34 files 529/529; oxlint 0; lefthook pass.
- Rebuilt again (build:lib:host exit 0, 6 hits for pendingPlanRoute in lib) and restarted: host 26144 on 3080 (17:26:19), FCC 8082 pid 15204, openrouter 8080 pid 30596. Launcher cmd window is the user's running instance now.
- NOTE: default `planMode` is 'council' (live settings.yaml sets none), and plannerRoute is only computed for planMode 'single'. So a default live council run carries no plannerRoute by design.
- LIVE TEST (17:27, DSH session "Call the council tool once", browser pane http://127.0.0.1:3080): DSH agent called council with planMode single, query "In one sentence: should a CLI flag parser reject unknown flags or ignore them?". Plan issued (Kimi planner, estimate ~$0.00 metered). settings.yaml held: `pendingPlanId: 5de780cf-b94b-43f8-af85-65405df88e47`, `pendingPlanRoute: '{"roleId":"planner","chosen":"kimi","routerPick":"free-claude","policy":"TOKEN_EFFICIENT","rejections":[]}'` - the shadow route works live and disagrees with the chosen seat.
- HALF-DONE at 150k context stop: Approve was pressed (UI shows "approved Â· send a message to run it"); clicking the "Send â€œgoâ€ to run it" button did NOT start the run (after 570s no new file in `~/.dsh/council-runs/`, UI still waiting). Next: type "go" into the composer (textbox "Message the agent") and press Send message, then wait for the new `~/.dsh/council-runs/<id>.json` and check it carries `plannerRoute` equal to the held one above. Approval expires eventually (planExpired); if expired, re-run with planMode single.
- Swarm contest live run: NOT started.

## (b) live seat state - IN PROGRESS, UNCOMMITTED (session 5215a0c3, stopped 20:35 at 150k context)
- User decision 2026-09-17 ~20:15 (AskUserQuestion): when a seat is out of quota, REROUTE to another eligible seat; block only when no seat is left. (Not park, not block.)
- DSH relaunched by the user 20:10 from their window: host 17176 on 3080 HTTP 200, lib has renderUnitRoute; FCC 14024 on 8082, openrouter 28328 on 8080. Agent-opened launcher windows closed.
- Code written, UNCOMMITTED in the harness on top of ee758e9770 (`packages/council/tool-council/`):
  - `src/route-swarm.ts`: gating pulled out of routeSwarm into exported `gateRoster(roster, seats, pricing, state)`; new `isClaudeSubscriptionSeat(seat)` (cli, not free, no ANTHROPIC_BASE_URL, command claude); new `liveSeatState(seats, problems, sessionPercent)` (probe failure => available false + reason; subscription seat => quotaHeadroom = 1 - pct/100; router gates below 5%).
  - `src/swarm.ts`: `runSwarm` gates `fullRoster` first via gateRoster (so plan, contest contestants, reviewers and paid fallback all skip gated seats = reroute); `routing.gated` merges gate.gated with routeSwarm's.
  - `src/index.ts`: imports probeSeatLive, seatRoster, liveSeatState, SeatState; new closure `swarmSeatState(seats, overrides, apiKey, signal)` after statuslineSessionPercent (probes each swarm-enabled seat with probeSeatLive in parallel); `seatState: await swarmSeatState(...)` added at BOTH runSwarm calls (swarm tool ~1420, pipeline swarm stage ~1720).
  - Evidence: `npx tsc -b packages/council/tool-council` exit 0. Tests NOT written or run yet.
- NEXT: (1) tests in `tests/route-swarm.spec.ts`: gateRoster disables down/quota seats and records UNAVAILABLE/QUOTA_EXHAUSTED; liveSeatState (probe failure, subscription headroom, free-claude with base URL gets no headroom, no evidence => no entry); isClaudeSubscriptionSeat vs DEFAULT_SEATS claude/free-claude; a swarm test that a gated seat's unit goes to another seat and a contest excludes it. (2) full council suite (`npx vitest run packages/council/tool-council`, expect 529 + new), oxlint, commit locally (router work approved for local commits; no push). (3) rebuild live DSH + one live check that a probe-failed seat shows under "### Routing" as held out.
- DONE (session 3298bad6, 2026-09-17 ~20:45): committed 813279c2f5 (local, not pushed). Adds `heldOut` lines to runSwarm blocked reports (all seats gated / graph problems), tests: route-swarm.spec +8 (gateRoster, isClaudeSubscriptionSeat vs DEFAULT_SEATS, liveSeatState), swarm-profiles.spec +3 (reroute around held-out seat, block naming it, all held out). Evidence: council suite 34 files 540/540; `tsc -b` exit 0; oxlint clean on touched files except index.ts, whose 37 errors equal HEAD's count (pre-existing); lefthook pass. `build:lib:host` exit 0, lib 20:38 has 8 hits for gateRoster/liveSeatState/swarmSeatState. DSH restarted: host 32896 on 3080 (HTTP 200), FCC 7280 on 8082, openrouter 4612 on 8080.
- Live probe check (real probeSeatLive + real runSwarm plan phase, scratch script, no spend): all enabled DEFAULT_SEATS probe ok now; claude headroom 0.85 at 15%. A free CLI seat pointed at 127.0.0.1:1 with a unit pinned to it: state `unavailable (http://127.0.0.1:1 is not accepting connections (connect ECONNREFUSED 127.0.0.1:1))`, unit rerouted to `claude`, plan report `### Routing` / "- `dead` held out of this run: unavailable (...)". NOT exercised through the DSH UI (the index.ts `swarmSeatState` closure is covered by tsc only). Note: probeSeatLive probes only loopback backends and free seats; a missing binary or paid seat is never gated by probe.
- NEXT: optional UI check (swarm plan in DSH with a free seat whose proxy is down); then MIDPOINT benchmark (item 2 below) or (c) let the router decide.
- Caveat: probing adds up to 20s (LIVE_PROBE_TIMEOUT_MS) and one free token per free seat to every swarm call, plan phase included.

## Rebuild + contest rerun (session 5215a0c3, 2026-09-17 19:58, checkpoint at 101k context)
- `npm run build:lib:host` at ee758e9770 exit 0; lib has 2 hits for renderUnitRoute. DSH restarted: host 25940 on 3080 (19:46:34), FCC 14024 on 8082, openrouter 28328 on 8080; UI badge ee758e9.
- Contest rerun in DSH session "Call the swarm tool once" (Harness Build, Workspace Write, Swarm mode economy): plan issued 19:48:36 (pendingSwarmId 9071d80d, unit summarize-router-resolve on free-claude), Approve pressed by the user 19:48:48 (approvedSwarmId set, TTL 15 min, expires ~20:03:48).
- The DSH free-large agent then answered the task itself and on "go" replied again without calling swarm (the known "model does not know go runs the graph" gap). 19:57 sent: "The swarm graph is approved. Call the swarm tool now with the same query to run it." Waiting on it.
- swarmProfile is `economy` in settings.yaml now; restore to `user` after the run.
- RESULT 20:04: the nudge worked; the approved graph ran and approval 9071d80d retired 20:04:17. Run report (live, lib ee758e9770): "0 of 1 unit(s) reported. 1 failed." Unit summarize-router-resolve failed review ("escalation cap reached. ACCEPT: no"; reviewer said the candidate had a bash call but no file content). Decisive line: `Route: coder deepseek (router agrees); reviewer kimi (TOKEN_EFFICIENT router would pick ree-claude)`. So the contest route line is VERIFIED LIVE; the router disagrees on the reviewer.
- Side findings, not fixed: (1) economy contest ended with metered deepseek as coder (fallback after free candidates) and the free candidate lost the file read; (2) the DSH agent re-called swarm after the run and issued plan f535b545, which was discarded in the UI; (3) the model needs an explicit "call the swarm tool" after Approve, "go" alone did not run it.
- Cleanup verified: pendingSwarmId "", approvedSwarmId "", swarmProfile user, no .dsh-staging in Harness Build.
- NEXT: (b) live seat state. Open design decision first: should a seat gated out by quota park the run resumably (as a quota hold does) or block it.

## Swarm contest live run RESULT (session e12cd60e, released 18:25 at 150k context)
- Live economy contest ran and finished (DSH session "Call the swarm tool once", Harness Build; approval a331b619 retired 18:19:23). Report: "1 of 1 unit(s) reported", unit `summarize-resolve-ts` on free-claude, "Review: ACCEPT: yes". Plan report had no "### Routing" section: correct, since renderRouting (route-swarm.ts:189) prints only on disagreement or gating, and the router agreed on free-claude.
- GAP FOUND: contest `SwarmUnitResult.route` was computed but surfaced nowhere (not in runReport, not in SWARM_VALUE_SCHEMA, no swarm record file), so it could not be checked live.
- FIX committed ee758e9770 (local, not pushed): `renderUnitRoute` in swarm.ts adds one line per contested unit to the run report, e.g. `Route: coder \`free-a\` (router agrees); reviewer \`paid\` (TOKEN_EFFICIENT router would pick \`free-b\`)` (swarm-composition snapshot updated, real Loader path). Checks: council suite 34 files 529/529, `tsc -b` exit 0, lefthook lint pass.
- NOT rebuilt into live DSH (still bda0033b79 lib). Contest route line NOT yet seen live.
- Cleanup done: swarmProfile restored to `user` (settings.yaml verified). Workspace root is `~\Documents\Harness Build` (not the harness repo); no `.dsh-staging` created. That DSH session's access is Workspace Write.
- Note: DSH agent (free-large tier) re-called swarm after the run finished; it was stopped. The model does not know "go" alone runs the approved graph.
- NEXT: rebuild live DSH (`npm run build:lib:host`, restart via `~/.dsh/launch-dsh.cmd`), rerun one tiny economy contest (set Swarm mode economy in composer dock, access Workspace Write, Approve, send "go"; free seats took ~8 min), confirm the Route line, restore swarmProfile user. Then (b) live seat state.

## Swarm contest live run (session e12cd60e, 2026-09-17 18:20, superseded by RESULT above)
- Council live test PASSED (see claim line above).
- Contest needs `swarmProfile` economy or fastest (live was `user`, so no contest). Set in the DSH composer dock: Swarm toggle, then "Swarm mode" select (SwarmRoster.tsx, namespace council). Profile economy = free contestants, paid review.
- Workspace: new session in Harness Build. With fileRoots set, the contest stages proposals under `<workspaceRoot>/.dsh-staging` (index.ts:786) and needs workspace-write approved plus "go". `.dsh-staging` is NOT gitignored in the harness: delete it after the test.
- Check after the run: `route` on unit results and the "Routing" plan-report section. Then restore `swarmProfile: user`.

## Next action
NEXT FIRST (user instruction 2026-09-17): rebuild the live DSH from harness c4ac90ab97 so the running DSH carries the router wiring (swarm routes a7ff882d49 + council planner/contest routes c4ac90ab97), then test it live right away: one council run (check `plannerRoute` in the filed record under `~/.dsh/council-runs/<id>.json`) and one swarm contest run (check `route` on unit results and the "Routing" plan-report section). Quote the decisive output. Only after that, move to (b) live seat state. Rebuild procedure: see `dsh-harness-gotchas.md` and `project_dsh_profile_plugin_install.md`.
0. DONE c4ac90ab97. Was: finish the council wiring (remaining, in order):
   - `src/runs.ts`: add `RunRecord.plannerRoute?: RoleRoute` (import type from route-council), write it in index.ts:1268 `stored` from `result.plannerRoute`, and read it back in `readRecord` (validate roleId/policy strings, rejections array).
   - `tests/route-council.spec.ts`: routePlanner disagreement (metered chosen, free router pick), dead seat rejected UNAVAILABLE; routeContest reviewer never equals coder (NOT_INDEPENDENT), coder pinned (NOT_IN_ROSTER for others), fastest = PAID_FASTEST. Fixture style: `tests/route-swarm.spec.ts`.
   - Optional: planner line in report when routerPick !== chosen (mirror `renderRouting`).
   - Then full council suite, `tsc -b`, oxlint, commit locally (router work is already user-approved for local commits; no push).
1. Wire the router into its first callers - the user said go at 14:35, and this session stopped at 229k context without starting it, so a fresh session picks it up. Plan, so nothing is re-derived:
   - Read `packages/council/tool-council/src/roster.ts` (`assignWorkers`, `defaultRoster`, `seatRoster`, `Worker`, `WorkKind`) and `src/swarm.ts`. The swarm assigns a `Worker` per `SubTask` today; the wiring maps each `SubTask` to a `RoleRequirement` (kind and `inferKind` give the capabilities) and each enabled `Worker` plus its seat state to a `Candidate`, then calls `resolveRoster`.
   - Seat state for `Candidate`: `src/seats.ts` for the configured seats, `src/quota-hold.ts` for parked seats (`available: false` plus the reason, or `quotaHeadroom`), `src/execution-cost.ts` for `costClass` and pricing, `src/capacity.ts` and `src/budget.ts` for the budget figures.
   - Council side: `src/select.ts` and `src/council.ts` choose the seats for a round; the same mapping applies, with the reviewer role carrying `independentFrom: ['coder']`.
   - Keep the existing behavior the brain note lists: economy keeps review paid, stage rosters are verified before spend, quota holds stay resumable.
   - Write the resolution's rejections and factors into the run record, which is what makes a route explainable afterwards.
   - Tests live beside `tests/router.spec.ts`; the existing `tests/roster.spec.ts` shows the fixtures style for workers and tasks.
2. MIDPOINT benchmark AFTER that wiring, not now - the user's decision on 2026-09-17. Same 4 CORE cases, about 1M tokens and $1.85.
3. A second measurement once the local LLM is live on vmixer, which is also when `machines.md` gets its measured throughput.
4. When the user says the session is ending, hand these repos to git-gatekeeper: brain (0fcb827, e0a85b0 and the notes since) and harness (07d17746f6..813279c2f5).

## Staged files (nothing applied to the live brain)
`~/Documents/claudecode/token-benchmark/task01-staging/`: RECONCILIATION.md (classification table for all 15 proposed docs, the 5 decisions, apply plan), dsh-target-architecture.md, dsh-runtime-routing.md, dsh-user-profiles.md, dsh-platform-completion.md, machines.md, rules/efficiency.md, rules/efficiency-review-1-110-status.md, patches/existing-notes.md. Every wiki link resolves.

## Applied (2026-09-17, user approved)
The staged state is live in the brain: 5 new top-level notes, `rules/efficiency.md` and `rules/efficiency-review-1-110-status.md`, appends to project_agent_project_manager, project_dsh_team_platform and shared-memory-protocol, and 7 MEMORY.md index lines. `node .sync/selftest.mjs` 220/220. Every wiki link in the new notes resolves. brain-sync auto-committed it as 0fcb827 and e0a85b0. Not pushed.

## Do not repeat
- Do not re-run BEFORE.
- Do not run the B01-B12 suite.
- Do not create fixtures.
- Do not push anything in the brain without explicit user approval after review.
