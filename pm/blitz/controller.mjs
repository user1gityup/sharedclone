// BLITZ-05 durable headless run controller (Claude Opus 5.5). Contract: CONTROLLER.md.
//
// Campaign: draft -> preflighted -> launched -> running <-> paused -> completed | cancelled | failed
// Task:     pending | blocked | leased | running | awaiting_verification | verified | failed | escalated | cancelled
//
// Nothing here dispatches real work. dispatch/verify/escalate are injected; the defaults
// refuse to dispatch, never verify, and only record escalations. The controller never calls
// pm's HTTP task routes (the BLITZ-03 guard sits on those); it reads tasks from the store and
// calls assertTaskApproved with the approval-ledger db it is given.
import { PmError } from '../store.mjs'
import { createAgentRegistry } from './agents.mjs'
import { assertTaskApproved, approvalStatus } from './gate.mjs'
import { isOpen, noncodingReason, parseMeta, parseProjectList, topProjects } from './rank.mjs'
import { buildDag } from './dag.mjs'
import { createCampaignStore, requireActor, TERMINAL_CAMPAIGN, ACTIVE_TASK } from './campaigns.mjs'

export const DISPATCH_NOT_WIRED = 'dispatch not wired (BLITZ-05 build only)'
export const DEFAULT_LEASE_SECONDS = 900
/** Agents with this role only verify (BLITZ-07); a task without meta.blitz.role is never leased to one. */
export const VERIFIER_ROLE = 'verifier'
const PARKABLE = ['blocked', 'failed', 'awaiting_verification', 'pending']

/** Can `agent` take a task whose meta.blitz.role is `role`? No role = any non-verifier agent. */
export const roleFits = (agent, role) => (role ? agent.role === role : agent.role !== VERIFIER_ROLE)

export const defaultDeps = {
  dispatch: async () => { throw new Error(DISPATCH_NOT_WIRED) },
  verify: async () => ({ verified: false, reason: 'verifier not wired' }),
  escalate: async () => ({ escalated: false, recorded: true }),
}

const OPEN_TASK = ['pending', 'blocked', 'leased', 'running', 'awaiting_verification', 'escalated']
const KEY = /^[\w.:@-]{1,200}$/

/**
 * @param o.store       pm store (openStore); tasks are read from store.db
 * @param o.db          db holding the blitz tables; default store.db
 * @param o.ledgerDb    () => approval-ledger db or null (server: () => bridge?.queue?.db ?? null)
 * @param o.registry    BLITZ-04 agent registry; default createAgentRegistry(db, {store, clock, machines})
 * @param o.dispatch    async (task, ctx) => {ref?, result?}
 * @param o.verify      async (task, result, ctx) => {verified: bool, failed?: bool, reason?, evidence?}
 * @param o.escalate    async (problem, ctx) => {escalated?: bool, ref?}
 * @param o.clock       () => Date
 * @param o.onEvent     (event) => void, called after each event commits; errors are swallowed
 * @param o.leaseSeconds lease length for a dispatched task
 * @param o.maxAttempts a failed task with attempt < maxAttempts is retried by the next tick
 * @param o.canLease    ({agent, task, row, campaign}) => true | {ok, reason?}; checked in tick before each lease (default: allow)
 */
