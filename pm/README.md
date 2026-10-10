# pm - Agent Project Manager

Shared source of truth for work by humans, CLI agents, DSH councils and swarms,
across sessions and machines. Zero dependencies: Node 22.5+ built-in `node:sqlite`.

- **Start:** double-click `START-PM.cmd` -> http://127.0.0.1:4480
- **Data:** `~/.claude/pm-data/pm.db` (outside git; override with `PM_DB`)
- **CLI:** `node cli.mjs help` (`PM_URL`, `PM_ACTOR`, `PM_MODEL`, `PM_TOKEN`)
- **MCP:** `node cli.mjs mcp` (stdio; same tools as the CLI)
- **Tests:** `node --test test.mjs`
- **Other machines:** run the server with `PM_HOST=0.0.0.0 PM_TOKEN=<secret>`
  (e.g. over Tailscale); clients set `PM_URL` + `PM_TOKEN`. Remote calls without
  the token get 401; the server refuses a non-loopback bind without one.

Rules the service enforces: every change names its actor (agents: model name);
edits carry the revision they read, and a stale one gets 409 with the rejected
edit returned; claims are leases, atomic, heartbeat to keep; an expired lease
turns the task `uncertain`, never `failed`; comments and instructions are
distinct, instructions are acknowledged; releasing can leave a continuation
brief. Backup: `POST /api/backup {"dest": "..."}` (SQLite `VACUUM INTO`).

Built from `../handoff-dsh-three-run-completion/agent1-deliverable.md` phases 1-2.
Built: phase 3 DSH connector (connectors/dsh-connector.mjs) and phase 4 machine runner (runner.mjs: claim, isolated workspace, heartbeat, cancel ack; spawn is user-typed only, never DSH runs). Not built yet: phase 5 notifications.
