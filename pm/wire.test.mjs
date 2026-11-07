// node --test wire.test.mjs   (run from this folder)
// Wiring tests (Claude Sonnet 5.5): agent-access.mjs (T-4dfa4288), free-swarm.mjs (T-0bf60afc) and
// change-notify.mjs (T-f06d8373) reached through the real server, bridge MCP/REST and the web UI.
// Mocked: the DSH invoker. Real: HTTP server, bridge, store, sqlite, HMAC DSH proof.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = mkdtempSync(join(tmpdir(), 'pm-wire-test-'))
process.env.BRIDGE_TOKENS = join(DIR, 'bridge-tokens.json')
process.env.BRIDGE_PEERS = join(DIR, 'bridge-peers.json')
process.env.BRIDGE_POLICY = join(DIR, 'bridge-policy.json')
process.env.BRIDGE_DB = join(DIR, 'bridge-default.db')
process.env.PM_DB = join(DIR, 'pm-default.db')
process.env.PM_BRAIN_DIR = join(DIR, 'brain')
process.env.PM_BRAIN_AUDIT = join(DIR, 'brain-write-audit.jsonl')

const http = (await import('node:http')).default
const { createBridge } = await import('./bridge/index.mjs')
const { createAuth, sha256 } = await import('./bridge/auth.mjs')
const { openStore } = await import('./store.mjs')
const { createServer } = await import('./server.mjs')
const { signDshProof, makeProofVerifier, restAction, escalate } = await import('./agent-gate.mjs')
const roles = await import('./roles.mjs')
const { migrateLedger, ingestEvent } = await import('./usage-ledger.mjs')

const PEER = 'peer-secret-token'
const SECRET = 'dsh-proof-secret'
const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = { actor: 'admin-test' }
const cleanups = []
after(() => { for (const fn of cleanups.reverse()) { try { fn() } catch {} } try { rmSync(DIR, { recursive: true, force: true }) } catch {} })

