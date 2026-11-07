// Token usage ledger and cost attribution (T-ab0064b1). Standalone over node:sqlite;
// migrateLedger(db) is idempotent and additive.
//  - Ingestion is idempotent: event_id is the primary key; replaying identical content is a
//    no-op, replaying an event_id with DIFFERENT content is rejected and audited.
//  - Double-count prevention: (provider, request_key) is unique, so the same provider request
//    reported by two collectors under two event ids is stored once. An actual event may
//    `supersedes` an estimated one; superseded estimates drop out of every total.
//  - cost_class local|free|included|metered. Only metered carries USD. included events can
//    name a shared quota_pool; pool totals count each event once however many agents share it.
//  - Goal allocations are versioned and append-only; per event the percentages sum to at most
//    100 and the remainder is reported as unattributed, never silently spread.
//  - usage_events, usage_allocations and ledger_audit reject UPDATE and DELETE.

export const COST_CLASSES = ['local', 'free', 'included', 'metered']
export const BASES = ['actual', 'estimated']
export class LedgerError extends Error { constructor(code, msg) { super(msg); this.code = code } }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_events (
  event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
  agent TEXT, task_id TEXT, run_id TEXT,
  basis TEXT NOT NULL CHECK (basis IN ('actual','estimated')),
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_class TEXT NOT NULL CHECK (cost_class IN ('local','free','included','metered')),
  cost_usd REAL NOT NULL DEFAULT 0, quota_pool TEXT, request_key TEXT, supersedes TEXT,
  occurred_at TEXT NOT NULL, ingested_at TEXT NOT NULL, ingested_by TEXT NOT NULL, content_hash TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS usage_request_key ON usage_events(provider, request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_task ON usage_events(task_id);
CREATE INDEX IF NOT EXISTS usage_run ON usage_events(run_id);
CREATE INDEX IF NOT EXISTS usage_pool ON usage_events(quota_pool);
CREATE TABLE IF NOT EXISTS usage_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL REFERENCES usage_events(event_id),
  version INTEGER NOT NULL, goal_id TEXT, pct REAL NOT NULL CHECK (pct >= 0 AND pct <= 100),
  actor TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS usage_alloc_event ON usage_allocations(event_id, version);
CREATE TABLE IF NOT EXISTS ledger_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
  outcome TEXT NOT NULL, event_id TEXT, detail TEXT NOT NULL DEFAULT '{}');
`
const APPEND_ONLY = ['usage_events', 'usage_allocations', 'ledger_audit']
  .map((t) => `CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`).join('\n')

export function migrateLedger(db) { db.exec(SCHEMA); db.exec(APPEND_ONLY) }

const nowIso = () => new Date().toISOString()
function atomic(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { try { db.exec('ROLLBACK') } catch {} throw e }
}
function audit(db, actor, outcome, event_id, detail = {}) {
  db.prepare('INSERT INTO ledger_audit (at, actor, outcome, event_id, detail) VALUES (?,?,?,?,?)').run(nowIso(), actor, outcome, event_id ?? null, JSON.stringify(detail))
}
const CONTENT = ['provider', 'model', 'agent', 'task_id', 'run_id', 'basis', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_class', 'cost_usd', 'quota_pool', 'request_key', 'supersedes', 'occurred_at']
function normalise(e) {
  return {
    provider: e.provider, model: e.model, agent: e.agent ?? null, task_id: e.task_id ?? null, run_id: e.run_id ?? null,
    basis: e.basis, input_tokens: e.input_tokens ?? 0, output_tokens: e.output_tokens ?? 0,
    cache_read_tokens: e.cache_read_tokens ?? 0, cache_write_tokens: e.cache_write_tokens ?? 0,
    cost_class: e.cost_class, cost_usd: e.cost_usd ?? 0, quota_pool: e.quota_pool ?? null,
    request_key: e.request_key ?? null, supersedes: e.supersedes ?? null, occurred_at: e.occurred_at,
  }
}
const hashOf = (n) => JSON.stringify(CONTENT.map((k) => n[k]))

function validate(e, n) {
  if (!e.event_id || typeof e.event_id !== 'string') throw new LedgerError('BAD_REQUEST', 'event_id required')
  if (!n.provider || !n.model) throw new LedgerError('BAD_REQUEST', 'provider and model required')
  if (!BASES.includes(n.basis)) throw new LedgerError('BAD_REQUEST', `bad basis ${n.basis}`)
  if (!COST_CLASSES.includes(n.cost_class)) throw new LedgerError('BAD_REQUEST', `bad cost_class ${n.cost_class}`)
  for (const k of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']) {
    if (!Number.isInteger(n[k]) || n[k] < 0) throw new LedgerError('BAD_REQUEST', `${k} must be a non-negative integer`)
  }
  if (!Number.isFinite(n.cost_usd) || n.cost_usd < 0) throw new LedgerError('BAD_REQUEST', 'cost_usd must be >= 0')
  if (n.cost_class !== 'metered' && n.cost_usd !== 0) throw new LedgerError('BAD_REQUEST', `${n.cost_class} usage carries no USD cost`)
  if (n.quota_pool && n.cost_class !== 'included') throw new LedgerError('BAD_REQUEST', 'quota_pool applies to included usage only')
  if (!n.occurred_at || Number.isNaN(Date.parse(n.occurred_at))) throw new LedgerError('BAD_REQUEST', 'occurred_at must be an ISO time')
  if (n.supersedes && n.basis !== 'actual') throw new LedgerError('BAD_REQUEST', 'only an actual event can supersede an estimate')
}

/**
 * Ingest one event. Returns {status: 'inserted'|'duplicate'|'duplicate_request'} or throws.
 * duplicate = same event_id and identical content (no-op); duplicate_request = same provider
 * request already recorded under another event_id (not stored again).
 */
export function ingestEvent(db, event, { actor }) {
  if (!actor) throw new LedgerError('FORBIDDEN', 'actor identity required')
  const n = normalise(event)
  try { validate(event, n) } catch (err) { audit(db, actor, 'rejected', event?.event_id, { reason: err.message }); throw err }
  return atomic(db, () => {
    const h = hashOf(n)
    const prev = db.prepare('SELECT content_hash FROM usage_events WHERE event_id=?').get(event.event_id)
    if (prev) {
      if (prev.content_hash === h) { audit(db, actor, 'duplicate', event.event_id); return { status: 'duplicate', event_id: event.event_id } }
      audit(db, actor, 'conflict', event.event_id, { reason: 'same event_id, different content' })
      db.exec('COMMIT'); db.exec('BEGIN IMMEDIATE') // keep the audit row, then fail
      throw new LedgerError('CONFLICT', `event ${event.event_id} already recorded with different content`)
    }
    if (n.request_key) {
      const same = db.prepare('SELECT event_id FROM usage_events WHERE provider=? AND request_key=?').get(n.provider, n.request_key)
      if (same) { audit(db, actor, 'duplicate_request', event.event_id, { kept: same.event_id }); return { status: 'duplicate_request', event_id: same.event_id } }
    }
    if (n.supersedes) {
      const t = db.prepare('SELECT basis FROM usage_events WHERE event_id=?').get(n.supersedes)
      if (!t) throw new LedgerError('NOT_FOUND', `superseded event ${n.supersedes}`)
      if (t.basis !== 'estimated') throw new LedgerError('BAD_REQUEST', 'can only supersede an estimated event')
      if (db.prepare('SELECT 1 FROM usage_events WHERE supersedes=?').get(n.supersedes)) throw new LedgerError('CONFLICT', `${n.supersedes} already superseded`)
    }
    db.prepare(`INSERT INTO usage_events (event_id,provider,model,agent,task_id,run_id,basis,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_class,cost_usd,quota_pool,request_key,supersedes,occurred_at,ingested_at,ingested_by,content_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(event.event_id, n.provider, n.model, n.agent, n.task_id, n.run_id, n.basis, n.input_tokens, n.output_tokens, n.cache_read_tokens, n.cache_write_tokens, n.cost_class, n.cost_usd, n.quota_pool, n.request_key, n.supersedes, n.occurred_at, nowIso(), actor, h)
    audit(db, actor, 'inserted', event.event_id)
    return { status: 'inserted', event_id: event.event_id }
  })
}

