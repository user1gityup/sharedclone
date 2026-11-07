---
name: handoff-2026-10-18-0538-openclaw-headless-dsh-test
description: OpenClaw speed-up (warm 17.3s) on origin in 39bbbb5c39; tab cleanup + keepalive autostart + DSH restart left
metadata:
  type: project
---
Id: handoff-2026-10-18-0538-openclaw-headless-dsh-test
Updated: 2026-10-19 08:20Z
Host: vmixer2o2
Session: 2e570559-5683-4ee1-bab9-fb3650a5acd0 (Claude Opus 5.5, side session of local_67173fec); context handoff at 253k
Model: Claude Opus 5.5 (claude-opus-5-5)
Remote Control: off
Owner: Claude Opus 5.5 session 2e570559 (vmixer2o2), claimed 2026-10-18 for markup Requirement + model/effort probe (spawned by local_67173fec)
pm task: T-46fceb2b on ndi2 pm (comments #274-#278 A/B/C results; #285 GUI-test outcome)
Ask: test DSH -> OpenClaw headless -> ChatGPT -> DSH; support user's live GUI test; restore default model; record outcome
Verified: A PASS 63.6s, B PASS (Always allow), C PASS 45.5s via DSH API (2026-10-16); re-smoke 2026-10-18 20:35Z PASS nonce OCPROOF-F5O909EO exact, 63.6s cold
GUI test: NOT done. User session 997ee191 ran llama-local/Qwen3.6 (down, TRANSPORT) so never reached ChatGPT; pending user picking "ChatGPT (browser, free)"
Default model: free-claude-code/claude-sonnet-4-20250514, restored 2026-10-19 04:46Z via session.selectModel after the markdown DSH turn; verified settings.yaml line 2582-2584
State 2026-10-19 04:30Z: DSH :3080 up; ndi2 pm up; T-46fceb2b comments #282 #283 #285 posted; openclaw-markup session (local_0ec12e11) working - its live test may rewrite the default again; OpenClawGateway on-demand
Caveat: DSH selectModel rewrites global agent-default-model; session title call also routes to ChatGPT
Not tested: tool calls via ChatGPT, long chats, role-based visibility, multi-user identity, notifications
Commits (user "lets go"): deepseek-harness feat/heterogeneous-teammates 2aabe9590c (markdown reader + tests) and d02f20492e (drop unused oxlint directive); hooks green, vitest 45/45; 2 ahead of origin, NOT pushed (push only at session end via gatekeeper). Other M files in that repo belong to another session
Open: 4 unacked bridge msgs for claude-code on vmixer pm (seq 31, 333, 357, 478) - reported, not acted on
Model/effort: GPT-6; thinking effort changed Medium -> High 2026-10-19 05:05Z on user request (slider ArrowRight in model menu, profile openclaw); verified data-selected-reasoning-effort=high and label "High" after page reload
Requirement (user 2026-10-19 04:23Z): reply as web markup, not plaintext - DONE in code 2026-10-19 04:40Z by Claude Opus 5.5 (2e570559): read() now runs DOM_TO_MARKDOWN (src/markdown.ts, in-page JS source, innerText fallback on throw) - links/citations [t](href) minus utm_source=chatgpt.com, code fences from CodeMirror [data-language], lists, headings, span-based bold/italic, tables, KaTeX; chrome (data-markdown-copy=exclude, buttons, hidden, sr-only) dropped. Gates: vitest pkg 45/45 exit 0, tsc -b exit 0, oxlint exit 0, jscpd 0 clones. Live: built lib smoke 60.7s exit 0 reply "OCLINK-5SIZ5Q80. [Example](https://example.com/)". LIVE in DSH: user said "Yes, restart DSH" (relayed by local_20e0b59d); 04:39Z stopped pid 7176, ran ~/.dsh/launch-dsh.cmd, :3080 up pid 37568 after 121s. DSH API turn (session-4f32d6a5, Harness Build, openclaw-chatgpt/chatgpt-web) 63.7s turn/end completed, reply "OCDSH-AS0JSLL2. [Example](https://example.com/)". Note: UPDATE-DSH would not have restarted it (HEAD e96ac5e311 == .built-commit; change uncommitted)
Next: (1) tab cleanup: open tab via curl PUT 127.0.0.1:18800/json/new (fallback openclaw open loop when CDP down = cold), evaluate --target-id, mark finished tab (e.g. URL hash #oc-done via replaceState) and close only done tabs via /json/close after opening the new one - never close active tabs (title call runs concurrently); (2) persist keepalive (Startup-folder .vbs loop running the sleep-infinity wsl.exe hidden); (3) re-test cold/warm + DSH restart (user OK needed) + DSH API turn; (4) restore default model free-claude-code/claude-sonnet-4-20250514 if selectModel used; (5) commit only on user word
Do not repeat: true headless (Cloudflare block); Allow-once watcher gated on nonce
Speed ask: user 2026-10-19 "do all possible" (make openclaw-chatgpt faster)
Speed measured: old transport cold 61.9s / warm 41.1s; each openclaw CLI call ~5s startup x6 calls. New: cold 37.0s, warm 17.3s (link smoke OCLINK-QVWH1FXT PASS 05:34Z)
Speed built (committed by another session in WIP 39bbbb5c39 with council changes; on origin, ls-remote 51e469996a 08:20Z): src/transport.ts: whole turn is one async in-page evaluate (composer wait, insertText, click Send, done = Stop button gone + 300ms stable, fallback 3s stable, turn-count guard, markdown read); failures return OC_FAIL:<code> mapped by parseReply via unfail() to EXIT_REASON; bash = open loop (exit 21) + 1 evaluate (--timeout 360000, --timeout-ms 350000). tests/openclaw-chatgpt.spec.ts updated (+OC_FAIL cases); tests/markdown.spec.ts oxlint-disable restored (d02f20492e removal was wrong: full oxlint needs it, staged lint only warns). vitest 45/45, tsc, oxlint exit 0; lib rebuilt
Keepalive: TEMPORARY: hidden wsl.exe -d OpenClawGateway -u openclaw --exec sleep infinity, Windows pid 4872, started 05:20Z; dies on reboot/wsl --shutdown. Not persisted yet
Speed findings: navigate to same URL hangs 30s (gateway timeout) -> use open; open adds a tab per turn (14 tabs seen); evaluate setting location.href hung 124s; batch returns no evaluate results; Chrome CDP HTTP at 127.0.0.1:18800 in distro: PUT /json/new?<url> 35ms returns id, evaluate --target-id <raw id> works, /json/list, /json/close/<id> available (curl present, jq absent)
