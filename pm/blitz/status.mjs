// BLITZ-08 campaign monitoring and final report (Claude Opus 5.5).
//
// buildStatus(controller, id) aggregates one campaign: tasks by lifecycle state; use per agent,
// machine and model; the guard's quota snapshot; cost; dependency-wave progress; escalations and
// failures; throughput; and an ETA per task and overall.
//   - Throughput is measured from events only: verified tasks per hour between the first lease
//     and the last verification (or now while the campaign is live). No verified task -> null.
//   - Durations are measured per task from its first `leased` event to its `verification`
//     (verified) event. ETAs use their mean and are marked `measured`; with no completed task
//     they use o.defaultTaskMinutes and are marked `estimated`.
//   - Cost: a result's `cost_usd` is measured; otherwise attempts x o.costPerAttemptUsd[transport]
//     is an estimate; with no rate the cost is null and says so. Nothing is guessed.
// finalReport(status) renders markdown with verified / unverified / rejected / failed / blocked /
// cancelled tasks and their evidence pointers.
import { ACTIVE_TASK, TERMINAL_CAMPAIGN } from './campaigns.mjs'
import { seatsOf } from './guard.mjs'

export const DEFAULT_TASK_MINUTES = 60
const H = 3_600_000

/** {utc, pacific} clock strings for a time. */
export function clockTimes(ms) {
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  const pacific = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(d)
  return { utc: d.toISOString().replace(/\.\d{3}Z$/, 'Z'), pacific: pacific.replace(',', '') }
}

function allEvents(ctl, id) {
  const out = []
  let since = 0
  for (;;) {
    const page = ctl.events(id, { since, limit: 5000 })
    out.push(...page)
    if (page.length < 5000) return out
    since = page[page.length - 1].id
  }
}

function category(row) {
  if (row.state === 'verified') return 'verified'
  if (row.state === 'cancelled') return 'cancelled'
  if (row.state === 'failed') return row.verification?.failed ? 'rejected' : 'failed'
  if (row.state === 'blocked' || row.state === 'escalated') return 'blocked'
  return 'unverified'
}

/**
 * @param ctl  controller (guarded or raw)
 * @param o.guard              guard, for the quota snapshot and the global ceiling
 * @param o.clock              () => Date
 * @param o.costPerAttemptUsd  {transport: usd} for estimates
 * @param o.defaultTaskMinutes duration used when nothing has been measured yet
 */
