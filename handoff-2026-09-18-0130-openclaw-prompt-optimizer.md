---
name: handoff-2026-09-18-0130-openclaw-prompt-optimizer
description: Open - DSH prompt-optimization stage via OpenClaw browser -> ChatGPT before routing; OpenClaw WSL gateway installing; design mapped, no code written
metadata:
  type: project
---

# Handoff 2026-09-18 01:30: OpenClaw -> ChatGPT prompt optimizer

- Id: handoff-2026-09-18-0130-openclaw-prompt-optimizer. Updated 2026-09-18 01:30 PDT.
- Host: vMixer (VMIXER2O2). Session be2640ad-6a74-4fe6-a10b-e5202859cdeb. Model: Claude Opus 5 (claude-opus-5). Remote Control: not changed by this session.
- Repo: `~/Documents/claudecode/deepseek-harness`, branch `feat/heterogeneous-teammates`, HEAD 83dcec25f1, tree clean at start. Owner: this session. Other agents active in the harness today: see handoff-2026-09-18-0121 and -0110 (llama work); avoid their files.

## Ask
User attached `~\Downloads\dsh-openclaw-chatgpt-prompt-optimization-feature.md`: build a DSH preprocessing stage. source_prompt (immutable) -> OpenClaw browser (logged into ChatGPT) -> optimized execution_prompt -> existing DSH pipeline/router unchanged. Fallback to source_prompt on any failure, no recursion, no authority expansion, PM/observability records, tests, report.

## Verified
- OpenClaw was NOT installed at session start. The user is installing it now, via the Windows tray `~\AppData\Local\OpenClawTray\OpenClaw.Tray.WinUI.exe` (v2026.9.4). It runs `wsl --install Ubuntu-24.04 --name OpenClawGateway`, started 01:26.
- Tray `default-config.json`: the gateway runs in WSL distro `OpenClawGateway` as user `openclaw`, bound to WS loopback 127.0.0.1:18789 with token auth. Interop and automount are off. model-auth-provider=skip. The Windows tray is a paired "node" with the Browser capability (NodeBrowserProxyEnabled), so the browser runs on Windows and is proxied. Setup logs are in `%APPDATA%\OpenClawTray\Logs\Setup\`.
- DSH ingress: `packages/council/tool-council/src/index.ts`. The council tool uses `args.query`, then the approval gate (pendingPlanQuery), then runCouncil (~l.1124). The swarm tool (~1368), pipeline (~1593, `startPipeline(... args.query ...)` l.1639) and propose (~2148, `args.task`) follow. Router `src/router/` (resolveRoster) is built but uncalled ([[dsh-runtime-routing]]); resolver step 3 "prepare the prompt" is where this stage belongs.

## Update 2026-09-18 01:45 (Claude Opus 5, be2640ad; hit the 150k FINISH trigger)
- OpenClaw setup is DONE: "Pipeline completed successfully in 446.4s", all 19 steps. The gateway listens on 127.0.0.1:18789. CLI `/usr/local/bin/openclaw` is 2026.9.4 (3a9d69d). Run it as `wsl.exe -d OpenClawGateway -u openclaw -- bash -l < script.sh`. Pass scripts on stdin, because wsl.exe expands `$var` inside an inline command.
- `openclaw nodes status`: "Windows Node (VMIXER2O2)" is paired and approved with caps browser,canvas,... but shows as DISCONNECTED (Connected: 0). The tray log stopped at 01:23 with "No stored device token". Background watcher brxd6o6qq polls for "Connected: 1".
- `openclaw browser profiles`: `openclaw` (managed, cdp 18800, runs in WSL headless, no Chrome detected), `user` (existing-session over chrome-mcp, i.e. the user's real Chrome), `chrome` (extension relay 18799). gateway.nodes.commands.allow includes `browser.proxy`.
- Browser CLI verbs confirmed from --help: `open <url> [--label]`, `evaluate --fn <code> [--target-id] [--timeout-ms]`, `wait [selector] --fn/--text/--text-gone/--load [--timeout-ms]`, `start [--headless]`, `status`, `tabs`, `close`, `batch --actions`, and a global `--json --timeout --browser-profile`.
- Docs to read next: https://docs.openclaw.ai/tools/browser/remote (node browser proxy) and /tools/browser-control.
- WRITTEN, uncommitted: `packages/council/tool-council/src/optimize.ts`. It holds OptimizerTransport, optimizePrompt (fallback to source on every failure, AsyncLocalStorage recursion guard), rejectReason (empty, size, UI/login/rate-limit text, preamble, markup, authority-expansion patterns checked against the source), optimizerInstruction and describeOptimization. It is not yet typechecked, tested or wired.

- 01:52: after 400s of polling the node is still "Connected: 0", and the tray log has no new lines since 01:23:39. The tray has not connected since setup. The setup window may still be open, or the tray may need a restart. Diagnose that first; do not re-run setup.

- 02:05: the user's onboarding wizard needed a reachable model provider. OpenAI OAuth failed and Ollama was unreachable. With the user's explicit yes, Claude Opus 5 installed Ollama 0.34.2 in the OpenClawGateway distro: apt zstd, then the official install.sh, as a systemd service `ollama`. `/api/version` answers from WSL and from Windows at 127.0.0.1:11434. No model has been pulled; pulling one needs a separate yes.

- 02:10: the user finished onboarding with the defaults. The OpenClaw default model is `ollama/gemma4`, which has NOT been pulled, so the model is idle and unused by the optimizer; fix it later if OpenClaw's agent is ever wanted. The Windows node is still "Connected: 0" and the tray log is still stale at 01:23:39. The next step is a tray restart; the user has not yet said yes to it.

- 02:15: the user's gateway restart from the tray failed. The unit was stuck in `deactivating stop-sigterm` for more than 90s, and the CLI returned HTTP 503 "websocket admission closed". Claude Opus 5 ran `systemctl --user kill -s KILL` and then `start`. The gateway was healthy after 20s (active, probe 6ms). The Windows node is STILL "Connected: 0". Stopped here at the 175k FINISH trigger.
- NEXT (for the next session): restart the tray app (`%LOCALAPPDATA%\OpenClawTray\OpenClaw.Tray.WinUI.exe`, pid 23500 at the time); the user has not answered the restart question. Then confirm "Connected: 1" and `openclaw browser status` through the node. The user signs in to ChatGPT in that browser. Then do Remaining 2-5.

## Remaining
1. Decide which browser profile carries the ChatGPT login: the Windows node proxy, or the `user` existing-session. The user signs in to ChatGPT once; that is the only human step.
2. `src/openclaw-transport.ts`: spawn wsl with the script on stdin. Open https://chatgpt.com/?temporary-chat=true and wait for `#prompt-textarea`. Insert the text with evaluate/execCommand, click `[data-testid=send-button]`, wait until the stop button is gone, then read the last `[data-message-author-role=assistant]` innerText. Verify the selectors live first.
3. Config `promptOptimizer {enabled:false default, distro, user, profile, timeoutMs, maxChars}` in the index.ts Config/z schema (~l.134/412).
4. Ingress: call optimizePrompt once for a new query in council (before pendingPlanQuery is stored), swarm, pipeline (startPipeline l.1639) and propose. Store `...SourceQuery` beside it and show both in the approval report. Add `promptOptimization` to RunRecord (runs.ts l.100). Replays, amends and approved runs never re-optimize.
5. tests/optimize.spec.ts (vitest), with all 8 spec test cases using a fake transport. Run `tsc -b` and the full vitest, then a live round-trip, then commit (the spec is the build authorization) and queue it for the gatekeeper. Never push.

