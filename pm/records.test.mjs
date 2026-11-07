// node --test records.test.mjs   (run from the pm folder)
// The generic record engine (L6a): registry, migration, validation, owner, per-type ACL,
// per-type audit log, and the separation between two record types.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  RecordError, defineRecordType, getRecordType, requireRecordType, listRecordTypes,
  migrateRecordType, appliedMigrations, validateRecordData, isIdOf, newRecordId,
  createRecord, getRecord, requireRecord, listRecords, countRecords, updateRecord,
  setRecordStatus, addNote, linkRecord, unlinkRecord, deleteRecord, exportRecords,
  grantAccess, revokeAccess, listAccess, accessActions, accessAllows, appendAudit, auditLog,
  assertActor, RESERVED_FIELDS, DEFAULT_ACTIONS,
} from './records.mjs'

const T0 = new Date('2026-10-25T10:00:00Z')
const plus = (s) => new Date(T0.getTime() + s * 1000)
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof RecordError && e.code === code, `expected ${code}`)

// Two throwaway types with nothing in common: different prefixes, different status enums.
const WIDGET = defineRecordType({
  type: 'widget', label: 'Widget', idPrefix: 'WID', idField: 'widgetId',
  statuses: ['draft', 'live', 'retired'], initialStatus: 'draft', terminal: ['retired'],
  transitions: { draft: ['live', 'retired'], live: ['retired'], retired: [] },
  fields: {
    name: { type: 'string', required: true, max: 40 },
    kind: { type: 'enum', values: ['a', 'b'] },
    email: { type: 'string', pattern: 'email' },
    count: { type: 'number', min: 0 },
    when: { type: 'date' },
    flag: { type: 'boolean', default: false },
    tags: { type: 'tags' },
    notes: { type: 'notes' },
    gadget_links: { type: 'links', linkTo: 'gadget' },
  },
})
const GADGET = defineRecordType({
  type: 'gadget', label: 'Gadget', idPrefix: 'GAD',
  statuses: ['open', 'shut'], initialStatus: 'open',
  fields: { name: { type: 'string', required: true } },
})

function fresh() {
  const db = new DatabaseSync(':memory:')
  migrateRecordType(db, WIDGET)
  migrateRecordType(db, WIDGET) // idempotent
  migrateRecordType(db, GADGET)
  return db
}
const makeWidget = (db, over = {}) => createRecord(db, WIDGET, { project: 'p1', owner: 'olive', data: { name: 'w' }, actor: 'alice', model: 'claude-opus-5', now: T0, ...over })

