---
name: fix-dont-explain
description: User wants fixes applied silently — no explanations, diagnoses, or rationale unless explicitly requested
metadata:
  type: feedback
---

Just fix things. Do not explain what was wrong, why it broke, what the root cause was, or what the tradeoffs were. No diagnosis write-ups, no before/after tables, no "here's what happened" summaries.

**Why:** Stated 2026-08-25 as standing operating policy for all future work. The user considers explanatory prose a waste of tokens and does not want it.

**How to apply:** Report only the outcome in as few words as possible — "fixed", "done", or the one fact they need (a command, a URL, a status). Explain ONLY when explicitly asked. Applies to every task, not just code. See [[no-live-git-pushes]] for the related git preference.
