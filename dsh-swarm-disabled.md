---
name: dsh-swarm-disabled
description: "Swarm/agent-team work: why it was disabled, and the 2026-09-03 local re-enable for debugging — what that proved and what is still missing"
metadata: 
  node_type: memory
  type: project
  originSessionId: be428cdb-8d94-4adb-8bc9-22d446db25cf
  modified: 2026-09-03T00:00:00.000Z
---

Parallel-execution ("swarm") support was built on 2026-09-01 and then **deliberately disabled**. The user asked for it off until it works properly, and it must not ship or be published in that state.

**What exists, built and tested:** per-teammate provider selection (`spawn_teammate` takes a `provider`, `list_providers` lists them, an unknown name is refused with the valid list) with 5 passing tests that spawn real teammates on different providers concurrently. Plus `decompose.ts` (a decision → validated task graph, rejecting cycles, self-deps, dangling refs, unstartable graphs), `roster.ts` (assignment with subscription workers preferred on ties), and `execution-cost.ts` (prices a decomposition before it runs; unpriced workers are counted, never treated as free).

**What is disabled:** `agent-team`, `tool-agent-team` and `subagent-claude-code` carry `disabled: true` in `packages/bundle/base/cordis.patch.yml`, and the swarm switch and roster panel registrations are removed from `ui-council-budget/src/client/index.ts`. Mounting the team exposes `spawn_teammate` to the model, which could then create workers unasked.

**Why it is off — four things must be true first:**
- the council does not hand work to the swarm; the chain is unwired
- there is no execution approval gate, so nobody approves a task graph before workers run
- it is unknown whether a worker's approval request can reach the user's screen; the approval seam is **fail-closed**, so workers may stall silently
- proven only against in-process `spawn`/`fork` providers, never a real Claude Code subprocess, and never on work that writes files

**One genuinely good property, established by reading the code:** teammates each get their own session, and `permission/preset` is a per-session event folded from that session's own log. An empty log falls back to the composition default (`read-only`). So a teammate does **not** inherit an escalated Lead — one approval cannot authorise a crowd of writers.

**How to apply:** to re-enable, restore the two slot registrations in the client index and remove the three `disabled: true` lines. Do neither until the four points above are addressed. See [[dsh-council-plugin]].

## Re-enabled locally on 2026-09-03 for debugging (uncommitted)

The user asked to turn it on and see how it works. Working tree on
`feat/heterogeneous-teammates`, not committed:

- the three `disabled: true` lines removed from `packages/bundle/base/cordis.patch.yml`
- the `swarm-toggle` and `swarm-roster` slot registrations restored in
  `packages/client/ui-council-budget/src/client/index.ts`
- `tsconfig.base.json` gained the path mappings that were missing all along:
  `packages/council/*/src`, `packages/memory/*/src`, and explicit entries for
  `dsh-client-ui-council-budget` and `dsh-client-ui-openrouter-monitor`.
  `verify-cordis-config` was failing on those four before the swarm work was
  touched; it now reports 130 config files passed.

Booted from source, rebuilt `build:lib:client` and `build:web`, 200 tests pass.
The toggle and roster render correctly.

**Three findings that change the original four-point list:**

1. The chain is still unwired, now confirmed rather than assumed. A call-site
   grep for `swarmMode`, `decomposePrompt`, `parseDecomposition`, `assignWorkers`,
   `estimateExecution` and `executionWaves` outside tests returns only the two
   React components and the settings schema. Flipping the toggle changes nothing.
2. The Claude Code worker does not stall — it denies. `subagent-claude-code/src/run.ts`
   installs `canUseTool` returning `behavior: 'deny'` with a diagnostic, plus
   `onElicitation: decline`, `onUserDialog: cancelled`, and `AskUserQuestion` in
   `disallowedTools`. The silent-stall worry applies to `spawn`/`fork` teammates
   instead; `agent-team` carries no permission code at all.
3. `SwarmRoster.tsx` hardcodes `claude-code`, `codex`, `spawn` despite its own
   comment claiming absent providers are never offered. This host registers only
   `spawn`, `fork` and `claude-code` — so it shows an OpenAI worker that cannot
   run and hides `fork`. Host-side `defaultRoster(available)` filters correctly;
   the client copy does not. Same client/host drift as the budget panel.

**Still missing:** the council-to-swarm hand-off and the execution approval gate.
While the mounts are live, `spawn_teammate` is visible to the model in every DSH
session, not only when the toggle is on.

Wiring order when it is picked up: `runCouncil` result, then
`decomposePrompt`/`parseDecomposition`, then `assignWorkers`, then
`estimateExecution`, then the execution approval gate reusing `approval.ts`,
then `executionWaves` spawning per wave.

## Shipped 2026-09-04, gated — this note's "disabled" framing is now history

Commit `2c041a7` on `feat/heterogeneous-teammates`, pushed to the private fork.
The swarm no longer uses teammate providers at all: **workers are the council's
seats**. `seatRoster(seats, overrides)` derives the roster from configured
seats (cli = `included`, openrouter = `metered`), the client derives the same
list from `capacity.ts`, so the client/roster drift in finding 3 above is gone.
`runSwarm` decomposes the request directly — no council debate needed first —
and blocks at four points before spending, after at most one planning call.

**The execution gate exists.** `swarm` is its own tool with its own
`pendingSwarm*` / `approvedSwarm*` slots, reusing `judgeApproval` and
`planExpired`: button press plus a later user turn, single-use, 15-minute TTL.
A council approval cannot authorise a worker graph. The approved graph is
stored and run verbatim, never re-planned.

`agent-team`, `tool-agent-team`, `subagent-claude-code` and the new
`subagent-free-claude` are back to `disabled: true` — the 2026-09-03 debugging
re-enable was still in the tree and would have shipped `spawn_teammate` to the
model. Restoring those four flags was the fix made before this push.

Also in that commit: `quota-claude` host plugin and `ui-claude-quota` panel,
reading the status line's cache at boot and calling `/usage` only on a press.

**Test state, honestly:** the four changed packages are green (277 tests). The
whole-tree run shows 60 failures elsewhere, chiefly
`workflow-worker-thread.spec.ts`; unrelated to this change and uninvestigated.
