---
name: handoff-vmixer-system-repair
description: Active handoff for the VMIXER2O2 system-wide shared brain, gatekeeper, permissions, listener, credentials, and one-click repair package.
metadata:
  type: project
---

# VMIXER2O2 system repair handoff

Stable handoff id: `vmixer-system-repair-20260913-2249`

- Time: 2026-09-13 22:49 America/Los_Angeles
- Host: VMIXLAPTOP2X6
- Session: current Codex desktop task
- Model: GPT-5.6-sol
- Owner: GPT-5.6-sol; no collaborating subagents
- Repositories: `~/.claude/shared-brain` main; `~/Documents/claudecode/deepseek-harness` feat/heterogeneous-teammates; `~/Documents/claudecode/dsh-council-plugins` main

## Exact ask

Finish a one-click external-drive repair that makes VMIXER2O2 behave like this machine system-wide for Claude, Codex, DSH council/swarm agents, shared rules/memory, sealed DSH credentials, repository histories, and the user-operated gatekeeper. Every path must resolve for the machine it runs on. Agents must request missing runtime permissions instead of merely reporting that they cannot write. Add continuous synchronization so shared-brain changes do not wait for another session and completed repository commits are presented promptly to the gatekeeper.

## Verified work

- The previous external-drive repair really ran on VMIXER2O2. Its log proved that brain/harness/plugin merges and 32-file overlay succeeded, then `pnpm install --frozen-lockfile` failed because the new Codex CLI workspace package was absent from the lockfile.
- Local repair now uses `pnpm install --no-frozen-lockfile`, including offline-first and online fallback.
- Local repair rewrites operational DSH and gatekeeper paths to the target home, audits for stale source-home paths, renders Codex rules, and repairs existing open VMIXER2O2 queue headings.
- Fixture repair completed exit 0 with preservation, brain merge/install, credentials, 180 shared-brain checks, operational-path audit, both repositories, and the 32-file overlay. Build and final RUN-ALL were intentionally disabled in the fixture.
- Shared gatekeeper source now resolves a missing `C:\Users\<other-user>\...` request to `%USERPROFILE%\...` only when the resulting local path exists and contains `.git`. Existing paths win; arbitrary paths are rejected. Both Node queue submission and PowerShell review use machine-local resolution.
- Every gatekeeper Git command now supplies the exact repository as `safe.directory`, avoiding ownership failures without global configuration.
- The queue resolver was exercised with a foreign-user/foreign-drive path and returned the matching fixture repository under the current home.
- The master rules now require every agent to invoke its runtime permission-request mechanism for the exact blocked resource and access level. A read-only grant must be reported as read-only, not treated as write access.
- Added continuous listener source. The brain installer creates a machine-local startup entry that launches a single-instance shared-brain sync/publish cycle every 20 seconds and starts the existing PowerShell gatekeeper. Shared-brain publication remains protected by its credential/path pre-push gate. Project pushes still require a committed clean tree plus exact gatekeeper review and human approval.
- Shared-brain selftest passes `180/180` after these changes. Node and PowerShell sources parse successfully.

## Partial work and files

Uncommitted shared-brain changes:

- `.sync/brain-sync.mjs`
- `.sync/SharedBrainListener.ps1`
- `.sync/gatekeeper/Gatekeeper.ps1`
- `.sync/gatekeeper/queue-build.mjs`
- `.sync/selftest.mjs`
- `rules/CLAUDE.md`
- this handoff and its MEMORY index line

Local one-click package source:

- `~/Documents/Codex/2026-09-13/you/work/vmixer-system-repair/REPAIR-VMIXER.cmd`
- `~/Documents/Codex/2026-09-13/you/work/vmixer-system-repair/REPAIR-ALL.cmd`
- `~/Documents/Codex/2026-09-13/you/work/vmixer-system-repair/REPAIR-ALL.ps1`
- `~/Documents/Codex/2026-09-13/you/work/vmixer-system-repair/build-package.mjs`
- `~/Documents/Codex/2026-09-13/you/outputs/COPY-VMIXER-REPAIR-TO-DRIVE.cmd`

The payload still contains the older shared-brain bundle and must be rebuilt after the shared-brain commit. The external drive still contains the older repair copy.

## External drive and permissions

- Drive is `D:\clone` on this host and `G:\clone` on VMIXER2O2.
- This Codex task requested read/write access to `D:\clone`; the first dialog granted read only for the turn. A separate write-only request was automatically denied with no dialog. No write bypass was attempted.
- To grant more than read in the Codex desktop permission UI, select the choice explicitly labeled write or read-and-write, then session/permanent scope if offered. If no write choice is offered, that policy is controlled outside the task and cannot be changed by the agent or installer.
- Current local Codex configuration has Windows elevated sandbox, but the desktop task's managed filesystem permission profile still controls access to the external drive. Cloning a config file cannot override that host policy.

## Credentials

- The repair payload carries the current shared-brain key separately from the clone bundle's original `CLONE-KEY.txt`; do not overwrite the original key because it opens the original `secrets.enc`.
- Sealed DSH refs verified in the fixture: `FCC_DSH_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`.
- Claude, Codex, GitHub, and browser interactive sign-ins are machine/user protected and cannot be copied as raw credentials; the existing one-click sign-in stage remains the only physical/user step.

## Processes and ports

- No persistent repair or test process is running.
- The listener is source-only on this machine until brain install/restart; it uses a named mutex and a 20-second cycle.
- No ports were opened by this work.

## Open permission-design questions

- Resolved 2026-09-13: the user gives ChatGPT/Codex standing read/write authorization for the entire `~/.claude/shared-brain/` folder. Repository and external-drive access remain separate decisions.
- Codex desktop managed permissions may be account/host policy rather than portable `config.toml`. Confirm using current OpenAI product controls before promising the installer can set it.
- Do not weaken the gatekeeper's exact review/human approval while changing filesystem permissions. Continuous readiness and automatic shared-brain publication are separate from automatic project pushes.

## Exact next action

1. Review the permission-policy choice with the user.
2. Append the completion log entry, run the 180-test suite once after any edits, and commit the shared-brain changes locally. Do not push manually.
3. Rebuild the repair payload so `shared-brain.bundle` contains that commit and the manifest includes the listener.
4. Run the complete local fixture again. If practical, run the harness build with the repaired lockfile behavior.
5. Request write access to `D:\clone` again. If granted, replace `D:\clone\VMIXER-SYSTEM-REPAIR` and `D:\clone\REPAIR-VMIXER.cmd`, then hash-verify the drive copy. If denied, the already-tested local copy helper is the sole bundled physical handoff.
6. On VMIXER2O2, only `G:\clone\REPAIR-VMIXER.cmd` should be clicked. Read its fresh log and summary before claiming success.

## Do not repeat

- Do not use frozen lockfile installation with the uncommitted Codex CLI workspace overlay.
- Do not hardcode `ndi2`, `vMixer`, drive letters, or another machine's home into operational gatekeeper paths.
- Do not overwrite the original clone key with the current brain key.
- Do not treat a queue entry as a successful push, auto-commit arbitrary repository work, bypass hooks, or bypass exact human approval.
- Do not claim external-drive write access: only read was granted in this task.

**Why:** The earlier clone restored source-machine absolute paths and left target agents unable to write or submit usable gatekeeper requests.

**How to apply:** Resume from the exact next action, preserve all uncommitted work, and use the one-click repair as the only user-facing execution path.
