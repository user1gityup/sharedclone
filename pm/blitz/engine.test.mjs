// node --test blitz/engine.test.mjs   (run from pm/)   Blitz Phase-1 integration, Claude Opus 5.5
// The composed engine exactly as server.mjs builds it (createEngine({store, ledgerDb: () => bridge.queue.db,
// bridge}) plus fakes for spawn, git, the check runner, the review and the quota snapshot), driven by the
// real runner, poller, recovery, verifier and guard. Nothing real is launched: dsh-run is a fake spawn,
// Claude is a fake bridge queue, checks are a fake runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../store.mjs'
import * as approvals from '../approvals.mjs'
import { scopeHash } from './gate.mjs'
import { createAgentRegistry } from './agents.mjs'
import { ENABLE_ENV } from './dispatch.mjs'
import { createEngine } from './engine.mjs'
import { buildStatus, finalReport } from './status.mjs'
import { createServer } from '../server.mjs'

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const T0 = Date.parse('2026-10-25T20:00:00Z')
const MACHINES = new Set(['vmixer2o2', 'ndi2'])
const CHECKS = ['npm test']
const ACCEPT = ['feature works']

/** Fake pm bridge: just the queue the engine uses (approval ledger db, Claude submits, escalation messages). */
function fakeBridge(ledger) {
  const messages = []
  const queue = {
    db: ledger, machine: 'vmixer2o2', messages,
    enqueue(env) {
      const dup = env.dedupe_key && messages.find((m) => m.dedupe_key === env.dedupe_key)
      if (dup) return { ...dup, duplicate: true }
      const m = { id: env.id ?? `M${messages.length + 1}`, ...env, created_at: new Date().toISOString() }
      messages.push(m)
      return m
    },
    list: ({ correlation } = {}) => messages.filter((m) => !correlation || m.correlation_id === correlation),
    pending: () => null,
  }
  return { queue }
}

