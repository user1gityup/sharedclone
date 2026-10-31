// node --test blitz/blitz.test.mjs   (run from pm/)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, PmError } from '../store.mjs'
import { createServer } from '../server.mjs'
import { openQueue } from '../bridge/queue.mjs'
import { topProjects } from './rank.mjs'
import { discover, auditRepo } from './discovery.mjs'
import { openQa } from './qa.mjs'

const A = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const U = { actor: 'user', model: null }
const rejects = (fn, status) => assert.throws(fn, (e) => e instanceof PmError && e.status === status)

let tick = 0
const clock = () => new Date(Date.UTC(2026, 9, 19, 0, 0, tick++))

function world() {
  const s = openStore(':memory:', { clock })
  const mk = (name) => s.createProject(A, { name })
  const task = (project, title, extra = {}) => s.createTask(A, { project, title, ...extra })
  return { s, mk, task }
}

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-repo-'))
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t')
  g('config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), '1')
  g('add', '.')
  g('commit', '-q', '-m', 'one')
  return { dir, g }
}

// 1. selection order
test('top-projects ranks by project priority, min prio, P1 count, open count, age, id', () => {
  const { s, mk, task } = world()
  const a = mk('a'); const b = mk('b'); const c = mk('c'); const d = mk('d'); const e = mk('e'); const f = mk('f')
  task('a', 'a1', { priority: 2 })
  task('b', 'b1', { priority: 1 }); task('b', 'b2', { priority: 2 })
  task('c', 'c1', { priority: 1 }); task('c', 'c2', { priority: 1 })
  task('d', 'd1', { priority: 3 })
  task('e', 'e1', { priority: 1 }); task('e', 'e2', { priority: 2 }); task('e', 'e3', { priority: 3 })
  task('f', 'f1', { priority: 1, kind: 'handoff' }) // noncoding only: not ranked
  let r = topProjects(s.db, {})
  assert.equal(r.mode, 'ranked')
  // c: 2 P1; e: 1 P1 + 3 open; b: 1 P1 + 2 open; a: min 2; d: min 3
  assert.deepEqual(r.projects.map((p) => p.name), ['c', 'e', 'b', 'a', 'd'])
  assert.deepEqual(r.projects[0].inputs, { manual_order: null, project_priority: null, min_open_priority: 1, p1_open: 2, open_coding: 2, oldest_open: r.projects[0].inputs.oldest_open })
  s.updateProject(A, 'd', { rev: d.rev, priority: 1 })
  s.updateProject(A, 'a', { rev: a.rev, priority: 2 })
  r = topProjects(s.db, { n: 3 })
  assert.deepEqual(r.projects.map((p) => p.name), ['d', 'a', 'c'])
  assert.deepEqual(r.projects.map((p) => p.rank), [1, 2, 3])
  // age then id on a full tie
  const { s: s2, mk: mk2, task: task2 } = world()
  mk2('y'); mk2('x')
  task2('x', 'x1'); task2('y', 'y1')
  assert.deepEqual(topProjects(s2.db, {}).projects.map((p) => p.name), ['x', 'y'])
  void b; void c; void e; void f
})

test('manual Top order (sorter sort_order) outranks every computed key', () => {
  const { s, mk, task } = world()
  mk('a'); mk('b'); mk('c')
  task('a', 'a1', { priority: 1 }); task('a', 'a2', { priority: 1 })
  task('b', 'b1', { priority: 3 })
  task('c', 'c1', { priority: 2 })
  assert.deepEqual(topProjects(s.db, {}).projects.map((p) => p.name), ['a', 'c', 'b'])
  const top = s.orderOps.getOrder('top')
  const byName = Object.fromEntries(top.items.map((i) => [i.name, i.id]))
  s.orderOps.setOrder(A, 'top', { base_rev: top.rev, ids: [byName.b, byName.c, byName.a] })
  const r = topProjects(s.db, {})
  assert.deepEqual(r.projects.map((p) => p.name), ['b', 'c', 'a'])
  assert.deepEqual(r.projects.map((p) => p.inputs.manual_order), [1, 2, 3])
})

