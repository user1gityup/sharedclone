// PM Swarm Tool, FREE AGENTS ONLY mode (T-0bf60afc). Pure logic with injected seat registry,
// quota reader, permission gate and invoker: no DSH code, DSH commands or DSH access rules are
// touched; the default PM swarm mode is untouched (resolveMode returns 'default' unless asked).
//  - A seat is eligible only when its cost class is local|free AND free entitlement is verified
//    AND (for non-local seats) quota is known, fresh and has headroom. Unknown cost = ineligible.
//  - Eligibility is rechecked at initial routing, every retry, every reassignment and again
//    immediately before invocation, so a seat that turned paid or ran dry is never called.
//  - No eligible seat: the run goes `blocked` with a cause; there is never a paid fallback.
//  - Scheduler: dependency-aware, per-seat reservation (no quota overcommit), max parallelism.
//  - Every PM operation passes ctx.can(actor, action, project): launch, pause, reassign, edit,
//    approve, complete. Selecting a free seat grants no PM right.
//  - A task is `verified` only with build/test/review evidence; an agent returning is not done.
export const FREE_CLASSES = new Set(['local', 'free'])
export const OPS = ['launch', 'pause', 'reassign', 'edit', 'approve', 'complete']
export const QUOTA_STALE_MS = 30 * 60_000
export class SwarmError extends Error { constructor(code, msg) { super(msg); this.code = code } }

export const resolveMode = (cfg) => (cfg?.mode === 'free-only' ? 'free-only' : 'default')

/** @returns {{eligible:boolean, reason:string}} */
export function seatEligibility(seat, { now = Date.now(), staleMs = QUOTA_STALE_MS, reserve = 0 } = {}) {
  if (!seat || !seat.id) return { eligible: false, reason: 'unknown seat' }
  if (!FREE_CLASSES.has(seat.cost_class)) return { eligible: false, reason: `cost class ${seat.cost_class ?? 'unknown'} is not free` }
  if (seat.verified_free !== true) return { eligible: false, reason: 'free entitlement not verified' }
  if (seat.cost_class === 'local') return { eligible: true, reason: 'local, zero marginal cost' }
  const q = seat.quota
  if (!q || typeof q.remaining !== 'number') return { eligible: false, reason: 'quota unknown' }
  if (!q.as_of || now - Date.parse(q.as_of) > staleMs) return { eligible: false, reason: 'quota stale' }
  if (q.remaining - reserve <= 0) return { eligible: false, reason: 'quota exhausted' }
  return { eligible: true, reason: `free, ${q.remaining - reserve} quota units remaining` }
}

