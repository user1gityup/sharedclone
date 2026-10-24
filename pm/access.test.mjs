// node --test access.test.mjs   (run from this folder)
// access.mjs: approval decisions, role routes and pm HTTP authorization over the bridge.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'pm-access-test-'))
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
const approvals = await import('./approvals.mjs')
const roles = await import('./roles.mjs')
const { TRUSTED_PRINCIPALS } = await import('./access.mjs')

const PEER = 'peer-secret-token'
const TOKENS = {
  chatgpt: { secret: 'chatgpt-secret-token', scopes: ['send', 'read'], projects: ['*'] },
  adminscoped: { secret: 'adminscoped-secret-token', scopes: ['send', 'read', 'admin'], projects: ['*'] },
  p1only: { secret: 'p1only-secret-token', scopes: ['send', 'read'], projects: ['p1'] },
  lead: { secret: 'lead-secret-token', scopes: ['send', 'read', 'pm'], projects: ['*'] },
  replicator: { secret: 'replicator-secret-token', scopes: ['replicate'], projects: ['*'] },
  replrw: { secret: 'replrw-secret-token', scopes: ['replicate', 'send', 'read'], projects: ['*'] },
}
const tokenList = Object.entries(TOKENS).map(([name, t]) => ({ name, sha256: sha256(t.secret), scopes: t.scopes, projects: t.projects }))

