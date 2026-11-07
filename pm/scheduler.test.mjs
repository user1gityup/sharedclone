// node --test scheduler.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as S from './scheduler.mjs'

const T = (id, o = {}) => ({ id, project: 'a', priority: 2, status: 'todo', created_at: id, est_cost_usd: 1, ...o })
const open = () => true

test('fails closed without a permission gate or agent', () => {
  assert.throws(() => S.suggestSchedule([T('1')], {}, ''), { code: 'NO_AGENT' })
  const r = S.suggestSchedule([T('1')], {}, 'x')
  assert.equal(r.suggestions.length, 0)
  assert.match(r.skipped[0].reason, /permission/)
})

test('admin project priority outranks task priority; then task priority; then age', () => {
  const tasks = [T('t1', { project: 'low', priority: 1 }), T('t2', { project: 'high', priority: 3 }), T('t3', { project: 'high', priority: 1 })]
  const r = S.suggestSchedule(tasks, { canRun: open, projectPriority: { high: 1, low: 2 } }, 'x')
  assert.deepEqual(r.suggestions.map((s) => s.id), ['t3', 't2', 't1'])
})

test('permission gate is per agent and project', () => {
  const tasks = [T('t1', { project: 'a' }), T('t2', { project: 'b' })]
  const r = S.suggestSchedule(tasks, { canRun: (ag, p) => ag === 'x' && p === 'b' }, 'x')
  assert.deepEqual(r.suggestions.map((s) => s.id), ['t2'])
  assert.equal(r.skipped[0].id, 't1')
})

test('budgets: per-project and total ceilings count prior spend and the running plan', () => {
  const tasks = [T('t1', { est_cost_usd: 4 }), T('t2', { est_cost_usd: 4 }), T('t3', { project: 'b', est_cost_usd: 4 })]
  const r = S.suggestSchedule(tasks, { canRun: open, budgets: { total: 10, perProject: { a: 6 } }, spent: { total: 2, perProject: { a: 1 } } }, 'x')
  assert.deepEqual(r.suggestions.map((s) => s.id), ['t1', 't3']) // t2 busts project a (1+4+4>6)
  assert.equal(r.skipped.find((s) => s.id === 't2').reason, 'budget: project ceiling')
  assert.equal(r.projectedSpend.total, 10)
})

test('total ceiling skips later tasks', () => {
  const r = S.suggestSchedule([T('t1', { est_cost_usd: 5 }), T('t2', { est_cost_usd: 5 })], { canRun: open, budgets: { total: 7 } }, 'x')
  assert.deepEqual(r.suggestions.map((s) => s.id), ['t1'])
  assert.equal(r.skipped[0].reason, 'budget: total ceiling')
})

test('assignee, unmet dependencies, archived and non-todo are not suggested', () => {
  const tasks = [T('d', { status: 'done' }), T('a', { assignee: 'other' }), T('b', { blocked_by: ['x'] }), T('c', { blocked_by: ['d'] }), T('e', { lifecycle: 'ARCHIVED' }), T('f', { status: 'review' })]
  const r = S.suggestSchedule(tasks, { canRun: open }, 'x')
  assert.deepEqual(r.suggestions.map((s) => s.id), ['c'])
  assert.deepEqual(r.skipped.map((s) => s.id).sort(), ['a', 'b'])
})

test('prepare-never-dispatch: suggestions carry no roster and cannot start themselves', () => {
  const r = S.suggestSchedule([T('t1')], { canRun: open }, 'x')
  const s = r.suggestions[0]
  assert.deepEqual([s.dispatch, s.roster, s.needsUserRoster], [false, null, true])
  assert.throws(() => S.startFromSuggestion(s), { code: 'USER_ROSTER' })
  assert.throws(() => S.startFromSuggestion(s, { roster: { council: [], swarm: [] } }), { code: 'USER_ROSTER' })
  assert.equal(S.startFromSuggestion(s, { roster: { council: ['kimi'] } }).startedBy, 'user')
})

test('maxSuggestions caps the plan', () => {
  const r = S.suggestSchedule([T('1'), T('2'), T('3')], { canRun: open, maxSuggestions: 2 }, 'x')
  assert.equal(r.suggestions.length, 2)
  assert.equal(r.skipped[0].reason, 'limit: max suggestions')
})
