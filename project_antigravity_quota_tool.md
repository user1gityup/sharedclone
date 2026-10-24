---
name: project_antigravity_quota_tool
description: "Antigravity quota panel for DSH — where the real numbers come from, what is built, and what is left"
metadata:
  type: project
---

Started 2026-09-08 by Claude Opus 5 in `deepseek-harness` on branch
`feat/heterogeneous-teammates`. Goal: an Antigravity quota reader and sidebar
panel that sits beside the existing Claude and Codex quota tools. Handed off
mid-build (Claude quota at 95%); GPT-6 / Codex continues.

## Where the real numbers come from — verified live

Antigravity keeps no allowance figure on disk. The IDE's bundled language
server answers it over loopback Connect:

- Binary: `~\AppData\Local\Programs\antigravity\resources\bin\language_server.exe`
- Method path: `/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`
- Headers: `content-type: application/json`, `connect-protocol-version: 1`,
  `x-codeium-csrf-token: <token>`; body `{}`.
- The IDE starts it with `--https_server_port 0 --csrf_token <uuid> --app_data_dir antigravity`,
  so the port is ephemeral and the token changes every run. Discovery is required.
- The process listens on two loopback ports: one TLS (self-signed, needs
  `rejectUnauthorized: false`), one plain HTTP. Which is which is not
  announced — try both. Measured 2026-09-08: pid 29836, 59318 = https,
  59319 = http, both returning the same summary.
- `agentapi` (`~/.gemini/antigravity/bin/agentapi.bat`) has only
  `get-conversation-metadata`, `new-conversation`, `send-message` — no quota
  command. The language server call is the only route.

Verified response shape (real answer, redacted of nothing — it carries no
account identifier):

```json
{"response":{"groups":[{"displayName":"Gemini Models",
 "description":"Models within this group: Gemini Flash, Gemini Pro",
 "buckets":[{"bucketId":"gemini-weekly","displayName":"Weekly Limit Remaining",
  "description":"You have used some of your weekly limit, it will fully refresh in 6 days, 23 hours.",
  "window":"weekly","remainingFraction":0.8938016,"resetTime":"2026-09-15T23:23:14Z"}]},
 {"displayName":"Claude and GPT models","buckets":[{"bucketId":"3p-weekly",
  "displayName":"Weekly Limit Remaining","window":"weekly","remainingFraction":1,
  "resetTime":"2026-09-15T23:55:15Z"}]}],
 "description":"Within each group, models share a weekly limit..."}}
```

Discovery on Windows is one `powershell.exe -NoProfile -NonInteractive -Command`
child combining `Get-CimInstance Win32_Process -Filter "Name='language_server.exe'"`
(for the command line, hence the token) with `Get-NetTCPConnection -State Listen`
filtered by `OwningProcess` (for the ports). POSIX fallback is `ps -eo pid=,args='`
plus `lsof -nP -a -p <pid> -iTCP -sTCP:LISTEN`. A working prototype of exactly
this ran green and is at
`~\AppData\Local\Temp\claude\C--Users-ndi2-Documents-claudecode\ab46b39b-b192-4374-b7bf-198622f84a5f\scratchpad\probe-antigravity.mjs`
(scratchpad — copy anything still wanted before it is cleaned up).

Unlike the Claude reader, this call is free and starts no model turn, so
polling on a timer is acceptable (300000 ms, matching Codex).

## State as of the handoff (2026-09-08 17:30)

GPT-6 took this over in the same checkout and has landed far more than the
three files Claude Opus 5 left. `packages/quota/quota-antigravity/` now holds
README.md, package.json, tsconfig.json, src/{index.ts,invariant.ts,reading.ts},
tests/ and a built lib/; `packages/client/ui-antigravity-quota/` exists with
the same shape plus tsdown.config.ts. The bundle registration files
(`packages/bundle/base/*`, `packages/bundle/web-app/*`, `tsconfig.host.json`,
`tsconfig.client.json`, `scripts/verify-package-readme-model-experience.ts`)
are modified and uncommitted, alongside unrelated council work
(`src/research-seats.ts`, `capacity.ts`, `seats.ts`, `council.ts`).

`reading.ts` is Claude Opus 5's file, adopted and tightened by GPT-6: `tokenOf`
now also requires `antigravity` in the command line, and the port and pid
checks demand integers. Nothing is committed. Whether it typechecks, tests
green or boots was not verified by Claude Opus 5.

## What is left (verify before assuming any of it is undone)

1. Confirm the host `index.ts`, `invariant.ts`, README "Model Experience"
   section and tests match the quota-codex shapes, and that
   `scripts/verify-package-readme-model-experience.ts` carries entries for both
   new packages.
2. Confirm the panel registers on slot `sidebar.region.action` with id
   `antigravity-quota` and an order above codex (-1) and claude (0).
3. Profile symlinks — see [[project_dsh_profile_plugin_install]]; without them
   a green build still boots without the plugin.
4. Build and boot check per [[dsh-harness-gotchas]] (`--dsw-alias-*` CSS
   tokens, `inject` as an array, host `apply()` even for a client-only package).
5. Commit locally only. [[no-live-git-pushes]].

## Coordination

