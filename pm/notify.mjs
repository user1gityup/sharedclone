// notify.mjs - C5 notification events (workstream 2e).
// Stores NotifyEvent rows, dedupes on dedupe_key, tracks per-identity marks,
// and fans new events out to injectable bridgeInbox/toast functions.
import { randomUUID } from 'node:crypto'

export const SEVERITIES = ['info', 'warn', 'error']
export const MARK_STATES = ['read', 'acked', 'dismissed']
export const EXTRA_TYPES = ['bridge_offline', 'no_consumer', 'stall', 'machine_health']
export const RUN_STATES = ['accepted', 'running', 'permission_required', 'awaiting_approval', 'resuming',
  'retrying', 'session_unavailable', 'completed', 'failed', 'cancelled', 'rejected']
const TYPES = new Set([...RUN_STATES, ...EXTRA_TYPES])

let fanout = {}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notify_events (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      project TEXT, machine TEXT, owner TEXT,
      run_id TEXT, task_id TEXT,
      severity TEXT NOT NULL,
      audience TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS notify_events_at ON notify_events(at);
    CREATE TABLE IF NOT EXISTS notify_marks (
      event_id TEXT NOT NULL,
      identity TEXT NOT NULL,
      state TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (event_id, identity)
    );
  `)
}

function rowToEvent(r) {
  if (!r) return null
  const { audience, detail, ...rest } = r
  let d = detail
  try { d = detail == null ? null : JSON.parse(detail) } catch { d = detail }
  return { ...rest, audience: JSON.parse(audience), detail: d }
}

/** Store an event. Returns { event, created }. A repeated dedupe_key returns the existing row and does not fan out. */
export function emit(db, ev) {
  if (!ev || typeof ev !== 'object') throw new Error('emit: event object required')
  if (!TYPES.has(ev.type)) throw new Error(`emit: unknown type ${ev.type}`)
  if (!ev.dedupe_key) throw new Error('emit: dedupe_key required')
  if (!ev.summary) throw new Error('emit: summary required')
  const severity = ev.severity ?? 'info'
  if (!SEVERITIES.includes(severity)) throw new Error(`emit: invalid severity ${severity}`)
  const roles = ev.audience?.roles
  if (!Array.isArray(roles) || roles.length === 0) throw new Error('emit: audience.roles required')
  const audience = { roles: [...roles] }
  if (ev.audience.identities) audience.identities = [...ev.audience.identities]

  const existing = db.prepare('SELECT * FROM notify_events WHERE dedupe_key = ?').get(ev.dedupe_key)
  if (existing) return { event: rowToEvent({ ...existing }), created: false }

  const row = {
    id: ev.id ?? randomUUID(),
    at: ev.at ?? new Date().toISOString(),
    type: ev.type,
    project: ev.project ?? null, machine: ev.machine ?? null, owner: ev.owner ?? null,
    run_id: ev.run_id ?? null, task_id: ev.task_id ?? null,
    severity,
    audience: JSON.stringify(audience),
    dedupe_key: ev.dedupe_key,
    summary: ev.summary,
    detail: ev.detail === undefined ? null : JSON.stringify(ev.detail),
  }
  db.prepare(`INSERT INTO notify_events (id, at, type, project, machine, owner, run_id, task_id,
    severity, audience, dedupe_key, summary, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.id, row.at, row.type, row.project, row.machine, row.owner, row.run_id, row.task_id,
      row.severity, row.audience, row.dedupe_key, row.summary, row.detail)
  const event = rowToEvent(row)

  const errors = []
  for (const name of ['bridgeInbox', 'toast']) {
    const fn = fanout[name]
    if (typeof fn !== 'function') continue
    try { fn(event) } catch (e) { errors.push({ channel: name, error: String(e?.message ?? e) }) }
  }
  return errors.length ? { event, created: true, fanout_errors: errors } : { event, created: true }
}

function visible(ev, identity, role) {
  if (!identity && !role) return true
  const ids = ev.audience.identities
  if (identity && Array.isArray(ids) && ids.includes(identity)) return true
  if (role && ev.audience.roles.includes(role)) return true
  return false
}

/** Events visible to identity (explicit audience) or role, newest first. unread: no mark by identity. */
export function list(db, { identity, role, unread } = {}) {
  const rows = db.prepare('SELECT * FROM notify_events ORDER BY at DESC, rowid DESC').all()
    .map(r => rowToEvent({ ...r }))
  const marks = identity
    ? new Map(db.prepare('SELECT event_id, state FROM notify_marks WHERE identity = ?').all(identity)
      .map(m => [m.event_id, m.state]))
    : new Map()
  const out = []
  for (const ev of rows) {
    if (!visible(ev, identity, role)) continue
    const state = marks.get(ev.id) ?? null
    if (unread && state) continue
    out.push({ ...ev, state })
  }
  return out
}

export function mark(db, id, { identity, state } = {}) {
  if (!identity) throw new Error('mark: identity required')
  if (!MARK_STATES.includes(state)) throw new Error(`mark: invalid state ${state}`)
  const ev = db.prepare('SELECT id FROM notify_events WHERE id = ?').get(id)
  if (!ev) throw new Error(`mark: unknown event ${id}`)
  const at = new Date().toISOString()
  db.prepare(`INSERT INTO notify_marks (event_id, identity, state, at) VALUES (?,?,?,?)
    ON CONFLICT(event_id, identity) DO UPDATE SET state = excluded.state, at = excluded.at`)
    .run(id, identity, state, at)
  return { event_id: id, identity, state, at }
}

/** Install fanout channels. Pass {} or null to clear. Toast is injectable so tests never hit Windows. */
export function setFanout(fns) {
  if (fns != null && typeof fns !== 'object') throw new Error('setFanout: object required')
  const next = {}
  for (const k of ['bridgeInbox', 'toast']) {
    const fn = fns?.[k]
    if (fn == null) continue
    if (typeof fn !== 'function') throw new Error(`setFanout: ${k} must be a function`)
    next[k] = fn
  }
  fanout = next
}
