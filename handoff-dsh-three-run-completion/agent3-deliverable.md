# Agent 3 (Claude Opus 5) — DSH council reliability: verified diagnosis and patch plan

Phase 1, planning only. No repository file was written, edited, built, or committed.

- Repo: `~\Documents\claudecode\deepseek-harness`, branch `feat/heterogeneous-teammates`, HEAD `4e5f8a42f4`
- Working tree: **665 insertions across 25 files, uncommitted**, produced by GPT-5.6-Sol under `handoff-dsh-pipeline-approval.md` (status `complete`, 496 tests / typechecks / builds all exit 0)
- Assigned run `df3b49eb` produced zero usable output; source council work taken from run `059ae26b` (4/8 drafts, 8 reviews)

## 0. What the council actually decided, and what in it is not evidence

Review tally from `059ae26b`: **free-claude 3 votes** (from free-claude 0.9, deepseek 0.95, openrouter-free 0.78), kimi 1 self-vote 0.85, openai + 3 agy seats errored to `vote=undefined`. So the winning draft is free-claude's seven-work-package plan. Its content is identical to the pre-round PLAN block — it is a plan document, not an implementation.

Two council claims are **fabricated and must not be carried forward**:

- **kimi's "core files"** (transcript lines 279–553) are invented TypeScript. There is no `SeatConfig.cliArgs`, no `PromptBudgetConfig`, no `DEFAULT_SEATS` array of that shape, no `CouncilRound`/`CouncilRoundResult` in the real tree. Its "PowerShell inspection output" of `language_server.exe agentapi` (`Unknown command: --help`, `error: unknown flag --stdin`) is a hallucinated terminal session — the openrouter-free review caught this ("fabricates inspection outputs").
- **deepseek's evidence [16]–[18]** claiming the Antigravity language server takes prompts over loopback Connect/gRPC bodies. The kimi and openrouter-free reviews both reject it. The real driver does pass the prompt on argv (see RC-1).

What survives as genuine council product is the **10-item confirmed-root-cause list** (transcript line 553) and the seven-work-package structure. Every one of the 10 is re-verified below against the real tree.

## 1. Verified root causes (file:line against the working tree)

Legend: **FIXED** = present in the uncommitted tree and confirmed live in a post-fix run record; **OPEN** = still absent.

### RC-1 — Antigravity argv-only, 30 000-char ceiling — FIXED (with residual defects)

`packages/council/tool-council/bin/agy-headless.mjs:87`
```js
const MAX_PROMPT_CHARS = 30_000
```
`agy-headless.mjs:869-873` replaced the old hard throw with compaction:
```js
const compacted = compactPrompt(prompt)
prompt = compacted.text
if (compacted.compacted) {
  process.stderr.write(`agy-headless: compacted prompt to ${prompt.length} characters; omitted ${compacted.omittedChars}\n`)
}
```
Live proof it works: run `9df149a7` (2026-09-14 19:10, post-fix) has `agy-flash-lite` succeeding in 28 930 ms and `agy-pro` in 55 301 ms, where run `059ae26b` (pre-fix) had all three agy seats erroring with `prompt is 93534 characters; ... 30000 is the ceiling here`.

**Residual defect D1** — `compactPrompt` (`agy-headless.mjs:94-114`) cuts mandatory blocks mid-text:
```js
const take = Math.min(block.text.length, remaining)
kept.push({ index: block.index, text: block.text.slice(0, take) })
```
A priority-0 block (`objective|constraint|required|plan|evidence|citation|…`) that arrives when `remaining` has run low is kept as a character-sliced fragment, and line 113 then applies a second `.slice(0, limit)` over the joined result. The prompt's rule was "Preserve the objective, hard constraints, required output, agreed plan, essential evidence, and citation identifiers" — a half-sentence fragment does not satisfy that.

**Residual defect D2** — the omission record is a **character count on stderr only**. `omittedChars` never reaches the run record; the prompt requires "Record omitted material and the reason". No list of *which* sections were dropped exists anywhere.

**Not done at all** — the prompt's first instruction, "Inspect the installed `language_server.exe agentapi` interface before choosing the transport", was never actually carried out. The only "inspection" in the council transcript is kimi's fabricated one. The 30 000 cap is currently accepted on an unverified premise.

