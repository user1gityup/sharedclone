// node --test insights.test.mjs   (run from this folder)
// Goals, usage ledger and budgets over pm HTTP (T-805b65ed): wiring, role isolation, human-proof raises.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStore } from './store.mjs'
import { createServer } from './server.mjs'
import * as roles from './roles.mjs'
import * as approvals from './approvals.mjs'

const A = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const servers = []
after(() => { for (const s of servers) s.close() })

/** world: store, projects alpha/beta with a task each, an auth db with role assignments, and a fake bridge mapping x-principal to a principal. */
async function world({ authDb = true } = {}) {
  const store = openStore(':memory:')
  const p1 = store.createProject(A, { name: 'alpha' }); const p2 = store.createProject(A, { name: 'beta' })
  const t1 = store.createTask(A, { project: 'alpha', title: 'a1' }); const t2 = store.createTask(A, { project: 'beta', title: 'b1' })
  const adb = new DatabaseSync(':memory:'); approvals.migrate(adb); roles.migrate(adb)
  for (const [identity, role, project] of [['user1', 'admin', ''], ['mgr1', 'manager', p1.id], ['wk1', 'worker', ''], ['cl1', 'client', '']]) roles.assignRole(adb, { identity, role, project, by: 'admin' })
  const principals = { loopback: { name: 'loopback', scopes: ['read', 'send'], projects: ['*'] } }
  for (const n of ['mgr1', 'wk1', 'cl1', 'ghost']) principals[n] = { name: n, scopes: ['read', 'send'], projects: ['*'] }
  const bridge = { handle: async () => false, auth: (req) => principals[req.headers['x-principal'] || 'loopback'], queue: { db: adb } }
  const server = createServer(store, { bridge, insightsAuthDb: authDb ? adb : false }); servers.push(server)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body, who = 'loopback', actor) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-principal': who, 'x-pm-actor': actor ?? (who === 'loopback' ? 'user1' : who) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
    return { status: res.status, body: await res.json() }
  }
  return { store, p1, p2, t1, t2, adb, call }
}
const ev = (id, o = {}) => ({ event_id: id, provider: 'anthropic', model: 'opus', basis: 'actual', input_tokens: 100, output_tokens: 50, cost_class: 'metered', cost_usd: 0.5, occurred_at: '2026-10-31T10:00:00Z', ...o })

test('migration is additive and idempotent on an existing database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-ins-')); const path = join(dir, 'pm.db')
  try {
    const s1 = openStore(path); s1.createProject(A, { name: 'keep' }); const t = s1.createTask(A, { project: 'keep', title: 'old' }); s1.close()
    const s2 = openStore(path); const s3 = openStore(path)
    assert.equal(s2.getTask(t.id).title, 'old')
    for (const tbl of ['goals', 'goal_metrics', 'goal_evidence', 'usage_events', 'usage_allocations', 'budgets', 'budget_reservations', 'budget_events'])
      assert.ok(s3.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tbl), tbl)
    s2.close(); s3.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('goal flow over HTTP: only verified evidence counts, submitter cannot verify, KPI math direction-aware', async () => {
  const { call, p1 } = await world()
  const org = await call('POST', '/api/goals', { id: 'ORG', scope: 'organization', title: 'Org goal', status: 'active' })
  assert.equal(org.status, 200)
  const g = await call('POST', '/api/goals', { id: 'GA', scope: 'project', project_id: p1.id, parent_id: 'ORG', title: 'Cut spend' })
  assert.equal(g.status, 200)
  const m = await call('POST', '/api/goals/GA/metrics', { name: 'cost', unit: 'usd', direction: 'decrease', baseline: 100, target: 50 })
  const e = await call('POST', `/api/goal-metrics/${m.body.id}/evidence`, { value: 75 }, 'wk1')
  assert.equal(e.status, 200)
  assert.equal((await call('GET', '/api/goals/GA')).body.progress, 0, 'unverified evidence does not count')
  assert.equal((await call('POST', `/api/goal-evidence/${e.body.id}/verify`, {}, 'wk1')).status, 403, 'contributor cannot verify')
  assert.equal((await call('POST', `/api/goal-evidence/${e.body.id}/verify`, {}, 'loopback', 'wk1')).status, 403, 'submitter cannot verify own evidence')
  assert.equal((await call('POST', `/api/goal-evidence/${e.body.id}/verify`, {}, 'loopback', 'user1')).status, 200)
  const view = (await call('GET', '/api/goals/GA')).body
  assert.equal(view.own_progress, 0.5)
  assert.equal(view.metrics[0].verified_series.length, 1)
  assert.ok(view.history.length >= 4)
  const dash = (await call('GET', '/api/insights/dashboard')).body
  assert.equal(dash.goals.find((x) => x.id === 'GA').progress, 0.5)
})

