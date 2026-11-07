// record-gates.mjs - administrator-configurable permission gates for pm record types
// (website blitz L6a; T-d9cf422d, and the external half of T-d0ab1b37).
//
// A gate is one admin-written row: for this record type, this subject (a role, an agent or a
// named identity), this project and this action -> allow | deny | approval.
//
// Two rules are not negotiable and are enforced here, not by convention:
//   1. INTERNAL work that has been granted runs WITHOUT a repeat approval. Read, dedupe
//      suggestions, tagging, note drafting and link proposals never re-prompt once allowed.
//   2. EXTERNAL actions - outbound message, export out of pm, bulk delete, sharing with a
//      third party - ALWAYS need a human approval through pm approvals (approvals.mjs).
//      setGate refuses to write an 'allow' for one, and checkAccess never returns allow for one.
//   3. One approval authorizes one action, as approved. It is bound to the requester, the
//      project, the record type, the action, the exact record ids and the destination, and it
//      is SPENT the first time it is used (record_approval_uses). An approved export cannot be
//      replayed, pointed at another destination, or handed to another identity.
//
// A gate names exactly one record_type, so a gate on Opportunities is invisible to Contacts.
import * as approvals from './approvals.mjs'
import { RecordError, recordFail, accessAllows, appendAudit, assertActor, requireRecordType } from './records.mjs'

/** Actions an authorized internal agent may run repeatedly once granted. */
export const INTERNAL_ACTIONS = Object.freeze(['read', 'create', 'update', 'status', 'note', 'tag', 'link', 'dedupe_suggest'])
/** Actions that leave pm or are irreversible: a human approves each one, every time. */
export const EXTERNAL_ACTIONS = Object.freeze(['outbound_message', 'export', 'bulk_delete', 'share_third_party'])
export const GATE_MODES = Object.freeze(['allow', 'deny', 'approval'])
export const SUBJECT_KINDS = Object.freeze(['role', 'agent', 'identity'])
/** Actions a record's own owner may always take on it (an explicit deny gate still wins). */
export const OWNER_ACTIONS = Object.freeze(['read', 'update', 'status', 'note', 'tag', 'link', 'dedupe_suggest'])
/** Project a record approval is filed under when the record carries none. Never '*'. */
export const UNSCOPED_RECORD_PROJECT = 'records'
/** pm approval kind used for a record action. */
export const RECORD_APPROVAL_KIND = 'elevation'

const iso = (v) => (v instanceof Date ? v : new Date(v ?? Date.now())).toISOString()
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''

export const isExternalAction = (action) => EXTERNAL_ACTIONS.includes(action)

/** Normalized destination a record approval is bound to ('' when the action has none). */
export const destinationOf = (d) => String(d ?? '').trim()

