// Integration tests: the Step 2 modules wired together through permissions.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateAll, workerPermissions, wireBrainWriteApprovals, UNSCOPED_PROJECT } from './permissions.mjs'
import * as approvals from './approvals.mjs'
import * as notify from './notify.mjs'
import * as lc from './bridge/lifecycle.mjs'
import { brainWrite } from './brain-write.mjs'

test('migrateAll is idempotent and creates every permission table', () => {
  const db = new DatabaseSync(':memory:')
  migrateAll(db)
  migrateAll(db)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  for (const t of ['grants', 'approvals', 'approval_challenges', 'role_assignments', 'notify_events', 'notify_marks']) {
    assert.ok(tables.includes(t), `missing table ${t}`)
  }
})

test('worker requestApproval records a pending C2 approval, never under project *', () => {
  const db = new DatabaseSync(':memory:')
  const { requestApproval } = workerPermissions(db)
  const a = requestApproval({ kind: 'permission_resume', run_id: 'r1', session_id: 'S1', requested_by: 'worker@test', scope: { project: null, tools: ['Write'] } })
  assert.equal(a.status, 'pending')
  assert.equal(a.scope.project, UNSCOPED_PROJECT)
  assert.equal(approvals.getApproval(db, a.id).run_id, 'r1')
})

test('resume gate: only an approved permission_resume approval for the same run passes', () => {
  const db = new DatabaseSync(':memory:')
  const { requestApproval, approvalValid } = workerPermissions(db)
  const a = requestApproval({ kind: 'permission_resume', run_id: 'r9', session_id: 'S9', requested_by: 'worker@test', scope: { project: 'p' } })
  assert.equal(approvalValid(a.id, 'r9'), false, 'pending approval does not resume')
  approvals.decideApproval(db, a.id, { approver: 'alice', method: 'pm_ui', proof: { approver: 'alice' }, decision: 'approved' })
  assert.equal(approvalValid(a.id, 'r9'), true)
  assert.equal(approvalValid(a.id, 'other-run'), false, 'approval is bound to its run')
  assert.equal(approvalValid('no-such-id', 'r9'), false)
  const g = approvals.requestApproval(db, { kind: 'grant', run_id: 'r9', scope: { project: 'p' }, requested_by: 'x' })
  approvals.decideApproval(db, g.id, { approver: 'alice', method: 'pm_ui', proof: { approver: 'alice' }, decision: 'approved' })
  assert.equal(approvalValid(g.id, 'r9'), false, 'wrong approval kind')
})

test('lifecycle terminal states land as notify events through the worker hooks', () => {
  const db = new DatabaseSync(':memory:')
  const toasts = []
  const { hooks } = workerPermissions(db, { toast: (ev) => toasts.push(ev) })
  lc.migrate(db)
  lc.setHooks(hooks)
  try {
    lc.createRun(db, 'r2', { project: 'p', owner: 'alice' })
    for (const s of ['running', 'permission_required', 'awaiting_approval']) lc.transition(db, 'r2', s, s === 'permission_required' ? { session_id: 'S2' } : null)
    const events = notify.list(db, { identity: 'alice' })
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'awaiting_approval')
    assert.equal(toasts.length, 1, 'toast fanout fired once')
  } finally {
    lc.setHooks({})
    notify.setFanout({})
  }
})

test('brain-write handoff gate resolves approvals from the bridge database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-perm-'))
  const saved = { brain: process.env.PM_BRAIN_DIR, audit: process.env.PM_BRAIN_AUDIT, copy: process.env.PM_BRAIN_COPY_DIR }
  process.env.PM_BRAIN_DIR = join(dir, 'brain')
  process.env.PM_BRAIN_AUDIT = join(dir, 'audit.jsonl')
  delete process.env.PM_BRAIN_COPY_DIR
  const dbPath = join(dir, 'bridge.db')
  try {
    const db = new DatabaseSync(dbPath)
    migrateAll(db)
    const req = approvals.requestApproval(db, { kind: 'handoff_write', scope: { project: 'p', path: 'handoff-x.md' }, requested_by: 'claude-code' })
    const ok = approvals.decideApproval(db, req.id, { approver: 'alice', method: 'pm_ui', proof: { approver: 'alice' }, decision: 'approved' })
    assert.equal(ok.status, 'approved')
    db.close()
    const close = wireBrainWriteApprovals(dbPath)
    try {
      assert.throws(() => brainWrite({ path: 'handoff-x.md', content: 'x', actor: 't' }), (err) => err.data?.code === 'APPROVAL_REQUIRED')
      brainWrite({ path: 'handoff-x.md', content: 'x', actor: 't', approval_id: req.id })
      assert.ok(existsSync(join(dir, 'brain', 'handoff-x.md')))
    } finally {
      close()
    }
  } finally {
    for (const [k, v] of [['PM_BRAIN_DIR', saved.brain], ['PM_BRAIN_AUDIT', saved.audit], ['PM_BRAIN_COPY_DIR', saved.copy]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
