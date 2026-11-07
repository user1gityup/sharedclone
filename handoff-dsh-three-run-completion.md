---
name: handoff-dsh-three-run-completion
description: 2026-09-15 open — four agents finished forensics and completion plans for the three broken DSH council runs; step-by-step decision work moves to a new session, nothing applied yet
metadata:
  type: project
---

# Handoff: completing the three broken DSH council runs

**Status:** open, BLOCKED ON A BRANCH DIVERGENCE the user has authorised
resolving. All five council fixes are committed locally; nothing is queued or
pushed because local and origin have split.

**Refreshed:** 2026-09-16 by Claude Opus 5, session
`5e3a08cb-ce12-458e-933c-90c660233ca9`, host `ndi2`, repo
`~/Documents/claudecode/deepseek-harness`, branch `feat/heterogeneous-teammates`,
no worktree. Stopped at the 184k-token FINISH-NOW quota trigger (week 100%),
so the authorised reconcile was NOT started.

**Exact next action - AUTHORISED, do not re-ask.** The user said, verbatim,
"yes do what will resolve it fastest route" in answer to reconciling the
divergence below. The user also asked to go **step by step, waiting for their
response before each next thing** - so do one step, report, wait.

1. Read origin's two commits in full: `git show d962843bd5` and
   `git show 56fc59878d`. Report whether `d962843bd5`'s `runs.ts` (+70) already
   does P2 (read back `terminalState`/`quorumConfig`/`promptMetrics`/
   `schemaVersion` in `readRecord()`), and what it changed in `index.ts`,
   `seats.ts`, `pipeline.ts`, `errors.ts`, `council.ts`. Wait.
2. Fastest route (the recommendation already given): `git rebase
   origin/feat/heterogeneous-teammates`, DROPPING local `78ceb34996` (a
   near-duplicate of origin's `56fc59878d`; the two differ by 2 lines, one in
   `packages/llm/llm-codex-cli/src/index.ts`, one in `tests/codex-cli.spec.ts` -
   check those 2 lines and keep origin's unless local's is a fix). Resolve
   conflicts in `index.ts` / `seats.ts` against `d962843bd5`. Wait.
3. `npx tsc -b tsconfig.host.json`, `npx tsc -b tsconfig.client.json`,
   `npx vitest run packages/council/tool-council packages/client/ui-council-budget packages/llm/llm-codex-cli`,
   then `npm run build:lib:host` (deploys live via junction). Wait.
4. Queue: `node "~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/queue-build.mjs" "~/Documents/claudecode/deepseek-harness" "<model>" "<checks run>"`
   and read the JSON receipt under `outputs/gatekeeper/state` before reporting.
   The user asked for "push to gatekeeper" = this queue, not a direct push.

**Step 1 DONE 2026-09-16, Claude Opus 5 (new session fb96d68c, host ndi2, claimed ownership; state re-verified: 2/5, tree clean).**
- `d962843bd5` council `src` is byte-identical to local `983701c5b3` (`git diff d962843bd5 983701c5b3 -- packages/council/tool-council/src` empty): same WIP pushed twice. Rebase should drop most of `983701c5b3` as already applied; real overlap left = `bin/agy-profile.mjs` + tests (local only) and `ui-council-budget` (origin also touched it, local `f8ec229c74` too).
- `runs.ts` +70 is types only (`RunTerminalState`, `QuorumConfig`, `PromptMetric`, optional record fields). `readRecord()` does NOT read them back: P2 still open.
- `78ceb34996` vs `56fc59878d`: 2 lines, both lint parens only (`source =>` vs `(source) =>`, `resolve =>` vs `(resolve) =>`). Keep origin's; nothing to salvage. Waiting for user go on step 2.

**Step 2 DONE 2026-09-16, Claude Opus 5 (session fb96d68c).** Backup branch `backup/pre-rebase-2026-09-16` = old HEAD `78ceb34996`. `git reset --keep f8ec229c74` dropped the duplicate, then `git rebase origin/feat/heterogeneous-teammates`, exit 0. One conflict, `CouncilBudget.tsx`, indentation only (identical code), resolved with local side. Result: ahead 4, behind 0. New commits: `41373aee06` (now only `bin/agy-profile.mjs` + its test; council src already in origin), `78c57f5973` economy free, `584bf2a3ac` P1/P3/restart/probe, `3e1a67da2e` ui-council-budget (now 1 file, reindent). `git diff backup/pre-rebase-2026-09-16 HEAD` = only the 2 origin paren lines in `llm-codex-cli`: no work lost. Not yet built/tested (step 3). Not queued, not pushed.

