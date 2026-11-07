---
name: handoff-2026-09-21-1715-cheaperinference-key-entry
description: User asked to wire a (presumably new/rescoped) CheaperInference key into the DSH budget tool so wallet/spend rows stop being empty.
metadata:
  type: project
---

# Handoff 2026-09-21 17:15: CheaperInference key entry for the DSH budget tool

- Stable id: handoff-2026-09-21-1715-cheaperinference-key-entry
- Updated: 2026-09-21 17:15
- Host: ndi2 (Windows 11 Home 10.0.26200)
- Session: this session (Claude Sonnet 5), cwd ~\Documents\claudecode
- Model: Claude Sonnet 5
- Project: `~/Documents/claudecode/deepseek-harness`, branch `feat/heterogeneous-teammates` (DSH host)

## The ask

User: "use the key to make the cheapinfernece budget tool work in dsh". No key value was
included in the message.

## Context found (via [[handoff-2026-09-21-0640-dsh-quota-work-account]])

- The CheaperInference budget tool in DSH (Council Budget panel, section "CHEAPERINFERENCE
  BUDGET") is already fully built and live per that handoff, part 2, session 3. It reads
  `CHEAPERINFERENCE_API_KEY` and shows "key lacks account:read" — the code works, the
  configured key just lacks the `account:read` (and probably `usage:read`) scope, so
  wallet/reserved/billed/request-count/top-model rows stay empty. **No code change needed** —
  a key with the right scope makes the rows populate as-is.
- There is already a purpose-built one-click tool for entering this key safely:
  `~\Desktop\CheaperInference Key Setup.cmd` -> runs
  `~/.dsh/cheaperinference-control.ps1`. It prompts with `Read-Host -AsSecureString` (never
  echoed), verifies the key live against `GET https://api.cheaperinference.com/v1/models`,
  and only then writes it into `~/.dsh/.credentials.yaml` under `refs:` (masked logging only,
  timestamped `.bak` backup made first). Comment in the script: "DSH picks this up on its next
  launch. Nothing else to do" (besides an explicit next-launch relaunch).
- Global CLAUDE.md safety rules (this session's system prompt) list "Entering ... API keys, or
  tokens into any field" as a **prohibited action for the agent** even with explicit user
  permission — direct the user to do it themselves. This matches the existing tool design
  (secure, no-echo prompt) — it was clearly built for exactly this reason.
- DSH host verified running: PID 21104 listening on 127.0.0.1:3080 (checked via `netstat`,
  17:xx). `~/.dsh/launch-dsh.cmd` exists for relaunch.

## Status: NOTHING BUILT/CHANGED THIS SESSION — investigation only

No files edited. No key entered or handled by the agent (by design/policy).

## Exact next action

1. Tell the user to double-click `CheaperInference Key Setup.cmd` on their Desktop and paste
   the new/rescoped key when prompted (masked entry, live-verified before it's stored).
2. Once they confirm it's stored and the live check passed, relaunch DSH
   (`~/.dsh/launch-dsh.cmd`) so the running host (currently PID 21104 on 3080) picks up the new
   credential — the script comment says a relaunch is required, "next launch" picks it up.
3. Verify live in browser at http://127.0.0.1:3080 — Council Budget panel, "CHEAPERINFERENCE
   BUDGET" section — that wallet/reserved/billed/request-count/top-models now populate instead
   of "key lacks account:read". Click Refresh to force a re-read if needed.

## Do-not-repeat

- Do not enter, type, or paste the API key value myself under any circumstance, even if the
  user pastes it directly into chat — direct them to the existing secure-entry script instead
  (global CLAUDE.md prohibited-action rule).
- Do not build a new key-entry path; `cheaperinference-control.ps1` already does exactly this
  correctly (secure prompt, live verify, masked logging, timestamped backup).
- Do not assume the panel needs code changes — per the 06:40 handoff this is scope-only; the
  tool already renders every field once the key can read them.
