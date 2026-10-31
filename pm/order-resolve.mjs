// Pure order resolver for pm project/task ordering (spec: pm-ordering-backend-spec.md, A1).
// No store imports, no clock, no I/O. Inputs are plain row objects.
//
// Top scope = projects (callers pass the active ones) + tasks with order_override = 1.
// A non-overridden task sits under its project and moves with it; an overridden task is its own
// top-scope entry ranked by top_order and does not move when its project is reordered.

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))

// NULLs last; numbers ascending.
function cmpRank(a, b) {
  const na = isNum(a), nb = isNum(b)
  if (na && nb) return Number(a) - Number(b)
  if (na) return -1
  if (nb) return 1
  return 0
}

const cmpStr = (a, b) => {
  const x = String(a ?? ''), y = String(b ?? '')
  return x < y ? -1 : x > y ? 1 : 0
}

const isOverridden = (t) => Number(t?.order_override) === 1

// Within a project: sort_order (NULLs last), then priority, then created_at, then id.
function cmpTask(a, b) {
  return cmpRank(a.sort_order, b.sort_order)
    || cmpRank(a.priority ?? 2, b.priority ?? 2)
    || cmpStr(a.created_at, b.created_at)
    || cmpStr(a.id, b.id)
}

// Top-scope entries: { kind: 'project'|'task', id, rank, tie, row }.
function topEntry(kind, row) {
  return kind === 'project'
    ? { kind, id: row.id, rank: row.sort_order, tie: row.name ?? '', row }
    : { kind, id: row.id, rank: row.top_order, tie: row.created_at ?? '', row }
}

function cmpTop(a, b) {
  return cmpRank(a.rank, b.rank)
    || cmpStr(a.tie, b.tie)
    || (a.kind === b.kind ? 0 : a.kind === 'project' ? -1 : 1)
    || cmpStr(a.id, b.id)
}

/** Ordered top scope: [{kind:'project'|'task', id, row}]. */
export function resolveTop(projects = [], overriddenTasks = []) {
  const entries = [
    ...projects.map((p) => topEntry('project', p)),
    ...overriddenTasks.filter(isOverridden).map((t) => topEntry('task', t)),
  ]
  return entries.sort(cmpTop).map(({ kind, id, row }) => ({ kind, id, row }))
}

/** Tasks of one project in effective order (overridden tasks excluded; they live in the top scope). */
export function resolveProject(tasks = []) {
  return tasks.filter((t) => !isOverridden(t)).slice().sort(cmpTask)
}

/**
 * Flattened effective order: [{ id, project_id, overridden, key, row }].
 * key = [projectTopRank, taskRank, priority, created_at] for a non-overridden task,
 *       [ownTopRank, -1, priority, created_at] for an overridden one (ranks are 0-based positions).
 * Non-overridden tasks whose project is not in `projects` are appended last, in task order.
 */
export function flatten(projects = [], tasks = []) {
  const top = resolveTop(projects, tasks.filter(isOverridden))
  const byProject = new Map()
  for (const t of tasks) {
    if (isOverridden(t)) continue
    if (!byProject.has(t.project_id)) byProject.set(t.project_id, [])
    byProject.get(t.project_id).push(t)
  }
  const out = []
  top.forEach((e, topRank) => {
    if (e.kind === 'task') {
      const t = e.row
      out.push({ id: t.id, project_id: t.project_id, overridden: true, key: [topRank, -1, t.priority ?? 2, t.created_at ?? ''], row: t })
      return
    }
    resolveProject(byProject.get(e.id) || []).forEach((t, taskRank) => {
      out.push({ id: t.id, project_id: t.project_id, overridden: false, key: [topRank, taskRank, t.priority ?? 2, t.created_at ?? ''], row: t })
    })
    byProject.delete(e.id)
  })
  const orphanRank = top.length
  // orphans grouped by project (ids ascending), task order inside each
  const orphans = [...byProject.values()].flat().sort((a, b) => cmpStr(a.project_id, b.project_id) || cmpTask(a, b))
  orphans.forEach((t, taskRank) => {
    out.push({ id: t.id, project_id: t.project_id, overridden: false, key: [orphanRank, taskRank, t.priority ?? 2, t.created_at ?? ''], row: t })
  })
  return out
}

/**
 * Move `id` within `ids`; returns a new array. Exactly one of:
 *   { to_index }  final index of id (clamped to [0, length-1])
 *   { before }    place directly before that id
 *   { after }     place directly after that id
 * Throws if id is not in ids, or the before/after anchor is missing.
 */
export function applyMove(ids, id, spec = {}) {
  if (!Array.isArray(ids)) throw new TypeError('ids must be an array')
  const from = ids.indexOf(id)
  if (from < 0) throw new Error(`id not in list: ${id}`)
  const rest = ids.filter((_, i) => i !== from)
  let at
  if (spec.to_index !== undefined && spec.to_index !== null) {
    const n = Math.trunc(Number(spec.to_index))
    at = Number.isFinite(n) ? Math.min(Math.max(n, 0), rest.length) : rest.length
  } else if (spec.before !== undefined && spec.before !== null) {
    if (spec.before === id) return ids.slice()
    at = rest.indexOf(spec.before)
    if (at < 0) throw new Error(`anchor not in list: ${spec.before}`)
  } else if (spec.after !== undefined && spec.after !== null) {
    if (spec.after === id) return ids.slice()
    const a = rest.indexOf(spec.after)
    if (a < 0) throw new Error(`anchor not in list: ${spec.after}`)
    at = a + 1
  } else {
    throw new Error('move needs to_index, before or after')
  }
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/** Compare a proposed id list `a` with the current members `b`. */
export function sameMembers(a = [], b = []) {
  const seen = new Set(), dupeSet = new Set()
  for (const x of a) (seen.has(x) ? dupeSet : seen).add(x)
  const bs = new Set(b)
  const missing = [...bs].filter((x) => !seen.has(x))
  const extra = [...seen].filter((x) => !bs.has(x))
  const dupes = [...dupeSet]
  return { ok: !missing.length && !extra.length && !dupes.length, missing, extra, dupes }
}
