// node --test "blitz/verify.test.mjs"   (run from pm/)   BLITZ-07, Claude Opus 5.5
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PmError } from '../store.mjs'
import { createVerifier, shellRun, assertNoPush, checksOf, REVIEW_NOT_WIRED } from './verify.mjs'
import { W, world, fakeDispatch, fakeRun, passReview } from './blitz07.fixture.mjs'

const CHECKS = ['npm run lint', 'npm test']
const ACCEPT = ['lint is clean', 'unit tests pass']

/** world whose controller verify is a createVerifier on the same db. */
function vworld({ run = fakeRun(), review = passReview(), agents, dispatch = fakeDispatch(), ...vo } = {}) {
  return world({
    agents,
    deps: (env) => {
      env.run = run
      env.verify = createVerifier({ db: env.store.db, run, review, escalate: env.escalate, clock: env.clock, ...vo })
      return { verify: env.verify, dispatch }
    },
  })
}

async function runOne(env, blitz = { checks: CHECKS, acceptance: ACCEPT }, launchOpts) {
  const t = env.task('feature', blitz)
  env.approve(t)
  const c = env.launch(launchOpts)
  const tick = await env.ctl.tick(W, c.id, {})
  return { t, c, tick, row: env.ctl.store.task(c.id, t.id) }
}

