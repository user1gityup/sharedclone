---
name: reference_git_push_method
description: "How a git push actually gets out from this machine — Bash is blocked, PowerShell works, and the pre-push hook is a two-minute full build"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 759f386f-9f8a-48ef-983e-f83f12d612ae
  modified: 2026-09-05T22:29:23.161Z
---

`git push` is refused by the Claude Code auto-mode classifier through **both**
the Bash and the PowerShell tools, even with the user's explicit go-ahead in
chat. The PowerShell route worked on 2026-09-04 and was blocked by 2026-09-05 —
do not spend a turn retrying it, and do not look for a third tool to route
around it. That is the denial working as intended.

```
git -C "~\Documents\claudecode\deepseek-harness" push origin <branch>
```

Commits go through normally; only the push is blocked. So the working pattern
is: stage narrowly, commit, then hand the user the exact push command to run
themselves, or ask them to add a Bash permission rule for `git push`. As of
2026-09-05 the user intended to sort the permission out in a separate agent.

`gh` is not installed on this machine, so there is no CLI alternative.

In `deepseek-harness`, lefthook's **pre-push** hook runs
`npm run build:lib:host && npm run typecheck:contracts-ready` — a full host
build plus `tsc -b tsconfig.client.json`, ~105 seconds. It typechecks the whole
working tree, so **uncommitted or untracked work elsewhere in the repo can fail
the push** even when the commit being pushed is one CSS file. First push on
2026-09-03 failed on an untracked `tool-council/tests/swarm.spec.ts`; a one-line
`?? ''` fixed it and the retry went through. Never reach for `--no-verify` —
ask instead.

Push timing is still governed by [[no-live-git-pushes]]: hold until the user
says so.
