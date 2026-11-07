# DSH council run forensics — why three runs could not complete

Claude Opus 5, agent 4 of 4. Analysis only: nothing outside this scratchpad was written, no
repo file edited, no settings changed, no run launched, no spend.

Evidence base: `~/.dsh/council-runs/*.json` (raw records), the extracted transcripts in this
scratchpad, the working tree at `~\Documents\claudecode\deepseek-harness` (branch
`feat/heterogeneous-teammates`, council sources **uncommitted / modified**), the deployed
artifact `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-council` (a symlink into the repo's
`apps/cli/node_modules/...`, `lib/index.js` built and current), `~/.dsh/settings.yaml`,
`~/.dsh/bin/agy-headless.mjs`, and live `netstat`.

---

## 0. Two facts established before anything else

**The deployed build is current.** `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-council`
is a symlink into the repo. `lib/index.js:558` contains
`if (error.kind === "user") return "cancelled by user";` and `terminalState` appears throughout
`lib/index.js`. So the fixes that landed in `errors.ts` and `runs.ts` **are** running now. That is
why only run 1 carries `schemaVersion: 2`. Runs 2 and 3 predate that build and were written by
schema 1, which had no terminal state at all.

**The dead port is dead right now.** `netstat` at 2026-09-15 16:29 local:

```
TCP    0.0.0.0:8082           LISTENING       24884     <- FCC, alive
TCP    127.0.0.1:3080         LISTENING       24624     <- DSH host
```

Nothing on 8080. `settings.yaml:22-25` still has `openrouter-free` → `baseURL:
http://127.0.0.1:8080/v1`, and `settings.yaml:125-127` has it `enabled: true`. The next council
run repeats the identical failure.

---

## 1. Per run: the mechanical cause

### Run 3 — `df3b49eb` · 2026-09-13T09:14:04Z · 7 seats · 0/7 drafts · whole run in ~3.9s

Every seat's error, from the JSON:

```
free-claude      ms 3927   "aborted"
kimi             ms 3896   "{\"kind\":\"user\"}"
deepseek         ms 3910   "{\"kind\":\"user\"}"
openrouter-free  ms 0      "not called — http://127.0.0.1:8080 is not accepting connections (connect ECONNREFUSED 127.0.0.1:8080)"
agy-flash-lite   ms 3890   "aborted"
agy-flash        ms 3878   "aborted"
agy-pro          ms 3867   "aborted"
```

**Cause: the user (or the host) aborted ~3.9 s in.** Six seats died on one shared abort signal,
which reached two different layers and produced two different strings for the same event — the
CLI seats returned the string `"aborted"`, the hosted seats threw the raw object `{kind:'user'}`
which `String(error)` at the time rendered verbatim. The seventh seat was never called at all
because the probe had already marked it dead.

The mechanical *non-completion* is not the abort. It is that **the run was still filed**:
`index.ts:1246` — `if (result.phase === 'full')` → build `stored` → `saveRun(stored)`. Nothing in
that branch consults the outcome. `runs.ts:saveRun` then calls `shareRun(record)`, which appended
this line to the shared brain permanently:

```
- 2026-09-13 09:14Z ... drafts 0/7; reviews 0; amendments 0 <!-- dsh-run id=df3b49eb-... -->
```

Zero drafts, zero reviews, recorded as a run alongside real ones. At the time it had no
`terminalState` field, and `runs.ts:110-114` documents the fallback: *"Absent ... treated as
`completed` by callers for backward compatibility."*

On today's build the same run would be labelled `cancelled` (`council.ts:1019`), because
`errors.ts:describeError` now maps `kind === 'user'` → `'cancelled by user'` and
`council.ts:1016` tests exactly that string. **But it would still be saved and still be shared.**
Nothing gates the write on terminal state.

Note the string mismatch is only half fixed: the four seats that said `"aborted"` still do not
match `'cancelled by user'`. If a future abort produces only `"aborted"` and `signal.aborted` is
false at the check, the run is labelled `failed` rather than `cancelled`.

### Run 2 — `9df149a7` · 2026-09-15T02:10:44Z · 8 seats · 5/8 drafts · "split vote" · amendments=1

Four independent failures in one run:

| seat | ms | failure |
|---|---|---|
| `claude` | 34482 | `Failed to authenticate: OAuth session expired and could not be refreshed` — **and it produced a 72-char draft whose entire text is that error message** |
| `openrouter-free` | 0 | `not called — http://127.0.0.1:8080 ... ECONNREFUSED` |
| `agy-flash` | 4565 | `agy-headless: no pool seat could answer. seat5: never signed in \| seat6: never signed in` |
| `agy-flash` (review) | — | `agy-headless: compacted prompt to 29866 characters; omitted 28856` then the same pool failure |

**The decisive defect is not the split vote — it is that the vote was mis-parsed.**

`council.ts:1058` calls `parseReview(reply.text, active)`. `active` is the **whole roster**, not
the candidate list. `parseReview` (`council.ts:428-432`) resolves a vote with:

```ts
if (claimed === seat.id || claimed.includes(seat.id) || claimed.includes(seat.name.toLowerCase()))
```

iterating the roster in order. Roster order here was `claude, free-claude, kimi, ...`. A
`VOTE: free-claude` line hits `claimed.includes('claude')` on the **first** iteration and resolves
to the `claude` seat.

Proof from the record — the two seats recorded as `vote: "claude"` say in their own critiques who
they meant:

- `kimi` (conf 0.92): *"**Free Claude (Claude Opus 5)** delivered the only complete, actionable answer..."*
- `agy-flash-lite` (conf 1.0): *"...Free Claude provided an exceptionally thorough... Free Claude's answer is fully realized and ready for approval."*

Both voted for **free-claude**. Both were recorded as votes for **claude** — a seat that produced
nothing but an OAuth error.

Consequence, at `council.ts:1091-1092`:

```ts
const winning = verdict.winner === undefined ? undefined : drafts.find(draft => draft.seat === verdict.winner)
```

`drafts.find`, not `usable.find`. The winner lookup searches **failed drafts too**. With
peer-score 1.92 for `claude` (0.92 + 1.00, both non-self so both count as peer endorsement), the
`method: 'peer'` branch at `council.ts:574` returns first and `claude` wins outright — no tie, no
split. `answer` becomes the 72-character string *"Failed to authenticate: OAuth session expired
and could not be refreshed"*, presented as the council's decision.

The real tally, with votes correctly attributed: agy-flash-lite 2 (0.94+0.90 = 1.84),
free-claude 2 (0.92+1.00 = 1.92), kimi 1 (0.80). free-claude wins on peer score. The run had a
decidable outcome and the parser threw it away.

`amendments: 1` — the run was amended once. That matters: see §4, the amendment downgrades the
record.

### Run 1 — `9d32f748` · 2026-09-15T05:13:03Z · 4 seats · 2/4 drafts · `terminalState: "completed"`

```
free-claude      ms 4007     "API Error: 402 Upstream provider SAMBANOVA returned HTTP 402.
                              Category: PAYMENT_METHOD_REQUIRED ... {"balance_units":0,...}"
kimi             ms 69065    ok, 12834 chars
deepseek         ms 179098   ok, 25034 chars
openrouter-free  ms 0        "not called — http://127.0.0.1:8080 ... ECONNREFUSED"
quorumConfig: {"minDrafts":2,"minReviews":1}   schemaVersion: 2   terminalState: "completed"
```

**This run is not a bug in the quorum gate — the gate did what it was told.**
`council.ts:1013`: `minDrafts = Math.max(1, Math.min(options.minDrafts ?? 2, active.length))` = 2.
Two usable drafts, so the failure branch is skipped. `council.ts:1088-1089`:
`minReviews = 1`, three good reviews, `verdict.winner = 'deepseek'` (unanimous among the three
that voted), so `quorumMet` is true and `terminalState: 'completed'` at `council.ts:1095`.

The defect is that the threshold is **absolute, not proportional**, and `settings.yaml` sets
neither `minDrafts` nor `minReviews` (grep found no occurrence), so the 2/1 defaults stand. Half
the roster was dead and the run still reads as a full council decision. On an 8-seat roster
2-of-8 would read identically, and `minReviews: 1` means a single review can decide an
eight-model council.

Second defect in the same run: `free-claude` returned the SambaNova 402 body **as its draft text**
(483 chars) as well as in `error`. Because `error !== undefined` it was correctly excluded from
`usable`, but if any path ever ranks on `text` alone, a billing error is a candidate answer.

---

## 2. What is the same root cause across runs

**R1 — `ECONNREFUSED 127.0.0.1:8080`. All three runs. Never fixed between them.**