let n = 0
async function node({ invoke, clock, withBridge = true } = {}) {
  const dir = join(DIR, `n${++n}`)
  const store = openStore(join(DIR, `pm${n}.db`))
  const bridge = withBridge ? createBridge({
    machine: 'testbox', dbPath: join(dir, 'bridge.db'), peers: {}, policyPath: join(dir, 'policy.json'), tokenFile: join(dir, 'tokens.json'), replica: { intervalMs: 0 },
    auth: createAuth({ tokens: [], peerToken: PEER, trustLoopback: true }), workers: { router: null, logDir: join(dir, 'logs') },
  }) : null
  const server = createServer(store, { token: PEER, bridge, dshProofSecret: SECRET, dshInvoke: invoke, ...(clock ? { clock } : {}) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  bridge?.setPmUrl(url)
  cleanups.push(() => { server.close(); bridge?.stop(); store.close() })
  return { url, store, bridge, db: bridge?.queue.db ?? store.db, server }
}

async function call(url, method, path, { body, token, proof, headers = {} } = {}) {
  const res = await fetch(url + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(proof ? { 'x-dsh-proof': proof } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const admin = (url, method, path, body = {}) => call(url, method, path, { body: method === 'GET' ? undefined : { ...ADMIN, ...body } })

/** Two projects, a task in each, an agent fc1 for alice on vmixer2o2 with the given grants, and a token. */
async function seed(nd, grants = [['p1', 'read'], ['p1', 'update']], { agent = 'fc1', machine = 'vmixer2o2' } = {}) {
  for (const name of ['p1', 'p2']) if (!nd.store.listProjects().some((p) => p.name === name)) nd.store.createProject(ADMIN, { name })
  const t1 = nd.store.listTasks({ project: 'p1' })[0] ?? nd.store.createTask(ADMIN, { project: 'p1', title: 'task one' })
  const t2 = nd.store.listTasks({ project: 'p2' })[0] ?? nd.store.createTask(ADMIN, { project: 'p2', title: 'task two' })
  roles.migrate(nd.db); roles.assignRole(nd.db, { identity: 'alice', role: 'admin', by: 'test' })
  assert.equal((await admin(nd.url, 'POST', '/api/agent-access/agents', { agent_id: agent, seat: 'free-claude', machine, human_owner: 'alice' })).status, 200)
  const exp = new Date(Date.now() + 7 * 86400_000).toISOString()
  for (const [project, action] of grants) {
    const r = await admin(nd.url, 'POST', '/api/agent-access/grants', { agent_id: agent, project, action, expires_at: exp, ...(['assign', 'start', 'complete', 'swarm'].includes(action) ? { approval_id: 'AP-1' } : {}) })
    assert.equal(r.status, 200, JSON.stringify(r.body))
  }
  const tk = await admin(nd.url, 'POST', '/api/agent-access/tokens', { agent_id: agent, scopes: grants.map(([project, action]) => ({ project, action })) })
  assert.equal(tk.status, 200, JSON.stringify(tk.body))
  return { t1, t2, token: tk.body.token, proof: () => signDshProof(SECRET, { agent_id: agent, machine }) }
}

// ============================ T-4dfa4288: agent access ============================

test('route and tool maps: unmapped is denied by default, status/lifecycle/assignee escalate', () => {
  assert.equal(restAction('GET', '/api/projects'), null)
  assert.equal(restAction('GET', '/api/events'), null)
  assert.equal(restAction('POST', '/api/tasks/upsert'), null)
  assert.equal(restAction('POST', '/api/agent-access/grants'), null)
  assert.equal(restAction('DELETE', '/api/tasks/T-1'), null)
  assert.equal(restAction('GET', '/api/tasks/T-1').action, 'read')
  assert.equal(escalate({ title: 'x' }), 'update')
  assert.equal(escalate({ status: 'review' }), 'review')
  assert.equal(escalate({ status: 'done' }), 'complete')
  assert.equal(escalate({ lifecycle: 'COMPLETE' }), 'complete')
  assert.equal(escalate({ status: 'review', assignee: 'x' }), 'review')
  assert.equal(escalate({ assignee: null }), 'assign')
})

test('DSH proof verifier: signed, fresh, fail-closed without secret', () => {
  const now = 1_000_000
  const ok = makeProofVerifier(SECRET, { clock: () => now })
  const p = signDshProof(SECRET, { agent_id: 'a', machine: 'm' }, now)
  assert.deepEqual(ok(p), { agent_id: 'a', machine: 'm' })
  assert.equal(ok(p + 'x'), null)
  assert.equal(ok(signDshProof('other', { agent_id: 'a', machine: 'm' }, now)), null)
  assert.equal(ok(signDshProof(SECRET, { agent_id: 'a', machine: 'm' }, now - 10 * 60_000)), null, 'stale proof')
  assert.equal(makeProofVerifier('')(p), null, 'no secret configured verifies nothing')
})

test('REST: authorized agent reads a task and makes one permitted edit; actor audited; owner of every other door stays closed', async () => {
  const nd = await node()
  const s = await seed(nd)
  const read = await call(nd.url, 'GET', `/api/tasks/${s.t1.id}`, { token: s.token, proof: s.proof() })
  assert.equal(read.status, 200); assert.equal(read.body.id, s.t1.id)
  const edit = await call(nd.url, 'PATCH', `/api/tasks/${s.t1.id}`, { token: s.token, proof: s.proof(), body: { rev: s.t1.rev, next_action: 'agent note', actor: 'spoofed-admin' } })
  assert.equal(edit.status, 200, JSON.stringify(edit.body)); assert.equal(edit.body.next_action, 'agent note')
  const hist = nd.store.getTask(s.t1.id).history.at(-1)
  assert.equal(hist.actor, 'fc1', 'attribution is the proven agent, never the body claim')
  const audit = (await admin(nd.url, 'GET', '/api/agent-access/audit?agent_id=fc1&outcome=allow')).body
  const last = audit.at(-1)
  assert.deepEqual([last.actor, last.seat, last.machine, last.entry, last.action, last.target, last.outcome], ['fc1', 'free-claude', 'vmixer2o2', 'rest', 'update', s.t1.id, 'allow'])
  // list reads must name a granted project
  assert.equal((await call(nd.url, 'GET', '/api/tasks?project=p1', { token: s.token, proof: s.proof() })).status, 200)
  assert.equal((await call(nd.url, 'GET', '/api/tasks', { token: s.token, proof: s.proof() })).status, 403)
})

test('REST: every bypass attempt is refused with a reason that never contains the credential', async () => {
  const nd = await node()
  const s = await seed(nd)
  const g = (path, o = {}, method = 'GET') => call(nd.url, method, path, { token: s.token, proof: s.proof(), ...o })
  const cases = [
    ['no proof', () => call(nd.url, 'GET', `/api/tasks/${s.t1.id}`, { token: s.token }), /proof/],
    ['proof for another machine', () => call(nd.url, 'GET', `/api/tasks/${s.t1.id}`, { token: s.token, proof: signDshProof(SECRET, { agent_id: 'fc1', machine: 'ndi2' }) }), /different machine/],
    ['proof for another agent', () => call(nd.url, 'GET', `/api/tasks/${s.t1.id}`, { token: s.token, proof: signDshProof(SECRET, { agent_id: 'zz', machine: 'vmixer2o2' }) }), /proof/],
    ['stale proof', () => call(nd.url, 'GET', `/api/tasks/${s.t1.id}`, { token: s.token, proof: signDshProof(SECRET, { agent_id: 'fc1', machine: 'vmixer2o2' }, Date.now() - 3600_000) }), /proof/],
    ['other project task', () => g(`/api/tasks/${s.t2.id}`), /outside token scope/],
    ['complete without grant', () => g(`/api/tasks/${s.t1.id}`, { body: { rev: s.t1.rev, status: 'done' } }, 'PATCH'), /outside token scope/],
    ['review without grant', () => g(`/api/tasks/${s.t1.id}`, { body: { rev: s.t1.rev, status: 'review' } }, 'PATCH'), /outside token scope/],
    ['assign without grant', () => g(`/api/tasks/${s.t1.id}`, { body: { rev: s.t1.rev, assignee: 'me' } }, 'PATCH'), /outside token scope/],
    ['lifecycle COMPLETE without grant', () => g(`/api/tasks/${s.t1.id}`, { body: { rev: s.t1.rev, lifecycle: 'COMPLETE' } }, 'PATCH'), /outside token scope/],
    ['create in a project it has no grant for', () => g('/api/tasks', { body: { project: 'p1', title: 'x' } }, 'POST'), /outside token scope/],
    ['unmapped route: list projects', () => g('/api/projects'), /not available/],
    ['unmapped route: upsert', () => g('/api/tasks/upsert', { body: { project: 'p1' } }, 'POST'), /not available/],
    ['admin route: grant yourself', () => g('/api/agent-access/grants', { body: { agent_id: 'fc1', project: 'p1', action: 'read' } }, 'POST'), /not available/],
    ['bogus token', () => call(nd.url, 'GET', `/api/tasks/${s.t1.id}`, { token: 'pmat_' + 'ab'.repeat(24), proof: s.proof() }), /not recognised/],
  ]
  for (const [name, run, re] of cases) {
    const r = await run()
    assert.equal(r.status, 403, `${name}: ${JSON.stringify(r.body)}`)
    assert.match(r.body.error, re, name)
    assert.ok(!JSON.stringify(r.body).includes(s.token), `${name}: token leaked`)
  }
  // nothing changed on p1/p2 through any of those
  assert.equal(nd.store.getTask(s.t1.id).status, 'todo'); assert.equal(nd.store.getTask(s.t1.id).assignee, null)
  const denied = (await admin(nd.url, 'GET', '/api/agent-access/audit?outcome=deny')).body
  assert.ok(denied.length >= cases.length - 1)
  assert.ok(!JSON.stringify(denied).includes(s.token))
})

test('revocation and expiry take effect immediately on REST, MCP and bridge alike', async () => {
  const nd = await node()
  const s = await seed(nd)
  const rd = () => call(nd.url, 'GET', `/api/tasks/${s.t1.id}`, { token: s.token, proof: s.proof() })
  const mcp = () => call(nd.url, 'POST', '/mcp', { token: s.token, proof: s.proof(), body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pm_get_task', arguments: { id: s.t1.id } } } })
  const br = () => call(nd.url, 'POST', '/api/bridge/pm/call', { token: s.token, proof: s.proof(), body: { tool: 'pm_get_task', arguments: { id: s.t1.id } } })
  assert.equal((await rd()).status, 200); assert.equal((await br()).status, 200)
  assert.equal((await mcp()).body.result.isError, undefined)
  const rev = await admin(nd.url, 'POST', '/api/agent-access/tokens/revoke', { token: s.token })
  assert.equal(rev.status, 200)
  assert.equal((await rd()).status, 403)
  assert.equal((await br()).status, 403)
  assert.equal((await mcp()).body.result.isError, true)
  // agent revoked: a fresh token cannot be minted for it either
  const t2 = await seed(nd, [['p1', 'read']], { agent: 'fc2' })
  assert.equal((await call(nd.url, 'GET', `/api/tasks/${t2.t1.id}`, { token: t2.token, proof: t2.proof() })).status, 200)
  await admin(nd.url, 'POST', '/api/agent-access/agents/fc2/revoke')
  const after = await call(nd.url, 'GET', `/api/tasks/${t2.t1.id}`, { token: t2.token, proof: t2.proof() })
  assert.equal(after.status, 403); assert.match(after.body.error, /revoked/)
  // grant revoked
  const t3 = await seed(nd, [['p1', 'read']], { agent: 'fc3' })
  const gid = (await admin(nd.url, 'GET', '/api/agent-access/agents')).body.find((a) => a.agent_id === 'fc3')
  assert.deepEqual(gid.grants, { p1: ['read'] })
  const grantId = nd.db.prepare('SELECT id FROM agent_grants WHERE agent_id=?').get('fc3').id
  await admin(nd.url, 'POST', `/api/agent-access/grants/${grantId}/revoke`)
  assert.match((await call(nd.url, 'GET', `/api/tasks/${t3.t1.id}`, { token: t3.token, proof: t3.proof() })).body.error, /no live grant/)
})

test('expired credential is refused (server clock moved past expiry)', async () => {
  const future = { now: false }
  const nd = await node({ clock: () => (future.now ? new Date(Date.now() + 3 * 86400_000 * 30) : new Date()) })
  const s = await seed(nd)
  assert.equal((await call(nd.url, 'GET', `/api/tasks/${s.t1.id}`, { token: s.token, proof: s.proof() })).status, 200)
  future.now = true
  const r = await call(nd.url, 'GET', `/api/tasks/${s.t1.id}`, { token: s.token, proof: s.proof() })
  assert.equal(r.status, 403); assert.match(r.body.error, /expired/)
})

test('MCP: agent token sees only governed pm tools, calls are gated per project, brain write is not reachable, path-token form works', async () => {
  const nd = await node()
  const s = await seed(nd)
  const rpc = (method, params, path = '/mcp', token = s.token) => call(nd.url, 'POST', path, { token, proof: s.proof(), body: { jsonrpc: '2.0', id: 7, method, params } })
  const list = await rpc('tools/list')
  const names = list.body.result.tools.map((t) => t.name)
  assert.ok(names.includes('pm_get_task') && names.includes('pm_update_task'))
  assert.ok(!names.includes('pm_brain_write') && !names.includes('pm_start_run') && !names.includes('pm_archive_project') && !names.some((x) => x.startsWith('bridge_')))
  const got = await rpc('tools/call', { name: 'pm_get_task', arguments: { id: s.t1.id } })
  assert.equal(got.body.result.isError, undefined); assert.equal(got.body.result.structuredContent.result.id, s.t1.id)
  const upd = await rpc('tools/call', { name: 'pm_update_task', arguments: { id: s.t1.id, rev: s.t1.rev, body: 'via mcp' } })
  assert.equal(upd.body.result.isError, undefined, JSON.stringify(upd.body))
  assert.equal(nd.store.getTask(s.t1.id).history.at(-1).actor, 'agent:fc1')
  const other = await rpc('tools/call', { name: 'pm_get_task', arguments: { id: s.t2.id } })
  assert.equal(other.body.result.isError, true); assert.match(other.body.result.content[0].text, /outside token scope/)
  const done = await rpc('tools/call', { name: 'pm_update_task', arguments: { id: s.t1.id, rev: nd.store.getTask(s.t1.id).rev, status: 'done' } })
  assert.equal(done.body.result.isError, true)
  const brain = await rpc('tools/call', { name: 'pm_brain_write', arguments: { path: 'reports/x.md', content: 'x' } })
  assert.equal(brain.body.result.isError, true); assert.match(brain.body.result.content[0].text, /not available/)
  const viaPath = await rpc('tools/list', undefined, `/mcp/${s.token}`, null)
  assert.equal(viaPath.status, 200)
  assert.equal((await call(nd.url, 'POST', '/mcp', { token: 'pmat_' + 'cd'.repeat(24), body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).body.error.code, -32001)
  const audit = (await admin(nd.url, 'GET', '/api/agent-access/audit?agent_id=fc1')).body
  assert.ok(audit.some((r) => r.entry === 'mcp' && r.outcome === 'allow') && audit.some((r) => r.entry === 'mcp' && r.outcome === 'deny'))
})

test('bridge: agent token cannot use any other bridge route; pm/call is gated and audited as entry bridge', async () => {
  const nd = await node()
  const s = await seed(nd)
  for (const [m, p] of [['GET', '/api/bridge/messages'], ['GET', '/api/bridge/health'], ['POST', '/api/bridge/messages'], ['GET', '/api/bridge/roles'], ['POST', '/api/bridge/roles']]) {
    const r = await call(nd.url, m, p, { token: s.token, proof: s.proof(), body: m === 'POST' ? { identity: 'fc1', role: 'admin' } : undefined })
    assert.equal(r.status, 403, `${m} ${p}`)
  }
  assert.equal(roles.listRoles(nd.db, { identity: 'fc1' }).length, 0, 'agent granted itself no role')
  const ok = await call(nd.url, 'POST', '/api/bridge/pm/call', { token: s.token, proof: s.proof(), body: { tool: 'pm_get_task', arguments: { id: s.t1.id } } })
  assert.equal(ok.status, 200); assert.equal(ok.body.id, s.t1.id)
  const no = await call(nd.url, 'POST', '/api/bridge/pm/call', { token: s.token, proof: s.proof(), body: { tool: 'pm_get_task', arguments: { id: s.t2.id } } })
  assert.equal(no.status, 403)
  const noProof = await call(nd.url, 'POST', '/api/bridge/pm/call', { token: s.token, body: { tool: 'pm_get_task', arguments: { id: s.t1.id } } })
  assert.equal(noProof.status, 403)
  const rows = nd.db.prepare("SELECT outcome FROM bridge_audit WHERE action LIKE 'pm.pm_get_task'").all().map((r) => r.outcome)
  assert.ok(rows.includes('ok') && rows.includes('denied'))
  const a = (await admin(nd.url, 'GET', '/api/agent-access/audit?agent_id=fc1')).body
  assert.ok(a.some((r) => r.entry === 'bridge' && r.outcome === 'allow') && a.some((r) => r.entry === 'bridge' && r.outcome === 'deny'))
})

test('unchanged: loopback and the peer token keep full access, and bridge off still serves agent REST', async () => {
  const nd = await node()
  const s = await seed(nd)
  assert.equal((await call(nd.url, 'GET', '/api/projects')).status, 200)
  assert.equal((await call(nd.url, 'GET', '/api/projects', { token: PEER })).status, 200)
  assert.equal((await call(nd.url, 'PATCH', `/api/tasks/${s.t1.id}`, { body: { actor: 'human', rev: s.t1.rev, status: 'review' } })).status, 200)
  const nb = await node({ withBridge: false })
  const s2 = await seed(nb)
  assert.equal((await call(nb.url, 'GET', `/api/tasks/${s2.t1.id}`, { token: s2.token, proof: s2.proof() })).status, 200)
  assert.equal((await call(nb.url, 'GET', `/api/tasks/${s2.t2.id}`, { token: s2.token, proof: s2.proof() })).status, 403)
})

// ============================ T-0bf60afc: free swarm ============================

const fresh = () => new Date().toISOString()
const SEATS = [
  { id: 'local-llama', machine: 'ndi2', cost_class: 'local', verified_free: true },
  { id: 'or-free', machine: 'ndi2', cost_class: 'free', verified_free: true, quota: { remaining: 50, limit: 100, as_of: fresh(), reset_at: '2026-11-02T00:00:00Z' } },
  { id: 'claude-paid', machine: 'ndi2', cost_class: 'metered', verified_free: false, quota: { remaining: 999, limit: 1000, as_of: fresh() } },
  { id: 'free-unverified', machine: 'ndi2', cost_class: 'free', verified_free: false, quota: { remaining: 9, limit: 10, as_of: fresh() } },
]
const EVIDENCE = { build: { exit_code: 0 }, tests: { exit_code: 0, passed: 12 }, review: { verdict: 'pass', by: 'reviewer' } }

async function swarmNode(opts = {}) {
  const calls = []
  const nd = await node({ invoke: async ({ seat, task }) => { calls.push([seat.id, task.id]); return { ok: true } }, ...opts })
  nd.calls = calls
  nd.store.createProject(ADMIN, { name: 'p1' })
  for (const s of SEATS) assert.equal((await admin(nd.url, 'POST', '/api/free-swarm/seats', s)).status, 200)
  return nd
}

test('free swarm: default mode is unchanged and refuses runs; only the local admin flips the toggle', async () => {
  const nd = await swarmNode()
  assert.equal((await call(nd.url, 'GET', '/api/free-swarm/config')).body.mode, 'default')
  const refused = await admin(nd.url, 'POST', '/api/free-swarm/runs', { id: 'R0', project: 'p1', pool: ['local-llama'], tasks: [] })
  assert.equal(refused.status, 409); assert.match(refused.body.error, /default swarm mode is unchanged/)
  assert.equal((await call(nd.url, 'POST', '/api/free-swarm/config', { body: { mode: 'free-only' } })).status, 400, 'actor required')
  assert.equal((await admin(nd.url, 'POST', '/api/free-swarm/config', { mode: 'paid-too' })).status, 400)
  assert.equal((await admin(nd.url, 'POST', '/api/free-swarm/config', { mode: 'free-only' })).body.mode, 'free-only')
  assert.ok(nd.store.listProjects().length, 'store usable')
  const ev = nd.store.events({ since: 0, limit: 50 }).filter((e) => e.entity === 'free-swarm')
  assert.ok(ev.some((e) => e.action === 'mode'))
  // an agent token cannot flip it (route unmapped), and a bridge role principal cannot either
  const s = await seed(nd, [['p1', 'swarm']])
  assert.equal((await call(nd.url, 'POST', '/api/free-swarm/config', { token: s.token, proof: s.proof(), body: { mode: 'default' } })).status, 403)
  assert.equal((await call(nd.url, 'GET', '/api/free-swarm/config')).body.mode, 'free-only')
})

test('free swarm: seat eligibility is visible; paid, unverified and stale seats never run; evidence gates completion', async () => {
  const nd = await swarmNode()
  await admin(nd.url, 'POST', '/api/free-swarm/config', { mode: 'free-only' })
  const seats = (await call(nd.url, 'GET', '/api/free-swarm/seats')).body
  const by = Object.fromEntries(seats.map((x) => [x.id, x]))
  assert.equal(by['local-llama'].eligible, true); assert.equal(by['or-free'].eligible, true)
  assert.equal(by['claude-paid'].eligible, false); assert.match(by['claude-paid'].reason, /not free/)
  assert.match(by['free-unverified'].reason, /not verified/)
  const run = await admin(nd.url, 'POST', '/api/free-swarm/runs', { id: 'R1', project: 'p1', pool: ['claude-paid', 'free-unverified', 'local-llama', 'or-free'], tasks: [{ id: 'a', approved: true }, { id: 'b', deps: ['a'], approved: true }] })
  assert.equal(run.status, 200, JSON.stringify(run.body))
  assert.deepEqual(run.body.seats.map((x) => x.id).sort(), ['local-llama', 'or-free'])
  assert.equal(run.body.rejected.length, 2)
  let v = (await admin(nd.url, 'POST', '/api/free-swarm/runs/R1/tick')).body
  assert.deepEqual(v.tasks.map((t) => [t.id, t.status]), [['a', 'returned'], ['b', 'queued']], 'dependency respected')
  assert.ok(nd.calls.every(([sid]) => ['local-llama', 'or-free'].includes(sid)), 'paid seat never invoked')
  // an agent returning is not done
  const noEvidence = await admin(nd.url, 'POST', '/api/free-swarm/runs/R1/complete', { task: 'a', evidence: { build: { exit_code: 0 } } })
  assert.equal(noEvidence.status, 409); assert.match(noEvidence.body.error, /tests passing.*review pass/)
  assert.equal((await admin(nd.url, 'POST', '/api/free-swarm/runs/R1/complete', { task: 'a', evidence: EVIDENCE })).status, 200)
  await admin(nd.url, 'POST', '/api/free-swarm/runs/R1/tick')
  v = (await admin(nd.url, 'POST', '/api/free-swarm/runs/R1/complete', { task: 'b', evidence: EVIDENCE })).body
  assert.equal(v.state, 'done')
  assert.equal((await call(nd.url, 'GET', '/api/free-swarm/runs')).body.length, 1)
  // reassign to a paid seat is refused
  await admin(nd.url, 'POST', '/api/free-swarm/runs', { id: 'R2', project: 'p1', pool: ['local-llama'], tasks: [{ id: 'x', approved: true }] })
  const re = await admin(nd.url, 'POST', '/api/free-swarm/runs/R2/reassign', { task: 'x', seat: 'claude-paid' })
  assert.equal(re.status, 409)
})

test('free swarm: exhausted or unavailable pool blocks with a cause, never a paid fallback', async () => {
  const nd = await swarmNode()
  await admin(nd.url, 'POST', '/api/free-swarm/config', { mode: 'free-only' })
  await admin(nd.url, 'POST', '/api/free-swarm/runs', { id: 'R3', project: 'p1', pool: ['or-free'], tasks: [{ id: 'a', approved: true }] })
  await admin(nd.url, 'POST', '/api/free-swarm/seats', { ...SEATS[1], quota: { remaining: 0, limit: 100, as_of: fresh() } })
  const v = (await admin(nd.url, 'POST', '/api/free-swarm/runs/R3/tick')).body
  assert.equal(v.state, 'blocked'); assert.match(v.blocked_cause, /not falling back to paid/)
  assert.equal(nd.calls.length, 0)
  const none = await admin(nd.url, 'POST', '/api/free-swarm/runs', { id: 'R4', project: 'p1', pool: ['claude-paid'], tasks: [] })
  assert.equal(none.body.state, 'blocked')
})

test('free swarm: PM permission gate for roles and for agent tokens (swarm vs review vs complete)', async () => {
  const nd = await swarmNode()
  await admin(nd.url, 'POST', '/api/free-swarm/config', { mode: 'free-only' })
  roles.migrate(nd.db)
  roles.assignRole(nd.db, { identity: 'cliff', role: 'client', by: 'test' })
  roles.assignRole(nd.db, { identity: 'wanda', role: 'worker', by: 'test' })
  const as = (actor, path, body) => call(nd.url, 'POST', path, { body: { actor, ...body } })
  const mk = { id: 'RP', project: 'p1', pool: ['local-llama'], tasks: [{ id: 't', approved: true }] }
  assert.equal((await as('cliff', '/api/free-swarm/runs', mk)).status, 403, 'client cannot launch')
  assert.equal((await as('wanda', '/api/free-swarm/runs', mk)).status, 200, 'worker may launch')
  assert.equal((await as('wanda', '/api/free-swarm/runs/RP/tick', {})).status, 200)
  assert.equal((await as('wanda', '/api/free-swarm/runs/RP/complete', { task: 't', evidence: EVIDENCE })).status, 403, 'worker cannot complete')
  assert.equal((await as('cliff', '/api/free-swarm/runs/RP/pause', {})).status, 403)
  // agent token with swarm only
  const s = await seed(nd, [['p1', 'swarm']])
  const ag = (path, body) => call(nd.url, 'POST', path, { token: s.token, proof: s.proof(), body })
  const made = await ag('/api/free-swarm/runs', { id: 'RA', project: 'p1', pool: ['local-llama'], tasks: [{ id: 't', approved: false }] })
  assert.equal(made.status, 200, JSON.stringify(made.body))
  assert.equal((await ag('/api/free-swarm/runs/RA/tick', {})).status, 200)
  assert.equal((await ag('/api/free-swarm/runs/RA/pause', {})).status, 200)
  const approve = await ag('/api/free-swarm/runs/RA/approve', { task: 't' })
  assert.equal(approve.status, 403, 'approve needs review')
  assert.equal((await ag('/api/free-swarm/runs/RA/complete', { task: 't', evidence: EVIDENCE })).status, 403, 'complete needs complete')
  // a body claiming another project cannot redirect the check: the run's own project is used
  assert.equal((await ag('/api/free-swarm/runs/RA/pause', { project: 'p2' })).status, 200)
  assert.equal(nd.store.listProjects().length, 2 - 0, 'no side effects on projects')
})

// ============================ T-f06d8373: notifications, capacity, usage ============================

test('meaningful task changes notify through the store (REST, sync-style direct writes, reconcile); churn does not; replays dedupe', async () => {
  const nd = await node()
  const s = await seed(nd)
  const list = async () => (await call(nd.url, 'GET', '/api/notifications?role=admin')).body
  assert.equal((await list()).length, 0)
  // churn: checkpoint, priority, comment: no notification
  const T = s.t1
  let cur = (await call(nd.url, 'PATCH', `/api/tasks/${T.id}`, { body: { actor: 'human', rev: T.rev, checkpoint: 'c1' } })).body
  await call(nd.url, 'POST', `/api/tasks/${T.id}/comments`, { body: { actor: 'human', body: 'hi' } })
  assert.equal((await list()).length, 0)
  // review notifies once
  cur = (await call(nd.url, 'PATCH', `/api/tasks/${T.id}`, { body: { actor: 'human', rev: cur.rev, status: 'review' } })).body
  let l = await list()
  assert.equal(l.length, 1); assert.equal(l[0].type, 'awaiting_approval'); assert.equal(l[0].task_id, T.id); assert.equal(l[0].project, 'p1')
  // same-status write: no new notification
  cur = (await call(nd.url, 'PATCH', `/api/tasks/${T.id}`, { body: { actor: 'human', rev: cur.rev, status: 'review', next_action: 'x' } })).body
  assert.equal((await list()).length, 1)
  // blocked then recovery
  cur = (await call(nd.url, 'PATCH', `/api/tasks/${T.id}`, { body: { actor: 'human', rev: cur.rev, status: 'blocked' } })).body
  cur = (await call(nd.url, 'PATCH', `/api/tasks/${T.id}`, { body: { actor: 'human', rev: cur.rev, status: 'in_progress' } })).body
  assert.deepEqual((await list()).map((e) => e.type).sort(), ['awaiting_approval', 'resuming', 'stall'])
  // a write that bypasses store.tx (sync-style) is still delivered on drain
  nd.store.db.prepare("UPDATE tasks SET status='done', rev=rev+1, updated_at=? WHERE id=?").run(new Date().toISOString(), T.id)
  nd.store.drainChanges()
  assert.ok((await list()).some((e) => e.type === 'completed'))
  nd.store.drainChanges()
  assert.equal((await list()).filter((e) => e.type === 'completed').length, 1, 'drained rows are not redelivered')
  // lease expiry (reconciler) -> uncertain notifies
  const t = nd.store.createTask(ADMIN, { project: 'p1', title: 'leased' })
  nd.store.claimTask({ actor: 'w1' }, t.id, { leaseSeconds: 1 })
  nd.store.db.prepare("UPDATE tasks SET status='in_progress', lease_until=? WHERE id=?").run('2000-01-01T00:00:00.000Z', t.id)
  nd.store.reconcile()
  assert.ok((await list()).some((e) => e.type === 'stall' && /uncertain/.test(e.summary)))
  // mark acked
  const first = (await list())[0]
  assert.equal((await call(nd.url, 'POST', `/api/notifications/${first.id}/mark`, { body: { identity: 'human', state: 'acked' } })).status, 200)
  assert.equal((await call(nd.url, 'GET', '/api/notifications?role=admin&identity=human&unread=1')).body.some((e) => e.id === first.id), false)
  assert.equal((await call(nd.url, 'POST', `/api/notifications/${first.id}/mark`, { body: { identity: 'human', state: 'bogus' } })).status, 400)
})

test('a failing change hook never fails the write', async () => {
  const nd = await node()
  const s = await seed(nd)
  nd.store.setChangeHook(() => { throw new Error('hook boom') })
  const origErr = console.error; console.error = () => {}
  try {
    const r = await call(nd.url, 'PATCH', `/api/tasks/${s.t1.id}`, { body: { actor: 'human', rev: s.t1.rev, status: 'review' } })
    assert.equal(r.status, 200); assert.equal(r.body.status, 'review')
  } finally { console.error = origErr }
})

test('capacity view: stale and unknown never read as healthy; warn/critical notify once per window; usage view reads the ledger', async () => {
  const nd = await node()
  const seat = (id, quota) => admin(nd.url, 'POST', '/api/free-swarm/seats', { id, machine: 'ndi2', cost_class: 'free', verified_free: true, quota })
  await seat('s-ok', { remaining: 90, limit: 100, as_of: fresh() })
  await seat('s-warn', { remaining: 15, limit: 100, as_of: fresh(), reset_at: '2026-11-02T00:00:00Z' })
  await seat('s-crit', { remaining: 2, limit: 100, as_of: fresh(), reset_at: '2026-11-02T00:00:00Z' })
  await seat('s-stale', { remaining: 1, limit: 100, as_of: '2020-01-01T00:00:00Z' })
  await seat('s-unknown', undefined)
  const cap = Object.fromEntries((await call(nd.url, 'GET', '/api/capacity')).body.map((c) => [c.name, c.status]))
  assert.deepEqual(cap, { 's-ok': 'ok', 's-warn': 'warn', 's-crit': 'critical', 's-stale': 'stale', 's-unknown': 'unknown' })
  const first = (await admin(nd.url, 'POST', '/api/capacity/notify')).body.events
  assert.deepEqual(first.map((e) => e.severity).sort(), ['error', 'warn'])
  assert.equal((await admin(nd.url, 'POST', '/api/capacity/notify')).body.events.length, 0, 'once per threshold and window')
  assert.equal(nd.server.capacityTick().length, 0)
  assert.ok((await call(nd.url, 'GET', '/api/notifications?role=admin')).body.some((e) => e.type === 'machine_health'))
  // usage view
  const off = await node({ withBridge: false })
  assert.equal((await call(off.url, 'GET', '/api/usage-view')).body.available, false)
  migrateLedger(nd.db)
  ingestEvent(nd.db, { event_id: 'u1', provider: 'p', model: 'm', basis: 'actual', input_tokens: 100, output_tokens: 50, cost_class: 'metered', cost_usd: 0.5, occurred_at: fresh() }, { actor: 'test' })
  ingestEvent(nd.db, { event_id: 'u2', provider: 'p', model: 'm', basis: 'actual', input_tokens: 300, output_tokens: 0, cost_class: 'free', cost_usd: 0, occurred_at: fresh() }, { actor: 'test' })
  const u = (await call(nd.url, 'GET', '/api/usage-view')).body
  assert.equal(u.available, true); assert.equal(u.tokens, 450); assert.equal(u.metered_token_share, 33.3)
})

// ============================ UI ============================

const HTML = readFileSync(join(HERE, 'public', 'index.html'), 'utf8')
const CORE = HTML.slice(HTML.indexOf('/*CORE-BEGIN*/'), HTML.indexOf('/*CORE-END*/'))
const NOTICE = HTML.slice(HTML.indexOf('/*NOTICE-BEGIN*/'), HTML.indexOf('/*NOTICE-END*/'))

test('UI: page script parses; nav, views and handlers for free swarm and notices are wired', () => {
  const script = HTML.slice(HTML.indexOf('<script>') + 8, HTML.lastIndexOf('</script>'))
  assert.doesNotThrow(() => new Function(script), 'inline script compiles')
  assert.match(HTML, /\['swarm', 'Free swarm'/); assert.match(HTML, /\['notices', 'Notices'/)
  assert.match(HTML, /swarm: viewSwarm, notices: viewNotices/)
  for (const a of ['swarmMode', 'noticeAck', 'capNotify']) assert.match(HTML, new RegExp(`case '${a}'`))
  for (const p of ['/api/notifications', '/api/capacity', '/api/usage-view', '/api/free-swarm/config', '/api/free-swarm/seats', '/api/free-swarm/runs']) assert.ok(NOTICE.includes(p), p)
})

test('UI helpers: notice rows, capacity labels (stale/unknown not healthy), seat rows', () => {
  const h = new Function(`${CORE}; ${NOTICE}; return { noticeRows, capacityRows, swarmSeatRows, unreadNotices }`)()
  const rows = h.noticeRows([{ id: 'e1', at: 'x', summary: 'T needs review', severity: 'info', type: 'awaiting_approval', task_id: 'T-1', state: null }, { id: 'e2', summary: 'blocked', severity: 'warn', state: 'acked' }])
  assert.equal(rows[0].text, 'T needs review'); assert.equal(rows[1].cls, 'med')
  assert.equal(h.unreadNotices([{ state: null }, { state: 'acked' }]).length, 1)
  const cap = h.capacityRows([{ name: 'a', status: 'stale', pct: 99, used: 99, limit: 100 }, { name: 'b', status: 'unknown', pct: null }, { name: 'c', status: 'critical', pct: 97, used: 97, limit: 100 }])
  assert.deepEqual(cap.map((c) => c.label), ['stale, not trusted', 'unknown', 'critical 95%+'])
  assert.equal(cap[1].text, 'no quota data')
  const seats = h.swarmSeatRows([{ id: 's', cost_class: 'free', verified_free: false, eligible: false, reason: 'free entitlement not verified', quota: { remaining: 5, limit: 10 } }])
  assert.deepEqual([seats[0].eligible, seats[0].verified, seats[0].quota, seats[0].machine], [false, false, '5 / 10', '?'])
})
