// node --test record-operations.test.mjs   (run from the pm folder)
//
// An action pm advertises as grantable has to be an action a grant can actually perform, and
// performing it must not hand over anything the grant does not cover. This file proves both,
// the whole way down:
//   engine  - setTags touches a tags field and nothing else; dedupeSuggestions never writes;
//   routes  - every internal action of every type is PERFORMED on that one grant alone
//             (read, create, update, status, note, tag, link, dedupe_suggest), and the
//             Contact Lead, which carries no links field, advertises no link action at all;
//   privacy - a write grant is not a read grant: tagging, noting, patching or linking without
//             `read` returns a receipt (id, revision, the fields that call touched), so a
//             tag-only agent never sees a Contact's name, email, phone or notes;
//   HTTP    - a bridge token holding only `tag` tags over the wire, repeatedly, with no
//             approval ever queued - and still cannot patch, read or touch the other type.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DIR = mkdtempSync(join(tmpdir(), 'pm-record-ops-'))
process.env.BRIDGE_TOKENS = join(DIR, 'bridge-tokens.json')
process.env.BRIDGE_PEERS = join(DIR, 'bridge-peers.json')
process.env.BRIDGE_POLICY = join(DIR, 'bridge-policy.json')
process.env.BRIDGE_DB = join(DIR, 'bridge-default.db')
process.env.PM_DB = join(DIR, 'pm-default.db')
process.env.PM_BRAIN_DIR = join(DIR, 'brain')
process.env.PM_BRAIN_AUDIT = join(DIR, 'brain-write-audit.jsonl')

const { CONTACT_LEAD, OPPORTUNITY, migrateRecords } = await import('./record-types.mjs')
const {
  RecordError, createRecord, getRecord, setTags, dedupeSuggestions, auditLog, updateRecord,
} = await import('./records.mjs')
const { openStore } = await import('./store.mjs')
const { recordRoutes, ACTION_OPERATIONS } = await import('./record-routes.mjs')
const { createBridge } = await import('./bridge/index.mjs')
const { createAuth, sha256 } = await import('./bridge/auth.mjs')
const { createServer } = await import('./server.mjs')
const { INTERNAL_ACTIONS } = await import('./record-gates.mjs')
const roles = await import('./roles.mjs')
const approvals = await import('./approvals.mjs')

const T0 = new Date('2026-10-26T09:00:00Z')
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof RecordError && e.code === code, `expected ${code}`)

