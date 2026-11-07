---
name: handoff-2026-09-23-2200-fcc-systemwide-fix
description: Free Claude Code (FCC) down on ndi2 - two defects found and measured (a readiness probe whose 2s timeout aborts the cold model-catalog build, and a monitor that gives up permanently), the system-wide distribution route chosen, FCC live again on a diagnostic server; FIX SHIPPED 2026-09-29 by Claude Opus 5.5 (pm T-910ad413), see top section
metadata:
  type: project
---

- Handoff id: handoff-2026-09-23-2200-fcc-systemwide-fix
- Created: 2026-09-23 22:00 PDT. **Updated: 2026-09-23 22:05 PDT** at a FINISH-NOW checkpoint (150k context). Keep this id on later updates.
- Host: **vmixlaptop2x6 (= "ndi2")** - confirmed by `hostname`, not assumed.
- Session: `ead0a9c8-ef47-4e6a-932a-cf2d8f958b4a`. Model: **Claude Opus 5** (Claude Code, desktop app). Remote Control: not requested this leg.
- Repos in play: `~/Documents/claudecode/free-claude-code` (branch `main`, **19 behind origin**, untouched) and `~/.claude/shared-brain` (the `.sync` tooling). Host config `~/.dsh/` is unversioned. The harness `deepseek-harness` is **not** part of this fix.
- Owner: this session. FCC was item 12 in [[handoff-2026-09-22-2130-dsh-swarm-readiness-gate-commerce]], unowned until now.
- Parents: [[handoff-2026-09-23-0200-dsh-fix-plan-decisions]] (where FCC-down was reported), [[free-claude-code-setup]] (how FCC is wired into DSH), [[handoff-2026-09-18-2357-fix-free-claude-code-quota-stop]] (the earlier venv repoint).

## STATUS 2026-09-29 19:58 PDT - FIX SHIPPED (Claude Opus 5.5, pipeline D3, pm T-910ad413, ndi2)

- Canonical copies: `.sync/dsh/fcc-control.ps1` (portable `$FccDir` via `FCC_DIR`/`%USERPROFILE%`; catalog probe 20s, `FCC_CATALOG_TIMEOUT_SEC`; startup deadline 90s; mutex wait sized from both) and `.sync/dsh/fcc-session.cjs` (`createMonitor` cool-down: `cooldownTicks=20`, ~10 min, then a fresh 3-attempt burst; status carries `cooldownRemaining`).
- `brain-sync.mjs` `install()` ships both via `DSH_SHIPPED_FILES`, gated on `existsSync(dshHome)`, standard `.pre-brain-sync-` backup. vmixer2o2 gets them on its next sync (not yet observed there).
- Selftest: 12 new checks (5 install, 7 mocked monitor incl. cool-down reset) all PASS; suite 317/319, the 2 failures are the separate in-progress quota-hook Routine work (`quota hook: ... resume chip`), not this change.
- Live ndi2: backups `~/.dsh/fcc-control.ps1.bak-20260929`, `fcc-session.cjs.bak-20260929`. Cold `-Action start` with nothing on 8082: ready in 31.7s wall (26s logged, under a concurrent selftest), first `/v1/models` probe completed (1 models line vs 4 health lines in stdout log). `/health` 200, `/admin` 200, `/v1/models` 308 models. DSH relaunched via `launch-dsh.cmd`: 3080 200, monitor `Free Claude ready.` / `OpenRouter Free ready.` at 02:55Z.
- Note: the brain listener auto-committed the code mid-edit (bdab4151, 63d3fdd5 "session changes").

## Exact ask

User's words: **"5 lets check in with ndi2 and build a fix for fcc that will work system wide"** - item 5 from this session's status report (FCC down), on ndi2, with the fix to be system-wide rather than a one-host hand-edit.

Reading used, stated so it can be corrected: "system wide" = survives restarts and `uv sync`, and reaches **every host in the fleet** (ndi2 + vmixer2o2), not a manual edit to one machine's `~/.dsh`.

## TWO DEFECTS. One is certain, one is measured but its link to the outage is inference. Do not conflate them.

### Defect A - CERTAIN, and it is why FCC stayed down

`~/.dsh/fcc-session.cjs` `createMonitor` resets the failure counter **only on a successful check**:

    if (ready) attempts = 0;
    if (!ready && attempts < limit) { ...recover... }

After three consecutive failures `attempts === limit` forever, because the only thing that clears it is a `check()` that returns ready - which cannot happen while the service is down and nothing is restarting it. So at 16:12:59Z the monitor logged "Automatic recovery stopped after 3 consecutive attempts" and **never tried again for the life of the DSH session**, even though a cold start on this box succeeds in about 15 seconds (measured below). The in-code comment claims the budget is "three CONSECUTIVE failures, so a service that dies hours after an earlier recovery is still brought back" - true only for a service that recovers by itself. The relay survived this only because its restarts happened to succeed.

This same monitor governs the OpenRouter proxy, so the fix covers both.

