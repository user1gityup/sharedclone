---
name: dsh-memory
description: Facts DSH agents remembered on any machine - the shared copy of every machine's memory digest
metadata:
  type: reference
---

# DSH remembered facts

What DSH agents wrote with `memory_write`, from every machine that shares this
brain. Each line names the machine it was remembered on and carries the id DSH
derives from the text, so the same fact remembered twice appears once.

Appended, never edited: the file merges by union. A fact that is wrong is
corrected by remembering the correction, not by rewriting history here.

<!-- ENTRIES BELOW THIS LINE -->
- [fact] Measured baseline from local Claude Code transcripts over 11.1 days: 18.9M output tokens, 10.3B cache-read tokens, 32,246 assistant messages — about 51M output tokens per month. _(budget, usage)_ - remembered on vmixlaptop2x6 <!-- dsh-fact id=m9jvvu6 machine=vmixlaptop2x6 -->
- [fact] A $20 Claude subscription at that throughput costs roughly $0.39 per 1M output tokens, around 7x cheaper per token than metered OpenRouter. Subscription seats carry most of the throughput in this configuration. _(budget, pricing)_ - remembered on vmixlaptop2x6 <!-- dsh-fact id=m1glx47y machine=vmixlaptop2x6 -->
- [preference] The monthly AI budget is $60: $20 of metered OpenRouter credit plus roughly $20 each for the Claude Code and Codex subscriptions. _(budget)_ - remembered on vmixlaptop2x6 <!-- dsh-fact id=mtaxzrs machine=vmixlaptop2x6 -->
- [preference] The user wants fixes applied directly rather than explained, and no git pushes until the very end of a session. _(workflow)_ - remembered on vmixlaptop2x6 <!-- dsh-fact id=mdo2cwa machine=vmixlaptop2x6 -->
- [decision] The council always runs a cheap planning round first and stops for approval before the expensive draft and review rounds. One planning call costs far less than eight seat calls aimed in the wrong direction. _(council, cost)_ - remembered on vmixlaptop2x6 <!-- dsh-fact id=m1y33btb machine=vmixlaptop2x6 -->
- [decision] Shared memory reaches every seat from one store: CLI seats receive the digest file path via --append-system-prompt-file, and hosted OpenRouter seats receive its text inline, because they have no filesystem. _(memory)_ - remembered on vmixlaptop2x6 <!-- dsh-fact id=m8yaox5 machine=vmixlaptop2x6 -->
- [reference] Published coding-agent figures (Artificial Analysis Index v1.4): Claude Code Opus 5 index 68 at 23.7m/task, Codex GPT-5.6 Sol index 65 at 10.2m, Kimi K3 index 63 at 24.1m, Codex DeepSeek V4 Flash index 50 at 14.5m. A council does not exceed its best seat; it improves the odds of reaching that seat. _(benchmarks)_ - remembered on vmixlaptop2x6 <!-- dsh-fact id=m15xaeab machine=vmixlaptop2x6 -->
- [fact] We are building a multi-agent council plugin inside a fork of DeepSeek Harness at ~\Documents\claudecode\deepseek-harness. Four seats — Claude and OpenAI/Codex over local CLIs, Kimi and DeepSeek v4 over OpenRouter — draft an answer, review each other, and vote. _(council, dsh)_ - remembered on vmixlaptop2x6 <!-- dsh-fact id=m1i5jocm machine=vmixlaptop2x6 -->
- [fact] Archive all DSH ungrouped sessions — DONE (2026-10-06, Qwen3.6-35B-A3B-UD-Q4_K_M).
Method: RPC via POST /api/workspace.archiveSession.
Results: 48 total sessions, 21 workspace-accounted, 18 previously archived. Found 11 ungrouped, skipped 1 blank (session-f69111aa), archived 10 (8 session- prefixed + 2 bare UUIDs). New total archived: 28. _(dsh, archive, ungrouped-sessions, completed)_ - remembered on vmixer2o2 <!-- dsh-fact id=mahwy6x machine=vmixer2o2 -->
- [fact] Archive all DSH ungrouped sessions — DONE (2026-10-06, Qwen3.6-35B-A3B-UD-Q4_K_M). - remembered on vmixer2o2 <!-- dsh-fact id=m5xcyou machine=vmixer2o2 -->
- [remembered] [fact] Archive all DSH ungrouped sessions — DONE (2026-10-06, Qwen3.6-35B-A3B-UD-Q4_K_M). - vmixer2o2 - remembered on vmixer2o2 <!-- dsh-fact id=mws6af machine=vmixer2o2 -->
