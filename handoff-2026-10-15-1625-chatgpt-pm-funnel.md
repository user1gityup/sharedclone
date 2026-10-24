---
name: handoff-2026-10-15-1625-chatgpt-pm-funnel
description: ChatGPT pm access - vmixer alias deployed on ndi2; vmixer Funnel script sent to vmixer session, result pending
metadata:
  type: project
---
Handoff id: chatgpt-pm-funnel-20261015
Status: session [4a8833] closed at 246k context; owner released. ndi2 ChatGPT connector re-add in progress by user (URL on ndi2 clipboard).
Updated: 2026-10-15 17:25Z
Host: vmixlaptop2x6 (ndi2); Model: Claude Opus 5.5 (claude-opus-5-5); session "DSH bridge status and NDI claims" [4a8833]
Remote Control: unknown (desktop session)
Collaborator: vmixer2o2 "ChatGPT PM access troubleshooting" [0fbcbe] (bridge:session_01CazE2FgGdwT2K4BNNjerRY)
Ask: ChatGPT can't do pm tasks; user approved Funnel on vmixer2o2 for /mcp only + connector URL with pm scope + e2e test.
Verified:
- ndi2 pm 22256 (deploy PASS 15:49Z) has alias vmixer=vmixer2o2 (pm/actions.mjs ALIAS_GROUPS, pm/bridge/workers.mjs forwarder). Suites 29/36 pass. Brain commits local, no push.
- ndi2 chatgpt token scopes send,read,execute,auto,pm; public funnel tools/list has 11 pm tools; write probe pm_comment #273 on T-46fceb2b as chatgpt PASS.
- Audit: real ChatGPT never called pm.*; only bridge_send. vmixer2o2 pm chatgpt last_connect null; vmixer2o2 has no public DNS (no Funnel).
- seq 674 relayed to vmixer2o2 as 675 (vmixer seq 462 queued); old copy stuck in vmixer outbox (vmixer pm lacks alias until brain push + restart).
- Replies to chatgpt: 676, 743, 745/746 (vmixer box), 747 (ndi2 box).
Partial:
- pm/ENABLE-PM-FUNNEL.ps1 v5 (sha 9c752a3f; adds DoH public lookup): -Port, busy-port refusal, rollback, PS5.1 EAP fix, new tailscale CLI (>=1.52 funnel --bg --set-path), token redaction, curl bodies via file. vmixer v3 run: funnel :10000 came up + reached pm, test failed on PS5.1 quote stripping, rolled back. v4 in vmixer bridge-inbox; port 10000 freed (wyze-bridge on :5050). Leaked token (seq 748) dies on next mint.
Open: vmixer run 4e2b99a7 AWAITING_APPROVAL (my read-only diag; not needed, leave). ChatGPT still says pm tools not visible despite pm scope + refresh - cause on ChatGPT side unproven.
Next: v5 (DoH public lookup, 100.x rejected) in vmixer bridge-inbox; [0fbcbe] waits on USER go to run -Port 10000. Then verify :10000 from ndi2 via 208.111.34.11.
Do not repeat: funnel 443 on vmixer (exposes Frigate); reading vmixer token files headless (policy-denied).