### RC-2 — no prompt budget for argv transports — FIXED for agy; N/A elsewhere

CLI seats already fall back to stdin for oversized prompts: `seats.ts:505-507` documents "The exception is a prompt too long for argv: then stdin IS the delivery channel", with `stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']` (`seats.ts:507`). Only `agy-headless` cannot use that channel because `agentapi` is argv-only.

### RC-3 — cancellation not checked before spawn/request — FIXED

Three guards, all new in the tree:
- `seats.ts:482-485` — inside `runOnce`, before `spawn`:
  ```ts
  if (signal?.aborted === true) {
    resolve({ stdout: '', stderr: '', code: null, spawnError: 'cancelled by user' })
    return
  }
  ```
- `seats.ts:645` — `askCliSeat`: `if (signal?.aborted === true) return { seat: seat.id, text: '', error: 'cancelled by user', ms: 0 }`
- `seats.ts:1071` — `askSeat` dispatch, same guard, covering the OpenRouter path.

Test exists: `tests/seats.spec.ts` +`it('does not spawn when the signal is already aborted')`, asserting `reply.error === 'cancelled by user'` and `reply.ms === 0`.

**Residual gap D3** — `askOpenRouterSeat` itself (`seats.ts:726`) has no pre-abort check; it is protected only because `askSeat:1071` runs first. A direct call, or any future caller, has no guard.

### RC-4 — `child.kill()` does not kill a Windows process tree — FIXED

`seats.ts:537-545`:
```ts
const terminate = (): void => {
  if (process.platform !== 'win32' || child.pid === undefined) {
    child.kill('SIGKILL')
    return
  }
  const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    shell: false, windowsHide: true, stdio: 'ignore',
  })
  killer.on('error', () => { child.kill('SIGKILL') })
}
```
Used by both the timeout (`seats.ts:547`) and the abort handler (`seats.ts:551`).

### RC-5 — `{"kind":"user"}` reaching the user as error text — FIXED

`packages/council/tool-council/src/errors.ts:55`:
```ts
if ((error as { kind?: unknown }).kind === 'user') return 'cancelled by user'
```
Test at `tests/council.spec.ts:428`: `expect(describeError({ kind: 'user' })).toBe('cancelled by user')`.
Pre-fix evidence: run `df3b49eb` drafts read `kimi: ERR {"kind":"user"}`, `deepseek: ERR {"kind":"user"}` — exactly the string this now normalizes. Also in that run, `free-claude`/`agy-*` read `ERR aborted`; `seats.ts:552` now produces `cancelled by user` instead.

### RC-6 — no layered timeouts — **OPEN (the largest remaining gap)**

What exists:
- **seat-overall**, CLI: `seats.ts:546-549`, `spawnError: \`seat overall deadline exceeded after ${timeoutMs}ms\``
- **seat-overall**, OpenRouter: `seats.ts:726` `const overall = AbortSignal.timeout(timeoutMs)`, reported at `seats.ts:791-792`
- **stream-idle**, OpenRouter only: `seats.ts:727-728` (`stall` controller composed via `AbortSignal.any`), `seats.ts:906` `DEFAULT_STREAM_IDLE_MS = 90_000`, enforced in `readSseStream` at `seats.ts:990-1007`, reported at `seats.ts:793-794` as `stream idle for Nms (silent)`

What does **not** exist, confirmed by grep returning zero hits across `packages/council/tool-council/src/`:
- **startup deadline** — no `startupMs`, no spawn/handshake timer. A `language_server.exe` that never reaches its first byte burns the full seat-overall budget.
- **stream-idle for CLI seats** — `idleMs` is referenced only at `seats.ts:64` (the type), `:772`, `:794`, `:977-1007`, all on the OpenRouter path. `runOnce` has one timer only.
- **council-round deadline** — `council.ts` gathers each round with `Promise.all` over `tasks` (`council.ts:507`: `if (!sequential) return await Promise.all(tasks.map(task => task()))`) and every call is handed the same `options.timeoutMs` (`council.ts:853, 870, 896, 904, 956, 961, 1009, 1048`). The round therefore ends when the **slowest** seat's own cap expires. This is the documented 420-second-cap pacing failure in `dsh-harness-gotchas.md`.
- **full-run deadline** — none.

