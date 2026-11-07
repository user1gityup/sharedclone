// node --test record-types.test.mjs   (run from the pm folder)
// The two record types pm carries (L6a): Contact Lead (T-8b68240c) and Opportunity
// (T-af9f057e). What this file is really testing is that they stay apart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  CONTACT_LEAD, OPPORTUNITY, CONTACT_STATUSES, OPPORTUNITY_STATUSES, CONSENT_FLAGS,
  RECORD_TYPES, migrateRecords,
} from './record-types.mjs'
import {
  RecordError, createRecord, getRecord, setRecordStatus, updateRecord, addNote, linkRecord,
  appliedMigrations, validateRecordData, auditLog, grantAccess, accessAllows, isIdOf,
} from './records.mjs'

const T0 = new Date('2026-10-25T09:00:00Z')
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof RecordError && e.code === code, `expected ${code}`)

function fresh() {
  const db = new DatabaseSync(':memory:')
  migrateRecords(db)
  migrateRecords(db) // idempotent
  return db
}
const CONTACT = {
  type: 'person', name: 'Dana Reyes', organization: 'Northwind', role_title: 'Head of Energy',
  email: 'dana@northwind.example', phone: '+63 2 555 0100',
  event_name: 'Manila Energy Expo', event_date: '2026-10-20', event_venue: 'SMX',
  source_channel: 'booth', tags: ['solar', 'Manila'], consent_contact: true,
}
const newContact = (db, over = {}) => createRecord(db, CONTACT_LEAD, { project: 'crm', owner: 'olive', data: { ...CONTACT, ...over }, actor: 'alice', model: 'claude-opus-5', now: T0 })
const newOpp = (db, over = {}) => createRecord(db, OPPORTUNITY, { project: 'leads', owner: 'owen', data: { title: 'Rooftop 500kW', organization: 'Northwind', due_date: '2026-11-30', next_action: 'send proposal', ...over }, actor: 'alice', model: 'claude-opus-5', now: T0 })

test('both types are registered and migrated, with their own tables and schema version', () => {
  const db = fresh()
  assert.deepEqual(RECORD_TYPES.map((d) => d.type), ['contact_lead', 'opportunity'])
  assert.equal(CONTACT_LEAD.table, 'rec_contact_lead')
  assert.equal(OPPORTUNITY.table, 'rec_opportunity')
  assert.notEqual(CONTACT_LEAD.table, OPPORTUNITY.table)
  assert.notEqual(CONTACT_LEAD.aclTable, OPPORTUNITY.aclTable)
  assert.notEqual(CONTACT_LEAD.auditTable, OPPORTUNITY.auditTable)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  for (const t of [CONTACT_LEAD, OPPORTUNITY]) {
    for (const n of [t.table, t.aclTable, t.auditTable]) assert.ok(tables.includes(n), `missing ${n}`)
    assert.deepEqual(appliedMigrations(db, t.type).map((r) => r.version), [1])
  }
})

test('Contact Lead carries exactly the fields T-8b68240c asks for', () => {
  const want = ['type', 'name', 'organization', 'role_title', 'email', 'phone',
    'event_name', 'event_date', 'event_venue', 'source_channel', 'notes', 'tags',
    'consent_contact', 'consent_marketing', 'consent_share', 'consent_recorded_at']
  assert.deepEqual(Object.keys(CONTACT_LEAD.fields), want)
  assert.deepEqual(CONTACT_LEAD.fields.type.values, ['person', 'company'])
  assert.deepEqual(CONTACT_LEAD.fields.source_channel.values, ['booth', 'talk', 'intro', 'badge_scan'])
  assert.deepEqual([...CONTACT_STATUSES], ['new', 'contacted', 'qualified', 'dormant', 'closed'])
  assert.equal(CONTACT_LEAD.initialStatus, 'new')
  assert.equal(CONTACT_LEAD.idField, 'contactId')
  for (const flag of CONSENT_FLAGS) assert.equal(CONTACT_LEAD.fields[flag].type, 'boolean')
})

