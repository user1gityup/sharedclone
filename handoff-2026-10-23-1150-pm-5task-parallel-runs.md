---
name: handoff-2026-10-23-1150-pm-5task-parallel-runs
description: 5 ChatGPT PM tasks as 10 parallel DSH runs on vmixer2o2 - STOPPED, quota waste post-mortem
metadata:
  type: project
---
Updated: 2026-10-25 12:13Z (rerun by Opus 5.5 session bc69b6d7 for ndi2 dd96c4, user OK "All 8 now")
Rerun 09:52Z: Claude-only roster (claude+claude-work, maxConcurrent 1 each), 003-010 resumed --auto. 12:12Z: 001-009 FAILED (verdict repair/wait), 010 stopped. No new RESULT.md; reviews BLOCKED for missing artifacts; 006 swarm units collide on same files.
Council skip FAILED: patched run json stages/fields to swarm,review; resume re-starts council (likely dsh-run resume prompt omits stages). Fix needs dsh-run edit = user call.
Settings: restored from .bak-5task-20261023 12:12Z (end-state copy .bak-10run-end-20261025).
Host: vmixer2o2
Model: Claude Opus 5.5 (claude-opus-5-5), Claude Code desktop side session
Session: eb20162d-5cbb-43a9-b550-9562fe4f9296 (parent hub local_6dd9d5c6)
Owner: Claude Opus 5.5 (this session) until claimed
Ask: run PM tasks T-ac8f45fd T-a73df977 T-00d1d9a3 T-4dfa4288 T-0bf60afc as max-parallel DSH runs, Claude only, each <10 min
State: ALL 10 runs STOPPED/FAILED (RUN-20261023-001..010). Do NOT auto-resume: they burned quota in retry loops.
Produced: 4 RESULT.md in ~/.dsh/runs-5task/. Only T-4dfa4288-B is real work (RBAC spec/findings/tests, tests SIMULATED). T-ac8f45fd, T-00d1d9a3-C, T-4dfa4288-A = blocker reports. Nothing applied to repos.
Code changes (deepseek-harness, uncommitted, not pushed):
- packages/llm/llm-claude-cli: prompt via stdin, system via --system-prompt-file (fixes ENAMETOOLONG); DSH tool loop via --json-schema structured output (src/protocol.ts new, events.ts structured_output, adapter structured mode, onUnsupportedTools removed). tests 37/37; real opus tool round trip PASS; lib rebuilt.
- packages/council/tool-council/bin/dsh-run.mjs: resume clears fields.pipelineStoppedId (stop marker blocked resumed runs).
Open bug: events.ts result failure = subtype when is_error true, so real CLI error (likely usage limit) shows as "llm-claude-cli: success" and classifies TRANSPORT not RATE_LIMIT -> supervisor retries instead of quota-stop. Fix: failure = error ?? result text ?? subtype; then classifyFailure sees "limit".
Quota waste causes: (1) 10 codex orchestrators exhausted Codex in ~8 min; (2) claude-cli text-only orchestrator faked tool calls; (3) stop-marker bug discarded finished stages; (4) 10 runs x council+swarm (maxConcurrent 16) on Claude drained claude-work in 4 min and main to 100%; (5) supervisors retried at each reset (02:10Z, 07:10Z) and failed instantly.
Settings now: agent-default-model claude-cli opus; seats/roster claude on (maxConcurrent 16), claude-work OFF, claude-fable OFF. Backups: settings.yaml.bak-5task-20261023 (pre-run), .bak-claudework-20261024, .bak-claudework-on-20261024.
Bridge: seq 563/565 (ndi2 pm sync) + 578 (T-ac8f45fd acceptance probe) unacked; ChatGPT reply_to 917649ad-b88e-428e-8354-042d824e2688 NOT sent.
Remote Control: off
Next: fix the events.ts failure-text bug; get user approval for a smaller rerun (2-3 runs at a time, maxConcurrent 4) before resuming anything; then RESULT review, bridge reply, pm evidence, restore settings from .bak-5task-20261023.
Do not: resume all 10 at once; push; commit without approval; edit pm.db; use Fable.
