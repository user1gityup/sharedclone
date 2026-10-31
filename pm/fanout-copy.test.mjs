// node --test fanout-copy.test.mjs   (run from pm/)
// Matrix row 18: C5 default fanout (permissions.mjs notifyFanout) - bridge inbox status notice to the run
//   owner, toast jsonl beside the bridge db, dedupe, executor mailboxes skipped, createBridge wiring.
// Matrix row 19: brain-write dual-write copy root (brain-write.mjs copyDir) and provenance;
//   extra finding "model:null" - model falls back to env PM_MODEL in the copy and the audit line.
// Temp dirs and env overrides only; nothing is written under ~/.claude. PM_TOAST is never set to 1.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { notifyFanout, workerPermissions } from './permissions.mjs'
import * as notify from './notify.mjs'
import * as lc from './bridge/lifecycle.mjs'
import { openQueue } from './bridge/queue.mjs'
import { createBridge } from './bridge/index.mjs'
import { copyDir, brainWrite, setApprovalResolver } from './brain-write.mjs'

const ENV_KEYS = ['PM_TOAST', 'PM_BRAIN_COPY_DIR', 'PM_BRAIN_DIR', 'PM_BRAIN_AUDIT', 'PM_MODEL', 'PM_ACTOR']
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
const dirs = []
const queues = []
const tmp = (p = 'fc-') => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
const policy = () => ({ ack_timeout_seconds: 600, response_timeout_seconds: 600 })
const q = (dir) => { const qu = openQueue(join(dir, 'bridge.db'), { machine: 'm1', policy }); queues.push(qu); return qu }
const notices = (qu, agent) => qu.db.prepare("SELECT * FROM bridge_messages WHERE type = 'status' AND to_agent = ? ORDER BY seq").all(agent)
  .map((r) => ({ ...r, body: JSON.parse(r.body) }))
const toastLines = (dir) => { const f = join(dir, 'notify-toast.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [] }

/** Wire queue -> workerPermissions(notifyFanout(queue)) -> lifecycle hooks, as createBridge does. */
function wire(qu, override) {
  const perm = workerPermissions(qu.db, notifyFanout(qu, override))
  lc.migrate(qu.db)
  lc.setHooks(perm.hooks)
  return perm
}

afterEach(() => {
  notify.setFanout({})
  lc.setHooks({})
  setApprovalResolver(null)
  for (const qu of queues.splice(0)) { try { qu.close() } catch {} }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k] }
})

// ---- Row 18: notifyFanout ----

test('row 18: override is returned as-is; default has bridgeInbox and toast functions', () => {
  const qu = q(tmp())
  const ov = { toast: () => {} }
  assert.equal(notifyFanout(qu, ov), ov)
  const f = notifyFanout(qu)
  assert.equal(typeof f.bridgeInbox, 'function')
  assert.equal(typeof f.toast, 'function')
})

test('row 18: owner gets exactly one status notice per terminal/parking state', () => {
  delete process.env.PM_TOAST
  const dir = tmp()
  const qu = q(dir)
  wire(qu)
  const db = qu.db
  lc.createRun(db, 'rc', { project: 'p', owner: 'chatgpt' })
  lc.transition(db, 'rc', 'running')
  assert.equal(notices(qu, 'chatgpt').length, 0, 'running is not a notify state')
  lc.transition(db, 'rc', 'completed')
  lc.createRun(db, 'rf', { project: 'p', owner: 'chatgpt' }); lc.transition(db, 'rf', 'running'); lc.transition(db, 'rf', 'failed')
  lc.createRun(db, 'rx', { project: 'p', owner: 'chatgpt' }); lc.transition(db, 'rx', 'cancelled')
  lc.createRun(db, 'ra', { project: 'p', owner: 'chatgpt' }); lc.transition(db, 'ra', 'running')
  lc.transition(db, 'ra', 'permission_required', { session_id: 'S1' }); lc.transition(db, 'ra', 'awaiting_approval')

  const got = notices(qu, 'chatgpt')
  assert.deepEqual(got.map((m) => [m.body.run_id, m.body.notice]),
    [['rc', 'completed'], ['rf', 'failed'], ['rx', 'cancelled'], ['ra', 'awaiting_approval']])
  for (const m of got) {
    assert.equal(m.from_agent, 'pm'); assert.equal(m.from_machine, 'm1'); assert.equal(m.to_machine, 'm1')
    assert.equal(m.principal, 'pm@m1')
    assert.match(m.dedupe_key, /^notify-run-/)
    assert.deepEqual(Object.keys(m.body).sort(), ['at', 'notice', 'run_id', 'severity', 'summary'])
    assert.ok(m.body.summary.includes(m.body.run_id))
  }
  assert.equal(got[0].dedupe_key, 'notify-run-rc-completed-0')
  assert.deepEqual(got.map((m) => m.body.severity), ['info', 'error', 'warn', 'warn'])
  assert.equal(got.find((m) => m.body.run_id === 'rc').project, 'p')
})