test('registry: a type is declared once, and two types never share an id space or a table', () => {
  assert.equal(getRecordType('widget'), WIDGET)
  assert.equal(getRecordType('nope'), null)
  throwsCode(() => requireRecordType('nope'), 'NOT_FOUND')
  assert.ok(listRecordTypes().includes(GADGET))
  // same declaration again is the same descriptor
  assert.equal(defineRecordType({ type: 'gadget', idPrefix: 'GAD', statuses: ['open', 'shut'], initialStatus: 'open', fields: { name: { type: 'string', required: true } } }), GADGET)
  throwsCode(() => defineRecordType({ type: 'gadget', idPrefix: 'GAD', statuses: ['open'], fields: {} }), 'CONFLICT')
  throwsCode(() => defineRecordType({ type: 'other', idPrefix: 'GAD', statuses: ['open'], fields: {} }), 'CONFLICT')
  throwsCode(() => defineRecordType({ type: 'other', idPrefix: 'OTH', statuses: ['open'], fields: {}, table: 'rec_gadget' }), 'CONFLICT')
  // malformed declarations are refused
  throwsCode(() => defineRecordType({ type: 'Bad Name', idPrefix: 'BAD', statuses: ['x'] }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({ type: 'bad1', idPrefix: 'bad', statuses: ['x'] }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({ type: 'bad2', idPrefix: 'BD2', statuses: [] }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({ type: 'bad3', idPrefix: 'BD3', statuses: ['x', 'x'] }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({ type: 'bad4', idPrefix: 'BD4', statuses: ['x'], initialStatus: 'y' }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({ type: 'bad5', idPrefix: 'BD5', statuses: ['x'], fields: { owner: { type: 'string' } } }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({ type: 'bad6', idPrefix: 'BD6', statuses: ['x'], fields: { f: { type: 'frog' } } }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({ type: 'bad7', idPrefix: 'BD7', statuses: ['x'], fields: { f: { type: 'enum' } } }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({ type: 'bad8', idPrefix: 'BD8', statuses: ['x'], fields: { f: { type: 'links' } } }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({ type: 'bad9', idPrefix: 'BD9', statuses: ['x'], transitions: { nowhere: ['x'] } }), 'BAD_REQUEST')
  assert.ok(RESERVED_FIELDS.includes('status') && DEFAULT_ACTIONS.includes('export'))
})

test('a type never advertises an action it has no field to perform', () => {
  // WIDGET declares tags, notes and links, so it keeps those actions; it declares no dedupe key
  assert.ok(WIDGET.actions.includes('tag') && WIDGET.actions.includes('note') && WIDGET.actions.includes('link'))
  assert.equal(WIDGET.actions.includes('dedupe_suggest'), false)
  // GADGET declares none of them: the default list comes back without those four
  for (const a of ['tag', 'note', 'link', 'dedupe_suggest']) assert.equal(GADGET.actions.includes(a), false, `gadget advertises ${a}`)
  assert.ok(GADGET.actions.includes('read') && GADGET.actions.includes('update') && GADGET.actions.includes('export'))
  // and an action nothing can perform may not be granted on that type
  const db = fresh()
  throwsCode(() => grantAccess(db, GADGET, { subject: 'x', actions: ['link'], by: 'admin' }), 'BAD_REQUEST')
  // asking for one explicitly is a declaration error rather than a silent drop
  throwsCode(() => defineRecordType({
    type: 'bad10', idPrefix: 'BD10', statuses: ['x'], fields: { name: { type: 'string' } }, actions: ['read', 'link'],
  }), 'BAD_REQUEST')
  throwsCode(() => defineRecordType({
    type: 'bad11', idPrefix: 'BD11', statuses: ['x'], fields: { name: { type: 'string' } }, actions: 'read',
  }), 'BAD_REQUEST')
})

test('migration: three tables per type, recorded version, idempotent and column-safe', () => {
  const db = fresh()
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)
  for (const t of ['rec_widget', 'rec_widget_acl', 'rec_widget_audit', 'rec_gadget', 'rec_gadget_acl', 'rec_gadget_audit', 'record_migrations']) {
    assert.ok(names.includes(t), `missing table ${t}`)
  }
  assert.deepEqual(appliedMigrations(db, 'widget').map((r) => r.version), [1])
  assert.deepEqual(appliedMigrations(db, 'nothing'), [])
  // a database whose table predates a column has it ALTERed in
  const old = new DatabaseSync(':memory:')
  old.exec('CREATE TABLE rec_gadget (id TEXT PRIMARY KEY, status TEXT)')
  const res = migrateRecordType(old, GADGET)
  assert.ok(res.added.includes('data') && res.added.includes('owner') && res.added.includes('created_at'))
  assert.equal(countRecords(old, GADGET), 0)
})

test('validation: required, enums, email, numbers, dates, tags; unknown keys refused', () => {
  assert.deepEqual(validateRecordData(WIDGET, { name: ' w ', flag: true, tags: ['B', 'b', 'a'] }),
    { name: 'w', flag: true, tags: ['b', 'a'] })
  // a default is filled in on a full validation, not on a patch
  assert.equal(validateRecordData(WIDGET, { name: 'w' }).flag, false)
  assert.equal('flag' in validateRecordData(WIDGET, { name: 'w' }, { partial: true }), false)
  throwsCode(() => validateRecordData(WIDGET, {}), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: 'w', nope: 1 }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: 'w', kind: 'z' }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: 'w', email: 'not-an-email' }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: 'w', count: -1 }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: 'w', when: '25/10/2026' }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: 'w', tags: 'a' }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: 'x'.repeat(41) }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: 'w', notes: ['hi'] }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: 'w', gadget_links: ['WID-abcdef'] }), 'BAD_REQUEST')
  throwsCode(() => validateRecordData(WIDGET, { name: null }), 'BAD_REQUEST')
  // every problem is reported at once
  try { validateRecordData(WIDGET, { kind: 'z', count: 'x' }) } catch (e) { assert.equal(e.extra.fields.length, 3) }
})

