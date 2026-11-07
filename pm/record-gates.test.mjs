// node --test record-gates.test.mjs   (run from the pm folder)
// Admin-configurable permission gates (T-d9cf422d) and the two rules they exist to hold:
// a granted internal agent action never re-prompts, and an external action always waits for
// a human in pm approvals. Plus: a gate on one record type says nothing about the other.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import * as approvals from './approvals.mjs'
import { RecordError, createRecord, auditLog, grantAccess } from './records.mjs'
import { CONTACT_LEAD, OPPORTUNITY, migrateRecords } from './record-types.mjs'
import {
  migrateGates, setGate, revokeGate, listGates, matchGate, checkAccess, enforceAccess,
  requestRecordApproval, recordApprovalValid, recordApprovalUse, pendingRecordApprovals, effectiveActions,
  isExternalAction, INTERNAL_ACTIONS, EXTERNAL_ACTIONS, RECORD_APPROVAL_KIND, UNSCOPED_RECORD_PROJECT,
} from './record-gates.mjs'

const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof RecordError && e.code === code, `expected ${code}`)
function catchCode(fn) {
  try { fn() } catch (err) { return err }
  return null
}

function fresh() {
  const db = new DatabaseSync(':memory:')   // records, ACLs, audit logs and gates
  const adb = new DatabaseSync(':memory:')  // the pm approval ledger (the bridge db in production)
  migrateRecords(db)
  migrateGates(db)
  migrateGates(db) // idempotent
  approvals.migrate(adb)
  const contact = createRecord(db, CONTACT_LEAD, { project: 'crm', owner: 'olive', data: { type: 'person', name: 'Dana' }, actor: 'alice' })
  const opp = createRecord(db, OPPORTUNITY, { project: 'leads', owner: 'owen', data: { title: 'Rooftop' }, actor: 'alice' })
  return { db, adb, contact, opp }
}
const pendingCount = (adb) => approvals.listApprovals(adb, { kind: RECORD_APPROVAL_KIND }).length

test('internal and external actions are a fixed, disjoint split', () => {
  for (const a of EXTERNAL_ACTIONS) {
    assert.ok(isExternalAction(a))
    assert.equal(INTERNAL_ACTIONS.includes(a), false)
  }
  assert.deepEqual([...EXTERNAL_ACTIONS], ['outbound_message', 'export', 'bulk_delete', 'share_third_party'])
  for (const a of INTERNAL_ACTIONS) assert.equal(isExternalAction(a), false)
})

test('setGate: validated, admin-written, and never "allow" for an action that leaves pm', () => {
  const { db } = fresh()
  const g = setGate(db, { record_type: 'contact_lead', subject_kind: 'agent', subject: 'claude-code', action: 'update', mode: 'allow', by: 'admin', note: 'CRM tidying' })
  assert.equal(g.record_type, 'contact_lead')
  assert.equal(g.mode, 'allow')
  assert.equal(g.configured_by, 'admin')
  // rewriting the same key replaces the old row rather than stacking a second one
  setGate(db, { record_type: 'contact_lead', subject_kind: 'agent', subject: 'claude-code', action: 'update', mode: 'deny', by: 'admin' })
  const live = listGates(db, { record_type: 'contact_lead' })
  assert.equal(live.length, 1)
  assert.equal(live[0].mode, 'deny')
  assert.equal(listGates(db, { record_type: 'contact_lead', includeRevoked: true }).length, 2)
  // the refusals
  throwsCode(() => setGate(db, { record_type: 'nope', subject_kind: 'role', subject: 'worker', action: 'read', mode: 'allow', by: 'a' }), 'NOT_FOUND')
  throwsCode(() => setGate(db, { record_type: 'contact_lead', subject_kind: 'wizard', subject: 'w', action: 'read', mode: 'allow', by: 'a' }), 'BAD_REQUEST')
  throwsCode(() => setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: '', action: 'read', mode: 'allow', by: 'a' }), 'BAD_REQUEST')
  throwsCode(() => setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'w', action: 'fly', mode: 'allow', by: 'a' }), 'BAD_REQUEST')
  throwsCode(() => setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'w', action: 'read', mode: 'maybe', by: 'a' }), 'BAD_REQUEST')
  throwsCode(() => setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'w', project: '*', action: 'read', mode: 'allow', by: 'a' }), 'BAD_REQUEST')
  throwsCode(() => setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'w', action: 'read', mode: 'allow', by: '' }), 'BAD_REQUEST')
  for (const action of EXTERNAL_ACTIONS) {
    throwsCode(() => setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'worker', action, mode: 'allow', by: 'admin' }), 'FORBIDDEN')
    // deny and approval are fine for them
    assert.equal(setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'worker', action, mode: 'approval', by: 'admin' }).mode, 'approval')
  }
  throwsCode(() => setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'worker', action: '*', mode: 'allow', by: 'admin' }), 'FORBIDDEN')
  assert.equal(setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'client', action: '*', mode: 'deny', by: 'admin' }).mode, 'deny')
})

