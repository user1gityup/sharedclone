// node --test bridge/test.mjs   (run from pm/)
// UNIT TESTS. The Claude executor here runs fake-claude.mjs (a test double) and
// the weight router is the real DSH router when present. Operational integration
// evidence lives in bridge/integration.mjs, not here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openQueue } from './queue.mjs'
import { normalizeEnvelope, BridgeError } from './protocol.mjs'
import { createBridge } from './index.mjs'
import { createAuth, sha256 } from './auth.mjs'
import { safeRelative, pushFile, pullFile, fileSha256 } from './files.mjs'
import { chooseModel, loadRouter, defaultCandidates } from './weight.mjs'
import { createReplicator, mergeTokens, exportTokens, uniquePeers } from './replica.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const tmp = () => mkdtempSync(join(tmpdir(), 'bridge-test-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('envelope validation rejects bad input', () => {
  assert.throws(() => normalizeEnvelope({ type: 'nope', to: { agent: 'x' } }, { self: 'a' }), BridgeError)
  assert.throws(() => normalizeEnvelope({ type: 'ping' }, { self: 'a' }), /to.agent is required/)
  assert.throws(() => normalizeEnvelope({ v: 2, type: 'ping', to: { agent: 'node' } }, { self: 'a' }), /unsupported protocol/)
  assert.throws(() => normalizeEnvelope({ type: 'ping', to: { agent: '../x' } }, { self: 'a' }), /to.agent must match/)
  const e = normalizeEnvelope({ type: 'ping', to: { agent: 'node' } }, { self: 'a' })
  assert.equal(e.to_machine, 'a')
  assert.equal(e.dedupe_key, e.id)
})

test('forwarded envelope keeps expires_at when ttl_seconds is absent', () => {
  const created_at = '2026-10-08T10:00:00.000Z'
  const first = normalizeEnvelope({ type: 'ping', to: { agent: 'node' }, created_at, ttl_seconds: 60 }, { self: 'a' })
  assert.equal(first.expires_at, '2026-10-08T10:01:00.000Z')
  const forwarded = normalizeEnvelope({ type: 'ping', to: { agent: 'node' }, created_at, expires_at: first.expires_at }, { self: 'b' })
  assert.equal(forwarded.expires_at, first.expires_at)
  assert.equal(normalizeEnvelope({ type: 'ping', to: { agent: 'node' } }, { self: 'a' }).expires_at, null)
  assert.throws(() => normalizeEnvelope({ type: 'ping', to: { agent: 'node' }, expires_at: 'nope' }, { self: 'a' }), /expires_at is not a date/)
})

test('dedupe: same id or dedupe_key stores once', () => {
  const q = openQueue(':memory:', { machine: 'a' })
  const one = q.enqueue({ type: 'message', to: { agent: 'inbox' }, dedupe_key: 'k1', body: { n: 1 } })
  const two = q.enqueue({ type: 'message', to: { agent: 'inbox' }, dedupe_key: 'k1', body: { n: 2 } })
  assert.equal(two.duplicate, true)
  assert.equal(two.id, one.id)
  assert.deepEqual(two.body, { n: 1 })
  assert.equal(q.list().length, 1)
})

test('fenced leases: stale fence cannot settle; non-retry-safe lease loss becomes uncertain', () => {
  let t = new Date('2026-10-08T00:00:00Z')
  const q = openQueue(':memory:', { machine: 'a', clock: () => t })
  q.enqueue({ id: 'm1', type: 'submit', to: { agent: 'claude-code' }, body: { prompt: 'x' } })
  q.enqueue({ id: 'm2', type: 'ping', to: { agent: 'node' } })
  const l1 = q.lease(['claude-code'], { seconds: 10 })
  const l2 = q.lease(['node'], { seconds: 10 })
  t = new Date(t.getTime() + 11_000)
  const r = q.reconcile({ retrySafe: new Set(['node']) })
  assert.deepEqual(r.map((x) => x.state).sort(), ['queued', 'uncertain'])
  assert.throws(() => q.settle('m1', l1.fence, 'done'), /stale fence/)
  const again = q.lease(['node'], { seconds: 10 })
  assert.equal(again.fence, l2.fence + 1)
  assert.throws(() => q.settle('m2', l2.fence, 'done'), /stale fence/)
  assert.equal(q.settle('m2', again.fence, 'done').state, 'done')
})

test('retry with backoff then dead-letter', () => {
  let t = new Date('2026-10-08T00:00:00Z')
  const q = openQueue(':memory:', { machine: 'a', clock: () => t })
  q.enqueue({ id: 'm1', type: 'ping', to: { agent: 'node' } }, { maxAttempts: 2 })
  let l = q.lease(['node'])
  assert.equal(q.settle('m1', l.fence, 'retry', 'boom').state, 'queued')
  assert.equal(q.lease(['node']), null, 'backoff holds it')
  t = new Date(t.getTime() + 5000)
  l = q.lease(['node'])
  assert.equal(q.settle('m1', l.fence, 'retry', 'boom').state, 'dead')
  assert.equal(q.requeueDead('m1').state, 'queued')
})

test('outbox forward: failures back off, success marks forwarded', () => {
  let t = new Date('2026-10-08T00:00:00Z')
  const q = openQueue(':memory:', { machine: 'a', clock: () => t })
  q.enqueue({ id: 'o1', type: 'ping', to: { machine: 'b', agent: 'node' } })
  assert.equal(q.due().length, 1)
  q.forwardResult('o1', false, 'down')
  assert.equal(q.due().length, 0)
  t = new Date(t.getTime() + 2000)
  assert.equal(q.forwardResult('o1', true).state, 'forwarded')
})

test('path safety', () => {
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\x', 'con.txt', 'a/b.', '', 'a\0b']) {
    assert.throws(() => safeRelative(bad), BridgeError, bad)
  }
  assert.equal(safeRelative('a\\b/./c.txt'), 'a/b/c.txt')
})

test('weight router picks a model and rejects unknown pins', async () => {
  const router = await loadRouter()
  if (!router) return assert.ok(true, 'router not present on this machine')
  const c = await chooseModel({ capability: 'low' }, { router })
  assert.ok(['haiku', 'sonnet', 'opus'].includes(c.model))
  assert.equal(c.router, 'dsh')
  await assert.rejects(chooseModel({ pinned: 'gpt-9' }, { router }), /not a bridge candidate/)
  const p = await chooseModel({ pinned: 'haiku' }, { router })
  assert.equal(p.model, 'haiku')
  await assert.rejects(chooseModel({ capability: 'low', quotaHeadroom: 0.01 }, { router }), /filled no executor/)
  await assert.rejects(chooseModel({}, { router: null }), /refusing to guess/)
})

