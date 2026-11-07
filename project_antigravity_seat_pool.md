---
name: project_antigravity_seat_pool
description: "Antigravity multi-account seat pool: the credential-isolation bug and its fix, what is proven, and the router work still open for Codex"
metadata:
  node_type: memory
  type: project
  modified: 2026-09-11T00:00:00.000Z
---

Started and handed off 2026-09-10 by Claude Opus 5 at 93% quota. GPT-6 / Codex
continues with the remaining 7%. Goal: several Google accounts on one machine,
each holding its own Antigravity quota, with automatic hand-off as accounts
drain — a team working shifts, not one person's accounts.

Companion note: [[project_antigravity_agy_seat]] (the headless driver and the
three DSH seats). This note is about the *account pool underneath* it.

## The load-bearing discovery: the IDE is not needed

`language_server.exe --standalone` authenticates itself. With no session it
prints a Google authorization URL and reads the code from stdin:

```
No valid authentication found (). Starting login...
Please visit the following URL to authorize the application:
https://accounts.google.com/o/oauth2/auth?access_type=offline&...
Enter the authorization code:
```

`access_type=offline`, PKCE, so a refresh token is issued and persists. This
contradicts the earlier conclusion in [[project_antigravity_agy_seat]] that the
OAuth session belongs to the Electron IDE and a standalone server always
returns 401 — that held for the IDE's *own* credential store, not for a
standalone server, which has a separate store of its own.

Cost per seat drops from ~650 MB (IDE + server) to ~178 MB (server only).

**The `agentapi` gate passed.** A conversation started against a standalone
server, no IDE involved:

```json
{"response":{"newConversation":{"conversationId":"822db9bc-6ec5-4585-9d2c-9b27952af4b9"}}}
```

Of the two loopback ports a server binds, one speaks gRPC and the other fails
with `error reading server preface`. Trying both is correct and costs nothing.

## The bug that cost most of the session, and the fix

`-gemini_dir` isolates conversations, brain and config. **It does not isolate
the account.** The standalone OAuth token is written to

```
<home>/.gemini/jetski-standalone-oauth-token
```

computed from the home directory and ignoring the flag. Three seats were
created and logged in separately; all three reported one email, and the user
was never re-prompted on the second and third logins because a valid token was
already sitting at that path.

Proof it was shared: a brand-new empty `-gemini_dir` with no login started with
`Authenticated as kevin@mixedmonthly.com`.

**Fix: give each seat its own home.** `seatEnv()` in `agy-profile.mjs` sets
`USERPROFILE`, `HOME`, `HOMEDRIVE`, `HOMEPATH` to the seat directory. Verified:
a seat that previously inherited the shared account now reports `signed-out`,
and a server under an overridden HOME prints `No valid authentication found ()`
while the real profile stays signed in.

**Do not also redirect `APPDATA` or `LOCALAPPDATA`.** An attempt that did
redirect them produced a server that never started and emitted nothing at all
on either stream. A regression test asserts both stay inherited.

Ruled out as the credential's location before it was found: Windows Credential
Manager, the registry, `%APPDATA%`, `%LOCALAPPDATA%\Google`, `~/.gemini/config`,
and the seat gemini dirs. It was found by diffing file modification times
across the profile, which is the technique to reach for next time.

## Seat directories are portable

The token file is plain JSON, 501 bytes, entirely printable, with keys
`access_token`, `refresh_token`, `expiry`, `token_type`, `auth_method`. No
DPAPI, no machine binding. Copying `~/.dsh/antigravity/` to another machine
carries the accounts with it — relevant because the user is moving to a 128 GB
box and should not repeat the logins.

Security consequence worth stating plainly: each seat holds a plaintext bearer
refresh token for a Google account, with scopes including `cloud-platform` and
`userinfo.email`. The pool multiplies how many exist on one disk. Restrict the
directory with NTFS ACLs and keep the disk encrypted.

## What is built

`packages/council/tool-council/bin/agy-profile.mjs` in `deepseek-harness`,
branch `feat/heterogeneous-teammates`, with
`packages/council/tool-council/tests/agy-profile.test.mjs`. 11 tests, `node
--test`, all passing.

Commands: `add`, `login`, `start`, `stop`, `status`, `list`, `remove`.

- Registry at `~/.dsh/antigravity/accounts.json`; seats at
  `~/.dsh/antigravity/profiles/<id>/`. Paths and bookkeeping only, no secrets.
- Discovery reads `<geminiDir>/antigravity/daemon/ls_*.json`, written by a
  server started with `-persistent_mode=true`, carrying pid, both ports and the
  CSRF token. This replaces scraping `language_server.exe` command lines, which
  cannot tell two seats apart.
- `status` reports each seat's account, tier and both weekly buckets, and warns
  when two seats share one Google account — that warning is what exposed the
  credential bug on its first real run.