test('role isolation: client sees goals not usage; unknown principal refused; manager sees only own project', async () => {
  const { call, p1, p2, t1, t2 } = await world()
  await call('POST', '/api/goals', { id: 'G1', scope: 'project', project_id: p1.id, title: 'alpha goal', status: 'active' })
  await call('POST', '/api/goals', { id: 'G2', scope: 'project', project_id: p2.id, title: 'beta goal', status: 'active' })
  await call('POST', '/api/usage/events', ev('u1', { task_id: t1.id }))
  await call('POST', '/api/usage/events', ev('u2', { task_id: t2.id }))
  const cl = await call('GET', '/api/insights/dashboard', undefined, 'cl1')
  assert.equal(cl.status, 200); assert.equal(cl.body.usage, null); assert.deepEqual(cl.body.budgets, []); assert.equal(cl.body.can.usage, false)
  assert.equal((await call('GET', '/api/usage/summary', undefined, 'cl1')).status, 403)
  assert.equal((await call('GET', '/api/budgets', undefined, 'cl1')).status, 403)
  assert.equal((await call('POST', '/api/goals', { scope: 'organization', title: 'x' }, 'cl1')).status, 403)
  assert.equal((await call('GET', '/api/insights/dashboard', undefined, 'ghost')).status, 403)
  const mg = (await call('GET', '/api/insights/dashboard', undefined, 'mgr1')).body
  assert.deepEqual(mg.goals.map((g) => g.id), ['G1'])
  assert.equal(mg.usage.events, 1)
  assert.equal((await call('GET', '/api/goals/G2', undefined, 'mgr1')).status, 404)
  assert.equal((await call('GET', `/api/projects/${p2.id}/insights`, undefined, 'mgr1')).status, 404)
  assert.equal((await call('GET', `/api/projects/${p1.id}/insights`, undefined, 'mgr1')).status, 200)
  assert.equal((await call('POST', '/api/usage/events', ev('u3', { task_id: t2.id }), 'mgr1')).status, 403)
  assert.equal((await call('POST', '/api/goals', { scope: 'organization', title: 'org' }, 'mgr1')).status, 403, 'manager cannot create org goal')
})

test('usage: double ingestion, supersede, zero-priced and subscription pool', async () => {
  const { call, t1 } = await world()
  const r1 = await call('POST', '/api/usage/events', ev('e1', { task_id: t1.id, request_key: 'req-1' }))
  assert.equal(r1.body.status, 'inserted')
  assert.equal((await call('POST', '/api/usage/events', ev('e1', { task_id: t1.id, request_key: 'req-1' }))).body.status, 'duplicate')
  assert.equal((await call('POST', '/api/usage/events', ev('e1b', { task_id: t1.id, request_key: 'req-1' }))).body.status, 'duplicate_request')
  assert.equal((await call('POST', '/api/usage/events', ev('e1', { task_id: t1.id, request_key: 'req-1', input_tokens: 999 }))).status, 409)
  await call('POST', '/api/usage/events', ev('loc', { task_id: t1.id, provider: 'llama', model: 'q', cost_class: 'local', cost_usd: 0 }))
  await call('POST', '/api/usage/events', ev('sub1', { task_id: t1.id, cost_class: 'included', cost_usd: 0, quota_pool: 'claude-max', agent: 'a1' }))
  await call('POST', '/api/usage/events', ev('sub2', { task_id: t1.id, cost_class: 'included', cost_usd: 0, quota_pool: 'claude-max', agent: 'a2' }))
  assert.equal((await call('POST', '/api/usage/events', ev('bad', { cost_class: 'free', cost_usd: 1 }))).status, 400)
  const s = (await call('GET', '/api/usage/summary')).body
  assert.equal(s.events, 4)
  assert.equal(s.cost_usd, 0.5)
  assert.equal(s.by_cost_class.local.cost_usd, 0)
  assert.equal(s.pools[0].tokens, 300); assert.equal(Object.keys(s.pools[0].by_agent).length, 2)
  const al = await call('POST', '/api/usage/events/e1/allocations', { lines: [{ goal_id: 'GX', pct: 60 }] }, 'wk1')
  assert.equal(al.status, 403, 'worker cannot allocate')
  const ok = await call('POST', '/api/usage/events/e1/allocations', { lines: [{ goal_id: 'GX', pct: 60 }] })
  assert.equal(ok.body.unattributed_pct, 40)
  assert.equal((await call('GET', '/api/usage/summary')).body.by_goal.goals.GX.tokens, 90)
})

