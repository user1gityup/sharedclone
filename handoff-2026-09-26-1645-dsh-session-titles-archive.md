---
name: handoff-2026-09-26-1645-dsh-session-titles-archive
description: "DSH test-run archive done + pipeline session-title fix live, uncommitted"
metadata:
  type: project
---
Status: active (checkpoint, PREPARE at 179k)
Updated: 2026-09-26 16:55
Host: vmixlaptop2x6 (user dir ndi2; my earlier log entries said "ndi2" meaning this host)
Session: 346b6f6e-b218-4f2f-84b2-7ed79dfffb31
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5 session 346b6f6e
Collaborating: Claude Opus 5.5 session d3c5c6dc / local_9b8b9fd5 "DSH runs management" (runs tool, PipelineControl.tsx, rpc-map.ts, tool-council presets/runs/index.ts)
Repo: ~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates, HEAD 812ae0a35e
Remote Control: off
Ask 1: archive DSH test runs made by Claude - DONE
Verified 1: 11 sessions archived via /api/workspace.archiveSession (b5c139e7 8d160f15 48912397 491b3e40 fb68cb66 d62ee7a4 f34b1761 c3c37001 034fc1b2 a54f7e12 f4b34e37); workspace.json archive set 29
Ask 2: pipeline runs get unique query-based session titles instead of "Run the pipeline tool on" - DONE, live
Cause: pipeline start prompt > session-title-llm maxInputBytes 4096, so the LLM titler threw and the 5-word fallback stuck
Fix: session-title-llm/src/index.ts frameWithinBudget clips text to the budget; session-title/src/normalize.ts fallback uses text after "Request:" for pipeline prompts
Verified 2: vitest 58/58, coverage 100% both files, pnpm typecheck 0, pnpm run build 0, DSH host restarted (3080 200, PID 27144); built-lib fallback on real 2240-byte request -> request words
Not verified: a live pipeline run showing the new title (not run, to avoid seat spend)
Uncommitted mine: packages/session/session-title/src/normalize.ts, session-title/tests/session-title.spec.ts, session-title-llm/src/index.ts, session-title-llm/tests/llm.spec.ts
Uncommitted NOT mine: tool-council src/index.ts, src/route-swarm.ts, tests/route-swarm.spec.ts (quota-guard, handoff-2026-09-26-1213 owner)
Processes: DSH host via launch-dsh.cmd -> fcc-session.cjs -> bin.ts web, port 3080
Open: user go to commit my 4 files, then queue-build.mjs; peer d3c5c6dc cleared by me to do the combined rebuild+restart now (its runs tool in same tree)
Next: ask user for commit go; on yes commit the 4 files by explicit path and queue
Do not repeat: decoding session.jsonl.zstd with node zlib (multi-frame, gives 1 line); UI clicking to archive (use RPC)
