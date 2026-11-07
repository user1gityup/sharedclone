// node --test contact-crm.test.mjs   (run from the pm folder)
// Contact CRM (website blitz L6b; T-c54d4b46 covering T-a9bf1b8f, T-c0654b62, T-21886e52):
// typed Contact <-> Opportunity cross-links visible and removable from both sides, the
// conversion guard, central control (settings, permission sets, export policy, retention), the
// import path, and the permission gates around all of it. Same harness as record-routes.test.mjs:
// the registered handlers are driven directly, (match, body, w, query, principal).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DIR = mkdtempSync(join(tmpdir(), 'pm-contact-crm-'))
process.env.BRIDGE_TOKENS = join(DIR, 'bridge-tokens.json')
process.env.BRIDGE_PEERS = join(DIR, 'bridge-peers.json')
process.env.BRIDGE_POLICY = join(DIR, 'bridge-policy.json')
process.env.BRIDGE_DB = join(DIR, 'bridge.db')
process.env.PM_DB = join(DIR, 'pm.db')

const { openStore } = await import('./store.mjs')
const { recordRoutes } = await import('./record-routes.mjs')
const roles = await import('./roles.mjs')
const approvals = await import('./approvals.mjs')
const { LINK_TYPES } = await import('./record-links.mjs')
const { DEFAULT_SETTINGS, MAX_IMPORT_ROWS } = await import('./contact-crm.mjs')

const stores = []
after(() => {
  for (const s of stores) { try { s.close?.() } catch {} }
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

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
    try { call(method, path, opts) } catch (err) {
      assert.equal(err.status, status, `${method} ${path}: ${err.status} ${err.message}`)
      return err
    }
    assert.fail(`${method} ${path} should have failed with ${status}`)
  }
  const contact = (extra = {}) => call('POST', '/api/records/contact_lead', {
    body: { project: 'crm', owner: 'olive', data: { type: 'person', name: 'Dana Reyes', email: 'dana@northwind.example', event_name: 'Expo', source_channel: 'booth', ...extra } },
  })
  const opp = (title = 'Rooftop 500kW') => call('POST', '/api/records/opportunity', { body: { project: 'leads', owner: 'owen', data: { title, due_date: '2026-11-30' } } })
  const audit = (type, id) => call('GET', `/api/records/${type}/audit`, { query: id === '-' ? {} : { record_id: id } })
  const grant = (type, subject, actions, project = '') => call('POST', `/api/records/${type}/acl`, { body: { subject, actions, project } })
  return { store, ledger, routes, call, fails, contact, opp, audit, grant }
}

// ---------------------------------------------------------------- cross-links (T-a9bf1b8f)