export function createFreeSwarm({ seats, can, invoke, clock = () => Date.now(), maxParallel = 4 }) {
  const runs = new Map()
  const reserved = new Map() // seat id -> reserved units across running attempts

  const gate = (run, actor, op) => {
    if (!OPS.includes(op)) throw new SwarmError('BAD_REQUEST', `unknown op ${op}`)
    const ok = can?.(actor, op, run.project)
    if (!ok) { run.audit.push({ at: clock(), actor, op, outcome: 'denied' }); throw new SwarmError('FORBIDDEN', `${actor} may not ${op} in ${run.project}`) }
    run.audit.push({ at: clock(), actor, op, outcome: 'allowed' })
  }
  const seatById = (id) => seats().find((s) => s.id === id) ?? null
  const eligible = (id, units = 0) => seatEligibility(seatById(id), { now: clock(), reserve: (reserved.get(id) ?? 0) + units })

  function create({ id, project, actor, pool, tasks }) {
    if (!id || !project || !actor) throw new SwarmError('BAD_REQUEST', 'id, project, actor required')
    const run = { id, project, mode: 'free-only', actor, pool: [], rejected: [], tasks: {}, audit: [], state: 'ready', blocked_cause: null, paused: false }
    gate(run, actor, 'launch')
    for (const sid of pool ?? []) {
      const e = eligible(sid)
      if (e.eligible) run.pool.push(sid); else run.rejected.push({ seat: sid, reason: e.reason })
    }
    if (!run.pool.length) { run.state = 'blocked'; run.blocked_cause = 'no eligible free seat in the chosen pool' }
    for (const t of tasks ?? []) run.tasks[t.id] = { id: t.id, deps: t.deps ?? [], units: t.units ?? 1, status: 'queued', attempts: [], seat: null, evidence: null, approved: !!t.approved }
    runs.set(id, run)
    return run
  }

  /** Optional expansion, only inside the already-chosen eligible pool (candidates outside are refused). */
  function expand(runId, actor, seatId, allowedPool) {
    const run = get(runId); gate(run, actor, 'edit')
    if (!allowedPool?.includes(seatId)) { run.rejected.push({ seat: seatId, reason: 'outside the chosen free pool' }); return false }
    const e = eligible(seatId)
    if (!e.eligible) { run.rejected.push({ seat: seatId, reason: e.reason }); return false }
    if (!run.pool.includes(seatId)) run.pool.push(seatId)
    return true
  }

  const get = (id) => { const r = runs.get(id); if (!r) throw new SwarmError('NOT_FOUND', `run ${id}`); return r }
  const running = (run) => Object.values(run.tasks).filter((t) => t.status === 'running').length

  /** One scheduling pass. Assigns approved, dependency-ready tasks to eligible seats within quota. */
  async function tick(runId) {
    const run = get(runId)
    if (run.paused || run.state === 'done') return run
    run.pool = run.pool.filter((sid) => {
      const e = eligible(sid)
      if (!e.eligible) run.rejected.push({ seat: sid, reason: `dropped on recheck: ${e.reason}` })
      return e.eligible
    })
    const ready = Object.values(run.tasks).filter((t) => t.status === 'queued' && t.approved && t.deps.every((d) => run.tasks[d]?.status === 'verified'))
    if (ready.length && !run.pool.length) { run.state = 'blocked'; run.blocked_cause = 'free pool exhausted or unavailable; not falling back to paid'; return run }
    let blockedNow = false
    for (const t of ready) {
      if (running(run) >= maxParallel) break
      const sid = run.pool.find((s) => eligible(s, t.units).eligible && !t.attempts.some((a) => a.seat === s && a.outcome === 'failed'))
        ?? run.pool.find((s) => eligible(s, t.units).eligible)
      if (!sid) { run.state = 'blocked'; run.blocked_cause = `no free seat has quota for ${t.id}`; blockedNow = true; continue }
      await dispatch(run, t, sid)
    }
    if (!blockedNow && run.state === 'blocked' && run.pool.length) { run.state = 'ready'; run.blocked_cause = null }
    return run
  }

  async function dispatch(run, t, sid) {
    // final guard right before invocation: never call a seat that is not free right now
    const e = eligible(sid, t.units)
    if (!e.eligible) { run.audit.push({ at: clock(), op: 'dispatch', outcome: 'refused', seat: sid, reason: e.reason }); return }
    reserved.set(sid, (reserved.get(sid) ?? 0) + t.units)
    t.status = 'running'; t.seat = sid
    const attempt = { seat: sid, started: clock(), outcome: null, reason: e.reason }
    t.attempts.push(attempt)
    try {
      const out = await invoke({ seat: seatById(sid), task: t, run })
      attempt.outcome = 'returned'; t.status = 'returned'; t.result = out
    } catch (err) {
      attempt.outcome = 'failed'; attempt.error = String(err?.message ?? err); t.status = 'queued' // retry rechecks eligibility
    } finally {
      reserved.set(sid, Math.max(0, (reserved.get(sid) ?? 0) - t.units))
    }
  }

  function pause(runId, actor) { const r = get(runId); gate(r, actor, 'pause'); r.paused = true; return r }
  function resume(runId, actor) { const r = get(runId); gate(r, actor, 'launch'); r.paused = false; return r }
  function approve(runId, actor, taskId) { const r = get(runId); gate(r, actor, 'approve'); r.tasks[taskId].approved = true; return r.tasks[taskId] }
  function reassign(runId, actor, taskId, seatId) {
    const r = get(runId); gate(r, actor, 'reassign')
    const e = eligible(seatId)
    if (!e.eligible || !r.pool.includes(seatId)) throw new SwarmError('INELIGIBLE', e.eligible ? 'seat is outside the chosen pool' : e.reason)
    const t = r.tasks[taskId]; t.status = 'queued'; t.attempts.push({ seat: seatId, outcome: 'reassigned', started: clock() }); return t
  }

  /** verified only with build + test + review evidence; otherwise stays returned/open. */
  function complete(runId, actor, taskId, evidence) {
    const r = get(runId); gate(r, actor, 'complete')
    const t = r.tasks[taskId]
    if (t.status !== 'returned') throw new SwarmError('NOT_RETURNED', `${taskId} has not returned work`)
    const ev = evidence ?? {}
    const missing = []
    if (ev.build?.exit_code !== 0) missing.push('build exit 0')
    if (ev.tests?.exit_code !== 0 || !(ev.tests?.passed > 0)) missing.push('tests passing')
    if (ev.review?.verdict !== 'pass' || !ev.review?.by) missing.push('review pass')
    if (missing.length) throw new SwarmError('EVIDENCE', `missing evidence: ${missing.join(', ')}`)
    t.status = 'verified'; t.evidence = ev
    if (Object.values(r.tasks).every((x) => x.status === 'verified')) r.state = 'done'
    return t
  }

  /** Visibility: seats, cost/eligibility reason, remaining quota, machine, status, blockers, verified finish. */
  function view(runId) {
    const r = get(runId)
    return {
      id: r.id, mode: r.mode, state: r.state, blocked_cause: r.blocked_cause, paused: r.paused, rejected: r.rejected,
      seats: r.pool.map((sid) => { const s = seatById(sid); const e = eligible(sid); return { id: sid, machine: s?.machine ?? null, cost_class: s?.cost_class ?? null, eligible: e.eligible, reason: e.reason, quota_remaining: s?.quota?.remaining ?? null, reserved: reserved.get(sid) ?? 0 } }),
      tasks: Object.values(r.tasks).map((t) => ({ id: t.id, status: t.status, seat: t.seat, attempts: t.attempts.length, verified: t.status === 'verified' })),
    }
  }

  return { create, expand, tick, pause, resume, approve, reassign, complete, view, get }
}
