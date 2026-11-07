---
name: user-budget-parameters
description: The user's AI spend targets and measured usage baseline
metadata:
  type: project
---

Target: **$60/month total** — $20 OpenRouter (metered) plus $40 split across two subscription seats (Claude Code and Codex, ~$20 each).

**Measured baseline** from local Claude Code transcripts, 2026-08-15 to 2026-08-26 (11.1 days, 84 transcripts):
- output 18,906,335 tokens → **~51M/month run rate**
- input 562,412 · cache-read 10,264,826,355 · cache-write 143,821,207
- 32,246 assistant messages
- by model: claude-sonnet-5 16.65M out, claude-opus-5 2.20M out, haiku-4.5 59K out

**Why it matters:** a $20 Claude subscription at 51M output tokens/month works out around **$0.39 per 1M output tokens**, roughly 7x more token-efficient per dollar than metered OpenRouter (~$2.78/1M for deepseek-v4-pro assuming 3x prompt ratio). The workload is extremely cache-heavy, so uncached-token estimates read pessimistic.

**How to apply:** Do not claim Claude/Codex spend is unmeasurable — it is derivable from `~/.claude/projects/**/*.jsonl`, which carry per-message `usage` and ISO timestamps. Anthropic *account* billing is not reachable; only local transcripts are. Quota percentages must be stated against a user-set allowance, never presented as the provider's real ceiling.
