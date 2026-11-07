// node --test "blitz/integrate.test.mjs"   (run from pm/)   BLITZ-07, Claude Opus 5.5
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PmError } from '../store.mjs'
import { createVerifier } from './verify.mjs'
import { createIntegrator, createGitRunner, assessRisk } from './integrate.mjs'
import { createReleaser, categoryOf } from './release.mjs'
import { verifyRoutes } from './verify-routes.mjs'
import { DEFAULT_PUSH_REQUESTS } from './discovery.mjs'
import { W, world, fakeDispatch, fakeRun, passReview } from './blitz07.fixture.mjs'

const REPO = 'C:\\repos\\app'
const BLITZ = { checks: ['npm test'], acceptance: ['tests pass'] }

/** Fake git: per-branch diff + conflict list; records every call; any push argv would throw. */
function fakeGit(branches = {}) {
  const calls = []
  let n = 0
  const g = {
    calls, merges: [],
    async mergeTree(repo, target, branch) { calls.push(['merge-tree', repo, target, branch]); const b = branches[branch] ?? {}; return b.conflicts?.length ? { clean: false, conflicts: b.conflicts } : { clean: true, conflicts: [] } },
    async diff(repo, target, branch) { calls.push(['diff', repo, target, branch]); const b = branches[branch] ?? {}; return { files: b.files ?? [{ path: 'src/a.mjs', added: 3, deleted: 1 }], text: b.text ?? '+x' } },
    async merge(repo, target, branch) { calls.push(['merge', repo, target, branch]); const commit = `c0ffee${String(++n).padStart(4, '0')}`; g.merges.push({ repo, target, branch, commit }); return { commit } },
  }
  return g
}

/** Campaign with N verified tasks (through the real controller tick + verifier). */
async function verifiedWorld(n = 1, { blitz = BLITZ } = {}) {
  const env = world({
    deps: (e) => ({ dispatch: fakeDispatch(), verify: createVerifier({ db: e.store.db, run: fakeRun(), review: passReview(), clock: e.clock }) }),
  })
  const tasks = []
  for (let i = 0; i < n; i++) { const t = env.task(`feat ${i}`, blitz); env.approve(t); tasks.push(t) }
  env.ctl.registry.update(W, 'Ada', { rev: 1, max_concurrent: 4 })
  const c = env.launch()
  await env.ctl.tick(W, c.id, {})
  for (const t of tasks) assert.equal(env.ctl.store.task(c.id, t.id).state, 'verified')
  return { env, c, tasks }
}

const integrator = (env, git, rules = { [REPO]: { target: 'main', allowMerge: true } }) =>
  createIntegrator({ db: env.store.db, store: env.store, ledgerDb: () => env.ledger, git, rules, controller: env.ctl, clock: env.clock })

test('merge without task_merge approval -> blocked; with approval -> merged; never pushes', async () => {
  const { env, c, tasks: [t] } = await verifiedWorld()
  const git = fakeGit()
  const integ = integrator(env, git)
  assert.equal(integ.enqueueVerified(W, c.id).length, 1)
  let out = await integ.process(W, { repo: REPO })
  assert.equal(out.merged.length, 0)
  assert.match(out.blocked[0].reason, /^approval: no task_merge approval/)
  assert.equal(git.merges.length, 0)

  env.approveMerge(t)
  integ.retry(W, c.id, t.id, { reason: 'merge approved' })
  out = await integ.process(W, { repo: REPO })
  assert.equal(out.merged.length, 1)
  assert.equal(integ.queue({ campaignId: c.id })[0].state, 'merged')
  assert.ok(git.calls.every((x) => !x.includes('push')))
  assert.equal(env.ctl.events(c.id, { kind: 'integration_merged' }).length, 1)
})

test('idempotent merge on retry: a crash after merge never merges twice', async () => {
  const { env, c, tasks: [t] } = await verifiedWorld()
  env.approveMerge(t)
  const git = fakeGit()
  const integ = integrator(env, git)
  integ.enqueue(W, c.id, t.id)
  assert.equal(integ.enqueue(W, c.id, t.id).replayed, true)
  const first = await integ.process(W, { repo: REPO })
  // simulate a crash between the merge and the queue-state write
  env.store.db.prepare("UPDATE blitz_integration SET state = 'queued' WHERE task_id = ?").run(t.id)
  const second = await integ.process(W, { repo: REPO })
  assert.equal(git.merges.length, 1)
  assert.equal(second.merged[0].replayed, true)
  assert.equal(second.merged[0].commit, first.merged[0].commit)
})

test('conflict -> blocked with files; later entries still merge', async () => {
  const { env, c, tasks } = await verifiedWorld(2)
  for (const t of tasks) env.approveMerge(t)
  const git = fakeGit({ [`blitz/${tasks[0].id}`]: { conflicts: ['src/a.mjs'] } })
  const integ = integrator(env, git)
  integ.enqueueVerified(W, c.id)
  const out = await integ.process(W, { repo: REPO })
  assert.match(out.blocked[0].reason, /^conflict: .*src\/a\.mjs/)
  assert.deepEqual(out.merged.map((m) => m.task_id), [tasks[1].id])
})

