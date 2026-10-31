---
name: handoff-2026-10-31-0603-webchat-budget-deepseek-speed
description: Web-agents budget section + gatekeeper push landed; open user ask - DeepSeek DeepThink+Search slowness
metadata:
  type: project
---

Handoff id: handoff-2026-10-31-0603-webchat-budget-deepseek-speed
Time: 2026-10-31 06:03Z / 2026-10-30 23:03 PT
Host: vmixer2o2
Session: 8038f2ef-277a-4980-872d-9ab6f067bc20 (side session of local_ca209505, parent handoff handoff-2026-10-30-2000-webchat-file-protocol.md)
Model: Claude Opus 5.5 (claude-opus-5-5)
Reason: quota hook, 8.9-hour session, 88% week
Repo: ~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates
Owner: Claude Opus 5.5, session a2676c48 (side session of local_21895a13), claimed 2026-10-31 06:1xZ on vmixer2o2; state verified (branch, HEAD 7ef72bcac9, uncommitted set matches)
Remote Control: off
Exact ask (open): user "deepseek deep thinking + search is slow how can improve that" - model deepseek-web-think-search on UnlimitedChat (OpenClaw browser)
Verified done: 74b60818d3 council budget "Web unlimited agents" section (unlimitedChatModels/unlimitedChatAvailable host publish, webSeats toggles inert until pm T-7b0a88ba, user picked B)
Verified done: 7ef72bcac9 optimize.spec wording fix (chat page); vitest 1125/1125, pnpm typecheck 0
Verified done: gatekeeper PUSHED c585614786..7ef72bcac9 to origin/feat/heterogeneous-teammates (receipt 72ac7ca0..., 2026-10-31 01:02Z, ls-remote confirms)
Partial work: none
Uncommitted (not mine, leave alone): llm-claude-cli/*, tool-council/bin/dsh-run.mjs, quota-contract/
Leftover: clean worktree ../deepseek-harness-gk on branch gk/heterogeneous-teammates (pushed; safe to remove with git worktree remove after confirming)
Processes/ports: gatekeeper monitor pids 25924/26052/19436 running (not mine)
Speed leads (unverified, read first): packages/llm/llm-openclaw-chatgpt/src/transport.ts deepseekChoose/deepseekTurn + EXIT_REASON 26 (240s reply cap); adapter.ts DEEPSEEK_MODELS; ideas: skip re-selecting DeepThink/Search toggles when already set, poll completion faster, reuse the open tab instead of new chat, offer deepseek-web-think (no search) or -search alone, trim prompt (AGENTS.md 169 KB staged per call)
Next: measure one deepseek-web-think-search call end-to-end (phases: open, choose, insert, reply) and cut the slowest phase
Do not repeat: queue/push of 7ef72bcac9 (landed); do not read ~/.dsh/settings.yaml
Bridge: unacked seq 16220/16221 (chatgpt PM project P-b8dffb4d) + 23 older, not acted on

## Update 2026-10-31 06:25Z / 23:25 PT - Claude Opus 5.5 (session a2676c48 -> handed to 5301d830)
Done: de41fea150 (local, NOT pushed) perf(llm-openclaw): faster DeepSeek turns, pinned to their own tab. vitest 87/87, tsc 0, oxlint 0 for the package.
Measured live (tools/deepseek-phase-timing.ts, DeepThink+Search, phases open/stage/turn-start/choose/submit/answer/settle):
- warm small prompt 25.9s -> 20.7s (settle 3.0s -> 0.3s via DeepSeek send button `.ds-button--primary.ds-button--circle` returning to ds-button--disabled)
- 169 KB council prompt: FAILED 74.8s (code 22, turn ran on a concurrent chatgpt.com tab) -> 27.2s OK (staging 17.1s -> 6.2s: one stdin `batch` vs 3 argv evaluates; tabs pinned by `open --label "$TAB"` + `--target-id`)
- cold distro adds ~20-24s (open 23-24s vs 6.5s warm); untouched
Remaining levers (not done, need user OK - outside package/config): keep OpenClawGateway warm (WSL idles ~60s; ~20s/cold call); gateway loopback HTTP API (OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1 + gateway restart) would cut ~5s per CLI start x2-3/call; close turn tabs (accumulate; probe tabs probe-* also left open). Reply wait itself (5-10s) is DeepSeek's own think+search.
Facts: `openclaw browser batch` returns only {ok} per action (no evaluate value); stdin cap 1,000,000 bytes.
Next: user decides on keep-warm / HTTP API; queue de41fea150 via gatekeeper helper only when user asks.
