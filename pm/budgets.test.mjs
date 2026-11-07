// node --test budgets.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrateBudgets, createBudgetOps } from './budgets.mjs'

const allowAll = () => true
function mk(opts = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); migrateBudgets(db)
  const clock = { t: Date.parse('2026-11-01T00:00:00Z') }
  const ops = createBudgetOps({ db, authorize: allowAll, verifyHuman: () => true, now: () => new Date(clock.t), ...opts })
  return { db, ops, clock }
}
const A = 'admin1'
function tree(ops, orgLimit = 1000, projLimit = 600) {
  ops.createBudget({ id: 'ORG', level: 'organization', subject: 'acme', unit: 'tokens', limit_amount: orgLimit, actor: A })
  ops.createBudget({ id: 'PRJ', level: 'project', subject: 'p1', parent_id: 'ORG', unit: 'tokens', limit_amount: projLimit, actor: A })
  ops.createBudget({ id: 'TSK', level: 'task', subject: 't1', parent_id: 'PRJ', unit: 'tokens', limit_amount: 300, actor: A })
}
const code = (fn) => { try { fn() } catch (e) { return e.code } return null }

test('fail closed: no authorize callback means every mutation is denied', () => {
  const db = new DatabaseSync(':memory:'); migrateBudgets(db)
  const ops = createBudgetOps({ db })
  assert.equal(code(() => ops.createBudget({ level: 'organization', subject: 'x', unit: 'tokens', limit_amount: 1, actor: 'root' })), 'FORBIDDEN')
})

test('identity required; unauthorized actor refused and a throwing authorizer denies', () => {
  const { ops } = mk(); tree(ops)
  assert.equal(code(() => ops.reserve({ budget_id: 'TSK', amount: 1, holder: 'h', actor: '' })), 'FORBIDDEN')
  assert.equal(code(() => ops.reserve({ budget_id: 'TSK', amount: 1, actor: 'a' })), 'FORBIDDEN') // no holder
  const { ops: o2 } = mk({ authorize: () => { throw new Error('boom') } })
  assert.equal(code(() => o2.createBudget({ level: 'organization', subject: 'x', unit: 'tokens', limit_amount: 1, actor: 'a' })), 'FORBIDDEN')
  const { ops: o3 } = mk({ authorize: (actor, action) => actor === 'ok' && action === 'create_budget' })
  o3.createBudget({ id: 'O', level: 'organization', subject: 'x', unit: 'tokens', limit_amount: 5, actor: 'ok' })
  assert.equal(code(() => o3.reserve({ budget_id: 'O', amount: 1, holder: 'h', actor: 'ok' })), 'FORBIDDEN')
})

test('hierarchy validation', () => {
  const { ops } = mk(); tree(ops)
  assert.equal(code(() => ops.createBudget({ level: 'team', subject: 't', parent_id: 'PRJ', unit: 'tokens', limit_amount: 1, actor: A })), 'BAD_REQUEST')
  assert.equal(code(() => ops.createBudget({ level: 'job', subject: 'j', parent_id: 'PRJ', unit: 'usd', limit_amount: 1, actor: A })), 'BAD_REQUEST')
  assert.equal(code(() => ops.createBudget({ level: 'project', subject: 'orphan', unit: 'tokens', limit_amount: 1, actor: A })), 'BAD_REQUEST')
  assert.equal(code(() => ops.createBudget({ level: 'job', subject: 'j', parent_id: 'NOPE', unit: 'tokens', limit_amount: 1, actor: A })), 'NOT_FOUND')
})

test('reserve charges every ancestor; hard limit refuses at any level', () => {
  const { ops } = mk(); tree(ops)
  ops.reserve({ budget_id: 'TSK', amount: 250, holder: 'run1', actor: A })
  assert.equal(ops.status('PRJ').used, 250); assert.equal(ops.status('ORG').used, 250)
  assert.equal(code(() => ops.reserve({ budget_id: 'TSK', amount: 100, holder: 'run2', actor: A })), 'BUDGET_EXCEEDED')
  assert.equal(ops.status('TSK').held, 250) // denial left nothing behind
  assert.ok(ops.events('TSK', 'denied').length === 1)
})