test('weight candidates: no agents = built-in list; agents narrow to enabled bridge-claude models', () => {
  const all = defaultCandidates()
  assert.deepEqual(all.map((c) => c.model), ['haiku', 'sonnet', 'opus'])
  assert.deepEqual(defaultCandidates({}), all)
  const agents = [
    { name: 'a', enabled: true, transport: 'bridge-claude', model_policy: { policy: 'TOKEN_EFFICIENT', pin: 'sonnet' } },
    { name: 'b', enabled: true, transport: 'bridge-claude', model_policy: { policy: 'TOKEN_EFFICIENT', allow: ['haiku'] } },
    { name: 'c', enabled: false, transport: 'bridge-claude', model_policy: { policy: 'TOKEN_EFFICIENT', pin: 'opus' } },
    { name: 'd', enabled: true, transport: 'dsh-run', model_policy: { policy: 'TOKEN_EFFICIENT', pin: 'opus' } },
  ]
  assert.deepEqual(defaultCandidates({ agents }).map((c) => c.model), ['haiku', 'sonnet'])
  assert.deepEqual(defaultCandidates({ agents: [{ enabled: true, transport: 'bridge-claude', model_policy: { policy: 'FREE_FIRST' } }] }), all)
  assert.deepEqual(defaultCandidates({ agents: [] }), [])
})

// ---- HTTP-level tests against a real server on an ephemeral port -----------
async function node({ machine = 'a', tokens = [], tokenFile, trustLoopback = false, peers = {}, quota, dbPath = ':memory:', dir = tmp(), notify = null, policy = null, sweepMs } = {}) {
  const policyPath = join(dir, 'bridge-policy.json')
  if (policy) writeFileSync(policyPath, JSON.stringify(policy))
  const bridge = createBridge({
    machine, dbPath, peers, notify, policyPath, tokenFile: tokenFile ?? join(dir, 'bridge-tokens.json'), replica: { intervalMs: 0 },
    auth: createAuth({ ...(tokenFile ? { tokenFile } : { tokens }), peerToken: 'peer-secret', trustLoopback }),
    roots: { inbox: join(dir, 'inbox') },
    workers: { bin: process.execPath, binArgs: [join(HERE, 'fake-claude.mjs')], router: null, pollMs: 50, ...(sweepMs ? { sweepMs } : {}),
      quota: quota ?? (() => ({ ok: true, headroom: 0.9 })), logDir: join(dir, 'logs') },
  })
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (!(await bridge.handle(req, res, url))) { res.writeHead(404); res.end() }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  bridge.start()
  const url = `http://127.0.0.1:${server.address().port}`
  return { url, bridge, dir, close: () => { bridge.stop(); server.close() } }
}
const call = async (url, method, path, body, token = 'peer-secret') => {
  const res = await fetch(url + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => null) }
}
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50) }
  throw new Error('waitFor timeout')
}

test('auth: no token, bad token, missing scope, project limit', async () => {
  const n = await node({ tokens: [{ name: 'ro', sha256: sha256('ro-token'), scopes: ['read'], projects: ['*'] },
    { name: 'p1', sha256: sha256('p1-token'), scopes: ['send', 'read'], projects: ['p1'] },
    { name: 'adm', sha256: sha256('adm-token'), scopes: ['admin'], projects: ['*'] }] })
  try {
    assert.equal((await call(n.url, 'GET', '/api/bridge/health', null, '')).status, 401)
    assert.equal((await call(n.url, 'GET', '/api/bridge/health', null, 'wrong')).status, 401)
    assert.equal((await call(n.url, 'GET', '/api/bridge/health', null, 'ro-token')).status, 200)
    assert.equal((await call(n.url, 'POST', '/api/bridge/messages', { type: 'ping', to: { agent: 'node' } }, 'ro-token')).status, 403)
    assert.equal((await call(n.url, 'POST', '/api/bridge/messages', { type: 'submit', to: { agent: 'claude-code' }, project: 'p1', body: { prompt: 'x' } }, 'p1-token')).status, 403, 'no execute scope')
    assert.equal((await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'inbox' }, project: 'p2' }, 'p1-token')).status, 403, 'wrong project')
    assert.equal((await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'inbox' }, project: 'p1' }, 'p1-token')).status, 200)
    assert.equal((await call(n.url, 'GET', '/api/bridge/audit')).status, 403, 'peer has no admin')
    const audit = await call(n.url, 'GET', '/api/bridge/audit', null, 'adm-token')
    assert.ok(audit.body.filter((a) => a.outcome.startsWith('refused')).length >= 5)
  } finally { n.close() }
})

test('permission_mode auto needs the auto scope; unknown modes refused', async () => {
  const n = await node({ tokens: [{ name: 'ex', sha256: sha256('ex-token'), scopes: ['send', 'read', 'execute'], projects: ['*'] },
    { name: 'au', sha256: sha256('au-token'), scopes: ['send', 'read', 'execute', 'auto'], projects: ['*'] }] })
  const sub = (mode, token) => call(n.url, 'POST', '/api/bridge/messages', { type: 'submit', to: { agent: 'claude-code' }, body: { prompt: 'x', model: 'haiku', permission_mode: mode } }, token)
  try {
    assert.equal((await sub('auto', 'ex-token')).status, 403, 'execute alone cannot run auto')
    assert.equal((await sub('acceptEdits', 'ex-token')).status, 200)
    assert.equal((await sub('bypassPermissions', 'au-token')).status, 400, 'bypass never allowed')
    const ok = (await sub('auto', 'au-token')).body
    const acc = await waitFor(async () => (await call(n.url, 'GET', `/api/bridge/threads/${ok.id}`)).body.find((x) => x.type === 'result'))
    assert.equal(acc.body.text, 'FAKE:x')
    const log = readFileSync(join(n.dir, 'logs', `${ok.id}.log`), 'utf8')
    assert.match(log, /--permission-mode auto/)
    assert.match(log, /--allowedTools mcp__pm/)
    // the worker still writes after posting the result: let it finish before the db closes
    await waitFor(async () => (await call(n.url, 'GET', '/api/bridge/health')).body.running?.length === 0 || null)
  } finally { n.close() }
})

test('ping gets a correlated reply from the node agent', async () => {
  const n = await node()
  try {
    const m = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'ping', to: { agent: 'node' }, from: { agent: 'tester' }, body: { hi: 1 } })).body
    const t = await waitFor(async () => (await call(n.url, 'GET', `/api/bridge/threads/${m.id}`)).body.find((x) => x.reply_to === m.id))
    assert.equal(t.type, 'result')
    assert.equal(t.body.pong, true)
    assert.equal(t.to.agent, 'tester')
  } finally { n.close() }
})

