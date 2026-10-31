// node --test blitz/recovery.test.mjs   (run from pm/)   BLITZ-06, Claude Opus 5.5
// Fakes only: no network, no real bridge, no DSH. The bridge is an in-memory fake.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { openStore, PmError } from '../store.mjs'
import * as approvals from '../approvals.mjs'
import { scopeHash } from './gate.mjs'
import { createAgentRegistry } from './agents.mjs'
import { createRecoveringController, classify, parseReset, looksRateLimited } from './recovery.mjs'
import { recoveryRoutes } from './recovery-routes.mjs'

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const T0 = Date.parse('2026-10-25T06:00:00Z')
const MACHINES = new Set(['vmixer2o2', 'ndi2'])

function fakeBridge() {
  let up = true
  const sent = []
  const acked = new Map()
  const inbound = []
  const seen = {}
  return {
    sent, seen, inbound,
    setUp(v) { up = v },
    ack(id, at) { acked.set(id, at) },
    reply(correlationId, body, from = 'chatgpt') { inbound.push({ id: `R${inbound.length + 1}`, correlation_id: correlationId, from: { agent: from, machine: 'cloud' }, body, created_at: new Date().toISOString() }) },
    available: () => true,
    send(env) {
      if (!up) throw new Error('connect ECONNREFUSED 127.0.0.1:4480')
      const m = { id: `M${sent.length + 1}`, ...env }
      sent.push(m)
      return m
    },
    message(id) { return sent.some((m) => m.id === id) ? { id, delivery: { delivered_at: acked.get(id) ?? null, acked_at: acked.get(id) ?? null } } : null },
    replies(cid) { return inbound.filter((m) => m.correlation_id === cid) },
    presence(agent) { return seen[agent] ?? null },
  }
}

function world({ agents = [{ name: 'Ada', max_concurrent: 2 }], policy = {}, bridge = fakeBridge(), ...deps } = {}) {
  let now = T0
  const clock = () => new Date(now)
  const store = openStore(':memory:', { clock })
  const ledger = new DatabaseSync(':memory:')
  approvals.migrate(ledger)
  const registry = createAgentRegistry(store.db, { store, machines: MACHINES, clock })
  for (const a of agents) registry.create(W, { role: 'builder', machine: 'vmixer2o2', transport: 'dsh-run', model_policy: { policy: 'FREE_FIRST' }, max_concurrent: 1, ...a })
  const p = store.createProject(W, { name: 'proj' })
  const { controller: ctl, recovery: rec } = createRecoveringController({
    store, ledgerDb: () => ledger, registry, clock, bridge, agent: 'chatgpt',
    policy: { maxAttempts: 3, backoffBaseSeconds: 10, backoffCapSeconds: 60, cooldownSeconds: 120, ackSeconds: 60, presenceSeconds: 300, sendRetrySeconds: [30], ttlSeconds: 3600, maxReminders: 2, ...policy },
    ...deps,
  })
  const task = (title, meta = { blitz: {} }) => { now += 1000; return store.createTask(W, { project: p.id, title, body: `${title} body`, meta }) }
  const approve = (t) => {
    const a = approvals.requestApproval(ledger, {
      kind: 'task_scope', requested_by: 'Claude Opus 5.5', now: new Date(now),
      scope: { project: t.project_id, task_id: t.id, task_rev: t.rev, scope_hash: scopeHash(t), scope: { repo: 'r', branch: 'b', files: ['pm/blitz/x.mjs'], summary: 's' }, permissions: ['fs_write'], version: 'v1', merge_limit: 'local_commit' },
    })
    return approvals.decideApproval(ledger, a.id, { approver: 'ada', method: 'pm_ui', proof: { approver: 'ada' }, decision: 'approved', now: new Date(now) })
  }
  const launch = (roster = agents.map((a) => a.name)) => {
    const c = ctl.create(W, { projects: [p.id], roster })
    const pf = ctl.preflight(W, c.id, { rev: c.rev })
    return ctl.launch(W, c.id, { rev: pf.rev, authorizedBy: 'user' })
  }
  const advance = (s) => { now += s * 1000 }
  const row = (cid, tid) => ctl.store.task(cid, tid)
  const kinds = (cid, kind) => ctl.events(cid, { kind, limit: 5000 })
  return { store, ledger, registry, ctl, rec, p, task, approve, launch, advance, row, kinds, bridge, clock }
}

