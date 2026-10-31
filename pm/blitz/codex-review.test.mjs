// node --test blitz/codex-review.test.mjs   (run from pm/)   Claude Opus 5.5
// Codex independent review + default verification policy + repo integration rules. Codex never runs:
// every Codex process is a fake spawn that writes (or withholds) the last-message file. The end-to-end test
// uses a real temp git repo, a fake bridge-claude builder, real `node --test` checks, the fake Codex verifier,
// and the integrator merging LOCALLY under a rules file loaded the way server.mjs loads it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCodexReview, createDefaultPolicy, deriveAcceptance, parseBodyCriteria, detectRepoChecks, parseVerdict,
  extractJson, lastAgentMessage, codexReviewEngineOptions, DEFAULT_CRITERION, isReviewOnlyKind,
} from './codex-review.mjs'
import { loadRepoRules, normalizedRules } from './repo-rules.mjs'
import { createVerifier } from './verify.mjs'
import { createCampaignStore } from './campaigns.mjs'
import { openStore } from '../store.mjs'
import * as approvals from '../approvals.mjs'
import { scopeHash } from './gate.mjs'
import { createAgentRegistry } from './agents.mjs'
import { ENABLE_ENV, defaultGit, commitWorktree, COMMIT_TRAILER } from './dispatch.mjs'
import { createEngine } from './engine.mjs'
import { blitzMainOptions } from '../server.mjs'

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const quiet = { log() {}, warn() {}, error() {} }
const tmp = (p) => mkdtempSync(join(tmpdir(), p))

/**
 * Fake spawn for Codex. mode: 'pass' | 'unmet' | 'garbage' | 'hang' | 'exit1' | fn(stdin, args) => text.
 * Records every call (cmd, args, stdin). taskkill (timeout cleanup on Windows) is a no-op child.
 */
function fakeCodex(mode, { onlyStdout = false } = {}) {
  const calls = []
  const spawn = (cmd, args) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 4242
    child.kill = () => { child.killed = true }
    if (cmd === 'taskkill') { child.stdin = { end() {} }; setImmediate(() => child.emit('close', 0)); return child }
    const call = { cmd, args, stdin: '' }
    calls.push(call)
    child.stdin = {
      end(input) {
        call.stdin = String(input ?? '')
        if (mode === 'hang') return
        setImmediate(() => {
          const out = args[args.indexOf('--output-last-message') + 1]
          const text = typeof mode === 'function' ? mode(call.stdin, args) : mode === 'garbage' ? 'I think it looks fine overall!' : null
          const crit = [...call.stdin.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ id: Number(m[1]), criterion: m[2] }))
          const body = text ?? JSON.stringify({
            verified: mode === 'pass',
            criteria: crit.map((c, i) => ({ ...c, met: mode === 'pass' ? true : i !== 0, evidence: 'feature.mjs exports add(); node --test exit 0' })),
            reason: mode === 'pass' ? 'all deliverables present' : 'criterion 1 is not met',
          })
          if (onlyStdout) child.stdout.emit('data', `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: body } })}\n`)
          else writeFileSync(out, body)
          child.emit('close', mode === 'exit1' ? 1 : 0)
        })
      },
    }
    return child
  }
  return { spawn, calls }
}

const fakeGit = (calls = []) => async (args) => {
  calls.push(args)
  if (args.includes('rev-parse')) return { code: 0, stdout: 'a'.repeat(40) + '\n', stderr: '' }
  if (args.includes('diff') && args.some((a) => a.endsWith('...HEAD'))) return { code: 0, stdout: 'diff --git a/feature.mjs b/feature.mjs\n+export const add = (a, b) => a + b\n', stderr: '' }
  return { code: 0, stdout: '', stderr: '' }
}

const TASK = { id: 'T-abc123', project_id: 'P-1', title: 'Add an add() helper', body: 'Build add().\n\n## Acceptance\n- add(1,2) returns 3\n- has a unit test\n', meta: JSON.stringify({ repo: 'C:/r' }) }
const RESULT = { worktree: 'C:/runs/c/T-abc123/repo', repo: 'C:/r', branch: 'blitz/c/T-abc123' }
const reviewArgs = (extra = {}) => ({ task: TASK, result: RESULT, verifier: { name: 'Codey', role: 'verifier' }, builders: ['Cleo'], checks: [{ name: 'node-test', cmd: 'node --test', exit_code: 0, cwd: RESULT.worktree, stdout_tail: 'pass 3' }], acceptance: deriveAcceptance(TASK), workspace: RESULT.worktree, ...extra })