/** Append a new allocation version for an event. Lines sum to <= 100; the rest is unattributed. */
export function setAllocations(db, event_id, lines, { actor }) {
  if (!actor) throw new LedgerError('FORBIDDEN', 'actor identity required')
  return atomic(db, () => {
    if (!db.prepare('SELECT 1 FROM usage_events WHERE event_id=?').get(event_id)) throw new LedgerError('NOT_FOUND', event_id)
    const seen = new Set(); let sum = 0
    for (const l of lines) {
      if (!l.goal_id) throw new LedgerError('BAD_REQUEST', 'goal_id required')
      if (seen.has(l.goal_id)) throw new LedgerError('BAD_REQUEST', `duplicate goal ${l.goal_id}`)
      if (!Number.isFinite(l.pct) || l.pct < 0 || l.pct > 100) throw new LedgerError('BAD_REQUEST', 'pct must be 0..100')
      seen.add(l.goal_id); sum += l.pct
    }
    if (sum > 100 + 1e-9) throw new LedgerError('BAD_REQUEST', `allocations sum to ${sum}%, over 100%`)
    const v = (db.prepare('SELECT MAX(version) v FROM usage_allocations WHERE event_id=?').get(event_id).v || 0) + 1
    const ins = db.prepare('INSERT INTO usage_allocations (event_id,version,goal_id,pct,actor,at) VALUES (?,?,?,?,?,?)')
    const at = nowIso()
    if (!lines.length) ins.run(event_id, v, null, 0, actor, at) // explicit "all unattributed" version
    for (const l of lines) ins.run(event_id, v, l.goal_id, l.pct, actor, at)
    audit(db, actor, 'allocated', event_id, { version: v, lines, unattributed_pct: Math.max(0, 100 - sum) })
    return { version: v, unattributed_pct: Math.max(0, 100 - sum) }
  })
}

