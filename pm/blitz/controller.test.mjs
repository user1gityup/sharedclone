// node --test blitz/controller.test.mjs   (run from pm/)   BLITZ-05, Claude Opus 5.5
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { openStore, PmError } from '../store.mjs'
import * as approvals from '../approvals.mjs'
import { createServer } from '../server.mjs'
import { scopeHash } from './gate.mjs'
import { createAgentRegistry } from './agents.mjs'
import { createController, DISPATCH_NOT_WIRED } from './controller.mjs'
import { campaignRoutes } from './campaign-routes.mjs'

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const T0 = Date.parse('2026-10-25T06:00:00Z')
const MACHINES = new Set(['vmixer2o2', 'ndi2'])
const rejects = (fn, status, re) => assert.throws(fn, (e) => e instanceof PmError && e.status === status && (!re || re.test(e.message)))
const rejectsAsync = (p, status, re) => assert.rejects(p, (e) => e instanceof PmError && e.status === status && (!re || re.test(e.message)))

function world({ agents = [{ name: 'Ada', max_concurrent: 2 }], ...deps } = {}) {
  let now = T0
  const clock = () => new Date(now)
  const store = openStore(':memory:', { clock })
  const ledger = new DatabaseSync(':memory:')
  approvals.migrate(ledger)
  const registry = createAgentRegistry(store.db, { store, machines: MACHINES, clock })
  for (const a of agents) registry.create(W, { role: 'builder', machine: 'vmixer2o2', transport: 'dsh-run', model_policy: { policy: 'FREE_FIRST' }, max_concurrent: 1, ...a })
  const p = store.createProject(W, { name: 'proj' })
  const events = []
  const ctl = createController({ store, ledgerDb: () => ledger, registry, clock, onEvent: (e) => events.push(e), ...deps })
  const task = (title, meta = { blitz: {} }, extra = {}) => {
    now += 1000 // distinct created_at: ties break on it, deterministically
    return store.createTask(W, { project: p.id, title, body: `${title} body`, meta, ...extra })
  }
  const approve = (t) => {
    const a = approvals.requestApproval(ledger, {
      kind: 'task_scope', requested_by: 'Claude Opus 5.5', now: new Date(now),
      scope: { project: t.project_id, task_id: t.id, task_rev: t.rev, scope_hash: scopeHash(t), scope: { repo: 'r', branch: 'b', files: ['pm/blitz/x.mjs'], summary: 's' }, permissions: ['fs_write'], version: 'v1', merge_limit: 'local_commit' },
    })
    return approvals.decideApproval(ledger, a.id, { approver: 'ada', method: 'pm_ui', proof: { approver: 'ada' }, decision: 'approved', now: new Date(now) })
  }
  const advance = (s) => { now += s * 1000 }
  return { store, ledger, registry, ctl, p, task, approve, advance, events, clock }
}

/** draft -> preflighted -> launched, with an approved task each. */
function launched(env, { roster = ['Ada'], tasks } = {}) {
  const c = env.ctl.create(W, { projects: [env.p.id], roster, ...(tasks ? { tasks } : {}) })
  const pf = env.ctl.preflight(W, c.id, { rev: c.rev })
  return env.ctl.launch(W, c.id, { rev: pf.rev, authorizedBy: 'user' })
}

const okDispatch = () => async (task, ctx) => ({ ref: `run-${task.id}-${ctx.attempt}` })

test('create needs projects and an actor; roster is never defaulted', () => {
  const env = world()
  rejects(() => env.ctl.create(W, {}), 400, /no default project/)
  rejects(() => env.ctl.create({}, { projects: [env.p.id] }), 400, /actor/)
  rejects(() => env.ctl.create(W, { projects: ['nope'] }), 400, /unknown project/)
  const c = env.ctl.create(W, { projects: ['proj'] })
  assert.deepEqual(c.roster, [])
  assert.deepEqual(c.projects, [env.p.id])
  const top = env.ctl.create(W, { top_n: 3 })
  assert.deepEqual(top.projects, []) // no open coding tasks yet: nothing ranked
})

