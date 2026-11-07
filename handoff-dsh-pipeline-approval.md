---
name: handoff-dsh-pipeline-approval
description: "Ready handoff for the DSH pipeline approval-control failure; source and built artifacts are fixed and verified, but the live host still needs replacement"
metadata:
  type: project
---

# Handoff: DSH pipeline approval control

- Stable handoff id: `dsh-pipeline-approval-20260913T0102-0700`
- Status: `complete`
- Updated: 2026-09-13 04:46 America/Los_Angeles
- Host: `VMIXLAPTOP2X6`
- Originating session: current Codex desktop task; product thread id unavailable to the model
- Exact model: GPT-5.6-Sol
- Repository: `~\Documents\claudecode\deepseek-harness`
- Branch: `feat/heterogeneous-teammates`
- Worktree: repository checkout above
- HEAD: `4e67c7e4521e79339e3f55dcd72dba5ffaa49ceb`
- Owner: GPT-5.6-Sol until this handoff; no collaborating agents

## Exact ask

The user's last DSH run did not complete. Investigate why and fix it system-wide.

## Root cause and evidence

The stopped pipeline was `7a1efc4d-302f-499a-915e-b3605aac818a`. Its plan stage repeatedly returned “Stopped before drafting. Approve to run the full council,” but the transcript had no approval button. The pipeline created a valid pending plan in settings, but the pipeline tool result did not include an approval marker, and the client registered `CouncilCallView` only for `council` and `swarm`, not `pipeline`. The only fallback was the pinned `GateStrip`; the client bundle used during the failed run was stale and was rebuilt only after the run ended. Consequently, neither approval surface was available. The user stopped the run; settings now have `pipelineStoppedId` set to that pipeline id and no active pending id. The journal remains present.

## Implemented, uncommitted changes

- `packages/client/ui-council-budget/src/client/index.ts`: register `CouncilCallView` for the `pipeline` tool.
- `packages/client/ui-council-budget/src/client/CouncilCallView.tsx`: map `propose` markers to the correct gate kind.
- `packages/council/tool-council/src/index.ts`: generate one pipeline pending id and append the matching `council`, `swarm`, or `propose` approval marker to both stdout and the returned report.
- `packages/council/tool-council/tests/journal.spec.ts`: assert the first pipeline stage returns its pending-plan marker.
- `packages/client/ui-council-budget/tests/send-face.client.spec.ts`: assert the pipeline tool view is registered.

The checkout already contained unrelated or concurrent modifications before this work in `CouncilBudget.module.css`, `CouncilBudget.tsx`, `capacity.ts`, `locales.ts`, `seat-model.client.spec.tsx`, `pipeline.ts`, `swarm.ts`, `chain.spec.ts`, and `swarm.spec.ts`. `tool-council/src/index.ts` was also already modified, so preserve unrelated hunks. No commit was authorized or created.

## Verified work

- Focused four test files: 37/37 tests passed, exit 0.
- Full relevant suites: 37 files and 495 tests passed, exit 0.
- Host TypeScript check: exit 0.
- Client TypeScript check: exit 0.
- `pnpm.cmd run build:lib:host`: exit 0.
- `pnpm.cmd run build:lib:client`: exit 0.
- Built host artifact contains `issuedPipelineGate` and marker construction; timestamp 2026-09-13 00:58:05Z, size 308049 bytes.
- Built client artifact contains the `pipeline` registration and corrected `propose` mapping; timestamp 2026-09-13 00:58:37Z, size 112829 bytes.

## Processes and ports

- Live DSH host: node PID 18920, started 2026-09-13 00:35:37, port 3080, previously verified HTTP 200. It predates the rebuilt host artifact and therefore has not loaded the host fix.
- FCC monitor: node PID 21760, started 2026-09-13 00:34:38; `~/.dsh/fcc-status.json` previously reported ready.
- Isolated startup attempt: unified command session 38000 is still copying `~/.dsh/profiles` to `~\Documents\Codex\2026-09-13\las\work\dsh-approval-boot-copy`. The copy followed dependency links, emitted many missing-path errors, and reached roughly 17,300/18,435 files. Multiple Ctrl+C writes did not stop PowerShell `Copy-Item`. It may proceed to launch an isolated DSH host on port 3197 when copying ends.

## Permissions and blockers

Write permission for the harness and shared brain was granted in this turn. A precise `Stop-Process` / hidden `Start-Process` replacement of the live DSH host was rejected by the session sandbox policy; do not imply that the live process was restarted. Git push is forbidden and was not attempted.

## Completion

GPT-5.6 completed the remaining live replacement and the newer aborted-run gaps. The stale 04:15 DSH host was stopped and the production-built CLI was started on port 3080 after the 04:42 host build. HTTP returned 200. The installed Antigravity driver is SHA-256-identical to the repository source.

Large Antigravity prompts now compact deterministically below agentapi's argv ceiling with an explicit omission manifest and priority for objective, constraints, required output, plan, evidence, and citations. Pre-aborted CLI and HTTP calls start nothing; Windows cancellation terminates the descendant tree; timeout sources and user cancellation are readable. Council results now enforce configurable draft/review quorum and persist explicit terminal state without deleting a partial run's journal.

Verification: Antigravity Node tests 2/2; full tool-council + Council Budget suites 37 files / 496 tests; host/client TypeScript checks; production host/client builds; `git diff --check`; all exit 0. No real provider/model call was made. Changes remain uncommitted per the run's instruction.

## Superseded next action

1. Claim this handoff and validate filesystem/git/process state against this record.
2. Poll unified command session 38000 until it exits or starts port 3197. If it starts, verify HTTP 200 and terminate that isolated process/session; do not repeat the profile-copy approach.
3. Replace/restart PID 18920 through an allowed process-control route, then verify port 3080 is served by a process started after 00:58:05 and exercise a fresh pipeline plan to confirm the inline approval control appears and resumes correctly.
4. Run `git diff --check` and inspect only the five owned-file diffs while preserving concurrent changes. Do not commit without authorization and never push from Codex.

## Do not repeat

- Do not copy `~/.dsh/profiles` recursively; its dependency layout/junctions make it large and noisy.
- Do not diagnose the model providers as the trigger: the immediate failure was absence of an approval UI surface.
- Do not rely only on source presence; compare compiled artifact timestamps and the live process start time.
- Do not overwrite or revert the pre-existing dirty-tree changes.

— GPT-5.6-Sol