test('a required field is required after trimming: whitespace is not a value', () => {
  const db = fresh()
  for (const blank of [' ', '   ', '\t', '\n ']) {
    throwsCode(() => validateRecordData(WIDGET, { name: blank }), 'BAD_REQUEST')
    throwsCode(() => validateRecordData(WIDGET, { name: blank }, { partial: true }), 'BAD_REQUEST')
    throwsCode(() => createRecord(db, WIDGET, { data: { name: blank }, actor: 'alice' }), 'BAD_REQUEST')
    const err = (() => { try { validateRecordData(WIDGET, { name: blank }) } catch (e) { return e } })()
    assert.match(err.message, /widget\.name is required/)
  }
  // nothing was written by any of those attempts
  assert.equal(countRecords(db, WIDGET), 0)
  // an optional field may still be blanked
  const w = makeWidget(db)
  assert.equal(updateRecord(db, WIDGET, w.id, { patch: { kind: null }, actor: 'alice' }).kind, null)
  throwsCode(() => updateRecord(db, WIDGET, w.id, { patch: { name: '  ' }, actor: 'alice' }), 'BAD_REQUEST')
  assert.equal(getRecord(db, WIDGET, w.id).name, 'w')
})

test('every record carries createdAt/updatedAt beside the engine columns', () => {
  const db = fresh()
  const w = makeWidget(db)
  assert.equal(w.createdAt, T0.toISOString())
  assert.equal(w.updatedAt, T0.toISOString())
  assert.equal(w.createdAt, w.created_at)
  const u = updateRecord(db, WIDGET, w.id, { patch: { kind: 'a' }, actor: 'bob', now: plus(60) })
  assert.equal(u.createdAt, T0.toISOString())
  assert.equal(u.updatedAt, plus(60).toISOString())
  assert.equal(listRecords(db, WIDGET)[0].updatedAt, u.updatedAt)
  // and a type may not redefine them
  throwsCode(() => defineRecordType({ type: 'bad10', idPrefix: 'BDA', statuses: ['x'], fields: { createdAt: { type: 'date' } } }), 'BAD_REQUEST')
  assert.ok(RESERVED_FIELDS.includes('createdAt') && RESERVED_FIELDS.includes('updatedAt'))
})

test('an agent actor must name its model: no mutation lands with a null model', () => {
  const db = fresh()
  const agent = { actor: 'cc-agent', agent: 'claude-code' }
  // the engine refuses the write outright, so the audit log can never hold an agent with no model
  throwsCode(() => createRecord(db, WIDGET, { data: { name: 'w' }, actor: 'cc-agent', agent: 'claude-code' }), 'BAD_REQUEST')
  throwsCode(() => createRecord(db, WIDGET, { data: { name: 'w' }, actor: 'cc-agent', agent: 'claude-code', model: '  ' }), 'BAD_REQUEST')
  throwsCode(() => assertActor(agent), 'BAD_REQUEST')
  assert.equal(assertActor({ ...agent, model: 'claude-opus-5' }), 'cc-agent')
  assert.equal(assertActor({ actor: 'olive' }), 'olive')  // a human names no agent and needs no model
  throwsCode(() => assertActor({ actor: '' }), 'BAD_REQUEST')
  assert.equal(countRecords(db, WIDGET), 0)

  const w = createRecord(db, WIDGET, { data: { name: 'w' }, actor: 'cc-agent', agent: 'claude-code', model: 'claude-opus-5', now: T0 })
  assert.equal(auditLog(db, WIDGET, { record_id: w.id })[0].model, 'claude-opus-5')
  for (const run of [
    () => updateRecord(db, WIDGET, w.id, { patch: { kind: 'a' }, ...agent }),
    () => setRecordStatus(db, WIDGET, w.id, { status: 'live', ...agent }),
    () => addNote(db, WIDGET, w.id, { text: 'hi', ...agent }),
    () => deleteRecord(db, WIDGET, w.id, { ...agent }),
    () => exportRecords(db, WIDGET, { ids: [w.id], ...agent }),
    () => appendAudit(db, WIDGET, { record_id: w.id, action: 'note', ...agent }),
  ]) throwsCode(run, 'BAD_REQUEST')
  // the record is untouched and nothing of that was audited
  assert.equal(getRecord(db, WIDGET, w.id).rev, 1)
  assert.equal(auditLog(db, WIDGET, { record_id: w.id }).length, 1)
})