test('launch refused without explicit authorization', () => {
  const env = world()
  env.approve(env.task('a'))
  const c = env.ctl.create(W, { projects: [env.p.id], roster: ['Ada'] })
  const pf = env.ctl.preflight(W, c.id, { rev: c.rev })
  assert.equal(pf.state, 'preflighted')
  assert.equal(pf.preflight.ok, true)
  for (const authorizedBy of [undefined, '', '   ', 7]) rejects(() => env.ctl.launch(W, c.id, { rev: pf.rev, authorizedBy }), 400, /authoriz/)
  rejects(() => env.ctl.launch(W, c.id, { authorizedBy: 'user' }), 400, /rev is required/)
  const l = env.ctl.launch(W, c.id, { rev: pf.rev, authorizedBy: 'user' })
  assert.equal(l.state, 'launched')
  assert.equal(l.authorized_by, 'user')
})

test('launch refused with an empty roster, an empty slot, or a disabled agent', () => {
  const env = world()
  env.approve(env.task('a'))
  let c = env.ctl.create(W, { projects: [env.p.id] })
  c = env.ctl.preflight(W, c.id, { rev: c.rev })
  assert.equal(c.preflight.ok, false)
  assert.match(c.preflight.problems[0].reason, /no default roster/)
  rejects(() => env.ctl.launch(W, c.id, { rev: c.rev, authorizedBy: 'user' }), 400, /no default roster/)
  c = env.ctl.update(W, c.id, { rev: c.rev, roster: ['Ada', { slot: 'reviewer', agent: '' }] })
  assert.equal(c.state, 'draft') // editing a preflighted campaign sends it back to draft
  c = env.ctl.preflight(W, c.id, { rev: c.rev })
  rejects(() => env.ctl.launch(W, c.id, { rev: c.rev, authorizedBy: 'user' }), 400, /slot 2 \(reviewer\) is empty/)
  c = env.ctl.update(W, c.id, { rev: c.rev, roster: ['Ada'] })
  c = env.ctl.preflight(W, c.id, { rev: c.rev })
  env.registry.disable(W, 'Ada', { rev: 1 })
  rejects(() => env.ctl.launch(W, c.id, { rev: c.rev, authorizedBy: 'user' }), 400, /disabled/)
  assert.equal(env.ctl.get(c.id).state, 'preflighted')
})

test('state machine: illegal transitions 409; pause/resume; preflight with no tasks refused', () => {
  const env = world()
  const empty = env.ctl.create(W, { projects: [env.p.id], roster: ['Ada'] })
  rejects(() => env.ctl.preflight(W, empty.id, { rev: empty.rev }), 409, /no open coding tasks/)
  env.approve(env.task('a'))
  const c = env.ctl.create(W, { projects: [env.p.id], roster: ['Ada'] })
  rejects(() => env.ctl.launch(W, c.id, { rev: c.rev, authorizedBy: 'user' }), 409, /state draft/)
  rejects(() => env.ctl.pause(W, c.id, { rev: c.rev }), 409)
  const l = launched(env)
  const p = env.ctl.pause(W, l.id, { rev: l.rev })
  assert.equal(p.state, 'paused')
  rejects(() => env.ctl.pause(W, l.id, { rev: p.rev }), 409)
  const r = env.ctl.resume(W, l.id, { rev: p.rev })
  assert.equal(r.state, 'running')
  assert.deepEqual(env.ctl.events(l.id).map((e) => e.kind), ['created', 'preflighted', 'launched', 'paused', 'resumed'])
})

test('rev conflict: a stale rev is refused with 409 and the current record', () => {
  const env = world()
  env.approve(env.task('a'))
  const c = env.ctl.create(W, { projects: [env.p.id], roster: ['Ada'] })
  env.ctl.update(W, c.id, { rev: c.rev, title: 'renamed' })
  assert.throws(() => env.ctl.preflight(W, c.id, { rev: c.rev }), (e) => e instanceof PmError && e.status === 409 && e.extra.current.rev === 2)
  rejects(() => env.ctl.update(W, c.id, { rev: c.rev, title: 'again' }), 409, /stale rev/)
})

