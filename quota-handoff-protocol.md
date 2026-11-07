---
name: quota-handoff-protocol
description: "System-wide checkpoint and handoff protocol for expensive, long, compacted or quota-limited sessions, with ownership and recovery validation"
metadata:
  type: feedback
---

The user asked on 2026-09-12 for a system-wide rule: every agent, on every
machine, prepares its own handoff before a long or costly session degrades, so
the next session or another agent can continue without rediscovery. The rule is
in `~/.claude/CLAUDE.md`, the master set rendered for Codex and DSH too.

**Why:** an agent that hits its limit mid-task leaves nothing behind but a long
transcript, and the user pays twice — once for the lost work, again for the next
agent to rediscover it. See [[user-budget-parameters]].

**How to apply:**

- **Checkpoint trigger.** 100k context, four hours elapsed, 95% of any quota,
  a provider warning, compaction that loses operational detail, or clear context
  confusion. Finish the current atomic step, write the note, then continue only
  the already-active scope and keep the note current.
- **Handoff trigger.** 150k context, eight hours elapsed, 99% quota, imminent
  exhaustion, or repeated degraded reasoning. Start no new scope. Stabilize the
  work and finish the note. Thresholds are defaults to tune from observed data.
- **The note.** `~/.claude/shared-brain/handoff-YYYY-MM-DD-HHMM-<topic>.md`, named
  with the creation date and local 24h time first so the index and folder sort
  by when it was written (user rule
  2026-09-16); the name stays fixed on later updates. Index title
  `Handoff YYYY-MM-DD HH:MM: <topic>`. Frontmatter
  `name`, `description`, `type: project`. It holds a stable handoff id; update
  time; host; session id; exact model; project, repository, branch and worktree;
  current owner and collaborating agents; the exact ask; verified results and
  evidence; partial work, files and uncommitted changes; processes and ports;
  permissions and approvals; Remote Control on|off and, when it is on, the peer
  handle another agent needs to reach this one (host, session id, short ref, the
  name `ListAgents` prints); open questions; exact next action; verification;
  and do-not-repeat items. Update an existing note for the same work. Sign it.
- **Ownership.** A handoff is `active`, `ready`, `claimed`, `blocked`, or
  `complete`. The originating session owns `active`; a replacement changes it
  to `claimed` with its model/session/host before editing. A second agent does
  not continue a live owner's files without coordination. A newer checkpoint
  explicitly supersedes the older one; history is never silently deleted.
- **Recovery validation.** Before editing, the receiver compares the record to
  the filesystem, git status/HEAD, active processes and ports, and the newest
  shared-agent-log entries. Differences are recorded in the note. The handoff
  is evidence, not authority over newer state.
- **Remote Control carries over, and so does the conversation.** The note records
  whether Remote Control was on in the originating session
  (`Remote Control: on|off`) and, when it was on, the handle that reaches that
  agent: host, session id, short ref, and the name `ListAgents` prints for it.
  User rule 2026-09-18, extended 2026-09-27.
  - **Start with it on.** A handoff whose note says `on` resumes with Remote
    Control on. The receiving session turns it on as its first action, before it
    verifies anything else (Claude Code desktop: `set_remote_control` on its own
    session), confirms it is live, and keeps it live until the resumed work is
    done. It is never silently dropped between sessions; if it cannot be enabled,
    say so in one line and record it in the note.
  - **Then talk to the prior agent.** Remote Control is what makes the two
    sessions reachable, so the receiver opens the channel instead of working from
    the note alone: `ListAgents` to find the prior session by that handle, then
    `SendMessage` (or `mcp__ccd_session_mgmt__send_message` with its session id)
    to say the handoff is claimed, to ask for whatever the note does not cover,
    and to report back when the work lands. The channel stays open for the rest
    of the resumed work. Record the exchange under a `## Messages` heading in the
    note, which is also where a message waits when the peer is not reachable now.
  - **The prior agent answers and steps back.** A live originating session replies,
    hands over what it is holding, and stops working the handoff; ownership is the
    receiver's from the claim (`claimed`). Two agents never work one handoff in
    parallel.
  - **Unreachable is a recorded fact, not a blocker.** If the prior session is
    gone, on another account, or absent from `ListAgents`, write that in one line
    under `## Messages` and continue from the note and live state. Never ask the
    user to relay between agents ([[feedback_never_tell_user_to_run_it]]); see
    [[feedback_last_active_agents_from_handoffs]] for finding the peer.
- **Also:** a line under `## Shared operation` in `MEMORY.md`, titled `[Handoff YYYY-MM-DD HH:MM: <topic>]`, and a signed
  entry in [[shared-agent-log]].
- **Git.** Commit only work the user already authorised committing. Never push
  ([[no-live-git-pushes]]). Anything uncommitted stays as it is and is listed in
  the note.
- **Tell the user** in one line, with the model name, that the note is written
  and where.
- **Permission.** The rule itself authorises those brain writes; nothing else
  ([[nothing-without-permission]]).

