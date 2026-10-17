---
name: free-claude-code-setup
description: "Free Claude Code proxy installed locally — how it is wired into DSH two different ways, and the fallback chain that makes it usable"
metadata: 
  node_type: memory
  type: project
  originSessionId: be428cdb-8d94-4adb-8bc9-22d446db25cf
  modified: 2026-09-02T08:57:01.332Z
---

Free Claude Code (FCC) is installed at `~\Documents\claudecode\free-claude-code` (2026-09-01, from a reviewed clone via `uv sync`, not the remote installer). Admin page: **http://127.0.0.1:8082/admin**. Started with `uv run fcc-server` from that folder; `uv` is at `~/AppData/Roaming/Python/Python314/Scripts/uv.exe`, not on PATH.

Three providers configured (nvidia_nim, gemini, sambanova), ~142 models. Proxy auth is off; the nominal token is `freecc`.

**It is wired into DSH two separate ways, and they are not the same thing:**

1. **A council seat** — `free-claude` runs the same `claude` binary as the paid seat with `ANTHROPIC_BASE_URL` pointed at the proxy and its own `CLAUDE_CONFIG_DIR` (`~/.dsh/free-claude-home`). The separate config dir is load-bearing: without it both seats share `~/.claude` and the free one can silently fall back to the paid subscription. Verified — requests appear in FCC's log, `~/.claude` untouched.
2. **A native DSH provider** — `llm-pi-ai.providers.free-claude-code` in `$DSH_HOME/settings.yaml`, `api: openai-responses`, `baseURL: http://127.0.0.1:8082/v1`, credential `FCC_DSH_API_KEY`. Hot-reloads, no restart.

**Use the routed aliases, never a pinned model slug.** The provider lists `claude-sonnet-4-20250514` / `-opus-` / `-haiku-`, which FCC maps to its own `MODEL` with `MODEL_FALLBACKS` behind them. Naming `anthropic/nvidia_nim/...` pins one model and bypasses FCC's routing entirely, so the fallback chain never fires. FCC only exposes `/v1/messages`, `/v1/responses` and `/v1/models` — there is no `/v1/chat/completions`.

**Why the fallback chain matters:** with `MODEL_FALLBACKS` unset, a 529 Overloaded retried the same model into the same wall — 84 seconds of refusals, then the council's 180s timeout killed the seat. With a chain across all three providers the same prompt answered in 18 seconds. Free-tier capacity is the provider's, not yours; the chain converts "certain failure" into "occasionally slow".

**DSH now starts it for you (2026-09-05).** `~/.dsh/launch-dsh.cmd` calls `~/.dsh/fcc-control.ps1 -Action start` before booting DSH and `-Action stop` after, so FCC is up whenever DSH is. Two things that script had to get right: `uv run fcc-server` is not the server — uv spawns python which spawns the uvicorn worker that binds 8082, so stopping the uv PID leaks the whole tree and the port stays bound; and it only stops a proxy it started, tracked by `~/.dsh/fcc-owned.pid`, so a hand-started one survives. It starts headless via `FCC_OPEN_BROWSER=false` (`config/settings.py`), otherwise every start opens the Admin UI in a browser tab.

**How to apply:** FCC must be running or the free seat fails loudly (deliberately — a silent fallback would spend the subscription). The seat ships disabled and carries `timeoutMs: 420_000`, because a free tier retries through 529s and one global timeout cannot serve a paid seat and a free one. See [[dsh-council-plugin]].

**Readiness and recovery update (2026-09-07, GPT-6).** The launcher now runs `~/.dsh/fcc-session.cjs`, which checks FCC every 30 seconds while its DSH child runs and permits at most three recovery attempts per session. `fcc-control.ps1` requires both `/health` and a nonempty `/v1/models` catalog, starts the installed virtualenv Python hidden, and logs to `fcc-monitor.log` and `fcc-server.stdout.log`/`fcc-server.stderr.log`. Ownership is now `fcc-owned.json` with PID and start ticks, preventing cleanup of a reused PID. The monitor writes `fcc-status.json`. The old uv executable and uv-managed Python paths no longer exist; `.venv/pyvenv.cfg` was backed up and repaired to use installed `C:/Python314` (3.14.7). Live proxy readiness passed. Four mocked recovery tests and script syntax checks passed; live crash/restart and launcher-exit cleanup remain untested. Attaching the monitor to the already-running DSH session was denied by the Codex runtime; the next launch through the updated launcher activates monitoring.