test('unapproved task is blocked and logged; approved unrelated task still runs; approval later unblocks', async () => {
  const env = world({ dispatch: okDispatch() })
  const a = env.task('approved'); env.approve(a)
  const b = env.task('unapproved')
  const l = launched(env)
  assert.equal(env.ctl.get(l.id).preflight.problems.filter((x) => x.kind === 'approval').length, 1)
  const r = await env.ctl.tick(W, l.id)
  assert.deepEqual(r.dispatched, [a.id])
  assert.equal(r.campaign.state, 'running')
  const rowB = env.ctl.store.task(l.id, b.id)
  assert.equal(rowB.state, 'blocked')
  assert.match(rowB.reason, /^approval: no task_scope approval/)
  const ev = env.ctl.events(l.id, { task: b.id })
  assert.deepEqual(ev.map((e) => e.kind), ['approval_blocked', 'escalation'])
  // a second tick does not duplicate the block event or the escalation
  await env.ctl.tick(W, l.id)
  assert.equal(env.ctl.events(l.id, { task: b.id }).length, 2)
  env.approve(env.store.getTask(b.id))
  const r2 = await env.ctl.tick(W, l.id)
  assert.deepEqual(r2.dispatched, [b.id])
})

test('a material edit after approval revokes it and blocks the task (stale scope)', async () => {
  const env = world({ dispatch: okDispatch() })
  const a = env.task('a'); env.approve(a)
  const l = launched(env)
  env.store.updateTask(W, a.id, { rev: a.rev, body: 'changed scope' })
  await env.ctl.tick(W, l.id)
  assert.match(env.ctl.store.task(l.id, a.id).reason, /older scope/)
})

test('default dispatch is not wired: the task fails, nothing runs, campaign settles failed', async () => {
  const env = world()
  const a = env.task('a'); env.approve(a)
  const l = launched(env)
  const r = await env.ctl.tick(W, l.id)
  assert.deepEqual(r.failed, [a.id])
  const row = env.ctl.store.task(l.id, a.id)
  assert.equal(row.state, 'failed')
  assert.equal(row.reason, `dispatch: ${DISPATCH_NOT_WIRED}`)
  assert.equal(r.campaign.state, 'failed')
})

test('DAG order: dependents wait for verified dependencies; capacity caps the round', async () => {
  const verify = async () => ({ verified: true, evidence: ['tests 3/3'] })
  const env = world({ dispatch: okDispatch(), verify, agents: [{ name: 'Ada', max_concurrent: 1 }, { name: 'Bob', max_concurrent: 1 }] })
  const a = env.task('a'); const b = env.task('b'); const c = env.task('c', { blitz: { depends_on: [a.id, b.id] } }); const d = env.task('d')
  for (const t of [a, b, c, d]) env.approve(t)
  const l = launched(env, { roster: ['Ada', 'Bob'] })
  assert.deepEqual(env.ctl.dag(l.id).waves, [[a.id, b.id, d.id], [c.id]])
  let r = await env.ctl.tick(W, l.id)
  assert.equal(r.dispatched.length, 2) // two agents x one slot
  assert.deepEqual(r.dispatched, [a.id, b.id])
  assert.equal(env.ctl.store.task(l.id, c.id).state, 'blocked')
  assert.match(env.ctl.store.task(l.id, c.id).reason, /^deps: waiting on/)
  const owner = (id) => env.ctl.store.task(l.id, id).lease_owner
  await env.ctl.reportResult(W, l.id, { taskId: a.id, owner: owner(a.id), result: { artifacts: ['commit abc'] } })
  assert.equal(env.ctl.store.task(l.id, a.id).state, 'verified')
  r = await env.ctl.tick(W, l.id)
  assert.deepEqual(r.dispatched, [d.id])
  await env.ctl.reportResult(W, l.id, { taskId: b.id, owner: owner(b.id), result: {} })
  await env.ctl.reportResult(W, l.id, { taskId: d.id, owner: owner(d.id), result: {} })
  r = await env.ctl.tick(W, l.id)
  assert.deepEqual(r.dispatched, [c.id])
  const done = await env.ctl.reportResult(W, l.id, { taskId: c.id, owner: owner(c.id), result: {} })
  assert.equal(done.campaign.state, 'completed')
})

