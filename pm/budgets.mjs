// Budgets, reservations and authorization (T-0bb1c2ff). Standalone over node:sqlite.
// migrateBudgets(db) is idempotent and additive; createBudgetOps({db, authorize, verifyHuman})
// returns the operations.
//
// Authority never comes from the UI. The server injects two callbacks and both default to
// DENY, so a missing callback fails closed:
//   authorize(actor, action, budget)  -> true only if this identity may do `action`
//   verifyHuman(approver, approvalId) -> true only if a human proof (e.g. the one-time code
//                                        from approvals.mjs) backs this decision
// Hierarchy: organization > team > user > project > job > task. A reservation placed on a
// budget is charged against every ancestor too, inside one BEGIN IMMEDIATE transaction, so
// reserve / settle / release are atomic. Hard budgets refuse, soft budgets allow and alert.
// budget_events is append-only.

export const LEVELS = ['organization', 'team', 'user', 'project', 'job', 'task']
export const UNITS = ['tokens', 'usd']
export const MODES = ['hard', 'soft']
export const DEFAULT_THRESHOLDS = [0.5, 0.8, 1]
export const DEFAULT_TTL_SECONDS = 900
export class BudgetError extends Error { constructor(code, msg, extra = {}) { super(msg); this.code = code; this.extra = extra } }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY, level TEXT NOT NULL, subject TEXT NOT NULL, parent_id TEXT REFERENCES budgets(id),
  unit TEXT NOT NULL CHECK (unit IN ('tokens','usd')), limit_amount REAL NOT NULL CHECK (limit_amount >= 0),
  mode TEXT NOT NULL CHECK (mode IN ('hard','soft')), thresholds TEXT NOT NULL DEFAULT '[0.5,0.8,1]',
  cap_per_reservation REAL, quota_pool TEXT, exploratory_allowance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, rev INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, UNIQUE (level, subject));
