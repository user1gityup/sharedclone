// Task logs and central searchable history (T-7e5fd4ba). Standalone over node:sqlite;
// migrateHistory(db) is idempotent and additive.
//  - appendLog records one entry per task event: machine, job, model, cost, approval, error.
//    Entries cannot be edited (trigger); they leave only through the retention purge.
//  - searchHistory filters on any column plus free text; parameterised, never string-built.
//  - exportHistory writes JSON or CSV. CSV cells starting with = + - @ are prefixed with ' so a
//    spreadsheet never runs a logged string as a formula.
//  - Retention is administrator-configurable (admin role only). purgeExpired deletes only entries
//    older than the window and writes an audit row naming who set the window and how many went.

export const KINDS = ['info', 'approval', 'error', 'cost', 'run']
export class HistoryError extends Error { constructor(code, msg) { super(msg); this.code = code } }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, task_id TEXT NOT NULL, kind TEXT NOT NULL,
  machine TEXT, job TEXT, model TEXT, cost_usd REAL NOT NULL DEFAULT 0,
  approval TEXT, error TEXT, message TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS task_logs_task ON task_logs(task_id, at);
CREATE INDEX IF NOT EXISTS task_logs_at ON task_logs(at);
CREATE TABLE IF NOT EXISTS history_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, set_by TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}');
CREATE TRIGGER IF NOT EXISTS task_logs_no_update BEFORE UPDATE ON task_logs BEGIN SELECT RAISE(ABORT, 'task_logs is append-only'); END;
`

export function migrateHistory(db) { db.exec(SCHEMA) }

const need = (v, what) => { if (typeof v !== 'string' || !v.trim()) throw new HistoryError('INVALID', `${what} required`); return v.trim() }

export function appendLog(db, e, { now = () => new Date().toISOString() } = {}) {
  const actor = need(e.actor, 'actor identity')
  const task_id = need(e.task_id, 'task_id')
  const kind = e.kind ?? 'info'
  if (!KINDS.includes(kind)) throw new HistoryError('INVALID', `kind must be one of ${KINDS.join(', ')}`)
  const cost = Number(e.cost_usd ?? 0)
  if (!Number.isFinite(cost) || cost < 0) throw new HistoryError('INVALID', 'cost_usd must be a non-negative number')
  const r = db.prepare(`INSERT INTO task_logs (at, task_id, kind, machine, job, model, cost_usd, approval, error, message, actor)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(e.at ?? now(), task_id, kind, e.machine ?? null, e.job ?? null, e.model ?? null, cost, e.approval ?? null, e.error ?? null, e.message ?? '', actor)
  return Number(r.lastInsertRowid)
}

/** Per-task log, oldest first. */
export function taskLog(db, taskId) {
  return db.prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY at, id').all(taskId).map((r) => ({ ...r }))
}

const EQ = ['task_id', 'kind', 'machine', 'job', 'model', 'approval', 'actor']

/** Filters: any of EQ columns, q (free text over message/error/job), since, until, hasError, minCost, limit, offset. */
export function searchHistory(db, f = {}) {
  const where = []
  const args = []
  for (const k of EQ) if (f[k] != null && f[k] !== '') { where.push(`${k} = ?`); args.push(String(f[k])) }
  if (f.q) {
    const like = `%${String(f.q).replace(/[\\%_]/g, (c) => '\\' + c)}%`
    where.push("(message LIKE ? ESCAPE '\\' OR error LIKE ? ESCAPE '\\' OR job LIKE ? ESCAPE '\\')")
    args.push(like, like, like)
  }
  if (f.since) { where.push('at >= ?'); args.push(f.since) }
  if (f.until) { where.push('at < ?'); args.push(f.until) }
  if (f.hasError) where.push('error IS NOT NULL')
  if (f.minCost != null) { where.push('cost_usd >= ?'); args.push(Number(f.minCost)) }
  const limit = Math.min(Math.max(Number(f.limit) || 100, 1), 1000)
  const offset = Math.max(Number(f.offset) || 0, 0)
  const sql = `FROM task_logs${where.length ? ' WHERE ' + where.join(' AND ') : ''}`
  const total = Number(db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n)
  const rows = db.prepare(`SELECT * ${sql} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset).map((r) => ({ ...r }))
  return { total, rows }
}

const COLS = ['id', 'at', 'task_id', 'kind', 'machine', 'job', 'model', 'cost_usd', 'approval', 'error', 'message', 'actor']

function csvCell(v) {
  if (v == null) return ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Export the rows a filter selects (no paging cap beyond 1000 per call: pass offset to continue). */
export function exportHistory(db, filter = {}, format = 'json') {
  const { rows, total } = searchHistory(db, filter)
  if (format === 'json') return JSON.stringify({ total, rows }, null, 2)
  if (format !== 'csv') throw new HistoryError('INVALID', 'format must be json or csv')
  return [COLS.join(','), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n'
}

// ---- retention --------------------------------------------------------------------------
export const DEFAULT_RETENTION_DAYS = 365

export function getRetentionDays(db) {
  const r = db.prepare("SELECT value FROM history_settings WHERE key = 'retention_days'").get()
  return r ? Number(r.value) : DEFAULT_RETENTION_DAYS
}

/** Admin only. days >= 1; 0 is refused so the window can never silently mean "keep nothing". */
export function setRetentionDays(db, { days, actor, role }, { now = () => new Date().toISOString() } = {}) {
  need(actor, 'actor identity')
  if (role !== 'admin') throw new HistoryError('FORBIDDEN', 'only an administrator may set retention')
  const n = Number(days)
  if (!Number.isInteger(n) || n < 1) throw new HistoryError('INVALID', 'retention days must be a whole number >= 1')
  db.prepare(`INSERT INTO history_settings (key, value, set_by, at) VALUES ('retention_days', ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, set_by = excluded.set_by, at = excluded.at`).run(String(n), actor, now())
  db.prepare("INSERT INTO history_audit (at, actor, action, detail) VALUES (?, ?, 'set_retention', ?)").run(now(), actor, JSON.stringify({ days: n }))
  return n
}

/** Delete entries older than the window. Returns { removed, cutoff }. Audited, including zero. */
export function purgeExpired(db, { actor, now = () => new Date() } = {}) {
  need(actor, 'actor identity')
  const days = getRetentionDays(db)
  const cutoff = new Date(now().getTime() - days * 86_400_000).toISOString()
  const removed = Number(db.prepare('DELETE FROM task_logs WHERE at < ?').run(cutoff).changes)
  db.prepare("INSERT INTO history_audit (at, actor, action, detail) VALUES (?, ?, 'purge', ?)").run(now().toISOString(), actor, JSON.stringify({ days, cutoff, removed }))
  return { removed, cutoff, days }
}

export function auditTrail(db) { return db.prepare('SELECT * FROM history_audit ORDER BY id').all().map((r) => ({ ...r })) }
