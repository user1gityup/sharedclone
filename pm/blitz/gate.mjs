// BLITZ-03 (Q1): the per-task approval gate. A governed task does not start, resume,
// continue or open a run without an approved, unexpired task_scope approval bound to
// the task's current material scope (option A: scope hash, not raw rev - pm bumps rev
// on every claim, lifecycle or next_action write). A material edit after approval
// revokes it. Governed = the project is in blitz_governed_projects (admin-only, in
// bridge.db, so stripping meta cannot escape it) or the task carries meta.blitz.
import { createHash } from 'node:crypto'
import { PmError } from '../store.mjs'
import * as approvals from '../approvals.mjs'
import { parseMeta } from './rating.mjs'

const MERGE_RANK = { none: 0, local_commit: 1, queue_gatekeeper: 2 }

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS blitz_governed_projects (
    project TEXT PRIMARY KEY, added_by TEXT NOT NULL, added_at TEXT NOT NULL)`)
}

/** sha256 of the fields that define what a task asks for. Lease, lifecycle, next_action,
 *  checkpoint and meta.blitz.rating are operational and left out. */
export function scopeHash(task) {
  const meta = parseMeta(task)
  const material = { project_id: task.project_id, title: task.title ?? '', body: task.body ?? '', kind: task.kind ?? null, scope: meta.blitz?.scope ?? null }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

export function listGoverned(db) {
  migrate(db)
  return db.prepare('SELECT project, added_by, added_at FROM blitz_governed_projects ORDER BY project').all().map((r) => ({ ...r }))
}
export function addGoverned(db, project, by, now = new Date().toISOString()) {
  migrate(db)
  db.prepare('INSERT INTO blitz_governed_projects (project, added_by, added_at) VALUES (?, ?, ?) ON CONFLICT(project) DO NOTHING').run(project, by, now)
  return listGoverned(db)
}
export function removeGoverned(db, project) {
  migrate(db)
  db.prepare('DELETE FROM blitz_governed_projects WHERE project = ?').run(project)
  return listGoverned(db)
}

export function isGoverned(db, task) {
  if (parseMeta(task).blitz != null) return true
  if (!db) return false
  migrate(db)
  return !!db.prepare('SELECT 1 FROM blitz_governed_projects WHERE project = ?').get(task.project_id)
}

/** Why a task's approval of this kind does not hold right now; [] when it does.
 *  Side effects (fail closed): a lapsed approval is marked expired, and one whose
 *  scope_hash no longer matches the task is revoked as scope_changed. */
function check(db, task, kind, { now, mergeAction } = {}) {
  const list = approvals.taskApprovals(db, task.id, kind)
  const live = list.find((a) => a.status === 'approved')
  if (!live) return { reasons: [list.length ? `no approved ${kind} for ${task.id} (latest is ${list[0].status})` : `no ${kind} approval for ${task.id}`] }
  if (!approvals.isApprovalValid(db, live.id, now)) return { approval: live.id, reasons: [`${kind} ${live.id} expired`] }
  const reasons = []
  if (live.scope.project !== task.project_id) reasons.push(`${kind} ${live.id} is for project ${live.scope.project}, task is in ${task.project_id}`)
  if (!(live.scope.task_rev <= task.rev)) reasons.push(`${kind} ${live.id} names rev ${live.scope.task_rev}, newer than the task (rev ${task.rev})`)
  if (live.scope.scope_hash !== scopeHash(task)) {
    approvals.revokeApproval(db, live.id, { actor: 'pm-gate', reason: 'scope_changed', now })
    reasons.push(`${kind} ${live.id} was for an older scope of ${task.id} (approved at rev ${live.scope.task_rev}); revoked, request a renewal`)
  }
  if (mergeAction && (MERGE_RANK[mergeAction] ?? Infinity) > MERGE_RANK[live.scope.merge_limit])
    reasons.push(`${mergeAction} exceeds the approved merge_limit ${live.scope.merge_limit}`)
  return { approval: live.id, reasons }
}

/** Non-throwing status for UIs and callers (BLITZ-05 controller, BLITZ-07 merge step). */
export function approvalStatus(db, task, { now } = {}) {
  const governed = isGoverned(db, task)
  const out = { task_id: task.id, task_rev: task.rev, governed, scope_hash: scopeHash(task) }
  if (!db) return { ...out, task_scope: { ok: false, reasons: ['approval ledger unavailable (bridge off)'] }, task_merge: { ok: false, reasons: ['approval ledger unavailable (bridge off)'] } }
  for (const kind of approvals.TASK_KINDS) {
    const r = check(db, task, kind, { now })
    out[kind] = { ok: r.reasons.length === 0, approval_id: r.approval ?? null, reasons: r.reasons }
  }
  return out
}

/**
 * Throws 409 APPROVAL_REQUIRED unless the task may proceed. kind 'task_merge' also needs
 * a holding task_scope, and mergeAction (none|local_commit|queue_gatekeeper) is checked
 * against the merge_limit.
 */
export function assertTaskApproved(db, task, kind = 'task_scope', { now, mergeAction } = {}) {
  if (!db) throw new PmError(409, `${task.id} needs an approval and the approval ledger is unavailable (bridge off)`, { code: 'APPROVAL_REQUIRED', reasons: ['ledger unavailable'] })
  const reasons = check(db, task, 'task_scope', { now, mergeAction: kind === 'task_scope' ? mergeAction : undefined }).reasons
  if (kind === 'task_merge') reasons.push(...check(db, task, 'task_merge', { now, mergeAction }).reasons)
  if (reasons.length) throw new PmError(409, `${task.id} is not approved: ${reasons.join('; ')}`, { code: 'APPROVAL_REQUIRED', reasons })
  return true
}

const GATED = /^\/api\/tasks\/([\w-]+)\/(start|resume|continue|runs)$/

/** Server hook: refuses gated POSTs on governed tasks. getTask throws 404 for a bad id. */
export function guardRequest(db, store, method, pathname, { now } = {}) {
  if (method !== 'POST') return
  const m = GATED.exec(pathname)
  if (!m) return
  const task = store.getTask(m[1])
  if (isGoverned(db, task)) assertTaskApproved(db, task, 'task_scope', { now })
}
