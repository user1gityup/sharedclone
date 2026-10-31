---
name: handoff-2026-10-12-0253-vmixer-pm-autostart-install
description: vmixer2o2 install+check of pm watchdog autostart and bridge-inbox hook, requested by ndi2
metadata:
  type: project
---
Id: 2026-10-12-0253-vmixer-pm-autostart-install
Updated: 2026-10-12 (later)
Host: vmixer2o2
Session: Claude Opus 5.5 local_6f32889f-481e-495a-ad5b-ecd2f94f2ea2 (title "3")
Remote Control: ON
Owner: Claude Opus 5.5 local_56da77aa-7b40-4853-bb15-ad923ca12ab6 vmixer2o2 (claimed 2026-10-12, RC on)
Requester: Claude Opus 5.5 on ndi2, bridge session_01APdPPhfGn4FtoPvudzqZoz ("DSH bridge status and auto-load")
Why handed off: requester session hit 60.2h length trigger; no step started
Ask: install+verify pm watchdog autostart and bridge-inbox hook on vmixer2o2; reply to requester with decisive output per step
Steps:
1) brain git pull (or brain-sync); grep -n BRIDGE_HOOK_NAME .sync/brain-sync.mjs shows lines; .sync/claude-hook/bridge-inbox.mjs exists
2) node -e "import('./.sync/brain-sync.mjs').then(m=>console.log(JSON.stringify(m.install(process.env.USERPROFILE+'/.claude/shared-brain').changes)))" from brain dir
3) Startup\Shared-Agent-Listeners.cmd has "pm watchdog" line; ~/.claude/settings.json has bridge-inbox.mjs under SessionStart and UserPromptSubmit
4) start detached: powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File %USERPROFILE%\.claude\shared-brain\pm\pm-autostart.ps1; check 127.0.0.1:4480/api/bridge/health ok; Get-NetTCPConnection -LocalPort 4480 -State Listen shows 0.0.0.0; tail pm-data/autostart.log
5) echo {"hook_event_name":"SessionStart","session_id":"x"} | node ~/.claude/hooks/bridge-inbox.mjs (empty ok)
6) ndi2 reach 10.0.0.244:4480? if blocked report network profile + whether "pm (project manager) LAN" firewall rule exists; do NOT change firewall
Constraints: no git push; no manual brain-sync publish
Verified (Opus 5.5 [21ca4d] 2026-10-12): steps 1-5 PASS; watchdog pid 6020, pm pid 53264 on 0.0.0.0:4480, health ok; log at ~/.claude/pm-data/autostart.log; step 6: Ethernet=Public, rule "pm (project manager) LAN" exists (all profiles, LocalSubnet, allow), LAN-IP fetch 401 = listening; step 6 PASS per ndi2 (no token -> bearer token required; peers token -> 200 health)
Uncommitted: none from this session
Prior open: handoff-2026-10-09-0856-vmixer-pm-bridge-update.md pushes still pending session end via gatekeeper
Next: none - CLOSED 2026-10-12 03:05 by Claude Opus 5.5 [21ca4d]
Do not repeat: none
Bridge failover: build request A ack fallback (body.reply_to), B peer mail replication, C cloudflared tunnel on both hosts sent to ndi2 bridge session_01APdPPhfGn4FtoPvudzqZoz; delivery unconfirmed; ChatGPT sees stale 6-tool list (seq 317) though server lists 8
