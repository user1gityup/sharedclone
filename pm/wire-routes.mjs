// REST wiring for three pm modules that previously only existed as libraries:
//   agent-access.mjs  (T-4dfa4288)  -> agentAccessRoutes: admin of agent identities, grants, tokens, audit
//   free-swarm.mjs    (T-0bf60afc)  -> freeSwarmRoutes: seat registry, mode toggle, runs, permission gate
//   change-notify.mjs (T-f06d8373)  -> notifyRoutes: notifications, capacity and usage views
// Routes are [method, regex, handler(m, body, w, query, principal)] like server.mjs. Everything that
// changes configuration needs a trusted principal (loopback/peer; none when the bridge is off).
import { PmError } from './store.mjs'
import { TRUSTED_PRINCIPALS } from './access.mjs'
import * as AA from './agent-access.mjs'
import * as roles from './roles.mjs'
import { createFreeSwarm, seatEligibility, resolveMode, SwarmError } from './free-swarm.mjs'
import * as notify from './notify.mjs'
import { capacityView, notifyCapacity, usageView } from './change-notify.mjs'
import { migrateLedger } from './usage-ledger.mjs'

const trusted = (p) => !p || (p.agent !== true && TRUSTED_PRINCIPALS.has(p.name))
const needTrusted = (p) => { if (!trusted(p)) throw new PmError(403, 'this route needs a trusted principal (local admin or peer)') }
const need = (w) => { if (!w?.actor) throw new PmError(400, 'actor is required'); return w.actor }
const ACCESS_STATUS = { BAD_REQUEST: 400, APPROVAL_REQUIRED: 409, UNKNOWN_AGENT: 404, NO_GRANT: 403 }
const SWARM_STATUS = { FORBIDDEN: 403, NOT_FOUND: 404, BAD_REQUEST: 400, INELIGIBLE: 409, EVIDENCE: 409, NOT_RETURNED: 409 }
const mapErr = (err) => {
  if (err instanceof AA.AccessError) return new PmError(ACCESS_STATUS[err.code] ?? 400, err.message, { code: err.code })
  if (err instanceof SwarmError) return new PmError(SWARM_STATUS[err.code] ?? 400, err.message, { code: err.code })
  return err
}
const wrap = (fn) => (...a) => { try { return fn(...a) } catch (err) { throw mapErr(err) } }
const wrapAsync = (fn) => async (...a) => { try { return await fn(...a) } catch (err) { throw mapErr(err) } }
const nowIso = (clock) => new Date(clock()).toISOString()

// ---------------- agent access ----------------
export function agentAccessRoutes(db) {
  AA.migrateAgentAccess(db); roles.migrate(db)
  return [
    ['GET', /^\/api\/agent-access\/agents$/, wrap((m, b, w, q, p) => {
      needTrusted(p)
      return db.prepare('SELECT agent_id, seat, machine, human_owner, registered_by, registered_at, revoked_at FROM agent_identities ORDER BY agent_id').all()
        .map((r) => ({ ...r, grants: AA.permissionMatrix(db, r.agent_id, new Date()) }))
    })],
    ['POST', /^\/api\/agent-access\/agents$/, wrap((m, b, w, q, p) => { needTrusted(p); AA.registerAgent(db, { ...b, by: need(w), now: new Date() }); return { ok: true, agent_id: b.agent_id } })],
    ['POST', /^\/api\/agent-access\/agents\/([\w.-]+)\/revoke$/, wrap((m, b, w, q, p) => { needTrusted(p); AA.revokeAgent(db, m[1], { by: need(w), now: new Date() }); return { ok: true } })],
    ['POST', /^\/api\/agent-access\/grants$/, wrap((m, b, w, q, p) => { needTrusted(p); return { id: AA.grantAction(db, { ...b, by: need(w), now: new Date() }) } })],
    ['POST', /^\/api\/agent-access\/grants\/(\d+)\/revoke$/, wrap((m, b, w, q, p) => { needTrusted(p); AA.revokeGrant(db, Number(m[1]), { by: need(w), now: new Date() }); return { ok: true } })],
    ['POST', /^\/api\/agent-access\/tokens$/, wrap((m, b, w, q, p) => { needTrusted(p); return AA.issueToken(db, { agent_id: b.agent_id, scopes: b.scopes, ttlMs: b.ttl_ms, by: need(w), now: new Date() }) })],
    ['POST', /^\/api\/agent-access\/tokens\/revoke$/, wrap((m, b, w, q, p) => { needTrusted(p); AA.revokeToken(db, b.token, { by: need(w), now: new Date() }); return { ok: true } })],
    ['GET', /^\/api\/agent-access\/audit$/, wrap((m, b, w, q, p) => { needTrusted(p); return AA.auditLog(db, q).slice(-500) })],
  ]
}