- `login` pipes the server's stdout, spots the authorization URL and opens it in
  a browser started on a throwaway `--user-data-dir`. A private window is not
  enough: Chromium shares one private session across windows, so the second
  seat's login silently reuses the first seat's account.
- `add` writes the registry entry *before* running the login, so an interrupt
  cannot leave a signed-in session on disk that nothing points at.

Gotchas already paid for: a UTF-8 BOM from `Out-File -Encoding utf8` breaks
`JSON.parse` on a hand-edited registry (`parseJsonFile` strips it); an em dash
in console output becomes mojibake under the Windows console codepage; Windows
console QuickEdit freezes output until Enter is pressed, which looks like a hung
command during login.

## Quota shape, measured

Two buckets per account, both weekly, independent per account:

- `gemini-weekly` — Gemini Flash and Pro. This is the only bucket headless
  seats can spend, because `agentapi --model` resolves only `flash_lite`,
  `flash` and `pro`.
- `3p-weekly` — Claude Opus, Claude Sonnet, GPT-OSS. **Unreachable headlessly**,
  so roughly half of every account's entitlement is idle. This is a protocol
  limit, not a memory limit, and is the largest unclaimed resource in the whole
  design.

The server states `"Your weekly limit is tied directly to your individual
tier."` — so `remainingFraction` is tier-relative and **not comparable across
tiers**. A router that ranks seats by fraction alone will prefer weak seats.

Tiers seen, from `userStatus.userTier.id`:

- `free-tier` — "Antigravity Starter Quota"
- `g1-plus-tier` — "Google AI Plus", whose own note says it "receive[s] the
  minimum base limits"; paid did not mean larger.

Read the tier from `userTier`, never from `planStatus.planInfo`. The latter is
inherited Codeium/Windsurf scaffolding and reports `planName: "Pro"` with
`TEAMS_TIER_PRO` for an account whose real tier is `free-tier`. A regression
test covers this.

Google One did not apply to the Workspace account and family sharing did not
confer a paid Antigravity tier; both read `free-tier`.

## State — 2026-09-11, pool live in DSH (Claude Opus 5)

Runbook steps 1–3 done 2026-09-10; router and DSH wiring done 2026-09-11 in
`60f4d9e43e` on `feat/heterogeneous-teammates`. Committed locally, not pushed.

Seats, all signed in, distinct accounts:

- `seat1` — sales@420smoking.co, `g1-plus-tier`
- `gone1` — kevin@mixedmonthly.com, `g1-plus-tier`, gemini-weekly ~0.3% (resets 2026-09-15)
- `fam1` — kevin.luster@katakiinc.com, `free-tier`
- `seat4` — tammi.leung@gmail.com, `g1-plus-tier` (added 2026-09-13; both buckets 100%, reset 2026-09-21)

More seats: `~/Desktop/ADD-AGY-SEATS.cmd` (+ `.ps1`) asks how many, finishes token-less seats first,
continues from the highest `seatN`, closes each login window once its token file lands. Dry-run hooks:
`DSH_ANTIGRAVITY_ROOT`, `AGY_LOGIN_STUB`, `AGY_SEAT_COUNT`.

A fresh login's tier can read `free-tier` for a few minutes before settling
(seat1 did); re-read `status` before recording it.

**The second load-bearing discovery: `--override_ide_version`.** Seats started
without it get every turn answered with "Your current version of Antigravity is
out of date" — written to the trajectory at the answer path `.20.1`, so the
driver used to print it as a reply and exit 0. The install was current (2.12.2).
The IDE passes `app.getVersion()` (see `resources/app.asar`, the standalone
launch block); `ideVersion()` in `agy-profile.mjs` reads it from the
`package.json` inside `app.asar`. Any version string passes (1.0.0 was
accepted); only a missing one is rejected. Env override:
`ANTIGRAVITY_IDE_VERSION`.

**Router, in `agy-headless.mjs`** (`--seat auto|pool|ide|<id>`, env `AGY_SEAT`):
score = tier weight × gemini-weekly `remainingFraction` ÷ (1 + in-flight
leases). Leases are `~/.dsh/antigravity/leases/<seat>.<pid>.lease`, taken
under `lease.lock`; dead-pid leases are swept. Failure hands off and replays
the prompt; `quota` parks until the bucket's `resetTime`, `stalled` for
15 min, in `parked.json`. Down-but-signed-in seats are started on demand.
`auto` falls back to the IDE only when every pool seat fails. Tier weights:
free and Plus = 1 (measured equal), `g1-pro-tier` 4 and `g1-ultra-tier` 16
are placeholders. `--print-target` shows the ranking without a model turn.