**Step 3 DONE 2026-09-16 10:33, Claude Opus 5 (session d076c585, host ndi2, claimed ownership; state re-verified: tree clean, ahead 4 behind 0, HEAD `3e1a67da2e`).** `tsc -b tsconfig.host.json` 0, `tsc -b tsconfig.client.json` 0, `vitest run` council + ui-council-budget + llm-codex-cli: 38 files, **518 passed**, exit 0. `npm run build:lib:host` exit 0; `tool-council/lib/index.js` 10:33:23 contains `councilDecided`/`probeSeatLive`/`resolveVote` (3 each), `requires an enabled paid reviewer` 0 = live. Next = step 4 queue, awaiting user go. Not queued, not pushed.

**Step 4 QUEUED 2026-09-16 11:07, Claude Opus 5 (session d076c585).** `queue-build.mjs` exit 0, `{queued:true, head:3e1a67da2e}`; entry in `push-requests.md` filed 18:07:37Z, Status open. User-operated PowerShell `Gatekeeper.ps1` is running (hidden window), so no agent push. No receipt for this request yet. Next = user approves in the gatekeeper; then read the receipt under `outputs/gatekeeper/state` and close this handoff.

**The divergence, verified 2026-09-16 after a fresh `git fetch`.**
`git rev-list --left-right --count origin/feat/heterogeneous-teammates...HEAD`
= `2 5`. Queue helper refused: `Expected locally recorded upstream to be behind
HEAD, without divergence`.

- Origin only: `56fc59878d feat(llm): add Codex headless provider`,
  `d962843bd5 fix(council): make interrupted runs recoverable` (pushed earlier
  from another machine or Codex; `56fc598` is the "harness staging" commit named
  in `handoff-distributed-dsh-runs.md`).