test('nothing is verified without a verifier: tasks stay awaiting_verification and the campaign stays open', async () => {
  const env = world({ dispatch: async () => ({ ref: 'x', result: { artifacts: [] } }) })
  const a = env.task('a'); env.approve(a)
  const l = launched(env)
  const r = await env.ctl.tick(W, l.id)
  assert.equal(r.campaign.state, 'running')
  const row = env.ctl.store.task(l.id, a.id)
  assert.equal(row.state, 'awaiting_verification')
  assert.equal(row.reason, 'unverified: verifier not wired')
  assert.equal(row.checkpoint.stage, 'awaiting_verification')
})

test('lease expiry: worker calls refused after expiry; recover reclaims; next tick re-dispatches with the checkpoint', async () => {
  const seen = []
  const env = world({ dispatch: async (task, ctx) => { seen.push({ attempt: ctx.attempt, resumeFrom: ctx.resumeFrom }); return { ref: 'r' } }, leaseSeconds: 60 })
  const a = env.task('a'); env.approve(a)
  const l = launched(env)
  await env.ctl.tick(W, l.id)
  const cp = env.ctl.checkpoint(W, l.id, { taskId: a.id, owner: 'Ada', stage: 'tests_written', artifacts: ['pm/blitz/x.test.mjs'] })
  assert.deepEqual(Object.keys(cp).sort(), ['artifacts', 'at', 'attempt', 'stage'])
  assert.equal(cp.attempt, 1)
  rejects(() => env.ctl.checkpoint(W, l.id, { taskId: a.id, owner: 'Ada', stage: '' }), 400)
  rejects(() => env.ctl.heartbeat(W, l.id, { taskId: a.id, owner: 'Mallory' }), 409, /leased to Ada/)
  assert.equal(env.ctl.recover(W, l.id).reclaimed.length, 0) // lease still held
  env.advance(61)
  rejects(() => env.ctl.heartbeat(W, l.id, { taskId: a.id, owner: 'Ada' }), 409, /expired/)
  await rejectsAsync(env.ctl.reportResult(W, l.id, { taskId: a.id, owner: 'Ada', result: {} }), 409, /expired/)
  const rec = env.ctl.recover(W, l.id)
  assert.deepEqual(rec.reclaimed, [a.id])
  assert.equal(env.ctl.store.task(l.id, a.id).state, 'pending')
  await env.ctl.tick(W, l.id)
  assert.equal(seen.length, 2)
  assert.equal(seen[1].attempt, 2)
  assert.equal(seen[1].resumeFrom.stage, 'tests_written')
  // the old attempt cannot report into the new lease
  await rejectsAsync(env.ctl.reportResult(W, l.id, { taskId: a.id, owner: 'Ada', attempt: 1, result: {} }), 409, /stale attempt/)
  assert.ok(env.ctl.events(l.id, { kind: 'lease_expired' }).length === 1)
})

test('idempotent retry: same key or same attempt never repeats a side effect', async () => {
  let dispatches = 0
  let commits = 0
  const env = world({
    dispatch: async (task, ctx) => {
      dispatches++
      await ctx.once('commit', async () => { commits++; return { sha: 'abc' } })
      const again = await ctx.once('commit', async () => { commits++; return { sha: 'def' } })
      assert.equal(again.replayed, true)
      assert.equal(again.sha, 'abc')
      return { ref: 'r' }
    },
    verify: async () => ({ verified: true }),
  })
  const a = env.task('a'); env.approve(a)
  const b = env.task('b')
  const c = env.ctl.create(W, { projects: [env.p.id], roster: ['Ada'], idempotencyKey: 'create-1' })
  const c2 = env.ctl.create(W, { projects: [env.p.id], roster: ['Ada'], idempotencyKey: 'create-1' })
  assert.equal(c2.id, c.id)
  assert.equal(c2.replayed, true)
  assert.equal(env.ctl.list().length, 1)
  const pf = env.ctl.preflight(W, c.id, { rev: c.rev })
  const l1 = env.ctl.launch(W, c.id, { rev: pf.rev, authorizedBy: 'user', idempotencyKey: 'go' })
  const l2 = env.ctl.launch(W, c.id, { rev: pf.rev, authorizedBy: 'user', idempotencyKey: 'go' }) // stale rev, but a replay
  assert.equal(l2.replayed, true)
  assert.equal(l2.rev, l1.rev)
  assert.equal(env.ctl.events(c.id, { kind: 'launched' }).length, 1)
  await env.ctl.tick(W, c.id)
  await env.ctl.tick(W, c.id)
  assert.equal(dispatches, 1)
  assert.equal(commits, 1)
  const r1 = await env.ctl.reportResult(W, c.id, { taskId: a.id, owner: 'Ada', result: { n: 1 } })
  const r2 = await env.ctl.reportResult(W, c.id, { taskId: a.id, owner: 'Ada', attempt: 1, result: { n: 2 } })
  assert.equal(r1.task.state, 'verified')
  assert.equal(r2.replayed, true)
  assert.equal(env.ctl.events(c.id, { kind: 'result' }).length, 1)
  assert.equal(env.ctl.events(c.id, { kind: 'verification' }).length, 1)
  void b
})

