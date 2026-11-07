// order.mjs - pm manual-ordering store ops (Claude Opus (S3)).
// Built on order-schema (S1), order-resolve (S2) and order-audit (S5). Wired in store.mjs as
// `api.orderOps = createOrderOps({ db, tx, now, event, who, projectRow, taskRow, PmError })`.
// A reorder never touches task/project `rev`: conflicts are detected per scope (order_scopes.rev).

import { ensureScope } from './order-schema.mjs'
import { resolveTop, resolveProject, flatten, applyMove, sameMembers } from './order-resolve.mjs'
import { reorderEvent, ORDER_MODES } from './order-audit.mjs'

const rowsOf = (stmt, ...args) => stmt.all(...args).map((r) => ({ ...r }))

export function createOrderOps({ db, tx, now, event, who, projectRow, taskRow, PmError }) {
  const fail = (status, msg, extra) => new PmError(status, msg, extra)

  /** Normalise 'top' | 'project:<id|name>' to 'top' | 'project:<P-id>'. */
  function normScope(scope) {
    if (scope === 'top') return 'top'
    if (typeof scope === 'string' && scope.startsWith('project:') && scope.length > 8) {
      return `project:${projectRow(scope.slice(8)).id}`
    }
    throw fail(400, `scope must be 'top' or 'project:<ref>', got ${JSON.stringify(scope)}`)
  }

  const activeProjects = () => rowsOf(db.prepare(`SELECT * FROM projects WHERE status != 'archived'`))
  const overriddenTasks = () => rowsOf(db.prepare('SELECT * FROM tasks WHERE order_override = 1'))
  const projectTasks = (pid) => rowsOf(db.prepare('SELECT * FROM tasks WHERE project_id = ? AND order_override = 0'), pid)

  function itemsOf(scope) {
    if (scope === 'top') {
      return resolveTop(activeProjects(), overriddenTasks()).map(({ kind, id, row }) =>
        ({ kind, id, ...(kind === 'project' ? { name: row.name } : { title: row.title, project_id: row.project_id }) }))
    }
    return resolveProject(projectTasks(scope.slice(8))).map((t) => ({ kind: 'task', id: t.id, title: t.title, project_id: t.project_id }))
  }

  function snapshot(scope) {
    const { rev } = ensureScope(db, scope, now())
    return { scope, rev, items: itemsOf(scope) }
  }

  // Write ranks 1..n for the given ordered ids of a scope (no rev/updated_at on rows).
  // updated_at moves only on rows whose rank changed, so pm sync (sync-schema.mjs,
  // newest updated_at wins) carries a reorder to the peer; rev stays put.
  function writeRanks(scope, ids) {
    const at = now()
    if (scope === 'top') {
      const p = db.prepare('UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND sort_order IS NOT ?')
      const pin = db.prepare('SELECT 1 FROM projects WHERE id = ?')
      const t = db.prepare('UPDATE tasks SET top_order = ?, updated_at = ? WHERE id = ? AND order_override = 1 AND top_order IS NOT ?')
      ids.forEach((id, i) => { if (pin.get(id)) p.run(i + 1, at, id, i + 1); else t.run(i + 1, at, id, i + 1) })
    } else {
      const t = db.prepare('UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ? AND sort_order IS NOT ?')
      ids.forEach((id, i) => t.run(i + 1, at, id, i + 1))
    }
  }

  function bumpScope(scope) {
    db.prepare('UPDATE order_scopes SET rev = rev + 1, updated_at = ? WHERE scope = ?').run(now(), scope)
    return db.prepare('SELECT rev FROM order_scopes WHERE scope = ?').get(scope).rev
  }

  function checkMode(mode) {
    const m = mode ?? 'manual'
    if (!ORDER_MODES.includes(m)) throw fail(400, `mode must be one of ${ORDER_MODES.join(', ')}`)
    return m
  }

  function checkRev(cur, base_rev, rejected) {
    if (base_rev === undefined || base_rev === null || base_rev === '') throw fail(400, 'base_rev is required: pass the scope revision you edited')
    if (Number(base_rev) !== cur.rev) {
      throw fail(409, `order ${cur.scope} changed since revision ${base_rev} (now ${cur.rev})`, { current: { rev: cur.rev, items: cur.items }, rejected })
    }
  }

  function knownId(id) {
    return !!(db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id) || db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(id))
  }

  // Core bulk write; caller holds the tx.
  function setOrderTx(w, scope, { base_rev, ids, mode, draft_id, action = 'reordered' }) {
    const cur = snapshot(scope)
    const before = cur.items.map((i) => i.id)
    checkRev(cur, base_rev, { ids })
    const m = sameMembers(ids, before)
    if (!m.ok) {
      const unknown = m.extra.filter((id) => !knownId(id))
      if (unknown.length) throw fail(404, `unknown id(s) in ${scope}: ${unknown.join(', ')}`)
      throw fail(400, `ids must be exactly the members of ${scope}` +
        (m.missing.length ? `; missing: ${m.missing.join(', ')}` : '') +
        (m.extra.length ? `; extra: ${m.extra.join(', ')}` : '') +
        (m.dupes.length ? `; duplicate: ${m.dupes.join(', ')}` : ''), { missing: m.missing, extra: m.extra, dupes: m.dupes })
    }
    writeRanks(scope, ids)
    const rev = bumpScope(scope)
    const ev = reorderEvent({ scope, mode, draft_id, base_rev: Number(base_rev), rev, before, after: ids, action })
    event(w, ev.entity, ev.entity_id, ev.action, ev.data)
    return { scope, rev, items: itemsOf(scope) }
  }

  const ops = {
    normScope,

    /** -> { scope, rev, items:[{kind, id, name|title, project_id?}] } */
    getOrder(scope) {
      return snapshot(normScope(scope))
    },

    /** Bulk: ids = full member list of the scope. -> { scope, rev, items } */
    setOrder(w, scope, { base_rev, ids, mode, draft_id, action } = {}) {
      w = who(w)
      const s = normScope(scope)
      const md = checkMode(mode)
      if (!Array.isArray(ids)) throw fail(400, 'ids must be an array')
      return tx(() => setOrderTx(w, s, { base_rev, ids, mode: md, draft_id, action }))
    },

    /** Single move: exactly one of to_index | before | after. -> { scope, rev, items } */
    moveItem(w, scope, { base_rev, id, to_index, before, after, mode } = {}) {
      w = who(w)
      const s = normScope(scope)
      const md = checkMode(mode)
      return tx(() => {
        const cur = snapshot(s)
        checkRev(cur, base_rev, { id, to_index, before, after })
        const list = cur.items.map((i) => i.id)
        for (const x of [id, before, after]) {
          if (x != null && !list.includes(x)) throw fail(knownId(x) ? 400 : 404, `${x} is not a member of ${s}`)
        }
        let ids
        try { ids = applyMove(list, id, { to_index, before, after }) } catch (e) { throw fail(400, e.message) }
        return setOrderTx(w, s, { base_rev, ids, mode: md })
      })
    },

    /** Pin (override=true) a task into the top scope or unpin it back under its project. Bumps both scopes. */
    setOverride(w, taskId, { override, base_rev_top, base_rev_project, to_index, mode } = {}) {
      w = who(w)
      const md = checkMode(mode)
      const pin = !!override
      return tx(() => {
        const task = taskRow(taskId)
        const ps = `project:${task.project_id}`
        const top = snapshot('top')
        const proj = snapshot(ps)
        const rejected = { id: taskId, override: pin, to_index }
        checkRev(top, base_rev_top, rejected)
        checkRev(proj, base_rev_project, rejected)
        const topBefore = top.items.map((i) => i.id)
        const projBefore = proj.items.map((i) => i.id)
        if (Number(task.order_override) === 1 === pin) {
          return { task: { ...taskRow(taskId) }, top, project: proj }
        }
        const insertAt = (list) => {
          const n = to_index == null ? list.length : Math.min(Math.max(Math.trunc(Number(to_index)) || 0, 0), list.length)
          return [...list.slice(0, n), taskId, ...list.slice(n)]
        }
        let topAfter, projAfter
        if (pin) {
          topAfter = insertAt(topBefore)
          projAfter = projBefore.filter((x) => x !== taskId)
          db.prepare('UPDATE tasks SET order_override = 1, sort_order = NULL WHERE id = ?').run(taskId)
        } else {
          topAfter = topBefore.filter((x) => x !== taskId)
          projAfter = insertAt(projBefore)
          db.prepare('UPDATE tasks SET order_override = 0, top_order = NULL WHERE id = ?').run(taskId)
        }
        writeRanks('top', topAfter)
        writeRanks(ps, projAfter)
        const action = pin ? 'override_set' : 'override_cleared'
        const revTop = bumpScope('top')
        const revProj = bumpScope(ps)
        for (const [scope, b, a, br, r] of [['top', topBefore, topAfter, top.rev, revTop], [ps, projBefore, projAfter, proj.rev, revProj]]) {
          const ev = reorderEvent({ scope, mode: md, base_rev: br, rev: r, before: b, after: a, action })
          event(w, ev.entity, ev.entity_id, ev.action, { ...ev.data, task_id: taskId })
        }
        event(w, 'task', taskId, action, { override: pin, top_index: topAfter.indexOf(taskId), project_index: projAfter.indexOf(taskId), rev_top: revTop, rev_project: revProj })
        return { task: { ...taskRow(taskId) }, top: { scope: 'top', rev: revTop, items: itemsOf('top') }, project: { scope: ps, rev: revProj, items: itemsOf(ps) } }
      })
    },

    /** Every task in effective order (A1 key); optional project ref filter. -> [{id, project_id, overridden, key, task}] */
    flat(projectRef) {
      const pid = projectRef ? projectRow(projectRef).id : null
      const tasks = rowsOf(db.prepare('SELECT * FROM tasks'))
      return flatten(activeProjects(), tasks)
        .filter((e) => !pid || e.project_id === pid)
        .map(({ id, project_id, overridden, key, row }) => ({ id, project_id, overridden, key, task: row }))
    },

    /** Sort project rows (any subset) into manual top order. */
    sortProjects(projects) {
      return resolveTop(projects, []).map((e) => e.row)
    },

    /** Sort task rows (any subset) into effective order. */
    sortTasks(tasks) {
      const all = rowsOf(db.prepare('SELECT * FROM projects'))
      return flatten(all, tasks).map((e) => e.row)
    },
  }
  return ops
}
