// Goals, metrics and token intelligence - HTTP wiring (T-805b65ed). Mounts goals.mjs,
// usage-ledger.mjs and budgets.mjs on pm's store db and builds the dashboard / project views.
//
// Authority is resolved here on the server from the request principal, never from the UI:
//   - loopback / peer / no bridge principal (already authenticated by server.mjs) -> admin
//   - any other principal -> role_assignments in the bridge db (roles.roleOf); none -> refused
//   pm role -> goal role: admin->admin, manager->owner, worker->contributor, client->viewer
// A client sees goals only: usage and budgets are refused (fail closed).
// Budget raises need a human proof: the one-time code of an approvals.mjs 'elevation'
// approval bound to the budget approval id (verifyHuman). Only a trusted principal may
// approve, and when the auth db is unavailable the approval path is closed.

import { PmError } from './store.mjs'
import * as roles from './roles.mjs'
import * as approvals from './approvals.mjs'
import { approvalAuthorizer, TRUSTED_PRINCIPALS } from './access.mjs'
import * as G from './goals.mjs'
import * as L from './usage-ledger.mjs'
import { createBudgetOps, BudgetError } from './budgets.mjs'

const STATUS = { BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID_PROOF: 403, REPLAY: 409, IDENTITY_MISMATCH: 403, EXPIRED: 410, INACTIVE: 409, CAP_EXCEEDED: 409, BUDGET_EXCEEDED: 409 }
export function asPmError(err) {
  if (err instanceof PmError) return err
  if ((err instanceof G.GoalError || err instanceof L.LedgerError || err instanceof BudgetError) && STATUS[err.code]) return new PmError(STATUS[err.code], err.message, { code: err.code, ...(err.extra || {}) })
  if (err?.code && STATUS[err.code]) return new PmError(STATUS[err.code], err.message, { code: err.code })
  if (/FOREIGN KEY|CHECK constraint|NOT NULL constraint|UNIQUE constraint/.test(String(err?.message))) return new PmError(400, String(err.message))
  return err
}
const guard = (fn) => (...a) => { try { return fn(...a) } catch (e) { throw asPmError(e) } }

const TO_GOAL_ROLE = { admin: 'admin', manager: 'owner', worker: 'contributor', client: 'viewer' }
const BUDGET_PERMS = {
  admin: ['create_budget', 'reserve', 'settle', 'release', 'release_stale', 'request_raise', 'approve', 'raise_limit', 'lower_limit', 'deactivate'],
  manager: ['reserve', 'settle', 'release', 'request_raise', 'lower_limit'],
  worker: ['reserve', 'settle', 'release', 'request_raise'],
  client: [],
}
const USAGE_INGEST = ['admin', 'manager', 'worker']
const USAGE_VIEW = ['admin', 'manager', 'worker']