test('two-phase cancel: request, worker ack, then cancelled; idle tasks cancel at once', async () => {
  const env = world({ dispatch: okDispatch(), agents: [{ name: 'Ada', max_concurrent: 1 }] })
  const a = env.task('a'); const b = env.task('b'); env.approve(a); env.approve(b)
  const l = launched(env)
  await env.ctl.tick(W, l.id)
  const cur = env.ctl.get(l.id)
  const req = env.ctl.cancel(W, l.id, { rev: cur.rev, reason: 'user stop' })
  assert.equal(req.state, 'running')
  assert.equal(req.cancel_requested, true)
  assert.equal(env.ctl.store.task(l.id, b.id).state, 'cancelled')
  assert.equal(env.ctl.store.task(l.id, a.id).state, 'running')
  assert.equal(env.ctl.heartbeat(W, l.id, { taskId: a.id, owner: 'Ada' }).cancel_requested, true)
  const t = await env.ctl.tick(W, l.id)
  assert.equal(t.skipped, 'cancel requested')
  rejects(() => env.ctl.cancel(W, l.id, { rev: req.rev }), 409, /already requested/)
  rejects(() => env.ctl.ackCancel(W, l.id, { taskId: a.id, owner: 'Bob' }), 409)
  const done = env.ctl.ackCancel(W, l.id, { taskId: a.id, owner: 'Ada', observed: 'stopped' })
  assert.equal(done.state, 'cancelled')
  assert.equal(env.ctl.store.task(l.id, a.id).state, 'cancelled')
  const kinds = env.ctl.events(l.id).map((e) => e.kind)
  assert.ok(kinds.indexOf('cancel_requested') < kinds.indexOf('cancel_acked'))
  assert.ok(kinds.indexOf('cancel_acked') < kinds.indexOf('cancelled'))
  // a draft cancels in one step
  const d = env.ctl.create(W, { projects: [env.p.id], roster: ['Ada'] })
  assert.equal(env.ctl.cancel(W, d.id, { rev: d.rev }).state, 'cancelled')
})

test('cancel with a dead worker completes when recover reclaims the expired lease', async () => {
  const env = world({ dispatch: okDispatch(), leaseSeconds: 30 })
  const a = env.task('a'); env.approve(a)
  const l = launched(env)
  await env.ctl.tick(W, l.id)
  env.ctl.cancel(W, l.id, { rev: env.ctl.get(l.id).rev })
  env.advance(31)
  const r = env.ctl.recover(W, l.id)
  assert.equal(r.campaign.state, 'cancelled')
  assert.equal(env.ctl.recoverAll(W).length, 0)
})

test('failure, bounded retry, escalation hook, requeue', async () => {
  const problems = []
  const env = world({ dispatch: okDispatch(), maxAttempts: 2, escalate: async (p) => { problems.push(p); return { escalated: p.attempt >= 2, ref: 'bridge-1' } } })
  const a = env.task('a'); env.approve(a)
  const l = launched(env)
  await env.ctl.tick(W, l.id)
  await env.ctl.reportFailure(W, l.id, { taskId: a.id, owner: 'Ada', error: 'tests red' })
  assert.equal(env.ctl.store.task(l.id, a.id).state, 'failed')
  await env.ctl.tick(W, l.id) // retry: attempt 2
  assert.equal(env.ctl.store.task(l.id, a.id).attempt, 2)
  await env.ctl.reportFailure(W, l.id, { taskId: a.id, owner: 'Ada', error: 'still red' })
  assert.equal(env.ctl.store.task(l.id, a.id).state, 'escalated')
  assert.deepEqual(problems.map((p) => [p.kind, p.attempt]), [['task_failed', 1], ['task_failed', 2]])
  assert.equal(env.ctl.get(l.id).state, 'running') // waiting on a human
  const st = env.ctl.status(l.id)
  assert.equal(st.counts.escalated, 1)
  assert.equal(st.escalations.length, 2)
  assert.equal(st.roster[0].name, 'Ada')
  const rq = env.ctl.requeue(W, l.id, { taskId: a.id, reason: 'user answered' })
  assert.equal(rq.state, 'pending')
})

