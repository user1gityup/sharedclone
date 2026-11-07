// node --test record-http.test.mjs   (run from the pm folder)
//
// The record routes over real HTTP, through the whole pm stack: bridge authentication,
// access.mjs authorization, then the per-type gates. Everything here is a fetch against a
// listening server, so what it proves is what a caller on the wire can and cannot do:
//   - a bridge token is its own agent and must name its model;
//   - a grant on one record type is never a grant on the other;
//   - an external action comes back 428 with a pm approval, and that approval is bound to
//     the requester, the project, the records and the destination, and is spent once.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'pm-records-http-'))
process.env.BRIDGE_TOKENS = join(DIR, 'bridge-tokens.json')
process.env.BRIDGE_PEERS = join(DIR, 'bridge-peers.json')
process.env.BRIDGE_POLICY = join(DIR, 'bridge-policy.json')
process.env.BRIDGE_DB = join(DIR, 'bridge-default.db')
process.env.PM_DB = join(DIR, 'pm-default.db')
process.env.PM_BRAIN_DIR = join(DIR, 'brain')
process.env.PM_BRAIN_AUDIT = join(DIR, 'brain-write-audit.jsonl')

const { createBridge } = await import('./bridge/index.mjs')
const { createAuth, sha256 } = await import('./bridge/auth.mjs')
const { openStore } = await import('./store.mjs')
const { createServer } = await import('./server.mjs')
const approvals = await import('./approvals.mjs')
const roles = await import('./roles.mjs')

const PEER = 'peer-secret-token'
const SECRET = { chatgpt: 'chatgpt-secret-token', scraper: 'scraper-secret-token' }
const tokenList = [
  { name: 'chatgpt', sha256: sha256(SECRET.chatgpt), scopes: ['read', 'send'], projects: ['*'] },
  { name: 'scraper', sha256: sha256(SECRET.scraper), scopes: ['read', 'send'], projects: ['*'] },
]

const cleanups = []
after(() => {
  for (const fn of cleanups.reverse()) { try { fn() } catch {} }
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

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
  const db = bridge.queue.db
  roles.assignRole(db, { identity: 'user1', role: 'admin', by: 'test' })
  roles.assignRole(db, { identity: 'chatgpt', role: 'worker', by: 'test' })
  roles.assignRole(db, { identity: 'scraper', role: 'worker', by: 'test' })
  return { url, bridge, store, db }
}

/**
 * One HTTP call. `as` is a token name, or null for this machine's own loopback user.
 * actor and model travel in the headers pm reads them from (x-pm-actor / x-pm-model).
 */
async function call(url, method, path, { body, as = null, actor = 'user1', model = null } = {}) {
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
const CONTACT = { type: 'person', name: 'Dana Reyes', email: 'dana@northwind.example', event_name: 'Expo', source_channel: 'booth' }

async function seed(url) {
  const c = await call(url, 'POST', '/api/records/contact_lead', { body: { project: 'crm', owner: 'olive', data: CONTACT } })
  assert.equal(c.status, 200, JSON.stringify(c.body))
  const o = await call(url, 'POST', '/api/records/opportunity', { body: { project: 'crm', owner: 'owen', data: { title: 'Rooftop 500kW' } } })
  assert.equal(o.status, 200, JSON.stringify(o.body))
  return { contact: c.body, opp: o.body }
}

test('over HTTP: a token is an agent, must name its model, and holds nothing until granted', async () => {
  const { url } = await pmNode()
  const { contact } = await seed(url)

  // no model: refused before anything is read or decided
  const bare = await call(url, 'GET', '/api/records/contact_lead', { as: 'chatgpt', actor: 'chatgpt' })
  assert.equal(bare.status, 400)
  assert.match(bare.body.error, /model is required/)

  // a worker role gets it through pm authorization, and then the record gate refuses it
  const ungranted = await call(url, 'GET', '/api/records/contact_lead', AGENT)
  assert.equal(ungranted.status, 403)

  // the administrator grants read on the Contact CRM only
  const grant = await call(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['read'] } })
  assert.equal(grant.status, 200, JSON.stringify(grant.body))
  const read = await call(url, 'GET', '/api/records/contact_lead', AGENT)
  assert.equal(read.status, 200)
  assert.equal(read.body.length, 1)
  assert.equal(read.body[0].id, contact.id)
  assert.equal(read.body[0].createdAt, contact.created_at)

  // and that grant says nothing about Opportunities, nor about writing
  assert.equal((await call(url, 'GET', '/api/records/opportunity', AGENT)).status, 403)
  assert.equal((await call(url, 'PATCH', `/api/records/contact_lead/${contact.id}`, { ...AGENT, body: { patch: { phone: '1' } } })).status, 403)

  // a token may not configure gates or ACLs: that is bridge_settings, an administrator's
  const gate = await call(url, 'POST', '/api/record-gates', {
    ...AGENT, body: { record_type: 'contact_lead', subject_kind: 'identity', subject: 'chatgpt', action: 'update', mode: 'allow' },
  })
  assert.equal(gate.status, 403)
  assert.equal((await call(url, 'POST', '/api/records/contact_lead/acl', { ...AGENT, body: { subject: 'chatgpt', actions: ['update'] } })).status, 403)
})