## Design (not yet built)
- New `src/optimize.ts`: `optimizePrompt({source, transport, signal})` returns `{source_prompt, execution_prompt, status, provider:'chatgpt', transport:'openclaw_browser', reason?}`. It validates the result (non-empty, size cap, no UI/error text) and returns the source on any failure.
- Call it once at new-query ingress, before the approval gate stores pendingXQuery. Store the optimized text as the query and the source in a new `...SourceQuery` setting. Replays, amends and approved held runs never re-optimize (recursion guard).
- Transport: the OpenClaw CLI/gateway browser API. **It must be read from the installed version; do not invent it.**

## Next action
1. Wait for the distro and gateway. Then run `wsl -d OpenClawGateway -u openclaw -- openclaw --help` and `openclaw browser --help`, and check whether the gateway listens on 18789.
2. Tell the user that the only human step is signing in to ChatGPT in the OpenClaw-controlled browser.
3. Implement optimize.ts, add the ingress hooks and tests (vitest in tool-council), and run tsc -b.

## Do not repeat
- Do not search the drives for OpenClaw again. `D:\vm\wsl\OpenClawGateway` is an empty leftover; the real install path is `%LOCALAPPDATA%\OpenClawTray\wsl\OpenClawGateway`.

- 02:17: Claude Opus 5 (session 8797dd6d, vMixer) CLAIMED. Verified: harness 83dcec25f1, only optimize.ts untracked; gateway answers CLI; node still "Connected: 0"; tray pid 23500 alive, log stale 01:23:39 ("No stored device token — skipping startup connect", tray started before setup); gateways/<id>/device-key-ed25519.json touched 02:16:24. Remote Control was not on in the prior session; left off. Next = tray restart (user resumed the handoff = go).

- 02:30 Claude Opus 5 (8797dd6d): tray restarted (new pid 39704) -> node "Connected: 1". Pinned gateway.nodes.browser.node -> every browser call failed "Browser control authentication was blocked because the local listener owner could not be verified". Cause (from OpenClaw.Shared.dll strings): the Windows node's browser.proxy forwards to a browser-control host on Windows loopback at gateway port+2 (18791); nothing runs there in this WSL-gateway layout, so the NODE ROUTE IS A DEAD END. Unset the pin; auto mode still routed to the node, so SET gateway.nodes.browser.mode=off -> host profiles answer again (openclaw managed headless cdp 18800, user chrome-mcp, chrome extension relay 18799 which wslrelay forwards to Windows). Extension status: not installed, "manual action required" (load-unpacked path is inside WSL).
- Options for ChatGPT browser: (A) extension relay into the user's Windows Chrome (load unpacked once, GUI); (B) dedicated Windows Chrome instance, own profile, --remote-debugging-port, registered as an OpenClaw CDP profile (needs WSL->Windows reachability); (C) WSL headless managed profile (no display for ChatGPT login; weak).
- Do not repeat: node browser proxy route; tray restart (done).