export function buildStatus(ctl, id, { guard = null, clock = () => new Date(), costPerAttemptUsd = {}, defaultTaskMinutes = DEFAULT_TASK_MINUTES } = {}) {
  const now = clock().getTime()
  const base = ctl.status(id, { tail: 20 })
  const c = base.campaign
  const rows = ctl.store.tasks(id)
  const events = allEvents(ctl, id)

  // --- measured durations per task ---
  const leasedAt = new Map()
  const finishedAt = new Map()
  const attempts = new Map()
  let firstLease = null
  let lastVerified = null
  for (const e of events) {
    if (!e.task_id) continue
    const t = Date.parse(e.at)
    if (e.kind === 'leased') {
      if (!leasedAt.has(e.task_id)) leasedAt.set(e.task_id, t) // first lease: wall clock to verified
      attempts.set(e.task_id, (attempts.get(e.task_id) ?? 0) + 1)
      if (firstLease === null || t < firstLease) firstLease = t
    }
    if (e.kind === 'verification' && e.data?.verified) {
      finishedAt.set(e.task_id, t)
      if (lastVerified === null || t > lastVerified) lastVerified = t
    }
  }
  const durations = [...finishedAt].map(([tid, t]) => t - (leasedAt.get(tid) ?? t)).filter((d) => d >= 0)
  const measured = durations.length > 0
  const meanMs = measured ? durations.reduce((a, b) => a + b, 0) / durations.length : defaultTaskMinutes * 60_000

  // --- throughput (measured only) ---
  const live = !TERMINAL_CAMPAIGN.includes(c.state)
  const verified = rows.filter((r) => r.state === 'verified').length
  const windowEnd = live ? now : (lastVerified ?? now)
  const hours = firstLease !== null ? Math.max((windowEnd - firstLease) / H, 1 / 3600) : null
  const throughput = verified && hours
    ? { verified_per_hour: Math.round((verified / hours) * 100) / 100, verified, window_hours: Math.round(hours * 1000) / 1000, basis: 'measured', from: clockTimes(firstLease), to: clockTimes(windowEnd) }
    : { verified_per_hour: null, verified, basis: 'measured', note: verified ? 'no lease recorded' : 'no verified task yet' }

  // --- agents, machines, models ---
  const agentInfo = new Map()
  const info = (name) => {
    if (!name) return null
    if (!agentInfo.has(name)) {
      let a = null
      try { a = ctl.registry.get(name) } catch { a = null }
      agentInfo.set(name, a ? { name, machine: a.machine, transport: a.transport, model: seatsOf(a).join('+') || a.model_policy?.policy || 'unknown', max_concurrent: a.max_concurrent } : { name, machine: 'unknown', transport: 'unknown', model: 'unknown' })
    }
    return agentInfo.get(name)
  }
  for (const n of c.roster.map((e) => (typeof e === 'string' ? e : e?.agent)).filter(Boolean)) info(n)
  const group = (key) => {
    const g = {}
    for (const r of rows) {
      const a = info(r.agent)
      const k = a ? a[key] : 'unassigned'
      g[k] ??= { tasks: 0, active: 0, by_state: {} }
      g[k].tasks++
      if (ACTIVE_TASK.includes(r.state)) g[k].active++
      g[k].by_state[r.state] = (g[k].by_state[r.state] ?? 0) + 1
    }
    return g
  }

  // --- cost ---
  let measuredUsd = 0
  let measuredN = 0
  let estUsd = 0
  let unrated = 0
  for (const r of rows) {
    const cost = Number(r.result?.cost_usd)
    if (Number.isFinite(cost)) { measuredUsd += cost; measuredN++; continue }
    const n = attempts.get(r.task_id) ?? 0
    if (!n) continue
    const rate = costPerAttemptUsd[info(r.agent)?.transport]
    if (Number.isFinite(rate)) estUsd += n * rate
    else unrated += n
  }
  const cost = {
    measured_usd: measuredN ? Math.round(measuredUsd * 100) / 100 : null, measured_tasks: measuredN,
    estimated_usd: Math.round(estUsd * 100) / 100, unrated_attempts: unrated,
    note: unrated ? `${unrated} attempt(s) have no measured cost and no configured rate; their cost is unknown, not zero` : null,
  }

  // --- waves ---
  const byId = new Map(rows.map((r) => [r.task_id, r]))
  const waves = (c.preflight?.waves ?? []).map((ids, i) => {
    const states = {}
    for (const t of ids) { const s = byId.get(t)?.state ?? 'missing'; states[s] = (states[s] ?? 0) + 1 }
    const done = ids.filter((t) => ['verified', 'cancelled'].includes(byId.get(t)?.state)).length
    return { wave: i, tasks: ids.length, done, percent: ids.length ? Math.round((done / ids.length) * 100) : 100, states }
  })

  // --- ETA ---
  let slots = 0
  try { slots = ctl.registry.selectRoster(c.roster.map((e) => (typeof e === 'string' ? e : e?.agent))).reduce((n, a) => n + a.max_concurrent, 0) } catch { slots = 0 }
  const ceiling = guard?.config?.().global
  if (Number.isInteger(ceiling)) slots = Math.min(slots, ceiling)
  slots = Math.max(slots, 1)
  const basis = measured ? 'measured' : 'estimated'
  const etas = []
  const queued = rows.filter((r) => ['pending', 'blocked', 'escalated', 'awaiting_verification'].includes(r.state))
    .sort((a, b) => (a.wave ?? 1e9) - (b.wave ?? 1e9) || a.task_id.localeCompare(b.task_id))
  for (const r of rows) {
    if (!ACTIVE_TASK.includes(r.state)) continue
    const start = leasedAt.get(r.task_id) ?? now
    etas.push({ task_id: r.task_id, state: r.state, eta: clockTimes(Math.max(start + meanMs, now)), overdue: start + meanMs < now, basis })
  }
  queued.forEach((r, i) => {
    const t = now + (Math.floor(i / slots) + 1) * meanMs
    etas.push({ task_id: r.task_id, state: r.state, eta: clockTimes(t), basis, ...(r.state === 'blocked' || r.state === 'escalated' ? { note: `waits on: ${r.reason ?? r.state}` } : {}) })
  })
  const last = etas.reduce((m, e) => Math.max(m, Date.parse(e.eta.utc)), -Infinity)
  const overall = etas.length
    ? { eta: clockTimes(last), remaining_minutes: Math.round(Math.max(0, last - now) / 60_000), basis, mean_task_minutes: Math.round(meanMs / 6_000) / 10, measured_tasks: durations.length, slots }
    : { eta: null, remaining_minutes: 0, basis, note: live ? 'no open task' : `campaign ${c.state}` }

  const counts = {}
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1

  return {
    campaign: { id: c.id, title: c.title, state: c.state, rev: c.rev, authorized_by: c.authorized_by, authorized_at: c.authorized_at, cancel_requested_at: c.cancel_requested_at, roster: c.roster, projects: c.projects },
    at: clockTimes(now),
    counts, total: rows.length,
    per_agent: group('name'), per_machine: group('machine'), per_model: group('model'),
    agents: [...agentInfo.values()],
    quota: guard ? { ...guard.snapshot(), last_decision: guard.lastDecision(), config: guard.config() } : null,
    cost, waves, throughput, eta: { overall, tasks: etas },
    escalations: base.escalations, failures: base.failures,
    tasks: rows.map((r) => ({
      task_id: r.task_id, project_id: r.project_id, wave: r.wave, state: r.state, category: category(r), agent: r.agent, attempt: r.attempt,
      reason: r.reason, checkpoint: r.checkpoint, result: r.result, verification: r.verification,
      duration_minutes: finishedAt.has(r.task_id) ? Math.round((finishedAt.get(r.task_id) - (leasedAt.get(r.task_id) ?? finishedAt.get(r.task_id))) / 6_000) / 10 : null,
    })),
  }
}

