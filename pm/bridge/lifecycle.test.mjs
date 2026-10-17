// node --test bridge/lifecycle.test.mjs   (run from pm/)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as lc from './lifecycle.mjs'
import { openQueue } from './queue.mjs'
import { loadPolicy } from './delivery.mjs'
import { createWorkers } from './workers.mjs'

const mem = () => { const db = new DatabaseSync(':memory:'); lc.migrate(db); return db }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('RUN_STATES matches C4 and every edge target is a state', () => {
  assert.deepEqual(lc.RUN_STATES, ['accepted', 'running', 'permission_required', 'awaiting_approval', 'resuming',
    'retrying', 'session_unavailable', 'completed', 'failed', 'cancelled', 'rejected'])
  for (const [from, tos] of Object.entries(lc.EDGES)) { assert.ok(lc.RUN_STATES.includes(from)); for (const t of tos) assert.ok(lc.RUN_STATES.includes(t)) }
})

test('legal path through permission/approval/resume; illegal edges throw', () => {
  const db = mem()
  lc.createRun(db, 'r1', { project: 'p' })
  assert.throws(() => lc.transition(db, 'r1', 'completed'), { code: 'ILLEGAL_EDGE' })
  assert.throws(() => lc.transition(db, 'r1', 'bogus'), { code: 'BAD_STATE' })
  assert.throws(() => lc.transition(db, 'nope', 'running'), { code: 'NOT_FOUND' })
  for (const s of ['running', 'permission_required', 'awaiting_approval']) lc.transition(db, 'r1', s, s === 'permission_required' ? { session_id: 'S1' } : null)
  assert.throws(() => lc.transition(db, 'r1', 'running'), { code: 'ILLEGAL_EDGE' }) // must go via resuming
  lc.transition(db, 'r1', 'resuming', { approval_id: 'A1' })
  lc.transition(db, 'r1', 'running')
  const r = lc.transition(db, 'r1', 'completed')
  assert.equal(r.session_id, 'S1'); assert.equal(r.approval_id, 'A1')
  assert.throws(() => lc.transition(db, 'r1', 'running'), { code: 'ILLEGAL_EDGE' })
  assert.equal(lc.history(db, 'r1').length, 6)
})

test('rejected -> cancelled; session_unavailable is terminal (no silent restart)', () => {
  const db = mem()
  lc.createRun(db, 'r2'); lc.transition(db, 'r2', 'running'); lc.transition(db, 'r2', 'permission_required'); lc.transition(db, 'r2', 'awaiting_approval')
  lc.transition(db, 'r2', 'rejected'); lc.transition(db, 'r2', 'cancelled')
  lc.createRun(db, 'r3'); lc.transition(db, 'r3', 'running'); lc.transition(db, 'r3', 'session_unavailable')
  for (const s of lc.RUN_STATES) if (s !== 'session_unavailable') assert.throws(() => lc.transition(db, 'r3', s), { code: 'ILLEGAL_EDGE' })
})

test('at most one retry, and only when no write happened', () => {
  const db = mem()
  lc.createRun(db, 'r4'); lc.transition(db, 'r4', 'running'); lc.transition(db, 'r4', 'failed')
  assert.equal(lc.canRetry(db, 'r4'), true)
  lc.transition(db, 'r4', 'retrying'); lc.transition(db, 'r4', 'running'); lc.transition(db, 'r4', 'failed')
  assert.equal(lc.canRetry(db, 'r4'), false)
  assert.throws(() => lc.transition(db, 'r4', 'retrying'), { code: 'RETRY_LIMIT' })
  lc.createRun(db, 'r5'); lc.transition(db, 'r5', 'running'); lc.markWrite(db, 'r5'); lc.transition(db, 'r5', 'failed')
  assert.throws(() => lc.transition(db, 'r5', 'retrying'), { code: 'RETRY_AFTER_WRITE' })
})