test('valid verified verdict: pass, signed by the verifier, read-only codex command, diff + criteria + evidence on stdin', async () => {
  const fc = fakeCodex('pass')
  const gitCalls = []
  const review = createCodexReview({ spawn: fc.spawn, git: fakeGit(gitCalls), entry: { cmd: 'codex', pre: [] }, timeoutMs: 5000 })
  const rv = await review(reviewArgs())
  assert.equal(rv.verdict, 'pass', rv.reason)
  assert.equal(rv.agent, 'Codey')
  assert.equal(rv.criteria.length, 3)
  assert.ok(rv.criteria.every((c) => c.met === true))
  const { args, stdin } = fc.calls[0]
  assert.deepEqual(args.slice(0, 6), ['exec', '--cd', RESULT.worktree, '--sandbox', 'read-only', '--json'])
  assert.equal(args[6], '--output-last-message')
  assert.equal(args.at(-1), '-')
  assert.ok(!args.includes('workspace-write') && !args.includes('--dangerously-bypass-approvals-and-sandbox'))
  assert.match(stdin, /You are Codey, an INDEPENDENT/)
  assert.match(stdin, /1\. The task body's stated deliverables/)
  assert.match(stdin, /2\. add\(1,2\) returns 3/)
  assert.match(stdin, /node --test` exit 0/)
  assert.match(stdin, /\+export const add/)
  assert.ok(gitCalls.some((a) => a.includes(`${'a'.repeat(40)}...HEAD`)), 'diff vs the base commit (repo HEAD)')
  assert.equal(rv.run.exit_code, 0)
  assert.match(review.command(RESULT.worktree, 'X.json', 'Codey').args.join(' '), /^exec --cd \S+ --sandbox read-only --json --output-last-message X\.json -$/)
  // the (task, result, ctx) call form works too
  const rv2 = await review(TASK, RESULT, { verifier: { name: 'Codey' }, builders: ['Cleo'], workspace: RESULT.worktree })
  assert.equal(rv2.verdict, 'pass')
  // stdout JSONL fallback when the last-message file is missing
  const fc3 = fakeCodex('pass', { onlyStdout: true })
  const rv3 = await createCodexReview({ spawn: fc3.spawn, git: fakeGit(), entry: { cmd: 'codex', pre: [] } })(reviewArgs())
  assert.equal(rv3.verdict, 'pass')
})

test('criterion unmet => fail; through createVerifier the task is failed (not verified)', async () => {
  const fc = fakeCodex('unmet')
  const review = createCodexReview({ spawn: fc.spawn, git: fakeGit(), entry: { cmd: 'codex', pre: [] } })
  const rv = await review(reviewArgs())
  assert.equal(rv.verdict, 'fail')
  assert.equal(rv.criteria[0].met, false)

  // the verifier maps it to {failed:true}
  const store = openStore(':memory:')
  const cs = createCampaignStore(store.db)
  const reg = createAgentRegistry(store.db, { store, machines: new Set(['vmixer2o2', 'ndi2']) })
  reg.create(W, { name: 'Cleo', role: 'builder', machine: 'ndi2', transport: 'bridge-claude', model_policy: { policy: 'SUBSCRIPTION_FIRST' }, max_concurrent: 1 })
  reg.create(W, { name: 'Codey', role: 'verifier', machine: 'vmixer2o2', transport: 'codex', model_policy: { policy: 'SUBSCRIPTION_FIRST' }, max_concurrent: 1 })
  const p = store.createProject(W, { name: 'p' })
  const t = store.createTask(W, { project: p.id, title: 'x', body: 'Deliverable: a thing' })
  const verifier = createVerifier({ db: store.db, review, run: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }), policy: createDefaultPolicy({ repoChecks: { [p.id]: ['node --test'] } }) })
  const campaign = { id: 'C-1', roster: ['Cleo', 'Codey'] }
  // verify() writes events into blitz_run_events, which needs the campaign row: use the controller's tables
  const { createController } = await import('./controller.mjs')
  const ctl = createController({ store, verify: verifier })
  const made = ctl.create(W, { id: 'C-1', projects: [p.id], roster: ['Cleo', 'Codey'] })
  assert.equal(made.id, 'C-1')
  const v = await verifier(t, { worktree: tmp('wt-'), repo: 'C:/r' }, { campaign, agent: 'Cleo', attempt: 1, escalate: async () => ({}) })
  assert.equal(v.verified, false)
  assert.equal(v.failed, true, v.reason)
  assert.match(v.reason, /verifier Codey failed it/)
  assert.equal(v.evidence.acceptance_source, 'default-policy')
  assert.deepEqual(v.evidence.acceptance, [DEFAULT_CRITERION, 'a thing'])
})

test('garbage output, nonzero exit, contradictory or partial JSON => uncertain (stays open)', async () => {
  for (const mode of ['garbage', 'exit1']) {
    const rv = await createCodexReview({ spawn: fakeCodex(mode).spawn, git: fakeGit(), entry: { cmd: 'codex', pre: [] } })(reviewArgs())
    assert.equal(rv.verdict, 'uncertain', mode)
  }
  const acc = ['a', 'b']
  assert.equal(parseVerdict('{"verified": true, "criteria": [{"id":1,"met":true}], "reason":"x"}', acc).verdict, 'uncertain', 'b unassessed')
  assert.equal(parseVerdict('{"verified": true, "criteria": [{"id":1,"met":true},{"id":2,"met":false}]}', acc).verdict, 'uncertain', 'contradictory')
  assert.equal(parseVerdict('{"verified": "yes", "criteria": []}', acc).verdict, 'uncertain')
  assert.equal(parseVerdict('{"verified": false, "criteria": [{"id":1,"met":null},{"id":2,"met":null}]}', acc).verdict, 'uncertain')
  assert.equal(parseVerdict('```json\n{"verified": true, "criteria": [{"criterion":"A","met":true},{"criterion":"b.","met":true}]}\n```', acc).verdict, 'pass', 'fenced + normalized text match')
  assert.equal(parseVerdict('', acc).verdict, 'uncertain')
  assert.equal(extractJson('noise {"a":1} tail').a, 1)
  assert.equal(lastAgentMessage('{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}\nnot json\n'), 'hi')
})

test('timeout => uncertain, codex process killed; git failure or no base => uncertain without a codex run', async () => {
  const fc = fakeCodex('hang')
  const rv = await createCodexReview({ spawn: fc.spawn, git: fakeGit(), entry: { cmd: 'codex', pre: [] }, timeoutMs: 50 })(reviewArgs())
  assert.equal(rv.verdict, 'uncertain')
  assert.match(rv.reason, /timed out after 50 ms/)
  assert.equal(rv.run.timed_out, true)

  const fc2 = fakeCodex('pass')
  const badGit = async (args) => (args.includes('diff') ? { code: 128, stdout: '', stderr: 'fatal: bad revision' } : fakeGit()(args))
  const rv2 = await createCodexReview({ spawn: fc2.spawn, git: badGit, entry: { cmd: 'codex', pre: [] } })(reviewArgs())
  assert.equal(rv2.verdict, 'uncertain')
  assert.match(rv2.reason, /git diff .* failed \(128\)/)
  const rv3 = await createCodexReview({ spawn: fc2.spawn, git: fakeGit(), entry: { cmd: 'codex', pre: [] } })(reviewArgs({ result: { worktree: RESULT.worktree } }))
  assert.match(rv3.reason, /no diff base/)
  assert.equal(fc2.calls.length, 0)
})

test('builder == verifier is refused before any codex run; verify.mjs keeps it open', async () => {
  const fc = fakeCodex('pass')
  const review = createCodexReview({ spawn: fc.spawn, git: fakeGit(), entry: { cmd: 'codex', pre: [] } })
  const rv = await review(reviewArgs({ builders: ['Codey'] }))
  assert.equal(rv.verdict, 'uncertain')
  assert.match(rv.reason, /refused: verifier Codey built this task/)
  const rv2 = await review(reviewArgs({ verifier: null }))
  assert.match(rv2.reason, /refused: no verifier agent/)
  assert.equal(fc.calls.length, 0)
})

test('default acceptance derivation from meta or body', () => {
  assert.deepEqual(deriveAcceptance({ meta: JSON.stringify({ blitz: { acceptance: ['own one'] } }), body: '- [ ] ignored' }), ['own one'])
  const body = [
    'Intro paragraph.',
    '- [ ] Landing page renders on mobile',
    '* [x] Contact form posts to /api/contact',
    '',
    '## Acceptance criteria',
    '1. Lighthouse score >= 90',
    '- No console errors',
    '',
    '## Notes',
    '- not a criterion',
    'Deliverable: a deployed preview URL',
    '**Acceptance:** README documents the setup',
  ].join('\n')
  assert.deepEqual(parseBodyCriteria(body), [
    'Landing page renders on mobile', 'Contact form posts to /api/contact', 'Lighthouse score >= 90', 'No console errors',
    'a deployed preview URL', 'README documents the setup',
  ])
  const d = deriveAcceptance({ body })
  assert.equal(d[0], DEFAULT_CRITERION)
  assert.equal(d.length, 7)
  assert.deepEqual(deriveAcceptance({ body: 'just do it' }), [DEFAULT_CRITERION])
  assert.equal(isReviewOnlyKind({ kind: 'Docs' }), true)
  assert.equal(isReviewOnlyKind({ meta: JSON.stringify({ blitz: { kind: 'research' } }) }), true)
  assert.equal(isReviewOnlyKind({ kind: 'coding' }), false)
})

test('repo check detection: npm test, node --test, pytest, none; repoChecks map wins', () => {
  const npm = tmp('det-npm-'); writeFileSync(join(npm, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }))
  assert.deepEqual(detectRepoChecks(npm).map((c) => c.cmd), ['npm test'])
  const nodeT = tmp('det-node-'); writeFileSync(join(nodeT, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })); writeFileSync(join(nodeT, 'x.test.mjs'), '')
  assert.deepEqual(detectRepoChecks(nodeT).map((c) => c.cmd), ['node --test'])
  const nodeDir = tmp('det-nodedir-'); mkdirSync(join(nodeDir, 'test')); writeFileSync(join(nodeDir, 'test', 'a.js'), '')
  assert.deepEqual(detectRepoChecks(nodeDir).map((c) => c.cmd), ['node --test'])
  const py = tmp('det-py-'); writeFileSync(join(py, 'pyproject.toml'), '[tool.pytest.ini_options]\naddopts = "-q"\n')
  assert.deepEqual(detectRepoChecks(py).map((c) => c.cmd), ['python -m pytest -q'])
  const none = tmp('det-none-'); writeFileSync(join(none, 'index.html'), '<html>')
  assert.deepEqual(detectRepoChecks(none), [])

  const pol = createDefaultPolicy({ repoChecks: { 'C:\\Repos\\Site': ['npm run lint', { name: 'e2e', cmd: 'npm run e2e', timeoutMs: 1000 }] } })
  const mapped = pol.checks({ id: 'T-1', meta: JSON.stringify({ repo: 'C:\\Repos\\Site' }) }, { workspace: npm, result: {} })
  assert.deepEqual(mapped.map((c) => [c.name, c.cmd, c.source]), [['repo-check-1', 'npm run lint', 'repoChecks'], ['e2e', 'npm run e2e', 'repoChecks']])
  assert.deepEqual(pol.checks({ id: 'T-2' }, { workspace: none, result: {} }), [])
  assert.equal(pol.reviewOnly({ kind: 'docs' }), true)
})

test('repo rules file: valid, missing, invalid JSON, dropped entries, normalized path lookup; server options', () => {
  const dir = tmp('rules-')
  const repo = join(dir, 'Site')
  const file = join(dir, 'blitz-repo-rules.json')
  writeFileSync(file, JSON.stringify({ [repo]: { target: 'main', allowMerge: true, protectedTargets: ['release'] }, [join(dir, 'other')]: { target: 'main', allowMerge: false }, [join(dir, 'x')]: { allowMerge: true } }))
  const ok = loadRepoRules(file, { log: quiet })
  assert.equal(ok.loaded, true)
  assert.deepEqual(Object.keys(ok.rules), [repo])
  assert.equal(ok.dropped.length, 2)
  assert.equal(ok.rules[`${repo}/`.replace(/\\/g, '/')]?.target, 'main', 'path spelling does not matter')
  if (process.platform === 'win32') assert.equal(ok.rules[repo.toUpperCase()]?.allowMerge, true)
  assert.equal(ok.rules[join(dir, 'other')], undefined, 'allowMerge:false is dropped, never merges')
  const missing = loadRepoRules(join(dir, 'nope.json'), { log: quiet })
  assert.equal(missing.loaded, false); assert.deepEqual(Object.keys(missing.rules), [])
  writeFileSync(join(dir, 'bad.json'), '{ not json')
  const bad = loadRepoRules(join(dir, 'bad.json'), { log: quiet })
  assert.equal(bad.loaded, false); assert.match(bad.error, /invalid JSON/)
  writeFileSync(join(dir, 'arr.json'), '[1,2]')
  assert.equal(loadRepoRules(join(dir, 'arr.json'), { log: quiet }).loaded, false)
  assert.equal(normalizedRules({})['C:/x'], undefined)

  // server.mjs main() options: nothing without the flag and the file
  assert.deepEqual(Object.keys(blitzMainOptions({ BLITZ_REPO_RULES: join(dir, 'nope.json') }, null, { log: quiet })), [])
  const on = blitzMainOptions({ BLITZ_REPO_RULES: file, BLITZ_CODEX_REVIEW: '1' }, null, { log: quiet })
  assert.deepEqual(Object.keys(on).sort(), ['integrationGit', 'review', 'rules', 'verifyPolicy'])
  assert.deepEqual(codexReviewEngineOptions({ BLITZ_CODEX_REVIEW: '0' }), {})
  assert.throws(() => codexReviewEngineOptions({ BLITZ_CODEX_REVIEW: '1', BLITZ_REPO_CHECKS: '{bad' }), /not valid JSON/)
})

test('docs/research rule: no runnable check -> only a docs task verifies on review alone; a coding task stays open', async () => {
  const store = openStore(':memory:')
  const reg = createAgentRegistry(store.db, { store, machines: new Set(['vmixer2o2', 'ndi2']) })
  reg.create(W, { name: 'Cleo', role: 'builder', machine: 'ndi2', transport: 'bridge-claude', model_policy: { policy: 'SUBSCRIPTION_FIRST' }, max_concurrent: 1 })
  reg.create(W, { name: 'Codey', role: 'verifier', machine: 'vmixer2o2', transport: 'codex', model_policy: { policy: 'SUBSCRIPTION_FIRST' }, max_concurrent: 1 })
  const p = store.createProject(W, { name: 'p' })
  const { createController } = await import('./controller.mjs')
  const review = createCodexReview({ spawn: fakeCodex('pass').spawn, git: fakeGit(), entry: { cmd: 'codex', pre: [] } })
  const verifier = createVerifier({ db: store.db, review, run: async () => { throw new Error('no check should run') }, policy: createDefaultPolicy() })
  createController({ store, verify: verifier }).create(W, { id: 'C-2', projects: [p.id], roster: ['Cleo', 'Codey'] })
  const ctx = { campaign: { id: 'C-2', roster: ['Cleo', 'Codey'] }, agent: 'Cleo', attempt: 1, escalate: async () => ({}) }
  const empty = tmp('wt-empty-')
  const docs = store.createTask(W, { project: p.id, title: 'Write the setup guide', body: 'Deliverable: docs/SETUP.md', kind: 'docs' })
  const code = store.createTask(W, { project: p.id, title: 'Build the cart', body: 'Deliverable: cart works' })
  const vd = await verifier(docs, { worktree: empty, repo: 'C:/r' }, ctx)
  assert.equal(vd.verified, true, vd.reason)
  assert.match(vd.reason, /review only, docs\/research task/)
  const vc = await verifier(code, { worktree: empty, repo: 'C:/r' }, ctx)
  assert.equal(vc.verified, false)
  assert.equal(vc.failed, undefined)
  assert.match(vc.reason, /no runnable check/)
})

// ---------------------------------------------------------------- end to end

function fakeBridge(ledger) {
  const messages = []
  return {
    queue: {
      db: ledger, machine: 'vmixer2o2', messages,
      enqueue(env) {
        const dup = env.dedupe_key && messages.find((m) => m.dedupe_key === env.dedupe_key)
        if (dup) return { ...dup, duplicate: true }
        const m = { id: env.id ?? `M${messages.length + 1}`, ...env }
        messages.push(m)
        return m
      },
      list: ({ correlation } = {}) => messages.filter((m) => !correlation || m.correlation_id === correlation),
      pending: () => null,
    },
  }
}

test('end to end: bridge-claude builder, Codex verifier, default policy, real node --test, local merge under a rules file', async (tt) => {
  try { execFileSync('git', ['--version']) } catch { tt.skip('git not installed'); return }
  const env0 = { ...process.env }
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Claude Opus 5.5', GIT_AUTHOR_EMAIL: 'noreply@anthropic.com', GIT_COMMITTER_NAME: 'Claude Opus 5.5', GIT_COMMITTER_EMAIL: 'noreply@anthropic.com' })
  const root = tmp('blitz-codex-e2e-')
  const repo = join(root, 'site')
  const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
  try {
    mkdirSync(repo)
    g(repo, 'init', '-q', '-b', 'main'); g(repo, 'config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, 'README.md'), '# site\n'); g(repo, 'add', '.'); g(repo, 'commit', '-qm', 'base')
    const rulesFile = join(root, 'blitz-repo-rules.json')
    writeFileSync(rulesFile, JSON.stringify({ [repo]: { target: 'main', allowMerge: true } }))

    let now = Date.parse('2026-10-25T20:00:00Z')
    const clock = () => new Date(now)
    const store = openStore(':memory:', { clock })
    const ledger = new DatabaseSync(':memory:')
    approvals.migrate(ledger)
    const bridge = fakeBridge(ledger)
    const machines = new Set(['vmixer2o2', 'ndi2'])
    const reg = createAgentRegistry(store.db, { store, machines, clock })
    reg.create(W, { name: 'Cleo', role: 'builder', machine: 'ndi2', transport: 'bridge-claude', model_policy: { policy: 'SUBSCRIPTION_FIRST', pin: 'claude-opus-5-5' }, max_concurrent: 1 })
    reg.create(W, { name: 'Codey', role: 'verifier', machine: 'vmixer2o2', transport: 'codex', model_policy: { policy: 'SUBSCRIPTION_FIRST' }, max_concurrent: 1 })

    const codex = fakeCodex((stdin) => {
      const crit = [...stdin.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ id: Number(m[1]), criterion: m[2] }))
      const good = /\+export const add/.test(stdin) && /node --test` exit 0/.test(stdin)
      const bad = /Build mul\(\)/.test(stdin)
      return JSON.stringify({ verified: good && !bad, criteria: crit.map((c) => ({ ...c, met: bad ? false : good, evidence: 'diff + check output' })), reason: bad ? 'mul() missing' : 'ok' })
    })
    const opts = blitzMainOptions({ BLITZ_REPO_RULES: rulesFile }, store, { log: quiet })
    assert.equal(opts.review, undefined, 'review only with BLITZ_CODEX_REVIEW=1')
    const engine = createEngine({
      store, ledgerDb: () => bridge.queue.db, bridge, clock, machines,
      env: { [ENABLE_ENV]: '1', BLITZ_WORKSPACE_ROOT: join(root, 'runs') }, git: defaultGit(),
      readSnapshot: async () => ({ machine: 'vmixer2o2', quota: { claude: { stale: false, sessionPercent: 5, weekPercent: 5, exhausted: false } } }),
      ...codexReviewEngineOptions({ BLITZ_CODEX_REVIEW: '1' }, { db: store.db }), // shape check of the env path
      review: createCodexReview({ spawn: codex.spawn, git: defaultGit(), entry: { cmd: 'codex', pre: [] } }),
      verifyPolicy: createDefaultPolicy(),
      rules: opts.rules, integrationGit: opts.integrationGit,
    })
    assert.equal(engine.integrationOn, true)
    const p = store.createProject(W, { name: 'site' })
    const mk = (title, body) => { now += 1000; return store.createTask(W, { project: p.id, title, body, meta: { repo, blitz: {} } }) }
    const A = mk('Add add()', 'Build add().\n\n## Acceptance\n- add(1,2) returns 3')
    const B = mk('Add mul()', 'Build mul().')
    for (const t of [A, B]) {
      for (const kind of ['task_scope', 'task_merge']) {
        const a = approvals.requestApproval(ledger, { kind, requested_by: 'Claude Opus 5.5', now: new Date(now), scope: { project: t.project_id, task_id: t.id, task_rev: t.rev, scope_hash: scopeHash(t), scope: { repo, branch: 'b', files: ['x'], summary: 's' }, permissions: ['fs_write'], version: 'v1', merge_limit: 'local_commit' } })
        approvals.decideApproval(ledger, a.id, { approver: 'user', method: 'pm_ui', proof: { approver: 'user' }, decision: 'approved', now: new Date(now) })
      }
    }
    const runner = engine.start({ autoStart: false, log: null })
    const ctl = engine.controller
    const c0 = ctl.create(W, { id: 'E-1', projects: [p.id], roster: ['Cleo', 'Codey'] })
    const pf = ctl.preflight(W, c0.id, { rev: c0.rev })
    ctl.launch(W, c0.id, { rev: pf.rev, authorizedBy: 'user (codex-review e2e)' })

    // pass 1: Cleo gets A (max_concurrent 1); the bridge submit carries the worktree
    await runner.runOnce()
    const subA = bridge.queue.messages.find((m) => m.type === 'submit' && m.task === A.id)
    assert.ok(subA, 'A dispatched over bridge-claude')
    const wtA = subA.body.cwd
    assert.ok(wtA.startsWith(join(root, 'runs')), 'BLITZ_WORKSPACE_ROOT sets the workspace root')
    // "Claude" builds in the worktree and commits on the task branch
    writeFileSync(join(wtA, 'add.mjs'), 'export const add = (a, b) => a + b\n')
    writeFileSync(join(wtA, 'add.test.mjs'), "import { test } from 'node:test'\nimport assert from 'node:assert'\nimport { add } from './add.mjs'\ntest('add', () => assert.equal(add(1, 2), 3))\n")
    // no git from the builder (bridge policy denies Bash): pm commits the working tree before verification
    bridge.queue.messages.push({ id: `res-${subA.id}`, type: 'result', correlation_id: subA.id, body: { text: 'done: add() + test' } })
    await runner.runOnce() // poll -> result -> verify (node --test real, Codex fake) -> verified; integration pass merges
    await runner.runOnce()
    const rowA = ctl.store.task('E-1', A.id)
    assert.equal(rowA.state, 'verified', rowA.reason)
    const ev = engine.verifier.evidenceOf('E-1', { task: A.id }).verdicts.at(-1)
    assert.equal(ev.evidence.verifier, 'Codey')
    assert.deepEqual(ev.evidence.checks.map((c) => [c.cmd, c.exit_code]), [['node --test', 0]])
    assert.equal(ev.evidence.acceptance[0], DEFAULT_CRITERION)
    assert.equal(ev.evidence.review.agent, 'Codey')
    assert.match(codex.calls[0].args.join(' '), /exec --cd .* --sandbox read-only --json --output-last-message .* -$/)

    const [entA] = engine.integrator.queue({ campaignId: 'E-1' }).filter((e) => e.task_id === A.id)
    assert.equal(entA.state, 'merged', entA.reason)
    assert.equal(g(repo, 'rev-parse', 'main'), entA.merge_commit)
    assert.equal(g(repo, 'show', 'main:add.mjs'), 'export const add = (a, b) => a + b')
    assert.equal(g(repo, 'log', '--format=%B', '-n', '1', 'main^2'), `blitz E-1 ${A.id} a1: Add add()

${COMMIT_TRAILER}`, 'pm committed the builder worktree')
    assert.equal(g(repo, 'status', '--porcelain', '--untracked-files=no'), '', 'checked-out main updated cleanly')
    assert.equal(g(repo, 'remote'), '', 'no remote, nothing pushed')

    // B: Codex finds the criterion unmet -> verification failed, never merged
    for (let i = 0; i < 4 && !bridge.queue.messages.some((m) => m.type === 'submit' && m.task === B.id); i++) await runner.runOnce()
    const subB = bridge.queue.messages.find((m) => m.type === 'submit' && m.task === B.id)
    assert.ok(subB, 'B dispatched')
    writeFileSync(join(subB.body.cwd, 'mul.test.mjs'), "import { test } from 'node:test'\ntest('placeholder', () => {})\n")
    g(subB.body.cwd, 'add', '.'); g(subB.body.cwd, 'commit', '-qm', 'no mul')
    bridge.queue.messages.push({ id: `res-${subB.id}`, type: 'result', correlation_id: subB.id, body: { text: 'done' } })
    await runner.runOnce()
    const rowB = ctl.store.task('E-1', B.id)
    assert.notEqual(rowB.state, 'verified')
    const evB = engine.verifier.evidenceOf('E-1', { task: B.id }).verdicts.at(-1)
    assert.equal(evB.verdict.failed, true, evB.verdict.reason)
    assert.match(evB.verdict.reason, /verifier Codey failed it/)
    assert.equal(engine.integrator.queue({ campaignId: 'E-1' }).some((e) => e.task_id === B.id), false)
    assert.ok(runner.stats().last_integration, 'runner ran the integration pass')
    await engine.stop()
  } finally {
    for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) { if (env0[k] === undefined) delete process.env[k]; else process.env[k] = env0[k] }
    try { rmSync(root, { recursive: true, force: true }) } catch { /* windows file locks */ }
  }
})

