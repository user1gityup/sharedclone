---
name: blitz-04-approval-request
description: BLITZ-04 per-task approval request (Q1) - named agent registry, capacity/quota poller, DSH router wiring; exact files, base commits, permissions, tests, merge limit
metadata:
  type: project
---

# BLITZ-04 approval request: named agent registry + capacity poller + router wiring

- **Author:** Claude Opus 5.5 (Claude Code, vmixer2o2)
- **Date:** 2026-10-19 ~06:20Z
- **pm:** task T-db141bc5 (rev 3, RUNNING, execution_machine vmixer2o2), project P-03a8c18b
- **Status:** awaiting user approval. No source code has been changed.
- **Inputs:** BLITZ-01 audit (`blitz/BLITZ-01-audit.md`), master spec T-2df5e988 (Q1-Q12 locked).

## 1. Authoritative checkouts (verified 06:15Z)

| Code | Authoritative checkout | Base commit | Notes |
|---|---|---|---|
| pm (live on ndi2:4480) | `~/.claude/shared-brain/pm/` (brain git repo) | brain HEAD `09d57653`; last pm change `185c6b22` (2026-10-18 20:44 -0700) | ndi2 deploys pm from the brain (`DEPLOY-PM-UPDATE.ps1`, "pm deployed on brain 6ff2f26d" in handoff-2026-10-14-1645). Brain pm has the vmixer alias pair the audit found missing locally. |
| pm sandbox | `~/Documents/claudecode/dsh-sandbox/pm` (branch `integrate` @ `fa45449`) | — | **Not authoritative.** Diverges from the brain copy in ~20 files. BLITZ-04 will not edit it. The task brief named it; the audit's caveat (stale alias) is the evidence it is behind. |
| DSH router | `~/Documents/claudecode/deepseek-harness`, branch `feat/heterogeneous-teammates` @ `d02f20492e` | `d02f20492e` | Working tree has **8 unrelated uncommitted files** (OpenClaw handoff: `seats.ts`, `index.ts`, `capacity.ts`, llm-openclaw-chatgpt). BLITZ-04 touches none of them and stages only its own paths. |

Code master rule: ndi2 is master. The brain repo is shared by git, and **brain-sync auto-pushes brain `main`** (found by BLITZ-02), so BLITZ-04 must not commit on `main`. Build location, same pattern as BLITZ-02/03:

- `git -C ~/.claude/shared-brain worktree add ~/Documents/claudecode/blitz-04-wt -b blitz/04-registry-capacity 09d57653`
- The worktree sits outside the brain folder; brain-sync pushes only `main` and `keys`, so the branch is never pushed. The live `~/.claude/shared-brain/pm` is not edited.

## 2. Design

### 2a. Named agent registry (Q3)

- Record: `{name, role, machine, transport: 'bridge-claude'|'dsh-run'|'codex', model_policy, max_concurrent, capabilities?, enabled, rev, created_by, updated_at}`. `name` is the key (custom display name, unique). `model_policy` is `{policy: TOKEN_EFFICIENT|…, allow:[model ids|cost classes], pin?}`, validated against the router's `routingPolicies`.
- Storage: a new table `blitz_agents` in pm.db, created by `pm/blitz/agents.mjs` on its **own** `node:sqlite` connection to `store.path` (WAL + `busy_timeout`, same as store). No `store.mjs` change. Writes take `rev` (409 on mismatch) and log through the existing `store.recordEvent` (entity `blitz_agent`).
- Machines validated against `actions.mjs` `machineNames()` alias groups (ndi2/vmixlaptop2x6, vmixer2o2/vmixer).
- Routes: `GET /api/blitz/agents`, `POST /api/blitz/agents` (create), `PATCH /api/blitz/agents/:name` (rev), `POST /api/blitz/agents/:name/disable`. No delete (audit trail); disable instead.
- **Roster is never defaulted.** The registry is a catalogue only. No seed rows, no "default roster", no auto-selection. A helper `selectRoster(names[])` returns exactly the named agents or throws on an empty/unknown list; BLITZ-05's campaign will require the user's explicit list.

### 2b. Capacity and quota poller (Q4)

`pm/blitz/capacity.mjs`, a per-machine poller with **no live provider calls** by default:

| Source | How it is read | Field produced |
|---|---|---|
| `~/.claude/statusline/usage-cache.json` | file read; stale if `capturedAt` > 30 min | `claude: {sessionPercent, weekPercent, resets, stale}` |
| `~/.claude/quota-guard/exhausted.json` | file read; absent = not exhausted (it is absent now) | `claude.exhausted` |
| quota-codex / quota-antigravity / quota-aws | these are DSH Cordis plugins that publish into DSH settings namespaces (`codex-quota`, `antigravity-quota`, `aws-quota`); poller reads the last published values from the DSH settings store on that host, never calls the providers | `codex`, `antigravity`, `aws` buckets + `asOf` |
| local llama | `GET http://127.0.0.1:8090/health` (2 s timeout) on hosts whose `fleet/endpoints` list llama | `local: {up, model, tokensPerSecond?}` |
| pm | `runs` in non-ended state per machine, bridge `running` | `slots: {used, max}` |

