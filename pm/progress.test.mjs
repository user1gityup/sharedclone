// node --test progress.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as P from './progress.mjs'

const TASKS = { T1: 'P1', T2: 'P1', T3: 'P2' }
const ctx = { actor: 'bridge', trustedAgents: new Set(['dsh-a']), taskProject: (t) => TASKS[t] ?? null,
  runOwner: (r) => ({ R1: { task_id: 'T1', agent: 'dsh-a' }, R2: { task_id: 'T1', agent: 'dsh-a' }, R3: { task_id: 'T3', agent: 'dsh-a' } })[r] ?? null }
const mk = (file = ':memory:') => { const db = new DatabaseSync(file); P.migrateProgress(db); return db }
let n = 0
const ev = (o = {}) => ({ event_key: `k${++n}`, task_id: 'T1', project_id: 'P1', run_id: 'R1', generation: 1, seq: n, stage: 'running', percent: 40,
  source_agent: 'dsh-a', source_machine: 'vmixer', event_time: '2026-11-01T10:00:00Z', ...o })
const code = (fn) => { try { fn() } catch (e) { return e.code } return null }

test('exact stage thresholds', () => {
  const db = mk()
  assert.equal(P.recordProgress(db, ev({ stage: 'queued', percent: 99 }), ctx).snapshot.percent, 0)
  assert.equal(P.recordProgress(db, ev({ percent: undefined }), ctx).snapshot.percent, 10)
  assert.equal(code(() => P.recordProgress(db, ev({ percent: 81 }), ctx)), 'BAD_STAGE')
  assert.equal(code(() => P.recordProgress(db, ev({ percent: 9 }), ctx)), 'BAD_STAGE')
  assert.equal(P.recordProgress(db, ev({ percent: 80 }), ctx).snapshot.percent, 80)
  assert.equal(P.recordProgress(db, ev({ stage: 'report_written', report_ref: 'r.md' }), ctx).snapshot.percent, 85)
  const f = P.recordProgress(db, ev({ stage: 'check_failed', error: 'test x failed' }), ctx).snapshot
  assert.equal(f.percent, 90); assert.equal(f.result, 'fail')
  const v = P.taskProgress(db, 'T1')
  assert.equal(v.done, false); assert.equal(v.animate_success, false)
})

test('no false 100 from report alone; pass needs evidence and a report', () => {
  const db = mk()
  P.recordProgress(db, ev(), ctx)
  assert.equal(code(() => P.recordProgress(db, ev({ stage: 'verified_pass', check_ref: 'c1' }), ctx)), 'BAD_STAGE')
  P.recordProgress(db, ev({ stage: 'report_written', report_ref: 'r' }), ctx)
  assert.equal(P.taskProgress(db, 'T1').percent, 85)
  assert.equal(code(() => P.recordProgress(db, ev({ stage: 'verified_pass' }), ctx)), 'BAD_STAGE')
  assert.equal(code(() => P.recordProgress(db, ev({ stage: 'report_written' }), ctx)), 'BAD_STAGE')
  P.recordProgress(db, ev({ stage: 'verified_pass', check_ref: 'c1' }), ctx)
  const v = P.taskProgress(db, 'T1')
  assert.equal(v.percent, 100); assert.equal(v.done, true); assert.equal(v.animate_success, true)
})

test('duplicate is idempotent; replay with different content conflicts', () => {
  const db = mk(); const e = ev()
  assert.equal(P.recordProgress(db, e, ctx).status, 'applied')
  assert.equal(P.recordProgress(db, e, ctx).status, 'duplicate')
  assert.equal(code(() => P.recordProgress(db, { ...e, percent: 70 }, ctx)), 'CONFLICT')
  assert.ok(P.auditTrail(db, 'T1').some((a) => a.outcome === 'rejected'))
})

test('out-of-order and percent regression are stored late, snapshot unchanged', () => {
  const db = mk()
  P.recordProgress(db, ev({ seq: 10, percent: 60 }), ctx)
  assert.equal(P.recordProgress(db, ev({ seq: 5, percent: 20 }), ctx).status, 'late')
  assert.equal(P.recordProgress(db, ev({ seq: 11, percent: 30 }), ctx).status, 'late')
  assert.equal(P.taskProgress(db, 'T1').percent, 60)
})