/** One-line summaries of every campaign (newest last). */
export function overview(ctl, o = {}) {
  return ctl.list().map((c) => {
    const s = buildStatus(ctl, c.id, o)
    return { id: c.id, title: c.title, state: c.state, total: s.total, counts: s.counts, throughput: s.throughput.verified_per_hour, eta: s.eta.overall.eta, eta_basis: s.eta.overall.basis }
  })
}

function evidence(t) {
  const out = []
  const ev = t.verification?.evidence
  if (ev) out.push(`verification evidence: ${typeof ev === 'string' ? ev : JSON.stringify(ev)}`.slice(0, 400))
  if (t.verification?.reason) out.push(`verifier: ${t.verification.reason}`.slice(0, 300))
  for (const a of t.result?.artifacts ?? []) out.push(`${a.kind}: ${a.path ?? a.ref ?? JSON.stringify(a)}`)
  if (t.result?.ref) out.push(`run: ${t.result.transport ?? ''} ${t.result.ref}`.trim())
  const run = t.checkpoint?.artifacts?.find?.((a) => a?.kind === 'run')
  if (!t.result && run) out.push(`run: ${run.transport} ${run.ref} (${run.worktree ?? ''})`)
  return out
}

const fmtEta = (e) => (e ? `${e.utc} / ${e.pacific}` : 'none')

/** Markdown final report from buildStatus() output. */
export function finalReport(s, { generatedBy = 'pm blitz status (BLITZ-08)' } = {}) {
  const sec = (title, cat) => {
    const list = s.tasks.filter((t) => t.category === cat)
    const lines = [`## ${title} (${list.length})`, '']
    if (!list.length) return [...lines, '- none', '']
    for (const t of list) {
      lines.push(`- **${t.task_id}** (project ${t.project_id}, wave ${t.wave ?? '-'}, agent ${t.agent ?? '-'}, attempt ${t.attempt}, state ${t.state})${t.reason ? ` - ${t.reason}` : ''}`)
      for (const e of evidence(t)) lines.push(`  - ${e}`)
      if (cat === 'verified' && t.duration_minutes !== null) lines.push(`  - measured duration: ${t.duration_minutes} min`)
    }
    return [...lines, '']
  }
  const tp = s.throughput
  return [
    `# Blitz campaign ${s.campaign.id}${s.campaign.title ? `: ${s.campaign.title}` : ''}`,
    '',
    `- State: ${s.campaign.state}; authorized by ${s.campaign.authorized_by ?? 'nobody'}${s.campaign.authorized_at ? ` at ${s.campaign.authorized_at}` : ''}`,
    `- Report time: ${fmtEta(s.at)}; generated by ${generatedBy}`,
    `- Tasks: ${s.total} (${Object.entries(s.counts).map(([k, v]) => `${k} ${v}`).join(', ')})`,
    `- Throughput (measured): ${tp.verified_per_hour === null ? `n/a (${tp.note})` : `${tp.verified_per_hour} verified tasks/hour over ${tp.window_hours} h`}`,
    `- Overall ETA (${s.eta.overall.basis}): ${fmtEta(s.eta.overall.eta)}`,
    `- Cost: measured ${s.cost.measured_usd === null ? 'none' : `$${s.cost.measured_usd}`}, estimated $${s.cost.estimated_usd}${s.cost.note ? ` (${s.cost.note})` : ''}`,
    `- Escalations: ${s.escalations.length}; failures: ${s.failures.length}`,
    '',
    ...sec('Verified', 'verified'),
    ...sec('Unverified', 'unverified'),
    ...sec('Rejected by verification', 'rejected'),
    ...sec('Failed', 'failed'),
    ...sec('Blocked or escalated', 'blocked'),
    ...sec('Cancelled', 'cancelled'),
    '## Dependency waves',
    '',
    ...(s.waves.length ? s.waves.map((w) => `- wave ${w.wave}: ${w.done}/${w.tasks} done (${w.percent}%)`) : ['- none recorded']),
    '',
    '## Agents',
    '',
    ...Object.entries(s.per_agent).map(([k, v]) => `- ${k}: ${v.tasks} task(s), ${Object.entries(v.by_state).map(([a, b]) => `${a} ${b}`).join(', ')}`),
    '',
  ].join('\n')
}
