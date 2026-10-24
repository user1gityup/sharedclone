// node --test blitz/capacity.test.mjs   (run from pm/)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, PmError } from '../store.mjs'
import { createServer } from '../server.mjs'
import { readClaude, readDshQuotas, yamlSection, probeLlama, buildSnapshot, createCapacityStore } from './capacity.mjs'

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const NOW = Date.parse('2026-10-19T06:00:00Z')
const tmp = () => mkdtempSync(join(tmpdir(), 'blitz-cap-'))
const MACHINES = new Set(['vmixer2o2', 'vmixer', 'ndi2', 'vmixlaptop2x6'])

// Shaped like the real ~/.dsh/settings.yaml quota sections, folded strings included.
const SETTINGS = `other:
  x: 1
claude-quota:
  sessionPercent: 13
codex-quota:
  refreshState: ok
  bucketsJson: '[{"id":"codex","label":"codex","primary":{"remaining":80,"minutes":300},"secondary":{"remaining":60,"minutes":10080}}]'
  capturedAt: ${NOW - 60_000}
antigravity-quota:
  refreshState: ok
  bucketsJson: '[{"id":"gemini-weekly","group":"Gemini Models","label":"Weekly
    Limit
    Remaining","remaining":90},{"id":"3p-weekly","label":"it''s
    folded","remaining":40}]'
  capturedAt: ${NOW - 60_000}
  seatsJson: '[{"id":"seat1"},{"id":"seat2"}]'
aws-quota:
  refreshState: unconfigured
  seatJson: '{"installed":true,"health":{"state":"headless_unavailable","cause":"logged_out"}}'
  accountsJson: "[]"
tail:
  y: 2
`

function files({ usage, exhausted, settings = SETTINGS } = {}) {
  const dir = tmp()
  const f = { usageFile: join(dir, 'usage-cache.json'), exhaustedFile: join(dir, 'exhausted.json'), settingsFile: join(dir, 'settings.yaml') }
  if (usage !== undefined) writeFileSync(f.usageFile, typeof usage === 'string' ? usage : JSON.stringify(usage))
  if (exhausted !== undefined) writeFileSync(f.exhaustedFile, JSON.stringify(exhausted))
  if (settings !== null) writeFileSync(f.settingsFile, settings)
  return f
}

test('claude: fresh cache gives headroom from the worse of session and week', () => {
  const f = files({ usage: { capturedAt: NOW - 60_000, sessionPercent: 12, weekPercent: 30, sessionResets: 'a', weekResets: 'b' } })
  const c = readClaude({ ...f, now: NOW })
  assert.equal(c.stale, false)
  assert.equal(c.headroomPercent, 70)
  assert.equal(c.exhausted, false)
  assert.equal(c.weekResets, 'b')
})

test('claude: stale, missing and malformed caches give no headroom', () => {
  const stale = readClaude({ ...files({ usage: { capturedAt: NOW - 3_600_000, sessionPercent: 1, weekPercent: 1 } }), now: NOW })
  assert.equal(stale.stale, true)
  assert.equal(stale.headroomPercent, null)
  const missing = readClaude({ ...files(), now: NOW })
  assert.equal(missing.error, 'usage cache missing')
  assert.equal(missing.headroomPercent, null)
  const bad = readClaude({ ...files({ usage: '{nope' }), now: NOW })
  assert.match(bad.error, /unreadable/)
})

test('claude: exhausted marker absent = not exhausted; present = zero headroom', () => {
  const usage = { capturedAt: NOW, sessionPercent: 10, weekPercent: 10 }
  assert.equal(readClaude({ ...files({ usage }), now: NOW }).exhausted, false)
  const ex = readClaude({ ...files({ usage, exhausted: { until: 'Oct 25' } }), now: NOW })
  assert.equal(ex.exhausted, true)
  assert.equal(ex.headroomPercent, 0)
  assert.deepEqual(ex.exhaustedDetail, { until: 'Oct 25' })
})