test('pass path through controller tick: verified, evidence recorded, campaign completes', async () => {
  const env = vworld()
  const { t, c, tick, row } = await runOne(env)
  assert.deepEqual(tick.dispatched, [t.id])
  assert.equal(row.state, 'verified')
  const ev = row.verification.evidence
  assert.equal(ev.verifier, 'Vera')
  assert.deepEqual(ev.builders, ['Ada'])
  assert.equal(ev.workspace, `C:\\wt\\${t.id}`)
  assert.deepEqual(ev.checks.map((x) => [x.cmd, x.exit_code, x.cwd]), CHECKS.map((cmd) => [cmd, 0, `C:\\wt\\${t.id}`]))
  assert.match(ev.checks[0].stdout_sha256, /^[0-9a-f]{64}$/)
  assert.ok(ev.checks[0].started_at && ev.checks[0].finished_at)
  assert.match(ev.sha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(env.run.calls.map((x) => x.cwd), [`C:\\wt\\${t.id}`, `C:\\wt\\${t.id}`])
  const trail = env.verify.evidenceOf(c.id, { task: t.id })
  assert.equal(trail.checks.length, 2)
  assert.equal(trail.verdicts.at(-1).verdict.verified, true)
  assert.equal(env.ctl.get(c.id).state, 'completed')
})

test('nonzero exit -> failed with reason; later checks not run', async () => {
  const env = vworld({ run: fakeRun({ 'npm run lint': { exitCode: 2, stdout: '', stderr: 'x.mjs: bad' } }) })
  const { row } = await runOne(env)
  assert.equal(row.state, 'failed')
  assert.match(row.reason, /check check-1 exited 2/)
  assert.equal(env.run.calls.length, 1)
  assert.equal(row.verification.evidence.checks[0].stderr_tail, 'x.mjs: bad')
  assert.ok(env.escalations.some((p) => p.kind === 'verification_failed'))
})

test('missing checks, missing acceptance, UI-only evidence: never verified, stays open', async () => {
  let env = vworld()
  let r = await runOne(env, { acceptance: ACCEPT })
  assert.equal(r.row.state, 'awaiting_verification')
  assert.match(r.row.reason, /no check commands/)
  assert.equal(env.run.calls.length, 0)

  env = vworld()
  r = await runOne(env, { checks: CHECKS })
  assert.equal(r.row.state, 'awaiting_verification')
  assert.match(r.row.reason, /no acceptance criteria/)

  env = vworld({ dispatch: fakeDispatch({ evidence: [{ kind: 'screenshot', path: 'a.png' }] }) })
  r = await runOne(env, { acceptance: ACCEPT })
  assert.equal(r.row.state, 'awaiting_verification')
  assert.match(r.row.reason, /UI-only evidence is not verification/)
  assert.equal(env.ctl.get(r.c.id).state, 'running')
})

test('timeout, missing exit code and runner error stay open (uncertain, not failed)', async () => {
  for (const [res, re] of [
    [{ exitCode: null, stdout: '', stderr: '', timedOut: true }, /timed out/],
    [{ stdout: 'no code' }, /no exit code/],
    [() => { throw new Error('spawn ENOENT') }, /could not run: spawn ENOENT/],
  ]) {
    const env = vworld({ run: fakeRun((cmd) => (typeof res === 'function' ? res() : res)) })
    const { row } = await runOne(env)
    assert.equal(row.state, 'awaiting_verification', String(re))
    assert.match(row.reason, re)
  }
})

test('workspace must be an isolated absolute worktree', async () => {
  for (const [extra, re] of [[{ workspace: null }, /no workspace/], [{ workspace: 'rel/path' }, /not an absolute/], [{ workspace: 'C:\\repos\\app' }, /repo checkout itself/]]) {
    const env = vworld({ dispatch: fakeDispatch(extra) })
    const { row } = await runOne(env)
    assert.equal(row.state, 'awaiting_verification')
    assert.match(row.reason, re)
  }
})

test('same agent built and verified -> refused; no verifier -> escalated, stays open', async () => {
  // review signed by the builder
  let env = vworld({ review: passReview('Ada') })
  let r = await runOne(env)
  assert.equal(r.row.state, 'awaiting_verification')
  assert.match(r.row.reason, /refused: review by Ada, who built the task/)

  // the builder claims to be the verifier in its result
  env = vworld({ dispatch: fakeDispatch({ agent: 'Vera' }) })
  r = await runOne(env)
  assert.equal(r.row.state, 'awaiting_verification')
  assert.match(r.row.reason, /no independent verifier/)

  // roster without a verifier role
  env = vworld()
  r = await runOne(env, undefined, { roster: ['Ada'] })
  assert.equal(r.row.state, 'awaiting_verification')
  assert.match(r.row.reason, /no independent verifier/)
  assert.equal(env.run.calls.length, 0)
  assert.ok(env.escalations.some((p) => p.kind === 'verifier_unavailable' && p.task_id === r.t.id))
  assert.equal(env.ctl.events(r.c.id, { kind: 'verifier_unavailable' }).length, 1)
})

test('review: not wired, fail, uncertain, unassessed criteria', async () => {
  let env = vworld({ review: null })
  let r = await runOne(env)
  assert.equal(r.row.state, 'awaiting_verification')
  assert.match(r.row.reason, new RegExp(REVIEW_NOT_WIRED))

  env = vworld({ review: async () => ({ agent: 'Vera', verdict: 'fail', reason: 'misses edge case' }) })
  r = await runOne(env)
  assert.equal(r.row.state, 'failed')
  assert.match(r.row.reason, /misses edge case/)

  env = vworld({ review: async () => ({ agent: 'Vera', verdict: 'uncertain', reason: 'cannot run UI' }) })
  r = await runOne(env)
  assert.equal(r.row.state, 'awaiting_verification')

  env = vworld({ review: async () => ({ agent: 'Vera', verdict: 'pass', criteria: [{ criterion: ACCEPT[0], met: true }] }) })
  r = await runOne(env)
  assert.equal(r.row.state, 'awaiting_verification')
  assert.match(r.row.reason, /acceptance not assessed: unit tests pass/)

  env = vworld({ review: async () => ({ agent: 'Vera', verdict: 'pass', criteria: [{ criterion: ACCEPT[0], met: true }, { criterion: ACCEPT[1], met: false }] }) })
  r = await runOne(env)
  assert.equal(r.row.state, 'failed')
})

test('reverify after a verifier joins: through the controller, verified, campaign completes', async () => {
  let joined = false
  const env = vworld({ agents: [{ name: 'Ada', role: 'builder', max_concurrent: 2 }], pickVerifier: ({ builders }) => (joined && !builders.has('Vera') ? { name: 'Vera', role: 'verifier' } : null) })
  const { t, c, row } = await runOne(env, undefined, { roster: ['Ada'] })
  assert.equal(row.state, 'awaiting_verification')
  await assert.rejects(env.verify.reverify(W, c.id, t.id), (e) => e instanceof PmError && e.status === 503)
  env.verify.attach(env.ctl)
  env.registry.create(W, { name: 'Vera', role: 'verifier', machine: 'vmixer2o2', transport: 'dsh-run', model_policy: { policy: 'FREE_FIRST' }, max_concurrent: 1 })
  joined = true
  const out = await env.verify.reverify(W, c.id, t.id)
  assert.equal(out.task.state, 'verified')
  assert.equal(out.verdict.verified, true)
  assert.equal(env.ctl.get(c.id).state, 'completed', 'ctl.reverify settles the campaign')
  await assert.rejects(env.ctl.reverify(W, c.id, t.id), (e) => e instanceof PmError && e.status === 409)
  assert.equal(env.ctl.events(c.id, { kind: 'verification' }).filter((e) => e.data.reverify).length, 1)
})

test('level checks fallback from rating.verification.level', () => {
  const t = { meta: JSON.stringify({ blitz: { rating: { verification: { level: 'unit' } } } }) }
  assert.deepEqual(checksOf(t, { unit: ['node --test'] }).map((c) => c.cmd), ['node --test'])
  assert.deepEqual(checksOf(t, {}), [])
  assert.deepEqual(checksOf({ meta: { blitz: { checks: [{ name: 'lint', cmd: 'x', timeoutMs: 5 }] } } }).map((c) => [c.name, c.timeoutMs]), [['lint', 5]])
})

test('shellRun captures real exit codes and timeouts; push is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz07-'))
  try {
    const ok = await shellRun('node -e "console.log(process.cwd())"', { cwd: dir, timeoutMs: 20000 })
    assert.equal(ok.exitCode, 0)
    const bad = await shellRun('node -e "process.exit(3)"', { cwd: dir, timeoutMs: 20000 })
    assert.equal(bad.exitCode, 3)
    const slow = await shellRun('node -e "setTimeout(()=>{}, 20000)"', { cwd: dir, timeoutMs: 300 })
    assert.equal(slow.timedOut, true)
    assert.equal(slow.exitCode, null)
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
  assert.throws(() => shellRun('git push origin main', {}), (e) => e instanceof PmError && e.status === 403)
  assert.throws(() => assertNoPush(['push', '--force']), /never pushes/)
  assert.doesNotThrow(() => assertNoPush('npm run pushover-lint'))
})