test('claude executor: accept, progress, result; failure; cancel', async () => {
  const n = await node()
  try {
    const ok = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'submit', to: { agent: 'claude-code' }, body: { prompt: 'hello', model: 'haiku' } })).body
    const thread = await waitFor(async () => { const t = (await call(n.url, 'GET', `/api/bridge/threads/${ok.id}`)).body; return t.some((x) => x.type === 'result') && t })
    assert.deepEqual(thread.filter((x) => x.id !== ok.id).map((x) => x.type).filter((x, i, a) => a.indexOf(x) === i), ['accept', 'progress', 'result'])
    assert.equal(thread.find((x) => x.type === 'result').body.text, 'FAKE:hello')
    assert.equal(thread.find((x) => x.type === 'result').body.session, 'fake-session-1')

    const bad = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'submit', to: { agent: 'claude-code' }, body: { prompt: 'FAIL', model: 'haiku' } })).body
    const err = await waitFor(async () => (await call(n.url, 'GET', `/api/bridge/threads/${bad.id}`)).body.find((x) => x.type === 'error'))
    assert.equal(err.body.exit_code, 1)

    const slow = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'submit', to: { agent: 'claude-code' }, body: { prompt: 'SLOW', model: 'haiku' } })).body
    await waitFor(async () => (await call(n.url, 'GET', `/api/bridge/threads/${slow.id}`)).body.some((x) => x.type === 'progress'))
    await call(n.url, 'POST', '/api/bridge/messages', { type: 'cancel', to: { agent: 'claude-code' }, correlation_id: slow.id })
    const c = await waitFor(async () => (await call(n.url, 'GET', `/api/bridge/threads/${slow.id}`)).body.find((x) => x.type === 'error'), 10000)
    assert.equal(c.body.cancelled, true)
    assert.equal((await call(n.url, 'GET', `/api/bridge/messages/${slow.id}`)).body.state, 'cancelled')
  } finally { n.close() }
})

test('quota gate refuses execution', async () => {
  const n = await node({ quota: () => ({ ok: false, reason: 'quota at 99%' }) })
  try {
    const m = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'submit', to: { agent: 'claude-code' }, body: { prompt: 'x', model: 'haiku' } })).body
    const e = await waitFor(async () => (await call(n.url, 'GET', `/api/bridge/threads/${m.id}`)).body.find((x) => x.type === 'error'))
    assert.match(e.body.error, /quota gate/)
  } finally { n.close() }
})

test('two nodes: forward, remote reply comes back; file push both ways with SHA-256', async () => {
  const peersA = {}
  const peersB = {}
  const a = await node({ machine: 'node-a', peers: peersA })
  const b = await node({ machine: 'node-b', peers: peersB })
  peersA['node-b'] = { url: b.url, token: 'peer-secret' }
  peersB['node-a'] = { url: a.url, token: 'peer-secret' }
  // workers were created before peers were filled: rebuild forwarders
  try {
    const { httpForwarder } = await import('./workers.mjs')
    for (const [n, p] of [[a, peersA], [b, peersB]]) {
      const fwd = httpForwarder(p)
      n.bridge.workers.stop()
      const { createWorkers } = await import('./workers.mjs')
      n.bridge.workers = createWorkers(n.bridge.queue, { forwardTo: fwd, pollMs: 50, router: null, logDir: join(n.dir, 'logs'),
        bin: process.execPath, binArgs: [join(HERE, 'fake-claude.mjs')], quota: () => ({ ok: true, headroom: 0.9 }) }).start()
    }
    const m = (await call(a.url, 'POST', '/api/bridge/messages', { type: 'ping', to: { machine: 'node-b', agent: 'node' }, from: { agent: 'tester' } })).body
    assert.equal(m.state, 'outbox')
    const reply = await waitFor(async () => (await call(a.url, 'GET', `/api/bridge/threads/${m.id}`)).body.find((x) => x.reply_to === m.id))
    assert.equal(reply.from.machine, 'node-b')

    const src = join(a.dir, 'payload.bin')
    writeFileSync(src, Buffer.from(Array.from({ length: 3_000_000 }, (_, i) => i % 251)))
    const pushed = await pushFile({ url: b.url, token: 'peer-secret', file: src, chunkBytes: 1_000_000 })
    assert.equal(pushed.state, 'delivered')
    assert.equal(pushed.dest_sha256, await fileSha256(src))
    assert.equal(await fileSha256(pushed.final_path), pushed.source_sha256)
    const again = await pushFile({ url: b.url, token: 'peer-secret', file: src })
    assert.match(again.final_path, /payload\.v2\.bin$/, 'no overwrite; new version')
    const back = join(a.dir, 'back', 'payload.bin')
    const pulled = await pullFile({ url: b.url, token: 'peer-secret', id: pushed.id, dest: back })
    assert.equal(pulled.sha256, pushed.source_sha256)
    assert.ok(existsSync(back))
  } finally { a.close(); b.close() }
})

test('file transfer rejects bad checksum and traversal', async () => {
  const n = await node()
  try {
    const t = (await call(n.url, 'POST', '/api/bridge/files', { name: 'x.txt', size: 3, sha256: '0'.repeat(64) })).body
    await fetch(`${n.url}/api/bridge/files/${t.id}?offset=0`, { method: 'PUT', headers: { authorization: 'Bearer peer-secret' }, body: 'abc' })
    const done = await call(n.url, 'POST', `/api/bridge/files/${t.id}/complete`, {})
    assert.equal(done.status, 422)
    assert.equal(done.body.transfer.state, 'rejected')
    assert.equal((await call(n.url, 'POST', '/api/bridge/files', { name: 'x', path: '../../evil.txt', size: 1, sha256: 'a'.repeat(64) })).status, 400)
    assert.equal((await call(n.url, 'POST', '/api/bridge/files', { name: 'x', root: 'system', size: 1, sha256: 'a'.repeat(64) })).status, 400)
  } finally { n.close() }
})

test('MCP: initialize, tools/list, tools/call', async () => {
  const n = await node()
  try {
    const init = await call(n.url, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    assert.equal(init.body.result.serverInfo.name, 'dsh-bridge')
    const list = await call(n.url, 'POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    assert.ok(list.body.result.tools.some((t) => t.name === 'bridge_run_claude'))
    const sent = await call(n.url, 'POST', '/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bridge_send', arguments: { to_agent: 'node', type: 'ping' } } })
    const id = sent.body.result.structuredContent.result.id
    await waitFor(async () => (await call(n.url, 'GET', `/api/bridge/threads/${id}`)).body.some((x) => x.reply_to === id))
    const noAuth = await call(n.url, 'POST', '/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/list' }, '')
    assert.equal(noAuth.status, 401)
  } finally { n.close() }
})

// ---- reliable delivery (ChatGPT request seq 225) ----------------------------
const toks = () => [
  { name: 'chatgpt', sha256: sha256('gpt-token'), scopes: ['send', 'read'], projects: ['*'] },
  { name: 'other', sha256: sha256('other-token'), scopes: ['send', 'read'], projects: ['*'] },
  { name: 'p1', sha256: sha256('p1-token'), scopes: ['send', 'read'], projects: ['p1'] },
]
const mcpTool = async (url, name, args, token, id = 1) =>
  (await call(url, 'POST', '/mcp', { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, token)).body.result

test('delivery: queued is not delivered; only the recipient read marks delivered', async () => {
  const n = await node({ tokens: toks() })
  try {
    const m = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, from: { agent: 'claude' }, body: { t: 1 } })).body
    assert.equal(m.delivery.state, 'queued')
    const peek = await call(n.url, 'GET', '/api/bridge/inbox/chatgpt', null, 'other-token')
    assert.equal(peek.body.delivered_marked, false)
    assert.equal(peek.body.messages.length, 1)
    assert.equal((await call(n.url, 'GET', `/api/bridge/delivery/${m.id}`)).body.state, 'queued', 'a non-recipient read is not delivery')
    const mine = await call(n.url, 'GET', '/api/bridge/inbox/chatgpt', null, 'gpt-token')
    assert.equal(mine.body.delivered_marked, true)
    const st = (await call(n.url, 'GET', `/api/bridge/delivery/${m.id}`)).body
    assert.equal(st.state, 'delivered')
    assert.equal(st.delivered_by, 'chatgpt')
    assert.equal(st.queue_state, 'queued')
  } finally { n.close() }
})