/** Effective (latest-version) allocation for an event, with the unattributed remainder explicit. */
export function getAllocation(db, event_id) {
  const v = db.prepare('SELECT MAX(version) v FROM usage_allocations WHERE event_id=?').get(event_id).v
  const lines = v ? db.prepare('SELECT goal_id, pct FROM usage_allocations WHERE event_id=? AND version=? AND goal_id IS NOT NULL ORDER BY goal_id').all(event_id, v) : []
  const sum = lines.reduce((s, l) => s + l.pct, 0)
  return { version: v || 0, lines, unattributed_pct: Math.max(0, 100 - sum) }
}

const LIVE = `NOT EXISTS (SELECT 1 FROM usage_events s WHERE s.supersedes = e.event_id)`
const totalTokens = 'e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens'

/** Non-superseded events, optionally filtered by {task_id, run_id, agent, provider, model, cost_class, quota_pool}. */
export function liveEvents(db, filter = {}) {
  const keys = ['task_id', 'run_id', 'agent', 'provider', 'model', 'cost_class', 'quota_pool', 'basis']
  const where = [LIVE]; const args = []
  for (const k of keys) if (filter[k] !== undefined) { where.push(`e.${k} = ?`); args.push(filter[k]) }
  return db.prepare(`SELECT e.* FROM usage_events e WHERE ${where.join(' AND ')} ORDER BY e.occurred_at, e.event_id`).all(...args)
}

/** Totals split by basis and cost class. Superseded estimates are excluded. */
export function summarize(db, filter = {}) {
  const out = { events: 0, tokens: 0, cost_usd: 0, by_basis: {}, by_cost_class: {} }
  for (const e of liveEvents(db, filter)) {
    const tok = e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens
    out.events++; out.tokens += tok; out.cost_usd += e.cost_usd
    for (const [bucket, key] of [['by_basis', e.basis], ['by_cost_class', e.cost_class]]) {
      const b = out[bucket][key] ||= { events: 0, tokens: 0, cost_usd: 0 }
      b.events++; b.tokens += tok; b.cost_usd += e.cost_usd
    }
  }
  return out
}

/** Shared subscription pool use: each live event counted once, regardless of how many agents drew on it. */
export function poolUsage(db, quota_pool) {
  const rows = db.prepare(`SELECT e.agent, ${totalTokens} AS tokens FROM usage_events e WHERE e.quota_pool = ? AND ${LIVE}`).all(quota_pool)
  const by_agent = {}; let tokens = 0
  for (const r of rows) { tokens += r.tokens; const k = r.agent ?? '(none)'; by_agent[k] = (by_agent[k] || 0) + r.tokens }
  return { quota_pool, events: rows.length, tokens, by_agent }
}

/** Tokens and USD by goal using each event's effective allocation, plus the explicit unattributed remainder. */
export function costByGoal(db, filter = {}) {
  const goals = {}; const unattributed = { tokens: 0, cost_usd: 0 }; let total_tokens = 0; let total_cost = 0
  for (const e of liveEvents(db, filter)) {
    const tok = e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens
    total_tokens += tok; total_cost += e.cost_usd
    const a = getAllocation(db, e.event_id)
    for (const l of a.lines) {
      const g = goals[l.goal_id] ||= { tokens: 0, cost_usd: 0 }
      g.tokens += tok * l.pct / 100; g.cost_usd += e.cost_usd * l.pct / 100
    }
    unattributed.tokens += tok * a.unattributed_pct / 100; unattributed.cost_usd += e.cost_usd * a.unattributed_pct / 100
  }
  return { goals, unattributed, total_tokens, total_cost_usd: total_cost }
}

export function auditTrail(db, event_id) {
  const rows = event_id ? db.prepare('SELECT * FROM ledger_audit WHERE event_id=? ORDER BY id').all(event_id) : db.prepare('SELECT * FROM ledger_audit ORDER BY id').all()
  return rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) }))
}
