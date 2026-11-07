---
name: handoff-2026-09-21-0640-dsh-quota-work-account
description: DSH Claude quota panel gains the second (claude-work) account; CheaperInference budget tool queued next.
metadata:
  type: project
---

# Handoff 2026-09-21 06:40: DSH quota tool — claude-work account + CheaperInference budget

- Stable id: handoff-2026-09-21-0640-dsh-quota-work-account
- Updated: 2026-09-21 10:52 (session 3: part 2 BUILT, DSH relaunched, panel + Refresh verified live)
- Host: ndi2 (Windows 11 Home 10.0.26200)
- Session: 2a3943ab (part 1) / faceeaef (session 2) / 16c60c59-ae97-429c-9074-b9c73a88b785 (session 3, Claude Opus 5)
- Model: Claude Opus 5
- Project: `~/Documents/claudecode/deepseek-harness`, branch `feat/heterogeneous-teammates`
- Owner: Claude Opus 5. A DSH agent writes CheaperInference work into the same repo.

## The ask

1. "dsh needs to have add claude work to the claude quota tool" — the DSH Claude quota panel must
   also show the second Claude account (`claude-work`, `CLAUDE_CONFIG_DIR=~/.claude-work`).
2. Mid-turn: "cheap inference needs a buget tool as well complete after claude is complete" —
   after (1) lands, build a budget/quota tool for the CheaperInference seat.

## Survey (evidence)

- Host half: `packages/quota/quota-claude` (`src/index.ts` 220 lines, `src/reading.ts` 302,
  `tests/reading.spec.ts` 125). Publishes into settings namespace `claude-quota`; boot publishes
  the status-line cache, free endpoint poll every `pollMs` (floor 30 s), live `/usage` only on the
  panel's Refresh (`refreshRequestedAt`).
- Client half: `packages/client/ui-claude-quota` (`ClaudeQuota.tsx` 262, `locales.ts` 74).
- Registration: `packages/bundle/base/cordis.patch.yml:238`, `packages/bundle/web-app/cordis.patch.yml:304`.
- `~/.claude/statusline/usage-work.mjs` already reads the work account
  (`~/.claude-work/.credentials.json` -> `/api/oauth/usage`) into
  `~/.claude/statusline/usage-work-cache.json`. Same shape as the default cache.
- `~/.claude-work` exists; per `handoff-2026-09-21-0244-second-claude-seat-setup.md` the profile is
  NOT logged in yet, so a work reading returns `{failed: 'not logged in'}` until the user logs in.

## Plan

Host: parametrize `readUsageApi`/`readUsageText` by config dir, add work cache path
(`usage-work-cache.json`), publish `work*` fields in the same namespace, poll both, refresh both.
Client: second section with the work meters, hidden when the work account has no reading.
Then the CheaperInference budget tool as a sibling package.

## Status 10:25 — part 1 (Claude work account) DONE **and LIVE in DSH**, part 2 not started

### Done, with evidence (all UNCOMMITTED, branch `feat/heterogeneous-teammates`)

`packages/quota/quota-claude/src/reading.ts`
- `defaultConfigDir()`, `workConfigDir()` (`~/.claude-work`), `workCachePath()`
  (`~/.claude/statusline/usage-work-cache.json`, the file `usage-work.mjs` already writes).
- `readUsageApi(configDir = defaultConfigDir())` — credentials come from the given profile.
- `readUsageText(timeoutMs, configDir?)` — passes `CLAUDE_CONFIG_DIR` in the child env.
- `refreshFree(path?, configDir?)` and `refresh(timeoutMs?, path?, configDir?)`.

`packages/quota/quota-claude/src/index.ts`
- Config: `workEnabled` (default true), `workConfigDir`, `workCachePath`, plus published
  `workSessionPercent`, `workSessionResets`, `workWeekPercent`, `workWeekResets`, `workCapturedAt`.
- `publishableWork()`; boot publishes the work cache; the free poll reads both accounts; the panel's
  Refresh reads the work account on the free endpoint in the same press. Accounts are never summed.

`packages/client/ui-claude-quota` — panel shows two labelled blocks ("Personal account" /
"Work account"), each with session+week meters; the work block and the `+NN%` trigger badge appear
only when that profile has a reading. Locale keys `account.personal` / `account.work` in en + zh.

`packages/quota/quota-claude/README.md` — new "Two accounts" section; configuration paragraph
updated.

Verification actually run:
- `node node_modules/typescript/bin/tsc --noEmit -p packages/quota/quota-claude/tsconfig.json` -> exit 0.
- same for `packages/client/ui-claude-quota/tsconfig.json` -> exit 0.
- `node node_modules/vitest/vitest.mjs run packages/client/ui-claude-quota packages/quota`
  -> **7 files, 38 tests passed**. 6 new tests in `quota-claude/tests/reading.spec.ts` cover the
  separate config dir, the Bearer token coming from that profile, "not logged in" -> nothing rather
  than zero, its own cache file, `publishableWork` absent sentinels, and the schema defaults.