test('classify: quota beats transport (DSH reports quota as transport), and the other classes', () => {
  assert.equal(classify({ kind: 'dispatch_failed', reason: 'dispatch: TRANSPORT error: 429 rate_limit_error' }), 'RATE_LIMIT')
  assert.equal(classify({ kind: 'task_failed', reason: "failed: You've hit your usage limit" }), 'RATE_LIMIT')
  assert.equal(classify({ kind: 'dispatch_failed', reason: 'dispatch: fetch failed ECONNRESET' }), 'TRANSPORT')
  assert.equal(classify({ kind: 'dispatch_failed', reason: 'dispatch: run timed out after 900s' }), 'TIMEOUT')
  assert.equal(classify({ kind: 'lease_expired', reason: 'x' }), 'TIMEOUT')
  assert.equal(classify({ kind: 'verification_failed', reason: 'verification failed: 3 failed' }), 'TEST_FAILURE')
  assert.equal(classify({ kind: 'approval', reason: 'approval: none' }), 'APPROVAL')
  assert.equal(classify({ kind: 'task_failed', reason: 'failed: merge conflict in pm/x.mjs' }), 'CONFLICT')
  assert.equal(classify({ kind: 'task_failed', reason: 'failed: something odd' }), 'UNKNOWN')
  assert.equal(parseReset('limit reached, resets at 2026-10-25T09:00:00Z').toISOString(), '2026-10-25T09:00:00.000Z')
  assert.equal(parseReset('Retry-After: 120', new Date(T0)).getTime(), T0 + 120000)
  assert.equal(parseReset('resets 5pm (America/Los_Angeles)'), null)
  assert.equal(looksRateLimited({ result: 'Claude usage limit reached', is_error: false }), true)
  assert.equal(looksRateLimited({ result: 'built the quota widget', artifacts: ['commit abc'] }), false)
})

test('rate limit: task and provider parked, no retry loop, one human escalation for the provider', async () => {
  let calls = 0
  const env = world({ dispatch: async () => { calls++; throw new Error('API Error: 429 {"type":"rate_limit_error"} usage limit reached') } })
  const a = env.task('a'); const b = env.task('b')
  env.approve(a); env.approve(b)
  const l = env.launch()
  const r = await env.rec.tick(W, l.id)
  assert.deepEqual(r.failed.sort(), [a.id, b.id].sort())
  assert.equal(calls, 2)
  for (let i = 0; i < 20; i++) { env.advance(1800); await env.rec.tick(W, l.id) } // ten hours of ticks
  assert.equal(calls, 2, 'no retry while the quota hold stands')
  assert.equal(env.row(l.id, a.id).state, 'escalated')
  assert.equal(env.row(l.id, b.id).state, 'escalated')
  assert.equal(env.ctl.get(l.id).state, 'running')
  const s = env.rec.status(l.id)
  assert.equal(s.holds.length, 1)
  assert.equal(s.holds[0].key, 'provider:agent:Ada')
  assert.equal(s.holds[0].until, null)
  assert.equal(s.escalations.length, 1, 'the second task joins the hold instead of a second escalation')
  assert.equal(s.escalations[0].kind, 'RATE_LIMIT')
  assert.equal(s.escalations[0].options[0].action, 'hold')
  assert.deepEqual(s.tasks.map((t) => t.state).sort(), ['human', 'parked'])
  assert.equal(env.ctl.status(l.id).roster.length, 0, 'held provider is out of the roster')
})

