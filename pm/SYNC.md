# pm two-way sync

Written by Claude Opus 5.5 (lane 9), 2026-10-19, from `sync.mjs`, `sync-schema.mjs`, `access.mjs:authorizeSync` and the `PM-SYNC` block in `server.mjs`.

Every host runs its own pm. Each one pulls the others' project/task rows, so either host serves the whole board while the other is off. Same pull pattern as `bridge/replica.mjs`.

## What replicates

| Table | Key |
|---|---|
| `projects` | `id` |
| `order_scopes` | `scope` |
| `tasks` | `id` |

Comments and artifacts replicate too (`sync-children.mjs`): keyed by a deterministic `uid`, not the local autoincrement id; artifacts are immutable, a comment ack flows to the peer.

Not replicated, local to each host: `events`, runs, runners, `order_drafts`, `sync_state`, and everything in `bridge.db` (the bridge has its own replica).

## How

- `migrateSync` (run at every start, idempotent) adds a `chg` column and insert/update triggers to each table. `chg` is a local monotonic change number kept in `sync_state.chg`.
- Every `PM_SYNC_MS` (default 5000) each host calls `GET /api/sync/changes?after=<cursor>&limit=500` on each peer, applies the rows in one transaction, and advances `cursor:<peer>` in `sync_state`. Pages until a short page.
- After an outage the next pull pages through everything missed. A peer whose counter went backwards (database recreated) is re-read from 0.
- Peers come from `bridge-peers.json` (`BRIDGE_PEERS`). Entries naming this machine, and URLs in `PM_SELF_URLS` (comma-separated), are skipped. Aliases with the same URL are pulled once.

## Conflict rule

- **Newest `updated_at` wins.** A tie or an older remote row keeps the local row (`kept_local`).
- **Project name clash:** a remote project whose name is held by a different local id is stored as `<name> (<peer>)`. The suffix is kept on later updates.
- Foreign keys are off during apply, so a task can land before its project.
- **Leases/claims are not fenced across hosts.** Two hosts can both claim one task. Claim only tasks whose `execution_machine` is your host.

## Auth

| Endpoint | Allowed |
|---|---|
| `GET /api/sync/changes?after=&limit=` | loopback, the `PM_TOKEN` peer, or a bridge token with `replicate` |
| `GET /api/sync/status` | same |
| `POST /api/sync/now` | loopback, or a token with `admin` |

Peers pull with the `token` from their `bridge-peers.json` entry (normally `PM_TOKEN`). `replicate` grants nothing outside `/api/sync/*` and `/api/bridge/replica*`. Default peer scopes include it (`BRIDGE_PEER_SCOPES`).

## Environment

| Variable | Meaning |
|---|---|
| `PM_SYNC=0` | Sync off. Endpoints still answer; `migrateSync` still runs. |
| `PM_SYNC_MS` | Pull interval in ms. Default 5000. `0` disables the timer. |
| `PM_SELF_URLS` | Extra URLs that are this host, never pulled. |
| `BRIDGE_PEERS` | Peers file. Default `~/.claude/pm-data/bridge-peers.json`. |

## Enable

Double-click `ENABLE-PM-SYNC.cmd` on each host. Sync is on by default once pm runs the new code with a peers file, so enabling is a restart onto it. Both hosts must run LAN mode (`START-PM-LAN.cmd`) for the peer to reach them.

## Troubleshooting

`GET /api/sync/status` returns `{ chg, peers: [...] }`. Per peer:

- `ok` true/false/null (null = never pulled), `after` (cursor), `last_ok_at`, `last_error`, `last_error_at`.
- `totals` for the last pull: `inserted`, `updated`, `unchanged`, `kept_local`, `renamed`, `errors`, `pages`.

| Symptom | Check |
|---|---|
| `peer <name> HTTP 401` | Peer entry's `token` does not match the other host's `PM_TOKEN`, or the token lacks `replicate`. |
| `fetch failed` / timeout | Peer pm down, loopback-only, or TCP 4480 blocked. |
| Peers list empty | No peers file, or every entry names this machine. |
| `ok: true` but rows missing | `kept_local` counts a newer local edit; `errors` lists rows that failed apply. |
| Forced pull | `POST /api/sync/now` from loopback. |

## Rollback

Set `PM_SYNC=0` and restart pm. The `chg` columns and triggers are harmless and stay.
