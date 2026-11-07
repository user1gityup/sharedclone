# pm bridge - ChatGPT / DSH / Claude messaging and execution

Built 2026-10-08 by Claude Opus 5.5 on ndi2 (pm project `dsh-bridge`, P-c4b7ecad).
It is a module of the pm server: it starts with `server.mjs`, and `PM_BRIDGE=0` turns it off.
It has its own SQLite file (`~/.claude/pm-data/bridge.db`, override `BRIDGE_DB`), so it never touches `pm.db`.

## Status (2026-10-08)

| Area | State |
|---|---|
| Protocol v1, queue, auth, files, Claude Code adapter, MCP endpoint | built; unit tests 14/14 (`node --test bridge/test.mjs`) |
| Operational tests 1-10 | PASS on ndi2 plus a second local pm instance (`node-b`, port 4481) standing in for the other machine. Evidence: `~/.claude/pm-data/bridge-evidence/integration-2026-10-08T10-14-49-674Z.json` |
| ndi2 <-> vmixer2o2 over the LAN | NOT TESTED. vmixer pm is up at 10.0.0.244:4480, but its inbound firewall rule is missing (`ADD-PM-FIREWALL-RULE.cmd` on the vmixer Desktop needs elevation). `pm-remote.env` still says .241. |
| Claude Desktop app | The MCP transport is proven through the stdio shim. The Desktop app itself is not registered yet; that needs a config entry and a GUI restart (see below). |
| ChatGPT | BLOCKED: connector unavailable. `/mcp` listens on loopback only, and the user deferred Tailscale Funnel. |

## Architecture

```text
ChatGPT (custom MCP connector, later via Funnel) --HTTPS--> /mcp ┐
Claude Desktop --stdio--> bridge/cli.mjs mcp-stdio --HTTP--> /mcp ┤
CLI / scripts --HTTP--> /api/bridge/*                             ┤--> queue (bridge.db)
peer pm node --HTTP + PM_TOKEN--> /api/bridge/messages            ┘      |
                                                       workers (in server process)
                                       node agent | claude-code executor | forwarder -> peers
                                                       |
                                    weight router (harness src/router) + quota gate
```

## Protocol v1 (`protocol.mjs`)

Envelope: `v, id, dedupe_key, type, from{machine,agent}, to{machine,agent}, correlation_id, reply_to, project, task, session, body, created_at, ttl_seconds`.
Types: `message ping submit accept status progress log cancel pause resume result error ack`.
States: `outbox forwarded queued held leased done uncertain cancelled dead`.

- The same `id` or `dedupe_key` is stored once; a repeat returns `duplicate: true`.
- Replies carry `correlation_id` (the original submit) and `reply_to` (the message being answered).
- A message for another machine waits in `outbox`. The forwarder delivers it, backing off 1 s, 2 s and so on up to 60 s, and marks it `dead` after 20 attempts (`max_attempts`).
- Leases are fenced. Every lease increments `fence`, and a stale fence cannot settle a message (409).
- When a lease is lost, `node` work goes back to the queue. A `claude-code` submit becomes `uncertain` and is never re-run automatically, because that could bill twice. `POST /api/bridge/messages/:id/requeue` (admin scope) re-runs it deliberately.
- Replay: `GET /api/bridge/messages?after=<seq>` (plus `agent`, `machine`, `correlation`, `state`).

## Agents on each node

- `node`: answers `ping`, `message` (echo) and `status`. Its work is safe to retry.
- `claude-code`: `submit {prompt, model?, capability?, max_turns?, cwd?, resume_session?, permission_mode?, failover_to?, failover_after?}`.
  - Runs `claude.exe -p --output-format stream-json --verbose --include-partial-messages --model <m>`, with the prompt on stdin.
  - Emits `accept` (model, router reason, quota), then `progress` (partial text, at most 1 per second), then `result` or `error` (exit code, session, cost, usage, log path).
  - Logs go to `~/.claude/pm-data/bridge-logs/<id>.log`.
  - `cancel` kills the process tree and the run ends `cancelled`.
  - `pause`/`resume` hold or release a queued submit. A started run can only be cancelled.
- Any other agent name, such as `chatgpt` or `it`, is a mailbox. Read it with `GET /api/bridge/messages?agent=X`, then `POST .../:id/ack`.

## Execution gate (pre-approved by the user, 2026-10-08)

