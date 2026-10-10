// Agent Project Manager - storage and service layer.
// Every mutation is attributed (actor + model), recorded in the append-only
// events table, and runs inside one IMMEDIATE transaction, so claims are atomic.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

export const STATUSES = ['todo', 'in_progress', 'review', 'blocked', 'uncertain', 'done']
export const ARTIFACT_KINDS = ['brief', 'commit', 'file', 'url', 'evidence', 'run']
export const DEFAULT_LEASE_SECONDS = 900

// Operational vocabulary the control surface shows and the runners act on.
// `status` stays the storage vocabulary - the board UI, the MCP tool table and
// test.mjs all depend on it - and `lifecycle` is derived from it unless a
// runner has set one explicitly.
export const LIFECYCLES = ['READY', 'RUNNING', 'PAUSED', 'WAITING', 'BLOCKED', 'VERIFY', 'FAILED', 'COMPLETE', 'ARCHIVED']
export const RUN_KINDS = ['dsh-council', 'dsh-pipeline', 'claude-code', 'shell']
export const RUN_STATES = ['requested', 'starting', 'running', 'held', 'done', 'failed', 'cancelled']

// Columns added after v1. All nullable, so an existing pm.db upgrades in place
// with ALTER TABLE and no data rewrite.
export const OP_FIELDS = [
  'lifecycle', 'kind', 'origin_machine', 'execution_machine', 'run_ref', 'session_ref',
  'agent', 'provider', 'model_id', 'checkpoint', 'next_action', 'blockers', 'source_ref', 'meta',
]

export function lifecycleFor(task, leaseIsHeld = false) {
  if (task.lifecycle) return task.lifecycle
  switch (task.status) {
    case 'todo': return 'READY'
    case 'in_progress': return leaseIsHeld ? 'RUNNING' : 'PAUSED'
    case 'review': return 'VERIFY'
    case 'blocked': return 'BLOCKED'
    case 'uncertain': return 'PAUSED'
    case 'done': return 'COMPLETE'
    default: return 'READY'
  }
}

export class PmError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export function defaultDbPath() {
  return process.env.PM_DB || join(homedir(), '.claude', 'pm-data', 'pm.db')
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active', rev INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 2, assignee TEXT,
  claimed_by TEXT, claim_model TEXT, lease_until TEXT,
  rev INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id, status, priority);
CREATE INDEX IF NOT EXISTS tasks_lease ON tasks(lease_until) WHERE claimed_by IS NOT NULL;
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'instruction')), body TEXT NOT NULL,
  actor TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL, acked_by TEXT, acked_at TEXT);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL, ref TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, model TEXT,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS events_entity ON events(entity, entity_id);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL, machine TEXT NOT NULL, external_id TEXT, state TEXT NOT NULL DEFAULT 'requested',
  started_at TEXT, ended_at TEXT, last_checkpoint TEXT, detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS runs_task ON runs(task_id, state);
CREATE INDEX IF NOT EXISTS runs_machine ON runs(machine, state);
CREATE TABLE IF NOT EXISTS runners (
  id TEXT PRIMARY KEY, machine TEXT NOT NULL, capabilities TEXT NOT NULL DEFAULT '{}',
  pid INTEGER, started_at TEXT NOT NULL, last_seen TEXT NOT NULL);