There *is* a preflight. `council.ts:814` runs `probeSeat` over every active seat before the plan
round; `seats.ts:874` opens a loopback TCP connect with `PROBE_TIMEOUT_MS = 1500`. It works — it
is why `openrouter-free` shows `ms 0` instead of burning its 420 s timeout. The probe saved the
wall clock and did nothing else.

Why it was never caught between runs:

1. **The probe result is a per-seat row, not a gate.** `council.ts:830-832` returns
   `not called — <why>` as that seat's error and the run proceeds. There is no branch anywhere
   that counts dead seats and refuses to spend, and no warning above the Approve button.
2. **It only surfaces pre-spend when the plan round happens to run.** The only pre-approval
   rendering is `markdown.ts:81`, a `> **!**` line built from `planFailures`, and the plan round
   is conditional (`council.ts:840`: `plan === undefined && skipPlan !== true && planMode ===
   'council' && active.length > 1`). Skip the plan and the dead seat is invisible until after the
   money is spent.
3. **Nothing is persisted.** The probe's finding is not written to settings, to the brain, or to
   any status file. Each run rediscovers it from scratch and the knowledge dies with the run.
4. **Nothing restarts the proxy.** `handoff-dsh-model-choice.md:29` already records the cause:
   *"The :8080 proxy was started from this Claude Code session's background task and may stop with
   it; DSH's launcher does not start it."* FCC (8082) has `fcc-status.json` with
   `recoveryAttempts: 0, recoveryLimit: 3` and a 30 s monitor. The OpenRouter proxy has no
   equivalent. `shared-agent-log.md:1682` flagged this exact gap and it was never closed.

**R2 — the probe tests a socket, not a seat.** `loopbackBackend` (`seats.ts:824`) returns
`undefined` for anything that is not a loopback URL, so `probeSeat` returns `undefined` — "usable"
— for every one of the other three failures:

- `claude` OAuth expired: `transport: 'cli'`, no `*BASE_URL` env → no probe → 34 s burned to
  learn what `claude -p` would have said in one call, plus a poisoned draft.
- agy pool never signed in: `agy-headless.mjs:711` already does the check
  (`if (!existsSync(join(geminiDir, TOKEN_FILE))) return { ...row, skip: 'never signed in' }`) —
  a pure filesystem test, free — but only at call time inside the driver.
- `free-claude` SambaNova 402: **8082 is listening**, so a TCP probe passes and even a
  `GET /health` passes (the FCC log shows `/health 200 OK` every 30 s). Only an actual
  minimal completion catches an upstream billing wall.

**R3 — error text is not normalised at the point it is produced.** `{"kind":"user"}`, `"aborted"`,
and `"cancelled by user"` are three spellings of one event, and `council.ts:1016` matches only the
third. `errors.ts:describeError` fixed the object case; the string case is still unnormalised.

**R4 — agy prompts are silently halved.** `agy-headless.mjs:87` `MAX_PROMPT_CHARS = 30_000`;
`compactPrompt` (line 94) drops blocks, prepends
`<prompt-compaction original-chars= omitted-chars= reason=.../>` **into the prompt the model sees**,
and writes one line to **stderr** (line 872). Run 2: `compacted prompt to 29866 characters;
omitted 28856` — 49 % of the spec discarded. That stderr line reached the record only because the
seat failed afterwards and the driver concatenated it into the error. **Had the seat succeeded,
the run record would show a normal draft with no indication that half the input was thrown away.**
Run 4 (`059ae26b`, 06:28Z the same day) shows the earlier behaviour: all three agy seats returned
a hard error, `prompt is 35225 characters; ... 30000 is the ceiling here`. So between 09-13 and
09-15 a loud, correct failure was converted into a silent truncation — a regression against run
3's own written requirement, quoted from its prompt: *"Never silently truncate ... Record omitted
material and the reason."*

`runs.ts:70-97` declares a `PromptMetric` type with a `compacted: boolean` field designed for
exactly this. `index.ts:1248-1264` never populates `promptMetrics`. The type is dead.

---

## 3. Recursive loops — every re-entry path, and what bounds it

