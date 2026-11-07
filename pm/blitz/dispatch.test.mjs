// node --test blitz/dispatch.test.mjs   (run from pm/)   BLITZ-08, Claude Opus 5.5
// Fakes only: no DSH, codex or bridge run is started. The one real child process is `node -e`
// under wrapMain, to prove the exit record.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertDispatchAllowed, createDispatcher, dshRunAdapter, codexAdapter, bridgeClaudeAdapter, ensureWorkspace,
  redact, runIdFor, wrapMain, ENABLE_ENV, briefText,
} from './dispatch.mjs'
import { createGuard, providerReading, defaultProviderOf } from './guard.mjs'

/** spawn-compatible fake: records calls, answers via handler(cmd, args, opts) -> {code, stdout, stderr}. */
function fakeSpawn(handler = () => ({ code: 0, stdout: '{}' })) {
  const calls = []
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end() {} }
    child.pid = 4242
    child.unref = () => {}
    child.kill = () => {}
    const r = handler(cmd, args, opts) ?? {}
    setImmediate(() => {
      if (r.stdout) child.stdout.emit('data', r.stdout)
      if (r.stderr) child.stderr.emit('data', r.stderr)
      child.emit('close', r.code ?? 0)
    })
    return child
  }
  return { spawn, calls }
}

function fakeGit({ branchExists = false, fail = false } = {}) {
  const calls = []
  const git = async (args) => {
    calls.push(args)
    if (args.includes('rev-parse')) return { code: branchExists ? 0 : 1, stdout: '', stderr: '' }
    if (fail) return { code: 128, stdout: '', stderr: 'fatal: not a git repository' }
    const wt = args[args.indexOf('add') + (args.includes('-b') ? 3 : 1)]
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, '.git'), 'gitdir: fake')
    return { code: 0, stdout: '', stderr: '' }
  }
  return { git, calls }
}

const tmp = () => mkdtempSync(join(tmpdir(), 'blitz08-'))
const TASK = (extra = {}) => ({ id: 'T-0000aaaa', project_id: 'P-1', title: 'Add widget', body: 'Do it. API_KEY=supersecret123 and Bearer abcdefghijklmnop1234', meta: JSON.stringify({ repo: 'C:/repos/app', blitz: { role: 'builder' } }), ...extra })
const DEE = { name: 'Dee', role: 'builder', machine: 'vmixer2o2', transport: 'dsh-run', model_policy: { policy: 'FIXED_ROSTER', allow: ['deepseek', 'kimi'] }, max_concurrent: 2 }
const CODY = { name: 'Cody', role: 'builder', machine: 'vmixer2o2', transport: 'codex', model_policy: { policy: 'PAID_FASTEST', pin: 'gpt-6' }, max_concurrent: 1 }
const CLEO = { name: 'Cleo', role: 'reviewer', machine: 'ndi2', transport: 'bridge-claude', model_policy: { policy: 'SUBSCRIPTION_FIRST', pin: 'claude-opus-5-5' }, max_concurrent: 1 }
const CAMPAIGN = { id: 'C-pilot', title: 'pilot', authorized_by: 'user (test scope)' }

function fakeCtx(agent, { attempt = 1, resumeFrom = null } = {}) {
  const store = new Map()
  const checkpoints = []
  return {
    campaign: { id: CAMPAIGN.id, title: CAMPAIGN.title }, agent, attempt, resumeFrom, idempotencyKey: `x:${attempt}`, actor: 'test', now: new Date(),
    once: async (step, fn) => { if (store.has(step)) return { ...store.get(step), replayed: true }; const v = await fn(); store.set(step, v); return v },
    checkpoint: (cp) => { checkpoints.push(cp); return cp },
    heartbeat: () => ({}),
    cancelRequested: () => false,
    checkpoints,
  }
}

