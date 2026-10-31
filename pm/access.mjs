// Approval decisions, role administration and pm HTTP authorization (Step 3 NOT IMPLEMENTED
// groups 1 and 2). Identity is the bridge principal (bridge/auth.mjs):
//   loopback  - this machine's local admin (no token, local socket): unchanged full access
//   peer      - the machine-to-machine PM_TOKEN: unchanged full access
//   any other bridge-tokens.json principal (e.g. chatgpt): role-checked through
//             roles.assertAllowed on role_assignments in bridge.db; GET -> view, else run.
// Nothing here seeds a role. With no assignment recorded a token principal is refused.
import { BridgeError } from './bridge/protocol.mjs'
import { requireScope } from './bridge/auth.mjs'
import * as approvals from './approvals.mjs'
import * as roles from './roles.mjs'

/** Principals that keep today's full access on pm HTTP. */
export const TRUSTED_PRINCIPALS = new Set(['loopback', 'peer'])

const STATUS = { BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID_PROOF: 403, REPLAY: 409, EXPIRED: 410, IDENTITY_MISMATCH: 403 }
function asBridgeError(err) {
  if (err instanceof BridgeError) return err
  if (err?.code && STATUS[err.code]) { const e = new BridgeError(STATUS[err.code], err.message); e.extra = { code: err.code }; return e }
  if (err instanceof Error && /required|unknown role|not allowed|needs a project/.test(err.message)) return new BridgeError(400, err.message)
  return err
}
const wrap = (fn) => (...a) => { try { return fn(...a) } catch (err) { throw asBridgeError(err) } }

/** A token limited to some projects sees only approvals scoped to them. */
const seesProject = (p, project) => p.projects.includes('*') || (project && p.projects.includes(project))

/** authorize(approver, approval, method) for decideApproval: role may approve in scope and use this method. */
export function approvalAuthorizer(db, { relayed = false } = {}) {
  return (approver, a, method) => {
    let role
    try { role = roles.assertAllowed(db, approver, 'approve', { project: a.scope?.project }) } catch { return false }
    return relayed || roles.allowedApprovalMethods(role).includes(method)
  }
}

/**
 * Decide an approval for a bridge principal. A token principal (not loopback/peer) can only
 * relay: its proof is replaced by {via: <principal>}, so the result is pending_user_confirm.
 */
export function decideAs(db, principal, id, { approver, method, proof, decision, validSeconds } = {}) {
  const trusted = TRUSTED_PRINCIPALS.has(principal.name)
  const p = trusted ? proof : { via: principal.name }
  const relayed = p?.relayed === true || (p?.via != null && p.via !== '')
  const a = approvals.getApproval(db, id)
  if (!a || !seesProject(principal, a.scope?.project)) throw new BridgeError(404, `no approval ${id}`)
  return approvals.decideApproval(db, id, { approver, method, proof: p, decision, validSeconds, authorize: approvalAuthorizer(db, { relayed }) })
}

/** Bridge routes ([method, regex, scope, handler(m, body, principal, query)]) for approvals and roles. */
export function accessRoutes(db) {
  approvals.migrate(db)
  roles.migrate(db)
  const one = (p, id) => {
    const a = approvals.getApproval(db, id)
    if (!a || !seesProject(p, a.scope?.project)) throw new BridgeError(404, `no approval ${id}`)
    return a
  }
  return [
    ['GET', /^\/api\/bridge\/approvals$/, 'read', wrap((m, b, p, q) => approvals.listApprovals(db, q).filter((a) => seesProject(p, a.scope?.project)))],
    ['GET', /^\/api\/bridge\/approvals\/([\w-]+)$/, 'read', wrap((m, b, p) => one(p, m[1]))],
    // challenge secrets are shown to this machine's own user only (pm UI over loopback)
    ['POST', /^\/api\/bridge\/approvals\/([\w-]+)\/challenge$/, 'admin', wrap((m, b, p) => {
      if (p.name !== 'loopback') throw new BridgeError(403, 'challenges are issued to the local pm UI only')
      one(p, m[1])
      return approvals.issueChallenge(db, m[1], { method: b.method, ttlSeconds: b.ttlSeconds ?? b.ttl_seconds, approver: b.approver })
    })],
    ['POST', /^\/api\/bridge\/approvals\/([\w-]+)\/decide$/, 'send', wrap((m, b, p) => decideAs(db, p, m[1], b))],
    ['GET', /^\/api\/bridge\/roles$/, 'read', wrap((m, b, p, q) => roles.listRoles(db, { identity: q.identity }))],
    ['POST', /^\/api\/bridge\/roles$/, 'admin', wrap((m, b, p) => {
      roles.assignRole(db, { identity: b.identity, role: b.role, project: b.project ?? '', by: p.name })
      return roles.listRoles(db, { identity: b.identity })
    })],
    ['DELETE', /^\/api\/bridge\/roles$/, 'admin', wrap((m, b, p, q) => {
      const identity = b.identity ?? q.identity
      if (!identity) throw new BridgeError(400, 'identity required')
      roles.revokeRole(db, { identity, project: b.project ?? q.project ?? '' })
      return roles.listRoles(db, { identity })
    })],
  ]
}