| # | Loop | Trigger | What makes it spin | Current bound |
|---|---|---|---|---|
| L1 | **Quota hold → same stage** | `pipeline.ts:361` `detectQuotaHold(output.failures)` sets `hold`; next call `pipeline.ts:349-352` clears it and re-runs **the same stage** | A seat that is permanently 429 or permanently out of credit. `quota-hold.ts:EXHAUSTED` matches `/rate limit/i` and `/\bHTTP 429\b/` — a free OpenRouter proxy emits these constantly | **None.** No hold counter, no consecutive-hold cap, no monotonic-progress requirement. Only `MAX_HOLD_MS = 8h` bounds one wait, and `holdElapsed(..., sessionPercent < 90)` can release a hold *early*, shortening the cycle. Human re-invocation is the only real brake |
| L2 | **Review → rework → swarm → review** | `pipeline.ts:399` `if (stage === 'review' && output.rework === true)` sets `stage = 'swarm'`. `index.ts:1863` sets `rework: true` whenever the review answer starts `REWORK REQUIRED` | A reviewer that never says ACCEPTED — and the whole point of the review stage is to be strict | **None.** `grep -rn rework *.ts` returns 6 hits and not one counter. Each cycle is a full swarm + a full council |
| L3 | **Journal re-entry** | `index.ts:1103` `openJournal(journalIdFor(councilQuestion))` — the journal id is `sha256(question)`. Same question ⇒ same journal. `journal.ts:recordReply` records **successes only** | Call the council again with the same text: successes replay free, failures are re-asked. If the failure is structural (dead 8080, expired OAuth) it fails again, forever, for free-ish but never converging | Weak: `JOURNAL_MAX_AGE_MS = 24h`, `JOURNAL_HISTORY = 20`. No attempt count. `discardJournal` fires only at `index.ts:1151` `terminalState === 'completed'` — so a run that never completes keeps its journal alive for the full 24 h and keeps inviting re-entry |
| L4 | **Amendment** | `index.ts:961` `resume` arg → `amendCouncil` re-asks only the holes | A permanently dead seat is a permanent hole | **Bounded, correctly.** `runs.ts:MAX_AMENDMENTS = 3`, enforced by `isAmendable` (`runs.ts:150`) against `record.amendments`, which survives the `readRecord` round trip. This is the one loop in the system that is done right |
| L5 | **Pipeline restart** | `index.ts:1520` exposes `restart: boolean` *as a model-callable tool argument*: "Abandon the run in progress and start a new one at the first stage." `index.ts:1634` acts on it | A model that reads a blocked/held report and decides to restart. This is not hypothetical: run `39e8f161` in `dsh-runs.md` has the literal query **"Restart the pipeline: call the pipeline tool with restart set to true."** — a restart instruction that became a saved council run | **None.** No restart counter, no cooldown, no record of how many times this run has been restarted. The approval gate is the only friction, and `settingsNow.autoApprove` can remove it |
| L6 | **Re-plan on reworded query** | A model re-calls council with slightly different text | Would buy a fresh plan each time and reset the gate | **Bounded.** `index.ts:1044-1052` `heldUnapproved` returns the held plan instead of planning again. Explicitly commented as a fix for this |

Composite worst case — all real, all currently reachable: **L5 → L1 → L2.** A model restarts the
pipeline; the council stage hits a 429-ing free seat and parks; the hold expires, the same stage
re-runs, parks again; eventually it clears, the swarm runs, review says REWORK, back to swarm,
review, REWORK. Every arc of that cycle spends. Nothing in the code counts anything.

---

## 4. Why a run is declared "completed" when it is not

Four separate places, in order of severity.

**(a) The pipeline never looks at the terminal state at all.** `index.ts:1862`:

```ts
complete: council.phase === 'full' && (stage !== 'review' || reviewVerdict === 'ACCEPTED'),
```

`phase === 'full'` means only "the run got past the plan gate". `council.ts:1015-1035` returns
`phase: 'full'` **together with** `terminalState: 'failed'` when zero seats drafted. So a council
stage in which **every seat died** returns `complete: true`, `pipeline.ts:432` advances the stage,
and the next stage is the **swarm** — a failed council authorises a build. This is the most
dangerous line in the system.

**(b) The default when the field is missing is `completed`.** `index.ts:1261`:

```ts
terminalState: result.terminalState ?? 'completed',
```

and `runs.ts:110-114` states the same fallback for old records in prose.

**(c) The field is written but never read back.** `runs.ts:readRecord` (lines 209-224) rebuilds
the record field by field and **omits `terminalState`, `quorumConfig` and `schemaVersion`**.
Everything that loads a run — `loadRun`, `latestRun`, and therefore the whole amend/resume path —
sees a record with no terminal state, which by (b) means completed. The honesty fix is presently
write-only.