### RC-7 — quorum not enforced, partial reported as completed — FIXED

`council.ts:1014-1018`:
```ts
const minDrafts = Math.max(1, Math.min(options.minDrafts ?? 2, active.length))
if (usable.length < minDrafts) {
  const cancelled = options.signal?.aborted === true || drafts.some(draft => draft.error === 'cancelled by user')
  return { phase: 'full', terminalState: cancelled ? 'cancelled' : usable.length === 0 ? 'failed' : 'partial', … }
```
`council.ts:1087-1090`:
```ts
const goodReviews = reviews.filter(review => review.error === undefined)
const minReviews = Math.max(0, options.minReviews ?? (usable.length > 1 ? 1 : 0))
const quorumMet = goodReviews.length >= minReviews && verdict.winner !== undefined
```
Config surface: `index.ts:141-144` (`minDrafts`, `minReviews`), `index.ts:422-423` (`z.natural().default(2)` / `.default(1)`), threaded at `index.ts:1124-1125` and `index.ts:1815-1816`.

**Live confirmation:** run `9d32f748` (2026-09-14 22:13) carries `terminalState: "completed"`, `schemaVersion: 2`, `quorumConfig: {"minDrafts":2,"minReviews":1}`. Runs `9df149a7` and `df3b49eb` (both before the fix landed at 04:37–04:41 on 09-13 / before the host reload) carry none of those keys.

**Residual defect D4 — the quorum is an absolute 2, not a fraction.** Run `9d32f748` had 4 seats: `free-claude` HTTP 402 (SambaNova billing), `openrouter-free` "not called — http://127.0.0.1:8080 is not accepting connections", `kimi` ok, `deepseek` ok. Two of four succeeded, so `2 >= 2` and it reported `completed`. The winning council plan specified `≥ ⌈seats/2⌉`. On an 8-seat roster, 2 successes out of 8 would still read `completed`, and `minReviews: 1` means a **single review** decides an eight-model council.

**Residual defect D5** — `Math.max(1, Math.min(minDrafts, active.length))` at `council.ts:1014` clamps the floor to `active.length`. With one enabled seat the quorum becomes 1 and a lone draft is reported `completed`, which is the exact "never call one draft a council verdict" case the prompt forbids.

### RC-8 — no durable resume with prompt/model identity — PARTLY FIXED

Already correct, and **predates** this work — `journal.ts:79-82`:
```ts
export function journalKey(seat: SeatConfig, prompt: string): string {
  const routing = [seat.id, seat.transport, seat.command ?? '', seat.model ?? '', seat.baseUrl ?? '']
  return createHash('sha256').update(JSON.stringify([...routing, prompt])).digest('hex')
}
```
Changing the prompt, model, transport, command or base URL changes the key, so a stale answer is simply not recalled. Requirement 5's "invalidate answers when the effective prompt, model, transport, or relevant context changes" is therefore already satisfied by construction.

New in the tree — the journal survives a non-completed run (`index.ts:1151`):
```ts
if (result.phase === 'full' && result.terminalState === 'completed' && journal !== undefined) discardJournal(journal.runId)
```

**OPEN — failures are never journalled.** `journal.ts:159`:
```ts
if (journal === undefined || reply.error !== undefined || reply.text.trim() === '') return
```
`recordReply` discards every failed reply. Consequences, all still live:
- terminal vs retryable failure classification does not exist anywhere in the tree;
- "do not retry unchanged configuration errors" is unimplemented — a seat that failed with `no command configured` (`seats.ts:647`) or `not installed or not on PATH` (`seats.ts:672`) is re-called on every resume;
- cancellation and timeout reasons are not persisted in the journal (they reach the `RunRecord` only for a run that got far enough to be filed);
- the `Journal` interface (`journal.ts:43`) holds `runId`, `entries`, `hits`, `path` only — no phase, no quorum state.

### RC-9 — missing terminal states — FIXED