test('Contact Lead validation: required name and type, enums, email, consent defaults', () => {
  const db = fresh()
  const c = newContact(db)
  assert.match(c.id, /^CL-[0-9a-f]+$/)
  assert.equal(c.contactId, c.id)
  assert.equal(c.status, 'new')
  assert.equal(c.owner, 'olive')
  assert.equal(c.consent_contact, true)
  assert.equal(c.consent_marketing, false) // defaults are written, not left undefined
  assert.equal(c.consent_share, false)
  assert.deepEqual(c.tags, ['solar', 'manila'])
  throwsCode(() => createRecord(db, CONTACT_LEAD, { data: { name: 'x' }, actor: 'a' }), 'BAD_REQUEST') // type missing
  throwsCode(() => createRecord(db, CONTACT_LEAD, { data: { type: 'robot', name: 'x' }, actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => createRecord(db, CONTACT_LEAD, { data: { type: 'person', name: 'x', email: 'nope' }, actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => createRecord(db, CONTACT_LEAD, { data: { type: 'person', name: 'x', source_channel: 'linkedin' }, actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => createRecord(db, CONTACT_LEAD, { data: { type: 'person', name: 'x', event_date: 'last tuesday' }, actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(CONTACT_LEAD, { ...CONTACT, title: 'CTO' }), 'BAD_REQUEST') // no such field
  // a name of spaces is not a name (it would otherwise trim to '' and be stored empty)
  throwsCode(() => createRecord(db, CONTACT_LEAD, { data: { type: 'person', name: '   ' }, actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => createRecord(db, CONTACT_LEAD, { data: { type: 'person', name: '' }, actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => updateRecord(db, CONTACT_LEAD, c.id, { patch: { name: ' ' }, actor: 'alice' }), 'BAD_REQUEST')
  assert.equal(getRecord(db, CONTACT_LEAD, c.id).name, 'Dana Reyes')
})

test('a Contact Lead carries every field T-8b68240c names, contactId and createdAt/updatedAt included', () => {
  const db = fresh()
  const c = newContact(db)
  // the record as the API hands it out: the task list, field for field
  for (const f of ['contactId', 'type', 'name', 'organization', 'role_title', 'email', 'phone',
    'event_name', 'event_date', 'event_venue', 'source_channel', 'notes', 'tags',
    'owner', 'status', 'consent_contact', 'consent_marketing', 'consent_share',
    'createdAt', 'updatedAt']) {
    assert.ok(f in c, `a Contact Lead has no ${f}`)
  }
  assert.equal(c.createdAt, T0.toISOString())
  assert.equal(c.updatedAt, T0.toISOString())
  assert.deepEqual(c.notes, [])
  const later = new Date('2026-10-26T09:00:00Z')
  const u = updateRecord(db, CONTACT_LEAD, c.id, { patch: { phone: '+63 2 555 0199' }, actor: 'alice', now: later })
  assert.equal(u.createdAt, c.createdAt)         // createdAt never moves
  assert.equal(u.updatedAt, later.toISOString()) // updatedAt does
})

test('the two types share no id space and no status enum', () => {
  const db = fresh()
  const c = newContact(db)
  const o = newOpp(db)
  assert.match(o.id, /^OPP-[0-9a-f]+$/)
  assert.equal(o.opportunityId, o.id)
  assert.ok(isIdOf(CONTACT_LEAD, c.id) && !isIdOf(OPPORTUNITY, c.id))
  assert.ok(isIdOf(OPPORTUNITY, o.id) && !isIdOf(CONTACT_LEAD, o.id))
  assert.equal(getRecord(db, OPPORTUNITY, c.id), null)
  assert.equal(getRecord(db, CONTACT_LEAD, o.id), null)
  // disjoint status enums, in both directions
  for (const s of CONTACT_STATUSES) assert.equal(OPPORTUNITY_STATUSES.includes(s), false, `${s} leaked into the pipeline`)
  for (const s of OPPORTUNITY_STATUSES) assert.equal(CONTACT_STATUSES.includes(s), false, `${s} leaked into the CRM`)
  throwsCode(() => setRecordStatus(db, CONTACT_LEAD, c.id, { status: 'proposal', actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => setRecordStatus(db, OPPORTUNITY, o.id, { status: 'contacted', actor: 'a' }), 'BAD_REQUEST')
})

test('Contact Lead status walk: new -> contacted -> qualified -> dormant -> closed', () => {
  const db = fresh()
  const c = newContact(db)
  let r = c
  for (const s of ['contacted', 'qualified', 'dormant', 'closed']) {
    r = setRecordStatus(db, CONTACT_LEAD, c.id, { status: s, actor: 'alice', model: 'claude-opus-5' })
    assert.equal(r.status, s)
  }
  assert.equal(auditLog(db, CONTACT_LEAD, { record_id: c.id, action: 'status_change' }).length, 4)
})

test('Opportunity pipeline: statuses, deadlines, notes, owners, and its transitions', () => {
  const db = fresh()
  const o = newOpp(db)
  assert.equal(o.status, 'identified')
  assert.equal(o.due_date, '2026-11-30')
  assert.equal(o.next_action, 'send proposal')
  assert.equal(o.owner, 'owen')
  throwsCode(() => setRecordStatus(db, OPPORTUNITY, o.id, { status: 'won', actor: 'a' }), 'CONFLICT') // not straight from identified
  setRecordStatus(db, OPPORTUNITY, o.id, { status: 'qualifying', actor: 'alice' })
  setRecordStatus(db, OPPORTUNITY, o.id, { status: 'proposal', actor: 'alice' })
  setRecordStatus(db, OPPORTUNITY, o.id, { status: 'negotiation', actor: 'alice' })
  const won = setRecordStatus(db, OPPORTUNITY, o.id, { status: 'won', actor: 'alice', reason: 'signed' })
  assert.equal(won.status, 'won')
  throwsCode(() => setRecordStatus(db, OPPORTUNITY, o.id, { status: 'lost', actor: 'a' }), 'CONFLICT') // won is final
  // deadlines and owner are ordinary audited edits
  const moved = updateRecord(db, OPPORTUNITY, o.id, { patch: { due_date: '2026-12-15', next_action_at: '2026-12-01' }, owner: 'nina', actor: 'alice' })
  assert.equal(moved.due_date, '2026-12-15')
  assert.equal(moved.owner, 'nina')
  const noted = addNote(db, OPPORTUNITY, o.id, { text: 'client wants a site visit', actor: 'claude-code', model: 'claude-opus-5' })
  assert.equal(noted.notes.at(-1).model, 'claude-opus-5')
  assert.equal(auditLog(db, OPPORTUNITY, { record_id: o.id, action: 'status_change' }).length, 4)
})

test('an Opportunity links to a Contact Lead: a link, never a conversion', () => {
  const db = fresh()
  const c = newContact(db)
  const o = newOpp(db)
  const linked = linkRecord(db, OPPORTUNITY, o.id, { field: 'contact_links', targetId: c.id, actor: 'alice', model: 'claude-opus-5' })
  assert.deepEqual(linked.contact_links, [c.id])
  // the contact is untouched: same status, same owner, same rev, no opportunity field copied over
  const after = getRecord(db, CONTACT_LEAD, c.id)
  assert.deepEqual(after, c)
  assert.equal(after.title, undefined)
  // the contact has no field that can hold an opportunity id at all - and therefore does not
  // advertise a `link` action either: linking is an Opportunity operation, granted there
  assert.equal(Object.values(CONTACT_LEAD.fields).some((f) => f.type === 'links'), false)
  assert.equal(CONTACT_LEAD.actions.includes('link'), false)
  assert.equal(OPPORTUNITY.actions.includes('link'), true)
  throwsCode(() => linkRecord(db, CONTACT_LEAD, c.id, { field: 'contact_links', targetId: o.id, actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => linkRecord(db, OPPORTUNITY, o.id, { field: 'contact_links', targetId: o.id, actor: 'a' }), 'BAD_REQUEST')
})

test('ACLs and audit logs do not cross between the two types', () => {
  const db = fresh()
  const c = newContact(db)
  const o = newOpp(db)
  grantAccess(db, OPPORTUNITY, { subject: 'claude-code', actions: ['read', 'update', 'export'], by: 'admin' })
  assert.ok(accessAllows(db, OPPORTUNITY, 'claude-code', 'read'))
  assert.equal(accessAllows(db, CONTACT_LEAD, 'claude-code', 'read'), false)
  grantAccess(db, CONTACT_LEAD, { subject: 'claude-code', actions: ['read'], by: 'admin' })
  assert.ok(accessAllows(db, CONTACT_LEAD, 'claude-code', 'read'))
  assert.equal(accessAllows(db, CONTACT_LEAD, 'claude-code', 'update'), false) // still not implied
  // each type's audit log only ever mentions its own records
  const contactLog = auditLog(db, CONTACT_LEAD)
  const oppLog = auditLog(db, OPPORTUNITY)
  assert.ok(contactLog.every((e) => e.record_type === 'contact_lead' && (e.record_id === c.id || e.record_id === '-')))
  assert.ok(oppLog.every((e) => e.record_type === 'opportunity' && (e.record_id === o.id || e.record_id === '-')))
  assert.equal(auditLog(db, CONTACT_LEAD, { record_id: o.id }).length, 0)
})
