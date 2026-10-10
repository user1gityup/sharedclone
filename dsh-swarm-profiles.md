---
name: dsh-swarm-profiles
description: "Economy vs fastest swarm profiles: the agreed design, what phase 1 landed, and the four phases left for whoever picks it up"
metadata:
  node_type: memory
  type: project
  modified: 2026-09-08T00:00:00.000Z
---

The user wants to spend fewer paid tokens without weakening the plan. The
rule that frames the whole design, stated by the user directly: **do not
change anything that would let a weaker plan win a vote.** Free models lose
plan votes because their plans are worse, and that is correct. Cost is
handled *downstream of the decision*, by who executes, never by who wins.

## The agreed design

Three modes, on a toggle and saveable to a `council.pipelinePresets` entry:

| mode | stages | execution |
|---|---|---|
| `council` | `council, merge` | none |
| `economy` | `council, merge, swarm, review` | every unit contested by free seats, winner selected per unit |
| `fastest` | `council, merge, swarm, review` | one paid seat per unit, wide parallel waves |

Plan and review are paid in **both** execution modes. Routing is **earned by
the run**, never configured by opinion:

- plan and decompose → the seat that won the vote
- UI units → the seat whose sample the user picked (`pipelinePicked`, already
  written by `GateStrip.tsx`, previously only pasted into the swarm query)
- everything else → cheapest capable seat
- review → paid

**The `merge` stage** (decided by the user, 2026-09-08): the council votes
normally, then every seat is shown the winning plan *and* the rivals and asked
to nominate specific borrowable pieces with attribution. A piece nominated by
≥2 seats is accepted; the **winning seat** then rewrites its own plan folding
those in. One author, no second vote. `select.ts`'s rule against merging —
"a vote, not a merge... a fifth version nobody wrote and nobody reviewed" —
stays in force for *code*; it does not apply to prose plans, which are
decomposed, priced and gated afterwards.

**Economy contests every unit, not just UI ones.** The user's reasoning: you
cannot claim free is cheaper for a unit unless free produced the artifact and
it was judged. This is affordable because the proposers are free seats and
free redundancy costs $0 — K free seats on one unit is 0 dollars and K× wall
clock. Per-unit selection reuses `parseReview`/`tally`, the way `select.ts`
already does.

Correction to an earlier reading: per-unit competition does **not** require
moving the `propose` stage after decomposition. It belongs inside the swarm
run, which is where the units already are — fan each unit to K seats instead
of 1. The existing whole-task `propose`/`select` stages are untouched.

## Phase 1 — landed 2026-09-08, commit `8b3558529b` (Claude Opus 5)

On `feat/heterogeneous-teammates`, **committed, not pushed**.

- `CostClass` is now `free | included | metered`; `COST_ORDER` is
  `{ free: 0, included: 1, metered: 2 }`.
- `free-claude` carries `free: true`. It could not be expressed by transport:
  it runs the same `claude` CLI as the paid seat, against the FCC proxy, so
  reading `transport === 'cli'` billed it to a subscription it never touches.
  The client `capacity.ts` split now reads the flag **before** the transport
  for the same reason.
- `ExecutionEstimate.freeCount` plus a caveat. Both a free run and a run that
  eats the month's Claude quota priced at `$0.0000` before this.
- `choosePlanner(seats, preferred, winner)` — the winner now outranks the
  "prefer an OpenRouter seat for cost transparency" default; a configured
  planner still outranks the winner. `plannerOrder` passes it through.
- The winning seat travels the pipeline like the approach does:
  `PipelineState.winner`, `StageInput.winner`, `StageOutput.winner`, settings
  key `pipelineWinner`. The **review** stage deliberately does not emit a
  winner — it runs the same council tool and would otherwise overwrite the
  seat that won the approach with whoever best critiqued the finished work.

**The bug this fixes, for anyone who doubts it was real:** `claude` and
`free-claude` were both `included`, so `assignWorkers` fell through to
`a.provider.localeCompare(b.provider)` and `claude` won every tie on its
first letter. The free seat never got work.

**Verified:** 27 test files / 423 tests pass in `tool-council` +
`ui-council-budget`; `pnpm run typecheck` exit 0; `COST_ORDER` and
`choosePlanner(seats, preferred, winner)` confirmed present in the built
`lib/index.js`, not just in source. `pnpm run lint` exits 1 with 85 errors
tree-wide — all pre-existing (`seats.ts` params, `index.ts`, `memory`,
`experimental`, client JSX deprecations); none on lines this change wrote.

