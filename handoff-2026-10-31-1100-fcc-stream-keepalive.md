---
name: handoff-2026-10-31-1100-fcc-stream-keepalive
description: "FCC fix: SSE ping keepalive + thinking-only recovery + 600s cooldown; commit 4c092b9 local; restart pending"
metadata:
  type: project
---

Handoff id: fcc-keepalive-20261031
Status: ready (context limit; next agent claims)
Updated: 2026-10-31 20:05Z (13:05 PT)
Host: vmixer2o2
Session: 0f102355-18c8-4a43-94ab-dbfa430475c7 (side session of local_c9089ac2)
Model: Claude Opus 5.5
Repo: ~/Documents/claudecode/free-claude-code, branch fix/rate-limit-cooldown, commit 4c092b9 (local, not pushed)
Ask: user 2026-10-31 "fix free claude restart it in other places its been brokenr"
Root cause 1: NIM MiniMax buffers native tool-call XML until </tool_call>; midstream recovery buffers its whole continuation. Big Write = minutes of zero bytes to client; Claude Code drops stream -> "API error unknown", retries burn out. Measured: big-write repro 289s deltas then 600s silence then FCC timeout_error.
Root cause 2: recovery after a NIM cut that yields only thinking was emitted as successful end_turn -> headless lane ends silently (wp7 transcript 3f2f06cf at 16:02:55Z, output_tokens 1).
Root cause 3: Gemini quota 429 outlasts 120s cooldown; each lane request burned ~33s on 5 retries.
Fix (4c092b9): api/response_streams.py ping frame every 10s while body idle; transport.py thinking-only recovery -> None (error, client retries); execution.py cooldown 600s. Tests: 116/116 affected files; full suite 5791 pass, 2 fail only on WinError 10048 (live FCC holds :8082).
Config: ~/.fcc/.env MODEL_FALLBACKS EOL nvidia_nim/z-ai/glm-5.3 removed (backup .env.bak-2026-10-31-glm53).
Processes: old FCC still running pids 21260/37156 (.venv python serve()) on :8082 with OLD code. Kill refused by auto-mode classifier.
Proof runs (test FCC :8093, 4c092b9, started by this session as bg task b5wvg1p8t): run1 killed by FCC 600s progress watchdog -> PROVIDER_PROGRESS_TIMEOUT=1800 in ~/.fcc/.env; run2 killed by Claude Code chunk-idle 300s (SDK drops SSE ping; byte watchdog is fed by ping) -> ~/.dsh/free-claude-home/settings.json env CLAUDE_STREAM_IDLE_TIMEOUT_MS=1800000 + CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK=1. run3 FAILED (19:13-20:03Z, 50 min cap): idle limit worked (900s warning, no abort) but client "Request timed out" at ~6 min (19:19, 19:25 - likely SDK API_TIMEOUT_MS) and NIM minimax never finished the ~300-line Write. :8093 test server stopped.
Remote Control: off
Next: (1) add API_TIMEOUT_MS=3600000 to ~/.dsh/free-claude-home/settings.json env (+ ndi2 bundle) and verify name in claude.exe; (2) rerun proof with a smaller Write (~120 lines) to separate NIM slowness from FCC bugs; (3) restart :8082 via ~/.dsh/fcc-control.ps1 stop/start (raw kill refused by auto mode); (4) ndi2 bundle transfer/fcc-keepalive-2026-10-31/FIX-FCC-KEEPALIVE.cmd. Honest limit: free NIM minimax may be too slow for big-file lanes regardless.
Do not repeat: supervisor in-process restart does not reload Python code; don't use admin restart for code changes.
ndi2: FCC healthy at 10.0.0.241:8082, runs old code (same bug), not yet patched.
Open: server-side alternative to client env = emit a client-visible keepalive event (SDK ignores ping); not built.
Signed: Claude Opus 5.5
