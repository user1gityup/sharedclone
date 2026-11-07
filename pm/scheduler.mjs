// Hybrid scheduling (T-7746527b). DSH may SUGGEST priorities and an order of work automatically,
// but only inside what the administrator defined:
//   - project priority weights set by admin (policy.projectPriority, lower = sooner),
//   - permission gates: role/agent/project (policy.canRun(agent, project)),
//   - budgets: per-project and total USD ceilings (policy.budgets) against spend so far.
// Prepare-never-dispatch holds: every suggestion has dispatch:false and roster:null; the user
// still picks the council and swarm seats and starts the run. Pure: no I/O, no clock.

export class ScheduleError extends Error { constructor(code, msg) { super(msg); this.code = code } }

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

/**
 * @param tasks   [{ id, project, priority, status, lifecycle, est_cost_usd, assignee, created_at, blocked_by:[ids] }]
 * @param policy  { projectPriority:{proj:n}, canRun:(agent,project)=>bool, budgets:{ total, perProject:{} },
 *                  spent:{ total, perProject:{} }, maxSuggestions }
 * @param agent   identity the suggestions are for
 */
export function suggestSchedule(tasks, policy = {}, agent) {
  if (!agent) throw new ScheduleError('NO_AGENT', 'agent identity required')
  const canRun = policy.canRun ?? (() => false) // fail closed: no gate, no work
  const pp = policy.projectPriority ?? {}
  const b = policy.budgets ?? {}
  const spent = { total: num(policy.spent?.total), perProject: { ...(policy.spent?.perProject ?? {}) } }
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id))
  const suggestions = []
  const skipped = []
  let totalSpent = spent.total
  const projSpent = { ...spent.perProject }

  const eligible = tasks.filter((t) => t.status === 'todo' && !['ARCHIVED', 'COMPLETE'].includes(t.lifecycle ?? ''))
  eligible.sort((x, y) =>
    num(pp[x.project], 99) - num(pp[y.project], 99)
    || num(x.priority, 2) - num(y.priority, 2)
    || String(x.created_at ?? '').localeCompare(String(y.created_at ?? ''))
    || x.id.localeCompare(y.id))

  for (const t of eligible) {
    const skip = (reason) => skipped.push({ id: t.id, reason })
    if (!canRun(agent, t.project)) { skip('permission: agent may not run this project'); continue }
    if (t.assignee && t.assignee !== agent) { skip(`assigned to ${t.assignee}`); continue }
    const unmet = (t.blocked_by ?? []).filter((d) => !done.has(d))
    if (unmet.length) { skip(`blocked by ${unmet.join(',')}`); continue }
    const cost = num(t.est_cost_usd)
    if (b.total != null && totalSpent + cost > num(b.total)) { skip('budget: total ceiling'); continue }
    const pb = b.perProject?.[t.project]
    if (pb != null && num(projSpent[t.project]) + cost > num(pb)) { skip('budget: project ceiling'); continue }
    if (suggestions.length >= (policy.maxSuggestions ?? 10)) { skip('limit: max suggestions'); continue }
    totalSpent += cost
    projSpent[t.project] = num(projSpent[t.project]) + cost
    suggestions.push({
      id: t.id, project: t.project, order: suggestions.length + 1, est_cost_usd: cost,
      reason: `project priority ${num(pp[t.project], 99)}, task priority ${num(t.priority, 2)}`,
      dispatch: false, roster: null, needsUserRoster: true,
    })
  }
  return { agent, suggestions, skipped, projectedSpend: { total: totalSpent, perProject: projSpent } }
}

/** A suggestion cannot be started by the scheduler: the user supplies the roster and presses start. */
export function startFromSuggestion(suggestion, { roster } = {}) {
  const has = (k) => Array.isArray(roster?.[k]) && roster[k].length > 0
  if (!has('council') && !has('swarm')) throw new ScheduleError('USER_ROSTER', 'the user picks the seats; the scheduler never defaults a roster')
  return { id: suggestion.id, roster, startedBy: 'user' }
}
