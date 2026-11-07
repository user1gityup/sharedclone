---
name: blitz-02-approval-request
description: BLITZ-02 (T-dddde3c9) per-task Q1 approval request - top-N ranking, hybrid discovery, one-project-at-a-time Q&A; scope, base rev, permissions, tests, merge limit
metadata:
  type: project
---

# BLITZ-02 approval request (Q1): hybrid discovery and project-by-project Q&A

- **Author:** Claude Opus 5.5 (Claude Code, vmixer2o2)
- **Written:** 2026-10-19 ~06:20Z
- **pm:** task T-dddde3c9, project P-03a8c18b. Claimed by claude-code@vmixer2o2, lifecycle RUNNING, execution_machine vmixer2o2.
- **Status:** awaiting user approval. No source code has been changed.

## 1. Authoritative checkout (verified; corrects the BLITZ-01 audit)

- The live pm on ndi2 runs from **`~/.claude/shared-brain/pm`**. `pm/DEPLOY-PM-UPDATE.ps1` runs brain-sync, both test suites, then restarts pm. Live `/api/health` reports db `~\.claude\pm-data\pm.db`.
- `~/Documents/claudecode/dsh-sandbox/pm` (fa45449, origin = a local bundle) is a **stale, divergent copy**: about 30 files differ, and it lacks the DEPLOY and FUNNEL scripts. BLITZ-01 read this copy, so its line references may not match live.
- **Merge hazard:** brain-sync commits **and pushes** the brain's `main` (and `keys`) at every session start (`.sync/brain-sync.mjs` ~l.427-455). Any edit made directly under `~/.claude/shared-brain/pm` would therefore be pushed and later deployed to ndi2 without a gatekeeper review. That breaks the merge limit, so BLITZ-02 must **not** edit the brain working tree.

## 2. Base version

- Repo: `github.com/user1gityup/shared-brain`, branch `main`, HEAD **09d57653ab4efbadf2f2c264b39ad6e1a95fdd59**.
  - Last pm change: 185c6b22.
  - Last `store.mjs`/`server.mjs` change: dc2a586a.
- Work happens in a separate git worktree on a local branch that brain-sync never pushes:
  - `git -C ~/.claude/shared-brain worktree add ~/Documents/claudecode/blitz-02-pm -b blitz/02-discovery-qa 09d57653`
  - brain-sync pushes only `main` and `keys`. This worktree sits outside the brain folder, so session-start sync cannot pick it up.

## 3. Design

### 3a. Top-N ranking: `GET /api/blitz/top-projects?n=10[&projects=P-a,P-b]`

- Live data: 29 active projects and 284 open tasks. Of those, 72 are priority 1, so the derived rank has many ties.
- **Default rank keys, in order:**
  1. `projects.priority` (if S1 below is approved; NULL sorts last)
  2. minimum open-task priority
  3. count of priority-1 open coding tasks
  4. count of open coding tasks
  5. oldest open task `created_at`
  6. project id (stable tiebreak)
- Only `status='active'` projects are ranked, and only those with at least one open coding task.
- When `projects=` is given, that explicit list is used in the caller's order and replaces the ranking. The `n` cap still applies. Unknown ids are rejected with 400.
- Each row returns its rank inputs, so the order can be audited.
- **Recommendation:** add a nullable `projects.priority` column (S1). It is the only way to get the "PM authoritative priority" that the task body asks for. Without it, the ranking is derived only and stays tie-heavy.

### 3b. Hybrid discovery: `POST /api/blitz/discover {projects?|n?, apply:false}`

- **pm source**
  - Takes open tasks in the selected projects.
  - Noncoding exclusion: kinds `handoff`, `brain-project` and `other` are excluded, and so are tasks whose `meta.blitz.coding === false`.
  - Kinds `null`, `dsh-run`, `dsh-pipeline` and `cc-session` are kept as coding candidates, with a `reason` field.
- **repo audit source (read-only)**
  - For each repo path linked to a project (from the task `source_ref`/`meta.repo`), it reads `git status --porcelain`, ahead/behind, open `push-requests.md` entries and the handoff `Next:` lines.
  - It uses only git plumbing reads and never writes to repos.
- **agent audit source**
  - Ingests a JSON report file from an agent (`{project, items:[{title, body, evidence, fingerprint}]}`).
  - Ingestion is validated and stays read-only until `apply`.