- Each machine posts its snapshot to pm: `POST /api/blitz/capacity/report` (bearer token, `x-pm-actor`), held in a `blitz_capacity` table keyed by machine (latest row + `reported_at`). `GET /api/blitz/capacity` returns all machines with a `stale` flag (> 2 poll intervals).
- Runner: `node pm/blitz/capacity.mjs --once|--watch 60` — **not** installed as a service or scheduled task by this task (that is a separate approval).
- Unknown values stay `null`, never guessed (same rule as `registry.ts`: an unmeasured machine must not get a number).

### 2c. Router wiring

- New `packages/council/tool-council/src/router/machine-profiles.ts`: pure `machineProfilesFromCapacity(snapshot): MachineProfile[]` mapping pm capacity → `{id, throughputTokensPerSecond (only if measured), slots, queueDepth, available, unavailableReason}`.
- `route-swarm.ts`: today every candidate gets `UNMEASURED_THROUGHPUT = 50` and no `machineId`. Change: candidates carry `machineId` when the seat is local/host-bound, and the candidate list passes through `buildRegistry({candidates, machines})` before `resolveRoster`, with `machines` supplied by an optional caller-provided `machineProfiles` argument. With no profiles supplied the behaviour is byte-identical to today (50 stays as the candidate fallback), so existing runs do not change.
- `router/index.ts`: export the new function.
- Throughput numbers come only from measurement (llama `/health` or recorded benchmark rows); nothing hard-coded.

### 2d. Quota ledger — decision: do **not** wire now

`quota-ledger.ts` is CAS-correct but its file store serialises one host only, and its own header says the fleet host is undecided. Wiring it into pm now would mean picking pm.db as the fleet ledger store, which is a design decision beyond this task and touches seat dispatch in DSH. BLITZ-04 exposes the ledger's inputs (latest readings + `asOf` per seat) in `/api/blitz/capacity` so a later task (proposed: BLITZ-05 or a BLITZ-04b) can back `LedgerStore` with pm.db. Recorded as an open item, not done.

### 2e. Bridge model choice

- `pm/bridge/weight.mjs` keeps its API. One change: `defaultCandidates()` gains an optional second source — candidates derived from enabled `blitz_agents` rows with `transport: 'bridge-claude'` — used only when a caller passes `{agents}`. The hard-coded haiku/sonnet/opus list and `BRIDGE_CANDIDATES` override stay as-is, so live bridge behaviour is unchanged.
- `quotaHeadroom` for bridge choice may come from the capacity snapshot instead of only `usage-cache.json`; the existing fail-closed 95% `quotaGate` stays.

## 3. Exact files

### pm (brain repo worktree `~/Documents/claudecode/blitz-04-wt`, branch `blitz/04-registry-capacity`, base `09d57653`)

| File | Change |
|---|---|
| `pm/blitz/agents.mjs` | **new** — registry table, validation, CRUD, `selectRoster`, route list |
| `pm/blitz/capacity.mjs` | **new** — source readers, snapshot builder, report/list, CLI `--once/--watch` |
| `pm/blitz/agent-routes.mjs` | **new** — `blitzAgentRoutes({store, db})` returns the BLITZ-04 route tuples (agents + capacity) in server.mjs format. Deliberately **not** `routes.mjs`: BLITZ-02 and BLITZ-03 both propose a `pm/blitz/routes.mjs`; that file is theirs to reconcile. |
| `pm/blitz/agents.test.mjs` | **new** |
| `pm/blitz/capacity.test.mjs` | **new** |
| `pm/server.mjs` | **SHARED change, 2 lines:** `import { blitzAgentRoutes } from './blitz/agent-routes.mjs'` and `...blitzAgentRoutes({ store, db: store.db }),` in the `routes` array. BLITZ-02 (3 lines) and BLITZ-03 (~6 lines + gate) also edit this file; the three branches merge by hand in the order the user picks (BLITZ-03 asks to go first). |
| `pm/bridge/weight.mjs` | small: optional `{agents}` candidate source (2e) |
| `pm/bridge/test.mjs` | add weight cases for the agents source |
| `pm/test.mjs` | add the two new test files to the suite runner if it enumerates files |

`store.mjs`: **no change by BLITZ-04.** BLITZ-02 proposes `api.db = db` (one shared connection). BLITZ-04 uses `store.db` when present and otherwise opens its own `DatabaseSync` on `store.path` (WAL, `busy_timeout`), so it works whether or not BLITZ-02 lands first; after all three merge it uses the shared handle. `approvals.mjs`, `meta.blitz.rating`, discovery and Q&A files: not touched (BLITZ-02/03 ownership).