test('yamlSection reads flat keys and folded quoted strings, stops at the next section', () => {
  const s = yamlSection(SETTINGS, 'antigravity-quota')
  assert.equal(s.refreshState, 'ok')
  const b = JSON.parse(s.bucketsJson)
  assert.equal(b[0].label, 'Weekly Limit Remaining')
  assert.equal(b[1].label, "it's folded")
  assert.equal(yamlSection(SETTINGS, 'missing'), null)
  assert.deepEqual(yamlSection(SETTINGS, 'other'), { x: 1 })
})

test('dsh quotas: codex, antigravity and aws from the published sections', () => {
  const q = readDshQuotas({ settingsFile: files().settingsFile, now: NOW })
  assert.equal(q.codex.headroomPercent, 60)
  assert.equal(q.codex.stale, false)
  assert.equal(q.antigravity.headroomPercent, 40)
  assert.equal(q.antigravity.seats, 2)
  assert.equal(q.aws.state, 'unconfigured')
  assert.equal(q.aws.accounts, 0)
  assert.equal(q.aws.health.cause, 'logged_out')
  assert.equal(q.aws.headroomPercent, null)
})

test('dsh quotas: stale readings give no headroom; missing file reported per source', () => {
  const q = readDshQuotas({ settingsFile: files().settingsFile, now: NOW + 3_600_000 })
  assert.equal(q.codex.stale, true)
  assert.equal(q.codex.headroomPercent, null)
  const none = readDshQuotas({ settingsFile: files({ settings: null }).settingsFile, now: NOW })
  assert.equal(none.codex.error, 'DSH settings missing')
  const empty = readDshQuotas({ settingsFile: files({ settings: 'x:\n  y: 1\n' }).settingsFile, now: NOW })
  assert.match(empty.antigravity.error, /no antigravity-quota/)
})

const fakeFetch = (routes) => async (url) => {
  const path = new URL(url).pathname
  if (!(path in routes)) throw new Error('ECONNREFUSED')
  const [status, body] = routes[path]
  return { ok: status < 400, status, json: async () => body }
}

test('llama: up with model, down, and error states; never a throughput', async () => {
  const up = await probeLlama({ url: 'http://x:8090', fetchImpl: fakeFetch({ '/health': [200, { status: 'ok' }], '/v1/models': [200, { data: [{ id: 'qwen' }] }] }) })
  assert.equal(up.up, true)
  assert.equal(up.model, 'qwen')
  assert.equal(up.tokensPerSecond, null)
  const loading = await probeLlama({ url: 'http://x:8090', fetchImpl: fakeFetch({ '/health': [503, {}] }) })
  assert.equal(loading.up, false)
  assert.equal(loading.status, 503)
  const down = await probeLlama({ url: 'http://x:8090', fetchImpl: fakeFetch({}) })
  assert.equal(down.up, false)
  assert.match(down.error, /ECONNREFUSED/)
})

test('snapshot puts every source together; unknown slots stay null', async () => {
  const f = files({ usage: { capturedAt: NOW, sessionPercent: 0, weekPercent: 50 } })
  const s = await buildSnapshot({ machine: 'vmixer2o2', now: NOW, claude: f, dsh: f, llamaOpts: { fetchImpl: fakeFetch({}) } })
  assert.equal(s.machine, 'vmixer2o2')
  assert.equal(s.slots.max, null)
  assert.equal(s.quota.claude.headroomPercent, 50)
  assert.equal(s.quota.codex.headroomPercent, 60)
  assert.equal(s.local.up, false)
  const noLlama = await buildSnapshot({ machine: 'ndi2', slots: 4, llama: false, now: NOW, claude: f, dsh: f })
  assert.equal(noLlama.local, null)
  assert.equal(noLlama.slots.max, 4)
})

