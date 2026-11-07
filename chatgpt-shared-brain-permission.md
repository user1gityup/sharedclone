---
name: chatgpt-shared-brain-permission
description: User gives ChatGPT and Codex standing read/write authorization for the entire shared-brain folder; Git pushes remain separately gated.
metadata:
  type: user
---

ChatGPT and Codex have the user's standing permission to read, create, and update files anywhere under `~/.claude/shared-brain/` without requesting task-level authorization each time.

This authorization covers brain notes, handoffs, the memory index, the shared agent log, and brain-maintenance files when changes are needed for the user's task. It does not authorize unrelated filesystem access, automatic Git pushes, bypassing runtime permission controls, weakening the gatekeeper, or changing rules without a user request.

**Why:** The user explicitly granted shared-brain read/write permission on 2026-09-13 so ChatGPT/Codex can maintain the common memory across sessions and machines.

**How to apply:** Treat shared-brain reads and writes as pre-authorized. If the runtime sandbox still blocks access, request the exact folder permission and accurately report the grant's scope. Continue to follow the separate Git-push policy.
