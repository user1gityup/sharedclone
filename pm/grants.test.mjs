// node --test grants.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  migrate, issueGrant, revokeGrant, resolveGrant, listGrants, confirmReplication, getGrant, GrantError, DEFAULT_TTL_MS,
} from './grants.mjs'

const T0 = '2026-10-12T00:00:00.000Z'
const KEY = { project: 'demo', role: 'worker', agent: 'remote', host: 'vmixlaptop2x6' }
const BASE = { ...KEY, tools: ['Read', 'Edit'], deny: ['Bash(git push:*)'], issuer: 'admin@ndi2', approval_id: 'ap-1', issued_at: T0 }

function fresh() {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  migrate(db) // idempotent
  return db
}
const bad = (fn, status = 400) => assert.throws(fn, (e) => e instanceof GrantError && e.status === status)

test('issue: full C1 shape, 30-day default expiry, uuid id, version 1', () => {
  const db = fresh()
  const g = issueGrant(db, BASE)
  assert.match(g.id, /^[0-9a-f-]{36}$/)
  assert.equal(g.version, 1)
  assert.deepEqual(g.tools, ['Read', 'Edit'])
  assert.deepEqual(g.deny, ['Bash(git push:*)'])
  assert.equal(g.issued_at, T0)
  assert.equal(Date.parse(g.expires_at) - Date.parse(T0), DEFAULT_TTL_MS)
  assert.equal(g.revoked_at, null)
  assert.equal(g.revoked_by, null)
  assert.equal(g.revoke_reason, null)
  assert.deepEqual(g.replicated_to, [])
})

test("issue: project '*' and wildcards rejected; missing fields and bad role rejected", () => {
  const db = fresh()
  bad(() => issueGrant(db, { ...BASE, project: '*' }))
  bad(() => issueGrant(db, { ...BASE, project: 'demo*' }))
  bad(() => issueGrant(db, { ...BASE, role: 'root' }))
  bad(() => issueGrant(db, { ...BASE, issuer: '' }))
  bad(() => issueGrant(db, { ...BASE, approval_id: undefined }))
  bad(() => issueGrant(db, { ...BASE, tools: 'Read' }))
  bad(() => issueGrant(db, { ...BASE, expires_at: T0 }))
  assert.equal(listGrants(db).length, 0)
})

test('version is monotonic per (project, role, agent, host)', () => {
  const db = fresh()
  assert.equal(issueGrant(db, BASE).version, 1)
  assert.equal(issueGrant(db, BASE).version, 2)
  assert.equal(issueGrant(db, { ...BASE, host: 'ndi2' }).version, 1)
})

test('resolve: returns newest valid grant; unknown key -> null', () => {
  const db = fresh()
  issueGrant(db, BASE)
  const g2 = issueGrant(db, { ...BASE, tools: ['Read'] })
  const r = resolveGrant(db, { ...KEY, now: '2026-10-13T00:00:00Z' })
  assert.equal(r.id, g2.id)
  assert.equal(resolveGrant(db, { ...KEY, agent: 'claude-code', now: T0 }), null)
  assert.equal(resolveGrant(db, { ...KEY, project: '*', now: T0 }), null)
  assert.equal(resolveGrant(db, {}), null)
})

test('resolve: expired grant fails closed', () => {
  const db = fresh()
  issueGrant(db, BASE)
  const after = new Date(Date.parse(T0) + DEFAULT_TTL_MS).toISOString()
  assert.equal(resolveGrant(db, { ...KEY, now: after }), null)
  assert.ok(resolveGrant(db, { ...KEY, now: new Date(Date.parse(after) - 1) }))
})

test('revoke: revoked grant fails closed and does not fall back to older version', () => {
  const db = fresh()
  const g1 = issueGrant(db, BASE)
  const g2 = issueGrant(db, BASE)
  const r = revokeGrant(db, g2.id, { by: 'admin@ndi2', reason: 'compromised', now: '2026-10-12T01:00:00Z' })
  assert.equal(r.revoked_by, 'admin@ndi2')
  assert.equal(r.revoke_reason, 'compromised')
  assert.equal(r.revoked_at, '2026-10-12T01:00:00.000Z')
  assert.equal(resolveGrant(db, { ...KEY, now: '2026-10-12T02:00:00Z' }), null)
  assert.equal(getGrant(db, g1.id).revoked_at, null)
  bad(() => revokeGrant(db, g1.id, {}))
  bad(() => revokeGrant(db, 'nope', { by: 'x' }), 404)
  // revoking twice keeps the first record
  assert.equal(revokeGrant(db, g2.id, { by: 'other' }).revoked_by, 'admin@ndi2')
})

test('replication: unconfirmed peer fails closed until it confirms (E13)', () => {
  const db = fresh()
  const g = issueGrant(db, BASE)
  const q = { ...KEY, now: '2026-10-12T01:00:00Z', peers: ['ndi2'] }
  assert.equal(resolveGrant(db, q), null)
  confirmReplication(db, g.id, 'ndi2')
  confirmReplication(db, g.id, 'ndi2')
  assert.deepEqual(getGrant(db, g.id).replicated_to, ['ndi2'])
  assert.equal(resolveGrant(db, q).id, g.id)
  assert.equal(resolveGrant(db, { ...q, peers: ['ndi2', 'vmixer2o2'] }), null)
})

test('listGrants filters by key fields and active', () => {
  const db = fresh()
  const a = issueGrant(db, BASE)
  issueGrant(db, { ...BASE, project: 'other' })
  revokeGrant(db, a.id, { by: 'admin@ndi2' })
  assert.equal(listGrants(db).length, 2)
  assert.equal(listGrants(db, { project: 'demo' }).length, 1)
  const active = listGrants(db, { active: true, now: '2026-10-12T01:00:00Z' })
  assert.deepEqual(active.map((g) => g.project), ['other'])
})
