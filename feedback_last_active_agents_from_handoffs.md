---
name: feedback_last_active_agents_from_handoffs
description: To find the last active agents, rank the brain's handoff notes by their Updated stamp and file time across every host, not by this machine's session list
metadata:
  type: feedback
---

When the user asks for the "last active agents", start from the handoff notes. List `~/.claude/shared-brain/handoff-*.md` by modification time and read each note's `Updated:`, `Host:`, `Session:`, model and status lines. Cross-check against the `## <date>` headers in `shared-agent-log.md`. That list covers every host, because brain-sync brings in vmixer2o2's notes too. It also covers agents on other Claude accounts, which this session's tools cannot see.

**Why:** on 2026-09-25 Claude Opus 5.5 built the list from this machine's desktop session store and CLI transcripts. It missed that vmixer2o2 agents had worked at 01:40 and 05:37 that morning (handoff-2026-09-24-0020, handoff-2026-09-23-1230). The user pointed out that the handoff docs already record how recently each agent worked.

**How to apply:** use the handoff ranking as the source of truth for recency and open state. Then use `list_sessions` and `ListAgents` only to find which of those agents this session can reach, for sending messages or turning Remote Control on. Treat a note updated in the last few minutes as having a live owner, and do not resume it in parallel. Related: [[feedback_shared_workdir_collisions]], [[quota-handoff-protocol]].
