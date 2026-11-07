---
name: handoff-2026-10-31-0620-dsh-prose-question-card
description: DSH web agents' prose A-D questions now become the clickable ask_user_question card (committed); live check needs DSH restart, user approved
metadata:
  type: project
---

Handoff id: handoff-2026-10-31-0620-dsh-prose-question-card
Time: 2026-10-31T21:17Z (Pacific 2026-10-30 late evening)
Host: vmixer2o2
Session: a2676c48-ded1-48a2-8b72-f815e7bd8fe8 (side session of local_21895a13)
Model: Claude Opus 5.5 (claude-opus-5-5)
Reason: quota hook, 95% week, 15.2-hour session
Repo: ~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates (no worktree, shared folder)
Owner: unowned (next agent claims)
Remote Control: off
Exact ask: user "Current prompt in dsh should be a markup clickable menu like what is rendered via the app read observe and fix"
Observed: DSH session 14527322 ("Linking to shared brain file"), model chatgpt-web-gpt-6-high, asked Q1 of ~3 as bold A-D markdown; request DID offer ask_user_question and ASK_RULE (protocol.ts) - model ignored it
Verified done: 9ee3378baf feat(llm-openclaw) proseQuestion() in packages/llm/llm-openclaw-chatgpt/src/protocol.ts + offersAsk() wired in adapter.ts: reply with no call block ending in "question?" + options lettered from A (<=3 trailer lines) -> ask_user_question call, recommended first, rest stays prose. Parsed the real reply correctly. vitest 85/85 (package), tsc 0, oxlint 0, lefthook green. Local only, not queued, not pushed.
Not verified: live card in DSH UI. DSH web = pid 31564 "node --import tsx/esm apps/cli/src/bin.ts web" on 127.0.0.1:3080, started 2026-10-31T00:01Z, predates the commit.
User approval: user answered "Restart now" (Q&A card, ~06:20Z 10-31) for restarting DSH web to verify
Next: restart DSH web (pid 31564, same command line/cwd), re-open session 14527322 or ask the ChatGPT web agent an A-D question, confirm the native clickable card renders and a click returns the answer
Seen in passing (not fixed): DeepSeek replies leak "jsonCopyDownload" banner text into prose and some calls parse as arguments "{}" (session 14527322 seq 32-50)
Related, not mine: DeepSeek speed fix handed to local_5301d830 (note handoff-2026-10-31-0603-webchat-budget-deepseek-speed.md); it edits transport.ts, choose.spec.ts, tools/deepseek-phase-timing.ts in this same folder - leave those alone
Uncommitted (not mine): llm-claude-cli/*, tool-council/bin/dsh-run.mjs, quota-contract/, plus the speed session's files above
Do not repeat: diagnosis (done); never open the DSH home settings file