test('row 18: repeated emit with the same dedupe_key fans out once', () => {
  delete process.env.PM_TOAST
  const dir = tmp()
  const qu = q(dir)
  const perm = wire(qu)
  const ev = { type: 'failed', owner: 'chatgpt', run_id: 'rd', severity: 'error', audience: { roles: ['admin'] },
    dedupe_key: 'run-rd-failed-0', summary: 'run rd: running -> failed' }
  const a = perm.hooks.emit(null, ev)
  const b = perm.hooks.emit(null, ev)
  assert.equal(a.created, true); assert.equal(b.created, false)
  assert.equal(notices(qu, 'chatgpt').length, 1)
  assert.equal(toastLines(dir).length, 1)
  // bridgeInbox itself is idempotent too (queue dedupe on notify-<key>)
  notifyFanout(qu).bridgeInbox({ ...ev, at: 'x' })
  assert.equal(notices(qu, 'chatgpt').length, 1)
})

test('row 18: executor owners (claude-code, node) and owner-less runs get no notice; toast still logs', () => {
  delete process.env.PM_TOAST
  const dir = tmp()
  const qu = q(dir)
  wire(qu)
  lc.createRun(qu.db, 'e1', { owner: 'claude-code' }); lc.transition(qu.db, 'e1', 'cancelled')
  lc.createRun(qu.db, 'e2', { owner: 'node' }); lc.transition(qu.db, 'e2', 'cancelled')
  lc.createRun(qu.db, 'e3'); lc.transition(qu.db, 'e3', 'cancelled')
  assert.equal(qu.db.prepare("SELECT COUNT(*) n FROM bridge_messages WHERE type = 'status'").get().n, 0)
  assert.equal(toastLines(dir).length, 3)
})

test('row 18: toast appends a JSON line beside the bridge db with the event type', () => {
  delete process.env.PM_TOAST
  const dir = tmp()
  const qu = q(dir)
  wire(qu)
  lc.createRun(qu.db, 't1', { owner: 'chatgpt' }); lc.transition(qu.db, 't1', 'running'); lc.transition(qu.db, 't1', 'failed')
  lc.createRun(qu.db, 't2', { owner: 'chatgpt' }); lc.transition(qu.db, 't2', 'running'); lc.transition(qu.db, 't2', 'completed')
  const lines = toastLines(dir)
  assert.deepEqual(lines.map((l) => [l.run_id, l.type, l.severity]), [['t1', 'failed', 'error'], ['t2', 'completed', 'info']])
  for (const l of lines) { assert.ok(l.at); assert.ok(l.summary) }
})

test("row 18: ':memory:' queue writes no toast file and does not throw", () => {
  delete process.env.PM_TOAST
  const cwdBefore = existsSync(join(process.cwd(), 'notify-toast.jsonl'))
  const qu = openQueue(':memory:', { machine: 'm1', policy }); queues.push(qu)
  const perm = wire(qu)
  lc.createRun(qu.db, 'm1r', { owner: 'chatgpt' })
  assert.doesNotThrow(() => lc.transition(qu.db, 'm1r', 'cancelled'))
  const r = perm.hooks.emit(null, { type: 'stall', owner: 'chatgpt', severity: 'warn', audience: { roles: ['admin'] }, dedupe_key: 'mem-1', summary: 's' })
  assert.equal(r.fanout_errors, undefined)
  assert.equal(notices(qu, 'chatgpt').length, 2)
  assert.equal(existsSync(join(process.cwd(), 'notify-toast.jsonl')), cwdBefore)
  assert.doesNotThrow(() => notifyFanout(qu).toast({ type: 'stall', summary: 's' }))
})

test('row 18: createBridge passes notifyFanout(queue, workers.fanout) into the worker hooks', () => {
  const dir = tmp()
  const seen = { bridgeInbox: [], toast: [] }
  const api = createBridge({ machine: 'm1', dbPath: join(dir, 'bridge.db'), auth: () => null, peers: {},
    tokenFile: join(dir, 'tokens.json'), policyPath: join(dir, 'policy.json'),
    workers: { logDir: join(dir, 'logs'), fanout: { bridgeInbox: (e) => seen.bridgeInbox.push(e), toast: (e) => seen.toast.push(e) } } })
  queues.push(api.queue)
  lc.createRun(api.queue.db, 'b1', { owner: 'chatgpt' }); lc.transition(api.queue.db, 'b1', 'cancelled')
  assert.equal(seen.bridgeInbox.length, 1); assert.equal(seen.toast.length, 1)
  assert.equal(seen.toast[0].run_id, 'b1')
  assert.equal(notices(api.queue, 'chatgpt').length, 0, 'override replaces the default inbox')
  assert.equal(toastLines(dir).length, 0)
})

