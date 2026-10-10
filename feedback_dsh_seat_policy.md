---
name: feedback_dsh_seat_policy
description: DSH seat policy from 2026-09-29 - paid seats are DeepSeek and Codex (plus the main claude seat); free seats do the grunt work; kimi/cheaperinference off
metadata:
  type: feedback
---

Paid DSH seats going forward: **deepseek** and **openai (Codex)**. The `claude` seat (main ~/.claude account) replaces `claude-work` when the work account is out of weekly quota. Kimi and CheaperInference are off. Free seats (free-claude, openrouter-free, agy-*) do the dirty work: economy contests units with free seats, paid seats only escalate and review.

**Why:** user said so on 2026-09-29 after claude-work hit its weekly limit and sank the PM UI swarm.

**How to apply:** set seats with `~/Documents/claudecode/pm-ui-samples/set-seats.cjs seat=on|off` (waits on settings.yaml.lock, which the DSH web app also takes). Headless runs go through `queue-headless.cjs`, which rotates failing seats out until the run completes. See [[handoff-2026-09-29-1240-headless-dsh-gateless-runs]].
