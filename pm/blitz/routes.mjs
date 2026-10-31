// BLITZ-03 pm routes: task rating, per-task approval requests, revoke, approval status,
// governed projects, and the start/resume/continue/runs gate. Registered by server.mjs.
// Handlers get (match, body, w, query, principal). principal is null without the bridge,
// or {name, scopes, projects} from bridge/auth.mjs; loopback and peer are trusted.
import { PmError } from '../store.mjs'
import * as approvals from '../approvals.mjs'
import * as roles from '../roles.mjs'
import { TRUSTED_PRINCIPALS } from '../access.mjs'
import { rateTask } from './rating.mjs'
import { scopeHash, approvalStatus, guardRequest, listGoverned, addGoverned, removeGoverned } from './gate.mjs'

const STATUS = { BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, EXPIRED: 410 }
function asPm(err) {
  if (err instanceof PmError) return err
  if (err?.code && STATUS[err.code]) return new PmError(STATUS[err.code], err.message, { code: err.code })
  return err
}
const wrap = (fn) => (...a) => { try { return fn(...a) } catch (err) { throw asPm(err) } }

const trusted = (p) => !p || TRUSTED_PRINCIPALS.has(p.name)
const sees = (p, project) => trusted(p) || p.projects?.includes('*') || p.projects?.includes(project)
/** The identity whose role is checked: a token principal is itself; a trusted caller names one. */
function identityOf(p, body, w) {
  const id = trusted(p) ? (body.approver ?? w.actor) : p.name
  if (typeof id !== 'string' || !id.trim()) throw new PmError(400, 'approver (the identity acting) is required')
  return id.trim()
}

/** @param getDb () => bridge.db or null (bridge off). */
export function blitzRoutes(store, getDb) {
  const needDb = () => {
    const db = getDb()
    if (!db) throw new PmError(503, 'the approval ledger needs the bridge (PM_BRIDGE is off)')
    return db
  }
  const routes = [
    ['PUT', /^\/api\/tasks\/([\w-]+)\/rating$/, wrap((m, b, w) => rateTask(store, w, m[1], b))],

    ['GET', /^\/api\/blitz\/tasks\/([\w-]+)\/approval-status$/, wrap((m, b, w, q, p) => {
      const task = store.getTask(m[1])
      if (!sees(p, task.project_id)) throw new PmError(404, `no task ${m[1]}`)
      return approvalStatus(getDb(), task)
    })],

    // The server binds project, task_id, task_rev and scope_hash from the live task;
    // the caller supplies only what is being asked for.
    ['POST', /^\/api\/blitz\/tasks\/([\w-]+)\/approvals$/, wrap((m, b, w, q, p) => {
      const db = needDb()
      const task = store.getTask(m[1])
      if (!sees(p, task.project_id)) throw new PmError(404, `no task ${m[1]}`)
      if (!approvals.TASK_KINDS.includes(b.kind)) throw new PmError(400, `kind must be one of ${approvals.TASK_KINDS.join(', ')}`)
      const scope = {
        project: task.project_id, task_id: task.id, task_rev: task.rev, scope_hash: scopeHash(task),
        scope: b.scope, permissions: b.permissions, version: b.version, merge_limit: b.merge_limit,
        ...(b.supersedes ? { supersedes: b.supersedes } : {}),
      }
      const requested_by = trusted(p) ? w.actor : p.name
      return approvals.requestApproval(db, { kind: b.kind, scope, requested_by })
    })],

    ['POST', /^\/api\/blitz\/approvals\/([\w-]+)\/revoke$/, wrap((m, b, w, q, p) => {
      const db = needDb()
      const a = approvals.getApproval(db, m[1])
      if (!a || !approvals.TASK_KINDS.includes(a.kind) || !sees(p, a.scope.project)) throw new PmError(404, `no task approval ${m[1]}`)
      const who = identityOf(p, b, w)
      roles.assertAllowed(db, who, 'approve', { project: a.scope.project })
      return approvals.revokeApproval(db, a.id, { actor: who, reason: b.reason ?? '' })
    })],

    ['GET', /^\/api\/blitz\/governed-projects$/, wrap(() => listGoverned(needDb()))],
    ['POST', /^\/api\/blitz\/governed-projects$/, wrap((m, b, w, q, p) => {
      const db = needDb()
      if (typeof b.project !== 'string' || !b.project.trim() || b.project === '*') throw new PmError(400, 'project (an id) required')
      const who = identityOf(p, b, w)
      roles.assertAllowed(db, who, 'bridge_settings')
      return addGoverned(db, b.project.trim(), who)
    })],
    ['DELETE', /^\/api\/blitz\/governed-projects$/, wrap((m, b, w, q, p) => {
      const db = needDb()
      const project = b.project ?? q.project
      if (typeof project !== 'string' || !project.trim()) throw new PmError(400, 'project required')
      roles.assertAllowed(db, identityOf(p, b, w), 'bridge_settings')
      return removeGoverned(db, project.trim())
    })],
  ]
  const guard = (method, pathname) => {
    try { guardRequest(getDb(), store, method, pathname) } catch (err) { throw asPm(err) }
  }
  return { routes, guard }
}