### DSH (`deepseek-harness`, branch `feat/heterogeneous-teammates`, base `d02f20492e`)

| File | Change |
|---|---|
| `packages/council/tool-council/src/router/machine-profiles.ts` | **new** |
| `packages/council/tool-council/src/router/index.ts` | export line |
| `packages/council/tool-council/src/route-swarm.ts` | optional `machineProfiles` → `buildRegistry` before `resolveRoster`; `machineId` on host-bound candidates |
| `packages/council/tool-council/tests/router.spec.ts` | new cases |
| `packages/council/tool-council/tests/route-swarm.spec.ts` (or existing swarm spec) | new cases |

## 4. Permissions needed

- Create the brain worktree `~/Documents/claudecode/blitz-04-wt` (`git worktree add`, new local branch). No change to the brain's `main` working tree.
- Write, inside that worktree only: `pm/blitz/**` (BLITZ-04 files only), `pm/server.mjs`, `pm/bridge/weight.mjs`, `pm/bridge/test.mjs`, `pm/test.mjs`; plus the 5 DSH paths above.
- Run: `node pm/test.mjs`, `node pm/bridge/test.mjs`, `node --test pm/blitz/*.test.mjs` (temp pm.db only — tests never open the live `~/.claude/pm-data/pm.db`); DSH `pnpm` vitest for `tool-council` router/swarm specs + `tsc` typecheck of that package.
- Network: one read-only `GET 127.0.0.1:8090/health` on vmixer2o2 for a manual capacity `--once` check; one read-only `GET` of live pm to compare. No POST to live pm except task bookkeeping (comments/artifact/heartbeat).
- Git: `git add <exact paths>` + `git commit` in both repos. **No push.** Then `queue-build.mjs` per repo (needs a clean checkout — see §6).
- Not requested: deploying pm on ndi2, installing the poller as a service, launching any Blitz or DSH run, wiring the quota ledger.

## 5. Tests to add

- **agents:** create/list/patch with rev; 409 on stale rev; duplicate name 409; unknown machine/transport/policy 400; disable keeps row; `selectRoster([])` throws; unknown name throws; no seed rows on a fresh db; events recorded.
- **capacity:** each reader with fixture files (fresh, stale, missing, malformed); exhausted.json absent → not exhausted; llama down → `local.up=false`, no throughput; report → list round-trip; `stale` flag after 2 intervals; unknown values stay `null`.
- **routes:** HTTP-level via `createServer` on an ephemeral port: auth required remotely, 404 unchanged for unknown paths, existing routes unaffected.
- **weight.mjs:** no `{agents}` → identical candidate list to today; with agents → only enabled bridge-claude agents; pinned model outside list still 400.
- **DSH router:** `machineProfilesFromCapacity` mapping incl. unmeasured → no throughput; `buildRegistry` applies profile throughput/queue/availability; route-swarm with no profiles = identical assignments to current snapshot; unavailable machine excludes its candidates with the reason.
- Full existing suites (`pm/test.mjs`, bridge tests, tool-council vitest) must stay green.

## 6. Merge limit

- Commit locally only, one commit per repo, signed `Co-Authored-By: Claude Opus 5.5`. **Never push.**
- **pm (brain):** commit on local branch `blitz/04-registry-capacity` in the worktree. `queue-build.mjs` needs a matching upstream, which this branch lacks, and brain `main` is auto-pushed. So, like BLITZ-02, BLITZ-04 stops at "committed on the local branch, tests green, evidence attached". Getting it out is a separate user decision: (a) merge into brain `main` (brain-sync pushes, `DEPLOY-PM-UPDATE` deploys on ndi2), or (b) a remote branch for the gatekeeper.
- **DSH:** commit on `feat/heterogeneous-teammates` with `git add` of the 5 exact paths only, then `queue-build.mjs`. The helper requires a clean checkout; the 8 unrelated OpenClaw files will block it. BLITZ-04 will not stash, commit or discard them; it reports "committed, queue blocked by foreign uncommitted files" and stops. Alternative if the user prefers: commit the DSH change on a separate worktree branch `blitz/04-router-wiring` off `d02f20492e` — same queueing question as pm.
- Live pm on ndi2 is untouched until a separate deploy approval.

## 7. Risks

- Second sqlite connection to pm.db: same WAL/busy_timeout as store; writes are short single statements. Covered by a concurrent-write test.
- `server.mjs` is edited by BLITZ-02, 03 and 04 on three branches — a manual 3-way merge of a few lines; BLITZ-04 keeps its own route file so no new file collides.
- DSH settings-store read path for quota-codex/antigravity/aws is inferred from the plugins' `settingsNamespace(...)`; the exact on-disk location is verified as the first implementation step, and a source is reported `null` if it cannot be read.

## 8. Decision asked of the user

Approve BLITZ-04 implementation exactly as scoped in §3-§6 (approve / approve with changes / reject).