- Local only, oldest first: `983701c5b3` (restore point), `70ac8b0319`
  (economy free), `05e1d64ed6` (P1, P3, restart reset, live probe),
  `f8ec229c74` (ui-council-budget provider grouping + pipeline gate view),
  `78ceb34996` (Codex CLI package - duplicate of origin's).
- `d962843bd5` touches the same council files as `05e1d64ed6`:
  `runs.ts` +70, `seats.ts` +33, `pipeline.ts` +22, `index.ts` +15,
  `council.ts` +16, `errors.ts` +1. Conflicts expected in `index.ts`, `seats.ts`.

Working tree clean. Nothing merged, rebased, queued or pushed. Only `git fetch`
(read-only) was run against origin.

- Handoff id: `dsh-three-run-completion-2026-09-15`
- Written: 2026-09-15, host `ndi2`, session `554a88ca-9527-4297-be96-bd5029317806`
- Model: Claude Opus 5
- Owner: claimed 2026-09-15 by Claude Opus 5, session 5e3a08cb-ce12-458e-933c-90c660233ca9 (host ndi2), taking over from session f5d24e42-a71e-48a2-b32e-6c6adb1726d9. State at claim matched the note: HEAD 70ac8b0319, both commits present, the unstaged set decision 1 left behind, deployed lib dated 2026-09-13 15:00.
- Repository in scope: `~/Documents/claudecode/deepseek-harness`, branch
  `feat/heterogeneous-teammates`, HEAD `70ac8b0319` (the (b)-(e) work sits on
  top of it, uncommitted)

## The ask

The last three DSH council runs could not complete because of DSH infrastructure
faults. Four subagents were run: agents 1-3 each took one run and carried its
prompt to completion using the council's surviving drafts and reviews; agent 4 did
forensics across all three, to stop recursive loops and stop runs from being
unable to complete.

All four finished phase 1 (research and proposal). **Phase 2 — applying anything —
has not started and needs the user's answers first.**

## Evidence bundle

Full transcripts and all four deliverables are preserved beside this note in
`handoff-dsh-three-run-completion/`:

| File | What it is |
|---|---|
| `agent1-deliverable.md` | consolidated architecture + task graph for the standalone project-management platform (run `9d32f748`) |
| `agent2-deliverable.md` | adjudicated granular-agent-permissions design, full code, three-wave DAG, preset variants (run `9df149a7`) |
| `agent3-deliverable.md` | verified root causes + patch plan for council-run reliability (run `df3b49eb`, using `059ae26b` as source) |
| `agent4-forensics.md` | per-run cause, recurring causes, recursive-loop inventory, prioritized proposals |
| `9d32f748-*.md`, `9df149a7-*.md`, `df3b49eb-*.md`, `059ae26b-*.md` | extracted run transcripts: prompt, plan, every seat draft, every review |

Raw run records remain at `~/.dsh/council-runs/<id>.json`.

## The three runs

| Run | When | Drafts | Why it did not complete |
|---|---|---|---|
| `9d32f748-2bc2-4737-a2e1-44164e6e2491` | 09-15 05:13Z | 2/4 | free-claude died on `HTTP 402 SAMBANOVA PAYMENT_METHOD_REQUIRED`; openrouter-free never called, `ECONNREFUSED 127.0.0.1:8080`. `minDrafts: 2` is absolute, so half a dead roster still read `completed`. Never passed the council gate; build repository path still pending |
| `9df149a7-f7fc-4bc2-966c-e9e7e27210a2` | 09-14 18:14Z | 5/8 | vote recorded as a 2/2/1 split with no winner. Actually a parser bug (below). `claude` seat OAuth expired; `agy-flash` never signed in; agy compaction omitted 28,856 characters of the spec |
| `df3b49eb-fd27-4496-989b-e902a02bcf7d` | 09-13 09:14Z | **0/7** | whole run aborted at ~3.9s, six seats on one signal spelled two ways (`aborted`, raw `{"kind":"user"}`). DSH filed it as a run anyway and pushed the line to the brain |

## Verified findings (checked against source, not against seat claims)

- **`index.ts:1862`** — `complete: council.phase === 'full' && ...`, while
  `council.ts:1015-1035` returns `phase: 'full'` together with
  `terminalState: 'failed'`. A council where every seat died returns
  `complete: true` and the pipeline **advances to the swarm**. Worst line in the
  system.
- **Vote-parser substring bug** — `council.ts:428-432`,
  `claimed.includes(seat.id)` matches `'claude'` inside `'free-claude'`. In run
  `9df149a7` two seats wrote "Free Claude" in prose and both were recorded as
  voting for `claude`, a seat whose entire draft is a 72-character OAuth error.
  Peer score 1.92, so it **won**, and `answer` became that error string.
  `:1092` uses `drafts.find`, not `usable`. Found independently by agent 2 and
  agent 4.
- **`runs.ts readRecord()`** strips `terminalState`, `quorumConfig`,
  `promptMetrics` and `schemaVersion` on load. The honesty fix is write-only.
  The amend path rebuilds from that stripped object and saves over the same id,
  so **amending a schema-2 run downgrades it to schema 1**. Run `9df149a7`
  already has `amendments: 1`.
- **Preflight exists and is wasted** — `probeSeat` at `seats.ts:874`, called from
  `council.ts:814`, caught the dead 8080 in all three runs (`ms 0`). It is not a
  gate, is never persisted, and tests a socket rather than a seat: expired OAuth,
  never-signed-in agy seats and the SambaNova 402 all pass as healthy.
- **Live state as of 2026-09-15 16:xx** — `netstat` shows 8082 listening and
  **nothing on 8080**, while `settings.yaml:125` still has `openrouter-free`
  enabled. The next run repeats the same failure.
- **Deployed artifact is a symlink into the repo**
  (`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-council`), so the
  **uncommitted** working-tree fixes are live in production.
- **Uncommitted work at risk** — 665 insertions across 25 files on
  `feat/heterogeneous-teammates`, GPT-5.6-Sol's earlier reliability work,
  496 tests passing, never committed. `handoff-dsh-pipeline-approval.md` marks
  that work `complete`; that status is now stale.

### Recursive loops

| Loop | Where | Bound |
|---|---|---|
| L1 quota hold re-runs the same stage | `pipeline.ts:349-372` | **none**; `EXHAUSTED` matches `/rate limit/i`, which a free proxy emits constantly |
| L2 review → rework → swarm → review | `pipeline.ts:399`, `index.ts:1863` | **none**, and every cycle spends |
| L3 journal re-entry | `index.ts:1103` | age only; failures re-ask for 24h |
| L5 pipeline restart | `index.ts:1520` | **none**, and `restart: true` is model-callable — run `39e8f161` is literally a saved request to do it |
| L4 amendment | `MAX_AMENDMENTS = 3` | correct — the one done right |
| L6 re-plan on reworded query | `index.ts:1044` | bounded by `heldUnapproved` |

Composite reachable today: restart → hold → hold → rework → rework, spending on
every arc, counting nothing.

### Fabricated council claims — do not carry forward

- run `059ae26b`, kimi: invented TypeScript types and an `agentapi` inspection
- run `059ae26b`, deepseek: invented evidence [16]-[18] about a loopback gRPC prompt body
- run `9df149a7`, free-claude: `packages/agent/*` — no such directory exists
- run `9df149a7`, agy-flash-lite: fabricated a unanimous 5-0 tally naming five
  models that never voted, in a run where three seats hard-failed
- run `9d32f748`, deepseek: claimed the evidence was King County budget documents

## Prioritized fix order (agent 4)

P1 gate the pipeline stage on `terminalState === 'completed'` (one line,
`index.ts:1862`) · P2 read back what is written, never save-as-complete · P3 fix
vote resolution: resolve against candidates, longest-id-wins, winner from
`usable` · P4 layered `seatHealth()` blocking at the gate · P5
holds/reworks/restarts counters with progress-reset · P6 `classifyFailure()` in
`errors.ts` · P7 populate `promptMetrics`, mark compacted drafts degraded ·
P8 proportional quorum · P9 fix or disable the 8080 seat.

## Decisions ANSWERED this session (2026-09-15, Claude Opus 5)

The user asked for the first question again in plain terms before answering it;
the confusion was what the uncommitted code actually was. Recorded here so the
next session does not re-ask.

**1. Baseline — ANSWERED: commit council files only.**
Done. Commit `983701c5b3` on `feat/heterogeneous-teammates`,
`feat(council): record explicit run terminal state and quorum config`, 15 files
under `packages/council/tool-council`. Lefthook pre-commit passed (lint 22.6s,
whitespace, vendor manifest guard). Tests before commit:
`npx vitest run packages/council/tool-council` — **30 files, 448 passed, exit 0**.
The handoff's earlier figure of 496 tests was wrong; 448 is the measured count.
Left deliberately unstaged: `packages/client/ui-council-budget` (7 files, budget
panel), and the `llm-codex-cli` wiring (`tsconfig.host.json`,
`packages/bundle/base/cordis.patch.yml`, `packages/bundle/base/package.json`,
untracked `packages/llm/llm-codex-cli/`). **Not pushed.**

**2. Preflight — ANSWERED: yes, one-token probe, free seats only.**
Real one-token request against free/proxy seats (`free-claude`,
`openrouter-free`, `agy-*`); socket-only for paid seats. Not built yet. Extends
`probeSeat` at `seats.ts:874`, called from `council.ts:814`.

**3. Restart gate — ANSWERED: reset the approval clock on restart.**
Implement what `index.ts:84-85` already documents: set `lastUserTurnAt = 0` when
`restart` runs. Verified this session: `lastUserTurnAt` is assigned in exactly one
place, `index.ts:796` on a user turn, and **never reset**, so a model-triggered
restart inherits the approval given to the run it just destroyed. `restart` also
calls `discardJournal()` at `index.ts:1634`, throwing away paid seat answers.
No counter and no schema removal — the existing two-factor gate is the mechanism.
Not built yet.

**4. Build repository path — ANSWERED by the user, verbatim:**
> "it will live within its own folder within the shared brain within the repo"

So the agent-project-manager platform is built in its own folder **inside
`~/.claude/shared-brain/`**, which is itself the private git repo
`user1gityup/shared-brain`. Exact folder name not yet confirmed. Nothing created
yet. Note that the brain is mirrored one-way to `sharedclone` and its `MEMORY.md`
is injected into every session by `~/.claude/hooks/dsh-memory-index.mjs`; the
next session should confirm the folder name and keep build output
(`node_modules`, dist) out of the repo before creating anything. A path alone
still does not authorise starting the DSH preset run — the saved spec requires
separate explicit execution authorisation.

**5. Economy mode contradiction — ANSWERED and BUILT.** The user said:
"eliminate the paid requirement economy can just be completely free".
Commit `70ac8b0319`, `feat(council): economy mode runs completely free`.
`runUnitContest` now prefers a paid reviewer when one is enabled and uses a free
seat when none is, choosing a reviewer that is not the seat whose candidate it
judges; the `validateGraph` preflight in `swarm.ts` requires only a
review-capable seat for economy, while `fastest` still requires a paid one; the
escalation fallback prefers paid and otherwise uses another free seat; the report
label "Paid review:" became "Review:" because it was no longer true. Verified:
`vitest run packages/council/tool-council` — 30 files, **450 passed**, exit 0
(two new tests: a fully free economy run, and `fastest` still blocking without a
paid reviewer); `tsc -b tsconfig.host.json` exit 0; lefthook pre-commit passed.

**CORRECTION to an earlier finding in this note.** "Deployed artifact is a
symlink into the repo, so the uncommitted working-tree fixes are live in
production" is **wrong**. The package's `exports`/`main` point at
`lib/index.js`, not `src`. That file is dated **2026-09-13 15:00**: it contains
`minDrafts` (6 hits) but **not** `awaiting_resume`, so it is an older partial
build, behind the working tree. It still contains
`requires an enabled paid reviewer` (2 hits). Nothing committed this session is
live. Making it live needs `npm run build:lib:host` (tsdown), which is a build
and was **not** authorised, so it was not run.

**Old text of decision 5, for reference:****
The saved run policy says free-only with no paid fallback, but
`swarm-contest.ts:39` requires an enabled paid reviewer and `:41` requires two
free seats per unit. The user must name a paid seat or drop economy.

## Open decisions — ask ONE AT A TIME

The user's standing rule `feedback_step_by_step_one_at_a_time.md` applies: give
step 1 only, wait for the answer, then step 2. Recommendations in brackets.

Blocking, in this order:

1. Baseline — commit the 665 uncommitted council insertions as a restore point
   first, or work from the tree as-is? [commit, scoped to council files, leaving
   the unrelated model-picker hunks unstaged]
2. May a free seat be pinged with one token before a run? Only thing that catches
   the 402. [yes — not built, and won't be without a yes]
3. Should `restart` require a user turn, like plan approval does? [yes]
4. Build repository path for the project-management platform — still the blocker
   on agent 1's work. [new local `~/Documents/claudecode/agent-project-manager`,
   git-init, no remote until phase 1 passes its gate]
5. Economy mode contradiction — the saved run policy says free-only with no paid
   fallback, but `swarm-contest.ts:39` requires an enabled paid reviewer and
   `:41` requires two free seats per unit. Name a paid seat or drop economy.

Then, per agent, the remaining questions are at the end of each deliverable:
agent 1 §(c) items 2-3 and 6-10, agent 2 §(c) items 1-7, agent 3 §7 items 1-10,
agent 4 items 2-3 and 6-7.


## Commits made 2026-09-15/16 by Claude Opus 5 (session 5e3a08cb)

After the (a)-(e) work below, the user said "push to gatekeeper". Committed:

- `05e1d64ed6 fix(council): stop a failed council from deciding anything` -
  the five files of (b)-(e). Lefthook passed.
- The queue helper then refused a dirty tree (the unstaged WIP from decision 1).
  User answered "fix the tree first". Verified that WIP: `tsc -b
  tsconfig.client.json` exit 0, `vitest run packages/llm/llm-codex-cli
  packages/client/ui-council-budget` 8 files 56 passed. Lefthook's lint
  re-indented `CouncilBudget.tsx` (whitespace only) and failed the first commit
  attempt; a second attempt accidentally swept both bodies into one commit,
  which was soft-reset (never pushed) and split into:
  - `f8ec229c74 feat(ui-council-budget): group seats by provider and give the pipeline gate a view` (7 files)
  - `78ceb34996 feat(llm): add the Codex CLI model provider` (10 files)
- Final verification on the committed state: `tsc -b tsconfig.host.json` 0,
  `tsc -b tsconfig.client.json` 0, `vitest run packages/council/tool-council
  packages/client/ui-council-budget packages/llm/llm-codex-cli` 38 files,
  **518 passed**, exit 0.
- Brain notes need no queue: `brain-sync` auto-commits and pushes
  (`7dadaf0`, 0 ahead of upstream at the time).

## Subagent question - answered, nothing spawned

User asked whether subagents could finish the remaining run work in parallel.
Answer given: yes for P2, P6, P7, P8 and agent 2's permissions design, each in
its own worktree (a build in the shared tree deploys straight into DSH through
the junction); no for P5 (same files as this work - serialize), P9 (a one-line
`settings.yaml` decision for the user), and agent 1's platform (needs a folder
name, and the brain auto-pushes, so node_modules must be kept out first).
Week quota is 100%, so subagents are faster, not cheaper. The user then asked
to go step by step; no subagent was started.


