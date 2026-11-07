// Scoped PM access for DSH-hosted agents such as the Free Claude seat (T-4dfa4288).
// Standalone over node:sqlite; migrateAgentAccess(db) is idempotent and additive. PM permissions
// ONLY: nothing here reads or changes DSH swarm commands or DSH-wide rules.
//  - Identity is proven through DSH (ctx.verifyDshProof) and mapped to a human owner; hostname,
//    seat name or being "free" never grants anything. Eligibility is not entitlement.
//  - Hybrid authorization: ceiling = the human owner's role (roles.mjs) for the action; plus an
//    explicit per-agent, per-project, per-action grant with expiry. Least privilege: no grant, no access.
//  - Sensitive actions (assign, start, complete, swarm) need an approval_id on the grant.
//  - Delegated tokens are bounded (max 24h), hashed at rest, limited to a subset of live grants,
//    revocable. Every call re-reads state, so revocation is immediate on REST, MCP and bridge alike.
//  - Every decision, allow or deny, is audited (actor, seat, machine, action, target, outcome);
//    denial reasons never contain credentials. access_audit is append-only.
import { createHash, randomBytes } from 'node:crypto'
import { assertAllowed } from './roles.mjs'

export const ACTIONS = ['read', 'create', 'update', 'assign', 'start', 'review', 'complete', 'swarm']
export const SENSITIVE = new Set(['assign', 'start', 'complete', 'swarm'])
export const ENTRY_POINTS = ['rest', 'mcp', 'bridge']
export const MAX_TOKEN_MS = 24 * 60 * 60 * 1000
// action -> roles.mjs action used for the human owner's ceiling
const CEILING = { read: 'view', create: 'run', update: 'run', assign: 'run', start: 'run', swarm: 'run', review: 'approve', complete: 'approve' }
export class AccessError extends Error { constructor(code, msg) { super(msg); this.code = code } }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_identities (
  agent_id TEXT PRIMARY KEY, seat TEXT NOT NULL, machine TEXT NOT NULL, human_owner TEXT NOT NULL,
  registered_by TEXT NOT NULL, registered_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS agent_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, project TEXT NOT NULL, action TEXT NOT NULL,
  approval_id TEXT, issued_by TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  revoked_at TEXT, revoked_by TEXT);
CREATE INDEX IF NOT EXISTS agent_grants_k ON agent_grants(agent_id, project, action);
CREATE TABLE IF NOT EXISTS agent_tokens (
  token_hash TEXT PRIMARY KEY, agent_id TEXT NOT NULL, scopes TEXT NOT NULL, issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS access_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, seat TEXT, machine TEXT,
  entry TEXT, action TEXT NOT NULL, target TEXT, outcome TEXT NOT NULL, reason TEXT);
