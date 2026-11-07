---
name: dsh-pipeline-chain
description: The council → swarm → council chain as one resumable tool, its quota hold, and the button that restarts it
metadata:
  type: project
---

Built 2026-09-04, commit `c8ce344` on `feat/heterogeneous-teammates`, pushed.

**`pipeline` tool** (`packages/council/tool-council/src/pipeline.ts`) runs three
stages — council agrees the approach, swarm splits and runs it, council reviews
the output. **One call advances one stage**, and each stage still passes its own
tool's existing gate; the pipeline adds no approval of its own. Stage, plan,
approved graph and unit results live in the `council` settings namespace as
`pipeline*` keys, so the chain survives a session, not just a turn.

**Quota hold, not failure** (`src/quota-hold.ts`): a seat that runs out of
allowance parks the run. `isQuotaExhausted` separates exhaustion ("usage limit
reached", HTTP 429) from faults it would be wrong to wait on (no API key, 401).
Reset time is taken from the provider's own wording, bounded to 8 h, defaulting
to 30 min when none is stated; a stated time already past resolves to tomorrow.
While held **no seat is called at all**, and the approved graph survives, so
resuming costs no second planning call. The status line's cache file can release
a hold early, never extend it.

**The button** (`PipelineControl.tsx`, dock slot `pipeline-control`, order 7):
type the request, press Run. It shows the exact prompt it will send before
sending it, and while held it counts down and sends the continue prompt **once,
by itself**, when the window rolls over. That self-restart is why the run holds
rather than fails.

Tests in `tests/chain.spec.ts` (21). Note the name trap: `tests/pipeline.spec.ts`
was already taken by the council end-to-end smoke test — it was overwritten
once during this work and restored from HEAD. See [[dsh-swarm-disabled]] for the
swarm underneath, and [[dsh-council-plugin]] for the gate design being reused.

## Saved runs and the naming convention (2026-09-04, commit `7665c14`)

Presets live in `~/.dsh/settings.yaml` under `council.pipelinePresets`, keyed
**`area/name`** — `dsh/gate-audit`, `web/ship-landing`. The panel sorts by id,
so areas group themselves, and the area rides on the pill as a chip. Each entry
carries `name`, `query` (the whole request, written once), and `autoAdvance`.
`autoAdvance` sends the continue prompt once per stage, never while held, and
clears itself when the run ends; it does **not** touch approval — unless
`autoApprove` is on, every stage still stops at its gate.

Seeded example: `dsh/pipeline-smoke`.

**Three bugs found debugging before the first live run**, all fixed in the same
commit: the control's send used the plugin ROOT context, where
`conversation.send` throws by design (the slot frame hands a session id — resolve
`ctx.sessions.scope(sessionId)`, as ui-input-trigger does); neither stage retired
the approval that authorised it, so one press could carry the next stage too;
and a blocked run had no way back from the panel (Start over added).

Verified in the running app on `http://localhost:3080` — panel renders above the
composer with the preset pill. Never clicked: a press spends.

## Stop run — a way back to the saved runs (2026-09-12, uncommitted)

While a run exists the panel hides the saved runs and the request box, and the
only exits were Continue and Start over — both PROMPTS, so a session that could
not take a turn (or a held run, which offered only Resume now) left no way back.
`PipelineControl.tsx` now has **Stop run** on the running row and the held row.
It sends nothing: `stopWrites(id)` clears every `pipeline*` run key, the hold,
and the pending/approved gate ids to empty sentinels (revokes only, never
approves), writing `pipelineStoppedId` first. Each write is tried on its own so
a host that refuses one key still clears the run.

Host side, `stoppedDuring(runId, live().pipelineStoppedId)` in `pipeline.ts`
skips the write-back when a stage that was already in flight returns after
Stop, which would otherwise resurrect the run. That guard needs the DSH host
restarted to load; the button itself works on the old host (proven: the stuck
run `d4988e5c` was stopped on `:3080` at 15:49 and the panel showed Saved runs).
Tests: `pipeline-control.client.spec.tsx` (Stop suite), `chain.spec.ts`,
`config.spec.ts`.

## `save_pipeline_preset` — the one settings key a model may write (commit `5927da7`)

Model-facing tools are otherwise shut out of settings, which is the only reason
the approval gate holds. Presets are the deliberate exception: a preset is text
the user later chooses to press, so it starts, spends and approves nothing.
`src/presets.ts` can express **only** a new preset map, and the tool writes only
`pipelinePresets` — no approval slot is reachable from that path by construction.

Enforced, not documented: id must be `area/name` lowercase kebab; an existing id
needs `replace`; query capped at 4000 chars; the write is read back before it is
reported. `remove: true` deletes one.

In DSH: "save that as a preset called dsh/gate-audit" now works from inside the
session — no editing `settings.yaml` by hand.

## Resume after an abort — seat-answer journal (2026-09-12, uncommitted)

A stage cut off mid-way used to lose everything: state reached settings only when a stage returned. Now `pipeline` writes the run id before a new stage spends, and `src/journal.ts` records each successful seat answer (key = seat routing + exact prompt) under the run id; `council` uses sha256(question). Re-entering the same stage/question hands recorded answers back from `askSeat` without calling the seat, so only missing seats are asked. 24 h age limit, discarded when the run finishes or restarts. Tests: `tests/journal.spec.ts`.