test('the most specific gate wins: identity over agent over role, project over global', () => {
  const { db } = fresh()
  setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'worker', action: 'update', mode: 'allow', by: 'admin' })
  setGate(db, { record_type: 'contact_lead', subject_kind: 'agent', subject: 'claude-code', action: 'update', mode: 'approval', by: 'admin' })
  setGate(db, { record_type: 'contact_lead', subject_kind: 'identity', subject: 'mallory', action: 'update', mode: 'deny', by: 'admin' })
  const ask = (over) => matchGate(db, { record_type: 'contact_lead', action: 'update', project: 'crm', ...over })
  assert.equal(ask({ role: 'worker' }).mode, 'allow')
  assert.equal(ask({ role: 'worker', agent: 'claude-code' }).mode, 'approval')
  assert.equal(ask({ role: 'worker', agent: 'claude-code', identity: 'mallory' }).mode, 'deny')
  assert.equal(ask({ role: 'manager' }), null)
  assert.equal(ask({}), null)
  // a project-scoped gate beats the global one for that project only
  setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'worker', project: 'crm', action: 'update', mode: 'deny', by: 'admin' })
  assert.equal(ask({ role: 'worker' }).mode, 'deny')
  assert.equal(matchGate(db, { record_type: 'contact_lead', action: 'update', role: 'worker', project: 'other' }).mode, 'allow')
})

test('a granted internal action runs again and again without another approval', () => {
  const { db, adb, contact } = fresh()
  setGate(db, { record_type: 'contact_lead', subject_kind: 'agent', subject: 'claude-code', action: 'dedupe_suggest', mode: 'allow', by: 'admin' })
  // 'link' is deliberately absent: the Contact Lead declares no links field, so it advertises
  // no link action and a grant of one is refused rather than quietly stored (see below)
  grantAccess(db, CONTACT_LEAD, { subject: 'cc-agent', actions: ['read', 'note', 'tag'], by: 'admin' })
  const run = (action, actor, agent) => enforceAccess(db, CONTACT_LEAD, {
    action, actor, agent, model: 'claude-opus-5', role: 'worker', project: 'crm', record: contact, approvalsDb: adb,
  })
  for (let i = 0; i < 3; i++) {
    assert.equal(run('dedupe_suggest', 'cc-agent', 'claude-code').decision, 'allow')
    assert.equal(run('note', 'cc-agent', 'claude-code').source, 'acl')
    assert.equal(run('read', 'cc-agent', 'claude-code').decision, 'allow')
  }
  // nothing was ever queued for a human
  assert.equal(pendingCount(adb), 0)
  assert.equal(auditLog(db, CONTACT_LEAD, { action: 'approval_required' }).length, 0)
  assert.equal(auditLog(db, CONTACT_LEAD, { action: 'access_denied' }).length, 0)
})

