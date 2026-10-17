// node --test roles.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrate, assignRole, revokeRole, roleOf, assertAllowed, allowedApprovalMethods } from './roles.mjs'

const BY = 'Claude Opus 5.5'

function fresh() {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  migrate(db) // idempotent
  assignRole(db, { identity: 'alice', role: 'admin', by: BY })
  assignRole(db, { identity: 'mona', role: 'manager', project: 'alpha', by: BY })
  assignRole(db, { identity: 'wes', role: 'worker', project: 'alpha', by: BY })
  assignRole(db, { identity: 'cleo', role: 'client', project: 'alpha', by: BY })
  return db
}

const forbidden = { code: 'FORBIDDEN' }

test('roleOf returns recorded role, null for unknown', () => {
  const db = fresh()
  assert.equal(roleOf(db, 'alice'), 'admin')
  assert.equal(roleOf(db, 'mona'), 'manager')
  assert.equal(roleOf(db, 'mona', 'beta'), null)
  assert.equal(roleOf(db, 'nobody'), null)
  assert.equal(roleOf(db, ''), null)
})

test('admin approves any scope', () => {
  const db = fresh()
  assert.equal(assertAllowed(db, 'alice', 'approve', { project: 'alpha' }), 'admin')
  assert.equal(assertAllowed(db, 'alice', 'approve', { project: 'beta' }), 'admin')
  assert.equal(assertAllowed(db, 'alice', 'bridge_settings', {}), 'admin')
})

test('manager approves only within own grant', () => {
  const db = fresh()
  assert.equal(assertAllowed(db, 'mona', 'approve', { project: 'alpha' }), 'manager')
  assert.throws(() => assertAllowed(db, 'mona', 'approve', { project: 'beta' }), forbidden)
  assert.throws(() => assertAllowed(db, 'mona', 'approve', {}), forbidden)
  assert.throws(() => assertAllowed(db, 'mona', 'approve', { project: '*' }), forbidden)
  assert.throws(() => assertAllowed(db, 'mona', 'bridge_settings', { project: 'alpha' }), forbidden)
})

test('worker and client never approve', () => {
  const db = fresh()
  for (const who of ['wes', 'cleo']) {
    assert.throws(() => assertAllowed(db, who, 'approve', { project: 'alpha' }), forbidden)
  }
  assert.deepEqual(allowedApprovalMethods('worker'), [])
  assert.deepEqual(allowedApprovalMethods('client'), [])
  assert.deepEqual(allowedApprovalMethods('unknown'), [])
  assert.ok(allowedApprovalMethods('admin').includes('otp'))
  assert.ok(!allowedApprovalMethods('manager').includes('link'))
})

test('browser_control is restricted server-side', () => {
  const db = fresh()
  assert.equal(assertAllowed(db, 'alice', 'browser_control', { project: 'beta' }), 'admin')
  assert.equal(assertAllowed(db, 'mona', 'browser_control', { project: 'alpha' }), 'manager')
  assert.throws(() => assertAllowed(db, 'mona', 'browser_control', { project: 'beta' }), forbidden)
  assert.throws(() => assertAllowed(db, 'wes', 'browser_control', { project: 'alpha' }), forbidden)
  assert.throws(() => assertAllowed(db, 'cleo', 'browser_control', { project: 'alpha' }), forbidden)
  assert.throws(() => assertAllowed(db, 'nobody', 'browser_control', { project: 'alpha' }), forbidden)
})

test('OpenClaw is never a principal', () => {
  const db = fresh()
  for (const id of ['openclaw', 'OpenClaw', 'openclaw:relay', 'openclaw@ndi2']) {
    assert.throws(() => assignRole(db, { identity: id, role: 'admin', by: BY }), forbidden)
    assert.equal(roleOf(db, id), null)
    assert.throws(() => assertAllowed(db, id, 'browser_control', { project: 'alpha' }), forbidden)
  }
  // even a row planted directly is ignored
  db.prepare("INSERT INTO role_assignments VALUES ('openclaw', 'admin', '', 'x', 'now', NULL)").run()
  assert.equal(roleOf(db, 'openclaw'), null)
  assert.throws(() => assertAllowed(db, 'openclaw', 'approve', { project: 'alpha' }), forbidden)
})

test('unknown action and revoked role fail closed', () => {
  const db = fresh()
  assert.throws(() => assertAllowed(db, 'alice', 'launch_missiles', {}), forbidden)
  revokeRole(db, { identity: 'mona', project: 'alpha' })
  assert.equal(roleOf(db, 'mona'), null)
  assert.throws(() => assertAllowed(db, 'mona', 'approve', { project: 'alpha' }), forbidden)
  assert.throws(() => assignRole(db, { identity: 'x', role: 'manager', by: BY }))
  assert.throws(() => assignRole(db, { identity: 'x', role: 'manager', project: '*', by: BY }))
})
