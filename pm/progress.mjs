// Persisted per-task progress (T-409c621d, PM_PROGRESS_V1). Standalone over node:sqlite;
// migrateProgress(db) is idempotent and additive. Progress is a separate axis from task status.
//  Stage map: queued 0 | running 10-80 | report_written 85 (needs report_ref) |
//  verifying 90 pending | check_failed 90 fail (NOT done) | verified_pass 100 (needs check_ref
//  AND a report_written in the same run generation) | blocked/unknown keep last justified %.
//  - progress_events and progress_audit are append-only; event_key makes ingest idempotent.
//  - Out-of-order (seq <= last_seq) events are stored as 'late' and never change the snapshot.
//  - A verified generation is never regressed; a new generation needs retry:true + reason.
//  - Events are rejected for cross-project task mapping, run/task mismatch and untrusted agents.

export const STAGES = ['queued', 'running', 'report_written', 'verifying', 'check_failed', 'verified_pass', 'blocked', 'unknown']
export const RESULTS = ['pending', 'pass', 'fail', 'blocked']
export const STALE_MS = 15 * 60_000
export class ProgressError extends Error { constructor(code, msg) { super(msg); this.code = code } }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS progress_events (
  event_key TEXT PRIMARY KEY, task_id TEXT NOT NULL, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
  generation INTEGER NOT NULL, seq INTEGER NOT NULL, stage TEXT NOT NULL, percent INTEGER,
  result TEXT NOT NULL, work_units INTEGER, expected_units INTEGER, report_ref TEXT, check_ref TEXT,
  error TEXT, source_machine TEXT, source_agent TEXT, source_model TEXT, retry_reason TEXT,
  event_time TEXT NOT NULL, ingested_at TEXT NOT NULL, ingested_by TEXT NOT NULL,
  disposition TEXT NOT NULL, content_hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS progress_ev_task ON progress_events(task_id, generation, seq);
CREATE TABLE IF NOT EXISTS task_progress (
  task_id TEXT NOT NULL, generation INTEGER NOT NULL, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
  stage TEXT NOT NULL, percent INTEGER, result TEXT NOT NULL, last_seq INTEGER NOT NULL,
  work_units INTEGER, expected_units INTEGER, report_ref TEXT, check_ref TEXT, error TEXT,
  source_machine TEXT, source_agent TEXT, source_model TEXT, last_event_time TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY (task_id, generation));
CREATE TABLE IF NOT EXISTS progress_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, outcome TEXT NOT NULL,
  event_key TEXT, task_id TEXT, detail TEXT NOT NULL DEFAULT '{}');
