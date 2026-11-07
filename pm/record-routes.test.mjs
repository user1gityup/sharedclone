// node --test record-routes.test.mjs   (run from the pm folder)
// The pm record routes (L6a): the handlers server.mjs registers, driven directly the way the
// server drives them - (match, body, w, query, principal). A null principal is this machine's
// own loopback user (pm's administrator); a named principal is a bridge token, role-checked.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DIR = mkdtempSync(join(tmpdir(), 'pm-records-routes-'))
process.env.BRIDGE_TOKENS = join(DIR, 'bridge-tokens.json')
process.env.BRIDGE_PEERS = join(DIR, 'bridge-peers.json')
process.env.BRIDGE_POLICY = join(DIR, 'bridge-policy.json')
process.env.BRIDGE_DB = join(DIR, 'bridge.db')
process.env.PM_DB = join(DIR, 'pm.db')

const { openStore } = await import('./store.mjs')
const { recordRoutes } = await import('./record-routes.mjs')
const roles = await import('./roles.mjs')
const approvals = await import('./approvals.mjs')

const stores = []
after(() => {
  for (const s of stores) { try { s.close?.() } catch {} }
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})
// DIR only names the bridge/pm env paths the modules read at import; every database below is
// in memory, so this file holds no file handle and leaves nothing behind on any platform.

const ADMIN = { actor: 'user1', model: 'claude-opus-5' }
const CHATGPT = { name: 'chatgpt', scopes: ['read', 'send'], projects: ['*'] }
const asChatgpt = { actor: 'chatgpt', model: 'gpt' }

function fresh() {
  const store = openStore(':memory:')
  stores.push(store)
  const ledger = new DatabaseSync(':memory:')
  roles.migrate(ledger)
  approvals.migrate(ledger)
  roles.assignRole(ledger, { identity: 'chatgpt', role: 'worker', by: 'user1' })
  const routes = recordRoutes(store, () => ledger)
  const call = (method, path, { body = {}, w = ADMIN, query = {}, principal = null } = {}) => {
    const r = routes.find(([mm, re]) => mm === method && re.test(path))
    assert.ok(r, `no route ${method} ${path}`)
    return r[2](path.match(r[1]), body, w, query, principal)
  }
  const fails = (method, path, opts, status) => {
    try {
      call(method, path, opts)
    } catch (err) {
      assert.equal(err.status, status, `${method} ${path}: ${err.status} ${err.message}`)
      return err
    }
    assert.fail(`${method} ${path} should have failed with ${status}`)
  }
  const contact = () => call('POST', '/api/records/contact_lead', {
    body: { project: 'crm', owner: 'olive', data: { type: 'person', name: 'Dana Reyes', email: 'dana@northwind.example', event_name: 'Expo', source_channel: 'booth' } },
  })
  const opp = () => call('POST', '/api/records/opportunity', { body: { project: 'leads', owner: 'owen', data: { title: 'Rooftop 500kW', due_date: '2026-11-30' } } })
  return { store, ledger, routes, call, fails, contact, opp }
}

test('GET /api/record-types describes both types and keeps them apart', () => {
  const { call } = fresh()
  const types = call('GET', '/api/record-types')
  assert.deepEqual(types.map((t) => t.type), ['contact_lead', 'opportunity'])
  const [c, o] = types
  assert.equal(c.id_prefix, 'CL')
  assert.equal(o.id_prefix, 'OPP')
  assert.notEqual(c.table, o.table)
  assert.deepEqual(c.statuses, ['new', 'contacted', 'qualified', 'dormant', 'closed'])
  assert.equal(c.statuses.some((s) => o.statuses.includes(s)), false)
  assert.deepEqual(c.external_actions, ['outbound_message', 'export', 'bulk_delete', 'share_third_party'])
  assert.ok(c.internal_actions.includes('dedupe_suggest'))
  assert.deepEqual(c.migrations.map((m) => m.version), [1])
  assert.ok(o.transitions.identified.includes('qualifying'))
})

