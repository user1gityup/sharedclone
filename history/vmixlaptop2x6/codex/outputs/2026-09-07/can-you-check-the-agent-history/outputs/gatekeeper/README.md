<!-- Copied 2026-09-15T10:15:42.527Z from ~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/README.md on vmixlaptop2x6 (redacted). -->
# Shared gatekeeper

Built by GPT-6. See STATUS.md for verified results and remaining runtime limits.

## Operation

The standalone monitor reads `~\.claude\shared-brain\push-requests.md`. It shows open requests, commit identities, destination and diff. Approve each push in its window. It preserves Git hooks, rechecks reviewed state, pushes the exact approved commit, verifies the destination, and records JSON receipts in `state`. Requests with successful receipts are skipped. The Markdown queue is read-only to the monitor, avoiding races with agents appending entries.

The Windows Startup shortcut starts a hidden watcher. Claude, Codex or DSH launches cause it to start a hidden monitor if one is absent. Approval and result dialogs still appear. It needs no model quota. Windows must be logged in and awake. DSH's terminal can be the only visible terminal.

For the current login, start `Start-Startup-Watcher.ps1` from normal PowerShell. The watcher retains existing monitors; they must restart to load script changes. Next Windows login loads current scripts. `Watch-Agent-Startup.ps1 -CheckOnly` checks detection without launching anything. Detection errors go to `state/startup-errors.log`. Remove `Gatekeeper Startup Watcher.lnk` from `shell:startup` to disable future autostart; sign out to stop the current watcher.

## DSH, Claude and Codex handoff

The shared agent rules and DSH root instructions now document the agent-driven workflow. After user-requested finalization, an authorized local agent reviews, checks and commits work, then invokes:

```text
node queue-build.mjs "<absolute repository>" "<model name>" "<checks actually run>"
```

Use the absolute helper path when outside this directory. Optional fourth argument selects a test queue. The helper requires clean committed work, an HTTPS GitHub origin and matching upstream with pending commits. It pins HEAD and deduplicates submission. It never builds, commits, fetches or pushes. Validation text is the submitting agent's report, not proof that tests ran.

DSH API agents keep staged work inside their session sandbox after workspace-write approval plus go. A local agent reviews and applies staging before validating, committing and queueing it. No pipeline-completion callback or automatic commit was installed. Queueing does not authorize a push, and agents must not use this workflow to escape denied operations or runtime restrictions.

## Tests

`Test-Gatekeeper.ps1` creates isolated local repositories and asks for Defer, then Approve. It verifies no change after deferral, exact local push, hook execution and duplicate prevention. This test passed in the user's normal PowerShell. No GitHub push is involved.

`node --test queue-build.test.mjs` runs five isolated producer tests. They passed: commit pinning, CRLF deduplication, dirty-tree rejection, metadata injection rejection and upstream mismatch rejection. PowerShell scripts passed syntax validation.

User checks confirmed startup detection and a running monitor. Hidden-window appearance and fresh-login autostart have not been visually verified. Script execution and CIM inspection are blocked inside the Codex sandbox; no execution-policy bypass was attempted.

Keep this directory in place: Startup and shared instructions reference its absolute path.
