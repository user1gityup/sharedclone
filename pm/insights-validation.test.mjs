// node --test insights-validation.test.mjs   (run from this folder)
// Validation matrix for goals / usage ledger / budgets (T-8517248e). Router ordering is covered in
// deepseek-harness router-goal-alignment.spec.ts; role isolation, double ingestion and budget
// concurrency are covered end to end in insights.test.mjs and are re-checked here at module level.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStore } from './store.mjs'
import * as G from './goals.mjs'
import * as L from './usage-ledger.mjs'
import { createBudgetOps } from './budgets.mjs'

const A = { actor: 'Claude Sonnet 5.5' }
const admin = { actor: 'a', role: 'admin' }
const ev = (id, o = {}) => ({ event_id: id, provider: 'p', model: 'm', basis: 'actual', input_tokens: 10, output_tokens: 10, cost_class: 'metered', cost_usd: 1, occurred_at: '2026-11-01T00:00:00Z', ...o })

test('KPI math: increase, decrease, maintain and clamping', () => {
  const inc = { direction: 'increase', baseline: 0, target: 10 }
  assert.equal(G.metricProgress(inc, 5), 0.5)
  assert.equal(G.metricProgress(inc, -3), 0)
  assert.equal(G.metricProgress(inc, 99), 1)
  assert.equal(G.metricProgress({ direction: 'decrease', baseline: 100, target: 50 }, 75), 0.5)
  const mt = { direction: 'maintain', baseline: 50, target: 50 }
  assert.equal(G.metricProgress(mt, 52, 5), 1)
  assert.equal(G.metricProgress(mt, 57.5, 5), 0.5)
  assert.equal(G.metricProgress(mt, 70, 5), 0)
  assert.equal(G.metricProgress(inc, Number.NaN), 0)
})

test('history is append-only for goals, ledger and budgets', () => {
  const s = openStore(':memory:'); const db = s.db
  G.createGoal(db, { id: 'G', scope: 'organization', title: 't', ...admin })
  L.ingestEvent(db, ev('e1'), { actor: 'a' })
  const ops = createBudgetOps({ db, authorize: () => true })
  ops.createBudget({ id: 'B', level: 'organization', subject: 'o', unit: 'tokens', limit_amount: 5, actor: 'a' })
  for (const sql of ['UPDATE goal_history SET actor=1', 'DELETE FROM goal_history', 'UPDATE usage_events SET cost_usd=0', 'DELETE FROM usage_events', 'DELETE FROM ledger_audit', 'UPDATE budget_events SET kind=1', 'DELETE FROM budget_events'])
    assert.throws(() => db.exec(sql), /append-only/, sql)
})

test('usage reconciliation: actual supersedes estimate, goal split plus unattributed equals total', () => {
  const db = openStore(':memory:').db
  L.ingestEvent(db, ev('est', { basis: 'estimated', input_tokens: 100, output_tokens: 0, cost_usd: 2 }), { actor: 'a' })
  L.ingestEvent(db, ev('act', { supersedes: 'est', input_tokens: 80, output_tokens: 0, cost_usd: 1.5 }), { actor: 'a' })
  L.ingestEvent(db, ev('other', { input_tokens: 20, output_tokens: 0, cost_usd: 0.5 }), { actor: 'a' })
  L.setAllocations(db, 'act', [{ goal_id: 'G1', pct: 70 }], { actor: 'a' })
  const s = L.summarize(db)
  assert.equal(s.tokens, 100); assert.equal(s.cost_usd, 2)
  const c = L.costByGoal(db)
  assert.ok(Math.abs(c.goals.G1.tokens + c.unattributed.tokens - c.total_tokens) < 1e-9)
  assert.ok(Math.abs(c.goals.G1.cost_usd + c.unattributed.cost_usd - c.total_cost_usd) < 1e-9)
  assert.throws(() => L.ingestEvent(db, ev('act2', { supersedes: 'est' }), { actor: 'a' }), /already superseded|CONFLICT|superseded/)
})