test('explicit projects keep caller order, cap n, reject unknown/archived; done tasks do not count', () => {
  const { s, mk, task } = world()
  mk('a'); mk('b'); const z = mk('z')
  task('a', 'a1', { priority: 1 })
  const done = task('b', 'b1', { priority: 1 })
  s.updateTask(A, done.id, { rev: done.rev, status: 'done' })
  task('b', 'b2', { priority: 3 })
  assert.deepEqual(topProjects(s.db, { projects: 'b,a' }).projects.map((p) => p.name), ['b', 'a'])
  assert.equal(topProjects(s.db, { projects: ['b', 'a'], n: 1 }).projects.length, 1)
  assert.equal(topProjects(s.db, { projects: ['b'] }).projects[0].inputs.min_open_priority, 3)
  rejects(() => topProjects(s.db, { projects: 'nope' }), 400)
  rejects(() => topProjects(s.db, { n: 0 }), 400)
  s.archiveProject(A, 'z')
  rejects(() => topProjects(s.db, { projects: [z.id] }), 400)
  assert.ok(!topProjects(s.db, {}).projects.some((p) => p.name === 'z'))
})

test('updateProject validates priority and rev', () => {
  const { s, mk } = world()
  const p = mk('a')
  rejects(() => s.updateProject(A, 'a', { rev: p.rev, priority: 0 }), 400)
  rejects(() => s.updateProject(A, 'a', { rev: 99, priority: 1 }), 409)
  const p2 = s.updateProject(A, 'a', { rev: p.rev, priority: 2 })
  assert.equal(p2.priority, 2)
  assert.equal(s.updateProject(A, 'a', { rev: p2.rev, priority: null }).priority, null)
})

// 2. noncoding exclusion
test('discovery excludes noncoding kinds and meta.blitz.coding=false; coding=true overrides kind', () => {
  const { s, mk, task } = world()
  mk('a')
  task('a', 'code it')
  task('a', 'handoff note', { kind: 'handoff' })
  task('a', 'brain', { kind: 'brain-project' })
  task('a', 'flagged', { meta: { blitz: { coding: false } } })
  task('a', 'forced', { kind: 'other', meta: { blitz: { coding: true } } })
  const r = discover(s, { projects: 'a' })
  assert.deepEqual(r.candidates.map((c) => c.title).sort(), ['code it', 'forced'])
  assert.deepEqual(r.excluded.map((x) => x.reason).sort(), ['kind brain-project', 'kind handoff', 'meta.blitz.coding=false'])
})

// 3. dedupe + apply idempotent
test('dedupe merges pm, repo-ref and audit sources; apply twice creates one task and leaves existing tasks untouched', () => {
  const { s, mk, task } = world()
  mk('a')
  const existing = task('a', 'Fix login bug', { priority: 1, meta: { blitz: { rating: { priority: 1 } }, x: 1 } })
  const audits = [
    { agent: 'codex', project: 'a', items: [{ title: 'fix login BUG!', fingerprint: 'f1' }, { title: 'Add retry to sync', fingerprint: 'f2' }] },
    { agent: 'kimi', project: 'a', items: [{ title: 'Add retry to sync' }] },
  ]
  const r = discover(s, { projects: 'a', audits })
  const login = r.candidates.find((c) => c.task_id === existing.id)
  assert.deepEqual(login.provenance.map((p) => p.source), ['pm', 'audit'])
  const retry = r.candidates.find((c) => /retry/.test(c.title))
  assert.equal(retry.provenance.length, 2)
  assert.equal(r.candidates.length, 2)
  const w1 = discover(s, { projects: 'a', audits, apply: true }, A)
  assert.deepEqual(w1.applied.map((x) => x.action).sort(), ['created', 'exists'])
  const w2 = discover(s, { projects: 'a', audits, apply: true }, A)
  assert.deepEqual(w2.applied.map((x) => x.action), ['exists', 'exists'])
  assert.equal(s.listTasks({ project: 'a' }).length, 2)
  const after = s.getTask(existing.id)
  assert.equal(after.rev, existing.rev)
  assert.equal(after.priority, 1)
  assert.deepEqual(JSON.parse(after.meta), { blitz: { rating: { priority: 1 } }, x: 1 })
  const created = s.listTasks({ project: 'a' }).find((t) => t.id !== existing.id)
  assert.equal(JSON.parse(created.meta).blitz.discovery.provenance.length, 2)
  assert.throws(() => discover(s, { projects: 'a', audits, apply: true }, null), (e) => e.status === 400)
  rejects(() => discover(s, { projects: 'a', audits: [{ agent: 'bad agent', project: 'a', items: [] }] }), 400)
})