test('create, read, patch, status and notes over the routes', () => {
  const { call, fails, contact } = fresh()
  const c = contact()
  assert.match(c.id, /^CL-[0-9a-f]+$/)
  assert.equal(c.status, 'new')
  assert.equal(c.created_by, 'user1')
  assert.equal(c.created_model, 'claude-opus-5')
  assert.deepEqual(call('GET', `/api/records/contact_lead/${c.id}`), c)
  assert.equal(call('GET', '/api/records/contact_lead', { query: { project: 'crm' } }).length, 1)
  assert.equal(call('GET', '/api/records/contact_lead', { query: { project: 'nowhere' } }).length, 0)
  const p = call('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: { organization: 'Northwind' }, rev: 1 } })
  assert.equal(p.organization, 'Northwind')
  const s = call('POST', `/api/records/contact_lead/${c.id}/status`, { body: { status: 'contacted', reason: 'emailed' } })
  assert.equal(s.status, 'contacted')
  const nte = call('POST', `/api/records/contact_lead/${c.id}/notes`, { body: { text: 'met at the booth' } })
  assert.equal(nte.notes.length, 1)
  assert.equal(nte.notes[0].actor, 'user1')
  // refusals carry a real status code
  fails('POST', '/api/records/contact_lead', { body: { data: { name: 'no type' } } }, 400)
  fails('POST', `/api/records/contact_lead/${c.id}/status`, { body: { status: 'proposal' } }, 400) // an opportunity status
  fails('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: { status: 'closed' } } }, 400)
  fails('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: {}, rev: 1 } }, 409)
  fails('GET', '/api/records/contact_lead/CL-ffffffffff', {}, 404)
  fails('POST', '/api/records/contact_lead', { body: { data: { type: 'person', name: 'x' } }, w: { actor: '' } }, 400)
  assert.throws(() => call('GET', '/api/records/nosuchtype'), (e) => e.status === 404)
})

test('an id of one type is not found under the other, and links stay typed', () => {
  const { call, fails, contact, opp } = fresh()
  const c = contact()
  const o = opp()
  assert.match(o.id, /^OPP-[0-9a-f]+$/)
  fails('GET', `/api/records/contact_lead/${o.id}`, {}, 404)
  fails('GET', `/api/records/opportunity/${c.id}`, {}, 404)
  const linked = call('POST', `/api/records/opportunity/${o.id}/links`, { body: { field: 'contact_links', target_id: c.id, reason: 'decision maker for this bid', link_type: 'decision_maker' } })
  assert.deepEqual(linked.contact_links, [c.id])
  // the contact is untouched by the link
  assert.deepEqual(call('GET', `/api/records/contact_lead/${c.id}`), c)
  fails('POST', `/api/records/opportunity/${o.id}/links`, { body: { target_id: o.id, reason: 'x' } }, 400)
  const un = call('DELETE', `/api/records/opportunity/${o.id}/links`, { body: { target_id: c.id } })
  assert.deepEqual(un.contact_links, [])
})

test('an export waits for a human, then runs once that approval is decided', () => {
  const { call, ledger, contact } = fresh()
  const c = contact()
  let err
  try { call('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv' } }) } catch (e) { err = e }
  assert.equal(err.status, 428)
  assert.equal(err.extra.code, 'APPROVAL_REQUIRED')
  const id = err.extra.approval_id
  assert.ok(id)
  const queued = call('GET', '/api/record-approvals')
  assert.equal(queued.length, 1)
  assert.equal(queued[0].id, id)
  assert.equal(queued[0].record_type, 'contact_lead')
  assert.equal(queued[0].record_action, 'export')
  assert.deepEqual(queued[0].record_ids, [c.id])
  assert.equal(call('GET', '/api/record-approvals', { query: { record_type: 'opportunity' } }).length, 0)
  // the human decides it in pm, exactly as any other pm approval
  approvals.decideApproval(ledger, id, { approver: 'user1', method: 'pm_ui', proof: { approver: 'user1' }, decision: 'approved' })
  const out = call('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv', approval_id: id } })
  assert.equal(out.records.length, 1)
  assert.equal(out.record_type, 'contact_lead')
  assert.equal(call('GET', '/api/record-approvals').length, 0)
  // what left pm is in the audit log, with the approval that let it
  const exported = call('GET', '/api/records/contact_lead/audit', { query: { action: 'export' } })
  assert.equal(exported.length, 1)
  assert.equal(exported[0].detail.approval_id, id)
  assert.equal(exported[0].actor, 'user1')
})