// A grant has to be a grant of something that can be done. The Contact Lead declares no links
// field (T-8b68240c fixes its fields), so `link` is not one of its actions at all: it cannot be
// granted, cannot be gated, and cannot be asked for. The Opportunity, which holds the
// cross-link, has it. That is what keeps the registry honest - see record-operations.test.mjs,
// which performs every advertised action of every type.
test('an action a type cannot perform cannot be granted, gated or requested', () => {
  const { db, adb, contact, opp } = fresh()
  assert.equal(CONTACT_LEAD.actions.includes('link'), false)
  assert.equal(OPPORTUNITY.actions.includes('link'), true)

  throwsCode(() => grantAccess(db, CONTACT_LEAD, { subject: 'cc-agent', actions: ['link'], by: 'admin' }), 'BAD_REQUEST')
  throwsCode(() => setGate(db, { record_type: 'contact_lead', subject_kind: 'agent', subject: 'claude-code', action: 'link', mode: 'allow', by: 'admin' }), 'BAD_REQUEST')
  throwsCode(() => checkAccess(db, CONTACT_LEAD, { action: 'link', actor: 'cc-agent' }), 'BAD_REQUEST')
  throwsCode(() => enforceAccess(db, CONTACT_LEAD, { action: 'link', actor: 'cc-agent', role: 'admin', record: contact, approvalsDb: adb }), 'BAD_REQUEST')
  // refusing it is not a quiet denial: nothing was written to the log or to the approval queue
  assert.equal(auditLog(db, CONTACT_LEAD, { action: 'access_denied' }).length, 0)
  assert.equal(pendingCount(adb), 0)

  // the same action on the type that does carry the field is allowed to an admin
  assert.equal(checkAccess(db, OPPORTUNITY, { action: 'link', actor: 'root', role: 'admin', project: opp.project, record: opp }).decision, 'allow')
  assert.equal(effectiveActions(db, CONTACT_LEAD, { actor: 'root', role: 'admin' }).some((a) => a.action === 'link'), false)
  assert.equal(effectiveActions(db, OPPORTUNITY, { actor: 'root', role: 'admin' }).some((a) => a.action === 'link'), true)
})

test('nothing granted means denied, and the refusal is in that type\'s audit log', () => {
  const { db, adb, contact } = fresh()
  const err = catchCode(() => enforceAccess(db, CONTACT_LEAD, { action: 'update', actor: 'stranger', role: 'worker', project: 'crm', record: contact, approvalsDb: adb }))
  assert.ok(err instanceof RecordError && err.code === 'FORBIDDEN')
  const denied = auditLog(db, CONTACT_LEAD, { action: 'access_denied' })
  assert.equal(denied.length, 1)
  assert.equal(denied[0].actor, 'stranger')
  assert.equal(denied[0].record_id, contact.id)
  assert.equal(denied[0].detail.requested, 'update')
  assert.equal(pendingCount(adb), 0)
  // the other type's log knows nothing about it
  assert.equal(auditLog(db, OPPORTUNITY, { action: 'access_denied' }).length, 0)
  throwsCode(() => checkAccess(db, CONTACT_LEAD, { action: 'teleport', actor: 'a' }), 'BAD_REQUEST')
})

test('an owner may work on their own record; an admin may work on any; a deny gate stops both', () => {
  const { db, contact } = fresh()
  assert.equal(checkAccess(db, CONTACT_LEAD, { action: 'update', actor: 'olive', project: 'crm', record: contact }).source, 'owner')
  assert.equal(checkAccess(db, CONTACT_LEAD, { action: 'read', actor: 'root', role: 'admin', project: 'crm' }).source, 'role:admin')
  // owning a record does not let its owner take it out of pm
  assert.equal(checkAccess(db, CONTACT_LEAD, { action: 'export', actor: 'olive', project: 'crm', record: contact }).decision, 'deny')
  setGate(db, { record_type: 'contact_lead', subject_kind: 'identity', subject: 'olive', action: 'update', mode: 'deny', by: 'admin' })
  setGate(db, { record_type: 'contact_lead', subject_kind: 'role', subject: 'admin', action: 'read', mode: 'deny', by: 'admin' })
  assert.equal(checkAccess(db, CONTACT_LEAD, { action: 'update', actor: 'olive', project: 'crm', record: contact }).decision, 'deny')
  assert.equal(checkAccess(db, CONTACT_LEAD, { action: 'read', actor: 'root', role: 'admin', project: 'crm' }).decision, 'deny')
})

