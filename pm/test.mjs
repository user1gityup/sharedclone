// node --test test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStore, PmError } from './store.mjs'
import { createServer } from './server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const A = { actor: 'Claude Opus 5', model: 'claude-opus-5' }
const B = { actor: 'GPT-6', model: 'gpt-6' }

function fresh(clock) {
  const s = openStore(':memory:', clock ? { clock } : undefined)
  const p = s.createProject(A, { name: 'demo' })
  return { s, p }
}
const rejects = (fn, status) => assert.throws(fn, (e) => e instanceof PmError && e.status === status)

test('every change is attributed with actor and model', () => {
  const { s, p } = fresh()
  const t = s.createTask(A, { project: 'demo', title: 'one' })
  assert.equal(t.project_id, p.id)
  const h = s.getTask(t.id).history
  assert.equal(h[0].actor, 'Claude Opus 5')
  assert.equal(h[0].model, 'claude-opus-5')
  rejects(() => s.createTask({}, { project: 'demo', title: 'x' }), 400)
})

test('concurrent edit: second save is rejected with 409 and the rejected content returned', () => {
  const { s } = fresh()
  const t = s.createTask(A, { project: 'demo', title: 'one' })
  s.updateTask(A, t.id, { rev: t.rev, body: 'A wrote this' })
  try {
    s.updateTask(B, t.id, { rev: t.rev, body: 'B wrote this' })
    assert.fail('expected conflict')
  } catch (e) {
    assert.equal(e.status, 409)
    assert.equal(e.extra.rejected.body, 'B wrote this')
    assert.equal(e.extra.current.body, 'A wrote this')
  }
  assert.equal(s.getTask(t.id).body, 'A wrote this')
})

test('contested claim: only the holder may heartbeat or release', () => {
  const { s } = fresh()
  const t = s.createTask(A, { project: 'demo', title: 'one' })
  const c = s.claimTask(A, t.id)
  assert.equal(c.claimed_by, 'Claude Opus 5')
  assert.equal(c.status, 'in_progress')
  rejects(() => s.claimTask(B, t.id), 409)
  rejects(() => s.heartbeat(B, t.id), 409)
  rejects(() => s.releaseTask(B, t.id), 409)
  s.heartbeat(A, t.id)
  const r = s.releaseTask(A, t.id, { status: 'review', brief: 'tests pass; next: review diff' })
  assert.equal(r.status, 'review')
  assert.equal(r.claimed_by, null)
  assert.equal(s.getTask(t.id).artifacts[0].kind, 'brief')
})

test('expired lease becomes uncertain, not failed, and is recorded', () => {
  let now = new Date('2026-09-16T12:00:00Z')
  const { s } = fresh(() => now)
  const t = s.createTask(A, { project: 'demo', title: 'one' })
  s.claimTask(A, t.id, { leaseSeconds: 60 })
  assert.deepEqual(s.reconcile(), [])
  now = new Date('2026-09-16T12:01:01Z')
  assert.deepEqual(s.reconcile(), [t.id])
  const after = s.getTask(t.id)
  assert.equal(after.status, 'uncertain')
  assert.equal(after.claimed_by, null)
  assert.equal(after.history.at(-1).action, 'lease_expired')
  assert.equal(after.history.at(-1).data.holder, 'Claude Opus 5')
})

test('claim next: priority order, and two workers never get the same task', () => {
  const { s } = fresh()
  s.createTask(A, { project: 'demo', title: 'low', priority: 3 })
  const high = s.createTask(A, { project: 'demo', title: 'high', priority: 1 })
  const first = s.claimNext(A, { project: 'demo' })
  const second = s.claimNext(B, { project: 'demo' })
  assert.equal(first.id, high.id)
  assert.notEqual(second.id, first.id)
  assert.equal(s.claimNext(B, { project: 'demo' }), null)
})

test('comments and instructions are distinct; instructions are acknowledged once', () => {
  const { s } = fresh()
  const t = s.createTask(A, { project: 'demo', title: 'one' })
  s.addComment(B, t.id, { body: 'looks fine' })
  const i = s.addComment(B, t.id, { body: 'use port 4480', kind: 'instruction' })
  assert.equal(s.getTask(t.id).comments.map((c) => c.kind).join(), 'comment,instruction')
  assert.equal(s.ackInstruction(A, i.id).acked_by, 'Claude Opus 5')
  rejects(() => s.ackInstruction(A, i.id), 409)
})