const cleanups = []
after(() => {
  for (const fn of cleanups.reverse()) { try { fn() } catch {} }
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

// ------------------------------------------------------------------ engine

const CONTACT = {
  type: 'person', name: 'Dana Reyes', organization: 'Northwind',
  email: 'dana@northwind.example', phone: '+63 2 555 0100',
  event_name: 'Manila Energy Expo', source_channel: 'booth', tags: ['solar'],
}
function engineDb() {
  const db = new DatabaseSync(':memory:')
  migrateRecords(db)
  return db
}
const mkContact = (db, over = {}) => createRecord(db, CONTACT_LEAD, {
  project: 'crm', owner: 'olive', data: { ...CONTACT, ...over }, actor: 'alice', model: 'claude-opus-5', now: T0,
})

test('setTags adds, removes and replaces tags, and audits every change as `tag`', () => {
  const db = engineDb()
  const c = mkContact(db)
  assert.deepEqual(c.tags, ['solar'])

  const added = setTags(db, CONTACT_LEAD, c.id, { add: ['Manila', 'rooftop'], actor: 'tagger', model: 'gpt-6', agent: 'chatgpt', now: T0 })
  assert.deepEqual(added.tags, ['solar', 'manila', 'rooftop']) // normalized, de-duplicated, ordered
  assert.equal(added.rev, c.rev + 1)

  const removed = setTags(db, CONTACT_LEAD, c.id, { remove: ['SOLAR'], actor: 'tagger', model: 'gpt-6', agent: 'chatgpt', now: T0 })
  assert.deepEqual(removed.tags, ['manila', 'rooftop'])

  const replaced = setTags(db, CONTACT_LEAD, c.id, { set: ['battery'], actor: 'tagger', model: 'gpt-6', agent: 'chatgpt', now: T0 })
  assert.deepEqual(replaced.tags, ['battery'])

  const log = auditLog(db, CONTACT_LEAD, { record_id: c.id, action: 'tag' })
  assert.equal(log.length, 3)
  assert.equal(log.every((e) => e.actor === 'tagger' && e.model === 'gpt-6'), true)
  const newest = log[0]
  assert.deepEqual(newest.before.tags, ['manila', 'rooftop'])
  assert.deepEqual(newest.after.tags, ['battery'])
  assert.deepEqual(newest.detail.added, ['battery'])
  assert.deepEqual(newest.detail.removed, ['manila', 'rooftop'])
})

test('setTags changes nothing else, and a no-op is neither a revision nor an audit entry', () => {
  const db = engineDb()
  const c = mkContact(db)
  const same = setTags(db, CONTACT_LEAD, c.id, { add: ['solar'], actor: 'tagger', now: T0 })
  assert.equal(same.rev, c.rev)
  assert.equal(auditLog(db, CONTACT_LEAD, { record_id: c.id, action: 'tag' }).length, 0)

  // a tags call cannot reach another field, a missing field, or an agent without a model
  throwsCode(() => setTags(db, CONTACT_LEAD, c.id, { field: 'name', set: ['x'], actor: 'tagger' }), 'BAD_REQUEST')
  throwsCode(() => setTags(db, CONTACT_LEAD, c.id, { field: 'notes', add: ['x'], actor: 'tagger' }), 'BAD_REQUEST')
  throwsCode(() => setTags(db, CONTACT_LEAD, c.id, { actor: 'tagger' }), 'BAD_REQUEST')
  throwsCode(() => setTags(db, CONTACT_LEAD, c.id, { add: ['x'], set: ['y'], actor: 'tagger' }), 'BAD_REQUEST')
  throwsCode(() => setTags(db, CONTACT_LEAD, c.id, { add: [''], actor: 'tagger' }), 'BAD_REQUEST')
  throwsCode(() => setTags(db, CONTACT_LEAD, c.id, { add: ['x'], actor: 'bot', agent: 'chatgpt' }), 'BAD_REQUEST')

  const after = getRecord(db, CONTACT_LEAD, c.id)
  assert.equal(after.name, 'Dana Reyes')
  assert.equal(after.email, CONTACT.email)
  assert.equal(after.rev, c.rev)
})

test('dedupeSuggestions proposes duplicates, writes an audit entry and never writes a record', () => {
  const db = engineDb()
  const a = mkContact(db)
  const b = mkContact(db, { name: 'D. Reyes', phone: '', email: 'DANA@northwind.example' })        // same email
  const c = mkContact(db, { name: 'Dana  Reyes', email: '', phone: '+6325550100' })                // same name+org, same phone
  const alone = mkContact(db, { name: 'Sam Cruz', organization: 'Helios', email: 'sam@helios.example', phone: '' })

  const out = dedupeSuggestions(db, CONTACT_LEAD, { project: 'crm', actor: 'dedupe-bot', model: 'gpt-6', agent: 'chatgpt', now: T0 })
  assert.equal(out.record_type, 'contact_lead')
  assert.equal(out.scanned, 4)
  const byKey = Object.fromEntries(out.groups.map((g) => [g.key, g.record_ids.slice().sort()]))
  assert.deepEqual(byKey.email, [a.id, b.id].sort())
  assert.deepEqual(byKey.phone, [a.id, c.id].sort())
  assert.deepEqual(byKey.name_organization, [a.id, c.id].sort())
  assert.equal(out.groups.some((g) => g.record_ids.includes(alone.id)), false)

  // it proposed; it did not merge, rename or touch anything
  for (const r of [a, b, c, alone]) assert.deepEqual(getRecord(db, CONTACT_LEAD, r.id), r)
  const log = auditLog(db, CONTACT_LEAD, { action: 'dedupe_suggest' })
  assert.equal(log.length, 1)
  assert.equal(log[0].actor, 'dedupe-bot')
  assert.equal(log[0].model, 'gpt-6')
  assert.equal(log[0].after.groups, out.groups.length)

  // anchored at one record: only the groups that record is in
  const anchored = dedupeSuggestions(db, CONTACT_LEAD, { record_id: b.id, actor: 'dedupe-bot', now: T0 })
  assert.deepEqual(anchored.groups.map((g) => g.key), ['email'])
})

test('dedupe keys belong to one type: Opportunities never group with Contact Leads', () => {
  const db = engineDb()
  mkContact(db, { name: 'Northwind', type: 'company', organization: 'Northwind', email: '', phone: '' })
  const o1 = createRecord(db, OPPORTUNITY, { project: 'leads', owner: 'owen', data: { title: 'Rooftop 500kW', organization: 'Northwind' }, actor: 'alice', now: T0 })
  const o2 = createRecord(db, OPPORTUNITY, { project: 'leads', owner: 'owen', data: { title: 'rooftop  500kw', organization: 'northwind' }, actor: 'alice', now: T0 })

  const opp = dedupeSuggestions(db, OPPORTUNITY, { actor: 'alice', now: T0 })
  assert.deepEqual(opp.keys, ['title_organization'])
  assert.deepEqual(opp.groups.map((g) => g.record_ids.slice().sort()), [[o1.id, o2.id].sort()])
  assert.equal(opp.groups.every((g) => g.record_type === 'opportunity'), true)

  // and the Contact log knows nothing of the Opportunity run
  assert.equal(auditLog(db, CONTACT_LEAD, { action: 'dedupe_suggest' }).length, 0)
  assert.equal(auditLog(db, OPPORTUNITY, { action: 'dedupe_suggest' }).length, 1)
})

// ------------------------------------------------------------------ routes

const ADMIN = { actor: 'user1', model: 'claude-opus-5' }
const CHATGPT = { name: 'chatgpt', scopes: ['read', 'send'], projects: ['*'] }
const asChatgpt = { actor: 'chatgpt', model: 'gpt-6' }

function fresh() {
  const store = openStore(':memory:')
  cleanups.push(() => store.close?.())
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
  const grant = (type, actions, project = '') =>
    call('POST', `/api/records/${type}/acl`, { body: { subject: 'chatgpt', project, actions } })
  const contact = (over = {}) => call('POST', '/api/records/contact_lead', {
    body: { project: 'crm', owner: 'olive', data: { ...CONTACT, ...over } },
  })
  return { store, ledger, routes, call, fails, grant, contact }
}

test('every advertised action names the route that performs it', () => {
  const { call } = fresh()
  for (const t of call('GET', '/api/record-types')) {
    for (const a of t.actions) {
      assert.equal(typeof t.operations[a], 'string', `${t.type}.${a} has no operation`)
      assert.equal(t.operations[a], ACTION_OPERATIONS[a])
    }
    assert.equal(t.operations.tag, 'POST /api/records/:type/:id/tags')
    assert.equal(t.operations.dedupe_suggest, 'GET /api/records/:type/dedupe-suggestions')
    assert.ok(t.dedupe_keys.length)
  }
})

test('a tag-only grant tags - and does nothing else', () => {
  const { call, fails, grant, contact } = fresh()
  const c = contact()
  const o = call('POST', '/api/records/opportunity', { body: { project: 'leads', owner: 'owen', data: { title: 'Rooftop 500kW' } } })

  // nothing granted yet: the tag route refuses like everything else
  fails('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['manila'] }, w: asChatgpt, principal: CHATGPT }, 403)

  // the administrator grants `tag` on the Contact CRM, and nothing more
  grant('contact_lead', ['tag'])

  const tagged = call('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['Manila', 'rooftop'] }, w: asChatgpt, principal: CHATGPT })
  assert.deepEqual(tagged.tags, ['solar', 'manila', 'rooftop'])
  const untagged = call('DELETE', `/api/records/contact_lead/${c.id}/tags`, { body: {}, query: { tag: 'solar' }, w: asChatgpt, principal: CHATGPT })
  assert.deepEqual(untagged.tags, ['manila', 'rooftop'])
  const replaced = call('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { set: ['battery'] }, w: asChatgpt, principal: CHATGPT })
  assert.deepEqual(replaced.tags, ['battery'])

  // that grant is a grant of tagging only: not reading, not patching, not the pipeline
  fails('GET', '/api/records/contact_lead', { w: asChatgpt, principal: CHATGPT }, 403)
  fails('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: { phone: '1' } }, w: asChatgpt, principal: CHATGPT }, 403)
  fails('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: { tags: ['sneaky'] } }, w: asChatgpt, principal: CHATGPT }, 403)
  fails('POST', `/api/records/contact_lead/${c.id}/status`, { body: { status: 'contacted' }, w: asChatgpt, principal: CHATGPT }, 403)
  fails('GET', '/api/records/contact_lead/dedupe-suggestions', { w: asChatgpt, principal: CHATGPT, query: { project: 'crm' } }, 403)

  // nor a grant on the other record type
  fails('POST', `/api/records/opportunity/${o.id}/tags`, { body: { add: ['x'] }, w: asChatgpt, principal: CHATGPT }, 403)

  // the record is exactly as the tag calls left it
  const now = call('GET', `/api/records/contact_lead/${c.id}`)
  assert.deepEqual(now.tags, ['battery'])
  assert.equal(now.phone, CONTACT.phone)
  assert.equal(now.status, 'new')
})

test('a dedupe_suggest-only grant runs the suggestion route and cannot act on it', () => {
  const { call, fails, grant, contact } = fresh()
  const a = contact()
  const b = contact({ name: 'D. Reyes', phone: '' })
  grant('contact_lead', ['dedupe_suggest'], 'crm')

  const out = call('GET', '/api/records/contact_lead/dedupe-suggestions', { w: asChatgpt, principal: CHATGPT, query: { project: 'crm' } })
  assert.equal(out.record_type, 'contact_lead')
  assert.equal(out.scanned, 2)
  assert.deepEqual(out.groups.find((g) => g.key === 'email').record_ids.sort(), [a.id, b.id].sort())

  // repeatable: a granted internal action never asks again
  for (let i = 0; i < 3; i++) call('GET', '/api/records/contact_lead/dedupe-suggestions', { w: asChatgpt, principal: CHATGPT, query: { project: 'crm' } })

  // and it buys nothing else: not reading records, not tagging, not merging them
  fails('GET', '/api/records/contact_lead', { w: asChatgpt, principal: CHATGPT, query: { project: 'crm' } }, 403)
  fails('POST', `/api/records/contact_lead/${a.id}/tags`, { body: { add: ['dupe'] }, w: asChatgpt, principal: CHATGPT }, 403)
  fails('PATCH', `/api/records/contact_lead/${a.id}`, { body: { patch: { organization: 'merged' } }, w: asChatgpt, principal: CHATGPT }, 403)
  // the grant is scoped to crm, so another project is out of reach even for suggestions
  fails('GET', '/api/records/contact_lead/dedupe-suggestions', { w: asChatgpt, principal: CHATGPT, query: { project: 'partners' } }, 403)

  const log = call('GET', '/api/records/contact_lead/audit', { query: { action: 'dedupe_suggest' } })
  assert.equal(log.length, 4)
  assert.equal(log.every((e) => e.actor === 'chatgpt' && e.model === 'gpt-6'), true)
})

test('a gate grants tagging on its own, and a deny gate takes it back', () => {
  const { call, fails, contact } = fresh()
  const c = contact()
  call('POST', '/api/record-gates', { body: { record_type: 'contact_lead', subject_kind: 'agent', subject: 'chatgpt', action: 'tag', mode: 'allow' } })
  assert.deepEqual(call('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['gated'] }, w: asChatgpt, principal: CHATGPT }).tags, ['solar', 'gated'])

  const effective = call('GET', '/api/records/contact_lead/effective-actions', { w: asChatgpt, principal: CHATGPT })
  const decisions = Object.fromEntries(effective.actions.map((a) => [a.action, a.decision]))
  assert.equal(decisions.tag, 'allow')
  assert.equal(decisions.update, 'deny')
  assert.equal(decisions.dedupe_suggest, 'deny')
  assert.equal(decisions.export, 'deny')

  const gate = call('POST', '/api/record-gates', { body: { record_type: 'contact_lead', subject_kind: 'agent', subject: 'chatgpt', action: 'tag', mode: 'deny' } })
  assert.equal(gate.mode, 'deny')
  const denied = fails('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['again'] }, w: asChatgpt, principal: CHATGPT }, 403)
  assert.match(denied.message, /denies tag/)
  assert.deepEqual(call('GET', `/api/records/contact_lead/${c.id}`).tags, ['solar', 'gated'])
})

// ---------------------------------------------------- a write grant is not a read grant

// The fields a tag-only agent must never see coming back out of the tag route.
const PRIVATE = ['name', 'email', 'phone', 'organization', 'role_title', 'event_name', 'notes', 'status', 'owner']

test('tagging returns a receipt, not the record: a tag grant discloses nothing', () => {
  const { call, fails, grant, contact } = fresh()
  const c = contact()
  grant('contact_lead', ['tag'])

  const tagged = call('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['manila'] }, w: asChatgpt, principal: CHATGPT })
  // what it asked for came back: the id, the new tags, the new revision
  assert.deepEqual(tagged.tags, ['solar', 'manila'])
  assert.equal(tagged.id, c.id)
  assert.equal(tagged.rev, c.rev + 1)
  assert.equal(tagged.redacted, true)
  assert.equal(tagged.readable, false)
  // and nothing else did
  for (const f of PRIVATE) assert.equal(tagged[f], undefined, `the tag route disclosed ${f}`)

  const dropped = call('DELETE', `/api/records/contact_lead/${c.id}/tags`, { body: {}, query: { tag: 'solar' }, w: asChatgpt, principal: CHATGPT })
  assert.deepEqual(dropped.tags, ['manila'])
  for (const f of PRIVATE) assert.equal(dropped[f], undefined, `the untag route disclosed ${f}`)

  // a no-op tag call is the same: it returns the record unchanged, so it must redact it too
  const noop = call('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['manila'] }, w: asChatgpt, principal: CHATGPT })
  assert.deepEqual(noop.tags, ['manila'])
  for (const f of PRIVATE) assert.equal(noop[f], undefined, `a no-op tag call disclosed ${f}`)

  // reading is still refused outright, and the record itself is untouched
  fails('GET', `/api/records/contact_lead/${c.id}`, { w: asChatgpt, principal: CHATGPT }, 403)
  const whole = call('GET', `/api/records/contact_lead/${c.id}`)
  assert.equal(whole.email, CONTACT.email)
  assert.deepEqual(whole.tags, ['manila'])
})

test('with read as well, the same tag call hands back the whole record', () => {
  const { call, grant, contact } = fresh()
  const c = contact()
  grant('contact_lead', ['tag', 'read'])
  const tagged = call('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['manila'] }, w: asChatgpt, principal: CHATGPT })
  assert.equal(tagged.email, CONTACT.email)
  assert.equal(tagged.name, 'Dana Reyes')
  assert.equal(tagged.redacted, undefined)
})

test('a gate that denies read is obeyed by the routes that write', () => {
  const { call, fails, grant, contact } = fresh()
  const c = contact()
  grant('contact_lead', ['tag', 'note', 'update', 'status', 'read'])
  // the administrator takes reading away again, and leaves the writing grants standing
  call('POST', '/api/record-gates', { body: { record_type: 'contact_lead', subject_kind: 'agent', subject: 'chatgpt', action: 'read', mode: 'deny' } })
  fails('GET', `/api/records/contact_lead/${c.id}`, { w: asChatgpt, principal: CHATGPT }, 403)

  const as = { w: asChatgpt, principal: CHATGPT }
  const tagged = call('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['manila'] }, ...as })
  const noted = call('POST', `/api/records/contact_lead/${c.id}/notes`, { body: { text: 'met at the booth' }, ...as })
  const moved = call('POST', `/api/records/contact_lead/${c.id}/status`, { body: { status: 'contacted' }, ...as })
  const patched = call('PATCH', `/api/records/contact_lead/${c.id}`, { body: { patch: { organization: 'Northwind PH' } }, ...as })

  // every one of them did its work...
  assert.deepEqual(tagged.tags, ['solar', 'manila'])
  assert.equal(noted.note_count, 1)
  assert.equal(moved.status, 'contacted')
  assert.equal(patched.organization, 'Northwind PH') // the caller's own input, handed back
  // ...and not one of them read anything back to a caller a gate denies read
  for (const r of [tagged, noted, moved, patched]) {
    assert.equal(r.redacted, true)
    assert.equal(r.email, undefined)
    assert.equal(r.name, undefined)
    assert.equal(r.phone, undefined)
  }
  assert.equal(noted.notes, undefined)   // the note went in; the notes already there stay unseen
  assert.equal(tagged.status, undefined)
  // the record really did take all four writes
  const whole = call('GET', `/api/records/contact_lead/${c.id}`)
  assert.deepEqual(whole.tags, ['solar', 'manila'])
  assert.equal(whole.notes.length, 1)
  assert.equal(whole.status, 'contacted')
  assert.equal(whole.organization, 'Northwind PH')
})

// ------------------------------------------- every advertised action is one that can be run

/** How to exercise each action of a type, so the registry's promise is tested, not read. */
const SEED = {
  contact_lead: { project: 'crm', data: { type: 'person', name: 'Gen Test' }, patch: { organization: 'Northwind PH' }, next_status: 'contacted' },
  opportunity: { project: 'leads', data: { title: 'Gen Test' }, patch: { organization: 'Northwind PH' }, next_status: 'qualifying' },
}

test('every internal action a type advertises can actually be performed on that grant alone', () => {
  for (const def of [CONTACT_LEAD, OPPORTUNITY]) {
    const seed = SEED[def.type]
    for (const action of def.actions.filter((a) => INTERNAL_ACTIONS.includes(a))) {
      const { call, grant } = fresh()
      const rec = call('POST', `/api/records/${def.type}`, { body: { project: seed.project, owner: 'olive', data: seed.data } })
      grant(def.type, [action])
      const as = { w: asChatgpt, principal: CHATGPT }
      const where = `${def.type}.${action}`
      let out
      switch (action) {
        case 'read':
          out = call('GET', `/api/records/${def.type}`, { ...as, query: { project: seed.project } })
          assert.ok(out.some((r) => r.id === rec.id), where)
          break
        case 'create':
          out = call('POST', `/api/records/${def.type}`, { ...as, body: { project: seed.project, data: seed.data } })
          assert.match(out.id, new RegExp(`^${def.idPrefix}-`), where)
          break
        case 'update':
          out = call('PATCH', `/api/records/${def.type}/${rec.id}`, { ...as, body: { patch: seed.patch } })
          assert.equal(out.rev, rec.rev + 1, where)
          break
        case 'status':
          out = call('POST', `/api/records/${def.type}/${rec.id}/status`, { ...as, body: { status: seed.next_status } })
          assert.equal(out.status, seed.next_status, where)
          break
        case 'note':
          out = call('POST', `/api/records/${def.type}/${rec.id}/notes`, { ...as, body: { text: 'a drafted note' } })
          assert.equal(out.note_count, 1, where)
          break
        case 'tag':
          out = call('POST', `/api/records/${def.type}/${rec.id}/tags`, { ...as, body: { add: ['proposed'] } })
          assert.ok(out.tags.includes('proposed'), where)
          break
        case 'link': {
          // the field is the type's own links field, and the target a record of the type it links to
          const [field] = Object.keys(def.fields).filter((f) => def.fields[f].type === 'links')
          const target = SEED[def.fields[field].linkTo]
          const to = call('POST', `/api/records/${def.fields[field].linkTo}`, { body: { project: target.project, data: target.data } })
          out = call('POST', `/api/records/${def.type}/${rec.id}/links`, { ...as, body: { target_id: to.id, reason: 'seen at the same event' } })
          assert.deepEqual(out[field], [to.id], where)
          // and unlinking runs on the same grant, through the same default field
          const back = call('DELETE', `/api/records/${def.type}/${rec.id}/links`, { ...as, body: { target_id: to.id, reason: 'seen at the same event' } })
          assert.deepEqual(back[field], [], where)
          break
        }
        case 'dedupe_suggest':
          out = call('GET', `/api/records/${def.type}/dedupe-suggestions`, { ...as, query: { project: seed.project } })
          assert.equal(out.record_type, def.type, where)
          break
        default:
          assert.fail(`${where}: this test does not know how to perform ${action}`)
      }
      // a granted internal action is finished work: nothing was queued for a human
      assert.deepEqual(call('GET', '/api/record-approvals'), [], where)
    }
  }
})

test('the Contact CRM advertises no link action, and says so rather than failing on a field', () => {
  const { call, fails, contact } = fresh()
  const c = contact()
  const o = call('POST', '/api/records/opportunity', { body: { project: 'leads', owner: 'owen', data: { title: 'Rooftop 500kW' } } })

  // the registry does not offer it...
  const types = Object.fromEntries(call('GET', '/api/record-types').map((t) => [t.type, t]))
  assert.equal(types.contact_lead.actions.includes('link'), false)
  assert.equal(types.contact_lead.internal_actions.includes('link'), false)
  assert.equal(types.opportunity.actions.includes('link'), true)
  assert.equal(types.opportunity.operations.link, 'POST /api/records/:type/:id/links')

  // ...so it cannot be granted or gated, and the route says why instead of a field error
  const grantErr = fails('POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['link'] } }, 400)
  assert.match(grantErr.message, /no action link/)
  fails('POST', '/api/record-gates', { body: { record_type: 'contact_lead', subject_kind: 'agent', subject: 'chatgpt', action: 'link', mode: 'allow' } }, 400)
  const routeErr = fails('POST', `/api/records/contact_lead/${c.id}/links`, { body: { target_id: o.id } }, 400)
  assert.match(routeErr.message, /no action link/)

  // the cross-link lives on the Opportunity, and a link-only grant there really performs it
  call('POST', '/api/records/opportunity/acl', { body: { subject: 'chatgpt', actions: ['link'] } })
  const linked = call('POST', `/api/records/opportunity/${o.id}/links`, { body: { target_id: c.id, reason: 'same buyer' }, w: asChatgpt, principal: CHATGPT })
  assert.deepEqual(linked.contact_links, [c.id])   // no field named: the type's own links field
  assert.equal(linked.title, undefined)            // and still not a read grant
  // linking an Opportunity to a Contact is not a grant on Contacts
  fails('GET', '/api/records/contact_lead', { w: asChatgpt, principal: CHATGPT }, 403)
  fails('POST', `/api/records/contact_lead/${c.id}/tags`, { body: { add: ['x'] }, w: asChatgpt, principal: CHATGPT }, 403)
  // and the Contact itself was not touched by the link
  assert.equal(call('GET', `/api/records/contact_lead/${c.id}`).rev, c.rev)
})

// ------------------------------------------------------------------ over HTTP

const PEER = 'peer-secret-token'
const SECRET = { chatgpt: 'chatgpt-secret-token' }
const tokenList = [{ name: 'chatgpt', sha256: sha256(SECRET.chatgpt), scopes: ['read', 'send'], projects: ['*'] }]

let n = 0
async function pmNode() {
  const dir = join(DIR, `n${++n}`)
  const store = openStore(join(dir, 'pm.db'))
  const bridge = createBridge({
    machine: 'testbox', dbPath: join(dir, 'bridge.db'), peers: {}, policyPath: join(dir, 'policy.json'),
    tokenFile: join(dir, 'tokens.json'), replica: { intervalMs: 0 },
    auth: createAuth({ tokens: tokenList, peerToken: PEER, trustLoopback: true }),
    workers: { router: null, logDir: join(dir, 'logs') },
  })
  const server = createServer(store, { token: PEER, bridge })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  cleanups.push(() => { server.close(); bridge.stop(); store.close() })
  roles.assignRole(bridge.queue.db, { identity: 'user1', role: 'admin', by: 'test' })
  roles.assignRole(bridge.queue.db, { identity: 'chatgpt', role: 'worker', by: 'test' })
  return { url, bridge, store }
}

async function http(url, method, path, { body, as = null, actor = 'user1', model = null } = {}) {
  const res = await fetch(url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(as ? { authorization: `Bearer ${SECRET[as]}` } : {}),
      ...(actor ? { 'x-pm-actor': actor } : {}),
      ...(model ? { 'x-pm-model': model } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const AGENT = { as: 'chatgpt', actor: 'chatgpt', model: 'gpt-6' }

test('over HTTP: a token holding only `tag` tags, again and again, and never queues a human', async () => {
  const { url } = await pmNode()
  const made = await http(url, 'POST', '/api/records/contact_lead', { body: { project: 'crm', owner: 'olive', data: CONTACT } })
  assert.equal(made.status, 200, JSON.stringify(made.body))
  const id = made.body.id

  assert.equal((await http(url, 'POST', `/api/records/contact_lead/${id}/tags`, { ...AGENT, body: { add: ['manila'] } })).status, 403)

  const grant = await http(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['tag'] } })
  assert.equal(grant.status, 200, JSON.stringify(grant.body))

  for (const t of ['manila', 'rooftop', 'battery']) {
    const r = await http(url, 'POST', `/api/records/contact_lead/${id}/tags`, { ...AGENT, body: { add: [t] } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.ok(r.body.tags.includes(t))
  }
  const dropped = await http(url, 'DELETE', `/api/records/contact_lead/${id}/tags?tag=manila`, { ...AGENT, body: {} })
  assert.equal(dropped.status, 200, JSON.stringify(dropped.body))
  assert.deepEqual(dropped.body.tags, ['solar', 'rooftop', 'battery'])

  // not one of those tag calls asked a human for anything
  assert.deepEqual((await http(url, 'GET', '/api/record-approvals')).body, [])

  // the tag grant is not a write grant, not a read grant, and not a grant on Opportunities
  assert.equal((await http(url, 'PATCH', `/api/records/contact_lead/${id}`, { ...AGENT, body: { patch: { phone: '2' } } })).status, 403)
  assert.equal((await http(url, 'GET', '/api/records/contact_lead', AGENT)).status, 403)
  assert.equal((await http(url, 'GET', '/api/records/contact_lead/dedupe-suggestions', AGENT)).status, 403)

  // every tag entry says which model did it
  const log = (await http(url, 'GET', '/api/records/contact_lead/audit')).body.filter((e) => e.action === 'tag')
  assert.equal(log.length, 4)
  assert.equal(log.every((e) => e.actor === 'chatgpt' && e.model === 'gpt-6'), true)
})

test('over HTTP: a token holding only `dedupe_suggest` gets suggestions and nothing else', async () => {
  const { url } = await pmNode()
  const a = await http(url, 'POST', '/api/records/contact_lead', { body: { project: 'crm', owner: 'olive', data: CONTACT } })
  const b = await http(url, 'POST', '/api/records/contact_lead', { body: { project: 'crm', owner: 'olive', data: { ...CONTACT, name: 'D. Reyes', phone: '' } } })
  assert.equal(b.status, 200, JSON.stringify(b.body))

  assert.equal((await http(url, 'GET', '/api/records/contact_lead/dedupe-suggestions?project=crm', AGENT)).status, 403)
  await http(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['dedupe_suggest'] } })

  const out = await http(url, 'GET', '/api/records/contact_lead/dedupe-suggestions?project=crm', AGENT)
  assert.equal(out.status, 200, JSON.stringify(out.body))
  assert.equal(out.body.scanned, 2)
  assert.deepEqual(out.body.groups.find((g) => g.key === 'email').record_ids.sort(), [a.body.id, b.body.id].sort())

  // suggesting is not merging, tagging or reading the records themselves
  assert.equal((await http(url, 'PATCH', `/api/records/contact_lead/${b.body.id}`, { ...AGENT, body: { patch: { organization: 'merged' } } })).status, 403)
  assert.equal((await http(url, 'POST', `/api/records/contact_lead/${a.body.id}/tags`, { ...AGENT, body: { add: ['dupe'] } })).status, 403)
  assert.equal((await http(url, 'GET', '/api/records/contact_lead', AGENT)).status, 403)
  assert.deepEqual((await http(url, 'GET', '/api/record-approvals')).body, [])

  // both records are untouched, and the run is in the log under the model that asked
  const still = (await http(url, 'GET', '/api/records/contact_lead')).body
  assert.equal(still.length, 2)
  assert.equal(still.every((r) => r.rev === 1), true)
  const log = (await http(url, 'GET', '/api/records/contact_lead/audit')).body.filter((e) => e.action === 'dedupe_suggest')
  assert.equal(log.length, 1)
  assert.equal(log[0].model, 'gpt-6')
})

test('over HTTP: tagging stays internal - an export still waits for a human', async () => {
  const { url } = await pmNode()
  const made = await http(url, 'POST', '/api/records/contact_lead', { body: { project: 'crm', owner: 'olive', data: CONTACT } })
  await http(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['tag', 'dedupe_suggest', 'export'] } })

  assert.equal((await http(url, 'POST', `/api/records/contact_lead/${made.body.id}/tags`, { ...AGENT, body: { add: ['x'] } })).status, 200)
  const exported = await http(url, 'POST', '/api/records/contact_lead/export', { ...AGENT, body: { ids: [made.body.id], destination: 'csv' } })
  assert.equal(exported.status, 428)
  assert.ok(exported.body.approval_id)
  const queue = (await http(url, 'GET', '/api/record-approvals')).body
  assert.deepEqual(queue.map((q) => q.record_action), ['export'])
})

test('over HTTP: the tag route hands a tag-only token a receipt, never the contact', async () => {
  const { url } = await pmNode()
  const made = await http(url, 'POST', '/api/records/contact_lead', { body: { project: 'crm', owner: 'olive', data: CONTACT } })
  const id = made.body.id
  const granted = await http(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['tag'] } })
  assert.equal(granted.status, 200, JSON.stringify(granted.body))

  const r = await http(url, 'POST', `/api/records/contact_lead/${id}/tags`, { ...AGENT, body: { add: ['manila'] } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body.tags, ['solar', 'manila'])
  assert.equal(r.body.redacted, true)
  for (const f of PRIVATE) assert.equal(r.body[f], undefined, `the tag route sent ${f} over the wire`)
  // nothing of the person is anywhere in that response, under any key
  const wire = JSON.stringify(r.body)
  for (const secret of [CONTACT.email, CONTACT.phone, CONTACT.name, CONTACT.event_name]) {
    assert.equal(wire.includes(secret), false, `the tag response carried ${secret}`)
  }
  const dropped = await http(url, 'DELETE', `/api/records/contact_lead/${id}/tags?tag=manila`, { ...AGENT, body: {} })
  assert.equal(dropped.status, 200)
  assert.equal(JSON.stringify(dropped.body).includes(CONTACT.email), false)

  // the record is whole, and a caller who may read it still gets all of it
  const whole = await http(url, 'GET', `/api/records/contact_lead/${id}`)
  assert.equal(whole.body.email, CONTACT.email)
  assert.deepEqual(whole.body.tags, ['solar'])
})

// updateRecord is still the only way to change anything but tags: imported here so this file
// fails loudly if that separation is ever collapsed into the tag path.
test('updateRecord remains the write path for every other field', () => {
  const db = engineDb()
  const c = mkContact(db)
  const patched = updateRecord(db, CONTACT_LEAD, c.id, { patch: { organization: 'Northwind PH' }, actor: 'alice', now: T0 })
  assert.equal(patched.organization, 'Northwind PH')
  assert.deepEqual(patched.tags, ['solar'])
  assert.equal(auditLog(db, CONTACT_LEAD, { record_id: c.id, action: 'tag' }).length, 0)
  assert.equal(auditLog(db, CONTACT_LEAD, { record_id: c.id, action: 'update' }).length, 1)
})