### Defect B - MEASURED, and it is what burned the three attempts

`~/.dsh/fcc-control.ps1` `Test-Ready` wants `/health` **and** a non-empty `/v1/models`, each with `-TimeoutSec 2`.
`/health` (`src/free_claude_code/api/routes.py:203`) returns `{"status":"healthy"}` instantly.
`/v1/models` (`routes.py:217`) awaits `services.requests.wait_for_catalog()` - a **lazy cold build**.

Measured live tonight against a freshly started server:

| call | timeout given | result |
|---|---|---|
| `/health` | 2s | 200, `{"status":"healthy"}`, instant |
| `/v1/models` **cold** | 2s | **timed out at 2028 ms** |
| `/v1/models` **cold** | 60s | **OK in 2627 ms**, `object=list`, **310 models** |
| `/v1/models` warm x5 | 2s | OK in 76 / 15 / 20 / 12 / 12 ms |

So every cold probe aborts its own build. That is why `fcc-server.stdout.log` holds 13 `/health` 200s and **not one** `/v1/models` line: uvicorn logs a request only when it completes, and none did.

**Honest limit, and a correction to this note's first draft.** The controller's exact 60-second loop was then replayed against a cold server on this box: **it passed, ready after 6 attempts (~15s)**. So the 2s timeout is not an absolute block on an idle machine. The real attempts at 16:10:46Z and 16:12:58Z failed after 61s and 70s, i.e. the deadline expired rather than the child dying. The most likely reading is the same aborting loop failing to converge inside 60s under real startup load (DSH, the OpenRouter proxy and the Antigravity seats all starting at once) - **plausible and consistent with the logs, but not proven.** Defect A explains the permanence with certainty; defect B explains the cost of each attempt with measurement.

### What is NOT the cause - do not go back down these roads

- **Not the venv.** The `C:/Python314` repoint from 09-18 is intact; the server starts, binds 8082 and serves. `fcc-server.stderr.log` ending at `Application startup complete` is what misled earlier readers.
- **Not the 3/3 give-up being the old lifetime-budget bug.** The patched budget counted three genuinely consecutive failures. Correct behaviour on top of a broken probe.
- **Not FCC being 19 commits behind origin.** Untested as a factor and irrelevant to the probe.

## LIVE STATE RIGHT NOW - read this before touching anything

- **FCC is UP and the monitor has adopted it.** `fcc-status.json`: `ready: true`, `recoveryAttempts: 0`, `checkedAt 2026-09-24T05:00:50Z`; `fcc-monitor.log` logged `Free Claude ready.` at `2026-09-24T04:52:07Z`. `/health` 200.
- **But it is up on a DIAGNOSTIC server this session started, PID 35456**, launched by hand from the scratchpad, logs `<scratchpad>/repro-out.log` / `repro-err.log`, pid recorded in `<scratchpad>/diag-pid.txt`. **It is not recorded in `fcc-owned.json`**, so `Stop-Owned` will not manage it: the controller cannot stop or restart it, and a `-Action start` will take the "port occupied" branch. Whoever continues must `taskkill /PID 35456 /T /F` first and let the controller own the next one. The monitor reset its counter purely by observing a healthy port - that is the adoption, and it proves defect A's fix direction (a ready check does clear the counter) without fixing anything.
- DSH: `:3080` 200, monitor PID 23004, DSH PID 8888, `~/.dsh/.built-commit` = `b894fb8499`, which is **not an ancestor of harness HEAD** - the running host is 6 commits behind (`87c53cad56`, `6cb5cda128`, `0d49b54f8b`, `f55855f248`, `2355728cd5`, `6ad3ae7abb`). Separate finding, already reported to the user, not part of this fix.
- Relay: `/health` 200; its watchdog **proved itself in the field at 17:55 tonight** (`recovery 1/3` -> `ready (health verified)`, unaided).
- Harness repo: tree clean, **3 ahead of origin**, nothing pushed.
- A background `grep` launched by this session (task `bg3tf25ir`, searching `~/.dsh` and `.sync` for `createMonitor`) may still be running. Harmless; kill it if it lingers.
- **Verified, do not repeat - it takes over two minutes.** A full recursive grep of `deepseek-harness` for `fcc-control` / `fcc-session` returned **nothing** (exit 0, no matches). So the harness genuinely does not carry either script, and `brain-sync.mjs` is the only distribution route. This was an assumption when the plan below was written; it is now a checked fact.
- **There is no existing test for `createMonitor` anywhere.** A recursive grep of `~/.dsh` and `.sync` matched only `fcc-session.cjs` itself and its three `.bak-*` copies; every other hit was the unrelated `@algolia/monitoring` package inside a worktree's `node_modules`. The "four mocked recovery tests" mentioned in [[free-claude-code-setup]] (2026-09-07) left no file behind. So the cool-down fix ships with a **new** test - do not go looking for one to extend.

## The fix - DESIGNED IN FULL, NO CODE WRITTEN YET