test('an external action always goes to a human, even for an admin with a grant', () => {
  const { db, adb, contact } = fresh()
  grantAccess(db, CONTACT_LEAD, { subject: 'cc-agent', actions: ['read', 'export'], by: 'admin' })
  const ask = (over = {}) => enforceAccess(db, CONTACT_LEAD, {
    action: 'export', actor: 'cc-agent', agent: 'claude-code', model: 'claude-opus-5',
    role: 'worker', project: 'crm', record: contact, approvalsDb: adb, ...over,
  })
  const first = catchCode(ask)
  assert.ok(first instanceof RecordError && first.code === 'APPROVAL_REQUIRED')
  const approval = first.extra.approval
  assert.equal(approval.kind, RECORD_APPROVAL_KIND)
  assert.equal(approval.status, 'pending')
  assert.equal(approval.scope.record_type, 'contact_lead')
  assert.equal(approval.scope.record_action, 'export')
  assert.deepEqual(approval.scope.record_ids, [contact.id])
  assert.equal(approval.scope.project, 'crm')
  assert.equal(auditLog(db, CONTACT_LEAD, { action: 'approval_required' })[0].detail.approval_id, approval.id)
  // an administrator is not an exception
  assert.equal(catchCode(() => ask({ actor: 'root', role: 'admin' })).code, 'APPROVAL_REQUIRED')
  // an unapproved id is not a licence
  assert.equal(catchCode(() => ask({ approval_id: approval.id })).code, 'APPROVAL_REQUIRED')
  // the human decides it in pm, and only then does the action run
  approvals.decideApproval(adb, approval.id, { approver: 'user1', method: 'pm_ui', proof: { approver: 'user1' }, decision: 'approved' })
  const ok = ask({ approval_id: approval.id })
  assert.equal(ok.decision, 'allow')
  assert.equal(ok.source, 'approval')
  // that approval covers those ids and nothing else
  const other = createRecord(db, CONTACT_LEAD, { project: 'crm', owner: 'olive', data: { type: 'company', name: 'Acme' }, actor: 'alice' })
  assert.equal(catchCode(() => ask({ record: other, approval_id: approval.id })).code, 'APPROVAL_REQUIRED')
  // and a rejected one never does
  const rej = catchCode(() => ask({ record: other })).extra.approval
  approvals.decideApproval(adb, rej.id, { approver: 'user1', method: 'pm_ui', proof: { approver: 'user1' }, decision: 'rejected' })
  assert.equal(catchCode(() => ask({ record: other, approval_id: rej.id })).code, 'APPROVAL_REQUIRED')
})

test('an approval is bound to its destination, requester and project, and is spent once', () => {
  const { db, adb, contact } = fresh()
  grantAccess(db, CONTACT_LEAD, { subject: 'cc-agent', actions: ['export'], by: 'admin' })
  grantAccess(db, CONTACT_LEAD, { subject: 'other-agent', actions: ['export'], by: 'admin' })
  const ask = (over = {}) => enforceAccess(db, CONTACT_LEAD, {
    action: 'export', actor: 'cc-agent', agent: 'claude-code', model: 'claude-opus-5',
    role: 'worker', project: 'crm', destination: 'csv', record: contact, approvalsDb: adb, ...over,
  })
  const id = catchCode(ask).extra.approval.id
  const approved = approvals.getApproval(adb, id)
  assert.equal(approved.scope.record_destination, 'csv')
  assert.equal(approved.requested_by, 'cc-agent')
  approvals.decideApproval(adb, id, { approver: 'user1', method: 'pm_ui', proof: { approver: 'user1' }, decision: 'approved' })

  // the same approval, pointed somewhere else: the human approved an export to csv, not to a partner
  assert.equal(recordApprovalValid(adb, id, { def: CONTACT_LEAD, action: 'export', record_ids: [contact.id], actor: 'cc-agent', project: 'crm', destination: 'partner-sftp' }), false)
  assert.equal(catchCode(() => ask({ approval_id: id, destination: 'partner-sftp' })).code, 'APPROVAL_REQUIRED')
  // by somebody else
  assert.equal(recordApprovalValid(adb, id, { def: CONTACT_LEAD, action: 'export', record_ids: [contact.id], actor: 'other-agent', project: 'crm', destination: 'csv' }), false)
  assert.equal(catchCode(() => ask({ approval_id: id, actor: 'other-agent' })).code, 'APPROVAL_REQUIRED')
  // in another project
  assert.equal(recordApprovalValid(adb, id, { def: CONTACT_LEAD, action: 'export', record_ids: [contact.id], actor: 'cc-agent', project: 'other', destination: 'csv' }), false)
  // for another action
  assert.equal(recordApprovalValid(adb, id, { def: CONTACT_LEAD, action: 'share_third_party', record_ids: [contact.id], actor: 'cc-agent', project: 'crm', destination: 'csv' }), false)
  // and with no ids at all, where the approval named some
  assert.equal(recordApprovalValid(adb, id, { def: CONTACT_LEAD, action: 'export', record_ids: [], actor: 'cc-agent', project: 'crm', destination: 'csv' }), false)
  // none of those refusals spent it
  assert.equal(recordApprovalUse(db, id), null)

  // used exactly as approved: it runs, and is spent
  assert.equal(ask({ approval_id: id }).source, 'approval')
  const receipt = recordApprovalUse(db, id)
  assert.equal(receipt.actor, 'cc-agent')
  assert.equal(receipt.destination, 'csv')
  assert.equal(receipt.record_type, 'contact_lead')
  assert.equal(auditLog(db, CONTACT_LEAD, { action: 'approval_used' })[0].detail.approval_id, id)
  // replaying the very same call is refused: one approval, one action
  assert.equal(catchCode(() => ask({ approval_id: id })).code, 'APPROVAL_REQUIRED')
  assert.equal(approvals.getApproval(adb, id).status, 'revoked')
  assert.equal(recordApprovalValid(adb, id, { def: CONTACT_LEAD, action: 'export', record_ids: [contact.id], actor: 'cc-agent', project: 'crm', destination: 'csv' }), false)
})

