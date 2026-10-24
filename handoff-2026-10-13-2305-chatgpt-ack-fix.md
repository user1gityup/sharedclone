---
name: handoff-2026-10-13-2305-chatgpt-ack-fix
description: CLOSED 10-14 - reply-as-ack proven live on ndi2 (seq 385/387), no deploy needed
metadata:
  type: project
---
Handoff id: chatgpt-ack-fix-20261013
Updated: 2026-10-13 23:05Z
Host: vmixer2o2
Session: f379ac (ChatGPT ACK not working)
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5 vmixer2o2; no collaborators
Remote Control: off
Ask: investigate why ChatGPT acks don't work; user picked fix "Reply = ack" and said go on the plan
Root cause: ChatGPT reads mail but never calls bridge_ack and answers with correlation_id instead of reply_to; 206 chatgpt messages unacked on ndi2. Server ack path proven fine (ndi2 live MCP fallback ack of seq 565).
Fix: ~/.claude/shared-brain/pm/bridge/queue.mjs enqueue(): a type=message from the recipient whose reply_to or correlation_id names its mail marks that mail acked+responded and advances cursor. Non-message types (refusals/results) only mark responded via reply_to, as before.
Test: new test in pm/bridge/test.mjs ("a recipient reply ... acknowledges the original"); bridge 36/36, pm 28/28.
Live vmixer: pm restarted (pid 24012 -> 28040, health ok). Live test PASS: msg 0048fc57 replied via correlation_id only -> state responded, acked_by chatgpt.
Live ndi2: NOT done. ndi2 (vmixlaptop2x6, the node ChatGPT's connector actually hits via Funnel) still runs old code. Needs brain sync of queue.mjs+test.mjs, both suites run there, pm restart, then live check. A bridge-dispatched claude run on ndi2 has no shell/read access (tried, cost $0.66, cancelled seq 357) - needs an interactive ndi2 session.
Test rows left: ndi2 seq 565 (ack-diag, acked); vmixer seq ~361/362 (ack-diag pair, acked). Harmless; delete only if user asks.
Backlog: 206 old unacked chatgpt msgs NOT cleared (user did not pick that option).
Uncommitted: queue.mjs, test.mjs, this note, log entry - brain sync commits them; no push.
Do not repeat: ndi2 audit via peer token (lacks admin); bridge run-claude diagnostics on ndi2 (no tools).
Claimed 2026-10-14 00:25Z by Claude Opus 5.5 vmixer2o2 session fd63a6. Verified: queue.mjs fix present and already on origin; vmixer pm healthy. ndi2 pm answers on 10.0.0.241:4480 but no shell route from vmixer (no SSH/WinRM, no ndi2 Claude session in ListAgents).
Built: ~/.claude/shared-brain/pm/DEPLOY-PM-UPDATE.cmd (+ .ps1): brain-sync start, both suites, stop pm, watchdog restart, readiness check; log pm-data\deploy.log. Tested on vmixer: PASS, exit 0, pm 28040 -> 28512. Not yet on origin (brain push held until session end).
Next (revised): after the brain push, on ndi2 double-click pm\DEPLOY-PM-UPDATE.cmd, then send chatgpt a check message and confirm its reply acks the original.
Old next: on ndi2, sync brain, run node test.mjs + node bridge/test.mjs in pm, restart pm, send chatgpt a check message and confirm its reply acks the original.

CLOSED 2026-10-14 14:13Z by Claude Opus 5.5 vmixer2o2 session 139bc5: live test PASS on ndi2 (vmixlaptop2x6) without deploy. Sent seq 385 id 60466ba8 to chatgpt@vmixlaptop2x6; ChatGPT replied seq 387 id 878c52ad reply_to=60466ba8 "ACK-OK" at 14:12:10.886Z; original went delivered+acked(acked_by chatgpt)+responded at 14:12:11.699Z, same instant as reply = reply-as-ack. ndi2 pm pid 8108 (started after queue.mjs commit) already runs the fix; DEPLOY-PM-UPDATE not needed. Backlog 228 old chatgpt msgs still unacked (user has not chosen to clear).
