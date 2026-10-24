---
name: handoff-2026-10-08-0940-dsh-bridge-build
description: DSH bridge - all acceptance tests run and passing (1-11); L6 docs reviewed+copied to pm/bridge; Funnel ON
metadata:
  type: project
---
Handoff id: dsh-bridge-build-20261008
Updated: 2026-10-08 (claim) [4a7679]
Host: ndi2 (vmixlaptop2x6; Tailscale name now vmixlaptop2x6.tail0f662.ts.net, was 2x4)
Session: Resume DSH bridge handoff [f24abd], local_1c97332e-eacb-435b-aa27-711cc89f396e, Remote Control ON
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5 session local_de888b77 [4a7679], RC ON (claimed 2026-10-08; verified ndi2 pm pid 24140 0.0.0.0:4480 /api/health ok; vmixer 10.0.0.244 = host up (tailscale pong 3ms) but :4480 times out on LAN and 100.72.119.57). Previous owner: Claude Opus 5.5 local_1c97332e (claimed 2026-10-08, RC ON; verified pm 29148 0.0.0.0:4480, vmixer 10.0.0.244 health ok, funnel /mcp/<tok> only, brain clean); prior [a652e4] released, [e0c82b] released. Collaborator: vmixer "Remote standby for swarm code send" (bridge:session_01HkudN7BhTy2DUe3MxGn2WR), standing by
Prior-agent contact: [a652e4] not in ListAgents at claim time (session ended); no message sent.
Ask: run DSH swarm lanes; run test 11 (ChatGPT) - user says Tailscale active, ChatGPT standing by for MCP instructions
pm: project P-c4b7ecad, lanes L1 T-9f4f80fa .. L6 T-c53799e9
Verified: unit 14/14, pm 28/28; cross-host ndi2<->vmixer tests 1,4,8 PASS (bridge-evidence/integration-2026-10-08T10-32-37-108Z.json), 7 queue-half PASS (xhost-test7-2026-10-08T10-34-03-965Z.json); lease-lost half local only
Processes (2026-10-08 16:23 [f24abd]): ndi2 REBOOTED 06:33 local; pm restarted pid 24140 0.0.0.0:4480 via START-PM-LAN.cmd + BRIDGE_ALLOW_FAILOVER=1, health ok, Funnel ON. vmixer 10.0.0.244:4480 TIMES OUT (unverified why: reboot/IP change?) - restart pm there with START-PM-LAN.cmd and update peers if IP moved. Both hosts' code has TTL fix (hash cc8a5dea).
Code changes (uncommitted until brain auto-sync): bridge/integration.mjs --peer mode; bridge/auth.mjs + server.mjs proxied (x-forwarded-for/forwarded/tailscale-funnel-request) = remote; bridge/index.mjs /mcp/<token> path auth (bridge-tokens only, PM_TOKEN in path 403)
Token: "chatgpt" send,read,execute in pm-data/bridge-tokens.json; URL in ~/.claude/pm-data/chatgpt-mcp-url.txt (outside git)
L6: docs reviewed+corrected by [a652e4], now pm/bridge/RUNBOOK.md, SECURITY-REVIEW.md, FAILURE-MODES.md (drafts in dsh-runs/L6-bridge-docs; RUN-20261008-001 gate FAILED, swarm stage not reached). TTL-on-forward bug FIXED [f24abd].
Tailscale: HTTPS certs on; ACL replaced by user with default + nodeAttrs funnel (autogroup:member); Funnel ON 443 for /mcp/<tok> only; verified public via 208.111.35.209
Serve: FIXED. tailscale 1.44 forwards mount as /mcp/<tok>/ (trailing slash); index.mjs regex allows it. serve https /mcp/<tok> -> http://127.0.0.1:4480/mcp/<tok> live (tailnet): 6 tools; wrong token/bare /mcp = 404 at tailscale. Run tailscale from PowerShell (Git Bash mangles /paths)
Next: (1) BLOCKED [4a7679] 2026-10-08: vmixer host up (tailscale ping 3ms via 10.0.0.244) but ALL inbound TCP times out (4480,22,445,3389,5985,5986, LAN and 100.72.119.57) => pm down and/or firewall/network profile flipped after reboot; no vmixer agent online (standby session offline, not in ListAgents), so no route in. Needs someone at vmixer: run pm/START-PM-LAN.cmd, confirm network profile Private; then rerun health from ndi2; (2) DONE [4a7679] user approved in manual mode: new scope `auto` (auth.mjs), bridge_run_claude permission_mode default|acceptEdits|auto + cwd (index.mjs; bypass refused 400), execRoots += shared-brain with --add-dir, auto runs get --allowedTools mcp__pm (workers.mjs), cli token-scopes; chatgpt token = send,read,execute,auto; tests bridge 16/16 pm 28/28; pm restarted pid see log; Funnel E2E as chatgpt run 161a471c => BRAIN=## Shared operation PM=15, no denials. Instructions sent to chatgpt inbox seq 215; awaiting ChatGPT's own run + reply. vmixer has OLD bridge code until brain sync reaches it.
Do not: push; expose / or /api via Funnel (pm GET / is unauthenticated); put PM_TOKEN in URLs; start council
Full history: shared-agent-log.md entries 2026-10-08 [e0c82b]/[a652e4]

## Sync audit ndi2<->vmixer [4a7679] 2026-10-08 ~17:00 PDT
vmixer pm back (pid 32856, started after 470fbc55; health ok from ndi2). Bridge *.mjs identical except integration.mjs = line endings only (both blobs bed9934f, both clean) => bridge code IN SYNC.
Remaining gaps:
- deepseek-harness: vmixer 54a9807b8e ahead2/behind8 (+1 untracked note); ndi2 fd7ae624da = origin. Needs rebase on vmixer + gatekeeper push.
- dsh-headless (vmixer only): fix/files-resolve-existing-root HEAD 06eedc3f59, no upstream; push-requests entry says Head abcb7bb850 -> stale/mismatched entry.
- canna/commerce/users: vmixer on build/ecom-final (3ac132e/4094464/85bc0b8, no upstream), ndi2 on main. commerce being built on vmixer NOW (tier pricing+fulfillment+ledger) - do not sync until it lands.
- billboard-platform: vmixer wp0-solar-sam = 60e5607 (ancestor of main), ndi2 main 3a61f5e.
- lead-intelligence: ndi2 only, no remote.
- free-claude-code: both 84 behind origin (running FCC on ndi2 :8082).
ChatGPT two-way test PASS [4a7679]: ChatGPT submitted run dc86875c (seq 216, permission_mode auto, cwd shared-brain) => BRAIN=Shared operation PM=16, exit 0; ChatGPT replied seq 223. One compound PowerShell call was refused (headless auto mode refuses multi-step shell commands); the run fell back to Read and finished.
