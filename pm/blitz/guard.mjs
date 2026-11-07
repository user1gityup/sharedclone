// BLITZ-08 quota and concurrency guard (Claude Opus 5.5).
//
// The controller picks agents with registry.selectRoster() and fills each agent up to its
// max_concurrent. The guard narrows that, inside tick only, so a task is never leased when:
//   - its agent's provider is at or above the quota stop threshold (default 95% session or
//     weekly for Claude, per the user's quota rule), or its reading is unknown/stale and the
//     provider's unknown policy is 'refuse' (the default for providers that have a reading);
//   - the global ceiling on concurrent leased/running tasks (all campaigns) is reached;
//   - the per-provider or per-agent ceiling is reached.
// A refused task is never leased, so it stays `pending`; the guard writes the reason on the
// row and a `dispatch_deferred` event (once per distinct reason).
//
// The quota reading is cached: refresh() (async) reads a capacity snapshot (BLITZ-04
// buildSnapshot without the llama probe, or an injected reader); the synchronous tick path
// only reads the cache. guardController() returns a controller whose tick goes through here,
// so REST /tick and the runner are both guarded.
import { buildSnapshot } from './capacity.mjs'
import { ACTIVE_TASK } from './campaigns.mjs'
import { VERIFIER_ROLE } from './controller.mjs'

export const DEFAULT_STOP_PERCENT = 95
export const DEFAULT_GLOBAL_CEILING = 4

/** Which quota bucket an agent spends. Override with o.providerOf. */
export function defaultProviderOf(agent) {
  if (agent.transport === 'bridge-claude') return 'claude'
  if (agent.transport === 'codex') return 'codex'
  const seats = seatsOf(agent)
  if (seats.length && seats.every((s) => /^agy-/.test(s))) return 'antigravity'
  if (seats.some((s) => /^(claude|claude-work)$/.test(s))) return 'claude'
  if (seats.some((s) => /^openai$/.test(s))) return 'codex'
  return 'dsh'
}

/** Seats named by the agent's model policy: pin first, then allow. Never a default. */
export function seatsOf(agent) {
  const p = agent?.model_policy ?? {}
  return [...new Set([p.pin, ...(Array.isArray(p.allow) ? p.allow : [])].filter((x) => typeof x === 'string' && x.trim()))]
}

/**
 * Used-percent reading for one provider from a capacity snapshot.
 * @returns {known, usedPercent, detail}
 */
export function providerReading(snapshot, provider) {
  const q = snapshot?.quota ?? {}
  if (provider === 'claude') {
    const c = q.claude
    if (!c) return { known: false, detail: 'no claude reading' }
    if (c.exhausted) return { known: true, usedPercent: 100, detail: 'claude quota-guard exhausted marker present' }
    if (c.stale || c.error) return { known: false, detail: c.error ?? 'claude usage cache stale' }
    const used = [c.sessionPercent, c.weekPercent].filter(Number.isFinite)
    if (!used.length) return { known: false, detail: 'claude usage cache has no percentages' }
    return { known: true, usedPercent: Math.max(...used), detail: `session ${c.sessionPercent ?? '?'}%, week ${c.weekPercent ?? '?'}%` }
  }
  if (provider === 'codex' || provider === 'antigravity') {
    const r = q[provider]
    if (!r || r.error) return { known: false, detail: r?.error ?? `no ${provider} reading` }
    if (r.stale || !Number.isFinite(r.headroomPercent)) return { known: false, detail: `${provider} reading stale or without headroom` }
    return { known: true, usedPercent: 100 - r.headroomPercent, detail: `${provider} headroom ${r.headroomPercent}%` }
  }
  return { known: false, notApplicable: true, detail: `${provider} has no quota reading` }
}

/**
 * @param o.db           blitz db (store.db): counts leased/running tasks across campaigns
 * @param o.readSnapshot async () => capacity snapshot (default buildSnapshot({llama:false}))
 * @param o.stopPercent  {provider: n} or number; default 95 for every provider with a reading
 * @param o.unknown      {provider: 'refuse'|'allow'}; default 'refuse' for claude/codex/antigravity
 * @param o.ceilings     {global, perProvider: {p: n}, perAgent: {name: n}}
 * @param o.providerOf   (agent) => provider name
 */
