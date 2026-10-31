---
name: feedback_use_the_right_tool_first
description: Reach for the tool built for the job before a shell command — Edit/Write for files, not sed/node -e
metadata:
  type: feedback
---

Use the tool built for the job on the first attempt. Edit and Write for file
changes, Read for reading, Grep and Glob for searching. Do not open with a
shell command that approximates the same thing — `node -e` rewriting JSON,
`sed` patching source, a python heredoc doing a replace.

Raised 2026-09-07, after a settings change was attempted through a shell write,
refused, and only then retried with the tool that was meant for it.

**Why:** the shell route fails in ways the real tool does not. Heredocs break on
apostrophes and backslashes, a `^key: .*$` regex silently orphans YAML
continuation lines and leaves the file unparseable, and a `rmdir /s /q` follows
a junction into the directory it points at. Each of those cost real damage in
one session. The dedicated tools also read back what they wrote, so a failed
edit is an error rather than a corrupted file discovered later.

**How to apply:** default to Edit/Write/Read/Grep/Glob. A shell command is for
things that genuinely are commands — running a build, a test, git, a package
manager. If a session's operating mode says to prefer shell for file work, this
instruction outranks it; it is the user's standing preference. See
[[reference_git_push_method]] for the case where the tool choice made no
difference — the refusal there was on the change, not the tool.