function world({ review: reviewFn } = {}) {
  let now = T0
  const clock = () => new Date(now)
  const store = openStore(':memory:', { clock })
  const ledger = new DatabaseSync(':memory:')
  approvals.migrate(ledger)
  const bridge = fakeBridge(ledger)
  const registry = createAgentRegistry(store.db, { store, machines: MACHINES, clock })
  const agent = (name, role, transport, model_policy, machine = 'vmixer2o2', max_concurrent = 1) => registry.create(W, { name, role, machine, transport, model_policy, max_concurrent })
  agent('Dee', 'builder', 'dsh-run', { policy: 'FIXED_ROSTER', allow: ['deepseek'] }, 'vmixer2o2', 2)
  agent('Bo', 'builder', 'dsh-run', { policy: 'FIXED_ROSTER', allow: ['kimi'] })
  agent('Cleo', 'writer', 'bridge-claude', { policy: 'SUBSCRIPTION_FIRST', pin: 'claude-opus-5-5' }, 'ndi2')
  agent('Vera', 'verifier', 'dsh-run', { policy: 'FIXED_ROSTER', allow: ['qwen'] })
  const root = mkdtempSync(join(tmpdir(), 'blitz-engine-'))
  const dshHomes = {}
  for (const n of ['Dee', 'Bo', 'Vera']) { dshHomes[n] = join(root, `lane-${n}`); mkdirSync(dshHomes[n]); writeFileSync(join(dshHomes[n], 'settings.yaml'), 'council: {}\n') }

  // dsh-run fake: outcome per (task, attempt) from `script`; a task in `hold` keeps running
  const runs = {}
  const calls = []
  const script = {}
  const hold = new Set()
  const outcome = (runId) => {
    const m = runId.match(/^BLITZ-[\w.-]+?-(T-[0-9a-f]+)-a(\d+)$/)
    const s = script[m?.[1]]
    return typeof s === 'function' ? s(Number(m[2])) : s
  }
  const spawn = (cmd, args) => {
    calls.push(args)
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = { end() {} }; child.pid = 1
    let r = { code: 9 }
    if (args[1] === 'start') {
      const run = args[args.indexOf('--run') + 1]
      const o = outcome(run)
      runs[run] = { runId: run, status: 'running', ...(o && !hold.has(run.match(/-(T-[0-9a-f]+)-a/)[1]) ? (o.blocker ? { status: 'failed', auto: { blocker: o.blocker } } : { status: 'complete' }) : {}) }
      r = { code: 0, stdout: JSON.stringify({ runId: run }) }
    } else if (args[1] === 'list') r = { code: 0, stdout: JSON.stringify(Object.values(runs)) }
    else if (args[1] === 'stop') { runs[args[2]].status = 'stopped'; r = { code: 0 } }
    setImmediate(() => { if (r.stdout) child.stdout.emit('data', r.stdout); child.emit('close', r.code) })
    return child
  }
  const gitOps = []
  const git = async (args) => {
    if (args.includes('rev-parse')) return { code: 1, stdout: '', stderr: '' }
    // pm's commit step for bridge-claude results (dispatch.mjs commitWorktree)
    if (args[2] === 'status') return { code: 0, stdout: ' M feature.mjs\n', stderr: '' }
    if (args[2] === 'add' || args[2] === 'commit') { gitOps.push(args.slice(2)); return { code: 0, stdout: '', stderr: '' } }
    const wt = args[args.indexOf('add') + 3]
    mkdirSync(wt, { recursive: true }); writeFileSync(join(wt, '.git'), 'gitdir: fake')
    return { code: 0, stdout: '', stderr: '' }
  }
  const checkRuns = []
  const run = async (cmd, { cwd }) => { checkRuns.push({ cmd, cwd }); return { exitCode: 0, stdout: `ok ${cmd}`, stderr: '' } }
  const reviews = []
  const review = reviewFn ?? (async ({ task, verifier, acceptance }) => {
    reviews.push({ task: task.id, verifier: verifier.name })
    const fail = review.failOnce?.has(task.id)
    if (fail) review.failOnce.delete(task.id)
    return fail ? { agent: verifier.name, verdict: 'fail', reason: 'misses the empty-input edge case' }
      : { agent: verifier.name, verdict: 'pass', criteria: acceptance.map((criterion) => ({ criterion, met: true })) }
  })
  review.failOnce = new Set()
  let claude = 97
  const readSnapshot = async () => ({ machine: 'vmixer2o2', quota: { claude: { stale: false, sessionPercent: 10, weekPercent: claude, exhausted: false } } })

  // exactly server.mjs's call, plus the fakes
  const engine = () => createEngine({
    store, ledgerDb: () => bridge.queue?.db ?? null, bridge,
    env: { [ENABLE_ENV]: '1' }, spawn, git, dshHomes, workspaceRoot: join(root, 'runs'), readSnapshot, ceilings: { global: 2 },
    run, review, clock, machines: MACHINES,
    recoveryPolicy: { maxAttempts: 3, backoffBaseSeconds: 10, backoffCapSeconds: 60, ackSeconds: 600, ttlSeconds: 86400 },
  })
  const project = (name) => store.createProject(W, { name })
  const task = (p, title, blitz = {}) => { now += 1000; return store.createTask(W, { project: p.id, title, body: `${title} body`, meta: { repo: join(root, 'src-repo'), blitz: { checks: CHECKS, acceptance: ACCEPT, ...blitz } } }) }
  const approve = (t) => {
    const a = approvals.requestApproval(ledger, {
      kind: 'task_scope', requested_by: 'Claude Opus 5.5', now: new Date(now),
      scope: { project: t.project_id, task_id: t.id, task_rev: t.rev, scope_hash: scopeHash(t), scope: { repo: 'r', branch: 'b', files: ['x'], summary: 's' }, permissions: ['fs_write'], version: 'v1', merge_limit: 'local_commit' },
    })
    return approvals.decideApproval(ledger, a.id, { approver: 'user', method: 'pm_ui', proof: { approver: 'user' }, decision: 'approved', now: new Date(now) })
  }
  /** Claude worker reply on the bridge thread of a submit. */
  const claudeReplies = (text) => {
    for (const m of bridge.queue.messages.filter((x) => x.type === 'submit')) {
      if (bridge.queue.messages.some((x) => x.correlation_id === m.id && x.type === 'result')) continue
      bridge.queue.messages.push({ id: `res-${m.id}`, type: 'result', correlation_id: m.id, from: { agent: 'claude-code', machine: 'ndi2' }, body: { text: typeof text === 'function' ? text(m) : text } })
    }
  }
  const starts = (t) => calls.filter((a) => a[1] === 'start' && a[a.indexOf('--run') + 1].includes(`-${t.id}-a`))
  const submits = (t) => bridge.queue.messages.filter((m) => m.type === 'submit' && m.task === t.id)
  return {
    store, ledger, bridge, registry, root, runs, calls, gitOps, script, hold, checkRuns, reviews, review, engine, project, task, approve, claudeReplies, starts, submits, clock,
    advance: (s) => { now += s * 1000 }, setClaude: (n) => { claude = n },
  }
}