That has a concrete regression: `index.ts:990-996` builds the amended record as
`{ ...record, ... }` from the stripped `readRecord` output and calls `saveRun(filed)` over the
same id. **Amending a schema-2 run silently downgrades it to schema 1 and erases its
`terminalState` and `quorumConfig`.** Run 2 has `amendments: 1` — it has already been through this
path. And `amendCouncil` never sets `terminalState` at all (grep: only `council.ts:1019` and
`:1095` set it), so no amended run can ever carry one.

**(d) Saving is unconditional.** `index.ts:1246` `if (result.phase === 'full')` → `saveRun` →
`shareRun`. Terminal state is stored but never consulted before writing to disk or to the shared
brain. Run 3's 0/7 run is in `dsh-runs.md` forever.

**Also dead:** `RunTerminalState` declares `'awaiting_resume'` (`runs.ts:51`, "Stop pressed; good
replies retained in journal"). Nothing in the codebase ever produces it — grep finds the
declaration and no assignment. Pressing Stop yields `cancelled` or `failed`, and there is no state
that says "resumable from journal".

---

## 5. Proposals, prioritized

Each: the problem it kills · where · effort · how to verify.

### P1 — Stop the pipeline treating a failed council as a completed stage
**Kills:** a 0-draft council authorising a swarm build (§4a) — the only defect here that can spend
money on garbage.
**Where:** `index.ts:1862`. Change to
`complete: council.phase === 'full' && council.terminalState === 'completed' && (stage !== 'review' || reviewVerdict === 'ACCEPTED')`,
and add the non-completed case to `problems` so `pipeline.ts:390` blocks instead of advancing.
**Effort:** one line plus a problems entry. Smallest change in this list.
**Verify:** disable every seat but `openrouter-free` (proxy down), run the pipeline's council
stage, confirm it reports **blocked** and that the stage in settings has not advanced to `swarm`.
No spend — every seat fails at the probe.

### P2 — Read back what is written, and never save a run as complete when it is not
**Kills:** §4b, §4c, §4d, and the amendment downgrade.
**Where:**
- `runs.ts:readRecord` — carry `terminalState`, `quorumConfig`, `schemaVersion`, `promptMetrics` through.
- `index.ts:1261` — drop the `?? 'completed'` default; make `terminalState` required from `runCouncil`, and treat *absent* on a legacy record as `'unknown'`, never `'completed'`.
- `council.ts` `amendCouncil` — recompute and return a terminal state, same quorum rule as `runCouncil`.
- `index.ts:1246` — still save (the record is needed for amendment) but pass the state to `shareRun`, and have `brain.ts` either skip or explicitly mark `failed`/`cancelled` runs in `dsh-runs.md`.
**Effort:** moderate; touches four files, all mechanical, existing tests should cover the shape.
**Verify:** `node -e` over `~/.dsh/council-runs/*.json` after one run — the record has a
`terminalState`; amend it; re-read and confirm the state is still there and `schemaVersion` is
still 2. Then check `dsh-runs.md` shows the honest state on the line.

### P3 — Vote resolution against candidates only
**Kills:** run 2 entirely — the mis-attributed vote, the failed seat winning, and a 72-char OAuth
error being served as the council's answer. This is a correctness bug, not a robustness one: the
council reached a decidable verdict and the parser inverted it.
**Where:** `council.ts:1058` — pass the **usable** drafts' seats, not `active`, into `parseReview`.
`council.ts:428` — require a whole-token match and prefer the **longest** matching id (so
`free-claude` beats `claude`), rather than first-substring-wins in roster order. Delete or
tightly restrict the "first seat named anywhere in the prose" fallback at `council.ts:435-447`;
an unparsable review should be a null vote, not a guess. `council.ts:1092` — look the winner up in
`usable`, not `drafts`; a winner not in `usable` is a bug and should force `partial`.
**Effort:** small, and `parseReview` is already exported, so it is directly unit-testable with no
spend at all.
**Verify:** a unit test feeding `VOTE: free-claude` against a roster whose first entry is `claude`
and asserting the vote resolves to `free-claude`. Then re-run `tally` over run 2's recorded
reviews offline and confirm the winner becomes `free-claude`, not `claude`.

### P4 — Preflight that tests seats, not sockets, and blocks before spend
**Kills:** the recurring dead 8080 (§2 R1), the expired OAuth, the never-signed-in agy seats, and
the SambaNova 402 — all four (§2 R2).
**Where:** extend `seats.ts:probeSeat` into a `seatHealth(seat)` returning
`{ ok, reason, cost: 'free' | 'metered' }`, layered cheapest-first:
1. loopback TCP (existing, ~1 ms),
2. filesystem credential checks — the agy token test already written at
   `agy-headless.mjs:711`, and the equivalent for the `claude` seat's `claude-seat-home`,
3. an HTTP `GET /v1/models` or `/health` on any local baseUrl (FCC already answers both),
4. a one-token completion **for free/unmetered seats only** (`seat.free === true`), which is the
   only thing that catches a 402 behind a healthy proxy.
Then in `council.ts` before the plan round: if any seat is unhealthy, put a blocking summary at
the top of the plan-gate report — *"3 of 8 seats cannot answer: openrouter-free (proxy on 8080 not
listening), claude (OAuth expired), agy-flash (seats 5 and 6 never signed in). Approve to run with
5."* — and refuse outright when healthy seats < `minDrafts`. Persist the result to
`~/.dsh/seat-health.json` so the next session sees it without paying.
**Effort:** the largest item. Layers 1-3 are cheap and free; layer 4 needs care about which seats
are safe to ping.
**Verify:** with 8080 down, start a council run and confirm it stops at the gate naming the port,
having spent nothing; start the proxy, re-run, confirm the seat is live.

