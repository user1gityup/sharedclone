# DSH bridge runbook

Drafted by the L6 lead session RUN-20261008-001 (Claude Opus 5.5). Reviewed against the code and corrected by Claude Opus 5.5 [a652e4] on 2026-10-08.

## Start / stop

Either script works on either host.

| Script | Binds | Auth |
|---|---|---|
| `START-PM.cmd` | 127.0.0.1:4480 | loopback callers trusted |
| `START-PM-LAN.cmd` | 0.0.0.0:4480 | non-loopback callers need `PM_TOKEN` from `~/.claude/pm-remote.env` |

- **Firewall:** LAN mode needs inbound TCP 4480 open on the Private profile.
- **Bridge on/off:** the bridge is on unless `PM_BRIDGE=0` (`server.mjs`, `createBridge` call).
- **Stop:** kill the pm `node server.mjs` process. Queue state persists in `~/.claude/pm-data/bridge.db`.

Live on 2026-10-08:
- **ndi2:** LAN mode with `BRIDGE_ALLOW_FAILOVER=1`, started by hand (not by a script). A reboot or `START-PM.cmd` returns it to loopback-only without failover.
- **vmixer2o2:** `START-PM-LAN.cmd`.

## Environment

| Variable | Meaning | Source |
|---|---|---|
| `PM_TOKEN` | Shared peer token. Peer scopes come from `BRIDGE_PEER_SCOPES` (default `send,read,file,execute`). | `auth.mjs:createAuth` |
| `BRIDGE_PEERS` | Peers file path. Default `~/.claude/pm-data/bridge-peers.json`. | `index.mjs:loadPeers` |
| `BRIDGE_ALLOW_FAILOVER` | When `1`, this sending node may move an undeliverable submit to a `failover_to` machine after `failover_after` failed deliveries. Off by default: failover can double-execute when a partition hides a successful delivery. | `workers.mjs`, README |
| `BRIDGE_EXEC_SLOTS` | Concurrent Claude runs. Default 2; extra submits wait queued. | `workers.mjs:createWorkers` |
| `BRIDGE_QUOTA_LIMIT` | Percent of session or week quota at which execution is refused. Default 95. Fails closed when `~/.claude/statusline/usage-cache.json` is missing or older than 24 h. | `weight.mjs:quotaGate` |
| `BRIDGE_EXEC_ROOTS` | Extra allowed `cwd` roots, `;`-separated. The default run cwd is `~/.claude/pm-data/bridge-work/<id>`. | `workers.mjs:execRoots`, `workers.mjs` lines 87-89 |
| `BRIDGE_TOKENS` | Token file. Default `~/.claude/pm-data/bridge-tokens.json`. | `auth.mjs:defaultTokenFile` |

## Peers file

```
{ "<machine>": { "url": "http://<ip>:4480", "token": "<PM_TOKEN>" } }
```

- **ndi2:** `vmixer2o2` -> `http://10.0.0.244:4480`
- **vmixer2o2:** `vmixlaptop2x6` and `ndi2` -> `http://10.0.0.241:4480`

Restart pm after editing.

## Health

- `GET /api/bridge/health` (read scope) returns machine, queue counts, running ids and peers. It is also available as `node bridge/cli.mjs status`.
- `GET /api/bridge/audit` (admin scope) returns refusals and actions.
- `GET /api/bridge/messages?state=dead` lists dead letters (`queue.mjs:list`).
- `GET /api/bridge/delivery` returns policy, pending counts per mailbox agent and presence; `GET /api/bridge/delivery/:id` one message's delivery timeline. Overdue/failed mail also appears as pm events (`entity bridge`) and in the pm Attention panel under "Bridge mailboxes".
- Change timeouts with `PUT /api/bridge/policy` (admin scope); takes effect at the next sweep, no restart. See README "Reliable delivery".

## Requeue

- `POST /api/bridge/messages/:id/requeue` (admin scope, `index.mjs` routes) puts a dead or uncertain message back in the queue.
- Requeue an `uncertain` claude-code submit only after confirming it did not already run; it is never auto-retried.

## Tokens

- **Create or rotate:** `node bridge/cli.mjs token-add <name> <scopes>` prints the token once. Only its unsalted SHA-256 is stored in `bridge-tokens.json`. Re-running it with the same name replaces that entry. Restart pm to load the change.
- **Revoke:** delete the entry from `bridge-tokens.json`, then restart pm.
- **PM_TOKEN rotation:** generate a new value, update `pm-remote.env` and both hosts' `bridge-peers.json`, then restart pm on both hosts.

## ChatGPT via Tailscale Funnel (test 11, live 2026-10-08)

- **Token:** `chatgpt`, scopes `send,read,execute`. Its URL is in `~/.claude/pm-data/chatgpt-mcp-url.txt`, outside git.
- **Route:** `/mcp/<token>`, handled by `index.mjs:handle`. Only bridge-tokens.json tokens are accepted there. `PM_TOKEN` in the path gets 403, and token in both path and header gets 400.
- **Tailscale (CLI 1.44, run from PowerShell):** Git Bash rewrites `/paths`, so don't run these from Bash.
  - `tailscale serve https /mcp/<tok> http://127.0.0.1:4480/mcp/<tok>`
  - `tailscale funnel 443 on`
- **Trailing slash:** Tailscale forwards the request as `/mcp/<tok>/`, and the route accepts that.
- **Exposure:** Funnel exposes only that path. Any other path gets a 404 from Tailscale. Never mount `/` or `/api`, because pm's `GET /` is unauthenticated.
- **Turn off:** `tailscale funnel 443 off`, or `tailscale serve reset`. To kill the access itself, revoke the `chatgpt` token.
- **Tailnet prerequisites:** HTTPS certificates enabled, and the policy file has `nodeAttrs` with `attr: ["funnel"]`.

## Rollback

- Set `PM_BRIDGE=0` and restart pm. The rest of pm keeps working.
- For full removal, revert the bridge import and `bridge` option in `server.mjs`, then delete `pm/bridge/`.
- Turn Funnel off first.