test('backup, drop, restore: all data present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-test-'))
  try {
    const s = openStore(join(dir, 'pm.db'))
    s.createProject(A, { name: 'demo' })
    const t = s.createTask(A, { project: 'demo', title: 'survives' })
    s.backup(join(dir, 'backup.db'))
    s.close()
    rmSync(join(dir, 'pm.db'))
    const restored = openStore(join(dir, 'backup.db'))
    assert.equal(restored.getTask(t.id).title, 'survives')
    restored.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('task list with 1,000 tasks returns in under 200 ms', () => {
  const { s } = fresh()
  for (let i = 0; i < 1000; i++) s.createTask(A, { project: 'demo', title: `task ${i}`, priority: (i % 3) + 1 })
  const start = performance.now()
  const rows = s.listTasks({ project: 'demo', q: 'task 9' })
  const ms = performance.now() - start
  assert.ok(rows.length > 0)
  assert.ok(ms < 200, `took ${ms} ms`)
})

async function withServer(fn) {
  const store = openStore(':memory:')
  const server = createServer(store)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.close()
    store.close()
  }
}

test('REST: actor required, conflict body carries rejected edit, UI served', async () => {
  await withServer(async (base) => {
    const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    assert.equal((await post('/api/projects', { name: 'x' })).status, 400)
    assert.equal((await post('/api/projects', { name: 'x' }, { 'x-pm-actor': 'me' })).status, 200)
    const t = await (await post('/api/tasks', { project: 'x', title: 'y', actor: 'me' })).json()
    const patch = (body) => fetch(`${base}/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-pm-actor': 'me' }, body: JSON.stringify(body) })
    assert.equal((await patch({ rev: 1, title: 'first' })).status, 200)
    const conflict = await patch({ rev: 1, title: 'second' })
    assert.equal(conflict.status, 409)
    assert.equal((await conflict.json()).rejected.title, 'second')
    const html = await fetch(base + '/')
    assert.match(await html.text(), /<title>Project Manager<\/title>/)
  })
})

test('MCP over stdio: initialize, list tools, create and claim a task', async () => {
  await withServer(async (base) => {
    const child = spawn(process.execPath, [join(HERE, 'cli.mjs'), 'mcp'], { env: { ...process.env, PM_URL: base, PM_TOKEN: '' } })
    const replies = new Map()
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i))
        buf = buf.slice(i + 1)
        replies.get(msg.id)?.(msg)
      }
    })
    let next = 1
    const rpc = (method, params) => new Promise((resolve) => {
      const id = next++
      replies.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
    const tool = async (name, args) => {
      const r = await rpc('tools/call', { name, arguments: { actor: 'Claude Opus 5', model: 'claude-opus-5', ...args } })
      return { ...r.result, data: JSON.parse(r.result.content[0].text) }
    }
    try {
      assert.equal((await rpc('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name, 'pm')
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      const names = (await rpc('tools/list')).result.tools.map((t) => t.name)
      assert.ok(names.includes('pm_claim_next'))
      await tool('pm_create_project', { name: 'mcp' })
      const t = (await tool('pm_create_task', { project: 'mcp', title: 'via mcp' })).data
      const claimed = (await tool('pm_claim_next', { project: 'mcp' })).data
      assert.equal(claimed.id, t.id)
      assert.equal(claimed.claim_model, 'claude-opus-5')
      const denied = await rpc('tools/call', { name: 'pm_claim_task', arguments: { id: t.id, actor: 'GPT-6' } })
      assert.equal(denied.result.isError, true)
    } finally {
      child.kill()
    }
  })
})

// ---------------------------------------------------------------------------
// The operational layer: the action state machine, machine ownership, and the
// DSH driver's prompt/settings contract. A fake driver stands in for DSH so
// these rules are checked without a live harness.
// ---------------------------------------------------------------------------

test('actions: the state machine refuses with a reason, and never silently no-ops', async () => {
  const { act, refusals, available } = await import('./actions.mjs')
  const { s } = fresh()
  const t = s.createTask(A, { project: 'demo', title: 'build it', lifecycle: 'BLOCKED' })

  assert.deepEqual(available(t).filter((a) => a.allowed).map((a) => a.action), ['archive'])
  assert.match(refusals(t, 'prepare')[0], /BLOCKED task allows archive, not prepare/)
  await assert.rejects(() => act(s, A, t.id, 'prepare', { drivers: {} }), (e) => e.status === 409 && e.extra.reasons.length > 0)

  // An unknown verb is refused too, rather than reaching a driver.
  assert.match(refusals(t, 'teleport')[0], /not an action/)
})

test('actions: a task owned by another machine refuses to execute here, aliases aside', async () => {
  const { refusals, sameMachine, machineNames } = await import('./actions.mjs')
  const task = { id: 'T-x', lifecycle: 'READY', execution_machine: 'vmixer2o2' }
  assert.match(refusals(task, 'prepare', { machine: 'ndi2' })[0], /executes on vmixer2o2/)
  assert.deepEqual(refusals({ ...task, execution_machine: 'ndi2' }, 'prepare', { machine: 'ndi2' }), [])
  // One machine, two names: the brain says ndi2, Windows says vmixlaptop2x6.
  assert.ok(sameMachine('ndi2', 'vmixlaptop2x6'))
  assert.ok(machineNames('ndi2').has('vmixlaptop2x6'))
  assert.ok(!sameMachine('ndi2', 'vmixer2o2'))
  // Archive is the one action that works regardless of who owns the machine.
  assert.deepEqual(refusals(task, 'archive', { machine: 'ndi2' }), [])
})

test('actions: prepare stops before dispatch, and start refuses until the user has picked the seats', async () => {
  const { act, preparedRun, missingRoster, available } = await import('./actions.mjs')
  const { s } = fresh()
  const t = s.createTask(A, { project: 'demo', title: 'ship it', next_action: 'do the thing', lifecycle: 'READY' })
  const calls = []
  const drivers = { 'dsh-pipeline': async () => ({ start: async () => { calls.push('start'); return { runId: 'RUN-1', stage: 'council', sessionId: 'sess-1' } } }) }

  // prepare contacts no driver at all.
  const p1 = await act(s, A, t.id, 'prepare', { machine: 'ndi2', drivers })
  assert.deepEqual(calls, [], 'prepare must not dispatch')
  assert.equal(p1.lifecycle, 'WAITING')
  assert.deepEqual(p1.missing, ['council', 'swarm'])
  assert.match(p1.question, /Who should sit on the council/)
  assert.equal(preparedRun(p1.task).request, 'do the thing')
  assert.deepEqual(preparedRun(p1.task).roster, { council: [], swarm: [] }, 'pm never defaults a roster')

  // A half-filled roster is still not startable.
  await act(s, A, t.id, 'prepare', { machine: 'ndi2', drivers, roster: { council: 'kimi,free-claude' } })
  await assert.rejects(() => act(s, A, t.id, 'start', { machine: 'ndi2', drivers }), (e) => e.status === 409 && /the user picks the seats/.test(e.message))
  assert.deepEqual(calls, [], 'a roster-less start must not reach the driver')

  // Both slots filled: now it starts, and the seats ride on the run record.
  await act(s, A, t.id, 'prepare', { machine: 'ndi2', drivers, keepRoster: true, roster: { swarm: ['kimi'] } })
  assert.deepEqual(missingRoster(preparedRun(s.getTask(t.id))), [])
  const out = await act(s, A, t.id, 'start', { machine: 'ndi2', drivers })
  assert.deepEqual(calls, ['start'])
  assert.equal(out.lifecycle, 'RUNNING')
  assert.equal(out.external, 'RUN-1')
  const after = s.getTask(t.id)
  assert.equal(after.execution_machine, 'ndi2')
  assert.equal(after.session_ref, 'sess-1')
  assert.equal(after.runs.at(-1).external_id, 'RUN-1')
  assert.ok(after.artifacts.some((x) => x.kind === 'run' && /council seats kimi\/free-claude/.test(x.note)))
  assert.deepEqual(available(after, { machine: 'ndi2' }).filter((a) => a.allowed).map((a) => a.action), ['continue', 'amend', 'stop', 'archive'])
})

test('actions: a failed start lands at FAILED, which offers repair rather than a silent relaunch', async () => {
  const { act, available } = await import('./actions.mjs')
  const { s } = fresh()
  const t = s.createTask(A, { project: 'demo', title: 'break it', next_action: 'x', lifecycle: 'READY' })
  const bad = { 'dsh-pipeline': async () => ({ start: async () => { throw Object.assign(new Error('DSH said no'), { details: { code: 'x' } }) } }) }
  await act(s, A, t.id, 'prepare', { machine: 'ndi2', drivers: bad, roster: { council: ['kimi'], swarm: ['kimi'] } })
  await assert.rejects(() => act(s, A, t.id, 'start', { machine: 'ndi2', drivers: bad }), (e) => e.status === 502)
  const failed = s.getTask(t.id)
  assert.equal(failed.lifecycle, 'FAILED')
  assert.equal(failed.runs.at(-1).state, 'failed')
  assert.deepEqual(available(failed, { machine: 'ndi2' }).filter((a) => a.allowed).map((a) => a.action), ['prepare', 'amend', 'archive'])
})

test('actions: amend repairs the run in place and refuses to become a restart', async () => {
  const { act } = await import('./actions.mjs')
  const { s } = fresh()
  const t = s.createTask(A, { project: 'demo', title: 'stalled', next_action: 'x', lifecycle: 'READY' })
  const calls = []
  const drivers = { 'dsh-pipeline': async () => ({
    start: async () => { calls.push('start'); return { runId: 'RUN-9', stage: 'swarm', sessionId: 'sess-9' } },
    amend: async ({ fix }) => { calls.push(`amend:${fix}`); return { runId: 'RUN-9', sessionId: 'sess-9', amended: true } },
  }) }
  await act(s, A, t.id, 'prepare', { machine: 'ndi2', drivers, roster: { council: ['kimi'], swarm: ['kimi'] } })
  await act(s, A, t.id, 'start', { machine: 'ndi2', drivers })

  await assert.rejects(() => act(s, A, t.id, 'amend', { machine: 'ndi2', drivers }), (e) => e.status === 400 && /needs `fix`/.test(e.message))
  await assert.rejects(() => act(s, A, t.id, 'amend', { machine: 'ndi2', drivers, fix: 'y', restart: true }), (e) => e.status === 400 && /will not restart it/.test(e.message))

  const out = await act(s, A, t.id, 'amend', { machine: 'ndi2', drivers, fix: 'the swarm roster was wrong' })
  assert.deepEqual(calls, ['start', 'amend:the swarm roster was wrong'], 'amend must not call start')
  assert.match(out.note, /RUN-9 in place, keeping the run and its journal/)
  assert.equal(s.getTask(t.id).runs.at(-1).external_id, 'RUN-9', 'the run id survives a repair')
})

test('dsh driver: the panel contract - prompts, the stop order, and never autoApprove', async () => {
  const d = await import('./drivers/dsh.mjs')
  assert.equal(d.startPrompt('do X'), 'Run the pipeline tool on this request, one stage at a time. Request: do X')
  assert.match(d.startPrompt('do X', 'council,swarm'), /Pass stages as `council,swarm`\./)
  assert.match(d.startPrompt('do X', '', 'fast'), /Pass mode as `fast`\./)

  const writes = d.stopWrites('RUN-7')
  assert.deepEqual(writes[0], ['pipelineStoppedId', 'RUN-7'], 'the stop id is written before pipelineId clears')
  assert.ok(writes.findIndex(([k]) => k === 'pipelineStoppedId') < writes.findIndex(([k]) => k === 'pipelineId'))
  assert.ok(!writes.some(([k]) => k === 'autoApprove'), 'stop must never touch the approval gate')
  assert.ok(!d.GATES.some((g) => g.approvedId === 'autoApprove'))
  for (const g of d.GATES) assert.match(g.prompt, /pipeline/, 'every gate needs a second-factor prompt')
})

test('dsh driver: a stale gate and an absent run are refused, not approved', async () => {
  const { openDsh } = await import('./drivers/dsh.mjs')
  // A council namespace with a pending gate but no live pipelineId: what a
  // stopped run leaves behind.
  const council = { pendingPlanId: 'GATE-1', approvedPlanId: '', pipelineId: '', pipelineStoppedId: 'OLD' }
  const sent = []
  const fetchImpl = async (url, init) => {
    const { method, payload } = JSON.parse(init.body)
    sent.push(method)
    const value = method === 'settings.describe'
      ? { namespaces: [{ ns: 'council', revision: 3, value: council }] }
      : method === 'session.list' ? { items: [{ sessionId: 'S1', running: false, cwd: 'C:/x' }] }
      : method === 'settings.mutate' ? (Object.assign(council, Object.fromEntries(payload.ops.map((o) => [o.path[0], o.value]))), { revision: 4 })
      : { accepted: true }
    return { ok: true, json: async () => ({ result: { ok: true, value } }) }
  }
  const dsh = openDsh({ fetchImpl })

  const st = await dsh.status()
  assert.equal(st.gate.stale, true, 'a gate with no running pipeline is stale')
  assert.equal(st.running, false)
  await assert.rejects(() => dsh.approveGate(), (e) => e.code === 'stale-gate')
  await assert.rejects(() => dsh.resume(), (e) => e.code === 'nothing-to-resume')
  assert.ok(!sent.includes('settings.mutate'), 'a refused approval must not write settings')

  // With a live run the same gate is approved: settings write FIRST, then the prompt.
  council.pipelineId = 'RUN-3'
  sent.length = 0
  const ok = await dsh.approveGate()
  assert.deepEqual(ok.approved, { gate: 'plan', id: 'GATE-1' })
  assert.ok(sent.indexOf('settings.mutate') < sent.indexOf('session.prompt'), 'the write is the first factor, the prompt the second')
  assert.equal(council.approvedPlanId, 'GATE-1')
  assert.ok(typeof council.approvedAt === 'number')
})

test('dsh driver: starting a second run over a live one is refused', async () => {
  const { openDsh } = await import('./drivers/dsh.mjs')
  const council = { pipelineId: 'RUN-LIVE', pipelineStage: 'swarm' }
  const fetchImpl = async (url, init) => {
    const { method } = JSON.parse(init.body)
    const value = method === 'settings.describe' ? { namespaces: [{ ns: 'council', revision: 1, value: council }] } : { items: [] }
    return { ok: true, json: async () => ({ result: { ok: true, value } }) }
  }
  await assert.rejects(() => openDsh({ fetchImpl }).start({ request: 'x' }), (e) => e.code === 'already-running')
})

test('actions: start hands the prepared roster to DSH, and stop puts the seats back', async () => {
  const { act } = await import('./actions.mjs')
  const { s } = fresh()
  const t = s.createTask(A, { project: 'demo', title: 'seated run', kind: 'dsh-pipeline' })
  const calls = []
  const undo = [{ op: 'set', path: ['seats', 'claude', 'enabled'], value: true }]
  const drivers = { 'dsh-pipeline': async () => ({
    start: async (args) => { calls.push(['start', args]); return { runId: 'RUN-R', stage: 'council', sessionId: 'sess-r', roster: { applied: args.roster, restore: undo } } },
    stop: async () => { calls.push(['stop']); return { stopped: 'RUN-R' } },
    restoreRoster: async (ops) => { calls.push(['restore', ops]); return { restored: ops.length } },
  }) }
  await act(s, A, t.id, 'prepare', { machine: 'ndi2', drivers, roster: { council: ['kimi', 'free-claude'], swarm: 'openrouter-free' } })
  await act(s, A, t.id, 'start', { machine: 'ndi2', drivers })
  assert.deepEqual(calls[0][1].roster, { council: ['kimi', 'free-claude'], swarm: ['openrouter-free'] }, 'the seats the user picked reach DSH')
  assert.deepEqual(JSON.parse(s.getTask(t.id).meta).rosterRestore, undo, 'the undo is kept on the task')

  await act(s, A, t.id, 'stop', { machine: 'ndi2', drivers })
  assert.deepEqual(calls.map((c) => c[0]), ['start', 'stop', 'restore'])
  assert.deepEqual(calls[2][1], undo)
  assert.equal(JSON.parse(s.getTask(t.id).meta).rosterRestore, null, 'a restored roster is not restored twice')
})

test('dsh driver: start seats exactly the roster before the prompt, refuses unknown seats, and restore undoes it', async () => {
  const { openDsh, rosterWrites } = await import('./drivers/dsh.mjs')
  // user layer = what settings.yaml holds; `value` the effective view.
  const user = {
    seats: { claude: { enabled: true, model: 'opus' }, kimi: { enabled: false }, 'free-claude': { enabled: true } },
    extraSeats: { 'or-x': { model: 'm', enabled: true } },
    swarmRoster: { claude: { enabled: true, kinds: [] }, codex: { enabled: true } },
  }
  const council = { pipelineId: '', ...structuredClone(user) }
  const userAtStart = structuredClone(user)
  const set = (obj, path, v, unset) => { const last = path.at(-1); let o = obj; for (const k of path.slice(0, -1)) o = (o[k] ??= {}); if (unset) delete o[last]; else o[last] = v }
  const sent = []
  const fetchImpl = async (url, init) => {
    const { method, payload } = JSON.parse(init.body)
    sent.push(method)
    let value
    if (method === 'settings.describe') value = { namespaces: [{ ns: 'council', revision: 1, value: council, user }] }
    else if (method === 'settings.mutate') {
      for (const o of payload.ops) { set(council, o.path, o.value, o.op === 'unset'); if (o.path.length > 1) set(user, o.path, o.value, o.op === 'unset') }
      value = { revision: 2 }
    } else if (method === 'session.list') value = { items: [] }
    else if (method === 'session.create') value = { sessionId: 'S-new' }
    else if (method === 'session.prompt') { council.pipelineId = 'RUN-S'; value = { accepted: true } }
    else value = {}
    return { ok: true, json: async () => ({ result: { ok: true, value } }) }
  }
  const dsh = openDsh({ fetchImpl })

  // A seat this DSH does not have: nothing is written, nothing is prompted.
  await assert.rejects(() => dsh.start({ request: 'x', roster: { council: ['ghost'], swarm: ['kimi'] } }), (e) => e.code === 'unknown-seat')
  assert.ok(!sent.includes('settings.mutate') && !sent.includes('session.prompt'))

  sent.length = 0
  const out = await dsh.start({ request: 'x', fresh: true, roster: { council: ['kimi', 'or-x'], swarm: ['kimi'] }, waitMs: 1000 })
  assert.ok(sent.indexOf('settings.mutate') < sent.indexOf('session.prompt'), 'seats are applied before the run is prompted')
  assert.equal(out.runId, 'RUN-S')
  const on = (sec) => Object.entries(council[sec]).filter(([, v]) => v.enabled).map(([k]) => k).sort()
  assert.deepEqual(on('seats'), ['kimi'], 'only the picked council seats are on; the paid claude seat is off')
  assert.deepEqual(on('extraSeats'), ['or-x'])
  assert.deepEqual(on('swarmRoster'), ['kimi'], 'only the picked swarm seats are on')
  assert.equal(council.seats.claude.model, 'opus', 'only enabled flags are touched')

  await dsh.restoreRoster(out.roster.restore)
  assert.deepEqual(user, userAtStart, 'restore returns the user layer to exactly what it was')
  assert.equal(rosterWrites({ value: council, user }, { council: [], swarm: [] }).unknown.length, 0)
})

test('REST: the action routes are mounted and report what a task allows', async () => {
  const s = openStore(':memory:')
  s.createProject(A, { name: 'demo' })
  const t = s.createTask(A, { project: 'demo', title: 'rest', lifecycle: 'BLOCKED' })
  const server = createServer(s)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const acts = await (await fetch(`${base}/api/tasks/${t.id}/actions`)).json()
    assert.deepEqual(acts.filter((a) => a.allowed).map((a) => a.action), ['archive'])

    const refused = await fetch(`${base}/api/tasks/${t.id}/prepare`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...A }),
    })
    assert.equal(refused.status, 409)
    assert.ok((await refused.json()).reasons.length > 0, 'a refusal carries its reasons')

    const archived = await (await fetch(`${base}/api/tasks/${t.id}/archive`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...A, note: 'done with it' }),
    })).json()
    assert.equal(archived.lifecycle, 'ARCHIVED')
    assert.equal(s.getTask(t.id).lifecycle, 'ARCHIVED')
  } finally {
    server.close()
    s.close()
  }
})

// ---------------------------------------------------------------------------
// Phase 4: the machine runner. A real pm server on an ephemeral loopback port,
// a real runner talking to it over HTTP, real git clones and real processes.
// ---------------------------------------------------------------------------

const RUNNER = 'pm-runner@ndi2'
const HUMAN = { actor: 'user', model: null }

async function withRunnerEnv(fn, { clock } = {}) {
  const { createRunner } = await import('./runner.mjs')
  const root = mkdtempSync(join(tmpdir(), 'pm-runner-'))
  const store = openStore(':memory:', clock ? { clock } : undefined)
  store.createProject(A, { name: 'demo' })
  const server = createServer(store)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const make = (over = {}) => createRunner({ url, token: '', machine: 'ndi2', machines: ['ndi2', 'vmixlaptop2x6'], actor: RUNNER, root: join(root, 'ws'), leaseSeconds: 60, pollMs: 200, slots: 1, log: () => {}, ...over })
  try {
    await fn({ store, url, root, make })
  } finally {
    server.close()
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
}

const routed = (store, title, extra = {}) => store.createTask(HUMAN, { project: 'demo', title, assignee: RUNNER, execution_machine: 'ndi2', ...extra })

test('runner: claims only tasks routed to it on its machine, never DSH kinds, and starts nothing', async () => {
  const { existsSync, readFileSync } = await import('node:fs')
  await withRunnerEnv(async ({ store, make }) => {
    store.createTask(HUMAN, { project: 'demo', title: 'unassigned', execution_machine: 'ndi2' })
    routed(store, 'other machine', { execution_machine: 'vmixer2o2' })
    routed(store, 'dsh run', { kind: 'dsh-pipeline' })
    routed(store, 'dsh council', { kind: 'dsh-council' })
    const mine = routed(store, 'mine', { priority: 3 })
    const r = make()
    await r.register()
    assert.equal(store.listRunners()[0].machine, 'ndi2')
    const t1 = await r.tick()
    assert.deepEqual(t1.claimed.map((c) => c.task), [mine.id])
    for (let i = 0; i < 3; i++) await r.tick()
    const run = store.getRun(store.getTask(mine.id).run_ref)
    assert.equal(run.state, 'held', 'the daemon never moves a run past held')
    assert.equal(run.pid, null, 'the daemon never launches a process')
    assert.equal(run.owner, RUNNER)
    assert.equal(store.getTask(mine.id).lifecycle, 'WAITING')
    assert.ok(existsSync(join(run.detail.workspace, 'PM-TASK.json')))
    assert.match(readFileSync(join(run.detail.workspace, 'PM-TASK.json'), 'utf8'), /runner.mjs spawn/)
    for (const t of store.listTasks({ project: 'demo' }).filter((t) => t.id !== mine.id)) {
      assert.equal(t.claimed_by, null, `${t.title} must not be claimed`)
      assert.equal(t.run_ref, null)
    }
  })
})

test('runner: two assignments on the same repository get separate clones', async () => {
  const { writeFileSync, existsSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  await withRunnerEnv(async ({ store, root, make }) => {
    const repo = join(root, 'origin')
    execFileSync('git', ['init', '--quiet', repo])
    writeFileSync(join(repo, 'a.txt'), 'hello')
    const g = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' })
    g('add', 'a.txt')
    g('commit', '--quiet', '-m', 'init')
    const one = routed(store, 'one', { meta: { repo } })
    const two = routed(store, 'two', { meta: { repo } })
    const r = make({ slots: 2 })
    const out = await r.tick()
    assert.equal(out.claimed.length, 2)
    const [c1, c2] = out.claimed
    assert.notEqual(c1.cwd, c2.cwd)
    assert.ok(existsSync(join(c1.cwd, '.git')) && existsSync(join(c2.cwd, 'a.txt')))
    writeFileSync(join(c1.cwd, 'only-in-one.txt'), 'x')
    assert.ok(!existsSync(join(c2.cwd, 'only-in-one.txt')), 'neither sees the other working tree')
    assert.deepEqual(new Set(out.claimed.map((c) => c.task)), new Set([one.id, two.id]))
  })
})

test('runner: cancellation stays requested until the holding runner acknowledges it', async () => {
  await withRunnerEnv(async ({ store, url, make }) => {
    const t = routed(store, 'cancel me')
    const r = make()
    await r.tick()
    const runId = store.getTask(t.id).run_ref
    const req = await fetch(`${url}/api/runs/${runId}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'user', reason: 'not now' }) })
    assert.equal(req.status, 200)
    let run = store.getRun(runId)
    assert.equal(run.state, 'held', 'a request is not a termination')
    assert.ok(run.cancel_requested_at)
    assert.equal(run.cancel_acked_at, null)
    rejects(() => store.cancelAck(B, runId, { observed: 'lies' }), 409)
    const out = await r.tick()
    assert.deepEqual(out.cancelled, [runId])
    run = store.getRun(runId)
    assert.equal(run.state, 'cancelled')
    assert.ok(run.cancel_acked_at)
    assert.match(run.last_checkpoint, /no process was running/)
    const after = store.getTask(t.id)
    assert.equal(after.status, 'todo')
    assert.equal(after.assignee, null)
    assert.deepEqual((await r.tick()).claimed, [], 'a cancelled task is not taken straight back')
  })
})