test('an audit read can be narrowed to one project; engine-wide entries are not in it', () => {
  const db = fresh()
  const a = makeWidget(db, { project: 'p1' })
  const b = makeWidget(db, { project: 'p2', data: { name: 'w2' } })
  grantAccess(db, WIDGET, { subject: 'cc', actions: ['read'], by: 'admin', now: T0 }) // record_id '-'
  const p1 = auditLog(db, WIDGET, { project: 'p1' })
  assert.deepEqual([...new Set(p1.map((e) => e.record_id))], [a.id])
  assert.deepEqual([...new Set(auditLog(db, WIDGET, { project: 'p2' }).map((e) => e.record_id))], [b.id])
  assert.equal(auditLog(db, WIDGET, { project: 'p1' }).some((e) => e.record_id === '-'), false)
  assert.equal(auditLog(db, WIDGET, { project: 'nowhere' }).length, 0)
  // unscoped, the whole log including the ACL entry
  const all = auditLog(db, WIDGET)
  assert.ok(all.some((e) => e.record_id === '-') && all.length > p1.length)
})

test('ids: each type owns its own id space and never answers for another one', () => {
  const db = fresh()
  const w = makeWidget(db)
  assert.match(w.id, /^WID-[0-9a-f]{10}$/)
  assert.equal(w.widgetId, w.id)
  assert.ok(isIdOf(WIDGET, w.id))
  assert.equal(isIdOf(GADGET, w.id), false)
  assert.match(newRecordId(GADGET), /^GAD-/)
  // a widget id is simply not a gadget, even though both tables live in one database
  assert.equal(getRecord(db, GADGET, w.id), null)
  throwsCode(() => requireRecord(db, GADGET, w.id), 'NOT_FOUND')
})

test('create/update: owner, rev, actor and model are recorded; status is not patchable', () => {
  const db = fresh()
  const w = makeWidget(db)
  assert.equal(w.status, 'draft')
  assert.equal(w.owner, 'olive')
  assert.equal(w.created_by, 'alice')
  assert.equal(w.created_model, 'claude-opus-5')
  assert.equal(w.rev, 1)
  assert.equal(w.flag, false)
  const u = updateRecord(db, WIDGET, w.id, { patch: { kind: 'a', tags: ['X'] }, owner: 'bo', actor: 'bob', model: 'gpt', now: plus(60), expectedRev: 1 })
  assert.equal(u.rev, 2)
  assert.equal(u.kind, 'a')
  assert.deepEqual(u.tags, ['x'])
  assert.equal(u.owner, 'bo')
  assert.equal(u.updated_by, 'bob')
  assert.equal(u.status, 'draft')
  throwsCode(() => updateRecord(db, WIDGET, w.id, { patch: { status: 'live' }, actor: 'bob' }), 'BAD_REQUEST')
  throwsCode(() => updateRecord(db, WIDGET, w.id, { patch: {}, actor: 'bob', expectedRev: 1 }), 'CONFLICT')
  throwsCode(() => updateRecord(db, WIDGET, w.id, { patch: {}, actor: '' }), 'BAD_REQUEST')
  throwsCode(() => createRecord(db, WIDGET, { data: { name: 'x' }, actor: 'a', status: 'shut' }), 'BAD_REQUEST')
  assert.equal(countRecords(db, WIDGET), 1)
})

test('status: a type only accepts its own enum and its own transitions', () => {
  const db = fresh()
  const w = makeWidget(db)
  throwsCode(() => setRecordStatus(db, WIDGET, w.id, { status: 'open', actor: 'a' }), 'BAD_REQUEST') // a gadget status
  const live = setRecordStatus(db, WIDGET, w.id, { status: 'live', actor: 'alice', now: plus(10), reason: 'shipped' })
  assert.equal(live.status, 'live')
  throwsCode(() => setRecordStatus(db, WIDGET, w.id, { status: 'draft', actor: 'alice' }), 'CONFLICT') // not an allowed move
  setRecordStatus(db, WIDGET, w.id, { status: 'retired', actor: 'alice', now: plus(20) })
  throwsCode(() => setRecordStatus(db, WIDGET, w.id, { status: 'live', actor: 'alice' }), 'CONFLICT') // terminal
  const log = auditLog(db, WIDGET, { record_id: w.id, action: 'status_change' })
  assert.equal(log.length, 2)
  assert.deepEqual(log[1].before, { status: 'draft' })
  assert.deepEqual(log[1].after, { status: 'live' })
  assert.equal(log[1].detail.reason, 'shipped')
})

