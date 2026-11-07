// node --test blitz/pilot.test.mjs   (run from pm/)   BLITZ-08, Claude Opus 5.5
// Controlled end-to-end pilot, in authorized TEST scope only: real controller, guard, dispatcher,
// adapters, poller, runner and status/report code on an in-memory pm store, with a fake spawn
// (dsh-run), a fake bridge (Claude worker), a fake git runner and a fake verifier. Nothing real
// is launched. Six tasks across two projects, two agents (one quota-limited), one failing task,
// one cancelled task. Proves: approvals, dependency order, concurrency ceiling, quota refusal,
// no duplicate dispatch on retry, recovery after a simulated crash (new controller on the same
// db + recoverAll), two-phase cancel, and the final report.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, PmError } from '../store.mjs'
import * as approvals from '../approvals.mjs'
import { scopeHash } from './gate.mjs'
import { createAgentRegistry } from './agents.mjs'
import { createBlitzEngine, dshRunAdapter, bridgeClaudeAdapter, ENABLE_ENV } from './dispatch.mjs'
import { startRunner } from './runner.mjs'
import { buildStatus, finalReport } from './status.mjs'
import { statusRoutes } from './status-routes.mjs'

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const T0 = Date.parse('2026-10-25T18:00:00Z')
const MACHINES = new Set(['vmixer2o2', 'ndi2'])
const ACTIVE = ['leased', 'running']

function fakeSpawn(handler) {
  const calls = []
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = { end() {} }; child.pid = 1
    const r = handler(cmd, args, opts) ?? {}
    setImmediate(() => { if (r.stdout) child.stdout.emit('data', r.stdout); child.emit('close', r.code ?? 0) })
    return child
  }
  return { spawn, calls }
}

function world() {
  let now = T0
  const clock = () => new Date(now)
  const advance = (s) => { now += s * 1000 }
  const store = openStore(':memory:', { clock })
  const ledger = new DatabaseSync(':memory:')
  approvals.migrate(ledger)
  const registry = createAgentRegistry(store.db, { store, machines: MACHINES, clock })
  registry.create(W, { name: 'Dee', role: 'builder', machine: 'vmixer2o2', transport: 'dsh-run', model_policy: { policy: 'FIXED_ROSTER', allow: ['deepseek', 'kimi'] }, max_concurrent: 2 })
  registry.create(W, { name: 'Cleo', role: 'reviewer', machine: 'ndi2', transport: 'bridge-claude', model_policy: { policy: 'SUBSCRIPTION_FIRST', pin: 'claude-opus-5-5' }, max_concurrent: 1 })
  const root = mkdtempSync(join(tmpdir(), 'blitz08-pilot-'))
  const lane = join(root, 'lane-dee')
  mkdirSync(lane)
  writeFileSync(join(lane, 'settings.yaml'), 'council:\n  swarmRoster: {}\n')

  // --- fakes ---
  const runs = {}
  const sp = fakeSpawn((cmd, args) => {
    const run = args[args.indexOf('--run') + 1]
    if (args[1] === 'start') { runs[run] = { runId: run, status: 'running' }; return { code: 0, stdout: JSON.stringify({ runId: run }) } }
    if (args[1] === 'list') return { code: 0, stdout: JSON.stringify(Object.values(runs)) }
    if (args[1] === 'stop') { runs[args[2]].status = 'stopped'; return { code: 0 } }
    return { code: 9 }
  })
  const gitCalls = []
  const git = async (args) => {
    gitCalls.push(args)
    if (args.includes('rev-parse')) return { code: 1, stdout: '', stderr: '' }
    const wt = args[args.indexOf('add') + 3]
    mkdirSync(wt, { recursive: true }); writeFileSync(join(wt, '.git'), 'gitdir: fake')
    return { code: 0, stdout: '', stderr: '' }
  }
  const bridgeSent = []
  const bridgeThread = []
  const bridge = {
    submit: (e) => { const dup = bridgeSent.some((x) => x.dedupe_key === e.dedupe_key); if (!dup) bridgeSent.push(e); return { id: e.id, duplicate: dup } },
    thread: (id) => bridgeThread.filter((m) => m.correlation_id === id),
    cancel: (e) => bridgeSent.push(e),
  }
  let claudeWeek = 97
  const readSnapshot = async () => ({ machine: 'vmixer2o2', quota: { claude: { stale: false, sessionPercent: 20, weekPercent: claudeWeek, exhausted: false } } })
  const verified = []
  const verify = async (task, result) => { verified.push(task.id); return { verified: true, evidence: { branch: result.branch, tests: 'fake verifier: 3/3' } } }
  const env = { [ENABLE_ENV]: '1' }

  const engine = () => createBlitzEngine({
    store, ledgerDb: () => ledger, registry, env, clock, readSnapshot, verify, ceilings: { global: 2 }, workspaceRoot: root, git,
    adapters: {
      'dsh-run': dshRunAdapter({ spawn: sp.spawn, env, dshHomes: { Dee: lane }, cli: 'dsh-run.mjs', node: 'node' }),
      'bridge-claude': bridgeClaudeAdapter({ bridge }),
    },
  })

  const projects = [store.createProject(W, { name: 'alpha' }), store.createProject(W, { name: 'beta' })]
  const task = (p, title, blitz, body = `${title} body`) => { now += 1000; return store.createTask(W, { project: p.id, title, body, meta: { repo: join(root, 'src-repo'), blitz } }) }
  const approve = (t) => {
    const a = approvals.requestApproval(ledger, {
      kind: 'task_scope', requested_by: 'Claude Opus 5.5', now: new Date(now),
      scope: { project: t.project_id, task_id: t.id, task_rev: t.rev, scope_hash: scopeHash(t), scope: { repo: 'r', branch: 'b', files: ['x'], summary: 's' }, permissions: ['fs_write'], version: 'v1', merge_limit: 'local_commit' },
    })
    return approvals.decideApproval(ledger, a.id, { approver: 'user', method: 'pm_ui', proof: { approver: 'user' }, decision: 'approved', now: new Date(now) })
  }
  return { store, ledger, registry, root, lane, runs, sp, gitCalls, bridgeSent, bridgeThread, verified, engine, projects, task, approve, clock, advance, setClaudeWeek: (n) => { claudeWeek = n } }
}