- LIVE probe (tsx, repo root, temp file deleted): work endpoint returned
  `sessionPercent 54, weekPercent 16, resets Sep 21 12:20pm / Sep 26 4:00pm`; published fields
  `workSessionPercent 54 / workWeekPercent 16`; personal cache still 28 (untouched).
  The `claude-work` profile IS logged in (contrary to the 02:44 handoff).

NOT yet done for part 1: `pnpm run build` (host + client bundle) and a DSH relaunch, so the
running DSH host (port 3080) still carries the old quota plugin.

### Part 2 — CheaperInference budget tool: NOT STARTED

Survey only. `packages/council/tool-council/src/cheaperinference.ts` (471 lines) already has
`readWallet` (`/v1/account/balance`), `readUsage` (`/v1/account/usage`, `days`), `loadCatalog`,
`textModels`, `estimateUsd`, `judgeWallet` — all with injectable fetch, all free (no metered
tokens), key env `CHEAPERINFERENCE_API_KEY`. The budget surface on top of them does not exist.

Intended shape (matches `packages/quota/quota-codex`, the smallest sibling: index 121 / invariant 32
/ reading 139 lines): a host plugin publishing wallet + usage into its own settings namespace on a
poll (free, so a timer is allowed, unlike the Claude `/usage` turn), and — per
`handoff-2026-09-20-2205-cheaperinference-swarm-fix.md` — integrated into the EXISTING DSH views
(`packages/client/ui-council-budget`, which already knows the `cheaperinference` seat at
`capacity.ts:45/98`) rather than a new all-provider budget system. Settings fields must be flat
scalars; top models therefore go as one JSON string field.

## Session 2 (2026-09-21 10:10-, Claude Opus 5, faceeaef) — build blocked then unblocked

- Repo state on entry: HEAD `b43949011c` on `feat/heterogeneous-teammates`; part-1 edits still
  uncommitted (7 files, incl. an unrelated uncommitted `packages/council/tool-council/src/index.ts`
  default-profile fix from handoff-2026-09-21-0218).
- `pnpm run build` FAILED: `'tsx' is not recognized`. Cause found: `node_modules/.bin` had been
  emptied (single hand-written POSIX `tsx` sh shim, mtime 2026-09-21 08:40, no .cmd/.ps1), and
  `node_modules/.modules.yaml` was gone while `node_modules/.pnpm` (937 pkgs) was intact.
- `pnpm install --frozen-lockfile` and `pnpm install --force` both said "Already up to date" —
  `node_modules/.pnpm-workspace-state-v1.json` made pnpm skip relinking.
- FIX: delete `node_modules/.pnpm-workspace-state-v1.json`, then `pnpm install --prefer-offline`.
  `.bin` went 1 -> 45 entries. Do this first if `tsx`/`tsc`/`tsdown` "not recognized" recurs.
- DSH host on 3080 answering 200 (old plugin build). Last council run 2026-09-20 22:47, so no DSH
  agent appears to be mid-write in this repo.

- Second build failure after the relink: `tsc -b` TS2307 on `@agentclientprotocol/sdk` — that
  package's `dist/acp.js` + `acp.d.ts` had been DELETED inside
  `node_modules/.pnpm/@agentclientprotocol+sdk@0.25.1_zod@4.4.3/...` (same 08:40 damage).
  FIX: remove that .pnpm dir + the workspace-state json, `pnpm install --prefer-offline` -> restored.
- `pnpm run build` then exit 0 (210 client artifacts). `packages/quota/quota-claude/lib/index.js`
  contains `workSessionPercent`; `packages/client/ui-claude-quota/lib/client.js` contains the work
  locale keys.