const cleanups = []
after(() => {
  for (const fn of cleanups.reverse()) { try { fn() } catch {} }
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

let n = 0
function makeBridge() {
  const dir = join(DIR, `b${++n}`)
  const bridge = createBridge({
    machine: 'testbox', dbPath: join(dir, 'bridge.db'), peers: {}, policyPath: join(dir, 'policy.json'),
    tokenFile: join(dir, 'tokens.json'), replica: { intervalMs: 0 },
    auth: createAuth({ tokens: tokenList, peerToken: PEER, trustLoopback: true }),
    workers: { router: null, logDir: join(dir, 'logs') },
  })
  return { bridge, dir }
}

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${server.address().port}`
}

async function bridgeNode() {
  const { bridge } = makeBridge()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (!(await bridge.handle(req, res, url))) { res.writeHead(404); res.end() }
  })
  const url = await listen(server)
  cleanups.push(() => { server.close(); bridge.stop() })
  return { url, bridge, db: bridge.queue.db }
}

async function pmNode({ withBridge = true } = {}) {
  const store = openStore(join(DIR, `pm${++n}.db`))
  const bridge = withBridge ? makeBridge().bridge : null
  const server = createServer(store, { token: PEER, bridge })
  const url = await listen(server)
  cleanups.push(() => { server.close(); bridge?.stop(); store.close() })
  return { url, bridge, store, db: bridge?.queue.db }
}

/** token: undefined/null = loopback (no header); a name from TOKENS; 'peer'; or a raw string. */
async function call(url, method, path, body, token) {
  const secret = token == null ? null : token === 'peer' ? PEER : TOKENS[token]?.secret ?? token
  const res = await fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const open = (db, project = 'p1') => approvals.requestApproval(db, { kind: 'grant', scope: { project }, requested_by: 'tester' })
const decide = (url, id, b, token) => call(url, 'POST', `/api/bridge/approvals/${id}/decide`, b, token)

test('trusted principals are loopback and peer only', () => {
  assert.deepEqual([...TRUSTED_PRINCIPALS].sort(), ['loopback', 'peer'])
})

test('decide: no role, worker and client are refused; admin and in-project manager approve', async () => {
  const { url, db } = await bridgeNode()
  roles.assignRole(db, { identity: 'wanda', role: 'worker', by: 'test' })
  roles.assignRole(db, { identity: 'cliff', role: 'client', by: 'test' })
  roles.assignRole(db, { identity: 'ada', role: 'admin', by: 'test' })
  roles.assignRole(db, { identity: 'mona', role: 'manager', project: 'p1', by: 'test' })

  // matrix row 25: identity with no role
  const a = open(db)
  for (const who of ['nobody', 'wanda', 'cliff']) {
    const r = await decide(url, a.id, { approver: who, method: 'pm_ui', proof: { approver: who }, decision: 'approved' })
    assert.equal(r.status, 403, who)
    assert.equal(r.body.code, 'FORBIDDEN', who)
  }
  assert.equal(approvals.getApproval(db, a.id).status, 'pending')

  const ok = await decide(url, a.id, { approver: 'ada', method: 'pm_ui', proof: { approver: 'ada' }, decision: 'approved' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.status, 'approved')
  assert.equal(ok.body.approver, 'ada')

  const inside = open(db, 'p1')
  const m1 = await decide(url, inside.id, { approver: 'mona', method: 'pm_ui', proof: { approver: 'mona' }, decision: 'approved' })
  assert.equal(m1.status, 200)
  assert.equal(m1.body.status, 'approved')

  const outside = open(db, 'p2')
  const m2 = await decide(url, outside.id, { approver: 'mona', method: 'pm_ui', proof: { approver: 'mona' }, decision: 'approved' })
  assert.equal(m2.status, 403)
  assert.equal(approvals.getApproval(db, outside.id).status, 'pending')

  // manager may not use 'link'
  const viaLink = open(db, 'p1')
  const m3 = await decide(url, viaLink.id, { approver: 'mona', method: 'link', proof: { challenge_id: 'x', token: 'y' }, decision: 'approved' })
  assert.equal(m3.status, 403)
  assert.equal(approvals.getApproval(db, viaLink.id).status, 'pending')
})

test('decide: a token principal only relays; the admin confirms over loopback', async () => {
  const { url, db } = await bridgeNode()
  roles.assignRole(db, { identity: 'ada', role: 'admin', by: 'test' })
  const a = open(db)
  // even a pm_ui proof naming the approver is replaced by {via: 'chatgpt'}
  const r = await decide(url, a.id, { approver: 'ada', method: 'pm_ui', proof: { approver: 'ada' }, decision: 'approved' }, 'chatgpt')
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'pending_user_confirm')
  assert.equal(r.body.relayed_decision.via, 'chatgpt')
  assert.equal(r.body.relayed_decision.approver, 'ada')
  assert.equal(r.body.method, undefined)

  const c = await decide(url, a.id, { approver: 'ada', method: 'pm_ui', proof: { approver: 'ada' }, decision: 'approved' })
  assert.equal(c.status, 200)
  assert.equal(c.body.status, 'approved')
  assert.equal(c.body.method, 'pm_ui')
  assert.ok(c.body.audit.some((e) => e.action === 'confirmed_approved'))
})

test('challenge: loopback only; otp decides once, replay is 409', async () => {
  const { url, db } = await bridgeNode()
  roles.assignRole(db, { identity: 'ada', role: 'admin', by: 'test' })
  const a = open(db)

  const refused = await call(url, 'POST', `/api/bridge/approvals/${a.id}/challenge`, { method: 'otp', approver: 'ada' }, 'adminscoped')
  assert.equal(refused.status, 403)
  const peer = await call(url, 'POST', `/api/bridge/approvals/${a.id}/challenge`, { method: 'otp', approver: 'ada' }, 'peer')
  assert.equal(peer.status, 403)

  const ch = await call(url, 'POST', `/api/bridge/approvals/${a.id}/challenge`, { method: 'otp', approver: 'ada' })
  assert.equal(ch.status, 200)
  assert.match(ch.body.code, /^\d{6}$/)
  assert.equal(ch.body.method, 'otp')

  const proof = { challenge_id: ch.body.id, code: ch.body.code }
  const ok = await decide(url, a.id, { approver: 'ada', method: 'otp', proof, decision: 'approved' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.status, 'approved')
  assert.equal(ok.body.method, 'otp')

  // reusing the code on the decided approval is refused with 409
  const replay = await decide(url, a.id, { approver: 'ada', method: 'otp', proof, decision: 'approved' })
  assert.equal(replay.status, 409)

  // a second challenge used twice on a still-open approval: the second use is REPLAY 409
  const b = open(db)
  const ch2 = await call(url, 'POST', `/api/bridge/approvals/${b.id}/challenge`, { method: 'otp', approver: 'ada' })
  const proof2 = { challenge_id: ch2.body.id, code: ch2.body.code }
  const rej = await decide(url, b.id, { approver: 'ada', method: 'otp', proof: proof2, decision: 'rejected' })
  assert.equal(rej.status, 200)
  const again = await decide(url, b.id, { approver: 'ada', method: 'otp', proof: proof2, decision: 'approved' })
  assert.equal(again.status, 409)
})

test('challenge replay on an open approval returns REPLAY 409', () => {
  // HTTP cannot reach REPLAY on a decided approval (CONFLICT fires first); check the code path directly.
  const { bridge } = makeBridge()
  cleanups.push(() => bridge.stop())
  const db = bridge.queue.db
  roles.assignRole(db, { identity: 'ada', role: 'admin', by: 'test' })
  const a = open(db)
  const ch = approvals.issueChallenge(db, a.id, { method: 'otp', approver: 'ada' })
  db.prepare('UPDATE approval_challenges SET used_at = ? WHERE id = ?').run(new Date().toISOString(), ch.id)
  assert.throws(() => approvals.decideApproval(db, a.id, { approver: 'ada', method: 'otp', proof: { challenge_id: ch.id, code: ch.code }, decision: 'approved' }),
    (e) => e.code === 'REPLAY')
})

test('project-limited token cannot see approvals of other projects', async () => {
  const { url, db } = await bridgeNode()
  const a1 = open(db, 'p1')
  const a2 = open(db, 'p2')
  const list = await call(url, 'GET', '/api/bridge/approvals', undefined, 'p1only')
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.map((a) => a.id), [a1.id])
  assert.equal((await call(url, 'GET', `/api/bridge/approvals/${a2.id}`, undefined, 'p1only')).status, 404)
  const own = await call(url, 'GET', `/api/bridge/approvals/${a1.id}`, undefined, 'p1only')
  assert.equal(own.status, 200)
  assert.equal(own.body.id, a1.id)
  // deciding a hidden approval is also 404
  assert.equal((await decide(url, a2.id, { approver: 'x', decision: 'approved' }, 'p1only')).status, 404)
  // the unrestricted token sees both
  const all = await call(url, 'GET', '/api/bridge/approvals', undefined, 'chatgpt')
  assert.equal(all.body.length, 2)
})

test('roles routes: admin scope required; loopback assigns, lists and revokes', async () => {
  const { url } = await bridgeNode()
  const denied = await call(url, 'POST', '/api/bridge/roles', { identity: 'chatgpt', role: 'admin' }, 'chatgpt')
  assert.equal(denied.status, 403)
  const delDenied = await call(url, 'DELETE', '/api/bridge/roles?identity=x', undefined, 'chatgpt')
  assert.equal(delDenied.status, 403)

  const set = await call(url, 'POST', '/api/bridge/roles', { identity: 'mona', role: 'manager', project: 'p1' })
  assert.equal(set.status, 200)
  assert.equal(set.body.length, 1)
  assert.equal(set.body[0].role, 'manager')
  assert.equal(set.body[0].project, 'p1')
  assert.equal(set.body[0].assigned_by, 'loopback')

  const viaAdminToken = await call(url, 'POST', '/api/bridge/roles', { identity: 'wanda', role: 'worker' }, 'adminscoped')
  assert.equal(viaAdminToken.status, 200)
  assert.equal(viaAdminToken.body[0].assigned_by, 'adminscoped')

  const bad = await call(url, 'POST', '/api/bridge/roles', { identity: 'x', role: 'manager' })
  assert.equal(bad.status, 400)

  const list = await call(url, 'GET', '/api/bridge/roles', undefined, 'chatgpt')
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.map((r) => r.identity).sort(), ['mona', 'wanda'])
  const one = await call(url, 'GET', '/api/bridge/roles?identity=mona')
  assert.deepEqual(one.body.map((r) => r.identity), ['mona'])

  const rev = await call(url, 'DELETE', '/api/bridge/roles', { identity: 'mona', project: 'p1' })
  assert.equal(rev.status, 200)
  assert.deepEqual(rev.body, [])
  const after2 = await call(url, 'GET', '/api/bridge/roles')
  assert.deepEqual(after2.body.map((r) => r.identity), ['wanda'])
  assert.equal((await call(url, 'DELETE', '/api/bridge/roles', {})).status, 400)
})

test('pm HTTP with bridge: loopback/peer full access, token principals role-checked', async () => {
  const { url, store, db } = await pmNode()
  assert.equal((await call(url, 'GET', '/api/projects')).status, 200)
  assert.equal((await call(url, 'GET', '/api/projects', undefined, 'peer')).status, 200)
  const peerMade = await call(url, 'POST', '/api/projects', { name: 'peerproj', actor: 'Claude Opus 5.5' }, 'peer')
  assert.equal(peerMade.status, 200)
  assert.equal(peerMade.body.created_by, 'Claude Opus 5.5')

  // matrix row 29: token principal with no role
  assert.equal((await call(url, 'GET', '/api/projects', undefined, 'chatgpt')).status, 403)
  assert.equal((await call(url, 'GET', '/api/projects', undefined, 'not-a-real-token')).status, 401)

  roles.assignRole(db, { identity: 'chatgpt', role: 'client', by: 'test' })
  assert.equal((await call(url, 'GET', '/api/projects', undefined, 'chatgpt')).status, 200)
  assert.equal((await call(url, 'POST', '/api/projects', { name: 'nope', actor: 'x' }, 'chatgpt')).status, 403)

  roles.assignRole(db, { identity: 'chatgpt', role: 'worker', by: 'test' })
  const made = await call(url, 'POST', '/api/projects', { name: 'byworker', actor: 'someone-else' }, 'chatgpt')
  assert.equal(made.status, 200)
  assert.equal(made.body.created_by, 'chatgpt')
  const p = store.listProjects().find((x) => x.name === 'byworker')
  assert.equal(p.created_by, 'chatgpt')
  const ev = store.events({}).find((e) => e.entity === 'project' && e.entity_id === p.id && e.action === 'created')
  assert.equal(ev.actor, 'chatgpt')
  assert.equal(store.listProjects().some((x) => x.name === 'nope'), false)
})

test('pm HTTP with bridge: token project scope still applies', async () => {
  const { url, db } = await pmNode()
  roles.assignRole(db, { identity: 'p1only', role: 'worker', by: 'test' })
  // p1only has send,read but only project p1: a body naming p2 is refused by scope
  const r = await call(url, 'POST', '/api/tasks', { project: 'p2', title: 't', actor: 'x' }, 'p1only')
  assert.equal(r.status, 403)
})

test('pm HTTP without bridge keeps the old behaviour', async () => {
  const { url } = await pmNode({ withBridge: false })
  assert.equal((await call(url, 'GET', '/api/projects')).status, 200)
  // a bearer header from loopback is ignored (no role checks without the bridge)
  assert.equal((await call(url, 'GET', '/api/projects', undefined, 'chatgpt')).status, 200)
  const made = await call(url, 'POST', '/api/projects', { name: 'legacy', actor: 'Claude Opus 5.5' })
  assert.equal(made.status, 200)
  assert.equal(made.body.created_by, 'Claude Opus 5.5')
  // remote callers are the only ones that need PM_TOKEN; a proxied request counts as remote
  const res = await fetch(url + '/api/projects', { headers: { 'x-forwarded-for': '203.0.113.9' } })
  assert.equal(res.status, 401)
  const res2 = await fetch(url + '/api/projects', { headers: { 'x-forwarded-for': '203.0.113.9', authorization: `Bearer ${PEER}` } })
  assert.equal(res2.status, 200)
})

test('pm scope over bridge MCP: lead token gets record-keeping + brain write tools, attributed; others do not', async () => {
  const { url, bridge } = await pmNode()
  bridge.setPmUrl(url)
  const mcp = async (token, method, params) => (await call(url, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params }, token)).body.result
  const tool = async (token, name, args) => mcp(token, 'tools/call', { name, arguments: args })

  const leadTools = (await mcp('lead', 'tools/list')).tools.map((t) => t.name)
  for (const t of ['pm_create_project', 'pm_create_task', 'pm_update_task', 'pm_comment', 'pm_brain_write', 'bridge_send']) assert.ok(leadTools.includes(t), t)
  for (const t of ['pm_start_run', 'pm_prepare_run', 'pm_amend_run', 'pm_stop_task', 'pm_claim_task']) assert.ok(!leadTools.includes(t), `${t} must not be exposed`)
  const plainTools = (await mcp('chatgpt', 'tools/list')).tools.map((t) => t.name)
  assert.ok(!plainTools.some((t) => t.startsWith('pm_')), 'no pm tools without the pm scope')
  const refused = await tool('chatgpt', 'pm_create_project', { name: 'x' })
  assert.equal(refused.isError, true)

  const proj = (await tool('lead', 'pm_create_project', { name: 'wyze-frigate-nvr', actor: 'GPT-6' })).structuredContent.result
  assert.match(proj.id, /^P-/)
  const task = (await tool('lead', 'pm_create_task', { project: proj.id, title: 'Register NVR handoff', actor: 'GPT-6' })).structuredContent.result
  assert.equal(task.title, 'Register NVR handoff')
  const upd = await tool('lead', 'pm_update_task', { id: task.id, rev: task.rev, status: 'in_progress' })
  assert.equal(upd.isError, undefined)
  await tool('lead', 'pm_comment', { id: task.id, body: 'from the connector' })
  const full = (await tool('lead', 'pm_get_task', { id: task.id })).structuredContent.result
  assert.equal(full.status, 'in_progress')
  assert.ok(full.history.some((e) => e.actor === 'GPT-6 via lead'), 'actor attributed to model via token')
  assert.ok(full.comments.some((c) => c.actor === 'lead'))

  const stale = await tool('lead', 'pm_update_task', { id: task.id, rev: task.rev, title: 'stale' })
  assert.equal(stale.isError, true, 'stale rev surfaces as a tool error')

  const wrote = await tool('lead', 'pm_brain_write', { path: 'reports/nvr/plan.md', content: '# NVR\n' })
  assert.equal(wrote.isError, undefined, JSON.stringify(wrote))
  const outside = await tool('lead', 'pm_brain_write', { path: 'rules/CLAUDE.md', content: 'x' })
  assert.equal(outside.isError, true, 'brain write roots still enforced')
})

// --- PM-SYNC: /api/sync/* authorization (access.mjs authorizeSync) ---
test('pm sync routes: replicate scope may pull; sync now needs admin; replicate grants nothing else', async () => {
  const { migrateSync } = await import('./sync-schema.mjs')
  const { url, store, db } = await pmNode()
  migrateSync(store.db)
  for (const path of ['/api/sync/changes?after=0', '/api/sync/status']) {
    for (const who of [undefined, 'peer', 'replicator', 'replrw']) {
      assert.equal((await call(url, 'GET', path, undefined, who)).status, 200, `${who ?? 'loopback'} GET ${path}`)
    }
    // a token without 'replicate' is refused even with a role
    roles.assignRole(db, { identity: 'chatgpt', role: 'admin', by: 'test' })
    assert.equal((await call(url, 'GET', path, undefined, 'chatgpt')).status, 403, `chatgpt GET ${path}`)
  }
  // POST /api/sync/now: loopback or admin scope only
  assert.equal((await call(url, 'POST', '/api/sync/now', {})).status, 200)
  assert.equal((await call(url, 'POST', '/api/sync/now', {}, 'adminscoped')).status, 200)
  for (const who of ['peer', 'replicator', 'replrw', 'chatgpt']) {
    assert.equal((await call(url, 'POST', '/api/sync/now', {}, who)).status, 403, `${who} POST sync/now`)
  }
  // 'replicate' adds nothing on other pm routes: still scope- and role-checked
  assert.equal((await call(url, 'GET', '/api/projects', undefined, 'replicator')).status, 403)
  assert.equal((await call(url, 'POST', '/api/projects', { name: 'r1', actor: 'x' }, 'replicator')).status, 403)
  assert.equal((await call(url, 'GET', '/api/projects', undefined, 'replrw')).status, 403)
  assert.equal((await call(url, 'POST', '/api/projects', { name: 'r2', actor: 'x' }, 'replrw')).status, 403)
  assert.equal((await call(url, 'POST', '/api/tasks', { project: 'p1', title: 't', actor: 'x' }, 'replrw')).status, 403)
  assert.equal(store.listProjects().some((p) => p.name === 'r1' || p.name === 'r2'), false)
})
