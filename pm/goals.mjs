// Goals and measurable KPI model (T-ee323cb5). Standalone module over node:sqlite:
// migrateGoals(db) is idempotent and additive (CREATE IF NOT EXISTS only), so it can be
// called from store.mjs migrate() later without touching existing rows or IDs.
// Goals cascade (parent_id) or stand alone (parent_id NULL). A child may override any
// inherited field. Progress counts only VERIFIED evidence. Every change appends to
// goal_history, which triggers make append-only. Authority is checked from the role the
// server resolved for the actor - never from a client-supplied flag - and fails closed.

export const GOAL_SCOPES = ['organization', 'project']
export const GOAL_STATUSES = ['draft', 'active', 'achieved', 'missed', 'cancelled']
export const DIRECTIONS = ['increase', 'decrease', 'maintain']
export const GOAL_ROLES = { viewer: ['view'], contributor: ['view', 'evidence'], owner: ['view', 'evidence', 'edit'], admin: ['view', 'evidence', 'edit', 'verify', 'admin'] }
export const INHERITABLE = ['title', 'weight', 'owner', 'status', 'due']

const SCHEMA = `
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK (scope IN ('organization','project')),
  project_id TEXT, parent_id TEXT REFERENCES goals(id),
  title TEXT, owner TEXT, weight REAL, status TEXT, due TEXT,
  overrides TEXT NOT NULL DEFAULT '[]',
  rev INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS goals_parent ON goals(parent_id);
CREATE INDEX IF NOT EXISTS goals_project ON goals(project_id);
CREATE TABLE IF NOT EXISTS goal_metrics (
  id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL CHECK (direction IN ('increase','decrease','maintain')),
  baseline REAL NOT NULL, target REAL NOT NULL, weight REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, UNIQUE (goal_id, name));
CREATE TABLE IF NOT EXISTS goal_milestones (
  id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), title TEXT NOT NULL,
  due TEXT, done_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goal_evidence (
  id TEXT PRIMARY KEY, metric_id TEXT NOT NULL REFERENCES goal_metrics(id), value REAL NOT NULL, ref TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL, submitted_by TEXT NOT NULL, verified_by TEXT, verified_at TEXT);
CREATE INDEX IF NOT EXISTS goal_evidence_metric ON goal_evidence(metric_id, observed_at);
CREATE TABLE IF NOT EXISTS goal_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, goal_id TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}');
CREATE TRIGGER IF NOT EXISTS goal_history_no_update BEFORE UPDATE ON goal_history BEGIN SELECT RAISE(ABORT, 'goal_history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS goal_history_no_delete BEFORE DELETE ON goal_history BEGIN SELECT RAISE(ABORT, 'goal_history is append-only'); END;
`

export function migrateGoals(db) { db.exec(SCHEMA) }

