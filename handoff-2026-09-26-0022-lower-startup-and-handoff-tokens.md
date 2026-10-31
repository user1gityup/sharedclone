---
name: handoff-2026-09-26-0022-lower-startup-and-handoff-tokens
description: "Q&A on cutting handoff and session-start token cost; measured 77.5k startup breakdown; nothing changed"
metadata:
  type: project
---
Id: lower-startup-tokens-0022 | Status: active | Host: vmixlaptop2x6 | Session: 136258c0-fdfb-4844-b203-167dbd323729
Model: Claude Opus 5.5 | Dir: ~/Documents/claudecode (no repo) | Remote Control: off
Ask: lower tokens used by auto handoff, then lower the ~78k session start that makes PREPARE fire before work.
Done (read-only, measured): first turn of this session = 77,549 input tokens. Big parts: dsh-memory-index SessionStart hook
50.6 KB (brain index); auto MEMORY.md 25.4 KB = SAME brain index via memory junction (loaded twice); skill_listing 28 KB;
~/.claude/CLAUDE.md 13 KB; deferred-tool list 13 KB; agents 6.9 KB; MCP instructions 6.7 KB; project CLAUDE.md 4.8 KB.
MEMORY.md: 160 lines, 47 closed, 17 duplicate titles, ~11 KB mojibake. Handoff message itself only ~450-660 tokens.
LIVE 00:55: quota-handoff.mjs context trigger = growth above first reading (this session 146k abs, 69k growth, silent); message 1.8-2.7 KB to 0.9-1.5 KB, note cap 60 lines, log append unread. dsh-memory-index.mjs skips index lines auto memory loads, drops closed/duplicate, fixes mojibake: 50.6 KB to 18.5 KB. selftest 300/300. Backups: %TEMP%/*.pre-token-cut. Not done: skills trim, CLAUDE.md trim, MEMORY.md data cleanup.
skills/plugins/MCP servers, measure thresholds above startup baseline, cap note 60 lines, append log without reading.
Uncommitted: .sync/claude-hook/{quota-handoff,dsh-memory-index}.mjs, .sync/selftest.mjs (brain repo). Processes: none.
Next: user watches next session start + trigger; if good, user archives. Else restore backups.
Do not repeat: the measurements above.
- Claude Opus 5.5