test('repo rules: none or allowMerge false -> blocked, never defaulted', async () => {
  const { env, c, tasks: [t] } = await verifiedWorld()
  env.approveMerge(t)
  let integ = integrator(env, fakeGit(), {})
  integ.enqueueVerified(W, c.id)
  let out = await integ.process(W, { repo: REPO })
  assert.match(out.blocked[0].reason, /no repo rules/)
  integ = integrator(env, fakeGit(), { [REPO]: { target: 'main', allowMerge: false } })
  integ.retry(W, c.id, t.id)
  out = await integ.process(W, { repo: REPO })
  assert.match(out.blocked[0].reason, /does not allow/)
})

test('risky change -> needs_review; builder may not review; other reviewer unblocks', async () => {
  const { env, c, tasks: [t] } = await verifiedWorld()
  env.approveMerge(t)
  const git = fakeGit({ [`blitz/${t.id}`]: { files: [{ path: 'pm/migrations/004.sql', added: 10, deleted: 0 }] } })
  const integ = integrator(env, git)
  integ.enqueueVerified(W, c.id)
  let out = await integ.process(W, { repo: REPO })
  assert.match(out.needs_review[0].reason, /migration/)
  const e = integ.queue({ campaignId: c.id })[0]
  assert.equal(e.state, 'needs_review')
  assert.throws(() => integ.review(W, c.id, t.id, { reviewer: 'Ada', decision: 'approved', fingerprint: e.fingerprint }), (x) => x instanceof PmError && x.status === 403)
  assert.throws(() => integ.review(W, c.id, t.id, { reviewer: 'Vera', decision: 'approved', fingerprint: 'stale' }), (x) => x.status === 409)
  assert.equal(integ.review(W, c.id, t.id, { reviewer: 'Vera', decision: 'approved', fingerprint: e.fingerprint }).state, 'queued')
  out = await integ.process(W, { repo: REPO })
  assert.equal(out.merged.length, 1)
})

test('risk classifier', () => {
  assert.equal(assessRisk({ files: [{ path: 'src/a.mjs', added: 1, deleted: 1 }], text: '+a' }).risky, false)
  assert.match(assessRisk({ files: [{ path: '.github/workflows/ci.yml', added: 1, deleted: 0 }] }).reasons[0], /protected/)
  assert.match(assessRisk({ files: [{ path: 'a.mjs', added: 900, deleted: 0 }] }).reasons[0], /large diff/)
  assert.match(assessRisk({ files: [{ path: 'a.mjs', added: 1, deleted: 0 }], text: '+const api_key = "abcdefghijk"' }).reasons[0], /secret/)
  assert.match(assessRisk({ files: [{ path: 'conf/.env.local', added: 1, deleted: 0 }] }).reasons.join(), /secret-like/)
  assert.equal(assessRisk({ files: [{ path: 'a.mjs', added: 900, deleted: 0 }] }, { maxDiffLines: 1000 }).risky, false)
})

test('only verified tasks enter the queue', async () => {
  const env = world({ deps: (e) => ({ dispatch: fakeDispatch(), verify: createVerifier({ db: e.store.db, run: fakeRun(), review: null, clock: e.clock }) }) })
  const t = env.task('x', BLITZ); env.approve(t)
  const c = env.launch()
  await env.ctl.tick(W, c.id, {})
  assert.equal(env.ctl.store.task(c.id, t.id).state, 'awaiting_verification')
  const integ = integrator(env, fakeGit())
  assert.throws(() => integ.enqueue(W, c.id, t.id), (x) => x.status === 409)
  assert.deepEqual(integ.enqueueVerified(W, c.id), [])
})