## Update 2026-09-27 02:45 (Claude Opus 5, vMixer/VMIXER2O2, session e849babd)

**Route decided and LIVE: WSLg headful Chrome inside the OpenClawGateway distro.**
Routes A (extension relay) and B (Windows Chrome over CDP) are both dropped — B was
refused by the auto-mode classifier as [Expose Local Services] (it needed Chrome bound
to 0.0.0.0 so WSL could reach it across the NAT), and A needs two GUI actions in the
user's own Chrome plus extension access to all their tabs.

Verified this session, each by live command output:
- Distro was Stopped and the tray was not running; started the distro, gateway healthy
  on ws://127.0.0.1:18789, CLI 2026.9.4.
- WSLg works on this Win10 19045 host: DISPLAY=:0, /mnt/wslg present, `xdpyinfo`
  answers (X.Org 24.1.6).
- Installed Google Chrome 154.0.8037.57 in the distro (`apt install ./chrome.deb` as
  root) — it pulled the x11 deps.
- Gave the gateway a display: drop-in
  `~/.config/systemd/user/openclaw-gateway.service.d/10-wslg-display.conf` with
  DISPLAY=:0 and XDG_RUNTIME_DIR=/run/user/1000. Before this, `browser status` read
  `headless: true (linux-display-fallback)`.
- Config set: `browser.headless=false`, `browser.executablePath=/home/openclaw/bin/openclaw-chrome`
  (a wrapper that execs /usr/bin/google-chrome with `--window-size=1440,960
  --window-position=80,40`; OpenClaw has no extra-launch-args config, so the wrapper is
  the seam). Without it Chrome's X window was 10x10.
- `openclaw browser start` → running: true, software rendering (llvmpipe). Real window
  confirmed via `xwininfo -root -children`: 1516x1057+48+8 under Weston WM, i.e. a
  visible window on the Windows desktop.
- Chrome user-data-dir is `/home/openclaw/.openclaw/browser/openclaw/user-data` —
  persistent in $HOME, so a ChatGPT login survives reboots. (/tmp/openclaw holds only
  logs + crash reports and IS wiped on boot: `D /tmp ... 30d` in tmpfiles.)
- FULL ROUND TRIP PROVEN, logged out: `browser open https://chatgpt.com/?temporary-chat=true`
  → `snapshot` (composer at ref e118) → `type e118 "Reply with exactly: OPENCLAW ROUNDTRIP OK" --submit`
  → `wait --text` → page text ends "ChatGPT said: OPENCLAW ROUNDTRIP OK".
  So open/snapshot/type/submit/wait/evaluate all work through the CLI.

### The one human step left
Sign in to ChatGPT in that Chrome window (open now). Logged out, ChatGPT serves an
anonymous shell with NO `#prompt-textarea` and NO `[data-message-author-role]` marks —
only `testid:desktop-app-shell` and a `textarea#mobile-composer-prompt`. Reply extraction
would have to guess at body text. Signed in gives the stable documented DOM the transport
targets. Agents cannot do this step: credentials.

### Known rough edges
- The gateway restarts itself after `openclaw config set` ("restart drain"), and a restart
  kills Chrome; `openclaw browser start` brings it back. The transport must tolerate this.
- No Windows autostart for the tray or the distro: nothing runs at logon, so the distro
  must be started before a run. Not yet addressed.
- Gateway warns at every boot: ollama.service is enabled with Restart=always and CUDA
  visible = WSL2 VM crash-loop risk. Ollama was only installed to satisfy onboarding and
  its default model `ollama/gemma4` was never pulled. Disabling its autostart is the
  obvious hardening; not done, needs a yes.

### Next
1. User signs in to ChatGPT in the open window.
2. Re-probe the signed-in DOM, then write `packages/council/tool-council/src/openclaw-transport.ts`:
   spawn `wsl.exe -d OpenClawGateway -u openclaw -- bash -l` with the script on stdin;
   write the instruction to a temp file via a quoted heredoc and pass it as `"$TEXT"` to
   `openclaw browser type <ref> "$TEXT" --submit` (safe: no re-parsing); find <ref> by
   grepping `snapshot` for the composer textbox; wait on a --fn that requires the stop
   button gone and a non-empty last assistant message; read it with evaluate.
3. Then Remaining items 3-5 below (config schema, ingress hooks, tests). `src/optimize.ts`
   is still untracked and unchanged since 2026-09-18; it is complete and reads well.
