---
name: handoff-2026-10-23-1100-pm-a1b-global-controls
description: pm UI - global sort rows shipped wrong design; replaced with user's A1b pick (pin, up/down, position left of name) on every row
metadata:
  type: project
---
Id: 2026-10-23-1100-pm-a1b-global-controls
Updated: 2026-10-23 (Claude Opus 5.5 local_afb4c6da, context FINISH at 247k)
Host: vmixer2o2
Owner: Claude Opus 5.5 local_afb4c6da
Ask (user 2026-10-23): "the wrong code was shipped for the order feature resarch the correct pick and update to all machines now"; then "update it with correct notes"
Correct pick (verbatim, hub transcript 14ff3a5b, 2026-10-19T12:53Z): "ok i want to select a1 but i want the pinned and up an down arrows to the left of the number" -> sample dsh-runs/pm-ui-samples-v2/a1b-arrows-left.html (handle, pin, up/down, position, name); Q13b=A shipped it as Top order view (correct).
Wrong code: global sort (session 9f086485, 2026-10-20) put bare up/down arrows on the RIGHT of Home/Projects/Tasks rows and board cards (float:right), no pin, no position number -> not A1b.
Fix: pm/public/index.html - stepBtns() now renders .gctl cluster [pin, up/down, position input] BEFORE the name on project rows, project cards, task rows, board cards; typed position + Enter moves (moveIds), pin/unpin via orderPin; drag handle kept only in Top order view. New pm/a1b-global.test.mjs.
Verified: a1b-global+attention-pill+order-ui+sync-ui 24/24; full pm node --test 316/0 exit 0. Live vmixer :4480 shows cluster (92 rows, admin). Throwaway pm :4490 on VACUUM copy of pm.db (bridge+sync off): typed project pos 5->1, project up 3->2, task typed 3->1, task pin -> top list pos 2 right after its project; all writes 200; no console errors except expected /api/bridge/delivery 404 (bridge off). Live pm data NOT touched.
Commits: pushed - origin/main 40a3259cb contains d1513be64 (rows) + 6dc80576e (Attention/Continue) + notes; core.bare false; pm 317/0.
Backup: pm-backups/index.pre-a1b-global-20261023.html
Rollout: DONE both hosts - served index.html sha256 0369565f... identical on vmixer 127.0.0.1:4480 and ndi2 10.0.0.241:4480 (no pm restart needed). ndi2 data render not checked from vmixer (API 401 without ndi2 token).
Remote Control: off (set_remote_control denied by auto classifier).
Attention+Continue: user 2026-10-23 "so now you can globally apply sort capacity" -> both follow global order (byGlobal over S.tasks manual order) with A1b cluster per task; a1b-global 5/5, pm 317/0; live vmixer check: 6 Continue cards + 47 Attention rows in global order, cluster first.
Next: user said "retry" = push brain again; main is 4 commits ahead of origin (notes only, code already live both hosts). Spawn git-gatekeeper from a NON-auto session, push main worktree, confirm 0/0 + core.bare false.
Do not: edit pm.db; restart pm without asking.