test('awaiting_approval never expires and survives a restart (file DB reopened)', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'lc-')), 'runs.db')
  let db = new DatabaseSync(path); lc.migrate(db)
  lc.createRun(db, 'r6'); lc.transition(db, 'r6', 'running'); lc.transition(db, 'r6', 'permission_required', { session_id: 'S6' }); lc.transition(db, 'r6', 'awaiting_approval')
  db.close()
  db = new DatabaseSync(path); lc.migrate(db)
  const parked = lc.awaiting(db)
  assert.equal(parked.length, 1); assert.equal(parked[0].id, 'r6'); assert.equal(parked[0].session_id, 'S6')
  assert.equal(Object.keys(lc.EDGES).includes('expired'), false)
  db.close()
})

test('terminal and parking states fan out to pm event, bridge inbox and an injectable toast', () => {
  const db = mem()
  const got = { emit: [], bridgeInbox: [], toast: [] }
  lc.setHooks({ emit: (_db, ev) => got.emit.push(ev), bridgeInbox: (ev) => got.bridgeInbox.push(ev), toast: (ev) => { got.toast.push(ev); throw new Error('toast down') } })
  try {
    lc.createRun(db, 'r7', { project: 'p', owner: 'chatgpt' }); lc.transition(db, 'r7', 'running')
    assert.equal(got.emit.length, 0) // running is not terminal
    lc.transition(db, 'r7', 'failed')
    for (const k of Object.keys(got)) { assert.equal(got[k].length, 1); assert.equal(got[k][0].type, 'failed'); assert.equal(got[k][0].run_id, 'r7') }
    assert.equal(got.emit[0].severity, 'error'); assert.ok(got.emit[0].dedupe_key)
  } finally { lc.setHooks({}) }
})

test('classifyExit', () => {
  assert.equal(lc.classifyExit({ code: 0, result: { is_error: false } }), 'completed')
  assert.equal(lc.classifyExit({ code: 1, result: null }), 'failed')
  assert.equal(lc.classifyExit({ code: 0, result: { cancelled: 1 }, cancelled: true }), 'cancelled')
  assert.equal(lc.classifyExit({ code: 0, result: { is_error: false, permission_denials: [{ tool_name: 'Write' }] } }), 'permission_required')
  assert.equal(lc.classifyExit({ code: 1, result: null, resumed: true, stderr: 'No conversation found with session ID: x' }), 'session_unavailable')
  assert.equal(lc.classifyExit({ code: 1, result: null, resumed: false, stderr: 'No conversation found' }), 'failed')
})

// ---- worker wiring with a scripted fake claude ------------------------------
const FAKE = `let p='';process.stdin.on('data',d=>p+=d);process.stdin.on('end',()=>{
const a=process.argv;const r=a.indexOf('--resume');const sid=r>0?a[r+1]:'sess-'+Date.now();
const say=o=>process.stdout.write(JSON.stringify(o)+'\\n');
if(r>0&&sid==='gone'){process.stderr.write('No conversation found with session ID: gone\\n');process.exit(1)}
say({type:'system',subtype:'init',session_id:sid});
if(p.includes('DENY')&&r<0){say({type:'result',is_error:false,result:'need perms',session_id:sid,permission_denials:[{tool_name:'Write'}]});return}
if(p.includes('FAIL')){process.exit(1)}
say({type:'result',is_error:false,result:'ok resumed='+(r>0),session_id:sid})})`

