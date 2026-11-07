---
name: handoff-2026-10-12-1100-pm-bridge-autostart-and-ack
description: pm/bridge autostart fixed on both hosts, bridge-inbox hook live, ChatGPT stale-tool ack fallback shipped; waiting on ChatGPT ack of seq 291
metadata:
  type: project
---
Handoff id: pm-bridge-autostart-ack-20261012 (CLOSED 2026-10-12 11:35Z)
Updated: 2026-10-12 11:25Z - replication (B) by vmixer [a9f4f9] merged via brain-sync; ndi2 bridge 29/29 pm 28/28; ndi2 pm pid 2992, replica peer vmixer2o2 last_ok, pulled 82, rev 318
Host: ndi2 (vmixlaptop2x6)
Session: DSH bridge status and auto-load [b44e7e], local_3a44de90-c322-4b71-b10d-97d2bba08a21, Remote Control ON
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5 [b44e7e]
Collaborators: ChatGPT (bridge agent chatgpt); vmixer "3" [0a248f] (RC); vmixer [21ca4d] closed handoff-2026-10-12-0253 6/6 PASS
Ask: check DSH bridge, relaunch, make it auto-load with pm; ship message alerts for Claude and ChatGPT
Verified:
- Cause: brain-sync install() template rewrote Startup/Shared-Agent-Listeners.cmd, wiping the pm-autostart.ps1 line. Fixed in .sync/brain-sync.mjs (pm watchdog line when pm/pm-autostart.ps1 exists). selftest 322/322.
- New hook .sync/claude-hook/bridge-inbox.mjs, wired by install to SessionStart and UserPromptSubmit. Proven live in this session (hook surfaced seq 313, 317).
- ndi2: watchdog restarts pm (51s, 43s). vmixer: watchdog pid 6020, pm 0.0.0.0:4480, LAN health ok from ndi2 with peer token.
- ChatGPT connector caches the original 6 tools and never re-initializes (last_connect 09:45:19Z). Shipped fallback in pm/bridge/index.mjs: bridge_send type "ack" (body {ids, agent?}) -> ackMessages; body.reply_to honoured. bridge test 25/25 (new stale-client test), pm 28/28. ndi2 pm restarted on it (pid 18404); public Funnel tools/list shows it.
- ChatGPT told: seq 312, 314, 316, 318 (318 = exact fallback calls). Brain note chatgpt-bridge-ack-instructions.md updated (mirrored to sharedclone).
Open:
- ChatGPT has not yet acked seq 291 (id 1af70054-cac0-4bf3-b08e-333501859615). Watch GET /api/bridge/delivery/<id> for acked_by=chatgpt.
- Requested by user via vmixer "3" [0a248f], NOT started (this session past 150k): B) replicate bridge mail/acks/responses between ndi2 and vmixer (idempotent by id, cursor catch-up) so either node serves chatgpt+claude-code inbox when the other is off; live test = stop ndi2 pm, read chatgpt inbox from vmixer. C) Cloudflare named tunnel replicas on both hosts serving /mcp/<token> only, autostart, one-click bundle; user Cloudflare login + domain last; keep Funnel until then.
- vmixer pm runs the pre-fallback bridge code; restart it only after running its bridge tests there (ChatGPT connects to ndi2 only, not urgent).
Uncommitted: none outside brain auto-sync. No push. push-requests.md has 2 pending for the gatekeeper.
Next: closed. Auto-dispatch live on ndi2 and smoke-tested by [f0ec11] 13:40Z (direct + cross-machine runs ran; plain and ACK-OK not run; spoofed sender refused); 323 responded. peer/e2e-smoke allow entry still in bridge-policy.json: remove only if the user asks.
Do not: push; restart vmixer pm without its tests; touch claude-code message 31.