CREATE TRIGGER IF NOT EXISTS access_audit_no_update BEFORE UPDATE ON access_audit BEGIN SELECT RAISE(ABORT, 'access_audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS access_audit_no_delete BEFORE DELETE ON access_audit BEGIN SELECT RAISE(ABORT, 'access_audit is append-only'); END;
`
export function migrateAgentAccess(db) { db.exec(SCHEMA) }

const iso = (v) => (v instanceof Date ? v : new Date(v ?? Date.now())).toISOString()
const hash = (t) => createHash('sha256').update(String(t)).digest('hex')
const need = (v, n) => { if (typeof v !== 'string' || !v.trim()) throw new AccessError('BAD_REQUEST', `${n} required`) }

function log(db, row) {
  db.prepare('INSERT INTO access_audit (at, actor, seat, machine, entry, action, target, outcome, reason) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(iso(row.now), row.actor ?? 'unknown', row.seat ?? null, row.machine ?? null, row.entry ?? null,
      row.action, row.target ?? null, row.outcome, row.reason ?? null)
}

/** Admin registers a DSH agent identity and the human it acts for. No implicit privileges. */
export function registerAgent(db, { agent_id, seat, machine, human_owner, by, now }) {
  for (const [v, n] of [[agent_id, 'agent_id'], [seat, 'seat'], [machine, 'machine'], [human_owner, 'human_owner'], [by, 'by']]) need(v, n)
  db.prepare(`INSERT INTO agent_identities (agent_id, seat, machine, human_owner, registered_by, registered_at, revoked_at)
    VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(agent_id) DO UPDATE SET seat=excluded.seat, machine=excluded.machine,
    human_owner=excluded.human_owner, registered_by=excluded.registered_by, registered_at=excluded.registered_at, revoked_at=NULL`)
    .run(agent_id, seat, machine, human_owner, by, iso(now))
  log(db, { now, actor: by, seat, machine, action: 'register_agent', target: agent_id, outcome: 'allow' })
}

export function revokeAgent(db, agent_id, { by, now }) {
  need(by, 'by')
  db.prepare('UPDATE agent_identities SET revoked_at=? WHERE agent_id=? AND revoked_at IS NULL').run(iso(now), agent_id)
  db.prepare('UPDATE agent_tokens SET revoked_at=? WHERE agent_id=? AND revoked_at IS NULL').run(iso(now), agent_id)
  log(db, { now, actor: by, action: 'revoke_agent', target: agent_id, outcome: 'allow' })
}

/** One action in one project for one agent. Wildcard project/action is refused (least privilege). */
export function grantAction(db, { agent_id, project, action, approval_id, expires_at, by, now }) {
  for (const [v, n] of [[agent_id, 'agent_id'], [project, 'project'], [action, 'action'], [by, 'by']]) need(v, n)
  if (project.includes('*') || action.includes('*')) throw new AccessError('BAD_REQUEST', 'wildcard grants are not allowed')
  if (!ACTIONS.includes(action)) throw new AccessError('BAD_REQUEST', `unknown PM action ${action}`)
  if (SENSITIVE.has(action) && !approval_id) throw new AccessError('APPROVAL_REQUIRED', `${action} needs an approval_id`)
  if (!db.prepare('SELECT 1 FROM agent_identities WHERE agent_id=? AND revoked_at IS NULL').get(agent_id)) throw new AccessError('UNKNOWN_AGENT', 'agent not registered')
  if (!expires_at || Date.parse(expires_at) <= Date.parse(iso(now))) throw new AccessError('BAD_REQUEST', 'expires_at in the future required')
  const r = db.prepare('INSERT INTO agent_grants (agent_id, project, action, approval_id, issued_by, issued_at, expires_at) VALUES (?,?,?,?,?,?,?)')
    .run(agent_id, project, action, approval_id ?? null, by, iso(now), iso(expires_at))
  log(db, { now, actor: by, action: 'grant', target: `${agent_id}:${project}:${action}`, outcome: 'allow' })
  return Number(r.lastInsertRowid)
}

export function revokeGrant(db, id, { by, now }) {
  need(by, 'by')
  db.prepare('UPDATE agent_grants SET revoked_at=?, revoked_by=? WHERE id=? AND revoked_at IS NULL').run(iso(now), by, id)
  log(db, { now, actor: by, action: 'revoke_grant', target: String(id), outcome: 'allow' })
}

function liveGrant(db, agent_id, project, action, nowMs) {
  const g = db.prepare('SELECT * FROM agent_grants WHERE agent_id=? AND project=? AND action=? AND revoked_at IS NULL ORDER BY id DESC').all(agent_id, project, action)
  return g.find((x) => Date.parse(x.expires_at) > nowMs) ?? null
}

/** Mint a bounded token for an agent. scopes: [{project, action}] each backed by a live grant. */
export function issueToken(db, { agent_id, scopes, ttlMs = MAX_TOKEN_MS, by, now }) {
  need(by, 'by')
  const t = Date.parse(iso(now))
  const ag = db.prepare('SELECT * FROM agent_identities WHERE agent_id=? AND revoked_at IS NULL').get(agent_id)
  if (!ag) throw new AccessError('UNKNOWN_AGENT', 'agent not registered')
  if (!Array.isArray(scopes) || !scopes.length) throw new AccessError('BAD_REQUEST', 'scopes required')
  for (const s of scopes) if (!liveGrant(db, agent_id, s.project, s.action, t)) throw new AccessError('NO_GRANT', `no live grant for ${s.project}:${s.action}`)
  const ttl = Math.min(ttlMs, MAX_TOKEN_MS)
  const token = `pmat_${randomBytes(24).toString('hex')}`
  db.prepare('INSERT INTO agent_tokens (token_hash, agent_id, scopes, issued_by, issued_at, expires_at) VALUES (?,?,?,?,?,?)')
    .run(hash(token), agent_id, JSON.stringify(scopes.map((s) => ({ project: s.project, action: s.action }))), by, iso(now), new Date(t + ttl).toISOString())
  log(db, { now, actor: by, seat: ag.seat, machine: ag.machine, action: 'issue_token', target: agent_id, outcome: 'allow' })
  return { token, expires_at: new Date(t + ttl).toISOString() }
}

export function revokeToken(db, token, { by, now }) {
  need(by, 'by')
  db.prepare('UPDATE agent_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(iso(now), hash(token))
  log(db, { now, actor: by, action: 'revoke_token', outcome: 'allow' })
}

/**
 * The single gate for REST, MCP and bridge entry points.
 * req = { entry, token, proof, action, project, target }
 * ctx = { now, verifyDshProof(proof)->{agent_id, machine}|null, ownerCeiling: bool (default true) }
 * Returns { allow, actor, reason }. Never throws for a denial and never echoes the token.
 */
export function authorize(db, req, ctx = {}) {
  const nowMs = Date.parse(iso(ctx.now))
  const { entry, token, proof, action, project, target } = req
  let ag = null
  const deny = (reason) => {
    log(db, { now: ctx.now, actor: ag?.agent_id ?? 'unauthenticated', seat: ag?.seat, machine: ag?.machine, entry, action: action ?? '?', target: target ?? project, outcome: 'deny', reason })
    return { allow: false, actor: ag?.agent_id ?? null, reason }
  }
  if (!ENTRY_POINTS.includes(entry)) return deny('unknown entry point')
  if (!ACTIONS.includes(action)) return deny('action is not a governed PM action')
  if (!project || project.includes('*')) return deny('exact project required')
  if (!token) return deny('credential required')
  const tk = db.prepare('SELECT * FROM agent_tokens WHERE token_hash=?').get(hash(token))
  if (!tk) return deny('credential not recognised')
  ag = db.prepare('SELECT * FROM agent_identities WHERE agent_id=?').get(tk.agent_id)
  if (tk.revoked_at) return deny('credential revoked')
  if (Date.parse(tk.expires_at) <= nowMs) return deny('credential expired')
  if (!ag || ag.revoked_at) return deny('agent identity revoked')
  // identity must be proven through DSH, and match the token's agent and the registered machine
  const p = ctx.verifyDshProof?.(proof)
  if (!p || p.agent_id !== ag.agent_id) return deny('DSH identity proof missing or mismatched')
  if (p.machine !== ag.machine) return deny('request came from a different machine than the registered seat')
  const scoped = JSON.parse(tk.scopes).some((s) => s.project === project && s.action === action)
  if (!scoped) return deny('outside token scope')
  const g = liveGrant(db, ag.agent_id, project, action, nowMs)
  if (!g) return deny('no live grant for this action')
  if (SENSITIVE.has(action) && !g.approval_id) return deny('approval gate not satisfied')
  if (ctx.ownerCeiling !== false) {
    try { assertAllowed(db, ag.human_owner, CEILING[action], { project }) } catch { return deny('human owner role does not allow this action') }
  }
  log(db, { now: ctx.now, actor: ag.agent_id, seat: ag.seat, machine: ag.machine, entry, action, target: target ?? project, outcome: 'allow' })
  return { allow: true, actor: ag.agent_id, on_behalf_of: ag.human_owner, grant_id: g.id }
}

/** Permission matrix for docs/UI: live grants per project and action. */
export function permissionMatrix(db, agent_id, now) {
  const t = Date.parse(iso(now))
  const rows = db.prepare('SELECT * FROM agent_grants WHERE agent_id=? AND revoked_at IS NULL').all(agent_id).filter((g) => Date.parse(g.expires_at) > t)
  const m = {}
  for (const g of rows) (m[g.project] ??= []).push(g.action)
  for (const k of Object.keys(m)) m[k] = [...new Set(m[k])].sort()
  return m
}

export function auditLog(db, { agent_id, outcome } = {}) {
  let sql = 'SELECT * FROM access_audit WHERE 1=1'; const a = []
  if (agent_id) { sql += ' AND actor=?'; a.push(agent_id) }
  if (outcome) { sql += ' AND outcome=?'; a.push(outcome) }
  return db.prepare(sql + ' ORDER BY id').all(...a).map((r) => ({ ...r }))
}
