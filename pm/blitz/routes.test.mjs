// node --test blitz/routes.test.mjs   (run from pm/)
// BLITZ-03 over HTTP: rating route, server-bound approval requests, decide roles,
// the start/resume/continue/runs gate, revoke, governed projects, bridge off.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'pm-blitz-routes-'))
process.env.BRIDGE_TOKENS = join(DIR, 'bridge-tokens.json')
process.env.BRIDGE_PEERS = join(DIR, 'bridge-peers.json')
process.env.BRIDGE_POLICY = join(DIR, 'bridge-policy.json')
process.env.BRIDGE_DB = join(DIR, 'bridge-default.db')
process.env.PM_DB = join(DIR, 'pm-default.db')
process.env.PM_BRAIN_DIR = join(DIR, 'brain')
process.env.PM_BRAIN_AUDIT = join(DIR, 'brain-write-audit.jsonl')

const { createBridge } = await import('../bridge/index.mjs')
const { createAuth, sha256 } = await import('../bridge/auth.mjs')
const { openStore } = await import('../store.mjs')
const { createServer } = await import('../server.mjs')
const approvals = await import('../approvals.mjs')
const roles = await import('../roles.mjs')

const PEER = 'peer-secret-token'
const TOKENS = {
  chatgpt: { secret: 'chatgpt-secret-token', scopes: ['send', 'read'], projects: ['*'] },
  other: { secret: 'other-secret-token', scopes: ['send', 'read'], projects: ['P-elsewhere'] },
}
const tokenList = Object.entries(TOKENS).map(([name, t]) => ({ name, sha256: sha256(t.secret), scopes: t.scopes, projects: t.projects }))
const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const RATING = { priority: 1, effort: 2, complexity: 3, risk: 2, resources: { model_class: 'paid' }, dependency: { depends_on: [] }, verification: { level: 'unit' }, rationale: 'r' }
const ASK = { scope: { repo: '~/.claude/shared-brain', branch: 'blitz-03', files: ['pm/blitz/*.mjs'] }, permissions: ['fs_write'], version: 'd62a0b9f', merge_limit: 'queue_gatekeeper' }

