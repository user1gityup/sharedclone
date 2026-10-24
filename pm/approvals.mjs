// C2 approval records (ws-2a). node built-ins only; db is a node:sqlite DatabaseSync.
// A bridge token or browser cookie is never proof of consent: a relayed decision
// (proof.relayed / proof.via) stays 'pending_user_confirm' until a human confirms it
// through otp, pm_ui, interactive or link.
import { randomUUID, randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto'

export const APPROVAL_KINDS = ['grant', 'permission_resume', 'elevation', 'handoff_write', 'task_scope', 'task_merge']
export const APPROVAL_STATUSES = ['pending', 'pending_user_confirm', 'approved', 'rejected', 'expired', 'revoked']
export const APPROVAL_METHODS = ['otp', 'pm_ui', 'interactive', 'link']
export const CHALLENGE_METHODS = ['otp', 'link']
export const DEFAULT_CHALLENGE_TTL = 600
export const MAX_CHALLENGE_TTL = 3600

// BLITZ-03 (Q1): per-task approvals. One record binds one pm task, at a task_rev and a
// server-computed scope_hash, to a repo/branch/files scope, permissions, base version
// and a merge limit. A merge limit never reaches a push: pushes go through the gatekeeper.
export const TASK_KINDS = ['task_scope', 'task_merge']
export const MERGE_LIMITS = ['none', 'local_commit', 'queue_gatekeeper']
const DAY = 86400
export const DEFAULT_VALID_SECONDS = { task_scope: 7 * DAY, task_merge: 2 * DAY }
export const MAX_TASK_VALID_SECONDS = 30 * DAY
const OPEN_ALL = new Set(['*', '**', '**/*', '/**', './**'])

export class ApprovalError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const fail = (code, msg) => { throw new ApprovalError(code, msg) }
const iso = (d) => (d instanceof Date ? d : new Date(d ?? Date.now())).toISOString()
const sha = (s) => createHash('sha256').update(String(s)).digest()

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, scope TEXT NOT NULL,
    requested_by TEXT NOT NULL, requested_at TEXT NOT NULL,
    run_id TEXT, session_id TEXT, status TEXT NOT NULL,
    approver TEXT, method TEXT, decided_at TEXT, valid_until TEXT,
    relayed_decision TEXT, audit TEXT NOT NULL DEFAULT '[]')`)
  db.exec(`CREATE TABLE IF NOT EXISTS approval_challenges (
    id TEXT PRIMARY KEY, approval_id TEXT NOT NULL, method TEXT NOT NULL,
    secret_hash BLOB NOT NULL, approver TEXT, issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, used_at TEXT)`)
  db.exec('CREATE INDEX IF NOT EXISTS approval_challenges_by_approval ON approval_challenges(approval_id)')
}

function row2approval(r) {
  if (!r) return null
  const a = {
    id: r.id, kind: r.kind, scope: JSON.parse(r.scope),
    requested_by: r.requested_by, requested_at: r.requested_at,
    status: r.status, audit: JSON.parse(r.audit),
  }
  for (const k of ['run_id', 'session_id', 'approver', 'method', 'decided_at', 'valid_until']) if (r[k] != null) a[k] = r[k]
  if (r.relayed_decision) a.relayed_decision = JSON.parse(r.relayed_decision)
  return a
}

export function getApproval(db, id) {
  return row2approval(db.prepare('SELECT * FROM approvals WHERE id = ?').get(id))
}

/** Approvals newest first, optionally filtered by status, kind or run_id. */
export function listApprovals(db, { status, kind, run_id, limit = 200 } = {}) {
  const where = [], args = []
  for (const [k, v] of [['status', status], ['kind', kind], ['run_id', run_id]]) if (v != null && v !== '') { where.push(`${k} = ?`); args.push(String(v)) }
  const n = Math.min(Math.max(Number(limit) || 200, 1), 1000)
  return db.prepare(`SELECT * FROM approvals${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY requested_at DESC LIMIT ${n}`)
    .all(...args).map(row2approval)
}

function save(db, a, relayed) {
  db.prepare(`UPDATE approvals SET status=?, approver=?, method=?, decided_at=?, valid_until=?,
    relayed_decision=?, audit=? WHERE id=?`).run(
    a.status, a.approver ?? null, a.method ?? null, a.decided_at ?? null, a.valid_until ?? null,
    relayed === undefined ? (a.relayed_decision ? JSON.stringify(a.relayed_decision) : null) : relayed,
    JSON.stringify(a.audit), a.id)
}

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''

/** Throws BAD_REQUEST unless scope is a well-formed task_scope/task_merge scope. */
export function validateTaskScope(scope) {
  if (!nonEmpty(scope.task_id)) fail('BAD_REQUEST', 'scope.task_id required')
  if (!Number.isInteger(scope.task_rev) || scope.task_rev < 1) fail('BAD_REQUEST', 'scope.task_rev must be a positive integer')
  if (typeof scope.scope_hash !== 'string' || !/^[0-9a-f]{64}$/.test(scope.scope_hash)) fail('BAD_REQUEST', 'scope.scope_hash must be a sha256 hex digest')
  const s = scope.scope
  if (!s || typeof s !== 'object' || Array.isArray(s)) fail('BAD_REQUEST', 'scope.scope must be an object {repo, branch, files, summary}')
  if (!nonEmpty(s.repo)) fail('BAD_REQUEST', 'scope.scope.repo required')
  if (!nonEmpty(s.branch)) fail('BAD_REQUEST', 'scope.scope.branch required')
  if (!Array.isArray(s.files) || !s.files.length || !s.files.every(nonEmpty)) fail('BAD_REQUEST', 'scope.scope.files must be a non-empty list of paths or globs')
  if (s.files.some((f) => OPEN_ALL.has(f.trim()))) fail('BAD_REQUEST', 'scope.scope.files may not open every file')
  if (!Array.isArray(scope.permissions) || !scope.permissions.every(nonEmpty)) fail('BAD_REQUEST', 'scope.permissions must be a list of strings')
  if (!nonEmpty(scope.version)) fail('BAD_REQUEST', 'scope.version (base commit) required')
  if (!MERGE_LIMITS.includes(scope.merge_limit)) fail('BAD_REQUEST', `scope.merge_limit must be one of ${MERGE_LIMITS.join(', ')}; a push is never approvable here`)
  if (scope.supersedes != null && !nonEmpty(scope.supersedes)) fail('BAD_REQUEST', 'scope.supersedes must be an approval id')
}

/** Task approvals of one kind for a task, newest first. */
export function taskApprovals(db, taskId, kind) {
  return db.prepare("SELECT * FROM approvals WHERE kind = ? AND json_extract(scope, '$.task_id') = ? ORDER BY requested_at DESC, rowid DESC")
    .all(kind, String(taskId)).map(row2approval)
}

/** Opens a request; status 'pending'. */
export function requestApproval(db, req = {}) {
  const { kind, scope, requested_by, run_id, session_id } = req
  if (!APPROVAL_KINDS.includes(kind)) fail('BAD_REQUEST', `kind must be one of ${APPROVAL_KINDS.join(', ')}`)
  if (!scope || typeof scope !== 'object' || !scope.project) fail('BAD_REQUEST', 'scope.project required')
  if (scope.project === '*') fail('BAD_REQUEST', "scope.project '*' is not allowed")
  if (!requested_by || typeof requested_by !== 'string') fail('BAD_REQUEST', 'requested_by required')
  if (TASK_KINDS.includes(kind)) {
    validateTaskScope(scope)
    if (scope.supersedes) {
      const old = getApproval(db, scope.supersedes)
      if (!old || old.kind !== kind || old.scope.task_id !== scope.task_id) fail('BAD_REQUEST', 'supersedes must name an approval of the same kind for the same task')
    }
    if (kind === 'task_merge' && !taskApprovals(db, scope.task_id, 'task_scope').some((a) => isApprovalValid(db, a.id, req.now)))
      fail('CONFLICT', `task_merge needs an approved, valid task_scope for ${scope.task_id}`)
  }
  const at = iso(req.now)
  const id = randomUUID()
  const audit = [{ at, actor: requested_by, action: 'requested', detail: kind }]
  db.prepare(`INSERT INTO approvals (id, kind, scope, requested_by, requested_at, run_id, session_id, status, audit)
    VALUES (?,?,?,?,?,?,?, 'pending', ?)`).run(id, kind, JSON.stringify(scope), requested_by, at,
    run_id ?? null, session_id ?? null, JSON.stringify(audit))
  return getApproval(db, id)
}

/** Short-lived challenge for 'otp' or 'link'; single use, default TTL 10 min.
 *  Returns the secret once (code for otp, token for link); only its hash is stored. */
export function issueChallenge(db, approvalId, { method, ttlSeconds = DEFAULT_CHALLENGE_TTL, approver, now } = {}) {
  if (!CHALLENGE_METHODS.includes(method)) fail('BAD_REQUEST', 'challenge method must be otp or link')
  const a = getApproval(db, approvalId)
  if (!a) fail('NOT_FOUND', 'approval not found')
  if (!['pending', 'pending_user_confirm'].includes(a.status)) fail('CONFLICT', `approval is ${a.status}`)
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_CHALLENGE_TTL) fail('BAD_REQUEST', 'bad ttlSeconds')
  const issued = new Date(iso(now))
  const secret = method === 'otp' ? String(randomInt(0, 1e6)).padStart(6, '0') : randomBytes(32).toString('base64url')
  const id = randomUUID()
  const expires_at = new Date(issued.getTime() + ttlSeconds * 1000).toISOString()
  db.prepare(`INSERT INTO approval_challenges (id, approval_id, method, secret_hash, approver, issued_at, expires_at)
    VALUES (?,?,?,?,?,?,?)`).run(id, approvalId, method, sha(secret), approver ?? null, issued.toISOString(), expires_at)
  a.audit.push({ at: issued.toISOString(), actor: approver ?? 'pm', action: 'challenge_issued', detail: `${method} ${id}` })
  save(db, a)
  return { id, approval_id: approvalId, method, expires_at, ...(method === 'otp' ? { code: secret } : { token: secret }) }
}

function consumeChallenge(db, a, { approver, method, proof, at }) {
  const cid = proof?.challenge_id
  const secret = method === 'otp' ? proof?.code : proof?.token
  if (!cid || !secret) fail('INVALID_PROOF', `${method} needs proof.challenge_id and proof.${method === 'otp' ? 'code' : 'token'}`)
  const c = db.prepare('SELECT * FROM approval_challenges WHERE id = ?').get(cid)
  if (!c || c.approval_id !== a.id || c.method !== method) fail('INVALID_PROOF', 'challenge does not match')
  if (c.used_at) fail('REPLAY', 'challenge already used')
  if (at >= c.expires_at) fail('EXPIRED', 'challenge expired')
  if (c.approver && c.approver !== approver) fail('IDENTITY_MISMATCH', 'challenge bound to another approver')
  const want = Buffer.from(c.secret_hash), got = sha(secret)
  if (want.length !== got.length || !timingSafeEqual(want, got)) fail('INVALID_PROOF', 'wrong secret')
  const r = db.prepare('UPDATE approval_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').run(at, cid)
  if (r.changes !== 1) fail('REPLAY', 'challenge already used')
}

/** method: 'otp'|'pm_ui'|'interactive'|'link'. Validates identity binding, expiry, single use.
 *  Optional opts.authorize(approver, approval, method) => boolean gates approval power (roles.mjs at integration).
 *  proof.relayed === true (or proof.via set, e.g. 'chatgpt'/'bridge') => recorded, status pending_user_confirm. */
export function decideApproval(db, id, { approver, method, proof, decision, now, validSeconds, authorize } = {}) {
  if (!approver || typeof approver !== 'string') fail('BAD_REQUEST', 'approver required')
  if (!['approved', 'rejected'].includes(decision)) fail('BAD_REQUEST', 'decision must be approved or rejected')
  const a = getApproval(db, id)
  if (!a) fail('NOT_FOUND', 'approval not found')
  const at = iso(now)
  const relayed = proof?.relayed === true || (proof?.via != null && proof.via !== '')
  if (!['pending', 'pending_user_confirm'].includes(a.status)) fail('CONFLICT', `approval is ${a.status}`)
  if (authorize && !authorize(approver, a, method)) fail('FORBIDDEN', `${approver} may not approve this scope`)

  if (relayed) {
    if (a.status === 'pending_user_confirm') fail('CONFLICT', 'relayed decision already awaiting confirmation')
    a.status = 'pending_user_confirm'
    a.relayed_decision = { decision, approver, via: proof.via ?? 'relay', at }
    a.audit.push({ at, actor: approver, action: 'relayed_decision', detail: `${decision} via ${proof.via ?? 'relay'}` })
    save(db, a)
    return getApproval(db, id)
  }

  if (!APPROVAL_METHODS.includes(method)) fail('BAD_REQUEST', `method must be one of ${APPROVAL_METHODS.join(', ')}`)
  if (a.status === 'pending_user_confirm' && a.relayed_decision.approver !== approver)
    fail('IDENTITY_MISMATCH', 'confirmation must come from the relayed approver')
  if (CHALLENGE_METHODS.includes(method)) consumeChallenge(db, a, { approver, method, proof, at })
  else if (!proof || proof.approver !== approver) fail('INVALID_PROOF', `${method} proof must carry the authenticated approver`)

  const confirmed = a.status === 'pending_user_confirm'
  a.status = decision
  a.approver = approver
  a.method = method
  a.decided_at = at
  let valid = validSeconds ?? DEFAULT_VALID_SECONDS[a.kind] ?? 30 * DAY
  if (TASK_KINDS.includes(a.kind)) valid = Math.min(Math.max(Number(valid) || DEFAULT_VALID_SECONDS[a.kind], 1), MAX_TASK_VALID_SECONDS)
  if (decision === 'approved') a.valid_until = new Date(Date.parse(at) + valid * 1000).toISOString()
  a.audit.push({ at, actor: approver, action: confirmed ? `confirmed_${decision}` : decision, detail: method })
  save(db, a, null)
  // a renewal replaces what it supersedes the moment it is approved
  if (decision === 'approved' && TASK_KINDS.includes(a.kind) && a.scope.supersedes) {
    const old = getApproval(db, a.scope.supersedes)
    if (old && old.status !== 'revoked') revokeApproval(db, old.id, { actor: approver, reason: `superseded by ${id}`, now: at })
  }
  return getApproval(db, id)
}

/** Withdraws an approval that is not already closed. Callers check who may revoke. */
export function revokeApproval(db, id, { actor, reason = '', now } = {}) {
  if (!nonEmpty(actor)) fail('BAD_REQUEST', 'actor required')
  const a = getApproval(db, id)
  if (!a) fail('NOT_FOUND', 'approval not found')
  if (!['pending', 'pending_user_confirm', 'approved'].includes(a.status)) fail('CONFLICT', `approval is ${a.status}`)
  const at = iso(now)
  a.status = 'revoked'
  a.audit.push({ at, actor, action: 'revoked', detail: String(reason) })
  save(db, a)
  return getApproval(db, id)
}

/** Approved and still inside valid_until? Marks it 'expired' when lapsed. */
export function isApprovalValid(db, id, now) {
  const a = getApproval(db, id)
  if (!a || a.status !== 'approved') return false
  const at = iso(now)
  if (a.valid_until && at >= a.valid_until) {
    a.status = 'expired'
    a.audit.push({ at, actor: 'pm', action: 'expired', detail: '' })
    save(db, a)
    return false
  }
  return true
}