test('budgets: concurrent reservations never overspend; roles and fail-closed authority', async () => {
  const { call } = await world()
  assert.equal((await call('POST', '/api/budgets', { id: 'BO', level: 'organization', subject: 'org', unit: 'tokens', limit_amount: 100 }, 'wk1')).status, 403)
  assert.equal((await call('POST', '/api/budgets', { id: 'BO', level: 'organization', subject: 'org', unit: 'tokens', limit_amount: 100 })).status, 200)
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => call('POST', '/api/budgets/BO/reserve', { amount: 30, holder: `t${i}` }, 'wk1')))
  assert.equal(rs.filter((r) => r.status === 200).length, 3)
  assert.equal(rs.filter((r) => r.status === 409).length, 5)
  const st = (await call('GET', '/api/budgets/BO')).body
  assert.equal(st.used, 90); assert.ok(st.events.some((e) => e.kind === 'denied'))
  const id = rs.find((r) => r.status === 200).body.reservation_id
  assert.equal((await call('POST', `/api/budget-reservations/${id}/settle`, { actual: 10 }, 'wk1')).body.settled_amount, 10)
  assert.equal((await call('GET', '/api/budgets/BO')).body.used, 70)
  assert.equal((await call('GET', '/api/budgets', undefined, 'cl1')).status, 403)
  const dash = (await call('GET', '/api/insights/dashboard')).body
  assert.equal(dash.budgets[0].used, 70)
})