## Work done 2026-09-15 by Claude Opus 5 (session 5e3a08cb)

The user answered the five-item next-action list with **"do them in order"**, so
all of (a)-(e) were taken.

**(a) Build - DONE, and it corrected two findings in this note.**
`npm run build:lib:host` exit 0 (run twice: once for the two existing commits,
once after (b)-(e)). `packages/council/tool-council/lib/index.js` went from
2026-09-13 15:00 to 2026-09-15 19:02.

- The deployed package IS a junction after all, but to the *package*, not to
  `src`: `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-council` is a
  Windows junction to `apps/cli/node_modules/.../dsh-tool-council`, itself a
  junction to `packages/council/tool-council`. `exports` points at `lib/`, so
  **a build is what deploys, and it deploys instantly.**
- The previous session's staleness marker was wrong: `awaiting_resume` appears
  in `runs.ts` only in a comment and a union type, so it can never reach a
  bundle. The usable marker is `requires an enabled paid reviewer`, which was
  2 hits before the build and is 0 now - commit `70ac8b0319` is live.

**(b) P1 pipeline gate - DONE.** New exported `councilDecided()` in
`src/index.ts` (`phase === 'full' && terminalState === 'completed'`), used for
`complete`, for `rework`, and for the BLOCKED problem, all three of which read
`council.phase === 'full'` before. The stage now also reports a problem naming
the terminal state when a council reaches `full` without deciding, instead of
silently handing a dead roster's answer to the swarm. `problems` became one
built array because two spread branches can now produce it. Not changed: the
approval-retirement block just above, which still keys on `phase`.