test('delivery: ack only by the recipient; unacked mail returns until acked; idempotent', async () => {
  const n = await node({ tokens: toks() })
  try {
    const m = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, body: {} })).body
    assert.equal((await call(n.url, 'POST', '/api/bridge/ack', { agent: 'chatgpt', ids: [m.id] }, 'other-token')).status, 403)
    assert.equal((await call(n.url, 'POST', `/api/bridge/messages/${m.id}/ack`, {}, 'other-token')).status, 403)
    assert.equal((await call(n.url, 'GET', '/api/bridge/inbox/chatgpt', null, 'gpt-token')).body.messages.length, 1)
    assert.equal((await call(n.url, 'GET', '/api/bridge/inbox/chatgpt', null, 'gpt-token')).body.messages.length, 1, 'read again until acked')
    const a = await call(n.url, 'POST', '/api/bridge/ack', { agent: 'chatgpt', ids: [m.id] }, 'gpt-token')
    assert.deepEqual(a.body.acked, [m.id])
    assert.equal(a.body.cursor, m.seq)
    const again = await call(n.url, 'POST', '/api/bridge/ack', { agent: 'chatgpt', ids: [m.id] }, 'gpt-token')
    assert.deepEqual(again.body.already, [m.id])
    assert.equal((await call(n.url, 'GET', '/api/bridge/inbox/chatgpt', null, 'gpt-token')).body.messages.length, 0)
    const st = (await call(n.url, 'GET', `/api/bridge/delivery/${m.id}`)).body
    assert.equal(st.state, 'acknowledged')
    assert.equal(st.acked_by, 'chatgpt')
    const o = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'other' }, body: {} })).body
    assert.equal((await call(n.url, 'POST', '/api/bridge/ack', { agent: 'chatgpt', ids: [o.id] }, 'gpt-token')).status, 403)
  } finally { n.close() }
})

test('delivery: reply_to correlates the response and marks the original responded', async () => {
  const n = await node({ tokens: toks() })
  try {
    const q = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, from: { agent: 'claude' }, expects_response: true, body: { ask: 1 } })).body
    assert.ok(q.delivery.response_due_at)
    const r = await mcpTool(n.url, 'bridge_send', { to_agent: 'claude', from_agent: 'chatgpt', type: 'message', reply_to: q.id, correlation_id: q.id, body: { answer: 1 } }, 'gpt-token')
    const reply = r.structuredContent.result
    const st = (await call(n.url, 'GET', `/api/bridge/delivery/${q.id}`)).body
    assert.equal(st.state, 'responded')
    assert.equal(st.response_id, reply.id)
    assert.ok(st.delivered_at, 'a reply implies the original was read')
    const q2 = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, expects_response: true, body: {} })).body
    await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'claude' }, from: { agent: 'other' }, reply_to: q2.id, body: {} }, 'other-token')
    assert.equal((await call(n.url, 'GET', `/api/bridge/delivery/${q2.id}`)).body.state, 'queued', 'a reply from a non-recipient does not count')
  } finally { n.close() }
})

test('delivery: a recipient reply (reply_to or correlation_id only) acknowledges the original', async () => {
  const n = await node({ tokens: toks() })
  try {
    const before = (await call(n.url, 'GET', '/api/bridge/delivery?agent=chatgpt')).body.pending.unacked ?? 0
    const q = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, from: { agent: 'claude' }, body: { ask: 1 } })).body
    // ChatGPT's habit: answer with correlation_id = the original id, no reply_to, no bridge_ack.
    const r = (await mcpTool(n.url, 'bridge_send', { to_agent: 'claude', from_agent: 'chatgpt', type: 'message', correlation_id: q.id, body: { answer: 1 } }, 'gpt-token')).structuredContent.result
    const st = (await call(n.url, 'GET', `/api/bridge/delivery/${q.id}`)).body
    assert.ok(st.acked_at, 'correlation reply acks')
    assert.equal(st.acked_by, 'chatgpt')
    assert.equal(st.response_id, r.id)
    const q2 = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, body: {} })).body
    await mcpTool(n.url, 'bridge_send', { to_agent: 'claude', from_agent: 'chatgpt', type: 'message', reply_to: q2.id, body: {} }, 'gpt-token')
    assert.ok((await call(n.url, 'GET', `/api/bridge/delivery/${q2.id}`)).body.acked_at, 'reply_to acks')
    assert.equal((await call(n.url, 'GET', '/api/bridge/delivery?agent=chatgpt')).body.pending.unacked ?? 0, before)
    const q3 = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, body: {} })).body
    await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'claude' }, from: { agent: 'other' }, correlation_id: q3.id, body: {} }, 'other-token')
    assert.equal((await call(n.url, 'GET', `/api/bridge/delivery/${q3.id}`)).body.acked_at, null, 'a non-recipient correlation does not ack')
  } finally { n.close() }
})

test('delivery: restart replays unacked mail; dedupe; pagination', async () => {
  const dir = tmp()
  const dbPath = join(dir, 'bridge.db')
  let n = await node({ tokens: toks(), dbPath, dir })
  const ids = []
  try {
    for (let i = 0; i < 5; i++) ids.push((await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, dedupe_key: `d${i}`, body: { i } })).body.id)
    const dup = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, dedupe_key: 'd0', body: { i: 99 } })).body
    assert.equal(dup.duplicate, true)
    const p1 = (await call(n.url, 'GET', '/api/bridge/inbox/chatgpt?limit=2', null, 'gpt-token')).body
    assert.equal(p1.messages.length, 2)
    const p2 = (await call(n.url, 'GET', `/api/bridge/inbox/chatgpt?limit=2&after=${p1.next_after}`, null, 'gpt-token')).body
    assert.deepEqual(p2.messages.map((m) => m.id), ids.slice(2, 4))
    await call(n.url, 'POST', '/api/bridge/ack', { agent: 'chatgpt', up_to: p1.next_after }, 'gpt-token')
  } finally { n.close() }
  n = await node({ tokens: toks(), dbPath, dir })
  try {
    const after = (await call(n.url, 'GET', '/api/bridge/inbox/chatgpt', null, 'gpt-token')).body
    assert.deepEqual(after.messages.map((m) => m.id), ids.slice(2), 'unacked survive a restart, acked do not')
    assert.equal(after.pending, 3)
    assert.equal(after.messages[0].delivery.state, 'delivered', 'delivery stamps persisted')
  } finally { n.close() }
})