test('notes are append-only and each one is audited', () => {
  const db = fresh()
  const w = makeWidget(db)
  const a = addNote(db, WIDGET, w.id, { text: ' first ', actor: 'alice', model: 'claude-opus-5', now: plus(5) })
  assert.deepEqual(a.notes, [{ at: plus(5).toISOString(), actor: 'alice', model: 'claude-opus-5', text: 'first' }])
  const b = addNote(db, WIDGET, w.id, { text: 'second', actor: 'bob', now: plus(6) })
  assert.equal(b.notes.length, 2)
  throwsCode(() => addNote(db, WIDGET, w.id, { text: '', actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => addNote(db, WIDGET, w.id, { field: 'tags', text: 'x', actor: 'a' }), 'BAD_REQUEST')
  assert.equal(auditLog(db, WIDGET, { record_id: w.id, action: 'note' }).length, 2)
})

test('cross-links: link only, typed, never a conversion', () => {
  const db = fresh()
  const w = makeWidget(db)
  const g = createRecord(db, GADGET, { data: { name: 'g' }, actor: 'alice', now: T0 })
  const linked = linkRecord(db, WIDGET, w.id, { field: 'gadget_links', targetId: g.id, actor: 'alice', now: plus(30) })
  assert.deepEqual(linked.gadget_links, [g.id])
  // nothing of the target was copied in
  assert.equal(linked.name, 'w')
  assert.equal(linked.status, 'draft')
  assert.equal(getRecord(db, GADGET, g.id).status, 'open')
  // linking the same target twice is a no-op; a wrong-type or missing id is refused
  assert.equal(linkRecord(db, WIDGET, w.id, { field: 'gadget_links', targetId: g.id, actor: 'alice' }).rev, linked.rev)
  throwsCode(() => linkRecord(db, WIDGET, w.id, { field: 'gadget_links', targetId: w.id, actor: 'a' }), 'BAD_REQUEST')
  throwsCode(() => linkRecord(db, WIDGET, w.id, { field: 'gadget_links', targetId: 'GAD-ffffffffff', actor: 'a' }), 'NOT_FOUND')
  throwsCode(() => linkRecord(db, WIDGET, w.id, { field: 'tags', targetId: g.id, actor: 'a' }), 'BAD_REQUEST')
  assert.deepEqual(unlinkRecord(db, WIDGET, w.id, { field: 'gadget_links', targetId: g.id, actor: 'alice' }).gadget_links, [])
  assert.equal(auditLog(db, WIDGET, { record_id: w.id, action: 'link' }).length, 1)
  assert.equal(auditLog(db, WIDGET, { record_id: w.id, action: 'unlink' }).length, 1)
})

test('delete is soft and export is recorded per record', () => {
  const db = fresh()
  const w1 = makeWidget(db)
  const w2 = makeWidget(db, { data: { name: 'w2' } })
  const ex = exportRecords(db, WIDGET, { ids: [w1.id, w2.id], actor: 'alice', model: 'claude-opus-5', destination: 'csv', approval_id: 'ap-1', now: plus(90) })
  assert.equal(ex.records.length, 2)
  const exported = auditLog(db, WIDGET, { action: 'export' })
  assert.equal(exported.length, 2)
  assert.equal(exported[0].detail.approval_id, 'ap-1')
  assert.equal(exported[0].detail.destination, 'csv')
  throwsCode(() => exportRecords(db, WIDGET, { ids: [], actor: 'a' }), 'BAD_REQUEST')
  const d = deleteRecord(db, WIDGET, w1.id, { actor: 'alice', now: plus(100), reason: 'dupe' })
  assert.equal(d.deleted_at, plus(100).toISOString())
  assert.equal(listRecords(db, WIDGET).length, 1)
  assert.equal(listRecords(db, WIDGET, { includeDeleted: true }).length, 2)
  assert.equal(deleteRecord(db, WIDGET, w1.id, { actor: 'alice' }).deleted_at, d.deleted_at) // idempotent
  throwsCode(() => updateRecord(db, WIDGET, w1.id, { patch: { kind: 'a' }, actor: 'alice' }), 'CONFLICT')
  assert.equal(auditLog(db, WIDGET, { action: 'delete' })[0].detail.reason, 'dupe')
})

test('listing filters by project, owner and status', () => {
  const db = fresh()
  makeWidget(db, { project: 'p1', owner: 'olive' })
  const b = makeWidget(db, { project: 'p2', owner: 'pete' })
  setRecordStatus(db, WIDGET, b.id, { status: 'live', actor: 'a', now: plus(1) })
  assert.equal(listRecords(db, WIDGET, { project: 'p2' }).length, 1)
  assert.equal(listRecords(db, WIDGET, { owner: 'olive' }).length, 1)
  assert.equal(listRecords(db, WIDGET, { status: 'live' })[0].id, b.id)
  assert.equal(listRecords(db, WIDGET, { status: 'open' }).length, 0)
})

test('ACL is per type: a grant on one record type is invisible to the other', () => {
  const db = fresh()
  grantAccess(db, WIDGET, { subject: 'claude-code', actions: ['read', 'update'], by: 'admin', now: T0 })
  assert.deepEqual(accessActions(db, WIDGET, 'claude-code').sort(), ['read', 'update'])
  assert.ok(accessAllows(db, WIDGET, 'claude-code', 'read'))
  // the very same subject and action on the other type: nothing
  assert.equal(accessAllows(db, GADGET, 'claude-code', 'read'), false)
  assert.deepEqual(accessActions(db, GADGET, 'claude-code'), [])
  // project scoping
  grantAccess(db, WIDGET, { subject: 'bo', project: 'p1', actions: ['read'], by: 'admin', now: T0 })
  assert.ok(accessAllows(db, WIDGET, 'bo', 'read', 'p1'))
  assert.equal(accessAllows(db, WIDGET, 'bo', 'read', 'p2'), false)
  assert.equal(accessAllows(db, WIDGET, 'bo', 'read'), false)
  // '*' grants every action of this type, and only of this type
  grantAccess(db, GADGET, { subject: 'root', actions: ['*'], by: 'admin', now: T0 })
  assert.ok(accessAllows(db, GADGET, 'root', 'export'))
  assert.equal(accessAllows(db, WIDGET, 'root', 'export'), false)
  assert.equal(listAccess(db, WIDGET).length, 2)
  assert.equal(listAccess(db, WIDGET, { subject: 'claude-code' })[0].record_type, 'widget')
  revokeAccess(db, WIDGET, { subject: 'claude-code', by: 'admin', now: plus(10) })
  assert.equal(accessAllows(db, WIDGET, 'claude-code', 'read'), false)
  throwsCode(() => grantAccess(db, WIDGET, { subject: 'x', actions: ['fly'], by: 'admin' }), 'BAD_REQUEST')
  throwsCode(() => grantAccess(db, WIDGET, { subject: 'x', actions: ['read'], by: '' }), 'BAD_REQUEST')
  throwsCode(() => grantAccess(db, WIDGET, { subject: 'x', project: '*', actions: ['read'], by: 'admin' }), 'BAD_REQUEST')
  // grants and revokes are themselves audited, in this type's log only
  assert.equal(auditLog(db, WIDGET, { action: 'acl_grant' }).length, 2)
  assert.equal(auditLog(db, GADGET, { action: 'acl_grant' }).length, 1)
  assert.equal(auditLog(db, WIDGET, { action: 'acl_revoke' }).length, 1)
})

test('audit logs are separate per type and carry actor, model, time and before/after', () => {
  const db = fresh()
  const w = makeWidget(db)
  createRecord(db, GADGET, { data: { name: 'g' }, actor: 'bob', model: 'gpt', now: T0 })
  const wlog = auditLog(db, WIDGET)
  const glog = auditLog(db, GADGET)
  assert.equal(wlog.length, 1)
  assert.equal(glog.length, 1)
  assert.equal(wlog[0].record_type, 'widget')
  assert.equal(wlog[0].actor, 'alice')
  assert.equal(wlog[0].model, 'claude-opus-5')
  assert.equal(wlog[0].at, T0.toISOString())
  assert.equal(wlog[0].before, null)
  assert.equal(wlog[0].after.id, w.id)
  assert.equal(glog[0].actor, 'bob')
  // nothing of one type's log shows up in the other's
  assert.equal(auditLog(db, GADGET, { record_id: w.id }).length, 0)
  updateRecord(db, WIDGET, w.id, { patch: { kind: 'b' }, actor: 'alice', now: plus(1) })
  const up = auditLog(db, WIDGET, { action: 'update' })[0]
  assert.equal(up.before.kind, undefined)
  assert.equal(up.after.kind, 'b')
  assert.deepEqual(up.detail.fields, ['kind'])
  assert.equal(auditLog(db, WIDGET, { actor: 'nobody' }).length, 0)
  throwsCode(() => appendAudit(db, WIDGET, { record_id: w.id, action: 'note', actor: '' }), 'BAD_REQUEST')
})
