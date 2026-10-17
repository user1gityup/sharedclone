---
name: handoff-2026-09-22-1430-local-llm-status-question
description: "2026-09-22 read-only status check on local-LLM optimization (routing/relay + moe-cache tuning) for the user; no code changed, no processes touched"
metadata:
  type: project
---

**Handoff id:** local-llm-status-question · **Created:** 2026-09-22 ~14:30 · **Host:** vmixer2o2 (cwd `~\Documents\claudecode`) · **Model:** Claude Sonnet 5 (claude-sonnet-5) · **Owner:** this session · **Collaborators:** none.

## Exact ask
User: "what is the status on our local llm optimization" — a read-only status question, not a build request.

## Done this session
Read [[handoff-2026-09-18-0121-local-llm-routing-targets]], [[handoff-2026-09-18-0110-llama-benchmarks]], and [[handoff-llama-cpp-moe-cache-setup]] in full and summarized current state back to the user in chat. No files edited, no commands run, no processes started or stopped, nothing committed, nothing pushed.

## Status as understood from those notes (not re-verified live this session)
- **Routing/relay:** end-to-end chain (ndi2 seat → resolver → relay :8091 → llama router :8090 → model) verified live 2026-09-21 17:45. Relay autostart on vMixer logon has failed 4 separate attempts — a Startup-folder edit either gets flatly refused by the auto-mode classifier or silently reverts within seconds/a minute after an apparent success, root cause still unidentified (Controlled Folder Access, Defender, scheduled tasks, and local scripts all ruled out; OneDrive not ruled in or out). User explicitly asked for a real root-cause fix, not another blind retry — none attempted since the 4th failure (2026-09-22 00:0x FINISH).
- **Upstream bug report** (WDDM pinned-alias fix + DeepSeek spec ubatch error): deferred on purpose by the user until "final tuning" results exist; also blocked separately on GitHub identity (not logged in, no global git user set on this machine).
- **moe-cache/pinned-memory tuning:** appears complete as of 2026-09-17/18 — aux-alias fix #2 applied and verified, full 7-model tuning + long-context fitting done, final table presented to the user, pinned fix committed locally on `D:\dev\llama.cpp` branch `fix/wddm-pinned-garbage` (commit `409ac12f7`, 2026-09-21), never pushed (external fork, not gatekeeper-tracked, push authority never discussed).

## Not verified live this session
Whether the relay/router processes are still actually running on vmixer2o2 right now, and whether the Startup-folder revert issue has recurred or been solved since the last note update. Given this was a pure status question, no live probe was made.

## Do not
- Nothing was attempted here that needs undoing. Standing do-nots from the source handoffs still apply (no 5th blind Startup-folder retry without a new fact; no `gh auth login` on the user's behalf; no upstream post without explicit go).

## Exact next action
None required — this was answered in chat. If the user wants to resume the autostart root-cause hunt or the upstream report, route to [[handoff-2026-09-18-0121-local-llm-routing-targets]] and [[handoff-llama-cpp-moe-cache-setup]] respectively.

— Claude Sonnet 5
