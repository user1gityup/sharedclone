// node --test approvals.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrate, requestApproval, decideApproval, getApproval, issueChallenge, isApprovalValid, ApprovalError } from './approvals.mjs'

const T0 = new Date('2026-10-12T10:00:00Z')
const plus = (s) => new Date(T0.getTime() + s * 1000)
function fresh() {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  migrate(db) // idempotent
  const a = requestApproval(db, { kind: 'grant', scope: { project: 'demo', role: 'worker' }, requested_by: 'remote', now: T0, run_id: 'r1' })
  return { db, a }
}
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof ApprovalError && e.code === code)

test('request opens pending with audit; bad requests refused', () => {
  const { db, a } = fresh()
  assert.equal(a.status, 'pending')
  assert.equal(a.run_id, 'r1')
  assert.equal(a.audit[0].action, 'requested')
  assert.deepEqual(getApproval(db, a.id).scope, { project: 'demo', role: 'worker' })
  throwsCode(() => requestApproval(db, { kind: 'nope', scope: { project: 'x' }, requested_by: 'r' }), 'BAD_REQUEST')
  throwsCode(() => requestApproval(db, { kind: 'grant', scope: { project: '*' }, requested_by: 'r' }), 'BAD_REQUEST')
  throwsCode(() => requestApproval(db, { kind: 'grant', scope: { project: 'x' } }), 'BAD_REQUEST')
  assert.equal(getApproval(db, 'missing'), null)
})

test('otp: valid code approves; replay refused', () => {
  const { db, a } = fresh()
  const c = issueChallenge(db, a.id, { method: 'otp', approver: 'alice', now: T0 })
  assert.match(c.code, /^\d{6}$/)
  assert.equal(c.expires_at, plus(600).toISOString())
  const r = decideApproval(db, a.id, { approver: 'alice', method: 'otp', proof: { challenge_id: c.id, code: c.code }, decision: 'approved', now: plus(60) })
  assert.equal(r.status, 'approved')
  assert.equal(r.method, 'otp')
  assert.equal(r.approver, 'alice')
  assert.ok(isApprovalValid(db, a.id, plus(120)))
  // replay against a second request with the same challenge is refused
  const b = requestApproval(db, { kind: 'grant', scope: { project: 'demo' }, requested_by: 'remote', now: T0 })
  throwsCode(() => decideApproval(db, b.id, { approver: 'alice', method: 'otp', proof: { challenge_id: c.id, code: c.code }, decision: 'approved', now: plus(61) }), 'INVALID_PROOF')
  // and against the already-decided one
  throwsCode(() => decideApproval(db, a.id, { approver: 'alice', method: 'otp', proof: { challenge_id: c.id, code: c.code }, decision: 'approved', now: plus(61) }), 'CONFLICT')
})

test('otp: wrong code, expiry, identity binding, single use after failure-free use', () => {
  const { db, a } = fresh()
  const c = issueChallenge(db, a.id, { method: 'otp', approver: 'alice', ttlSeconds: 30, now: T0 })
  const wrong = c.code === '000000' ? '000001' : '000000'
  throwsCode(() => decideApproval(db, a.id, { approver: 'alice', method: 'otp', proof: { challenge_id: c.id, code: wrong }, decision: 'approved', now: plus(5) }), 'INVALID_PROOF')
  throwsCode(() => decideApproval(db, a.id, { approver: 'mallory', method: 'otp', proof: { challenge_id: c.id, code: c.code }, decision: 'approved', now: plus(5) }), 'IDENTITY_MISMATCH')
  throwsCode(() => decideApproval(db, a.id, { approver: 'alice', method: 'otp', proof: { challenge_id: c.id, code: c.code }, decision: 'approved', now: plus(31) }), 'EXPIRED')
  const c2 = issueChallenge(db, a.id, { method: 'otp', approver: 'alice', now: plus(40) })
  throwsCode(() => decideApproval(db, a.id, { approver: 'alice', method: 'link', proof: { challenge_id: c2.id, token: c2.code }, decision: 'approved', now: plus(41) }), 'INVALID_PROOF')
  assert.equal(decideApproval(db, a.id, { approver: 'alice', method: 'otp', proof: { challenge_id: c2.id, code: c2.code }, decision: 'rejected', now: plus(42) }).status, 'rejected')
  throwsCode(() => issueChallenge(db, a.id, { method: 'otp', now: plus(43) }), 'CONFLICT')
  throwsCode(() => issueChallenge(db, a.id, { method: 'pm_ui' }), 'BAD_REQUEST')
})

