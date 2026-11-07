// Verification scope tests (T-d1d6f44a concurrency, T-e1b0b33c independent queues,
// T-34f83a9e routing, T-3a7de03a peer discovery, T-df95707b peer routing,
// T-ec8e2fcf failover). Mock-based: real pm store/server/runner and the real
// bridge queue/replicator, with fake peers and fake DSH pipeline runs.
// No live model, seat, host or network is touched.  Claude Sonnet 5.5.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from './store.mjs'
import { createServer } from './server.mjs'
import { openQueue } from './bridge/queue.mjs'
import { createReplicator, uniquePeers, mergeTokens } from './bridge/replica.mjs'

const A = { actor: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5' }
const HUMAN = { actor: 'user', model: null }

function pipelineTask(store, title, machine, extra = {}) {
  return store.createTask(HUMAN, { project: 'demo', title, kind: 'dsh-pipeline', execution_machine: machine, ...extra })
}

function freshStore(clock) {
  const s = openStore(':memory:', clock ? { clock } : undefined)
  s.createProject(A, { name: 'demo' })
  return s
}

test('concurrency: parallel pipeline runs keep separate runs, leases and external ids', () => {
  const s = freshStore()
  const tasks = ['p1', 'p2', 'p3'].map((n, i) => pipelineTask(s, n, i === 2 ? 'vmixer2o2' : 'ndi2'))
  const runs = tasks.map((t, i) => s.startRun({ actor: `dsh-pipe-${i}`, model: null }, t.id, {
    kind: 'dsh-pipeline', machine: t.execution_machine, external_id: `dsh-run-${i}`, state: 'running' }))
  assert.equal(new Set(runs.map((r) => r.id)).size, 3)
  assert.equal(new Set(runs.map((r) => r.external_id)).size, 3)
  s.updateRun(A, runs[0].id, { last_checkpoint: 'stage 2' })
  s.updateRun(A, runs[1].id, { last_checkpoint: 'stage 1' })
  assert.equal(s.getRun(runs[0].id).last_checkpoint, 'stage 2')
  assert.equal(s.getRun(runs[1].id).last_checkpoint, 'stage 1')
  assert.equal(s.getRun(runs[2].id).last_checkpoint ?? null, null)
  for (const t of tasks) assert.equal(s.listRuns({ task_id: t.id }).length, 1)
  s.close()
})

test('concurrency + routing: two runners claiming at once never share a task or write root', async () => {
  const { createRunner } = await import('./runner.mjs')
  const root = mkdtempSync(join(tmpdir(), 'pm-vr3-'))
  const s = freshStore()
  const server = createServer(s)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const mk = (machine) => createRunner({ url, token: '', machine, machines: [machine], actor: `pm-runner@${machine}`, root: join(root, 'ws'), leaseSeconds: 60, pollMs: 200, slots: 3, log: () => {} })
  try {
    for (let i = 0; i < 3; i++) s.createTask(HUMAN, { project: 'demo', title: `n${i}`, assignee: 'pm-runner@ndi2', execution_machine: 'ndi2' })
    for (let i = 0; i < 3; i++) s.createTask(HUMAN, { project: 'demo', title: `v${i}`, assignee: 'pm-runner@vmixer2o2', execution_machine: 'vmixer2o2' })
    const [o1, o2] = await Promise.all([mk('ndi2').tick(), mk('vmixer2o2').tick()])
    assert.equal(o1.claimed.length, 3)
    assert.equal(o2.claimed.length, 3)
    assert.equal(new Set([...o1.claimed, ...o2.claimed].map((c) => c.task)).size, 6, 'no task claimed twice')
    const norm = (p) => p.replaceAll('\\', '/')
    for (const c of o1.claimed) { assert.equal(s.getTask(c.task).execution_machine, 'ndi2'); assert.match(norm(c.workspace), /\/ndi2\//) }
    for (const c of o2.claimed) { assert.equal(s.getTask(c.task).execution_machine, 'vmixer2o2'); assert.match(norm(c.workspace), /\/vmixer2o2\//) }
    assert.equal(new Set([...o1.claimed, ...o2.claimed].map((c) => c.workspace)).size, 6, 'six distinct write roots')
  } finally { server.close(); s.close(); rmSync(root, { recursive: true, force: true }) }
})

test('independent queues: a pipeline whose lease lapses does not stall or fail the others', () => {
  let now = new Date('2026-11-01T12:00:00Z')
  const s = freshStore(() => now)
  const mk = (n) => {
    const t = pipelineTask(s, n, 'ndi2')
    s.claimTask({ actor: `w-${n}`, model: null }, t.id, { leaseSeconds: 60 })
    return t
  }
  const dead = mk('dead'), live1 = mk('live1'), live2 = mk('live2')
  now = new Date('2026-11-01T12:00:40Z')
  s.heartbeat({ actor: 'w-live1', model: null }, live1.id, { leaseSeconds: 60 })
  s.heartbeat({ actor: 'w-live2', model: null }, live2.id, { leaseSeconds: 60 })
  now = new Date('2026-11-01T12:01:30Z')
  s.reconcile()
  assert.equal(s.getTask(dead.id).status, 'uncertain', 'expired pipeline becomes uncertain, not failed')
  assert.equal(s.getTask(live1.id).claimed_by, 'w-live1')
  assert.equal(s.getTask(live2.id).claimed_by, 'w-live2')
  s.heartbeat({ actor: 'w-live1', model: null }, live1.id, { leaseSeconds: 60 })
  s.releaseTask({ actor: 'w-live2', model: null }, live2.id, { status: 'done' })
  assert.equal(s.getTask(live2.id).status, 'done')
  s.close()
})

test('independent queues: a failed run is isolated from a running sibling', () => {
  const s = freshStore()
  const t1 = pipelineTask(s, 'a', 'ndi2'), t2 = pipelineTask(s, 'b', 'ndi2')
  const r1 = s.startRun({ actor: 'a', model: null }, t1.id, { kind: 'dsh-pipeline', machine: 'ndi2', state: 'running' })
  const r2 = s.startRun({ actor: 'b', model: null }, t2.id, { kind: 'dsh-pipeline', machine: 'ndi2', state: 'running' })
  s.updateRun(A, r1.id, { state: 'failed', last_checkpoint: 'seat 402' })
  assert.equal(s.getRun(r1.id).state, 'failed')
  assert.equal(s.getRun(r2.id).state, 'running')
  s.updateRun(A, r2.id, { last_checkpoint: 'still advancing' })
  assert.equal(s.getRun(r2.id).last_checkpoint, 'still advancing')
  s.close()
})

test('routing: a run cannot start on a machine other than the task execution_machine', () => {
  const s = freshStore()
  const t = pipelineTask(s, 'routed', 'ndi2')
  assert.throws(() => s.startRun(A, t.id, { kind: 'dsh-pipeline', machine: 'vmixer2o2' }), (e) => e.status === 409)
  const r = s.startRun(A, t.id, { kind: 'dsh-pipeline', machine: 'ndi2' })
  assert.equal(r.machine, 'ndi2')
  assert.equal(s.claimForRunner({ actor: 'pm-runner@vmixer2o2' }, { machines: ['vmixer2o2'] }), null)
  s.close()
})

test('peer discovery: aliases collapse; mirrored tokens are capped and drop with the peer', () => {
  assert.deepEqual(uniquePeers({ ndi2: { url: 'http://a:1/' }, 'ndi2-alias': { url: 'http://a:1' }, v: { url: 'http://b:2', token: 't' }, bad: {} }).map((p) => p.url), ['http://a:1', 'http://b:2'])
  const dir = mkdtempSync(join(tmpdir(), 'vr3-tok-'))
  const file = join(dir, 'tokens.json')
  try {
    const h = 'a'.repeat(64)
    assert.deepEqual(mergeTokens('peerA', [{ name: 'x', sha256: h, scopes: ['read', 'admin'] }], file), { added: 1, removed: 0 })
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).tokens[0].scopes, ['read'], 'admin scope stripped')
    assert.deepEqual(mergeTokens('peerA', [], file), { added: 0, removed: 1 }, 'peer dropped it, so did we')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

function fakePeer(queue, { up = () => true } = {}) {
  return async (url) => {
    if (!up()) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    const u = new URL(url)
    if (u.pathname === '/api/bridge/replica/tokens') return { ok: true, json: async () => ({ tokens: [] }), text: async () => '' }
    const after = Number(u.searchParams.get('after') ?? 0)
    const limit = Number(u.searchParams.get('limit') ?? 200)
    const f = queue.changesSince(after, limit)
    return { ok: true, json: async () => f, text: async () => '' }
  }
}

test('peer discovery + routing: a peer added to config is replicated; its mail stays a replica here', async () => {
  const a = openQueue(':memory:', { machine: 'ndi2' })
  const b = openQueue(':memory:', { machine: 'vmixer2o2' })
  b.enqueue({ id: 'b1', type: 'message', to: { agent: 'chatgpt' }, body: {} })
  const dir = mkdtempSync(join(tmpdir(), 'vr3-rep-'))
  try {
    const peers = {}
    const mk = () => createReplicator(a, peers, { intervalMs: 0, tokenFile: join(dir, 't.json'), fetchImpl: fakePeer(b) })
    assert.deepEqual(await mk().syncAll(), [], 'no peers configured yet')
    peers.vmixer2o2 = { url: 'http://vmixer2o2:4480' }
    const out = await mk().syncAll()
    assert.equal(out[0].ok, true)
    assert.equal(out[0].inserted, 1)
    assert.deepEqual(a.inbox('chatgpt').map((m) => m.id), ['b1'])
    assert.equal(a.get('b1').state, 'replica', 'peer-owned mail is never re-executed here')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('failover: owner down is recorded not fatal; return catches up exactly once', async () => {
  const a = openQueue(':memory:', { machine: 'ndi2' })
  const b = openQueue(':memory:', { machine: 'vmixer2o2' })
  const dir = mkdtempSync(join(tmpdir(), 'vr3-fo-'))
  try {
    let up = true
    const rep = createReplicator(a, { vmixer2o2: { url: 'http://v:1' } }, { intervalMs: 0, tokenFile: join(dir, 't.json'), fetchImpl: fakePeer(b, { up: () => up }), pageSize: 2 })
    for (let i = 0; i < 3; i++) b.enqueue({ id: `m${i}`, type: 'message', to: { agent: 'chatgpt' }, body: { i } })
    assert.equal((await rep.syncAll())[0].inserted, 3)
    up = false
    b.enqueue({ id: 'm3', type: 'message', to: { agent: 'chatgpt' }, body: {} })
    b.enqueue({ id: 'm4', type: 'message', to: { agent: 'chatgpt' }, body: {} })
    const down = (await rep.syncAll())[0]
    assert.equal(down.ok, false)
    assert.match(down.error, /fetch failed/)
    assert.ok(a.replicaCursor('vmixer2o2').last_error, 'outage recorded on the cursor')
    assert.deepEqual(a.inbox('chatgpt').map((m) => m.id), ['m0', 'm1', 'm2'], 'nothing lost or invented while down')
    up = true
    const back = (await rep.syncAll())[0]
    assert.equal(back.ok, true)
    assert.equal(back.inserted, 2)
    assert.deepEqual(a.inbox('chatgpt').map((m) => m.id), ['m0', 'm1', 'm2', 'm3', 'm4'])
    const again = (await rep.syncAll())[0]
    assert.equal(again.inserted + again.merged, 0, 'no duplicate delivery on repeat pulls')
    a.ackFor('chatgpt', { ids: ['m0'] }, 'chatgpt')
    assert.ok(b.applyReplica(a.changesSince(0).rows, 'ndi2').merged >= 1)
    assert.equal(b.get('m0').delivery.acked_by, 'chatgpt', 'ack taken on the survivor reaches the owner')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
