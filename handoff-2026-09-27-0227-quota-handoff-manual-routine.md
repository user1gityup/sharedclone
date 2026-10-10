---
name: handoff-2026-09-27-0227-quota-handoff-manual-routine
description: "Make quota handoff a manual, archive-first, machine-aware Routine (spec in Downloads) - Claude Opus 5, vmixlaptop2x6"
metadata:
  type: project
---
Handoff id: HO-2026-09-27-0227-qhr
Status: BUILT + TESTED 2026-09-29 19:46 (pm T-53f181f3, pipeline D2) - pending brain-sync source update, see Blocker
Updated: 2026-09-29 19:46
Host: vmixlaptop2x6
Session: d638ec09-e9b7-497f-924c-510b4f28b214 on vmixlaptop2x6 (previous: eb0c0893-f368-4fe6-82a3-e3a2aefbac8b)
Model: Claude Opus 5 (claude-opus-5)
Owner: Claude Opus 5.5 subagent (session 3292415c), vmixlaptop2x6 - work done, owner may close
Remote Control: off (never enabled this session)
Quota: 100% session (resets 2026-09-27 03:00), 78% week
Ask: user attached ~/Downloads/quota-handoff-routine-update.md and said "resume". Spec = targeted modification of the EXISTING quota-handoff feature, not a parallel system.
Spec summary 1: remove automatic execution - 97%/threshold detection stays, but it must only mark "handoff available", never archive/relaunch on its own.
Spec summary 2: expose it as a manually callable Routine (Shared Brain > Routines > Quota Handoff).
Spec summary 3: order is ARCHIVE ALL -> VERIFY ARCHIVE -> read machine-origin data -> detect current machine -> build resume plan -> resume. No resume if verification fails.
Spec summary 4: per-session metadata to persist - session_id, agent_id, origin_machine, last_execution_machine, task/workflow_id, coordinated_group_id, archive_reference, resume_reference, timestamp.
Spec summary 5: default resume mode = LOCAL (this machine only). Modes LOCAL / COORDINATED / POOLED in the data model; POOLED representable (origin_machine != target_machine) but never silently active.
Spec summary 6: coordinated multi-machine tasks (VMIXER + NDI on one task) must not collapse onto one machine.
Spec tests: A single machine, B two coordinated machines, C routine called from one machine only resumes its own, D failed archive = no resume, E plan can represent cross-machine without defaulting to it.
Spec deliverable: report files changed, components reused vs new, archive/verify mechanics, machine-origin storage, current-machine detection, resume-plan selection, where the Routine is exposed, what automatic behavior was disabled, test results, what remains for POOLED.
Verified this session: host is vmixlaptop2x6; implementation file is ~/.claude/hooks/quota-handoff.mjs (375 lines) - NOT "quota-guard.mjs" as the 09-26 note calls it; wired in ~/.claude/settings.json at two hook entries (lines 43 and 54); state at ~/.claude/hooks/quota-handoff-state.json; archives at ~/.claude/shared-brain/quota-handoffs/<id>/ (3 present: H-20260926-vmixlaptop2x6-001, H-20260927-vmixer2o2-001, H-20260927-vmixlaptop2x6-001); resume procedure template at ~/.claude/hooks/resume-handoff.md, referenced from quota-handoff.mjs lines 271/287/295; hook cannot call spawn_task itself, it emits chip instructions for the session to post.
Verified this session 2: routine/slash-command surface already exists as ~/.claude/commands/*.md (only usage-panel.md today) - that is the natural home for a Quota Handoff Routine.
Partial: none. No file was created or edited this session other than these brain notes.
Uncommitted: none from this session (brain-sync auto-commits brain files).
Processes/ports: none started.
Related: handoff-2026-09-26-1213-automatic-quota-handoff.md (HO-2026-09-26-1213-aqh) built the AUTOMATIC v2 this spec now rolls back to manual. Its live two-account trial is still outstanding - do not delete its archive dirs or its tests; the spec says reuse, not replace.
Do not: build a second/parallel handoff system; push; auto-run the routine; migrate any session across machines by default; touch the ecomm DSH work owned live by vmixer2o2 (handoff-2026-09-27-0105-ecomm-dsh-run-vmixer.md).
Next: read ~/.claude/hooks/quota-handoff.mjs end to end plus the Downloads spec, then map which of its existing functions already do archive / verify / session detection / chip emission, and report that map to the user before writing any code.
Re-verified 2026-09-27 02:48 (session d638ec09): quota-handoff.mjs still 375 lines; settings.json still wires it at lines 43 and 54; 3 archive dirs unchanged; commands/ still only usage-panel.md; spec ~/Downloads/quota-handoff-routine-update.md present, 10266 bytes, mtime 02:25; state json mtime 02:42 (hook has run since the 02:27 note); host confirmed vmixlaptop2x6. Every claim in this note holds.
Verification for next agent: confirm quota-handoff.mjs is still 375 lines and settings.json still wires it at the two hook entries; re-read the Downloads spec (it is the source of truth, not this summary).
Built: ~/.claude/hooks/quota-handoff.mjs (699 lines; backup quota-handoff.mjs.bak-20260929) - detection only at threshold (exhausted.json handoff_available + one notice), no guard `check` spawn, no quota chips; Routine = `node quota-handoff.mjs routine` (archiveAll -> verifyArchive -> buildPlan -> resumeHere), reusing quota-guard buildHandoff/claim/LAUNCHERS/markRestored.
Built 2: ~/.claude/commands/quota-handoff.md (the /quota-handoff Routine); tests ~/.claude/hooks/quota-handoff.routine.test.mjs A-E + detection ALL PASS.
Blocker: brain-sync install overwrites ~/.claude/hooks/quota-handoff.mjs from .sync/claude-hook/quota-handoff.mjs at session start (it already reverted one edit 19:39). The .sync owner must copy the new hook there; not done here (.sync is off-limits to this task).
Signed: Claude Opus 5.5 (claude-opus-5-5), vmixlaptop2x6, 2026-09-29 19:46 (prior: Claude Opus 5, 2026-09-27 02:50)