A bridge-started Claude Code run needs all of these:
1. A token with the `execute` scope. Loopback callers get it while `trustLoopback` is on, which is the pm default.
2. The quota gate passes. It reads `~/.claude/statusline/usage-cache.json`, refuses at 95% or more of session or week (`BRIDGE_QUOTA_LIMIT`), and fails closed when the reading is missing or older than 24 h.
3. The DSH weight router (`resolveRoster`) picks the model. A pinned model must be one of the candidates. With no router and no pin, the run is refused.
4. A free slot (`BRIDGE_EXEC_SLOTS`, default 2). Extra submits wait in the queue.
5. `cwd` lies inside `BRIDGE_EXEC_ROOTS`. The default is a fresh `~/.claude/pm-data/bridge-work/<id>`.

## Machines: origin default and failover

A submit runs on `to.machine`. When that is omitted, it runs on the origin node. Failover happens only when **all** of these hold:
- The sending node has `BRIDGE_ALLOW_FAILOVER=1`.
- The submit lists `failover_to`.
- It is not resuming a machine-local session.
- Delivery has failed `failover_after` times (default 3).

The undelivered original is marked `dead` before the copy is sent.
Known limit: if the target stored the message but the acknowledgment was lost, failover can run the task twice. Keep failover off for expensive jobs until a cross-machine lease exists.

## Reliable delivery (`delivery.mjs`, ChatGPT request seq 225, 2026-10-08)

