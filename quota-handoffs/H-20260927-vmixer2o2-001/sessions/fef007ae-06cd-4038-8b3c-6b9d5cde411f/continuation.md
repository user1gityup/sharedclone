# Continuation H-20260927-vmixer2o2-001 / fef007ae-06cd-4038-8b3c-6b9d5cde411f

Source: vMixer@vmixer2o2, account claude:.claude:a540ddf6@vmixer2o2, model claude-opus-5-5
Reason: Receiver vMixer@vmixer2o2 preserved its sessions before resuming H-20260927-vmixlaptop2x6-001
Repository: n/a  cwd: ~\Documents\claudecode
Branch: n/a  HEAD: n/a  uncommitted: 0
Session settings: title "Local LLM optimizations status", model claude-opus-5-5, effort xhigh, permission auto

## Objective
did we complete all local llm optimizations work?

## Last status
No, Claude Opus 5.5 finds it isn't finished. The core tuning is done, but the audit on 09-23 found problems in several presets that were never fixed. I checked this machine (vmixer2o2) live, not just the notes.
**Done and verified**
- The moe-cache build, tuning all 7 models, and long-context fitting.
- gpt-oss was slowed by memory spilling out of the GPU. That fix went from 9.95 to 20 t/s and is still in `models.ini` (`n-cpu-moe = 12`).
- Qwen3.6's context was raised to 65536. A 57.5k-token prompt returned 200. DSH was relaunched on 9/26 at 1:38 AM, after that change, so it's using the bigger window.
- The relay now starts on its own at logon. The bug was in `brain-sync.mjs`, which kept reverting the startup file. The relay has been running since 9/22.
**Still open**
1. **Nemotron and DeepSeek-Coder-V2-Lite spill the same way gpt-oss did.** Nemotron gets 15.9 of its tuned 24.4 t/s; DeepSeek-Lite gets 12–13.6 of 27.4. Neither was fixed: `n-cpu-moe` is still 39 and 11. The fix is the same one that worked for gpt-oss and needs your go.
2. **Ornith and Qwen3.6 run at 65% and 57% of their tuned speed, and the cause isn't known.** Measuring it needs `ctx-ab.ps1`, which the auto-mode saf ...[802 more chars in archive]

## Pending
- none recorded

## Next action
Verify the last status against the repository, then continue the objective.

## Decisions / notes
- See handoff note shared-brain/handoff-2026-09-22-1900-moe-cache-task2-verify.md
- See handoff note shared-brain/handoff-2026-09-24-0020-dsh-local-llm-context-overflow.md
- See handoff note shared-brain/handoff-2026-09-22-1430-local-llm-status-question.md

## Files
- ~/.claude/shared-brain/shared-agent-log.md

## Running when handed off
- none recorded

## Errors / blockers
- none recorded

Full archived transcript (redacted, gzip JSONL): quota-handoffs/H-20260927-vmixer2o2-001/archive/fef007ae-06cd-4038-8b3c-6b9d5cde411f.jsonl.gz. Do NOT load it by default; open it only when this package lacks something you need.
Before editing: verify these claims against the live filesystem, git state and processes. Work under your own account; no credentials were transferred.