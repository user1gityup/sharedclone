# pm/service — autostart service scripts (CONTRACTS.md C7)

Draft only. **No script in this directory, and no change to `pm/pm-autostart.ps1`,
has been run, registered, or installed as part of this workstream (ws-2d).**
Everything below describes what the scripts will do when someone explicitly
runs them in a later, separate step — not anything that has happened yet.

## Status note on this file

`install.ps1` and `disable.ps1` exist in this worktree and are described below
against their actual committed content (commits `70ec612` and `4962fe3`).
`rollback.ps1` has **not** been committed to this worktree as of this writing —
only drafted as text by a peer unit, never written to disk here. The rollback
section below documents its *intended* behavior per CONTRACTS.md C7 (restore
the prior logon Startup entry, remove the Task Scheduler task), not actual
file content. Before relying on it, confirm the file exists and — critically —
that it uses the same task identity as the other two scripts (see below);
re-verify this README's rollback section against the real file once it lands.

## Task identity used by install.ps1 / disable.ps1

CONTRACTS.md C7 does not pin a literal Task Scheduler task name. Both existing
scripts agree on:
- `TaskName = 'pm-autostart-watchdog'`
- `TaskPath = '\'` (task scheduler root)

This mirrors the existing named mutex in `pm-autostart.ps1`
(`Local\pm-autostart-watchdog`) minus the `Local\` prefix. `rollback.ps1` must
use this same `pm-autostart-watchdog` / `\` pair to find and remove the task —
if a later draft of it (e.g. one using a different name such as
`DSH-PM-Autostart`) lands instead, that is a naming mismatch to fix at
integration, not an acceptable variant.

## Scripts

### `install.ps1`

Registers the pm supervisor as a Task Scheduler task:
- Trigger **At startup** (`/SC ONSTART`, system boot — not user logon).
- Principal: the current user (`$env:USERDOMAIN\$env:USERNAME`), "run whether
  logged on or not" (`/RP *`). `/RP *` is `schtasks.exe`'s own interactive
  password prompt; the script never stores, hardcodes, or bypasses a
  credential. The user enters the account password once, in that prompt.
- Action: launches `pm-autostart.ps1` via
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <path>`.
- Idempotent: if task `pm-autostart-watchdog` already exists, the script
  no-ops with exit code 0 and prints a message, unless `-Force` is passed, in
  which case it updates (re-creates) the existing task instead of erroring or
  duplicating it.
- One-click: no required parameters. Optional overrides:
  `-PmAutostartScript <path>` (default: `..\pm-autostart.ps1` next to this
  script), `-PowerShellExePath <path>` (default: the system
  `WindowsPowerShell\v1.0\powershell.exe`), `-Force`.
- Warns (does not fail outright beyond what `schtasks` itself reports) if the
  shell is not elevated, since "run whether logged on or not" normally
  requires an administrator/UAC context.

One-click invocation:
```
powershell -NoProfile -ExecutionPolicy Bypass -File pm\service\install.ps1
```

### `disable.ps1`

Disables the `pm-autostart-watchdog` task without deleting it:
- No parameters.
- If the task is absent, or already in the `Disabled` state, exits 0 with a
  message — not an error.
- Otherwise calls `Disable-ScheduledTask` on it.
- Re-enable path: there is no `enable.ps1` in this workstream. Re-enabling
  today means either `Enable-ScheduledTask -TaskName pm-autostart-watchdog`
  directly, or re-running `install.ps1 -Force`, which re-creates the task
  (and therefore also re-enables it).

One-click invocation:
```
powershell -NoProfile -ExecutionPolicy Bypass -File pm\service\disable.ps1
```

### `rollback.ps1` (intended behavior — file not yet committed here)