test('delivery: overdue ack escalates (pm notify + high-priority message) then fails', async () => {
  const events = []
  const n = await node({ tokens: toks(), sweepMs: 50, notify: (a, d) => events.push([a, d]),
    policy: { ack_timeout_seconds: 0.2, escalation_backoff_seconds: [0.2], max_escalations: 2, escalate_to: [{ agent: 'ops' }] } })
  try {
    const m = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, priority: 'high', body: { subject: 'urgent' } })).body
    await waitFor(() => events.some(([a, d]) => a === 'delivery_failed' && d.id === m.id), 8000)
    const over = events.filter(([a, d]) => a === 'delivery_overdue' && d.id === m.id)
    assert.equal(over.length, 2)
    assert.equal(over[0][1].kind, 'ack')
    const esc = (await call(n.url, 'GET', '/api/bridge/messages?agent=ops')).body
    assert.equal(esc.length, 2, 'one escalation message per overdue sweep')
    assert.match(esc[0].body.subject, /not acknowledged/)
    const st = (await call(n.url, 'GET', `/api/bridge/delivery/${m.id}`)).body
    assert.equal(st.state, 'failed')
    assert.equal(st.escalations, 2)
    assert.equal((await call(n.url, 'GET', '/api/bridge/health')).body.pending.chatgpt.failed, 1)
    const o = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'other' }, body: {} })).body
    await waitFor(() => events.some(([a, d]) => a === 'delivery_overdue' && d.id === o.id), 8000)
    assert.equal((await call(n.url, 'GET', '/api/bridge/messages?agent=ops')).body.length, 2, 'normal priority: notify only')
  } finally { n.close() }
})

test('delivery: project-limited token sees only its project; policy route admin-only', async () => {
  const n = await node({ tokens: [...toks(), { name: 'adm', sha256: sha256('adm-token'), scopes: ['admin', 'read'], projects: ['*'] }] })
  try {
    await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'p1' }, project: 'p1', body: {} })
    await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'p1' }, project: 'p2', body: {} })
    await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'p1' }, body: {} })
    const box = (await call(n.url, 'GET', '/api/bridge/inbox/p1', null, 'p1-token')).body
    assert.deepEqual(box.messages.map((m) => m.project), ['p1'])
    const thread = await mcpTool(n.url, 'bridge_thread', { id: box.messages[0].id }, 'p1-token')
    assert.equal(thread.structuredContent.result.length, 1)
    assert.equal((await call(n.url, 'PUT', '/api/bridge/policy', { ack_timeout_seconds: 60 }, 'gpt-token')).status, 403)
    assert.equal((await call(n.url, 'PUT', '/api/bridge/policy', { ack_timeout_seconds: -1 }, 'adm-token')).status, 400)
    assert.equal((await call(n.url, 'PUT', '/api/bridge/policy', { ack_timeout_seconds: 60 }, 'adm-token')).body.ack_timeout_seconds, 60)
    assert.equal((await call(n.url, 'GET', '/api/bridge/policy')).body.ack_timeout_seconds, 60)
  } finally { n.close() }
})

test('delivery MCP: initialize reports pending; bridge_inbox unacked + bridge_ack; legacy inbox marks delivered', async () => {
  const n = await node({ tokens: toks() })
  try {
    const m = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, body: {} })).body
    const init = (await call(n.url, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, 'gpt-token')).body.result
    assert.match(init.instructions, /chatgpt: 1 unacknowledged/)
    const tools = (await call(n.url, 'POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'gpt-token')).body.result.tools.map((t) => t.name)
    for (const t of ['bridge_send', 'bridge_inbox', 'bridge_thread', 'bridge_run_claude', 'bridge_ack', 'bridge_delivery_status']) assert.ok(tools.includes(t), t)
    const legacy = (await mcpTool(n.url, 'bridge_inbox', { agent: 'chatgpt' }, 'gpt-token')).structuredContent.result
    assert.equal(legacy.length, 1, 'legacy array shape kept')
    assert.equal((await call(n.url, 'GET', `/api/bridge/delivery/${m.id}`)).body.state, 'delivered')
    const box = (await mcpTool(n.url, 'bridge_inbox', { agent: 'chatgpt', unacked: true }, 'gpt-token')).structuredContent.result
    assert.equal(box.pending, 1)
    const ack = (await mcpTool(n.url, 'bridge_ack', { agent: 'chatgpt', up_to: box.next_after }, 'gpt-token')).structuredContent.result
    assert.deepEqual(ack.acked, [m.id])
    const ds = (await mcpTool(n.url, 'bridge_delivery_status', { agent: 'chatgpt' }, 'gpt-token')).structuredContent.result
    assert.equal(ds.pending.unacked, 0)
    assert.ok(ds.presence.some((p) => p.agent === 'chatgpt' && p.last_connect_at))
    const denied = await mcpTool(n.url, 'bridge_ack', { agent: 'chatgpt', ids: [m.id] }, 'other-token')
    assert.equal(denied.isError, true)
  } finally { n.close() }
})

test('delivery MCP: stale 6-tool clients ack via bridge_send type ack and reply via body.reply_to', async () => {
  const n = await node({ tokens: toks() })
  try {
    const m = (await call(n.url, 'POST', '/api/bridge/messages', { type: 'message', to: { agent: 'chatgpt' }, body: {} })).body
    await mcpTool(n.url, 'bridge_inbox', { agent: 'chatgpt' }, 'gpt-token')
    const ack = (await mcpTool(n.url, 'bridge_send', { to_agent: 'bridge', type: 'ack', body: { ids: [m.id] } }, 'gpt-token')).structuredContent.result
    assert.deepEqual(ack.acked, [m.id])
    const denied = await mcpTool(n.url, 'bridge_send', { to_agent: 'bridge', type: 'ack', body: { agent: 'chatgpt', ids: [m.id] } }, 'other-token')
    assert.equal(denied.isError, true)
    const reply = (await mcpTool(n.url, 'bridge_send', { to_agent: 'claude-code', type: 'message', from_agent: 'chatgpt', body: { reply_to: m.id, text: 'ok' } }, 'gpt-token')).structuredContent.result
    assert.equal(reply.reply_to, m.id)
    const st = (await call(n.url, 'GET', `/api/bridge/delivery/${m.id}`)).body
    assert.equal(st.state, 'responded')
    assert.equal(st.acked_by, 'chatgpt')
  } finally { n.close() }
})

test('delivery: handled agents (node, claude-code submit) and remote targets are not tracked here', () => {
  const q = openQueue(':memory:', { machine: 'a' })
  q.enqueue({ id: 'n1', type: 'ping', to: { agent: 'node' } })
  q.enqueue({ id: 'c1', type: 'submit', to: { agent: 'claude-code' }, body: { prompt: 'x' } })
  q.enqueue({ id: 'r1', type: 'message', to: { agent: 'claude-code' }, body: {} })
  q.enqueue({ id: 'f1', type: 'message', to: { machine: 'b', agent: 'chatgpt' }, body: {} })
  assert.deepEqual(Object.keys(q.pending()), ['claude-code'])
  assert.equal(q.pending('claude-code').unacked, 1)
  assert.equal(q.ack('r1', 'claude-code').delivery.state, 'acknowledged')
  assert.equal(q.pending('claude-code').unacked, 0)
})

