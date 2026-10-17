# HANDOFF — Antigravity seat pool

Written 2026-09-10 by Claude Opus 5 at 93% quota, for a fresh session to pick up
cheaply. Read this file first, then `project_antigravity_seat_pool.md` in the
same directory for the evidence and gotchas. Do not re-derive anything below.

## What this is

Several Google accounts on one machine, each holding its own Antigravity quota,
handing off automatically as accounts drain. A team working shifts on one box,
not one person's accounts. The user is moving to a 128 GB machine, so the target
is a hot pool with parallel fan-out — not sequential hand-off.

## Where it stands

Committed locally on `feat/heterogeneous-teammates` in `deepseek-harness` as
`0a372eede1`, hooks clean, tree clean, **nothing pushed**.

- `packages/council/tool-council/bin/agy-profile.mjs` — seat manager.
  Commands: `add`, `login`, `start`, `stop`, `status`, `list`, `remove`.
- `packages/council/tool-council/tests/agy-profile.test.mjs` — 11 tests,
  `node --test`, green.

Proven: standalone `language_server.exe` self-authenticates (no Electron IDE,
~178 MB per seat), `agentapi` conversations work against it, sessions persist
across restarts, and per-seat `HOME` isolates the Google account.

Three seats registered — `seat1`, `gone1`, `fam1` — all **stopped and
signed-out**. Their earlier logins predate the isolation fix and do not carry
over.

## Start here — Step 1, then stop

The user runs this themselves, in their own terminal tab:

```
node "~/Documents/claudecode/deepseek-harness/packages/council/tool-council/bin/agy-profile.mjs" login seat1
```

A clean browser window opens on the Google consent screen. They sign in as one
account, paste the code at `Enter the authorization code:`, then Ctrl-C.

When they say it is done, run:

```
node ".../agy-profile.mjs" start seat1
node ".../agy-profile.mjs" status
```

Confirm the email and `userTier.id`, report them in one or two lines, and
**stop**. Then Step 2 (`login gone1`), Step 3 (`login fam1`), and so on — the
full seven-step runbook is at the end of
`project_antigravity_seat_pool.md`.

## Rules for whoever resumes

- **One step, then wait.** The user is managing cost; session length drives it
  far more than question difficulty. Do not run ahead.
- **Never attempt a seat login yourself.** It is the user's Google account and
  their authorization code. Your job starts after they say done.
- Each seat must use a **different** Google account. `status` prints a warning
  when two seats share one; treat that warning as a failed step, not noise.
- Commit locally only. Never push. See `no-live-git-pushes.md`.
- Terse replies; the user prefers caveman style. Memory files, commits and
  anything else persisted outside chat stay in normal prose.

## After the logins

Steps 4–7: measure concurrent conversations per seat (this sizes the router),
build the router (lease by tier weight × `remainingFraction`, park on
`resetTime`, replay the prompt on hand-off, lease API shaped for parallel
fan-out), register the pool in `src/seats.ts`, then extend
`packages/client/ui-antigravity-quota` to a row per seat.

Largest unclaimed resource, worth raising once the pool works: the `3p-weekly`
bucket (Claude Opus, Claude Sonnet, GPT-OSS) is unreachable through `agentapi`,
which resolves only `flash_lite`, `flash` and `pro`. That is roughly half of
every account's entitlement sitting idle.