test('HTTP: campaign routes mounted; qa routes on the same id still match', async () => {
  const store = openStore(':memory:')
  const registry = createAgentRegistry(store.db, { store, machines: MACHINES })
  registry.create(W, { name: 'Ada', role: 'builder', machine: 'vmixer2o2', transport: 'dsh-run', model_policy: { policy: 'FREE_FIRST' }, max_concurrent: 1 })
  const p = store.createProject(W, { name: 'web' })
  store.createTask(W, { project: p.id, title: 'x', meta: { blitz: {} } })
  const server = createServer(store, {})
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-pm-actor': 'Claude Opus 5.5' } }, (res) => {
      let s = ''
      res.on('data', (c) => { s += c })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s || '{}') }))
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
  try {
    let r = await call('POST', '/api/blitz/campaigns', { projects: [p.id], roster: ['Ada'] })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const id = r.body.id
    r = await call('POST', `/api/blitz/campaigns/${id}/preflight`, { rev: 1 })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.preflight.problems[0].kind, 'approval') // bridge off: ledger unavailable
    r = await call('POST', `/api/blitz/campaigns/${id}/launch`, { rev: r.body.rev })
    assert.equal(r.status, 400)
    r = await call('POST', `/api/blitz/campaigns/${id}/preflight`, { rev: 1 })
    assert.equal(r.status, 409)
    r = await call('GET', `/api/blitz/campaigns/${id}/dag`)
    assert.equal(r.body.waves.length, 1)
    r = await call('GET', `/api/blitz/campaigns/${id}/status`)
    assert.equal(r.body.counts.pending, 1)
    r = await call('POST', `/api/blitz/campaigns/${id}/qa`, { project: p.id, question: 'ok?' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    r = await call('GET', `/api/blitz/campaigns/${id}/qa/current`)
    assert.equal(r.status, 200)
    assert.equal(campaignRoutes({}).length, 0)
  } finally {
    server.close()
    store.close()
  }
})

// ---- Phase-1 integration fixes (Claude Opus 5.5): escalation per attempt, park, avoidAgents, canLease, verifier role ----
import { world as fxWorld } from './blitz07.fixture.mjs'

test('escalation dedupe includes the attempt: a retry with the identical failure is escalated again', async () => {
  const env = fxWorld({ deps: { dispatch: async () => { throw new Error('same error') }, maxAttempts: 2 } })
  const t = env.task('x'); env.approve(t)
  const c = env.launch({ roster: ['Ada'] })
  await env.ctl.tick(W, c.id)
  await env.ctl.tick(W, c.id)
  assert.deepEqual(env.escalations.filter((p) => p.kind === 'dispatch_failed').map((p) => p.attempt), [1, 2])
  assert.equal(env.ctl.get(c.id).state, 'failed')
})

test('park: rev-checked, only idle tasks, emits task_escalated', async () => {
  const env = fxWorld({ deps: { dispatch: async () => ({ ref: 'r' }) } })
  const a = env.task('a'); const b = env.task('b'); env.approve(a)
  const c = env.launch({ roster: ['Ada'] })
  const pb = env.ctl.store.task(c.id, b.id)
  assert.throws(() => env.ctl.park(W, c.id, { taskId: b.id, reason: 'x', rev: pb.rev + 7 }), (e) => e instanceof PmError && e.status === 409)
  const parked = env.ctl.park(W, c.id, { taskId: b.id, reason: 'human decides', rev: pb.rev })
  assert.equal(parked.state, 'escalated')
  assert.equal(parked.reason, 'escalated: human decides')
  assert.equal(env.ctl.events(c.id, { task: b.id, kind: 'task_escalated' }).length, 1)
  await env.ctl.tick(W, c.id)
  assert.equal(env.ctl.store.task(c.id, a.id).state, 'running')
  assert.equal(env.ctl.park(W, c.id, { taskId: a.id, reason: 'x' }), null, 'a running task is not parked')
})

