// BLITZ-05 dependency waves (Claude Opus 5.5). Edges come only from meta.blitz.depends_on.
// A dependency on a task outside the set is reported in `external` and does not form an edge
// (the controller checks those against pm status). Cycles are returned, never thrown.
import { parseMeta } from './rank.mjs'

export function dependsOnOf(task) {
  const d = parseMeta(task).blitz?.depends_on
  return Array.isArray(d) ? [...new Set(d.map(String).filter((x) => x && x !== task.id))] : []
}

/**
 * @param tasks [{id, meta?, priority?}] in the caller's preferred order (ties keep it)
 * @returns {nodes, waves: [[id]], cycles: [[id]], blocked: [id], waveOf: {id: n}}
 *   waves[0] has no in-set dependencies; a task is in wave k when its deepest dependency is in k-1.
 *   cycles: each strongly connected component of size > 1, or a self-loop.
 *   blocked: tasks in a cycle or downstream of one; they appear in no wave.
 */
export function buildDag(tasks) {
  const ids = tasks.map((t) => t.id)
  const inSet = new Set(ids)
  const order = new Map(ids.map((id, i) => [id, i]))
  const deps = new Map()
  const nodes = []
  for (const t of tasks) {
    const raw = parseMeta(t).blitz?.depends_on
    const all = Array.isArray(raw) ? [...new Set(raw.map(String).filter(Boolean))] : []
    const internal = all.filter((d) => inSet.has(d))
    deps.set(t.id, internal)
    nodes.push({ id: t.id, depends_on: internal, external: all.filter((d) => !inSet.has(d)) })
  }

  // Tarjan SCC (iterative, so deep chains do not overflow the stack).
  let index = 0
  const idx = new Map(); const low = new Map(); const onStack = new Set(); const stack = []
  const sccs = []
  for (const root of ids) {
    if (idx.has(root)) continue
    const work = [[root, 0]]
    idx.set(root, index); low.set(root, index); index++; stack.push(root); onStack.add(root)
    while (work.length) {
      const frame = work[work.length - 1]
      const [v, i] = frame
      const ds = deps.get(v)
      if (i < ds.length) {
        frame[1]++
        const w = ds[i]
        if (!idx.has(w)) {
          idx.set(w, index); low.set(w, index); index++; stack.push(w); onStack.add(w)
          work.push([w, 0])
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)))
      } else {
        work.pop()
        if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))) }
        if (low.get(v) === idx.get(v)) {
          const comp = []
          let w
          do { w = stack.pop(); onStack.delete(w); comp.push(w) } while (w !== v)
          sccs.push(comp)
        }
      }
    }
  }
  const cycles = sccs
    .filter((c) => c.length > 1 || deps.get(c[0]).includes(c[0]))
    .map((c) => c.sort((a, b) => order.get(a) - order.get(b)))
  const inCycle = new Set(cycles.flat())

  // Longest-path layering over the acyclic part; anything depending on a cycle is blocked.
  const waveOf = {}
  const blocked = new Set(inCycle)
  const visiting = new Set()
  const layer = (id) => {
    if (id in waveOf) return waveOf[id]
    if (blocked.has(id)) return -1
    visiting.add(id)
    let w = 0
    for (const d of deps.get(id)) {
      const k = blocked.has(d) || visiting.has(d) ? -1 : layer(d)
      if (k < 0) { blocked.add(id); visiting.delete(id); return -1 }
      w = Math.max(w, k + 1)
    }
    visiting.delete(id)
    waveOf[id] = w
    return w
  }
  for (const id of ids) layer(id)
  const waves = []
  for (const id of ids) if (id in waveOf) (waves[waveOf[id]] ??= []).push(id)

  return {
    nodes, waves, cycles, waveOf,
    blocked: ids.filter((id) => blocked.has(id)),
    has_cycles: cycles.length > 0,
  }
}
