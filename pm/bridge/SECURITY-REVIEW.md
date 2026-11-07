# DSH bridge security review

Drafted by the L6 lead session RUN-20261008-001 (Claude Opus 5.5). Reviewed against the code and corrected by Claude Opus 5.5 [a652e4] on 2026-10-08. Each "enforced" claim was checked in the file named.

| # | Threat | Severity | Enforced now | Gap / fix |
|---|---|---|---|---|
| 1 | `PM_TOKEN` in cleartext on the LAN (plain HTTP) | High on an untrusted LAN; accepted for the lab LAN (user decision 2026-10-08) | Bearer check with `timingSafeEqual` on the SHA-256 (`auth.mjs:createAuth`) | Anyone sniffing the LAN gets peer scopes, including `execute`. Fix: carry peer traffic over Tailscale (100.x addresses, WireGuard) instead of LAN IPs. |
| 2 | `/mcp` public via Tailscale Funnel | Critical before the fix; Medium now | (1) Proxied requests are treated as remote: `x-forwarded-for`, `forwarded` or `tailscale-funnel-request` headers disable loopback trust (`auth.mjs:createAuth`, `server.mjs` request handler). Before this fix, Funnel traffic arrived from 127.0.0.1 and would have had full scopes. (2) Funnel mounts only `/mcp/<token>`. (3) A path token must be a bridge-tokens.json token; `PM_TOKEN` gets 403 (`index.mjs:handle`). | The secret sits in a URL: it can appear in ChatGPT config and proxy logs, it never expires, and it carries `execute`. Fix: OAuth with dynamic client registration; meanwhile rotate the token often and turn Funnel off when not testing. |
| 3 | `execute` scope runs Claude Code | High | `requireScope(principal, 'execute')` for claude-code submit/cancel/pause/resume (`index.mjs:50`). Quota gate (`workers.mjs:80`, `weight.mjs:quotaGate`), slots, and `--permission-mode default` (README). | The prompt is attacker-controlled for any holder of an execute token. Fix: a project allowlist on tokens (`--projects`), and a per-token rate limit (not implemented). |
| 4 | Path traversal in file transfer | Low | `safeRelative` rejects absolute paths, drive letters, `..` and device names; `inside()` checks the root (`files.mjs`). Unit test "file transfer rejects bad checksum and traversal" passes. | None found. |
| 5 | Run cwd outside roots | Low | Default cwd is a fresh `bridge-work/<id>`. A caller-supplied cwd must be inside `execRoots()`, or the submit fails with "outside BRIDGE_EXEC_ROOTS" (`workers.mjs` lines 87-89; integration test 9). | `BRIDGE_EXEC_ROOTS` is trusted from the environment, which is acceptable because only the operator sets it. |
| 6 | Replay and duplicates | Medium | Messages are deduped by `id`/`dedupe_key` (`queue.mjs:enqueue`). A lost claude-code lease becomes `uncertain`, not re-run (integration test 7). | Tokens are static, with no expiry or binding. Fix: expiry fields in bridge-tokens.json checked in `auth.mjs`. |
| 7 | Audit | Low | `bridge_audit` records every 4xx refusal with principal and source address (`index.mjs:handle` catch block), plus queue actions (`queue.mjs:audit`). Tokens are never logged. | Prompts are not in the audit table; they are in the per-run logs under `pm-data`. The audit table is not tamper-evident. |

## Found by L6, not fixed

TTL is lost on forward. `normalizeEnvelope` computes `expires_at` only from `ttl_seconds` (`protocol.mjs` lines 72 and 92), but forwarded envelopes carry `expires_at` without `ttl_seconds`. So the receiving node keeps forwarded messages with no expiry.

The fix is to accept an incoming `expires_at` when `ttl_seconds` is absent. This is a correctness bug, not a security one.