test('gates and ACL writes are administrator-only; a deny gate stops a token principal', () => {
  const { call, fails, contact } = fresh()
  const c = contact()
  // a bridge token with the worker role holds nothing on this type yet
  fails('GET', '/api/records/contact_lead', { w: asChatgpt, principal: CHATGPT }, 403)
  fails('POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['read'] }, w: asChatgpt, principal: CHATGPT }, 403)
  fails('POST', '/api/record-gates', { body: { record_type: 'contact_lead', subject_kind: 'identity', subject: 'chatgpt', action: 'read', mode: 'allow' }, w: asChatgpt, principal: CHATGPT }, 403)
  // the administrator grants read on this type only
  call('POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['read'] } })
  assert.equal(call('GET', '/api/records/contact_lead', { w: asChatgpt, principal: CHATGPT }).length, 1)
  assert.equal(call('GET', `/api/records/contact_lead/${c.id}`, { w: asChatgpt, principal: CHATGPT }).id, c.id)
  // and that grant says nothing about Opportunities
  fails('GET', '/api/records/opportunity', { w: asChatgpt, principal: CHATGPT }, 403)
  fails('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: { phone: '1' } }, w: asChatgpt, principal: CHATGPT }, 403)
  // an admin gate shuts it off again
  const gate = call('POST', '/api/record-gates', { body: { record_type: 'contact_lead', subject_kind: 'identity', subject: 'chatgpt', action: 'read', mode: 'deny', note: 'paused' } })
  assert.equal(gate.mode, 'deny')
  assert.equal(call('GET', '/api/record-gates').gates.length, 1)
  fails('GET', '/api/records/contact_lead', { w: asChatgpt, principal: CHATGPT }, 403)
  // revoking it hands the ACL back
  call('DELETE', `/api/record-gates/${gate.id}`)
  assert.equal(call('GET', '/api/records/contact_lead', { w: asChatgpt, principal: CHATGPT }).length, 1)
  // a gate that would wave an external action through is refused outright
  fails('POST', '/api/record-gates', { body: { record_type: 'contact_lead', subject_kind: 'identity', subject: 'chatgpt', action: 'export', mode: 'allow' } }, 403)
  // every refusal and every grant is in this type's own audit log
  const denied = call('GET', '/api/records/contact_lead/audit', { query: { action: 'access_denied' } })
  assert.ok(denied.length >= 3)
  assert.equal(call('GET', '/api/records/opportunity/audit', { query: { action: 'acl_grant' } }).length, 0)
})

test('a gate is written in the administrator\'s name, at the server\'s clock', () => {
  const { call } = fresh()
  const g = call('POST', '/api/record-gates', {
    body: { record_type: 'opportunity', subject_kind: 'agent', subject: 'claude-code', action: 'status', mode: 'allow',
      // a caller cannot sign a gate as someone else, nor say when it was configured
      by: 'somebody-else', configured_by: 'somebody-else', now: '2000-01-01T00:00:00.000Z', configured_at: '2000-01-01T00:00:00.000Z' },
  })
  assert.equal(g.configured_by, 'user1')
  assert.ok(g.configured_at > '2026-01-01', `configured_at was ${g.configured_at}`)
  assert.equal(g.record_type, 'opportunity')
  assert.equal(g.mode, 'allow')
})

test('effective-actions tells the UI what an identity may do, per type', () => {
  const { call } = fresh()
  call('POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['read', 'note', 'export'] } })
  const got = call('GET', '/api/records/contact_lead/effective-actions', { w: asChatgpt, principal: CHATGPT })
  assert.equal(got.role, 'worker')
  assert.equal(got.agent, 'chatgpt')
  const by = Object.fromEntries(got.actions.map((a) => [a.action, a]))
  assert.equal(by.read.decision, 'allow')
  assert.equal(by.export.decision, 'approval')
  assert.equal(by.update.decision, 'deny')
  // the same identity on the other type
  const other = call('GET', '/api/records/opportunity/effective-actions', { w: asChatgpt, principal: CHATGPT })
  assert.equal(other.actions.every((a) => a.decision === 'deny'), true)
})

test('no pm database mounts no routes; a route reached with no body refuses, never crashes', () => {
  // createServer may be handed a store stub (other pm route sets guard the same way)
  assert.deepEqual(recordRoutes({}, () => null), [])
  assert.deepEqual(recordRoutes(null, () => null), [])
  const { routes } = fresh()
  const path = '/api/records/contact_lead/acl'
  const r = routes.find(([mm, re]) => mm === 'DELETE' && re.test(path))
  assert.ok(r)
  // body and query absent: the handler must still answer 400 'subject required', not a TypeError
  assert.throws(() => r[2](path.match(r[1]), undefined, ADMIN, undefined, null),
    (e) => e.status === 400 && /subject required/.test(e.message))
})

test('an approved export cannot be replayed, nor pointed at another destination', () => {
  const { call, fails, ledger, contact } = fresh()
  const c = contact()
  const first = fails('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv' } }, 428)
  const id = first.extra.approval_id
  approvals.decideApproval(ledger, id, { approver: 'user1', method: 'pm_ui', proof: { approver: 'user1' }, decision: 'approved' })
  // the destination the human saw is part of the approval
  const elsewhere = fails('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'partner-sftp', approval_id: id } }, 428)
  assert.notEqual(elsewhere.extra.approval_id, id)
  // and another identity cannot spend it
  call('POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['export'] } })
  fails('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv', approval_id: id }, w: asChatgpt, principal: CHATGPT }, 428)
  // used as approved, once
  assert.equal(call('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv', approval_id: id } }).records.length, 1)
  fails('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv', approval_id: id } }, 428)
  // exactly one export left pm
  assert.equal(call('GET', '/api/records/contact_lead/audit', { query: { action: 'export' } }).length, 1)
  assert.equal(call('GET', '/api/records/contact_lead/audit', { query: { action: 'approval_used' } }).length, 1)
})