test('dispatch refuses without BLITZ_DISPATCH_ENABLED=1 or without authorized_by, and starts nothing', async () => {
  assert.throws(() => assertDispatchAllowed({}, CAMPAIGN), /BLITZ_DISPATCH_ENABLED=1 is not set/)
  assert.throws(() => assertDispatchAllowed({ [ENABLE_ENV]: 'true' }, CAMPAIGN), /not set/)
  assert.throws(() => assertDispatchAllowed({ [ENABLE_ENV]: '1' }, { id: 'C-x' }), /no authorized_by/)
  assert.throws(() => assertDispatchAllowed({ [ENABLE_ENV]: '1' }, { id: 'C-x', authorized_by: '  ' }), /no authorized_by/)
  assert.equal(assertDispatchAllowed({ [ENABLE_ENV]: '1' }, CAMPAIGN), 'user (test scope)')

  for (const [env, campaign, re] of [[{}, CAMPAIGN, /disabled/], [{ [ENABLE_ENV]: '1' }, { ...CAMPAIGN, authorized_by: null }, /refused/]]) {
    const sp = fakeSpawn()
    const g = fakeGit()
    const root = tmp()
    const adapters = { 'dsh-run': dshRunAdapter({ spawn: sp.spawn, env: { ...env }, dshHomes: { Dee: root } }), codex: codexAdapter({ spawn: sp.spawn, env }), 'bridge-claude': bridgeClaudeAdapter({ bridge: { submit: () => assert.fail('submitted') } }) }
    const dispatch = createDispatcher({ adapters, getCampaign: () => campaign, env, root, git: g.git })
    for (const agent of [DEE, CODY, CLEO]) await assert.rejects(dispatch(TASK(), fakeCtx(agent)), re)
    assert.equal(sp.calls.length, 0, 'no process spawned')
    assert.equal(g.calls.length, 0, 'no worktree made')
    rmSync(root, { recursive: true, force: true })
  }
})

test('dsh-run adapter builds the exact command, with the lane home and never a default roster', () => {
  const ws = { workspace: 'W', worktree: 'W/repo', brief: 'W/BRIEF.md' }
  const a = dshRunAdapter({ env: {}, cli: 'CLI/dsh-run.mjs', dshHomes: { Dee: 'L/dee' }, node: 'node', maxAttempts: 2 })
  const b = a.build(TASK({ meta: JSON.stringify({ repo: 'r', blitz: { stages: 'swarm,review', mode: 'fastest' } }) }), fakeCtx(DEE, { attempt: 3 }), ws)
  assert.equal(b.cmd, 'node')
  assert.deepEqual(b.args, ['CLI/dsh-run.mjs', 'start', 'W/BRIEF.md', '--out', 'W/repo', '--run', 'BLITZ-C-pilot-T-0000aaaa-a3', '--auto', '--max-attempts', '2', '--stages', 'swarm,review', '--mode', 'fastest'])
  assert.deepEqual(b.env, { DSH_HOME: 'L/dee' })
  assert.deepEqual(b.seats, ['deepseek', 'kimi'])
  assert.throws(() => a.build(TASK(), fakeCtx({ ...DEE, model_policy: { policy: 'FREE_FIRST' } }), ws), /names no seats/)
  assert.throws(() => a.build(TASK(), fakeCtx({ ...DEE, name: 'Other' }), ws), /no DSH lane home .*BLITZ_DSH_HOME__OTHER/)
  const viaEnv = dshRunAdapter({ env: { BLITZ_DSH_HOME__DEE_2: 'L/env' }, cli: 'c', node: 'n' })
  assert.deepEqual(viaEnv.build(TASK(), fakeCtx({ ...DEE, name: 'dee-2' }), ws).env, { DSH_HOME: 'L/env' })
})