test('rate limit reported as success: parked until the stated reset, then resumed once', async () => {
  let calls = 0
  const env = world({ dispatch: async () => { calls++; return calls === 1 ? { ref: 'r1', result: { result: "You've hit your usage limit - resets at 2026-10-25T08:00:00Z", is_error: false } } : { ref: 'r2' } } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  const r = await env.rec.tick(W, l.id)
  assert.deepEqual(r.failed, [a.id])
  assert.equal(env.row(l.id, a.id).state, 'escalated')
  assert.equal(env.rec.status(l.id).escalations.length, 0, 'a stated reset needs no human')
  env.advance(3600); await env.rec.tick(W, l.id)
  assert.equal(calls, 1, 'not before the reset')
  env.advance(3601); const r2 = await env.rec.tick(W, l.id)
  assert.equal(calls, 2)
  assert.deepEqual(r2.recovery.requeued, [a.id])
  assert.equal(env.row(l.id, a.id).state, 'running')
  assert.equal(env.row(l.id, a.id).attempt, 2)
})

test('transport: bounded retries with backoff on the only agent, then a human escalation', async () => {
  let calls = 0
  const env = world({ dispatch: async () => { calls++; throw new Error('fetch failed: socket hang up ECONNRESET') } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  assert.equal(calls, 1)
  await env.rec.tick(W, l.id); assert.equal(calls, 1, 'backoff: not retried at once')
  env.advance(11); await env.rec.tick(W, l.id); assert.equal(calls, 2)
  env.advance(11); await env.rec.tick(W, l.id); assert.equal(calls, 2, 'second backoff doubles to 20s')
  env.advance(10); await env.rec.tick(W, l.id); assert.equal(calls, 3)
  for (let i = 0; i < 10; i++) { env.advance(600); await env.rec.tick(W, l.id) }
  assert.equal(calls, 3, 'never beyond maxAttempts')
  const decisions = env.kinds(l.id, 'recovery_decision').map((e) => e.data.action)
  assert.deepEqual(decisions, ['retry', 'retry', 'human'])
  const [e] = env.rec.status(l.id).escalations
  assert.equal(e.kind, 'TRANSPORT')
  assert.equal(e.options[0].action, 'retry')
  assert.match(e.options[0].detail, /one more attempt \(3\/3/)
  assert.equal(env.row(l.id, a.id).state, 'escalated')
})

test('reassignment: a transport failure on Ada moves the task to Bob (same role)', async () => {
  const seen = []
  const env = world({
    agents: [{ name: 'Ada', max_concurrent: 1 }, { name: 'Bob', max_concurrent: 1 }],
    dispatch: async (task, ctx) => { seen.push(ctx.agent.name); if (ctx.agent.name === 'Ada') throw new Error('ECONNREFUSED dsh'); return { ref: 'ok', result: { artifacts: ['commit 1'] } } },
    verify: async () => ({ verified: true }),
  })
  const a = env.task('a'); env.approve(a)
  const l = env.launch(['Ada', 'Bob'])
  await env.rec.tick(W, l.id)
  const r = await env.rec.tick(W, l.id) // no backoff for a reassignment
  assert.deepEqual(seen, ['Ada', 'Bob'])
  assert.deepEqual(r.recovery.requeued, [a.id])
  assert.equal(env.row(l.id, a.id).state, 'verified')
  assert.equal(env.ctl.get(l.id).state, 'completed')
  const d = env.kinds(l.id, 'recovery_decision')[0].data
  assert.equal(d.action, 'reassign')
  assert.deepEqual(d.to, ['Bob'])
  assert.equal(env.rec.holdActive('agent:Ada'), false, 'reassignment is per task, not a global agent cooldown')
  assert.deepEqual(env.row(l.id, a.id).avoid_agents, ['Ada'])
})

test('escalation delivery: pm comment + correlated bridge message, then ack', async () => {
  const env = world({ dispatch: async () => { throw new Error('merge conflict in pm/blitz/x.mjs') } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  const [e] = env.rec.status(l.id).escalations
  assert.equal(e.kind, 'CONFLICT')
  assert.deepEqual(e.options.map((o) => o.letter), ['A', 'B', 'C', 'D'])
  assert.equal(e.options[0].recommended, true)
  assert.equal(e.bridge_state, 'sent')
  const msg = env.bridge.sent[0]
  assert.equal(msg.correlation_id, e.id)
  assert.equal(msg.to.agent, 'chatgpt')
  assert.equal(msg.body.kind, 'blitz_escalation')
  assert.equal(msg.body.run, l.id)
  assert.equal(msg.body.task, a.id)
  assert.equal(msg.body.recommended, 'A')
  const comments = env.store.getTask(a.id).comments
  assert.equal(comments.length, 1)
  assert.match(comments[0].body, new RegExp(`\\[blitz-escalation ${e.id}\\]`))
  assert.match(comments[0].body, /A \(recommended\)/)
  env.advance(5); env.bridge.ack(msg.id, env.clock().toISOString())
  await env.rec.pump(W, l.id)
  assert.equal(env.rec.get(e.id).bridge_state, 'acked')
  assert.equal(env.kinds(l.id, 'escalation_acked').length, 1)
  // idempotent create: the same failure does not open a second escalation
  await env.rec.escalate({ kind: 'dispatch_failed', campaign_id: l.id, task_id: a.id, attempt: 1, reason: 'dispatch: merge conflict in pm/blitz/x.mjs [attempt 1]' }, { actor: W.actor })
  assert.equal(env.rec.status(l.id).escalations.length, 1)
})

test('bridge outage: falls back to the pm comment, marks undelivered_bridge, retries later', async () => {
  const bridge = fakeBridge()
  bridge.setUp(false)
  const env = world({ bridge, dispatch: async () => { throw new Error('something odd happened') } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  let [e] = env.rec.status(l.id).escalations
  assert.equal(e.bridge_state, 'undelivered_bridge')
  assert.match(e.last_error, /ECONNREFUSED/)
  const comments = env.store.getTask(a.id).comments.map((c) => c.body)
  assert.equal(comments.length, 2)
  assert.match(comments[1], /unavailable/)
  assert.equal(env.kinds(l.id, 'escalation_bridge_undelivered').length, 1)
  await env.rec.pump(W, l.id)
  assert.equal(env.kinds(l.id, 'escalation_bridge_undelivered').length, 1, 'no re-send before next_send_at')
  bridge.setUp(true)
  env.advance(31)
  await env.rec.pump(W, l.id)
  e = env.rec.get(e.id)
  assert.equal(e.bridge_state, 'sent')
  assert.equal(bridge.sent.length, 1)
  assert.equal(env.kinds(l.id, 'escalation_sent')[0].data.after_outage, true)
})

test('bridge off entirely (null): the comment carries the escalation', async () => {
  const env = world({ bridge: null, dispatch: async () => { throw new Error('something odd') } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  const [e] = env.rec.status(l.id).escalations
  assert.equal(e.bridge_state, 'undelivered_bridge')
  assert.equal(e.last_error, 'bridge is off')
  assert.ok(e.comment_id)
})

test('false presence: looks present but never acks -> absent, re-routed to comment and the fallback agent', async () => {
  const bridge = fakeBridge()
  const env = world({ bridge, fallbackAgents: ['claude-code'], dispatch: async () => { throw new Error('something odd') } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  bridge.seen.chatgpt = env.clock().toISOString() // presence says it is there
  env.advance(30); await env.rec.pump(W, l.id)
  let [e] = env.rec.status(l.id).escalations
  assert.equal(e.bridge_state, 'sent', 'still inside the ack deadline')
  bridge.seen.chatgpt = env.clock().toISOString()
  env.advance(31); await env.rec.pump(W, l.id)
  e = env.rec.get(e.id)
  const fp = env.kinds(l.id, 'escalation_false_presence')
  assert.equal(fp.length, 1)
  assert.equal(fp[0].data.agent, 'chatgpt')
  assert.match(env.store.getTask(a.id).comments.at(-1).body, /looked present .* treated as absent/)
  assert.equal(e.bridge_agent, 'claude-code')
  assert.equal(e.bridge_state, 'sent')
  assert.deepEqual(bridge.sent.map((m) => m.to.agent), ['chatgpt', 'claude-code'])
  env.advance(61); await env.rec.pump(W, l.id)
  assert.equal(env.rec.get(e.id).bridge_state, 'absent', 'last agent absent too: the pm comment is the channel')
  assert.equal(env.kinds(l.id, 'escalation_unacked').length, 1)
  assert.equal(env.row(l.id, a.id).state, 'escalated', 'absence never approves anything')
})

test('answer routing: a bridge reply is relayed (pending_confirm); only a direct confirm acts', async () => {
  let calls = 0
  const env = world({ dispatch: async () => { calls++; if (calls === 1) throw new Error('something odd'); return { ref: 'ok' } } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  const [e0] = env.rec.status(l.id).escalations
  const retry = e0.options.find((o) => o.action === 'retry').letter
  env.bridge.reply(e0.id, { choice: retry, model: 'gpt-6' })
  env.bridge.reply(e0.id, { text: 'sounds good' }) // no valid choice: ignored, never approval
  await env.rec.tick(W, l.id)
  let e = env.rec.get(e0.id)
  assert.equal(e.answer_state, 'pending_confirm')
  assert.equal(e.status, 'open')
  assert.equal(e.bridge_state, 'acked')
  assert.equal(env.row(l.id, a.id).state, 'escalated')
  assert.equal(calls, 1)
  assert.equal(env.kinds(l.id, 'escalation_reply_ignored').length, 1)
  await assert.rejects(env.rec.confirm({ ...W, via: 'chatgpt-token' }, e0.id), (x) => x instanceof PmError && x.status === 403)
  await assert.rejects(env.rec.confirm(W, e0.id, { relayed: true }), (x) => x instanceof PmError && x.status === 403)
  e = await env.rec.confirm(W, e0.id)
  assert.equal(e.status, 'resolved')
  assert.equal(e.applied.action, 'retry')
  assert.equal(e.applied.requeue.ok, true)
  assert.equal(env.row(l.id, a.id).state, 'pending')
  await env.rec.tick(W, l.id)
  assert.equal(calls, 2)
  assert.deepEqual(e.history.map((h) => h.state), ['pending_confirm', 'ignored', 'confirmed'])
  await assert.rejects(env.rec.answer(W, e0.id, { choice: 'A' }), (x) => x.status === 409)
})

test('routes: a token principal answers by relay; loopback answers directly; list and status', async () => {
  const env = world({ dispatch: async () => { throw new Error('something odd') } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  const routes = recoveryRoutes({ recovery: env.rec })
  const call = (method, path, body = {}, principal = { name: 'loopback' }, q = {}) => {
    const r = routes.find(([m, re]) => m === method && re.test(path))
    assert.ok(r, `no route ${method} ${path}`)
    return r[2](path.match(r[1]), body, W, q, principal)
  }
  const list = await call('GET', '/api/blitz/escalations', {}, undefined, { campaign: l.id })
  assert.equal(list.length, 1)
  const id = list[0].id
  assert.equal((await call('GET', `/api/blitz/escalations/${id}`)).id, id)
  const relayed = await call('POST', `/api/blitz/escalations/${id}/answer`, { choice: 'B' }, { name: 'chatgpt-token' })
  assert.equal(relayed.answer_state, 'pending_confirm')
  await assert.rejects(call('POST', `/api/blitz/escalations/${id}/confirm`, {}, { name: 'chatgpt-token' }), (x) => x.status === 403)
  await assert.rejects(call('POST', `/api/blitz/escalations/${id}/answer`, { choice: 'Z' }), (x) => x.status === 400)
  const direct = await call('POST', `/api/blitz/escalations/${id}/confirm`, {})
  assert.equal(direct.status, 'resolved')
  const st = await call('GET', `/api/blitz/campaigns/${l.id}/recovery`)
  assert.equal(st.escalations[0].status, 'resolved')
  assert.ok(await call('POST', `/api/blitz/campaigns/${l.id}/recovery/pump`))
})

test('silence never approves: expiry sends reminders, then the task stays parked with the escalation open', async () => {
  let calls = 0
  const env = world({ dispatch: async () => { calls++; throw new Error('something odd') } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  const [e0] = env.rec.status(l.id).escalations
  for (let i = 0; i < 12; i++) { env.advance(3601); await env.rec.tick(W, l.id) }
  const e = env.rec.get(e0.id)
  assert.equal(e.status, 'open')
  assert.equal(e.answer, null)
  assert.equal(e.reminders, 2)
  assert.ok(e.unanswered_at)
  assert.equal(env.kinds(l.id, 'escalation_reminder').length, 2)
  assert.equal(env.kinds(l.id, 'escalation_unanswered').length, 1)
  assert.equal(env.row(l.id, a.id).state, 'escalated')
  assert.equal(env.ctl.get(l.id).state, 'running')
  assert.equal(calls, 1)
})

test('approval: escalated to a human but never approved by the answer; the ledger approval supersedes it', async () => {
  let calls = 0
  const env = world({ dispatch: async () => { calls++; return { ref: 'r' } } })
  const a = env.task('a'); const b = env.task('b')
  const l = env.launch()
  await env.rec.tick(W, l.id)
  const all = env.rec.status(l.id).escalations
  const e = all.find((x) => x.task_id === a.id)
  const eb = all.find((x) => x.task_id === b.id)
  assert.ok(e && eb)
  assert.equal(e.kind, 'APPROVAL')
  assert.match(e.options[0].detail, /never approves/)
  assert.equal(env.row(l.id, a.id).state, 'blocked')
  const retry = e.options.find((o) => o.action === 'retry').letter
  await env.rec.answer(W, e.id, { choice: retry }) // re-check only
  await env.rec.tick(W, l.id)
  assert.equal(calls, 0, 'an answer cannot stand in for the ledger')
  assert.equal(env.row(l.id, a.id).state, 'blocked')
  assert.equal(env.rec.status(l.id).escalations.length, 2, 'the same block is not escalated twice')
  // b's escalation is left unanswered; the ledger approves b, b runs, and its escalation is superseded
  env.approve(env.store.getTask(b.id))
  await env.rec.tick(W, l.id)
  assert.equal(calls, 1)
  assert.equal(env.row(l.id, b.id).state, 'running')
  await env.rec.pump(W, l.id)
  const after = env.rec.get(eb.id)
  assert.equal(after.status, 'superseded')
  assert.equal(after.answer, null, 'superseded by the ledger, not by an inferred answer')
})

test('dependents wait while unrelated approved work proceeds; a human retry unblocks the chain', async () => {
  let failA = true
  const env = world({
    agents: [{ name: 'Ada', max_concurrent: 3 }],
    dispatch: async (task) => { if (task.title === 'a' && failA) throw new Error('merge conflict in shared.mjs'); return { ref: 'ok', result: { artifacts: ['c'] } } },
    verify: async () => ({ verified: true }),
  })
  const a = env.task('a'); const b = env.task('b', { blitz: { depends_on: [a.id] } }); const c = env.task('c')
  for (const t of [a, b, c]) env.approve(t)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  assert.equal(env.row(l.id, a.id).state, 'escalated')
  assert.equal(env.row(l.id, c.id).state, 'verified', 'unrelated approved work proceeds')
  await env.rec.tick(W, l.id)
  assert.equal(env.row(l.id, b.id).state, 'blocked')
  assert.match(env.row(l.id, b.id).reason, /^deps: dependency .* is escalated/)
  assert.equal(env.ctl.get(l.id).state, 'running')
  assert.equal(env.kinds(l.id, 'recovery_dependents_wait').length, 1)
  const [e] = env.rec.status(l.id).escalations
  failA = false
  await env.rec.answer(W, e.id, { choice: e.options.find((o) => o.action === 'retry').letter })
  await env.rec.tick(W, l.id)
  assert.equal(env.row(l.id, a.id).state, 'verified')
  await env.rec.tick(W, l.id)
  assert.equal(env.row(l.id, b.id).state, 'verified')
  assert.equal(env.ctl.get(l.id).state, 'completed')
})

test('session restoration: an expired lease is bounded through recovery and resumes from the last real checkpoint', async () => {
  const seen = []
  const env = world({ leaseSeconds: 60, dispatch: async (task, ctx) => { seen.push({ attempt: ctx.attempt, resumeFrom: ctx.resumeFrom }); return { ref: 'r' } } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  env.ctl.checkpoint(W, l.id, { taskId: a.id, owner: 'Ada', stage: 'tests_written', artifacts: ['x.test.mjs'] })
  env.advance(61)
  const r = await env.rec.tick(W, l.id)
  assert.deepEqual(r.recovery.reclaimed, [a.id])
  assert.equal(env.row(l.id, a.id).state, 'escalated', 'parked for backoff, not re-run at once')
  assert.equal(seen.length, 1)
  env.advance(11)
  await env.rec.tick(W, l.id)
  assert.equal(seen.length, 2)
  assert.equal(seen[1].attempt, 2)
  assert.equal(seen[1].resumeFrom.stage, 'tests_written')
  assert.equal(env.kinds(l.id, 'recovery_decision')[0].data.class, 'TIMEOUT')
})

test('bridgeAdapter over a real in-memory bridge queue: send, ack, correlated reply', async () => {
  const { openQueue } = await import('../bridge/queue.mjs')
  const { DEFAULT_POLICY } = await import('../bridge/delivery.mjs')
  const { bridgeAdapter } = await import('./recovery.mjs')
  const queue = openQueue(':memory:', { machine: 'vmixer2o2', policy: () => ({ ...DEFAULT_POLICY }) })
  const env = world({ bridge: bridgeAdapter({ queue }), dispatch: async () => { throw new Error('something odd') } })
  const a = env.task('a'); env.approve(a)
  const l = env.launch()
  await env.rec.tick(W, l.id)
  const [e] = env.rec.status(l.id).escalations
  assert.equal(e.bridge_state, 'sent')
  const sent = queue.list({ correlation: e.id })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to.agent, 'chatgpt')
  assert.equal(sent[0].from.agent, 'pm-blitz')
  queue.ackFor('chatgpt', { ids: [sent[0].id] })
  await env.rec.pump(W, l.id)
  assert.equal(env.rec.get(e.id).bridge_state, 'acked')
  queue.enqueue({ type: 'message', to: { agent: 'pm-blitz' }, from: { agent: 'chatgpt' }, correlation_id: e.id, body: { choice: 'A' } })
  const list = await env.rec.list({ campaign: l.id })
  assert.equal(list[0].answer_state, 'pending_confirm')
})
