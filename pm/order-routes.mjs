// pm HTTP routes for project/task ordering (spec S4). Spread into server.mjs `routes`.
// Handlers follow server.mjs: (match, body, w, query) -> JSON result; PmError -> status.
// Drafts come from order-drafts.mjs (S6), imported lazily so these routes load without it.
import { PmError } from './store.mjs'
import { historyQuery } from './order-audit.mjs'
import { roleCan, ROLES } from './roles.mjs'

const REF = '([^/]+)'
const ID = '([\\w-]+)'

/** Lazy drafts: createDrafts(...) from order-drafts.mjs once it exists; null until then. */
function draftsLoader(store) {
  let inst = null
  let pending = null
  const build = (mod) => {
    if (!mod?.createDrafts || !store.orderDeps) return null
    const { db, tx, now, newId, event, who } = store.orderDeps
    return mod.createDrafts({ db, tx, now, newId, orderOps: store.orderOps, event, who })
  }
  return {
    peek: () => inst,
    async get() {
      if (inst) return inst
      pending ??= import('./order-drafts.mjs').then(build, () => null).finally(() => { pending = null })
      inst = await pending
      if (!inst) throw new PmError(501, 'order drafts are not available (order-drafts.mjs missing)')
      return inst
    },
  }
}

function historyRows(store, scope, limit) {
  const db = store.orderDeps?.db
  if (!db) throw new PmError(501, 'order history is not available')
  const s = scope ? store.orderOps.normScope(scope) : null
  const { sql, args } = historyQuery(s, limit)
  return db.prepare(sql).all(...args).map((r) => {
    let data = r.data
    try { data = JSON.parse(r.data || '{}') } catch {}
    return { ...r, data }
  })
}

const scopeOf = (draft) => draft?.scope ?? draft?.draft?.scope

/**
 * resolveOrder(target) for access.mjs authorizePm: turns {project:ref}/{draft:id}/{task:id}
 * into {top:true} | {project:<P-id>, names:[ref, name]} so role checks match id or name.
 */
export function orderResolver(store, drafts) {
  const projectNames = (ref) => {
    const scope = store.orderOps.normScope(`project:${ref}`)
    const id = scope.slice(8)
    const p = store.listProjects().find((x) => x.id === id)
    return { project: id, names: [ref, p?.name].filter(Boolean) }
  }
  const fromScope = (scope) => {
    if (scope === 'top') return { top: true }
    if (typeof scope === 'string' && scope.startsWith('project:')) return projectNames(scope.slice(8))
    return {}
  }
  return (target) => {
    if (target.top) return { top: true }
    if (target.project) return projectNames(target.project)
    if (target.task) {
      const t = store.getTask(target.task)
      return t?.project_id ? projectNames(t.project_id) : {}
    }
    if (target.draft) {
      const inst = drafts?.peek()
      if (!inst) return {}
      return fromScope(scopeOf(inst.get(target.draft)))
    }
    return target
  }
}

export function orderRoutes(store, drafts = draftsLoader(store)) {
  const ops = store.orderOps
  const routes = [
    ['GET', /^\/api\/order$/, (m, b, w, q) => ops.getOrder(q.scope || 'top')],
    ['GET', /^\/api\/order\/flat$/, (m, b, w, q) => ops.flat(q.project || undefined)],
    ['GET', /^\/api\/order\/history$/, (m, b, w, q) => historyRows(store, q.scope, q.limit)],
    ['GET', /^\/api\/order\/capabilities$/, (m, b, w, q) => {
      const role = q.role
      if (role && !ROLES.includes(role)) throw new PmError(400, `unknown role ${role}`)
      return { role: role ?? null, can_reorder: role ? roleCan(role, 'reorder') : false }
    }],
    ['PUT', /^\/api\/order\/top$/, (m, b, w) => ops.setOrder(w, 'top', { base_rev: b.base_rev, ids: b.ids, mode: b.mode })],
    ['POST', /^\/api\/order\/top\/move$/, (m, b, w) => ops.moveItem(w, 'top', moveArgs(b))],
    ['PUT', new RegExp(`^/api/order/project/${REF}$`), (m, b, w) => ops.setOrder(w, `project:${decodeURIComponent(m[1])}`, { base_rev: b.base_rev, ids: b.ids, mode: b.mode })],
    ['POST', new RegExp(`^/api/order/project/${REF}/move$`), (m, b, w) => ops.moveItem(w, `project:${decodeURIComponent(m[1])}`, moveArgs(b))],
    ['POST', new RegExp(`^/api/order/override/${ID}$`), (m, b, w) => ops.setOverride(w, m[1], {
      override: b.override, base_rev_top: b.base_rev_top, base_rev_project: b.base_rev_project, to_index: b.to_index, mode: b.mode,
    })],
    ['POST', /^\/api\/order\/drafts$/, async (m, b, w) => (await drafts.get()).create(w, { scope: b.scope, base_rev: b.base_rev, ids: b.ids })],
    ['GET', new RegExp(`^/api/order/drafts/${ID}$`), async (m) => (await drafts.get()).get(m[1])],
    ['POST', new RegExp(`^/api/order/drafts/${ID}/commit$`), async (m, b, w) => (await drafts.get()).commit(w, m[1])],
    ['DELETE', new RegExp(`^/api/order/drafts/${ID}$`), async (m, b, w) => (await drafts.get()).discard(w, m[1])],
  ]
  routes.resolveOrder = orderResolver(store, drafts)
  routes.drafts = drafts
  return routes
}

function moveArgs(b) {
  return { base_rev: b.base_rev, id: b.id, to_index: b.to_index, before: b.before, after: b.after, mode: b.mode }
}