**(c) P3 vote resolution - DONE.** `parseReview` in `src/council.ts` no longer
takes the first roster seat whose id is a substring. New private `resolveVote()`
plus `better()`: an exact VOTE line wins outright, then the longest matching id
or name, then position; the prose fallback leads on earliest mention and uses
length only to separate overlapping matches. New private `candidates()` narrows
the roster to seats that actually produced a usable draft (falling back to the
full roster if none did), and all three `parseReview` call sites now pass it.
The winner is taken from `usable`, not `drafts`, so a vote resolved onto a
failed seat can no longer make that seat's error string the council's answer.

**(d) Restart resets the approval clock - DONE.** One line plus comment in
`src/index.ts`, inside `if (!running || args.restart === true)`:
`if (args.restart === true) lastUserTurnAt = 0`. Placed before the settings
update and before any stage runs; the `councilApproved` / `swarmApproved` /
`proposeApproved` closures read the module variable at call time, so they see
the reset. `judgeApproval` then fails on `state.lastUserTurnAt <= approvedAt`
("approved - now send a message to run it"), which is the intended gate.
**Untested** - `lastUserTurnAt` is module-private with no seam; the reset is
verified by reading, not by a test.

**(e) Free-seat live probe - DONE.** `src/seats.ts` gains `probeSeatLive()`
(exported), `LIVE_PROBE_TIMEOUT_MS = 20_000`, `PROBE_TOLERATED_STATUS`
(400/404/422), `liveProbeTarget()`, `probeBodyOpenAi()`, `probeBodyAnthropic()`.
It runs the existing socket `probeSeat` first and returns early on a dead
socket, then, for `free: true` seats only, sends one real `max_tokens: 1`
request: to `baseUrl ?? OPENROUTER_URL` for `openrouter` transport, and to
ANTHROPIC_BASE_URL + `/v1/messages` for a CLI seat routed through a local proxy
(which is how `free-claude` is caught without spawning the CLI). 400/404/422 are
tolerated because they judge the probe's own shape, not the seat. Both
`probeSeat` call sites in `council.ts` now call
`probeSeatLive(seat, options.apiKey, options.signal)`.
**Not covered:** the `agy-*` free seats, which are node scripts with no HTTP
endpoint of their own; a never-signed-in agy seat still passes preflight.

