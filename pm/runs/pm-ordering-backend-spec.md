# PM project/task ordering - selection-independent backend spec

Author: Claude Opus 5.5 on vmixer2o2, 2026-10-17T03:10Z (2026-10-16 20:10 PDT).
Status: PREPARED. Nothing dispatched. pm never dispatches; the user picks swarm seats per task.
Parent: vMixer pm T-67ba9f12 (project `dsh-pm-uiux`, P-f2186d57); ndi2 T-26b4ca91 comment #281.

Scope: the backend that every one of the six UI samples needs, whichever the user picks.
Out of scope: any UI, the sample run in `dsh-runs/pm-ui-samples-T-67ba9f12`, deploy, live pm files.

## Where the work happens

- Staging copy: `~/Documents/claudecode/dsh-runs/pm-ordering-backend-staging/` (copied from
  `~/.claude/shared-brain/pm` minus `runs/` and `service/` at 03:07Z; baseline `node --test`
  = 151 pass / 0 fail, measured).
- Swarm workers edit ONLY the staging copy. Never live pm files, pm.db, or a pm restart.
  Merge into live pm happens later, after user approval, through the normal commit + gatekeeper queue.
- File ownership is per task (below) so wave-mates never touch the same file.

## Facts from the current code (read 2026-10-17)

- `store.mjs`: `projects` and `tasks` both carry `rev`; `migrate(db)` adds nullable columns with
  `ALTER TABLE`, no rewrite. `listProjects` orders by `name`; `listTasks` by `priority, created_at`.
  All writes run in `tx()` (BEGIN IMMEDIATE) and call `event(w, entity, id, action, data)`.
- `updateTask` does optimistic concurrency on `rev` and returns `{current, rejected}` on 409.
- Roles live in **bridge.db** (`roles.mjs`, `role_assignments`), not pm.db. pm HTTP authorization is
  `access.mjs authorizePm`: loopback + peer are trusted (full access); any other bridge principal is
  role-checked, GET -> `view`, everything else -> `run`. Client has no `run`, so Client is already 403
  on every write; this spec makes that explicit with a `reorder` action.
- `public/index.html` has a `#roleSel` (Admin/Manager/Worker/Client) in the header. That select is a
  client-side View-As; it carries no server authority. Server enforcement applies to token principals.

## Data model (S1)

New columns, all added by `migrateOrder(db)` in the existing upgrade-in-place style:

| Table | Column | Type | Meaning |
|---|---|---|---|
| projects | `sort_order` | INTEGER NULL | rank in the **top scope**; NULL = unordered (falls back to name) |
| tasks | `sort_order` | INTEGER NULL | rank inside its project; NULL = unordered (falls back to priority, created_at) |
| tasks | `order_override` | INTEGER NOT NULL DEFAULT 0 | 1 = task is pinned in the top scope, does not follow its project |
| tasks | `top_order` | INTEGER NULL | rank in the top scope, used only when `order_override = 1` |

New tables:

```sql
CREATE TABLE IF NOT EXISTS order_scopes (
  scope TEXT PRIMARY KEY,            -- 'top' or 'project:<P-id>'
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_drafts (
  id TEXT PRIMARY KEY,               -- 'D-xxxxxxxx'
  scope TEXT NOT NULL, base_rev INTEGER NOT NULL,
  ids TEXT NOT NULL,                 -- JSON array, proposed order
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','committed','discarded','expired','stale')),
  actor TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, committed_at TEXT);
CREATE INDEX IF NOT EXISTS tasks_order ON tasks(project_id, sort_order);
```

Migration rules: idempotent (second run adds nothing), no existing row rewritten, all existing rows
keep NULL order, so the current views look identical until someone reorders. Returns the list of
columns added, like `migrate()`.

Why a separate `order_scopes.rev` and not the row `rev`: a reorder must not bump task `rev`,
otherwise every drag would 409 an unrelated body edit in progress. Order conflicts are detected per
scope instead.

## Effective order (S2) - assumption A1, confirm with the user

"Task order is inherited from its project unless overridden" is implemented as:

1. **Top scope** = active projects + tasks with `order_override = 1`, ranked by `sort_order` /
   `top_order` (NULLs last, then project name / task created_at).
2. A task with `order_override = 0` sits under its project; it moves when the project moves.
   Inside the project: `sort_order` (NULLs last), then `priority`, then `created_at`.
