// grants.mjs - C1 grant records (ws-2a). node:sqlite DatabaseSync handle in, plain objects out.
// Fail-closed: anything unknown, expired, revoked or unreplicated resolves to null.
import { randomUUID } from 'node:crypto'

export const ROLES = ['admin', 'manager', 'worker', 'client']
export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

export class GrantError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS grants (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    project TEXT NOT NULL,
    role TEXT NOT NULL,
    agent TEXT NOT NULL,
    host TEXT NOT NULL,
    tools TEXT NOT NULL,
    deny TEXT NOT NULL,
    issuer TEXT NOT NULL,
    approval_id TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoked_by TEXT,
    revoke_reason TEXT,
    replicated_to TEXT NOT NULL DEFAULT '[]',
    UNIQUE (project, role, agent, host, version)
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS grants_key ON grants(project, role, agent, host, version)')
}

const str = (v) => typeof v === 'string' && v.trim() !== ''
const strArr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
const iso = (v) => (v instanceof Date ? v : new Date(v ?? Date.now())).toISOString()

function row2grant(r) {
  if (!r) return null
  return {
    ...r,
    tools: JSON.parse(r.tools),
    deny: JSON.parse(r.deny),
    replicated_to: JSON.parse(r.replicated_to),
  }
}

/** @returns Grant */
export function issueGrant(db, g = {}) {
  for (const k of ['project', 'role', 'agent', 'host', 'issuer', 'approval_id']) {
    if (!str(g[k])) throw new GrantError(`grant.${k} required`)
  }
  if (g.project.includes('*')) throw new GrantError("grant.project must be an exact name; '*' is not allowed")
  if (!ROLES.includes(g.role)) throw new GrantError(`grant.role must be one of ${ROLES.join('|')}`)
  const tools = g.tools ?? []
  const deny = g.deny ?? []
  if (!strArr(tools)) throw new GrantError('grant.tools must be string[]')
  if (!strArr(deny)) throw new GrantError('grant.deny must be string[]')
  const replicated = g.replicated_to ?? []
  if (!strArr(replicated)) throw new GrantError('grant.replicated_to must be string[]')
  const issued_at = iso(g.issued_at)
  const expires_at = g.expires_at ? iso(g.expires_at) : new Date(Date.parse(issued_at) + DEFAULT_TTL_MS).toISOString()
  if (Date.parse(expires_at) <= Date.parse(issued_at)) throw new GrantError('grant.expires_at must be after issued_at')
  const prev = db.prepare('SELECT MAX(version) AS v FROM grants WHERE project=? AND role=? AND agent=? AND host=?')
    .get(g.project, g.role, g.agent, g.host)
  const version = (prev?.v ?? 0) + 1
  const id = randomUUID()
  db.prepare(`INSERT INTO grants (id, version, project, role, agent, host, tools, deny, issuer, approval_id,
    issued_at, expires_at, revoked_at, revoked_by, revoke_reason, replicated_to)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?)`)
    .run(id, version, g.project, g.role, g.agent, g.host, JSON.stringify(tools), JSON.stringify(deny),
      g.issuer, g.approval_id, issued_at, expires_at, JSON.stringify([...new Set(replicated)]))
  return getGrant(db, id)
}

export function getGrant(db, id) {
  return row2grant(db.prepare('SELECT * FROM grants WHERE id=?').get(id))
}

export function revokeGrant(db, id, { by, reason, now } = {}) {
  if (!str(by)) throw new GrantError('revokeGrant: by required')
  const g = getGrant(db, id)
  if (!g) throw new GrantError(`grant ${id} not found`, 404)
  if (g.revoked_at) return g
  db.prepare('UPDATE grants SET revoked_at=?, revoked_by=?, revoke_reason=? WHERE id=?')
    .run(iso(now), by, reason ?? null, id)
  return getGrant(db, id)
}

/** Record that a peer confirmed it holds this grant (E13). */
export function confirmReplication(db, id, peer) {
  if (!str(peer)) throw new GrantError('confirmReplication: peer required')
  const g = getGrant(db, id)
  if (!g) throw new GrantError(`grant ${id} not found`, 404)
  if (!g.replicated_to.includes(peer)) {
    db.prepare('UPDATE grants SET replicated_to=? WHERE id=?').run(JSON.stringify([...g.replicated_to, peer]), id)
  }
  return getGrant(db, id)
}

/**
 * Effective grant for a run, or null. Fail-closed: unknown/expired/revoked/unreplicated -> null.
 * Only the newest version for the key is considered; a revoked or expired newest version does
 * not fall back to an older one. `peers` lists peers that must have confirmed replication.
 */
export function resolveGrant(db, { project, role, agent, host, now, peers = [] } = {}) {
  try {
    if (![project, role, agent, host].every(str) || project.includes('*')) return null
    if (!ROLES.includes(role) || !strArr(peers)) return null
    const g = row2grant(db.prepare(
      'SELECT * FROM grants WHERE project=? AND role=? AND agent=? AND host=? ORDER BY version DESC LIMIT 1',
    ).get(project, role, agent, host))
    if (!g) return null
    const t = Date.parse(iso(now))
    if (Number.isNaN(t)) return null
    if (g.revoked_at) return null
    if (!(Date.parse(g.expires_at) > t) || Date.parse(g.issued_at) > t) return null
    if (!peers.every((p) => g.replicated_to.includes(p))) return null
    return g
  } catch {
    return null
  }
}

export function listGrants(db, filter = {}) {
  const where = []
  const args = []
  for (const k of ['project', 'role', 'agent', 'host', 'issuer', 'approval_id']) {
    if (filter[k] != null) { where.push(`${k}=?`); args.push(filter[k]) }
  }
  if (filter.active) {
    where.push('revoked_at IS NULL', 'expires_at > ?')
    args.push(iso(filter.now))
  }
  const sql = `SELECT * FROM grants${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY project, role, agent, host, version`
  return db.prepare(sql).all(...args).map(row2grant)
}