**Claude Code is told automatically.** `~/.claude/hooks/quota-handoff.mjs` runs
on every `UserPromptSubmit` and `PostToolUse`. It reads
`~/.claude/statusline/usage-cache.json` (the `/usage` figures the status line
caches, see [[claude-code-statusline]]), and when session or weekly usage is at
95%+ it injects the instruction as `additionalContext`, with a one-line
`systemMessage` shown to the user the first time. Per session it fires once per
level and reset window, again after 30 minutes (so the instruction survives
compaction), and again on reaching 99%. Figures whose reset time has passed are
ignored. When the cache is older than 5 minutes it starts a detached refresh, at
most once per 5 minutes. Missing cache or any error: silent, exit 0. State:
`~/.claude/hooks/quota-handoff-state.json`.

It also reads only the first 64 KiB and last 512 KiB of the current transcript:
the first timestamp gives elapsed time, and the latest Claude usage record gives
context tokens. It checkpoints at four hours/100k and finishes at eight
hours/150k without loading a large transcript into memory.

The hook ships in the brain at `.sync/claude-hook/quota-handoff.mjs`; `install`
in `.sync/brain-sync.mjs` copies it to `~/.claude/hooks/` and adds the two hook
entries to `settings.json` where missing (backup `settings.json.pre-brain-sync-<stamp>`),
so each machine gets it at its first session start after the brain reaches it.
Self-test covers install, wiring once, and the thresholds.

**Codex and DSH** have no equivalent per-turn hook: they follow the rendered
master rule, use their own quota/rate-limit telemetry, elapsed time and context
signals, and treat compaction loss or context confusion as triggers. Claude's
cache measures only the Claude account and must not be used as their quota.

- Claude Opus 5 (vmixlaptop2x6), 2026-09-12
- Remote Control continuity + prior-agent channel: Claude Opus 5 (vMixer), 2026-09-27

## Automatic Quota Handoff (built 2026-09-26, Claude Opus 5.5)

`.sync/quota-guard.mjs` moves WORK between accounts when a Claude account hits
**97%** (default; `QUOTA_GUARD_THRESHOLD` or `~/.claude/quota-guard/config.json`)
of its session OR weekly window. Context size is not a trigger for it.

- **Quota:** the status-line cache only (fed free by `/api/oauth/usage`); a window
  past its reset reads null; no cache = UNKNOWN, never a guessed percent. Codex = UNKNOWN.
- **Trigger:** the quota hook records every session in `~/.claude/quota-guard/sessions/`
  and at >=97% spawns `quota-guard.mjs check`. One handoff per exhaustion event
  (the event closes only when a real reading drops below threshold).
- **Source:** writes `~/.claude/quota-guard/exhausted.json` (DSH swarm seat gate then
  sends no new work to the Claude subscription seat), snapshots every session active
  in the last 30 min into `quota-handoffs/<id>.partial/`, renames it to `<id>/` as
  READY only when all are written; failure = FAILED, retried under the same id.
- **Package:** `sessions/<sid>/continuation.md` (~2 KB resume layer, mechanical, no
  model tokens) + `archive/<sid>.jsonl.gz` (full redacted transcript, loaded lazily).
  Credential shapes redacted; `.env`/credential/cookie/key file contents omitted.
- **Receiver:** double-click `.sync/RESUME-HANDOFF.cmd` (brain pull, preserve own
  sessions, exclusive `claim.json`, one Claude Code window per source session,
  per-session `restore.json`; re-run continues). Admin: `release <id> --admin <name>`.
- **Simulation:** only with `QUOTA_GUARD_DEV=1`; ids start `SIM-`, hidden otherwise.
- Tests: `node --test .sync/quota-guard.test.mjs`.
- **Remote Control on this path.** The continuation package carries no Remote
  Control field - quota-guard copies title, model, effort and permission mode
  only - so a resumed quota handoff takes it from the topic note's
  `Remote Control:` line. The peer step applies only where the prior agent is on
  a live account: sessions on the exhausted account cannot be expected to answer.
- **Receiver in the Claude app (v2, 2026-09-26):** account = signed-in login
  (`oauthAccount.accountUuid`), so a desktop account switch on one `~/.claude` counts
  as a different account. The snapshot copies each session's title/model/effort/
  permission mode from the desktop record (`%APPDATA%/Claude/claude-code-sessions/
  <acct>/<org>/local_*.json`, transcript fallback). When an incoming handoff is READY
  the hook asks the session to post a "Resume handoff <id>" chip (at most every 30 min);
  that chip runs `.sync/resume-handoff.md`: `resume --launcher chips` (preserve,
  claim, chips = OFFERED), archive this account's other sessions, post one chip per
  source session. Each chip's first prompt carries `Resume quota handoff <id>, source
  session <sid>.`; the hook sees it and runs `markRestored` (RESTORED; all -> ACTIVE).
  The resumer then applies `settings <id>` rows (a session cannot set its own model/
  effort) and records `applied`.