Per the workstream plan and CONTRACTS.md C7, this script is meant to undo the
Task Scheduler autostart mechanism and restore whatever logon Startup entry
preceded it (the repository's existing `Shared-Agent-Listeners.cmd`-style
Startup-folder launch referenced in `pm-autostart.ps1`'s own header comment),
by:
1. Removing the `pm-autostart-watchdog` Task Scheduler task (tolerating it
   already being absent — idempotent).
2. Re-creating the logon Startup-folder entry that launches
   `pm-autostart.ps1`, so the machine falls back to logon-triggered autostart
   (tolerating it already being present — idempotent).

One-click invocation (once the file exists):
```
powershell -NoProfile -ExecutionPolicy Bypass -File pm\service\rollback.ps1
```

### `pm-autostart.ps1` (existing script, modified this workstream)

Not in this directory, but its autostart behavior is what `install.ps1` points
the Task Scheduler task at, so the test plan below covers it too.

- **Readiness probe** (`Test-Ready`, gates whether a (re)start counts as a
  success): both of —
  - `GET http://127.0.0.1:4480/api/bridge/health` returns `ok: true`.
  - `health.dispatch.last_tick_at` is within 10 seconds of the current time
    (`Test-DispatcherTick`). This field is refreshed by the bridge dispatcher
    roughly every ~2s while its worker loop is alive, so "stale" (not ticking)
    fails readiness even if `ok: true`.
  - `Start-Pm` polls both conditions for up to 20s after spawning the server
    before declaring the start successful; if neither condition holds inside
    that window, the start counts as a failure.
- **Restart backoff**: on a failed (re)start, the watchdog waits, then
  doubles the wait, starting at 5s and capping at 600s (10 min):
  `5s → 10s → 20s → 40s → 80s → 160s → 320s → 600s → 600s → ...`. The backoff
  counter resets to 5s the moment a restart reaches readiness.
- **Single instance**: named mutex `Global\pm-autostart-watchdog` (was `Local\`; changed 2026-10-13 so the session-0 boot task and the session-1 logon Startup entry cannot both run a watchdog),
  acquired non-blocking (`WaitOne(0)`) at normal startup — a second normal
  invocation exits immediately if the mutex is held.
- **`-StartIfAbsent`**: a separate, non-blocking probe of the *same* mutex,
  intended for a Gatekeeper start step. If the mutex is free, it launches a
  detached watchdog and exits; if held, it logs and exits without starting
  anything — so a Gatekeeper "ensure the supervisor is running" step can call
  this repeatedly and never spawn a duplicate watchdog.

## Manual test plan

None of these steps have been executed. This is the plan for whoever runs
them in a later, explicit step.

### 1. Fresh install

1. Confirm no task named `pm-autostart-watchdog` exists:
   `Get-ScheduledTask -TaskName pm-autostart-watchdog -ErrorAction SilentlyContinue`
   should return nothing.
2. Run `pm\service\install.ps1` from an elevated shell. Enter the account
   password at the `schtasks` prompt when asked.
3. Verify:
   - `Get-ScheduledTask -TaskName pm-autostart-watchdog` now returns the task.
   - `(Get-ScheduledTaskInfo -TaskName pm-autostart-watchdog)` and
     `Get-ScheduledTask ... | Select -Expand Triggers` show an `ONSTART`
     (boot) trigger, not a logon trigger.
   - `Get-ScheduledTask ... | Select -Expand Principal` shows the current
     user as `UserId`, and `LogonType` set to the "run whether logged on or
     not" value (`Password`, not `InteractiveToken`).
   - Reboot the machine (or, short of a reboot, confirm via
     `schtasks /Query /TN pm-autostart-watchdog /V /FO LIST` that
     `Run As User` matches the current user and `Logon Mode` shows it is not
     restricted to interactive logon) and confirm `pm-autostart.ps1` is
     running even if nobody is logged on (check `pm-data\autostart.log` for a
     fresh `watchdog start` line timed near boot, with no interactive session
     open).

### 2. Idempotent re-install

1. With the task from step 1 still present, run `pm\service\install.ps1`
   again (no `-Force`).
2. Verify: script exits 0, prints the "already exists... no-op" message, and
   `Get-ScheduledTask -TaskName pm-autostart-watchdog` still shows exactly one
   task (no `pm-autostart-watchdog(1)` or similar duplicate).
3. Run `pm\service\install.ps1 -Force` and verify it re-registers the same
   single task (still exactly one `Get-ScheduledTask` result) rather than
   adding a second one.

### 3. Disable

1. With the task present and enabled, run `pm\service\disable.ps1`.
2. Verify: `(Get-ScheduledTask -TaskName pm-autostart-watchdog).State` is now
   `Disabled`.
3. Reboot (or wait for the next scheduled trigger) and confirm the task does
   **not** launch `pm-autostart.ps1` (no new `watchdog start` line in
   `pm-data\autostart.log` after that boot).
4. Re-enable path: run
   `Enable-ScheduledTask -TaskName pm-autostart-watchdog -TaskPath '\'`
   (or `install.ps1 -Force`) and confirm `.State` returns to `Ready`.
5. Run `pm\service\disable.ps1` a second time while already disabled; verify
   it exits 0 with the "already disabled" message rather than erroring.

### 4. Rollback

1. With the Task Scheduler task present (from step 1), run
   `pm\service\rollback.ps1`.
2. Verify:
   - `Get-ScheduledTask -TaskName pm-autostart-watchdog -ErrorAction SilentlyContinue`
     now returns nothing (task removed).
   - The current user's Startup folder
     (`shell:startup`, i.e.
     `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`) contains an
     entry that launches `pm-autostart.ps1` on next interactive logon.
   - Log off and back on (or run the Startup entry manually) and confirm
     `pm-data\autostart.log` shows a fresh `watchdog start` line.
3. Run `pm\service\rollback.ps1` a second time; verify it makes no further
   change and reports no error (idempotent on an already-rolled-back state).

### 5. `pm-autostart.ps1` backoff and readiness probe

1. Stop the pm server process and block or redirect `127.0.0.1:4480` (or
   temporarily rename `pm\server.mjs`) so a restart attempt cannot reach
   readiness.
2. Run `pm-autostart.ps1 -Once` (or let the installed watchdog hit its next
   cycle) and watch `pm-data\autostart.log` timestamps across consecutive
   failed attempts; confirm the gaps between "restart backoff: waiting Ns"
   lines follow `5s, 10s, 20s, 40s, 80s, 160s, 320s, 600s`, then stay at
   `600s` on further failures.
3. Restore `server.mjs` / unblock the port, let a restart succeed, and
   confirm the very next failure (if forced again) starts its backoff over at
   `5s`, not continuing from the capped value.
4. To exercise the readiness probe specifically: start the pm server so
   `GET /api/bridge/health` returns `ok: true`, but with the dispatcher loop
   not ticking (e.g. pause/kill the dispatcher's interval, or wait past the
   point `dispatch.last_tick_at` should refresh). Confirm
   `pm-data\autostart.log` logs "pm did not reach readiness" rather than a
   success line during that window, and that a start only logs success once
   both `ok: true` and a tick timestamp within the last 10s are observed
   together.
5. Test `-StartIfAbsent`: with a watchdog already running (mutex held), run
   `pm-autostart.ps1 -StartIfAbsent` and confirm the log shows "mutex already
   held" and no second `pm-autostart.ps1` process appears (e.g. via
   `Get-Process powershell` / Task Manager). Stop the running watchdog, run
   `-StartIfAbsent` again, and confirm it now logs "mutex was free - launched
   a new watchdog" and exactly one new watchdog process starts.