Three agents were in this checkout at once. The peer session "Antigravity CLI
headless integration" (`local_7c5981c4-9249-480d-91f0-9112a88e5cf9`, Claude
Opus 5) owns only
`packages/council/tool-council/bin/agy-headless.mjs` and does not touch quota
or bundle files. It confirmed independently: there is no headless quota
command, and there is no credential file to read — a second language server
started with the IDE's own argv returns `UNAUTHENTICATED (code 401)`, because
the OAuth session belongs to the running IDE's process. Attaching to the
running server, as `reading.ts` does, is the only route. Its driver also found
that only one of the two loopback ports speaks gRPC (the other fails with
`error reading server preface: EOF`), and that `agentapi` calls need
`ANTIGRAVITY_PROJECT_ID` (`outside-of-project` works).

GPT-6 is the third agent and currently holds this work.

See [[dsh-harness-gotchas]], [[project_dsh_profile_plugin_install]],
[[no-live-git-pushes]].

## The two refresh bugs, and how they were actually shaped

Found and fixed 2026-09-09 by Claude Opus 5 (session claudecode-c7), by
instrumenting rather than reasoning:

1. **A race on `scope.watch((next, prev) => ...)`, not a constant failure.** An
   earlier reading of this — recorded here and then corrected — claimed `prev`
   never carries the pre-update value. It does, once the settings scope has
   quiesced: instrumented, quota-codex's watcher saw `{ next: 1, prev: 0 }`.
   `prev` is unreliable only when the update lands among those a running read is
   already publishing, where it arrives as `{ next: 1, prev: 1 }` and the rising
   edge is lost. So the refresh button fails only for a click made while a read
   is in flight — the state the panel is in right after the sidebar loads. Fix:
   remember the last value acted on in a closure instead of trusting `prev`.
2. **A dropped click.** `if (pending) return` discarded a request made while the
   boot read was still settling, with no feedback. Fix: queue one pending
   request and serve it in the `.finally`, so reads stay serial without losing a
   click.

Both fixes are in **both** `packages/quota/quota-antigravity/src/index.ts` and
`packages/quota/quota-codex/src/index.ts`.

**The test lesson is the durable part.** The first quota-codex composition spec
passed against the unfixed source, because it let the boot read settle before
requesting a refresh and so exercised the path that already worked. A test that
passes on broken code proves nothing. Both packages now hold the boot read open
on a deferred promise and request the refresh while it is in flight; each was
shown red against HEAD (`expected "vi.fn()" to be called 2 times, but got 1
times`) and green with the fix.

**Composition specs write real files.** `FileSettingsProvider` resolves a
relative path against the process working directory, not the loader's
`baseUrl`, so a fixture naming a bare `settings.yaml` left one in the repository
root on every run. Write the config per-test with an absolute path, as
`packages/settings/settings-file/tests/loader-composition.spec.ts` does.

Verified by claudecode-c7 after both fixes: typecheck exit 0; `tool-council` +
`ui-council-budget` + `quota` + `ui-antigravity-quota` at 38 files / 471 tests,
0 failures, three consecutive runs, repository root clean.

## State — 2026-09-11, whole pool combined + Antigravity as a model (Claude Opus 5, claudecode-b7)

Done at the user's request, coordinated with claudecode-a6 (seat pool owner),
who confirmed the pool finished and supplied the per-seat reading spec.

- **Reader** `quota-antigravity/src/pool.ts`: registry `~/.dsh/antigravity/accounts.json`
  (BOM-safe, re-read every refresh), newest `<geminiDir>/antigravity/daemon/ls_*.json`,
  pid liveness, then `RetrieveUserQuotaSummary` + `GetUserStatus` on each port over plain
  HTTP. States `ok | signed-out | down | error`. Leases and `parked.json` are read, never
  swept. Seats are never started; token files are never opened.
- **Combined figure**: per bucket, Σ(tier weight × remaining%) ÷ Σ weight over distinct
  accounts (email de-dupes in memory only, never published); soonest reset. Weights match
  the router: free/Plus 1, Pro 4, Ultra 16, registry `weight` overrides. Published as
  `bucketsJson`; rows as `seatsJson`. First live read: 97.6 / 0.3 / 92.6 → 63.5%.
- **Conflict fixed**: `tokenOf` now skips command lines carrying `--gemini_dir`, so a
  pool seat's server is never reported as the IDE.
- **Panel**: trigger shows combined `gemini-weekly`; panel lists combined buckets, then
  one row per account with tier, runs in flight, parking and refill countdowns.
- **Model route** `packages/llm/llm-antigravity` (provider `antigravity`, models
  `flash_lite | flash | pro`): spawns `node ~/.dsh/bin/agy-headless.mjs --json` with the
  prompt on stdin, so the same pool serves it. That one registration makes Antigravity
  selectable in the `/model` popup, composer selector, Settings › Models,
  `agent-default-model` and subagent `agentOptions`. Council and swarm already had the
  `agy-*` seats. Text only; prompt fitted to 28000 chars (driver ceiling 30000 minus the
  1100-char `shared` preamble): system ≤ half, newest turns kept, omission marker.
- **Proof**: vitest 37/37; whole-tree typecheck exit 0; live adapter turn "ANTIGRAVITY
  ROUTE OK" in 7.7s; isolated boot (`DSH_HOME` = temp dir with a `profiles` junction,
  `web --port 3197`) listed Antigravity in Settings › Models and rendered the combined
  panel with all three seats.
- **Deploy facts**: profile junction `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-llm-antigravity`
  created. `apps/web` rebuilt and the panel's `lib/client.js` rebuilt. The user's running
  DSH (port 3080) still runs the old host code until restarted.
- **Not done**: web-search lanes (`web-search-cli` DEFAULT_LANES) have no Antigravity
  lane — a lanes dict replaces the defaults wholesale, so adding one is a config-shape
  change, left for a decision. `3p-weekly` stays unreachable headlessly.
