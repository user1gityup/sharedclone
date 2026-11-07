// node --test agent-access.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import * as A from './agent-access.mjs'
import * as R from './roles.mjs'

const NOW = new Date('2026-11-01T10:00:00Z')
const LATER = new Date('2026-12-01T10:00:00Z')
const HOUR = new Date(NOW.getTime() + 3600_000)
const proofs = { good: { agent_id: 'fc1', machine: 'vmixer' }, otherMachine: { agent_id: 'fc1', machine: 'ndi2' }, otherAgent: { agent_id: 'zzz', machine: 'vmixer' } }
const ctx = (o = {}) => ({ now: NOW, verifyDshProof: (p) => proofs[p] ?? null, ...o })

function setup() {
  const db = new DatabaseSync(':memory:')
  A.migrateAgentAccess(db); R.migrate(db)
  R.assignRole(db, { identity: 'alice', role: 'worker', by: 'root' })
  A.registerAgent(db, { agent_id: 'fc1', seat: 'free-claude', machine: 'vmixer', human_owner: 'alice', by: 'root', now: NOW })
  return db
}
const call = (db, tok, o = {}, c = ctx()) => A.authorize(db, { entry: 'rest', token: tok, proof: 'good', action: 'read', project: 'P1', ...o }, c)
const mint = (db, scopes = [{ project: 'P1', action: 'read' }]) => A.issueToken(db, { agent_id: 'fc1', scopes, by: 'root', now: NOW }).token

test('no grant, no access; granted read works with audit of actor/seat/machine/action/target', () => {
  const db = setup()
  assert.throws(() => A.issueToken(db, { agent_id: 'fc1', scopes: [{ project: 'P1', action: 'read' }], by: 'root', now: NOW }), /no live grant/)
  A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'read', expires_at: LATER, by: 'root', now: NOW })
  A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'update', expires_at: LATER, by: 'root', now: NOW })
  const tok = mint(db, [{ project: 'P1', action: 'read' }, { project: 'P1', action: 'update' }])
  assert.equal(call(db, tok).allow, true)
  const r = call(db, tok, { action: 'update', target: 'T-1' })
  assert.equal(r.allow, true); assert.equal(r.on_behalf_of, 'alice')
  const last = A.auditLog(db, { agent_id: 'fc1', outcome: 'allow' }).pop()
  assert.deepEqual([last.seat, last.machine, last.action, last.target, last.entry], ['free-claude', 'vmixer', 'update', 'T-1', 'rest'])
})

test('least privilege: ungranted action/project/wildcard/unknown action denied; sensitive needs approval', () => {
  const db = setup()
  A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'read', expires_at: LATER, by: 'root', now: NOW })
  const tok = mint(db)
  assert.equal(call(db, tok, { action: 'update' }).allow, false)
  assert.equal(call(db, tok, { project: 'P2' }).allow, false)
  assert.equal(call(db, tok, { project: '*' }).allow, false)
  assert.equal(call(db, tok, { action: 'dsh_swarm' }).reason, 'action is not a governed PM action')
  assert.throws(() => A.grantAction(db, { agent_id: 'fc1', project: '*', action: 'read', expires_at: LATER, by: 'r', now: NOW }), /wildcard/)
  assert.throws(() => A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'complete', expires_at: LATER, by: 'r', now: NOW }), /approval_id/)
})

test('free seat or hostname alone grants nothing; DSH proof required and must match agent and machine', () => {
  const db = setup()
  A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'read', expires_at: LATER, by: 'root', now: NOW })
  const tok = mint(db)
  assert.match(call(db, tok, { proof: undefined }).reason, /proof/)
  assert.match(call(db, tok, { proof: 'otherAgent' }).reason, /proof/)
  assert.match(call(db, tok, { proof: 'otherMachine' }).reason, /different machine/)
  assert.equal(call(db, null).allow, false)
  assert.equal(call(db, 'pmat_bogus').allow, false)
})

test('human owner role is a ceiling: worker cannot complete even with an approved grant', () => {
  const db = setup()
  A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'complete', approval_id: 'AP1', expires_at: LATER, by: 'root', now: NOW })
  const tok = mint(db, [{ project: 'P1', action: 'complete' }])
  const r = call(db, tok, { action: 'complete' })
  assert.equal(r.allow, false); assert.match(r.reason, /human owner/)
  R.assignRole(db, { identity: 'alice', role: 'manager', project: 'P1', by: 'root' })
  assert.equal(call(db, tok, { action: 'complete' }).allow, true)
})

test('expired token, expired grant, revoked grant/token/agent are denied on every entry point', () => {
  const db = setup()
  const gid = A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'read', expires_at: HOUR, by: 'root', now: NOW })
  const tok = mint(db)
  for (const entry of ['rest', 'mcp', 'bridge']) assert.equal(call(db, tok, { entry }).allow, true)
  assert.match(call(db, tok, {}, ctx({ now: new Date(NOW.getTime() + 2 * 3600_000) })).reason, /no live grant|expired/)
  A.revokeGrant(db, gid, { by: 'root', now: NOW })
  for (const entry of ['rest', 'mcp', 'bridge']) assert.match(call(db, tok, { entry }).reason, /no live grant/)
  const db2 = setup()
  A.grantAction(db2, { agent_id: 'fc1', project: 'P1', action: 'read', expires_at: LATER, by: 'root', now: NOW })
  const t2 = mint(db2); A.revokeToken(db2, t2, { by: 'root', now: NOW })
  assert.match(call(db2, t2).reason, /revoked/)
  const t3 = mint(db2); A.revokeAgent(db2, 'fc1', { by: 'root', now: NOW })
  assert.equal(call(db2, t3).allow, false)
  assert.throws(() => A.issueToken(db2, { agent_id: 'fc1', scopes: [{ project: 'P1', action: 'read' }], by: 'r', now: NOW }), /not registered/)
})

test('token ttl is capped at 24h and tokens are stored hashed; denials never echo the token', () => {
  const db = setup()
  A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'read', expires_at: LATER, by: 'root', now: NOW })
  const { token, expires_at } = A.issueToken(db, { agent_id: 'fc1', scopes: [{ project: 'P1', action: 'read' }], ttlMs: 1e12, by: 'root', now: NOW })
  assert.equal(expires_at, new Date(NOW.getTime() + A.MAX_TOKEN_MS).toISOString())
  assert.equal(db.prepare('SELECT COUNT(*) c FROM agent_tokens WHERE token_hash=?').get(token).c, 0)
  const bad = call(db, token, { action: 'update' })
  assert.ok(!JSON.stringify(bad).includes(token))
  assert.ok(!JSON.stringify(A.auditLog(db)).includes(token))
})

test('permission matrix lists live grants only; audit is append-only', () => {
  const db = setup()
  A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'read', expires_at: LATER, by: 'root', now: NOW })
  const g = A.grantAction(db, { agent_id: 'fc1', project: 'P1', action: 'update', expires_at: LATER, by: 'root', now: NOW })
  A.revokeGrant(db, g, { by: 'root', now: NOW })
  assert.deepEqual(A.permissionMatrix(db, 'fc1', NOW), { P1: ['read'] })
  assert.throws(() => db.exec('DELETE FROM access_audit'), /append-only/)
})