const activeCount = (store) => Number(store.db.prepare("SELECT COUNT(*) AS n FROM blitz_campaign_tasks WHERE state IN ('leased','running')").get().n)

test('composed engine end to end: approvals, deps, ceiling, rate-limit park, reassign, verification, escalation, crash, cancel, report', async () => {
  const w = world()
  const alpha = w.project('alpha'); const beta = w.project('beta'); const gamma = w.project('gamma')
  const A = w.task(alpha, 'A core')
  const B = w.task(alpha, 'B on core', { depends_on: [A.id] })
  const C = w.task(beta, 'C flaky transport')
  const D = w.task(beta, 'D claude writer', { role: 'writer' })
  const E = w.task(alpha, 'E late approval, rework')
  const G = w.task(beta, 'G conflict')
  const H = w.task(gamma, 'H long run (cancelled)')
  for (const t of [A, B, C, D, G, H]) w.approve(t) // E is approved later
  w.script[A.id] = { ok: true }
  w.script[B.id] = { ok: true }
  w.script[C.id] = (n) => (n === 1 ? { blocker: 'ECONNRESET socket hang up' } : { ok: true })
  w.script[E.id] = { ok: true }
  w.script[G.id] = (n) => (n === 1 ? { blocker: 'merge conflict in src/x.mjs' } : { ok: true })
  w.script[H.id] = { ok: true }
  w.hold.add(A.id) // A keeps running until after the crash
  w.hold.add(H.id)
  w.review.failOnce.add(E.id)

  let maxActive = 0
  const pass = async (r) => { const out = await r.runOnce(); maxActive = Math.max(maxActive, activeCount(w.store)); return out }

  // ---------- engine 1 ----------
  const e1 = w.engine()
  const ctl = e1.controller
  const r1 = e1.start({ autoStart: false })
  const row = (t, cid = 'P-1') => ctl.store.task(cid, t.id)

  const c0 = ctl.create(W, { id: 'P-1', title: 'two-project pilot', projects: [alpha.id, beta.id], roster: ['Dee', 'Bo', 'Cleo', 'Vera'] })
  const pf = ctl.preflight(W, c0.id, { rev: c0.rev })
  assert.deepEqual(pf.preflight.problems.map((p) => [p.kind, p.task]), [['approval', E.id]])
  await pass(r1)
  assert.equal(w.calls.length, 0, 'preflighted, not launched: nothing starts')
  ctl.launch(W, c0.id, { rev: pf.rev, authorizedBy: 'user (engine test scope)' })

  // pass 1: global ceiling 2 -> A (Dee) and C (Bo); D deferred (Claude 97%); B waits on A; E not reached.
  // C's run fails at once with a transport error -> recovery reassigns C (per task) away from Bo
  await pass(r1)
  assert.equal(row(A).state, 'running')
  assert.equal(row(A).agent, 'Dee')
  assert.equal(row(C).agent, 'Bo')
  assert.equal(row(C).state, 'escalated')
  assert.equal(row(D).state, 'pending')
  assert.match(row(D).reason, /^deferred: Cleo: quota: claude at 97% used/)
  assert.match(row(B).reason, /^deps: waiting on/)
  assert.equal(w.submits(D).length, 0)
  const decC = ctl.events(c0.id, { task: C.id, kind: 'recovery_decision' }).map((e) => e.data)
  assert.equal(decC[0].class, 'TRANSPORT')
  assert.equal(decC[0].action, 'reassign')
  assert.deepEqual(decC[0].to, ['Dee'], 'only a same-role agent is an alternative')
  await pass(r1) // pump requeues C with avoidAgents [Bo]; Dee (the only other builder) takes it
  assert.deepEqual(row(C).avoid_agents, ['Bo'])
  assert.equal(e1.recovery.holdActive('agent:Bo'), false, 'no global cooldown')

  // E is refused by the approval gate once a slot frees: blocked, and an APPROVAL escalation opens
  for (let i = 0; i < 8 && row(E).state !== 'blocked'; i++) { await pass(r1); w.advance(5) }
  assert.equal(row(E).state, 'blocked')
  assert.match(row(E).reason, /^approval: /)
  const [escE] = await e1.recovery.list({ campaign: c0.id, task: E.id })
  assert.equal(escE.kind, 'APPROVAL')
  w.approve(E) // the ledger approves; an escalation answer never does

  // drive until G hits its conflict and C/E have run
  for (let i = 0; i < 8; i++) { await pass(r1); w.advance(5) }
  assert.equal(e1.recovery.get(escE.id).status, 'superseded')
  assert.equal(row(C).state, 'verified')
  assert.equal(row(C).agent, 'Dee', 'C was reassigned to the other builder')
  assert.equal(w.starts(A).length, 1)
  assert.equal(row(G).state, 'escalated')
  const [escG] = await e1.recovery.list({ campaign: c0.id, task: G.id, status: 'open' })
  assert.equal(escG.kind, 'CONFLICT')
  assert.equal(escG.bridge_state, 'sent')
  assert.ok(w.bridge.queue.messages.some((m) => m.correlation_id === escG.id && m.body?.kind === 'blitz_escalation'))

  // ---------- crash: engine 1 dies with A still running; engine 2 on the same db ----------
  await e1.stop()
  w.advance(1000) // past A's 900 s lease
  const e2 = w.engine()
  const ctl2 = e2.controller
  const r2 = e2.start({ autoStart: false })
  const row2 = (t, cid = 'P-1') => ctl2.store.task(cid, t.id)
  assert.ok(r2.stats().recovered_at_start.find((x) => x.id === 'P-1').reclaimed.includes(A.id))
  await pass(r2) // pump: A lease_expired -> TIMEOUT decision; requeue; re-lease adopts the live run
  await pass(r2)
  assert.equal(ctl2.events(c0.id, { task: A.id, kind: 'recovery_decision' })[0].data.class, 'TIMEOUT')
  assert.equal(w.starts(A).length, 1, 'recovery adopted the live run: no second start')
  assert.ok(row2(A).attempt >= 2)
  assert.equal(row2(A).checkpoint.artifacts[0].adopted_from_attempt, 1)
  w.hold.delete(A.id)
  w.runs[`BLITZ-P-1-${A.id}-a1`].status = 'complete'

  // ---------- escalation answer: relayed over the bridge stays pending until a direct confirm ----------
  w.bridge.queue.messages.push({ id: 'R-G', correlation_id: escG.id, from: { agent: 'chatgpt', machine: 'cloud' }, body: { choice: 'B' } })
  await pass(r2)
  let eg = e2.recovery.get(escG.id)
  assert.equal(eg.answer, 'B')
  assert.equal(eg.answer_state, 'pending_confirm')
  assert.equal(row2(G).state, 'escalated', 'a relayed answer changes nothing')
  eg = await e2.recovery.confirm({ actor: 'user', model: null }, escG.id)
  assert.equal(eg.status, 'resolved')
  assert.equal(eg.applied.action, 'retry')
  assert.equal(row2(G).state, 'pending')

  // ---------- Claude drops to 50%: D is dispatched; its "success" is a quota error -> parked, no retry loop ----------
  w.setClaude(50)
  for (let i = 0; i < 3 && !w.submits(D).length; i++) await pass(r2)
  assert.equal(w.submits(D).length, 1)
  w.claudeReplies("You've hit your usage limit. Try again in 2h")
  await pass(r2)
  assert.equal(row2(D).state, 'escalated')
  assert.equal(ctl2.events(c0.id, { task: D.id, kind: 'quota_as_success' }).length, 1)
  const decD = ctl2.events(c0.id, { task: D.id, kind: 'recovery_decision' }).at(-1).data
  assert.equal(decD.class, 'RATE_LIMIT')
  assert.equal(decD.action, 'park_until_reset')
  for (let i = 0; i < 10; i++) { w.advance(300); await pass(r2) } // 50 min: still inside the reset window
  assert.equal(w.submits(D).length, 1, 'rate limit: no retry before the reset')
  assert.ok(e2.recovery.holdActive('provider:anthropic'))

  // drive everything else to a finish
  for (let i = 0; i < 12; i++) { w.advance(30); await pass(r2) }
  for (const t of [A, B, C, E, G]) assert.equal(row2(t).state, 'verified', `${t.title} verified`)
  assert.equal(row2(B).checkpoint.stage, 'awaiting_verification')
  // E: the first review failed -> TEST_FAILURE requeued exactly once, by recovery
  assert.equal(ctl2.events(c0.id, { task: E.id, kind: 'requeued' }).length, 1)
  assert.equal(row2(E).attempt, 2)
  assert.equal(ctl2.events(c0.id, { task: E.id, kind: 'verification' }).filter((e) => e.data.failed).length, 1)

  // past the reset: D is requeued once and finishes
  w.advance(2 * 3600)
  await pass(r2)
  assert.equal(w.submits(D).length, 2)
  w.claudeReplies('Implemented D: 2 files changed, npm test exit 0')
  await pass(r2)
  await pass(r2)
  assert.equal(row2(D).state, 'verified')
  assert.equal(ctl2.get(c0.id).state, 'completed')

  // independent verification: every verdict by Vera, never by the builder; Vera never leased
  assert.ok(w.reviews.length >= 7)
  assert.ok(w.reviews.every((r) => r.verifier === 'Vera'))
  assert.equal(ctl2.events(c0.id, { kind: 'leased', limit: 5000 }).filter((e) => e.data.agent === 'Vera').length, 0)
  assert.ok(w.checkRuns.every((r) => r.cwd.endsWith(join('', 'repo'))), 'checks run in the per-task worktree')
  assert.ok(maxActive <= 2, `global ceiling held (max ${maxActive})`)

  // ---------- two-phase cancel on a second campaign ----------
  const q0 = ctl2.create(W, { id: 'Q-1', projects: [gamma.id], roster: ['Dee'] })
  const qf = ctl2.preflight(W, q0.id, { rev: q0.rev })
  ctl2.launch(W, q0.id, { rev: qf.rev, authorizedBy: 'user' })
  await pass(r2)
  assert.equal(row2(H, 'Q-1').state, 'running')
  const qc = ctl2.cancel(W, q0.id, { rev: ctl2.get(q0.id).rev, reason: 'user stop' })
  assert.equal(qc.state, 'running', 'phase 1: still running while H holds its lease')
  assert.equal(row2(H, 'Q-1').cancel_requested, true)
  await pass(r2)
  assert.equal(w.runs[`BLITZ-Q-1-${H.id}-a1`].status, 'stopped')
  assert.equal(row2(H, 'Q-1').state, 'cancelled')
  assert.equal(ctl2.get(q0.id).state, 'cancelled')

  // pm committed the bridge-claude writer's (D) changes exactly once, with the trailer; never pushed
  const commits = w.gitOps.filter((o) => o[0] === 'commit')
  assert.ok(commits.length >= 1)
  assert.equal(new Set(commits.map((c) => c[2])).size, commits.length, "at most one commit per attempt")
  assert.match(commits[0][2], new RegExp(`^blitz P-1 ${D.id} a\\d+: D claude writer$`))
  assert.equal(commits[0][4], 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
  assert.ok(!w.gitOps.flat().includes('push'))

  // ---------- final report ----------
  const s = buildStatus(ctl2, c0.id, { guard: e2.guard })
  const md = finalReport(s)
  assert.match(md, /State: completed; authorized by user \(engine test scope\)/)
  assert.match(md, /## Verified \(6\)/)
  for (const t of [A, B, C, D, E, G]) assert.match(md, new RegExp(t.id))
  assert.ok(s.escalations.length >= 3)
  await e2.stop()
})

/** One HTTP request against the test server. */
async function call(base, method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-pm-actor': 'Claude Opus 5.5' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: await res.json() }
}

test('HTTP: campaign, recovery, verify and status routes share one engine', async () => {
  let reviewOn = false
  const w = world({ review: async ({ verifier, acceptance }) => (reviewOn ? { agent: verifier.name, verdict: 'pass', criteria: acceptance.map((criterion) => ({ criterion, met: true })) } : { agent: verifier.name, verdict: 'uncertain', reason: 'review offline' }) })
  const p = w.project('solo')
  const T = w.task(p, 'T single')
  w.approve(T)
  w.script[T.id] = { ok: true }
  w.hold.add(T.id)
  const engine = w.engine()
  engine.start({ autoStart: false })
  const server = createServer(w.store, { blitz: engine })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    let r = await call(base, 'POST', '/api/blitz/campaigns', { id: 'H-1', projects: [p.id], roster: ['Dee', 'Vera'] })
    assert.equal(r.status, 200)
    r = await call(base, 'POST', '/api/blitz/campaigns/H-1/preflight', { rev: r.body.rev })
    r = await call(base, 'POST', '/api/blitz/campaigns/H-1/launch', { rev: r.body.rev, authorizedBy: 'user' })
    assert.equal(r.body.state, 'launched')

    // campaign route tick = recovery tick (pump) + guarded tick
    r = await call(base, 'POST', '/api/blitz/campaigns/H-1/tick', {})
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.dispatched, [T.id])
    assert.ok(r.body.recovery && Array.isArray(r.body.recovery.requeued), 'tick went through recovery.pump')
    assert.ok(r.body.guard, 'tick went through the guard')

    // a worker failure over the campaign route is seen by the recovery route
    r = await call(base, 'POST', `/api/blitz/campaigns/H-1/tasks/${T.id}/failure`, { owner: 'Dee', attempt: 1, error: 'fetch failed ECONNRESET' })
    assert.equal(r.body.task.state, 'escalated')
    r = await call(base, 'GET', '/api/blitz/campaigns/H-1/recovery')
    assert.equal(r.body.tasks[0].class, 'TRANSPORT')
    assert.equal(r.body.tasks[0].state, 'retry_wait')

    // after the backoff, the campaign tick requeues and re-dispatches (attempt 2)
    w.advance(11)
    r = await call(base, 'POST', '/api/blitz/campaigns/H-1/tick', {})
    assert.deepEqual(r.body.recovery.requeued, [T.id])
    assert.deepEqual(r.body.dispatched, [T.id])

    // a quota error reported as a result over REST is a failure (RATE_LIMIT), not a result
    r = await call(base, 'POST', `/api/blitz/campaigns/H-1/tasks/${T.id}/result`, { owner: 'Dee', attempt: 2, result: { summary: 'Error: 429 rate_limit_error, retry-after: 60' } })
    assert.equal(r.body.task.state, 'escalated')
    r = await call(base, 'GET', '/api/blitz/campaigns/H-1/recovery')
    assert.equal(r.body.tasks[0].class, 'RATE_LIMIT')
    w.advance(61)
    r = await call(base, 'POST', '/api/blitz/campaigns/H-1/recovery/tick', {})
    assert.deepEqual(r.body.dispatched, [T.id], 'recovery route tick drives the same controller')

    // the run finishes; the review is offline -> awaiting_verification (fail closed)
    w.hold.delete(T.id)
    w.runs[`BLITZ-H-1-${T.id}-a3`].status = 'complete'
    await engine.runner.runOnce()
    assert.equal(engine.controller.store.task('H-1', T.id).state, 'awaiting_verification')

    // verify route re-verifies through the shared controller; status route sees the result
    reviewOn = true
    r = await call(base, 'POST', `/api/blitz/campaigns/H-1/tasks/${T.id}/verify`, {})
    assert.equal(r.status, 200)
    assert.equal(r.body.task.state, 'verified')
    assert.equal(r.body.campaign.state, 'completed')
    r = await call(base, 'GET', `/api/blitz/campaigns/H-1/evidence?task=${T.id}`)
    assert.equal(r.body.verdicts.at(-1).verdict.verified, true)
    r = await call(base, 'GET', '/api/blitz/campaigns/H-1/monitor')
    assert.equal(r.body.campaign.state, 'completed')
    assert.equal(r.body.counts.verified, 1)
    r = await call(base, 'GET', '/api/blitz/runner')
    assert.ok(r.body.passes >= 1, 'status route reports the engine runner')
  } finally {
    await engine.stop()
    await new Promise((r) => server.close(r))
  }
})
