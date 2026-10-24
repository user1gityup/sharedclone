---
name: handoff-2026-10-20-0715-pm-attention-in-role-bar
description: pm UI - move the attention strip into the header bar beside Role; request not found in brain, restated by user 2026-10-20
metadata:
  type: project
---
Id: 2026-10-20-0715-pm-attention-in-role-bar
Updated: 2026-10-23 (Claude Opus 5.5, side session local_3014211f, CLAIMED)
Claim 2026-10-23 Claude Opus 5.5 local_3014211f: verified live - brain git clean, main ahead 3 of origin; pill work is ALREADY COMMITTED by brain-sync auto-commit (pm/public/index.html + pm/attention-pill.test.mjs in a4e2d0642 etc.) and contained in origin/main -> nothing left to commit/queue for the pill. Tests 20/20 PASS (exit 0). pm 127.0.0.1:4480 HTTP 200, served index.html has #attPill. Remote Control turn-on BLOCKED by auto-mode classifier (set_remote_control denied). Owner now local_3014211f; waiting on user for global-order question.
Host: vmixer2o2
Session: Claude Opus 5.5, side session of local_8310c8bc (context limit, quota-hook FINISH)
Owner: unclaimed (next session claims); prior owner Claude Opus 5.5 local_636940ee, Remote Control on
Ask (user, verbatim 2026-10-20): "i made a request for attention to go in same bar as role"
Search done: brain *.md, pm/runs/pm-ui-design-specification.md (only "Top alert strip + dedicated Attention panel"), pm tasks/comments, bridge.db, all CCD transcripts incl archived -> original request NOT found. Treat the user's restatement as the spec.
Current UI (pm/public/index.html, live on both hosts, same file): header row = menu, title, search, Ctrl+K, New, sync pill, Role select, View as; Home shows a separate full-width red strip "46 need attention (20 high, 9 medium, 17 low)" + "Open Attention panel" button below the header.
Wanted: attention count/severity as a compact pill INSIDE the header bar next to Role (click -> Attention panel), on every view; drop the separate full-width strip.
Also open from user 2026-10-20: "sort is a global function ... haven't seen the design move" - global ▲/▼ exist on Home/Projects/Tasks rows + Top order view (gated by can('reorder'): admin/manager/worker), NOT on Attention panel or Continue cards. Ask user if Attention/Continue should follow global order (offered card: A global order+arrows / B pin to top / C strip / D sample) - unanswered.
State: pm sync LIVE both hosts (handoff-2026-10-20-0615-pm-shared-store.md, CLOSED). index.html edits reach ndi2 only via brain push + ndi2 pull + pm restart (no restart needed for static index.html? server reads public/index.html per request -> pull alone is enough).
Tests: order-ui.test.mjs, sync-ui.test.mjs read index.html blocks; keep them green.
Done (uncommitted, brain repo): pm/public/index.html - #attPill button in header.top right before Role (class high/med by severity, '46 need attention 20H·9M·17L', click -> nav attention); renderAttPill() called from renderStrip; #alertStrip now only shows offline/load errors. New test pm/attention-pill.test.mjs; attention-pill+order-ui+sync-ui 20/20 PASS. Browser 127.0.0.1:4480: pill beside Role at 1400px and 375px (no overflow), visible on Tasks view, click opens Attention panel, strip empty.
Next: Q&A card on Attention panel + Continue cards following global order (A global+arrows rec / B pinned top / C leave / D sample) was REJECTED by user unanswered - do not re-ask unprompted; wait for user. Pill work uncommitted in brain repo (pm/public/index.html, pm/attention-pill.test.mjs); commit + queue at session end only.
Do not: hand-edit pm.db; restart pm without HUB-ASK; push (gatekeeper at session end).
