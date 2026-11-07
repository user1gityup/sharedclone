# DSH bridge failure modes

Drafted by the L6 lead session RUN-20261008-001 (Claude Opus 5.5). Reviewed against the code and corrected by Claude Opus 5.5 [a652e4] on 2026-10-08.

| Failure | Observed behaviour | Operator action |
|---|---|---|
| Peer down | The message stays in `outbox`. `workers.mjs:httpForwarder` retries with backoff up to 60 s, and after `max_attempts` (default 20, `queue.mjs` schema) it becomes `dead`. Proven cross-host: a ping queued while vmixer was down was delivered once after its restart (test 7, 2026-10-08). | Restore the peer, or requeue with `POST /api/bridge/messages/:id/requeue`. |
| Lease lost mid-run | `node` work goes back to the queue. A `claude-code` submit becomes `uncertain` and is never auto-retried, so it is not double-billed (integration test 7, local). | Check the run log under `pm-data`. Requeue only if the run did not happen. |
| Quota gate | The submit gets an `error` reply `quota gate: <reason>` (`workers.mjs:80`) when session or week usage is at least `BRIDGE_QUOTA_LIMIT`% (default 95), or when the usage cache is missing or older than 24 h. | Refresh the status line cache (`usage-panel.mjs`), or wait for the quota to reset. |
| Slot exhaustion | Submits beyond `BRIDGE_EXEC_SLOTS` (default 2) wait in `queued` (integration test 6 saw at most 2 running at once). | Wait, raise the slot count, or cancel a run with `bridge_cancel`. |
| File hash mismatch | A push is not delivered until the destination's recomputed SHA-256 matches. A pull throws 422 when the bytes don't match the node's hash (`files.mjs:pullFile`). | Retry the transfer, and check the disk or network if it repeats. |
| Dead letters | State `dead` after `max_attempts`. List them with `GET /api/bridge/messages?state=dead`. | Fix the cause, then requeue. |
| Expiry on forward (clock skew row) | Forwarded messages lose their TTL: `normalizeEnvelope` ignores an incoming `expires_at` when `ttl_seconds` is absent (`protocol.mjs` lines 72 and 92). Clock skew therefore doesn't matter today, because forwarded messages never expire. | Known bug, unfixed. Keep the clocks NTP-synced for when it is fixed. |
| ChatGPT connector refused | 404 from Tailscale means a wrong or truncated path. 401 means a bad token. 400 means the token was sent in both the path and a header. 403 means `PM_TOKEN` was put in the path. | Re-copy the URL from `pm-data/chatgpt-mcp-url.txt`, or rotate the `chatgpt` token. |