`
const APPEND_ONLY = ['progress_events', 'progress_audit']
  .map((t) => `CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`).join('\n')

export function migrateProgress(db) { db.exec(SCHEMA); db.exec(APPEND_ONLY) }

const nowIso = () => new Date().toISOString()
function atomic(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { try { db.exec('ROLLBACK') } catch {} throw e }
}
function audit(db, actor, outcome, ev, detail = {}) {
  db.prepare('INSERT INTO progress_audit (at, actor, outcome, event_key, task_id, detail) VALUES (?,?,?,?,?,?)')
    .run(nowIso(), actor, outcome, ev?.event_key ?? null, ev?.task_id ?? null, JSON.stringify(detail))
}
const CONTENT = ['task_id', 'project_id', 'run_id', 'generation', 'seq', 'stage', 'percent', 'result', 'work_units', 'expected_units', 'report_ref', 'check_ref', 'error', 'source_machine', 'source_agent', 'source_model', 'retry_reason', 'event_time']
const hashOf = (e) => JSON.stringify(CONTENT.map((k) => e[k] ?? null))

function reject(db, actor, ev, code, msg) {
  const err = new ProgressError(code, msg)
  // inside a transaction the audit row would be rolled back; the outer catch writes it after ROLLBACK
  if (db.isTransaction) { err.pendingAudit = { actor, ev } } else audit(db, actor, 'rejected', ev, { code, msg })
  throw err
}

/**
 * ctx = { actor, trustedAgents: Set|fn(agent)->bool, taskProject: fn(task_id)->project_id|null,
 *         runOwner: fn(run_id)->{task_id, agent?}|null }
 * Returns { status: 'applied'|'duplicate'|'late'|'ignored', snapshot }.
 */
export function recordProgress(db, ev, ctx = {}) {
  const actor = ctx.actor
  if (!actor || typeof actor !== 'string') throw new ProgressError('BAD_REQUEST', 'actor identity required')
  const e = { ...ev }
  for (const k of ['event_key', 'task_id', 'project_id', 'run_id', 'stage', 'event_time']) {
    if (!e[k] || typeof e[k] !== 'string') reject(db, actor, e, 'BAD_REQUEST', `${k} required`)
  }
  e.generation = e.generation ?? 1
  if (!Number.isInteger(e.generation) || e.generation < 1) reject(db, actor, e, 'BAD_REQUEST', 'generation must be a positive integer')
  if (!Number.isInteger(e.seq) || e.seq < 0) reject(db, actor, e, 'BAD_REQUEST', 'seq must be a non-negative integer')
  if (!STAGES.includes(e.stage)) reject(db, actor, e, 'BAD_REQUEST', `bad stage ${e.stage}`)
  if (Number.isNaN(Date.parse(e.event_time))) reject(db, actor, e, 'BAD_REQUEST', 'bad event_time')
  const trusted = typeof ctx.trustedAgents === 'function' ? ctx.trustedAgents(e.source_agent) : ctx.trustedAgents?.has(e.source_agent)
  if (!e.source_agent || !trusted) reject(db, actor, e, 'UNTRUSTED_SOURCE', `source agent ${e.source_agent ?? '(none)'} is not trusted`)
  const proj = ctx.taskProject?.(e.task_id)
  if (!proj) reject(db, actor, e, 'UNKNOWN_TASK', `task ${e.task_id} not found`)
  if (proj !== e.project_id) reject(db, actor, e, 'CROSS_PROJECT', `task ${e.task_id} belongs to another project`)
  const owner = ctx.runOwner?.(e.run_id)
  if (!owner || owner.task_id !== e.task_id) reject(db, actor, e, 'RUN_MISMATCH', `run ${e.run_id} is not mapped to task ${e.task_id}`)
  if (owner.agent && owner.agent !== e.source_agent) reject(db, actor, e, 'RUN_MISMATCH', `run ${e.run_id} is owned by another agent`)

  const r = e.result ?? (e.stage === 'verified_pass' ? 'pass' : e.stage === 'check_failed' ? 'fail' : e.stage === 'blocked' ? 'blocked' : 'pending')
  e.result = r
  if (!RESULTS.includes(r)) reject(db, actor, e, 'BAD_REQUEST', `bad result ${r}`)
  const bad = (m) => reject(db, actor, e, 'BAD_STAGE', m)
  const own = db.prepare('SELECT * FROM task_progress WHERE task_id=? AND generation=?').get(e.task_id, e.generation)
  switch (e.stage) {
    case 'queued': e.percent = 0; if (r !== 'pending') bad('queued is pending'); break
    case 'running':
      if (r !== 'pending') bad('running is pending')
      if (e.percent == null) e.percent = 10
      if (!Number.isInteger(e.percent) || e.percent < 10 || e.percent > 80) bad('running percent must be 10-80')
      break
    case 'report_written':
      if (!e.report_ref) bad('report_written needs report_ref')
      if (r !== 'pending') bad('report_written is pending, not a pass')
      e.percent = 85; break
    case 'verifying': if (r !== 'pending') bad('verifying is pending'); e.percent = 90; break
    case 'check_failed':
      if (r !== 'fail') bad('check_failed must carry result fail')
      if (!e.error && !e.check_ref) bad('check_failed needs error or check_ref evidence')
      e.percent = 90; break
    case 'verified_pass': {
      if (r !== 'pass') bad('verified_pass must carry result pass')
      if (!e.check_ref) bad('verified_pass needs check_ref evidence')
      const hadReport = db.prepare("SELECT 1 FROM progress_events WHERE task_id=? AND generation=? AND stage='report_written' AND disposition='applied'").get(e.task_id, e.generation)
      if (!hadReport) bad('verified_pass requires a report_written event in the same generation')
      e.percent = 100; break
    }
    case 'blocked': case 'unknown':
      if (e.stage === 'blocked' && r !== 'blocked') bad('blocked must carry result blocked')
      if (e.stage === 'unknown' && r !== 'pending') bad('unknown is pending')
      e.percent = own?.percent != null && own.percent < 100 ? own.percent : null
      break
  }

  try { return applyEvent(db, e, actor, own) } catch (err) {
    if (err.pendingAudit) audit(db, actor, 'rejected', e, { code: err.code, msg: err.message })
    throw err
  }
}

function applyEvent(db, e, actor, own0) {
  return atomic(db, () => {
    const own = own0
    const hash = hashOf(e)
    const prior = db.prepare('SELECT content_hash FROM progress_events WHERE event_key=?').get(e.event_key)
    if (prior) {
      if (prior.content_hash === hash) { audit(db, actor, 'duplicate', e); return { status: 'duplicate', snapshot: getSnapshot(db, e.task_id, e.generation) } }
      reject(db, actor, e, 'CONFLICT', `event_key ${e.event_key} replayed with different content`)
    }
    const maxGen = db.prepare('SELECT MAX(generation) g FROM task_progress WHERE task_id=?').get(e.task_id).g ?? 0
    if (e.generation < maxGen) return store(db, e, actor, hash, 'late')
    if (!own) {
      if (e.generation > maxGen && maxGen > 0 && (!e.retry || !e.retry_reason)) {
        reject(db, actor, e, 'GENERATION', 'a new run generation needs retry:true and retry_reason')
      }
    } else {
      if (own.stage === 'verified_pass') return store(db, e, actor, hash, 'ignored')
      if (e.run_id !== own.run_id) reject(db, actor, e, 'RUN_MISMATCH', 'run id changed inside one generation; start a new generation')
      if (e.seq <= own.last_seq) return store(db, e, actor, hash, 'late')
      if (e.stage === 'running' && own.stage === 'running' && e.percent < own.percent) return store(db, e, actor, hash, 'late')
    }
    return store(db, e, actor, hash, 'applied')
  })
}

function store(db, e, actor, hash, disposition) {
  const at = nowIso()
  db.prepare(`INSERT INTO progress_events (event_key, task_id, project_id, run_id, generation, seq, stage, percent, result,
    work_units, expected_units, report_ref, check_ref, error, source_machine, source_agent, source_model, retry_reason,
    event_time, ingested_at, ingested_by, disposition, content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(e.event_key, e.task_id, e.project_id, e.run_id, e.generation, e.seq, e.stage, e.percent ?? null, e.result,
      e.work_units ?? null, e.expected_units ?? null, e.report_ref ?? null, e.check_ref ?? null, e.error ?? null,
      e.source_machine ?? null, e.source_agent, e.source_model ?? null, e.retry_reason ?? null,
      e.event_time, at, actor, disposition, hash)
  audit(db, actor, disposition, e)
  if (disposition === 'applied') {
    db.prepare(`INSERT INTO task_progress (task_id, generation, project_id, run_id, stage, percent, result, last_seq, work_units,
      expected_units, report_ref, check_ref, error, source_machine, source_agent, source_model, last_event_time, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(task_id, generation) DO UPDATE SET stage=excluded.stage, percent=excluded.percent, result=excluded.result,
        last_seq=excluded.last_seq, work_units=COALESCE(excluded.work_units, work_units),
        expected_units=COALESCE(excluded.expected_units, expected_units),
        report_ref=COALESCE(excluded.report_ref, report_ref), check_ref=COALESCE(excluded.check_ref, check_ref),
        error=excluded.error, source_machine=excluded.source_machine, source_agent=excluded.source_agent,
        source_model=excluded.source_model, last_event_time=excluded.last_event_time, updated_at=excluded.updated_at`)
      .run(e.task_id, e.generation, e.project_id, e.run_id, e.stage, e.percent ?? null, e.result, e.seq,
        e.work_units ?? null, e.expected_units ?? null, e.report_ref ?? null, e.check_ref ?? null, e.error ?? null,
        e.source_machine ?? null, e.source_agent, e.source_model ?? null, e.event_time, at)
  }
  return { status: disposition, snapshot: getSnapshot(db, e.task_id, e.generation) }
}