// ---- peer mail replication (replica.mjs) -------------------------------------
test('replica: copy is idempotent by id, acks flow back to the owner, nodes converge', () => {
  const a = openQueue(':memory:', { machine: 'node-a' })
  const b = openQueue(':memory:', { machine: 'node-b' })
  const m1 = a.enqueue({ id: 'm1', type: 'message', to: { agent: 'chatgpt' }, body: { t: 1 }, expects_response: true })
  a.enqueue({ id: 'm2', type: 'message', to: { agent: 'chatgpt' }, body: { t: 2 } })
  a.enqueue({ id: 'n1', type: 'ping', to: { agent: 'node' } }) // not mailbox mail: never replicated
  const feed = a.changesSince(0)
  assert.deepEqual(feed.rows.map((r) => r.id), ['m1', 'm2'])
  assert.deepEqual(b.applyReplica(feed.rows, 'node-a'), { inserted: 2, merged: 0, unchanged: 0, skipped: 0 })
  assert.deepEqual(b.applyReplica(feed.rows, 'node-a'), { inserted: 0, merged: 0, unchanged: 2, skipped: 0 }, 'second copy changes nothing')
  assert.deepEqual(b.inbox('chatgpt').map((m) => m.id), ['m1', 'm2'], 'replica node serves the inbox')
  assert.equal(b.get('m1').state, 'replica')
  assert.equal(b.pending('chatgpt').unacked, 2)
  assert.equal(b.sweepOverdue({ ...b.policy(), ack_timeout_seconds: 0 }).length, 0, 'only the owner escalates')
  // ChatGPT acks and answers on the replica node while the owner is off.
  const revB = b.rev()
  assert.deepEqual(b.ackFor('chatgpt', { ids: ['m1'] }, 'chatgpt').acked, ['m1'])
  b.enqueue({ id: 'r1', type: 'message', from: { agent: 'chatgpt' }, to: { agent: 'claude-code' }, reply_to: 'm1', body: {} })
  const back = b.changesSince(0).rows
  assert.ok(back.find((r) => r.id === 'm1').acked_at)
  const fromB = a.applyReplica(back, 'node-b')
  assert.equal(fromB.merged, 1)
  assert.equal(fromB.inserted, 1, 'the reply (owned by b) is copied to a')
  const st = a.get('m1')
  assert.equal(st.state, 'done')
  assert.equal(st.delivery.acked_by, 'chatgpt')
  assert.equal(st.delivery.response_id, 'r1')
  assert.equal(st.delivery.state, 'responded')
  assert.equal(a.pending('chatgpt').unacked, 1)
  assert.ok(b.rev() > revB)
  // Converged: pulling each other again writes nothing, so there is no ping-pong.
  const ra = a.rev()
  const rb = b.rev()
  const again = b.applyReplica(a.changesSince(0).rows, 'node-a')
  assert.equal(again.merged + again.inserted, 0)
  assert.equal(a.applyReplica(b.changesSince(0).rows, 'node-b').merged, 0)
  assert.equal(a.rev(), ra)
  assert.equal(b.rev(), rb)
  // Dedupe: a different id with a known dedupe_key is skipped; dead on the owner reaches the replica.
  assert.equal(b.applyReplica([{ ...feed.rows[1], id: 'other' }], 'node-a').skipped, 1)
  a.db.prepare("UPDATE bridge_messages SET state = 'dead', last_error = 'expired' WHERE id = 'm2'").run()
  b.applyReplica(a.changesSince(0).rows, 'node-a')
  assert.equal(b.get('m2').state, 'dead')
  assert.equal(b.pending('chatgpt').unacked ?? 0, 0)
  assert.equal(b.ack(m1.id, 'chatgpt').delivery.state, 'responded', 'legacy ack accepts a replica row')
})

test('replica: our forwarded copy becomes a replica of the peer-owned mail', () => {
  const a = openQueue(':memory:', { machine: 'node-a' })
  const b = openQueue(':memory:', { machine: 'node-b' })
  const out = a.enqueue({ id: 'f1', type: 'message', to: { machine: 'node-b', agent: 'chatgpt' }, body: {} })
  assert.equal(out.state, 'outbox')
  a.forwardResult('f1', true)
  b.enqueue({ id: out.id, type: out.type, from: out.from, to: out.to, body: out.body, created_at: out.created_at })
  assert.equal(a.pending('chatgpt').unacked ?? 0, 0)
  assert.equal(a.applyReplica(b.changesSince(0).rows, 'node-b').merged, 1)
  assert.deepEqual(a.inbox('chatgpt').map((m) => m.id), ['f1'])
  assert.equal(a.get('f1').state, 'forwarded')
})

test('replica tokens: hashes only, scopes capped, imports mirrored and never re-exported', () => {
  const dir = tmp()
  const fa = join(dir, 'a.json')
  const fb = join(dir, 'b.json')
  writeFileSync(fa, JSON.stringify({ tokens: [
    { name: 'chatgpt', sha256: sha256('gpt-token'), scopes: ['send', 'read', 'execute', 'auto'], projects: ['*'] },
    { name: 'ops', sha256: sha256('ops-token'), scopes: ['admin', 'replicate', 'read'], projects: ['*'] },
  ] }))
  writeFileSync(fb, JSON.stringify({ tokens: [{ name: 'local', sha256: sha256('local-token'), scopes: ['read'] }] }))
  const exp = exportTokens(fa)
  assert.equal(exp.length, 2)
  assert.ok(exp.every((t) => !('token' in t) && /^[0-9a-f]{64}$/.test(t.sha256)))
  assert.deepEqual(mergeTokens('node-a', exp, fb), { added: 2, removed: 0 })
  assert.deepEqual(mergeTokens('node-a', exp, fb), { added: 0, removed: 0 })
  const b = JSON.parse(readFileSync(fb, 'utf8')).tokens
  assert.deepEqual(b.find((t) => t.name === 'ops').scopes, ['read'], 'admin and replicate never cross')
  assert.deepEqual(exportTokens(fb).map((t) => t.name), ['local'], 'imports are not re-exported')
  assert.deepEqual(mergeTokens('node-a', exp.filter((t) => t.name === 'chatgpt'), fb), { added: 0, removed: 1 }, 'revoked on the peer, dropped here')
  assert.deepEqual(JSON.parse(readFileSync(fb, 'utf8')).tokens.map((t) => t.name).sort(), ['chatgpt', 'local'])
  assert.deepEqual(uniquePeers({ ndi2: { url: 'http://h:1/' }, alias: { url: 'http://h:1' }, b: { url: 'http://g:1' } }).map((p) => p.name), ['ndi2', 'b'])
})

