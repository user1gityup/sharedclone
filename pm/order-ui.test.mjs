// node --test order-ui.test.mjs - A1b top-order sorter in public/index.html (Claude Opus 5.5).
// Pure sorter logic is read from the CORE block of index.html; the HTTP half drives the same
// calls the page makes (GET /api/order, PUT /api/order/top, POST /api/order/override/:id).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = mkdtempSync(join(tmpdir(), 'pm-order-ui-test-'))
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

const HTML = readFileSync(join(HERE, 'public', 'index.html'), 'utf8')
const CORE = HTML.slice(HTML.indexOf('/*CORE-BEGIN*/'), HTML.indexOf('/*CORE-END*/'))
const ui = new Function(`${CORE}; return { orderRows, orderMove, orderStep, orderErrorText, roleCan, stepIds, sortTasks }`)()

test('stepIds: one-step swap inside a scope, null at the ends or for an unknown id', () => {
  assert.deepEqual(ui.stepIds(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(ui.stepIds(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b'])
  assert.equal(ui.stepIds(['a', 'b'], 'a', -1), null)
  assert.equal(ui.stepIds(['a', 'b'], 'b', 1), null)
  assert.equal(ui.stepIds(['a'], 'z', 1), null)
})

test('sortTasks manual keeps the server global order and ignores direction', () => {
  const xs = [{ id: 'b', updated_at: '2026-01-01' }, { id: 'a', updated_at: '2026-09-01' }]
  assert.deepEqual(ui.sortTasks(xs, 'manual', 'desc').map((t) => t.id), ['b', 'a'])
  assert.deepEqual(ui.sortTasks(xs, 'manual', 'asc').map((t) => t.id), ['b', 'a'])
  assert.deepEqual(ui.sortTasks(xs, 'updated_at', 'desc').map((t) => t.id), ['a', 'b'])
})

const P = (id) => ({ id, pinned: false })
const T = (id) => ({ id, pinned: true })
const ids = (xs) => xs.map((x) => x.id)

test('orderRows: projects free, task overrides pinned, title used as name', () => {
  const rows = ui.orderRows({ items: [{ kind: 'project', id: 'P-1', name: 'alpha' }, { kind: 'task', id: 'T-1', title: 'fix', project_id: 'P-1' }] })
  assert.deepEqual(rows, [
    { kind: 'project', id: 'P-1', name: 'alpha', project_id: null, pinned: false },
    { kind: 'task', id: 'T-1', name: 'fix', project_id: 'P-1', pinned: true },
  ])
  assert.deepEqual(ui.orderRows(null), [])
})

test('orderMove: plain move, clamping, no-op and pinned source', () => {
  const xs = [P('a'), P('b'), P('c'), P('d')]
  assert.deepEqual(ui.orderMove(xs, 3, 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(ui.orderMove(xs, 0, 99), ['b', 'c', 'd', 'a'])
  assert.deepEqual(ui.orderMove(xs, 2, -5), ['c', 'a', 'b', 'd'])
  assert.equal(ui.orderMove(xs, 1, 1), null)
  assert.equal(ui.orderMove([P('a'), T('t'), P('b')], 1, 0), null, 'a pinned row never moves')
  assert.equal(ui.orderMove(xs, 9, 0), null)
})

test('orderMove: pinned rows keep their index; others flow around them', () => {
  const xs = [P('a'), T('t'), P('b'), P('c')]
  assert.deepEqual(ui.orderMove(xs, 3, 0), ['c', 't', 'a', 'b'])
  assert.deepEqual(ui.orderMove(xs, 0, 3), ['b', 't', 'c', 'a'])
  // dropping onto the pinned slot skips past it in the direction of travel
  assert.deepEqual(ui.orderMove(xs, 0, 1), ['b', 't', 'a', 'c'])
  assert.deepEqual(ui.orderMove(xs, 3, 1), ['c', 't', 'a', 'b'])
  assert.equal(ui.orderMove([P('a'), T('t')], 0, 1), null, 'no free slot past the pin')
  for (const [f, t] of [[0, 3], [3, 0], [2, 0], [0, 2]]) assert.equal(ui.orderMove(xs, f, t).indexOf('t'), 1)
})

test('orderStep: ▲/▼ hop over pinned rows and stop at the ends', () => {
  const xs = [P('a'), T('t'), P('b')]
  assert.deepEqual(ui.orderStep(xs, 2, -1), ['b', 't', 'a'])
  assert.deepEqual(ui.orderStep(xs, 0, 1), ['b', 't', 'a'])
  assert.equal(ui.orderStep(xs, 0, -1), null)
  assert.equal(ui.orderStep(xs, 2, 1), null)
})

test('orderErrorText: names the action; a 409 names the revision it reloaded', () => {
  assert.equal(ui.orderErrorText(Object.assign(new Error('nope'), { status: 403 }), 'Move'), 'Move failed: nope')
  const e = Object.assign(new Error('order top changed'), { status: 409, data: { current: { rev: 7, items: [] } } })
  assert.match(ui.orderErrorText(e, 'Move'), /Move failed: order top changed Reloaded revision 7/)
})

test('roles: manager and worker may reorder in the UI, client may not', () => {
  assert.equal(ui.roleCan('admin', 'reorder'), true)
  assert.equal(ui.roleCan('manager', 'reorder'), true)
  assert.equal(ui.roleCan('worker', 'reorder'), true)
  assert.equal(ui.roleCan('client', 'reorder'), false)
})

test('page wiring: Top order nav, real routes, errors surfaced', () => {
  assert.match(HTML, /\['order', 'Top order', 'list'\]/)
  assert.match(HTML, /order: viewOrder/)
  assert.match(HTML, /api\('GET', '\/api\/order' \+ buildQuery\(\{ scope: 'top' \}\)\)/)
  assert.match(HTML, /api\('PUT', '\/api\/order\/top', \{ base_rev: S\.order\.rev, ids, mode: 'manual' \}\)/)
  assert.match(HTML, /api\('POST', `\/api\/order\/override\/\$\{encodeURIComponent\(tid\)\}`/)
  assert.match(HTML, /class="oerr" role="alert"/)
  // every order write path reports failures through orderFail (toast + inline banner)
  for (const fn of ['saveOrder', 'orderPin']) {
    const body = HTML.slice(HTML.indexOf(`async function ${fn}(`), HTML.indexOf('\n}\n', HTML.indexOf(`async function ${fn}(`)))
    assert.match(body, /catch \(e\) \{\s*orderFail\(e,/, `${fn} must surface errors`)
  }
  // A1b row order: handle, pin, arrows, position, name
  const row = HTML.slice(HTML.indexOf('function orderRowHtml('), HTML.indexOf('function viewOrder('))
  const at = (s) => row.indexOf(s, row.indexOf('<li><div class="orow'))
  const seq = ['class="handle"', 'class="pinbtn', 'class="arrows"', 'class="pos"', 'class="name"'].map(at)
  assert.ok(seq.every((v, i) => v > 0 && (i === 0 || v > seq[i - 1])), `row order ${seq}`)
})

// ---------- HTTP: the calls the page makes, against a real pm server ----------
const PEER = 'peer-secret-token'
const TOKENS = { cli: { secret: 'cli-secret' }, mgr: { secret: 'mgr-secret' } }
const tokenList = Object.entries(TOKENS).map(([name, t]) => ({ name, sha256: sha256(t.secret), scopes: ['send', 'read'], projects: ['*'] }))
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
  cleanups.push(() => { server.close(); bridge.stop(); store.close() })
  const ps = ['alpha', 'bravo', 'charlie'].map((name) => store.createProject(W, { name }))
  const t1 = store.createTask(W, { project: ps[0].id, title: 'pin me', priority: 1 })
  roles.assignRole(bridge.queue.db, { identity: 'cli', role: 'client', by: 'test' })
  roles.assignRole(bridge.queue.db, { identity: 'mgr', role: 'manager', project: ps[0].id, by: 'test' })
  return { url: `http://127.0.0.1:${server.address().port}`, ps, t1 }
}
// same headers as buildApiHeaders in the page
async function call(url, method, path, body, token) {
  const res = await fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-pm-actor': 'Claude Opus 5.5', ...(token ? { authorization: `Bearer ${TOKENS[token].secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

test('HTTP: manager sorts the top list, pins a task that keeps its place, unpins it', async () => {
  const { url, ps, t1 } = await pmNode()
  let top = (await call(url, 'GET', '/api/order?scope=top', undefined, 'mgr')).body
  assert.deepEqual(ids(top.items), ps.map((p) => p.id))

  // ▼ on alpha
  let next = ui.orderStep(ui.orderRows(top), 0, 1)
  let r = await call(url, 'PUT', '/api/order/top', { base_rev: top.rev, ids: next, mode: 'manual' }, 'mgr')
  assert.equal(r.status, 200, JSON.stringify(r.body))
  top = r.body
  assert.deepEqual(ids(top.items), [ps[1].id, ps[0].id, ps[2].id])

  // pin t1 right after its project (index 1 -> to_index 2)
  const proj = (await call(url, 'GET', `/api/order?scope=project:${ps[0].id}`, undefined, 'mgr')).body
  r = await call(url, 'POST', `/api/order/override/${t1.id}`, { override: true, base_rev_top: top.rev, base_rev_project: proj.rev, to_index: 2, mode: 'manual' }, 'mgr')
  assert.equal(r.status, 200, JSON.stringify(r.body))
  top = r.body.top
  assert.deepEqual(ids(top.items), [ps[1].id, ps[0].id, t1.id, ps[2].id])
  assert.equal(ui.orderRows(top)[2].pinned, true)

  // drag charlie to the top: the pinned task stays at index 2
  next = ui.orderMove(ui.orderRows(top), 3, 0)
  r = await call(url, 'PUT', '/api/order/top', { base_rev: top.rev, ids: next, mode: 'manual' }, 'mgr')
  assert.equal(r.status, 200)
  top = r.body
  assert.deepEqual(ids(top.items), [ps[2].id, ps[1].id, t1.id, ps[0].id])

  // unpin: back under its project
  const proj2 = (await call(url, 'GET', `/api/order?scope=project:${ps[0].id}`, undefined, 'mgr')).body
  r = await call(url, 'POST', `/api/order/override/${t1.id}`, { override: false, base_rev_top: top.rev, base_rev_project: proj2.rev, mode: 'manual' }, 'mgr')
  assert.equal(r.status, 200)
  assert.deepEqual(ids(r.body.top.items), [ps[2].id, ps[1].id, ps[0].id])
  assert.deepEqual(ids(r.body.project.items), [t1.id])
})

test('HTTP: stale rev -> 409 with current order; client -> 403; both reach the page as text', async () => {
  const { url, ps } = await pmNode()
  const top = (await call(url, 'GET', '/api/order?scope=top')).body
  const ok = await call(url, 'PUT', '/api/order/top', { base_rev: top.rev, ids: ui.orderStep(ui.orderRows(top), 0, 1) }, 'mgr')
  assert.equal(ok.status, 200)
  const stale = await call(url, 'PUT', '/api/order/top', { base_rev: top.rev, ids: ui.orderStep(ui.orderRows(top), 2, -1) }, 'mgr')
  assert.equal(stale.status, 409)
  assert.equal(stale.body.current.rev, ok.body.rev)
  const err = Object.assign(new Error(stale.body.error), { status: 409, data: stale.body })
  assert.match(ui.orderErrorText(err, 'Move'), new RegExp(`Reloaded revision ${ok.body.rev}`))
  const cur = ok.body
  const denied = await call(url, 'PUT', '/api/order/top', { base_rev: cur.rev, ids: ui.orderStep(ui.orderRows(cur), 0, 1) }, 'cli')
  assert.equal(denied.status, 403)
  assert.ok(denied.body.error)
  assert.deepEqual(ids((await call(url, 'GET', '/api/order?scope=top')).body.items), ids(cur.items), 'denied write changed nothing')
  assert.equal(ps.length, 3)
})