// ---------------- free swarm ----------------
const SWARM_SCHEMA = `
CREATE TABLE IF NOT EXISTS free_seats (id TEXT PRIMARY KEY, machine TEXT, cost_class TEXT NOT NULL, verified_free INTEGER NOT NULL DEFAULT 0,
  quota_remaining REAL, quota_limit REAL, quota_as_of TEXT, quota_reset_at TEXT, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS free_swarm_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL);
`
export const migrateFreeSwarm = (db) => db.exec(SWARM_SCHEMA)
// swarm op -> the agent-access action an agent token needs / the roles.mjs action a human role needs
const OP_ACTION = { launch: 'swarm', pause: 'swarm', reassign: 'swarm', edit: 'swarm', approve: 'review', complete: 'complete' }
const OP_ROLE = { launch: 'run', pause: 'run', reassign: 'run', edit: 'run', approve: 'approve', complete: 'approve' }
const COST_CLASSES = ['local', 'free', 'included', 'metered']

export function freeSwarmRoutes({ db, roleDb = db, store, gate = null, invoke, clock = () => Date.now() }) {
  migrateFreeSwarm(db); roles.migrate(roleDb) // roles live beside agent grants (the bridge db when it is on)
  let ctx = null // principal of the request currently inside a synchronous swarm gate call
  const seats = () => db.prepare('SELECT * FROM free_seats ORDER BY id').all().map((r) => ({
    id: r.id, machine: r.machine, cost_class: r.cost_class, verified_free: !!r.verified_free,
    quota: r.quota_remaining == null ? null : { remaining: r.quota_remaining, limit: r.quota_limit, as_of: r.quota_as_of, reset_at: r.quota_reset_at },
  }))
  const mode = () => resolveMode({ mode: db.prepare("SELECT value FROM free_swarm_config WHERE key='mode'").get()?.value })

  // PM-specific permission only: no DSH swarm rule is read or changed here.
  const can = (actor, op, project) => {
    const p = ctx
    if (p?.agent) return gate ? gate.check({ entry: 'rest', token: p.token, proof: p.proof, action: OP_ACTION[op], project }).allow : false
    const role = roles.roleOf(roleDb, actor, project)
    if (role) { try { roles.assertAllowed(roleDb, actor, OP_ROLE[op], { project }); return true } catch { return false } }
    return trusted(p) // local admin / peer keep today's access; a token principal with no role assignment is refused
  }
  const swarm = createFreeSwarm({ seats, can, invoke: invoke ?? (async () => { throw new Error('no DSH invoker configured on this pm') }), clock })
  const projectOfRun = new Map()
  const as = (p, fn) => { ctx = p; try { return fn() } finally { ctx = null } }
  const seatView = (s) => ({ ...s, ...seatEligibility(s, { now: clock() }) })

  const routes = [
    ['GET', /^\/api\/free-swarm\/config$/, () => ({ mode: mode(), modes: ['default', 'free-only'] })],
    ['POST', /^\/api\/free-swarm\/config$/, wrap((m, b, w, q, p) => {
      needTrusted(p); const actor = need(w)
      if (!['default', 'free-only'].includes(b.mode)) throw new PmError(400, 'mode must be default or free-only')
      db.prepare("INSERT INTO free_swarm_config (key, value, updated_by, updated_at) VALUES ('mode', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
        .run(b.mode, actor, nowIso(clock))
      store.recordEvent(w, 'free-swarm', 'config', 'mode', { mode: b.mode })
      return { mode: mode() }
    })],
    ['GET', /^\/api\/free-swarm\/seats$/, () => seats().map(seatView)],
    ['POST', /^\/api\/free-swarm\/seats$/, wrap((m, b, w, q, p) => {
      needTrusted(p); const actor = need(w)
      if (!b.id || typeof b.id !== 'string') throw new PmError(400, 'id required')
      if (!COST_CLASSES.includes(b.cost_class)) throw new PmError(400, `cost_class must be one of ${COST_CLASSES.join(', ')}`)
      const qt = b.quota ?? {}
      db.prepare(`INSERT INTO free_seats (id, machine, cost_class, verified_free, quota_remaining, quota_limit, quota_as_of, quota_reset_at, updated_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET machine=excluded.machine, cost_class=excluded.cost_class, verified_free=excluded.verified_free,
        quota_remaining=excluded.quota_remaining, quota_limit=excluded.quota_limit, quota_as_of=excluded.quota_as_of, quota_reset_at=excluded.quota_reset_at,
        updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
        .run(b.id, b.machine ?? null, b.cost_class, b.verified_free === true ? 1 : 0, qt.remaining ?? null, qt.limit ?? null, qt.as_of ?? null, qt.reset_at ?? null, actor, nowIso(clock))
      store.recordEvent(w, 'free-swarm', b.id, 'seat', { cost_class: b.cost_class, verified_free: b.verified_free === true })
      return seatView(seats().find((s) => s.id === b.id))
    })],
    ['GET', /^\/api\/free-swarm\/runs$/, () => [...projectOfRun.keys()].map((id) => ({ ...swarm.view(id), project: projectOfRun.get(id) }))],
    ['POST', /^\/api\/free-swarm\/runs$/, wrap((m, b, w, q, p) => {
      const actor = need(w)
      if (mode() !== 'free-only') throw new PmError(409, 'free-only mode is off; the default swarm mode is unchanged')
      const id = b.id ?? `FS-${Math.random().toString(16).slice(2, 10)}`
      if (projectOfRun.has(id)) throw new PmError(409, `run ${id} exists`)
      as(p, () => swarm.create({ id, project: b.project, actor, pool: b.pool, tasks: b.tasks }))
      projectOfRun.set(id, b.project)
      store.recordEvent(w, 'free-swarm', id, 'create', { project: b.project, pool: b.pool })
      return swarm.view(id)
    })],
    ['GET', /^\/api\/free-swarm\/runs\/([\w-]+)$/, wrap((m) => swarm.view(m[1]))],
    ['POST', /^\/api\/free-swarm\/runs\/([\w-]+)\/(tick|pause|resume|approve|reassign|complete|expand)$/, wrapAsync(async (m, b, w, q, p) => {
      const actor = need(w); const [, id, op] = m
      if (op === 'tick') {
        if (!as(p, () => can(actor, 'launch', projectOfRun.get(id)))) throw new PmError(403, `${actor} may not run this swarm`)
        await swarm.tick(id)
      } else if (op === 'pause') as(p, () => swarm.pause(id, actor))
      else if (op === 'resume') as(p, () => swarm.resume(id, actor))
      else if (op === 'approve') as(p, () => swarm.approve(id, actor, b.task))
      else if (op === 'reassign') as(p, () => swarm.reassign(id, actor, b.task, b.seat))
      else if (op === 'complete') as(p, () => swarm.complete(id, actor, b.task, b.evidence))
      else if (op === 'expand') as(p, () => swarm.expand(id, actor, b.seat, b.allowed_pool ?? swarm.get(id).pool))
      store.recordEvent(w, 'free-swarm', id, op, { task: b.task ?? null, seat: b.seat ?? null })
      return swarm.view(id)
    })],
  ]
  return { routes, swarm, seats, mode, runProject: (id) => projectOfRun.get(id) ?? null }
}

// ---------------- notifications, capacity, usage ----------------
export function notifyRoutes({ db, ledgerDb = () => null, seats = () => [], clock = () => Date.now() }) {
  notify.migrate(db)
  const sources = () => seats().map((s) => ({
    name: s.id, machine: s.machine, used: s.quota && typeof s.quota.limit === 'number' ? s.quota.limit - s.quota.remaining : null,
    limit: s.quota?.limit ?? null, as_of: s.quota?.as_of ?? null, reset_at: s.quota?.reset_at ?? null,
  }))
  return {
    sources,
    routes: [
      ['GET', /^\/api\/notifications$/, (m, b, w, q) => notify.list(db, { identity: q.identity, role: q.role, unread: q.unread === '1' || q.unread === 'true' })],
      ['POST', /^\/api\/notifications\/([\w-]+)\/mark$/, (m, b, w) => {
        try { return notify.mark(db, m[1], { identity: b.identity ?? w.actor, state: b.state }) } catch (err) { throw new PmError(400, err.message) }
      }],
      ['GET', /^\/api\/capacity$/, () => capacityView(sources(), { now: clock() })],
      ['POST', /^\/api\/capacity\/notify$/, (m, b, w, q, p) => { needTrusted(p); return { events: notifyCapacity(db, sources(), { now: clock() }) } }],
      ['GET', /^\/api\/usage-view$/, (m, b, w, q) => {
        const l = ledgerDb()
        if (!l) return { available: false, reason: 'no ledger database (bridge is off)' }
        migrateLedger(l)
        const f = {}
        for (const k of ['task_id', 'run_id', 'agent', 'provider', 'model']) if (q[k]) f[k] = q[k]
        return { available: true, ...usageView(l, f) }
      }],
    ],
  }
}
