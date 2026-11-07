// node --test blitz/gate.test.mjs   (run from pm/)
// Per-task approval kinds (approvals.mjs) and the no-bypass gate (gate.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openStore, PmError } from '../store.mjs'
import * as approvals from '../approvals.mjs'
import { scopeHash, isGoverned, addGoverned, assertTaskApproved, approvalStatus, guardRequest } from './gate.mjs'
import { rateTask } from './rating.mjs'

const GOOD = {
  priority: 2, effort: 2, complexity: 2, risk: 2, resources: {}, dependency: { depends_on: [] },
  verification: { level: 'unit' }, rationale: 'r',
}

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const T0 = new Date('2026-10-19T06:00:00Z')
const plus = (s) => new Date(T0.getTime() + s * 1000)
const DAY = 86400

function env() {
  const dir = mkdtempSync(join(tmpdir(), 'pm-gate-'))
  const store = openStore(join(dir, 'pm.db'))
  const db = new DatabaseSync(':memory:')
  approvals.migrate(db)
  const p = store.createProject(W, { name: 'blitz' })
  const task = (meta = { blitz: {} }) => store.createTask(W, { project: p.id, title: 'build it', body: 'scope text', meta })
  return { store, db, p, task, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}
const scopeFor = (t, extra = {}) => ({
  project: t.project_id, task_id: t.id, task_rev: t.rev, scope_hash: scopeHash(t),
  scope: { repo: '~/.claude/shared-brain', branch: 'blitz-03', files: ['pm/blitz/*.mjs'], summary: 's' },
  permissions: ['fs_write', 'run_tests', 'git_commit_local'], version: 'd62a0b9f', merge_limit: 'queue_gatekeeper', ...extra,
})
const request = (db, t, kind = 'task_scope', extra = {}, now = T0) => approvals.requestApproval(db, { kind, scope: scopeFor(t, extra), requested_by: 'Claude Opus 5.5', now })
const approve = (db, id, now = T0, validSeconds) => approvals.decideApproval(db, id, { approver: 'ada', method: 'pm_ui', proof: { approver: 'ada' }, decision: 'approved', now, validSeconds })
const refused = (fn, re) => assert.throws(fn, (e) => e instanceof PmError && e.status === 409 && e.extra.code === 'APPROVAL_REQUIRED' && (!re || re.test(e.message)))
const badReq = (fn) => assert.throws(fn, (e) => e instanceof approvals.ApprovalError && e.code === 'BAD_REQUEST')

test('task_scope request validation: push, open globs, empty files, bad hash refused', () => {
  const { db, task, done } = env()
  try {
    const t = task()
    for (const merge_limit of ['push', 'merge_main', '*', undefined]) badReq(() => request(db, t, 'task_scope', { merge_limit }))
    for (const files of [[], ['**'], ['*'], ['**/*'], [''], 'pm/x'])
      badReq(() => request(db, t, 'task_scope', { scope: { repo: 'r', branch: 'b', files } }))
    badReq(() => request(db, t, 'task_scope', { scope_hash: 'abc' }))
    badReq(() => request(db, t, 'task_scope', { task_rev: 0 }))
    badReq(() => request(db, t, 'task_scope', { version: '' }))
    badReq(() => request(db, t, 'task_scope', { permissions: 'all' }))
    const a = request(db, t)
    assert.equal(a.status, 'pending')
    assert.equal(a.scope.task_id, t.id)
  } finally { done() }
})

test('task_merge needs an approved, valid task_scope first', () => {
  const { db, task, done } = env()
  try {
    const t = task()
    assert.throws(() => request(db, t, 'task_merge'), (e) => e.code === 'CONFLICT')
    const s = request(db, t)
    assert.throws(() => request(db, t, 'task_merge'), (e) => e.code === 'CONFLICT')
    approve(db, s.id)
    assert.equal(request(db, t, 'task_merge').status, 'pending')
  } finally { done() }
})

test('gate: missing, pending, relayed, rejected, expired, revoked are all refused', () => {
  const { db, task, done } = env()
  try {
    const t = task()
    refused(() => assertTaskApproved(db, t, 'task_scope', { now: T0 }), /no task_scope approval/)
    const a = request(db, t)
    refused(() => assertTaskApproved(db, t, 'task_scope', { now: T0 }), /latest is pending/)
    // a relayed decision (ChatGPT via bridge) never approves
    approvals.decideApproval(db, a.id, { approver: 'ada', proof: { via: 'chatgpt' }, decision: 'approved', now: T0 })
    assert.equal(approvals.getApproval(db, a.id).status, 'pending_user_confirm')
    refused(() => assertTaskApproved(db, t, 'task_scope', { now: T0 }), /pending_user_confirm/)
    approvals.decideApproval(db, a.id, { approver: 'ada', method: 'pm_ui', proof: { approver: 'ada' }, decision: 'rejected', now: T0 })
    refused(() => assertTaskApproved(db, t, 'task_scope', { now: T0 }), /rejected/)

    const b = request(db, t)
    approve(db, b.id)
    assert.equal(approvals.getApproval(db, b.id).valid_until, plus(7 * DAY).toISOString(), 'task_scope default is 7 days')
    assert.equal(assertTaskApproved(db, t, 'task_scope', { now: plus(60) }), true)
    refused(() => assertTaskApproved(db, t, 'task_scope', { now: plus(7 * DAY) }), /expired/)
    assert.equal(approvals.getApproval(db, b.id).status, 'expired')

    const c = request(db, t)
    approve(db, c.id, T0, 365 * DAY)
    assert.equal(approvals.getApproval(db, c.id).valid_until, plus(30 * DAY).toISOString(), 'capped at 30 days')
    approvals.revokeApproval(db, c.id, { actor: 'ada', reason: 'test', now: T0 })
    refused(() => assertTaskApproved(db, t, 'task_scope', { now: T0 }), /revoked/)
  } finally { done() }
})

test('gate: non-material edits keep the approval; a material edit revokes it; forged rev refused', () => {
  const { store, db, task, done } = env()
  try {
    let t = task({ blitz: { scope: { files: ['a'] } } })
    const a = request(db, t)
    approve(db, a.id)
    t = store.claimTask(W, t.id)
    t = store.updateTask(W, t.id, { rev: t.rev, lifecycle: 'RUNNING', next_action: 'go', checkpoint: 'c1' })
    t = rateTask(store, W, t.id, { rev: t.rev, ...GOOD })
    assert.equal(assertTaskApproved(db, store.getTask(t.id), 'task_scope', { now: T0 }), true, 'claim, lifecycle, next_action, rating are not material')

    t = store.updateTask(W, t.id, { rev: t.rev, body: 'scope text, widened' })
    refused(() => assertTaskApproved(db, t, 'task_scope', { now: T0 }), /older scope/)
    const after = approvals.getApproval(db, a.id)
    assert.equal(after.status, 'revoked')
    assert.equal(after.audit.at(-1).detail, 'scope_changed')

    // meta.blitz.scope is material too
    const u = task({ blitz: { scope: { files: ['a'] } } })
    approve(db, request(db, u).id)
    const u2 = store.updateTask(W, u.id, { rev: u.rev, meta: { blitz: { scope: { files: ['a', 'b'] } } } })
    refused(() => assertTaskApproved(db, u2, 'task_scope', { now: T0 }), /older scope/)

    // an approval naming a rev newer than the task is forged
    const v = task()
    approve(db, request(db, v, 'task_scope', { task_rev: v.rev + 5 }).id)
    refused(() => assertTaskApproved(db, v, 'task_scope', { now: T0 }), /newer than the task/)
  } finally { done() }
})

test('renewal: an approved superseding request revokes the old one and passes', () => {
  const { store, db, task, done } = env()
  try {
    let t = task()
    const old = request(db, t)
    approve(db, old.id)
    t = store.updateTask(W, t.id, { rev: t.rev, body: 'new scope' })
    const renewal = request(db, t, 'task_scope', { supersedes: old.id })
    badReq(() => request(db, t, 'task_scope', { supersedes: 'nope' }))
    assert.equal(approvals.getApproval(db, old.id).status, 'approved', 'old holds until the renewal is approved')
    approve(db, renewal.id)
    const o = approvals.getApproval(db, old.id)
    assert.equal(o.status, 'revoked')
    assert.match(o.audit.at(-1).detail, new RegExp(`superseded by ${renewal.id}`))
    assert.equal(assertTaskApproved(db, t, 'task_scope', { now: T0 }), true)
  } finally { done() }
})

test('merge limit: task_merge is checked and the merge action may not exceed merge_limit', () => {
  const { db, task, done } = env()
  try {
    const t = task()
    approve(db, request(db, t, 'task_scope').id)
    refused(() => assertTaskApproved(db, t, 'task_merge', { now: T0, mergeAction: 'local_commit' }), /no task_merge/)
    const m = request(db, t, 'task_merge', { merge_limit: 'local_commit' })
    approve(db, m.id)
    assert.equal(approvals.getApproval(db, m.id).valid_until, plus(2 * DAY).toISOString(), 'task_merge default is 2 days')
    assert.equal(assertTaskApproved(db, t, 'task_merge', { now: T0, mergeAction: 'local_commit' }), true)
    refused(() => assertTaskApproved(db, t, 'task_merge', { now: T0, mergeAction: 'queue_gatekeeper' }), /exceeds/)
    refused(() => assertTaskApproved(db, t, 'task_merge', { now: T0, mergeAction: 'push' }), /exceeds/)
    const s = approvalStatus(db, t, { now: T0 })
    assert.equal(s.task_scope.ok, true)
    assert.equal(s.task_merge.ok, true)
  } finally { done() }
})

test('governance: project table or meta.blitz; stripping meta in a governed project is still gated', () => {
  const { store, db, task, p, done } = env()
  try {
    const plain = task({})
    assert.equal(isGoverned(db, plain), false)
    guardRequest(db, store, 'POST', `/api/tasks/${plain.id}/start`) // not governed -> no throw
    const marked = task({ blitz: {} })
    assert.equal(isGoverned(db, marked), true)
    assert.equal(isGoverned(null, marked), true)
    refused(() => guardRequest(db, store, 'POST', `/api/tasks/${marked.id}/start`))
    refused(() => guardRequest(null, store, 'POST', `/api/tasks/${marked.id}/start`), /ledger is unavailable/)

    addGoverned(db, p.id, 'ada')
    const stripped = store.updateTask(W, marked.id, { rev: marked.rev, meta: {} })
    assert.equal(isGoverned(db, stripped), true)
    for (const a of ['start', 'resume', 'continue', 'runs']) refused(() => guardRequest(db, store, 'POST', `/api/tasks/${plain.id}/${a}`))
    guardRequest(db, store, 'POST', `/api/tasks/${plain.id}/prepare`) // prepare spends nothing
    guardRequest(db, store, 'GET', `/api/tasks/${plain.id}/runs`)
  } finally { done() }
})
