// node --test dashboards.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as D from './dashboards.mjs'

const NOW = new Date('2026-11-01T00:00:00Z')
const snap = {
  projects: [{ id: 'P1', name: 'alpha' }, { id: 'P2', name: 'beta' }],
  tasks: [
    { id: 'T1', project: 'alpha', title: 'one', status: 'done', assignee: 'w1', milestone: 'M1', done_at: '2026-10-30T00:00:00Z' },
    { id: 'T2', project: 'alpha', title: 'two', status: 'review', assignee: 'w1', milestone: 'M1' },
    { id: 'T3', project: 'alpha', title: 'three', status: 'todo', assignee: 'w2', milestone: 'M2' },
    { id: 'T4', project: 'beta', title: 'four', status: 'done', claimed_by: 'w1', milestone: 'M9', done_at: '2026-10-31T00:00:00Z' },
  ],
  artifacts: [{ task_id: 'T1', kind: 'commit', ref: 'abc' }, { task_id: 'T2', kind: 'file', ref: 'f.md' }, { task_id: 'T3', kind: 'commit', ref: 'zzz' }, { task_id: 'T4', kind: 'url', ref: 'http://b' }, { task_id: 'T1', kind: 'brief', ref: 'x' }],
  usage: [{ task_id: 'T1', agent: 'opus', cost_usd: 2 }, { task_id: 'T2', agent: 'sonnet', cost_usd: 0.5 }, { task_id: 'T4', agent: 'opus', cost_usd: 7 }],
  runs: [{ task_id: 'T1', agent: 'opus', state: 'done' }, { task_id: 'T2', agent: 'sonnet', state: 'failed' }, { task_id: 'T4', agent: 'opus', state: 'done' }],
}

test('admin sees every section across all projects', () => {
  const d = D.buildDashboard(snap, { role: 'admin' }, { now: NOW })
  assert.deepEqual(d.sections, D.ROLE_SECTIONS.admin)
  assert.equal(d.costs.total_usd, 9.5)
  assert.deepEqual(d.projects, ['alpha', 'beta'])
  assert.deepEqual(d.milestones.find((m) => m.milestone === 'M1'), { milestone: 'M1', total: 2, done: 1, pct: 50 })
  assert.equal(d.deliverables.length, 3, 'only finished tasks, only deliverable kinds')
})

test('manager is limited to assigned projects', () => {
  const d = D.buildDashboard(snap, { role: 'manager', projects: ['alpha'] }, { now: NOW })
  assert.deepEqual(d.projects, ['alpha'])
  assert.equal(d.costs.total_usd, 2.5)
  assert.ok(!JSON.stringify(d).includes('http://b'))
  const none = D.buildDashboard(snap, { role: 'manager', projects: [] }, { now: NOW })
  assert.deepEqual(none.projects, [])
  assert.equal(none.costs.total_usd, 0)
})

test('worker sees only own tasks and no costs, agents or forecast', () => {
  const d = D.buildDashboard(snap, { role: 'worker', identity: 'w1', projects: ['alpha', 'beta'] })
  assert.deepEqual(d.sections, ['milestones', 'deliverables'])
  assert.equal(d.costs, undefined)
  assert.equal(d.agentPerformance, undefined)
  assert.equal(d.forecast, undefined)
  assert.deepEqual(d.milestones.map((m) => m.milestone), ['M1', 'M9'])
  assert.ok(!d.deliverables.some((x) => x.task_id === 'T3'))
  assert.equal(D.buildDashboard(snap, { role: 'worker', identity: 'w3', projects: ['alpha'] }).milestones.length, 0)
})

test('client sees only own project milestones and deliverables', () => {
  const d = D.buildDashboard(snap, { role: 'client', projects: ['beta'] })
  assert.deepEqual(d.projects, ['beta'])
  assert.deepEqual(d.deliverables.map((x) => x.ref), ['http://b'])
  for (const k of ['costs', 'agentPerformance', 'forecast']) assert.equal(d[k], undefined)
})

test('unknown or missing role fails closed', () => {
  for (const who of [undefined, {}, { role: 'root' }, { role: 'admin ' }]) {
    const d = D.buildDashboard(snap, who)
    assert.deepEqual(d.sections, [])
    assert.deepEqual(d.projects, [])
    assert.equal(d.milestones, undefined)
  }
})

test('agent performance and forecast', () => {
  const d = D.buildDashboard(snap, { role: 'admin' }, { now: NOW })
  assert.deepEqual(d.agentPerformance.find((a) => a.agent === 'opus'), { agent: 'opus', runs: 2, done: 2, failed: 0, cost_usd: 9, success_rate: 1 })
  assert.equal(d.agentPerformance.find((a) => a.agent === 'sonnet').success_rate, 0)
  assert.equal(d.forecast.open, 2)
  assert.equal(d.forecast.finished_in_window, 2)
  assert.equal(d.forecast.eta, '2026-11-15')
  assert.equal(D.forecast([{ status: 'todo' }], { now: NOW }).eta, null)
})

test('exports follow the role: CSV refuses sections the role cannot see; formulas neutralised', () => {
  assert.throws(() => D.exportDashboard(snap, { role: 'client', projects: ['beta'] }, { format: 'csv', section: 'costs' }), /not available/)
  const csv = D.exportDashboard(snap, { role: 'admin' }, { format: 'csv', section: 'deliverables' })
  assert.match(csv.split('\r\n')[0], /^task_id,title,kind,ref$/)
  const evil = { ...snap, tasks: [{ id: 'X', project: 'alpha', title: '=1+1', status: 'done' }], artifacts: [{ task_id: 'X', kind: 'file', ref: 'r' }] }
  assert.ok(D.exportDashboard(evil, { role: 'admin' }, { format: 'csv', section: 'deliverables' }).includes("'=1+1"))
  const j = JSON.parse(D.exportDashboard(snap, { role: 'worker', identity: 'w1', projects: ['alpha'] }))
  assert.equal(j.costs, undefined)
  assert.throws(() => D.exportDashboard(snap, { role: 'admin' }, { format: 'pdf' }), /json or csv/)
})
