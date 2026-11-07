---
name: handoff-2026-09-22-auto-handoff-window-question
description: Automating the CLAUDE.md handoff rule - resume pointer + one-click spawn_task chip built, installed, and walked end to end 2026-09-25 (CLOSED)
metadata:
  type: project
---

[Handoff 2026-09-22: automate handoff rule question]

- Updated: 2026-09-22, ~134k context
- Host: ndi2 (main desktop, Windows 11), Claude Code desktop app (Code tab)
- Session: this session (bcb29fca-2662-457f-9453-ba6b903ad3ed), model Claude Sonnet 5
- Project/repo: ~\Documents\claudecode (not a git repo — this is discussion, not the Google Maps app in that dir)
- Owner: ndi2. No collaborating agents.

**User's exact ask:** Is there a way to automate the `~/.claude/CLAUDE.md` handoff/checkpoint rule so that when context reaches the threshold it automatically opens a new window/session, instead of the user pasting the handoff `.md` into a fresh window manually — and specifically, can this be done *within the app* rather than by shelling out to the `claude` CLI in a terminal.

**Done / found (no code changed, read-only investigation):**
- Read `~/.claude/hooks/quota-handoff.mjs` — confirms the existing mechanism is a `UserPromptSubmit`/`PostToolUse` hook that only injects a text instruction into the *current* session telling the agent to write the handoff note. It does NOT open a new window/session, and never has — that part of the rule has always been manual.
- This hook just fired live in this session at 102k tokens (QUOTA HANDOFF - PREPARE), which is what triggered this handoff note being written.
- Checked which app-native session-management tools this session has: `mcp__ccd_session_mgmt__*` (list/get/send_message/set_remote_control/set_session_permission_mode/detach/etc.) and `mcp__ccd_window__open_session_in` (can put an *already-started* session into a split/pop-out window) are available.
- `start_session` / `hand_off_to_session` are referenced by other tools' descriptions (e.g. `move_to_cloud`, `open_session_in`) as the app's real "create a new session" primitives, but **`ToolSearch` found neither tool available in this session** — they are not currently invocable here.
- Conclusion reached but not yet delivered to user: hooks are plain scripts and cannot call app tools at all, so a hook can never invoke session-creation directly; and this session doesn't have a session-creation tool exposed to it either, so *I* can't script "auto-open a new window" from here right now. The in-app half of the rule (injecting the checkpoint instruction with no CLI/terminal involved) already works today, live proof being this very trigger. The missing half (auto-creating the destination window/session) has no exposed hook.

**Half-done:** Nothing half-done in the repo — this is a pure Q&A/investigation thread, no files edited, no commits, no processes started.