export function createGuard({
  db, readSnapshot = () => buildSnapshot({ llama: false }), stopPercent = DEFAULT_STOP_PERCENT,
  unknown = {}, ceilings = {}, providerOf = defaultProviderOf, clock = () => new Date(),
} = {}) {
  if (!db) throw new Error('createGuard needs the blitz db')
  let snapshot = null
  let snapshotAt = null
  let snapshotError = null
  let active = null // {campaignId} while a guarded tick computes its plan
  let lastDecision = null
  const rotation = new Map()
  const global = Number.isInteger(ceilings.global) && ceilings.global > 0 ? ceilings.global : DEFAULT_GLOBAL_CEILING
  const perProvider = ceilings.perProvider ?? {}
  const perAgent = ceilings.perAgent ?? {}
  const stopFor = (p) => (typeof stopPercent === 'number' ? stopPercent : stopPercent[p] ?? DEFAULT_STOP_PERCENT)
  const unknownFor = (p) => unknown[p] ?? 'refuse'

  async function refresh() {
    try {
      snapshot = await readSnapshot()
      snapshotError = null
    } catch (err) {
      snapshot = null
      snapshotError = String(err?.message ?? err)
    }
    snapshotAt = clock().toISOString()
    return snapshot
  }

  /** Quota verdict for one provider: {ok, reason?, reading}. */
  function quota(provider) {
    const reading = providerReading(snapshot, provider)
    if (reading.notApplicable) return { ok: true, reading }
    if (!reading.known) {
      if (unknownFor(provider) === 'allow') return { ok: true, reading }
      return { ok: false, reason: `quota: ${provider} reading unknown (${reading.detail}${snapshotError ? `; ${snapshotError}` : ''}); refusing until measured`, reading }
    }
    if (reading.usedPercent >= stopFor(provider)) return { ok: false, reason: `quota: ${provider} at ${reading.usedPercent}% used (stop at ${stopFor(provider)}%; ${reading.detail})`, reading }
    return { ok: true, reading }
  }

  function busy(campaignId) {
    const rows = db.prepare(`SELECT campaign_id, lease_owner FROM blitz_campaign_tasks WHERE state IN (${ACTIVE_TASK.map(() => '?').join(',')})`).all(...ACTIVE_TASK)
    const all = new Map()
    const mine = new Map()
    for (const r of rows) {
      all.set(r.lease_owner, (all.get(r.lease_owner) ?? 0) + 1)
      if (r.campaign_id === campaignId) mine.set(r.lease_owner, (mine.get(r.lease_owner) ?? 0) + 1)
    }
    return { total: rows.length, all, mine }
  }

  /** Narrows each agent's max_concurrent so no new lease breaks quota or a ceiling. */
  function apply(campaignId, roster, lookup = () => null) {
    const b = busy(campaignId)
    let remaining = Math.max(0, global - b.total)
    const provBusy = new Map()
    for (const a of roster) provBusy.set(providerOf(a), 0)
    // provider use across every leasing agent, not only this roster (lookup resolves the others)
    const byName = new Map(roster.map((a) => [a.name, a]))
    for (const [name, n] of b.all) {
      let a = byName.get(name)
      if (!a) { try { a = lookup(name) } catch { a = null } }
      if (a) provBusy.set(providerOf(a), (provBusy.get(providerOf(a)) ?? 0) + n)
    }
    const provLeft = new Map([...provBusy].map(([p, n]) => [p, Number.isInteger(perProvider[p]) ? Math.max(0, perProvider[p] - n) : Infinity]))
    const demand = demandByRole(campaignId)
    const refusals = []
    // room = what the agent itself could still take, bounded by the work its role can pick up
    const st = roster.map((a) => {
      const p = providerOf(a)
      const q = quota(p)
      const agentCap = Math.min(a.max_concurrent, Number.isInteger(perAgent[a.name]) ? perAgent[a.name] : Infinity)
      // a task without a role never goes to a verifier (controller roleFits), so it is no demand for one
      const want = (a.role === VERIFIER_ROLE ? 0 : demand.any) + (demand.byRole.get(a.role) ?? 0)
      return { a, p, q, room: q.ok ? Math.min(Math.max(0, agentCap - (b.all.get(a.name) ?? 0)), want) : 0, free: 0, want }
    })
    // round robin, one slot at a time, starting at a rotating offset: a role-specific agent
    // is never starved by an agent earlier in the roster, and the global/provider caps hold exactly
    const start = (rotation.get(campaignId) ?? 0) % Math.max(1, st.length)
    rotation.set(campaignId, start + 1)
    for (let progress = true; progress && remaining > 0;) {
      progress = false
      for (let k = 0; k < st.length && remaining > 0; k++) {
        const s = st[(start + k) % st.length]
        if (s.free >= s.room || provLeft.get(s.p) <= 0) continue
        s.free++; remaining--; provLeft.set(s.p, provLeft.get(s.p) - 1); progress = true
      }
    }
    const out = st.map((s) => {
      const mine = b.mine.get(s.a.name) ?? 0
      if (!s.q.ok) { if (s.want > 0) refusals.push({ agent: s.a.name, role: s.a.role, provider: s.p, reason: s.q.reason }); return { ...s.a, max_concurrent: mine, guard: s.q.reason } }
      if (s.free < s.room) {
        const why = []
        if (provLeft.get(s.p) <= 0 && Number.isInteger(perProvider[s.p])) why.push(`provider ${s.p} ceiling ${perProvider[s.p]} reached`)
        if (remaining <= 0) why.push(`global ceiling ${global} reached`)
        if (why.length) refusals.push({ agent: s.a.name, role: s.a.role, provider: s.p, reason: `concurrency: ${why.join('; ')}` })
      }
      return { ...s.a, max_concurrent: mine + s.free }
    })
    lastDecision = { at: clock().toISOString(), campaign: campaignId, total_active: b.total, global, refusals, caps: out.map((a) => ({ agent: a.name, max_concurrent: a.max_concurrent })) }
    return out
  }

  /** Tasks this campaign could lease now or soon, by meta.blitz.role ('any' = no role). */
  function demandByRole(campaignId) {
    const rows = db.prepare("SELECT task_id, state, reason FROM blitz_campaign_tasks WHERE campaign_id = ? AND state IN ('pending', 'blocked')").all(campaignId)
    const byRole = new Map()
    let any = 0
    for (const r of rows) {
      if (r.state === 'blocked' && String(r.reason ?? '').startsWith('cycle:')) continue
      const role = taskRole(r.task_id)
      if (role) byRole.set(role, (byRole.get(role) ?? 0) + 1)
      else any++
    }
    return { any, byRole }
  }

  /** A registry whose selectRoster is narrowed while a guarded tick plans. */
  function wrapRegistry(base) {
    return { ...base, selectRoster: (names) => { const r = base.selectRoster(names); return active ? apply(active.campaignId, r, (n) => base.get(n)) : r } }
  }

  /** Records the deferral reason on tasks still pending after a guarded tick. */
  function markDeferred(ctl, w, id) {
    const refusals = lastDecision?.campaign === id ? lastDecision.refusals : []
    if (!refusals.length) return []
    const cs = ctl.store
    const marked = []
    cs.tx(() => {
      for (const r of cs.tasks(id, { state: 'pending' })) {
        // only the refusals of agents that could have taken this task (same role; no role = non-verifier)
        const role = taskRole(r.task_id)
        const mine = refusals.filter((x) => (role ? x.role === role : x.role !== VERIFIER_ROLE))
        if (!mine.length) continue
        const reason = `deferred: ${mine.map((x) => `${x.agent}: ${x.reason}`).join(' | ')}`.slice(0, 1000)
        if (r.reason === reason) continue
        cs.setTask(id, r.task_id, r.rev, { reason })
        cs.event(id, 'dispatch_deferred', { refusals: mine }, { taskId: r.task_id, actor: w.actor })
        marked.push(r.task_id)
      }
    })
    return marked
  }

  function taskRole(taskId) {
    const t = db.prepare('SELECT meta FROM tasks WHERE id = ?').get(taskId)
    try { return JSON.parse(t?.meta || '{}')?.blitz?.role ?? null } catch { return null }
  }


  /** Guarded tick: the plan (synchronous inside controller.tick) sees the narrowed roster. */
  async function tick(ctl, w, id, body = {}) {
    active = { campaignId: id }
    lastDecision = null
    let p
    try { p = ctl.tick(w, id, body) } finally { active = null }
    const out = await p
    const deferred = markDeferred(ctl, w, id)
    return { ...out, deferred, guard: lastDecision }
  }

  return {
    refresh, quota, apply, wrapRegistry, tick, markDeferred,
    snapshot: () => ({ snapshot, at: snapshotAt, error: snapshotError }),
    lastDecision: () => lastDecision,
    config: () => ({ global, perProvider, perAgent, stopPercent, unknown }),
  }
}

/** A controller whose tick (REST and runner alike) goes through the guard. */
export function guardController(ctl, guard) {
  return { ...ctl, tick: (w, id, body) => guard.tick(ctl, w, id, body) }
}