**DSH:** `~/.dsh/settings.yaml` council seats `agy-flash-lite`, `agy-flash`,
`agy-pro` set `enabled: true` (backup `settings.yaml.pre-agy-pool-052327`).
No rebuild was needed: the compiled `lib/index.js` already carried the seats.
Driver + `agy-profile.mjs` installed to `~/.dsh/bin/` by
`scripts/install-agy-headless.mjs`.

Verified live: three parallel runs answered on seat1, fam1, seat1; seat1
restarted without the version flag failed `outdated` and fam1 answered;
`--seat seat1` alone exits 1 with the rejection; all three `agy-*` seats
answered through the council's `askCliSeat` with seats from the compiled
`resolveSeats` (25.5s wall). `node --test` over the three agy test files: 19/19.

Cold start proven: with all seats stopped, one call through `~/.dsh/bin` started
all three and answered in 11.4s. A reboot needs no manual `start`.

**Consumers of the driver (keep stable):** `packages/llm/llm-antigravity` (commit
`65170f9bdf`, claudecode-b7) spawns `node ~/.dsh/bin/agy-headless.mjs --model <tier>
--tools shared --seat auto --json` with the prompt on stdin. It parses the `--json`
line `{text}`, stderr lines prefixed `agy-headless:`, and the `(quota)` /
`(signed-out)` kind markers. `quota-antigravity/src/pool.ts` reads the registry,
discovery files, leases and `parked.json` directly. Message the owning session before
changing any of those.

Concurrency, partial: seat1 served two conversations at once. Upper bound
not measured.

The pre-fix shared token still sits at `~/.gemini/jetski-standalone-oauth-token`
and is a live credential. The user decided on 2026-09-11 to keep it: do not delete it or ask again.

## What is left

1. ~~Router~~ and 2. ~~DSH seat wiring~~ — done 2026-09-11, above.
3. ~~Panel~~ — done 2026-09-11 by Claude Opus 5 (claudecode-b7): the quota tool
   reads every seat plus the IDE, publishes one tier-weighted combined figure and
   a row per seat with countdowns; Antigravity is also a selectable model route
   (`llm-antigravity`). See [[project_antigravity_quota_tool]].
4. **Measure concurrent conversations per seat.** Untested, and it sizes the
   whole router: parallelism is accounts × k, not accounts.
5. **Investigate `3p-weekly`**, above. Either a newer Antigravity exposes Claude
   tiers to `agentapi`, or the Electron IDE has to be driven per account — which
   is affordable on 128 GB but fragile.

The user's stated preference is a hot pool with fan-out — seats resident and
working in parallel — rather than the sequential hand-off the project started
from. RAM was the only reason for sequential, and 128 GB removes it. Shape the
lease API so parallel dispatch is an extension rather than a rewrite.

See [[project_antigravity_agy_seat]], [[project_antigravity_quota_tool]],
[[dsh-council-plugin]], [[nothing-without-permission]].

## Resume runbook — one step, then wait

Added 2026-09-10 so a fresh session can continue cheaply. Session length drives
cost here far more than question difficulty, so each step is small and the agent
stops after it rather than running ahead. Do them in order.

**Step 1 — sign in seat1.** (done 2026-09-10) User runs, in their own terminal tab:
`node "~/Documents/claudecode/deepseek-harness/packages/council/tool-council/bin/agy-profile.mjs" login seat1`
A clean browser window opens; sign in as one account; paste the code at
`Enter the authorization code:`; Ctrl-C. Report back: done.
Agent then runs `start seat1` + `status`, confirms the email, stops.

**Step 2 — sign in gone1.** (done 2026-09-10) Same, `login gone1`, a **different** account.
Agent confirms `status` shows two distinct emails and no collision warning,
stops.

**Step 3 — sign in fam1.** (done 2026-09-10) Same, `login fam1`, a third account. Agent confirms
three distinct emails, records each `userTier.id`, stops.

**Step 4 — measure concurrency.** (partial: k ≥ 2 on seat1) Agent starts one seat and opens conversations
against it in parallel to find how many it serves at once. This sizes the
router: parallelism is accounts × k, not accounts. Stops with the number.

**Step 5 — build the router.** (done 2026-09-11, `60f4d9e43e`) Lease by tier weight × `remainingFraction`, park
on `resetTime`, replay the prompt on hand-off. Lease API shaped for parallel
fan-out, since the 128 GB machine removes the reason for sequential. Stops with
tests green.

**Step 6 — register in `src/seats.ts`** (done 2026-09-11: no source change needed, the seats already existed; enabled in `settings.yaml`) so the pool backs the `agy-*` seats.

**Step 7 — extend `packages/client/ui-antigravity-quota`** to a row per seat. (done 2026-09-11, claudecode-b7)

Standing constraints for whoever resumes: seat logins are the human's alone,
never the agent's; commit locally only; the pre-fix shared token at
`~/.gemini/jetski-standalone-oauth-token` stays, by the user's decision.
