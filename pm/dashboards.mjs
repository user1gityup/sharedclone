// Role-based dashboard data (T-edb5f3e4): the DATA layer for admin/manager/worker/client views.
// UI design direction is the user's (T-c19fd883), so this returns plain objects a UI can render.
// Pure: callers pass a snapshot. Visibility is decided here, server-side, and fails closed:
//   admin   - everything, all projects
//   manager - only projects they were assigned: milestones, deliverables, costs, agents, forecast
//   worker  - only tasks they hold or are assigned: milestones + deliverables of their own work, no costs
//   client  - only their projects: milestones + deliverables, no costs, no agent performance, no forecast
// Unknown or missing role -> no sections (never a default view).
//
// snapshot = { projects:[{id,name}], tasks:[{id,project,title,status,assignee,claimed_by,milestone,
//              created_at,done_at}], artifacts:[{task_id,kind,ref}], usage:[{task_id,agent,cost_usd,tokens}],
//              runs:[{task_id,agent,state}] }

export const ROLE_SECTIONS = {
  admin: ['milestones', 'deliverables', 'costs', 'agentPerformance', 'forecast'],
  manager: ['milestones', 'deliverables', 'costs', 'agentPerformance', 'forecast'],
  worker: ['milestones', 'deliverables'],
  client: ['milestones', 'deliverables'],
}
const DELIVERABLE_KINDS = new Set(['commit', 'file', 'url', 'evidence'])
const FINISHED = new Set(['review', 'done'])

/** Which projects and tasks an identity may see. */
export function scopeFor(snapshot, who) {
  const role = who?.role
  if (!ROLE_SECTIONS[role]) return { projects: [], tasks: [] }
  const all = snapshot.projects ?? []
  let projects
  if (role === 'admin') projects = all
  else {
    const allowed = new Set(who.projects ?? [])
    projects = all.filter((p) => allowed.has(p.id) || allowed.has(p.name))
  }
  const names = new Set(projects.flatMap((p) => [p.id, p.name]))
  let tasks = (snapshot.tasks ?? []).filter((t) => names.has(t.project))
  if (role === 'worker') tasks = tasks.filter((t) => t.assignee === who.identity || t.claimed_by === who.identity)
  return { projects, tasks }
}

function milestones(tasks) {
  const by = new Map()
  for (const t of tasks) {
    const m = t.milestone || '(none)'
    const e = by.get(m) ?? { milestone: m, total: 0, done: 0 }
    e.total++
    if (t.status === 'done') e.done++
    by.set(m, e)
  }
  return [...by.values()].map((e) => ({ ...e, pct: e.total ? Math.round((e.done / e.total) * 100) : 0 })).sort((a, b) => a.milestone.localeCompare(b.milestone))
}

function deliverables(tasks, artifacts) {
  const ok = new Map(tasks.filter((t) => FINISHED.has(t.status)).map((t) => [t.id, t]))
  return (artifacts ?? []).filter((a) => ok.has(a.task_id) && DELIVERABLE_KINDS.has(a.kind))
    .map((a) => ({ task_id: a.task_id, title: ok.get(a.task_id).title, kind: a.kind, ref: a.ref }))
}

function costs(tasks, usage) {
  const ids = new Set(tasks.map((t) => t.id))
  const byTask = {}
  let total = 0
  for (const u of usage ?? []) {
    if (!ids.has(u.task_id)) continue
    const c = Number(u.cost_usd) || 0
    byTask[u.task_id] = (byTask[u.task_id] ?? 0) + c
    total += c
  }
  return { total_usd: Math.round(total * 1e6) / 1e6, byTask }
}

function agentPerformance(tasks, runs, usage) {
  const ids = new Set(tasks.map((t) => t.id))
  const agents = new Map()
  const row = (a) => { if (!agents.has(a)) agents.set(a, { agent: a, runs: 0, done: 0, failed: 0, cost_usd: 0 }); return agents.get(a) }
  for (const r of runs ?? []) {
    if (!ids.has(r.task_id) || !r.agent) continue
    const e = row(r.agent)
    e.runs++
    if (r.state === 'done') e.done++
    if (r.state === 'failed') e.failed++
  }
  for (const u of usage ?? []) if (ids.has(u.task_id) && u.agent) row(u.agent).cost_usd += Number(u.cost_usd) || 0
  return [...agents.values()].map((e) => ({ ...e, success_rate: e.runs ? Math.round((e.done / e.runs) * 100) / 100 : null })).sort((a, b) => a.agent.localeCompare(b.agent))
}

/** Velocity forecast: finished-per-day over the trailing window; null when there is no signal. */
export function forecast(tasks, { now = new Date(), windowDays = 14 } = {}) {
  const open = tasks.filter((t) => !['done'].includes(t.status)).length
  const since = now.getTime() - windowDays * 86_400_000
  const finished = tasks.filter((t) => t.status === 'done' && t.done_at && new Date(t.done_at).getTime() >= since).length
  const perDay = finished / windowDays
  if (!perDay) return { open, finished_in_window: finished, per_day: 0, eta: null, basis: 'no completions in window' }
  const days = Math.ceil(open / perDay)
  return { open, finished_in_window: finished, per_day: Math.round(perDay * 1000) / 1000, eta: new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10), basis: `${windowDays}-day velocity` }
}

/** The dashboard for one identity: only the sections its role allows. */
export function buildDashboard(snapshot, who, opts = {}) {
  const sections = ROLE_SECTIONS[who?.role] ?? []
  const { projects, tasks } = scopeFor(snapshot, who)
  const out = { role: who?.role ?? null, projects: projects.map((p) => p.name), sections }
  if (sections.includes('milestones')) out.milestones = milestones(tasks)
  if (sections.includes('deliverables')) out.deliverables = deliverables(tasks, snapshot.artifacts)
  if (sections.includes('costs')) out.costs = costs(tasks, snapshot.usage)
  if (sections.includes('agentPerformance')) out.agentPerformance = agentPerformance(tasks, snapshot.runs, snapshot.usage)
  if (sections.includes('forecast')) out.forecast = forecast(tasks, opts)
  return out
}

/** Export exactly what the role may see. JSON, or CSV of one section. */
export function exportDashboard(snapshot, who, { format = 'json', section, ...opts } = {}) {
  const d = buildDashboard(snapshot, who, opts)
  if (format === 'json') return JSON.stringify(d, null, 2)
  if (format !== 'csv') throw new Error('format must be json or csv')
  if (!d.sections.includes(section)) throw new Error(`section ${section ?? '(none)'} is not available to role ${d.role}`)
  const data = d[section]
  const rows = Array.isArray(data) ? data : section === 'costs' ? Object.entries(data.byTask).map(([task_id, cost_usd]) => ({ task_id, cost_usd })) : [data]
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n'
}
