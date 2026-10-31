// node --test sync-e2e.test.mjs  — PM-SYNC end to end (Claude Opus 5.5, lane 6).
// Two real pm servers (`node server.mjs`) as child processes on free loopback ports, each with
// its own temp PM_DB, bridge db, peers/tokens/policy files and a temp USERPROFILE/HOME, so
// nothing under ~/.claude/pm-data is read or written. Each peers file lists both nodes (the
// self entry must be filtered out by machine name). Port 4480 is never used.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOKEN = 'e2e-shared-peer-token-' + Math.random().toString(36).slice(2)
const W = { 'x-pm-actor': 'sync-e2e', 'x-pm-model': 'Claude Opus 5.5' }
const SYNC_WAIT = 3000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function freePort(avoid = []) {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const s = net.createServer()
      s.once('error', reject)
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
    })
    if (port !== 4480 && !avoid.includes(port)) return port
  }
}

/** Inherited env minus anything pm/bridge would pick up from the real machine. */
function baseEnv() {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(PM_|BRIDGE_|BLITZ_)/i.test(k)) continue
    env[k] = v
  }
  return env
}

const root = mkdtempSync(join(tmpdir(), 'pm-sync-e2e-'))
const nodes = {}

function nodeEnv(n) {
  return {
    ...baseEnv(),
    USERPROFILE: n.home, HOME: n.home, APPDATA: join(n.home, 'AppData'),
    PM_DB: join(n.data, 'pm.db'),
    PM_PORT: String(n.port), PM_HOST: '127.0.0.1', PM_TOKEN: TOKEN, PM_MACHINE: n.name,
    PM_SYNC: '1', PM_SYNC_MS: '300', PM_TOAST: '0',
    BRIDGE_DB: join(n.data, 'bridge.db'),
    BRIDGE_PEERS: join(n.data, 'bridge-peers.json'),
    BRIDGE_TOKENS: join(n.data, 'bridge-tokens.json'),
    BRIDGE_POLICY: join(n.data, 'bridge-policy.json'),
    BRIDGE_QUOTA_FILE: join(n.data, 'quota.json'),
    BRIDGE_INBOX: join(n.data, 'inbox'),
    BRIDGE_REPLICA_MS: '60000',
  }
}

async function startNode(n) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: HERE, env: nodeEnv(n), stdio: ['ignore', 'pipe', 'pipe'] })
  n.child = child
  n.log = n.log ?? []
  child.stdout.on('data', (d) => n.log.push(String(d)))
  child.stderr.on('data', (d) => n.log.push(String(d)))
  child.exited = new Promise((r) => child.once('exit', r))
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${n.name} exited ${child.exitCode}:\n${n.log.join('')}`)
    try { if ((await fetch(`${n.url}/api/health`)).ok) return } catch {}
    await sleep(100)
  }
  throw new Error(`${n.name} did not start:\n${n.log.join('')}`)
}

async function stopNode(n) {
  if (!n?.child || n.child.exitCode !== null) return
  n.child.kill()
  await Promise.race([n.child.exited, sleep(5000)])
}

async function api(n, method, path, body, headers = {}) {
  const res = await fetch(`${n.url}${path}`, {
    method,
    headers: { ...W, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

async function ok(n, method, path, body) {
  const r = await api(n, method, path, body)
  assert.equal(r.status, 200, `${n.name} ${method} ${path} -> ${r.status} ${r.text}`)
  return r.json
}

/** Poll fn until it returns truthy; returns that value or throws with the last seen value. */
async function waitFor(fn, ms = SYNC_WAIT, what = 'condition') {
  const deadline = Date.now() + ms
  let last
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last } catch (err) { last = err }
    await sleep(100)
  }
  throw new Error(`timed out after ${ms}ms waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`)
}

const taskOn = async (n, id) => { const r = await api(n, 'GET', `/api/tasks/${id}`); return r.status === 200 ? r.json : null }

before(async () => {
  const pa = await freePort()
  const pb = await freePort([pa])
  for (const [name, port] of [['e2e-a', pa], ['e2e-b', pb]]) {
    const home = join(root, name, 'home')
    const data = join(root, name, 'data')
    mkdirSync(join(home, '.claude', 'pm-data'), { recursive: true })
    mkdirSync(data, { recursive: true })
    nodes[name] = { name, port, url: `http://127.0.0.1:${port}`, home, data }
  }
  const peers = Object.fromEntries(Object.values(nodes).map((n) => [n.name, { url: n.url, token: TOKEN }]))
  for (const n of Object.values(nodes)) {
    writeFileSync(join(n.data, 'bridge-peers.json'), JSON.stringify(peers, null, 2))
    writeFileSync(join(n.data, 'bridge-tokens.json'), JSON.stringify({ tokens: [] }))
  }
  await Promise.all(Object.values(nodes).map(startNode))
})