CREATE INDEX IF NOT EXISTS budgets_parent ON budgets(parent_id);
CREATE TABLE IF NOT EXISTS budget_reservations (
  id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES budgets(id), holder TEXT NOT NULL, actor TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0), settled_amount REAL, purpose TEXT NOT NULL DEFAULT 'normal',
  state TEXT NOT NULL CHECK (state IN ('held','settled','released','expired')),
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL, closed_at TEXT);
CREATE INDEX IF NOT EXISTS budget_res_budget ON budget_reservations(budget_id, state);
CREATE TABLE IF NOT EXISTS budget_approvals (
  id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES budgets(id), action TEXT NOT NULL CHECK (action IN ('raise_limit')),
  amount REAL NOT NULL, requested_by TEXT NOT NULL, decided_by TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','denied','used')),
  created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS budget_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, budget_id TEXT NOT NULL, actor TEXT NOT NULL,
  kind TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS budget_events_budget ON budget_events(budget_id, kind);
CREATE TRIGGER IF NOT EXISTS budget_events_no_update BEFORE UPDATE ON budget_events BEGIN SELECT RAISE(ABORT, 'budget_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS budget_events_no_delete BEFORE DELETE ON budget_events BEGIN SELECT RAISE(ABORT, 'budget_events is append-only'); END;
`
export function migrateBudgets(db) { db.exec(SCHEMA) }

const deny = () => false
let seq = 0
const newId = (p) => `${p}-${Date.now().toString(36)}${(seq++ % 1296).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function createBudgetOps({ db, authorize = deny, verifyHuman = deny, now = () => new Date() }) {
  const iso = (d = now()) => d.toISOString()

  function atomic(fn) {
    db.exec('BEGIN IMMEDIATE')
    let committed = false
    try { const r = fn(); db.exec('COMMIT'); committed = true; return r } catch (e) { if (!committed) { try { db.exec('ROLLBACK') } catch {} } throw e }
  }
  /** A denial still has to leave a trace, so it is written in its own transaction after rollback. */
  function logOutside(budget_id, actor, kind, data) {
    db.prepare('INSERT INTO budget_events (at, budget_id, actor, kind, data) VALUES (?,?,?,?,?)').run(iso(), budget_id, actor || '(none)', kind, JSON.stringify(data))
  }
  const log = (budget_id, actor, kind, data = {}) => logOutside(budget_id, actor, kind, data)
  function requireActor(actor) { if (!actor || typeof actor !== 'string') throw new BudgetError('FORBIDDEN', 'actor identity required') }
  function allow(actor, action, budget) {
    requireActor(actor)
    let ok = false
    try { ok = authorize(actor, action, budget) === true } catch { ok = false }
    if (!ok) throw new BudgetError('FORBIDDEN', `${actor} is not authorized to ${action}${budget ? ` on ${budget.id}` : ''}`)
  }
  const getBudget = (id) => {
    const b = db.prepare('SELECT * FROM budgets WHERE id=?').get(id)
    return b ? { ...b, thresholds: JSON.parse(b.thresholds) } : null
  }
  function chain(id) {
    const out = []
    let b = getBudget(id)
    while (b) { out.push(b); b = b.parent_id ? getBudget(b.parent_id) : null }
    return out // leaf first
  }
  /** Held + settled amount charged to a budget or any descendant. */
  function used(id) {
    const r = db.prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT b.id FROM budgets b JOIN sub ON b.parent_id = sub.id)
      SELECT COALESCE(SUM(CASE WHEN state='held' THEN amount WHEN state='settled' THEN settled_amount ELSE 0 END),0) AS u,
             COALESCE(SUM(CASE WHEN state='held' THEN amount ELSE 0 END),0) AS held,
             COALESCE(SUM(CASE WHEN purpose='exploratory' AND state IN ('held','settled') THEN COALESCE(settled_amount, amount) ELSE 0 END),0) AS expl
      FROM budget_reservations WHERE budget_id IN (SELECT id FROM sub)`).get(id)
    return { used: r.u, held: r.held, exploratory: r.expl }
  }

  function createBudget({ id, level, subject, parent_id = null, unit, limit_amount, mode = 'hard', thresholds = DEFAULT_THRESHOLDS, cap_per_reservation = null, quota_pool = null, exploratory_allowance = 0, actor }) {
    allow(actor, 'create_budget', null)
    if (!LEVELS.includes(level)) throw new BudgetError('BAD_REQUEST', `bad level ${level}`)
    if (!subject) throw new BudgetError('BAD_REQUEST', 'subject required')
    if (!UNITS.includes(unit)) throw new BudgetError('BAD_REQUEST', `bad unit ${unit}`)
    if (!MODES.includes(mode)) throw new BudgetError('BAD_REQUEST', `bad mode ${mode}`)
    if (!Number.isFinite(limit_amount) || limit_amount < 0) throw new BudgetError('BAD_REQUEST', 'limit_amount must be >= 0')
    if (!Array.isArray(thresholds) || thresholds.some((t) => !(t > 0 && t <= 2))) throw new BudgetError('BAD_REQUEST', 'thresholds must be fractions in (0,2]')
    if (cap_per_reservation !== null && !(cap_per_reservation > 0)) throw new BudgetError('BAD_REQUEST', 'cap_per_reservation must be > 0')
    if (!(exploratory_allowance >= 0)) throw new BudgetError('BAD_REQUEST', 'exploratory_allowance must be >= 0')
    return atomic(() => {
      if (parent_id) {
        const p = getBudget(parent_id)
        if (!p) throw new BudgetError('NOT_FOUND', `parent ${parent_id}`)
        if (LEVELS.indexOf(p.level) >= LEVELS.indexOf(level)) throw new BudgetError('BAD_REQUEST', `${level} cannot sit under ${p.level}`)
        if (p.unit !== unit) throw new BudgetError('BAD_REQUEST', 'child budget must use the parent unit')
      } else if (level !== 'organization') {
        throw new BudgetError('BAD_REQUEST', 'only an organization budget may have no parent')
      }
      const bid = id || newId('B')
      db.prepare('INSERT INTO budgets (id,level,subject,parent_id,unit,limit_amount,mode,thresholds,cap_per_reservation,quota_pool,exploratory_allowance,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(bid, level, subject, parent_id, unit, limit_amount, mode, JSON.stringify([...thresholds].sort((a, b) => a - b)), cap_per_reservation, quota_pool, exploratory_allowance, iso(), actor)
      log(bid, actor, 'created', { level, subject, parent_id, unit, limit_amount, mode })
      return bid
    })
  }

  function reserve({ budget_id, amount, holder, actor, purpose = 'normal', ttl_seconds = DEFAULT_TTL_SECONDS, id }) {
    requireActor(actor)
    if (!holder) throw new BudgetError('FORBIDDEN', 'holder (task/run identity) required')
    if (!Number.isFinite(amount) || amount <= 0) throw new BudgetError('BAD_REQUEST', 'amount must be > 0')
    if (!['normal', 'exploratory'].includes(purpose)) throw new BudgetError('BAD_REQUEST', `bad purpose ${purpose}`)
    const leaf = getBudget(budget_id)
    if (!leaf) throw new BudgetError('NOT_FOUND', `budget ${budget_id}`)
    allow(actor, 'reserve', leaf)
    let denial = null
    let result = null
    try {
      result = atomic(() => {
        const alerts = []; const flags = []
        const levels = chain(budget_id)
        for (const b of levels) {
          if (!b.active) throw new BudgetError('INACTIVE', `budget ${b.id} is inactive`)
          if (b.cap_per_reservation !== null && amount > b.cap_per_reservation) throw new BudgetError('CAP_EXCEEDED', `reservation ${amount} exceeds cap ${b.cap_per_reservation} on ${b.id}`, { budget: b.id })
        }
        const plan = levels.map((b) => ({ b, u: used(b.id) }))
        for (const { b, u } of plan) {
          const after = u.used + amount
          if (after > b.limit_amount) {
            if (b.mode === 'soft') { flags.push({ budget: b.id, kind: 'soft_exceeded' }); continue }
            const explOk = purpose === 'exploratory' && b.exploratory_allowance > 0 && u.exploratory + amount <= b.exploratory_allowance
            if (!explOk) throw new BudgetError('BUDGET_EXCEEDED', `hard budget ${b.id} would reach ${after} of ${b.limit_amount}`, { budget: b.id, used: u.used, limit: b.limit_amount })
            flags.push({ budget: b.id, kind: 'exploratory_over_limit' })
          }
        }
        const rid = id || newId('RSV')
        const t = now()
        db.prepare('INSERT INTO budget_reservations (id,budget_id,holder,actor,amount,purpose,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(rid, budget_id, holder, actor, amount, purpose, 'held', iso(new Date(t.getTime() + ttl_seconds * 1000)), iso(t))
        log(budget_id, actor, 'reserved', { reservation: rid, amount, holder, purpose, flags })
        for (const { b, u } of plan) {
          const before = u.used / b.limit_amount || 0
          const afterFrac = b.limit_amount > 0 ? (u.used + amount) / b.limit_amount : Infinity
          for (const th of b.thresholds) {
            if ((b.limit_amount === 0 || before < th) && afterFrac >= th && !db.prepare("SELECT 1 FROM budget_events WHERE budget_id=? AND kind='alert' AND json_extract(data,'$.threshold')=?").get(b.id, th)) {
              log(b.id, actor, 'alert', { threshold: th, used_after: u.used + amount, limit: b.limit_amount }); alerts.push({ budget: b.id, threshold: th })
            }
          }
        }
        return { reservation_id: rid, alerts, flags }
      })
    } catch (e) {
      if (e instanceof BudgetError) denial = e; else throw e
    }
    if (denial) { logOutside(budget_id, actor, 'denied', { code: denial.code, message: denial.message, amount, holder, purpose }); throw denial }
    return result
  }

  function getReservation(id) {
    const r = db.prepare('SELECT * FROM budget_reservations WHERE id=?').get(id)
    if (!r) throw new BudgetError('NOT_FOUND', `reservation ${id}`)
    return r
  }

  /** Settle a held reservation at its real usage. Idempotent for the same amount; expired holds refuse. */
  function settle(reservation_id, actual, { actor }) {
    requireActor(actor)
    if (!Number.isFinite(actual) || actual < 0) throw new BudgetError('BAD_REQUEST', 'actual must be >= 0')
    const probe = getReservation(reservation_id)
    allow(actor, 'settle', getBudget(probe.budget_id))
    return atomic(() => {
      const r = getReservation(reservation_id)
      if (r.state === 'settled') {
        if (r.settled_amount === actual) return { state: 'settled', settled_amount: actual, idempotent: true }
        throw new BudgetError('CONFLICT', `reservation ${r.id} already settled at ${r.settled_amount}`)
      }
      if (r.state !== 'held') throw new BudgetError('CONFLICT', `reservation ${r.id} is ${r.state}`)
      if (iso() > r.expires_at) throw new BudgetError('EXPIRED', `reservation ${r.id} hold expired; reserve again`)
      db.prepare("UPDATE budget_reservations SET state='settled', settled_amount=?, closed_at=? WHERE id=?").run(actual, iso(), r.id)
      const overrun = Math.max(0, actual - r.amount)
      log(r.budget_id, actor, 'settled', { reservation: r.id, reserved: r.amount, actual, overrun })
      if (overrun > 0) log(r.budget_id, actor, 'overrun', { reservation: r.id, overrun })
      return { state: 'settled', settled_amount: actual, overrun }
    })
  }

  function release(reservation_id, { actor }) {
    requireActor(actor)
    const probe = getReservation(reservation_id)
    allow(actor, 'release', getBudget(probe.budget_id))
    return atomic(() => {
      const r = getReservation(reservation_id)
      if (r.state === 'released') return { state: 'released', idempotent: true }
      if (r.state !== 'held') throw new BudgetError('CONFLICT', `reservation ${r.id} is ${r.state}`)
      db.prepare("UPDATE budget_reservations SET state='released', closed_at=? WHERE id=?").run(iso(), r.id)
      log(r.budget_id, actor, 'released', { reservation: r.id, amount: r.amount })
      return { state: 'released' }
    })
  }

  /** Free every hold past its expiry so a crashed holder cannot lock budget forever. Returns the expired ids. */
  function releaseStale({ actor }) {
    allow(actor, 'release_stale', null)
    return atomic(() => {
      const rows = db.prepare("SELECT id, budget_id, amount FROM budget_reservations WHERE state='held' AND expires_at < ?").all(iso())
      for (const r of rows) {
        db.prepare("UPDATE budget_reservations SET state='expired', closed_at=? WHERE id=?").run(iso(), r.id)
        log(r.budget_id, actor, 'expired', { reservation: r.id, amount: r.amount })
      }
      return rows.map((r) => r.id)
    })
  }

  function status(id) {
    const b = getBudget(id)
    if (!b) throw new BudgetError('NOT_FOUND', id)
    const u = used(id)
    return { id, limit: b.limit_amount, used: u.used, held: u.held, remaining: b.limit_amount - u.used, fraction: b.limit_amount > 0 ? u.used / b.limit_amount : null, mode: b.mode, unit: b.unit }
  }

  /** Ask for a higher limit. Creates a pending approval; it grants nothing by itself. */
  function requestRaise({ budget_id, amount, actor }) {
    const b = getBudget(budget_id)
    if (!b) throw new BudgetError('NOT_FOUND', budget_id)
    allow(actor, 'request_raise', b)
    if (!(amount > b.limit_amount)) throw new BudgetError('BAD_REQUEST', 'a raise must exceed the current limit')
    const id = newId('APR')
    db.prepare('INSERT INTO budget_approvals (id,budget_id,action,amount,requested_by,created_at) VALUES (?,?,?,?,?,?)').run(id, budget_id, 'raise_limit', amount, actor, iso())
    log(budget_id, actor, 'raise_requested', { approval: id, amount })
    return id
  }

  /** Decide an approval. Approval requires verifyHuman(approver, id) to hold; the requester cannot approve their own. */
  function decide(approval_id, { approver, approve }) {
    requireActor(approver)
    return atomic(() => {
      const a = db.prepare('SELECT * FROM budget_approvals WHERE id=?').get(approval_id)
      if (!a) throw new BudgetError('NOT_FOUND', approval_id)
      if (a.state !== 'pending') throw new BudgetError('CONFLICT', `approval is ${a.state}`)
      if (approve) {
        let human = false
        try { human = verifyHuman(approver, approval_id) === true } catch { human = false }
        if (!human) throw new BudgetError('FORBIDDEN', 'human proof required to approve')
        if (approver === a.requested_by) throw new BudgetError('FORBIDDEN', 'requester cannot approve their own request')
        allow(approver, 'approve', getBudget(a.budget_id))
      }
      db.prepare('UPDATE budget_approvals SET state=?, decided_by=?, decided_at=? WHERE id=?').run(approve ? 'approved' : 'denied', approver, iso(), approval_id)
      log(a.budget_id, approver, approve ? 'raise_approved' : 'raise_denied', { approval: approval_id })
      return { state: approve ? 'approved' : 'denied' }
    })
  }

  /** Apply an approved raise. The approval is consumed, so it cannot be replayed or reused for another amount. */
  function applyRaise({ budget_id, approval_id, actor }) {
    const b = getBudget(budget_id)
    if (!b) throw new BudgetError('NOT_FOUND', budget_id)
    allow(actor, 'raise_limit', b)
    return atomic(() => {
      const a = db.prepare('SELECT * FROM budget_approvals WHERE id=?').get(approval_id)
      if (!a || a.budget_id !== budget_id) throw new BudgetError('FORBIDDEN', 'no matching approval for this budget')
      if (a.state !== 'approved') throw new BudgetError('FORBIDDEN', `approval is ${a.state}, not approved`)
      db.prepare("UPDATE budget_approvals SET state='used' WHERE id=?").run(approval_id)
      db.prepare('UPDATE budgets SET limit_amount=?, rev=rev+1 WHERE id=?').run(a.amount, budget_id)
      log(budget_id, actor, 'limit_raised', { from: b.limit_amount, to: a.amount, approval: approval_id, approved_by: a.decided_by })
      return { limit: a.amount }
    })
  }

  /** Lowering a limit or deactivating needs authorization but no human proof: it can only reduce spend. */
  function lowerLimit({ budget_id, amount, actor }) {
    const b = getBudget(budget_id)
    if (!b) throw new BudgetError('NOT_FOUND', budget_id)
    allow(actor, 'lower_limit', b)
    if (!(amount >= 0 && amount < b.limit_amount)) throw new BudgetError('BAD_REQUEST', 'new limit must be lower than the current one')
    return atomic(() => { db.prepare('UPDATE budgets SET limit_amount=?, rev=rev+1 WHERE id=?').run(amount, budget_id); log(budget_id, actor, 'limit_lowered', { from: b.limit_amount, to: amount }); return { limit: amount } })
  }

  function deactivate(budget_id, { actor }) {
    const b = getBudget(budget_id)
    if (!b) throw new BudgetError('NOT_FOUND', budget_id)
    allow(actor, 'deactivate', b)
    return atomic(() => { db.prepare('UPDATE budgets SET active=0, rev=rev+1 WHERE id=?').run(budget_id); log(budget_id, actor, 'deactivated'); return { active: 0 } })
  }

  const events = (budget_id, kind) => db.prepare(`SELECT id, at, actor, kind, data FROM budget_events WHERE budget_id=?${kind ? ' AND kind=?' : ''} ORDER BY id`).all(...(kind ? [budget_id, kind] : [budget_id])).map((r) => ({ ...r, data: JSON.parse(r.data) }))

  return { createBudget, reserve, settle, release, releaseStale, status, requestRaise, decide, applyRaise, lowerLimit, deactivate, events, getBudget }
}