- **Issues: out of scope for BLITZ-02.** `gh` 2.100 is installed but not logged in, and no GitHub client exists in pm. The source_ref form `gh:<owner>/<repo>#<n>` is reserved and a stub adapter returns `[]`. A future task can enable it once `gh auth` exists.
- **Dedupe and provenance**
  - Each candidate gets one canonical `source_ref`: `pm:<taskId>`, `repo:<repoName>:<kind>:<fingerprint>` or `audit:<agent>:<fingerprint>`.
  - Duplicates merge by `source_ref`, then by normalized title within the project. Every source is kept in `provenance[]`.
  - Dependency links come from `meta.blitz.depends_on` and text `T-xxxxxxxx` mentions. They are reported, not enforced (the DAG belongs to BLITZ-05).
- **Writes**
  - `apply:false` (the default) is a pure read.
  - `apply:true` calls the existing idempotent `store.upsert` with `source_ref`, adding `meta.blitz.discovery` to new tasks only. Existing tasks are never re-prioritized, and `meta.blitz.rating` is never touched (BLITZ-03 owns it).

### 3c. Q&A, one project at a time (Q8)

- **Storage**
  - A new table `blitz_questions` is owned by `pm/blitz/qa.mjs`, with columns `qid, campaign_id, project_id, task_id, seq, question, options, status (open|answered|superseded), answer, answered_by, answered_model, decision_key, correlation_id, created_at, answered_at`.
  - The table is created with `CREATE TABLE IF NOT EXISTS` on pm's own db handle (see S2).
- **Visibility**
  - Each question is also posted as a normal pm comment on the task (`kind:'comment'`, body prefixed `[blitz-question <qid>]`).
  - It is also mirrored to a bridge message with `correlation_id = qid` and `project = project_id`, so ChatGPT and companion agents see it and can reply on the thread.
- **Why `comments.kind='question'` is not used:** the `comments.kind` CHECK constraint allows only `('comment','instruction')`. Extending it needs a SQLite table rebuild of `comments` in `store.mjs`, a risky shared change. That is listed as optional S3; the default design does not need it.
- **Routes**
  - `POST /api/blitz/campaigns/:id/qa {project, task?, question, options?, decision_key?}` asks a question.
  - `GET /api/blitz/qa?campaign=&project=&status=` lists questions.
  - `POST /api/blitz/qa/:qid/answer {answer, rev?}` records an answer.
  - An answer arriving as a bridge reply on `correlation_id = qid` goes through the same function.
  - Relayed answers (a bridge principal that is not the user) are stored as `answered_pending_confirm` and do not count until confirmed. This mirrors `approvals.mjs` without changing that file.
- **One project at a time**
  - The "current project" for a campaign is the first project in rank order that still has open questions.
  - Asking a question for a later project is accepted but queued. The question is not mirrored to the bridge until every earlier project has none open.
  - `GET /api/blitz/campaigns/:id/qa/current` returns the active project and its open questions, which supports resume after a restart.
- **Decision reuse:** questions carrying a `decision_key` such as `repo-layout:<repo>` are auto-answered from the latest answered question with the same key. The answer records `reused_from: qid`, and the user can still override it.
- **Campaign id:** BLITZ-02 accepts any opaque campaign id string. The campaigns table and routes belong to BLITZ-05/08, so this module does not create them.

## 4. Exact scope (files)

New files, all in the worktree under `pm/blitz/`:

| File | Purpose |
|---|---|
| `pm/blitz/rank.mjs` | Top-N ranking (pure function over store reads) |
| `pm/blitz/discovery.mjs` | pm, repo and agent-audit sources, dedupe, noncoding filter, dependency links; `gh` stub |
| `pm/blitz/qa.mjs` | `blitz_questions` table, ask/answer/list/current, bridge mirror, decision reuse |
| `pm/blitz/routes.mjs` | Exports `blitzRoutes({store, db, bridge})` → route tuples in server.mjs format |
| `pm/blitz/blitz.test.mjs` | Tests (section 6) |
| `pm/blitz/README.md` | API contract |

Shared changes (sequence these with BLITZ-03/04):

