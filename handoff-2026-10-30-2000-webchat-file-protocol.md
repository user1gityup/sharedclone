---
name: handoff-2026-10-30-2000-webchat-file-protocol
description: OpenClaw web-chat (ChatGPT+DeepSeek) text tool protocol so free web models read/write repo files via DSH tool loop
metadata:
  type: project
---
Handoff id: handoff-2026-10-30-2000-webchat-file-protocol
Time: 2026-10-30 20:10Z (13:10 PT)
Host: vmixer2o2
Session: local_dee09601 side session (started by local_0a7c9635 "UnlimitedChat per-site model selector")
Model: Claude Opus 5.5
Repo: ~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates, no worktree
Owner: Claude Opus 5.5 (this session)
Ask: two-way code/files through free OpenClaw web chat (provider unlimitedchat, chatgpt-web*, deepseek-web*), proven by a live round trip writing a real file; commit local, no push
User answers: models = ChatGPT + DeepSeek (not claude.ai). Approach card unanswered -> chose text tool protocol (recommended)
Added asks (user, mid-task): (1) Q&A selection-style questions delivered to DSH properly; ChatGPT and DeepSeek both. Done as an ASK_RULE in the prompt: ask via DSH ask_user_question tool (selection card). (2) "web unlimited agents as their own section within the council budget" -> packages/client/ui-council-budget CouncilBudget.tsx (sections: mode, seats, capacity, cheaper). NOT STARTED. Seats only support cli/openrouter (pm T-7b0a88ba), so section is likely info + $0 listing unless user wants real seats.
Verified (final): vitest 77/77, hooks pass; tsc 0, oxlint 0, vitest package suite green, 100% coverage on protocol/prompt/adapter (index.ts/transport.ts gaps pre-existing, untouched lines)
Commit: a56e329018 (local, push request in push-requests.md); my files all committed
Do not touch: llm-claude-cli changes, dsh-run.mjs, quota-contract/ (others' uncommitted); never read ~/.dsh/settings.yaml
Live run: PASS 19:58Z - wrote src/math.ts (add+mul) via write call: chatgpt 43.3s, deepseek 18.1s (tools/files-live-check.ts)
Processes/ports: none of mine besides that run
Remote Control: off
Open questions: council budget section scope (info-only vs seat toggles)
Next: none here. 7 commits (incl a56e329018, 74b60818d3, 7ef72bcac9) queued from clean worktree branch gk/heterogeneous-teammates; gatekeeper Approve push dialog is the only step left (user click)
Do not repeat: python heredoc edits with \n escapes (mangled tests) - use Edit tool
