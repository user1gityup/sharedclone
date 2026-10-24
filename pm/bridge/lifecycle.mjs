// Bridge run lifecycle (CONTRACTS.md C4). One row per run in bridge_runs; every
// transition is checked against EDGES and recorded in bridge_run_events.
//
//   accepted -> running -> (completed | failed | cancelled)
//   running -> permission_required -> awaiting_approval -> resuming -> running  (same session, --resume)
//   awaiting_approval -> rejected -> cancelled
//   running -> session_unavailable          (no silent restart)
//   failed -> retrying -> running           (at most ONE retry, only if no write happened)
//
// awaiting_approval has no expiry and lives in SQLite, so it survives a pm restart.

export const RUN_STATES = ['accepted', 'running', 'permission_required', 'awaiting_approval', 'resuming',
  'retrying', 'session_unavailable', 'completed', 'failed', 'cancelled', 'rejected']

export const EDGES = Object.freeze({
  accepted: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'permission_required', 'session_unavailable'],
  permission_required: ['awaiting_approval'],
  awaiting_approval: ['resuming', 'rejected'],
  resuming: ['running'],
  rejected: ['cancelled'],
  failed: ['retrying'],
  retrying: ['running'],
  session_unavailable: [],
  completed: [],
  cancelled: [],
})

/** States that end a run (or park it for a person) and therefore notify. */
export const NOTIFY_STATES = new Set(['completed', 'failed', 'cancelled', 'session_unavailable', 'awaiting_approval', 'rejected'])
export const MAX_RETRIES = 1

export class LifecycleError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS bridge_runs (
    id TEXT PRIMARY KEY, state TEXT NOT NULL, session_id TEXT, project TEXT, machine TEXT, owner TEXT,
    retries INTEGER NOT NULL DEFAULT 0, wrote INTEGER NOT NULL DEFAULT 0, approval_id TEXT,
    detail TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS bridge_run_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, from_state TEXT, to_state TEXT NOT NULL,
    detail TEXT, at TEXT NOT NULL);`)
}

// Fanout for terminal/parking states: pm event, bridge inbox, Windows toast. All injectable.
let hooks = { emit: null, bridgeInbox: null, toast: null }
export function setHooks(h = {}) { hooks = { emit: null, bridgeInbox: null, toast: null, ...h } }

const now = () => new Date().toISOString()

export function getRun(db, id) {
  const r = db.prepare('SELECT * FROM bridge_runs WHERE id = ?').get(id)
  return r ? { ...r, detail: r.detail ? JSON.parse(r.detail) : null } : null
}

/** Create a run in 'accepted'. Idempotent on id. */
export function createRun(db, id, { session_id = null, project = null, machine = null, owner = null } = {}) {
  const at = now()
  db.prepare(`INSERT OR IGNORE INTO bridge_runs (id, state, session_id, project, machine, owner, created_at, updated_at)
    VALUES (?, 'accepted', ?, ?, ?, ?, ?, ?)`).run(id, session_id, project, machine, owner, at, at)
  return getRun(db, id)
}

export function markWrite(db, id) { db.prepare('UPDATE bridge_runs SET wrote = 1 WHERE id = ?').run(id) }

/** Move a run along a legal edge; throws LifecycleError on an illegal edge or a forbidden retry. */
export function transition(db, runId, to, detail = null) {
  if (!RUN_STATES.includes(to)) throw new LifecycleError('BAD_STATE', `unknown run state ${to}`)
  const run = getRun(db, runId)
  if (!run) throw new LifecycleError('NOT_FOUND', `run ${runId} not found`)
  if (!EDGES[run.state].includes(to)) throw new LifecycleError('ILLEGAL_EDGE', `illegal transition ${run.state} -> ${to}`)
  if (to === 'retrying') {
    if (run.wrote) throw new LifecycleError('RETRY_AFTER_WRITE', `run ${runId} wrote before failing; not retried`)
    if (run.retries >= MAX_RETRIES) throw new LifecycleError('RETRY_LIMIT', `run ${runId} already retried ${run.retries} time(s)`)
  }
  const at = now()
  const d = detail == null ? null : JSON.stringify(detail)
  db.prepare(`UPDATE bridge_runs SET state = ?, detail = ?, updated_at = ?,
    retries = retries + ?, session_id = COALESCE(?, session_id), approval_id = COALESCE(?, approval_id) WHERE id = ? AND state = ?`)
    .run(to, d, at, to === 'retrying' ? 1 : 0, detail?.session_id ?? null, detail?.approval_id ?? null, runId, run.state)
  db.prepare('INSERT INTO bridge_run_events (run_id, from_state, to_state, detail, at) VALUES (?, ?, ?, ?, ?)').run(runId, run.state, to, d, at)
  const next = getRun(db, runId)
  if (NOTIFY_STATES.has(to)) fanout(db, next, run.state)
  return next
}

/** Retry allowed? (failed, no write, under the limit) */
export function canRetry(db, runId) {
  const r = getRun(db, runId)
  return !!r && r.state === 'failed' && !r.wrote && r.retries < MAX_RETRIES
}

/** Runs parked for approval; never expire, read straight from the DB after a restart. */
export function awaiting(db) {
  return db.prepare("SELECT id FROM bridge_runs WHERE state = 'awaiting_approval' ORDER BY created_at").all().map((r) => getRun(db, r.id))
}

export function history(db, runId) {
  return db.prepare('SELECT from_state, to_state, detail, at FROM bridge_run_events WHERE run_id = ? ORDER BY seq').all(runId)
}

function fanout(db, run, from) {
  const severity = ['failed', 'session_unavailable'].includes(run.state) ? 'error'
    : ['awaiting_approval', 'rejected', 'cancelled'].includes(run.state) ? 'warn' : 'info'
  const ev = { at: now(), type: run.state, project: run.project, machine: run.machine, owner: run.owner, run_id: run.id,
    severity, audience: { roles: ['admin', 'manager'], identities: run.owner ? [run.owner] : [] },
    dedupe_key: `run-${run.id}-${run.state}-${run.retries}`, summary: `run ${run.id}: ${from} -> ${run.state}`, detail: run.detail }
  for (const k of ['emit', 'bridgeInbox', 'toast']) {
    const fn = hooks[k]
    if (!fn) continue
    try { k === 'emit' ? fn(db, ev) : fn(ev) } catch (err) { console.error(`lifecycle ${k}`, err.message) }
  }
}

/** Classify a finished `claude -p` run into the next lifecycle state. Pure. */
export function classifyExit({ code, result, cancelled = false, resumed = false, stderr = '' }) {
  if (cancelled) return 'cancelled'
  const text = `${result?.result ?? ''}\n${stderr}`
  if (resumed && /no conversation found|session .*not found|could not resume/i.test(text)) return 'session_unavailable'
  if (Array.isArray(result?.permission_denials) && result.permission_denials.length) return 'permission_required'
  if (code === 0 && result && !result.is_error) return 'completed'
  return 'failed'
}