export function migrateGates(db) {
  // One human approval buys one external action. This table is what spends it: the primary key
  // is the approval id, so a second attempt to use the same approval inserts nothing and the
  // replay is refused - with other ids, another destination, or simply the same call again.
  db.exec(`CREATE TABLE IF NOT EXISTS record_approval_uses (
    approval_id TEXT PRIMARY KEY, record_type TEXT NOT NULL, action TEXT NOT NULL,
    actor TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL DEFAULT '',
    record_ids TEXT NOT NULL DEFAULT '[]', used_at TEXT NOT NULL)`)
  db.exec(`CREATE TABLE IF NOT EXISTS record_gates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_type TEXT NOT NULL, subject_kind TEXT NOT NULL, subject TEXT NOT NULL,
    project TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, mode TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    configured_by TEXT NOT NULL, configured_at TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT)`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS record_gates_key ON record_gates(record_type, subject_kind, subject, project, action) WHERE revoked_at IS NULL')
  db.exec('CREATE INDEX IF NOT EXISTS record_gates_lookup ON record_gates(record_type, action)')
  return { table: 'record_gates' }
}

function rowToGate(r) {
  return r ? { ...r } : null
}

/**
 * Write (or replace) one gate. Admin-only at the route layer.
 * project '' means every project; action '*' means every action of that type.
 */
export function setGate(db, { record_type, subject_kind, subject, project = '', action, mode, note = '', by, now } = {}) {
  const def = requireRecordType(record_type)
  if (!SUBJECT_KINDS.includes(subject_kind)) recordFail('BAD_REQUEST', `subject_kind must be one of ${SUBJECT_KINDS.join(', ')}`)
  if (!nonEmpty(subject)) recordFail('BAD_REQUEST', 'subject required')
  if (!nonEmpty(by)) recordFail('BAD_REQUEST', 'by (the administrator) required')
  if (project === '*') recordFail('BAD_REQUEST', "project '*' is not allowed; use '' for every project")
  if (action !== '*' && !def.actions.includes(action)) recordFail('BAD_REQUEST', `${def.type} has no action ${action}`)
  if (!GATE_MODES.includes(mode)) recordFail('BAD_REQUEST', `mode must be one of ${GATE_MODES.join(', ')}`)
  if (mode === 'allow' && (action === '*' || isExternalAction(action))) {
    recordFail('FORBIDDEN', action === '*'
      ? "a '*' gate cannot be 'allow': external actions always need a human approval, so grant actions one by one"
      : `${action} leaves pm: it always needs a human approval and can never be gated to 'allow'`)
  }
  const at = iso(now)
  db.prepare(`UPDATE record_gates SET revoked_at = ?, revoked_by = ? WHERE revoked_at IS NULL
    AND record_type = ? AND subject_kind = ? AND subject = ? AND project = ? AND action = ?`)
    .run(at, String(by), def.type, subject_kind, String(subject), String(project), String(action))
  db.prepare(`INSERT INTO record_gates (record_type, subject_kind, subject, project, action, mode, note, configured_by, configured_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(def.type, subject_kind, String(subject), String(project), String(action), mode, String(note ?? ''), String(by), at)
  const gate = rowToGate(db.prepare('SELECT * FROM record_gates WHERE rowid = last_insert_rowid()').get())
  appendAudit(db, def, { record_id: '-', action: 'acl_grant', actor: by, now: at, after: { gate } , detail: { kind: 'gate' } })
  return gate
}

export function revokeGate(db, id, { by, now } = {}) {
  if (!nonEmpty(by)) recordFail('BAD_REQUEST', 'by required')
  const g = rowToGate(db.prepare('SELECT * FROM record_gates WHERE id = ?').get(Number(id)))
  if (!g) recordFail('NOT_FOUND', `no gate ${id}`)
  if (g.revoked_at) return g
  const at = iso(now)
  db.prepare('UPDATE record_gates SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(at, String(by), Number(id))
  appendAudit(db, requireRecordType(g.record_type), { record_id: '-', action: 'acl_revoke', actor: by, now: at, before: { gate: g }, detail: { kind: 'gate' } })
  return rowToGate(db.prepare('SELECT * FROM record_gates WHERE id = ?').get(Number(id)))
}

export function listGates(db, { record_type, subject, action, includeRevoked = false } = {}) {
  const where = []
  const args = []
  for (const [col, v] of [['record_type', record_type], ['subject', subject], ['action', action]]) {
    if (nonEmpty(v)) { where.push(`${col} = ?`); args.push(v) }
  }
  if (!includeRevoked) where.push('revoked_at IS NULL')
  return db.prepare(`SELECT * FROM record_gates${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY record_type, subject, action, id`)
    .all(...args).map(rowToGate)
}

/** How specific a gate row is; the most specific match wins, newest breaks a tie. */
function score(g) {
  const kind = { identity: 3, agent: 2, role: 1 }[g.subject_kind] ?? 0
  return kind * 100 + (g.project ? 20 : 10) + (g.action === '*' ? 1 : 2)
}

/** The gate that governs this request, or null. */
export function matchGate(db, { record_type, action, role, agent, identity, project = '' } = {}) {
  const subjects = [['identity', identity], ['agent', agent], ['role', role]].filter(([, v]) => nonEmpty(v))
  if (!subjects.length) return null
  const rows = db.prepare(`SELECT * FROM record_gates WHERE revoked_at IS NULL AND record_type = ?
      AND (action = ? OR action = '*') AND (project = '' OR project = ?)`)
    .all(String(record_type), String(action), String(project)).map(rowToGate)
  let best = null
  for (const g of rows) {
    const match = subjects.some(([kind, v]) => g.subject_kind === kind && g.subject === v)
    if (!match) continue
    if (!best || score(g) > score(best) || (score(g) === score(best) && g.id > best.id)) best = g
  }
  return best
}

/**
 * The effective decision for one request: 'allow' | 'deny' | 'approval'.
 *
 * An explicit deny gate wins over everything. Otherwise the request first has to be
 * permitted at all - by an allow gate, by this type's own ACL, by owning the record, or by
 * being an administrator. Permission alone finishes an INTERNAL action (no approval, ever
 * again, for as long as the grant stands). An EXTERNAL action that is permitted still comes
 * back as 'approval': a human decides it in pm approvals, every single time.
 * Nothing permitted -> deny, so an unauthorized caller cannot even queue an approval.
 */
export function checkAccess(db, def, { action, actor, role = null, agent = null, project = '', record = null } = {}) {
  if (!def.actions.includes(action)) recordFail('BAD_REQUEST', `${def.type} has no action ${action}`)
  const gate = matchGate(db, { record_type: def.type, action, role, agent, identity: actor, project })
  if (gate?.mode === 'deny') return { decision: 'deny', source: 'gate', gate, reason: `a gate denies ${action} on ${def.type}` }

  let base = null
  if (gate?.mode === 'allow') base = { source: 'gate', reason: `a gate allows ${action}` }
  else if (accessAllows(db, def, actor, action, project)) base = { source: 'acl', reason: `the ${def.type} ACL allows ${actor} to ${action}` }
  else if (record && record.owner && record.owner === actor && OWNER_ACTIONS.includes(action)) base = { source: 'owner', reason: `${actor} owns ${record.id}` }
  else if (role === 'admin') base = { source: 'role:admin', reason: `${actor} is an administrator` }

  if (isExternalAction(action)) {
    if (!base && gate?.mode !== 'approval') {
      return { decision: 'deny', source: 'default', gate: gate ?? null, external: true,
        reason: `nothing grants ${actor} ${action} on ${def.type}${project ? ` in ${project}` : ''}` }
    }
    return { decision: 'approval', source: gate?.mode === 'approval' ? 'gate' : (base?.source ?? 'policy'), gate: gate ?? null, external: true,
      reason: `${action} leaves pm: a human approves it in pm approvals, every time` }
  }
  if (gate?.mode === 'approval') return { decision: 'approval', source: 'gate', gate, external: false, reason: `a gate sends ${action} to approval` }
  if (base) return { decision: 'allow', source: base.source, gate: base.source === 'gate' ? gate : null, external: false, reason: base.reason }
  return { decision: 'deny', source: 'default', gate: null, external: false, reason: `nothing grants ${actor} ${action} on ${def.type}${project ? ` in ${project}` : ''}` }
}

const approvalProject = (project) => (nonEmpty(project) && project !== '*' ? project : UNSCOPED_RECORD_PROJECT)

/**
 * Open a pm approval for one external record action. The human decides it in the pm UI.
 * The scope is what the approval is bound to: requester, project, type, action, the exact
 * record ids and the destination. Change any of them and the approval no longer applies.
 */
export function requestRecordApproval(approvalsDb, def, { action, actor, project = '', record_ids = [], destination = '', detail = {}, now } = {}) {
  if (!approvalsDb) recordFail('CONFLICT', 'pm approvals are not available here, so an external record action cannot be approved')
  approvals.migrate(approvalsDb)
  return approvals.requestApproval(approvalsDb, {
    kind: RECORD_APPROVAL_KIND,
    requested_by: actor,
    scope: {
      project: approvalProject(project),
      record_type: def.type,
      record_action: action,
      record_ids: [...record_ids].map(String),
      record_destination: destinationOf(destination),
      detail,
    },
    now,
  })
}

/**
 * Is `approvalId` a human approval for exactly this external action - this type, this action,
 * this requester, this project, these ids and this destination?
 *
 * Everything the human saw is part of the binding, so an approved export cannot be replayed
 * against another destination, by another identity, in another project or over other records.
 * Pass actor: null only where there is no requester to bind (an admin UI preview).
 */
export function recordApprovalValid(approvalsDb, approvalId, { def, action, record_ids = [], actor = null, project = '', destination = '', now } = {}) {
  if (!approvalsDb || !nonEmpty(approvalId)) return false
  const a = approvals.getApproval(approvalsDb, approvalId)
  if (!a || a.kind !== RECORD_APPROVAL_KIND) return false
  if (a.scope?.record_type !== def.type) return false
  if (a.scope?.record_action !== action) return false
  if (nonEmpty(actor) && a.requested_by !== actor) return false
  if (a.scope?.project !== approvalProject(project)) return false
  if (destinationOf(a.scope?.record_destination) !== destinationOf(destination)) return false
  const covered = new Set((a.scope.record_ids ?? []).map(String))
  if (covered.size && !record_ids.length) return false
  if (record_ids.length && !record_ids.every((id) => covered.has(String(id)))) return false
  return approvals.isApprovalValid(approvalsDb, approvalId, now)
}

/**
 * Spend an approval. True the first time only: the row is the receipt, so the same approval
 * can never authorize a second action. `db` is the records database, where the receipts live.
 */
export function consumeRecordApproval(db, { approval_id, def, action, actor, project = '', destination = '', record_ids = [], now } = {}) {
  if (!nonEmpty(approval_id)) return false
  const r = db.prepare(`INSERT OR IGNORE INTO record_approval_uses
    (approval_id, record_type, action, actor, project, destination, record_ids, used_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(String(approval_id), def.type, String(action), String(actor ?? ''), String(project ?? ''),
      destinationOf(destination), JSON.stringify([...record_ids].map(String)), iso(now))
  return r.changes === 1
}

/** The receipt for an approval that has already been spent, or null. */
export function recordApprovalUse(db, approvalId) {
  return db.prepare('SELECT * FROM record_approval_uses WHERE approval_id = ?').get(String(approvalId ?? '')) ?? null
}

/**
 * Gate check middleware. Returns {decision:'allow', source, gate} or throws:
 *   FORBIDDEN           - denied outright
 *   APPROVAL_REQUIRED   - a human must approve; err.extra.approval is the opened pm approval
 * Every refusal is written to the record type's own audit log.
 */
export function enforceAccess(db, def, {
  action, actor, model = null, role = null, agent = null, project = '', destination = '',
  record = null, record_ids = [], approval_id = null, approvalsDb = null, now,
} = {}) {
  const ids = record_ids.length ? record_ids : (record?.id ? [record.id] : [])
  // an agent names its model before anything is decided, so every entry this call writes -
  // allowed, denied or waiting on a human - says which model asked for it
  assertActor({ actor, model, agent })
  const dest = destinationOf(destination)
  const verdict = checkAccess(db, def, { action, actor, role, agent, project, record })
  if (verdict.decision === 'deny') {
    appendAudit(db, def, {
      record_id: ids[0] ?? '-', action: 'access_denied', actor, model, agent, now,
      detail: { requested: action, reason: verdict.reason, source: verdict.source, gate_id: verdict.gate?.id ?? null },
    })
    recordFail('FORBIDDEN', verdict.reason, { record_type: def.type, action })
  }
  if (verdict.decision === 'allow') return verdict
  // approval required: the approval has to match this request exactly, and it is spent here
  if (recordApprovalValid(approvalsDb, approval_id, { def, action, record_ids: ids, actor, project, destination: dest, now })
    && consumeRecordApproval(db, { approval_id, def, action, actor, project, destination: dest, record_ids: ids, now })) {
    // the ledger shows it spent too, so no other pm surface can hand it out again
    try { approvals.revokeApproval(approvalsDb, approval_id, { actor: actor ?? 'pm', reason: `consumed by ${action} on ${def.type}`, now }) } catch {}
    appendAudit(db, def, {
      record_id: ids[0] ?? '-', action: 'approval_used', actor, model, agent, now,
      detail: { requested: action, approval_id, destination: dest, project: String(project ?? ''), record_ids: ids },
    })
    return { ...verdict, decision: 'allow', source: 'approval', approval_id }
  }
  let approval = null
  let approvalError = null
  try {
    approval = requestRecordApproval(approvalsDb, def, { action, actor, project, record_ids: ids, destination: dest, detail: { reason: verdict.reason }, now })
  } catch (err) {
    approvalError = err instanceof RecordError ? err.message : String(err?.message ?? err)
  }
  appendAudit(db, def, {
    record_id: ids[0] ?? '-', action: 'approval_required', actor, model, agent, now,
    detail: { requested: action, reason: verdict.reason, approval_id: approval?.id ?? null, destination: dest, error: approvalError },
  })
  recordFail('APPROVAL_REQUIRED', approval
    ? `${action} on ${def.type} needs a human approval: decide approval ${approval.id} in pm`
    : `${action} on ${def.type} needs a human approval (${approvalError})`,
  { record_type: def.type, action, approval_id: approval?.id ?? null, approval })
}

/**
 * Approval-queue hook: the record approvals a human still has to decide, newest first.
 * They are ordinary pm approvals, so the pm Approvals panel decides them like any other;
 * this view just narrows the queue to record actions (optionally of one type).
 */
export function pendingRecordApprovals(approvalsDb, { record_type = null, limit = 200 } = {}) {
  if (!approvalsDb) return []
  approvals.migrate(approvalsDb)
  return approvals.listApprovals(approvalsDb, { kind: RECORD_APPROVAL_KIND, limit })
    .filter((a) => nonEmpty(a.scope?.record_type)
      && (!nonEmpty(record_type) || a.scope.record_type === record_type)
      && ['pending', 'pending_user_confirm'].includes(a.status))
    .map((a) => ({
      id: a.id, status: a.status, requested_by: a.requested_by, requested_at: a.requested_at,
      project: a.scope.project, record_type: a.scope.record_type, record_action: a.scope.record_action,
      record_ids: a.scope.record_ids ?? [], destination: destinationOf(a.scope.record_destination),
      detail: a.scope.detail ?? {},
    }))
}

/**
 * What a subject may do on a type right now, for the admin UI: every action of the type with
 * its effective decision. Advisory only - enforceAccess is still what decides a real request.
 */
export function effectiveActions(db, def, { actor, role = null, agent = null, project = '' } = {}) {
  return def.actions.map((action) => {
    const v = checkAccess(db, def, { action, actor, role, agent, project })
    return { action, decision: v.decision, source: v.source, external: isExternalAction(action), reason: v.reason }
  })
}