test('over HTTP: a granted internal action repeats without ever asking again', async () => {
  const { url } = await pmNode()
  const { contact } = await seed(url)
  await call(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['read', 'note', 'tag', 'update'] } })
  for (let i = 0; i < 3; i++) {
    const note = await call(url, 'POST', `/api/records/contact_lead/${contact.id}/notes`, { ...AGENT, body: { text: `pass ${i}` } })
    assert.equal(note.status, 200, JSON.stringify(note.body))
    assert.equal(note.body.notes.length, i + 1)
    assert.equal(note.body.notes[i].model, 'gpt-6')
  }
  // nothing was ever queued for a human
  const queue = await call(url, 'GET', '/api/record-approvals')
  assert.equal(queue.body.length, 0)
  // every entry the agent caused names the model that caused it
  const log = await call(url, 'GET', '/api/records/contact_lead/audit')
  assert.equal(log.body.filter((e) => e.actor === 'chatgpt').every((e) => e.model === 'gpt-6'), true)
  assert.ok(log.body.some((e) => e.action === 'note'))
})

test('over HTTP: an export waits for a human, then runs once, for that destination only', async () => {
  const { url, db } = await pmNode()
  const { contact } = await seed(url)
  await call(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['read', 'export'] } })

  const asked = await call(url, 'POST', '/api/records/contact_lead/export', { ...AGENT, body: { ids: [contact.id], destination: 'csv' } })
  assert.equal(asked.status, 428)
  const id = asked.body.approval_id
  assert.ok(id)
  const queued = await call(url, 'GET', '/api/record-approvals')
  assert.deepEqual(queued.body.map((a) => [a.record_type, a.record_action, a.destination, a.requested_by]),
    [['contact_lead', 'export', 'csv', 'chatgpt']])

  // the human decides it in pm (the pm UI / bridge approval route writes exactly this)
  approvals.decideApproval(db, id, { approver: 'user1', method: 'pm_ui', proof: { approver: 'user1' }, decision: 'approved' })

  // the approval is bound to what the human saw: another destination is a different question
  const elsewhere = await call(url, 'POST', '/api/records/contact_lead/export', { ...AGENT, body: { ids: [contact.id], destination: 'partner-sftp', approval_id: id } })
  assert.equal(elsewhere.status, 428)
  assert.notEqual(elsewhere.body.approval_id, id)

  // and to the identity that asked: another token cannot spend it
  await call(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'scraper', actions: ['export'] } })
  const stolen = await call(url, 'POST', '/api/records/contact_lead/export', {
    as: 'scraper', actor: 'scraper', model: 'gpt-6', body: { ids: [contact.id], destination: 'csv', approval_id: id },
  })
  assert.equal(stolen.status, 428)
  assert.notEqual(stolen.body.approval_id, id)

  // used exactly as approved, it runs - once
  const ran = await call(url, 'POST', '/api/records/contact_lead/export', { ...AGENT, body: { ids: [contact.id], destination: 'csv', approval_id: id } })
  assert.equal(ran.status, 200, JSON.stringify(ran.body))
  assert.equal(ran.body.records.length, 1)
  const replay = await call(url, 'POST', '/api/records/contact_lead/export', { ...AGENT, body: { ids: [contact.id], destination: 'csv', approval_id: id } })
  assert.equal(replay.status, 428)
  assert.notEqual(replay.body.approval_id, id)

  // exactly one export left pm, and the audit says under which approval
  const exported = (await call(url, 'GET', '/api/records/contact_lead/audit', { body: undefined })).body.filter((e) => e.action === 'export')
  assert.equal(exported.length, 1)
  assert.equal(exported[0].detail.approval_id, id)
  assert.equal(exported[0].detail.destination, 'csv')
  assert.equal(exported[0].model, 'gpt-6')
})

test('over HTTP: a project-scoped grant reaches neither another project nor the whole audit log', async () => {
  const { url } = await pmNode()
  const { contact } = await seed(url)
  const other = await call(url, 'POST', '/api/records/contact_lead', { body: { project: 'partners', owner: 'olive', data: { type: 'company', name: 'Acme' } } })
  assert.equal(other.status, 200)
  await call(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', project: 'crm', actions: ['read', 'export', 'bulk_delete'] } })

  // reads: its own project only
  assert.equal((await call(url, 'GET', '/api/records/contact_lead?project=crm', AGENT)).body.length, 1)
  assert.equal((await call(url, 'GET', '/api/records/contact_lead?project=partners', AGENT)).status, 403)
  assert.equal((await call(url, 'GET', '/api/records/contact_lead', AGENT)).status, 403)

  // the audit log: that project's entries, never the engine-wide ACL rows
  const scoped = await call(url, 'GET', '/api/records/contact_lead/audit?project=crm', AGENT)
  assert.equal(scoped.status, 200)
  assert.deepEqual([...new Set(scoped.body.map((e) => e.record_id))], [contact.id])
  assert.equal((await call(url, 'GET', '/api/records/contact_lead/audit', AGENT)).status, 403)
  assert.equal((await call(url, 'GET', `/api/records/contact_lead/audit?record_id=${other.body.id}`, AGENT)).status, 403)

  // a batch outside that project is refused, and one that claims the wrong project is refused too
  const outside = await call(url, 'POST', '/api/records/contact_lead/bulk-delete', { ...AGENT, body: { ids: [other.body.id] } })
  assert.equal(outside.status, 403)
  const claimed = await call(url, 'POST', '/api/records/contact_lead/bulk-delete', { ...AGENT, body: { ids: [other.body.id], project: 'crm' } })
  assert.equal(claimed.status, 400)
  assert.match(claimed.body.error, /not crm/)
  const spanning = await call(url, 'POST', '/api/records/contact_lead/bulk-delete', { ...AGENT, body: { ids: [contact.id, other.body.id] } })
  assert.equal(spanning.status, 400)
  assert.match(spanning.body.error, /spans projects/)

  // nothing was deleted by any of that
  const left = await call(url, 'GET', '/api/records/contact_lead')
  assert.equal(left.body.length, 2)
})
