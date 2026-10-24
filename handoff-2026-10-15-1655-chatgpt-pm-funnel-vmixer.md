---
name: handoff-2026-10-15-1655-chatgpt-pm-funnel-vmixer
description: Opus 5.5 17:50Z: ChatGPT pm access PASS (ndi2 connector, 30 projects); vmixer Funnel off, optional
metadata:
  type: project
---
Handoff id: chatgpt-pm-funnel-vmixer-20261015
Updated: 2026-10-15 17:50Z
Host: vmixer2o2
Session: "ChatGPT PM access troubleshooting" [0fbcbe] (Claude Desktop, Remote Control off)
Model: Claude Opus 5.5 (claude-opus-5-5)
Collaborator: ndi2 session [4a8833] CLOSED at context limit; its handoff handoff-2026-10-15-1625-chatgpt-pm-funnel.md
Ask: let ChatGPT reach vmixer2o2 pm (pm_* tools). User chose: Tailscale Funnel on vmixer2o2 for pm /mcp only, port 10000.
Diagnosis: ChatGPT connector was ndi2 only; ndi2 chatgpt token already has pm scope (11 pm_* tools). vmixer2o2 had no Funnel, so ChatGPT never reached its pm.
Done (verified): serve :10000 (wyze-bridge UI) removed; wyze-bridge answers 200 at http://100.72.119.57:5050. 443 (Frigate 8971) and 8443 (ntfy 2586) unchanged, tailnet-only.
Script: shared-brain/pm/ENABLE-PM-FUNNEL.ps1 = v3 + partial edit. v5 in bridge-inbox (sha 9c752a3f...) has DoH fix but STILL uses curl -d $listBody/-d $call (body files written, unused) -> will fail; needs --data-binary "@$listFile"/"@$callFile". Run only on user go
Failed runs: run1 PS5.1 stderr bug (token lost); run2 old tailscale syntax, rolled back, RAW TOKEN leaked into funnel-setup.log and bridge seq 535 (vmixer) / 748 (ndi2). That token is superseded on the next mint.
In flight: none on vmixer. v3 run 16:53Z: funnel came up :10000, test FAIL (PS5.1 strips JSON quotes to curl.exe), rolled back; nothing public (ndi2 probe 000)
Next: ChatGPT pm access DONE (seq 539 PASS, pm_list_projects 30 projects via ndi2 connector after Refresh). Optional: vmixer Funnel only on user go, v5 + curl --data-binary fix
Undo: ENABLE-PM-FUNNEL.ps1 -Off -Port 10000.
Uncommitted: shared-brain/pm/ENABLE-PM-FUNNEL.ps1 (+ .cmd) new files.
Do not repeat: old serve/funnel syntax; token-add under ErrorActionPreference Stop.
Not done: bridge inbox acks (user did not ask); seq 461/462 PM UI council request untouched.
