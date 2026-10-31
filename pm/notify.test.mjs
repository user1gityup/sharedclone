import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrate, emit, list, mark, setFanout } from './notify.mjs'

let db
beforeEach(() => { db = new DatabaseSync(':memory:'); migrate(db); setFanout(null) })

const base = (o = {}) => ({ type: 'completed', project: 'p', machine: 'm', owner: 'o', run_id: 'r1',
  severity: 'info', audience: { roles: ['admin'] }, dedupe_key: 'k1', summary: 's', ...o })

test('migrate is idempotent', () => { migrate(db); migrate(db) })

test('emit stores and dedupes on dedupe_key', () => {
  const a = emit(db, base({ detail: { x: 1 } }))
  assert.equal(a.created, true)
  assert.deepEqual(a.event.detail, { x: 1 })
  const b = emit(db, base({ summary: 'other' }))
  assert.equal(b.created, false)
  assert.equal(b.event.id, a.event.id)
  assert.equal(b.event.summary, 's')
  assert.equal(list(db, {}).length, 1)
})

test('emit validates type, severity, audience, dedupe_key', () => {
  assert.throws(() => emit(db, base({ type: 'bogus' })))
  assert.throws(() => emit(db, base({ severity: 'fatal' })))
  assert.throws(() => emit(db, base({ audience: { roles: [] } })))
  assert.throws(() => emit(db, base({ dedupe_key: '' })))
  assert.equal(emit(db, base({ type: 'stall', dedupe_key: 'k2' })).created, true)
})

test('fanout fires once per new event; errors captured, not thrown', () => {
  const inbox = [], toasts = []
  setFanout({ bridgeInbox: e => inbox.push(e), toast: e => toasts.push(e) })
  emit(db, base()); emit(db, base())
  assert.equal(inbox.length, 1); assert.equal(toasts.length, 1)
  assert.equal(toasts[0].type, 'completed')
  setFanout({ toast: () => { throw new Error('no toast') } })
  const r = emit(db, base({ dedupe_key: 'k3' }))
  assert.equal(r.created, true)
  assert.equal(r.fanout_errors[0].channel, 'toast')
  assert.throws(() => setFanout({ toast: 1 }))
})

test('list filters by role/identity and unread; mark sets per-identity state', () => {
  const a = emit(db, base({ dedupe_key: 'a', at: '2026-01-01T00:00:00Z' })).event
  const b = emit(db, base({ dedupe_key: 'b', at: '2026-01-02T00:00:00Z', audience: { roles: ['worker'], identities: ['alice'] } })).event
  assert.deepEqual(list(db, { role: 'admin' }).map(e => e.id), [a.id])
  assert.deepEqual(list(db, { identity: 'alice' }).map(e => e.id), [b.id])
  assert.deepEqual(list(db, { identity: 'alice', role: 'admin' }).map(e => e.id), [b.id, a.id])
  mark(db, b.id, { identity: 'alice', state: 'read' })
  assert.deepEqual(list(db, { identity: 'alice', role: 'admin', unread: true }).map(e => e.id), [a.id])
  assert.equal(list(db, { identity: 'alice' })[0].state, 'read')
  mark(db, b.id, { identity: 'alice', state: 'acked' })
  assert.equal(list(db, { identity: 'alice' })[0].state, 'acked')
  assert.equal(list(db, { identity: 'bob', role: 'worker', unread: true }).length, 1)
  assert.throws(() => mark(db, b.id, { identity: 'alice', state: 'bad' }))
  assert.throws(() => mark(db, 'nope', { identity: 'alice', state: 'read' }))
  assert.throws(() => mark(db, b.id, { state: 'read' }))
})
