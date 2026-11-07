---
name: handoff-2026-10-14-1645-ndi2-pm-scope-deploy
description: ndi2 pm fixes + bridge backlog done; open - peer clipboard-token request, new ChatGPT msgs 610/670-672
metadata:
  type: project
---
Handoff id: ndi2-pm-scope-deploy-20261014
Status: pm fix work DONE; quota handoff 2026-10-15 00:05Z (9.8h session) by Claude Opus 5.5 [1b8504], owner released
Bridge backlog done: replies seq 603-609 (315, 503, 277-279, 575, 496); pm task T-46fceb2b (OpenClaw test, Phase 3, dsh-bridge). Left for ChatGPT's own pm test (user's instruction): seq 576 Ecom/Canna repos and the Wyze/Frigate registration.
New, unread in full, not acted on: chatgpt seq 610 (register the Wyze/Frigate pm entry), 670/671/672 (camera Q1-Q6 answers for T-25bb8b1f in P-a637179e). ChatGPT appears to have created pm entries itself; check with the user whether claude-code should act on them.
Peer request deferred: "Continue PM review with user notes" [d3da7d] on vmixer2o2 asked, on the user's behalf, to copy the ndi2 PM token to the clipboard and open http://127.0.0.1:4480/. Not done: quota stop, and it was a relayed request. Replied FAIL/deferred.
Next: ask the user (a) whether to do the clipboard token step on ndi2 and (b) whether to act on seq 610/670-672 or leave them to ChatGPT.
Host: vmixlaptop2x6 (ndi2)
Model: Claude Opus 5.5 (claude-opus-5-5)
Remote Control: on
Owner: Claude Opus 5.5 ndi2, session "Continue ndi2 pm deploy follow-ups" [1b8504]; prior [fd97c7] released (confirmed by message)
Collaborator: "Bridge status" [421a68]/[139bc5] on vmixer2o2
Done earlier ([fd97c7]): chatgpt bridge token scopes send,read,execute,auto,pm; pm deployed on brain 6ff2f26d; reply-as-ack proven (seq 385/387).
Correction: the 23:48Z "post-reboot PASS" was wrong. The boot-time S4U watchdog task loads no profile, so USERPROFILE/homedir was C:\Users\Default and pm 8468 served an empty pm.db/bridge.db with no bridge tokens. Only starts before logon are hit; starts after logon used the real profile.
Fixed + verified (user go 2026-10-14):
- pm-autostart.ps1 pins USERPROFILE/HOME/HOMEDRIVE/HOMEPATH from HKLM ProfileList by token SID. Tested with USERPROFILE forced to C:\Users\Default -> resolves ~.
- Default copy inventory: 0 rows in every pm/bridge table except 4 audit rows (this session's own 404 probes). Nothing to recover.
- Restart: Stop-ScheduledTask, elevated taskkill 8468, Start-ScheduledTask -> pm on ~\.claude\pm-data (server.log + /api/health db path), LAN mode.
- seq 599 answered by reply seq 602 (ACK; Wyze/Frigate NVR NOT in pm: no project/task among 29 projects, no brain note). Delivery state responded.
- DEPLOY-PM-UPDATE.ps1: pm pid from the 4480 listener; Stop-Process, then UAC taskkill if still alive; readiness checks for a new listener pid. Ran end to end: suites pass, elevated path used on 25976, new pid 9208, deploy PASS exit 0, db = real path.
vmixer: not affected (pm starts at logon via Startup\Shared-Agent-Listeners.cmd, full profile; no watchdog task). Fixes reach it through brain-sync.
Open (pm fix): none. Brain commits by brain-sync (c91d6488 + next sync). No push.
Do not repeat: Stop-Process on session-0 pm without elevation (access denied); Stop-ScheduledTask does not kill the pm child; trust /api/health db path, not pid/health alone.