**Open questions:**
- Whether `start_session`/`hand_off_to_session` exist as app tools under some other permission mode/context (e.g. only available to a "top-level" session, or gated by a setting) — not confirmed either way.
- Whether the user wants a "one more click" compromise (hook produces a `systemMessage`/notification prompting the user to click "new session", since full auto-creation isn't currently scriptable) versus continuing to research whether the app exposes a session-creation hook elsewhere.

**Exact next action:** Reply to the user in-chat with these findings directly. Nothing left to build — the "auto-dump full handoff body into every SessionStart" idea is now rejected on two independent grounds (see below), not just deferred. Do not edit `~/.claude/settings.json` or `dsh-memory-index.mjs` — no implementation was ever authorized, and the design itself doesn't hold up.

**Further finding (134k checkpoint):** Live-demonstrated a "most recently modified" pick of a mock full-handoff-dump feature grabbing the WRONG file — a peer session's unrelated `handoff-2026-09-21-0218-dsh-run-failures-audit.md` (vmixlaptop2x6, DSH audit) got touched 3 min after this session's own handoff write, so mtime-based selection would have injected that unrelated ~140KB file instead. On top of that correctness problem, the user then asked the real cost question directly: file size does map ~linearly to token cost (roughly chars/4), and that cost is paid **per session, per agent** at SessionStart, not once — with this user's setup (multiple hosts, Codex, DSH council/swarm seats all sharing this brain), unconditionally injecting a full handoff body would multiply real cost by however many agents/sessions start next, not amortize it. This directly contradicts `dsh-memory-index.mjs`'s own stated design philosophy ("Only the index is injected, never the notes ... per-turn cost stays near zero"), and MEMORY.md is already over its own 24.4KB soft limit and getting truncated on load in this very session — evidence the budget is already tight before adding anything. Recommendation given to user: keep index-only injection as-is; if a pointer to "read this handoff" is wanted, make it a single line naming the exact path so the resuming agent can choose to Read it (cheap, on-demand) rather than force-loading full text into every session unconditionally.

**Reopened 2026-09-25 (new turn in same session, QUOTA HANDOFF FINISH-NOW fired immediately on a 73-hour-old session before any work this turn — nothing below was started):** User now wants this actually built, not just designed. Exact ask: wire the low-cost resume design already in this note (host-scoped `resume-<hostname>.md` pointer, read by `dsh-memory-index.mjs`'s SessionStart hook) to the SAME mechanism this session's own SessionStart hook already uses to pop the "Show Claude Code usage panel" chip — i.e. call `mcp__ccd_session__spawn_task` from the hook/session when a context/quota threshold trips, so the user gets a one-click chip suggesting a new worktree/session; clicking it starts a fresh session whose prompt tells it to read the resume pointer/handoff and continue the real work immediately, instead of the user pasting anything.

Open design question for the next agent: `spawn_task` in this transcript was called BY THE MODEL (me, told to via a SessionStart hook's injected instruction each session), not by a hook script directly — hooks are plain stdout/JSON, they cannot call MCP tools themselves. So the actual mechanism is: SessionStart hook injects "if X threshold, call spawn_task with these exact args" as additionalContext (same pattern as the usage-panel instruction block already wired into this project's SessionStart hook), and the model (whichever agent's session start reads it) makes the real spawn_task call. Needs: (1) confirm spawn_task is available/appropriate to call unconditionally from SessionStart context rather than only in response to a live quota-handoff trigger mid-session, (2) decide the exact threshold to check inside the hook script (context tokens aren't visible to a SessionStart hook the way quota-handoff.mjs's separate UserPromptSubmit/PostToolUse hook sees them — SessionStart fires once at the very beginning, so the resume-chip trigger more likely belongs in quota-handoff.mjs's existing PREPARE/FINISH logic, extended to also emit a spawn_task instruction, not in dsh-memory-index.mjs), (3) write resume-<hostname>.md read/write logic per the design above, (4) test end-to-end: trigger fires -> chip appears -> click -> new session reads resume file -> continues without the user pasting.

**Do-not-repeat:** (1) Don't re-propose the earlier "PreCompact hook shells out to open a new terminal window running `claude` CLI" design — user wants it in-app, not CLI. (2) Don't re-propose unconditionally dumping a full handoff body (or any large file) into SessionStart context for every agent — rejected on both correctness (wrong-file selection under concurrent writers) and cost (linear token cost × every agent × every session) grounds.

---

**Build leg 2026-09-25 (Claude Opus 5, ndi2, session 3d3e81ca-7071-4017-930d-84de0002695b) — BUILT, TESTED, INSTALLED, LIVE-PROVEN.**

Machinery confirmed read-only first:
- `~/.claude/settings.json` SessionStart runs `usage-panel-chip.mjs` then `dsh-memory-index.mjs`; UserPromptSubmit + PostToolUse both run `quota-handoff.mjs`.
- `usage-panel-chip.mjs` is the working precedent: a hook cannot call MCP tools, so it emits `hookSpecificOutput.additionalContext` telling the model to call `mcp__ccd_session__spawn_task` with literal args, guarded by a per-session-id seen-list at `~/.claude/hooks/chip-hook-seen.json`.
- Canonical sources live in the brain and are installed by `.sync/brain-sync.mjs`: `.sync/claude-hook/quota-handoff.mjs`, `.sync/claude-hook/dsh-memory-index.mjs`, `fleet/apps-files/claude/hooks/usage-panel-chip.mjs`. All three verified byte-identical to the installed `~/.claude/hooks/` copies right now (`diff -q`). EDIT THE BRAIN COPIES — brain-sync overwrites the installed ones (see the `.pre-brain-sync-*` backups).
- `.sync/selftest.mjs` already drives the quota hook end-to-end (section around line 250, helper `quotaRun`), so new behaviour gets tests there.

Design being built (decided, per this note's earlier cost/correctness findings):
1. `resume-<hostname>.md` in the brain — host-scoped pointer, a handful of lines (Handoff/Topic/Updated/Session/Next). Host-scoped because mtime-based "latest handoff" selection was already live-proven to grab a peer machine's unrelated file.
2. `quota-handoff.mjs` — the injected instruction gains a step to write/refresh that pointer at every level, and at level >= 2 (FINISH NOW / weekly STOP) a further step giving the model literal `mcp__ccd_session__spawn_task` args so the user gets a one-click resume chip. Same availability guard as the usage-panel chip.
3. `dsh-memory-index.mjs` — injects ONE line at SessionStart naming the resume pointer and the handoff it points at, only when the pointer is fresh and the handoff exists. Index-only philosophy preserved; no note body is force-loaded.
4. Tests in `.sync/selftest.mjs`.

**Shipped 2026-09-25 (all three brain files, installed and live):**

1. `.sync/claude-hook/quota-handoff.mjs` — imports `hostname`, adds `RESUME` (host-scoped `~/.claude/shared-brain/resume-<host>.md`, overridable with `QUOTA_HANDOFF_HOST` for tests), `pointerStep()`, `chipStep()`, `numbered()`, and `message()` rebuilt around them. PREPARE (level 1) gets the pointer step and NO chip — the session keeps working there and a second session would collide. FINISH NOW (level 2) and WEEKLY STOP (level 3) get both. The chip step carries the literal `mcp__ccd_session__spawn_task` arguments and the same availability guard the usage-panel chip uses.
2. `.sync/claude-hook/dsh-memory-index.mjs` — imports `hostname`, adds `RESUME_MAX_AGE_MS` (7 days) and `resumePointer()`, and injects 6-7 lines at SessionStart naming the topic, the handoff file, the pointer and the recorded next action. Silent when the pointer is absent, older than 7 days, or names a note no longer in the brain. No note body is ever force-loaded: the index-only philosophy is untouched.
3. `.sync/selftest.mjs` — six new checks; `QUOTA_HANDOFF_HOST: 'testhost'` pinned in `quotaRun` so the expected file name is machine-independent; the index-hook run refactored into `indexHook()` / `contextOf()` so it can be run three times.

**Verification (all run, all quoted):**
- `node .sync/selftest.mjs` → **296/296 passed**, zero FAIL. The six new checks by name: `quota hook: preparing writes the pointer and offers no chip`, `quota hook: finishing offers the one-click resume chip`, `quota hook: the weekly stop offers the chip too`, `hook: names the resume pointer left on this machine`, `hook: a stale pointer says nothing`, `hook: a pointer to a missing note says nothing`.
- Quota hook driven directly at 95 / 99 / weekly-98 with a fake cache: PREPARE shows 5 steps with the pointer and no `spawn_task`; FINISH NOW shows 6 with both; WEEKLY STOP shows 6 with both.
- Index hook run in an isolated `USERPROFILE`: fresh pointer → the block appears with topic, note name and next action; stale (`Updated: 2026-09-01`) → nothing; dangling (`Handoff: handoff-gone.md`) → nothing; absent → nothing.
- `node .sync/brain-sync.mjs install` → `already-installed`; `diff -q` confirms `~/.claude/hooks/quota-handoff.mjs` and `~/.claude/hooks/dsh-memory-index.mjs` are byte-identical to the brain copies.
- **Live proof, not a fixture:** this session's own installed PostToolUse hook then fired `QUOTA HANDOFF - FINISH NOW` at 151k context and emitted the new step 2 (`resume-vmixlaptop2x6.md`) and step 5 (the `spawn_task` chip) into the running session. The feature triggered itself in production on the first firing after install.

**Note on this host:** `hostname()` here is `vmixlaptop2x6`, not `ndi2` (that is the user directory). The pointer file for this machine is therefore `resume-vmixlaptop2x6.md`.

**Not done / next:** the loop has not yet been walked end-to-end by a human — chip clicked, fresh session started, pointer read, work resumed. That is the one remaining verification and it needs the user's click. Nothing is committed; the brain's own listener commits the brain on its own cycle, but no `git push` was run and none was queued.

**Do-not-repeat (added):** the brain's `SharedBrainListener` commits brain files while you work, so `git checkout -- <file>` there restores the listener's latest commit, not your session's starting state — check what you are restoring before assuming a clean revert.

---

**Walkthrough leg 2026-09-25 07:07-07:15 PDT — CLOSED. Owner: Claude Opus 5.5, host vmixlaptop2x6, desktop session local_eba30b0b-0dea-4c5d-a09c-dee163deabb8 = CLI cefc354b-3fd0-4298-9434-6be654080d14, peer [5bf91f], title "Continue auto-handoff resume chip", Remote Control ON (set_remote_control self -> "on", first try).** Ownership claimed from 3d3e81ca (its account a540ddf6 is at weekly limit, session not running; ListAgents shows only [17aa45] canna, [ef3996] resume-agents, [adc02f] CI gates - none owns this note).

Result of the one open item - the loop walked end to end:
- Chip -> session: this session was started by one click on chip task_f6612f34, posted by Claude Opus 5.5 session 6cdb30d9 [ef3996]. Its prompt's core paragraph is byte-for-byte the `chipStep()` prompt (quota-handoff.mjs:136 with RESUME = `~/.claude/shared-brain/resume-vmixlaptop2x6.md`), plus a walkthrough paragraph. Caveat: that chip was posted by a model reusing the hook's text, not emitted by the hook at a real FINISH NOW; the hook-emits-chip half was live-proven separately by 3d3e81ca at 151k. The two halves together cover the whole loop.
- SessionStart pointer block: SHOWN. The injected context (persisted hook output, lines 192-195) read "Unfinished work on this machine: auto-handoff resume chip ... Its handoff note is handoff-2026-09-22-auto-handoff-window-question.md, updated 2026-09-25 07:20, named by the pointer resume-vmixlaptop2x6.md. Recorded next action: walk the loop end to end once ...".
- Pointer collision: NONE. resume-vmixlaptop2x6.md named this note at read time (Updated 07:20, Session 3d3e81ca).
- Continued without anything pasted: yes - the chip prompt alone led to pointer -> note -> verification -> this entry.

Re-verified live before editing: hostname `vmixlaptop2x6`; `diff -q` brain vs installed for quota-handoff.mjs, dsh-memory-index.mjs, usage-panel-chip.mjs -> all identical; settings.json SessionStart = usage-panel-chip.mjs + dsh-memory-index.mjs, UserPromptSubmit + PostToolUse = quota-handoff.mjs; brain tree clean, 0 ahead of upstream, tip 765b857; `node .sync/selftest.mjs` -> `=== 296/296 passed ===`, EXIT=0.

Findings (not fixed - no build authorised this leg):
1. **Fresh sessions open near the PREPARE line.** This session's first turn measured 77,665 context tokens (transcript usage); the quota hook fired `QUOTA HANDOFF - PREPARE` at 101k after ~7 tool calls of verification. CHECKPOINT_CONTEXT is 100_000 (quota-handoff.mjs:50). The brain MEMORY.md is 55,206 bytes (limit 24.4KB) and is injected whole at SessionStart - the largest controllable share of that opening cost. Every resumed session will hit PREPARE almost at once, and PREPARE's pointer step then rewrites the host pointer - so a resumed session can overwrite the pointer another parallel session relies on. Fix candidates for the user: prune MEMORY.md to one line per note under ~200 chars (anthropic-skills:consolidate-memory), and/or make pointerStep skip when the pointer already names the same note.
2. **Future-dated pointer stamp.** Wall clock was 07:07 PDT (`date`) while the pointer said `Updated: 2026-09-25 07:20` and its file mtime was 07:05:44; session 6cdb30d9's log entries are stamped 07:15/07:20 ahead of real time. resumePointer() (dsh-memory-index.mjs:215) rejects only age > 7 days, so a future stamp always passes - harmless today, but a pointer stamped far ahead would never go stale.

Pointer: deleted after this entry, per pointerStep ("Delete it once the work it points at is finished"). Nothing committed by me (brain listener commits on its own cycle), nothing pushed, nothing queued.