export function insightsRoutes({ store, authDb = () => null }) {
  const db = store.db

  /** pm role of the request principal for a project (undefined = any / global). null = no access. */
  function pmRole(principal, project) {
    if (!principal || TRUSTED_PRINCIPALS.has(principal.name)) return 'admin'
    const adb = authDb()
    if (!adb) return null
    try { return roles.roleOf(adb, principal.name, project) } catch { return null }
  }
  const trusted = (principal) => !principal || TRUSTED_PRINCIPALS.has(principal.name)
  function need(principal, project, roleList, what) {
    const r = pmRole(principal, project)
    if (!r || !roleList.includes(r)) throw new PmError(403, `${what} is not permitted for this role`)
    return r
  }
  const goalCtx = (principal, w, project) => {
    const r = pmRole(principal, project)
    return { actor: w.actor, role: r ? TO_GOAL_ROLE[r] : null }
  }
  const actorOf = (w) => { if (!w.actor) throw new PmError(400, 'actor is required'); return w.actor }

  const projectIds = () => db.prepare('SELECT id, name FROM projects').all()
  function visibleProjectIds(principal) {
    return new Set(projectIds().filter((p) => pmRole(principal, p.id)).map((p) => p.id))
  }
  const taskProject = (task_id) => (task_id ? db.prepare('SELECT project_id FROM tasks WHERE id=?').get(task_id)?.project_id ?? null : null)

  // ---------------------------------------------------------------- goals
  function goalView(id) {
    const e = G.effectiveGoal(db, id)
    const p = G.goalProgress(db, id)
    const metrics = db.prepare('SELECT * FROM goal_metrics WHERE goal_id=? ORDER BY created_at').all(id).map((m) => ({
      ...m,
      verified_series: db.prepare('SELECT value, observed_at, verified_by FROM goal_evidence WHERE metric_id=? AND verified_at IS NOT NULL ORDER BY observed_at, rowid').all(m.id),
      evidence_pending: db.prepare('SELECT id, value, ref, observed_at, submitted_by FROM goal_evidence WHERE metric_id=? AND verified_at IS NULL ORDER BY observed_at').all(m.id),
      progress: p.metrics.find((x) => x.metric === m.id)?.progress ?? 0,
      verified_value: p.metrics.find((x) => x.metric === m.id)?.verified_value ?? null,
    }))
    const milestones = db.prepare('SELECT * FROM goal_milestones WHERE goal_id=? ORDER BY created_at').all(id)
    return { ...e, own_progress: p.progress, progress: G.rollup(db, id), metrics, milestones }
  }
  function visibleGoal(principal, g) {
    return g.project_id ? Boolean(pmRole(principal, g.project_id)) : Boolean(pmRole(principal, undefined))
  }
  function listGoals(principal, { project } = {}) {
    const rows = db.prepare(`SELECT id FROM goals ${project ? 'WHERE project_id=?' : ''} ORDER BY created_at, id`).all(...(project ? [project] : []))
    return rows.map((r) => G.getGoal(db, r.id)).filter((g) => visibleGoal(principal, g)).map((g) => goalView(g.id))
  }
  const goalOrDie = (id, principal) => {
    const g = G.getGoal(db, id)
    if (!g || !visibleGoal(principal, g)) throw new PmError(404, `goal ${id} not found`)
    return g
  }
  const metricGoal = (metric_id, principal) => {
    const m = db.prepare('SELECT goal_id FROM goal_metrics WHERE id=?').get(metric_id)
    if (!m) throw new PmError(404, `metric ${metric_id} not found`)
    return goalOrDie(m.goal_id, principal)
  }

  // ---------------------------------------------------------------- usage
  function eventsFor(principal, filter = {}) {
    const vis = visibleProjectIds(principal)
    const tasks = new Map(db.prepare('SELECT id, project_id FROM tasks').all().map((t) => [t.id, t.project_id]))
    const global = pmRole(principal, undefined) === 'admin'
    return L.liveEvents(db, filter).filter((e) => {
      const pid = e.task_id ? tasks.get(e.task_id) : null
      if (filter.project && pid !== filter.project) return false
      if (pid) return vis.has(pid)
      return global // events not tied to a project are admin-only
    })
  }
  const tok = (e) => e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens
  function usageSummary(events) {
    const out = { events: events.length, tokens: 0, cost_usd: 0, by_cost_class: {}, by_provider: {}, by_model: {}, by_basis: {}, by_day: {}, by_task: {}, by_agent: {} }
    const add = (map, key, e) => { const b = map[key] ||= { events: 0, tokens: 0, cost_usd: 0 }; b.events++; b.tokens += tok(e); b.cost_usd += e.cost_usd }
    for (const e of events) {
      out.tokens += tok(e); out.cost_usd += e.cost_usd
      add(out.by_cost_class, e.cost_class, e); add(out.by_provider, e.provider, e); add(out.by_model, `${e.provider}/${e.model}`, e)
      add(out.by_basis, e.basis, e); add(out.by_day, e.occurred_at.slice(0, 10), e); add(out.by_task, e.task_id ?? '(none)', e); add(out.by_agent, e.agent ?? '(none)', e)
    }
    return out
  }
  function poolsFor(events) {
    const pools = {}
    for (const e of events) if (e.quota_pool) { const p = pools[e.quota_pool] ||= { quota_pool: e.quota_pool, events: 0, tokens: 0, by_agent: {} }; p.events++; p.tokens += tok(e); p.by_agent[e.agent ?? '(none)'] = (p.by_agent[e.agent ?? '(none)'] || 0) + tok(e) }
    return Object.values(pools)
  }
  function goalCosts(events) {
    const goals = {}; const un = { tokens: 0, cost_usd: 0 }
    for (const e of events) {
      const a = L.getAllocation(db, e.event_id)
      for (const l of a.lines) { const g = goals[l.goal_id] ||= { tokens: 0, cost_usd: 0 }; g.tokens += tok(e) * l.pct / 100; g.cost_usd += e.cost_usd * l.pct / 100 }
      un.tokens += tok(e) * a.unattributed_pct / 100; un.cost_usd += e.cost_usd * a.unattributed_pct / 100
    }
    return { goals, unattributed: un }
  }

  // -------------------------------------------------------------- budgets
  function opsFor(principal) {
    const adb = authDb()
    return createBudgetOps({
      db,
      authorize: (actor, action, budget) => {
        const project = budget?.level === 'project' ? budget.subject : undefined
        const r = pmRole(principal, project)
        return Boolean(r && (BUDGET_PERMS[r] || []).includes(action))
      },
      verifyHuman: (approver, id) => {
        if (!adb || !trusted(principal)) return false
        const a = approvals.listApprovals(adb, { kind: 'elevation', limit: 1000 }).find((x) => x.scope?.budget_approval === id)
        return Boolean(a && a.status === 'approved' && a.approver === approver && a.method === 'otp' && approvals.isApprovalValid(adb, a.id))
      },
    })
  }
  function budgetsFor(principal) {
    if (!USAGE_VIEW.includes(pmRole(principal, undefined) ?? '')) return []
    const ops = opsFor(principal)
    return db.prepare('SELECT id FROM budgets ORDER BY level, subject').all().map((r) => {
      const b = ops.getBudget(r.id)
      if (b.level === 'project' && !pmRole(principal, b.subject)) return null
      return { ...b, ...ops.status(r.id) }
    }).filter(Boolean)
  }

  // --------------------------------------------------------------- alerts
  function alertsFor(principal, { goals, budgets, summary, goalCost }) {
    const out = []
    const nowIso = new Date().toISOString()
    for (const b of budgets) {
      if (b.fraction === null) continue
      const pct = Math.round(b.fraction * 100)
      if (b.fraction >= 1) out.push({ severity: 'high', kind: 'budget_exceeded', ref: b.id, label: `Budget ${b.subject} (${b.level}) at ${pct}% of ${b.limit} ${b.unit}`, status_text: 'Over limit' })
      else if (b.fraction >= 0.8) out.push({ severity: 'medium', kind: 'budget_threshold', ref: b.id, label: `Budget ${b.subject} (${b.level}) at ${pct}% of ${b.limit} ${b.unit}`, status_text: 'Near limit' })
    }
    const stale = db.prepare("SELECT COUNT(*) n FROM budget_reservations WHERE state='held' AND expires_at < ?").get(nowIso).n
    if (stale && budgets.length) out.push({ severity: 'medium', kind: 'stale_reservations', ref: '', label: `${stale} expired reservation hold(s) not yet released`, status_text: 'Needs cleanup' })
    for (const g of goals) {
      if (['achieved', 'cancelled', 'draft'].includes(g.status)) continue
      if (g.due && g.due < nowIso.slice(0, 10)) out.push({ severity: 'high', kind: 'goal_overdue', ref: g.id, label: `Goal "${g.title}" was due ${g.due} at ${Math.round((g.progress ?? 0) * 100)}%`, status_text: 'Overdue' })
      const pend = g.metrics.reduce((s, m) => s + m.evidence_pending.length, 0)
      if (pend) out.push({ severity: 'low', kind: 'evidence_unverified', ref: g.id, label: `Goal "${g.title}" has ${pend} unverified evidence item(s)`, status_text: 'Awaiting verification' })
    }
    if (summary && summary.tokens > 0 && goalCost) {
      const share = goalCost.unattributed.tokens / summary.tokens
      if (share > 0.5) out.push({ severity: 'low', kind: 'unattributed_usage', ref: '', label: `${Math.round(share * 100)}% of tokens are not attributed to any goal`, status_text: 'Unattributed' })
    }
    const rank = { high: 0, medium: 1, low: 2 }
    return out.sort((a, b) => rank[a.severity] - rank[b.severity])
  }

  function dashboard(principal, query) {
    const role = pmRole(principal, undefined)
    if (!role) throw new PmError(403, 'no role for insights')
    const project = query.project || undefined
    let goals = listGoals(principal, { project })
    if (query.status) goals = goals.filter((g) => g.status === query.status)
    if (query.q) { const q = query.q.toLowerCase(); goals = goals.filter((g) => String(g.title).toLowerCase().includes(q)) }
    const seesUsage = USAGE_VIEW.includes(role)
    const events = seesUsage ? eventsFor(principal, project ? { project } : {}) : []
    const summary = seesUsage ? usageSummary(events) : null
    const goalCost = seesUsage ? goalCosts(events) : null
    const budgets = budgetsFor(principal).filter((b) => !project || b.level !== 'project' || b.subject === project)
    const names = new Map(projectIds().map((p) => [p.id, p.name]))
    const projects = [...visibleProjectIds(principal)].filter((id) => !project || id === project).map((id) => {
      const pg = goals.filter((g) => g.project_id === id && !g.parent_id)
      const pe = seesUsage ? usageSummary(events.filter((e) => taskProject(e.task_id) === id)) : null
      const prog = pg.filter((g) => g.progress !== null)
      return { id, name: names.get(id), goals: pg.length, progress: prog.length ? prog.reduce((s, g) => s + g.progress, 0) / prog.length : null, tokens: pe?.tokens ?? null, cost_usd: pe?.cost_usd ?? null }
    })
    return {
      generated_at: new Date().toISOString(), role, can: { usage: seesUsage, edit_goals: ['admin', 'manager'].includes(role), budgets: BUDGET_PERMS[role] || [] },
      goals, projects, usage: summary && { ...summary, pools: poolsFor(events), by_goal: goalCost },
      budgets, alerts: alertsFor(principal, { goals, budgets, summary, goalCost }),
    }
  }

  function projectInsights(principal, pid) {
    const proj = db.prepare('SELECT id, name, description FROM projects WHERE id=?').get(pid) || db.prepare('SELECT id, name, description FROM projects WHERE name=?').get(pid)
    if (!proj || !pmRole(principal, proj.id)) throw new PmError(404, `project ${pid} not found`)
    const d = dashboard(principal, { project: proj.id })
    const role = pmRole(principal, proj.id)
    const events = USAGE_VIEW.includes(role) ? eventsFor(principal, { project: proj.id }) : []
    const tasks = db.prepare('SELECT id, title, status FROM tasks WHERE project_id=?').all(proj.id)
    const byTask = usageSummary(events).by_task
    return { project: proj, ...d, role, tasks: tasks.map((t) => ({ ...t, usage: byTask[t.id] || { events: 0, tokens: 0, cost_usd: 0 } })), resources: { pools: d.usage?.pools ?? [], budgets: d.budgets, by_cost_class: d.usage?.by_cost_class ?? {} } }
  }

  // --------------------------------------------------------------- routes
  const R = []
  const add = (method, re, fn) => R.push([method, re, (m, b, w, q, p) => guard(fn)(m, b, w, q, p)])

  add('GET', /^\/api\/insights\/dashboard$/, (m, b, w, q, p) => dashboard(p, q))
  add('GET', /^\/api\/projects\/([\w-]+)\/insights$/, (m, b, w, q, p) => projectInsights(p, m[1]))

  add('GET', /^\/api\/goals$/, (m, b, w, q, p) => listGoals(p, q))
  add('POST', /^\/api\/goals$/, (m, b, w, q, p) => {
    if (!b.project_id) need(p, undefined, ['admin'], 'creating an organization goal')
    const c = goalCtx(p, w, b.project_id ?? undefined)
    const id = G.createGoal(db, { ...b, ...c }); return goalView(id)
  })
  add('GET', /^\/api\/goals\/([\w-]+)$/, (m, b, w, q, p) => { goalOrDie(m[1], p); return { ...goalView(m[1]), history: G.goalHistory(db, m[1]) } })
  add('PATCH', /^\/api\/goals\/([\w-]+)$/, (m, b, w, q, p) => {
    const g = goalOrDie(m[1], p); const { rev, ...patch } = b; delete patch.actor; delete patch.model
    G.updateGoal(db, m[1], patch, { ...goalCtx(p, w, g.project_id ?? undefined), rev }); return goalView(m[1])
  })
  add('POST', /^\/api\/goals\/([\w-]+)\/metrics$/, (m, b, w, q, p) => { const g = goalOrDie(m[1], p); return { id: G.addMetric(db, m[1], b, goalCtx(p, w, g.project_id ?? undefined)) } })
  add('POST', /^\/api\/goals\/([\w-]+)\/milestones$/, (m, b, w, q, p) => { const g = goalOrDie(m[1], p); return { id: G.addMilestone(db, m[1], b, goalCtx(p, w, g.project_id ?? undefined)) } })
  add('POST', /^\/api\/goal-milestones\/([\w-]+)\/complete$/, (m, b, w, q, p) => {
    const ms = db.prepare('SELECT goal_id FROM goal_milestones WHERE id=?').get(m[1]); if (!ms) throw new PmError(404, 'milestone not found')
    const g = goalOrDie(ms.goal_id, p); return G.completeMilestone(db, m[1], goalCtx(p, w, g.project_id ?? undefined))
  })
  add('POST', /^\/api\/goal-metrics\/([\w-]+)\/evidence$/, (m, b, w, q, p) => { const g = metricGoal(m[1], p); return { id: G.submitEvidence(db, m[1], b, goalCtx(p, w, g.project_id ?? undefined)) } })
  add('POST', /^\/api\/goal-evidence\/([\w-]+)\/verify$/, (m, b, w, q, p) => {
    const e = db.prepare('SELECT m.goal_id FROM goal_evidence e JOIN goal_metrics m ON m.id=e.metric_id WHERE e.id=?').get(m[1]); if (!e) throw new PmError(404, 'evidence not found')
    const g = goalOrDie(e.goal_id, p); return G.verifyEvidence(db, m[1], goalCtx(p, w, g.project_id ?? undefined))
  })

  add('POST', /^\/api\/usage\/events$/, (m, b, w, q, p) => {
    const pid = taskProject(b.task_id)
    need(p, pid ?? undefined, USAGE_INGEST, 'usage ingestion')
    return L.ingestEvent(db, b, { actor: actorOf(w) })
  })
  add('POST', /^\/api\/usage\/events\/([\w.:-]+)\/allocations$/, (m, b, w, q, p) => {
    const e = db.prepare('SELECT task_id FROM usage_events WHERE event_id=?').get(m[1]); if (!e) throw new PmError(404, 'event not found')
    need(p, taskProject(e.task_id) ?? undefined, ['admin', 'manager'], 'allocation')
    return L.setAllocations(db, m[1], b.lines || [], { actor: actorOf(w) })
  })
  add('GET', /^\/api\/usage\/summary$/, (m, b, w, q, p) => {
    need(p, undefined, USAGE_VIEW, 'usage view')
    const ev = eventsFor(p, q); return { ...usageSummary(ev), pools: poolsFor(ev), by_goal: goalCosts(ev) }
  })
  add('GET', /^\/api\/usage\/events$/, (m, b, w, q, p) => { need(p, undefined, USAGE_VIEW, 'usage view'); return eventsFor(p, q).map((e) => ({ ...e, tokens: tok(e), allocation: L.getAllocation(db, e.event_id) })) })
  add('GET', /^\/api\/usage\/audit$/, (m, b, w, q, p) => { need(p, undefined, ['admin'], 'usage audit'); return L.auditTrail(db, q.event_id) })

  add('GET', /^\/api\/budgets$/, (m, b, w, q, p) => { need(p, undefined, USAGE_VIEW, 'budget view'); return budgetsFor(p) })
  add('POST', /^\/api\/budgets$/, (m, b, w, q, p) => ({ id: opsFor(p).createBudget({ ...b, actor: actorOf(w) }) }))
  add('GET', /^\/api\/budgets\/([\w-]+)$/, (m, b, w, q, p) => {
    need(p, undefined, USAGE_VIEW, 'budget view'); const ops = opsFor(p)
    const bg = ops.getBudget(m[1]); if (!bg) throw new PmError(404, 'budget not found')
    if (bg.level === 'project') need(p, bg.subject, USAGE_VIEW, 'budget view')
    return { ...bg, ...ops.status(m[1]), events: ops.events(m[1]) }
  })
  add('POST', /^\/api\/budgets\/([\w-]+)\/reserve$/, (m, b, w, q, p) => opsFor(p).reserve({ ...b, budget_id: m[1], actor: actorOf(w) }))
  add('POST', /^\/api\/budget-reservations\/([\w-]+)\/settle$/, (m, b, w, q, p) => opsFor(p).settle(m[1], b.actual, { actor: actorOf(w) }))
  add('POST', /^\/api\/budget-reservations\/([\w-]+)\/release$/, (m, b, w, q, p) => opsFor(p).release(m[1], { actor: actorOf(w) }))
  add('POST', /^\/api\/budgets\/release-stale$/, (m, b, w, q, p) => ({ expired: opsFor(p).releaseStale({ actor: actorOf(w) }) }))
  add('POST', /^\/api\/budgets\/([\w-]+)\/raise-request$/, (m, b, w, q, p) => ({ approval_id: opsFor(p).requestRaise({ budget_id: m[1], amount: b.amount, actor: actorOf(w) }) }))
  add('POST', /^\/api\/budgets\/([\w-]+)\/lower$/, (m, b, w, q, p) => opsFor(p).lowerLimit({ budget_id: m[1], amount: b.amount, actor: actorOf(w) }))
  add('POST', /^\/api\/budgets\/([\w-]+)\/deactivate$/, (m, b, w, q, p) => opsFor(p).deactivate(m[1], { actor: actorOf(w) }))
  add('POST', /^\/api\/budgets\/([\w-]+)\/apply-raise$/, (m, b, w, q, p) => opsFor(p).applyRaise({ budget_id: m[1], approval_id: b.approval_id, actor: actorOf(w) }))
  add('GET', /^\/api\/budget-approvals$/, (m, b, w, q, p) => {
    need(p, undefined, ['admin', 'manager'], 'budget approvals')
    return db.prepare('SELECT * FROM budget_approvals ORDER BY created_at DESC LIMIT 200').all()
  })
  // Issue the one-time code for a pending budget approval. Trusted principals only.
  add('POST', /^\/api\/budget-approvals\/([\w-]+)\/challenge$/, (m, b, w, q, p) => {
    const adb = authDb()
    if (!adb) throw new PmError(403, 'human approval is unavailable: no approvals store')
    if (!trusted(p)) throw new PmError(403, 'only a trusted principal may request a human approval code')
    const a = db.prepare('SELECT * FROM budget_approvals WHERE id=?').get(m[1])
    if (!a) throw new PmError(404, 'budget approval not found')
    if (a.state !== 'pending') throw new PmError(409, `approval is ${a.state}`)
    const approver = b.approver || w.actor
    if (!approver) throw new PmError(400, 'approver required')
    let rec = approvals.listApprovals(adb, { kind: 'elevation', status: 'pending', limit: 1000 }).find((x) => x.scope?.budget_approval === a.id)
    if (!rec) rec = approvals.requestApproval(adb, { kind: 'elevation', scope: { project: 'pm-budgets', budget_approval: a.id, budget_id: a.budget_id, amount: a.amount }, requested_by: a.requested_by })
    const ch = approvals.issueChallenge(adb, rec.id, { method: 'otp', approver })
    return { approval_id: rec.id, challenge_id: ch.id, expires_at: ch.expires_at, code: ch.code }
  })
  add('POST', /^\/api\/budget-approvals\/([\w-]+)\/decide$/, (m, b, w, q, p) => {
    const ops = opsFor(p); const approver = b.approver || w.actor
    if (!approver) throw new PmError(400, 'approver required')
    const a = db.prepare('SELECT * FROM budget_approvals WHERE id=?').get(m[1])
    if (!a) throw new PmError(404, 'budget approval not found')
    if (!b.approve) { need(p, undefined, ['admin', 'manager'], 'denying a raise'); return ops.decide(m[1], { approver, approve: false }) }
    const adb = authDb()
    if (!adb || !trusted(p)) throw new PmError(403, 'human proof required to approve: not available to this principal')
    const rec = approvals.listApprovals(adb, { kind: 'elevation', status: 'pending', limit: 1000 }).find((x) => x.scope?.budget_approval === a.id)
    if (!rec) throw new PmError(409, 'request a one-time code first')
    try {
      approvals.decideApproval(adb, rec.id, { approver, method: 'otp', proof: { challenge_id: b.challenge_id, code: b.code }, decision: 'approved', authorize: approvalAuthorizer(adb) })
    } catch (e) { throw asPmError(e) }
    try { return ops.decide(m[1], { approver, approve: true }) } catch (e) {
      try { approvals.revokeApproval(adb, rec.id, { actor: approver, reason: `budget decision refused: ${e.message}` }) } catch {}
      throw e
    }
  })

  return R
}