### P5 — Bounded attempts and a terminal give-up state
**Kills:** L1, L2, L5 (§3).
**Where:** add to `PipelineState` (`pipeline.ts:130-165`) three counters — `holds`, `reworks`,
`restarts` — persisted with the rest of the state.
- `pipeline.ts:361`: at `MAX_CONSECUTIVE_HOLDS` (3) return `phase: 'blocked'` with
  *"parked N times without progress; the allowance is not coming back on its own"*. Reset the
  counter only when a stage actually completes — that is the **monotonic-progress** requirement,
  and it is what stops a permanently-429 seat parking forever.
- `pipeline.ts:399`: at `MAX_REWORKS` (2) stop the cycle and surface the reviewer's objections for
  a human decision instead of looping.
- `index.ts:1634`: count restarts on the state; past 2, require the user to say so explicitly
  rather than accepting the model's `restart: true`.
- `journal.ts`: record failed attempts per `(journalKey)` — not the errors, just a count — and
  refuse to re-ask a key that has failed 3 times inside the 24 h window with the same routing.
Precedent for the shape already exists in the user's own tooling: `fcc-status.json` carries
`recoveryAttempts: 0, recoveryLimit: 3`.
**Effort:** moderate. The counters are the easy part; the discipline is deciding what counts as
progress.
**Verify:** point a seat at a port that 429s (or stub `runStage` in the existing chain tests),
call `pipeline` four times, confirm call 4 returns blocked rather than held, and that the report
names the counter.

### P6 — Normalise cancellation and failure text at the boundary
**Kills:** §2 R3 — `{"kind":"user"}` / `"aborted"` / `"cancelled by user"` as three names for one
event, and the string-equality test at `council.ts:1016` that only recognises one of them.
**Where:** `errors.ts` — add a `classifyFailure(error): { kind: 'cancelled' | 'unreachable' |
'auth' | 'billing' | 'quota' | 'oversize' | 'timeout' | 'other', text: string }`. Map `"aborted"`,
`"AbortError"`, `kind:'user'` → `cancelled`; `PAYMENT_METHOD_REQUIRED` / `HTTP 402` → `billing`;
`OAuth session expired` → `auth`; the existing `UNREACHABLE` regex (`council.ts:497`) →
`unreachable`. Store the kind alongside the text on `SeatReply` and branch on the **kind**
everywhere, never on the string. `council.ts:1016` becomes
`drafts.some(d => d.kind === 'cancelled')`.
**Effort:** small-to-moderate; `errors.ts` already has the shape and the `UNREACHABLE` regex
already exists. Pure unit-test territory.
**Verify:** unit tests over the six literal error strings quoted in §1 of this document, asserting
each maps to the right kind. Then confirm a Stop mid-run yields `terminalState: 'cancelled'`.