test('codex adapter builds the exact wrapped codex exec command', () => {
  const ws = { workspace: 'W', worktree: 'W/repo', brief: 'W/BRIEF.md' }
  const a = codexAdapter({ env: {}, entry: { cmd: 'node', pre: ['codex.js'] }, node: 'node' })
  const b = a.build(TASK(), fakeCtx(CODY), ws)
  const ref = 'codex-C-pilot-T-0000aaaa-a1'
  assert.equal(b.ref, ref)
  const sep = b.args.indexOf('--')
  assert.match(b.args[0], /dispatch\.mjs$/)
  assert.deepEqual(b.args.slice(1, sep), ['wrap', '--exit', join('W', `${ref}.exit.json`), '--stdin', 'W/BRIEF.md', '--stdout', join('W', `${ref}.out.jsonl`), '--stderr', join('W', `${ref}.err.log`)])
  assert.deepEqual(b.args.slice(sep + 1), ['node', 'codex.js', 'exec', '--cd', 'W/repo', '--sandbox', 'workspace-write', '--json', '--output-last-message', join('W', `${ref}.last-message.md`), '-m', 'gpt-6', '-'])
})

test('bridge-claude adapter submits one deduped claude-code submit and reads its result', async () => {
  const sent = []
  const thread = []
  const bridge = { submit: (e) => { const dup = sent.some((x) => x.dedupe_key === e.dedupe_key); if (!dup) sent.push(e); return { id: e.id, duplicate: dup } }, thread: () => thread, cancel: (e) => sent.push(e) }
  const root = tmp()
  writeFileSync(join(root, 'BRIEF.md'), 'brief text')
  const ws = { workspace: root, worktree: join(root, 'repo'), brief: join(root, 'BRIEF.md') }
  const a = bridgeClaudeAdapter({ bridge })
  const s1 = await a.start(TASK(), fakeCtx(CLEO), ws)
  const s2 = await a.start(TASK(), fakeCtx(CLEO), ws)
  assert.equal(sent.length, 1)
  assert.equal(s2.duplicate, true)
  const e = sent[0]
  assert.equal(e.type, 'submit')
  assert.deepEqual(e.to, { machine: 'ndi2', agent: 'claude-code' })
  assert.equal(e.dedupe_key, 'blitz-C-pilot-T-0000aaaa-a1')
  assert.equal(e.body.prompt, 'brief text')
  assert.equal(e.body.model, 'claude-opus-5-5')
  assert.equal(e.body.cwd, ws.worktree)
  assert.deepEqual(await a.poll(s1), { state: 'running' })
  thread.push({ id: 'r1', type: 'result', correlation_id: s1.ref, body: JSON.stringify({ text: 'done, tests 12/12' }) })
  assert.deepEqual(await a.poll(s1), { state: 'done', result: { summary: 'done, tests 12/12', message: 'r1' } })
  thread[0] = { id: 'r1', type: 'error', correlation_id: s1.ref, body: { error: 'quota gate' } }
  assert.match((await a.poll(s1)).error, /quota gate/)
  await a.stop(s1)
  assert.equal(sent[1].type, 'cancel')
  await assert.rejects(bridgeClaudeAdapter({ bridge: null }).start(TASK(), fakeCtx(CLEO), ws), /needs the pm bridge/)
  rmSync(root, { recursive: true, force: true })
})

test('workspace: isolated worktree per task via the injected git runner', async () => {
  const root = tmp()
  const g = fakeGit()
  const ws = await ensureWorkspace({ task: TASK(), campaignId: 'C-1', root, git: g.git })
  assert.equal(ws.branch, 'blitz/C-1/T-0000aaaa')
  assert.equal(ws.worktree, join(root, 'C-1', 'T-0000aaaa', 'repo'))
  assert.deepEqual(g.calls[1], ['-C', 'C:/repos/app', 'worktree', 'add', '-b', 'blitz/C-1/T-0000aaaa', ws.worktree, 'HEAD'])
  const again = await ensureWorkspace({ task: TASK(), campaignId: 'C-1', root, git: g.git })
  assert.equal(again.created, false)
  assert.equal(g.calls.length, 2, 'an existing worktree is reused')
  const g2 = fakeGit({ branchExists: true })
  const ws2 = await ensureWorkspace({ task: TASK({ id: 'T-0000bbbb' }), campaignId: 'C-1', root, git: g2.git })
  assert.deepEqual(g2.calls[1], ['-C', 'C:/repos/app', 'worktree', 'add', ws2.worktree, 'blitz/C-1/T-0000bbbb'])
  await assert.rejects(ensureWorkspace({ task: TASK({ id: 'T-0000cccc' }), campaignId: 'C-1', root, git: fakeGit({ fail: true }).git }), /not a git repository/)
  await assert.rejects(ensureWorkspace({ task: TASK({ meta: '{}' }), campaignId: 'C-1', root, git: g.git }), /names no repo/)
  rmSync(root, { recursive: true, force: true })
})