const activeCount = (store) => Number(store.db.prepare(`SELECT COUNT(*) AS n FROM blitz_campaign_tasks WHERE state IN ('leased','running')`).get().n)

test('BLITZ-08 controlled pilot: 6 tasks, 2 projects, 2 agents, quota, failure, crash recovery, cancel, report', async () => {
  const w = world()
  const [alpha, beta] = w.projects
  const A = w.task(alpha, 'A build core', { role: 'builder' }, 'Build the core. PM_TOKEN=hunter2hunter2 must not leak.')
  const B = w.task(alpha, 'B build on core', { role: 'builder', depends_on: [A.id] })
  const C = w.task(beta, 'C flaky build', { role: 'builder' })
  const D = w.task(beta, 'D review', { role: 'reviewer' })
  const E = w.task(beta, 'E needs C', { role: 'builder', depends_on: [C.id] })
  const F = w.task(alpha, 'F late approval', { role: 'builder' })
  for (const t of [A, B, C, D, E]) w.approve(t) // F is approved later
  const starts = () => w.sp.calls.filter((c) => c.args[1] === 'start')
  let maxActive = 0
  const pass = async (r) => { const out = await r.runOnce(); maxActive = Math.max(maxActive, activeCount(w.store)); return out }

  // --- engine 1 ---
  const e1 = w.engine()
  const ctl = e1.controller
  const r1 = startRunner({ controller: ctl, poller: e1.poller, guard: e1.guard, autoStart: false })
  await pass(r1)
  assert.equal(w.sp.calls.length, 0, 'no campaign: the runner does nothing')

  const c0 = ctl.create(W, { id: 'PILOT-1', title: 'BLITZ-08 pilot', projects: [alpha.id, beta.id], roster: ['Dee', 'Cleo'] })
  const pf = ctl.preflight(W, c0.id, { rev: c0.rev })
  assert.deepEqual(pf.preflight.waves.map((x) => x.length), [4, 2])
  assert.deepEqual(pf.preflight.problems.map((p) => [p.kind, p.task]), [['approval', F.id]])
  await pass(r1)
  assert.equal(w.sp.calls.length, 0, 'preflighted but not launched: still nothing')
  assert.throws(() => ctl.launch(W, c0.id, { rev: pf.rev }), (e) => e instanceof PmError && e.status === 400 && /authoriz/.test(e.message))
  ctl.launch(W, c0.id, { rev: pf.rev, authorizedBy: 'user (BLITZ-08 pilot, test scope)' })

  // pass 1: A and C start (builder; the global ceiling 2 fills); D deferred on Claude quota;
  // B and E wait on deps; F (unapproved) is never reached because the roster is full
  await pass(r1)
  const row = (t) => ctl.store.task(c0.id, t.id)
  assert.deepEqual([A, C].map((t) => row(t).state), ['running', 'running'])
  assert.equal(starts().length, 2)
  assert.equal(row(D).state, 'pending')
  assert.match(row(D).reason, /^deferred: Cleo: quota: claude at 97% used \(stop at 95%/)
  assert.equal(row(F).state, 'pending')
  assert.match(row(B).reason, /^deps: waiting on/)
  assert.match(row(E).reason, /^deps: waiting on/)
  assert.equal(w.bridgeSent.length, 0, 'quota-limited Claude agent got nothing')
  const startA = starts().find((c) => c.args.includes(`BLITZ-PILOT-1-${A.id}-a1`))
  assert.equal(startA.opts.env.DSH_HOME, w.lane)
  assert.deepEqual(startA.args.slice(3, 9), ['--out', join(w.root, 'PILOT-1', A.id, 'repo'), '--run', `BLITZ-PILOT-1-${A.id}-a1`, '--auto', '--max-attempts'])
  const brief = readFileSync(join(w.root, 'PILOT-1', A.id, 'BRIEF.md'), 'utf8')
  assert.match(brief, /seats: deepseek, kimi/)
  assert.doesNotMatch(brief, /hunter2/)
  assert.ok(w.gitCalls.some((g) => g.includes('worktree') && g.includes(`blitz/PILOT-1/${A.id}`)))

  // retry: more passes and a direct REST-style tick start nothing twice
  await pass(r1)
  await ctl.tick(W, c0.id)
  assert.equal(starts().length, 2, 'no duplicate dispatch on retry')
  assert.equal(activeCount(w.store), 2)

  // --- simulated crash: drop engine 1, lose the leases, boot engine 2 on the same db ---
  await r1.stop()
  w.advance(1000) // past the 900 s lease
  const e2 = w.engine()
  const ctl2 = e2.controller
  const r2 = startRunner({ controller: ctl2, poller: e2.poller, guard: e2.guard, autoStart: false })
  assert.deepEqual(r2.stats().recovered_at_start.map((x) => x.reclaimed.sort()), [[A.id, C.id].sort()])
  assert.equal(ctl2.store.task(c0.id, A.id).state, 'pending')
  await pass(r2)
  assert.equal(starts().length, 2, 'recovery adopted the live runs instead of starting new ones')
  const cpA = ctl2.store.task(c0.id, A.id).checkpoint
  assert.equal(ctl2.store.task(c0.id, A.id).attempt, 2)
  assert.equal(cpA.artifacts[0].adopted_from_attempt, 1)
  assert.equal(cpA.artifacts[0].ref, `BLITZ-PILOT-1-${A.id}-a1`)

  // runs finish: A complete, C failed; Claude quota drops to 50%
  w.advance(600)
  w.runs[`BLITZ-PILOT-1-${A.id}-a1`].status = 'complete'
  w.runs[`BLITZ-PILOT-1-${C.id}-a1`].status = 'failed'
  w.setClaudeWeek(50)
  await pass(r2) // poll: A verified, C failed
  assert.equal(ctl2.store.task(c0.id, A.id).state, 'verified')
  assert.equal(ctl2.store.task(c0.id, C.id).state, 'failed')
  assert.deepEqual(w.verified, [A.id])

  // tick: E blocked (dependency C failed); D -> Cleo; F refused by the approval gate; B (deps met) -> Dee
  await pass(r2)
  const row2 = (t) => ctl2.store.task(c0.id, t.id)
  assert.match(row2(E).reason, /^deps: dependency .* is failed/)
  assert.equal(row2(D).state, 'running')
  assert.equal(row2(D).agent, 'Cleo')
  assert.equal(row2(F).state, 'blocked')
  assert.match(row2(F).reason, /^approval: /)
  assert.equal(row2(B).state, 'running')
  assert.equal(row2(B).agent, 'Dee')
  assert.equal(w.bridgeSent.length, 1)
  assert.equal(w.bridgeSent[0].type, 'submit')
  assert.deepEqual(w.bridgeSent[0].to, { machine: 'ndi2', agent: 'claude-code' })
  assert.equal(w.bridgeSent[0].body.cwd, join(w.root, 'PILOT-1', D.id, 'repo'))
  assert.equal(starts().length, 3)
  await pass(r2)
  assert.equal(w.bridgeSent.length, 1, 'bridge submit not repeated')
  assert.equal(starts().length, 3)

  // D's Claude worker answers over the bridge; B's run completes
  w.advance(300)
  w.bridgeThread.push({ id: 'res-1', type: 'result', correlation_id: w.bridgeSent[0].id, body: { text: 'reviewed, 0 findings' } })
  w.runs[`BLITZ-PILOT-1-${B.id}-a1`].status = 'complete'
  await pass(r2)
  assert.equal(row2(D).state, 'verified')
  assert.equal(row2(B).state, 'verified')
  assert.equal(row2(F).state, 'blocked', 'still unapproved: never dispatched')

  // the user approves F: the next tick leases and starts it
  w.approve(w.store.getTask(F.id))
  await pass(r2)
  assert.equal(row2(F).state, 'running')
  assert.equal(starts().length, 4)
  w.advance(900 - 60)
  await pass(r2) // heartbeat
  w.advance(120)
  await pass(r2)
  assert.equal(row2(F).state, 'running', 'heartbeats kept the lease alive past the original 900 s')
  const mid = buildStatus(ctl2, c0.id, { guard: e2.guard, clock: w.clock })
  const etaF = mid.eta.tasks.find((x) => x.task_id === F.id)
  assert.equal(etaF.basis, 'measured')
  assert.match(etaF.eta.utc, /^2026-10-25T\d\d:\d\d:\d\dZ$/)
  assert.match(etaF.eta.pacific, /PDT$/)
  assert.equal(mid.eta.overall.basis, 'measured')
  assert.equal(mid.eta.overall.measured_tasks, 3)

  // --- two-phase cancel while F runs ---
  const cur = ctl2.get(c0.id)
  const after = ctl2.cancel(W, c0.id, { rev: cur.rev, reason: 'pilot: stop F' })
  assert.equal(after.state, 'running', 'phase 1: F still holds its lease')
  assert.equal(row2(F).cancel_requested, true)
  assert.equal(row2(E).state, 'cancelled', 'idle tasks cancel at once')
  await pass(r2) // phase 2: the poller stops F's run and acks
  assert.equal(w.runs[`BLITZ-PILOT-1-${F.id}-a1`].status, 'stopped')
  assert.equal(row2(F).state, 'cancelled')
  assert.equal(ctl2.get(c0.id).state, 'cancelled')
  assert.ok(maxActive <= 2, `concurrency ceiling held (max ${maxActive})`)
  assert.equal(w.sp.calls.filter((c) => c.args[1] === 'stop').length, 1)

  // --- monitoring + final report ---
  const s = buildStatus(ctl2, c0.id, { guard: e2.guard, clock: w.clock })
  assert.deepEqual(s.counts, { verified: 3, failed: 1, cancelled: 2 })
  assert.equal(s.throughput.basis, 'measured')
  assert.ok(s.throughput.verified_per_hour > 0)
  assert.equal(s.eta.overall.basis, 'measured')
  assert.deepEqual(Object.keys(s.per_agent).sort(), ['Cleo', 'Dee', 'unassigned']) // E was never leased
  assert.deepEqual(Object.keys(s.per_machine).sort(), ['ndi2', 'unassigned', 'vmixer2o2'])
  assert.equal(s.per_model['deepseek+kimi'].tasks, 4)
  assert.equal(s.per_model['claude-opus-5-5'].tasks, 1)
  assert.equal(s.quota.snapshot.quota.claude.weekPercent, 50)
  assert.equal(s.cost.unrated_attempts > 0, true)
  assert.match(s.cost.note, /unknown, not zero/)
  assert.deepEqual(s.waves.map((x) => x.tasks), [4, 2])
  assert.ok(s.escalations.some((x) => x.problem.kind === 'task_failed' && x.task_id === C.id))
  assert.ok(s.escalations.some((x) => x.problem.kind === 'dependency_failed' && x.task_id === E.id))
  const md = finalReport(s)
  if (process.env.BLITZ_PILOT_PRINT === '1') console.log(md, JSON.stringify(s.eta.overall), JSON.stringify(s.throughput))
  const section = (title) => md.split(`## ${title}`)[1].split('\n## ')[0]
  for (const t of [A, B, D]) assert.match(section('Verified'), new RegExp(t.id))
  assert.match(section('Verified'), new RegExp(`branch: blitz/PILOT-1/${A.id}`))
  assert.match(section('Verified'), /fake verifier: 3\/3/)
  assert.match(section('Failed'), new RegExp(C.id))
  assert.match(section('Cancelled'), new RegExp(`${E.id}[\\s\\S]*|${F.id}`))
  assert.match(section('Cancelled'), new RegExp(F.id))
  assert.match(section('Unverified'), /- none/)
  assert.match(md, /Throughput \(measured\): [\d.]+ verified tasks\/hour/)

  // routes serve the same over HTTP-shaped handlers
  const routes = statusRoutes({ controller: ctl2, guard: e2.guard, runner: () => r2, clock: w.clock })
  const call = (path) => { for (const [m, re, h] of routes) { const x = m === 'GET' && re.exec(path); if (x) return h(x, {}, W, {}) } return null }
  assert.equal(call('/api/blitz/campaigns/PILOT-1/monitor').counts.verified, 3)
  assert.match(call('/api/blitz/campaigns/PILOT-1/report').markdown, /# Blitz campaign PILOT-1/)
  assert.equal(call('/api/blitz/monitor')[0].id, 'PILOT-1')
  assert.ok(call('/api/blitz/runner').passes > 0)
  await r2.stop()
  rmSync(w.root, { recursive: true, force: true })
})

test('pilot guard: dispatch refused end to end when BLITZ_DISPATCH_ENABLED is unset', async () => {
  const w = world()
  const A = w.task(w.projects[0], 'A', { role: 'builder' })
  w.approve(A)
  const e = createBlitzEngine({
    store: w.store, ledgerDb: () => w.ledger, registry: w.registry, env: {}, clock: w.clock, readSnapshot: async () => null, ceilings: { global: 2 }, workspaceRoot: w.root,
    git: async () => assert.fail('git must not run'),
    adapters: { 'dsh-run': dshRunAdapter({ spawn: w.sp.spawn, env: {}, dshHomes: { Dee: w.lane }, cli: 'c', node: 'n' }) },
  })
  const c = e.controller.create(W, { projects: [w.projects[0].id], roster: ['Dee'] })
  const pf = e.controller.preflight(W, c.id, { rev: c.rev })
  e.controller.launch(W, c.id, { rev: pf.rev, authorizedBy: 'user (test scope)' })
  const r = startRunner({ controller: e.controller, poller: e.poller, guard: e.guard, autoStart: false })
  await r.runOnce()
  assert.equal(w.sp.calls.length, 0)
  const t = e.controller.store.task(c.id, A.id)
  assert.equal(t.state, 'failed')
  assert.match(t.reason, /BLITZ_DISPATCH_ENABLED=1 is not set/)
  await r.stop()
  rmSync(w.root, { recursive: true, force: true })
})

test('runner: interval timer drives passes and stop() halts them', async () => {
  const w = world()
  const e = w.engine()
  const ticks = []
  const timers = { setInterval: (fn, ms) => { ticks.push({ fn, ms }); return { unref() {} } }, clearInterval: () => { ticks.length = 0 } }
  const r = startRunner({ controller: e.controller, poller: e.poller, guard: e.guard, intervalMs: 5000, timers })
  assert.equal(ticks[0].ms, 5000)
  ticks[0].fn()
  await r.runOnce()
  assert.ok(r.stats().passes >= 1)
  await r.stop()
  assert.equal(ticks.length, 0)
  assert.deepEqual(await r.runOnce(), [])
  rmSync(w.root, { recursive: true, force: true })
})

