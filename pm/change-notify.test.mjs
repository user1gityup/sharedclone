// node --test change-notify.test.mjs   (run from this folder)
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import * as N from './notify.mjs'
import * as C from './change-notify.mjs'
import * as L from './usage-ledger.mjs'

const NOW = Date.parse('2026-11-01T10:00:00Z')
const fresh = new Date(NOW - 60_000).toISOString()
let db, fanned
beforeEach(() => { db = new DatabaseSync(':memory:'); N.migrate(db); fanned = []; N.setFanout({ bridgeInbox: (e) => fanned.push(e), toast: () => {} }) })
afterEach(() => N.setFanout({}))
const T = (o = {}) => ({ id: 'T1', title: 'Build x', project_id: 'P1', status: 'todo', rev: 1, assignee: 'bob', ...o })

test('meaningful transitions notify with the right type and severity', () => {
  assert.equal(C.meaningfulChange(T(), T({ status: 'review' })).type, 'awaiting_approval')
  assert.equal(C.meaningfulChange(T(), T({ status: 'done' })).type, 'completed')
  const b = C.meaningfulChange(T(), T({ status: 'blocked' })); assert.deepEqual([b.type, b.severity], ['stall', 'warn'])
  assert.equal(C.meaningfulChange(T({ status: 'blocked' }), T({ status: 'in_progress' })).type, 'resuming')
})

test('churn does not notify: same status, checkpoint, assignee, plain progress', () => {
  assert.equal(C.meaningfulChange(T(), T({ rev: 2, checkpoint: 'x' })), null)
  assert.equal(C.meaningfulChange(T(), T({ assignee: 'amy' })), null)
  assert.equal(C.meaningfulChange(T(), T({ status: 'in_progress' })), null)
  assert.equal(C.notifyTaskChange(db, T(), T({ rev: 2 })).notified, false)
  assert.equal(N.list(db, { role: 'admin' }).length, 0)
})

test('task change emits once per transition+rev, audience and fanout set', () => {
  const next = T({ status: 'review', rev: 5 })
  assert.equal(C.notifyTaskChange(db, T(), next).notified, true)
  assert.equal(C.notifyTaskChange(db, T(), next).notified, false)
  assert.equal(fanned.length, 1)
  assert.equal(N.list(db, { identity: 'bob' }).length, 1)
  assert.equal(N.list(db, { role: 'worker' }).length, 0)
  const again = C.notifyTaskChange(db, T({ status: 'blocked' }), T({ status: 'review', rev: 6 }))
  assert.equal(again.notified, true)
})

test('capacity view labels ok/warn/critical/stale/unknown; unknown is never ok', () => {
  const v = C.capacityView([
    { name: 'a', used: 10, limit: 100, as_of: fresh }, { name: 'b', used: 80, limit: 100, as_of: fresh },
    { name: 'c', used: 95, limit: 100, as_of: fresh }, { name: 'd', used: 10, limit: 100, as_of: new Date(NOW - 3 * 3600_000).toISOString() },
    { name: 'e' }, { name: 'f', used: 5, limit: 0, as_of: fresh },
  ], { now: NOW })
  assert.deepEqual(v.map((x) => x.status), ['ok', 'warn', 'critical', 'stale', 'unknown', 'unknown'])
})

test('capacity notifies once per threshold per reset window, not for ok/stale', () => {
  const src = [{ name: 'a', used: 85, limit: 100, as_of: fresh, reset_at: 'R1' }, { name: 'b', used: 10, limit: 100, as_of: fresh }, { name: 'c', used: 99, limit: 100, as_of: '2020-01-01T00:00:00Z' }]
  assert.equal(C.notifyCapacity(db, src, { now: NOW }).length, 1)
  assert.equal(C.notifyCapacity(db, src, { now: NOW }).length, 0)
  src[0].used = 97
  const crit = C.notifyCapacity(db, src, { now: NOW }); assert.equal(crit.length, 1); assert.equal(crit[0].severity, 'error')
  src[0].reset_at = 'R2'
  assert.equal(C.notifyCapacity(db, src, { now: NOW }).length, 1)
})

test('usage view reports totals and metered share from the ledger without double counting', () => {
  const l = new DatabaseSync(':memory:'); L.migrateLedger(l)
  const ev = (o) => ({ event_id: 'e1', provider: 'p', model: 'm', basis: 'actual', input_tokens: 100, output_tokens: 0, cost_class: 'free', cost_usd: 0, occurred_at: '2026-11-01T00:00:00Z', ...o })
  L.ingestEvent(l, ev({}), { actor: 'c' }); L.ingestEvent(l, ev({}), { actor: 'c' })
  L.ingestEvent(l, ev({ event_id: 'e2', cost_class: 'metered', cost_usd: 0.25, input_tokens: 300 }), { actor: 'c' })
  const u = C.usageView(l)
  assert.equal(u.events, 2); assert.equal(u.tokens, 400); assert.equal(u.cost_usd, 0.25); assert.equal(u.metered_token_share, 75)
})