test('release: per-repo record + cross-project summary; gatekeeper text only with queue_gatekeeper approval', async () => {
  const { env, c, tasks } = await verifiedWorld(2)
  env.approveMerge(tasks[0], 'queue_gatekeeper')
  const git = fakeGit()
  const integ = integrator(env, git)
  integ.enqueueVerified(W, c.id)
  await integ.process(W, { repo: REPO }) // tasks[1] has no merge approval -> blocked
  const pushQueueBefore = existsSync(DEFAULT_PUSH_REQUESTS) ? statSync(DEFAULT_PUSH_REQUESTS).mtimeMs : null
  const rel = createReleaser({ db: env.store.db, store: env.store, ledgerDb: () => env.ledger, clock: env.clock })
  const r = rel.create(W, { campaigns: [c.id] })
  assert.equal(r.pushed, false)
  assert.equal(r.deployed, false)
  assert.equal(r.repos[0].merged.length, 1)
  assert.equal(r.repos[0].held.length, 1)
  assert.match(r.repos[0].gatekeeper_request, /^## C:\\repos\\app — main\nFiled: .* by Claude Opus 5.5\nStatus: open/)
  assert.equal(r.summary.counts.verified, 1)
  assert.equal(r.summary.counts.blocked, 1)
  const t0 = r.summary.tasks.find((x) => x.task_id === tasks[0].id)
  assert.equal(t0.verifier, 'Vera')
  assert.ok(t0.evidence.event_id && /^[0-9a-f]{64}$/.test(t0.evidence.sha256))
  assert.deepEqual(rel.get(r.id).id, r.id)
  assert.equal(rel.list({ campaign: c.id }).length, 1)
  assert.equal(existsSync(DEFAULT_PUSH_REQUESTS) ? statSync(DEFAULT_PUSH_REQUESTS).mtimeMs : null, pushQueueBefore)

  // a local_commit merge limit gives a release record but no gatekeeper text
  const { env: e2, c: c2, tasks: [u] } = await verifiedWorld()
  e2.approveMerge(u, 'local_commit')
  const i2 = integrator(e2, fakeGit()); i2.enqueueVerified(W, c2.id); await i2.process(W, { repo: REPO })
  const r2 = createReleaser({ db: e2.store.db, store: e2.store, ledgerDb: () => e2.ledger, clock: e2.clock }).create(W, { campaigns: [c2.id] })
  assert.equal(r2.repos[0].gatekeeper_request, null)
  assert.match(r2.repos[0].gatekeeper_blocked, /queue_gatekeeper exceeds the approved merge_limit local_commit/)
  assert.equal(categoryOf('awaiting_verification'), 'unverified')
})

test('routes: evidence, integration queue, process, releases', async () => {
  const { env, c, tasks: [t] } = await verifiedWorld()
  env.approveMerge(t)
  const git = fakeGit()
  const routes = verifyRoutes({ store: env.store, ledgerDb: () => env.ledger, git, rules: { [REPO]: { target: 'main', allowMerge: true } }, clock: env.clock })
  const call = async (method, path, body = {}, q = {}) => {
    const r = routes.find(([m, re]) => m === method && re.test(path))
    assert.ok(r, `${method} ${path}`)
    return r[2](path.match(r[1]), body, W, q)
  }
  assert.equal((await call('GET', `/api/blitz/campaigns/${c.id}/evidence`, {}, { task: t.id })).verdicts.length, 1)
  assert.equal((await call('POST', `/api/blitz/campaigns/${c.id}/integration`)).length, 1)
  assert.equal((await call('GET', '/api/blitz/integration', {}, { campaign: c.id }))[0].state, 'queued')
  assert.equal((await call('POST', '/api/blitz/integration/process', { repo: REPO })).merged.length, 1)
  const rel = await call('POST', '/api/blitz/releases', { campaigns: c.id })
  assert.equal((await call('GET', `/api/blitz/releases/${rel.id}`)).id, rel.id)
  assert.equal((await call('GET', '/api/blitz/releases/summary', {}, { campaigns: c.id })).counts.verified, 1)
  assert.equal(verifyRoutes({}).length, 0)
})

test('real git runner in a temp repo: dry-run conflict detection, CAS merge, no push', async (tt) => {
  try { execFileSync('git', ['--version']) } catch { tt.skip('git not installed'); return }
  const dir = mkdtempSync(join(tmpdir(), 'blitz07-git-'))
  const env0 = { ...process.env }
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Claude Opus 5.5', GIT_AUTHOR_EMAIL: 'noreply@anthropic.com', GIT_COMMITTER_NAME: 'Claude Opus 5.5', GIT_COMMITTER_EMAIL: 'noreply@anthropic.com' })
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
  try {
    g('init', '-q', '-b', 'main'); g('config', 'core.autocrlf', 'false')
    writeFileSync(join(dir, 'a.txt'), 'one\n'); g('add', '.'); g('commit', '-qm', 'base')
    g('checkout', '-qb', 'feat'); writeFileSync(join(dir, 'b.txt'), 'new\n'); g('add', '.'); g('commit', '-qm', 'feat')
    g('checkout', '-q', 'main'); g('checkout', '-qb', 'clash'); writeFileSync(join(dir, 'a.txt'), 'clash\n'); g('commit', '-qam', 'clash')
    g('checkout', '-q', 'main'); writeFileSync(join(dir, 'a.txt'), 'main\n'); g('commit', '-qam', 'main moves')
    const git = createGitRunner()
    assert.equal((await git.mergeTree(dir, 'main', 'feat')).clean, true)
    const cl = await git.mergeTree(dir, 'main', 'clash')
    assert.equal(cl.clean, false)
    assert.deepEqual(cl.conflicts, ['a.txt'])
    assert.deepEqual((await git.diff(dir, 'main', 'feat')).files, [{ path: 'b.txt', added: 1, deleted: 0 }])
    await assert.rejects(git.merge(dir, 'main', 'feat', { message: 'm' }), /checked out/)
    g('checkout', '-q', '--detach')
    const before = g('rev-parse', 'main')
    const m = await git.merge(dir, 'main', 'feat', { message: 'blitz merge' })
    assert.equal(m.previous, before)
    assert.equal(g('rev-parse', 'main'), m.commit)
    assert.equal(g('rev-list', '--parents', '-n', '1', 'main').split(' ').length, 3)
    assert.equal(g('remote'), '')
  } finally {
    for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) { if (env0[k] === undefined) delete process.env[k]; else process.env[k] = env0[k] }
    rmSync(dir, { recursive: true, force: true })
  }
})