**Verification (all re-run after the last edit).**

- `npx tsc -b tsconfig.host.json` - exit 0.
- `npx vitest run packages/council/tool-council` - 30 files, **462 passed**,
  exit 0. Baseline was 450, so +12 new tests.
- New tests: `tests/council.spec.ts` gains four `parseReview` cases (free-claude
  is not claude, the shorter id still resolves, an exact vote line beats a
  longer id mentioned inside it, votes only resolve onto the seats given) and a
  `councilDecided` describe block; `tests/reachability.spec.ts` gains a
  `live seat probe` describe block with a stub HTTP endpoint (402 caught with
  its body, 200 passes, 404 tolerated, a paid seat gets zero requests, an
  OpenRouter-shaped free seat is probed at its own base url, a dead socket is
  still answered in under 1500ms without a fetch).
- Rebuilt lib contains `councilDecided`, `probeSeatLive`, `resolveVote` and the
  new problem string, so **all four fixes are live in DSH now**.

**Uncommitted after this session** (nothing committed, nothing pushed):

- `packages/council/tool-council/src/index.ts`, `src/council.ts`, `src/seats.ts`
- `packages/council/tool-council/tests/council.spec.ts`,
  `tests/reachability.spec.ts`
- plus the pre-existing unstaged set from decision 1 (7 files under
  `packages/client/ui-council-budget`, `tsconfig.host.json`,
  `packages/bundle/base/cordis.patch.yml`, `packages/bundle/base/package.json`,
  untracked `packages/llm/llm-codex-cli/`)