### P7 — Make agy truncation impossible to miss
**Kills:** §2 R4 — 49 % of a spec silently discarded, and the regression from a loud error to a
quiet one.
**Where:** `agy-headless.mjs:869-873` — emit the compaction facts as **structured output on the
seat reply**, not a stderr line: `{ compacted: true, originalChars, omittedChars, droppedSections }`.
In `seats.ts`, populate the `PromptMetric` that `runs.ts:70-97` already defines, and in
`index.ts:1248` actually write `promptMetrics` into the record. Then: **a compacted draft is not
usable by default.** Either refuse the call (the pre-09-15 behaviour, which was correct) or mark
the draft `degraded` so it cannot win a vote without the user saying so. `markdown.ts` should
print a `> **!**` line naming the seat and the character count.
**Effort:** small in the driver, small in `index.ts`; the type already exists.
**Verify:** send a 40 k-character prompt to an agy seat and confirm the run record contains a
`promptMetrics` entry with `compacted: true, omittedChars: ~10000`, and that the seat's draft is
marked degraded in the report rather than competing silently.

### P8 — Proportional quorum
**Kills:** run 1's honest-but-misleading `completed` (§1).
**Where:** `council.ts:1013` and `:1088`. Default `minDrafts` to `max(2, ceil(activeSeats / 2))`
and `minReviews` to `max(1, ceil(usableDrafts / 2))`, keep the explicit settings override, and
record the computed values in `quorumConfig` (already saved) so the record shows what bar was
applied. Add a distinct state or a report banner for "quorum met but N of M seats were dead".
**Effort:** trivial code; the judgement call is the fraction, which is a decision for the user.
**Verify:** re-run the 4-seat roster with 8080 still down — 2 of 4 usable should now read
`partial`, not `completed`.

### P9 — Keep 8080 alive, or stop pretending the seat exists
**Kills:** the recurrence itself, as opposed to the detection of it.
**Where:** outside the harness. Either give the OpenRouter proxy the same treatment FCC has
(`~/.dsh/fcc-control.ps1` + `fcc-status.json` + the 30 s monitor with `recoveryLimit: 3`), started
from `launch-dsh.cmd`; or set `openrouter-free.enabled: false` in `settings.yaml` until it has one.
`handoff-dsh-model-choice.md:29` already diagnosed why it dies: it was started from a Claude Code
background task and DSH's launcher does not start it.
**Effort:** small — `fcc-control.ps1` is a working template sitting next to it.
**Verify:** `netstat -ano | findstr :8080` shows a listener after a cold DSH launch; kill the
process and confirm the monitor brings it back within 30 s and stops after 3 attempts.

---

## 6. Open questions for the user

1. **The council sources are uncommitted.** `git status` shows ` M` on `council.ts`, `errors.ts`,
   `index.ts`, `pipeline.ts`, `runs.ts`, `seats.ts`, `bin/agy-headless.mjs` and their tests, on
   `feat/heterogeneous-teammates`. The deployed `lib/index.js` is built from them. Should the
   forensic baseline be the working tree (what actually ran) or the last commit? Everything above
   is measured against the working tree.
2. **Truncate or refuse?** Before 2026-09-15 an oversize agy prompt was a hard error; now it is a
   silent 49 % cut. Run 3's own spec says *never silently truncate*. Which do you want —
   refuse the seat, or compact loudly and mark the draft degraded (P7)?
3. **What fraction is a quorum?** I propose `ceil(seats/2)` drafts and `ceil(usable/2)` reviews
   (P8), but on a 4-seat roster with two chronically dead seats that means no run ever completes.
   The alternative is to size quorum against *healthy* seats after the P4 preflight, which is
   honest about the roster but lets a 2-seat council call itself complete.
4. **May a free seat be pinged before a run?** P4 layer 4 is the only check that catches the
   SambaNova 402, and it costs one token on an unmetered seat. Your standing rule is nothing
   without permission — I have not built it and would not without a yes.
5. **Restart as a model-callable argument.** `index.ts:1520` lets the model abandon a run and start
   over. Run `39e8f161` shows it being used. Should `restart` require a user turn, the way plan
   approval already does (`judgeApproval`, `index.ts:1021`)?
6. **Should a failed run reach the shared brain at all?** Run 3's 0/7 line is in `dsh-runs.md` on
   every machine. Suppress, or keep with an honest state label?
7. **The `claude` seat.** It is `enabled: false` in `settings.yaml` now but was on for run 2, where
   its expired OAuth cost 34 s and then won the vote through the parser bug. Re-enable after P3
   and P4 land, or leave it off?
