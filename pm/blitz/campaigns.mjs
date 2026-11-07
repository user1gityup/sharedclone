// BLITZ-05 campaign store (Claude Opus 5.5). Durable state for the run controller:
//   blitz_campaigns       one row per campaign (projects, roster, schedule, state, rev)
//   blitz_campaign_tasks  the task snapshot taken at preflight and each task's lifecycle + lease
//   blitz_run_events      append-only timeline (triggers refuse UPDATE and DELETE)
//   blitz_idempotency     one row per idempotency key: a retried step returns the stored result
// Campaign ids match qa.mjs (/^[\w.-]{1,64}$/), so /api/blitz/campaigns/:id/qa keeps working
// for the same id. Every table is created idempotently on the store's own connection.
import { randomBytes } from 'node:crypto'
import { PmError } from '../store.mjs'

export const CAMPAIGN_STATES = ['draft', 'preflighted', 'launched', 'running', 'paused', 'completed', 'cancelled', 'failed']
export const TERMINAL_CAMPAIGN = ['completed', 'cancelled', 'failed']
export const TASK_STATES = ['pending', 'blocked', 'leased', 'running', 'awaiting_verification', 'verified', 'failed', 'escalated', 'cancelled']
export const ACTIVE_TASK = ['leased', 'running']
export const ID = /^[\w.-]{1,64}$/

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blitz_campaigns (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
  projects TEXT NOT NULL DEFAULT '[]', roster TEXT NOT NULL DEFAULT '[]', schedule TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'draft', rev INTEGER NOT NULL DEFAULT 1,
  authorized_by TEXT, authorized_at TEXT, cancel_requested_at TEXT, cancel_requested_by TEXT, cancel_reason TEXT,
  preflight TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS blitz_campaigns_state ON blitz_campaigns(state);
CREATE TABLE IF NOT EXISTS blitz_campaign_tasks (
  campaign_id TEXT NOT NULL, task_id TEXT NOT NULL, project_id TEXT NOT NULL,
  wave INTEGER, depends_on TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT 'pending', reason TEXT,
  agent TEXT, lease_owner TEXT, lease_until TEXT, attempt INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0, checkpoint TEXT, result TEXT, verification TEXT,
  rev INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, task_id));