`runs.ts:44-58` defines the full union:
```ts
export type RunTerminalState =
  | 'completed' | 'partial' | 'cancelled' | 'failed' | 'awaiting_resume'
```
plus `QuorumConfig` (`runs.ts:65-71`), and `RunRecord.terminalState` / `.quorumConfig` / `.promptMetrics` / `.schemaVersion` (`runs.ts:115-124`). `CouncilResult.terminalState` at `council.ts:150`. Persisted at `index.ts:1261-1263`.

**OPEN** — `awaiting_resume` is declared but never assigned anywhere in the tree (grep: only the type definition and the doc comment mention it). A Stop press does not produce it.

### RC-10 — no observability of prompt sizes / transport / compaction — **OPEN**

`PromptMetric` is fully specified at `runs.ts:74-100` (`promptChars`, `promptBytes`, `queryChars`, `planChars`, `evidenceChars`, `memoryChars`, `transport`, `seatLimit`, `compacted`) and `RunRecord.promptMetrics` at `runs.ts:123`. **Nothing constructs one.** `grep -rn "promptMetrics\|PromptMetric" src/` returns exactly two hits, both the declarations in `runs.ts`. The type is dead.

Confirmed against the artifact, not the source: the post-fix run record `9d32f748` — which *does* carry `schemaVersion: 2` and `quorumConfig`, proving it was written by the patched code — has `promptMetrics` **absent**.

### RC-11 (not in the council list; found here) — partial/quorum state is invisible in the UI — **OPEN**

`grep -rn "terminalState\|quorum\|partial" packages/client/ui-council-budget/src/` returns nothing. The UI changes sitting in the working tree are a different feature: provider grouping and bulk seat selection (`capacity.ts` +`providerForSeat`/`groupSeats`/`ANTIGRAVITY_IDE_ONLY_MODELS`, `CouncilBudget.tsx` +`setSeatsEnabled` and the grouped picker) plus the pipeline gate registration from the earlier approval handoff (`index.ts` +`ctx.slots.inject('tool.call.toolview', …)` keyed `pipeline`). Requirement 7 is untouched.

## 2. Already fixed vs outstanding — summary

| Prompt item | State | Evidence |
|---|---|---|
| 1 Large-prompt transport | **Fixed**, 2 defects (D1 mid-block cut, D2 no manifest), interface never inspected | `agy-headless.mjs:87,94-114,869-873`; live in run `9df149a7` |
| 2 Cancellation correctness | **Fixed**, 1 gap (D3) | `seats.ts:482,537-545,645,1071`; `errors.ts:55` |
| 3 Layered timeouts | **Open** — 2 of 5 layers exist, and only on one transport | `seats.ts:546,726-728,906,990-1007`; no startup/round/run deadline anywhere |
| 4 Partial-result policy | **Fixed**, 2 defects (D4 absolute quorum, D5 single-seat floor); `awaiting_resume` unassigned | `council.ts:1014,1087-1095`; `runs.ts:44-58`; live in run `9d32f748` |
| 5 Durable resume | **Half** — identity/invalidation already correct; failure persistence and retry classification absent | `journal.ts:79-82` (good), `journal.ts:159` (gap) |
| 6 Observability | **Open** — type declared, never populated | `runs.ts:74-100`; `promptMetrics` absent from `9d32f748` |
| 7 Partial-run UI | **Open** | no `terminalState` in `ui-council-budget/src/` |

Three of the seven are effectively done. The remaining work is items 3, 6, 7, half of 5, and five named defects.

## 3. Exact patch plan, per file

### P1 — `bin/agy-headless.mjs` (+ `tests/agy-headless.test.mjs`)
- Rewrite `compactPrompt` to drop **whole blocks**, never slice one. Keep priority-0 blocks entire; if the priority-0 set alone exceeds the limit, fail loudly with `prompt exceeds the argv ceiling even after dropping every optional section` rather than cutting a constraint in half.
- Replace `omittedChars` with `omitted: [{ heading, chars, reason }]`, embed the list in the `<prompt-compaction>` notice, and emit the same structure to stderr as one line `agy-headless: compaction-manifest <json>` so the caller can lift it.
- Keep the existing `.slice(0, limit)` only as a final assertion (`if (text.length > limit) throw`), not as a silent trim.