export function createController({
  store, db = store?.db, ledgerDb = () => null, registry, machines, canLease = null,
  dispatch = defaultDeps.dispatch, verify = defaultDeps.verify, escalate = defaultDeps.escalate,
  clock = () => new Date(), onEvent = null, leaseSeconds = DEFAULT_LEASE_SECONDS, maxAttempts = 1,
} = {}) {
  if (!store?.db) throw new Error('createController needs a pm store with a db handle')
  const cs = createCampaignStore(db, { clock, onEvent })
  const agents = registry ?? createAgentRegistry(db, { store, clock, machines })
  const getLedger = typeof ledgerDb === 'function' ? ledgerDb : () => ledgerDb
  const tdb = store.db
  const nowIso = () => clock().toISOString()
  const later = (s) => new Date(clock().getTime() + s * 1000).toISOString()

  // ---------- helpers ----------
  function liveTask(id) {
    const r = tdb.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
    if (!r) throw new PmError(404, `no task ${id}`)
    return { ...r }
  }

  function rosterNames(roster) {
    if (!Array.isArray(roster) || roster.length === 0) throw new PmError(400, 'roster is required: name every agent; there is no default roster')
    return roster.map((e, i) => {
      const name = typeof e === 'string' ? e : e?.agent
      if (typeof name !== 'string' || !name.trim()) throw new PmError(400, `roster slot ${i + 1}${e?.slot ? ` (${e.slot})` : ''} is empty: every slot needs a named agent`)
      return name.trim()
    })
  }
  /** BLITZ-04 selectRoster on the stored roster; throws 400 on empty, unknown or disabled. */
  const resolveRoster = (c) => agents.selectRoster(rosterNames(c.roster))

  function checkKey(key) {
    if (key === undefined || key === null) return null
    if (typeof key !== 'string' || !KEY.test(key)) throw new PmError(400, 'idempotencyKey must be 1-200 chars of letters, digits, _ . : @ -')
    return key
  }

  /** Sync step under an idempotency key: the first call applies and stores its result atomically; a retry returns it. */
  function once(scope, step, key, fn) {
    key = checkKey(key)
    if (!key) return fn()
    const k = `${scope}:${step}:${key}`
    return cs.tx(() => {
      const prev = cs.idem(k)
      if (prev?.status === 'done') return { ...prev.result, replayed: true }
      if (prev) throw new PmError(409, `step ${step} with key ${key} is ${prev.status}`)
      const out = fn()
      cs.claimKey(k, scope, step)
      cs.settleKey(k, 'done', out)
      return out
    })
  }

  function rev(body) {
    if (body?.rev === undefined || body?.rev === null) throw new PmError(400, 'rev is required')
    return body.rev
  }

  function expectState(c, allowed, what) {
    if (!allowed.includes(c.state)) throw new PmError(409, `cannot ${what} campaign ${c.id} in state ${c.state} (needs ${allowed.join(' or ')})`, { current: c })
  }

  /** Internal transition at the current rev (inside a tx, after the caller's rev was checked). */
  function move(w, id, fields, kind, data = {}) {
    const cur = cs.get(id)
    const c = cs.update(w, id, cur.rev, fields)
    if (kind) cs.event(id, kind, { from: cur.state, to: c.state, ...data }, { actor: w.actor })
    return c
  }

  function resolveProjects(body) {
    const listed = parseProjectList(body.projects)
    if (listed) {
      return listed.map((ref) => {
        const p = tdb.prepare('SELECT id, status FROM projects WHERE id = ? OR name = ?').get(ref, ref)
        if (!p) throw new PmError(400, `unknown project ${ref}`)
        if (p.status === 'archived') throw new PmError(400, `project ${ref} is archived`)
        return p.id
      })
    }
    if (body.top_n !== undefined) return topProjects(tdb, { n: body.top_n }).projects.map((p) => p.id)
    throw new PmError(400, 'projects (ids or names) or top_n is required: there is no default project set')
  }

  /** The campaign's task set: the explicit `tasks` list, or every open coding task in its projects. */
  function selectTasks(c) {
    const projects = new Set(c.projects)
    const explicit = Array.isArray(c.schedule?.tasks) ? c.schedule.tasks : null
    let rows
    if (explicit) {
      rows = explicit.map((id) => {
        const t = liveTask(id)
        if (!projects.has(t.project_id)) throw new PmError(400, `task ${id} is not in the campaign's projects`)
        return t
      })
    } else {
      rows = []
      for (const pid of c.projects) {
        for (const r of tdb.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority, created_at, id').all(pid)) {
          const t = { ...r }
          if (isOpen(t) && !noncodingReason(t)) rows.push(t)
        }
      }
    }
    return rows
  }

  /** Dependency readiness of one snapshot row: {ok} | {wait} | {fail}. */
  function depState(id, row, byId) {
    const waits = []
    for (const d of row.depends_on) {
      const dep = byId.get(d)
      if (dep) {
        if (dep.state === 'verified') continue
        if (['failed', 'escalated', 'cancelled'].includes(dep.state)) return { fail: `dependency ${d} is ${dep.state}` }
        waits.push(d)
      } else {
        const ext = tdb.prepare('SELECT status FROM tasks WHERE id = ?').get(d)
        if (!ext) return { fail: `dependency ${d} does not exist` }
        if (ext.status !== 'done') waits.push(`${d} (outside campaign, ${ext.status})`)
      }
    }
    return waits.length ? { wait: `waiting on ${waits.join(', ')}` } : { ok: true }
  }

  /** (task, reason, attempt) raised before? The attempt is part of the key, so a retry's identical failure is raised again. */
  function alreadyRaised(id, taskId, reason, attempt = null) {
    return cs.events(id, { task: taskId, kind: 'escalation', limit: 5000 })
      .some((e) => e.data?.problem?.reason === reason && (e.data?.problem?.attempt ?? null) === (attempt ?? null))
  }

  /** Parks an idle task as escalated (inside a tx). Returns the row, or null when the task is not parkable. */
  function parkRow(w, id, taskId, reason, { rev: want, ref = null } = {}) {
    const row = cs.task(id, taskId)
    if (want !== undefined && want !== null && Number(want) !== row.rev) throw new PmError(409, `stale task rev ${want}; current is ${row.rev}`, { current: row })
    if (!PARKABLE.includes(row.state)) return null
    const t = cs.setTask(id, taskId, row.rev, { state: 'escalated', reason: `escalated: ${reason}` })
    cs.event(id, 'task_escalated', { ref, from: row.state, reason }, { taskId, actor: w.actor })
    return t
  }

  /** Records an escalation event and hands it to deps.escalate. A truthy `escalated` parks the task. */
  async function raise(w, id, problem) {
    if (problem.task_id && alreadyRaised(id, problem.task_id, problem.reason, problem.attempt)) return null
    cs.event(id, 'escalation', { problem }, { taskId: problem.task_id ?? null, actor: w.actor })
    let r
    try { r = await escalate(problem, { campaign: cs.get(id), actor: w.actor, now: clock() }) } catch (err) {
      cs.event(id, 'escalation_error', { problem, error: String(err?.message ?? err) }, { taskId: problem.task_id ?? null, actor: w.actor })
      return null
    }
    if (r?.escalated && problem.task_id) cs.tx(() => parkRow(w, id, problem.task_id, problem.reason, { ref: r.ref ?? null }))
    return r ?? null
  }

  /** Runs deps.verify on an awaiting_verification row and writes the verdict (same attempt fence). */
  async function verifyRow(w, id, taskId, attempt, { reverify = false } = {}) {
    const row = cs.task(id, taskId)
    let verdict
    try {
      verdict = await verify(liveTask(taskId), row.result, {
        campaign: cs.get(id), attempt, actor: w.actor, now: clock(), agent: row.agent ?? null,
        escalate: (problem) => raise(w, id, { campaign_id: id, task_id: taskId, attempt, ...problem }),
      })
    } catch (err) {
      verdict = { verified: false, reason: `verifier error: ${String(err?.message ?? err)}` }
    }
    const v = { verified: verdict?.verified === true, failed: verdict?.failed === true, reason: verdict?.reason ?? null, evidence: verdict?.evidence ?? null, at: nowIso() }
    const state = v.verified ? 'verified' : v.failed ? 'failed' : 'awaiting_verification'
    const wrote = cs.tx(() => {
      const cur = cs.task(id, taskId)
      if (cur.state !== 'awaiting_verification' || cur.attempt !== attempt) return false
      cs.setTask(id, taskId, cur.rev, { state, verification: v, reason: v.verified ? null : v.failed ? `verification failed: ${v.reason ?? ''}` : `unverified: ${v.reason ?? ''}` })
      cs.event(id, 'verification', reverify ? { ...v, reverify: true } : v, { taskId, actor: w.actor })
      return true
    })
    if (wrote && v.failed) await raise(w, id, { kind: 'verification_failed', campaign_id: id, task_id: taskId, attempt, reason: `verification failed: ${v.reason ?? ''}` })
    return { v, wrote }
  }

  function checkpointOf(stage, attempt, artifacts = []) {
    if (typeof stage !== 'string' || !stage.trim()) throw new PmError(400, 'checkpoint stage is required')
    if (!Array.isArray(artifacts)) throw new PmError(400, 'checkpoint artifacts must be a list')
    return { stage: stage.trim(), attempt, artifacts, at: nowIso() }
  }

  function writeCheckpoint(w, id, row, cp) {
    const t = cs.setTask(id, row.task_id, row.rev, { checkpoint: cp })
    cs.event(id, 'checkpoint', cp, { taskId: row.task_id, actor: w.actor })
    return t
  }

  /** Lease fence for worker calls: same owner, same attempt, lease still held. */
  function fenced(id, taskId, { owner, attempt } = {}) {
    const row = cs.task(id, taskId)
    if (!ACTIVE_TASK.includes(row.state)) throw new PmError(409, `task ${taskId} is ${row.state}, not leased`, { current: row })
    if (owner !== row.lease_owner) throw new PmError(409, `task ${taskId} is leased to ${row.lease_owner}, not ${owner}`, { current: row })
    if (attempt !== undefined && Number(attempt) !== row.attempt) throw new PmError(409, `stale attempt ${attempt}; current is ${row.attempt}`, { current: row })
    if (row.lease_until <= nowIso()) throw new PmError(409, `lease on ${taskId} expired at ${row.lease_until}; recover reclaims it`, { current: row })
    return row
  }

  /** Completion check; call inside a tx. */
  function settle(w, id) {
    const c = cs.get(id)
    if (!['launched', 'running', 'paused'].includes(c.state)) return c
    const rows = cs.tasks(id)
    const active = rows.filter((r) => ACTIVE_TASK.includes(r.state))
    if (c.cancel_requested_at) {
      if (active.length) return c
      for (const r of rows) if (OPEN_TASK.includes(r.state)) cs.setTask(id, r.task_id, r.rev, { state: 'cancelled', reason: 'campaign cancelled' })
      return move(w, id, { state: 'cancelled' }, 'cancelled', { reason: c.cancel_reason })
    }
    if (c.state === 'paused') return c
    const open = rows.filter((r) => OPEN_TASK.includes(r.state) || (r.state === 'failed' && r.attempt < maxAttempts))
    if (open.length) return c
    const failed = rows.filter((r) => r.state === 'failed').map((r) => r.task_id)
    return move(w, id, { state: failed.length ? 'failed' : 'completed' }, failed.length ? 'failed' : 'completed', { failed })
  }

  // ---------- public API ----------
  const api = {
    store: cs,
    registry: agents,

    get: (id) => cs.get(id),
    list: (q = {}) => cs.list(q),
    events: (id, q = {}) => { cs.get(id); return cs.events(id, q) },

    create(w, body = {}) {
      w = requireActor(w)
      return once('create', 'create', body.idempotencyKey, () => cs.tx(() => {
        const projects = resolveProjects(body)
        if (body.roster !== undefined && !Array.isArray(body.roster)) throw new PmError(400, 'roster must be a list of agent names')
        if (body.tasks !== undefined && (!Array.isArray(body.tasks) || body.tasks.some((t) => typeof t !== 'string'))) throw new PmError(400, 'tasks must be a list of task ids')
        const schedule = { ...(body.schedule ?? {}), ...(body.tasks ? { tasks: body.tasks } : {}) }
        const c = cs.insert(w, { id: body.id, title: body.title, projects, roster: body.roster ?? [], schedule })
        cs.event(c.id, 'created', { projects, roster: c.roster, top_n: body.top_n ?? null }, { actor: w.actor })
        return c
      }))
    },

    /** Edit roster/projects/schedule/title while draft or preflighted; a preflighted campaign returns to draft. */
    update(w, id, body = {}) {
      w = requireActor(w)
      return once(id, 'update', body.idempotencyKey, () => cs.tx(() => {
        const c = cs.get(id)
        expectState(c, ['draft', 'preflighted'], 'edit')
        const f = {}
        if (body.roster !== undefined) { if (!Array.isArray(body.roster)) throw new PmError(400, 'roster must be a list'); f.roster = body.roster }
        if (body.projects !== undefined || body.top_n !== undefined) f.projects = resolveProjects(body)
        if (body.schedule !== undefined) f.schedule = body.schedule ?? {}
        if (body.title !== undefined) f.title = String(body.title)
        if (!Object.keys(f).length) throw new PmError(400, 'nothing to change')
        if (c.state === 'preflighted') f.state = 'draft'
        const out = cs.update(w, id, rev(body), f)
        cs.event(id, 'updated', { fields: Object.keys(f) }, { actor: w.actor })
        return out
      }))
    },

    /** Snapshot tasks + DAG, check roster and approvals. Hard errors refuse; the rest is reported in preflight.problems. */
    preflight(w, id, body = {}) {
      w = requireActor(w)
      return once(id, 'preflight', body.idempotencyKey, () => cs.tx(() => {
        const c = cs.get(id)
        expectState(c, ['draft', 'preflighted'], 'preflight')
        if (Number(rev(body)) !== c.rev) throw new PmError(409, `stale rev ${body.rev}; current is ${c.rev}`, { current: c })
        const tasks = selectTasks(c)
        if (!tasks.length) throw new PmError(409, `campaign ${id} has no open coding tasks in ${c.projects.join(', ')}`)
        const dag = buildDag(tasks)
        const problems = []
        let roster = null
        try { roster = resolveRoster(c).map((a) => ({ name: a.name, role: a.role, machine: a.machine, transport: a.transport, max_concurrent: a.max_concurrent })) } catch (err) {
          if (!(err instanceof PmError)) throw err
          problems.push({ kind: 'roster', reason: err.message })
        }
        for (const cyc of dag.cycles) problems.push({ kind: 'cycle', tasks: cyc, reason: `dependency cycle ${cyc.join(' -> ')}` })
        const ledger = getLedger()
        const approvals = {}
        for (const t of tasks) {
          const s = approvalStatus(ledger, t, { now: clock() })
          approvals[t.id] = { ok: s.task_scope.ok, reasons: s.task_scope.reasons }
          if (!s.task_scope.ok) problems.push({ kind: 'approval', task: t.id, reason: s.task_scope.reasons.join('; ') })
        }
        db.prepare('DELETE FROM blitz_campaign_tasks WHERE campaign_id = ?').run(id)
        const blocked = new Set(dag.blocked)
        const cycleOf = new Map(dag.cycles.flatMap((cy) => cy.map((t) => [t, cy])))
        for (const n of dag.nodes) {
          const t = tasks.find((x) => x.id === n.id)
          const deps = [...n.depends_on, ...n.external]
          cs.putTask(id, {
            task_id: n.id, project_id: t.project_id, wave: dag.waveOf[n.id] ?? null, depends_on: deps,
            state: blocked.has(n.id) ? 'blocked' : 'pending',
            reason: blocked.has(n.id) ? (cycleOf.has(n.id) ? `cycle: ${cycleOf.get(n.id).join(' -> ')}` : 'cycle: depends on a task in a dependency cycle') : null,
          })
        }
        const report = { at: nowIso(), tasks: tasks.length, waves: dag.waves, cycles: dag.cycles, roster, approvals, problems, ok: problems.length === 0 }
        const out = move(w, id, { state: 'preflighted', preflight: report }, 'preflighted', { ok: report.ok, problems: problems.length })
        return out
      }))
    },

    /** Needs explicit user authorization (authorizedBy) and a fully named, enabled roster. */
    launch(w, id, body = {}) {
      w = requireActor(w)
      return once(id, 'launch', body.idempotencyKey, () => cs.tx(() => {
        const c = cs.get(id)
        const by = typeof body.authorizedBy === 'string' ? body.authorizedBy.trim() : ''
        if (!by) throw new PmError(400, 'launch needs explicit user authorization: authorizedBy (who authorized this run) is required')
        expectState(c, ['preflighted'], 'launch')
        if (Number(rev(body)) !== c.rev) throw new PmError(409, `stale rev ${body.rev}; current is ${c.rev}`, { current: c })
        const roster = resolveRoster(c)
        return move(w, id, { state: 'launched', authorized_by: by, authorized_at: nowIso() }, 'launched', { authorized_by: by, roster: roster.map((a) => a.name) })
      }))
    },

    pause(w, id, body = {}) {
      w = requireActor(w)
      return once(id, 'pause', body.idempotencyKey, () => cs.tx(() => {
        const c = cs.get(id)
        expectState(c, ['launched', 'running'], 'pause')
        if (c.cancel_requested_at) throw new PmError(409, `campaign ${id} is cancelling`)
        if (Number(rev(body)) !== c.rev) throw new PmError(409, `stale rev ${body.rev}; current is ${c.rev}`, { current: c })
        return move(w, id, { state: 'paused' }, 'paused', { reason: body.reason ?? '' })
      }))
    },

    resume(w, id, body = {}) {
      w = requireActor(w)
      return once(id, 'resume', body.idempotencyKey, () => cs.tx(() => {
        const c = cs.get(id)
        expectState(c, ['paused'], 'resume')
        if (Number(rev(body)) !== c.rev) throw new PmError(409, `stale rev ${body.rev}; current is ${c.rev}`, { current: c })
        return move(w, id, { state: 'running' }, 'resumed')
      }))
    },

    /** Phase 1 of cancel. Idle tasks cancel at once; leased/running ones get cancel_requested
     *  and stay until the worker acks (ackCancel) or recover reclaims an expired lease. */
    cancel(w, id, body = {}) {
      w = requireActor(w)
      return once(id, 'cancel', body.idempotencyKey, () => cs.tx(() => {
        const c = cs.get(id)
        if (TERMINAL_CAMPAIGN.includes(c.state)) throw new PmError(409, `campaign ${id} is already ${c.state}`, { current: c })
        if (c.cancel_requested_at) throw new PmError(409, `cancel already requested for ${id}`, { current: c })
        if (Number(rev(body)) !== c.rev) throw new PmError(409, `stale rev ${body.rev}; current is ${c.rev}`, { current: c })
        const reason = String(body.reason ?? '')
        if (['draft', 'preflighted'].includes(c.state)) {
          for (const r of cs.tasks(id)) cs.setTask(id, r.task_id, r.rev, { state: 'cancelled', reason: 'campaign cancelled' })
          return move(w, id, { state: 'cancelled', cancel_requested_at: nowIso(), cancel_requested_by: w.actor, cancel_reason: reason }, 'cancelled', { reason })
        }
        move(w, id, { cancel_requested_at: nowIso(), cancel_requested_by: w.actor, cancel_reason: reason }, 'cancel_requested', { reason })
        for (const r of cs.tasks(id)) {
          if (ACTIVE_TASK.includes(r.state)) {
            cs.setTask(id, r.task_id, r.rev, { cancel_requested: 1 })
            cs.event(id, 'task_cancel_requested', { owner: r.lease_owner, attempt: r.attempt }, { taskId: r.task_id, actor: w.actor })
          } else if (OPEN_TASK.includes(r.state)) {
            cs.setTask(id, r.task_id, r.rev, { state: 'cancelled', reason: 'campaign cancelled' })
          }
        }
        return settle(w, id)
      }))
    },

    /** Phase 2: the worker holding the lease confirms it stopped. */
    ackCancel(w, id, body = {}) {
      w = requireActor(w)
      return once(id, `ack-cancel:${body.taskId}`, body.idempotencyKey, () => cs.tx(() => {
        const row = cs.task(id, body.taskId)
        if (!row.cancel_requested || !ACTIVE_TASK.includes(row.state)) throw new PmError(409, `no cancel pending on ${body.taskId}`, { current: row })
        if (body.owner !== row.lease_owner) throw new PmError(409, `task ${body.taskId} is leased to ${row.lease_owner}, not ${body.owner}`)
        cs.setTask(id, row.task_id, row.rev, { state: 'cancelled', reason: 'cancel acknowledged by worker', lease_owner: null, lease_until: null })
        cs.event(id, 'cancel_acked', { owner: row.lease_owner, attempt: row.attempt, observed: body.observed ?? '' }, { taskId: row.task_id, actor: w.actor })
        return settle(w, id)
      }))
    },

    /** Reclaims expired leases (task -> pending, or cancelled when a cancel was pending) and settles. */
    recover(w, id) {
      w = requireActor(w)
      return cs.tx(() => {
        const c = cs.get(id)
        const reclaimed = []
        const at = nowIso()
        for (const r of cs.tasks(id)) {
          if (!ACTIVE_TASK.includes(r.state) || !r.lease_until || r.lease_until > at) continue
          const to = r.cancel_requested || TERMINAL_CAMPAIGN.includes(c.state) ? 'cancelled' : 'pending'
          cs.setTask(id, r.task_id, r.rev, { state: to, lease_owner: null, lease_until: null, reason: `lease expired at ${r.lease_until} (${r.lease_owner}, attempt ${r.attempt})` })
          cs.event(id, 'lease_expired', { owner: r.lease_owner, attempt: r.attempt, lease_until: r.lease_until, to, checkpoint: r.checkpoint }, { taskId: r.task_id, actor: w.actor })
          reclaimed.push(r.task_id)
        }
        if (reclaimed.length) cs.event(id, 'recovered', { reclaimed }, { actor: w.actor })
        return { campaign: settle(w, id), reclaimed }
      })
    },

    /** recover() over every campaign that is not terminal (pm start-up). */
    recoverAll(w) {
      return cs.list().filter((c) => !TERMINAL_CAMPAIGN.includes(c.state) && !['draft', 'preflighted'].includes(c.state))
        .map((c) => ({ id: c.id, ...api.recover(w, c.id) }))
    },

    /**
     * One deterministic scheduling round: launched -> running; refresh dependency blocks;
     * pick dependency-ready tasks in wave/priority/id order up to roster capacity; check each
     * one's approval (assertTaskApproved); lease it; dispatch it. Then settle.
     */
    async tick(w, id, body = {}) {
      w = requireActor(w)
      const problems = []
      const picked = []
      const plan = cs.tx(() => {
        let c = cs.get(id)
        if (body.rev !== undefined && Number(body.rev) !== c.rev) throw new PmError(409, `stale rev ${body.rev}; current is ${c.rev}`, { current: c })
        if (!['launched', 'running'].includes(c.state)) return { skipped: `campaign is ${c.state}` }
        if (c.cancel_requested_at) return { skipped: 'cancel requested' }
        if (c.state === 'launched') c = move(w, id, { state: 'running' }, 'running')

        let rows = cs.tasks(id)
        // retry failed tasks that still have attempts left
        for (const r of rows) {
          if (r.state === 'failed' && r.attempt < maxAttempts) {
            cs.setTask(id, r.task_id, r.rev, { state: 'pending', reason: `retry after: ${r.reason ?? 'failure'}` })
            cs.event(id, 'retry', { attempt: r.attempt, max_attempts: maxAttempts }, { taskId: r.task_id, actor: w.actor })
          }
        }
        rows = cs.tasks(id)
        const byId = new Map(rows.map((r) => [r.task_id, r]))
        const ready = []
        for (const r of rows) {
          if (!(r.state === 'pending' || (r.state === 'blocked' && !String(r.reason).startsWith('cycle:')))) continue
          const d = depState(id, r, byId)
          if (d.fail || d.wait) {
            const reason = d.fail ? `deps: ${d.fail}` : `deps: ${d.wait}`
            if (r.state !== 'blocked' || r.reason !== reason) {
              cs.setTask(id, r.task_id, r.rev, { state: 'blocked', reason })
              cs.event(id, 'task_blocked', { reason }, { taskId: r.task_id, actor: w.actor })
            }
            if (d.fail) problems.push({ kind: 'dependency_failed', campaign_id: id, task_id: r.task_id, reason })
            continue
          }
          ready.push(r)
        }
        for (const r of rows) {
          if (r.state === 'blocked' && String(r.reason).startsWith('cycle:')) problems.push({ kind: 'cycle', campaign_id: id, task_id: r.task_id, reason: r.reason })
        }

        let roster
        try { roster = resolveRoster(c) } catch (err) {
          if (!(err instanceof PmError)) throw err
          cs.event(id, 'roster_invalid', { reason: err.message }, { actor: w.actor })
          return { skipped: `roster invalid: ${err.message}` }
        }
        const busy = new Map(roster.map((a) => [a.name, 0]))
        for (const r of cs.tasks(id)) if (ACTIVE_TASK.includes(r.state) && busy.has(r.lease_owner)) busy.set(r.lease_owner, busy.get(r.lease_owner) + 1)
        const free = () => roster.some((a) => busy.get(a.name) < a.max_concurrent)

        const live = new Map()
        for (const r of ready) { try { live.set(r.task_id, liveTask(r.task_id)) } catch { live.set(r.task_id, null) } }
        ready.sort((a, b) => (a.wave ?? 1e9) - (b.wave ?? 1e9) || (live.get(a.task_id)?.priority ?? 9) - (live.get(b.task_id)?.priority ?? 9) || String(live.get(a.task_id)?.created_at ?? '').localeCompare(String(live.get(b.task_id)?.created_at ?? '')) || a.task_id.localeCompare(b.task_id))

        const ledger = getLedger()
        for (const r0 of ready) {
          if (!free()) break
          const t = live.get(r0.task_id)
          let r = cs.task(id, r0.task_id)
          if (!t || !isOpen(t)) {
            cs.setTask(id, r.task_id, r.rev, { state: 'cancelled', reason: t ? 'task closed in pm outside the campaign' : 'task no longer exists in pm' })
            cs.event(id, 'task_dropped', { reason: t ? 'closed in pm' : 'missing' }, { taskId: r.task_id, actor: w.actor })
            continue
          }
          // role fit (no role = any non-verifier); the task's avoid_agents are skipped while another fitting agent exists
          const role = parseMeta(t).blitz?.role
          const fits = roster.filter((a) => roleFits(a, role))
          const preferred = fits.filter((a) => !r.avoid_agents.includes(a.name))
          let agent = null
          for (const a of (preferred.length ? preferred : fits)) {
            if (busy.get(a.name) >= a.max_concurrent) continue
            if (canLease) {
              const ok = canLease({ agent: a, task: t, row: r, campaign: c })
              if (ok !== true && !ok?.ok) continue
            }
            agent = a
            break
          }
          if (!agent) continue
          try {
            assertTaskApproved(ledger, t, 'task_scope', { now: clock() })
          } catch (err) {
            if (!(err instanceof PmError) || err.status !== 409) throw err
            const reason = `approval: ${(err.extra?.reasons ?? [err.message]).join('; ')}`
            if (r.state !== 'blocked' || r.reason !== reason) {
              r = cs.setTask(id, r.task_id, r.rev, { state: 'blocked', reason })
              cs.event(id, 'approval_blocked', { reasons: err.extra?.reasons ?? [], message: err.message }, { taskId: r.task_id, actor: w.actor })
            }
            problems.push({ kind: 'approval', campaign_id: id, task_id: r.task_id, reason })
            continue
          }
          const attempt = r.attempt + 1
          const cp = { stage: 'leased', attempt, artifacts: [], at: nowIso() }
          const resumeFrom = r.checkpoint
          r = cs.setTask(id, r.task_id, r.rev, { state: 'leased', reason: null, agent: agent.name, lease_owner: agent.name, lease_until: later(leaseSeconds), attempt, cancel_requested: 0, checkpoint: cp })
          cs.event(id, 'leased', { agent: agent.name, attempt, lease_until: r.lease_until, task_rev: t.rev }, { taskId: r.task_id, actor: w.actor })
          cs.event(id, 'checkpoint', cp, { taskId: r.task_id, actor: w.actor })
          busy.set(agent.name, busy.get(agent.name) + 1)
          picked.push({ row: r, task: t, agent, resumeFrom })
        }
        return {}
      })

      for (const p of problems) await raise(w, id, p)
      if (plan.skipped) return { campaign: cs.get(id), skipped: plan.skipped, leased: [], dispatched: [], failed: [] }

      const dispatched = []
      const failed = []
      for (const { row, task, agent, resumeFrom } of picked) {
        const key = `${id}:${row.task_id}:dispatch:${row.attempt}`
        if (!cs.claimKey(key, id, 'dispatch')) continue // already dispatched under this key
        const ctx = {
          campaign: { id, title: cs.get(id).title }, agent, attempt: row.attempt, lease_until: row.lease_until,
          idempotencyKey: key, resumeFrom, actor: w.actor, now: clock(), previous: { verification: row.verification ?? null },
          once: (step, fn) => api.once(id, `${row.task_id}:${step}`, fn),
          // true when attempt n's outcome was already reported: its run must not be adopted again
          reported: (n) => ['result', 'failure'].some((k) => cs.idem(`${id}:${row.task_id}:${k}:${n}`)?.status === 'done'),
          checkpoint: (cp) => api.checkpoint(w, id, { taskId: row.task_id, owner: agent.name, attempt: row.attempt, ...cp }),
          heartbeat: (b = {}) => api.heartbeat(w, id, { taskId: row.task_id, owner: agent.name, attempt: row.attempt, ...b }),
          cancelRequested: () => cs.task(id, row.task_id).cancel_requested,
        }
        let out
        try {
          out = await dispatch(task, ctx)
        } catch (err) {
          const msg = String(err?.message ?? err)
          cs.settleKey(key, 'failed', { error: msg })
          const moved = cs.tx(() => {
            const cur = cs.task(id, row.task_id)
            if (!ACTIVE_TASK.includes(cur.state) || cur.attempt !== row.attempt) return false
            cs.setTask(id, row.task_id, cur.rev, { state: 'failed', reason: `dispatch: ${msg}`, lease_owner: null, lease_until: null })
            cs.event(id, 'dispatch_failed', { agent: agent.name, attempt: row.attempt, error: msg }, { taskId: row.task_id, actor: w.actor })
            return true
          })
          if (moved) {
            failed.push(row.task_id)
            await raise(w, id, { kind: 'dispatch_failed', campaign_id: id, task_id: row.task_id, attempt: row.attempt, reason: `dispatch: ${msg}` })
          }
          continue
        }
        cs.settleKey(key, 'done', { ref: out?.ref ?? null })
        cs.tx(() => {
          const cur = cs.task(id, row.task_id)
          if (cur.state !== 'leased' || cur.attempt !== row.attempt) return
          cs.setTask(id, row.task_id, cur.rev, { state: 'running' })
          cs.event(id, 'dispatched', { agent: agent.name, attempt: row.attempt, ref: out?.ref ?? null }, { taskId: row.task_id, actor: w.actor })
        })
        dispatched.push(row.task_id)
        if (out && out.result !== undefined) {
          await api.reportResult(w, id, { taskId: row.task_id, owner: agent.name, attempt: row.attempt, result: out.result })
        }
      }
      const campaign = cs.tx(() => settle(w, id))
      return { campaign, leased: picked.map((p) => p.row.task_id), dispatched, failed }
    },

    /** Idempotent side effect for adapters: fn runs at most once per (campaign, key); a retry gets the stored result. */
    async once(id, key, fn) {
      checkKey(key)
      const k = `${id}:fx:${key}`
      if (!cs.claimKey(k, id, 'effect')) {
        const prev = cs.idem(k)
        if (prev.status === 'done') return { ...(prev.result ?? {}), replayed: true }
        throw new PmError(409, `side effect ${key} is ${prev.status}; reconcile before retrying`)
      }
      try {
        const out = await fn()
        cs.settleKey(k, 'done', out ?? null)
        return out
      } catch (err) {
        cs.settleKey(k, 'failed', { error: String(err?.message ?? err) })
        throw err
      }
    },

    heartbeat(w, id, body = {}) {
      w = requireActor(w)
      return cs.tx(() => {
        let row = fenced(id, body.taskId, body)
        const secs = Number.isInteger(body.leaseSeconds) && body.leaseSeconds > 0 ? body.leaseSeconds : leaseSeconds
        row = cs.setTask(id, row.task_id, row.rev, { lease_until: later(secs) })
        if (body.stage) row = writeCheckpoint(w, id, row, checkpointOf(body.stage, row.attempt, body.artifacts ?? []))
        return { lease_until: row.lease_until, cancel_requested: row.cancel_requested }
      })
    },

    /** Structured checkpoint {stage, attempt, artifacts[], at}, kept on the task row and as an event. */
    checkpoint(w, id, body = {}) {
      w = requireActor(w)
      return once(id, `checkpoint:${body.taskId}`, body.idempotencyKey, () => cs.tx(() => {
        const row = fenced(id, body.taskId, body)
        return writeCheckpoint(w, id, row, checkpointOf(body.stage, row.attempt, body.artifacts ?? [])).checkpoint
      }))
    },

    /** Worker reports a finished attempt. The task waits for verify(); only {verified:true} makes it verified. */
    async reportResult(w, id, body = {}) {
      w = requireActor(w)
      const row0 = cs.task(id, body.taskId)
      const attempt = body.attempt ?? row0.attempt
      const key = `${id}:${body.taskId}:result:${attempt}`
      const prev = cs.idem(key)
      if (prev?.status === 'done') return { ...(prev.result ?? {}), replayed: true }
      const row = cs.tx(() => {
        const r = fenced(id, body.taskId, { ...body, attempt })
        if (!cs.claimKey(key, id, 'result')) throw new PmError(409, `result for ${body.taskId} attempt ${attempt} is already being recorded`)
        const result = body.result ?? null
        const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : []
        if (r.cancel_requested) {
          cs.setTask(id, r.task_id, r.rev, { state: 'cancelled', reason: 'cancel acknowledged with result', result, lease_owner: null, lease_until: null })
          cs.event(id, 'cancel_acked', { owner: r.lease_owner, attempt, with_result: true }, { taskId: r.task_id, actor: w.actor })
          return null
        }
        const cp = { stage: 'awaiting_verification', attempt, artifacts, at: nowIso() }
        const t = cs.setTask(id, r.task_id, r.rev, { state: 'awaiting_verification', reason: null, result, checkpoint: cp, lease_owner: null, lease_until: null })
        cs.event(id, 'result', { owner: r.lease_owner, attempt, result }, { taskId: r.task_id, actor: w.actor })
        cs.event(id, 'checkpoint', cp, { taskId: r.task_id, actor: w.actor })
        return t
      })
      let out
      if (!row) {
        out = { task: cs.task(id, body.taskId), campaign: cs.tx(() => settle(w, id)) }
      } else {
        await verifyRow(w, id, row.task_id, attempt)
        out = { task: cs.task(id, row.task_id), campaign: cs.tx(() => settle(w, id)) }
      }
      cs.settleKey(key, 'done', { task_id: out.task.task_id, state: out.task.state })
      return out
    },

    /** Worker reports a failed attempt. */
    async reportFailure(w, id, body = {}) {
      w = requireActor(w)
      const row0 = cs.task(id, body.taskId)
      const attempt = body.attempt ?? row0.attempt
      const key = `${id}:${body.taskId}:failure:${attempt}`
      const prev = cs.idem(key)
      if (prev?.status === 'done') return { ...(prev.result ?? {}), replayed: true }
      const reason = `failed: ${String(body.error ?? 'unspecified')}`
      cs.tx(() => {
        const r = fenced(id, body.taskId, { ...body, attempt })
        if (!cs.claimKey(key, id, 'failure')) throw new PmError(409, 'failure already being recorded')
        cs.setTask(id, r.task_id, r.rev, { state: r.cancel_requested ? 'cancelled' : 'failed', reason, lease_owner: null, lease_until: null })
        cs.event(id, 'task_failed', { owner: r.lease_owner, attempt, error: body.error ?? null }, { taskId: r.task_id, actor: w.actor })
      })
      if (cs.task(id, body.taskId).state === 'failed') await raise(w, id, { kind: 'task_failed', campaign_id: id, task_id: body.taskId, attempt, reason })
      const out = { task: cs.task(id, body.taskId), campaign: cs.tx(() => settle(w, id)) }
      cs.settleKey(key, 'done', { task_id: body.taskId, state: out.task.state })
      return out
    },

    /** Returns a parked task to pending (BLITZ-06 retry / reassignment, or after a human answer). */
    requeue(w, id, body = {}) {
      w = requireActor(w)
      return once(id, `requeue:${body.taskId}`, body.idempotencyKey, () => cs.tx(() => {
        const c = cs.get(id)
        if (TERMINAL_CAMPAIGN.includes(c.state) || c.cancel_requested_at) throw new PmError(409, `campaign ${id} is ${c.cancel_requested_at ? 'cancelling' : c.state}`)
        const r = cs.task(id, body.taskId)
        if (body.rev !== undefined && Number(body.rev) !== r.rev) throw new PmError(409, `stale task rev ${body.rev}; current is ${r.rev}`, { current: r })
        if (!['failed', 'escalated', 'blocked', 'awaiting_verification'].includes(r.state)) throw new PmError(409, `task ${r.task_id} is ${r.state}; only failed, escalated, blocked or awaiting_verification can be requeued`)
        if (r.state === 'blocked' && String(r.reason).startsWith('cycle:') && !body.force) throw new PmError(409, `task ${r.task_id} is in a dependency cycle; fix depends_on and preflight again`)
        if (body.avoidAgents !== undefined && (!Array.isArray(body.avoidAgents) || body.avoidAgents.some((a) => typeof a !== 'string'))) throw new PmError(400, 'avoidAgents must be a list of agent names')
        const avoid = [...new Set([...r.avoid_agents, ...(body.avoidAgents ?? [])])]
        const t = cs.setTask(id, r.task_id, r.rev, { state: 'pending', reason: `requeued: ${body.reason ?? ''}`, ...(body.avoidAgents?.length ? { avoid_agents: avoid } : {}) })
        cs.event(id, 'requeued', { from: r.state, reason: body.reason ?? '', ...(body.avoidAgents?.length ? { avoid_agents: avoid } : {}) }, { taskId: r.task_id, actor: w.actor })
        return t
      }))
    },

    /** Parks an idle task (pending, blocked, failed, awaiting_verification) as escalated. Optional task rev check. */
    park(w, id, body = {}) {
      w = requireActor(w)
      if (typeof body.taskId !== 'string' || !body.taskId) throw new PmError(400, 'taskId is required')
      return cs.tx(() => parkRow(w, id, body.taskId, String(body.reason ?? 'parked'), { rev: body.rev, ref: body.ref ?? null }))
    },

    /** Re-runs verify on an awaiting_verification task (e.g. once a verifier is available), then settles. */
    async reverify(w, id, taskId) {
      w = requireActor(w)
      const row = cs.task(id, taskId)
      if (row.state !== 'awaiting_verification') throw new PmError(409, `task ${taskId} is ${row.state}, not awaiting_verification`, { current: row })
      const { v, wrote } = await verifyRow(w, id, taskId, row.attempt, { reverify: true })
      if (!wrote) throw new PmError(409, `task ${taskId} changed during verification`)
      return { task: cs.task(id, taskId), verdict: v, campaign: cs.tx(() => settle(w, id)) }
    },

    dag(id) {
      const c = cs.get(id)
      if (['draft'].includes(c.state) || !c.preflight) {
        const d = buildDag(selectTasks(c))
        return { campaign: id, source: 'live', waves: d.waves, cycles: d.cycles, blocked: d.blocked, nodes: d.nodes }
      }
      const rows = cs.tasks(id)
      return {
        campaign: id, source: 'snapshot', waves: c.preflight.waves ?? [], cycles: c.preflight.cycles ?? [],
        blocked: rows.filter((r) => r.wave === null).map((r) => r.task_id),
        nodes: rows.map((r) => ({ id: r.task_id, depends_on: r.depends_on, state: r.state, wave: r.wave })),
      }
    },

    status(id, { tail = 50 } = {}) {
      const c = cs.get(id)
      const rows = cs.tasks(id)
      const byState = {}
      for (const r of rows) (byState[r.state] ??= []).push({ task_id: r.task_id, project_id: r.project_id, wave: r.wave, agent: r.agent, lease_until: r.lease_until, attempt: r.attempt, reason: r.reason, checkpoint: r.checkpoint })
      const counts = Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, v.length]))
      let roster
      try {
        roster = resolveRoster(c).map((a) => ({ name: a.name, role: a.role, machine: a.machine, transport: a.transport, max_concurrent: a.max_concurrent, active: rows.filter((r) => ACTIVE_TASK.includes(r.state) && r.lease_owner === a.name).length }))
      } catch (err) { roster = { error: err.message, names: c.roster } }
      return {
        campaign: c, counts, tasks: byState, roster,
        dag: { waves: c.preflight?.waves ?? [], cycles: c.preflight?.cycles ?? [] },
        failures: rows.filter((r) => r.state === 'failed').map((r) => ({ task_id: r.task_id, attempt: r.attempt, reason: r.reason })),
        escalations: cs.events(id, { kind: 'escalation', limit: 5000 }).map((e) => ({ id: e.id, task_id: e.task_id, at: e.at, problem: e.data.problem })),
        events: cs.tail(id, Math.min(Number(tail) || 50, 500)),
      }
    },
  }
  return api
}
