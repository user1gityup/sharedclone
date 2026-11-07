// node --test goals.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import * as g from './goals.mjs'

const A = { actor: 'alice', role: 'admin' }
const mk = () => { const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); g.migrateGoals(db); return db }

test('migrate is idempotent', () => { const db = mk(); g.migrateGoals(db); g.migrateGoals(db) })

test('roles fail closed', () => {
  const db = mk()
  const base = { id: 'G1', scope: 'organization', title: 't', actor: 'x' }
  assert.throws(() => g.createGoal(db, { ...base, role: 'viewer' }), /may not edit/)
  assert.throws(() => g.createGoal(db, { ...base, role: undefined }), /may not edit/)
  assert.throws(() => g.createGoal(db, { ...base, role: 'root' }), /may not edit/)
  assert.throws(() => g.createGoal(db, { ...base, role: 'admin', actor: '' }), /actor identity/)
})

test('scope rules and ID preservation', () => {
  const db = mk()
  assert.throws(() => g.createGoal(db, { scope: 'project', title: 't', ...A }), /project_id/)
  assert.throws(() => g.createGoal(db, { scope: 'organization', project_id: 'P', title: 't', ...A }), /cannot have project_id/)
  g.createGoal(db, { id: 'ORG1', scope: 'organization', title: 'Org', ...A })
  assert.throws(() => g.createGoal(db, { id: 'ORG1', scope: 'organization', title: 'Dup', ...A }), /exists/)
  g.createGoal(db, { id: 'P1', scope: 'project', project_id: 'P-x', parent_id: 'ORG1', title: 'Proj', ...A })
  assert.throws(() => g.createGoal(db, { scope: 'organization', parent_id: 'P1', title: 'bad', ...A }), /under a project/)
})

test('cascade inheritance and individual override', () => {
  const db = mk()
  g.createGoal(db, { id: 'O', scope: 'organization', title: 'Org', weight: 3, owner: 'ceo', status: 'active', ...A })
  g.createGoal(db, { id: 'C', scope: 'project', project_id: 'p', parent_id: 'O', title: 'Child', weight: null, owner: null, status: null, ...A })
  const e = g.effectiveGoal(db, 'C')
  assert.equal(e.owner, 'ceo'); assert.equal(e.weight, 3); assert.equal(e.title, 'Child')
  assert.ok(e.inherited.includes('owner'))
  g.updateGoal(db, 'C', { owner: 'bob' }, A)
  assert.equal(g.effectiveGoal(db, 'C').owner, 'bob')
  g.updateGoal(db, 'O', { owner: 'dana' }, A)
  assert.equal(g.effectiveGoal(db, 'C').owner, 'bob')
  g.clearOverride(db, 'C', 'owner', A)
  assert.equal(g.effectiveGoal(db, 'C').owner, 'dana')
})

test('updateGoal rev conflict and field whitelist', () => {
  const db = mk()
  g.createGoal(db, { id: 'O', scope: 'organization', title: 'Org', ...A })
  assert.throws(() => g.updateGoal(db, 'O', { title: 'n' }, { ...A, rev: 9 }), /rev/)
  assert.throws(() => g.updateGoal(db, 'O', { id: 'Z' }, A), /not editable/)
  assert.equal(g.updateGoal(db, 'O', { title: 'n' }, { ...A, rev: 1 }).rev, 2)
})

test('metric validation by direction', () => {
  const db = mk(); g.createGoal(db, { id: 'O', scope: 'organization', title: 'Org', ...A })
  assert.throws(() => g.addMetric(db, 'O', { name: 'a', direction: 'increase', baseline: 10, target: 5 }, A), /target > baseline/)
  assert.throws(() => g.addMetric(db, 'O', { name: 'a', direction: 'decrease', baseline: 5, target: 10 }, A), /target < baseline/)
  assert.throws(() => g.addMetric(db, 'O', { name: 'a', direction: 'up', baseline: 1, target: 2 }, A), /direction/)
  g.addMetric(db, 'O', { name: 'a', direction: 'decrease', baseline: 10, target: 5 }, A)
  assert.throws(() => g.addMetric(db, 'O', { name: 'a', direction: 'decrease', baseline: 10, target: 5 }, A))
})

test('metricProgress is direction aware and clamped', () => {
  assert.equal(g.metricProgress({ direction: 'increase', baseline: 0, target: 100 }, 50), 0.5)
  assert.equal(g.metricProgress({ direction: 'increase', baseline: 0, target: 100 }, 150), 1)
  assert.equal(g.metricProgress({ direction: 'increase', baseline: 0, target: 100 }, -5), 0)
  assert.equal(g.metricProgress({ direction: 'decrease', baseline: 100, target: 40 }, 70), 0.5)
  assert.equal(g.metricProgress({ direction: 'maintain', baseline: 99, target: 99 }, 99), 1)
})

test('only verified evidence counts; submitter cannot self-verify', () => {
  const db = mk(); g.createGoal(db, { id: 'O', scope: 'organization', title: 'Org', ...A })
  const m = g.addMetric(db, 'O', { name: 'rev', direction: 'increase', baseline: 0, target: 100 }, A)
  const e = g.submitEvidence(db, m, { value: 80, ref: 'url' }, { actor: 'carol', role: 'contributor' })
  assert.equal(g.goalProgress(db, 'O').progress, 0)
  assert.equal(g.goalProgress(db, 'O').metrics[0].unverified_pending, 1)
  assert.throws(() => g.verifyEvidence(db, e, { actor: 'carol', role: 'admin' }), /own evidence/)
  assert.throws(() => g.verifyEvidence(db, e, { actor: 'dave', role: 'owner' }), /may not verify/)
  g.verifyEvidence(db, e, { actor: 'dave', role: 'admin' })
  assert.equal(g.goalProgress(db, 'O').progress, 0.8)
  assert.throws(() => g.submitEvidence(db, m, { value: 1 }, { actor: 'v', role: 'viewer' }), /may not evidence/)
})

test('milestones feed progress and rollup weights children', () => {
  const db = mk()
  g.createGoal(db, { id: 'O', scope: 'organization', title: 'Org', status: 'active', ...A })
  g.createGoal(db, { id: 'A', scope: 'project', project_id: 'p', parent_id: 'O', title: 'A', weight: 3, status: 'active', ...A })
  g.createGoal(db, { id: 'B', scope: 'project', project_id: 'q', parent_id: 'O', title: 'B', weight: 1, status: 'active', ...A })
  const ma = g.addMilestone(db, 'A', { title: 'm' }, A); g.completeMilestone(db, ma, A)
  g.addMilestone(db, 'B', { title: 'm' }, A)
  assert.equal(g.rollup(db, 'A'), 1); assert.equal(g.rollup(db, 'B'), 0)
  assert.equal(g.rollup(db, 'O'), 0.75)
  g.updateGoal(db, 'B', { status: 'cancelled' }, A)
  assert.equal(g.rollup(db, 'O'), 1)
})

test('history is append-only and records actions', () => {
  const db = mk(); g.createGoal(db, { id: 'O', scope: 'organization', title: 'Org', ...A })
  g.updateGoal(db, 'O', { title: 'x' }, A)
  const h = g.goalHistory(db, 'O')
  assert.deepEqual(h.map((r) => r.action), ['created', 'updated'])
  assert.throws(() => db.exec("UPDATE goal_history SET actor='evil'"), /append-only/)
  assert.throws(() => db.exec('DELETE FROM goal_history'), /append-only/)
})
