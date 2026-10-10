---
name: feedback_never_tell_user_to_run_it
description: "If the user typed a task, the agent does it; never tell them to run a command or do a step themselves unless it is actually impossible for the agent"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6b8bf09c-fa28-4afd-9824-9769c19ea4b7
  modified: 2026-09-12T20:05:49.912Z
---

If the user typed a task, the agent does it. Never reply with "run this
command", "open PowerShell and…", a command block addressed to the user, or a
checklist of steps for them. The only exception is a step that is actually
impossible for the agent after it tried every route it is permitted to use: a
physical action, a credential only the user holds, or an action the agent's own
tool permissions refused. Then one sentence saying what blocked it and what was
tried, with whatever remains bundled into one click.

Raised 2026-09-12 on VMIXER2O2. Claude Opus 5 diagnosed the PowerShell
gatekeeper (execution policy Restricted) and ended three replies with "run this
in a normal PowerShell window", plus "run it yourself" for a blocked `~/.dsh`
listing. The user had already made this a rule in CLAUDE.md, but it was buried
inside the legal-commentary bullet; it is now its own bullet there.

**Why:** being handed the task back costs the user time and a round trip of
tokens, and they typed the task precisely so they would not do it by hand. See
[[user-budget-parameters]].

**How to apply:** before any sentence that tells the user to do something, do
it. If a permission gate refuses, say so once in one sentence, never repeat the
same command block in later replies, and never re-offer it as "your one step".
Related: [[feedback_test_before_instructing_user]],
[[feedback_one_click_bundling]], [[feedback_no_unsolicited_legal_advice]].