after(async () => {
  await Promise.all(Object.values(nodes).map(stopNode))
  for (let i = 0; i < 10; i++) {
    try { rmSync(root, { recursive: true, force: true }); break } catch { await sleep(300) }
  }
})

const ctx = {}

test('sync wiring: both nodes expose /api/sync/status and list only the other node as peer', async () => {
  const A = nodes['e2e-a']
  const B = nodes['e2e-b']
  const sa = await ok(A, 'GET', '/api/sync/status')
  const sb = await ok(B, 'GET', '/api/sync/status')
  assert.deepEqual(sa.peers.map((p) => p.peer), ['e2e-b'])
  assert.deepEqual(sb.peers.map((p) => p.peer), ['e2e-a'])
  // the first pull runs at start-up; the peer should be reachable
  await waitFor(async () => (await ok(A, 'GET', '/api/sync/status')).peers[0]?.ok === true, SYNC_WAIT, 'A->B pull ok')
})

test('project + task created on A appear on B within ~3s', async () => {
  const A = nodes['e2e-a']
  const B = nodes['e2e-b']
  const p = await ok(A, 'POST', '/api/projects', { name: 'E2E Sync Project', description: 'from A' })
  const t = await ok(A, 'POST', '/api/tasks', { project: p.id, title: 'task one', body: 'made on A' })
  ctx.project = p
  ctx.task = t
  const onB = await waitFor(() => taskOn(B, t.id), SYNC_WAIT, `task ${t.id} on B`)
  assert.equal(onB.title, 'task one')
  assert.equal(onB.project_id, p.id)
  const projectsB = await ok(B, 'GET', '/api/projects')
  const pb = projectsB.find((x) => x.id === p.id)
  assert.ok(pb, 'project replicated to B')
  assert.equal(pb.name, 'E2E Sync Project')
})

test('task updated on B is seen on A', async () => {
  const A = nodes['e2e-a']
  const B = nodes['e2e-b']
  const cur = await taskOn(B, ctx.task.id)
  await sleep(5) // updated_at must be strictly newer than A's copy
  const upd = await ok(B, 'PATCH', `/api/tasks/${ctx.task.id}`, { rev: cur.rev, title: 'task one (edited on B)', status: 'in_progress' })
  assert.equal(upd.title, 'task one (edited on B)')
  const onA = await waitFor(async () => { const t = await taskOn(A, ctx.task.id); return t?.title === upd.title ? t : null }, SYNC_WAIT, 'B edit on A')
  assert.equal(onA.status, 'in_progress')
  assert.equal(onA.rev, upd.rev)
})

test('reorder on A: order_scopes rev and task sort_order / project sort_order reach B', async () => {
  const A = nodes['e2e-a']
  const B = nodes['e2e-b']
  const pid = ctx.project.id
  const t2 = await ok(A, 'POST', '/api/tasks', { project: pid, title: 'task two' })
  const t3 = await ok(A, 'POST', '/api/tasks', { project: pid, title: 'task three' })
  const p2 = await ok(A, 'POST', '/api/projects', { name: 'E2E Sync Project 2' })
  // let B hold every row first, so the reorder has to travel as an UPDATE, not an INSERT
  await waitFor(async () => (await taskOn(B, t3.id)) && (await ok(B, 'GET', '/api/projects')).some((x) => x.id === p2.id), SYNC_WAIT, 'rows on B before reorder')

  // project scope
  const cur = await ok(A, 'GET', `/api/order?scope=project:${pid}`)
  const ids = cur.items.map((i) => i.id).reverse()
  const done = await ok(A, 'PUT', `/api/order/project/${pid}`, { base_rev: cur.rev, ids })
  assert.deepEqual(done.items.map((i) => i.id), ids)
  // top scope
  const top = await ok(A, 'GET', '/api/order?scope=top')
  const topIds = top.items.map((i) => i.id).reverse()
  const topDone = await ok(A, 'PUT', '/api/order/top', { base_rev: top.rev, ids: topIds })
  const aFlat = (await ok(A, 'GET', `/api/tasks?project=${pid}`)).map((t) => [t.id, t.sort_order])
  const aProjects = (await ok(A, 'GET', '/api/projects')).map((p) => [p.id, p.sort_order])

  // scope revs reach B (read B's raw rows from its own change feed: GET /api/order on B would
  // create the scope row locally via ensureScope and mask a missing replication)
  const scopes = await waitFor(async () => {
    const rows = (await ok(B, 'GET', '/api/sync/changes?after=0&limit=2000')).rows.filter((r) => r.t === 'order_scopes')
    const m = Object.fromEntries(rows.map((r) => [r.row.scope, r.row.rev]))
    return m[`project:${pid}`] === done.rev && m.top === topDone.rev ? m : null
  }, SYNC_WAIT, `order_scopes project:${pid} rev ${done.rev} and top rev ${topDone.rev} on B`)
  assert.equal(scopes[`project:${pid}`], done.rev)

  // task ranks reach B
  const bFlat = await waitFor(async () => {
    const rows = (await ok(B, 'GET', `/api/tasks?project=${pid}`)).map((t) => [t.id, t.sort_order])
    const want = new Map(aFlat)
    return rows.length === aFlat.length && rows.every(([id, so]) => want.get(id) === so) ? rows : null
  }, SYNC_WAIT, `task sort_order on B to equal A ${JSON.stringify(aFlat)}; B has ${JSON.stringify((await ok(B, 'GET', `/api/tasks?project=${pid}`)).map((t) => [t.id, t.sort_order]))}`)
  assert.ok(bFlat)
  // project ranks reach B
  await waitFor(async () => {
    const want = new Map(aProjects)
    const rows = (await ok(B, 'GET', '/api/projects')).map((p) => [p.id, p.sort_order])
    return rows.every(([id, so]) => want.get(id) === so)
  }, SYNC_WAIT, `project sort_order on B to equal A ${JSON.stringify(aProjects)}`)
  // and B renders the same manual order
  const bOrder = await ok(B, 'GET', `/api/order?scope=project:${pid}`)
  assert.deepEqual(bOrder.items.map((i) => i.id), ids)
  assert.equal(bOrder.rev, done.rev)
})

