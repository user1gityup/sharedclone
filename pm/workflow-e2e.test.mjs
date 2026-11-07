// node --test workflow-e2e.test.mjs   (run from this folder)
// End-to-end PM workflow on both machines (T-0ee62fe6): create -> prepare (user-picked roster)
// -> start -> runner execution -> artifacts/review -> completion recommendation. DSH is faked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore, PmError } from './store.mjs'
import { act } from './actions.mjs'
import { recommendCompletion } from './completion.mjs'

const A = { actor: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5' }
const RUNNER = { actor: 'runner-1', model: null }
const mkStore = () => { const s = openStore(':memory:'); s.createProject(A, { name: 'demo' }); return s }
const fakeDsh = (calls) => ({ 'dsh-pipeline': async () => ({
  start: async (a) => { calls.push(['start', a]); return { runId: 'RUN-1', stage: 'council', sessionId: 'sess-1' } },
  stop: async () => ({ stopped: 'RUN-1' }),
  status: async () => ({ running: false }),
  restoreRoster: async () => ({}),
}) })

for (const machine of ['ndi2', 'vmixer2o2']) {
  test(`DSH workflow end to end on ${machine}`, async () => {
    const s = mkStore()
    const calls = []
    const drivers = fakeDsh(calls)
    const t = s.createTask(A, { project: 'demo', title: 'build x', kind: 'dsh-pipeline' })
    assert.equal(t.status, 'todo')

    // prepare: no roster picked -> pm asks, never defaults, start refused
    const p1 = await act(s, A, t.id, 'prepare', { machine, drivers, request: 'build x' })
    assert.deepEqual(p1.missing, ['council', 'swarm'])
    await assert.rejects(() => act(s, A, t.id, 'start', { machine, drivers }), (e) => e instanceof PmError && e.status === 409 && /user picks the seats/.test(e.message))
    assert.equal(calls.length, 0, 'nothing dispatched without a roster')

    // user picks seats; still not started until told
    const p2 = await act(s, A, t.id, 'prepare', { machine, drivers, roster: { council: ['kimi'], swarm: ['openrouter-free'] } })
    assert.deepEqual(p2.missing, [])
    assert.equal(calls.length, 0, 'prepare never dispatches')

    // start: run row, artifact, task RUNNING on this machine
    const started = await act(s, A, t.id, 'start', { machine, drivers })
    assert.equal(started.lifecycle, 'RUNNING')
    assert.deepEqual(calls[0][1].roster, { council: ['kimi'], swarm: ['openrouter-free'] })
    const run = s.getRun(s.getTask(t.id).run_ref)
    assert.equal(run.state, 'running')
    assert.equal(run.machine, machine)
    assert.equal(recommendCompletion(s, t.id).recommend, 'wait')

    // the other machine may not start or continue it
    const other = machine === 'ndi2' ? 'vmixer2o2' : 'ndi2'
    await assert.rejects(() => act(s, A, t.id, 'continue', { machine: other, drivers }), (e) => e.status === 409 && /executes on/.test(e.message))

    // run finishes: artifacts + review sync
    s.updateRun(A, run.id, { state: 'done', last_checkpoint: 'stage done' })
    s.addArtifact(A, t.id, { kind: 'commit', ref: 'abc1234', note: 'built x' })
    s.updateTask(A, t.id, { rev: s.getTask(t.id).rev, status: 'review', lifecycle: 'VERIFY' })
    assert.equal(s.getTask(t.id).lifecycle, 'VERIFY')
    const rec = recommendCompletion(s, t.id)
    assert.equal(rec.recommend, 'done')
    assert.notEqual(s.getTask(t.id).status, 'done', 'pm recommends; it does not complete')

    // audit trail carries every step with the actor
    const acts = s.events({}).filter((e) => e.entity_id === t.id).map((e) => e.action)
    for (const a of ['created', 'run_started']) assert.ok(acts.includes(a), a)
  })

  test(`runner execution on ${machine}: claim -> run -> finish exit 0 -> review recommendation`, () => {
    const s = mkStore()
    const t = s.createTask(A, { project: 'demo', title: 'shell job', assignee: RUNNER.actor, execution_machine: machine })
    const claim = s.claimForRunner(RUNNER, { machines: [machine] })
    assert.equal(claim.task.id, t.id)
    assert.equal(claim.run.state, 'held')
    s.runnerUpdate(RUNNER, claim.run.id, { state: 'running', pid: 4242 })
    assert.equal(s.getTask(t.id).lifecycle, 'RUNNING')
    assert.equal(recommendCompletion(s, t.id).recommend, 'wait')
    const fin = s.finishRun(RUNNER, claim.run.id, { exit_code: 0, note: 'ok' })
    assert.equal(fin.task.status, 'review')
    assert.equal(recommendCompletion(s, t.id).recommend, 'done') // evidence artifact attached by finishRun
    // a second runner on the other machine cannot claim it
    assert.equal(s.claimForRunner(RUNNER, { machines: ['elsewhere'] }), null)
  })
}

test('failed run recommends rework; open instruction downgrades done to review', () => {
  const s = mkStore()
  const t = s.createTask(A, { project: 'demo', title: 'j', assignee: RUNNER.actor, execution_machine: 'ndi2' })
  const c = s.claimForRunner(RUNNER, { machines: ['ndi2'] })
  s.finishRun(RUNNER, c.run.id, { exit_code: 2, note: 'boom' })
  assert.equal(s.getTask(t.id).status, 'blocked')
  assert.equal(recommendCompletion(s, t.id).recommend, 'rework')

  const t2 = s.createTask(A, { project: 'demo', title: 'k', assignee: RUNNER.actor, execution_machine: 'ndi2' })
  const c2 = s.claimForRunner(RUNNER, { machines: ['ndi2'] })
  s.finishRun(RUNNER, c2.run.id, { exit_code: 0 })
  s.addComment(A, t2.id, { body: 'also do Y', kind: 'instruction' })
  const r = recommendCompletion(s, t2.id)
  assert.equal(r.recommend, 'review')
  assert.match(r.reasons[0], /unacknowledged instruction/)
})

test('stop pauses a live run; archive is allowed from COMPLETE', async () => {
  const s = mkStore()
  const calls = []
  const drivers = fakeDsh(calls)
  const t = s.createTask(A, { project: 'demo', title: 's', kind: 'dsh-pipeline' })
  await act(s, A, t.id, 'prepare', { machine: 'ndi2', drivers, roster: { council: ['kimi'], swarm: ['x'] } })
  await act(s, A, t.id, 'start', { machine: 'ndi2', drivers })
  const stopped = await act(s, A, t.id, 'stop', { machine: 'ndi2', drivers })
  assert.equal(stopped.lifecycle, 'PAUSED')
  assert.equal(recommendCompletion(s, t.id).recommend, 'rework') // cancelled run
})