Nothing has been edited. Everything below is the plan, with the unknowns already resolved.

1. **`fcc-control.ps1`**
   - `$FccDir` is hardcoded `~\Documents\claudecode\free-claude-code`. Make it portable: `$env:USERPROFILE\Documents\claudecode\free-claude-code`, with an `FCC_DIR` override. The fleet manifest (`fleet/repos.json`) confirms that relative path is the fleet-wide location for `free-claude-code`. `$MarkerPath`/`$LogPath` already use `$PSScriptRoot` and need nothing.
   - Keep `/health` at 2s; give the catalog probe **15-20s** (env override `FCC_CATALOG_TIMEOUT_SEC`) so the first probe *waits for* the cold build instead of aborting it. A dead server still fails instantly - TCP connect is refused - so nothing slows down.
   - Raise the startup deadline from 60s to **90s** for margin on a loaded boot.
2. **`fcc-session.cjs` `createMonitor`** - add a bounded cool-down instead of a permanent give-up. Sketch, ordering already traced tick by tick:

       if (ready) { attempts = 0; cooldown = 0 }
       if (!ready && attempts >= limit) {
         if (cooldown === 0) cooldown = cooldownTicks           // just hit the wall
         else if (--cooldown === 0) { attempts = 0; report(`${name}: cool-down over, trying recovery again.`) }
       }
       if (!ready && attempts < limit) { ...existing recovery... }

   With `cooldownTicks = 20` and a 30s poll that is a fresh burst of 3 attempts every ~10 minutes. Applies to the OpenRouter monitor too, for free.
3. **Distribution - the route is already chosen and it is the existing one.** `fcc-control.ps1` and `fcc-session.cjs` live **only** in each host's `~/.dsh/`; no repo holds them, and `brain-sync.mjs` only patches `launch-dsh.cmd` to call `fcc-session.cjs` (line 1077). The vehicle is `brain-sync.mjs`'s **`shipped` array at lines ~745-770**: canonical sources under `.sync/`, copied to per-host targets on every sync, CRLF-insensitive comparison, automatic `.pre-brain-sync-<stamp>` backup. Same mechanism that already ships the memory hook, the quota hook, the git-gatekeeper definition and the two gatekeeper files.
   - Add `.sync/dsh/fcc-control.ps1` and `.sync/dsh/fcc-session.cjs`, appended to `shipped` **gated on `existsSync(dshHome)`**, exactly as the gatekeeper entries are gated on `existsSync(gatekeeperDir)`.
   - vmixer2o2 does have FCC (`fleet/status/vmixer2o2.json` shows secret `fcc-.env: "same"`), and it is `seen` at `2026-09-24T04:45Z`, so it will pick the files up on its next sync.
4. **Selftest** - `.sync/selftest.mjs` already has an `install:` block (around line 290) asserting each shipped file landed. Add the same shape for the two new files, plus a "not installed where DSH is missing" case mirroring `install: no Desktop updater where DSH or a Desktop is missing`. Run `node .sync/selftest.mjs`.

## Permissions

- Nothing has been denied this session.
- No commit, no push, no `push-requests.md` entry from this session. Writing files under `~/.claude/shared-brain/` is pre-authorised by the standing rules; **committing them is not** and the user has not been asked yet.

## Do not

- Do not run `uv sync` or "repair" the venv - it is not the fault, and 09-18 warns `uv sync` breaks the `C:/Python314` repoint.
- Do not pull FCC (19 behind origin) as part of this; separate decision.
- Do not re-measure the catalog timings or re-run the 60s reproduction; both are recorded above.
- Do not hand-edit only ndi2's `~/.dsh/fcc-control.ps1` and call it done - that is the exact failure the user asked to avoid.
- Do not restart DSH to deliver the `fcc-session.cjs` fix without telling the user; the running monitor keeps its own state and the repo owner `[24fdb9]` asked to be told before a rebuild.

## Exact next action

1. Kill diagnostic PID 35456 so the controller can own the server again.
2. Write `.sync/dsh/fcc-control.ps1` and `.sync/dsh/fcc-session.cjs` with the two fixes, wire them into `shipped`, extend the selftest, run `node .sync/selftest.mjs`.
3. Install on ndi2 by running brain-sync, then prove it cold: `fcc-control.ps1 -Action start` must report `Free Claude ready` on the **first** probe, and `fcc-status.json` must read `ready: true`.
4. Ask the user before committing the brain, and before any DSH restart that would load the new `fcc-session.cjs`.
5. Report vmixer2o2 honestly - only claimable once that host has actually run it.

## Verification owed before this is called done

- A cold `fcc-control.ps1 -Action start` succeeding on the first catalog probe, with the elapsed time quoted.
- `node .sync/selftest.mjs` green, with the new cases named.
- The cool-down exercised - not just written - by a mocked monitor test, since a live 10-minute wait is impractical.
- vmixer2o2 showing the installed files, or this note saying plainly that only ndi2 is proven.
