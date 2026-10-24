// order-drafts.test.mjs - S6 preview/confirm drafts (Claude Opus (S6)).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from './store.mjs'
import { createDrafts } from './order-drafts.mjs'

const W = { actor: 'tester', model: 'claude-opus-5-5' }

function seed() {
  let t = Date.UTC(2026, 9, 18)
  const clock = () => new Date(t += 1000)
  const s = openStore(':memory:', { clock })
  const a = s.createProject(W, { name: 'alpha' })
  const b = s.createProject(W, { name: 'bravo' })
  const c = s.createProject(W, { name: 'charlie' })
  const drafts = createDrafts({ ...s.orderDeps, orderOps: s.orderOps })
  const advance = (ms) => { t += ms }
  return { s, o: s.orderOps, drafts, a, b, c, advance }
}
const ids = (r) => r.items.map((i) => i.id)
const orderEvents = (s, action) => s.orderDeps.db.prepare('SELECT * FROM events WHERE entity = ? AND action = ?').all('order', action)

test('create -> preview/diff, commit applies and audits draft_committed', () => {
  const { s, o, drafts, a, b, c } = seed()
  const r = drafts.create(W, { scope: 'top', base_rev: 0, ids: [c.id, a.id, b.id] })
  assert.match(r.draft.id, /^D-[0-9a-f]{8}$/)
  assert.equal(r.draft.state, 'open')
  assert.deepEqual(r.preview.map((i) => i.id), [c.id, a.id, b.id])
  assert.deepEqual(r.diff, [{ id: c.id, from: 3, to: 1 }, { id: a.id, from: 1, to: 2 }, { id: b.id, from: 2, to: 3 }])
  assert.deepEqual(ids(o.getOrder('top')), [a.id, b.id, c.id], 'create does not apply')
  assert.equal(orderEvents(s, 'draft_created').length, 1)
  assert.equal(drafts.get(r.draft.id).stale, false)

  const done = drafts.commit(W, r.draft.id)
  assert.equal(done.draft.state, 'committed')
  assert.ok(done.draft.committed_at)
  assert.deepEqual(ids(o.getOrder('top')), [c.id, a.id, b.id])
  const ev = orderEvents(s, 'draft_committed')
  assert.equal(ev.length, 1)
  const data = JSON.parse(ev[0].data)
  assert.equal(data.mode, 'confirm')
  assert.equal(data.draft_id, r.draft.id)
  assert.equal(data.rev, 1)
  assert.throws(() => drafts.commit(W, r.draft.id), (e) => e.status === 409)
  assert.throws(() => drafts.discard(W, r.draft.id), (e) => e.status === 409)
  s.close()
})

test('create validates members: 400 naming missing/extra; unknown draft 404', () => {
  const { s, drafts, a, b } = seed()
  assert.throws(() => drafts.create(W, { scope: 'top', base_rev: 0, ids: [b.id, a.id, 'P-nope'] }), (e) => {
    assert.equal(e.status, 400)
    assert.match(e.message, /missing: .*extra: P-nope/)
    return true
  })
  assert.throws(() => drafts.get('D-00000000'), (e) => e.status === 404)
  s.close()
})

test('direct bulk write after create -> commit 409 + stale with current order', () => {
  const { s, o, drafts, a, b, c } = seed()
  const r = drafts.create(W, { scope: 'top', base_rev: 0, ids: [c.id, a.id, b.id] })
  o.setOrder(W, 'top', { base_rev: 0, ids: [b.id, c.id, a.id], mode: 'manual' })
  assert.equal(drafts.get(r.draft.id).stale, true)
  assert.throws(() => drafts.commit(W, r.draft.id), (e) => {
    assert.equal(e.status, 409)
    assert.equal(e.extra.current.rev, 1)
    assert.deepEqual(e.extra.current.items.map((i) => i.id), [b.id, c.id, a.id])
    assert.equal(e.extra.draft.state, 'stale')
    return true
  })
  assert.equal(drafts.get(r.draft.id).draft.state, 'stale')
  assert.deepEqual(ids(o.getOrder('top')), [b.id, c.id, a.id], 'stale commit changed nothing')
  assert.equal(orderEvents(s, 'draft_committed').length, 0)
  s.close()
})

test('draft days old with unchanged scope still commits (no expiry)', () => {
  const { s, o, drafts, a, b, c, advance } = seed()
  const r = drafts.create(W, { scope: 'top', ids: [b.id, a.id, c.id] })
  advance(30 * 24 * 3600 * 1000)
  const done = drafts.commit(W, r.draft.id)
  assert.equal(done.draft.state, 'committed')
  assert.deepEqual(ids(o.getOrder('top')), [b.id, a.id, c.id])
  s.close()
})

test('discard twice is idempotent: one draft_discarded event', () => {
  const { s, drafts, a, b, c } = seed()
  const r = drafts.create(W, { scope: 'top', base_rev: 0, ids: [c.id, b.id, a.id] })
  assert.equal(drafts.discard(W, r.draft.id).state, 'discarded')
  assert.equal(drafts.discard(W, r.draft.id).state, 'discarded')
  assert.equal(orderEvents(s, 'draft_discarded').length, 1)
  assert.throws(() => drafts.commit(W, r.draft.id), (e) => e.status === 409)
  assert.throws(() => drafts.discard({}, r.draft.id), (e) => e.status === 400)
  s.close()
})
