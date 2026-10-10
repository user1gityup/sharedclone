---
name: handoff-2026-09-23-0200-dsh-fix-plan-decisions
description: User-chosen solutions for the five remaining DSH fixes (relay watchdog, fix 2 permission, fix 3 scope, restart timing, shared-tree commits) and the step-by-step plan that starts from them
metadata:
  type: project
---

- Handoff id: handoff-2026-09-23-0200-dsh-fix-plan-decisions
- Created: 2026-09-23 02:00 PDT, at a FINISH-NOW checkpoint (202k context). Keep this id on later updates.
- Host: vmixlaptop2x6 (= "ndi2"). Session 53f13289-907a-42d4-a71c-4e463c1f8cd7. Model: Claude Opus 5.
- Repo: ~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates, HEAD **b30faedab2** (1 ahead of origin, never pushed).
- Parent note (all evidence and history): [[handoff-2026-09-22-1738-dsh-build-sync-agy-pool-openrouter]]. This note supersedes its "exact next action" list.
- Collaborators: the swarm-seam session `local_ff470bfb` ("Swarm council fixes") is **live again** in the same checkout, writing its own tests. The vmixer2o2 install-sync session is reachable only through the brain ([[handoff-2026-09-23-0021-dsh-install-sync-check]]); ndi2's Remote Control has been denied three times.

## Exact ask

User's words: "make me a step by step list of your fixes one question at a time and i select the answer you need to propose solutions for me to chooser from for each reamining fix and then creata a handoff and we make the solutions the starting point of that handoff".

So: options were put to the user one at a time, the user chose, and the chosen solutions below are the operative starting point. **Do not re-litigate them and do not re-ask.**

## THE STARTING POINT - five decisions, made by the user 2026-09-23 ~01:50 PDT

| # | Question | **User's choice** | What it rules out |
|---|---|---|---|
| 1 | The relay died at 21:28 and nothing brought it back | **Watchdog + find the cause** | not watchdog-only, not investigate-only, not leave-it |
| 2 | Fix 2's credential read is refused by the classifier even with the user's go | **Add a narrow permission rule**, exact rule shown to the user before it goes in | not building blind, not footer-only, not dropping fix 2 |
| 3 | How far to take fix 3 (host-side OpenRouter balance) | **Finish all of it** - publisher tests + both client edits | not monitor-only, not publisher-only, not pausing |
| 4 | When to rebuild and restart DSH for fix 1 | **Now, then again later** - two restarts accepted | not one combined restart, not leaving the host alone |
| 5 | The checkout shared with the live swarm-seam session | **Commit mine path-scoped, leave theirs** | not a separate worktree, not waiting for them |

## Step-by-step plan that follows from those choices

### Step 1 - rebuild + restart DSH now (decision 4)

Fix 1 is committed but the running host serves the pre-fix compiled panel (`ui-antigravity-quota/lib/**` is gitignored build output).

- Rebuild the client bundle, then `Start-Process launch-dsh.cmd` - **never pipe launch-dsh through Bash**.
- Verify: :3080 answers 200, and the Antigravity panel shows a **per-bucket** chip. Live parked.json already has seat4 in the new shape (`{"seat4":{"3p-weekly":{...}}}`), so the chip should read `3p-weekly parked ...` while seat4 stays usable for Gemini.
- Backup of the pre-edit parked.json: scratchpad `parked.json.bak` (session 53f13289).

### Step 2 - relay watchdog + root cause (decision 1)

- **Cause first, cheaply**: Windows event log around **2026-09-22 21:28** local, plus `~/.dsh/openrouter-proxy.stderr.log` (its last line is a normal 5-minute model poll, so it died without logging an error - look for an external kill, a reboot, or a parent-process exit).
- **Watchdog**: follow the pattern already on this box - `~/.dsh/fcc-monitor.log` and `~/.dsh/cluster-monitor.log` show monitors already run here; reuse that shape rather than inventing one. The relay's own control surface is `~/.dsh/openrouter-control.ps1` with `start|stop|status|restart|reload`; `restart` leaves a healthy proxy alone, so it is safe to call on a timer.
- Proven facts, do not re-derive: the thing on 8080 is the **python "OpenRouter Free" proxy** under `~\Documents\Harness Build`, not `openrouter-relay.mjs` (that only writes config and seals tokens). Config: mode lan, bind 0.0.0.0:8080, `trustLoopback: true`, allow-list `10.0.0.244`.
- Verify: kill the proxy deliberately once and confirm the watchdog restores it, then confirm `/health` 200 on both 127.0.0.1 and 10.0.0.241.

### Step 3 - finish fix 3 (decision 3)

Publisher `packages/council/tool-council/src/openrouter-balance.ts` exists and is wired into `index.ts` (imports, 8 Config fields + schema rows, `budgetScope` cast widened to `SettingsScope<BudgetFields & OpenRouterBalanceFields>`, `ctx.effect` beside the cheaperinference one). **Never typechecked, no tests, never run live.**

1. `npm run typecheck` - the wiring has never been typechecked. Do this first.
2. `packages/council/tool-council/tests/openrouter-balance.spec.ts` - copy the shape of `tests/cheaperinference-budget.spec.ts`: its `stubFetch`, its `host()` settings double with `emit`/`watch`, and its `settle()` poll helper are exactly what this needs. Cover: `normalizeRelayBase` dropping a trailing `/v1`; `resolveBalanceSource` preferring a raw key and falling back to relay base + token, and omitting the bearer entirely when no token (a loopback relay trusts its caller); `readCredits` parsing `{data:{total_credits,total_usage}}` and returning undefined on non-ok; `balancePatch` writing nothing but `state: 'failed'` on a failed read and always stamping `capturedAt` on success; the publisher's boot read, its rising-edge Refresh, and silence when neither key nor relay resolves.
3. Client edit A: `CouncilBudget.tsx:120-133` returns early when `localStorage['dsh:openrouter-monitor:api-key']` is absent - that early return is where the `section['openRouterRemainingUsd']` fallback goes.
4. Client edit B: `packages/client/ui-openrouter-monitor/src/client/index.ts:21` injects only `{ sessions }`; add `'settingsScope'` and the same bind `ui-council-budget/src/client/index.ts:65-70` uses (`namespace: 'council'`), plus `import type {} from '@deepseek-ai/dsh-client-ui-settings/client'`. `OpenRouterMonitor.tsx` takes a `settings` prop and uses the host figure when `status === 'no-key'` (that state already exists at `:67`).
5. Verify live in a browser profile that has **no** key (e.g. Chrome Profile 1) at :3080 - the balance must show. Known-good figures to expect right now: $17.00 purchased, $11.674 used, **$5.33 remaining**.

