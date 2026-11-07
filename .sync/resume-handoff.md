# Resume a quota handoff in the Claude app

Run by the session a "Resume handoff <id>" chip opened, under the newly
signed-in account. It replaces this account's open desktop sessions with the
ones the exhausted account was running, with the same title, model, effort,
permission mode and working directory. `G` below is
`node "C:/Users/ndi2/.claude/shared-brain/.sync/quota-guard.mjs"`
(on another machine, the same file under that user's `~/.claude/shared-brain`).

The quota hook has already recorded this session as the resumer, so steps 1 and 2
leave it alone. The user asked for this whole routine by starting the chip:
it authorises the archive calls in step 2 and the settings calls in step 5 for
the sessions listed there, nothing else.

1. `G resume <id> --launcher chips`. It snapshots this account's open sessions
   into a `preserve` handoff first, claims `<id>`, and prints JSON. Stop and
   report its `code` in one line if `ok` is false (`CLAIMED_BY_OTHER`,
   `SAME_ACCOUNT`, `NOT_READY`, ...). Keep the `chips` array.
2. `mcp__ccd_session_mgmt__list_sessions` (not archived). Archive each row with
   `mcp__ccd_session_mgmt__archive_session`, reason "quota handoff <id>". The
   list already leaves out this session. Skip, and name in the final line, any
   row the app refuses (still working, pinned, open on screen).
3. For every `chips` entry call `mcp__ccd_session__spawn_task` with its `title`,
   `tldr`, `prompt` and `cwd` (drop `cwd` when it is this session's own
   directory). One chip per entry, no others.
4. One line to the user, with the model name: N chips posted, click each; K
   sessions archived; the preserve handoff id if one was made.
5. Settings. Each started chip session confirms itself through the hook
   (`G restored`). Wait for that with `Monitor` on `G settings <id>` until
   every row's `state` is `RESTORED` (give up after 30 minutes and apply what
   is there; the rest are applied on the user's next message here). For each
   row with a `desktop_session_id` and `applied: false`, apply its `change`:
   `title` -> `set_session_title`, `model` -> `set_session_model`,
   `effort` -> `set_session_effort`, `permission_mode` ->
   `set_session_permission_mode`, each with `session_id` = `desktop_session_id`.
   A refused or unknown model id: leave it, note it. Then `G applied <id> <source_session_id>`.
6. `G status`, then one line: handoff state (ACTIVE once all confirmed), sessions
   restored and set, anything skipped.

Never push, never copy credentials, never archive this session ("self").