test('budget raise needs a one-time human code; replay, wrong code, relayed and requester-approve all refused', async () => {
  const { call, adb } = await world()
  await call('POST', '/api/budgets', { id: 'BO', level: 'organization', subject: 'org', unit: 'tokens', limit_amount: 100 })
  const req = await call('POST', '/api/budgets/BO/raise-request', { amount: 500 }, 'wk1')
  const aid = req.body.approval_id; assert.ok(aid)
  assert.equal((await call('POST', '/api/budgets/BO/apply-raise', { approval_id: aid })).status, 403, 'unapproved raise refused')
  assert.equal((await call('POST', `/api/budget-approvals/${aid}/challenge`, {}, 'wk1')).status, 403, 'token principal cannot request a code')
  assert.equal((await call('POST', `/api/budget-approvals/${aid}/decide`, { approve: true, approver: 'user1', challenge_id: 'x', code: '000000' }, 'wk1')).status, 403)
  assert.equal((await call('POST', `/api/budget-approvals/${aid}/decide`, { approve: true, approver: 'user1', challenge_id: 'x', code: '000000' })).status, 409, 'no code issued yet')
  const ch = (await call('POST', `/api/budget-approvals/${aid}/challenge`, { approver: 'user1' })).body
  assert.match(ch.code, /^\d{6}$/)
  const wrong = ch.code === '000000' ? '111111' : '000000'
  assert.equal((await call('POST', `/api/budget-approvals/${aid}/decide`, { approve: true, approver: 'user1', challenge_id: ch.challenge_id, code: wrong })).status, 403)
  const ok = await call('POST', `/api/budget-approvals/${aid}/decide`, { approve: true, approver: 'user1', challenge_id: ch.challenge_id, code: ch.code })
  assert.equal(ok.status, 200); assert.equal(ok.body.state, 'approved')
  assert.equal((await call('POST', `/api/budget-approvals/${aid}/decide`, { approve: true, approver: 'user1', challenge_id: ch.challenge_id, code: ch.code })).status, 409, 'approved already')
  assert.equal((await call('POST', '/api/budgets/BO/apply-raise', { approval_id: aid }, 'wk1')).status, 403, 'worker may not apply')
  assert.equal((await call('POST', '/api/budgets/BO/apply-raise', { approval_id: aid })).body.limit, 500)
  assert.equal((await call('POST', '/api/budgets/BO/apply-raise', { approval_id: aid })).status, 403, 'approval consumed')
  // requester cannot approve their own raise even with a valid code
  const r2 = await call('POST', '/api/budgets/BO/raise-request', { amount: 900 }, 'loopback', 'user1')
  const c2 = (await call('POST', `/api/budget-approvals/${r2.body.approval_id}/challenge`, { approver: 'user1' })).body
  assert.equal((await call('POST', `/api/budget-approvals/${r2.body.approval_id}/decide`, { approve: true, approver: 'user1', challenge_id: c2.challenge_id, code: c2.code })).status, 403)
  assert.equal(adb.prepare('SELECT status FROM approvals WHERE scope LIKE ?').get(`%${r2.body.approval_id}%`).status, 'revoked', 'consumed proof is revoked when the decision is refused')
})

test('without an approvals store the human-proof path is closed', async () => {
  const { call } = await world({ authDb: false })
  await call('POST', '/api/budgets', { id: 'BO', level: 'organization', subject: 'org', unit: 'tokens', limit_amount: 100 })
  const req = await call('POST', '/api/budgets/BO/raise-request', { amount: 500 }, 'loopback', 'wk-x')
  assert.equal((await call('POST', `/api/budget-approvals/${req.body.approval_id}/challenge`, { approver: 'user1' })).status, 403)
  assert.equal((await call('POST', `/api/budget-approvals/${req.body.approval_id}/decide`, { approve: true, approver: 'user1' })).status, 403)
})

test('dashboard alerts: budget threshold, overdue goal, unverified evidence, with text labels', async () => {
  const { call, p1 } = await world()
  await call('POST', '/api/budgets', { id: 'BP', level: 'organization', subject: 'org', unit: 'tokens', limit_amount: 100 })
  await call('POST', '/api/budgets/BP/reserve', { amount: 85, holder: 't' })
  await call('POST', '/api/goals', { id: 'GO', scope: 'project', project_id: p1.id, title: 'late', status: 'active', due: '2020-01-01' })
  const m = await call('POST', '/api/goals/GO/metrics', { name: 'k', direction: 'increase', baseline: 0, target: 10 })
  await call('POST', `/api/goal-metrics/${m.body.id}/evidence`, { value: 3 })
  const d = (await call('GET', '/api/insights/dashboard')).body
  const kinds = d.alerts.map((a) => a.kind)
  assert.ok(kinds.includes('budget_threshold') && kinds.includes('goal_overdue') && kinds.includes('evidence_unverified'))
  assert.ok(d.alerts.every((a) => a.label && a.status_text && ['high', 'medium', 'low'].includes(a.severity)))
  assert.equal(d.alerts[0].severity, 'high')
  const pd = (await call('GET', `/api/projects/${p1.id}/insights`)).body
  assert.equal(pd.project.id, p1.id); assert.ok(Array.isArray(pd.tasks)); assert.ok(pd.resources)
})

test('UI ships an Insights view with goals, usage, alerts and text status labels', () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'public', 'index.html'), 'utf8')
  for (const needle of ["['insights'", 'viewInsights', '/api/insights/dashboard', '/insights', 'insProject', 'aria-label="Goal progress']) assert.ok(html.includes(needle), needle)
})
