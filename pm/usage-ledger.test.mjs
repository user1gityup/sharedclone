// node --test usage-ledger.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import * as L from './usage-ledger.mjs'

const who = { actor: 'collector' }
const mk = () => { const db = new DatabaseSync(':memory:'); L.migrateLedger(db); return db }
const ev = (o = {}) => ({ event_id: 'e1', provider: 'anthropic', model: 'opus', agent: 'a1', task_id: 'T1', run_id: 'R1', basis: 'actual', input_tokens: 100, output_tokens: 50, cost_class: 'metered', cost_usd: 0.5, occurred_at: '2026-11-01T00:00:00Z', ...o })

test('migrate idempotent; actor required', () => {
  const db = mk(); L.migrateLedger(db)
  assert.throws(() => L.ingestEvent(db, ev(), { actor: '' }), /actor identity/)
})

test('ingest is idempotent on identical replay', () => {
  const db = mk()
  assert.equal(L.ingestEvent(db, ev(), who).status, 'inserted')
  assert.equal(L.ingestEvent(db, ev(), who).status, 'duplicate')
  assert.equal(L.summarize(db).events, 1)
  assert.equal(L.summarize(db).tokens, 150)
})

test('same event_id with different content is rejected and audited', () => {
  const db = mk()
  L.ingestEvent(db, ev(), who)
  assert.throws(() => L.ingestEvent(db, ev({ output_tokens: 999 }), who), /different content/)
  assert.equal(L.summarize(db).tokens, 150)
  assert.ok(L.auditTrail(db, 'e1').some((a) => a.outcome === 'conflict'))
})

test('same provider request under two event ids is stored once', () => {
  const db = mk()
  L.ingestEvent(db, ev({ request_key: 'req_1' }), who)
  const r = L.ingestEvent(db, ev({ event_id: 'e2', request_key: 'req_1' }), who)
  assert.deepEqual([r.status, r.event_id], ['duplicate_request', 'e1'])
  assert.equal(L.summarize(db).events, 1)
  assert.equal(L.ingestEvent(db, ev({ event_id: 'e3', provider: 'openai', request_key: 'req_1' }), who).status, 'inserted')
})

test('validation: classes, tokens, cost rules', () => {
  const db = mk()
  assert.throws(() => L.ingestEvent(db, ev({ cost_class: 'weird' }), who), /cost_class/)
  assert.throws(() => L.ingestEvent(db, ev({ input_tokens: -1 }), who), /input_tokens/)
  assert.throws(() => L.ingestEvent(db, ev({ input_tokens: 1.5 }), who), /input_tokens/)
  assert.throws(() => L.ingestEvent(db, ev({ cost_class: 'free', cost_usd: 1 }), who), /no USD/)
  assert.throws(() => L.ingestEvent(db, ev({ quota_pool: 'p' }), who), /included usage only/)
  assert.throws(() => L.ingestEvent(db, ev({ occurred_at: 'nope' }), who), /occurred_at/)
  assert.throws(() => L.ingestEvent(db, ev({ event_id: '' }), who), /event_id/)
  assert.ok(L.auditTrail(db).some((a) => a.outcome === 'rejected'))
})

test('actual supersedes estimate and estimates drop from totals', () => {
  const db = mk()
  L.ingestEvent(db, ev({ event_id: 'est', basis: 'estimated', input_tokens: 80, output_tokens: 40, cost_usd: 0.4 }), who)
  assert.equal(L.summarize(db).tokens, 120)
  assert.throws(() => L.ingestEvent(db, ev({ event_id: 'bad', basis: 'estimated', supersedes: 'est' }), who), /actual/)
  L.ingestEvent(db, ev({ event_id: 'act', supersedes: 'est' }), who)
  const s = L.summarize(db)
  assert.equal(s.tokens, 150); assert.equal(s.events, 1); assert.deepEqual(Object.keys(s.by_basis), ['actual'])
  assert.throws(() => L.ingestEvent(db, ev({ event_id: 'act2', supersedes: 'est' }), who), /already superseded/)
  assert.throws(() => L.ingestEvent(db, ev({ event_id: 'x', supersedes: 'act' }), who), /estimated/)
  assert.throws(() => L.ingestEvent(db, ev({ event_id: 'y', supersedes: 'nope' }), who), /superseded event/)
})