test('runner: cancelling a user-spawned process kills it and acknowledges only after it is gone', async () => {
  const { pidAlive } = await import('./runner.mjs')
  await withRunnerEnv(async ({ store, make }) => {
    const t = routed(store, 'long job')
    const r = make()
    await r.tick()
    const runId = store.getTask(t.id).run_ref
    const job = r.spawn(t.id, [process.execPath, '-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    for (let i = 0; i < 50 && store.getRun(runId).state !== 'running'; i++) await new Promise((x) => setTimeout(x, 100))
    let run = store.getRun(runId)
    assert.equal(run.state, 'running')
    assert.ok(pidAlive(run.pid))
    store.requestCancel(HUMAN, runId, { reason: 'stop' })
    assert.equal(store.getRun(runId).state, 'running', 'still running until the runner observes the exit')
    const res = await job
    assert.equal(res.cancelled, true)
    run = store.getRun(runId)
    assert.equal(run.state, 'cancelled')
    assert.ok(!pidAlive(run.pid), 'the process is really gone')
  })
})

test('runner: a stale runner write after reassignment is rejected', async () => {
  await withRunnerEnv(async ({ store, make }) => {
    const t = routed(store, 'contested')
    const r1 = make()
    await r1.tick()
    const oldRun = store.getTask(t.id).run_ref
    // A human takes it back and routes it to a different runner.
    store.releaseTask(HUMAN, t.id, { force: true })
    const cur = store.getTask(t.id)
    store.updateTask(HUMAN, t.id, { rev: cur.rev, assignee: 'pm-runner@other' })
    const r2 = make({ actor: 'pm-runner@other' })
    const got = await r2.tick()
    assert.equal(got.claimed.length, 1)
    assert.notEqual(store.getTask(t.id).run_ref, oldRun)
    const lost = await r1.tick()
    assert.deepEqual(lost.lost, [oldRun])
    rejects(() => store.finishRun({ actor: RUNNER }, oldRun, { exit_code: 0 }), 409)
    rejects(() => store.runnerUpdate({ actor: RUNNER }, oldRun, { state: 'running', pid: 1 }), 409)
    rejects(() => store.reattachRun({ actor: RUNNER }, oldRun), 409)
    assert.equal(store.getTask(t.id).claimed_by, 'pm-runner@other')
  })
})

test('runner: killed and restarted, it reconciles and relaunches nothing', async () => {
  const { spawnSync } = await import('node:child_process')
  let now = new Date('2026-09-29T12:00:00Z')
  await withRunnerEnv(async ({ store, make }) => {
    const held = routed(store, 'held', { priority: 1 })
    const crashed = routed(store, 'crashed', { priority: 2 })
    const done = routed(store, 'done', { priority: 3 })
    const r1 = make({ slots: 3 })
    await r1.tick()
    // `done` finished normally; `crashed` was running a process that died with the runner.
    const doneRun = store.getTask(done.id).run_ref
    store.runnerUpdate({ actor: RUNNER }, doneRun, { state: 'running', pid: process.pid })
    store.finishRun({ actor: RUNNER }, doneRun, { exit_code: 0 })
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid
    const crashedRun = store.getTask(crashed.id).run_ref
    store.runnerUpdate({ actor: RUNNER }, crashedRun, { state: 'running', pid: deadPid })
    // The runner is down long enough for its leases to expire.
    now = new Date('2026-09-29T12:05:00Z')
    assert.equal(store.reconcile().length, 2)
    assert.equal(store.getTask(held.id).status, 'uncertain')

    const r2 = make({ slots: 3 })
    const rec = await r2.recover()
    assert.deepEqual(rec.reattached, [store.getTask(held.id).run_ref])
    assert.deepEqual(rec.failed, [crashedRun])
    const c = store.getRun(crashedRun)
    assert.equal(c.state, 'failed')
    assert.match(c.last_checkpoint, /not relaunched/)
    assert.equal(store.getTask(held.id).status, 'in_progress')
    const out = await r2.tick()
    assert.deepEqual(out.claimed, [], 'nothing new is launched or claimed')
    for (const t of [held, crashed, done]) assert.equal(store.listRuns({ task_id: t.id }).length, 1, `${t.title} has exactly one run`)
    assert.equal(store.getRun(doneRun).state, 'done')
    assert.equal(store.getRun(crashedRun).pid, deadPid, 'the dead process was not replaced')
  }, { clock: () => now })
})

test('runner: spawn is the only execution path, needs an explicit command, and refuses DSH', async () => {
  const { readFileSync } = await import('node:fs')
  await withRunnerEnv(async ({ store, make }) => {
    const ok = routed(store, 'ok', { priority: 1 })
    const bad = routed(store, 'bad', { priority: 2 })
    const r = make({ slots: 2 })
    await r.tick()
    await assert.rejects(() => r.spawn(ok.id, []), /no default command/)
    const dsh = store.createTask(HUMAN, { project: 'demo', title: 'council', kind: 'dsh-council', execution_machine: 'ndi2' })
    await assert.rejects(() => r.spawn(dsh.id, ['node', '-v']), /DSH runs start only through pm prepare\/start/)

    const good = await r.spawn(ok.id, [process.execPath, '-e', 'console.log("runner-said-hi")'], { stdio: 'ignore' })
    assert.equal(good.exit_code, 0)
    assert.equal(good.state, 'done')
    assert.equal(store.getTask(ok.id).status, 'review')
    assert.match(readFileSync(store.getRun(good.runId).detail.log, 'utf8'), /runner-said-hi/)

    const failed = await r.spawn(bad.id, [process.execPath, '-e', 'process.exit(3)'], { stdio: 'ignore' })
    assert.equal(failed.exit_code, 3)
    assert.equal(store.getRun(failed.runId).state, 'failed')
    assert.equal(store.getTask(bad.id).lifecycle, 'FAILED')
    await assert.rejects(() => r.spawn(bad.id, [process.execPath, '-e', '']), /never relaunches/)
  })
})