test('replica over HTTP: owner stopped, other node serves chatgpt inbox and ack; cursor catch-up; acks flow back', async () => {
  const dir = tmp()
  const dbA = join(dir, 'a.db')
  const tokA = join(dir, 'a-tokens.json')
  const tokB = join(dir, 'b-tokens.json')
  writeFileSync(tokA, JSON.stringify({ tokens: [{ name: 'chatgpt', sha256: sha256('gpt-token'), scopes: ['send', 'read'], projects: ['*'] }] }))
  let a = await node({ machine: 'node-a', dbPath: dbA, tokenFile: tokA, dir })
  const b = await node({ machine: 'node-b', tokenFile: tokB })
  try {
    // replicate scope: the chatgpt token may not pull the feed; the peer token may.
    assert.equal((await call(a.url, 'GET', '/api/bridge/replica?after=0', null, 'gpt-token')).status, 403)
    assert.equal((await call(a.url, 'GET', '/api/bridge/replica/tokens')).status, 200)
    for (let i = 1; i <= 3; i++) await call(a.url, 'POST', '/api/bridge/messages', { id: `g${i}`, type: 'message', to: { agent: 'chatgpt' }, from: { agent: 'claude' }, body: { i } })
    const rb = createReplicator(b.bridge.queue, { 'node-a': { url: a.url, token: 'peer-secret' } }, { intervalMs: 0, pageSize: 2, tokenFile: tokB })
    const first = await rb.pull(rb.peers[0])
    assert.equal(first.ok, true, first.error)
    assert.equal(first.inserted, 3)
    assert.equal(first.pages, 2, 'paged by cursor')
    assert.equal(first.tokens.added, 1, 'chatgpt token hash copied')

    // Owner down.
    a.close()
    const down = await rb.pull(rb.peers[0])
    assert.equal(down.ok, false)
    assert.equal(b.bridge.queue.replicaStatus()[0].after_rev, first.after, 'cursor kept across the outage')
    // ChatGPT reads and acks on b with its own token (b learned it by replication).
    const inbox = (await mcpTool(b.url, 'bridge_inbox', { agent: 'chatgpt', unacked: true }, 'gpt-token')).structuredContent.result
    assert.deepEqual(inbox.messages.map((m) => m.id), ['g1', 'g2', 'g3'])
    const ack = (await mcpTool(b.url, 'bridge_send', { to_agent: 'bridge', type: 'ack', body: { ids: ['g1', 'g2'] } }, 'gpt-token')).structuredContent.result
    assert.deepEqual(ack.acked, ['g1', 'g2'])
    await mcpTool(b.url, 'bridge_send', { to_agent: 'claude-code', type: 'message', from_agent: 'chatgpt', body: { reply_to: 'g1', text: 'ok' } }, 'gpt-token')

    // Owner back on the same database, with mail it took while b could not see it.
    a = await node({ machine: 'node-a', dbPath: dbA, tokenFile: tokA, dir })
    await call(a.url, 'POST', '/api/bridge/messages', { id: 'g4', type: 'message', to: { agent: 'chatgpt' }, from: { agent: 'claude' }, body: {} })
    const rb2 = createReplicator(b.bridge.queue, { 'node-a': { url: a.url, token: 'peer-secret' } }, { intervalMs: 0, pageSize: 2, tokenFile: tokB })
    const catchup = await rb2.pull(rb2.peers[0])
    assert.equal(catchup.ok, true, catchup.error)
    assert.equal(catchup.inserted, 1, 'only what was missed')
    const ra = createReplicator(a.bridge.queue, { 'node-b': { url: b.url, token: 'peer-secret' } }, { intervalMs: 0, tokenFile: tokA })
    const fromB = await ra.pull(ra.peers[0])
    assert.equal(fromB.ok, true, fromB.error)
    const st = (await call(a.url, 'GET', '/api/bridge/delivery/g1')).body
    assert.equal(st.acked_by, 'chatgpt')
    assert.equal(st.state, 'responded')
    assert.equal((await call(a.url, 'GET', '/api/bridge/delivery?agent=chatgpt')).body.pending.unacked, 2, 'owner sees g3 and g4 still open')
    assert.equal((await call(b.url, 'GET', '/api/bridge/delivery?agent=chatgpt')).body.pending.unacked, 2, 'both nodes agree')
    assert.equal(fromB.tokens.added, 0, 'imported hashes are not sent back')
  } finally { a.close(); b.close() }
})

// ---- dispatch: message with execution intent -> headless run (dispatch.mjs) ----
const GPT = { name: 'chatgpt', sha256: sha256('gpt-token'), scopes: ['send', 'read', 'execute'], projects: ['*'] }
const OTHER = { name: 'other', sha256: sha256('other-token'), scopes: ['send', 'read', 'execute'], projects: ['*'] }
const NOEXEC = { name: 'noexec', sha256: sha256('noexec-token'), scopes: ['send', 'read'], projects: ['*'] }
const DISPATCH = (extra = {}) => ({ dispatch: { enabled: true, agents: ['remote'], after_seq: 0, allow: [{ principal: 'chatgpt', from_agents: ['chatgpt'], projects: ['*'] }], ...extra } })
const execMsg = (id, task, extra = {}) => ({ id, type: 'message', to: { agent: 'remote' }, from: { agent: 'chatgpt' }, body: { execution: { requested: true, model: 'haiku', task, ...extra } } })
const runsOf = (n) => n.bridge.queue.list({ agent: 'claude-code', limit: 500 }).filter((m) => m.type === 'submit')
const threadOf = async (n, id) => (await call(n.url, 'GET', `/api/bridge/threads/${id}`, null, 'gpt-token')).body

test('dispatch: authorized execution message runs once, CLAIMED -> RUNNING -> SUCCEEDED, result replies to the original', async () => {
  const n = await node({ tokens: [GPT], policy: DISPATCH() })
  try {
    const sent = await call(n.url, 'POST', '/api/bridge/messages', execMsg('x1', 'echo DISPATCH-OK'), 'gpt-token')
    assert.equal(sent.status, 200)
    assert.equal(sent.body.state, 'queued', 'stored first; nothing claimed yet')
    const t = await waitFor(async () => { const th = await threadOf(n, 'x1'); return th.some((m) => m.type === 'result') && th })
    const st = (type) => t.filter((m) => m.type === type)
    assert.equal(st('status')[0].body.state, 'CLAIMED')
    assert.equal(st('accept')[0].body.state, 'RUNNING')
    const result = st('result')[0]
    assert.equal(result.body.state, 'SUCCEEDED')
    assert.match(result.body.text, /echo DISPATCH-OK/)
    assert.match(result.body.text, /untrusted input/, 'task wrapped as untrusted input')
    assert.equal(result.reply_to, 'x1')
    assert.deepEqual(result.from, { machine: 'a', agent: 'remote' })
    assert.deepEqual(result.to, { machine: 'a', agent: 'chatgpt' })
    for (const m of t.filter((m) => m.id !== 'x1')) assert.equal(m.correlation_id, 'x1')
    const d = (await call(n.url, 'GET', '/api/bridge/delivery/x1', null, 'gpt-token')).body
    assert.equal(d.acked_by, 'dispatch@a')
    assert.equal(d.state, 'responded')
    assert.ok(d.acked_at <= d.responded_at)
    assert.equal(runsOf(n).length, 1)
    const inbox = (await call(n.url, 'GET', '/api/bridge/inbox/chatgpt', null, 'gpt-token')).body
    assert.ok(inbox.messages.some((m) => m.type === 'result' && m.reply_to === 'x1'), 'result is in the chatgpt mailbox')
  } finally { n.close() }
})