/**
 * Order-route target for a non-GET under /api/order (null otherwise):
 * {top:true} | {project:ref} | {draft:id} | {task:id}. Draft create reads body.scope.
 */
export function orderTarget(method, pathname, body = {}) {
  if (method === 'GET' || typeof pathname !== 'string' || !pathname.startsWith('/api/order')) return null
  let m
  if (/^\/api\/order\/top(\/move)?$/.test(pathname)) return { top: true }
  if ((m = pathname.match(/^\/api\/order\/project\/([^/]+)(\/move)?$/))) return { project: decodeURIComponent(m[1]) }
  if ((m = pathname.match(/^\/api\/order\/override\/([\w-]+)$/))) return { task: m[1] }
  if (pathname === '/api/order/drafts') {
    const sc = body?.scope
    if (sc === 'top') return { top: true }
    if (typeof sc === 'string' && sc.startsWith('project:')) return { project: sc.slice(8) }
    return {}
  }
  if ((m = pathname.match(/^\/api\/order\/drafts\/([\w-]+)(\/commit)?$/))) return { draft: m[1] }
  return {}
}

/**
 * pm HTTP authorization for a bridge principal. Returns the actor to record:
 * trusted principals keep the caller-supplied actor; token principals are forced to their own name.
 * Non-GET under /api/order -> action 'reorder'; the project comes from the path ref, the draft's
 * scope or the task (resolveOrder(target) -> {top:true} | {project, names?:[...]}).
 */
export function authorizePm(db, principal, method, { body = {}, query = {}, pathname = '', resolveOrder = null } = {}) {
  const synced = authorizeSync(principal, method, pathname) // PM-SYNC
  if (synced !== undefined) return synced
  if (TRUSTED_PRINCIPALS.has(principal.name)) return null
  const target = orderTarget(method, pathname, body)
  try {
    if (target) {
      let t = target
      if (resolveOrder) { try { t = resolveOrder(target) ?? target } catch { t = target } }
      if (t.top) {
        requireScope(principal, 'send', null)
        roles.assertAllowed(db, principal.name, 'reorder', { top: true })
        return principal.name
      }
      const names = [...new Set([t.project, ...(t.names ?? [])].filter((x) => typeof x === 'string' && x))]
      requireScopeAny(principal, names)
      if (!names.length) { roles.assertAllowed(db, principal.name, 'reorder', {}); return principal.name }
      let last
      for (const project of names) {
        try { roles.assertAllowed(db, principal.name, 'reorder', { project }); return principal.name } catch (err) { last = err }
      }
      throw last
    }
    const project = body.project ?? query.project
    const action = method === 'GET' ? 'view' : 'run'
    requireScope(principal, method === 'GET' ? 'read' : 'send', typeof project === 'string' ? project : null)
    roles.assertAllowed(db, principal.name, action, project ? { project: String(project) } : {})
  } catch (err) {
    if (err instanceof BridgeError) throw err
    throw new BridgeError(403, err.message)
  }
  return principal.name
}

// --- PM-SYNC: /api/sync/* (sync.mjs). Peer pulls (GET changes/status): loopback, the PM_TOKEN
// peer, or a token holding 'replicate'. POST /api/sync/now: loopback or a token holding 'admin'.
// Returns undefined for any other path so the normal checks apply; 'replicate' grants nothing else.
const SYNC_READ = /^\/api\/sync\/(changes|status)$/
export function authorizeSync(principal, method, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/api/sync/')) return undefined
  if (principal.name === 'loopback') return null
  if (method === 'GET' && SYNC_READ.test(pathname)) {
    if (principal.name === 'peer') return null
    requireScope(principal, 'replicate', null)
    return principal.name
  }
  requireScope(principal, 'admin', null)
  return TRUSTED_PRINCIPALS.has(principal.name) ? null : principal.name
}
// --- end PM-SYNC ---

/** Token project scope: passes if any alias of the project (id or name) is in scope. */
function requireScopeAny(principal, names) {
  if (!names.length) return requireScope(principal, 'send', null)
  let last
  for (const n of names) { try { return requireScope(principal, 'send', n) } catch (err) { last = err } }
  throw last
}
