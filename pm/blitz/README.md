# pm/blitz — Blitz Complete backend (BLITZ-02 part)

Top-N ranking, hybrid work discovery, and project-by-project Q&A, as pm REST routes (`discovery-routes.mjs`; BLITZ-03 owns `routes.mjs`). Every write needs an actor (`x-pm-actor`), and every write that edits an existing record takes `rev`. Spec: `~/.claude/shared-brain/blitz/BLITZ-02-approval-request.md`.

## Top-N: `GET /api/blitz/top-projects?n=10[&projects=P-a,P-b]`

- Ranks active projects that have at least one open coding task.
- Rank keys, in order:
  0. manual Top order (`projects.sort_order`, set by the pm UI "Top order" sorter / `PUT /api/order/top`; NULL last)
  1. `projects.priority` (NULL last; set it with `PATCH /api/projects/:id {rev, priority}`)
  2. minimum open coding-task priority
  3. count of priority-1 open coding tasks
  4. count of open coding tasks
  5. oldest open task
  6. project id
- `projects=` takes ids or names. It replaces the ranking and keeps the caller's order. An unknown or archived project returns 400.
- Each row has an `inputs` field holding the values it was ranked on.

## Discovery: `POST /api/blitz/discover {projects?|n?, repos?, audits?, apply?}`

- **pm:** open tasks in the selected projects.
  - Excluded as noncoding: kinds `handoff`, `brain-project` and `other`, and any task with `meta.blitz.coding=false`.
  - `meta.blitz.coding=true` overrides the kind exclusion.
- **repo:** a read-only git audit. It finds uncommitted files, commits not yet on the upstream, and open `push-requests.md` entries for that repo folder.
  - Repos come from `repos: {<project>: [path]}` and from a task's `meta.repo`.
- **audit:** agent reports shaped `{agent, project, items:[{title, body?, evidence?, fingerprint?}]}`.
- **GitHub issues:** out of scope (`gh` is not authenticated). The ref form `gh:<owner>/<repo>#<n>` is reserved.
- **Dedupe:** by `source_ref`, then by normalized title within a project.
  - Ref forms: `pm:<task>`, `repo:<name>:<dirty|unpushed|push-request>:<fp>`, `audit:<agent>:<fp>`.
  - Every source is kept in `provenance[]`.
- **Dependencies:** `depends_on` comes from `meta.blitz.depends_on` and from `T-xxxxxxxx` mentions. They are reported only, not enforced.
- **Writes:** `apply:true` creates pm tasks for new candidates only, via `upsertBySource`. Existing tasks are never edited.

## Q&A (one project at a time)

| Route | Purpose |
|---|---|
| `POST /api/blitz/campaigns/:id/qa {project, task?, question, options?, decision_key?}` | ask |
| `PUT /api/blitz/campaigns/:id/qa/order {projects:[...]}` | set the project order (default: order first asked) |
| `GET /api/blitz/campaigns/:id/qa/current` | active project, its open questions, the queue behind it |
| `GET /api/blitz/qa?campaign=&project=&status=` | list |
| `GET /api/blitz/qa/:qid` | one question with its answer history |
| `POST /api/blitz/qa/:qid/answer {answer, rev?, relayed?, via?}` | answer or re-answer |
| `POST /api/blitz/qa/:qid/confirm` | confirm a relayed answer (direct callers only) |

- **Storage:** questions are kept in `blitz_questions`, and every answer is kept in `blitz_answers`.
- **pm comment:** a question on a task is also posted as a pm comment, `[blitz-question <qid>]`.
- **Bridge mirror:** only the current project's open questions are mirrored to a bridge message. The message goes to agent `BLITZ_QA_AGENT` (default `chatgpt`) with `correlation_id = qid`. A reply on that thread is recorded as an answer.
- **Relayed answers:**
  - These are bridge replies, answers from role-checked token principals, and answers sent with `relayed`/`via` in the body.
  - They stay `pending_confirm`, and the question stays open, until a direct caller confirms.
- **Decision reuse:** a new question whose `decision_key` matches a confirmed answer is auto-answered from it, with `reused_from` set. It can still be re-answered.

## Tests

`node --test blitz/blitz.test.mjs` runs from `pm/`. `pm/test.mjs` also imports these tests.