test('a link carries type, reason and creator, and shows from both sides', () => {
  const { call, contact, opp } = fresh()
  const c = contact()
  const o = opp()
  const made = call('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, link_type: 'decision_maker', reason: 'signs off on the bid' } })
  assert.equal(made.created, true)
  assert.equal(made.link.link_type, 'decision_maker')
  assert.equal(made.link.reason, 'signs off on the bid')
  assert.equal(made.link.created_by, 'user1')
  assert.equal(made.link.created_model, 'claude-opus-5')

  const fromContact = call('GET', `/api/records/contact_lead/${c.id}/opportunities`)
  assert.equal(fromContact.length, 1)
  assert.equal(fromContact[0].opportunity_id, o.id)
  assert.equal(fromContact[0].reason, 'signs off on the bid')
  assert.equal(fromContact[0].created_by, 'user1')
  assert.equal(fromContact[0].other.title, 'Rooftop 500kW')

  const fromOpp = call('GET', `/api/records/opportunity/${o.id}/contacts`)
  assert.equal(fromOpp.length, 1)
  assert.equal(fromOpp[0].contact_id, c.id)
  assert.equal(fromOpp[0].link_type, 'decision_maker')
  assert.equal(fromOpp[0].other.name, 'Dana Reyes')

  // one Contact may be tied to several Opportunities, one Opportunity to several Contacts
  const o2 = opp('Warehouse retrofit')
  call('POST', `/api/records/contact_lead/${c.id}/opportunities`, { body: { opportunity_id: o2.id, reason: 'procurement lead', link_type: 'referral' } })
  assert.deepEqual(call('GET', `/api/records/contact_lead/${c.id}/opportunities`).map((l) => l.opportunity_id).sort(), [o.id, o2.id].sort())
  const c2 = contact({ name: 'Eli Park', email: 'eli@northwind.example' })
  call('POST', `/api/records/opportunity/${o.id}/contacts`, { body: { contact_id: c2.id, reason: 'engineer on site' } })
  assert.equal(call('GET', `/api/records/opportunity/${o.id}/contacts`).length, 2)
})

test('a link needs a reason, a known type and real records of the right types', () => {
  const { call, fails, contact, opp } = fresh()
  const c = contact()
  const o = opp()
  fails('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id } }, 400)
  fails('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: '   ' } }, 400)
  fails('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'x'.repeat(501) } }, 400)
  const bad = fails('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'x', link_type: 'owner' } }, 400)
  assert.match(bad.message, new RegExp(LINK_TYPES[0]))
  fails('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: o.id, reason: 'x' } }, 400) // an Opportunity id is not a Contact
  fails('POST', '/api/record-links', { body: { opportunity_id: c.id, contact_id: c.id, reason: 'x' } }, 404) // a Contact id is not an Opportunity
  fails('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: 'CL-ffff0000', reason: 'x' } }, 404)
  assert.deepEqual(call('GET', `/api/records/opportunity/${o.id}/contacts`), [])
})

test('linking twice is idempotent and audits once; the Contact does not change', () => {
  const { call, contact, opp, audit } = fresh()
  const c = contact()
  const o = opp()
  const body = { opportunity_id: o.id, contact_id: c.id, reason: 'first', link_type: 'related' }
  assert.equal(call('POST', '/api/record-links', { body }).created, true)
  assert.equal(call('POST', '/api/record-links', { body: { ...body, reason: 'second' } }).created, false)
  assert.equal(call('GET', `/api/records/opportunity/${o.id}/contacts`)[0].reason, 'first')
  assert.equal(audit('opportunity', o.id).filter((e) => e.action === 'link').length, 1)
  assert.equal(audit('contact_lead', c.id).filter((e) => e.action === 'link').length, 1)
  assert.equal(call('GET', `/api/records/contact_lead/${c.id}`).rev, c.rev)
})

test('link and unlink are audited on BOTH records, with reason and creator', () => {
  const { call, contact, opp, audit } = fresh()
  const c = contact()
  const o = opp()
  call('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'met at booth', link_type: 'event_followup' } })
  const oppLink = audit('opportunity', o.id).find((e) => e.action === 'link')
  assert.equal(oppLink.actor, 'user1')
  assert.equal(oppLink.model, 'claude-opus-5')
  assert.equal(oppLink.detail.reason, 'met at booth')
  assert.equal(oppLink.detail.target_id, c.id)
  const cLink = audit('contact_lead', c.id).find((e) => e.action === 'link')
  assert.equal(cLink.actor, 'user1')
  assert.equal(cLink.model, 'claude-opus-5')
  assert.equal(cLink.detail.source_id, o.id)
  assert.equal(cLink.detail.link_type, 'event_followup')
  assert.equal(cLink.detail.reason, 'met at booth')

  call('DELETE', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'wrong person' } })
  const oppUn = audit('opportunity', o.id).find((e) => e.action === 'unlink')
  const cUn = audit('contact_lead', c.id).find((e) => e.action === 'unlink')
  assert.equal(oppUn.detail.reason, 'wrong person')
  assert.equal(cUn.detail.source_id, o.id)
  assert.equal(cUn.detail.link_type, 'event_followup')
})

test('a link can be removed from either side, and then disappears from both', () => {
  const { call, contact, opp } = fresh()
  const c = contact()
  const o1 = opp()
  const o2 = opp('Second')
  const c2 = contact({ name: 'Eli Park', email: 'eli@northwind.example' })
  for (const [oid, cid] of [[o1.id, c.id], [o2.id, c.id], [o1.id, c2.id]]) call('POST', '/api/record-links', { body: { opportunity_id: oid, contact_id: cid, reason: 'r' } })
  // from the Contact side
  const r1 = call('DELETE', `/api/records/contact_lead/${c.id}/opportunities/${o2.id}`)
  assert.equal(r1.removed, true)
  assert.deepEqual(call('GET', `/api/records/contact_lead/${c.id}/opportunities`).map((l) => l.opportunity_id), [o1.id])
  assert.equal(call('GET', `/api/records/opportunity/${o2.id}/contacts`).length, 0)
  // from the Opportunity side
  call('DELETE', `/api/records/opportunity/${o1.id}/contacts/${c2.id}`)
  assert.equal(call('GET', `/api/records/contact_lead/${c2.id}/opportunities`).length, 0)
  assert.deepEqual(call('GET', `/api/records/opportunity/${o1.id}/contacts`).map((l) => l.contact_id), [c.id])
  // removing what is not linked is a no-op, not an error and not an audit entry
  assert.equal(call('DELETE', `/api/records/contact_lead/${c.id}/opportunities/${o2.id}`).removed, false)
})

test('the older per-record links route now records reason and audits the Contact too', () => {
  const { call, fails, contact, opp, audit } = fresh()
  const c = contact()
  const o = opp()
  fails('POST', `/api/records/opportunity/${o.id}/links`, { body: { target_id: c.id } }, 400) // no reason
  call('POST', `/api/records/opportunity/${o.id}/links`, { body: { target_id: c.id, reason: 'same buyer' } })
  assert.equal(call('GET', `/api/records/contact_lead/${c.id}/opportunities`)[0].reason, 'same buyer')
  assert.equal(audit('contact_lead', c.id).filter((e) => e.action === 'link').length, 1)
  call('DELETE', `/api/records/opportunity/${o.id}/links`, { body: { target_id: c.id } })
  assert.equal(call('GET', `/api/records/contact_lead/${c.id}/opportunities`).length, 0)
})

test('a link made before reasons existed still shows, flagged as unrecorded', () => {
  const { call, store, contact, opp } = fresh()
  const c = contact()
  const o = opp()
  // simulate a pre-L6b link: the id list holds it, record_link_meta has no row
  const row = store.db.prepare('SELECT data FROM rec_opportunity WHERE id = ?').get(o.id)
  const data = JSON.parse(row.data)
  data.contact_links = [c.id]
  store.db.prepare('UPDATE rec_opportunity SET data = ? WHERE id = ?').run(JSON.stringify(data), o.id)
  const seen = call('GET', `/api/records/contact_lead/${c.id}/opportunities`)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].recorded, false)
  assert.equal(seen[0].reason, null)
})

// ---------------------------------------------------------------- permission isolation

test('permission isolation both ways: one side never opens the other', () => {
  const { call, fails, contact, opp, grant } = fresh()
  const c = contact()
  const o = opp()
  call('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'tied' } })

  // Opportunity read only: sees that a Contact is linked, by id and reason, never its fields
  grant('opportunity', 'chatgpt', ['read'])
  const seen = call('GET', `/api/records/opportunity/${o.id}/contacts`, { w: asChatgpt, principal: CHATGPT })
  assert.equal(seen[0].contact_id, c.id)
  assert.equal(seen[0].reason, 'tied')
  assert.equal(seen[0].other_visible, false)
  assert.equal(seen[0].other, null)
  assert.equal(JSON.stringify(seen).includes('dana@northwind'), false)
  fails('GET', `/api/records/contact_lead/${c.id}`, { w: asChatgpt, principal: CHATGPT }, 403)
  fails('GET', `/api/records/contact_lead/${c.id}/opportunities`, { w: asChatgpt, principal: CHATGPT }, 403)
  fails('GET', '/api/records/contact_lead', { w: asChatgpt, principal: CHATGPT }, 403)

  // Contact read only (a fresh subject): sees the Opportunity reference, never its fields
  const other = { actor: 'scout', model: 'gpt' }
  const SCOUT = { name: 'scout', scopes: ['read', 'send'], projects: ['*'] }
  call('POST', '/api/records/contact_lead/acl', { body: { subject: 'scout', actions: ['read'] } })
  const back = (() => {
    // scout needs a role of its own for the bridge-side check
    return call('GET', `/api/records/contact_lead/${c.id}/opportunities`, { w: other, principal: SCOUT })
  })
  const r = (() => { try { return back() } catch (e) { return e } })()
  if (r instanceof Error) assert.equal(r.status, 403) // no role assignment is also a refusal, never a leak
  else {
    assert.equal(r[0].other_visible, false)
    assert.equal(r[0].other, null)
  }
  fails('GET', `/api/records/opportunity/${o.id}`, { w: other, principal: SCOUT }, 403)

  // an Opportunity read grant does not let an agent link, and a Contact read grant does not either
  fails('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'x' }, w: asChatgpt, principal: CHATGPT }, 403)
  fails('DELETE', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id }, w: asChatgpt, principal: CHATGPT }, 403)
})

test('with both read grants each side shows the other, and a link grant is what creates one', () => {
  const { call, fails, contact, opp, grant } = fresh()
  const c = contact()
  const o = opp()
  grant('opportunity', 'chatgpt', ['link'])
  grant('contact_lead', 'chatgpt', ['read'])
  const made = call('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'agent found the match', link_type: 'related' }, w: asChatgpt, principal: CHATGPT })
  assert.equal(made.link.created_by, 'chatgpt')
  assert.equal(made.link.created_model, 'gpt')
  const seen = call('GET', `/api/records/contact_lead/${c.id}/opportunities`, { w: asChatgpt, principal: CHATGPT })
  assert.equal(seen[0].other, null) // contact read, but no read on the Opportunity
  grant('opportunity', 'chatgpt', ['read', 'link']) // now it may read Opportunities too
  assert.equal(call('GET', `/api/records/contact_lead/${c.id}/opportunities`, { w: asChatgpt, principal: CHATGPT })[0].other.title, 'Rooftop 500kW')
  const oppSide = call('GET', `/api/records/opportunity/${o.id}/contacts`, { w: asChatgpt, principal: CHATGPT })
  assert.equal(oppSide[0].other.name, 'Dana Reyes')
  // an agent must name its model on every link it makes
  fails('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'x' }, w: { actor: 'chatgpt' }, principal: CHATGPT }, 400)
})

// ---------------------------------------------------------------- conversion guard

test('conversion between Contact and Opportunity is rejected in both directions, on every route and spelling', () => {
  const { call, fails, contact, opp, store } = fresh()
  const c = contact()
  const o = opp()
  const before = { c: call('GET', '/api/records/contact_lead').length, o: call('GET', '/api/records/opportunity').length }
  for (const verb of ['convert', 'promote', 'copy-as', 'copy_as', 'convert-to', 'demote', 'transform', 'clone-as']) {
    for (const [type, id] of [['contact_lead', c.id], ['opportunity', o.id]]) {
      for (const method of ['POST', 'PUT', 'PATCH', 'GET', 'DELETE']) {
        const e = fails(method, `/api/records/${type}/${id}/${verb}`, { body: { to: type === 'contact_lead' ? 'opportunity' : 'contact_lead' } }, 400)
        assert.match(e.message, /never converted/)
        assert.equal(e.extra.conversion_rejected, true)
      }
      fails('POST', `/api/records/${type}/${verb}`, { body: {} }, 400)
      fails('POST', `/api/records/${type}/${id}/${verb}/opportunity`, { body: {} }, 400)
    }
    fails('POST', `/api/contact-crm/${verb}`, { body: {} }, 400)
    fails('POST', `/api/record-links/${verb}`, { body: {} }, 400)
  }
  // conversion smuggled into a link, a create or an import is refused too
  for (const smuggle of [{ convert: true }, { promote_to: 'opportunity' }, { copy_as: 'contact_lead' }, { mode: 'convert' }, { operation: 'promotion' }, { converted_from: c.id }]) {
    fails('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'x', ...smuggle } }, 400)
    fails('POST', '/api/records/opportunity', { body: { data: { title: 'T' }, ...smuggle } }, 400)
    fails('POST', '/api/records/contact_lead', { body: { data: { type: 'person', name: 'N' }, ...smuggle } }, 400)
    fails('POST', '/api/contact-crm/import', { body: { source: 'spreadsheet', rows: [{ name: 'N' }], ...smuggle } }, 400)
  }
  // a Contact's fields can never be an Opportunity's (and the reverse): no field is shared
  fails('POST', '/api/records/opportunity', { body: { data: { title: 'T', name: 'Dana', email: 'd@x.example' } } }, 400)
  fails('POST', '/api/records/contact_lead', { body: { data: { type: 'person', name: 'N', title: 'T', value_usd: 5 } } }, 400)
  // statuses do not cross either
  fails('POST', `/api/records/opportunity/${o.id}/status`, { body: { status: 'qualified' } }, 400)
  fails('POST', `/api/records/contact_lead/${c.id}/status`, { body: { status: 'proposal' } }, 400)
  // nothing was created or changed
  assert.equal(call('GET', '/api/records/contact_lead').length, before.c)
  assert.equal(call('GET', '/api/records/opportunity').length, before.o)
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM record_link_meta").get().n, 0)
})

// ---------------------------------------------------------------- central control (T-c0654b62)

test('the record-type registry carries the Contact Lead entry and its actions', () => {
  const { call } = fresh()
  const c = call('GET', '/api/record-types').find((t) => t.type === 'contact_lead')
  assert.equal(c.id_prefix, 'CL')
  assert.ok(c.actions.includes('export'))
  assert.deepEqual(c.external_actions, ['outbound_message', 'export', 'bulk_delete', 'share_third_party'])
})

test('settings: defaults, admin-only change, validation, revision check, audit', () => {
  const { call, fails, audit, grant } = fresh()
  const s0 = call('GET', '/api/contact-crm/settings')
  assert.equal(s0.rev, 0)
  assert.deepEqual(s0.owners, DEFAULT_SETTINGS.owners)
  assert.equal(s0.retention.days, null)

  const s1 = call('PUT', '/api/contact-crm/settings', { body: { owners: ['olive', 'owen'], default_owner: 'olive', retention: { days: 365 }, export: { allowed_destinations: ['csv'], max_records: 50 } } })
  assert.equal(s1.rev, 1)
  assert.deepEqual(s1.owners, ['olive', 'owen'])
  assert.equal(s1.updated_by, 'user1')
  // a partial change keeps the rest
  const s2 = call('PUT', '/api/contact-crm/settings', { body: { default_owner: 'owen', rev: 1 } })
  assert.equal(s2.rev, 2)
  assert.deepEqual(s2.owners, ['olive', 'owen'])
  assert.equal(s2.retention.days, 365)
  fails('PUT', '/api/contact-crm/settings', { body: { default_owner: 'x', rev: 1 } }, 409) // stale

  // validation
  for (const bad of [{ owners: 'olive' }, { retention: { days: 0 } }, { retention: { days: 1.5 } }, { export: { max_records: 0 } },
    { import: { allowed_sources: ['fax'] } }, { import: { on_duplicate: 'merge' } }, { permission_sets: { Bad: ['read'] } },
    { permission_sets: { ok: ['teleport'] } }, { permission_sets: { ok: [] } }, { surprise: 1 }]) {
    fails('PUT', '/api/contact-crm/settings', { body: bad }, 400)
  }
  // only an administrator may change them; a read grant may read them
  grant('contact_lead', 'chatgpt', ['read'])
  fails('PUT', '/api/contact-crm/settings', { body: { default_owner: 'chatgpt' }, w: asChatgpt, principal: CHATGPT }, 403)
  assert.equal(call('GET', '/api/contact-crm/settings', { w: asChatgpt, principal: CHATGPT }).default_owner, 'owen')
  // and every change is on the Contact Lead audit log
  const changes = audit('contact_lead', '-').filter((e) => e.action === 'settings_update')
  assert.equal(changes.length, 2)
  assert.deepEqual(changes[1].detail.changed.sort(), ['default_owner', 'export', 'owners', 'retention'].sort())
  assert.equal(changes[1].actor, 'user1')
})

test('permission sets are stored centrally and applied to a subject as a real ACL grant', () => {
  const { call, fails, contact } = fresh()
  const c = contact()
  fails('POST', '/api/contact-crm/permission-sets/viewer/apply', { body: { subject: 'chatgpt' }, w: asChatgpt, principal: CHATGPT }, 403)
  fails('POST', '/api/contact-crm/permission-sets/nope/apply', { body: { subject: 'chatgpt' } }, 404)
  fails('GET', '/api/records/contact_lead', { w: asChatgpt, principal: CHATGPT }, 403)
  const acl = call('POST', '/api/contact-crm/permission-sets/viewer/apply', { body: { subject: 'chatgpt' } })
  assert.deepEqual(acl[0].actions, ['read'])
  assert.equal(call('GET', `/api/records/contact_lead/${c.id}`, { w: asChatgpt, principal: CHATGPT }).id, c.id)
  fails('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: { phone: '1' } }, w: asChatgpt, principal: CHATGPT }, 403)
  // a custom set; it cannot carry an action the type does not have, and Opportunities are untouched
  call('PUT', '/api/contact-crm/settings', { body: { permission_sets: { tagger: ['read', 'tag'] } } })
  call('POST', '/api/contact-crm/permission-sets/tagger/apply', { body: { subject: 'chatgpt' } })
  assert.equal(call('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['vip'] }, w: asChatgpt, principal: CHATGPT }).tags.includes('vip'), true)
  fails('GET', '/api/records/opportunity', { w: asChatgpt, principal: CHATGPT }, 403)
})

test('export policy narrows where Contact Leads may go, before any approval is even asked', () => {
  const { call, fails, contact, ledger } = fresh()
  const c = contact()
  call('PUT', '/api/contact-crm/settings', { body: { export: { allowed_destinations: ['csv'], max_records: 1 } } })
  fails('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'mailchimp' } }, 403)
  assert.equal(call('GET', '/api/record-approvals').length, 0) // refused, not queued
  const c2 = contact({ name: 'Eli Park', email: 'eli@northwind.example' })
  fails('POST', '/api/records/contact_lead/export', { body: { ids: [c.id, c2.id], destination: 'csv' } }, 400)
  fails('POST', `/api/records/contact_lead/${c.id}/share`, { body: { destination: 'mailchimp' } }, 403)
  // an allowed destination still needs a human
  const e = fails('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv' } }, 428)
  approvals.decideApproval(ledger, e.extra.approval_id, { approver: 'user1', method: 'pm_ui', proof: { approver: 'user1' }, decision: 'approved' })
  assert.equal(call('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv', approval_id: e.extra.approval_id } }).records.length, 1)
})

test('retention reports what is due and deletes nothing', () => {
  const { call, store, contact } = fresh()
  const c = contact()
  assert.deepEqual(call('GET', '/api/contact-crm/retention'), { days: null, due: [] })
  call('PUT', '/api/contact-crm/settings', { body: { retention: { days: 30 } } })
  assert.equal(call('GET', '/api/contact-crm/retention').due.length, 0)
  store.db.prepare("UPDATE rec_contact_lead SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(c.id)
  const r = call('GET', '/api/contact-crm/retention')
  assert.deepEqual(r.due.map((x) => x.id), [c.id])
  assert.equal(call('GET', '/api/records/contact_lead').length, 1) // still there: deleting is bulk_delete, with approval
})

// ---------------------------------------------------------------- import

test('import: validates every row, tags provenance, skips duplicates, reports errors, and audits the batch', () => {
  const { call, contact, audit } = fresh()
  const known = contact()
  call('PUT', '/api/contact-crm/settings', { body: { default_owner: 'olive' } })
  const out = call('POST', '/api/contact-crm/import', {
    body: {
      source: 'badge_scanner', batch: 'expo-2026', project: 'crm',
      rows: [
        { full_name: 'Ana Cruz', company: 'Solis', mail: 'ana@solis.example', phone: '+63 917 555 0100' },
        { name: 'Dana Again', email: 'DANA@northwind.example' }, // same email as an existing contact
        { name: '', email: 'blank@x.example' },                  // invalid
        { name: 'Bo Lim', email: 'not-an-email' },               // invalid
        { name: 'Cy Tan', phone: '+63 917 555 0100' },           // same phone as Ana, imported a moment ago
        { name: 'Di Uy', type: 'company', source_channel: 'talk' },
      ],
    },
  })
  assert.equal(out.received, 6)
  assert.deepEqual(out.created.map((x) => x.row), [0, 5])
  assert.deepEqual(out.duplicates.map((x) => [x.row, x.action]), [[1, 'skipped'], [4, 'skipped']])
  assert.equal(out.duplicates[0].duplicate_of, known.id)
  assert.deepEqual(out.errors.map((x) => x.row), [2, 3])
  const ana = call('GET', `/api/records/contact_lead/${out.created[0].id}`)
  assert.equal(ana.name, 'Ana Cruz')
  assert.equal(ana.organization, 'Solis')
  assert.equal(ana.type, 'person')
  assert.equal(ana.source_channel, 'badge_scan')
  assert.equal(ana.owner, 'olive')
  assert.equal(ana.project, 'crm')
  assert.equal(ana.consent_marketing, false) // imports carry no consent unless the row says so
  assert.ok(ana.tags.includes('import:badge_scanner') && ana.tags.includes('batch:expo-2026'))
  assert.equal(call('GET', `/api/records/contact_lead/${out.created[1].id}`).source_channel, 'talk')
  assert.equal(call('GET', '/api/records/contact_lead').length, 3)
  const batch = audit('contact_lead', '-').find((e) => e.action === 'import')
  assert.equal(batch.detail.batch, 'expo-2026')
  assert.deepEqual([batch.detail.created, batch.detail.duplicates, batch.detail.errors], [2, 2, 2])
  // every imported record is audited on its own, by the importer
  assert.equal(audit('contact_lead', ana.id)[0].action, 'create')
  assert.equal(audit('contact_lead', ana.id)[0].actor, 'user1')
})

test('import: dry run writes nothing; on_duplicate flag keeps and marks; sources can be switched off', () => {
  const { call, fails, contact } = fresh()
  contact()
  const rows = [{ name: 'New One', email: 'new@x.example' }, { name: 'Dup', email: 'dana@northwind.example' }]
  const dry = call('POST', '/api/contact-crm/import', { body: { source: 'spreadsheet', rows, dry_run: true } })
  assert.equal(dry.dry_run, true)
  assert.equal(dry.created.length, 1) // the one new row is reported as would-create, nothing is written
  assert.equal(call('GET', '/api/records/contact_lead').length, 1)
  assert.equal(dry.duplicates.length, 1)

  call('PUT', '/api/contact-crm/settings', { body: { import: { allowed_sources: ['spreadsheet'], on_duplicate: 'flag' } } })
  const flagged = call('POST', '/api/contact-crm/import', { body: { source: 'spreadsheet', rows } })
  assert.equal(flagged.created.length, 2)
  const dup = call('GET', `/api/records/contact_lead/${flagged.created[1].id}`)
  assert.ok(dup.tags.includes('possible-duplicate'))
  fails('POST', '/api/contact-crm/import', { body: { source: 'badge_scanner', rows } }, 403)
  fails('POST', '/api/contact-crm/import', { body: { source: 'carrier_pigeon', rows } }, 400)
  fails('POST', '/api/contact-crm/import', { body: { source: 'spreadsheet', rows: [] } }, 400)
  fails('POST', '/api/contact-crm/import', { body: { source: 'spreadsheet', rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `n${i}` })) } }, 400)
})

// ---------------------------------------------------------------- gates

test('gates: granted internal actions run without re-approval; external ones block until a human approves', () => {
  const { call, fails, contact, opp, grant, ledger } = fresh()
  const c = contact()
  const o = opp()
  grant('contact_lead', 'chatgpt', ['read', 'create', 'export'])
  grant('opportunity', 'chatgpt', ['read', 'link'])
  // internal: no approval, no queue
  const made = call('POST', '/api/records/contact_lead', { body: { project: 'crm', data: { type: 'person', name: 'Agent Made' } }, w: asChatgpt, principal: CHATGPT })
  assert.ok(made.id)
  call('POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'agent match' }, w: asChatgpt, principal: CHATGPT })
  call('POST', '/api/contact-crm/import', { body: { source: 'spreadsheet', project: 'crm', rows: [{ name: 'Imported By Agent' }] }, w: asChatgpt, principal: CHATGPT })
  assert.equal(call('GET', '/api/record-approvals').length, 0)
  // external: granted but still 428 with a pm approval, and the agent never sees the data
  const e = fails('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv' }, w: asChatgpt, principal: CHATGPT }, 428)
  assert.equal(call('GET', '/api/record-approvals').length, 1)
  // an ungranted action stays 403, a grant of one action is not a grant of another
  fails('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: { phone: '1' } }, w: asChatgpt, principal: CHATGPT }, 403)
  fails('POST', `/api/records/contact_lead/${c.id}/outbound-message`, { body: { to: 'a@b.example' }, w: asChatgpt, principal: CHATGPT }, 403)
  // once a human approves it, the same request goes through
  approvals.decideApproval(ledger, e.extra.approval_id, { approver: 'user1', method: 'pm_ui', proof: { approver: 'user1' }, decision: 'approved' })
  assert.equal(call('POST', '/api/records/contact_lead/export', { body: { ids: [c.id], destination: 'csv', approval_id: e.extra.approval_id }, w: asChatgpt, principal: CHATGPT }).records.length, 1)
  assert.equal(call('GET', '/api/record-link-types').link_types.includes('referral'), true)
})
