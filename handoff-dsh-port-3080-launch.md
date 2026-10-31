---
name: handoff-dsh-port-3080-launch
description: "2026-09-13 15:25 DSH launcher crashed EADDRINUSE 3080 because a Codex-started DSH was still listening; launcher now replaces a leftover DSH"
metadata:
  type: project
---

# Handoff: DSH launch EADDRINUSE 3080

- Stable handoff id: `dsh-port-3080-launch-20260913T1525`
- Updated: 2026-09-13 15:25 (local)
- Host: VMIXLAPTOP2X6
- Session: Claude Code desktop, Code tab
- Exact model: Claude Opus 5 (`claude-opus-5`)
- Files: `~/.dsh/fcc-session.cjs` (not in any git repo)
- Owner: Claude Opus 5; no collaborating agents

## Exact ask
"dsh not working ... fix it" — `launch-dsh.cmd` died: `listen EADDRINUSE 127.0.0.1:3080`.

## Cause (verified)
Port 3080 held by node PID 35656 `apps\cli\lib\bin.js web --no-open`, started 15:09:30, parent pwsh 28612 under `codex-command-runner` 33252 — the DSH GPT-5.6 restarted after its reliability batch (agent log 15:09). HTTP 200. FCC on 8082 was then stopped by the failed launcher's `finish()`.

## Fix
`freeDshPort()` added to `~/.dsh/fcc-session.cjs`, called before FCC start (non-attach mode): a listener on 3080 whose command line is `bin.(js|ts) web` is taskkilled (tree) and the port waited free (10 s); a non-DSH holder aborts with a clear message.

## Status: closed 2026-09-13 15:28
Verified by launching `launch-dsh.cmd` in a new window with old PID 35656 still on 3080: monitor log "Stopped leftover DSH (PID 35656) that held port 3080."; new host PID 21784 (started 15:28:30) listening on 3080, HTTP 200; FCC 8082 /health 200; 35656 gone. That DSH window is now the user's running instance. Nothing to resume. No git (file is outside repos).

## Do not repeat
- Do not diagnose providers/build; the build is fine, the port was taken.
