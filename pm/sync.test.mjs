// node --test sync.test.mjs  — two in-memory stores synced through a fake fetch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from './store.mjs'
import { migrateSync, syncCounter } from './sync-schema.mjs'
import { createPmSync, routes } from './sync.mjs'

let tick = Date.parse('2026-10-19T00:00:00Z')
const clock = () => new Date((tick += 1000))
const W = { actor: 'sync-test', model: 'Claude Opus 5.5' }

function mkStore() {
  const s = openStore(':memory:', { clock })
  migrateSync(s.db)
  return s
}

/** Fake fetch: hosts map url -> store (or a function returning a Response-like). */
function fakeFetch(hosts, calls = []) {
  return async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers ?? {} })
    const u = new URL(url)
    const target = hosts[u.origin]
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
    if (typeof target === 'function') return target(u)
    if (!target) return reply(502, { error: `no host ${u.origin}` })
    const r = routes(target.db, null).find(([m, re]) => m === 'GET' && re.test(u.pathname))
    if (!r) return reply(404, { error: 'no route' })
    return reply(200, JSON.parse(JSON.stringify(await r[2](u.pathname.match(r[1]), null, null, Object.fromEntries(u.searchParams)))))
  }
}

function pair() {
  const A = mkStore(), B = mkStore()
  const hosts = { 'http://a': A, 'http://b': B }
  const calls = []
  const f = fakeFetch(hosts, calls)
  const peers = { a: { url: 'http://a', token: 'tok-a' }, b: { url: 'http://b/' } }
  const syncA = createPmSync(A.db, peers, { fetchImpl: f, self: ['http://a'], intervalMs: 0, pageSize: 2 })
  const syncB = createPmSync(B.db, peers, { fetchImpl: f, self: ['http://b'], intervalMs: 0, pageSize: 2 })
  return { A, B, hosts, calls, syncA, syncB }
}

const titles = (s) => s.listTasks({}).map((t) => t.title).sort()

test('self-url filtering keeps only the other peer, trailing slash normalised', () => {
  const { syncA, syncB } = pair()
  assert.deepEqual(syncA.peers.map((p) => p.url), ['http://b'])
  assert.deepEqual(syncB.peers.map((p) => p.url), ['http://a'])
})

test('A creates project + 3 tasks -> B pulls them (paged); bearer token sent', async () => {
  const { A, B, calls, syncB } = pair()
  A.createProject(W, { name: 'alpha' })
  for (const t of ['one', 'two', 'three']) A.createTask(W, { project: 'alpha', title: t })
  const [r] = await syncB.syncAll()
  assert.equal(r.ok, true, r.last_error)
  assert.ok(r.totals.pages >= 2, 'pageSize 2 forces paging')
  assert.ok(B.listProjects().some((p) => p.name === 'alpha'))
  assert.deepEqual(titles(B), ['one', 'three', 'two'])
  assert.equal(calls[0].headers.authorization, 'Bearer tok-a')
})

test('B edits a task -> A pulls -> A updated', async () => {
  const { A, B, syncA, syncB } = pair()
  A.createProject(W, { name: 'alpha' })
  const t = A.createTask(W, { project: 'alpha', title: 'edit me' })
  await syncB.syncAll()
  const bt = B.getTask(t.id)
  B.updateTask(W, t.id, { rev: bt.rev, title: 'edited on B', status: 'in_progress' })
  const [r] = await syncA.syncAll()
  assert.equal(r.ok, true, r.last_error)
  const at = A.getTask(t.id)
  assert.equal(at.title, 'edited on B')
  assert.equal(at.status, 'in_progress')
})

