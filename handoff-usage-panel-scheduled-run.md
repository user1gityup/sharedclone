---
name: handoff-usage-panel-scheduled-run
description: 2026-09-16 open - Claude quota refresh broken since Sep 14 (claude -p /usage no longer prints quota); endpoint fallback written, untested live because /api/oauth/usage returns 429
metadata:
  type: project
---

Handoff id: usage-panel-scheduled-run
Updated: 2026-09-16 (Claude Opus 5, session f68d042f, host ndi2 / vmixlaptop2x6)
Model: Claude Opus 5 (claude-opus-5)
Project: ~/.claude/statusline/ (no repo, no branch)
Owner: Claude Opus 5 (session f68d042f). No collaborating agents.

**Ask:** "why isn't claude quota working" then "fix it".

**Root cause (verified):** `claude -p /usage` (CLI 2.1.263, npm install dated 2026-09-07) now prints only the
cost summary ("Total cost: $0.0000 ... Usage: 0 input...") with exit 0, so `parseUsage` finds nothing and
every refresh since 2026-09-14 11:07 keeps the stale cache (week 100%, reset Sep 15 already past).

**Built, uncommitted (not in any repo):**
- `usage-cache.mjs`: new `readUsageApi()` - GET https://api.anthropic.com/api/oauth/usage, Bearer token from
  `~/.claude/.credentials.json` claudeAiOauth.accessToken, header `anthropic-beta: oauth-2025-04-20`; maps
  `five_hour.utilization/resets_at` -> sessionPercent/sessionResets and `seven_day` -> week, stamps in
  America/Los_Angeles as `Sep 15, 12:59am`. New `readLive()`: text route first, else endpoint, keeps cached
  request counts/levers. `refresh()` uses `readLive()`. A failed read returns `{failed, reason}` and leaves cache.
- `usage-panel.mjs`: imports `readLive` instead of `readUsageText/parseUsage`.
- `node --check` both files: exit 0.

**Not verified:** a live endpoint read. Three probes (scratchpad probe-usage.mjs) all got HTTP 429
rate_limit_error; retry-after went 347s -> 3585s, so probing extends the lockout. Response shape
(whether utilization is 0-100 or 0-1) is ASSUMED 0-100 from binary strings `five_hour utilization resets_at
seven_day`; confirm on first successful read.

**Open question:** is the 429 a per-account limit on the usage endpoint that the CLI/desktop app also hits
(statusline refresh every 5 min may trip it)? If it persists, alternative source: status line stdin JSON has a
`rate_limits` field (seen in claude.exe strings) - capture stdin once to learn its shape; that route needs no
network call.

**Exact next action:** after ~1 hour idle (no probes before then), run
`node ~/.claude/statusline/usage-cache.mjs` once; expect JSON with sessionPercent/weekPercent and no `failed`.
If utilization looks like 0-1, multiply by 100 in readUsageApi. Then `node usage-panel.mjs --json` and check
footer has no "refresh failed".

**Do-not-repeat:** do not re-probe the endpoint in a loop; do not print the access token.

## Update 2026-09-16 21:55 (Claude Opus 5, session dccf7702, host ndi2 / vmixlaptop2x6)
Ask: "claude quota still not working in dsh".
**Cause of standing 429 (verified by code):** statusline.mjs spawned usage-cache.mjs on every redraw while cache >5 min old; refresh always failed so cache never freshened, so endpoint was hit constantly. Probe 21:47 still 429 (retry after 1282s).
**DSH cause:** packages/quota/quota-claude reads the same stale cache at boot only, and its Refresh runs dead `claude -p /usage`.
**Done:** statusline.mjs now (a) stores stdin `rate_limits.five_hour/seven_day.used_percentage/resets_at` into usage-cache.json (free, no network), (b) throttles background refresh to 1 per 15 min via .refresh-attempt. Backups *.bak-2026-09-16. Fake-stdin test in temp HOME: line shows 37% session / 61% week, cache written with source "statusline".
**In progress:** quota-claude reading.ts refresh: cache-if-fresh, then endpoint, then text; periodic cache re-read in index.ts. deepseek-harness also holds unrelated uncommitted Antigravity work - do not commit it with this.
**Do-not-repeat:** no endpoint probe loops.

## Update 2026-09-16 22:00 (Claude Opus 5, session dccf7702)
**Real root cause (verified):** `claude auth status` -> `"loggedIn": false`; `.credentials.json` rewritten 2026-09-14 19:10 with no refreshToken and no expiresAt; a `claude -p` Haiku turn fails "OAuth session expired and could not be refreshed". Every quota route (text, endpoint 429, DSH) depends on this login.
**DSH fix built (uncommitted, deepseek-harness packages/quota/quota-claude):** refresh() = fresh cache (<5 min) then /api/oauth/usage then /usage text; host re-reads cache every 60 s; tests 13/13 (quota-claude + ui-claude-quota), tsc 0, tsc -b host 0, tsdown host bundle built (lib/index.js contains oauth/usage + cache follow). Not loaded: running DSH pid 29300 predates build.
**Statusline:** stdin rate_limits store + 15 min refresh throttle (desktop app does not run the statusline; stdin route works only in terminal CLI sessions).
**One click shipped:** Desktop\CLAUDE-QUOTA-FIX.cmd = `claude auth login` (browser sign-in, user only), status check (detection tested both ways), one usage-cache.mjs read, restart DSH via launch-dsh.cmd. Untested past login (needs user credential).
**Next:** after user runs it, check usage-cache.json has fresh capturedAt and DSH panel shows it; if endpoint utilization is 0-1, multiply by 100 in both readUsageApi copies. Commit quota-claude separately from Antigravity work on user go.

## Update 2026-09-16 22:17 (Claude Opus 5, session dccf7702, host ndi2)
Ask 2: "still not producing accurate amount".
**Verified:** user signed in (auth status loggedIn true, credentials 22:05). DSH panel showed Session 29% / Week 34% read 22:06:21 = its cache; endpoint at 22:10 said 38%/35%. Cause: panel only read cache at boot and on click; percentages move within minutes.
**Done:**
- ~/.claude/statusline/usage-cache.mjs readLive: endpoint first (1 s, free); `/usage` text only when `leversAt` older than 6 h; endpoint percentages override text. Run 22:14: exit ok, 44%/35%, 1 second.
- statusline.mjs refresh throttle now 2 min.
- deepseek-harness packages/quota/quota-claude: `refreshFree()` endpoint poll every `pollMs` (default 120000, floor 30000), 10 min backoff on failure then cache follow; `refresh()` (button) = endpoint + text when levers stale; `leversAt` field; test rewritten (fetch mock). vitest 13/13, tsc 0, tsc -b host 0, tsdown host built (lib has refreshFree/pollMs). UNCOMMITTED, mixed in tree with Antigravity work.
- DSH restarted 22:15:02 (pid 4180, port 3080 up) with new bundle.
**Verified 22:19:** DSH poll rewrote usage-cache.json at 22:19:07 with no CLI/statusline activity (47% session, 36% week); panel reloaded shows Session 47%, Week 36%, "Read 10:19:07 PM".
**Next:** commit quota-claude files alone on user go.
**Do-not-repeat:** don't loop endpoint probes; don't spawn `claude -p /usage` on timers.


## 2026-09-17 00:12 update, Claude Opus 5 (vmixlaptop2x6)
- Committed on the user's go as `3d0690812a` (quota-claude src/index.ts, src/reading.ts, tests/reading.spec.ts).
- Queued with the harness push to `user1gityup/lseekv1`. Nothing is left uncommitted.
