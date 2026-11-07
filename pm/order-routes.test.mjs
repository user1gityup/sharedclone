// node --test order-routes.test.mjs - S4 order HTTP routes + permissions (Claude Opus (S4)).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = mkdtempSync(join(tmpdir(), 'pm-order-routes-test-'))
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
const HAS_DRAFTS = existsSync(join(dirname(fileURLToPath(import.meta.url)), 'order-drafts.mjs'))

const PEER = 'peer-secret-token'
const NAMES = ['cli', 'wrk', 'scopedwrk', 'mgr', 'adm']
const TOKENS = Object.fromEntries(NAMES.map((n) => [n, { secret: `${n}-secret`, scopes: ['send', 'read'], projects: ['*'] }]))
const tokenList = Object.entries(TOKENS).map(([name, t]) => ({ name, sha256: sha256(t.secret), scopes: t.scopes, projects: t.projects }))
const W = { actor: 'tester', model: 'claude-opus-5-5' }

const cleanups = []
after(() => {
  for (const fn of cleanups.reverse()) { try { fn() } catch {} }
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

let n = 0
async function pmNode() {
  const dir = join(DIR, `b${++n}`)
  const bridge = createBridge({
    machine: 'testbox', dbPath: join(dir, 'bridge.db'), peers: {}, policyPath: join(dir, 'policy.json'),
    tokenFile: join(dir, 'tokens.json'), replica: { intervalMs: 0 },
    auth: createAuth({ tokens: tokenList, peerToken: PEER, trustLoopback: true }),
    workers: { router: null, logDir: join(dir, 'logs') },
  })
  const store = openStore(join(DIR, `pm${n}.db`))
  const server = createServer(store, { token: PEER, bridge })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  cleanups.push(() => { server.close(); bridge.stop(); store.close() })
  const db = bridge.queue.db
  const a = store.createProject(W, { name: 'alpha' })
  const b = store.createProject(W, { name: 'bravo' })
  const t1 = store.createTask(W, { project: a.id, title: 't1', priority: 1 })
  const t2 = store.createTask(W, { project: a.id, title: 't2', priority: 2 })
  const t3 = store.createTask(W, { project: b.id, title: 't3', priority: 1 })
  roles.assignRole(db, { identity: 'cli', role: 'client', by: 'test' })
  roles.assignRole(db, { identity: 'wrk', role: 'worker', by: 'test' })
  roles.assignRole(db, { identity: 'scopedwrk', role: 'worker', project: a.id, by: 'test' })
  roles.assignRole(db, { identity: 'mgr', role: 'manager', project: a.id, by: 'test' })
  roles.assignRole(db, { identity: 'adm', role: 'admin', by: 'test' })
  return { url, store, db, a, b, t1, t2, t3 }
}

async function call(url, method, path, body, token) {
  const secret = token == null ? null : token === 'peer' ? PEER : TOKENS[token].secret
  const res = await fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const rev = async (url, scope) => (await call(url, 'GET', `/api/order?scope=${scope}`)).body.rev

test('reads: every role (client included) may GET order, flat, history, capabilities', async () => {
  const { url, a } = await pmNode()
  for (const who of [null, 'cli', 'wrk', 'mgr']) {
    const top = await call(url, 'GET', '/api/order?scope=top', undefined, who)
    assert.equal(top.status, 200, `${who} top`)
    assert.deepEqual(top.body.items.map((i) => i.name), ['alpha', 'bravo'])
    assert.equal((await call(url, 'GET', `/api/order?scope=project:${a.id}`, undefined, who)).status, 200)
    assert.equal((await call(url, 'GET', `/api/order/flat?project=${a.id}`, undefined, who)).status, 200)
    assert.equal((await call(url, 'GET', '/api/order/history?scope=top&limit=5', undefined, who)).status, 200)
  }
  assert.deepEqual((await call(url, 'GET', '/api/order/capabilities?role=client', undefined, 'cli')).body, { role: 'client', can_reorder: false })
  for (const r of ['worker', 'manager', 'admin']) assert.equal((await call(url, 'GET', `/api/order/capabilities?role=${r}`)).body.can_reorder, true)
  assert.equal((await call(url, 'GET', '/api/order/capabilities?role=bogus')).status, 400)
})

test('client: 403 on every order write, including draft create/commit/discard', async () => {
  const { url, a, b, t1 } = await pmNode()
  const r0 = await rev(url, 'top')
  const writes = [
    ['PUT', '/api/order/top', { base_rev: r0, ids: [b.id, a.id] }],
    ['POST', '/api/order/top/move', { base_rev: r0, id: b.id, to_index: 0 }],
    ['PUT', `/api/order/project/${a.id}`, { base_rev: 0, ids: [] }],
    ['POST', `/api/order/project/${a.id}/move`, { base_rev: 0, id: t1.id, to_index: 1 }],
    ['POST', `/api/order/override/${t1.id}`, { override: true, base_rev_top: r0, base_rev_project: 0 }],
    ['POST', '/api/order/drafts', { scope: 'top', base_rev: r0, ids: [b.id, a.id] }],
    ['POST', `/api/order/drafts/${'D-nope'}/commit`, {}],
    ['DELETE', `/api/order/drafts/${'D-nope'}`, undefined],
  ]
  for (const [m, p, body] of writes) assert.equal((await call(url, m, p, body, 'cli')).status, 403, `${m} ${p}`)
  assert.equal(await rev(url, 'top'), r0, 'nothing changed')
})

test('worker: top + project writes 200; actor forced to the principal; history records it', async () => {
  const { url, a, b, t1, t2 } = await pmNode()
  const put = await call(url, 'PUT', '/api/order/top', { base_rev: await rev(url, 'top'), ids: [b.id, a.id], mode: 'manual', actor: 'spoof' }, 'wrk')
  assert.equal(put.status, 200)
  assert.deepEqual(put.body.items.map((i) => i.id), [b.id, a.id])
  const mv = await call(url, 'POST', `/api/order/project/${a.id}/move`, { base_rev: await rev(url, `project:${a.id}`), id: t2.id, to_index: 0, mode: 'autosave' }, 'wrk')
  assert.equal(mv.status, 200)
  assert.deepEqual(mv.body.items.map((i) => i.id), [t2.id, t1.id])
  const hist = await call(url, 'GET', '/api/order/history?scope=top', undefined, 'wrk')
  assert.equal(hist.status, 200)
  assert.equal(hist.body[0].actor, 'wrk')
  assert.equal(hist.body[0].data.mode, 'manual')
  // stale base_rev -> 409 with current + rejected
  const stale = await call(url, 'PUT', '/api/order/top', { base_rev: 0, ids: [a.id, b.id] }, 'wrk')
  assert.equal(stale.status, 409)
  assert.ok(stale.body.current && stale.body.rejected)
})

test('scoped worker: own project 200, top 403; manager: own project 200 (id or name), other 403, top 200', async () => {
  const { url, a, b, t1, t2, t3 } = await pmNode()
  assert.equal((await call(url, 'POST', `/api/order/project/${a.id}/move`, { base_rev: await rev(url, `project:${a.id}`), id: t2.id, to_index: 0 }, 'scopedwrk')).status, 200)
  assert.equal((await call(url, 'POST', '/api/order/top/move', { base_rev: await rev(url, 'top'), id: b.id, to_index: 0 }, 'scopedwrk')).status, 403)

  assert.equal((await call(url, 'POST', `/api/order/project/${a.id}/move`, { base_rev: await rev(url, `project:${a.id}`), id: t1.id, to_index: 0 }, 'mgr')).status, 200)
  assert.equal((await call(url, 'PUT', '/api/order/project/alpha', { base_rev: await rev(url, `project:${a.id}`), ids: [t2.id, t1.id] }, 'mgr')).status, 200)
  assert.equal((await call(url, 'PUT', `/api/order/project/${b.id}`, { base_rev: await rev(url, `project:${b.id}`), ids: [t3.id] }, 'mgr')).status, 403)
  assert.equal((await call(url, 'POST', '/api/order/top/move', { base_rev: await rev(url, 'top'), id: b.id, to_index: 0 }, 'mgr')).status, 200)
  // override is checked against the task's project
  assert.equal((await call(url, 'POST', `/api/order/override/${t3.id}`, { override: true, base_rev_top: await rev(url, 'top'), base_rev_project: await rev(url, `project:${b.id}`) }, 'mgr')).status, 403)
  const ov = await call(url, 'POST', `/api/order/override/${t1.id}`, { override: true, base_rev_top: await rev(url, 'top'), base_rev_project: await rev(url, `project:${a.id}`) }, 'mgr')
  assert.equal(ov.status, 200)
  // drafts: manager may not draft another project's scope
  assert.equal((await call(url, 'POST', '/api/order/drafts', { scope: `project:${b.id}`, base_rev: await rev(url, `project:${b.id}`), ids: [t3.id] }, 'mgr')).status, 403)
})

test('loopback and peer unchanged: full access, caller actor kept', async () => {
  const { url, a, b } = await pmNode()
  const r = await call(url, 'PUT', '/api/order/top', { base_rev: await rev(url, 'top'), ids: [b.id, a.id], actor: 'Claude Opus 5.5' })
  assert.equal(r.status, 200)
  const p = await call(url, 'PUT', '/api/order/top', { base_rev: await rev(url, 'top'), ids: [a.id, b.id], actor: 'peerbot' }, 'peer')
  assert.equal(p.status, 200)
  const hist = (await call(url, 'GET', '/api/order/history?scope=top')).body
  assert.equal(hist[0].actor, 'peerbot')
  assert.equal(hist[1].actor, 'Claude Opus 5.5')
  assert.equal((await call(url, 'GET', '/api/order?scope=project:nope')).status, 404)
})

test('drafts: worker create -> get -> commit; discard; client 403 on commit of a real draft', { skip: !HAS_DRAFTS && 'order-drafts.mjs (S6) not present yet' }, async () => {
  const { url, a, b } = await pmNode()
  const made = await call(url, 'POST', '/api/order/drafts', { scope: 'top', base_rev: await rev(url, 'top'), ids: [b.id, a.id] }, 'wrk')
  assert.equal(made.status, 200, JSON.stringify(made.body))
  const id = made.body.draft?.id ?? made.body.id
  assert.ok(id)
  assert.equal((await call(url, 'GET', `/api/order/drafts/${id}`, undefined, 'cli')).status, 200)
  assert.equal((await call(url, 'POST', `/api/order/drafts/${id}/commit`, {}, 'cli')).status, 403)
  const c = await call(url, 'POST', `/api/order/drafts/${id}/commit`, {}, 'wrk')
  assert.equal(c.status, 200, JSON.stringify(c.body))
  const d2 = await call(url, 'POST', '/api/order/drafts', { scope: 'top', base_rev: await rev(url, 'top'), ids: [a.id, b.id] }, 'adm')
  assert.equal(d2.status, 200)
  assert.equal((await call(url, 'DELETE', `/api/order/drafts/${d2.body.draft?.id ?? d2.body.id}`, undefined, 'adm')).status, 200)
})