test('link: token single use; replay refused with REPLAY', () => {
  const { db, a } = fresh()
  const c = issueChallenge(db, a.id, { method: 'link', now: T0 })
  assert.ok(c.token.length >= 40)
  const c2 = issueChallenge(db, a.id, { method: 'link', now: T0 })
  // consume c on an approval that then stays pending via a different failure path is not possible; consume directly:
  decideApproval(db, a.id, { approver: 'bob', method: 'link', proof: { challenge_id: c.id, token: c.token }, decision: 'approved', now: plus(1) })
  assert.equal(getApproval(db, a.id).status, 'approved')
  // a fresh challenge on a new request, used twice
  const b = requestApproval(db, { kind: 'elevation', scope: { project: 'demo' }, requested_by: 'remote', now: T0 })
  const cb = issueChallenge(db, b.id, { method: 'link', now: T0 })
  const relay = decideApproval(db, b.id, { approver: 'bob', proof: { via: 'chatgpt' }, decision: 'approved', now: plus(1) })
  assert.equal(relay.status, 'pending_user_confirm')
  decideApproval(db, b.id, { approver: 'bob', method: 'link', proof: { challenge_id: cb.id, token: cb.token }, decision: 'approved', now: plus(2) })
  assert.ok(c2.id) // unused challenge remains harmless
  const d = requestApproval(db, { kind: 'grant', scope: { project: 'demo' }, requested_by: 'remote', now: T0 })
  const cd = issueChallenge(db, d.id, { method: 'link', now: T0 })
  db.prepare('UPDATE approval_challenges SET used_at = ? WHERE id = ?').run(plus(1).toISOString(), cd.id)
  throwsCode(() => decideApproval(db, d.id, { approver: 'bob', method: 'link', proof: { challenge_id: cd.id, token: cd.token }, decision: 'approved', now: plus(2) }), 'REPLAY')
})

test('ChatGPT-relayed decision stays pending_user_confirm until a human confirms', () => {
  const { db, a } = fresh()
  const r = decideApproval(db, a.id, { approver: 'alice', method: 'pm_ui', proof: { via: 'chatgpt', approver: 'alice' }, decision: 'approved', now: plus(1) })
  assert.equal(r.status, 'pending_user_confirm')
  assert.equal(r.relayed_decision.via, 'chatgpt')
  assert.equal(r.approver, undefined)
  assert.equal(isApprovalValid(db, a.id, plus(2)), false)
  // another relay cannot confirm it
  throwsCode(() => decideApproval(db, a.id, { approver: 'alice', proof: { relayed: true }, decision: 'approved', now: plus(2) }), 'CONFLICT')
  // a different human cannot confirm someone else's relayed decision
  throwsCode(() => decideApproval(db, a.id, { approver: 'eve', method: 'pm_ui', proof: { approver: 'eve' }, decision: 'approved', now: plus(3) }), 'IDENTITY_MISMATCH')
  const ok = decideApproval(db, a.id, { approver: 'alice', method: 'interactive', proof: { approver: 'alice' }, decision: 'approved', now: plus(4) })
  assert.equal(ok.status, 'approved')
  assert.ok(ok.audit.some((e) => e.action === 'relayed_decision'))
  assert.ok(ok.audit.some((e) => e.action === 'confirmed_approved'))
})

test('pm_ui/interactive need proof bound to approver; authorize hook gates power; validity expires', () => {
  const { db, a } = fresh()
  throwsCode(() => decideApproval(db, a.id, { approver: 'alice', method: 'pm_ui', proof: {}, decision: 'approved', now: plus(1) }), 'INVALID_PROOF')
  throwsCode(() => decideApproval(db, a.id, { approver: 'alice', method: 'pm_ui', proof: { approver: 'bob' }, decision: 'approved', now: plus(1) }), 'INVALID_PROOF')
  throwsCode(() => decideApproval(db, a.id, { approver: 'alice', method: 'cookie', proof: { approver: 'alice' }, decision: 'approved', now: plus(1) }), 'BAD_REQUEST')
  throwsCode(() => decideApproval(db, a.id, { approver: 'w1', method: 'pm_ui', proof: { approver: 'w1' }, decision: 'approved', now: plus(1), authorize: () => false }), 'FORBIDDEN')
  throwsCode(() => decideApproval(db, a.id, { approver: 'alice', method: 'pm_ui', proof: { approver: 'alice' }, decision: 'maybe' }), 'BAD_REQUEST')
  throwsCode(() => decideApproval(db, 'missing', { approver: 'alice', method: 'pm_ui', proof: { approver: 'alice' }, decision: 'approved' }), 'NOT_FOUND')
  const r = decideApproval(db, a.id, { approver: 'alice', method: 'pm_ui', proof: { approver: 'alice' }, decision: 'approved', now: plus(1), validSeconds: 60, authorize: (who) => who === 'alice' })
  assert.equal(r.valid_until, plus(61).toISOString())
  assert.ok(isApprovalValid(db, a.id, plus(30)))
  assert.equal(isApprovalValid(db, a.id, plus(61)), false)
  assert.equal(getApproval(db, a.id).status, 'expired')
})
