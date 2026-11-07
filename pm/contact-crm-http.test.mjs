// node --test contact-crm-http.test.mjs   (run from the pm folder)
// The Contact CRM routes (L6b) over real HTTP, through bridge authentication, access.mjs and the
// per-type gates: links visible from both sides, conversion refused, settings admin-only, import,
// and the admin page that carries the affordance.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = mkdtempSync(join(tmpdir(), 'pm-contact-crm-http-'))
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
const roles = await import('./roles.mjs')

const PEER = 'peer-secret-token'
const SECRET = { chatgpt: 'chatgpt-secret-token' }
const tokenList = [{ name: 'chatgpt', sha256: sha256(SECRET.chatgpt), scopes: ['read', 'send'], projects: ['*'] }]

const cleanups = []
after(() => {
  for (const fn of cleanups.reverse()) { try { fn() } catch {} }
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

async function pmNode() {
  const dir = join(DIR, 'n1')
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
  return { url }
}

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

test('over HTTP: links are visible and removable from both sides, audited on both, and conversion is refused', async () => {
  const { url } = await pmNode()
  const c = (await call(url, 'POST', '/api/records/contact_lead', { body: { project: 'crm', data: { type: 'person', name: 'Dana Reyes', email: 'dana@northwind.example' } } })).body
  const o = (await call(url, 'POST', '/api/records/opportunity', { body: { project: 'crm', data: { title: 'Rooftop 500kW' } } })).body

  const bare = await call(url, 'POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id } })
  assert.equal(bare.status, 400)
  const made = await call(url, 'POST', '/api/record-links', { body: { opportunity_id: o.id, contact_id: c.id, reason: 'signs the bid', link_type: 'decision_maker' } })
  assert.equal(made.status, 200, JSON.stringify(made.body))
  assert.equal(made.body.link.created_by, 'user1')

  const fromContact = await call(url, 'GET', `/api/records/contact_lead/${c.id}/opportunities`)
  assert.equal(fromContact.status, 200)
  assert.equal(fromContact.body[0].opportunity_id, o.id)
  const fromOpp = await call(url, 'GET', `/api/records/opportunity/${o.id}/contacts`)
  assert.equal(fromOpp.body[0].contact_id, c.id)

  const cAudit = await call(url, 'GET', `/api/records/contact_lead/audit?record_id=${c.id}`)
  assert.equal(cAudit.status, 200, JSON.stringify(cAudit.body))
  assert.ok(cAudit.body.some((e) => e.action === 'link' && e.detail.reason === 'signs the bid'))
  const oAudit = await call(url, 'GET', `/api/records/opportunity/audit?record_id=${o.id}`)
  assert.ok(oAudit.body.some((e) => e.action === 'link' && e.detail.reason === 'signs the bid'))

  for (const verb of ['convert', 'promote', 'copy-as']) {
    for (const path of [`/api/records/contact_lead/${c.id}/${verb}`, `/api/records/opportunity/${o.id}/${verb}`]) {
      const r = await call(url, 'POST', path, { body: {} })
      assert.equal(r.status, 400, path)
      assert.match(r.body.error, /never converted/)
    }
  }

  const gone = await call(url, 'DELETE', `/api/records/contact_lead/${c.id}/opportunities/${o.id}`)
  assert.equal(gone.status, 200)
  assert.equal((await call(url, 'GET', `/api/records/opportunity/${o.id}/contacts`)).body.length, 0)
  assert.ok((await call(url, 'GET', `/api/records/contact_lead/audit?record_id=${c.id}`)).body.some((e) => e.action === 'unlink'))
})

test('over HTTP: settings are admin-only, an agent needs model + grant to import, and the admin page carries the affordance', async () => {
  const { url } = await pmNode()
  const put = await call(url, 'PUT', '/api/contact-crm/settings', { body: { default_owner: 'olive', retention: { days: 90 } } })
  assert.equal(put.status, 200, JSON.stringify(put.body))
  assert.equal(put.body.rev, 1)
  assert.equal((await call(url, 'PUT', '/api/contact-crm/settings', { body: { default_owner: 'chatgpt' }, ...AGENT })).status, 403)

  const rows = [{ name: 'Ana Cruz', email: 'ana@solis.example' }]
  assert.equal((await call(url, 'POST', '/api/contact-crm/import', { body: { source: 'spreadsheet', rows }, ...AGENT })).status, 403) // no grant yet
  await call(url, 'POST', '/api/records/contact_lead/acl', { body: { subject: 'chatgpt', actions: ['create', 'read'] } })
  const imp = await call(url, 'POST', '/api/contact-crm/import', { body: { source: 'spreadsheet', rows }, ...AGENT })
  assert.equal(imp.status, 200, JSON.stringify(imp.body))
  assert.equal(imp.body.created.length, 1)
  const list = await call(url, 'GET', '/api/records/contact_lead', AGENT)
  assert.equal(list.body[0].owner, 'olive')
  assert.equal(list.body[0].created_model, 'gpt-6')

  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'public', 'records.html'), 'utf8')
  for (const needle of ['/api/contact-crm/settings', '/api/contact-crm/import', '/api/record-links', '/opportunities', '/contacts', 'id="link-table"', 'id="crm-form"']) {
    assert.ok(page.includes(needle), `records.html mentions ${needle}`)
  }
  const served = await fetch(url + '/records')
  assert.equal(served.status, 200)
  assert.match(await served.text(), /Contact &harr; Opportunity links/)
})
