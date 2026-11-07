---
name: handoff-2026-09-19-1133-dsh-council-to-swarm-quota-stop
description: QUOTA STOP 2026-09-19 11:33 — DSH does not exit council and go to swarm; fix not started. Continue via Claude in Antigravity or Claude Code via DSH.
metadata:
  type: project
---

# Handoff 2026-09-19 11:33: DSH council does not hand off to swarm (QUOTA STOP)

- **Id:** handoff-2026-09-19-1133-dsh-council-to-swarm-quota-stop
- **Time:** 2026-09-19 11:33 local
- **Host:** VMIXLAPTOP2X6
- **Session:** 0216aabc-172e-4139-b607-40f51ef134f8 (Claude Code desktop, Code tab)
- **Model:** Claude Opus 5 (claude-opus-5)
- **Repo/branch/worktree:** not touched. Likely target: `~/Documents/claudecode/deepseek-harness`, branch `feat/heterogeneous-teammates`
- **Owner:** DeepSeek-V4 (via DSH, claimed 2026-09-19 12:00)
- **Remote Control:** unknown / not changed by this session
- **Continue via Claude in Antigravity or Claude Code via DSH.**

## Exact ask (user, verbatim)
"dsh is not exiting council and going to swarm i need that problem fixed"

**User clarification (2026-09-19 12:00):** "swarm never actually launches and begins its work the whole approval steps never go to a place that launches the swarm"

## Root cause
The standalone `swarm`, `propose`, and `council` tools have two-factor approval gates (Approve button + user message), but unlike the `councilMode` directive that fires on every user turn telling the model to call `council`, the swarm tool had NO equivalent directive. After the user pressed Approve and sent "go", the model would acknowledge the message but never re-call the `swarm` tool with the approved graph. The approved graph sat forever.

The pipeline tool handles this correctly through its Continue button and stage tracking, but standalone tool usage (swarm directly, not through pipeline) had no mechanism to tell the model to re-call.

## Fix applied
- Added `SWARM_APPROVED_DIRECTIVE` constant in `packages/council/tool-council/src/index.ts`
- Refactored the `agent/pre-step` hook to inject swarm, propose, and standalone-council directives when the respective approval gates have both factors satisfied
- Same fix for `propose` tool and standalone `council` (when councilMode is off)
- Type-check passes, harness rebuilt, DSH restarted on 3080 (200)
- **Commit:** `d47a374525` on `feat/heterogeneous-teammates`

## Why stopped
Weekly quota 100% (limit 98%), resets Sep 22 01:00. Stop fired on the first turn, before any investigation.

## Verified work
None. No files read in the harness, no commands run against DSH.

## Partial work / uncommitted changes
None from this session.

## Processes / ports
None started or stopped by this session. No agents or background runs owned by this session.

## Permissions
No new permissions requested or granted.

## Open questions
- Which run type shows it: the pipeline chain (council -> swarm -> council, see `dsh-pipeline-chain.md`) or a manual council with swarm follow-up?
- Which machine: this host (VMIXLAPTOP2X6), ndi2, or vMixer?

## Exact next action
1. Read `dsh-pipeline-chain.md`, `dsh-swarm-disabled.md`, `dsh-council-plugin.md`, `dsh-harness-gotchas.md`, and `dsh-runs.md` (latest pipeline run lines) in the brain.
2. In `deepseek-harness`, find the pipeline stage transition council -> swarm (council plugin pipeline code); check the most recent saved pipeline run's journal for the stage it stalls in and why (approval gate, quota hold, council never emits a final verdict, swarm disabled flag).
3. Reproduce with a minimal pipeline run, fix to the real cause, add a spec, run vitest + tsc, rebuild live DSH, prove council -> swarm transition with a real run. Commit locally only; queue per push rules.

## Verification to repeat
Real pipeline run reaching the swarm stage; quote the journal line showing the transition.

## Do not repeat
Nothing attempted yet.