### P2 — new `src/deadlines.ts` (+ new `tests/deadlines.spec.ts`)
Pure, no imports from the existing modules, so it can land in parallel:
```ts
export interface Deadlines { startupMs, streamIdleMs, seatOverallMs, councilRoundMs, fullRunMs }
export function deadlinesFor(seat, config): Deadlines
export function deadlineReason(kind, ms): string   // the exact persisted strings
```
Reason strings, fixed by the prompt: `seat overall deadline exceeded after ${ms}ms`, `stream idle for ${ms}ms`, `council round deadline reached`, `run cancelled by user`, plus `seat produced no output within ${ms}ms of starting`.

### P3 — `src/seats.ts` (+ `tests/seats.spec.ts`)
- `runOnce`: add a **startup timer** armed at spawn and cleared on the first stdout/stderr byte; add a **CLI stream-idle timer** rearmed on every chunk, both routed through the existing `terminate()`.
- `askOpenRouterSeat`: add the pre-abort guard (D3) before `AbortSignal.timeout`.
- Build and return a `PromptMetric` from both `askCliSeat` and `askOpenRouterSeat` (the section sizes are known at prompt-assembly time in `council.ts`, so pass them down as one optional `sections` argument rather than re-parsing).
- Lift `agy-headless`'s `compaction-manifest` stderr line into the reply so `compacted` and the omission list are real data.

### P4 — `src/journal.ts` (+ `tests/journal.spec.ts`)
- Add `recordFailure(seat, prompt, reply, class: 'terminal' | 'retryable')` and persist it under the same `journalKey`.
- Classify: `no command configured`, `not installed or not on PATH`, `no pool seat could answer`, HTTP 401/402/403 → **terminal**; timeouts, idle, 429, 5xx, connection refused → **retryable**; `cancelled by user` → retryable.
- Add `recallFailure` so resume skips terminal ones. Persist `phase` and `quorum` on the `Journal` record.
- **Redaction**: store the normalized reason string only, never raw stderr — stderr carries paths and can carry tokens.

### P5 — `src/runs.ts`
Types only (keeps the write set disjoint from P4): add `SeatFailure { seat, round, reason, class, at }`, `RunRecord.failures`, `RunRecord.compaction`. Bump `schemaVersion` to 3 and keep the "absent means 1" reader contract at `runs.ts:118-119`.

### P6 — `src/council.ts` (+ `tests/council.spec.ts`)
- Wrap each round's `Promise.all` (`council.ts:507`) in a **round deadline**: an `AbortController` composed into `options.signal`, so a slow seat is cut with `council round deadline reached` and the round still returns every answer already in hand.
- D4: `const minDrafts = Math.max(options.minDrafts ?? 2, Math.ceil(active.length / 2))`.
- D5: when `active.length === 1`, never return `completed` unless the config explicitly sets `minDrafts: 1`.
- Collect `PromptMetric[]` from the seat calls and return them on `CouncilResult`.

### P7 — `src/index.ts`
- Config keys: `startupMs`, `idleMs`, `roundMs`, `runMs`, `quorumFraction`, all `z.natural()` with the defaults above.
- Persist `promptMetrics` and `failures` into the `RunRecord` at the existing `index.ts:1258-1264` site.
- Assign `awaiting_resume` on the Stop path so the state stops being dead.

### P8 — `packages/client/ui-council-budget/src/client/CouncilCallView.tsx` + `CouncilBudget.module.css` + `locales.ts` (+ client tests)
Additive only, per the council's accepted caution: one status banner keyed off `terminalState` (`running` / `waiting on slow seats` / `quorum unavailable` / `partial — resumable` / `cancelled` / `failed` / `completed`) and a per-seat chip (`succeeded` / `failed` / `timed out` / `cancelled` / `never started`). Continue passes only the unfinished/retryable seat ids. **Do not touch `CouncilBudget.tsx`'s picker hunks** — they belong to the unrelated in-flight feature.

## 4. Proposed test cases

Each maps to one of the prompt's required proofs.