test('cost classes aggregate separately; local and free carry no USD', () => {
  const db = mk()
  L.ingestEvent(db, ev(), who)
  L.ingestEvent(db, ev({ event_id: 'l', provider: 'llama', cost_class: 'local', cost_usd: 0 }), who)
  L.ingestEvent(db, ev({ event_id: 'f', provider: 'fcc', cost_class: 'free', cost_usd: 0 }), who)
  const s = L.summarize(db)
  assert.equal(s.cost_usd, 0.5)
  assert.deepEqual(Object.keys(s.by_cost_class).sort(), ['free', 'local', 'metered'])
  assert.equal(L.summarize(db, { cost_class: 'local' }).events, 1)
})

test('shared quota pool counts each event once across agents', () => {
  const db = mk()
  const inc = (id, agent, key) => ev({ event_id: id, agent, cost_class: 'included', cost_usd: 0, quota_pool: 'claude-max', request_key: key })
  L.ingestEvent(db, inc('p1', 'a1', 'r1'), who)
  L.ingestEvent(db, inc('p2', 'a2', 'r2'), who)
  L.ingestEvent(db, inc('p3', 'a2', 'r1'), who) // same request seen via a second agent
  const p = L.poolUsage(db, 'claude-max')
  assert.equal(p.events, 2); assert.equal(p.tokens, 300); assert.deepEqual(p.by_agent, { a1: 150, a2: 150 })
})

test('allocations: sum <= 100, versioned, unattributed explicit', () => {
  const db = mk(); L.ingestEvent(db, ev(), who)
  assert.deepEqual(L.getAllocation(db, 'e1'), { version: 0, lines: [], unattributed_pct: 100 })
  assert.throws(() => L.setAllocations(db, 'e1', [{ goal_id: 'g1', pct: 60 }, { goal_id: 'g2', pct: 50 }], who), /over 100/)
  assert.throws(() => L.setAllocations(db, 'e1', [{ goal_id: 'g1', pct: 10 }, { goal_id: 'g1', pct: 10 }], who), /duplicate/)
  assert.throws(() => L.setAllocations(db, 'e1', [{ goal_id: 'g1', pct: -1 }], who), /0\.\.100/)
  assert.throws(() => L.setAllocations(db, 'nope', [], who), /nope/)
  assert.equal(L.setAllocations(db, 'e1', [{ goal_id: 'g1', pct: 60 }, { goal_id: 'g2', pct: 30 }], who).unattributed_pct, 10)
  const a = L.getAllocation(db, 'e1')
  assert.equal(a.version, 1); assert.ok(Math.abs(a.unattributed_pct - 10) < 1e-9)
  L.setAllocations(db, 'e1', [{ goal_id: 'g1', pct: 100 }], who)
  assert.equal(L.getAllocation(db, 'e1').version, 2)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM usage_allocations WHERE event_id=?').get('e1').n, 3) // history kept
  L.setAllocations(db, 'e1', [], who)
  assert.equal(L.getAllocation(db, 'e1').unattributed_pct, 100)
})

test('costByGoal splits by percent and keeps unattributed', () => {
  const db = mk()
  L.ingestEvent(db, ev(), who); L.ingestEvent(db, ev({ event_id: 'e2', input_tokens: 200, output_tokens: 0, cost_usd: 1 }), who)
  L.setAllocations(db, 'e1', [{ goal_id: 'g1', pct: 50 }], who)
  const c = L.costByGoal(db)
  assert.equal(c.total_tokens, 350)
  assert.equal(c.goals.g1.tokens, 75); assert.equal(c.goals.g1.cost_usd, 0.25)
  assert.equal(c.unattributed.tokens, 275); assert.equal(c.unattributed.cost_usd, 1.25)
  assert.equal(c.goals.g1.tokens + c.unattributed.tokens, c.total_tokens)
})

test('ledger tables are append-only', () => {
  const db = mk(); L.ingestEvent(db, ev(), who); L.setAllocations(db, 'e1', [{ goal_id: 'g', pct: 5 }], who)
  for (const sql of ["UPDATE usage_events SET model='x'", 'DELETE FROM usage_events', 'UPDATE usage_allocations SET pct=1', 'DELETE FROM usage_allocations', "UPDATE ledger_audit SET actor='x'", 'DELETE FROM ledger_audit']) {
    assert.throws(() => db.exec(sql), /append-only/, sql)
  }
})