const cleanups = []
after(() => {
  for (const fn of cleanups.reverse()) { try { fn() } catch {} }
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

let n = 0
async function pmNode({ withBridge = true } = {}) {
  const dir = join(DIR, `n${++n}`)
  const store = openStore(join(dir, 'pm.db'))
  const bridge = withBridge ? createBridge({
    machine: 'testbox', dbPath: join(dir, 'bridge.db'), peers: {}, policyPath: join(dir, 'policy.json'),
    tokenFile: join(dir, 'tokens.json'), replica: { intervalMs: 0 },
    auth: createAuth({ tokens: tokenList, peerToken: PEER, trustLoopback: true }),
    workers: { router: null, logDir: join(dir, 'logs') },
  }) : null
  const server = createServer(store, { token: PEER, bridge })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  cleanups.push(() => { server.close(); bridge?.stop(); store.close() })
  const url = `http://127.0.0.1:${server.address().port}`
  const db = bridge?.queue.db
  if (db) {
    roles.assignRole(db, { identity: 'ada', role: 'admin', by: 'test' })
    roles.assignRole(db, { identity: 'wanda', role: 'worker', by: 'test' })
  }
  const p = store.createProject(W, { name: 'blitz' })
  const p2 = store.createProject(W, { name: 'other' })
  if (db) roles.assignRole(db, { identity: 'mona', role: 'manager', project: p.id, by: 'test' })
  if (db) roles.assignRole(db, { identity: 'otto', role: 'manager', project: p2.id, by: 'test' })
  const task = (meta = { blitz: {} }, project = p.id) => store.createTask(W, { project, title: 'build', body: 'b', meta })
  return { url, store, db, p, p2, task }
}

async function call(url, method, path, body, token) {
  const secret = token == null ? null : token === 'peer' ? PEER : TOKENS[token].secret
  const res = await fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-pm-actor': W.actor, 'x-pm-model': W.model, ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const decide = (url, id, approver, token, extra = {}) =>
  call(url, 'POST', `/api/bridge/approvals/${id}/decide`, { approver, method: 'pm_ui', proof: { approver }, decision: 'approved', ...extra }, token)
const isGated = (r) => r.status === 409 && r.body?.code === 'APPROVAL_REQUIRED'

test('rating route: merges into meta, validates, stale rev 409', async () => {
  const { url, task } = await pmNode()
  const t = task({ keep: 1 })
  const r = await call(url, 'PUT', `/api/tasks/${t.id}/rating`, { rev: t.rev, ...RATING })
  assert.equal(r.status, 200)
  const meta = JSON.parse(r.body.meta)
  assert.equal(meta.keep, 1)
  assert.equal(meta.blitz.rating.complexity, 3)
  assert.equal(meta.blitz.rating.rated_by, W.actor)
  assert.equal((await call(url, 'PUT', `/api/tasks/${t.id}/rating`, { rev: t.rev, ...RATING })).status, 409)
  assert.equal((await call(url, 'PUT', `/api/tasks/${t.id}/rating`, { rev: r.body.rev, ...RATING, risk: 9 })).status, 400)
})

test('approval request: server binds project, rev and hash; push merge limit refused', async () => {
  const { url, task, p } = await pmNode()
  const t = task()
  const r = await call(url, 'POST', `/api/blitz/tasks/${t.id}/approvals`, { kind: 'task_scope', ...ASK, task_rev: 999, scope_hash: '0'.repeat(64), project: 'P-forged' })
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'pending')
  assert.equal(r.body.scope.task_rev, t.rev)
  assert.equal(r.body.scope.project, p.id)
  assert.notEqual(r.body.scope.scope_hash, '0'.repeat(64))
  assert.equal(r.body.requested_by, W.actor)
  assert.equal((await call(url, 'POST', `/api/blitz/tasks/${t.id}/approvals`, { kind: 'task_scope', ...ASK, merge_limit: 'push' })).status, 400)
  assert.equal((await call(url, 'POST', `/api/blitz/tasks/${t.id}/approvals`, { kind: 'grant', ...ASK })).status, 400)
  assert.equal((await call(url, 'POST', `/api/blitz/tasks/${t.id}/approvals`, { kind: 'task_merge', ...ASK })).status, 409)
})

test('gate over HTTP: unapproved governed task refused on start/resume/continue/runs; ungoverned unaffected', async () => {
  const { url, task } = await pmNode()
  const t = task()
  for (const a of ['start', 'resume', 'continue', 'runs']) {
    const r = await call(url, 'POST', `/api/tasks/${t.id}/${a}`, {})
    assert.ok(isGated(r), `${a}: ${r.status} ${JSON.stringify(r.body)}`)
  }
  const plain = task({})
  const r = await call(url, 'POST', `/api/tasks/${plain.id}/start`, {})
  assert.ok(!isGated(r), 'ungoverned start is not gated')
})

test('decide roles: relayed stays pending_user_confirm; worker and other-project manager 403; own manager and admin approve; then the gate opens', async () => {
  const { url, task, p2 } = await pmNode()
  const t = task()
  const ask = async (tt = t) => (await call(url, 'POST', `/api/blitz/tasks/${tt.id}/approvals`, { kind: 'task_scope', ...ASK })).body

  const relayed = await ask()
  const viaChatgpt = await decide(url, relayed.id, 'ada', 'chatgpt')
  assert.equal(viaChatgpt.status, 200)
  assert.equal(viaChatgpt.body.status, 'pending_user_confirm')
  assert.ok(isGated(await call(url, 'POST', `/api/tasks/${t.id}/start`, {})))

  const a = await ask()
  assert.equal((await decide(url, a.id, 'wanda')).status, 403)
  assert.equal((await decide(url, a.id, 'otto')).status, 403)
  assert.equal((await decide(url, a.id, 'nobody')).status, 403)
  const mona = await decide(url, a.id, 'mona')
  assert.equal(mona.status, 200)
  assert.equal(mona.body.status, 'approved')

  const s = await call(url, 'GET', `/api/blitz/tasks/${t.id}/approval-status`)
  assert.equal(s.body.task_scope.ok, true)
  for (const act of ['start', 'runs']) {
    const r = await call(url, 'POST', `/api/tasks/${t.id}/${act}`, {})
    assert.ok(!isGated(r), `${act} passes the gate once approved: ${r.status} ${JSON.stringify(r.body)}`)
  }

  // admin approves in any project
  const t2 = task({ blitz: {} }, p2.id)
  const b = await ask(t2)
  assert.equal((await decide(url, b.id, 'ada')).body.status, 'approved')
})

test('revoke and governed projects need approval/admin power; a token principal sees only its projects', async () => {
  const { url, task, p, db } = await pmNode()
  const t = task()
  const a = (await call(url, 'POST', `/api/blitz/tasks/${t.id}/approvals`, { kind: 'task_scope', ...ASK })).body
  await decide(url, a.id, 'ada')
  assert.equal((await call(url, 'POST', `/api/blitz/approvals/${a.id}/revoke`, { approver: 'wanda', reason: 'x' })).status, 403)
  assert.equal((await call(url, 'POST', `/api/blitz/approvals/${a.id}/revoke`, { approver: 'otto', reason: 'x' })).status, 403)
  const rv = await call(url, 'POST', `/api/blitz/approvals/${a.id}/revoke`, { approver: 'mona', reason: 'scope review' })
  assert.equal(rv.status, 200)
  assert.equal(rv.body.status, 'revoked')
  assert.ok(isGated(await call(url, 'POST', `/api/tasks/${t.id}/start`, {})))

  assert.equal((await call(url, 'POST', '/api/blitz/governed-projects', { project: p.id, approver: 'mona' })).status, 403)
  assert.equal((await call(url, 'POST', '/api/blitz/governed-projects', { project: '*', approver: 'ada' })).status, 400)
  const g = await call(url, 'POST', '/api/blitz/governed-projects', { project: p.id, approver: 'ada' })
  assert.equal(g.status, 200)
  assert.deepEqual(g.body.map((x) => x.project), [p.id])
  const plain = task({})
  assert.ok(isGated(await call(url, 'POST', `/api/tasks/${plain.id}/start`, {})), 'governed project gates a task without meta.blitz')

  // a token limited to another project cannot reach this task's approvals
  roles.assignRole(db, { identity: 'other', role: 'worker', project: 'P-elsewhere', by: 'test' })
  const r = await call(url, 'POST', `/api/blitz/tasks/${t.id}/approvals`, { kind: 'task_scope', ...ASK }, 'other')
  assert.equal(r.status, 404)
  assert.equal(approvals.listApprovals(db, { kind: 'task_scope' }).length, 1)
})

test('bridge off: approval routes 503, meta.blitz tasks fail closed, others unchanged', async () => {
  const { url, task } = await pmNode({ withBridge: false })
  const t = task()
  assert.equal((await call(url, 'POST', `/api/blitz/tasks/${t.id}/approvals`, { kind: 'task_scope', ...ASK })).status, 503)
  assert.ok(isGated(await call(url, 'POST', `/api/tasks/${t.id}/start`, {})))
  assert.ok(!isGated(await call(url, 'POST', `/api/tasks/${task({}).id}/start`, {})))
  assert.equal((await call(url, 'PUT', `/api/tasks/${t.id}/rating`, { rev: t.rev, ...RATING })).status, 200)
})
