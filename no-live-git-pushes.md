---
name: no-live-git-pushes
description: User wants no git pushes during a session — only right before the session ends
metadata:
  type: feedback
---

Do not push to git during a working session. The user wants pushes held until right before the session ends, and will say when.

**Why:** Stated 2026-08-25 while mid-way through building out local changes. They want to review and batch what leaves the machine rather than have a stream of live commits land on their remote.

**How to apply:** Commit locally if useful, but never `git push` unprompted. Near the end of a session, offer to push and let them confirm. Applies to the deepseek-harness fork ([[deepseek-harness-fork]]) and their other repos.