function rig() {
  const dir = mkdtempSync(join(tmpdir(), 'lc-w-'))
  const fake = join(dir, 'fake.mjs'); writeFileSync(fake, FAKE)
  const q = openQueue(':memory:', { machine: 'a', policy: () => loadPolicy(join(dir, 'bridge-policy.json')) })
  const approvals = []; const toasts = []
  const w = createWorkers(q, { bin: process.execPath, binArgs: [fake], router: null, logDir: join(dir, 'logs'), quota: () => ({ ok: true, headroom: 0.9 }),
    requestApproval: (req) => { approvals.push(req); return { id: `appr-${approvals.length}` } }, approvalValid: (id) => id.startsWith('appr-'), hooks: { toast: (ev) => toasts.push(ev) } })
  const submit = (id, body) => q.enqueue({ id, type: 'submit', from: { agent: 'tester' }, to: { machine: 'a', agent: 'claude-code' }, body })
  const run = async (id, want) => { for (let i = 0; i < 100; i++) { await w.tick(); const r = lc.getRun(q.db, id); if (r && want.includes(r.state)) return r; await sleep(50) } throw new Error(`timeout ${id} ${lc.getRun(q.db, id)?.state}`) }
  return { q, w, submit, run, approvals, toasts, dir }
}

test('worker: PERMISSION_REQUIRED -> approval request -> --resume the same session -> completed', async () => {
  const { q, w, submit, run, approvals, toasts, dir } = rig()
  try {
    submit('w1', { prompt: 'DENY please', model: 'sonnet' })
    const parked = await run('w1', ['awaiting_approval'])
    assert.equal(approvals.length, 1); assert.equal(approvals[0].kind, 'permission_resume'); assert.equal(approvals[0].session_id, parked.session_id)
    assert.equal(parked.approval_id, 'appr-1')
    assert.ok(toasts.some((t) => t.type === 'awaiting_approval'))
    submit('w1-forged', { prompt: 'go on', model: 'sonnet', run_id: 'w1', approval_id: 'forged' })
    for (let i = 0; i < 10; i++) { await w.tick(); await sleep(30) }
    assert.equal(lc.getRun(q.db, 'w1').state, 'awaiting_approval', 'an unapproved approval_id does not resume')
    submit('w1-resume', { prompt: 'go on', model: 'sonnet', run_id: 'w1', approval_id: 'appr-1' })
    const done = await run('w1', ['completed', 'failed'])
    assert.equal(done.state, 'completed'); assert.equal(done.session_id, parked.session_id)
    const log = readFileSync(join(dir, 'logs', 'w1-resume.log'), 'utf8')
    assert.match(log, new RegExp(`--resume ${parked.session_id}`))
    assert.deepEqual(lc.history(q.db, 'w1').map((h) => h.to_state), ['running', 'permission_required', 'awaiting_approval', 'resuming', 'running', 'completed'])
  } finally { q.db.close?.() }
})

test('worker: lost session -> session_unavailable, never silently restarted', async () => {
  const { q, w, submit, run } = rig()
  submit('w2', { prompt: 'x', model: 'sonnet', resume_session: 'gone' })
  const r = await run('w2', ['session_unavailable', 'failed', 'completed'])
  assert.equal(r.state, 'session_unavailable')
  submit('w2-again', { prompt: 'x', model: 'sonnet', run_id: 'w2' })
  for (let i = 0; i < 10; i++) { await w.tick(); await sleep(30) }
  assert.equal(lc.getRun(q.db, 'w2').state, 'session_unavailable')
})

test('worker: failed run retried once (no write), second failure is final', async () => {
  const { q, w, submit, run } = rig()
  submit('w3', { prompt: 'FAIL', model: 'sonnet' })
  await run('w3', ['failed'])
  submit('w3-r1', { prompt: 'FAIL', model: 'sonnet', run_id: 'w3' })
  for (let i = 0; i < 100 && lc.getRun(q.db, 'w3').retries < 1; i++) { await w.tick(); await sleep(20) }
  const r = await run('w3', ['failed'])
  assert.equal(r.retries, 1)
  submit('w3-r2', { prompt: 'FAIL', model: 'sonnet', run_id: 'w3' })
  for (let i = 0; i < 10; i++) { await w.tick(); await sleep(30) }
  assert.equal(lc.getRun(q.db, 'w3').retries, 1)
  assert.equal(lc.getRun(q.db, 'w3').state, 'failed')
})