test('a batch is authorized in the project its records are in, never the one the caller claims', () => {
  const { call, fails, contact } = fresh()
  const crm = contact()
  const other = call('POST', '/api/records/contact_lead', {
    body: { project: 'partners', owner: 'olive', data: { type: 'company', name: 'Acme' } },
  })
  // chatgpt may export, but only inside crm
  call('POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', project: 'crm', actions: ['read', 'export'] } })
  // claiming crm over a partners record does not authorize it
  const denied = fails('POST', '/api/records/contact_lead/export', {
    body: { ids: [other.id], destination: 'csv', project: 'crm' }, w: asChatgpt, principal: CHATGPT,
  }, 400)
  assert.match(denied.message, /not crm/)
  fails('POST', '/api/records/contact_lead/export', { body: { ids: [other.id], destination: 'csv' }, w: asChatgpt, principal: CHATGPT }, 403)
  // and a batch may not span projects at all
  const spanning = fails('POST', '/api/records/contact_lead/bulk-delete', { body: { ids: [crm.id, other.id] } }, 400)
  assert.match(spanning.message, /spans projects/)
  // inside its own project the external action still waits for a human
  fails('POST', '/api/records/contact_lead/export', { body: { ids: [crm.id], destination: 'csv' }, w: asChatgpt, principal: CHATGPT }, 428)
  // nothing was deleted or exported by any of that
  assert.equal(call('GET', `/api/records/contact_lead/${other.id}`).deleted_at, null)
  assert.equal(call('GET', '/api/records/contact_lead/audit', { query: { action: 'export' } }).length, 0)
})