- DSH relaunched via `~/.dsh/launch-dsh.cmd`: old PID 27716 replaced by PID 9832, 3080 -> 200.
- **Panel verified live in the browser** (http://127.0.0.1:3080, sidebar "Claude Quota 46% +54%"):
  PERSONAL ACCOUNT session 46% / week 22%; WORK ACCOUNT session 54% / week 16%; separate blocks,
  never summed. Part 1 is complete end to end.

### Part 2 survey done this session (no code written)

The one-shot publisher ALREADY EXISTS — `packages/council/tool-council/src/index.ts:1025-1067`, a
fire-and-forget `void (async () => {...})()` inside `apply()`. It resolves
`CHEAPERINFERENCE_API_KEY` via `resolveOpenRouterKey({variable: CHEAPERINFERENCE_KEY_ENV})`, calls
`loadCatalog`/`textModels`, `readWallet`, `readUsage`, and patches COUNCIL_NAMESPACE only on change
with: `cheaperInferenceModels`, `cheaperInferenceWalletUsd` (= `availableUsd`, 1-cent deadband),
`cheaperInferenceSavedUsd`, `cheaperInferenceUsageDays`, `cheaperInferenceSavingsPercent`.
Declared at `index.ts:415-441` (Config interface) and `:554-558` (schema).
The panel already renders two rows from them: `CouncilBudget.tsx:186-203, 218, 456-470`; locale keys
`balance.cheaperInference*` at `locales.ts:27-30, 121-124` (en) and `:214-217` (zh); client tests
`ui-council-budget/tests/seat-model.client.spec.tsx:107-132`.

So what is MISSING is the budget *tool* around it: it runs once at plugin apply, has no poll, no
Refresh, no state/captured-at, and drops most of what `readWallet`/`readUsage` already return
(`balanceUsd` vs `availableUsd`, `reservedUsd`, `autoRecharge`, `billedUsd`, `requestCount`,
`topModels`).

DECISION (deviates from the 06:40 plan, deliberately): do NOT add a `packages/quota/quota-cheaperinference`
package. The readers live in `tool-council/src/cheaperinference.ts`, the fields and the panel rows
already live in the council namespace and `ui-council-budget`, and a separate package would either
duplicate the reader (jscpd gate) or add a quota->council dependency. Extend in place instead.

Shape to build (all free calls, so a timer IS allowed here, unlike the Claude `/usage` turn):
1. `tool-council/src/index.ts` — replace the one-shot IIFE with a `ctx.effect(...)` lifecycle copied
   in structure from `packages/quota/quota-codex/src/index.ts` (serial reads with a `queued` flag,
   rising-edge refresh tracked in a local `refreshedAt` rather than off `prev`, AbortController on
   dispose, `setInterval` when the poll ms > 0). Reuse `live()` for the current settings.
2. New flat scalar settings + schema entries: `cheaperInferenceBudgetPollMs` (default 300_000, 0 off),
   `cheaperInferenceRefreshRequestedAt`, `cheaperInferenceBudgetState` ('idle'|'running'|'ok'|'failed'),
   `cheaperInferenceCapturedAt`, `cheaperInferenceBalanceUsd`, `cheaperInferenceReservedUsd`,
   `cheaperInferenceAutoRecharge`, `cheaperInferenceBilledUsd`, `cheaperInferenceRequestCount`,
   `cheaperInferenceTopModelsJson` (one JSON string — settings fields must stay flat scalars).
3. `ui-council-budget/src/client/CouncilBudget.tsx` — extend the existing CheaperInference block with
   balance/reserved, spend + requests over the window, top models, captured-at and a Refresh button
   that bumps `cheaperInferenceRefreshRequestedAt`; locale keys in en AND zh (`locales.ts` pairs them).
4. Tests: host side with injected fetch (`readWallet`/`readUsage` already take a `FetchLike`), client
   side alongside `seat-model.client.spec.tsx`.
5. `pnpm run build`, relaunch DSH, verify in the browser at http://127.0.0.1:3080 (Council Budget
   panel in the left sidebar).


## Session 3 (2026-09-21 10:28-, Claude Opus 5, 16c60c59) — part 2 built, UNCOMMITTED

Entry state matched the note: HEAD `b43949011c`, 7 modified files, DSH on 3080 from session 2.

### Written this session (all uncommitted)