`

// Run columns added for the Phase 4 machine runner. `owner` is the runner that
// holds the run; the cancel columns make cancellation a request the runner
// must acknowledge, so pm never reports a termination it did not observe.
export const RUN_OP_FIELDS = ['owner', 'pid', 'exit_code', 'cancel_requested_at', 'cancel_requested_by', 'cancel_reason', 'cancel_acked_at']
const ENDED = ['done', 'failed', 'cancelled']
/** Run kinds a machine runner may hold. DSH runs go through actions.mjs prepare/start with a user-picked roster, never a runner. */
export const RUNNER_KINDS = ['shell', 'claude-code']

// v1 databases predate the operational columns. Add what is missing, then give
// every existing row a lifecycle so the control surface never shows a blank.
function migrate(db) {
  const have = new Set(db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((r) => r.name))
  const added = []
  for (const col of OP_FIELDS) {
    if (have.has(col)) continue
    db.exec(`ALTER TABLE tasks ADD COLUMN ${col} TEXT`)
    added.push(col)
  }
  if (added.includes('lifecycle')) {
    db.exec(`UPDATE tasks SET lifecycle = CASE status
      WHEN 'todo' THEN 'READY' WHEN 'in_progress' THEN 'PAUSED' WHEN 'review' THEN 'VERIFY'
      WHEN 'blocked' THEN 'BLOCKED' WHEN 'uncertain' THEN 'PAUSED' WHEN 'done' THEN 'COMPLETE'
      ELSE 'READY' END WHERE lifecycle IS NULL`)
  }
  if (added.includes('meta')) db.exec("UPDATE tasks SET meta = '{}' WHERE meta IS NULL")
  const haveRun = new Set(db.prepare("SELECT name FROM pragma_table_info('runs')").all().map((r) => r.name))
  for (const col of RUN_OP_FIELDS) {
    if (haveRun.has(col)) continue
    db.exec(`ALTER TABLE runs ADD COLUMN ${col} ${col === 'pid' || col === 'exit_code' ? 'INTEGER' : 'TEXT'}`)
    added.push(`runs.${col}`)
  }
  db.exec('CREATE INDEX IF NOT EXISTS runs_owner ON runs(owner, state)')
  db.exec('CREATE INDEX IF NOT EXISTS tasks_source ON tasks(source_ref)')
  db.exec('CREATE INDEX IF NOT EXISTS tasks_machine ON tasks(execution_machine, lifecycle)')
  return added
}

const plain = (row) => (row ? { ...row } : row)
const plainAll = (rows) => rows.map((r) => ({ ...r }))

export function openStore(path = defaultDbPath(), { clock = () => new Date() } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)
  migrate(db)

  const now = () => clock().toISOString()
  const later = (seconds) => new Date(clock().getTime() + seconds * 1000).toISOString()
  const newId = (prefix) => `${prefix}-${randomBytes(4).toString('hex')}`

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  function who(w) {
    const actor = typeof w?.actor === 'string' ? w.actor.trim() : ''
    if (!actor) throw new PmError(400, 'actor is required: name who is making this change (for an agent, its model name)')
    const model = typeof w.model === 'string' && w.model.trim() ? w.model.trim() : null
    return { actor, model }
  }

  function event(w, entity, entityId, action, data = {}) {
    db.prepare('INSERT INTO events (at, actor, model, entity, entity_id, action, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(now(), w.actor, w.model, entity, entityId, action, JSON.stringify(data))
  }

  function taskRow(id) {
    const row = plain(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
    if (!row) throw new PmError(404, `no task ${id}`)
    return row
  }

  function projectRow(ref) {
    const row = plain(db.prepare('SELECT * FROM projects WHERE id = ? OR name = ?').get(ref, ref))
    if (!row) throw new PmError(404, `no project ${ref}`)
    return row
  }

  function leaseHeld(task, at = now()) {
    return task.claimed_by && task.lease_until && task.lease_until > at
  }

  function checkStatus(status) {
    if (!STATUSES.includes(status)) throw new PmError(400, `status must be one of ${STATUSES.join(', ')}`)
  }

  function checkLifecycle(lifecycle) {
    if (!LIFECYCLES.includes(lifecycle)) throw new PmError(400, `lifecycle must be one of ${LIFECYCLES.join(', ')}`)
  }

  // `meta` and `blockers` are allowed in as objects/arrays for caller convenience.
  function coerce(key, value) {
    if (value === null || value === undefined) return null
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  function opFields(spec, status) {
    const out = {}
    for (const k of OP_FIELDS) if (k in spec) out[k] = coerce(k, spec[k])
    if (out.lifecycle) checkLifecycle(out.lifecycle)
    else out.lifecycle = lifecycleFor({ status }, false)
    if (!out.meta) out.meta = '{}'
    return out
  }

  // Expired leases become `uncertain`, never `failed`: the worker may have
  // finished and not reported, so a human or agent must reconcile.
  function reconcile() {
    const at = now()
    const expired = plainAll(db.prepare('SELECT * FROM tasks WHERE claimed_by IS NOT NULL AND lease_until <= ?').all(at))
    if (!expired.length) return []
    return tx(() => {
      const sys = { actor: 'reconciler', model: null }
      for (const t of expired) {
        const status = t.status === 'in_progress' ? 'uncertain' : t.status
        db.prepare('UPDATE tasks SET claimed_by = NULL, claim_model = NULL, lease_until = NULL, status = ?, rev = rev + 1, updated_at = ? WHERE id = ?')
          .run(status, at, t.id)
        event(sys, 'task', t.id, 'lease_expired', { holder: t.claimed_by, model: t.claim_model, lease_until: t.lease_until, status })
      }
      return expired.map((t) => t.id)
    })
  }

  const api = {
    path,
    close: () => db.close(),
    reconcile,

    /** Record an event raised outside pm's own tables (the bridge's delivery escalations). */
    recordEvent(w, entity, entityId, action, data = {}) {
      event(who(w), entity, entityId ?? null, action, data)
    },

    listProjects() {
      return plainAll(db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
        FROM projects p ORDER BY p.name`).all())
    },

    createProject(w, { name, description = '' } = {}) {
      w = who(w)
      if (!name?.trim()) throw new PmError(400, 'name is required')
      return tx(() => {
        if (db.prepare('SELECT 1 FROM projects WHERE name = ?').get(name.trim())) throw new PmError(409, `project ${name} already exists`)
        const id = newId('P')
        const at = now()
        db.prepare('INSERT INTO projects (id, name, description, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, name.trim(), description, at, w.actor, at)
        event(w, 'project', id, 'created', { name: name.trim() })
        return projectRow(id)
      })
    },

    listTasks({ project, status, claimed_by, q, lifecycle, kind, origin_machine, execution_machine, source_ref, limit = 500 } = {}) {
      const where = []
      const args = []
      if (project) { where.push('project_id = ?'); args.push(projectRow(project).id) }
      if (status) { where.push('status = ?'); args.push(status) }
      if (claimed_by) { where.push('claimed_by = ?'); args.push(claimed_by) }
      if (lifecycle) { where.push('lifecycle = ?'); args.push(lifecycle) }
      if (kind) { where.push('kind = ?'); args.push(kind) }
      if (origin_machine) { where.push('origin_machine = ?'); args.push(origin_machine) }
      if (execution_machine) { where.push('execution_machine = ?'); args.push(execution_machine) }
      if (source_ref) { where.push('source_ref = ?'); args.push(source_ref) }
      if (q) { where.push('(title LIKE ? OR body LIKE ?)'); args.push(`%${q}%`, `%${q}%`) }
      const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY priority, created_at LIMIT ?`
      return plainAll(db.prepare(sql).all(...args, Math.min(Number(limit) || 500, 5000)))
    },

    getTask(id) {
      const task = taskRow(id)
      task.runs = plainAll(db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at').all(id))
        .map((r) => ({ ...r, detail: JSON.parse(r.detail || '{}') }))
      task.project = plain(db.prepare('SELECT id, name FROM projects WHERE id = ?').get(task.project_id))
      task.comments = plainAll(db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY id').all(id))
      task.artifacts = plainAll(db.prepare('SELECT * FROM artifacts WHERE task_id = ? ORDER BY id').all(id))
      task.history = plainAll(db.prepare("SELECT * FROM events WHERE entity = 'task' AND entity_id = ? ORDER BY id").all(id))
        .map((e) => ({ ...e, data: JSON.parse(e.data) }))
      return task
    },

    createTask(w, spec = {}) {
      w = who(w)
      const { project, title, body = '', priority = 2, assignee = null, status = 'todo' } = spec
      if (!title?.trim()) throw new PmError(400, 'title is required')
      checkStatus(status)
      const op = opFields(spec, status)
      return tx(() => {
        const p = projectRow(project)
        const id = newId('T')
        const at = now()
        const cols = ['id', 'project_id', 'title', 'body', 'status', 'priority', 'assignee', 'created_at', 'created_by', 'updated_at', ...Object.keys(op)]
        const vals = [id, p.id, title.trim(), body, status, Number(priority) || 2, assignee, at, w.actor, at, ...Object.values(op)]
        db.prepare(`INSERT INTO tasks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals)
        event(w, 'task', id, 'created', { project: p.name, title: title.trim(), priority: Number(priority) || 2, ...op })
        return taskRow(id)
      })
    },

    // Idempotent import path for the connectors: one task per source_ref, updated
    // in place on a re-sync instead of duplicated.
    upsertBySource(w, spec = {}) {
      w = who(w)
      const ref = spec.source_ref?.trim()
      if (!ref) throw new PmError(400, 'source_ref is required')
      const existing = plain(db.prepare('SELECT * FROM tasks WHERE source_ref = ?').get(ref))
      if (!existing) return { action: 'created', task: api.createTask(w, spec) }
      const changes = { rev: existing.rev }
      for (const k of ['title', 'body', 'status', 'priority', ...OP_FIELDS]) {
        if (k in spec && spec[k] !== null && spec[k] !== undefined && String(spec[k]) !== String(existing[k] ?? '')) changes[k] = spec[k]
      }
      if (Object.keys(changes).length === 1) return { action: 'unchanged', task: existing }
      return { action: 'updated', task: api.updateTask(w, existing.id, changes) }
    },

    // Optimistic concurrency: the caller names the revision it edited. A stale
    // revision is rejected with the current row AND the rejected fields, so the
    // losing edit is offered back for merge rather than lost.
    updateTask(w, id, changes = {}) {
      w = who(w)
      const fields = ['title', 'body', 'status', 'priority', 'assignee', ...OP_FIELDS].filter((k) => k in changes)
      if (!fields.length) throw new PmError(400, 'nothing to change')
      if (changes.rev === undefined) throw new PmError(400, 'rev is required: pass the revision you edited')
      if ('status' in changes) checkStatus(changes.status)
      if (changes.lifecycle) checkLifecycle(changes.lifecycle)
      return tx(() => {
        const current = taskRow(id)
        if (Number(changes.rev) !== current.rev) {
          const rejected = Object.fromEntries(fields.map((k) => [k, changes[k]]))
          throw new PmError(409, `task ${id} changed since revision ${changes.rev} (now ${current.rev})`, { current, rejected })
        }
        const before = Object.fromEntries(fields.map((k) => [k, current[k]]))
        const sets = fields.map((k) => `${k} = ?`).join(', ')
        db.prepare(`UPDATE tasks SET ${sets}, rev = rev + 1, updated_at = ? WHERE id = ?`)
          .run(...fields.map((k) => (k === 'priority' ? Number(changes[k]) : coerce(k, changes[k]))), now(), id)
        event(w, 'task', id, 'updated', { before, after: Object.fromEntries(fields.map((k) => [k, changes[k]])) })
        return taskRow(id)
      })
    },

    claimTask(w, id, { leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
      w = who(w)
      return tx(() => claimInTx(w, taskRow(id), leaseSeconds))
    },

    // Atomically claim the highest-priority unclaimed open task. Two workers
    // calling this at once get different tasks, never the same one.
    claimNext(w, { project, leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
      w = who(w)
      return tx(() => {
        const args = [now()]
        let sql = "SELECT * FROM tasks WHERE status IN ('todo', 'uncertain') AND (claimed_by IS NULL OR lease_until <= ?)"
        if (project) { sql += ' AND project_id = ?'; args.push(projectRow(project).id) }
        sql += " AND (assignee IS NULL OR assignee = ?) ORDER BY CASE status WHEN 'uncertain' THEN 1 ELSE 0 END, priority, created_at LIMIT 1"
        args.push(w.actor)
        const row = plain(db.prepare(sql).get(...args))
        return row ? claimInTx(w, row, leaseSeconds) : null
      })
    },

    heartbeat(w, id, { leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
      w = who(w)
      return tx(() => {
        const t = taskRow(id)
        if (!leaseHeld(t) || t.claimed_by !== w.actor) throw new PmError(409, `${w.actor} does not hold the lease on ${id}`, { current: t })
        db.prepare('UPDATE tasks SET lease_until = ?, updated_at = ? WHERE id = ?').run(later(leaseSeconds), now(), id)
        return taskRow(id)
      })
    },

    releaseTask(w, id, { status, brief, force = false } = {}) {
      w = who(w)
      if (status) checkStatus(status)
      return tx(() => {
        const t = taskRow(id)
        if (!t.claimed_by) throw new PmError(409, `${id} is not claimed`)
        if (t.claimed_by !== w.actor && !force) throw new PmError(409, `${id} is claimed by ${t.claimed_by}; pass force to take it back`, { current: t })
        const next = status || (t.status === 'in_progress' ? 'todo' : t.status)
        db.prepare('UPDATE tasks SET claimed_by = NULL, claim_model = NULL, lease_until = NULL, status = ?, rev = rev + 1, updated_at = ? WHERE id = ?')
          .run(next, now(), id)
        if (brief) addArtifactInTx(w, id, { kind: 'brief', ref: 'continuation', note: brief })
        event(w, 'task', id, 'released', { holder: t.claimed_by, status: next, forced: t.claimed_by !== w.actor })
        return taskRow(id)
      })
    },

    addComment(w, id, { body, kind = 'comment' } = {}) {
      w = who(w)
      if (!body?.trim()) throw new PmError(400, 'body is required')
      if (!['comment', 'instruction'].includes(kind)) throw new PmError(400, 'kind must be comment or instruction')
      return tx(() => {
        taskRow(id)
        const r = db.prepare('INSERT INTO comments (task_id, kind, body, actor, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, kind, body, w.actor, w.model, now())
        event(w, 'task', id, kind === 'instruction' ? 'instruction_added' : 'commented', { comment_id: Number(r.lastInsertRowid) })
        return plain(db.prepare('SELECT * FROM comments WHERE id = ?').get(r.lastInsertRowid))
      })
    },

    ackInstruction(w, commentId) {
      w = who(w)
      return tx(() => {
        const c = plain(db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId))
        if (!c) throw new PmError(404, `no comment ${commentId}`)
        if (c.kind !== 'instruction') throw new PmError(400, 'only instructions are acknowledged')
        if (c.acked_by) throw new PmError(409, `already acknowledged by ${c.acked_by}`)
        db.prepare('UPDATE comments SET acked_by = ?, acked_at = ? WHERE id = ?').run(w.actor, now(), commentId)
        event(w, 'task', c.task_id, 'instruction_acked', { comment_id: c.id })
        return plain(db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId))
      })
    },

    addArtifact(w, id, spec = {}) {
      w = who(w)
      return tx(() => {
        taskRow(id)
        return addArtifactInTx(w, id, spec)
      })
    },

    // A run is one attempt to execute a task on one machine. It is the handle a
    // resume uses, so it outlives the process that created it.
    startRun(w, taskId, { kind, machine, external_id = null, state = 'requested', detail = {} } = {}) {
      w = who(w)
      if (!RUN_KINDS.includes(kind)) throw new PmError(400, `kind must be one of ${RUN_KINDS.join(', ')}`)
      if (!machine?.trim()) throw new PmError(400, 'machine is required')
      if (!RUN_STATES.includes(state)) throw new PmError(400, `state must be one of ${RUN_STATES.join(', ')}`)
      return tx(() => {
        const t = taskRow(taskId)
        if (t.execution_machine && t.execution_machine !== machine) {
          throw new PmError(409, `${taskId} executes on ${t.execution_machine}, not ${machine}`, { current: t })
        }
        const id = newId('R')
        const at = now()
        db.prepare('INSERT INTO runs (id, task_id, kind, machine, external_id, state, started_at, detail, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, taskId, kind, machine, external_id, state, at, JSON.stringify(detail), at, w.actor, at)
        db.prepare('UPDATE tasks SET run_ref = ?, execution_machine = COALESCE(execution_machine, ?), rev = rev + 1, updated_at = ? WHERE id = ?')
          .run(id, machine, at, taskId)
        event(w, 'task', taskId, 'run_started', { run: id, kind, machine, external_id })
        return plain(db.prepare('SELECT * FROM runs WHERE id = ?').get(id))
      })
    },

    updateRun(w, runId, { state, external_id, last_checkpoint, detail } = {}) {
      w = who(w)
      if (state && !RUN_STATES.includes(state)) throw new PmError(400, `state must be one of ${RUN_STATES.join(', ')}`)
      return tx(() => {
        const r = plain(db.prepare('SELECT * FROM runs WHERE id = ?').get(runId))
        if (!r) throw new PmError(404, `no run ${runId}`)
        const at = now()
        const sets = []
        const args = []
        if (state) { sets.push('state = ?'); args.push(state) }
        if (external_id !== undefined) { sets.push('external_id = ?'); args.push(external_id) }
        if (last_checkpoint !== undefined) { sets.push('last_checkpoint = ?'); args.push(last_checkpoint) }
        if (detail !== undefined) { sets.push('detail = ?'); args.push(JSON.stringify(detail)) }
        if (state && ['done', 'failed', 'cancelled'].includes(state)) { sets.push('ended_at = ?'); args.push(at) }
        if (!sets.length) throw new PmError(400, 'nothing to change')
        db.prepare(`UPDATE runs SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, at, runId)
        if (last_checkpoint !== undefined) {
          db.prepare('UPDATE tasks SET checkpoint = ?, updated_at = ? WHERE id = ?').run(last_checkpoint, at, r.task_id)
        }
        event(w, 'task', r.task_id, 'run_updated', { run: runId, state: state ?? r.state, external_id, last_checkpoint })
        return plain(db.prepare('SELECT * FROM runs WHERE id = ?').get(runId))
      })
    },

    listRuns({ task_id, machine, state, owner, limit = 200 } = {}) {
      const where = []
      const args = []
      if (task_id) { where.push('task_id = ?'); args.push(task_id) }
      if (owner) { where.push('owner = ?'); args.push(owner) }
      if (machine) { where.push('machine = ?'); args.push(machine) }
      if (state) { where.push('state = ?'); args.push(state) }
      const sql = `SELECT * FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`
      return plainAll(db.prepare(sql).all(...args, Math.min(Number(limit) || 200, 2000)))
        .map((r) => ({ ...r, detail: JSON.parse(r.detail || '{}') }))
    },

    getRun(runId) {
      const r = runRow(runId)
      return { ...r, detail: JSON.parse(r.detail || '{}') }
    },

    // ----- Phase 4: the machine runner -------------------------------------
    // A runner is a process on one machine that claims work routed to it,
    // prepares an isolated workspace, keeps the lease alive and acknowledges
    // cancellation. It never starts a DSH run and never spawns a session on
    // its own: spawning is a separate command the user types (runner.mjs spawn).

    registerRunner(w, { machine, capabilities = {}, pid = null } = {}) {
      w = who(w)
      if (!machine?.trim()) throw new PmError(400, 'machine is required')
      return tx(() => {
        const at = now()
        db.prepare(`INSERT INTO runners (id, machine, capabilities, pid, started_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET machine = excluded.machine, capabilities = excluded.capabilities, pid = excluded.pid,
          started_at = excluded.started_at, last_seen = excluded.last_seen`)
          .run(w.actor, machine.trim(), JSON.stringify(capabilities), pid == null ? null : Number(pid), at, at)
        event(w, 'runner', w.actor, 'registered', { machine: machine.trim(), capabilities, pid })
        return runnerRow(w.actor)
      })
    },

    listRunners() {
      return plainAll(db.prepare('SELECT * FROM runners ORDER BY machine, id').all())
        .map((r) => ({ ...r, capabilities: JSON.parse(r.capabilities || '{}') }))
    },

    // Claim one task routed to this runner and open a held run for it, in one
    // transaction. Two gates, both explicit: the task's assignee must be this
    // runner, and its execution_machine must be one of this machine's names.
    // Nothing unassigned is ever taken, so tasks agents pull by hand stay theirs.
    // DSH kinds are never taken: they start only through prepare/start.
    claimForRunner(w, { machines, leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
      w = who(w)
      const names = (Array.isArray(machines) ? machines : String(machines ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean)
      if (!names.length) throw new PmError(400, 'machines is required: the names this runner answers to')
      return tx(() => {
        touchRunner(w)
        const at = now()
        const row = plain(db.prepare(`SELECT * FROM tasks WHERE status = 'todo' AND assignee = ?
          AND execution_machine IN (${names.map(() => '?').join(', ')})
          AND (claimed_by IS NULL OR lease_until <= ?)
          AND COALESCE(lifecycle, '') != 'ARCHIVED'
          AND (kind IS NULL OR kind NOT IN ('dsh-council', 'dsh-pipeline'))
          ORDER BY priority, created_at LIMIT 1`).get(w.actor, ...names, at))
        if (!row) return null
        const task = claimInTx(w, row, leaseSeconds)
        const kind = RUNNER_KINDS.includes(task.kind) ? task.kind : 'shell'
        const id = newId('R')
        db.prepare(`INSERT INTO runs (id, task_id, kind, machine, state, started_at, detail, created_at, created_by, updated_at, owner)
          VALUES (?, ?, ?, ?, 'held', ?, '{}', ?, ?, ?, ?)`).run(id, task.id, kind, task.execution_machine, at, at, w.actor, at, w.actor)
        db.prepare("UPDATE tasks SET run_ref = ?, lifecycle = 'WAITING', rev = rev + 1, updated_at = ? WHERE id = ?").run(id, at, task.id)
        event(w, 'task', task.id, 'runner_claimed', { run: id, kind, machine: task.execution_machine })
        return { task: taskRow(task.id), run: runRow(id) }
      })
    },

    // After a runner restart: take back a run it still owns, provided nobody
    // else has the task and the task still points at this run. Relaunches nothing.
    reattachRun(w, runId, { leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
      w = who(w)
      return tx(() => {
        const r = runRow(runId)
        const t = taskRow(r.task_id)
        const reasons = []
        if (r.owner !== w.actor) reasons.push(`run ${runId} is owned by ${r.owner ?? 'nobody'}`)
        if (ENDED.includes(r.state)) reasons.push(`run ${runId} already ended (${r.state})`)
        if (t.run_ref !== runId) reasons.push(`task ${t.id} has moved to run ${t.run_ref}`)
        if (t.assignee !== w.actor) reasons.push(`task ${t.id} is assigned to ${t.assignee ?? 'nobody'}`)
        if (!['in_progress', 'uncertain'].includes(t.status)) reasons.push(`task ${t.id} is ${t.status}`)
        if (leaseHeld(t) && t.claimed_by !== w.actor) reasons.push(`task ${t.id} is claimed by ${t.claimed_by}`)
        if (reasons.length) throw new PmError(409, `reattach refused: ${reasons.join('; ')}`, { run: r, current: t, reasons })
        touchRunner(w)
        claimInTx(w, t, leaseSeconds)
        event(w, 'task', t.id, 'runner_reattached', { run: runId, state: r.state })
        return { task: taskRow(t.id), run: runRow(runId) }
      })
    },

    // Extend the lease through the run. Answers with what the runner must act
    // on: a pending cancel and unacknowledged instructions.
    runnerHeartbeat(w, runId, { leaseSeconds = DEFAULT_LEASE_SECONDS, checkpoint } = {}) {
      w = who(w)
      return tx(() => {
        const { r, t } = fence(w, runId)
        const at = now()
        touchRunner(w)
        db.prepare('UPDATE tasks SET lease_until = ?, updated_at = ? WHERE id = ?').run(later(leaseSeconds), at, t.id)
        if (checkpoint !== undefined) {
          db.prepare('UPDATE runs SET last_checkpoint = ?, updated_at = ? WHERE id = ?').run(String(checkpoint), at, runId)
          db.prepare('UPDATE tasks SET checkpoint = ? WHERE id = ?').run(String(checkpoint), t.id)
        }
        const instructions = plainAll(db.prepare("SELECT * FROM comments WHERE task_id = ? AND kind = 'instruction' AND acked_by IS NULL ORDER BY id").all(t.id))
        return { task: taskRow(t.id), run: runRow(runId), cancel_requested: Boolean(r.cancel_requested_at), instructions }
      })
    },

    // Runner-side run update (held -> starting -> running, pid, workspace detail).
    // Fenced: a runner that lost the task cannot write to it.
    runnerUpdate(w, runId, { state, pid, detail, last_checkpoint } = {}) {
      w = who(w)
      if (state && !['held', 'starting', 'running'].includes(state)) throw new PmError(400, 'runner-update moves a run between held, starting and running; use finish or cancel-ack to end it')
      return tx(() => {
        const { r, t } = fence(w, runId)
        if (state && state !== 'held' && r.cancel_requested_at) throw new PmError(409, `run ${runId} has a cancel pending; acknowledge it instead of starting`, { run: r })
        const at = now()
        const sets = []
        const args = []
        if (state) { sets.push('state = ?'); args.push(state) }
        if (pid !== undefined) { sets.push('pid = ?'); args.push(pid == null ? null : Number(pid)) }
        if (detail !== undefined) { sets.push('detail = ?'); args.push(JSON.stringify({ ...JSON.parse(r.detail || '{}'), ...detail })) }
        if (last_checkpoint !== undefined) { sets.push('last_checkpoint = ?'); args.push(String(last_checkpoint)) }
        if (!sets.length) throw new PmError(400, 'nothing to change')
        db.prepare(`UPDATE runs SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, at, runId)
        if (state === 'running') db.prepare("UPDATE tasks SET lifecycle = 'RUNNING', rev = rev + 1, updated_at = ? WHERE id = ?").run(at, t.id)
        event(w, 'task', t.id, 'run_updated', { run: runId, state: state ?? r.state, pid, last_checkpoint })
        return runRow(runId)
      })
    },

    // Anyone may ask; only the holding runner may acknowledge. Until it does the
    // run keeps its state and `cancel_requested_at` is the only thing that changed.
    requestCancel(w, runId, { reason = '' } = {}) {
      w = who(w)
      return tx(() => {
        const r = runRow(runId)
        if (ENDED.includes(r.state)) throw new PmError(409, `run ${runId} already ended (${r.state})`, { run: r })
        if (r.cancel_requested_at) return runRow(runId)
        const at = now()
        db.prepare('UPDATE runs SET cancel_requested_at = ?, cancel_requested_by = ?, cancel_reason = ?, updated_at = ? WHERE id = ?')
          .run(at, w.actor, reason, at, runId)
        event(w, 'task', r.task_id, 'cancel_requested', { run: runId, reason })
        return runRow(runId)
      })
    },

    cancelAck(w, runId, { observed = '' } = {}) {
      w = who(w)
      return tx(() => {
        const { r, t } = fence(w, runId)
        if (!r.cancel_requested_at) throw new PmError(409, `run ${runId} has no cancel request to acknowledge`, { run: r })
        const at = now()
        db.prepare("UPDATE runs SET state = 'cancelled', cancel_acked_at = ?, ended_at = ?, last_checkpoint = ?, updated_at = ? WHERE id = ?")
          .run(at, at, `cancel acknowledged: ${observed || 'observed'}`, at, runId)
        // Unassigned on the way out, so the runner does not take it straight back.
        db.prepare("UPDATE tasks SET claimed_by = NULL, claim_model = NULL, lease_until = NULL, assignee = NULL, status = 'todo', lifecycle = 'READY', rev = rev + 1, updated_at = ? WHERE id = ?")
          .run(at, t.id)
        event(w, 'task', t.id, 'cancel_acked', { run: runId, observed, requested_by: r.cancel_requested_by })
        return { run: runRow(runId), task: taskRow(t.id) }
      })
    },

    // The run ended on its own. A zero exit goes to review; anything else is
    // FAILED for a human to look at - never retried by the runner.
    finishRun(w, runId, { exit_code = null, note = '' } = {}) {
      w = who(w)
      return tx(() => {
        const { t } = fence(w, runId)
        const at = now()
        const code = exit_code == null ? null : Number(exit_code)
        const state = code === 0 ? 'done' : 'failed'
        db.prepare('UPDATE runs SET state = ?, exit_code = ?, ended_at = ?, last_checkpoint = ?, updated_at = ? WHERE id = ?')
          .run(state, code, at, `exit ${code ?? 'unknown'}${note ? ': ' + note : ''}`, at, runId)
        const status = state === 'done' ? 'review' : 'blocked'
        const lifecycle = state === 'done' ? 'VERIFY' : 'FAILED'
        db.prepare('UPDATE tasks SET claimed_by = NULL, claim_model = NULL, lease_until = NULL, status = ?, lifecycle = ?, rev = rev + 1, updated_at = ? WHERE id = ?')
          .run(status, lifecycle, at, t.id)
        addArtifactInTx(w, t.id, { kind: 'evidence', ref: `run ${runId} exit ${code ?? 'unknown'}`, note })
        event(w, 'task', t.id, 'run_finished', { run: runId, state, exit_code: code })
        return { run: runRow(runId), task: taskRow(t.id) }
      })
    },

    events({ since = 0, limit = 200 } = {}) {
      return plainAll(db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?').all(Number(since) || 0, Math.min(Number(limit) || 200, 2000)))
        .map((e) => ({ ...e, data: JSON.parse(e.data) }))
    },

    backup(dest) {
      if (!dest) throw new PmError(400, 'dest is required')
      if (existsSync(dest)) throw new PmError(409, `${dest} already exists`)
      mkdirSync(dirname(dest), { recursive: true })
      db.prepare('VACUUM INTO ?').run(dest)
      return { dest }
    },
  }

  function runRow(id) {
    const row = plain(db.prepare('SELECT * FROM runs WHERE id = ?').get(id))
    if (!row) throw new PmError(404, `no run ${id}`)
    return row
  }

  function runnerRow(id) {
    const r = plain(db.prepare('SELECT * FROM runners WHERE id = ?').get(id))
    return r ? { ...r, capabilities: JSON.parse(r.capabilities || '{}') } : r
  }

  function touchRunner(w) {
    db.prepare('UPDATE runners SET last_seen = ? WHERE id = ?').run(now(), w.actor)
  }

  // The stale-writer fence: a runner writes to a run only while it owns the run,
  // the task still points at it, and it still holds the task's lease.
  function fence(w, runId) {
    const r = runRow(runId)
    const t = taskRow(r.task_id)
    const reasons = []
    if (r.owner !== w.actor) reasons.push(`run ${runId} is owned by ${r.owner ?? 'nobody'}, not ${w.actor}`)
    if (ENDED.includes(r.state)) reasons.push(`run ${runId} already ended (${r.state})`)
    if (t.run_ref !== runId) reasons.push(`task ${t.id} has moved to run ${t.run_ref}`)
    if (!leaseHeld(t) || t.claimed_by !== w.actor) reasons.push(`${w.actor} no longer holds the lease on ${t.id}`)
    if (reasons.length) throw new PmError(409, `stale runner write refused: ${reasons.join('; ')}`, { run: r, current: t, reasons })
    return { r, t }
  }

  function claimInTx(w, t, leaseSeconds) {
    if (t.status === 'done') throw new PmError(409, `${t.id} is done`)
    if (leaseHeld(t) && t.claimed_by !== w.actor) {
      throw new PmError(409, `${t.id} is claimed by ${t.claimed_by} until ${t.lease_until}`, { current: t })
    }
    const status = ['todo', 'uncertain', 'blocked'].includes(t.status) ? 'in_progress' : t.status
    db.prepare('UPDATE tasks SET claimed_by = ?, claim_model = ?, lease_until = ?, status = ?, rev = rev + 1, updated_at = ? WHERE id = ?')
      .run(w.actor, w.model, later(Number(leaseSeconds) || DEFAULT_LEASE_SECONDS), status, now(), t.id)
    event(w, 'task', t.id, 'claimed', { lease_seconds: Number(leaseSeconds) || DEFAULT_LEASE_SECONDS, previous_status: t.status })
    return taskRow(t.id)
  }

  function addArtifactInTx(w, id, { kind, ref, note = '' }) {
    if (!ARTIFACT_KINDS.includes(kind)) throw new PmError(400, `kind must be one of ${ARTIFACT_KINDS.join(', ')}`)
    if (!ref?.trim()) throw new PmError(400, 'ref is required')
    const r = db.prepare('INSERT INTO artifacts (task_id, kind, ref, note, actor, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, kind, ref.trim(), note, w.actor, w.model, now())
    event(w, 'task', id, 'artifact_added', { artifact_id: Number(r.lastInsertRowid), kind, ref: ref.trim() })
    return plain(db.prepare('SELECT * FROM artifacts WHERE id = ?').get(r.lastInsertRowid))
  }

  return api
}