test('without rules the engine never integrates (runner has no integration pass)', () => {
  const store = openStore(':memory:')
  const e = createEngine({ store })
  assert.equal(e.integrationOn, false)
  const r = e.start({ autoStart: false, log: null })
  assert.equal(r.stats().last_integration, null)
})

test('BLITZ_GLOBAL_CEILING: 1-16 -> guard ceilings.global; unset or invalid keeps the default 4', () => {
  const none = { BLITZ_REPO_RULES: join(tmpdir(), 'no-such-blitz-rules.json') }
  assert.deepEqual(blitzMainOptions({ ...none, BLITZ_GLOBAL_CEILING: '6' }, null, { log: quiet }).ceilings, { global: 6 })
  for (const bad of [undefined, '0', '17', 'x', '2.5']) assert.equal(blitzMainOptions({ ...none, ...(bad !== undefined ? { BLITZ_GLOBAL_CEILING: bad } : {}) }, null, { log: quiet }).ceilings, undefined, String(bad))
  const store = openStore(':memory:')
  assert.equal(createEngine({ store, ...blitzMainOptions({ ...none, BLITZ_GLOBAL_CEILING: '6' }, null, { log: quiet }) }).guard.config().global, 6)
  assert.equal(createEngine({ store: openStore(':memory:'), ...blitzMainOptions(none, null, { log: quiet }) }).guard.config().global, 4)
})