test('row 18: createBridge without an override uses the default fanout (inbox + toast jsonl)', () => {
  delete process.env.PM_TOAST
  const dir = tmp()
  const api = createBridge({ machine: 'm1', dbPath: join(dir, 'bridge.db'), auth: () => null, peers: {},
    tokenFile: join(dir, 'tokens.json'), policyPath: join(dir, 'policy.json'), workers: { logDir: join(dir, 'logs') } })
  queues.push(api.queue)
  lc.createRun(api.queue.db, 'b2', { owner: 'chatgpt' }); lc.transition(api.queue.db, 'b2', 'cancelled')
  assert.equal(notices(api.queue, 'chatgpt').length, 1)
  assert.equal(toastLines(dir)[0]?.type, 'cancelled')
})

// ---- Row 19: copyDir and provenance ----

test('row 19: copyDir resolves env overrides', () => {
  process.env.PM_BRAIN_COPY_DIR = 'C:\\some\\copy'
  assert.equal(copyDir(), 'C:\\some\\copy')
  process.env.PM_BRAIN_COPY_DIR = 'off'; assert.equal(copyDir(), null)
  process.env.PM_BRAIN_COPY_DIR = 'OFF'; assert.equal(copyDir(), null)
  delete process.env.PM_BRAIN_COPY_DIR
  process.env.PM_BRAIN_DIR = tmp(); assert.equal(copyDir(), null)
  delete process.env.PM_BRAIN_DIR
  assert.equal(copyDir(), join(homedir(), '.claude', 'pm-data', 'brain-copy'))
})

function brainEnv() {
  const dir = tmp('bwc-')
  process.env.PM_BRAIN_DIR = join(dir, 'brain')
  process.env.PM_BRAIN_COPY_DIR = join(dir, 'copy')
  process.env.PM_BRAIN_AUDIT = join(dir, 'audit.jsonl')
  delete process.env.PM_ACTOR
  return dir
}
const auditLines = (dir) => readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

test('row 19: brainWrite copies to PM_BRAIN_COPY_DIR with a provenance header', () => {
  const dir = brainEnv()
  delete process.env.PM_MODEL
  const r = brainWrite({ path: 'reports/x.md', content: 'hello', actor: 'a1', model: 'Claude Opus 5.5', run_id: 'run-9' })
  const body = readFileSync(join(dir, 'copy', 'reports', 'x.md'), 'utf8')
  const m = body.match(/^<!-- provenance: (.*) -->\n([\s\S]*)$/)
  assert.ok(m, 'provenance header present')
  assert.equal(m[2], 'hello')
  const prov = JSON.parse(m[1])
  assert.deepEqual({ actor: prov.actor, model: prov.model, run_id: prov.run_id, sha256: prov.sha256 },
    { actor: 'a1', model: 'Claude Opus 5.5', run_id: 'run-9', sha256: r.sha256 })
  assert.ok(prov.at)
  assert.deepEqual(r.copy, { path: 'reports/x.md', provenance: prov })
  assert.equal(readFileSync(join(dir, 'brain', 'reports', 'x.md'), 'utf8'), 'hello')
})

test('row 19 (model:null): model falls back to PM_MODEL in copy provenance and audit line', () => {
  const dir = brainEnv()
  process.env.PM_MODEL = 'Claude Sonnet 5'
  const r = brainWrite({ path: 'reports/y.md', content: 'y' })
  assert.equal(r.copy.provenance.model, 'Claude Sonnet 5')
  const body = readFileSync(join(dir, 'copy', 'reports', 'y.md'), 'utf8')
  assert.equal(JSON.parse(body.match(/^<!-- provenance: (.*) -->/)[1]).model, 'Claude Sonnet 5')
  const a = auditLines(dir).at(-1)
  assert.equal(a.outcome, 'ok'); assert.equal(a.model, 'Claude Sonnet 5')
  // a refused write also carries the env model
  assert.throws(() => brainWrite({ path: 'elsewhere/z.md', content: 'z' }))
  assert.equal(auditLines(dir).at(-1).outcome, 'refused')
  assert.equal(auditLines(dir).at(-1).model, 'Claude Sonnet 5')
  // explicit model wins over env
  const r2 = brainWrite({ path: 'reports/w.md', content: 'w', model: 'Claude Opus 5.5' })
  assert.equal(r2.copy.provenance.model, 'Claude Opus 5.5')
  assert.equal(auditLines(dir).at(-1).model, 'Claude Opus 5.5')
})