test('dependency links come from meta.blitz.depends_on and T-id mentions', () => {
  const { s, mk, task } = world()
  mk('a')
  const t1 = task('a', 'base')
  const t2 = task('a', 'next', { body: `after ${t1.id} lands`, meta: { blitz: { depends_on: ['T-0000aaaa'] } } })
  const c = discover(s, { projects: 'a' }).candidates.find((x) => x.task_id === t2.id)
  assert.deepEqual(c.depends_on.sort(), [t1.id, 'T-0000aaaa'].sort())
})

// 4. repo audit, read-only
test('repo audit finds dirty files, unpushed commits and open push requests without changing the repo', () => {
  const { dir, g } = gitRepo()
  const remote = mkdtempSync(join(tmpdir(), 'blitz-remote-'))
  try {
    execFileSync('git', ['init', '-q', '--bare', remote])
    g('remote', 'add', 'origin', remote)
    g('push', '-q', '-u', 'origin', 'main')
    writeFileSync(join(dir, 'b.txt'), '2'); g('add', '.'); g('commit', '-q', '-m', 'two')
    writeFileSync(join(dir, 'a.txt'), 'dirty')
    const name = dir.split(/[\\/]/).pop()
    const pr = join(remote, 'push-requests.md')
    writeFileSync(pr, `## C:\\Users\\other\\${name} — main\n\nStatus: open\n\n## C:\\x\\${name} — old\n\nStatus: pushed 2026-10-01\n`)
    const before = { status: g('status', '--porcelain'), head: g('rev-parse', 'HEAD'), index: g('ls-files', '-s') }
    const items = auditRepo(dir, { project: 'P-x', pushRequests: pr })
    assert.deepEqual(items.map((i) => i.source_ref.split(':')[2]), ['dirty', 'unpushed', 'push-request'])
    assert.match(items[1].title, /^1 unpushed commits/)
    assert.deepEqual({ status: g('status', '--porcelain'), head: g('rev-parse', 'HEAD'), index: g('ls-files', '-s') }, before)
    // repo candidates flow through discover and dedupe on re-run
    const { s, mk, task } = world()
    mk('a'); task('a', 'x', { meta: { repo: dir } })
    const r = discover(s, { projects: 'a', pushRequests: pr })
    assert.equal(r.sources.repo, 3)
    discover(s, { projects: 'a', pushRequests: pr, apply: true }, A)
    assert.equal(s.listTasks({ project: 'a' }).length, 4)
    discover(s, { projects: 'a', pushRequests: pr, apply: true }, A)
    assert.equal(s.listTasks({ project: 'a' }).length, 4)
    rejects(() => auditRepo(join(dir, 'missing')), 400)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})

// 5. one project at a time + bridge mirror
function qaWorld() {
  const { s, mk, task } = world()
  mk('p1'); mk('p2')
  const t1 = task('p1', 'one'); const t2 = task('p2', 'two')
  const queue = openQueue(':memory:', { machine: 'm1' })
  const qa = openQa(s, { bridge: { queue }, clock })
  return { s, qa, queue, t1, t2 }
}

test('Q&A finishes one project at a time; later projects are queued and not mirrored', () => {
  const { s, qa, queue, t1, t2 } = qaWorld()
  const a = qa.ask(A, 'C1', { project: 'p1', task: t1.id, question: 'Which DB?', options: ['sqlite', 'pg'] })
  const b = qa.ask(A, 'C1', { project: 'p2', task: t2.id, question: 'Deploy where?' })
  assert.ok(a.mirrored_at)
  assert.equal(b.mirrored_at, null)
  let cur = qa.current('C1')
  assert.equal(cur.project, s.listProjects().find((p) => p.name === 'p1').id)
  assert.deepEqual(cur.queued.map((x) => x.open), [1])
  const msgs = queue.list({ correlation: a.qid })
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].correlation_id, a.qid)
  assert.equal(msgs[0].to.agent, qa.agent)
  qa.answer(U, a.qid, { answer: 'sqlite' })
  cur = qa.current('C1')
  assert.equal(cur.project, b.project_id)
  assert.ok(qa.get(b.qid).mirrored_at)
  qa.answer(U, b.qid, { answer: 'ndi2' })
  assert.equal(qa.current('C1').done, true)
  // the question and the answer are visible as pm comments on the task
  assert.deepEqual(s.getTask(t1.id).comments.map((c) => c.body.split(']')[0]), [`[blitz-question ${a.qid}`, `[blitz-answer ${a.qid}`])
  rejects(() => qa.ask(A, 'C1', { project: 'nope', question: 'x' }), 400)
  rejects(() => qa.ask(A, 'C1', { project: 'p1', task: t2.id, question: 'x' }), 400)
  rejects(() => qa.ask(A, 'bad id!', { project: 'p1', question: 'x' }), 400)
})