### Step 4 - restart DSH again (decision 4, second restart)

Same as step 1. Verify the OpenRouter monitor and CouncilBudget both show the balance with no browser key.

### Step 5 - fix 2, starting with the permission rule (decision 2)

1. **Draft the Bash allow rule and show the user the exact text before adding it.** Scope it to those two paths only: `~/.claude/.credentials.json` and `~/.claude-work/.credentials.json`. It is a security setting - the user approves the wording. The `update-config` skill covers settings.json edits.
2. Then the read that has been refused three times: field **names** plus `expiresAt` only, never values. Confirm whether `refreshToken` exists and whether the work token is actually expired.
3. Then the refresh in `packages/quota/quota-claude/src/reading.ts:249-285` (`readUsageApi` returns undefined on *any* non-ok, so a 401 is today indistinguishable from a rate limit) and `index.ts` `publishWork`. There is **no OAuth refresh code anywhere in the repo** - this is written from scratch.
4. Independent and free, do it regardless: surface `workCapturedAt` in the `ClaudeQuota.tsx` footer so a frozen reading is visible. `publishableWork()` (`index.ts:175-185`) already publishes the field.
5. Verify: `workCapturedAt` advances in `~/.dsh/settings.yaml` after a DSH restart.

### Step 6 - commits (decision 5)

- Commit **path-scoped, mine only**, as each fix finishes. Never `git add -A`, never touch `src/candidate-submit.ts`, `src/submit-work.ts`, `tests/candidate-submit.spec.ts`, `tests/swarm-submit.spec.ts` or the other session's part of `src/index.ts`.
- `queue-build.mjs` needs a clean checkout, so **queueing waits** until the seam session commits. **No push**, ever, without the user saying the session is ending.

## Already resolved - do not redo

- **Fix 1 (per-bucket seat parking): DONE**, live-proven, committed `b30faedab2` (7 files, +158/-34, lefthook green). seat4 ranks first for `flash` at score 1 and is still skipped for a 3p model.
- **Relay outage: FIXED.** It was down from 2026-09-22 21:28 to 01:30 PDT; restarted via `openrouter-control.ps1 restart`; verified 0.0.0.0:8080 listening (pid 20492), `/health` 200 loopback and LAN, `/openrouter/v1/credits` 200, and live completions 200 on both `/v1` (free model) and `/openrouter/v1` (`deepseek/deepseek-chat`, DeepInfra).
- **vmixer2o2's relay token is accepted: PROVEN** from ndi2's access log - 401 on its three unauthenticated calls, **200 OK x4** on authenticated `POST /openrouter/v1/chat/completions` from `10.0.0.244`. The peer's probe is closed; it has been told so in its own note.
- **Fix 4 (copying 4 Antigravity seats to vmixer2o2): DEFERRED** by the user. Do not start it.

## Permissions

- `set_session_remote_control`: **DENIED three times** by the auto-mode classifier. Requested, not skipped.
- `[Credential Exploration]`: the two-file read is **still refused even after the user said go** - a chat approval does not lift a harness classifier. Step 5.1 is the route through it.
- Everything else needed this session was allowed.

## Do not

Push. Commit another owner's files. Queue while the tree is mixed. Start fix 4. Log in Antigravity seats. Pull FCC. Print secrets. Retry the credential read before the rule exists. Re-derive the relay base (`http://127.0.0.1:8080` here, `10.0.0.241:8080` from vmixer2o2) or the bucket names (`gemini-weekly`, `3p-weekly`). Re-run the parking live proof.

## Session 2 - resumed 2026-09-23 04:15 PDT (Claude Opus 5)

- Host vmixlaptop2x6 (ndi2). Session `52a4e6c3-f64b-4423-ad0c-81b229cca2e5`. Remote Control: not requested yet this leg.
- Ask: user typed `handoff-2026-09-23-0200-dsh-fix-plan-decisions.md resume`. The five decisions above stand; working the plan in order.

### Verified against live state (do not re-derive)

