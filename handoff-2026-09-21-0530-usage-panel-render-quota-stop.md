---
name: handoff-2026-09-21-0530-usage-panel-render-quota-stop
description: QUOTA STOP before rendering the Claude Code usage panel; nothing run yet, next session runs the script live
metadata:
  type: project
---

# Handoff 2026-09-21 05:30: usage panel render QUOTA STOP

- **Stable handoff id:** handoff-2026-09-21-0530-usage-panel-render-quota-stop
- **Updated:** 2026-09-21 05:30
- **Host:** ndi2
- **Session id:** 84aa49ca-f97e-4e78-b265-811a7c5bf361
- **Model:** Claude Sonnet 5 (claude-sonnet-5)
- **Project/repo/branch/worktree:** ~\Documents\claudecode (not a git repo)
- **Owner:** Claude Sonnet 5, ndi2. No collaborating agents on this task.

## User's exact ask

Render the Claude Code usage panel: run `node "~/.claude/statusline/usage-panel.mjs"`
(live, ~30s, one request against quota) or with `--from-cache` for free, call
`mcp__visualize__read_me` with modules `["data_viz"]`, then pass the script's stdout verbatim as
`widget_code` to `mcp__visualize__show_widget`, titled `claude_code_usage_panel`. Don't rewrite the
HTML. Panel has a refresh button that resends "refresh the usage panel" — rerun live and re-render
on that message. Add no text the panel already shows. Caveman-style replies; invoke
`anthropic-skills:caveman` before the first substantive reply.

This request arrived via the SessionStart hook's standing `spawn_task` chip
("Show Claude Code usage panel") plus the session's own opening instructions — same task, both
sources.

## What is done

Nothing. No tool call toward the actual task has been made. The turn's only actions were reading
the shared-brain MEMORY.md head and shared-agent-log.md tail to prepare this handoff.

## What is half-done

Nothing in progress — task had not started when the quota-stop hook fired.

## Why stopped

UserPromptSubmit hook fired this turn: "QUOTA HANDOFF - FINISH NOW. Trigger: 100% session quota
(resets Sep 21, 6:30am). Claude usage 100% session, 15% week." Per the standing rule in
`~/.claude/CLAUDE.md` and `quota-handoff-protocol.md`, start no new work and finish the handoff
note first.

## Permissions / open questions

None outstanding — the task itself needs no special permission beyond running the existing script
and calling the two already-available tools (`mcp__visualize__read_me`, `mcp__visualize__show_widget`).

## Exact next action

1. Run `node "~/.claude/statusline/usage-panel.mjs"` (live reading; costs one quota
   request) — wait for session quota to reset at 2026-09-21 06:30, or use `--from-cache` sooner if
   a free redraw is acceptable.
2. Call `mcp__visualize__read_me` with `modules: ["data_viz"]`.
3. Pass the script's stdout verbatim as `widget_code` to `mcp__visualize__show_widget`, title
   `claude_code_usage_panel`, no HTML edits.
4. Invoke `anthropic-skills:caveman` before the first substantive reply; keep replies terse; add no
   text the panel already shows.
5. Note the SessionStart hook already posted a `spawn_task` chip for this exact task ("Show Claude
   Code usage panel") — if the user clicks that chip in a separate spawned session, this session's
   own render becomes redundant; check for a completed spawned session before re-running.

## Verification

Not yet run — nothing to verify. This session did not read or write any file outside the
shared-brain handoff machinery.

## Do-not-repeat

- Do not re-render the panel from stale/remembered figures — the script's live stdout is the
  source of truth each time, per the task instructions ("Do not rewrite the HTML; the script owns
  the design").
- Do not spend a second live quota request on a redraw when `--from-cache` covers it (e.g. the
  refresh-button flow explicitly wants live, but an idle re-render does not).