3. A task with `order_override = 1` is its own entry in the top scope and does NOT move when its
   project is reordered.

Flattened effective key for a non-overridden task: `[projectTopRank, taskRank, priority, created_at]`;
for an overridden task: `[ownTopRank, -1, priority, created_at]`.
Alternative A1-b if the user means something else (e.g. override = custom rank inside the project
only): only `order-resolve.mjs` and its tests change; schema and API stay.

## API (S3 store ops, S4 routes)

All writes take `actor`/`model` like every other pm write, require `base_rev` of the scope, and
return `{scope, rev, items}` (the resolved order after the write).

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/order?scope=top` | - | top scope, resolved, with `rev` |
| GET | `/api/order?scope=project:<ref>` | - | tasks of one project, resolved, with `rev` |
| GET | `/api/order/flat?project=<ref>` | - | every task in effective order (A1 key) |
| PUT | `/api/order/top` | `{base_rev, ids:[...], mode}` | **bulk**: full list of top-scope ids (projects + overridden tasks) |
| POST | `/api/order/top/move` | `{base_rev, id, to_index \| before \| after, mode}` | **single** move |
| PUT | `/api/order/project/<ref>` | `{base_rev, ids:[...], mode}` | bulk task order inside a project |
| POST | `/api/order/project/<ref>/move` | `{base_rev, id, to_index \| before \| after, mode}` | single task move |
| POST | `/api/order/override/<taskId>` | `{override: bool, base_rev_top, base_rev_project, to_index?}` | pin/unpin a task; bumps both scopes |
| POST | `/api/order/drafts` | `{scope, base_rev, ids}` | preview: stores proposal, returns `{draft, preview, diff}` |
| GET | `/api/order/drafts/<id>` | - | draft + fresh diff + `stale: bool` |
| POST | `/api/order/drafts/<id>/commit` | `{}` | applies if scope rev still = base_rev, else 409 + marks `stale` |
| DELETE | `/api/order/drafts/<id>` | - | discard |
| GET | `/api/order/history?scope=...&limit=` | - | reorder audit events |
| GET | `/api/order/capabilities?role=` | - | `{can_reorder}` for the UI to grey controls (advisory only) |

Validation: bulk `ids` must be exactly the current member set of the scope (same ids, no dupes,
archived projects excluded) -> else 400 naming missing/extra ids. Unknown id -> 404. Stale
`base_rev` -> 409 with `{current: {rev, items}, rejected: {ids}}`, mirroring `updateTask`.
A write renumbers the whole scope 1..n in one `tx()` and bumps `order_scopes.rev` by 1.

`mode` is one of `autosave | manual | confirm` and is recorded in the audit event only; it does not
change server behaviour (see save modes).

Existing list endpoints gain an opt-in: `GET /api/projects?order=manual`,
`GET /api/tasks?order=manual` (effective order). Default ordering is unchanged so the current UI
and test.mjs keep passing.

## Permissions (S4)

- `roles.mjs`: new action `reorder: ['admin', 'manager', 'worker']`; add `reorder` to
  `MANAGER_SCOPED` (a manager reorders only inside its assigned project; `top` scope is
  admin/unscoped-worker only - manager on `top` -> 403).
- `access.mjs authorizePm`: any non-GET under `/api/order` maps to action `reorder` (not `run`);
  project for the scope check comes from the path `<ref>` or the draft's scope. Needs the pathname
  passed in from `server.mjs` (one extra argument).
- Client: 403 on every order write, including draft create/commit. Client may GET order + history.
- Loopback and peer stay trusted, unchanged.

## Save modes (S6 + routes in S4) - all three supported, the UI picks

| Mode | Client behaviour | Server path |
|---|---|---|
| autosave | each drop/arrow sends immediately | single `move` or bulk `PUT`, `mode:'autosave'` |
| manual | client accumulates moves, Save sends once | one bulk `PUT`, `mode:'manual'`; one rev check for the batch |
| preview/confirm | client posts a draft, shows the diff, Confirm commits | `drafts` create -> `commit` / `DELETE` |

Drafts: TTL 60 min (`expires_at`); expired drafts refuse commit with 410; a commit after someone
else changed the scope returns 409 and the draft goes `stale` with the current order attached, so
the UI can re-preview. Commit goes through the same S3 bulk function, so audit and rev logic are
shared.

## Audit (S5)

Every applied reorder writes one pm event: `entity='order'`, `entity_id=<scope>`,
`action='reordered' | 'override_set' | 'override_cleared' | 'draft_committed'`,
`data = {mode, draft_id?, base_rev, rev, moved:[{id, from, to}], before:[ids], after:[ids]}`.
`moved` is computed by a pure `orderDiff(before, after)`. Override changes also write a
`task`-entity event so they show in the task's existing `history`. Draft create/discard are events
too (`draft_created`, `draft_discarded`). History endpoint reads `events WHERE entity='order'`.

## Swarm tasks

Waves (dependencies refined against the code; the proposed 3 waves became 4 because S3 store ops
must exist before routes and drafts can call them):

- **W1** (parallel): S1, S2, S5
- **W2**: S3
- **W3** (parallel): S4, S6
- **W4**: S7

Every brief: work in the staging folder only; name yourself by model in every comment; do not
commit, push, restart pm, or touch pm.db; run `node --test` in the staging folder and paste the
pass/fail summary lines as evidence.

### S1 - schema + migration (~6 min, W1)
Files owned: `order-schema.mjs` (new), `order-schema.test.mjs` (new), `store.mjs` (one call
`migrateOrder(db)` inside `migrate()`, returned columns appended to `added`).
Do: create the columns/tables/index above; export `migrateOrder(db)` and `ensureScope(db, scope, now)`
(inserts `order_scopes` row at rev 0 if missing).
Accept: (1) fresh `:memory:` store has all four columns and both tables; (2) opening a v1-shaped db
(projects/tasks without the columns) upgrades and keeps every row byte-identical except new NULL/0
columns; (3) second `migrateOrder` returns `[]`; (4) full suite still 151+ pass, 0 fail.

### S2 - pure order resolver (~5 min, W1)
Files owned: `order-resolve.mjs` (new), `order-resolve.test.mjs` (new). No imports from store.
Do: `resolveTop(projects, overriddenTasks)`, `resolveProject(tasks)`,
`flatten(projects, tasks)` per A1; `applyMove(ids, id, {to_index|before|after})` returning a new array;
`sameMembers(a, b)` returning `{ok, missing, extra, dupes}`.
Accept: tests for NULLs-last tie-break, project move carries non-overridden tasks, overridden task
stays put when its project moves, applyMove for first/last/before/after/out-of-range (clamps),
sameMembers dupes/missing/extra; all deterministic, no clock.

### S5 - audit helpers (~4 min, W1)
Files owned: `order-audit.mjs` (new), `order-audit.test.mjs` (new). No imports from store.
Do: `orderDiff(before, after)` -> `[{id, from, to}]` for moved ids only (1-based);
`reorderEvent({scope, mode, draft_id, base_rev, rev, before, after, action})` -> `{entity, entity_id, action, data}`;
`historyQuery(scope, limit)` -> `{sql, args}` for `events WHERE entity='order' [AND entity_id=?] ORDER BY id DESC LIMIT ?` (limit capped 500).
Accept: diff of identical lists is `[]`; swap of two gives two entries; mode outside
`autosave|manual|confirm` throws; tests green.

### S3 - order store ops (~8 min, W2; needs S1, S2, S5)
Files owned: `order.mjs` (new), `order.test.mjs` (new), `store.mjs` (expose
`orderOps = createOrderOps({db, tx, now, event, who, projectRow, taskRow})` on the store object and add
`order=manual` handling to `listProjects`/`listTasks`).
Do: `getOrder(scope)`, `setOrder(w, scope, {base_rev, ids, mode, draft_id})` (bulk),
`moveItem(w, scope, {base_rev, id, to_index|before|after, mode})` (calls setOrder),
`setOverride(w, taskId, {override, base_rev_top, base_rev_project, to_index})`, `flat(projectRef?)`.
Renumber 1..n, bump scope rev, write the S5 event, all inside one `tx()`. Errors as `PmError`
400/404/409 with `{current, rejected}` on 409. Task `rev` must NOT change on reorder.
Accept: bulk then stale bulk -> 409 with current order; move by before/after/index; override
pin/unpin bumps both scopes and writes a task history event; task rev unchanged after reorder;
`listTasks({order:'manual'})` returns effective order; default list order unchanged.

### S4 - HTTP routes + permissions (~8 min, W3; needs S3)
Files owned: `order-routes.mjs` (new), `server.mjs` (spread `orderRoutes(store)` into `routes`, pass
pathname to `authorizePm`), `access.mjs` (`/api/order` writes -> `reorder`), `roles.mjs`
(`reorder` action + MANAGER_SCOPED), `order-routes.test.mjs` (new).
Do: every route in the API table except draft internals, which call S6's exported
`createDrafts(...)` functions by the names in S6 (stub-import is fine; S6 lands in the same wave).
Accept: over HTTP with a test bridge principal: client -> 403 on PUT/POST/DELETE order and on draft
create/commit, 200 on GET; worker -> 200; manager in-project -> 200, other project -> 403, top -> 403;
loopback unchanged; `/api/order/capabilities?role=client` -> `{can_reorder:false}`;
existing access/roles tests still green.

### S6 - preview/confirm drafts (~8 min, W3; needs S3)
Files owned: `order-drafts.mjs` (new), `order-drafts.test.mjs` (new).
Exports: `createDrafts({db, tx, now, newId, orderOps, event, who})` returning
`{create(w, {scope, base_rev, ids}), get(id), commit(w, id), discard(w, id), expire()}`.
Do: create validates members (S2 `sameMembers`), stores the draft, returns `{draft, preview, diff}`;
commit calls `orderOps.setOrder(..., {mode:'confirm', draft_id})`; 409 -> state `stale` with current
order; expired -> 410; discard -> `discarded`. TTL 60 min, injectable clock.
Accept: create->commit applies and audits `draft_committed`; create, then a direct bulk write,
then commit -> 409 + stale; clock past TTL -> 410; discard twice is idempotent; autosave and manual
need no draft (covered in S3 tests).

### S7 - integration tests + full suite (~7 min, W4; needs all)
Files owned: `test.mjs` (append an "ordering" block only), any fix-ups limited to the order-* files.
Do: end-to-end through `createServer` on an ephemeral port: three projects, tasks with one
override; reorder top, move a task, pin/unpin, draft preview->commit, history shows each with mode;
Client principal 403 on every write; migration on a copy of a v1-shaped db.
Accept: `node --test` in staging = all previous 151 + new tests pass, 0 fail; paste the summary;
list every file changed vs live pm (`git diff --no-index` or a file list) for the merge review.

## ETAs (all estimated; clock assumes the user starts W1 at 03:15Z / 20:15 PDT)

Per-wave handoff overhead estimated at 2 min (worker spin-up + evidence check).

| Task | Wave | Duration | Start (UTC / PDT) | Done (UTC / PDT) |
|---|---|---|---|---|
| S1 schema + migration | W1 | 6 min | 03:15Z / 20:15 | 03:21Z / 20:21 |
| S2 resolver | W1 | 5 min | 03:15Z / 20:15 | 03:20Z / 20:20 |
| S5 audit helpers | W1 | 4 min | 03:15Z / 20:15 | 03:19Z / 20:19 |
| S3 store ops | W2 | 8 min | 03:23Z / 20:23 | 03:31Z / 20:31 |
| S4 routes + permissions | W3 | 8 min | 03:33Z / 20:33 | 03:41Z / 20:41 |
| S6 drafts | W3 | 8 min | 03:33Z / 20:33 | 03:41Z / 20:41 |
| S7 integration + suite | W4 | 7 min | 03:43Z / 20:43 | 03:50Z / 20:50 |
| **Whole set** | W1-W4 | **~35 min** wall clock (46 worker-min) | 03:15Z / 20:15 | **03:50Z / 20:50 PDT** |

If the start slips, shift every clock time by the same amount; durations stand.

## Open questions for the user
1. A1: is "override" = pinned in the top list (this spec) or a custom rank inside the project only?
2. Should a Manager reorder the top (cross-project) list? Spec says no (admin + unscoped worker only).
3. Draft TTL 60 min OK?

## pm tasks (vMixer pm, project dsh-pm-uiux, all READY, nothing prepared/started)
S1 T-2b7172f0 · S2 T-d1598d85 · S5 T-4bddea60 · S3 T-08a996df · S4 T-1bd000fd · S6 T-51864820 · S7 T-ff3d69e4
(source_ref `pm-ordering-backend/S<n>`; meta carries wave + estimated ETA.)
