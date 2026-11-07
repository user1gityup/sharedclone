---
name: handoff-2026-10-24-2128-pm-drag-drop
description: pm UI - user wants drag-and-drop ordering on every section; drag cause not yet found, nothing edited
metadata:
  type: project
---
Id: 2026-10-24-2128-pm-drag-drop
Updated: 2026-10-24 21:58Z (14:58 Pacific)
Host: vmixer2o2
Session: local_afb4c6da side session (started by pm-a1b session local_afb4c6da)
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5 (claude-opus-5-5) side session local_f877cd6f, CLAIMED 2026-10-24 21:31Z; verified: tree clean, brain 5 ahead origin (notes), 40a3259cb present, :4480 pid 4952 live, :4490 free, old scratch db exists (stale, re-copying)
Remote Control: off
Ask (user 2026-10-23): "drag and drop not working i want to add drag and drop order to all sections"
File: ~/.claude/shared-brain/pm/public/index.html (served fresh, no pm restart needed)
Prior context: handoff-2026-10-23-1100-pm-a1b-global-controls.md (A1b cluster via stepBtns on every row; live both hosts at 40a3259cb)
Verified so far: code read only. Drag exists ONLY in Top order view (orderRowHtml line ~766 row draggable, handle is a <button>; bindOrder ~847 dragstart/dragover/drop on #olist). Home/Projects/Tasks/board/Attention/Continue have no drag at all.
Suspected cause (UNTESTED): drag starts on a <button> handle inside draggable row - Firefox never drags from buttons; Chrome may. Also renderMain() replaces #main on poll refresh mid-drag. Reproduce in browser before fixing.
Partial work: scratch DB copy made read-only via VACUUM INTO: %TEMP%\claude\C--Users-vMixer-Documents-claudecode\29a86426-da55-4d19-aead-d0aadc191226\scratchpad\pm-dnd.db (helper vac.cjs beside it). Throwaway pm NOT started.
Uncommitted changes: none (index.html untouched). Brain main 3 ahead of origin (notes only).
Processes/ports: none started. Live pm :4480 untouched.
Plan:
- Start throwaway pm: PM_PORT=4490 PM_BRIDGE=0 PM_SYNC=0 PM_DB=<scratch db>, open http://127.0.0.1:4490, reproduce Top order drag failure, find real cause.
- Add ⠿ handle as FIRST item of stepBtns() cluster (matches dsh-runs/pm-ui-samples-v2/a1b-arrows-left.html); one delegated dragstart/dragover/drop on document keyed by data-k/data-id.
- Drop writes: projects + pinned tasks -> saveOrder(orderMove(...)) PUT /api/order/top; unpinned tasks -> PUT /api/order/project/:pid via stepItem(kind,id,0,to), same project only; pinned rows fixed; gate can('reorder').
- Keyboard: Alt+Up/Down on handle -> stepItem dir.
- Tests in pm/a1b-global.test.mjs; full `node --test` in pm/ must stay green (317/0 before).
- Click-prove drag on :4490 for project rows, task rows, board cards, Attention rows, Continue cards; then check live vmixer :4480 UI.
Next: DONE. Not pushed; push via gatekeeper when user ends session.
Do not: edit pm.db; restart live pm; push (commit/queue only on user say).
Bridge: seq 563 + 565 unacked for claude-code (ndi2 sync rollout); not acted on.
Result (Claude Opus 5.5, local_f877cd6f, 2026-10-24 21:58Z):
- Real cause: Top order drag DID save in Chromium (PUT 200) once a name was set. Failures: (1) empty "You" name -> needActor toast and drop returned early leaving drag-over/dragging classes stuck (looks broken); (2) handle was a <button> in a draggable row - Firefox never drags from buttons; (3) 5s poll render() replaced #main mid-drag. Every other section had no drag at all.
- Fix in pm/public/index.html: ⠿ span handle (draggable, role=button, tabindex) first in stepBtns cluster, data-grp top|p:<pid>; one document-level dragstart/dragover/drop/dragend + Alt+Up/Down keydown -> stepItem(kind,id,0,null,toId) (new toId arg); render/renderMain held while S.drag, flushed on dragend; Top order handle now a draggable span, classes always cleaned.
- Tests: 5 new in pm/a1b-global.test.mjs; node --test 322/0 (exit 0).
- Click-proven on :4490 scratch: Continue card (PUT order/project 200), project rows, task list row, board card, Attention row, Continue 📌 pin -> top list, Top order (pinned row kept slot). Live :4480 serves new code: 99 handles on Home (read-only check, no live writes).
- :4490 stopped. pm edits were auto-committed LOCALLY by brain-sync (6f4a72be1 and later "brain: vmixer2o2 session changes"), NOT on origin, not queued.