function getSnapshot(db, task_id, generation) {
  const r = db.prepare('SELECT * FROM task_progress WHERE task_id=? AND generation=?').get(task_id, generation)
  return r ? { ...r } : null
}

function ageLabel(iso, now) {
  const ms = Math.max(0, now - Date.parse(iso))
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

/** Read view for one task. visibleProjects (Set) scopes the read; null = unrestricted. */
export function taskProgress(db, task_id, { visibleProjects = null, now = Date.now(), staleMs = STALE_MS } = {}) {
  const rows = db.prepare('SELECT * FROM task_progress WHERE task_id=? ORDER BY generation DESC').all(task_id)
  if (!rows.length) return { task_id, known: false, label: 'UNKNOWN', percent: null }
  if (visibleProjects && !visibleProjects.has(rows[0].project_id)) throw new ProgressError('FORBIDDEN', 'project not visible')
  const cur = { ...rows[0] }
  const verified = rows.find((r) => r.stage === 'verified_pass')
  const terminal = cur.stage === 'verified_pass'
  return {
    ...cur, known: true, label: cur.stage.toUpperCase(),
    done: terminal && cur.result === 'pass', verified_generation: verified?.generation ?? null,
    age_label: ageLabel(cur.last_event_time, now), stale: !terminal && now - Date.parse(cur.last_event_time) > staleMs,
    animate_success: terminal && cur.result === 'pass' && !!cur.check_ref,
  }
}

/** Rollup over ALL listed task ids (tasks without progress count as unknown, never dropped). */
export function projectRollup(db, project_id, taskIds, opts = {}) {
  const by = {}
  let pctSum = 0, known = 0, unknown = 0, verified = 0, failed = 0, stale = 0
  for (const id of taskIds) {
    let v
    try { v = taskProgress(db, id, opts) } catch { continue }
    if (v.known && v.project_id !== project_id) continue
    if (!v.known) { unknown++; continue }
    known++; by[v.stage] = (by[v.stage] || 0) + 1
    if (v.percent != null) pctSum += v.percent
    if (v.done) verified++
    if (v.stage === 'check_failed') failed++
    if (v.stale) stale++
  }
  const total = known + unknown
  return { project_id, total, known, unknown, verified, failed, stale, by_stage: by,
    percent_of_all: total ? Math.round(pctSum / total) : null, verified_pct: total ? Math.round((verified / total) * 100) : null }
}

export function auditTrail(db, task_id) {
  return db.prepare('SELECT * FROM progress_audit WHERE task_id=? ORDER BY id').all(task_id).map((r) => ({ ...r, detail: JSON.parse(r.detail) }))
}