test('dispatch: plain message, ACK-OK and non-true intent never launch a run', async () => {
  const n = await node({ tokens: [GPT], policy: DISPATCH() })
  try {
    const send = (id, body) => call(n.url, 'POST', '/api/bridge/messages', { id, type: 'message', to: { agent: 'remote' }, from: { agent: 'chatgpt' }, body }, 'gpt-token')
    await send('p1', { text: 'please build the thing' })
    await send('p2', { text: 'ACK-OK' })
    await send('p3', { execution: { requested: 'true', task: 'string is not true' } })
    await send('p4', { execution: { requested: false, task: 'x' } })
    n.bridge.queue.enqueue({ id: 'p5', type: 'result', to: { agent: 'remote' }, from: { agent: 'chatgpt' }, body: { execution: { requested: true, task: 'x' } } })
    await sleep(400); n.bridge.workers.dispatcher.tick({ force: true }); await sleep(200)
    assert.equal(runsOf(n).length, 0)
    assert.equal(n.bridge.queue.pending('remote').unacked, 5, 'all stay in the mailbox for a person')
  } finally { n.close() }
})

test('dispatch: backlog before after_seq is not replayed; disabled dispatch runs nothing', async () => {
  const dir = tmp()
  const n = await node({ tokens: [GPT], dir, policy: DISPATCH({ enabled: false }) })
  try {
    for (const id of ['old1', 'old2']) await call(n.url, 'POST', '/api/bridge/messages', execMsg(id, 'old'), 'gpt-token')
    await sleep(300); n.bridge.workers.dispatcher.tick({ force: true })
    assert.equal(runsOf(n).length, 0, 'disabled')
    const last = n.bridge.queue.get('old2').seq
    writeFileSync(join(dir, 'bridge-policy.json'), JSON.stringify(DISPATCH({ after_seq: last })))
    await call(n.url, 'POST', '/api/bridge/messages', execMsg('new1', 'new'), 'gpt-token')
    await waitFor(async () => (await threadOf(n, 'new1')).some((m) => m.type === 'result'))
    assert.deepEqual(runsOf(n).map((m) => m.body.dispatch.message_id), ['new1'])
    const h = (await call(n.url, 'GET', '/api/bridge/health', null, 'gpt-token')).body.dispatch
    assert.equal(h.enabled, true)
    assert.equal(h.backlog_not_replayed, 2)
  } finally { n.close() }
})

test('dispatch: sender not allowed is refused once; no execute scope is refused at ingress; requires_approval is refused', async () => {
  const n = await node({ tokens: [GPT, OTHER, NOEXEC], policy: DISPATCH() })
  try {
    assert.equal((await call(n.url, 'POST', '/api/bridge/messages', execMsg('n1', 'x'), 'noexec-token')).status, 403)
    assert.equal((await call(n.url, 'POST', '/api/bridge/messages', execMsg('n2', 'x', { permission_mode: 'auto' }), 'gpt-token')).status, 403, 'auto needs the auto scope')
    await call(n.url, 'POST', '/api/bridge/messages', { ...execMsg('o1', 'x'), from: { agent: 'other' } }, 'other-token')
    await call(n.url, 'POST', '/api/bridge/messages', execMsg('o2', 'x'), 'other-token') // from.agent chatgpt, but not the chatgpt token
    await call(n.url, 'POST', '/api/bridge/messages', execMsg('r1', 'x', { requires_approval: true }), 'gpt-token')
    for (let i = 0; i < 3; i++) { await sleep(150); n.bridge.workers.dispatcher.tick({ force: true }) }
    assert.equal(runsOf(n).length, 0)
    for (const id of ['o1', 'o2', 'r1']) {
      const errs = n.bridge.queue.list({ correlation: id }).filter((m) => m.type === 'error')
      assert.equal(errs.length, 1, `${id} refused exactly once`)
      assert.equal(errs[0].body.state, 'REFUSED')
    }
    assert.equal(n.bridge.queue.pending('remote').unacked, 3, 'refused mail stays unacked')
  } finally { n.close() }
})

test('dispatch: duplicate sends and a restart never start a second run; two tasks run concurrently', async () => {
  const dir = tmp()
  const dbPath = join(dir, 'bridge.db')
  let n = await node({ tokens: [GPT], dir, dbPath, policy: DISPATCH() })
  try {
    const m = { ...execMsg('d1', 'one'), dedupe_key: 'dk-1' }
    await call(n.url, 'POST', '/api/bridge/messages', m, 'gpt-token')
    const dup = await call(n.url, 'POST', '/api/bridge/messages', { ...m, id: 'd1-again' }, 'gpt-token')
    assert.equal(dup.body.duplicate, true)
    await call(n.url, 'POST', '/api/bridge/messages', execMsg('d2', 'two'), 'gpt-token')
    await waitFor(async () => (await threadOf(n, 'd1')).some((x) => x.type === 'result') && (await threadOf(n, 'd2')).some((x) => x.type === 'result'))
    assert.equal(runsOf(n).length, 2)
    n.close()
    // A crash between creating the run and acking the message: the message is queued again.
    n = await node({ tokens: [GPT], dir, dbPath, policy: DISPATCH() })
    n.bridge.queue.db.prepare("UPDATE bridge_messages SET state = 'queued', acked_at = NULL WHERE id = 'd1'").run()
    await sleep(300); n.bridge.workers.dispatcher.tick({ force: true }); await sleep(300)
    assert.equal(runsOf(n).length, 2, 'the derived submit dedupe key blocks a second run')
    assert.ok(n.bridge.queue.get('d1').delivery.acked_at, 'and the message is acked')
    assert.equal(n.bridge.queue.list({ correlation: 'd1' }).filter((x) => x.type === 'result').length, 1, 'one result only')
  } finally { n.close() }
})

test('dispatch: failed run reports FAILED with reply_to; replicas of peer mail are never dispatched', async () => {
  const n = await node({ tokens: [GPT], policy: DISPATCH() })
  try {
    await call(n.url, 'POST', '/api/bridge/messages', execMsg('f1', 'FAIL please'), 'gpt-token')
    const t = await waitFor(async () => { const th = await threadOf(n, 'f1'); return th.some((m) => m.type === 'error') && th })
    const err = t.find((m) => m.type === 'error')
    assert.equal(err.body.state, 'FAILED')
    assert.equal(err.reply_to, 'f1')
    n.bridge.queue.applyReplica([{ id: 'rep1', dedupe_key: 'rep1', v: 1, type: 'message', from_machine: 'b', from_agent: 'chatgpt', to_machine: 'b', to_agent: 'remote',
      body: JSON.stringify({ execution: { requested: true, task: 'x', model: 'haiku' } }), state: 'queued', created_at: new Date().toISOString() }], 'b')
    await sleep(200); n.bridge.workers.dispatcher.tick({ force: true }); await sleep(200)
    assert.ok(!runsOf(n).some((m) => m.body.dispatch.message_id === 'rep1'))
  } finally { n.close() }
})