test('zero-priced and subscription usage never invent spend', () => {
  const db = openStore(':memory:').db
  for (const [id, cls] of [['l', 'local'], ['f', 'free'], ['i', 'included']]) L.ingestEvent(db, ev(id, { cost_class: cls, cost_usd: 0, quota_pool: cls === 'included' ? 'max' : undefined }), { actor: 'a' })
  assert.throws(() => L.ingestEvent(db, ev('bad', { cost_class: 'local', cost_usd: 0.01 }), { actor: 'a' }), /no USD/)
  assert.equal(L.summarize(db).cost_usd, 0)
  assert.equal(L.poolUsage(db, 'max').tokens, 20)
})

test('failure recovery: crashed holder cannot lock budget; expired settle refused; stale release is idempotent', () => {
  const db = openStore(':memory:').db
  let t = Date.parse('2026-11-01T00:00:00Z')
  const ops = createBudgetOps({ db, authorize: () => true, now: () => new Date(t) })
  ops.createBudget({ id: 'B', level: 'organization', subject: 'o', unit: 'tokens', limit_amount: 100, actor: 'a' })
  const r = ops.reserve({ budget_id: 'B', amount: 100, holder: 'crashed', actor: 'a', ttl_seconds: 60 })
  assert.throws(() => ops.reserve({ budget_id: 'B', amount: 1, holder: 'x', actor: 'a' }), /exceed|BUDGET/i)
  t += 120_000
  assert.throws(() => ops.settle(r.reservation_id, 10, { actor: 'a' }), /expired/)
  assert.deepEqual(ops.releaseStale({ actor: 'a' }), [r.reservation_id])
  assert.deepEqual(ops.releaseStale({ actor: 'a' }), [])
  assert.ok(ops.reserve({ budget_id: 'B', amount: 100, holder: 'next', actor: 'a' }).reservation_id)
})

test('failed transaction leaves no partial goal state', () => {
  const db = openStore(':memory:').db
  assert.throws(() => G.createGoal(db, { id: 'G', scope: 'project', project_id: 'P', parent_id: 'MISSING', title: 't', ...admin }), /parent/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM goals').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM goal_history').get().n, 0)
})

test('migration rollback: dropping the new tables leaves the original pm store working', () => {
  const s = openStore(':memory:'); const db = s.db
  s.createProject(A, { name: 'p' }); const t = s.createTask(A, { project: 'p', title: 'keep' })
  const before = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('goals','goal_metrics','goal_milestones','goal_evidence','goal_history','usage_events','usage_allocations','ledger_audit','budgets','budget_reservations','budget_approvals','budget_events','sqlite_sequence') ORDER BY name").all()
  for (const tbl of ['goal_history', 'goal_evidence', 'goal_milestones', 'goal_metrics', 'goals', 'usage_allocations', 'usage_events', 'ledger_audit', 'budget_events', 'budget_approvals', 'budget_reservations', 'budgets']) db.exec(`DROP TABLE IF EXISTS ${tbl}`)
  const after = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('sqlite_sequence') ORDER BY name").all()
  assert.deepEqual(after, before, 'only the new tables were dropped')
  assert.equal(s.getTask(t.id).title, 'keep')
  s.updateTask(A, t.id, { rev: s.getTask(t.id).rev, body: 'still writable' })
  assert.equal(s.getTask(t.id).body, 'still writable')
})

test('accessibility: progress bars are labelled, status chips carry text, charts have text alternatives', () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'public', 'index.html'), 'utf8')
  const ui = html.slice(html.indexOf('// ---------- insights'), html.indexOf('function viewProjects()'))
  assert.match(ui, /role="progressbar"[^`]*aria-label="Goal progress/)
  assert.match(ui, /aria-valuenow=/)
  assert.match(ui, /role="img" aria-label="Tokens per day/)
  assert.match(ui, /<summary class="muted">Data table/)
  assert.match(ui, /role="img" aria-label="\$\{escapeHtml\(label\)\} trend/)
  assert.match(ui, /aria-expanded=/)
  for (const label of ['Overdue', 'Over limit', 'Near limit', 'Within budget', 'Critical', 'Warning', 'Notice', 'Achieved', 'Missed']) assert.ok(ui.includes(label), label)
  assert.ok(!/innerHTML\s*=\s*[^;]*\+\s*g\.title/.test(ui), 'no unescaped goal titles')
})