- Mailbox messages (any agent except `node`, and `claude-code` for anything but submit/cancel/pause/resume) are **tracked** on the machine they land on. Rows stored before this change have `track = 0` and are never marked overdue.
- Delivery state (`envelope.delivery.state`, `protocol.mjs:deliveryState`): `queued` -> `forwarded` -> `delivered` (the recipient's own read) -> `acknowledged` (explicit ack by the recipient) -> `responded` (a message with `reply_to` = its id came from the recipient). `failed` = escalations exhausted or dead; `expired` = `ttl_seconds` passed first.
- Inbox: `GET /api/bridge/inbox/:agent?after&limit` or MCP `bridge_inbox {agent, unacked:true}` returns every **unacknowledged** message, oldest first; nothing is skipped until acked, so a crashed reader sees it again and restart replays it. `after`/`next_after` page within one read. Legacy `bridge_inbox` without `unacked` keeps its array shape and marks delivered when the caller is the recipient.
- Ack: `POST /api/bridge/ack {agent, ids?, up_to?}` or MCP `bridge_ack`. Only a token that speaks for the agent (`bridge-tokens.json` `agents`, default its own name; loopback and peer = all; admin) may ack or mark delivered. Idempotent; advances `bridge_cursors`.
- Status: `GET /api/bridge/delivery[/:id]`, MCP `bridge_delivery_status`; pending counts per agent (unacked, undelivered, overdue, high, failed, awaiting_response, cursor, last seen) in `/api/bridge/health` and the pm Attention panel. MCP `initialize` records a connect and reports pending counts in `instructions`.
- Timeouts: `~/.claude/pm-data/bridge-policy.json` (outside git), `GET/PUT /api/bridge/policy` (PUT = admin). Defaults: ack 300 s, response 1800 s (only when `expects_response`), escalation backoff 300/900/1800 s, max 3, then `failed`. The workers sweep every 5 s: each overdue message raises a pm event (`entity bridge`, `delivery_overdue` / `delivery_failed`, actor `dsh-bridge`); `priority: high` also sends a message to each `escalate_to` agent. Overdue mail is reported, never re-pushed: a pull-only client such as ChatGPT sees it only when its user starts a turn.

## Files (`files.mjs`)

- `POST /api/bridge/files {name, path?, size, sha256, root}` opens a transfer.
- `PUT /api/bridge/files/:id?offset=N` sends a chunk of up to 4 MB. Retried chunks are ignored, so retries are safe.
- `POST .../complete` makes the destination **recompute the SHA-256**. The file is delivered only on a match; otherwise the transfer is `rejected` (422) and the partial file is deleted.
- Roots: `inbox` (`~/.claude/pm-data/bridge-files`) and `brain` (`shared-brain/bridge-inbox` only).
- Path safety: absolute paths, `..`, drive letters, device names and trailing dots are rejected. Files are never overwritten; a repeat gets a `.vN` suffix.
- The size limit is `BRIDGE_MAX_FILE` (200 MB).
- `GET .../content` returns `x-sha256`. `pullFile` re-hashes the download and refuses to overwrite an existing file.

## Auth (`auth.mjs`)

- Scopes: `send read execute file admin`. Tokens live hashed in `~/.claude/pm-data/bridge-tokens.json`.
- `node bridge/cli.mjs token-add <name> <scopes> [--projects a,b]` prints the token once. Restart pm afterwards to load it.
- Peer nodes authenticate with the shared `PM_TOKEN`, with scopes from `BRIDGE_PEER_SCOPES` (default `send,read,file,execute`).
- Every refusal (401/403/4xx) is written to `bridge_audit`; read it with `GET /api/bridge/audit` (admin scope). Tokens are never logged.

## Deploy

**ndi2:** run `START-PM.cmd` as usual. The bridge is on. Loopback is trusted.

**Two machines (lab LAN, token in cleartext over HTTP; this is the user's 2026-10-08 choice, and Tailscale comes later):**
1. On each machine, start pm with `START-PM-LAN.cmd` (`PM_HOST=0.0.0.0`, `PM_TOKEN=<shared>`).
2. Open TCP 4480 to the local subnet only.
3. On each machine, create `~/.claude/pm-data/bridge-peers.json`:
   - on ndi2: `{"vmixer2o2": {"url": "http://10.0.0.244:4480", "token": "<PM_TOKEN>"}}`
   - on vmixer: `{"vmixlaptop2x6": {"url": "http://<ndi2-ip>:4480", "token": "<PM_TOKEN>"}, "ndi2": {...same...}}`
4. Check: `node bridge/cli.mjs send node ping --machine vmixer2o2`, then `node bridge/cli.mjs thread <id>`.

**Claude Desktop:** add to `%APPDATA%\Claude\claude_desktop_config.json`:
`"mcpServers": {"dsh-bridge": {"command": "node", "args": ["~\\.claude\\shared-brain\\pm\\bridge\\cli.mjs", "mcp-stdio"]}}`, then restart Desktop. This gives tool exchange only. MCP does not control the Desktop UI.

**ChatGPT (deferred):**
1. Expose `/mcp` over HTTPS with Tailscale Funnel.
2. Run `token-add chatgpt send,read,execute`.
3. Add it as a custom MCP connector in ChatGPT developer mode.
4. Call `bridge_run_claude` and then `bridge_thread`.

This round trip has never been run.

## Tests

- `node --test bridge/test.mjs` runs the unit tests. The Claude executor there is `fake-claude.mjs`, a test double.
- `node bridge/integration.mjs <scratch-dir>` runs the operational tests: real pm, real `claude -p` haiku runs, and a second pm instance on 4481. Main pm must run with `BRIDGE_ALLOW_FAILOVER=1` and `BRIDGE_PEERS` naming `node-b`. Each run costs about 7 short haiku runs.

## Failure modes

| Failure | Behaviour |
|---|---|
| Peer down | message stays in `outbox`, backs off up to 60 s, `dead` after 20 tries; `requeue` to retry |
| pm restarts mid-run | boot reconcile: `node` work requeued, Claude submits `uncertain` (no re-run) |
| Duplicate send / client retry | dedupe on `id`/`dedupe_key`, returns the stored message |
| Stale worker after takeover | fence mismatch, 409, its result is discarded |
| Quota at or above 95%, or unknown | submit answered with `error: quota gate ...` |
| Router missing | unpinned submit refused (503); pinned submit runs and is recorded `router: unavailable` |
| File corrupted in transit | 422, transfer `rejected`, partial deleted |
| Message past TTL | `dead` with `expired` |

## Security review (Claude Opus 5.5, 2026-10-08)

- Every bridge request is authenticated, including loopback, and scope-checked per route. Project allowlists are applied to message ingress.
- The default bind is loopback. A LAN bind requires `PM_TOKEN`, because `server.mjs` refuses to bind otherwise.
- Open risk: the LAN link is plain HTTP, so the token can be sniffed on the lab LAN. Tailscale or TLS fixes this; it was deferred by the user.
- Open risk: loopback trust means any local process can use every scope, including `execute`. Set `trustLoopback` off (code option) when untrusted local software runs.
- Open risk: failover can double-execute when a partition hides a successful delivery. Failover is off by default.
- Executions run with `--permission-mode default`. They are not passed `--dangerously-skip-permissions`, and their `cwd` is confined to the exec roots.
- The cloud relay extension point is `httpForwarder(peers)` in `workers.mjs`. A relay is another peer URL speaking the same `/api/bridge/messages` contract. It needs per-tenant tokens, rotation (edit `bridge-tokens.json` and restart) and revocation (remove the entry) before it is deployed.

## Rollback

Do any one of these:
- Set `PM_BRIDGE=0` and restart pm.
- Revert the two hunks in `server.mjs` (the import and the `bridge` option) and delete `pm/bridge/`.

`bridge.db`, `bridge-files/`, `bridge-logs/` and `bridge-evidence/` under `~/.claude/pm-data` can be deleted at any time; pm itself does not depend on them.
