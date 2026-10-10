---
name: feedback_weekly_98_stop
description: at 98% weekly Claude quota, stop all agents, write handoff with path; Claude via Antigravity or Claude Code via DSH continues
metadata:
  type: feedback
---
At 98% of the weekly Claude quota: stop every agent (subagents, background tasks, DSH runs this session started), write the handoff note, tell the user its full path; the work continues in Claude via Antigravity or Claude Code via DSH.

**Why:** user rule 2026-09-18 — the weekly window must not run dry mid-task; other routes pick the work up.
**How to apply:** `quota-handoff.mjs` (brain copy `.sync/claude-hook/`) emits "QUOTA STOP - WEEKLY" at level 3 when week >= 98%. Agents without the hook check their own telemetry. Related: [[quota-handoff-protocol]].