test('brief: written into the workspace, credentials redacted', () => {
  assert.equal(redact('x API_KEY=abc123 y'), 'x API_KEY=[redacted] y')
  assert.equal(redact('token sk-abcdefghijklmnop1234'), 'token [redacted]')
  assert.equal(redact('Authorization: Bearer abcdefghijklmnop1234'), 'Authorization: Bearer [redacted]')
  const text = briefText({ task: TASK(), campaign: CAMPAIGN, agent: DEE, attempt: 1, ws: { worktree: 'W/repo', branch: 'b', base: 'HEAD', repo: 'r' } })
  assert.match(text, /seats: deepseek, kimi/)
  assert.match(text, /Never git push/)
  assert.doesNotMatch(text, /supersecret123|abcdefghijklmnop1234/)
})

test('brief: previous attempt feedback carries the verifier\'s unmet criteria notes', () => {
  const previous = { verification: { verified: false, failed: true, reason: 'verifier v failed it: criterion 2 unmet',
    evidence: { review: { criteria: [
      { criterion: 'Audit log on every decision', met: false, note: 'entryGate.ts:88 drops failed ALLOW writes; token sk-abcdefghijklmnop1234' },
      { criterion: 'Age gate 21+', met: true, note: 'fine' }] } } } }
  const text = briefText({ task: TASK(), campaign: CAMPAIGN, agent: DEE, attempt: 2, ws: { worktree: 'W/repo', branch: 'b', base: 'HEAD', repo: 'r' }, previous })
  assert.match(text, /## Previous attempt feedback/)
  assert.match(text, /criterion 2 unmet/)
  assert.match(text, /- Audit log on every decision\n  Verifier: entryGate\.ts:88 drops failed ALLOW writes/)
  assert.doesNotMatch(text, /Age gate 21\+\n  Verifier/)
  assert.doesNotMatch(text, /abcdefghijklmnop1234/)
  const bare = briefText({ task: TASK(), campaign: CAMPAIGN, agent: DEE, attempt: 2, ws: { worktree: 'W/repo', branch: 'b', base: 'HEAD', repo: 'r' }, previous: { verification: { verified: false, reason: 'only a summary' } } })
  assert.match(bare, /only a summary/)
  assert.doesNotMatch(bare, /Unmet criteria/)
  assert.doesNotMatch(bare, /Failed checks/)
})

test('brief: lists the verifier\'s acceptance criteria and their clarification', () => {
  const ws = { worktree: 'W/repo', branch: 'b', base: 'HEAD', repo: 'r' }
  const meta = JSON.stringify({ repo: 'C:/repos/app', blitz: { role: 'builder', acceptance: ['Real PySAM runs', 'Fixtures from PySAM'], acceptance_clarification: { quote: 'User said: "make it work"' } } })
  const text = briefText({ task: TASK({ meta }), campaign: CAMPAIGN, agent: DEE, attempt: 2, ws })
  assert.match(text, /## Acceptance criteria the verifier checks/)
  assert.match(text, /Clarified: User said: "make it work"/)
  assert.match(text, /1\. Real PySAM runs\n2\. Fixtures from PySAM/)
  assert.ok(text.indexOf('## Task') < text.indexOf('## Acceptance criteria the verifier checks'))
  assert.doesNotMatch(briefText({ task: TASK(), campaign: CAMPAIGN, agent: DEE, attempt: 1, ws }), /verifier checks/)
})

test('brief: previous attempt feedback carries the failing check output', () => {
  const previous = { verification: { verified: false, failed: true, reason: 'check pm suite exited 1: cd pm && node --test',
    evidence: { checks: [
      { name: 'lint', cmd: 'npm run lint', exit_code: 0, stdout_tail: 'clean' },
      { name: 'pm suite', cmd: 'cd pm && node --test', exit_code: 1, stdout_tail: 'ok 1 - a\n✖ failing tests:\n\ntest at l9.test.mjs:148:1\n✖ row order keeps new rows API_KEY=abc123', stderr_tail: '' }] } } }
  const text = briefText({ task: TASK(), campaign: CAMPAIGN, agent: DEE, attempt: 2, ws: { worktree: 'W/repo', branch: 'b', base: 'HEAD', repo: 'r' }, previous })
  assert.match(text, /Failed checks/)
  assert.match(text, /- pm suite: `cd pm && node --test` exit 1/)
  assert.match(text, /test at l9\.test\.mjs:148:1\n✖ row order keeps new rows/)
  assert.doesNotMatch(text, /ok 1 - a/)
  assert.doesNotMatch(text, /- lint:/)
  assert.doesNotMatch(text, /abc123/)
})

test('full dispatch (dsh-run, fake spawn): brief, checkpoints, one start per attempt, adopt on re-lease', async () => {
  const root = tmp()
  const lane = join(root, 'lane')
  mkdirSync(lane)
  writeFileSync(join(lane, 'settings.yaml'), 'council:\n')
  const runs = {}
  const sp = fakeSpawn((cmd, args) => {
    if (args[1] === 'start') { runs[args[args.indexOf('--run') + 1]] = { runId: args[args.indexOf('--run') + 1], status: 'running' }; return { code: 0, stdout: '{}' } }
    if (args[1] === 'list') return { code: 0, stdout: JSON.stringify(Object.values(runs)) }
    return { code: 0 }
  })
  const env = { [ENABLE_ENV]: '1' }
  const adapters = { 'dsh-run': dshRunAdapter({ spawn: sp.spawn, env, dshHomes: { Dee: lane }, cli: 'dsh-run.mjs', node: 'node' }) }
  const dispatch = createDispatcher({ adapters, getCampaign: () => CAMPAIGN, env, root, git: fakeGit().git })
  const ctx = fakeCtx(DEE)
  const out = await dispatch(TASK(), ctx)
  assert.equal(out.ref, 'BLITZ-C-pilot-T-0000aaaa-a1')
  const starts = () => sp.calls.filter((c) => c.args[1] === 'start')
  assert.equal(starts().length, 1)
  assert.equal(starts()[0].opts.env.DSH_HOME, lane)
  const brief = join(root, 'C-pilot', 'T-0000aaaa', 'BRIEF.md')
  assert.ok(existsSync(brief))
  assert.doesNotMatch(readFileSync(brief, 'utf8'), /supersecret123/)
  assert.deepEqual(ctx.checkpoints.map((c) => c.stage), ['workspace', 'dispatched'])
  const art = ctx.checkpoints[1].artifacts[0]
  assert.equal(art.kind, 'run')
  assert.equal(art.ref, out.ref)
  // same attempt again (a retried tick): ctx.once replays, no second start
  await dispatch(TASK(), ctx)
  assert.equal(starts().length, 1)
  // a re-leased attempt adopts the live run named in the last checkpoint
  const ctx2 = fakeCtx(DEE, { attempt: 2, resumeFrom: ctx.checkpoints[1] })
  const out2 = await dispatch(TASK(), ctx2)
  assert.equal(out2.ref, out.ref)
  assert.equal(starts().length, 1)
  assert.equal(ctx2.checkpoints[0].artifacts[0].adopted_from_attempt, 1)
  // a failed prior run is not adopted: attempt 3 starts a new run with its own id
  runs[out.ref].status = 'failed'
  const out3 = await dispatch(TASK(), fakeCtx(DEE, { attempt: 3, resumeFrom: ctx.checkpoints[1] }))
  assert.equal(out3.ref, 'BLITZ-C-pilot-T-0000aaaa-a3')
  assert.equal(starts().length, 2)
  rmSync(root, { recursive: true, force: true })
})

test('dsh-run and codex polling map run states', async () => {
  let list = []
  const sp = fakeSpawn((cmd, args) => (args[1] === 'list' ? { code: 0, stdout: JSON.stringify(list) } : { code: 0 }))
  const a = dshRunAdapter({ spawn: sp.spawn, env: {}, cli: 'c', node: 'n' })
  list = [{ runId: 'R', status: 'running' }]
  assert.equal((await a.poll({ ref: 'R', home: 'L' })).state, 'running')
  list = [{ runId: 'R', status: 'complete', exitCode: 0 }]
  assert.equal((await a.poll({ ref: 'R', home: 'L' })).state, 'done')
  for (const s of ['failed', 'blocked', 'stopped', 'paused']) { list = [{ runId: 'R', status: s }]; assert.equal((await a.poll({ ref: 'R', home: 'L' })).state, 'failed') }
  list = []
  assert.match((await a.poll({ ref: 'R', home: 'L' })).error, /no run R/)
  await a.stop({ ref: 'R', home: 'L' })
  assert.deepEqual(sp.calls.at(-1).args, ['c', 'stop', 'R'])

  const dir = tmp()
  let alive = true
  const c = codexAdapter({ env: {}, entry: { cmd: 'x', pre: [] }, pidAlive: () => alive })
  const art = { pid: 7, exitFile: join(dir, 'e.json'), lastMessage: join(dir, 'm.md') }
  assert.equal((await c.poll(art)).state, 'running')
  alive = false
  assert.match((await c.poll(art)).error, /gone without an exit record/)
  writeFileSync(art.exitFile, JSON.stringify({ code: 0 }))
  writeFileSync(art.lastMessage, 'all green')
  assert.deepEqual(await c.poll(art), { state: 'done', result: { summary: 'all green', exitCode: 0 } })
  writeFileSync(art.exitFile, JSON.stringify({ code: 2 }))
  assert.match((await c.poll(art)).error, /exited 2/)
  rmSync(dir, { recursive: true, force: true })
})

test('wrap records the exit code of a real (harmless) child', async () => {
  const dir = tmp()
  const exit = join(dir, 'exit.json')
  const out = join(dir, 'out.log')
  writeFileSync(join(dir, 'in.txt'), 'from stdin')
  const code = await wrapMain(['--exit', exit, '--stdin', join(dir, 'in.txt'), '--stdout', out, '--', process.execPath, '-e', "process.stdin.pipe(process.stdout); process.stdin.on('end', () => process.exit(3))"])
  assert.equal(code, 3)
  assert.equal(JSON.parse(readFileSync(exit, 'utf8')).code, 3)
  assert.equal(readFileSync(out, 'utf8'), 'from stdin')
  rmSync(dir, { recursive: true, force: true })
})

test('guard: Claude stops at 95%, unknown readings refuse, ceilings narrow max_concurrent', () => {
  const fresh = (c) => ({ quota: { claude: { stale: false, sessionPercent: 10, weekPercent: 10, ...c } } })
  assert.deepEqual(providerReading(fresh({ weekPercent: 96 }), 'claude').usedPercent, 96)
  assert.equal(providerReading(fresh({ stale: true }), 'claude').known, false)
  assert.equal(providerReading(fresh({ exhausted: true }), 'claude').usedPercent, 100)
  assert.equal(providerReading({}, 'dsh').notApplicable, true)
  assert.equal(defaultProviderOf(CLEO), 'claude')
  assert.equal(defaultProviderOf(CODY), 'codex')
  assert.equal(defaultProviderOf(DEE), 'dsh')
  assert.equal(defaultProviderOf({ ...DEE, model_policy: { policy: 'FIXED_ROSTER', allow: ['agy-gemini-pro'] } }), 'antigravity')
  const db = { prepare: () => ({ all: () => [], get: () => null }) }
  const g = createGuard({ db, readSnapshot: async () => null })
  g.snapshot()
  return (async () => {
    await g.refresh()
    assert.equal(g.quota('claude').ok, false)
    assert.match(g.quota('claude').reason, /unknown/)
    assert.equal(g.quota('dsh').ok, true)
    const g2 = createGuard({ db, readSnapshot: async () => fresh({ weekPercent: 95 }), unknown: { codex: 'allow' } })
    await g2.refresh()
    assert.match(g2.quota('claude').reason, /claude at 95% used \(stop at 95%/)
    assert.equal(g2.quota('codex').ok, true)
    const g3 = createGuard({ db, readSnapshot: async () => fresh({ weekPercent: 94 }) })
    await g3.refresh()
    assert.equal(g3.quota('claude').ok, true)
  })()
})

test('guard ceilings: global, per provider, per agent; round robin never starves a role', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { migrate } = await import('./campaigns.mjs')
  const db = new DatabaseSync(':memory:')
  migrate(db)
  db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, meta TEXT)')
  const put = (c, id, state, owner, role) => {
    db.prepare("INSERT INTO blitz_campaign_tasks (campaign_id, task_id, project_id, state, lease_owner, updated_at) VALUES (?, ?, 'P', ?, ?, 'now')").run(c, id, state, owner)
    db.prepare('INSERT OR REPLACE INTO tasks (id, meta) VALUES (?, ?)').run(id, JSON.stringify({ blitz: role ? { role } : {} }))
  }
  const fresh = { quota: { claude: { stale: false, sessionPercent: 1, weekPercent: 1 }, codex: { stale: false, headroomPercent: 80 } } }
  const DEE2 = { ...DEE, max_concurrent: 4 }
  // 3 builder tasks + 1 reviewer task pending; nothing active
  for (const [id, role] of [['b1', 'builder'], ['b2', 'builder'], ['b3', 'builder'], ['r1', 'reviewer']]) put('C1', id, 'pending', null, role)
  let g = createGuard({ db, readSnapshot: async () => fresh, ceilings: { global: 2 } })
  await g.refresh()
  const caps = (roster) => Object.fromEntries(g.apply('C1', roster, () => null).map((a) => [a.name, a.max_concurrent]))
  assert.deepEqual(caps([DEE2, CLEO]), { Dee: 1, Cleo: 1 }, 'global 2 split so the reviewer is not starved')
  assert.deepEqual(caps([CLEO, DEE2]), { Cleo: 1, Dee: 1 })
  g = createGuard({ db, readSnapshot: async () => fresh, ceilings: { global: 10, perAgent: { Dee: 2 } } })
  await g.refresh()
  assert.deepEqual(caps([DEE2, CLEO]), { Dee: 2, Cleo: 1 })
  // an active codex task elsewhere uses the codex provider ceiling
  put('C2', 'x1', 'running', 'Cody', 'builder')
  g = createGuard({ db, readSnapshot: async () => fresh, ceilings: { global: 10, perProvider: { codex: 1 } } })
  await g.refresh()
  const CODY2 = { ...CODY, name: 'Cody2' } // free itself, but its provider is at the ceiling
  const out = g.apply('C1', [CODY2, CLEO], (n) => (n === 'Cody' ? CODY : null))
  assert.deepEqual(out.map((a) => a.max_concurrent), [0, 1])
  assert.match(g.lastDecision().refusals[0].reason, /provider codex ceiling 1 reached/)
  // global ceiling counts other campaigns' active tasks
  g = createGuard({ db, readSnapshot: async () => fresh, ceilings: { global: 1 } })
  await g.refresh()
  assert.deepEqual(caps([DEE2, CLEO]), { Dee: 0, Cleo: 0 })
  assert.match(g.lastDecision().refusals.map((r) => r.reason).join(' '), /global ceiling 1 reached/)
})