**Caveat on that commit:** `roster.ts`, `seats.ts`, `index.ts`,
`capacity.ts` and `council.spec.ts` also carried uncommitted API-staging work
by GPT-6 that was already in the tree and could not be separated. It went in
with phase 1 and the commit message says so.

## Phases left

2. **`merge` stage** — new `merge.ts`: nomination prompt, parse, ≥2 threshold,
   integration prompt to the winning seat, report with attribution. Call it
   after `planVerdict` at `council.ts:864`, which is winner-takes-all today.
   Independent of the swarm; improves `council` mode on its own.
3. **Economy competition** — `profile` on `SwarmRunOptions`; fan each unit to
   K free seats; per-unit selection; capped escalation ladder (free A → free B
   → paid, cap shown at the gate); **per-unit candidate roots** in `writes.ts`,
   which is per-*seat* today (`MAX_WRITES_PER_SEAT = 6`) and would collide.
   Also `SubTask` gains `tier`/`acceptance`/`files`, profile-specific decompose
   prompts (economy: few large tightly-specified units; fastest: wave width),
   and `validateGraph` rejecting economy units with no acceptance conditions.
4. **Mode toggle + preset field + client panels** (`PipelineControl.tsx`,
   `SwarmRoster.tsx` cost-tier column). `presets.ts` is the one settings key a
   model may write; adding `mode` stays inside that constraint because a preset
   starts, spends and approves nothing.
5. **Fastest specialisation** — landed 2026-09-08, commit pending on
   `feat/heterogeneous-teammates` (Claude Sonnet 5). `assignWorkers` (roster.ts)
   takes an optional `EarnedPreference { ignoreCost?, specialists? }`. Fastest
   now passes `{ ignoreCost: true, specialists: Map(['code', options.winner]) }`
   from `swarm.ts` whenever a plan-vote winner is known: cost class drops out
   of the ranking entirely (fit + least-loaded only) and the winning seat gets
   first refusal on `code`-kind units, ahead of load balancing, before falling
   through to fit+load like every other kind. `picked` (UI-tier routing) was
   already fully earned via the existing `named`/`task.provider` override in
   `routed`, so it needed no change here. No static per-model kind opinions
   were added — both signals are read from the run (`options.winner`,
   `options.picked`), never hardcoded.

All five phases are now landed on `feat/heterogeneous-teammates`. Nothing has
been pushed.

**Caveat on phase 5, worth carrying forward.** The `winner` signal only
reaches `runSwarm` through the `pipeline` tool's `PipelineState.winner`
(`index.ts` line ~1545) — the standalone `swarm` tool has no `winner`
argument and never reads `pipelineWinner` from settings, so a bare swarm call
in fastest mode gets the cost-ignoring/load-spreading half of phase 5 but
never the specialist routing half. Exercising the specialist half live means
going through a real `pipeline` run (council round decides the winner, then
the swarm stage inherits it) — not done this session; the specialist routing
itself is proven at the roster level (`roster.spec.ts`) and at the swarm
level with a mocked winner (`swarm-profiles.spec.ts`), not yet against a real
council vote end to end.

**Verified live 2026-09-08 (Claude Sonnet 5), via the bare `swarm` tool
against real seats** (a throwaway cordis harness booting only the plugins the
tool needs — `sessions/agents/prompt/tools/web/settings/council` — with
`autoApprove: true`, no mocks): an economy round with `free-claude` (real FCC
proxy on :8082) and `openrouter-free` (real python proxy on :8080) as the two
free contestants and `deepseek` as paid reviewer produced "2 + 2 equals 4."
and `ACCEPT: yes` in 35.6s. A fastest round with `kimi` and `deepseek` as the
only two paid seats split a two-unit request into one wave, each unit
answered by a different seat and both passed paid review, in 12.4s. A first
fastest attempt on a code-flavored query failed as designed —
`Candidate files require approved workspace staging and source roots` — the
live decomposition named a target file and this harness never mounted
`fs`/`sandboxPolicy` or granted workspace-write, so file-writing units are
correctly refused rather than silently dropped; this is the existing,
already-tested staging gate, not a phase-5 regression.

## Two things to keep saying out loud

- **Economy is slow, not just cheap.** `free-claude` carries
  `timeoutMs: 420_000` because FCC retries through 529s; K free seats per unit
  per wave multiplies that. The gate must say so.
- **Economy's honesty rests on the paid review stage.** Free candidates judged
  by free voters can agree on something wrong. Review is not optional there.

Delete `decomposePrompt` (`decompose.ts:52`) when convenient — it is dead
code, never called; `swarmQuery` in `index.ts:2059` does its job.

See [[dsh-swarm-disabled]], [[dsh-pipeline-chain]], [[dsh-council-plugin]],
[[free-claude-code-setup]].
