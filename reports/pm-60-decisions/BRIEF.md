# DSH PM 60-decision restructure — shared worker brief (user-approved 2026-10-13)

The user approved the change chart (Q60 final approval). You are one of 24 parallel swarm workers on vmixer2o2. NO council of any kind. Work only your assigned area; another worker owns every other area.

## Decisions (authoritative)
Read first: `~/.claude/shared-brain/dsh-pm-60-decisions.md` (Q1-Q60; later decisions override earlier).

## pm access (master pm on ndi2)
Run every pm command from Git Bash like this (loads URL + token, sets identity):
```
set -a; . ~/.claude/pm-remote.env; set +a; export PM_ACTOR="swarm-<WID>@vmixer2o2" PM_MODEL="<your model name>"
node ~/.claude/shared-brain/pm/cli.mjs <command> ... --json
```
Commands: `projects`, `tasks [--project X] [--q text]`, `show <id>`, `project-add <name>`, `add <project> <title> --body "..." --priority 1|2|3`, `set <id> --rev N --status ... --body ...` (rev = the rev you just read; on 409 re-read and retry once), `comment <id> "<body>"`, `artifact <id> <kind> <ref>`.

## Conventions (pm has no subtask field and no move)
- Sub-task = a task titled `<Parent> › <Sub>` in the same project; first line of body: `Parent: <parent task id>`.
- "Move" a task = create it in the target project with body `Moved from <old id> (<old project>)` + the old body summary, then `comment` on the old task `Superseded by <new id> in <project>`. Do NOT archive or change status of the old task.
- Every task you create: body ends with `Decision: Qnn[,Qnn]` and `Created by swarm-<WID> (<model>)`.
- Before creating, check the project/task does not already exist (`projects`, `tasks --q`). Never duplicate. Project names exactly as given in your assignment.
- FORBIDDEN: `archive`, `prepare`, `start`, `amend`, `stop`, `brain-write`, deleting anything, git push, editing pm.db, editing any file outside your scratch output. Merges (Q56) and archives (Q55) are recommendations only.
- Do not touch projects/tasks outside your assignment.

## Report (your final message, under 25 lines)
`WID | model | DONE/PARTIAL/FAILED`, then: projects created (id name), tasks created (id title), tasks updated/commented (id), errors verbatim, and anything you deliberately skipped with reason. Report only what pm returned; never claim a write you did not see succeed.