1. `compactPrompt` on an 89 830-char fixture: result ≤ 30 000, **no priority-0 heading missing**, manifest lists every dropped heading. (prompt proof 1 + 2)
2. `compactPrompt` where priority-0 alone exceeds the limit: throws, does not truncate. (new, guards D1)
3. Pre-aborted signal → no spawn, no `fetch`. Assert with a spy on both. Exists for CLI; add the OpenRouter half. (proof 3)
4. Mid-flight cancel of a CLI seat that spawned a grandchild → grandchild pid gone. Use a node fixture that spawns a sleeper and writes its pid. (proof 4)
5. `describeError({kind:'user'})` and a rejected promise carrying that object both render `cancelled by user`. (proof 5)
6. 1 success of 8 → `terminalState: 'partial'`, `verdict.winner === undefined` at the council level. 2 of 8 → still `partial` under the fraction rule. 4 of 8 → `completed`. (proof 6 + D4)
7. One enabled seat, one success → not `completed`. (D5)
8. Resume recalls the successful seat (journal hit count rises) and calls only the unfinished ones. (proof 7)
9. Changing model, transport, `baseUrl`, or prompt each invalidates the entry — four cases against `journalKey`. (proof 8)
10. A seat that failed `not installed or not on PATH` is **not** re-called on resume; one that timed out **is**. (requirement 5)
11. Round deadline fires while one seat is still running → the other seats' answers survive, the slow seat reads `council round deadline reached`, run is `partial` and resumable. (proof 9)
12. Startup deadline: a CLI fixture that never writes a byte fails with the startup string, not the overall string, and well before `timeoutMs`.
13. CLI stream-idle: a fixture that writes one byte then goes silent fails with the idle string.
14. `promptMetrics` present in the filed `RunRecord`, with `promptBytes >= promptChars` and section sizes summing within the total.
15. Regression: existing short-prompt council, pipeline, approval gate, Stop-run, model-picker, journal, roster-drift suites unchanged and green.

## 5. Swarm DAG — waves with disjoint write sets

Every unit names one local owner responsible for applying and testing the hosted worker's output. No wave shares a file with itself.

**Wave 1** — no cross-dependencies, three fully disjoint write sets
| Unit | Writes | Depends on |
|---|---|---|
| W1-A | `bin/agy-headless.mjs`, `tests/agy-headless.test.mjs` | — |
| W1-B | `src/journal.ts`, `tests/journal.spec.ts` | — |
| W1-C | `src/deadlines.ts` *(new)*, `tests/deadlines.spec.ts` *(new)* | — |

**Wave 2**
| Unit | Writes | Depends on |
|---|---|---|
| W2-A | `src/runs.ts` | W1-B (failure shape) |
| W2-B | `src/seats.ts`, `tests/seats.spec.ts` | W1-A, W1-B, W1-C |

**Wave 3**
| Unit | Writes | Depends on |
|---|---|---|
| W3-A | `src/council.ts`, `tests/council.spec.ts` | W2-A, W2-B |
| W3-B | `src/index.ts` | W2-A, W2-B |

**Wave 4**
| Unit | Writes | Depends on |
|---|---|---|
| W4-A | `client/CouncilCallView.tsx`, `client/CouncilBudget.module.css`, `client/locales.ts`, `tests/send-face.client.spec.ts` | W3-A, W3-B |

**Wave 5** — verification only, no writes: full suite, host + client typecheck, `build:lib:host`, `build:lib:client`, artifact grep, 89 830-char fixture replay.

Gate between every wave: the wave's tests green and the previous wave's tests still green. A failed wave stops the swarm; it does not advance.

## 6. Acceptance criteria, measured against built artifacts

Per the standing rule "verify the compiled artifact, not the source", and the gotcha that a piped build's exit code lies:

1. `pnpm.cmd run build:lib:host` and `build:lib:client` each exit 0 with `$?` captured directly, not through a pipe.
2. `packages/council/tool-council/lib/index.js` contains the literals `council round deadline reached`, `seat overall deadline exceeded after`, `stream idle for`, `awaiting_resume`, and `promptMetrics`.
3. `packages/client/ui-council-budget/lib/client.js` contains `quorum unavailable` and `partial`. The served `?rev=` on `/plugins/<pkg>/client.js` changes — per the gotcha, `--filter <pkg>` alone leaves a stale `client.js`, so both filters must be passed.
4. The installed driver `~\.dsh\bin\agy-headless.mjs` is SHA-256-identical to the repository copy (the previous handoff used this check; keep it).
5. Artifact mtimes are newer than the last source edit, and the live DSH host's start time is newer than the artifact mtime — otherwise the running host has not loaded the fix.
6. A replay of the 89 830-char fixture through the built artifact yields neither `ENAMETOOLONG` nor the 30 000-char rejection, and its manifest lists dropped headings.
7. A fresh run record written by the built host contains `schemaVersion: 3`, `promptMetrics` (non-empty), and `failures`.
8. No real metered model or API call anywhere in verification.

