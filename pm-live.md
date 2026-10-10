---
name: pm-live
description: pm is running and is the resume authority - how any agent on any machine reads and writes it, and what replaced the giant handoff prompt
metadata:
  type: project
---

**pm is live and is the normal place to find current work.** It replaced
reconstructing state from handoff notes. Read it before writing one.

## What it holds

128 tasks across 11 projects, reconciled 2026-09-28 from every source on both
machines: open `handoff-*.md` notes, live Claude Code sessions, DSH council
runs, the gatekeeper push queue, and the brain's own project notes. Every task
carries `lifecycle`, `origin_machine`, `execution_machine`, `run_ref`,
`session_ref`, `checkpoint`, `next_action`, `blockers` and `source_ref`.

`source_ref` is the idempotency key. Re-running any connector updates in place
and never duplicates, so a re-sweep is always safe.

## Reaching it

- **On ndi2 (the host):** `http://127.0.0.1:4480`, no token. The MCP server is
  registered in Claude Code and Codex, so the `pm_*` tools work directly.
- **From any other machine:** `PM_URL` and `PM_TOKEN` from `~/.claude/pm-remote.env`,
  which brain-sync seals into the brain as `fleet/secrets/pm-remote-env.enc` and
  unseals on every fleet machine. Set both and `pm/cli.mjs` works unchanged.
  Non-loopback callers without the bearer token get 401; loopback on the host
  stays token-free.
- ndi2 must be running pm in LAN mode (`pm/START-PM-LAN.cmd`, binds 0.0.0.0)
  and needs a one-time elevated inbound firewall rule for TCP 4480 on the
  Private profile. That rule is a system-security change - the user's, not an
  agent's.

## How runs work now (user amendment, 2026-09-28)

pm **prepares** runs; it does not dispatch them.

- `actions.mjs` is `prepare | start | resume | continue | amend | stop | archive`.
  There is no `launch`.
- `prepare` contacts no DSH, records query/stages/mode on the task, and leaves
  the roster **empty on purpose**, returning the open slots as a question.
- **The user picks the seats, every run.** A roster is never defaulted, inferred
  or carried over. `start` refuses while any slot is empty.
- A stalled run is **repaired in place**: `amend` keeps the run id, leaves the
  `council.pipeline*` fields alone and reuses the seat journal. `restart` refuses
  unless named, because it discards the journal and resets `lastUserTurnAt`.
- A prepared run lives in `tasks.meta`, so it survives a pm restart.

## Assignment

`assignee` is enforced server-side: `claimNext` only returns a task whose
assignee is null or the calling actor, and `startRun` refuses a run on a machine
other than the task's `execution_machine`. Today that is **pull** - an agent
gets work by calling `pm_claim_next`. The push side (`pm/runner.mjs` claiming on
behalf of a machine and spawning a session from the continuation brief) is being
built; until it lands, nothing starts an agent for you.

## Do not

- Do not hand-edit `pm.db`. Everything goes through the store API, REST, the CLI
  or MCP, or attribution and history are lost.
- Do not close a `push-queue` task. pm records the gatekeeper queue; only the
  gatekeeper or the user closes an entry.
- Do not add dependencies. pm is zero-dependency on purpose (`node:sqlite`).

See [[quota-handoff-protocol]] - handoff notes remain the fallback, not the
normal resume path.