test('idle repeated syncs converge: counters stop growing', async () => {
  const { A, B, syncA, syncB } = pair()
  A.createProject(W, { name: 'alpha' })
  for (const t of ['x', 'y', 'z']) A.createTask(W, { project: 'alpha', title: t })
  B.createProject(W, { name: 'beta' })
  B.createTask(W, { project: 'beta', title: 'b1' })
  for (let i = 0; i < 3; i++) { await syncA.syncAll(); await syncB.syncAll() }
  const before = [syncCounter(A.db), syncCounter(B.db)]
  for (let i = 0; i < 3; i++) { await syncA.syncAll(); await syncB.syncAll() }
  assert.deepEqual([syncCounter(A.db), syncCounter(B.db)], before, 'no growth loop')
  assert.deepEqual(titles(A), titles(B))
  assert.deepEqual(titles(A), ['b1', 'x', 'y', 'z'])
})

test('peer counter reset (fresh DB) is re-read from 0', async () => {
  const { A, B, hosts, syncA } = pair()
  B.createProject(W, { name: 'beta' })
  for (const t of ['b1', 'b2', 'b3', 'b4']) B.createTask(W, { project: 'beta', title: t })
  await syncA.syncAll()
  const cursor = syncA.status()[0].after
  assert.ok(cursor > 0)
  const C = mkStore() // b's database recreated
  C.createProject(W, { name: 'gamma' })
  hosts['http://b'] = C
  assert.ok(syncCounter(C.db) < cursor, 'fresh peer counter is below our cursor')
  const [r] = await syncA.syncAll()
  assert.equal(r.ok, true, r.last_error)
  assert.ok(A.listProjects().some((p) => p.name === 'gamma'), 'gamma pulled after reset')
  assert.ok(r.after <= syncCounter(C.db))
})

test('peer HTTP error is recorded in status, not thrown; recovery clears ok', async () => {
  const { A, B, hosts, syncA } = pair()
  const real = hosts['http://b']
  hosts['http://b'] = () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'down for maintenance' })
  const [r] = await syncA.syncAll()
  assert.equal(r.ok, false)
  assert.match(r.last_error, /HTTP 503: down for maintenance/)
  const st = syncA.status()[0]
  assert.equal(st.ok, false)
  assert.ok(st.last_error_at)
  hosts['http://b'] = () => { throw new Error('ECONNREFUSED') }
  const [r2] = await syncA.syncAll()
  assert.equal(r2.ok, false)
  assert.match(r2.last_error, /ECONNREFUSED/)
  hosts['http://b'] = real
  B.createProject(W, { name: 'beta' })
  const [r3] = await syncA.syncAll()
  assert.equal(r3.ok, true)
  assert.ok(r3.last_ok_at)
  assert.ok(A.listProjects().some((p) => p.name === 'beta'))
})

test('busy guard: overlapping syncAll returns [] for the second call', async () => {
  const A = mkStore()
  let release
  const gate = new Promise((r) => { release = r })
  const f = async () => { await gate; return { ok: true, status: 200, json: async () => ({ chg: 0, rows: [] }), text: async () => '' } }
  const s = createPmSync(A.db, { b: { url: 'http://b' } }, { fetchImpl: f, intervalMs: 0 })
  const first = s.syncAll()
  assert.deepEqual(await s.syncAll(), [])
  release()
  assert.equal((await first)[0].ok, true)
})

test('routes: status and now', async () => {
  const { A, syncA } = pair()
  A.createProject(W, { name: 'alpha' })
  const r = routes(A.db, syncA)
  const find = (m, p) => r.find(([mm, re]) => mm === m && re.test(p))
  const st = await find('GET', '/api/sync/status')[2]([], null, null, {})
  assert.equal(st.chg, syncCounter(A.db))
  assert.equal(st.peers.length, 1)
  const now = await find('POST', '/api/sync/now')[2]([], {}, null, {})
  assert.ok(Array.isArray(now))
  const ch = await find('GET', '/api/sync/changes')[2]([], null, null, { after: '0', limit: '10' })
  assert.ok(Array.isArray(ch.rows) && ch.rows.length >= 1)
  assert.deepEqual(routes(A.db, null)[1][2](), { chg: syncCounter(A.db), peers: [] })
})