test('an agent has to name its model before any record decision is taken', () => {
  const { db, adb, contact } = fresh()
  grantAccess(db, CONTACT_LEAD, { subject: 'cc-agent', actions: ['read'], by: 'admin' })
  const err = catchCode(() => enforceAccess(db, CONTACT_LEAD, {
    action: 'read', actor: 'cc-agent', agent: 'claude-code', role: 'worker', project: 'crm', record: contact, approvalsDb: adb,
  }))
  assert.equal(err.code, 'BAD_REQUEST')
  assert.match(err.message, /model is required/)
  // nothing was decided, so nothing was logged either way
  assert.equal(auditLog(db, CONTACT_LEAD, { action: 'access_denied' }).length, 0)
  assert.equal(enforceAccess(db, CONTACT_LEAD, {
    action: 'read', actor: 'cc-agent', agent: 'claude-code', model: 'claude-opus-5', role: 'worker', project: 'crm', record: contact, approvalsDb: adb,
  }).decision, 'allow')
  // a human identity needs no model
  assert.equal(enforceAccess(db, CONTACT_LEAD, { action: 'read', actor: 'olive', project: 'crm', record: contact, approvalsDb: adb }).source, 'owner')
})

test('an unauthorized caller cannot even queue an external action', () => {
  const { db, adb, contact } = fresh()
  const err = catchCode(() => enforceAccess(db, CONTACT_LEAD, {
    action: 'share_third_party', actor: 'stranger', role: 'worker', project: 'crm', record: contact, approvalsDb: adb,
  }))
  assert.equal(err.code, 'FORBIDDEN')
  assert.equal(pendingCount(adb), 0)
})

test('a grant on one record type is never a grant on the other', () => {
  const { db, adb, contact, opp } = fresh()
  grantAccess(db, OPPORTUNITY, { subject: 'cc-agent', actions: ['read', 'update', 'export'], by: 'admin' })
  setGate(db, { record_type: 'opportunity', subject_kind: 'agent', subject: 'claude-code', action: 'status', mode: 'allow', by: 'admin' })
  const run = (def, action, record) => enforceAccess(db, def, {
    action, actor: 'cc-agent', agent: 'claude-code', model: 'claude-opus-5', role: 'worker', project: record.project, record, approvalsDb: adb,
  })
  assert.equal(run(OPPORTUNITY, 'update', opp).decision, 'allow')
  assert.equal(run(OPPORTUNITY, 'status', opp).decision, 'allow')
  // the same subject, same agent, same actions - on the Contact CRM it has nothing
  assert.equal(catchCode(() => run(CONTACT_LEAD, 'update', contact)).code, 'FORBIDDEN')
  assert.equal(catchCode(() => run(CONTACT_LEAD, 'status', contact)).code, 'FORBIDDEN')
  assert.equal(catchCode(() => run(CONTACT_LEAD, 'export', contact)).code, 'FORBIDDEN')
  // and the export it does hold on Opportunities still waits for a human
  assert.equal(catchCode(() => run(OPPORTUNITY, 'export', opp)).code, 'APPROVAL_REQUIRED')
  // a gate written for one type is invisible to the other
  assert.equal(matchGate(db, { record_type: 'contact_lead', action: 'status', agent: 'claude-code' }), null)
  // the Opportunity approval does not cover the Contact record of the same action
  const a = approvals.listApprovals(adb, { kind: RECORD_APPROVAL_KIND })[0]
  assert.equal(recordApprovalValid(adb, a.id, { def: CONTACT_LEAD, action: 'export', record_ids: [contact.id] }), false)
})