test('parent limit binds even when the child has room', () => {
  const { ops } = mk(); tree(ops, 1000, 100)
  assert.equal(code(() => ops.reserve({ budget_id: 'TSK', amount: 150, holder: 'h', actor: A })), 'BUDGET_EXCEEDED')
})

test('soft budget allows and flags; alert thresholds fire once', () => {
  const { ops } = mk()
  ops.createBudget({ id: 'S', level: 'organization', subject: 's', unit: 'tokens', limit_amount: 100, mode: 'soft', actor: A })
  const r1 = ops.reserve({ budget_id: 'S', amount: 60, holder: 'h', actor: A })
  assert.deepEqual(r1.alerts.map((a) => a.threshold), [0.5])
  const r2 = ops.reserve({ budget_id: 'S', amount: 60, holder: 'h', actor: A })
  assert.deepEqual(r2.alerts.map((a) => a.threshold).sort(), [0.8, 1])
  assert.equal(r2.flags[0].kind, 'soft_exceeded')
  const r3 = ops.reserve({ budget_id: 'S', amount: 10, holder: 'h', actor: A })
  assert.deepEqual(r3.alerts, [])
  assert.equal(ops.events('S', 'alert').length, 3)
})

test('per-reservation cost cap', () => {
  const { ops } = mk()
  ops.createBudget({ id: 'C', level: 'organization', subject: 'c', unit: 'usd', limit_amount: 100, cap_per_reservation: 5, actor: A })
  assert.equal(code(() => ops.reserve({ budget_id: 'C', amount: 6, holder: 'h', actor: A })), 'CAP_EXCEEDED')
  ops.reserve({ budget_id: 'C', amount: 5, holder: 'h', actor: A })
})

test('settle frees the unused hold, is idempotent, and logs overrun', () => {
  const { ops } = mk(); tree(ops)
  const { reservation_id: id } = ops.reserve({ budget_id: 'TSK', amount: 200, holder: 'h', actor: A })
  assert.deepEqual(ops.settle(id, 120, { actor: A }), { state: 'settled', settled_amount: 120, overrun: 0 })
  assert.equal(ops.status('ORG').used, 120); assert.equal(ops.status('ORG').held, 0)
  assert.equal(ops.settle(id, 120, { actor: A }).idempotent, true)
  assert.equal(code(() => ops.settle(id, 130, { actor: A })), 'CONFLICT')
  const r2 = ops.reserve({ budget_id: 'TSK', amount: 100, holder: 'h', actor: A })
  assert.equal(ops.settle(r2.reservation_id, 150, { actor: A }).overrun, 50)
  assert.equal(ops.events('TSK', 'overrun').length, 1)
  assert.equal(ops.status('TSK').used, 270)
})

test('release returns the hold; double release is idempotent; settled cannot be released', () => {
  const { ops } = mk(); tree(ops)
  const a = ops.reserve({ budget_id: 'TSK', amount: 200, holder: 'h', actor: A }).reservation_id
  ops.release(a, { actor: A }); assert.equal(ops.status('TSK').used, 0)
  assert.equal(ops.release(a, { actor: A }).idempotent, true)
  const b = ops.reserve({ budget_id: 'TSK', amount: 50, holder: 'h', actor: A }).reservation_id
  ops.settle(b, 50, { actor: A })
  assert.equal(code(() => ops.release(b, { actor: A })), 'CONFLICT')
})

test('stale holds are released and can no longer settle', () => {
  const { ops, clock } = mk(); tree(ops)
  const id = ops.reserve({ budget_id: 'TSK', amount: 250, holder: 'crashed', actor: A, ttl_seconds: 60 }).reservation_id
  assert.equal(code(() => ops.reserve({ budget_id: 'TSK', amount: 100, holder: 'x', actor: A })), 'BUDGET_EXCEEDED')
  clock.t += 30_000; assert.deepEqual(ops.releaseStale({ actor: A }), [])
  clock.t += 60_000
  assert.equal(code(() => ops.settle(id, 10, { actor: A })), 'EXPIRED')
  assert.deepEqual(ops.releaseStale({ actor: A }), [id])
  assert.equal(ops.status('TSK').used, 0)
  ops.reserve({ budget_id: 'TSK', amount: 100, holder: 'x', actor: A })
  assert.equal(code(() => ops.settle(id, 10, { actor: A })), 'CONFLICT')
})

