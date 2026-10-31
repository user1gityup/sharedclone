---
name: handoff-2026-10-19-1100-unified-message-handler
description: Unified message handler hub on vmixer2o2 - relays all agent asks to the user, HUB-ASK protocol, unhangs sessions
metadata:
  type: project
---
Id: handoff-2026-10-19-1100-unified-message-handler
Updated: 2026-10-19 13:50Z
Host: vmixer2o2
Session: "Unified message handler (hub 3)" local_3a3d73ad (this) - CLAIMED 13:45Z from local_486b2d0a (context limit)
Model: Claude Opus 5.5 (claude-opus-5-5)
Mode: hub = auto (user switched it ~12:55Z); workers = auto. Auto classifier blocks process kills / settings edits -> switch hub to manual (set_session_permission_mode self default) so the prompt shows in hub window.
Protocol: workers end turn with "HUB-ASK:" (A-D) or "HUB-STATUS:"; no AskUserQuestion, no SendMessage. Hub reads finals via list_events, cards user, relays answer quoted. Rule in ~/.claude/CLAUDE.md.
Unhang: stop/archive/mode change refused while a prompt is open -> hub ends that session's claude.exe (user approved), send_message resumes. Map pid via parent-session ids in claude.exe args.
Ledger: Q1 pm restart=A DONE; Q7 doorbell=later (T-25bb8b1f); Q8 BLITZ-02=A DONE; Q9 end hung procs=A; Q10 DSH lanes="B. Merge all 5"; Q11 sample rerun="a, done in 10 min, max parallelism in claude"; design NOT fully approved; Q12 user picked A1 with pin + up/down LEFT of number; Funnel=later
pm: 4480 pid 41724 (new code), /api/order 200. Brain pm changes uncommitted (commit+push at session end).
BLITZ: user Q13=A -> gatekeeper PUSHED 02+04 as 9f077462+909b1fac on origin/main (259/44/37 exit 0), queue entries closed. 03 e29fe02f live. NOT LIVE in pm yet: local brain main diverged (brain-sync 0ac91197 after push; 1 ahead 2 behind) AND shared-brain git has core.bare=true (merge/status fail; auto mode denied flipping it). User Q14 = "B. Find cause first": inspect brain-sync scripts/log for what set core.bare BEFORE changing it; then card user to fix + merge 909b1fac, then restart pm once.
Sorter: user Q13b=A -> session "Ship A1b sorter into pm UI" local_34d0719a building A1b into pm/public on /api/order; told NOT to restart pm / not commit. After it lands + brain merge: hub restarts pm once (Stop-Process pid 41724, watchdog restarts), smoke /api/order. Note brain-sync 0ac91197 touched pm/public/index.html (may be the sorter session's edits being auto-committed).
DSH lanes: hub merged L1-L5 into deepseek-harness feat/heterogeneous-teammates, HEAD 6708d6fde6 (not pushed). build:lib exit 0; DSH restarted on merged code: :3080 pid 45344 (started 12:54Z), GET / 200. Runs panel not yet eyeballed in GUI.
PM sort samples: dsh-runs/pm-ui-samples-v2/ (h1,h2,h3,a1,a2,a3 + index.html), served by launch.json "pm-sort-samples-v2" http://localhost:5200/. In flight: session "PM sort sample A1" (local_d06df58e) making a1b-arrows-left.html (pin, up, down left of number) + index tab. Next after user OK: wire chosen sample into live pm UI on /api/order.
Trust: deepseek-harness workspace trust=false (old local_1dedb7c6 cannot resume).
Push queue: entry 1099 stale; raise all at session end; push nothing.
Memory index MEMORY.md is 252 lines (>200 cut) - follow-up, not done.
Q14 CAUSE FOUND (Opus 5.5 13:45Z, proven in scratch repro): gatekeeper pushed from linked worktree ~/gkwt at 13:03:50Z; push updated refs/remotes/origin/main -> .sync/hooks/reference-transaction ran mirror-sharedclone.mjs --detach with inherited absolute GIT_DIR=<brain>/.git/worktrees/gkwt; its `git -C tmp init --bare` (mirror-sharedclone.mjs:183) re-inited the BRAIN common dir as bare -> .git/config mtime 13:03:54Z. Main-worktree hooks get relative/empty GIT_DIR so never hit it. Fix = core.bare false + strip GIT_* env in mirror git() (line ~115). Not applied; carded user.
Q15 user="B. Fix + merge only": hub set core.bare=false 13:43Z; brain-sync merged origin itself (3ee4d0de 13:42Z, 909b1fac in main). Mirror script NOT patched (user choice) - a push from a linked worktree will flip bare again. Sorter session local_34d0719a restarted pm itself: pid 34712 started 13:43:01Z on merged code. Smoke 13:47Z: /api/order, /api/blitz/agents, capacity, top-projects, qa, / all 200; order-ui.test 9/9.
Next: relay sorter final report when its turn ends; await user. No second pm restart needed.
Do not: answer another session's prompt; push; overwrite contested resume pointer without need.
