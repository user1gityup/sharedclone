---
name: handoff-2026-09-21-0300-second-claude-account-plan
description: Rewrite of ~/Downloads/plan.md for adding a second Claude Code account on ndi2 and for DSH-spawned sessions; plan only, nothing executed.
metadata:
  type: project
---

# Handoff 2026-09-21 03:00: second Claude Code account plan

- Stable id: handoff-2026-09-21-0300-second-claude-account-plan
- Updated: 2026-09-21 03:00
- Host: ndi2 (Windows 11)
- Session: 0c0fb7fe-4de0-4ab6-b5b2-08b2c9545c9e
- Model: Claude Opus 5
- Project: no repo (working dir `~\Documents\claudecode`)
- Owner: Claude Opus 5. No collaborating agents.

## The ask

User: "make a plan for this ~\Downloads\plan.md", then "please rewrite this plan removing
all the info about what is dsh we already know what it is".

## Done, with evidence

- Read the original `~\Downloads\plan.md` (macOS/Linux plan assuming `dsh` is an SSH host).
- Verified on ndi2:
  - `(Get-Command claude).Source` = `~\AppData\Roaming\npm\claude.ps1`
  - only `.claude` exists under the profile; no `.claude-*` sibling
  - `sshconfig: False`, `bashrc: False`, `psprofile51: False`, `psprofile7: False`, `dshAgents: True`
- Backed up original to `~\Downloads\plan.md.bak`.
- Rewrote `~\Downloads\plan.md`: Windows paths, `.cmd` launcher + Desktop shortcut
  instead of shell rc edits, Keychain/SSH content removed, all "what is dsh" discussion removed,
  Phase 5 now = inject `CLAUDE_CONFIG_DIR` into the child process DSH spawns, plus vMixer mirror and
  optional `setup-token` route.

## Not done

Nothing executed from the plan. No `.claude-work` directory, no launcher, no DSH change, no login.

## Blockers seen

Auto-mode classifier denies credential-adjacent probes as *Credential Exploration*: blocked
`env | grep ANTHROPIC`, `Get-ChildItem Env:` filtered on `ANTHROPIC_|CLAUDE_`, `claude --version`
combined with dir listing, and `Get-ChildItem ~/.dsh`. Narrow `Test-Path` / `Get-Command` checks pass.
Phase 0 of the plan needs either a permission rule or those narrow checks.

## Uncommitted / processes

None. No repo touched, no ports, no background runs.

## Next action

Wait for the user. If they say go, start at plan Phase 0 survey; Phase 3 login stays operator-only.

## Do not repeat

- Do not re-run the blocked env-var probes as written; they are denied.
- `dsh` here is the DeepSeek Harness launcher at `~/.dsh`, not an SSH host — settled, do not re-ask.