const nowIso = () => new Date().toISOString()
let seq = 0
const newId = (p) => `${p}-${Date.now().toString(36)}${(seq++ % 1296).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export class GoalError extends Error { constructor(code, msg) { super(msg); this.code = code } }

/** Fail closed: unknown role or missing permission throws FORBIDDEN. */
export function assertGoalAllowed(role, perm) {
  const perms = GOAL_ROLES[role]
  if (!perms || !perms.includes(perm)) throw new GoalError('FORBIDDEN', `role ${role ?? '(none)'} may not ${perm}`)
}

function log(db, goalId, actor, action, data = {}) {
  db.prepare('INSERT INTO goal_history (at, goal_id, actor, action, data) VALUES (?,?,?,?,?)').run(nowIso(), goalId, actor, action, JSON.stringify(data))
}
function requireActor(a) { if (!a || typeof a !== 'string') throw new GoalError('FORBIDDEN', 'actor identity required'); return a }
function atomic(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { try { db.exec('ROLLBACK') } catch {} throw e }
}

export function createGoal(db, { id, scope, project_id = null, parent_id = null, title, owner = null, weight, status, due = null, actor, role }) {
  if (weight === undefined) weight = parent_id ? null : 1
  if (status === undefined) status = parent_id ? null : 'draft'
  requireActor(actor); assertGoalAllowed(role, 'edit')
  if (!GOAL_SCOPES.includes(scope)) throw new GoalError('BAD_REQUEST', `bad scope ${scope}`)
  if (scope === 'project' && !project_id) throw new GoalError('BAD_REQUEST', 'project goal needs project_id')
  if (scope === 'organization' && project_id) throw new GoalError('BAD_REQUEST', 'organization goal cannot have project_id')
  if (status !== null && !GOAL_STATUSES.includes(status)) throw new GoalError('BAD_REQUEST', `bad status ${status}`)
  if (weight !== null && !(weight >= 0)) throw new GoalError('BAD_REQUEST', 'weight must be >= 0')
  if (!title) throw new GoalError('BAD_REQUEST', 'title required')
  return atomic(db, () => {
    const gid = id || newId('G')
    if (db.prepare('SELECT 1 FROM goals WHERE id=?').get(gid)) throw new GoalError('CONFLICT', `goal ${gid} exists (ids are preserved, never reused)`)
    if (parent_id) {
      const p = db.prepare('SELECT scope FROM goals WHERE id=?').get(parent_id)
      if (!p) throw new GoalError('NOT_FOUND', `parent ${parent_id}`)
      if (p.scope === 'project' && scope === 'organization') throw new GoalError('BAD_REQUEST', 'organization goal cannot sit under a project goal')
    }
    const t = nowIso()
    const set = { title, owner, weight, status, due }
    const overrides = parent_id ? INHERITABLE.filter((f) => set[f] != null) : []
    db.prepare('INSERT INTO goals (id,scope,project_id,parent_id,title,owner,weight,status,due,overrides,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(gid, scope, project_id, parent_id, title, owner, weight, status, due, JSON.stringify(overrides), t, actor, t)
    log(db, gid, actor, 'created', { scope, project_id, parent_id, title, weight })
    return gid
  })
}

/** Raw row with overrides parsed. */
export function getGoal(db, id) {
  const g = db.prepare('SELECT * FROM goals WHERE id=?').get(id)
  return g ? { ...g, overrides: JSON.parse(g.overrides) } : null
}

/** Set an individual field. On a child, the field is recorded as an override so it stops following the parent. */
export function updateGoal(db, id, patch, { actor, role, rev }) {
  requireActor(actor); assertGoalAllowed(role, 'edit')
  return atomic(db, () => {
    const g = getGoal(db, id)
    if (!g) throw new GoalError('NOT_FOUND', id)
    if (rev !== undefined && rev !== g.rev) throw new GoalError('CONFLICT', `rev ${g.rev} != ${rev}`)
    const fields = Object.keys(patch)
    for (const f of fields) if (!INHERITABLE.includes(f)) throw new GoalError('BAD_REQUEST', `field ${f} not editable`)
    if ('status' in patch && !GOAL_STATUSES.includes(patch.status)) throw new GoalError('BAD_REQUEST', 'bad status')
    if ('weight' in patch && !(patch.weight >= 0)) throw new GoalError('BAD_REQUEST', 'weight must be >= 0')
    const overrides = new Set(g.overrides)
    if (g.parent_id) for (const f of fields) overrides.add(f)
    const sets = fields.map((f) => `${f}=?`).concat(['overrides=?', 'rev=rev+1', 'updated_at=?'])
    db.prepare(`UPDATE goals SET ${sets.join(',')} WHERE id=?`).run(...fields.map((f) => patch[f]), JSON.stringify([...overrides]), nowIso(), id)
    log(db, id, actor, 'updated', { patch, overridden: g.parent_id ? fields : [] })
    return getGoal(db, id)
  })
}

/** Drop an override so the field follows the parent again. */
export function clearOverride(db, id, field, { actor, role }) {
  requireActor(actor); assertGoalAllowed(role, 'edit')
  return atomic(db, () => {
    const g = getGoal(db, id)
    if (!g) throw new GoalError('NOT_FOUND', id)
    const o = g.overrides.filter((f) => f !== field)
    db.prepare('UPDATE goals SET overrides=?, rev=rev+1, updated_at=? WHERE id=?').run(JSON.stringify(o), nowIso(), id)
    log(db, id, actor, 'override_cleared', { field })
    return getGoal(db, id)
  })
}

/** Cascade-resolved view: a child inherits unset or non-overridden fields from its nearest ancestor. */
export function effectiveGoal(db, id) {
  const g = getGoal(db, id)
  if (!g) return null
  const out = { ...g, inherited: [] }
  if (g.parent_id) {
    const parent = effectiveGoal(db, g.parent_id)
    for (const f of INHERITABLE) {
      if (!g.overrides.includes(f) && parent && parent[f] != null) { out[f] = parent[f]; out.inherited.push(f) }
    }
  }
  return out
}

export function addMetric(db, goal_id, { id, name, unit = '', direction, baseline, target, weight = 1 }, { actor, role }) {
  requireActor(actor); assertGoalAllowed(role, 'edit')
  if (!DIRECTIONS.includes(direction)) throw new GoalError('BAD_REQUEST', `bad direction ${direction}`)
  if (![baseline, target].every(Number.isFinite)) throw new GoalError('BAD_REQUEST', 'baseline and target must be numbers')
  if (direction === 'increase' && target <= baseline) throw new GoalError('BAD_REQUEST', 'increase needs target > baseline')
  if (direction === 'decrease' && target >= baseline) throw new GoalError('BAD_REQUEST', 'decrease needs target < baseline')
  if (!(weight > 0)) throw new GoalError('BAD_REQUEST', 'metric weight must be > 0')
  return atomic(db, () => {
    if (!getGoal(db, goal_id)) throw new GoalError('NOT_FOUND', goal_id)
    const mid = id || newId('M')
    db.prepare('INSERT INTO goal_metrics (id,goal_id,name,unit,direction,baseline,target,weight,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(mid, goal_id, name, unit, direction, baseline, target, weight, nowIso())
    log(db, goal_id, actor, 'metric_added', { metric: mid, name, direction, baseline, target })
    return mid
  })
}

export function addMilestone(db, goal_id, { id, title, due = null }, { actor, role }) {
  requireActor(actor); assertGoalAllowed(role, 'edit')
  return atomic(db, () => {
    if (!getGoal(db, goal_id)) throw new GoalError('NOT_FOUND', goal_id)
    const mid = id || newId('MS')
    db.prepare('INSERT INTO goal_milestones (id,goal_id,title,due,created_at) VALUES (?,?,?,?,?)').run(mid, goal_id, title, due, nowIso())
    log(db, goal_id, actor, 'milestone_added', { milestone: mid, title, due })
    return mid
  })
}

export function completeMilestone(db, milestone_id, { actor, role }) {
  requireActor(actor); assertGoalAllowed(role, 'edit')
  return atomic(db, () => {
    const m = db.prepare('SELECT * FROM goal_milestones WHERE id=?').get(milestone_id)
    if (!m) throw new GoalError('NOT_FOUND', milestone_id)
    if (m.done_at) return m
    const t = nowIso()
    db.prepare('UPDATE goal_milestones SET done_at=? WHERE id=?').run(t, milestone_id)
    log(db, m.goal_id, actor, 'milestone_done', { milestone: milestone_id })
    return { ...m, done_at: t }
  })
}

/** Submit a measurement. It counts toward progress only after someone else with verify rights confirms it. */
export function submitEvidence(db, metric_id, { id, value, ref = '', observed_at }, { actor, role }) {
  requireActor(actor); assertGoalAllowed(role, 'evidence')
  if (!Number.isFinite(value)) throw new GoalError('BAD_REQUEST', 'value must be a number')
  return atomic(db, () => {
    const m = db.prepare('SELECT goal_id FROM goal_metrics WHERE id=?').get(metric_id)
    if (!m) throw new GoalError('NOT_FOUND', metric_id)
    const eid = id || newId('E')
    db.prepare('INSERT INTO goal_evidence (id,metric_id,value,ref,observed_at,submitted_by) VALUES (?,?,?,?,?,?)').run(eid, metric_id, value, ref, observed_at || nowIso(), actor)
    log(db, m.goal_id, actor, 'evidence_submitted', { evidence: eid, metric: metric_id, value, ref })
    return eid
  })
}

export function verifyEvidence(db, evidence_id, { actor, role }) {
  requireActor(actor); assertGoalAllowed(role, 'verify')
  return atomic(db, () => {
    const e = db.prepare('SELECT e.*, m.goal_id FROM goal_evidence e JOIN goal_metrics m ON m.id=e.metric_id WHERE e.id=?').get(evidence_id)
    if (!e) throw new GoalError('NOT_FOUND', evidence_id)
    if (e.submitted_by === actor) throw new GoalError('FORBIDDEN', 'submitter cannot verify their own evidence')
    if (e.verified_at) return e
    db.prepare('UPDATE goal_evidence SET verified_by=?, verified_at=? WHERE id=?').run(actor, nowIso(), evidence_id)
    log(db, e.goal_id, actor, 'evidence_verified', { evidence: evidence_id })
    return db.prepare('SELECT * FROM goal_evidence WHERE id=?').get(evidence_id)
  })
}

/** Direction-aware progress 0..1. maintain: 1 within tol of target, falling off linearly to 0 at 2*tol. */
export function metricProgress({ direction, baseline, target }, value, tol = 0) {
  if (!Number.isFinite(value)) return 0
  let p
  if (direction === 'maintain') {
    const dev = Math.abs(value - target)
    p = dev <= tol ? 1 : tol > 0 ? 1 - (dev - tol) / tol : 0
  } else p = (value - baseline) / (target - baseline)
  return Math.max(0, Math.min(1, p))
}

/** Latest VERIFIED value per metric -> weighted progress. Unverified evidence is reported but never counted. */
export function goalProgress(db, id) {
  const metrics = db.prepare('SELECT * FROM goal_metrics WHERE goal_id=?').all(id)
  const detail = metrics.map((m) => {
    const v = db.prepare('SELECT value, observed_at FROM goal_evidence WHERE metric_id=? AND verified_at IS NOT NULL ORDER BY observed_at DESC, rowid DESC LIMIT 1').get(m.id)
    const pending = db.prepare('SELECT COUNT(*) n FROM goal_evidence WHERE metric_id=? AND verified_at IS NULL').get(m.id).n
    return { metric: m.id, name: m.name, verified_value: v ? v.value : null, progress: v ? metricProgress(m, v.value) : 0, weight: m.weight, unverified_pending: pending }
  })
  const w = detail.reduce((s, d) => s + d.weight, 0)
  const metricsProgress = w ? detail.reduce((s, d) => s + d.progress * d.weight, 0) / w : null
  const ms = db.prepare('SELECT COUNT(*) n, SUM(done_at IS NOT NULL) d FROM goal_milestones WHERE goal_id=?').get(id)
  const milestoneProgress = ms.n ? ms.d / ms.n : null
  const parts = [metricsProgress, milestoneProgress].filter((x) => x !== null)
  const own = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
  return { goal_id: id, metrics: detail, milestones: ms.n ? { total: ms.n, done: ms.d } : null, progress: own }
}

/** Weighted rollup over children (weights normalised among siblings that have progress); falls back to own progress. */
export function rollup(db, id) {
  const kids = db.prepare('SELECT id FROM goals WHERE parent_id=?').all(id).map((r) => effectiveGoal(db, r.id)).filter((k) => !['cancelled', 'draft'].includes(k.status))
  const own = goalProgress(db, id).progress
  const parts = kids.map((k) => ({ id: k.id, weight: k.weight ?? 1, progress: rollup(db, k.id) })).filter((k) => k.progress !== null && k.weight > 0)
  if (!parts.length) return own
  const w = parts.reduce((s, p) => s + p.weight, 0)
  const kidP = parts.reduce((s, p) => s + p.progress * p.weight, 0) / w
  return own === null ? kidP : (own + kidP) / 2
}

export function goalHistory(db, goal_id) {
  return db.prepare('SELECT id, at, actor, action, data FROM goal_history WHERE goal_id=? ORDER BY id').all(goal_id).map((r) => ({ ...r, data: JSON.parse(r.data) }))
}
