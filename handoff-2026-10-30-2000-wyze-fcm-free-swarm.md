---
name: handoff-2026-10-30-2000-wyze-fcm-free-swarm
description: Wyze FCM push ring (Path C) free/local swarm launch - run alive but seats held out
metadata:
  type: project
---
Handoff id: wyze-fcm-free-swarm
Time: 2026-10-31 02:30Z (19:30 PT)
Host: vmixer2o2
Model: Claude Sonnet 5.5
Session: local_d1130d4e-e995-4d93-a1c7-350cca032b31 (started by tv-security-2 local_44bd4289-07a0-4344-a98f-821f42222dea)
Repo: deepseek-harness (uncommitted), brief+output dir D:/nvr/scripts/doorbell/push
Ask: build Wyze FCM push ring receiver on FREE/local seats only (llama-local, free-claude, openrouter-free), no council, staged only
pm task: T-656db537 (P-f4c73ef7), pm start path FAILED (GUI session never fired pipeline)
Run: RUN-20261030-003 FAILED (3 attempts, ended 01:53Z, no seat could write decomposition); 001 stopped, 002 FAILED
Root causes found: 1 default orchestrator unlimitedchat/deepseek-web prints DSML text tool calls (never parsed); 2 FCC claude-cli orchestrator emitted non-JSON tool args; 3 swarm roster flags were off when bypassing pm
Fixes done: llm-claude-cli src/protocol.ts + lib/index.js tolerant parseArguments (backups *.bak-20261030*); roster flags set via driver applyRoster; orchestrator = claude-cli/sonnet via FCC 8082
Still failing: grep args still not JSON at attempt 1; all swarm seats held out (FCC timeout, OpenRouter rate limit, llama context overflow); no deliverables written yet
Settings: orchestrator, llm-claude-cli env and roster flags RESTORED 02:30Z (logged in changes.log)
Untouched: running poller, TVs, Frigate, git push
Remote Control: unknown
Open: user asked to fix tool-call parsing (done partially); decide next if seats stay held out
Next: user decision: fix seat holds (FCC timeout, OpenRouter rate limit, llama overflow) or build deliverables another way
Do not repeat: pm start via DSH GUI; DeepSeek WebChat orchestrator
