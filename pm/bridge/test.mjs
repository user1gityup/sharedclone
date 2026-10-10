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
import { chooseModel, loadRouter } from './weight.mjs'

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

// ---- HTTP-level tests against a real server on an ephemeral port -----------
async function node({ machine = 'a', tokens = [], trustLoopback = false, peers = {}, quota, dbPath = ':memory:', dir = tmp(), notify = null, policy = null, sweepMs } = {}) {
  const policyPath = join(dir, 'bridge-policy.json')
  if (policy) writeFileSync(policyPath, JSON.stringify(policy))
  const bridge = createBridge({
    machine, dbPath, peers, notify, policyPath,
    auth: createAuth({ tokens, peerToken: 'peer-secret', trustLoopback }),
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