test('cross-project, wrong run, untrusted source, unknown task rejected', () => {
  const db = mk()
  assert.equal(code(() => P.recordProgress(db, ev({ project_id: 'P2' }), ctx)), 'CROSS_PROJECT')
  assert.equal(code(() => P.recordProgress(db, ev({ run_id: 'R3' }), ctx)), 'RUN_MISMATCH')
  assert.equal(code(() => P.recordProgress(db, ev({ source_agent: 'evil' }), ctx)), 'UNTRUSTED_SOURCE')
  assert.equal(code(() => P.recordProgress(db, ev({ task_id: 'Tx' }), ctx)), 'UNKNOWN_TASK')
  assert.equal(code(() => P.recordProgress(db, ev(), { ...ctx, actor: '' })), 'BAD_REQUEST')
  assert.equal(P.taskProgress(db, 'T1').known, false)
})

test('retry needs a new generation; verified task never regresses', () => {
  const db = mk()
  P.recordProgress(db, ev(), ctx)
  assert.equal(code(() => P.recordProgress(db, ev({ generation: 2, run_id: 'R2' }), ctx)), 'GENERATION')
  const g2 = P.recordProgress(db, ev({ generation: 2, run_id: 'R2', retry: true, retry_reason: 'resume after crash' }), ctx)
  assert.equal(g2.snapshot.generation, 2)
  P.recordProgress(db, ev({ generation: 2, run_id: 'R2', stage: 'report_written', report_ref: 'r' }), ctx)
  P.recordProgress(db, ev({ generation: 2, run_id: 'R2', stage: 'verified_pass', check_ref: 'c' }), ctx)
  assert.equal(P.recordProgress(db, ev({ generation: 2, run_id: 'R2', percent: 20 }), ctx).status, 'ignored')
  assert.equal(P.recordProgress(db, ev({ generation: 1 }), ctx).status, 'late')
  assert.equal(P.taskProgress(db, 'T1').percent, 100)
})

test('blocked keeps last justified percent, never 100', () => {
  const db = mk()
  P.recordProgress(db, ev({ percent: 55 }), ctx)
  const b = P.recordProgress(db, ev({ stage: 'blocked', percent: 100, error: 'source missing' }), ctx).snapshot
  assert.equal(b.percent, 55); assert.equal(b.result, 'blocked')
  assert.equal(P.taskProgress(db, 'T1').done, false)
})

test('stale label, age label, UNKNOWN when no evidence, scoped reads', () => {
  const db = mk()
  assert.equal(P.taskProgress(db, 'T2').label, 'UNKNOWN')
  P.recordProgress(db, ev({ event_time: '2026-11-01T10:00:00Z' }), ctx)
  const v = P.taskProgress(db, 'T1', { now: Date.parse('2026-11-01T10:30:00Z') })
  assert.equal(v.stale, true); assert.equal(v.age_label, '30m ago')
  assert.throws(() => P.taskProgress(db, 'T1', { visibleProjects: new Set(['P2']) }), /not visible/)
})

test('rollup counts every task, unknown included, not only active', () => {
  const db = mk()
  P.recordProgress(db, ev({ percent: 50 }), ctx)
  const r = P.projectRollup(db, 'P1', ['T1', 'T2'])
  assert.equal(r.total, 2); assert.equal(r.unknown, 1); assert.equal(r.known, 1); assert.equal(r.percent_of_all, 25)
  assert.equal(P.projectRollup(db, 'P1', []).percent_of_all, null)
  const big = P.projectRollup(db, 'P1', Array.from({ length: 60 }, (_, i) => `X${i}`))
  assert.equal(big.total, 60); assert.equal(big.unknown, 60)
})

test('persists across restart; events append-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prog-')); const f = join(dir, 'p.db')
  let db = mk(f); P.recordProgress(db, ev({ percent: 33 }), ctx); db.close()
  db = mk(f)
  assert.equal(P.taskProgress(db, 'T1').percent, 33)
  assert.throws(() => db.exec('DELETE FROM progress_events'), /append-only/)
  assert.throws(() => db.exec("UPDATE progress_audit SET actor='x'"), /append-only/)
  db.close(); rmSync(dir, { recursive: true, force: true })
})