test('a project-scoped read returns that project\'s audit entries and no others', () => {
  const { call, fails, contact } = fresh()
  const crm = contact()
  const other = call('POST', '/api/records/contact_lead', {
    body: { project: 'partners', owner: 'olive', data: { type: 'company', name: 'Acme' } },
  })
  call('POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', project: 'crm', actions: ['read'] } })
  const seen = call('GET', '/api/records/contact_lead/audit', { query: { project: 'crm' }, w: asChatgpt, principal: CHATGPT })
  assert.ok(seen.length >= 1)
  assert.deepEqual([...new Set(seen.map((e) => e.record_id))], [crm.id])
  assert.equal(seen.some((e) => e.record_id === other.id || e.record_id === '-'), false)
  // the other project, and the whole log, are both out of reach
  fails('GET', '/api/records/contact_lead/audit', { query: { project: 'partners' }, w: asChatgpt, principal: CHATGPT }, 403)
  fails('GET', '/api/records/contact_lead/audit', { w: asChatgpt, principal: CHATGPT }, 403)
  fails('GET', '/api/records/contact_lead/audit', { query: { record_id: other.id }, w: asChatgpt, principal: CHATGPT }, 403)
  // the administrator still reads the whole log, ACL entries included
  const all = call('GET', '/api/records/contact_lead/audit')
  assert.ok(all.some((e) => e.record_id === '-'))
  assert.ok(all.some((e) => e.record_id === other.id))
})

test('an agent principal is refused until it says which model it is', () => {
  const { call, fails } = fresh()
  call('POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['read', 'create'] } })
  const noModel = fails('GET', '/api/records/contact_lead', { w: { actor: 'chatgpt' }, principal: CHATGPT }, 400)
  assert.match(noModel.message, /model is required/)
  fails('POST', '/api/records/contact_lead', {
    body: { data: { type: 'person', name: 'Dana' } }, w: { actor: 'chatgpt', model: '   ' }, principal: CHATGPT,
  }, 400)
  // a named agent on the loopback UI is held to the same rule
  fails('GET', '/api/records/contact_lead', { w: { actor: 'user1' }, query: { agent: 'claude-code' } }, 400)
  // with the model named, the grant works and the audit entry carries it
  const made = call('POST', '/api/records/contact_lead', {
    body: { data: { type: 'person', name: 'Dana' } }, w: asChatgpt, principal: CHATGPT,
  })
  assert.equal(made.created_model, 'gpt')
  assert.equal(call('GET', '/api/records/contact_lead/audit', { query: { record_id: made.id } })[0].model, 'gpt')
  assert.equal(call('GET', '/api/records/contact_lead/audit').every((e) => e.actor !== 'chatgpt' || e.model === 'gpt'), true)
})

test('a Contact Lead needs a real name, and hands back createdAt/updatedAt', () => {
  const { call, fails, contact } = fresh()
  fails('POST', '/api/records/contact_lead', { body: { data: { type: 'person', name: '   ' } } }, 400)
  const c = contact()
  assert.equal(c.createdAt, c.created_at)
  assert.equal(c.updatedAt, c.updated_at)
  assert.equal(c.contactId, c.id)
  fails('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: { name: ' ' } } }, 400)
  assert.equal(call('GET', `/api/records/contact_lead/${c.id}`).name, 'Dana Reyes')
})

test('bulk delete and third-party sharing are external too', () => {
  const { call, fails, contact } = fresh()
  const c = contact()
  fails('POST', '/api/records/contact_lead/bulk-delete', { body: { ids: [c.id] } }, 428)
  fails('POST', `/api/records/contact_lead/${c.id}/share`, { body: { destination: 'partner' } }, 428)
  fails('POST', `/api/records/contact_lead/${c.id}/outbound-message`, { body: { subject: 'hello' } }, 428)
  fails('POST', '/api/records/contact_lead/bulk-delete', { body: { ids: [] } }, 400)
  // nothing happened to the record while those waited
  assert.equal(call('GET', `/api/records/contact_lead/${c.id}`).deleted_at, null)
  assert.equal(call('GET', '/api/record-approvals').length, 3)
})