- `packages/council/tool-council/lib/` is build output and is not tracked.

## Constraints that carry over

- As of 2026-09-16: five local commits (see the divergence above), all
  unpushed and unqueued; P1, P3, decision 2 and decision 3 are committed in
  `05e1d64ed6` and live. Still true: no `settings.yaml` change, no preset
  saved, no push and no queue entry, no spend, no DSH run launched. Decision 4
  (the build repository path inside the shared brain) is still an answer only:
  no folder created.
- Weekly quota hit 100% during this session; the quota-handoff hook fired.
- Push rules unchanged: commit locally, queue, only `git-gatekeeper` pushes.

## Do not repeat

- Do not re-extract the run transcripts; they are in the bundle folder.
- Do not re-ask decisions 1-4; they are answered above.
- Do not trust the "496 tests" figure. Measured: 448, then 450 after commit
  `70ac8b0319`, then **462** after this session's fixes.
- Do not re-do (a)-(e); they are built, committed, tested and live.
- Do not re-ask how to reconcile the divergence; the user authorised the
  fastest route. Do not queue before the rebase: the helper will refuse again.
- Do not commit `packages/llm/llm-codex-cli` a second time; origin has it. Do not re-derive the
  deployment mechanism - it is a junction chain to the package, serving `lib/`,
  so `npm run build:lib:host` deploys immediately.
- Do not use `awaiting_resume` as a build-staleness marker; it is comment and
  type only and never reaches a bundle.
- Do not re-derive the root causes from the seat drafts — the drafts are
  unreliable (see fabricated claims). Verify against source at the file:line
  references above.
- Do not propose rebuilding items 1, 2 and 4 of the reliability prompt; agent 3
  verified those are already implemented and live.

Related: [[dsh-harness-gotchas]], [[dsh-council-plugin]], [[dsh-pipeline-chain]],
[[handoff-dsh-pipeline-approval]], [[project_agent_project_manager]],
[[dsh-runs]], [[feedback_step_by_step_one_at_a_time]],
[[quota-handoff-protocol]]
