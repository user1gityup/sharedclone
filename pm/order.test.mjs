// order.test.mjs - S3 order store ops (Claude Opus (S3)).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from './store.mjs'

const W = { actor: 'tester', model: 'claude-opus-5-5' }
let tick = 0
const clock = () => new Date(Date.UTC(2026, 9, 18, 0, 0, tick++))

function seed() {
  const s = openStore(':memory:', { clock })
  const a = s.createProject(W, { name: 'alpha' })
  const b = s.createProject(W, { name: 'bravo' })
  const c = s.createProject(W, { name: 'charlie' })
  const t1 = s.createTask(W, { project: a.id, title: 't1', priority: 1 })
  const t2 = s.createTask(W, { project: a.id, title: 't2', priority: 2 })
  const t3 = s.createTask(W, { project: a.id, title: 't3', priority: 3 })
  const t4 = s.createTask(W, { project: b.id, title: 't4', priority: 1 })
  return { s, o: s.orderOps, a, b, c, t1, t2, t3, t4 }
}
const ids = (r) => r.items.map((i) => i.id)

test('getOrder: default order and rev 0; project scope by name', () => {
  const { s, o, a, b, c, t1, t2, t3 } = seed()
  const top = o.getOrder('top')
  assert.equal(top.rev, 0)
  assert.deepEqual(ids(top), [a.id, b.id, c.id])
  const p = o.getOrder('project:alpha')
  assert.equal(p.scope, `project:${a.id}`)
  assert.deepEqual(ids(p), [t1.id, t2.id, t3.id])
  s.close()
})

test('bulk then stale bulk -> 409 with current order; bad members 400/404', () => {
  const { s, o, a, b, c } = seed()
  const r = o.setOrder(W, 'top', { base_rev: 0, ids: [c.id, a.id, b.id], mode: 'autosave' })
  assert.equal(r.rev, 1)
  assert.deepEqual(ids(r), [c.id, a.id, b.id])
  assert.throws(() => o.setOrder(W, 'top', { base_rev: 0, ids: [b.id, a.id, c.id] }), (e) => {
    assert.equal(e.status, 409)
    assert.equal(e.extra.current.rev, 1)
    assert.deepEqual(e.extra.current.items.map((i) => i.id), [c.id, a.id, b.id])
    assert.deepEqual(e.extra.rejected.ids, [b.id, a.id, c.id])
    return true
  })
  assert.throws(() => o.setOrder(W, 'top', { base_rev: 1, ids: [a.id, b.id] }), (e) => e.status === 400 && e.message.includes(`missing: ${c.id}`))
  assert.throws(() => o.setOrder(W, 'top', { base_rev: 1, ids: [a.id, b.id, c.id, 'P-nope'] }), (e) => e.status === 404)
  assert.equal(o.getOrder('top').rev, 1)
  s.close()
})

test('move by before / after / to_index; task rev unchanged', () => {
  const { s, o, a, t1, t2, t3 } = seed()
  const sc = `project:${a.id}`
  let r = o.moveItem(W, sc, { base_rev: 0, id: t3.id, before: t1.id })
  assert.deepEqual(ids(r), [t3.id, t1.id, t2.id])
  r = o.moveItem(W, sc, { base_rev: 1, id: t3.id, after: t2.id })
  assert.deepEqual(ids(r), [t1.id, t2.id, t3.id])
  r = o.moveItem(W, sc, { base_rev: 2, id: t1.id, to_index: 2, mode: 'confirm' })
  assert.deepEqual(ids(r), [t2.id, t3.id, t1.id])
  assert.equal(r.rev, 3)
  assert.throws(() => o.moveItem(W, sc, { base_rev: 3, id: 'T-nope', to_index: 0 }), (e) => e.status === 404)
  for (const t of [t1, t2, t3]) assert.equal(s.getTask(t.id).rev, t.rev)
  s.close()
})

test('override pin/unpin bumps both scopes and writes task history', () => {
  const { s, o, a, b, c, t1, t2, t3 } = seed()
  const r = o.setOverride(W, t2.id, { override: true, base_rev_top: 0, base_rev_project: 0, to_index: 0 })
  assert.equal(r.top.rev, 1)
  assert.equal(r.project.rev, 1)
  assert.deepEqual(ids(r.top), [t2.id, a.id, b.id, c.id])
  assert.deepEqual(ids(r.project), [t1.id, t3.id])
  // project reorder does not move the pinned task
  o.setOrder(W, 'top', { base_rev: 1, ids: [c.id, t2.id, b.id, a.id] })
  assert.equal(o.flat()[0].id, t2.id)
  assert.throws(() => o.setOverride(W, t2.id, { override: false, base_rev_top: 1, base_rev_project: 1 }), (e) => e.status === 409)
  const u = o.setOverride(W, t2.id, { override: false, base_rev_top: 2, base_rev_project: 1, to_index: 1 })
  assert.equal(u.top.rev, 3)
  assert.equal(u.project.rev, 2)
  assert.deepEqual(ids(u.project), [t1.id, t2.id, t3.id])
  const hist = s.getTask(t2.id).history.map((h) => h.action)
  assert.ok(hist.includes('override_set') && hist.includes('override_cleared'))
  assert.equal(s.getTask(t2.id).rev, t2.rev)
  s.close()
})

test('listTasks/listProjects order=manual follow effective order; default unchanged', () => {
  const { s, o, a, b, c, t1, t2, t3, t4 } = seed()
  const defTasks = s.listTasks().map((t) => t.id)
  const defProjects = s.listProjects().map((p) => p.id)
  o.setOrder(W, 'top', { base_rev: 0, ids: [b.id, a.id, c.id] })
  o.setOrder(W, `project:${a.id}`, { base_rev: 0, ids: [t3.id, t1.id, t2.id] })
  assert.deepEqual(s.listTasks({ order: 'manual' }).map((t) => t.id), [t4.id, t3.id, t1.id, t2.id])
  assert.deepEqual(s.listProjects({ order: 'manual' }).map((p) => p.id), [b.id, a.id, c.id])
  assert.deepEqual(s.listTasks().map((t) => t.id), defTasks)
  assert.deepEqual(s.listProjects().map((p) => p.id), defProjects)
  assert.deepEqual(o.flat(a.id).map((e) => e.id), [t3.id, t1.id, t2.id])
  s.close()
})