test('exploratory work uses its own allowance on an exhausted hard budget', () => {
  const { ops } = mk()
  ops.createBudget({ id: 'Q', level: 'organization', subject: 'seat', unit: 'tokens', limit_amount: 100, quota_pool: 'claude-max', exploratory_allowance: 30, actor: A })
  ops.reserve({ budget_id: 'Q', amount: 100, holder: 'h', actor: A })
  assert.equal(code(() => ops.reserve({ budget_id: 'Q', amount: 10, holder: 'h', actor: A })), 'BUDGET_EXCEEDED')
  const e = ops.reserve({ budget_id: 'Q', amount: 20, holder: 'h', actor: A, purpose: 'exploratory' })
  assert.equal(e.flags[0].kind, 'exploratory_over_limit')
  assert.equal(code(() => ops.reserve({ budget_id: 'Q', amount: 20, holder: 'h', actor: A, purpose: 'exploratory' })), 'BUDGET_EXCEEDED')
})

test('inactive budget refuses reservations', () => {
  const { ops } = mk(); tree(ops); ops.deactivate('PRJ', { actor: A })
  assert.equal(code(() => ops.reserve({ budget_id: 'TSK', amount: 1, holder: 'h', actor: A })), 'INACTIVE')
})

test('raising a limit needs a human-verified approval, once, from someone else', () => {
  let human = false
  const { ops } = mk({ verifyHuman: () => human })
  tree(ops)
  const ap = ops.requestRaise({ budget_id: 'TSK', amount: 500, actor: 'agent7' })
  assert.equal(code(() => ops.applyRaise({ budget_id: 'TSK', approval_id: ap, actor: 'agent7' })), 'FORBIDDEN') // pending
  assert.equal(code(() => ops.decide(ap, { approver: 'boss', approve: true })), 'FORBIDDEN') // UI click without human proof
  human = true
  assert.equal(code(() => ops.decide(ap, { approver: 'agent7', approve: true })), 'FORBIDDEN') // self-approval
  assert.equal(ops.decide(ap, { approver: 'boss', approve: true }).state, 'approved')
  assert.equal(ops.applyRaise({ budget_id: 'TSK', approval_id: ap, actor: 'agent7' }).limit, 500)
  assert.equal(ops.getBudget('TSK').limit_amount, 500)
  assert.equal(code(() => ops.applyRaise({ budget_id: 'TSK', approval_id: ap, actor: 'agent7' })), 'FORBIDDEN') // replay
  assert.equal(code(() => ops.applyRaise({ budget_id: 'PRJ', approval_id: ap, actor: 'agent7' })), 'FORBIDDEN') // other budget
  const k = ops.events('TSK', 'limit_raised')[0]
  assert.equal(k.data.approved_by, 'boss')
})

test('denied approval cannot be applied; lowering needs no proof but must lower', () => {
  const { ops } = mk(); tree(ops)
  const ap = ops.requestRaise({ budget_id: 'TSK', amount: 500, actor: 'a' })
  ops.decide(ap, { approver: 'boss', approve: false })
  assert.equal(code(() => ops.applyRaise({ budget_id: 'TSK', approval_id: ap, actor: 'a' })), 'FORBIDDEN')
  assert.equal(code(() => ops.requestRaise({ budget_id: 'TSK', amount: 10, actor: 'a' })), 'BAD_REQUEST')
  assert.equal(ops.lowerLimit({ budget_id: 'TSK', amount: 100, actor: 'a' }).limit, 100)
  assert.equal(code(() => ops.lowerLimit({ budget_id: 'TSK', amount: 200, actor: 'a' })), 'BAD_REQUEST')
})

test('concurrent-style sequence: reservations never over-commit a hard budget', () => {
  const { ops } = mk(); tree(ops)
  let ok = 0
  for (let i = 0; i < 20; i++) { try { ops.reserve({ budget_id: 'TSK', amount: 40, holder: `r${i}`, actor: A }); ok++ } catch (e) { assert.equal(e.code, 'BUDGET_EXCEEDED') } }
  assert.equal(ok, 7); assert.ok(ops.status('TSK').used <= 300)
})

test('budget_events are append-only', () => {
  const { db, ops } = mk(); tree(ops)
  assert.throws(() => db.exec("UPDATE budget_events SET actor='x'"), /append-only/)
  assert.throws(() => db.exec('DELETE FROM budget_events'), /append-only/)
})
