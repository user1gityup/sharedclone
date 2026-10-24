---
name: handoff-2026-10-18-pm-ordering-backend
description: PM project/task ordering backend - spec + 7 READY swarm tasks; Q3 draft TTL open
metadata:
  type: project
---
Handoff: pm-ordering-backend
Updated: 2026-10-20 (Claude Opus 5.5, session 9f086485, claimed from e598f6b3)
Host: vmixer2o2
Session: 9f086485-fb1c-451d-a1d1-59485e3cca19 (owner); prior e598f6b3-9ead-4a18-b225-9471dd9d4baf (26h, handed off 06:04 UTC)
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5; collaborators: none
Repo/branch: none (brain + staging folder, no git work)
Ask: selection-independent backend for PM ordering as <=10 min swarm tasks + spec; pm prepares, never dispatches
Spec: ~/.claude/shared-brain/pm/runs/pm-ordering-backend-spec.md
Staging: ~/Documents/claudecode/dsh-runs/pm-ordering-backend-staging (copy of pm, baseline node --test 151/0, no code written)
pm tasks (vMixer pm, project dsh-pm-uiux, all READY): S1 T-2b7172f0, S2 T-d1598d85, S5 T-4bddea60, S3 T-08a996df, S4 T-1bd000fd, S6 T-51864820, S7 T-ff3d69e4
Waves: W1 {S1,S2,S5} -> W2 S3 -> W3 {S4,S6} -> W4 S7; ~35 min wall clock, estimated
User answers 2026-10-18: Q1 override = own place in top list (spec A1, confirmed); Q2 Manager may reorder top list (spec + S4 T-1bd000fd updated)
Open: none - Q1-Q3 all answered and applied
Verified: spec edits grep-checked; S4 PATCH 200; tasks created 200 READY. Re-verified 2026-10-19 03:45 UTC by Claude Opus 5.5: 7 tasks lifecycle READY, unclaimed, runs=[]; staging node --test 151/0, no files newer than spec; pm 4480 up (pid 36888); no DSH run processes
Committed: ordering backend (order*.mjs x13 incl order-ui.test, store/access/roles/test/server hunks) already in brain HEAD via brain-sync auto-commits and on origin/main (verified 2026-10-20 by Claude Opus 5.5) - commit item DONE
Sorter UI: A1b Top order view live in pm/public/index.html (built by local_34d0719a), order-ui.test 9/9, exercised in browser
Uncommitted (2026-10-20, Claude Opus 5.5, user ask "complete the ui sort build so we can resort and launch our blitz"): blitz/rank.mjs - manual Top order (projects.sort_order) is rank key 0 for /api/blitz/top-projects, inputs.manual_order added; blitz/blitz.test.mjs +1 test; blitz/README.md key 0; public/index.html sorter hint. Then user asks "order persistent throughout pm / change from home works globally / sort everything": server.mjs GET /api/projects passes ?order=manual; index.html loads projects+tasks with order=manual, refresh() keeps S.order (top) current, Tasks default Sort = "Manual (global order)" (Desc disabled), stepIds() in CORE, ▲/▼ on every project row/card and task row/board card (Home, Projects, Tasks list/grouped/board) writing PUT /api/order/top or /api/order/project/:pid, pinned tasks step in top scope; order-ui.test +2 (11/11). Suite 272/0. Click-proven on throwaway pm :4490 (temp DB, bridge off): Home ▲ moved gamma to top -> Top order, Tasks view, /api/projects?order=manual, /api/blitz/top-projects all agree; task ▲ persisted. Backup pm-backups/pre-blitz-manual-order-20261020 (index.html copy already has the hint line)
Separate (user 2026-10-20): vmixer and ndi2 pm hold different projects/tasks - bridge replication (handoff-2026-10-12-1110) covers bridge mail only, not pm.db; proposed as its own session
Processes/ports: pm 4480 pid 38616 (restarted 2026-10-19 13:50 by Claude Opus 5.5 on user word; live suite 268/0 first)
Remote Control: unknown/not turned on by this session
Do not: dispatch, prepare a roster, launch DSH, touch dsh-runs/pm-ui-samples-T-67ba9f12, edit live pm files/pm.db
Status: CLOSED 2026-10-23 by Claude Opus 5.5 (session 9f086485, 76h, ended)
Next: none. DONE 2026-10-20 - global sort LIVE (pm pid 24588 restarted by unify-pm session; stepIds served, /api/projects?order=manual 200, blitz manual_order present) and on origin/main via brain-sync + push 6eb72e099. Old: pm restart needed for blitz rank change (Stop-Process 38616 refused by auto mode -> HUB-ASK); after restart smoke /api/blitz/top-projects shows manual_order and follows Top order. Then brain-sync commits; push at session end via gatekeeper. Rollback: pm-backups/pre-blitz-manual-order-20261020, pm-backups/pre-ordering-20261019T0901Z.
Correction 2026-10-23 (Claude Opus 5.5 local_3014211f): the global sort rows shipped 2026-10-20 used the WRONG design (bare up/down on the right, no pin/position). User pick was A1b (pin + up/down left of the number). Replaced on every row - see handoff-2026-10-23-1100-pm-a1b-global-controls.md.