- **S2 `server.mjs` (required):** a 3-line change. Import `blitzRoutes` and spread its tuples into `routes`. Pass `bridge` and a db handle. Nothing else changes.
- **S2' `store.mjs` (required, minimal):** expose the db handle as a read-only property (`api.db = db`) so blitz modules share one connection and its transaction rules. The alternative, a second `DatabaseSync` on the same WAL file, avoids touching store.mjs but means two writers; I recommend `api.db`.
- **S1 `store.mjs` (optional, recommended):** add a migration `ALTER TABLE projects ADD COLUMN priority INTEGER` and allow `priority` in project updates.
- **S3 `store.mjs` (optional, not recommended now):** a rebuild that adds `'question'` to the `comments.kind` CHECK.
- `pm/test.mjs` (one line): import `blitz/blitz.test.mjs` so `DEPLOY-PM-UPDATE` runs it.

**Not touched:** `approvals.mjs`, `meta.blitz.rating` (BLITZ-03), and router, registry and quota poller (BLITZ-04). Also not touched: `actions.mjs`, `runner.mjs`, bridge internals, MCP tools, the UI, the live pm, and ndi2.

## 5. Permissions needed

- Create the worktree `~/Documents/claudecode/blitz-02-pm` (git worktree add on the brain repo, new local branch). There is no change to the brain's `main` working tree.
- Read/write files inside that worktree only.
- Run `node pm/blitz/blitz.test.mjs`, `node pm/test.mjs` and `node pm/bridge/test.mjs` in the worktree. They use in-memory or temp DBs, with no network.
- Read-only git commands on local repos, used by the discovery tests against temp fixture repos the tests create.
- `git commit` on branch `blitz/02-discovery-qa` only.
- pm API writes, limited to task T-dddde3c9: heartbeat, comments, artifacts, next_action and lifecycle.
- **Not requested:**
  - any push or brain-sync of the branch
  - any merge into `main`
  - a deploy or pm restart
  - writes to the live pm db, except this task's own records
  - a live discovery `apply:true` run
  - a Blitz launch or `gh auth`

## 6. Tests to add (`pm/blitz/blitz.test.mjs`, node:test, in-memory store)

1. **Selection order:** priority column > min prio > P1 count > open count > age > id; explicit `projects=` order wins; `n` cap applies; archived and no-open-coding projects are excluded; an unknown id returns 400.
2. **Noncoding exclusion:** handoff, brain-project and other kinds are excluded; `meta.blitz.coding=false` is honored.
3. **Dedupe:** the same item from pm, repo and audit gives one candidate with 3 provenance entries; a title-normalized duplicate merges; `apply:true` twice gives one task (idempotent); the existing task's priority and rating are untouched.
4. **Repo audit:** a temp git repo with a dirty file, an unpushed commit and a push-request line gives the expected candidates, and the repo is unchanged afterwards (status/HEAD compared).
5. **Q&A one-at-a-time:** a question for project 2 stays queued and unmirrored while project 1 has open questions; answering project 1 promotes project 2.
6. **Q&A resume:** reopen the store from the same file and check that `current` returns the same project and questions.
7. **Answer history:** re-answering keeps the prior answer in the event history; a relayed answer stays pending until confirmed; a bridge reply with `correlation_id=qid` answers the question.
8. **Decision reuse:** a matching `decision_key` auto-answers, with `reused_from` set.
9. **Regression:** existing `pm/test.mjs` and `pm/bridge/test.mjs` stay green.

## 7. Merge limit

- Commit locally only, on `blitz/02-discovery-qa` in the worktree.
- **Never push.**
- **Queueing needs a decision.** The gatekeeper helper (`queue-build.mjs`) requires a matching upstream. This branch has none, and the brain's `main` is auto-pushed by brain-sync. So "queue through the gatekeeper" means that, after review, the user picks one of two routes:
  - (a) merge the branch into brain `main` at a chosen moment, which brain-sync then pushes and `DEPLOY-PM-UPDATE` deploys on ndi2; or
  - (b) create a remote branch for the gatekeeper to push.
- Either route is a separate authorization. BLITZ-02 stops at "committed on the local branch, tests green, evidence attached to T-dddde3c9".

## 8. Effort and ETA (estimated, no past run to measure)

| Step | Duration |
|---|---|
| Implementation and tests | ~2.5 h |
| Review and evidence | ~0.5 h |
| **Total** | **~3 h** from approval |

If approved at 06:30Z (23:30 PDT), it should be done about 09:30Z (02:30 PDT).