test('setOrder reorders projects and the current project follows it', () => {
  const { qa } = qaWorld()
  qa.ask(A, 'C2', { project: 'p1', question: 'a?' })
  const b = qa.ask(A, 'C2', { project: 'p2', question: 'b?' })
  const r = qa.setOrder(A, 'C2', { projects: ['p2'] })
  assert.equal(r.current, b.project_id)
  assert.ok(qa.get(b.qid).mirrored_at)
})

// 6. resume after restart
test('Q&A state survives reopening the store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-qa-'))
  const file = join(dir, 'pm.db')
  try {
    let s = openStore(file, { clock })
    s.createProject(A, { name: 'p1' }); s.createProject(A, { name: 'p2' })
    let qa = openQa(s, { clock })
    const a = qa.ask(A, 'C3', { project: 'p1', question: 'a?' })
    qa.ask(A, 'C3', { project: 'p1', question: 'b?' })
    qa.ask(A, 'C3', { project: 'p2', question: 'c?' })
    qa.answer(U, a.qid, { answer: 'yes' })
    const before = qa.current('C3')
    s.close()
    s = openStore(file, { clock })
    qa = openQa(s, { clock })
    const after = qa.current('C3')
    assert.deepEqual(after, before)
    assert.deepEqual(after.open.map((q) => q.question), ['b?'])
    assert.equal(qa.get(a.qid).answer, 'yes')
    s.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// 7. answer history, relayed answers, bridge replies
test('re-answer keeps history; relayed answers wait for confirmation; bridge replies answer by correlation_id', () => {
  const { qa, queue } = qaWorld()
  const a = qa.ask(A, 'C4', { project: 'p1', question: 'Which DB?' })
  qa.answer(U, a.qid, { answer: 'pg' })
  const re = qa.answer(U, a.qid, { answer: 'sqlite', rev: 2 })
  assert.deepEqual(re.history.map((h) => h.answer), ['pg', 'sqlite'])
  assert.equal(re.status, 'answered')
  rejects(() => qa.answer(U, a.qid, { answer: 'x', rev: 1 }), 409)

  const b = qa.ask(A, 'C4', { project: 'p1', question: 'Ship?' })
  const viaToken = qa.answer({ actor: 'chatgpt', via: 'chatgpt' }, b.qid, { answer: 'yes' })
  assert.equal(viaToken.answer_state, 'pending_confirm')
  assert.equal(viaToken.status, 'open')
  rejects(() => qa.confirm({ actor: 'chatgpt', via: 'chatgpt' }, b.qid), 403)
  rejects(() => qa.confirm(U, b.qid, { relayed: true }), 403)
  const ok = qa.confirm(U, b.qid)
  assert.equal(ok.status, 'answered')
  assert.equal(ok.answer_state, 'confirmed')
  rejects(() => qa.confirm(U, b.qid), 409)
  assert.equal(qa.answer(U, b.qid, { answer: 'no', relayed: true }).answer_state, 'pending_confirm')

  const c = qa.ask(A, 'C4', { project: 'p1', question: 'Branch name?' })
  queue.enqueue({ type: 'message', to: { agent: 'pm-blitz' }, from: { agent: 'chatgpt' }, correlation_id: c.qid, body: { answer: 'blitz/main' } })
  const listed = qa.list({ campaign: 'C4', status: 'open' })
  const got = qa.get(c.qid)
  assert.equal(got.answer, 'blitz/main')
  assert.equal(got.answer_state, 'pending_confirm')
  assert.equal(got.history[0].source, 'bridge')
  assert.ok(listed.some((q) => q.qid === c.qid))
  qa.list({ campaign: 'C4' }) // the same reply is not recorded twice
  assert.equal(qa.get(c.qid).history.length, 1)
})

// 8. decision reuse
test('a confirmed answer with the same decision_key auto-answers a new question, which can be overridden', () => {
  const { qa } = qaWorld()
  const a = qa.ask(A, 'C5', { project: 'p1', question: 'Layout?', decision_key: 'repo-layout:x' })
  qa.answer(U, a.qid, { answer: 'monorepo' })
  const b = qa.ask(A, 'C6', { project: 'p2', question: 'Layout again?', decision_key: 'repo-layout:x' })
  assert.equal(b.status, 'answered')
  assert.equal(b.answer, 'monorepo')
  assert.equal(b.reused_from, a.qid)
  assert.equal(b.history[0].source, 'reuse')
  assert.equal(qa.answer(U, b.qid, { answer: 'polyrepo' }).answer, 'polyrepo')
  // an unconfirmed answer is not reused
  const c = qa.ask(A, 'C7', { project: 'p1', question: 'Port?', decision_key: 'port' })
  qa.answer(U, c.qid, { answer: '80', relayed: true })
  assert.equal(qa.ask(A, 'C8', { project: 'p1', question: 'Port?', decision_key: 'port' }).status, 'open')
})

// HTTP wiring
test('blitz routes are mounted on the pm server', async () => {
  const s = openStore(':memory:', { clock })
  const p = s.createProject(A, { name: 'web' })
  s.createTask(A, { project: 'web', title: 'do it', priority: 1 })
  const server = createServer(s)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-pm-actor': 'Claude Opus 5.5' }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, body: await r.json() }
  }
  try {
    assert.equal((await call('GET', '/api/blitz/top-projects?n=10')).body.projects[0].name, 'web')
    assert.equal((await call('PATCH', `/api/projects/${p.id}`, { rev: p.rev, priority: 1 })).body.priority, 1)
    assert.equal((await call('POST', '/api/blitz/discover', { projects: ['web'] })).body.candidates.length, 1)
    const q = (await call('POST', '/api/blitz/campaigns/C9/qa', { project: 'web', question: 'ok?' })).body
    assert.equal((await call('GET', '/api/blitz/campaigns/C9/qa/current')).body.open[0].qid, q.qid)
    assert.equal((await call('POST', `/api/blitz/qa/${q.qid}/answer`, { answer: 'yes' })).body.status, 'answered')
    assert.equal((await call('GET', `/api/blitz/qa/${q.qid}`)).body.history.length, 1)
    assert.equal((await call('GET', '/api/blitz/qa?campaign=C9')).body.length, 1)
    assert.equal((await call('GET', '/api/blitz/top-projects?projects=nope')).status, 400)
  } finally {
    server.close()
    s.close()
  }
})
