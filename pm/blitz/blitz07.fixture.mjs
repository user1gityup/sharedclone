// Shared test world for BLITZ-07 tests (Claude Opus 5.5). Not a test file itself.
import { DatabaseSync } from 'node:sqlite'
import { openStore } from '../store.mjs'
import * as approvals from '../approvals.mjs'
import { scopeHash } from './gate.mjs'
import { createAgentRegistry } from './agents.mjs'
import { createController } from './controller.mjs'

export const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
export const T0 = Date.parse('2026-10-25T06:00:00Z')
const MACHINES = new Set(['vmixer2o2', 'ndi2'])

export const DEFAULT_AGENTS = [
  { name: 'Ada', role: 'builder', max_concurrent: 2 },
  { name: 'Vera', role: 'verifier', max_concurrent: 1 },
]

/** `deps` may be a function (env) => deps, so a verify built on env.store.db can be plugged in. */
export function world({ agents = DEFAULT_AGENTS, deps = {} } = {}) {
  let now = T0
  const clock = () => new Date(now)
  const store = openStore(':memory:', { clock })
  const ledger = new DatabaseSync(':memory:')
  approvals.migrate(ledger)
  const registry = createAgentRegistry(store.db, { store, machines: MACHINES, clock })
  for (const a of agents) registry.create(W, { machine: 'vmixer2o2', transport: 'dsh-run', model_policy: { policy: 'FREE_FIRST' }, max_concurrent: 1, ...a })
  const p = store.createProject(W, { name: 'proj' })
  const escalations = []
  const env = { store, ledger, registry, p, clock, escalations }
  env.escalate = async (problem) => { escalations.push(problem); return { escalated: false } }
  const d = typeof deps === 'function' ? deps(env) : deps
  env.ctl = createController({ store, ledgerDb: () => ledger, registry, clock, escalate: env.escalate, ...d })
  env.task = (title, blitz = {}, extra = {}) => {
    now += 1000
    return store.createTask(W, { project: p.id, title, body: `${title} body`, meta: { blitz: { role: 'builder', ...blitz } }, ...extra })
  }
  const req = (kind, t, merge_limit) => {
    const a = approvals.requestApproval(ledger, {
      kind, requested_by: 'Claude Opus 5.5', now: new Date(now),
      scope: { project: t.project_id, task_id: t.id, task_rev: t.rev, scope_hash: scopeHash(t), scope: { repo: 'r', branch: 'b', files: ['pm/blitz/x.mjs'], summary: 's' }, permissions: ['fs_write'], version: 'v1', merge_limit },
    })
    return approvals.decideApproval(ledger, a.id, { approver: 'ada', method: 'pm_ui', proof: { approver: 'ada' }, decision: 'approved', now: new Date(now) })
  }
  env.approve = (t, merge_limit = 'local_commit') => req('task_scope', t, merge_limit)
  env.approveMerge = (t, merge_limit = 'local_commit') => req('task_merge', t, merge_limit)
  env.advance = (s) => { now += s * 1000 }
  env.launch = ({ roster = ['Ada', 'Vera'], tasks } = {}) => {
    const c = env.ctl.create(W, { projects: [p.id], roster, ...(tasks ? { tasks } : {}) })
    const pf = env.ctl.preflight(W, c.id, { rev: c.rev })
    return env.ctl.launch(W, c.id, { rev: pf.rev, authorizedBy: 'user' })
  }
  return env
}

/** Fake dispatch: reports a result naming an isolated per-task worktree, repo and branch. */
export const fakeDispatch = (extra = {}) => async (task, ctx) => ({
  ref: `run-${task.id}-${ctx.attempt}`,
  result: { workspace: `C:\\wt\\${task.id}`, repo: 'C:\\repos\\app', branch: `blitz/${task.id}`, artifacts: [], ...(typeof extra === 'function' ? extra(task, ctx) : extra) },
})

/** Fake runner: maps a command to {exitCode, stdout, stderr, timedOut?}; records every call. */
export function fakeRun(table = {}) {
  const calls = []
  const run = async (cmd, opts) => {
    calls.push({ cmd, ...opts })
    const r = typeof table === 'function' ? table(cmd, opts) : table[cmd]
    return r ?? { exitCode: 0, stdout: `ok ${cmd}`, stderr: '' }
  }
  run.calls = calls
  return run
}

/** Review that passes every acceptance criterion as `agent`. */
export const passReview = (agent = 'Vera') => async ({ acceptance, verifier }) => ({ agent: agent ?? verifier.name, verdict: 'pass', criteria: acceptance.map((criterion) => ({ criterion, met: true })) })