CREATE INDEX IF NOT EXISTS blitz_campaign_tasks_state ON blitz_campaign_tasks(campaign_id, state);
CREATE TABLE IF NOT EXISTS blitz_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL, task_id TEXT, kind TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}', actor TEXT, idempotency_key TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS blitz_run_events_campaign ON blitz_run_events(campaign_id, id);
CREATE TRIGGER IF NOT EXISTS blitz_run_events_no_update BEFORE UPDATE ON blitz_run_events
  BEGIN SELECT RAISE(ABORT, 'blitz_run_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS blitz_run_events_no_delete BEFORE DELETE ON blitz_run_events
  BEGIN SELECT RAISE(ABORT, 'blitz_run_events is append-only'); END;
CREATE TABLE IF NOT EXISTS blitz_idempotency (
  key TEXT PRIMARY KEY, campaign_id TEXT, step TEXT NOT NULL, status TEXT NOT NULL,
  result TEXT, at TEXT NOT NULL, done_at TEXT);
`

export function migrate(db) {
  db.exec(SCHEMA)
  // avoid_agents (JSON list): per-task agents tick must not pick while another eligible agent exists (BLITZ-06 reassignment)
  const cols = db.prepare('PRAGMA table_info(blitz_campaign_tasks)').all().map((c) => c.name)
  if (!cols.includes('avoid_agents')) db.exec("ALTER TABLE blitz_campaign_tasks ADD COLUMN avoid_agents TEXT NOT NULL DEFAULT '[]'")
}

const json = (s, dflt) => { if (s == null) return dflt; try { return JSON.parse(s) } catch { return dflt } }

function campaignRow(r) {
  if (!r) return null
  return {
    ...r, projects: json(r.projects, []), roster: json(r.roster, []), schedule: json(r.schedule, {}),
    preflight: json(r.preflight, null), cancel_requested: Boolean(r.cancel_requested_at),
  }
}

function taskRow(r) {
  if (!r) return null
  return {
    ...r, depends_on: json(r.depends_on, []), cancel_requested: Boolean(r.cancel_requested),
    checkpoint: json(r.checkpoint, null), result: json(r.result, null), verification: json(r.verification, null),
    avoid_agents: json(r.avoid_agents, []),
  }
}

export function requireActor(w) {
  const actor = typeof w?.actor === 'string' ? w.actor.trim() : ''
  if (!actor) throw new PmError(400, 'actor is required (x-pm-actor)')
  return { actor, model: w.model ?? null }
}

/**
 * Low-level persistence. The controller is the only writer of state transitions; this
 * module enforces rev on campaign rows and append-only on events.
 * @param db node:sqlite handle (store.db)
 */
export function createCampaignStore(db, { clock = () => new Date(), onEvent = null } = {}) {
  migrate(db)
  const now = () => clock().toISOString()
  const newId = () => `C-${randomBytes(4).toString('hex')}`
  let depth = 0
  const pendingEvents = []

  /** Nested-safe transaction (savepoints inside an outer one). */
  function tx(fn) {
    const sp = `sp${depth}`
    db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`)
    depth++
    try {
      const out = fn()
      depth--
      db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`)
      if (depth === 0) flush()
      return out
    } catch (err) {
      depth--
      if (depth === 0) { db.exec('ROLLBACK'); pendingEvents.length = 0 } else db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`)
      throw err
    }
  }
  function flush() {
    const list = pendingEvents.splice(0)
    if (!onEvent) return
    for (const e of list) { try { onEvent(e) } catch { /* a hook never breaks the controller */ } }
  }

  const get = (id) => campaignRow(db.prepare('SELECT * FROM blitz_campaigns WHERE id = ?').get(id))

  const api = {
    db, tx, now,

    get(id) {
      const c = get(id)
      if (!c) throw new PmError(404, `no campaign ${id}`)
      return c
    },
    find: get,

    list({ state } = {}) {
      const rows = state
        ? db.prepare('SELECT * FROM blitz_campaigns WHERE state = ? ORDER BY created_at, id').all(state)
        : db.prepare('SELECT * FROM blitz_campaigns ORDER BY created_at, id').all()
      return rows.map(campaignRow)
    },

    insert(w, { id, title = '', projects, roster, schedule = {} }) {
      w = requireActor(w)
      const cid = id ?? newId()
      if (!ID.test(cid)) throw new PmError(400, 'campaign id must match [\\w.-]{1,64}')
      if (get(cid)) throw new PmError(409, `campaign ${cid} already exists`)
      const at = now()
      db.prepare(`INSERT INTO blitz_campaigns (id, title, projects, roster, schedule, state, rev, created_at, created_by, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`)
        .run(cid, String(title ?? ''), JSON.stringify(projects), JSON.stringify(roster), JSON.stringify(schedule ?? {}), at, w.actor, at, w.actor)
      return get(cid)
    },

    /** Optimistic write: refuses unless `rev` is current. `fields` maps column -> value (objects are JSON-encoded). */
    update(w, id, rev, fields) {
      w = requireActor(w)
      const cur = api.get(id)
      if (rev === undefined || rev === null) throw new PmError(400, 'rev is required')
      if (Number(rev) !== cur.rev) throw new PmError(409, `stale rev ${rev}; current is ${cur.rev}`, { current: cur })
      const cols = Object.keys(fields)
      const vals = cols.map((c) => (fields[c] !== null && typeof fields[c] === 'object' ? JSON.stringify(fields[c]) : fields[c]))
      const r = db.prepare(`UPDATE blitz_campaigns SET ${cols.map((c) => `${c} = ?`).join(', ')}${cols.length ? ',' : ''} rev = rev + 1, updated_at = ?, updated_by = ? WHERE id = ? AND rev = ?`)
        .run(...vals, now(), w.actor, id, cur.rev)
      if (r.changes !== 1) throw new PmError(409, 'campaign changed concurrently; re-read and retry', { current: get(id) })
      return get(id)
    },

    // --- task snapshot ---
    tasks(campaignId, { state } = {}) {
      const rows = state
        ? db.prepare('SELECT * FROM blitz_campaign_tasks WHERE campaign_id = ? AND state = ? ORDER BY wave, task_id').all(campaignId, state)
        : db.prepare('SELECT * FROM blitz_campaign_tasks WHERE campaign_id = ? ORDER BY wave, task_id').all(campaignId)
      return rows.map(taskRow)
    },
    task(campaignId, taskId) {
      const t = taskRow(db.prepare('SELECT * FROM blitz_campaign_tasks WHERE campaign_id = ? AND task_id = ?').get(campaignId, taskId))
      if (!t) throw new PmError(404, `task ${taskId} is not in campaign ${campaignId}`)
      return t
    },
    putTask(campaignId, t) {
      db.prepare(`INSERT INTO blitz_campaign_tasks (campaign_id, task_id, project_id, wave, depends_on, state, reason, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id, task_id) DO UPDATE SET wave = excluded.wave, depends_on = excluded.depends_on,
          state = excluded.state, reason = excluded.reason, rev = rev + 1, updated_at = excluded.updated_at`)
        .run(campaignId, t.task_id, t.project_id, t.wave ?? null, JSON.stringify(t.depends_on ?? []), t.state, t.reason ?? null, now())
    },
    /** Task-row write fenced by its rev (the controller re-reads before each change). */
    setTask(campaignId, taskId, rev, fields) {
      const cols = Object.keys(fields)
      const vals = cols.map((c) => (fields[c] !== null && typeof fields[c] === 'object' ? JSON.stringify(fields[c]) : fields[c]))
      const r = db.prepare(`UPDATE blitz_campaign_tasks SET ${cols.map((c) => `${c} = ?`).join(', ')}, rev = rev + 1, updated_at = ?
        WHERE campaign_id = ? AND task_id = ? AND rev = ?`).run(...vals, now(), campaignId, taskId, rev)
      if (r.changes !== 1) throw new PmError(409, `task ${taskId} in ${campaignId} changed concurrently; re-read and retry`)
      return api.task(campaignId, taskId)
    },

    // --- events ---
    event(campaignId, kind, data = {}, { taskId = null, actor = null, key = null } = {}) {
      const at = now()
      const r = db.prepare('INSERT INTO blitz_run_events (campaign_id, task_id, kind, data, actor, idempotency_key, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(campaignId, taskId, kind, JSON.stringify(data ?? {}), actor, key, at)
      const e = { id: Number(r.lastInsertRowid), campaign_id: campaignId, task_id: taskId, kind, data: data ?? {}, actor, idempotency_key: key, at }
      pendingEvents.push(e)
      if (depth === 0) flush()
      return e
    },
    events(campaignId, { since = 0, limit = 200, task, kind } = {}) {
      const where = ['campaign_id = ?', 'id > ?']
      const args = [campaignId, Number(since) || 0]
      if (task) { where.push('task_id = ?'); args.push(task) }
      if (kind) { where.push('kind = ?'); args.push(kind) }
      return db.prepare(`SELECT * FROM blitz_run_events WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`)
        .all(...args, Math.min(Number(limit) || 200, 5000)).map((e) => ({ ...e, data: json(e.data, {}) }))
    },
    tail(campaignId, n = 50) {
      return db.prepare('SELECT * FROM blitz_run_events WHERE campaign_id = ? ORDER BY id DESC LIMIT ?').all(campaignId, n)
        .map((e) => ({ ...e, data: json(e.data, {}) })).reverse()
    },

    // --- idempotency ---
    /** Stored record for a key, or null. status: 'pending' (side effect started) | 'done' | 'failed'. */
    idem(key) {
      const r = db.prepare('SELECT * FROM blitz_idempotency WHERE key = ?').get(key)
      return r ? { ...r, result: json(r.result, null) } : null
    },
    /** Claims a key; returns false when it was already claimed. */
    claimKey(key, campaignId, step) {
      const r = db.prepare("INSERT INTO blitz_idempotency (key, campaign_id, step, status, at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(key) DO NOTHING")
        .run(key, campaignId, step, now())
      return r.changes === 1
    },
    settleKey(key, status, result) {
      db.prepare('UPDATE blitz_idempotency SET status = ?, result = ?, done_at = ? WHERE key = ?')
        .run(status, JSON.stringify(result ?? null), now(), key)
    },
  }
  return api
}