test('without the pm approval ledger an external action is refused, not waved through', () => {
  const { db, contact } = fresh()
  grantAccess(db, CONTACT_LEAD, { subject: 'cc-agent', actions: ['export'], by: 'admin' })
  const err = catchCode(() => enforceAccess(db, CONTACT_LEAD, { action: 'export', actor: 'cc-agent', role: 'worker', project: 'crm', record: contact, approvalsDb: null }))
  assert.equal(err.code, 'APPROVAL_REQUIRED')
  assert.equal(err.extra.approval_id, null)
  assert.match(err.message, /approval/)
  assert.equal(auditLog(db, CONTACT_LEAD, { action: 'approval_required' })[0].detail.approval_id, null)
  throwsCode(() => requestRecordApproval(null, CONTACT_LEAD, { action: 'export', actor: 'a' }), 'CONFLICT')
})

test('the approval queue shows record actions waiting on a human, per type', () => {
  const { db, adb, contact, opp } = fresh()
  grantAccess(db, CONTACT_LEAD, { subject: 'cc-agent', actions: ['export'], by: 'admin' })
  grantAccess(db, OPPORTUNITY, { subject: 'cc-agent', actions: ['bulk_delete'], by: 'admin' })
  catchCode(() => enforceAccess(db, CONTACT_LEAD, { action: 'export', actor: 'cc-agent', role: 'worker', project: 'crm', record: contact, approvalsDb: adb }))
  const second = catchCode(() => enforceAccess(db, OPPORTUNITY, { action: 'bulk_delete', actor: 'cc-agent', role: 'worker', project: '', record_ids: [opp.id], approvalsDb: adb }))
  assert.equal(pendingRecordApprovals(adb).length, 2)
  assert.equal(pendingRecordApprovals(adb, { record_type: 'contact_lead' }).length, 1)
  assert.equal(pendingRecordApprovals(adb, { record_type: 'contact_lead' })[0].record_action, 'export')
  // a record with no project is filed under a real project name, never '*'
  assert.equal(second.extra.approval.scope.project, UNSCOPED_RECORD_PROJECT)
  // deciding one takes it off the queue
  approvals.decideApproval(adb, second.extra.approval.id, { approver: 'user1', method: 'pm_ui', proof: { approver: 'user1' }, decision: 'approved' })
  assert.equal(pendingRecordApprovals(adb).length, 1)
  assert.deepEqual(pendingRecordApprovals(null), [])
  // an ordinary pm approval of another kind is not a record approval
  approvals.requestApproval(adb, { kind: 'grant', scope: { project: 'crm' }, requested_by: 'someone' })
  assert.equal(pendingRecordApprovals(adb).length, 1)
})

test('effectiveActions tells the admin UI what a subject may do, action by action', () => {
  const { db } = fresh()
  grantAccess(db, CONTACT_LEAD, { subject: 'cc-agent', actions: ['read', 'note', 'export'], by: 'admin' })
  const rows = effectiveActions(db, CONTACT_LEAD, { actor: 'cc-agent', role: 'worker', project: 'crm' })
  const by = Object.fromEntries(rows.map((r) => [r.action, r]))
  assert.equal(by.read.decision, 'allow')
  assert.equal(by.note.decision, 'allow')
  assert.equal(by.update.decision, 'deny')
  assert.equal(by.export.decision, 'approval')
  assert.equal(by.export.external, true)
  assert.equal(by.outbound_message.decision, 'deny') // not granted at all
  assert.equal(rows.length, CONTACT_LEAD.actions.length)
})

test('revoking a gate puts the decision back where it was', () => {
  const { db, contact } = fresh()
  const g = setGate(db, { record_type: 'contact_lead', subject_kind: 'identity', subject: 'olive', action: 'update', mode: 'deny', by: 'admin' })
  assert.equal(checkAccess(db, CONTACT_LEAD, { action: 'update', actor: 'olive', project: 'crm', record: contact }).decision, 'deny')
  const r = revokeGate(db, g.id, { by: 'admin' })
  assert.ok(r.revoked_at)
  assert.equal(revokeGate(db, g.id, { by: 'admin' }).revoked_at, r.revoked_at) // idempotent
  assert.equal(checkAccess(db, CONTACT_LEAD, { action: 'update', actor: 'olive', project: 'crm', record: contact }).source, 'owner')
  assert.equal(listGates(db).length, 0)
  throwsCode(() => revokeGate(db, 9999, { by: 'admin' }), 'NOT_FOUND')
  throwsCode(() => revokeGate(db, g.id, { by: '' }), 'BAD_REQUEST')
})