## 7. Questions for the user, with recommendations

1. **The 665 uncommitted lines.** They are GPT-5.6-Sol's finished, verified work (items 1/2/4) sitting unstaged alongside an unrelated in-flight model-picker feature. Commit the council-reliability hunks as their own commit before Phase 2 adds more, or keep one growing pile?
   *Recommend:* commit them first, scoped to the council files, leaving the picker hunks unstaged. A verified 496-test state is worth a restore point, and Phase 2 touches the same files.

2. **Quorum default (D4).** Current `minDrafts: 2` is absolute, so 2-of-8 reads `completed`. The winning council plan said `⌈seats/2⌉`.
   *Recommend:* `max(2, ceil(active/2))` for drafts and `max(1, ceil(active/3))` for reviews. Under this, run `9d32f748` (2 of 4) stays `completed`; an 8-seat run needs 4.

3. **Single-seat runs (D5).** With one enabled seat, should a lone successful draft ever be `completed`?
   *Recommend:* no by default — report `partial` — but honour an explicit `minDrafts: 1` for users who deliberately run one seat.

4. **Actually probing `agentapi`.** Nobody has inspected `language_server.exe agentapi` for a file/stdin/RPC prompt channel; the council's "inspection" was fabricated. Probing means launching the installed binary locally (no model spend, no network to a provider) to enumerate its flags.
   *Recommend:* yes, probe it in Phase 2 before hardening compaction as permanent. If a file or stdin channel exists, item 1 collapses from a compaction problem to a one-line transport change and nothing is ever omitted.

5. **CLI stream-idle default.** Adding one risks killing a legitimately quiet `claude -p` mid-think; the council's accepted caution (deepseek, backed by kimi and agy-pro) was explicit about this.
   *Recommend:* default **off** for CLI seats, opt-in per seat, and when on, arm it only after the first byte. OpenRouter keeps its existing 90 s.

6. **Council-round deadline: value, and what it does to a slow seat.**
   *Recommend:* default 600 s; on expiry, cancel the outstanding seats, keep every answer already in hand, mark the run `partial` and resumable. Not a silent wait-and-discard.

7. **UI scope (item 7).** Include the partial-run UI in this work, or defer it and ship the host-side correctness first?
   *Recommend:* include it. Without it a `partial` run still *looks* finished to you, which is the original complaint. Keep it strictly additive and off `CouncilBudget.tsx`.

8. **Journalling failures — what to store.** Raw stderr can contain paths and, from some CLIs, tokens.
   *Recommend:* store the normalized reason and the terminal/retryable class only; never the raw stream.

9. **Where the compaction manifest lives.** Run record, a sidecar file, or both?
   *Recommend:* the run record (`RunRecord.compaction`), so it travels with the run and appears in the report and the UI.

10. **Schema bump.** `RunRecord` is at `schemaVersion: 2` with exactly one record in the wild (`9d32f748`). Adding `failures` and `compaction` makes it 3.
    *Recommend:* bump to 3 and keep the existing tolerant reader ("absent means 1"); no migration of old records — they are read-only history.

## 8. Notes for the parent session

- The quota-handoff hook fired at ~101k context during this run (Claude weekly quota reported 100%). I did **not** write to `~/.claude/shared-brain/` because Phase 1 is scratchpad-only; this file is the checkpoint record. If a brain note is wanted, `handoff-dsh-pipeline-approval.md` is the right one to update — it already owns this work and is marked `complete`, which is now stale given items 3/5/6/7.
- Do not re-derive items 1, 2 and 4. They are built, tested at 496 tests, and confirmed live in run record `9d32f748`.
- Do not act on kimi's source listing or deepseek's transport evidence from run `059ae26b`. Both are fabricated; the reviews in that same run already say so.
