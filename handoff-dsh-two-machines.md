---
name: handoff-dsh-two-machines
description: Coordinate vMixer and VMIXLAPTOP2X6 so both DSH installations share the intended code and memory; inspect vMixer first.
metadata:
  type: project
---

# DSH on two machines — GPT-6 handoff, 2026-09-12

The user wants both running machines to have the same DSH and shared brain. The user will start an agent on vMixer and point it at this note. This authorizes inspection and coordination toward that task, not a push, credential overwrite, or replacement of live session data. Whether matching DSH also includes full conversation history and complete saved-run records remains unanswered. Do not assume the separate team-platform/PM proposal is approved.

## Update 2026-09-12 20:45 PDT - Claude Opus 5 (vmixlaptop2x6), handoff at 95% weekly quota

Ask: "dsh on the other machine still does not match this machine, can we get that going; the gatekeeper sent messages saying the directory didn't exist because they were sent to this machine."

Done, with evidence:
- Gatekeeper popups: cause was vmixer2o2's queue entry (`~\...`) read by this machine's Gatekeeper.ps1. `queue-build.mjs` writes `Host:`; `Gatekeeper.ps1` skips other machines' requests and ignores push-requests.md when pushing the brain itself. Shipped in brain `.sync/gatekeeper/`, installed by `install`. -CheckOnly real queue: "1 for another machine (left alone)"; queue-build tests 5/5; selftest 176/176.
- Harness 4e67c7e452 (Stop run + journal + model choice) committed after tsc exit 0 and vitest 484/484, pushed through the PowerShell gatekeeper with user approval (receipt: verified remote).
- `.sync/UPDATE-DSH.cmd`/.ps1: brain sync+install, harness fast-forward (refuses dirty/diverged), pnpm install if lockfile changed, `pnpm run build`, restart stale gatekeeper monitor, restart DSH. install places `Desktop\UPDATE-DSH.cmd` where ~/.dsh exists. Fixture runs: behind-by-one exit 0, dirty exit 1, diverged exit 1; real checkout "already at the remote".

Half-done / open:
- Brain commit + queue of these changes: see shared-agent-log for whether it landed. Until the brain is pushed, vMixer has none of this.
- dsh-council-plugins 2892eae queued; PowerShell gatekeeper refuses it (no pre-push hook). Claude git-gatekeeper at session end.
- Stale open queue entry `Head 066bfad` (brain) and harness entry 4e67c7e (already pushed) need closing by a gatekeeper.
- Running monitor PID 32500 (started 20:27) predates the last Gatekeeper.ps1 edit (brain-queue exclusion); restart it.
- UPDATE-DSH full build path never exercised (needs a behind checkout). vMixer's harness checkout state unknown: if dirty or diverged, the updater stops and names files.
- DSH settings.yaml beyond saved runs/credentials (seat toggles, model picks) is not synced between machines.

Next step: after the brain push lands, on vMixer: launch DSH once (its launcher runs brain-sync, which installs Desktop\UPDATE-DSH.cmd), then double-click UPDATE-DSH.cmd; read `~/.dsh/UPDATE-DSH-LOG.txt`. Verify: harness HEAD on vMixer = 4e67c7e452 or later, Council Budget panel shows Stop run and model dropdowns.

## First action on vMixer

Read the local shared-brain MEMORY.md, shared-agent-log.md, handoff_dsh_brain_wiring.md, shared-memory-protocol.md and project_clone_migration_vmixer.md where present. Identify yourself by model name. Report these facts without printing secrets:

- Actual computer name and user; local DSH home and harness repository path.
- Harness branch, full HEAD, working-tree status, configured remote URL and ahead/behind counts against the locally available tracking reference. Clearly distinguish that from a fresh remote check.
- Whether DSH responds locally; host PID and start time; timestamps of the compiled council and agent-memory libraries; whether those artifacts contain shareRun, shareFacts and council-context.
- Whether the brain is a Git repository, its branch, HEAD, working-tree state, remotes and most recent sync receipt. Do not invoke sync merely to inspect: it commits and merges.
- Whether the DSH launcher invokes brain-sync and the generated DSH AGENTS.md contains the shared-brain index.
- Counts of local saved runs, shared run summaries and facts; identify whether vMixer's saved run appears in dsh-runs.md. Full transcripts need not be pasted.
- Existing remote-management or agent communication route that the user already operates. Do not open ports, change firewall rules, install a service or expose DSH to establish access.

Return a concise comparison-ready report to the user. If a supported direct agent channel is available and the user authorizes it, coordinate there; otherwise the user can relay the report. Never claim another machine received a file without checking it there.

## Verified laptop state

GPT-6 checked VMIXLAPTOP2X6 on 2026-09-12 around 02:44 PDT:

- DSH HTTP on loopback port 3080 returned 200; FCC monitor reported ready with fresh timestamps.
- DSH host PID 20024 started 2026-09-11 at 16:47:50 PDT. Council and agent-memory libraries were rebuilt around 17:09 that day. The running host predates those builds; a restart remains outstanding.
- Harness HEAD was c5a54779c0 (shortened), branch feat/heterogeneous-teammates; checkout clean; five commits ahead and zero behind its local tracking reference.
- Shared brain was at b69de5e (shortened), eight commits ahead and zero behind its local tracking reference. GPT-6's five prior note edits remained uncommitted; unrelated project_dsh_team_platform.md was untracked.
- The previous verification passed 429 tests in 29 council/memory files and 120/120 brain self-tests, both exit 0. The installed Vitest Node entry worked; pnpm.cmd exec could not resolve vitest in the sandbox shell.
- The compiled libraries contain the sharing calls. The shared run note contained five laptop runs and no vMixer run.
- Git could not create the brain's .git/index.lock, even after explicit folder and .git write grants. Read-only ACL inspection later showed explicit deny entries alongside sandbox allow entries. Do not remove these access controls or route the denied operation through a helper.
- VMIXER2O2 resolved to 10.0.0.244. TCP probes to 22, 445, 3389, 5985 and 3080 timed out. Local Tailscale daemon access was denied. An agent running on vMixer is the current coordination route.

Recheck mutable facts before acting; neither remote Git state nor vMixer state was verified by these laptop checks.

## What the existing sync actually does

The shared-brain Git repository carries notes, rules and tooling. Session-start/launch collection imports local saved-run summaries and digest facts; immediate council/memory writers require the rebuilt libraries loaded into DSH. Full run JSON records remain local. This does not synchronize the harness checkout, all DSH settings, conversation history, live databases, credentials or runtime locks.

Changes do not reach another machine until published through the authorized gatekeeper and received by that machine. Pushes remain held for the user's cue. Do not add automatic pushes to solve this task. The existing one-click RUN-ALL includes JOIN-BRAIN; its current execution result on vMixer remains unverified. Inspect its source and the migration handoff before running it.

## Continue after comparison

Use both reports to identify the smallest changes needed to align the harness versions, installed profiles and memory tooling. Preserve each machine's existing work. Back up settings before any approved edits; keep machine paths and credentials local. Do not copy live session databases, overwrite active conversations, or treat an approval stored on one machine as authorization on the other. Confirm the intended history-sharing scope before implementing it.

Exercise any applied fix on that machine and quote the decisive result. A build alone does not prove the running host loaded it. Verify one machine's new memory/run record is received by the other before declaring cross-machine sharing complete. Any model-invoking council test must honor the existing two-factor gate and spending authorization.

Record completed work in shared-agent-log.md under your model name. Commit and queue only through permitted routes; never push independently. Keep the result to one-click steps where human execution is unavoidable.
