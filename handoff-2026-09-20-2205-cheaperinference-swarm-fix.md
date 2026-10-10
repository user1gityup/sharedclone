---
name: handoff-2026-09-20-2205-cheaperinference-swarm-fix
description: DSH pipeline routing and source-root fixes live; CheaperInference implementation still unbuilt and stopped.
metadata:
  type: project
---

# Handoff — CheaperInference swarm failure

- Time: 2026-09-20 22:05 PDT; host vmixlaptop2x6.
- Owner: GPT-6, Codex desktop task 01a0c222-5a3e-7343-8725-f38b66e5bfe7. No collaborating agents. Ownership released for handoff.
- Workspace: ~/Documents/Codex/2026-09-20/c-users-ndi2-claude-shared-brain-3.
- Repository: ~/Documents/claudecode/deepseek-harness; branch feat/heterogeneous-teammates; HEAD e67a9f47b307dff1de4aad53055138e939ebd920.
- Exact ask: "i ran the cheaperinfernce and it didn't produce swarm to complete it review and fix no commentary just fix". Latest request: handoff.
- Remote Control off/not used. Native computer-use inventory was read; no UI action performed. No background test or build remains. No commits, queue entries, or pushes created.

## Verified findings and fix

The actual failed DSH session is session-b72bb178-aa60-4f05-bf89-657421258c56 under ~/.dsh/sessions/--C-Users-ndi2-Documents-Harness~0020Build--. Session JSONL is concatenated Zstandard frames; Node zstdDecompressSync reads one frame at a time, so iterate with info:true and engine.bytesWritten. Decoded evidence is in this task's work/session-b72bb178-aa60-4f05-bf89-657421258c56.jsonl.

1. The saved pipeline request at sequence 7 was overridden by the injected Council mode directive; sequence 47 called standalone council. Pipeline state therefore did not own the work.
2. The later swarm at sequence 2789 reported 0/8 units. All independent units failed with "Candidate files require approved workspace staging and source roots." The persisted fileRoots setting was correct, but the tool read config.fileRoots from the plugin base rather than current settings.
3. That failed report incorrectly said "Swarm — done".

Applied: explicit pipeline launch/continue/advance messages take precedence over standalone Council mode; active pipelines do not fall through to standalone approval directives; council file-root consumers use current settings; failed swarm reports say incomplete. Existing two-factor and workspace-write gates remain intact. No approval or saved run state was synthesized or rewritten.

## Uncommitted files

- packages/council/tool-council/README.md
- packages/council/tool-council/src/index.ts
- packages/council/tool-council/src/swarm.ts
- packages/council/tool-council/tests/__snapshots__/swarm-composition.spec.ts.snap
- packages/council/tool-council/tests/swarm-composition.spec.ts
- packages/council/tool-council/tests/swarm-profiles.spec.ts
- .agents/notes/implemented/bug-fix/2026-09-20-pipeline-routing-and-swarm-roots.md (untracked)

Fresh git status at handoff matches this list. Preserve these edits.

## Verification and deployment

- Focused Vitest: 6 files, 77/77 tests passed, exit 0. Files: swarm-composition, swarm-profiles, swarm, pipeline, approval, staging. Includes Loader composition, pipeline routing under Council mode, retained approval checks, and real sandbox candidate-file writes using only persisted source roots. Models were mocked; no metered calls.
- Host TypeScript compilation and tsdown host build both passed, real final exit 0. Built lib/index.js inspected for all fixes. SHA256 91FE08574432CD5E8779FD2A041E1B7D278DCEE81668BAD652C90ACA474021E0.
- git diff --check passed (CRLF warning only).
- Logs: work/verification.log and work/build-host.log in this Codex workspace.
- Shell could not stop old DSH PID 4624: Windows Access denied. Packaged outputs/Restart-DSH.cmd with restart-dsh.ps1 and compiled digest; exact .cmd -CheckOnly passed.
- User subsequently ran the helper. outputs/dsh-restart-result.txt verifies restart, HTTP 200, compiled digest above, launcher PID 29560. Fresh HTTP check returned 200. Helper logs report Free Claude and OpenRouter Free health verified and DSH at http://127.0.0.1:3080.
- The fix is deployed. Do not repeat the old claim that restart remains blocked. Actual live CheaperInference generation through the fixed path has NOT been run; only mocked composition and real file staging were verified.

## Remaining work and next action

CheaperInference provider/seat/budget implementation is still unbuilt. The DSH pipeline is stopped: latest settings show pipelineId and pipelineStage empty; pendingSwarmId and approvedSwarmId empty; pipelineStoppedId 97c31c93-d79a-4e00-864a-59628342228d. Saved dsh/cheaperinference-seat-budget remains the intended council,swarm,review run. Its own gates require user button action and a subsequent user message. Do not manufacture approval or silently start paid work from this handoff.

Next owner should verify live host/build digest and these local diffs, then help continue the saved run when requested and genuinely approved. Inspect the generated graph before execution: the failed planner invented src/providers and src/ui paths, whereas this repo uses packages/. The old handoff's e67a9f commit was a writer-route proof, not CheaperInference implementation; seats incorrectly treated it as ongoing feature work. Make that distinction clear in any future run context.

Budget scope is still unresolved: saved brief covers CheaperInference pricing/usage/balance integrated with existing DSH views, not a new all-provider budget system. Local Llama inference remains externally dependent. The old run's candidate work produced no implementation files.

## Permissions and do-not-repeat

Runtime grants were needed for the repository, ~/.dsh, and shared brain. .agents is a protected carveout: granting just its child note folder caused exec launch failure; granting the whole repository .agents directory resolved it. A new task must request its own exact runtime grants as necessary. Windows process control was denied despite file grants; the user-run restart is now complete.

Use git -c safe.directory=~/Documents/claudecode/deepseek-harness for read-only git commands in the sandbox. pnpm exec vitest failed to resolve its shim; node node_modules/vitest/vitest.mjs works from the repository cwd. Do not run the tests from the Codex scratch cwd. Host build used node node_modules/typescript/bin/tsc -b tsconfig.host.json followed by node node_modules/tsdown/dist/run.mjs --env.DSH_BUILD_FACE host, preserving each exit code.

No automatic push. Follow shared gatekeeper policy if later authorized to finalize/queue. Do not rerun prior paid councils to reproduce these already-established defects. Do not claim the CheaperInference implementation or live full pipeline is complete.

Related: [[handoff-2026-09-20-1538-agent-permissions-dsh-ui-cheaperinference]].