- HEAD is now **d3f1f37e11** - the swarm-seam session committed its work; **2 ahead of origin**, never pushed.
- Working tree: `M packages/council/tool-council/src/index.ts` (mine, fix 3 wiring - diff confirmed to be only the OpenRouter balance additions), `?? packages/council/tool-council/src/openrouter-balance.ts` (mine), `?? packages/council/tool-council/tests/pipeline-advance-to-swarm.spec.ts` (**the seam session's, not mine - never commit it**).
- **Step 3.1 DONE: `npm run typecheck` EXIT=0.** The fix 3 wiring typechecks.
- parked.json lives at **`~/.dsh/antigravity/parked.json`**, not `~/.dsh/parked.json`. seat4 already in per-bucket shape (`3p-weekly` until 2026-09-24T03:16:28Z); seat1/gone1/fam1 still whole-seat parked.
- `~/.dsh/.built-commit` = **333073034d** - the running DSH (pid 9092, started 2026-09-22 02:18) is two commits stale, so fix 1 is not live yet. `npm run build` started in background.
- Relay is **UP**: :8080 `/health` 200 on 127.0.0.1 and on 10.0.0.241.
- **New evidence for step 2:** `openrouter-proxy.stderr.log` shows a fresh startup sequence at **2026-09-23 03:39:20** (pid 20492), with no 5-minute model polls logged between 01:30 and 03:39. So the relay went down (or was restarted) a **second** time after the 01:30 fix. Being run down now.

### Session 2 progress - updated 2026-09-23 04:25 PDT (FINISH-NOW at 150k)

**Step 1 - DONE.** Full rebuild `npm run build` EXIT=0. Stopped the stale host (pids 31216 monitor, 9092 web) and started `launch-dsh.cmd` via Start-Process. New pids: monitor **31588**, web **22988** (04:19:13). :3080 answers **200**. FCC came back with it (it had been down since 04:26Z with recovery exhausted). **Not yet eyeballed: the per-bucket chip in the Antigravity panel** - that visual check is still owed.

**Step 2 - ROOT CAUSE FOUND AND FIXED IN CODE, not yet proven live.**

Cause, from `~/.dsh/fcc-monitor.log` (UTC in that log; PDT = UTC-7):

1. `createMonitor` in `~/.dsh/fcc-session.cjs:6` counted recovery attempts **for the life of the host, never resetting on success**. Attempt 1/3 fired 2026-09-22 09:58 PDT and succeeded. At 21:25 PDT attempt 2/3, at 21:28 attempt 3/3, then `Automatic recovery stopped after three attempts.` - the watchdog disabled itself permanently while the relay was down. That is exactly "nothing brought it back". `fcc-status.json` and `openrouter-status.json` both still read `recoveryAttempts: 3` before the restart, and FCC had been dead since 04:26Z for the same reason.
2. The third attempt also failed on its own: `openrouter-control.ps1` `Start-Proxy` refused with "port 8080 is occupied but readiness failed" **before** it ever called `Stop-Owned`. A hung proxy keeps the port bound while health fails, so the restart path could never reclaim it.

Fixes applied (both in `~/.dsh`, backups `fcc-session.cjs.bak-20260923-watchdog` and `openrouter-control.ps1.bak-20260923-watchdog`; **neither file is in the repo or in the brain's `.sync`, and `brain-sync.mjs` only rewrites the launch line in `launch-dsh.cmd`, not these bodies** - verified, so they will not be reverted):

- `fcc-session.cjs`: `if (ready) attempts = 0` after the plain check, making the budget three **consecutive** failures; message reworded to match. `node --check` OK.
- `openrouter-control.ps1`: when the port is occupied but not ready, `try { Stop-Owned } catch {...}`, sleep 2s, re-test, and only then refuse. Ownership is still start-time matched, so a foreign process on 8080 is left alone. PowerShell parse OK.

**These are in the files but NOT in the running monitor** - pid 31588 loaded the pre-patch `fcc-session.cjs` at 04:18:55. They go live at the step-4 restart. **Still owed: the deliberate kill test** (kill the proxy, confirm the watchdog restores it, `/health` 200 on 127.0.0.1 and 10.0.0.241).

Useful fact found: `openrouter-owned.json` records pid **30648**, which is the python **parent** of the listening pid 20492 - the marker is correct, and `taskkill /T` reaches the listener.

**Step 3 - two of five parts done.**

- 3.1 `npm run typecheck` **EXIT=0**.
- 3.2 `packages/council/tool-council/tests/openrouter-balance.spec.ts` written and **22/22 green** (`npx vitest run` EXIT=0, 1.34s). Covers normalizeRelayBase, resolveBalanceSource (key preference, relay fallback, env base, no-token omission, nothing-resolves), readCredits (parse, no-auth-header, non-ok, bad shape, throw), balancePatch (failed-state, capturedAt stamp, deadband) and the publisher (boot read, relay read, rising-edge Refresh, flat Refresh ignored, silence with no source, figures kept on failure).
- 3.3 client edit A (`CouncilBudget.tsx:120-133`) - **not started**.
- 3.4 client edit B (`ui-openrouter-monitor`) - **not started**.
- 3.5 live no-key browser check - **not started**.

**Steps 4, 5, 6 - not started.** No commits made this leg. Nothing pushed.

### Working tree right now

- `M packages/council/tool-council/src/index.ts` (mine)
- `?? packages/council/tool-council/src/openrouter-balance.ts` (mine)
- `?? packages/council/tool-council/tests/openrouter-balance.spec.ts` (mine, new this leg)
- `?? packages/council/tool-council/tests/pipeline-advance-to-swarm.spec.ts` (**the seam session's - never add it**)

### Exact next action

Client edit A, then B (step 3.3/3.4), then the step-4 restart, which also puts the watchdog fixes live; prove the watchdog with a deliberate kill; then step 5's permission-rule draft for the user. Commit path-scoped only, three paths: `src/index.ts`, `src/openrouter-balance.ts`, `tests/openrouter-balance.spec.ts`.

### Session 3 - updated 2026-09-23 10:30 PDT (FINISH-NOW at 212k) - Claude Opus 5

Host vmixlaptop2x6 (ndi2), session `52a4e6c3-f64b-4423-ad0c-81b229cca2e5`, repo
~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates.
User's ask this leg: "please complete" - finish the remaining plan steps.

**Ownership changed under this session.** While it was away, the peer session
"Swarm readiness gate commerce fixes [24fdb9]" committed and pushed everything
this note listed as uncommitted, on the user's instruction, and the user then
asked that **one session own all DSH repo work**. That session now holds the
repo and the note tracking DSH state is
[[handoff-2026-09-22-2130-dsh-swarm-readiness-gate-commerce]]. Verified live
here: **HEAD a76b10d837, working tree CLEAN, 1 ahead of origin**
(origin = 2355728cd5; the one local commit is the deliberately red
advanceToSwarm spec). Nothing of this session's work was lost.

Where this session's work landed:
- `6ad3ae7abb` - the balance publisher spec (22/22).
- `6761f2ac5c` - openrouter-balance.ts + the 5 index.ts hunks.
- `2355728cd5` - the 8 client files: ui-claude-quota `ClaudeQuota.tsx` and
  `.module.css`, ui-council-budget `CouncilBudget.tsx`, ui-openrouter-monitor
  `package.json` / `index.ts` / `OpenRouterMonitor.tsx` / `locales.ts`,
  plus pnpm-lock.yaml.

**Step 3 / decision 3: DONE and shipped. Strike it from the plan.** Evidence:
`npm run typecheck` EXIT=0 twice (once after the publisher wiring, once after
the client edits); the publisher spec 22/22; `npm run build` EXIT=0 twice.

**Step 1 and step 4 (decision 4, both restarts): DONE.** Rebuilt and restarted
twice via `Start-Process launch-dsh.cmd`. Live now: :3080 **200**, monitor pid
23004, DSH pid 8888, relay `/health` **200**. The Antigravity per-bucket chip
was still never eyeballed in the browser - the only piece of step 1 left.

**Step 2 (decision 1): cause found AND the counter fix live-proven.**

- Cause 1, the real one: `createMonitor` in `~/.dsh/fcc-session.cjs:6` counted
  recoveries **for the life of the host and never reset them on success**.
  Attempt 1/3 fired 09-22 09:58 PDT and succeeded; 2/3 at 21:25 and 3/3 at
  21:28 disabled recovery permanently. FCC was dead the same way.
- Cause 2: `openrouter-control.ps1` `Start-Proxy` refused an occupied port
  **before** it ever called `Stop-Owned`, so a hung-but-bound proxy could never
  be reclaimed.
- Both patched in `~/.dsh` (backups `*.bak-20260923-watchdog`). Neither file is
  in the repo or the brain's `.sync`, and `brain-sync.mjs` only rewrites the
  launch line in `launch-dsh.cmd` - **verified, so these will not be reverted**.
  These are machine config, **not** repo work, so the single-owner rule above
  does not cover them.
- **Live proof of the counter fix:** killed the proxy tree deliberately
  (owner pid 30648, child 20492) at 09:02:56. Log shows
  `OpenRouter Free unavailable; recovery 1/3` then ready again inside ~20s, and
  `~/.dsh/openrouter-status.json` then read **`recoveryAttempts: 0`** - the
  reset the old code never did. Still reads 0 now.
- **Not proven:** the occupied-port reclaim. The test was to suspend the python
  proxy (NtSuspendProcess) to make it hung-but-bound and watch `Stop-Owned`
  reclaim it; the user interrupted that call, so **it never ran** and the relay
  was never suspended. That patch is code-reviewed and parse-checked only.

**Step 5.4, free and independent: DONE and shipped.** `workCapturedAt` now has
its own stamp on the work-account section head in `ClaudeQuota.tsx`, with new
`.sectionHeadRow` / `.headStamp` CSS. **This introduced a known-red test**, on
origin knowingly: ui-theme "every sheet that scrolls on an elevated surface
rebinds" - `ClaudeQuota.module.css` scrolls on an elevated surface without
rebinding `--dsw-alias-bg-layer-2` and `-3`. **That is this session's to fix
and it is the first thing to do.** Separately, five ui-sidebar failures are
pre-existing and not ours.

**Step 5.1-5.3 (fix 2): still blocked, and correctly so.** The narrow Bash
permission rule has not been drafted for the user yet. Two peers have now had
`[Credential Exploration]` denied; one explicitly asked this session not to run
those reads on its behalf, which is right - a denial in one session must not be
laundered through another. The credential read stays blocked until the user
approves a rule in their own settings.

**Do not re-run:** the full `vitest run packages/quota packages/client` sweep -
it is non-deterministic under load (13 failures one run, 8 the next, same
tree) and costs 4-7 minutes. Run the specific files instead (~28s). Three
`seats.spec.ts` failures seen this leg were load-induced: the file passes 13/13
when run alone.

**Exact next action:** (1) fix the ui-theme red test by rebinding
`--dsw-alias-bg-layer-2` and `-3` in `ClaudeQuota.module.css`, coordinating
with [24fdb9] before touching the repo; (2) draft the narrow credential
permission rule and put the exact text to the user; (3) if the hung-port patch
matters, run the suspend test with the user's go.

### Correction, 2026-09-23 10:45 PDT - the ui-theme red test is NOT from this session's change

`2355728cd5`'s commit message calls the failing `ui-theme > every sheet that
scrolls on an elevated surface rebinds` "this change's own defect". It is not.
Proven read-only, no checkout:

- `git show 2355728cd5 -- .../ClaudeQuota.module.css` - the whole change to that
  file is two new rules, `.sectionHeadRow` and `.headStamp`. Neither declares
  `overflow` nor any `--dsw-alias-bg-*` / `--dsw-specific-*` token, which are
  the only two things the check reads.
- `git show 6ad3ae7abb:.../ClaudeQuota.module.css` - at the parent commit
  `.panel` already had `overflow-y: auto` (line 35) on
  `background: var(--dsw-alias-bg-layer-2)` (line 36), with no
  `--dsh-scrollbar-*` rebind anywhere in the sheet.
- The sheet has been that way since it was created in `2c041a7fbc`; the spec
  has not changed since `3ef05f8a85`.

So it is pre-existing, same category as the five ui-sidebar failures - it merely
surfaced in the same run. The fix was still written here and handed to the repo
owner [24fdb9] as exact CSS rather than applied: two declarations at the top of
`.panel`, byte-identical to `CodexQuota.module.css:29-30`:

    --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
    --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);

Rebind only - the stamp does not need moving. `.panel` is the scroll container
and what the assertion names; `.sectionHead` does not scroll and carries no
surface token; `.track` is layer-3 but `overflow: hidden`, and the check is
sheet-level so one rebind clears the file.

### Resolved, 2026-09-23 11:00 PDT - scrollbar rebind landed as f55855f248

The repo owner [24fdb9] applied the CSS and, correctly, found the one-file
assumption in this session's handover was too narrow: the spec's loop reports
one sheet at a time, so clearing ClaudeQuota only moved the assertion to the
next offender. **Four** sheets needed the two lines, not one -
`ClaudeQuota.module.css`, `CouncilBudget.module.css`,
`PipelineControl.module.css`, `OpenRouterMonitor.module.css`.

Independently verified here, read-only: HEAD `63cb152916` (red advanceToSwarm
spec deliberately kept as the tip), `f55855f248` = exactly those 4 files, +2
lines each; all four now carry `--dsh-scrollbar-thumb` and
`--dsh-scrollbar-thumb-hover`; a sweep of `packages/client` for
`overflow(-y): auto|scroll` + `bg-layer-[23]` + no `dsh-scrollbar-thumb`
returns **nothing left**; working tree clean. Peer reports ui-theme plus the
three panel packages at 19 files / 132 tests green and typecheck exit 0; the
five ui-sidebar failures are unmoved.

The owner also re-proved the pre-existing claim the hard way - swapped the
parent's copy of the sheet into the worktree, saw the identical assertion fail,
restored it. So the correction above stands on two independent checks.

**Repo stays with [24fdb9]. Nothing here is uncommitted.** The only DSH work
still owned by this session is decision 1: the two `~/.dsh` watchdog patches,
whose counter half is live-proven and whose occupied-port half is still
unproven pending the user's go on the suspend test.

### DECISION 1 DONE - occupied-port half PROVEN LIVE, 2026-09-23 10:56 PDT

User gave the go ("coordinate with other agents and remote if needed to finish
your last task"); repo owner [24fdb9] was told before and after and stayed off
:8080 for the window. No vmixer2o2 session was reachable to warn (ListAgents
showed only the two local Claude Desktop peers), and the relay's stdout log
recorded no 10.0.0.244 traffic in the window, so nothing remote was interrupted.

**The test.** Suspended the python proxy tree with `NtSuspendProcess` - both the
owner parent (pid 25992) and the listening child (pid 30748) - producing the
exact hung-but-bound state that defeated the old code on 09-22 at 21:28: port
8080 still bound at 10:54:59, `/health` returning **000** after a 6s timeout.

**Result: PASS.** From `~/.dsh/fcc-monitor.log` (UTC; PDT = UTC-7):

    17:55:15.718Z  OpenRouter Free unavailable; recovery 1/3.
    17:55:27.601Z  [OpenRouter] Starting OpenRouter Free hidden (lan mode, 0.0.0.0:8080)
    17:55:33.543Z  [OpenRouter] OpenRouter Free ready (health verified).

The decisive line is the second one. Under the old code the run would have
stopped at `port 8080 is occupied but readiness failed` and returned false;
instead `Stop-Owned` was reached, killed the suspended tree, freed the port and
started a fresh proxy. Recovered **~34 s** after the suspend.

Verified after: old pids 25992 and 30748 both **gone**; new python **31608**
started 10:55:27; owner marker rewritten to pid 17524 with a new start-time
ticks value; `/health` **200** on 127.0.0.1 and on 10.0.0.241; and
`/openrouter/v1/credits` **200**, i.e. real work through the relay, not just a
liveness ping. `recoveryAttempts` read 1 at the recovery tick and **0** at the
next healthy tick (17:56:06Z) - the counter fix again, unprompted.

**So both halves of decision 1 are now live-proven** and the fix is complete:
the counter reset by the 09:02:56 kill test, the port reclaim by this one. The
patched wording is live too - the log now reads "Automatic recovery stopped
after 3 consecutive attempts."

### Separate live problem found while verifying: FCC (Free Claude) is DOWN

Not caused by this work and not in scope for it, but it is real and it is on
this machine now. `~/.dsh/fcc-status.json` reads `ready: false`,
`recoveryAttempts: 3` of 3; :8082 answers **000**. The monitor logged
`Free Claude unavailable: startup failed` at 16:12:58Z (09:12 PDT) after
`Stream was not readable` earlier. Note this is the patched budget behaving
correctly: three **consecutive** failures, so giving up is now legitimate rather
than the old lifetime-budget bug.

Confusing detail for whoever picks it up: `fcc-server.stderr.log` ends with
`Application startup complete` and `Admin UI: http://127.0.0.1:8082/admin`, and
the stdout log ends with healthy 200s - i.e. it came up and then went, or the
monitor's readiness probe (health **and model catalog**) failed on the catalog
rather than on health. Related prior note:
[[handoff-2026-09-18-2357-fix-free-claude-code-quota-stop]], which warned the
venv home repoint at C:/Python314 would break again on the next `uv sync`.
Nothing was changed about FCC here; it is reported, not touched.

### STEP 1 CLOSED - the per-bucket chip verified in the browser, 2026-09-23 11:00 PDT

The one piece of step 1 that had never been eyeballed is now done, read-only, no
rebuild needed: the running host is built from `b894fb8499`, which **does**
contain fix 1 (`b30faedab2`) - checked with `git merge-base --is-ancestor`.

Opened :3080 in the browser pane and read the Antigravity quota panel. It shows:

- `pool-seat4` - **"Google AI Plus - 3p-weekly parked 9h 17m"**: the chip names
  the bucket, which is the fix.
- The same seat's **Gemini Models: 100% left**, Claude and GPT models 0% left.
  That is the whole point of decision 1's sibling fix - seat4 is parked for the
  third-party bucket and **still usable for Gemini**, where the old whole-seat
  parking would have blocked both.
- The three legacy whole-seat entries render with no bucket name - "Google AI
  Plus - parked 1d 18h" (Shift A), "parked 7h 19m" (Google One) - so the
  legacy-shape mapping to bucket `*` is behaving too.

This matches `~/.dsh/antigravity/parked.json` exactly: seat4 per-bucket
(`3p-weekly`), seat1 / gone1 / fam1 still legacy whole-seat.

**Steps 1 and 4 (decision 4, "now, then again later") are both complete** - two
rebuild-and-restart cycles this session, at 04:19 and 09:01 PDT, each verified
at :3080 200. Nothing further is owed on decision 4.

One live fact for whoever rebuilds next: the running host at `b894fb8499`
**predates `f55855f248`**, so the four-sheet scrollbar rebind is on origin but
not in the running UI. A third rebuild would pick it up; it is cosmetic and was
not done here, and the repo owner [24fdb9] asked to be told before any rebuild.

### Standing state at close

- Decision 1: **DONE**, both halves live-proven.
- Decision 3 (fix 3): **DONE**, shipped on origin.
- Decision 4: **DONE**, both restarts.
- Decision 5/6 (path-scoped commits): moot - nothing of this session's is
  uncommitted; the repo owner committed it all.
- Decision 2 (fix 2): **OPEN, with the user.** The exact rule text and the
  helper script were put to them in chat, with the caveat that an allowlist
  entry probably will not lift an auto-mode `[Credential Exploration]`
  classifier. Nothing will be written until they accept.
- **FCC down** is recorded as item 12 in the coordination note, unowned, and is
  in front of the user. Not touched here.

### Item 7 fully closed - the headless drivers are already current, 2026-09-23 11:10 PDT

The coordination note's last open piece of item 7 was "`install-agy-headless.mjs`
has never been run, so `~/.dsh/bin` still carries whole-seat parking". **That is
stale.** Checked here, read-only:

- `scripts/install-agy-headless.mjs` writes exactly three things:
  `agy-headless.mjs`, `agy-profile.mjs` and `agy.cmd`.
- `~/.dsh/bin/agy-headless.mjs` is **byte-identical** (line endings aside) to
  `packages/council/tool-council/bin/agy-headless.mjs`, and
  `~/.dsh/bin/agy-profile.mjs` is identical to its source.
- The installed headless driver carries the per-bucket logic - 7 hits for
  `ALL_BUCKETS` / `bucketForModel`.
- `agy.cmd` is 44 bytes and matches the string the installer writes.

So running the installer would be a no-op. Something already refreshed
`~/.dsh/bin` (its agy-headless.mjs is dated 2026-09-22 18:47). Nothing to do.

### Step 3.5 CLOSED - the balance surface IS live-proven, 2026-09-23 11:15 PDT

The coordination note lists "the balance surface never run live" as open. It is
now closed, and it needed no rebuild: the running host `b894fb8499` already
contains both halves of fix 3 (`6761f2ac5c` host publisher, `2355728cd5` client),
and the browser pane is a fresh profile that has never had the key pasted into
it - exactly the no-key case step 3.5 called for.

Opened the OpenRouter Monitor at :3080. It reads:

    No OpenRouter key
    $5.33 - Reported by the host
    Configure an OpenRouter API key in Settings to see your balance.

That is the whole feature working end to end. **$5.33** is the known-good figure
($17.00 purchased - $11.674 used = $5.326, formatted to two places), so the host
read the account, published it to the council settings scope, and a browser
holding no credential rendered it. "Reported by the host" is the
`keyMissing.hostBalance` locale key added for this. No credential reached the
browser.

Not separately asserted: the CouncilBudget half. It reads the same
`openRouterRemainingUsd` field through the same settings scope and feeds it into
`project()`, so it has no distinctly labelled figure to point at; it typechecks
and is covered by the publisher spec, but the monitor is what is *proven*.

**So fix 3 / decision 3 is now complete end to end** - typechecked, spec 22/22,
committed, pushed, and live-proven in a no-key browser.

### User question 2026-09-23 12:10 PDT: "do i need to reboot the dsh on vmixer... so i can see the changes"

**A restart alone shows nothing.** Answered from the fleet status file rather
than by guessing, since vmixer2o2 is not reachable from here (ListAgents lists
only the two local Claude Desktop peers, and Remote Control to that host has
been denied repeatedly).

`shared-brain/fleet/status/vmixer2o2.json`, seen 2026-09-23 19:05Z:

- harness checkout: `head 333073034d`, **behind 6, ahead 0, state `dirty-behind`**
- its DSH build: also `333073034d` - build and checkout agree

Origin is now `f55855f248`, six commits ahead: `b30faedab2` (per-bucket parking),
`d3f1f37e11` (swarm seam), `6761f2ac5c` + `6ad3ae7abb` (balance publisher and
spec), `2355728cd5` (client balance UI), `f55855f248` (scrollbar rebind).

So a plain relaunch is a no-op there: `launch-dsh.cmd` runs `fleet.mjs build`,
which only rebuilds when HEAD has moved past `.built-commit`, and on vmixer2o2
those are the same commit. Nothing pulls, nothing rebuilds, the UI does not
change. It needs pull -> build -> relaunch, which is what `Desktop\UPDATE-DSH.cmd`
(from `.sync/UPDATE-DSH.ps1`) already does in one double-click.

**But that one click will stop, and this is the real blocker.**
`UPDATE-DSH.ps1:116` refuses a dirty checkout and prints the offending files.
Crucially both it and `fleet.mjs:248` compute dirt with
`git status --porcelain --untracked-files=no`, so **`dirty-behind` means
genuinely modified TRACKED files on vmixer2o2**, not stray untracked ones. Same
reason it has sat six behind: `fleet.mjs:249` skips the automatic fast-forward
for a follower whose tree is dirty.

What those modified files are cannot be seen from ndi2. Someone with eyes on
vmixer2o2 has to look at them and decide - commit, discard, or stash - before
the one click can run. Nothing here should guess on its behalf.

### vmixer2o2's dirty files IDENTIFIED, 2026-09-23 12:25 PDT - decision with the user

Remote Control was turned on for this session, which made two RC peers visible;
"Remote control on [7bda71]" = session `local_eb053f38` on **vmixer2o2**
(hostname confirmed, home ~). It ran the read-only diagnostics and
changed nothing - tree byte-identical afterwards.

Confirmed there: HEAD == `.built-commit` == `333073034d`, branch
feat/heterogeneous-teammates, upstream already fetched to `f55855f248`,
**6 behind / 0 ahead**, nothing staged. So the "a restart shows nothing" read of
that host was right.

**The two modified tracked files are not junk** - they are harness fixes (1)-(3)
from [[handoff-2026-09-18-0133-dsh-openrouter-key]], which that note records as
"awaits user go", uncommitted since 2026-09-21 22:13:

    M packages/council/tool-council/bin/agy-headless.mjs      (+58/-1)
    M packages/council/tool-council/tests/agy-headless.test.mjs (+21/-2)

1. `INLINE_FILE_CHARS = 6000` + `readForInline()` in `policyPreamble('shared')`:
   inlines CLAUDE.md, MEMORY.md and shared-agent-log.md into the preamble
   (log tail-first) instead of telling the seat to read them, each capped at
   6000 chars against the ~30000-char agentapi argv ceiling.
2. Exported `hasUnansweredToolCall(steps)` + a `waitForAnswer` branch throwing
   `SeatError('stalled', ...)` at `quietMs*4` - the fix for the Gemini seat
   hanging on an unanswered IDE `view_file` approval and having the 7-minute
   timeout mislabelled AUTH.
3. Two new tests covering both.

**Merge risk: none measured.** Of the six incoming commits only `b30faedab2`
touches these paths (+46/-7, `agy-headless.mjs` only; the test file is untouched
upstream). The peer extracted HEAD/origin/working-tree copies into its scratchpad
and ran `git merge-file -p` on each: **clean on both, zero conflict blocks**, and
it verified origin does **not** already carry this work (`hasUnansweredToolCall`
and `INLINE_FILE_CHARS` occur 0 times in origin's copy) - genuinely unpushed, not
a stale duplicate. Tests not run there; a node run was outside its read-only
mandate.

**Do not reach for a stash.** That host already carries `stash@{0}` (agy-profile
WIP, 2026-09-18) and `stash@{1}` (2026-09-15), both never reclaimed. A third
would bury live work rather than resolve it.

Options put to the user: (a) commit on vmixer2o2 then run UPDATE-DSH - preserves
the fix, clears `dirty-behind` so `fleet.mjs:249` stops skipping the host, merges
clean, local commit only with the push staying queued for the gatekeeper;
(b) stash then update; (c) leave it 6 behind. **Awaiting their word - nothing is
being done on that host meanwhile.**

### User's decision 2026-09-23 12:30 PDT: commit on vmixer2o2, then update

Option (a) chosen. Instruction sent to `local_eb053f38` on vmixer2o2.

**UPDATE-DSH cannot do this job, and that is the trap to avoid.**
`UPDATE-DSH.ps1:129` refuses a diverged checkout, so committing first makes it
6 behind / 1 ahead and the updater stops. Rebasing first makes it 0 behind /
1 ahead, which takes the "already at the remote" branch, leaves `$changed`
false and **never builds**. Either way the one-click updater is the wrong tool
here - it is the "needs a merge by an agent" case its own message names.

Sequence given, stop at the first failure: (1) run the agy-headless tests
**before** committing; (2) commit both files path-scoped, never `-A`, citing
handoff-2026-09-18-0133, with the Co-Authored-By line; (3)
`git rebase origin/feat/heterogeneous-teammates`, abort and report if it
conflicts; (4) **run the tests again** - `b30faedab2` also edits
`agy-headless.mjs` (+46/-7), so the rebase produces a combined file nobody has
tested; a clean merge is not a passing test; (5) check whether `pnpm-lock.yaml`
moved (`2355728cd5` touched it) and `pnpm install --frozen-lockfile` if so;
(6) stop DSH and `Start-Process` the launcher - `fleet.mjs build` rebuilds
because HEAD is past `.built-commit`, and `fleet.mjs:249` will not try to
fast-forward a host that is ahead.

**No push, and no push-requests.md entry either** - the harness repo's owner is
[24fdb9] on ndi2 and any push is the user's call on their session-ending cue.

Asked for back: both test runs, commit sha, rebase result, lockfile, build exit,
:3080, and whether the per-bucket chip and the host-reported balance render
there as they do here.

### Push ordering agreed with the branch owner, 2026-09-23 12:40 PDT

Not authorization - ordering for when the user releases the branch. It now
forks three ways: origin `f55855f248`, ndi2 **+1** (the deliberately red
advanceToSwarm spec, kept local), vmixer2o2 **+1** (its seat-stall commit, once
rebased). Only one can fast-forward.

1. **vmixer2o2 pushes first** - it rebases onto `f55855f248`, so it is a clean
   fast-forward.
2. [24fdb9] then rebases the red spec onto the new origin; one new test file,
   touching nothing vmixer2o2 edits.
3. Nothing leaves ndi2 ahead of that without telling vmixer2o2, or its rebase is
   wasted.

Relayed to vmixer2o2 over the Remote Control link, together with: **send the
post-rebase agy-headless test result either way, green or red.** `b30faedab2`
edits `agy-headless.mjs` (+46/-7) and so does the seat fix, so the rebase makes
a combined file nobody has run. A red there is a finding about `b30faedab2` -
already on origin and never live-proven on the headless path - as much as about
the seat fix, so it is to be reported, not smoothed over.

[24fdb9] independently confirmed the "unpushed, not a stale duplicate" finding:
`git grep` on origin returns 0 for `hasUnansweredToolCall` and 0 for
`INLINE_FILE_CHARS`.

### Unclaimed finding: the one-click updater cannot update a host that is ahead

`UPDATE-DSH.ps1` refuses a diverged checkout at :129, and for a checkout that is
ahead-but-not-behind it takes the "already at the remote" branch, leaves
`$changed` false and **never builds** - so the launcher it then starts serves the
old bundle. Any host carrying a local commit is therefore un-updatable by the
one click that exists for it. Nobody has claimed fixing this; it is on the
record as a finding, not as work in progress.

### vmixer2o2 sequence COMPLETE, and it found a real defect in fix 3 - 12:50 PDT

`local_eb053f38` on vmixer2o2 finished every step: tests **4/4 pre-commit**,
commit **a58cd3020a** (path-scoped, lefthook green), rebase clean onto
`f55855f248` -> **56f2eddbf7** (0 behind / 1 ahead, tree clean), tests **4/4
again post-rebase** on the combined `agy-headless.mjs` - so `b30faedab2` and the
seat fix coexist, which nobody had tested. `pnpm-lock.yaml` had moved, so
`pnpm install --frozen-lockfile` ran (exit 0) before the build. DSH rebuilt,
`.built-commit` advanced to `56f2eddbf7`, :3080 **200**, client header reads
`56f2edd`. FCC's python sits outside the killed tree, so the proxy never went
down. No push, no queue entry.

Antigravity: **per-bucket confirmed** - two buckets with separate reset timers
(Gemini and Claude/GPT). No parking chip can render there because both accounts
read "Not running" - the known sign-in gap from
[[handoff-2026-09-23-0021-dsh-install-sync-check]], not a build problem.

**THE FINDING - fix 3's relay path has never worked, and the bug is mine.**

The OpenRouter monitor there still reads "No OpenRouter key". Cause, traced by
that session rather than reported as a symptom: `resolveBalanceSource` takes the
relay root **only** from `openRouterRelayBase` in settings or the
`OPENROUTER_RELAY_BASE` env var. Neither is set on vmixer2o2, which by design
holds no raw key (removed when the relay went in) and carries only
`OPENROUTER_RELAY_TOKEN`. The relay root does exist in its `settings.yaml`, but
only as `llm-pi-ai.providers.openrouter.baseURL =
http://10.0.0.241:8080/openrouter/v1`, which the balance reader never consults.
Both sources empty -> nothing published -> the client fallback correctly shows
nothing. The route itself is live: `/credits` 401 (token-gated), `/health` 200.

So the module whose own header says the relay is "the only route a relay-only
machine has" does not work on the fleet's only relay-only machine. ndi2 shows
$5.33 because it takes path 1, the raw key. **The relay path was never exercised
anywhere** - my spec covers it only against a stub.

**And it is worse than a missing setting.** Verified here by running the
function's own logic:

    http://10.0.0.241:8080              -> .../openrouter/v1/credits          OK
    http://10.0.0.241:8080/v1           -> .../openrouter/v1/credits          OK
    http://10.0.0.241:8080/openrouter/v1 -> .../openrouter/openrouter/v1/credits  DOUBLED

`normalizeRelayBase` strips a trailing `/v1` only, so the relay's own provider
baseURL - the exact value the doc comment at `openrouter-balance.ts:64` invites
you to paste in whole - normalizes to `.../openrouter` and the built URL doubles
the segment. The spec has a case for `/v1` and none for `/openrouter/v1`. That
is a defect in my code and a hole in my own tests, found by a field test on
another machine.

Fix is small: strip `/openrouter/v1` before `/v1` in `normalizeRelayBase`, add
the spec case, and consider defaulting the relay base from the provider baseURL
so no relay-only host needs a second setting. **Nothing applied** - the repo
belongs to [24fdb9] and the user has not chosen.

### The patch for it, sent to the repo owner 2026-09-23 13:00 PDT

User chose the code fix. Exact patch handed to [24fdb9] rather than applied here
(it owns the checkout). In `normalizeRelayBase`, the final return becomes:

    return trimmed.replace(/\/openrouter\/v1$/, '').replace(/\/v1$/, '').replace(/\/openrouter$/, '')

Verified against every shape - bare root, `/v1`, `/openrouter/v1`, bare
`/openrouter`, trailing slashes, blank, undefined - all normalize to the right
root or to undefined. Plus one spec case in the `normalizeRelayBase` describe
covering `/openrouter/v1` and bare `/openrouter`.

**Deliberately NOT patched**, and flagged to the owner as its design call:
defaulting `openRouterRelayBase` from `llm-pi-ai.providers.openrouter.baseURL`
so no relay-only host needs a second setting. That couples the council tool to
another plugin's settings namespace, and the shape could not be tested from
here. Worth doing - otherwise every relay-only machine needs a config line
forever - but not something to smuggle in behind a one-line fix.

**Note for whoever closes this:** the patch alone does not make vmixer2o2 show a
balance. That host still needs `openRouterRelayBase: http://10.0.0.241:8080` in
its `settings.yaml`. The patch makes the setting *work*; it does not remove the
need for it. That host has not been asked to add it.

### SHIPPED: fix 3's relay path, commit 0d49b54f8b - 2026-09-23 13:20 PDT

User: "ship the correct code so we can close this move to other things".
[24fdb9] had already landed the one-liner as `87c53cad56`; this session took a
window with its agreement for the rest.

`0d49b54f8b fix(council): read the relay balance from the route already configured`
Three files, path-scoped, lefthook green (lint 7.25s, whitespace, vendor guard),
tree clean afterwards. **No push.**

- `openrouter-balance.ts`: `resolveBalanceSource` now resolves the relay root
  from three places, most explicit first - the council setting, then
  `OPENROUTER_RELAY_BASE`, then the OpenRouter route's own `baseURL`. New
  exported `providerBaseFrom(section: unknown)` does the narrowing, so the
  module still knows nothing about another plugin's settings shape; an absent,
  reshaped or hand-written section yields a missing balance, never a throw. A
  route filed under a key other than `openrouter` is found by the relay segment
  in its address.
- `index.ts`: `PROVIDER_NAMESPACE = settingsNamespace('llm-pi-ai')` and one
  wiring line, `providerBase: () => providerBaseFrom(ctx.settings?.get(...))`.
- Spec: **28 pass, up from 22** - the fallback, its precedence under an explicit
  setting, and eight shapes of malformed provider section.
- `npm run typecheck` EXIT=0.

**Honest limit: this is unit-proven, not field-proven.** vmixer2o2 is the only
host that exercises the relay path, and it cannot get this commit until the user
releases the branch. When it does, it should need **no** config change - its
provider route already names the relay - and the monitor should show a balance.
That is the proof still outstanding.

**Ordering note for [24fdb9]:** this commit sits ON TOP of `6cb5cda128`, the red
advanceToSwarm spec, so the red spec is **no longer the tip** and a prefix push
would now carry it. If that property still matters, the spec needs rebasing back
on top. Flagged to the owner.
