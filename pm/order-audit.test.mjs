// node --test order-audit.test.mjs   (run from this folder)
// order-audit.mjs: orderDiff, reorderEvent, historyQuery (Claude Opus (S5)).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { orderDiff, reorderEvent, historyQuery, HISTORY_MAX_LIMIT, HISTORY_DEFAULT_LIMIT } from './order-audit.mjs'

test('orderDiff identical lists is []', () => {
  assert.deepEqual(orderDiff(['a', 'b', 'c'], ['a', 'b', 'c']), [])
  assert.deepEqual(orderDiff([], []), [])
})

test('orderDiff swap of two gives two entries, 1-based', () => {
  assert.deepEqual(orderDiff(['a', 'b', 'c'], ['b', 'a', 'c']), [
    { id: 'b', from: 2, to: 1 }, { id: 'a', from: 1, to: 2 },
  ])
})

test('orderDiff move to end shifts the rest', () => {
  assert.deepEqual(orderDiff(['a', 'b', 'c'], ['b', 'c', 'a']), [
    { id: 'b', from: 2, to: 1 }, { id: 'c', from: 3, to: 2 }, { id: 'a', from: 1, to: 3 },
  ])
})

test('orderDiff added/removed ids get null side', () => {
  assert.deepEqual(orderDiff(['a', 'b'], ['a', 'c']), [{ id: 'c', from: null, to: 2 }, { id: 'b', from: 2, to: null }])
})

test('reorderEvent shape with defaults', () => {
  const e = reorderEvent({ scope: 'top', mode: 'autosave', base_rev: 3, rev: 4, before: ['a', 'b'], after: ['b', 'a'] })
  assert.deepEqual(e, {
    entity: 'order', entity_id: 'top', action: 'reordered',
    data: { mode: 'autosave', base_rev: 3, rev: 4, moved: [{ id: 'b', from: 2, to: 1 }, { id: 'a', from: 1, to: 2 }], before: ['a', 'b'], after: ['b', 'a'] },
  })
  assert.equal('draft_id' in e.data, false)
})

test('reorderEvent includes draft_id and custom action', () => {
  const e = reorderEvent({ scope: 'project:p1', mode: 'confirm', draft_id: 'd1', base_rev: 1, rev: 2, before: ['x'], after: ['x'], action: 'draft_committed' })
  assert.equal(e.action, 'draft_committed')
  assert.equal(e.data.draft_id, 'd1')
  assert.deepEqual(e.data.moved, [])
})

test('reorderEvent rejects bad mode, action, scope', () => {
  assert.throws(() => reorderEvent({ scope: 'top', mode: 'instant', base_rev: 0, rev: 1 }), /invalid mode/)
  assert.throws(() => reorderEvent({ scope: 'top', base_rev: 0, rev: 1 }), /invalid mode/)
  assert.throws(() => reorderEvent({ scope: 'top', mode: 'manual', action: 'deleted' }), /invalid action/)
  assert.throws(() => reorderEvent({ mode: 'manual' }), /scope required/)
  for (const a of ['override_set', 'override_cleared', 'draft_created', 'draft_discarded']) {
    assert.equal(reorderEvent({ scope: 'top', mode: 'manual', action: a }).action, a)
  }
})

test('historyQuery sql/args, default and cap', () => {
  const s = historyQuery('top', 10)
  assert.match(s.sql, /FROM events WHERE entity='order' AND entity_id=\? ORDER BY id DESC LIMIT \?$/)
  assert.deepEqual(s.args, ['top', 10])
  const all = historyQuery(undefined)
  assert.doesNotMatch(all.sql, /entity_id=\?/)
  assert.deepEqual(all.args, [HISTORY_DEFAULT_LIMIT])
  assert.deepEqual(historyQuery(null, 9999).args, [HISTORY_MAX_LIMIT])
  assert.deepEqual(historyQuery('top', -5).args, ['top', HISTORY_DEFAULT_LIMIT])
})

test('historyQuery runs against the store events schema', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, model TEXT,
    entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}')`)
  const ins = db.prepare('INSERT INTO events (at, actor, entity, entity_id, action, data) VALUES (?,?,?,?,?,?)')
  ins.run('t1', 'u', 'order', 'top', 'reordered', '{}')
  ins.run('t2', 'u', 'task', 'T1', 'updated', '{}')
  ins.run('t3', 'u', 'order', 'project:p1', 'reordered', '{}')
  ins.run('t4', 'u', 'order', 'top', 'override_set', '{}')
  const q = historyQuery('top', 5)
  assert.deepEqual(db.prepare(q.sql).all(...q.args).map(r => r.action), ['override_set', 'reordered'])
  const a = historyQuery(null, 2)
  assert.deepEqual(db.prepare(a.sql).all(...a.args).map(r => r.at), ['t4', 't3'])
  db.close()
})