test('capacity store: report, list with live slot use, stale after two intervals', () => {
  let t = new Date(NOW)
  const store = openStore(':memory:')
  const cap = createCapacityStore(new DatabaseSync(':memory:'), { store, machines: MACHINES, clock: () => t })
  assert.throws(() => cap.report({}, { machine: 'vmixer2o2', quota: {} }), (e) => e instanceof PmError && e.status === 400)
  assert.throws(() => cap.report(W, { machine: 'mars', quota: {} }), /machine must be/)
  assert.throws(() => cap.report(W, { machine: 'vmixer2o2' }), /quota is required/)
  assert.throws(() => cap.report(W, { machine: 'vmixer2o2', quota: {}, pad: 'x'.repeat(70_000) }), (e) => e.status === 413)

  store.createProject(W, { name: 'p' })
  const task = store.createTask(W, { project: 'p', title: 't' })
  store.startRun(W, task.id, { kind: 'shell', machine: 'vmixer', state: 'running' })
  cap.report(W, { machine: 'vmixer2o2', interval_ms: 60_000, slots: { max: 3 }, quota: { claude: { headroomPercent: 80 } } })
  cap.report(W, { machine: 'ndi2', quota: {} })
  let rows = cap.list()
  assert.deepEqual(rows.map((r) => r.machine), ['ndi2', 'vmixer2o2'])
  const v = rows.find((r) => r.machine === 'vmixer2o2')
  assert.deepEqual(v.slots, { max: 3, used: 1, free: 2 })
  assert.equal(v.stale, false)
  assert.equal(v.reported_by, 'Claude Opus 5.5')
  assert.deepEqual(rows.find((r) => r.machine === 'ndi2').slots, { max: null, used: 0, free: null })
  t = new Date(NOW + 121_000)
  rows = cap.list()
  assert.ok(rows.every((r) => r.stale))
  cap.report(W, { machine: 'vmixer2o2', interval_ms: 60_000, quota: {} })
  assert.equal(cap.list().find((r) => r.machine === 'vmixer2o2').stale, false)
})

async function serve(token = 'tok') {
  const store = openStore(':memory:')
  const server = createServer(store, { token })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-pm-actor': 'Claude Opus 5.5', ...headers }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, body: await r.json() }
  }
  return { store, server, call }
}

test('HTTP: blitz routes work, need the token remotely, and leave other routes alone', async () => {
  const { server, call } = await serve()
  try {
    assert.deepEqual((await call('GET', '/api/blitz/agents')).body, [])
    const remote = { 'x-forwarded-for': '10.0.0.9' }
    assert.equal((await call('GET', '/api/blitz/agents', null, remote)).status, 401)
    assert.equal((await call('GET', '/api/blitz/agents', null, { ...remote, authorization: 'Bearer tok' })).status, 200)

    const made = await call('POST', '/api/blitz/agents', { name: 'Ada Lovelace', role: 'builder', machine: 'vmixer2o2', transport: 'codex', model_policy: { policy: 'SUBSCRIPTION_FIRST' }, max_concurrent: 1 })
    assert.equal(made.status, 200)
    assert.equal((await call('GET', '/api/blitz/agents/Ada%20Lovelace')).body.role, 'builder')
    assert.equal((await call('PATCH', '/api/blitz/agents/Ada%20Lovelace', { rev: 9, role: 'x' })).status, 409)
    assert.equal((await call('PATCH', '/api/blitz/agents/Ada%20Lovelace', { rev: 1, role: 'reviewer' })).body.rev, 2)
    assert.equal((await call('POST', '/api/blitz/agents/Ada%20Lovelace/disable', { rev: 2 })).body.enabled, false)
    assert.equal((await call('POST', '/api/blitz/agents', { name: 'x' })).status, 400)
    assert.equal((await call('GET', '/api/blitz/agents/nobody')).status, 404)

    assert.equal((await call('POST', '/api/blitz/capacity/report', { machine: 'vmixer2o2', quota: { claude: {} } })).status, 200)
    const cap = await call('GET', '/api/blitz/capacity')
    assert.equal(cap.body[0].machine, 'vmixer2o2')
    assert.equal(cap.body[0].slots.used, 0)

    assert.equal((await call('GET', '/api/blitz/nothing')).status, 404)
    assert.equal((await call('GET', '/api/health')).body.ok, true)
    assert.equal((await call('GET', '/api/projects')).status, 200)
  } finally {
    server.close()
  }
})
