---
name: claude-code-statusline
description: "A status line showing real Claude Code quota without opening the usage menu — where the numbers come from, and the session-length lesson behind it"
metadata: 
  node_type: memory
  type: project
  originSessionId: be428cdb-8d94-4adb-8bc9-22d446db25cf
  modified: 2026-09-02T08:57:28.910Z
---

Built 2026-09-02 at `~/.claude/statusline/`: `usage-cache.mjs` refreshes, `statusline.mjs` renders, wired via `statusLine` in `~/.claude/settings.json`.

```
Opus 5 · ████████ 97% session (2h 56m) · 17% week (5d 23h) · 99% >150k ctx · 229 req/24h
```

**The numbers are real, not estimated.** Nothing on disk carries quota state — `~/.claude` session logs record tokens spent but never the allowance they were spent against, and the only limit-ish field is `service_tier`. The source is `claude -p "/usage"`, which answers the slash command **locally, without an assistant turn**, and prints session %, week %, reset stamps, request counts, and usage characteristics.

**Gotcha:** in Git Bash, `/usage` is mangled into `C:/Program Files/Git/usage` by MSYS path conversion. Use `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`.

Rendering never blocks: it reads a cache and spawns a detached refresh when older than 5 minutes. A failed refresh leaves the last good figures rather than blanking them.

**The efficiency lesson this surfaced, which matters more than the widget:** the user's usage was *99% at >150k context* and *83% from sessions active 8+ hours*. Long sessions re-send the whole conversation every turn, so cost is driven by session length, not question difficulty. The advice that follows: start a fresh session when the topic changes, and let the memory files carry knowledge forward — a few KB re-read on demand instead of a 150k-token transcript dragged through every turn.

**How to apply:** when finishing a chunk of work, write anything durable to memory and suggest starting fresh. See [[user-budget-parameters]].