test('pm commit step: changes -> add -A + commit with trailer; nothing changed -> no_changes -> verify fails closed "no changes"', async () => {
  const ops = []
  let dirty = true
  const git = async (args) => {
    ops.push(args.slice(2))
    if (args[2] === 'status') return { code: 0, stdout: dirty ? '?? new.txt\n' : '', stderr: '' }
    if (args[2] === 'rev-parse') return { code: 0, stdout: 'b'.repeat(40), stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  const art = { worktree: 'C:/w', base_commit: 'b'.repeat(40) }
  const c = await commitWorktree({ git, art, campaignId: 'C-9', taskId: 'T-9', attempt: 2, title: 'Make  it\nwork' })
  assert.equal(c.committed, true)
  assert.deepEqual(ops.filter((o) => o[0] === 'add'), [['add', '-A']])
  assert.deepEqual(ops.find((o) => o[0] === 'commit'), ['commit', '-m', 'blitz C-9 T-9 a2: Make it work', '-m', COMMIT_TRAILER])
  assert.ok(!ops.flat().includes('push'))
  dirty = false; ops.length = 0
  const n = await commitWorktree({ git, art, campaignId: 'C-9', taskId: 'T-9', attempt: 3, title: 'x' })
  assert.deepEqual([n.committed, n.no_changes], [false, true])
  assert.equal(ops.some((o) => o[0] === 'commit'), false)

  const store = openStore(':memory:')
  const reg = createAgentRegistry(store.db, { store, machines: new Set(['vmixer2o2', 'ndi2']) })
  reg.create(W, { name: 'Cleo', role: 'builder', machine: 'ndi2', transport: 'bridge-claude', model_policy: { policy: 'SUBSCRIPTION_FIRST' }, max_concurrent: 1 })
  reg.create(W, { name: 'Codey', role: 'verifier', machine: 'vmixer2o2', transport: 'codex', model_policy: { policy: 'SUBSCRIPTION_FIRST' }, max_concurrent: 1 })
  const p = store.createProject(W, { name: 'p' })
  const { createController } = await import('./controller.mjs')
  const verifier = createVerifier({ db: store.db, review: async () => { throw new Error('no review on no changes') }, run: async () => ({ exitCode: 0 }), policy: createDefaultPolicy() })
  createController({ store, verify: verifier }).create(W, { id: 'C-9', projects: [p.id], roster: ['Cleo', 'Codey'] })
  const t = store.createTask(W, { project: p.id, title: 't', body: 'b', meta: { blitz: { checks: ['node --test'], acceptance: ['a'] } } })
  const v = await verifier(t, { worktree: tmp('wt-nc-'), repo: 'C:/r', no_changes: true }, { campaign: { id: 'C-9', roster: ['Cleo', 'Codey'] }, agent: 'Cleo', attempt: 1, escalate: async () => ({}) })
  assert.deepEqual([v.verified, v.failed, v.reason], [false, undefined, 'no changes'])
})
