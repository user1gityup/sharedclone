// node --test history.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import * as H from './history.mjs'

const mk = () => { const db = new DatabaseSync(':memory:'); H.migrateHistory(db); return db }
const L = (o = {}) => ({ actor: 'Claude Sonnet 5.5', task_id: 'T1', kind: 'run', machine: 'ndi2', job: 'build', model: 'sonnet', cost_usd: 0.5, message: 'started', at: '2026-11-01T00:00:00.000Z', ...o })

test('migrate idempotent; validation', () => {
  const db = mk(); H.migrateHistory(db)
  assert.throws(() => H.appendLog(db, L({ actor: '' })), { code: 'INVALID' })
  assert.throws(() => H.appendLog(db, L({ task_id: '' })), { code: 'INVALID' })
  assert.throws(() => H.appendLog(db, L({ kind: 'nope' })), { code: 'INVALID' })
  assert.throws(() => H.appendLog(db, L({ cost_usd: -1 })), { code: 'INVALID' })
})

test('per-task log is ordered and entries cannot be edited', () => {
  const db = mk()
  H.appendLog(db, L({ at: '2026-11-01T02:00:00Z', message: 'second' }))
  const id = H.appendLog(db, L({ at: '2026-11-01T01:00:00Z', message: 'first' }))
  H.appendLog(db, L({ task_id: 'T2' }))
  assert.deepEqual(H.taskLog(db, 'T1').map((r) => r.message), ['first', 'second'])
  assert.throws(() => db.prepare('UPDATE task_logs SET message = ? WHERE id = ?').run('x', id), /append-only/)
})

test('central search across machine, job, model, cost, approvals, errors', () => {
  const db = mk()
  H.appendLog(db, L({ machine: 'ndi2', model: 'opus', cost_usd: 3 }))
  H.appendLog(db, L({ machine: 'vmixer2o2', model: 'sonnet', kind: 'approval', approval: 'approved by admin', message: 'ok' }))
  H.appendLog(db, L({ machine: 'vmixer2o2', kind: 'error', error: 'ECONNRESET 100%_x', message: 'failed' }))
  assert.equal(H.searchHistory(db, { machine: 'vmixer2o2' }).total, 2)
  assert.equal(H.searchHistory(db, { model: 'opus' }).total, 1)
  assert.equal(H.searchHistory(db, { minCost: 1 }).total, 1)
  assert.equal(H.searchHistory(db, { kind: 'approval' }).rows[0].approval, 'approved by admin')
  assert.equal(H.searchHistory(db, { hasError: true }).total, 1)
  assert.equal(H.searchHistory(db, { q: 'ECONN' }).total, 1)
  assert.equal(H.searchHistory(db, { q: '100%_x' }).total, 1, 'LIKE wildcards are escaped')
  assert.equal(H.searchHistory(db, { q: '%' }).total, 1, 'a bare % is literal, not match-all')
  assert.equal(H.searchHistory(db, { machine: "x' OR '1'='1" }).total, 0, 'no injection')
  assert.equal(H.searchHistory(db, { limit: 1 }).rows.length, 1)
  assert.equal(H.searchHistory(db, { limit: 1, offset: 2 }).rows.length, 1)
  assert.equal(H.searchHistory(db, { since: '2027-01-01' }).total, 0)
})

test('export JSON and CSV; formula cells neutralised; quoting', () => {
  const db = mk()
  H.appendLog(db, L({ message: '=HYPERLINK("http://x")', error: 'a,b\n"c"' }))
  const j = JSON.parse(H.exportHistory(db, {}, 'json'))
  assert.equal(j.total, 1)
  const csv = H.exportHistory(db, {}, 'csv')
  const [head, row] = csv.split('\r\n')
  assert.equal(head, 'id,at,task_id,kind,machine,job,model,cost_usd,approval,error,message,actor')
  assert.ok(row.includes(`"'=HYPERLINK(""http://x"")"`))
  assert.ok(csv.includes('"a,b\n""c"""'))
  assert.throws(() => H.exportHistory(db, {}, 'xml'), { code: 'INVALID' })
})

test('retention: admin only, validated, default 365, audited', () => {
  const db = mk()
  assert.equal(H.getRetentionDays(db), 365)
  assert.throws(() => H.setRetentionDays(db, { days: 30, actor: 'w', role: 'worker' }), { code: 'FORBIDDEN' })
  assert.throws(() => H.setRetentionDays(db, { days: 0, actor: 'a', role: 'admin' }), { code: 'INVALID' })
  assert.throws(() => H.setRetentionDays(db, { days: 1.5, actor: 'a', role: 'admin' }), { code: 'INVALID' })
  assert.equal(H.setRetentionDays(db, { days: 30, actor: 'alice', role: 'admin' }), 30)
  assert.equal(H.getRetentionDays(db), 30)
  assert.deepEqual(H.auditTrail(db).map((a) => a.action), ['set_retention'])
})

test('purge removes only expired entries and audits the count', () => {
  const db = mk()
  H.setRetentionDays(db, { days: 30, actor: 'alice', role: 'admin' })
  H.appendLog(db, L({ at: '2026-09-01T00:00:00Z', message: 'old' }))
  H.appendLog(db, L({ at: '2026-10-25T00:00:00Z', message: 'recent' }))
  const r = H.purgeExpired(db, { actor: 'janitor', now: () => new Date('2026-11-01T00:00:00Z') })
  assert.equal(r.removed, 1)
  assert.deepEqual(H.taskLog(db, 'T1').map((x) => x.message), ['recent'])
  const last = H.auditTrail(db).at(-1)
  assert.equal(last.action, 'purge')
  assert.equal(JSON.parse(last.detail).removed, 1)
  assert.equal(H.purgeExpired(db, { actor: 'janitor', now: () => new Date('2026-11-01T00:00:00Z') }).removed, 0)
  assert.throws(() => H.purgeExpired(db, { actor: '' }), { code: 'INVALID' })
})