test('GET /api/sync/changes from a remote-looking request needs a token', async () => {
  const A = nodes['e2e-a']
  // forwarding headers make a loopback socket count as remote (tailscale serve/funnel)
  const remote = { 'x-forwarded-for': '203.0.113.9' }
  const noTok = await api(A, 'GET', '/api/sync/changes?after=0', null, remote)
  assert.equal(noTok.status, 401, `no token -> ${noTok.status} ${noTok.text}`)
  const badTok = await api(A, 'GET', '/api/sync/changes?after=0', null, { ...remote, authorization: 'Bearer wrong' })
  assert.ok([401, 403].includes(badTok.status), `bad token -> ${badTok.status} ${badTok.text}`)
  const good = await api(A, 'GET', '/api/sync/changes?after=0', null, { ...remote, authorization: `Bearer ${TOKEN}` })
  assert.equal(good.status, 200, `peer token -> ${good.status} ${good.text}`)
  assert.ok(Array.isArray(good.json.rows))
  const nowRemote = await api(A, 'POST', '/api/sync/now', {}, { ...remote, authorization: `Bearer ${TOKEN}` })
  assert.ok([401, 403].includes(nowRemote.status), `POST /api/sync/now with peer token from remote -> ${nowRemote.status} (expected refused: needs admin)`)
})

test('B killed, A writes, B restarted on the same DB catches up', async () => {
  const A = nodes['e2e-a']
  const B = nodes['e2e-b']
  const before = await ok(B, 'GET', '/api/sync/status')
  const cursorBefore = before.peers[0].after
  assert.ok(cursorBefore > 0, 'B has a stored cursor for A')
  await stopNode(B)
  const t = await ok(A, 'POST', '/api/tasks', { project: ctx.project.id, title: 'written while B was down' })
  const cur = await taskOn(A, ctx.task.id)
  await ok(A, 'PATCH', `/api/tasks/${ctx.task.id}`, { rev: cur.rev, body: 'edited on A while B was down' })
  // A's pulls of B now fail and are reported, without breaking A
  await waitFor(async () => (await ok(A, 'GET', '/api/sync/status')).peers[0]?.ok === false, SYNC_WAIT, 'A reports B down')
  await startNode(B)
  const back = await waitFor(() => taskOn(B, t.id), SYNC_WAIT, 'missed task on restarted B')
  assert.equal(back.title, 'written while B was down')
  await waitFor(async () => (await taskOn(B, ctx.task.id))?.body === 'edited on A while B was down', SYNC_WAIT, 'missed edit on B')
  const after = await ok(B, 'GET', '/api/sync/status')
  assert.ok(after.peers[0].after >= cursorBefore, 'cursor survived the restart')
  await waitFor(async () => (await ok(A, 'GET', '/api/sync/status')).peers[0]?.ok === true, SYNC_WAIT, 'A sees B again')
})