test('avoidAgents is per task; canLease can refuse an agent; untagged tasks never go to a verifier', async () => {
  const agents = [{ name: 'Ada', role: 'builder', max_concurrent: 2 }, { name: 'Bob', role: 'builder', max_concurrent: 2 }, { name: 'Vera', role: 'verifier', max_concurrent: 2 }]
  let refuse = null
  const env = fxWorld({ agents, deps: { dispatch: async () => ({ ref: 'r' }), canLease: ({ agent }) => (agent.name === refuse ? { ok: false, reason: 'test' } : true) } })
  const a = env.task('a', { role: undefined }); const b = env.task('b', { role: undefined })
  env.approve(a); env.approve(b)
  // only a verifier in the roster: nothing is leased
  let c = env.launch({ roster: ['Vera'] })
  let r = await env.ctl.tick(W, c.id)
  assert.deepEqual(r.leased, [])
  // canLease refuses Ada -> both go to Bob; requeue a with avoidAgents [Bob] -> Ada (b stays on Bob)
  c = env.launch({ roster: ['Ada', 'Bob', 'Vera'] })
  refuse = 'Ada'
  r = await env.ctl.tick(W, c.id)
  assert.deepEqual([a, b].map((t) => env.ctl.store.task(c.id, t.id).agent), ['Bob', 'Bob'])
  refuse = null
  const ra = env.ctl.store.task(c.id, a.id)
  env.ctl.store.setTask(c.id, a.id, ra.rev, { state: 'failed', lease_owner: null, lease_until: null })
  const q = env.ctl.requeue(W, c.id, { taskId: a.id, reason: 'reassign', avoidAgents: ['Bob'] })
  assert.deepEqual(q.avoid_agents, ['Bob'])
  await env.ctl.tick(W, c.id)
  assert.equal(env.ctl.store.task(c.id, a.id).agent, 'Ada')
  assert.equal(env.ctl.store.task(c.id, b.id).agent, 'Bob')
  // when only avoided agents fit, the task still runs (fallback, never stuck)
  const env2 = fxWorld({ deps: { dispatch: async () => ({ ref: 'r' }) } })
  const t2 = env2.task('t'); env2.approve(t2)
  const c2 = env2.launch({ roster: ['Ada', 'Vera'] })
  await env2.ctl.tick(W, c2.id)
  const r2 = env2.ctl.store.task(c2.id, t2.id)
  env2.ctl.store.setTask(c2.id, t2.id, r2.rev, { state: 'failed', lease_owner: null, lease_until: null })
  env2.ctl.requeue(W, c2.id, { taskId: t2.id, reason: 'x', avoidAgents: ['Ada'] })
  await env2.ctl.tick(W, c2.id)
  assert.equal(env2.ctl.store.task(c2.id, t2.id).agent, 'Ada')
  assert.equal(env2.ctl.store.task(c2.id, t2.id).attempt, 2)
})

test('guard: untagged demand is no demand for a verifier, so it never takes a ceiling slot', async () => {
  const { createGuard } = await import('./guard.mjs')
  const env = fxWorld()
  const t = env.task('t', { role: undefined }); env.approve(t)
  const c = env.launch({ roster: ['Vera', 'Ada'] })
  const guard = createGuard({ db: env.store.db, ceilings: { global: 1 }, readSnapshot: async () => ({}) })
  const roster = [{ name: 'Vera', role: 'verifier', transport: 'dsh-run', model_policy: {}, max_concurrent: 1 }, { name: 'Ada', role: 'builder', transport: 'dsh-run', model_policy: {}, max_concurrent: 1 }]
  for (let i = 0; i < 2; i++) { // both rotation offsets
    const caps = Object.fromEntries(guard.apply(c.id, roster).map((a) => [a.name, a.max_concurrent]))
    assert.deepEqual(caps, { Vera: 0, Ada: 1 })
  }
})