- NEW `packages/council/tool-council/src/cheaperinference-budget.ts` (~260 lines):
  `readBudget` (catalogue + `/account/balance` + `/account/usage` in one pass, injectable fetch,
  never throws), `budgetPatch` (pure; 1-cent deadband, writes `capturedAt`+`ok` even when nothing
  moved, `failed` + no zeros when nothing could be read), `startBudgetPublisher` (serial reads,
  `queued` flag, rising-edge refresh via a local `refreshedAt`, AbortController, unref'd interval),
  `BUDGET_POLL_MS` 300_000.
- `packages/council/tool-council/src/index.ts`: the one-shot CheaperInference IIFE (was :1025-1067)
  replaced by `ctx.effect(() => startBudgetPublisher({...}), 'tool-council: cheaperinference budget')`;
  `ctx.settings?.register` return now kept as `budgetScope` (typed `SettingsScope<BudgetFields>`) so
  the publisher can watch Refresh; imports rewired (`readUsage/readWallet/textModels/loadCatalog`
  no longer imported here). 10 new Config fields + schema entries: `cheaperInferenceBalanceUsd`,
  `ReservedUsd`, `AutoRecharge`, `BilledUsd`, `RequestCount`, `TopModelsJson`, `CapturedAt`,
  `BudgetState`, `BudgetPollMs` (default BUDGET_POLL_MS), `RefreshRequestedAt`.
- `packages/client/ui-council-budget/src/client/CouncilBudget.tsx`: the two CheaperInference rows
  moved out of Capacity into their own "CheaperInference budget" section, plus reserved/of-balance,
  auto-recharge, billed + requests + window days, top-model rows parsed from the JSON field,
  a failed note, a read-at stamp and a Refresh button writing `cheaperInferenceRefreshRequestedAt`.
- `packages/client/ui-council-budget/src/client/locales.ts`: 14 `cheaper.*` keys in en AND zh.
- `packages/client/ui-council-budget/src/client/CouncilBudget.module.css`: `.budgetFoot`, `.stamp`,
  `.refreshBtn` (+hover/disabled).
- NEW `packages/council/tool-council/tests/cheaperinference-budget.spec.ts` — 9 tests.

### Verification actually run (this session)

- `node node_modules/typescript/bin/tsc --noEmit -p packages/council/tool-council/tsconfig.json` -> exit 0.
- same for `packages/client/ui-council-budget/tsconfig.json` -> exit 0.
- `node node_modules/vitest/vitest.mjs run packages/client/ui-council-budget packages/council/tool-council`
  -> **46 files, 698 tests passed** (exit 0).

### Part 2 is DONE and LIVE (10:52)

- NEW `packages/client/ui-council-budget/tests/cheaper-budget.client.spec.tsx` — 8 tests.
- Panel fix after the first live look: the auto-recharge row is gated on a WALLET reading, not on
  `capturedAt`. A key without `account:read` still produces a capture, and the row was saying "off"
  about something the provider never reported. Covered by a test.
- `pnpm run build` exit 0 (210 client artifacts); `tool-council/lib/index.js` carries
  `cheaperInferenceBudgetState`, `ui-council-budget/lib/client.js` carries `cheaper.refresh`.
- DSH relaunched twice via `~/.dsh/launch-dsh.cmd`; final host PID 27800 on 3080 -> 200. It runs from
  SOURCE (`node --import tsx/esm apps/cli/src/bin.ts web`), so host plugin edits need no rebuild;
  the client bundle does.
- LIVE in the browser (127.0.0.1:3080, Council Budget panel): section "CHEAPERINFERENCE BUDGET"
  shows `CheaperInference wallet / key lacks account:read / Read at 10:44:46 AM / Refresh`.
  Clicking Refresh flipped the stamp to "Reading…" and then to "Read at 10:45:13 AM" — the whole
  loop (browser write -> host watcher -> provider read -> settings publish -> panel) works.
- `node node_modules/vitest/vitest.mjs run packages/client/ui-council-budget packages/council/tool-council packages/quota`
  -> **53 files, 741 tests passed** (exit 0). tsc exit 0 on both tsconfigs.
- `pnpm run lint`: repo-wide 137 -> 131 errors, all pre-existing patterns (the same
  `ctx.settings?.update` optional-chain rule fires ~40 times in the untouched parts of
  `tool-council/src/index.ts`, plus quota-claude from part 1, agent-memory, sandbox-policy...).
  Nothing in the part-2 files is flagged.

**The wallet/spend rows are empty because the configured CheaperInference key lacks the
`account:read` scope**, not because the tool is broken: the catalogue read succeeds (which is why
the panel says "key lacks account:read" rather than "no key yet"). A key with that scope makes
balance, reserved, billed, request count and the top-model rows appear with no code change.

### Still open

1. Agent Note under `.agents/notes/` (repo AGENTS.md requires one for a non-trivial change; needs
   the en + zh pair, and part 1 shipped without one either).
2. Everything from both parts is UNCOMMITTED. No commit and no push without the user's word.

## Exact next action

1. DONE 2026-09-21 10:25 — built, relaunched, panel verified live with both blocks.
2. Build the CheaperInference budget surface per "Part 2 survey done this session" above, starting
   with step 1 (the `ctx.effect` poller in `tool-council/src/index.ts`, replacing the IIFE at
   `:1025-1067`). Part-1 edits remain UNCOMMITTED.

## Do-not-repeat

- No endpoint probe loops; no printing of access tokens.
- Do not sum the two Claude accounts into one percentage.
- No push; commits only on the user's word.
- Do not write a new `quota-cheaperinference` package; extend the council namespace + existing panel.
- Do not re-diagnose the build: `node_modules` was damaged at 08:40 (missing `.bin` shims, gutted
  `@agentclientprotocol/sdk` dist). Cure = delete `node_modules/.pnpm-workspace-state-v1.json`
  (pnpm otherwise reports "Already up to date" and relinks nothing), plus the affected `.pnpm`
  package dir, then `pnpm install --prefer-offline`.
- `packages/council/tool-council/src/index.ts:1626/1953` carries an UNRELATED uncommitted
  default-profile fix from handoff-2026-09-21-0218; leave it alone, it is still untested.
