// node --test bridge/grant-sources.test.mjs   (run from pm/)
// createWorkers resolveGrant (C1 grant unioned with policy tools/deny) and body.sources preflight.
// Every path the worker touches lives under a temp root: BRIDGE_EXEC_ROOTS points there, each
// message passes body.cwd inside it, and logDir is a temp dir, so nothing is created under ~/.claude.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as lc from './lifecycle.mjs'
import * as grants from '../grants.mjs'
import { openQueue } from './queue.mjs'
import { loadPolicy } from './delivery.mjs'
import { createWorkers } from './workers.mjs'
import { workerPermissions } from '../permissions.mjs'

const ROOT = mkdtempSync(join(tmpdir(), 'gs-root-'))
const OUTSIDE = mkdtempSync(join(tmpdir(), 'gs-out-'))
process.env.BRIDGE_EXEC_ROOTS = ROOT
delete process.env.BRIDGE_AUTO_TOOLS
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const POLICY = { headless_tools: ['mcp__pm', 'Read'], headless_deny: ['Read(**/.env)', 'WebFetch'] }

function rig({ resolveGrant, policy = POLICY } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gs-w-'))
  writeFileSync(join(dir, 'bridge-policy.json'), JSON.stringify(policy))
  const fake = join(dir, 'fake.mjs')
  writeFileSync(fake, readFileSync(new URL('./fake-claude.mjs', import.meta.url)))
  const q = openQueue(':memory:', { machine: 'a', policy: () => loadPolicy(join(dir, 'bridge-policy.json')) })
  const perms = resolveGrant === 'wired' ? workerPermissions(q.db) : null
  const logDir = join(dir, 'logs')
  const w = createWorkers(q, { bin: process.execPath, binArgs: [fake], router: null, logDir, quota: () => ({ ok: true, headroom: 0.9 }),
    resolveGrant: perms ? perms.resolveGrant : resolveGrant })
  const submit = (id, body, extra = {}) => {
    const cwd = join(ROOT, id)
    return q.enqueue({ id, type: 'submit', from: { agent: 'tester' }, to: { machine: 'a', agent: 'claude-code' }, body: { prompt: 'hi', model: 'sonnet', cwd, ...body }, ...extra })
  }
  const replies = (id) => q.list({ agent: 'tester', limit: 1000 }).filter((m) => m.reply_to === id || m.correlation_id === id)
  const logOf = (id) => (existsSync(join(logDir, `${id}.log`)) ? readFileSync(join(logDir, `${id}.log`), 'utf8') : '')
  const settled = async (id) => {
    for (let i = 0; i < 200; i++) {
      await w.tick()
      const r = replies(id)
      if (r.some((m) => m.type === 'result' || m.type === 'error' || (m.type === 'status' && m.body?.state))) return r
      await sleep(30)
    }
    throw new Error(`timeout ${id}: ${JSON.stringify(replies(id).map((m) => m.type))}`)
  }
  return { q, w, submit, replies, logOf, settled, perms, dir }
}

const argList = (log, flag) => {
  const line = log.split('\n').find((l) => / spawn /.test(l))
  assert.ok(line, 'spawn line logged')
  const m = line.match(new RegExp(`${flag} (\\S+)`))
  return m ? m[1].split(',') : []
}
const sorted = (a) => [...a].sort()

test('policy only: --allowedTools/--disallowedTools are the policy lists, log says grant none', async () => {
  const { submit, settled, logOf, q } = rig({ resolveGrant: () => null })
  submit('p1', {})
  const r = await settled('p1')
  assert.ok(r.some((m) => m.type === 'accept'))
  assert.ok(r.some((m) => m.type === 'result'), JSON.stringify(r.map((m) => [m.type, m.body])))
  const log = logOf('p1')
  assert.deepEqual(argList(log, '--allowedTools'), POLICY.headless_tools)
  assert.deepEqual(argList(log, '--disallowedTools'), POLICY.headless_deny)
  assert.match(log, /grant none \(policy only\)/)
  q.close()
})

test('no resolveGrant option at all behaves as policy only', async () => {
  const { submit, settled, logOf, q } = rig({ resolveGrant: undefined })
  submit('p0', {})
  await settled('p0')
  assert.deepEqual(argList(logOf('p0'), '--allowedTools'), POLICY.headless_tools)
  assert.match(logOf('p0'), /grant none \(policy only\)/)
  q.close()
})

test('wired claude-code grant: tools and deny are unioned; a grant never removes a policy deny', async () => {
  const { submit, settled, logOf, q } = rig({ resolveGrant: 'wired' })
  // the grant re-lists a policy-denied tool among its tools and denies something new
  const g = grants.issueGrant(q.db, { project: 'p1', role: 'worker', agent: 'claude-code', host: q.machine, issuer: 'alice', approval_id: 'ap1',
    tools: ['Read', 'Write', 'WebFetch'], deny: ['Bash'] })
  submit('g1', {}, { project: 'p1' })
  const r = await settled('g1')
  assert.ok(r.some((m) => m.type === 'result'))
  const log = logOf('g1')
  assert.deepEqual(sorted(argList(log, '--allowedTools')), sorted(['mcp__pm', 'Read', 'Write']), 'a denied tool is dropped from the allow list')
  const deny = argList(log, '--disallowedTools')
  assert.deepEqual(sorted(deny), sorted(['Read(**/.env)', 'WebFetch', 'Bash']))
  assert.ok(deny.includes('WebFetch'), 'policy deny survives a grant that lists the tool')
  assert.match(log, new RegExp(`grant ${g.id} v1 p1/worker/claude-code@a`))
  // a grant for another project does not apply
  submit('g1-other', {}, { project: 'p2' })
  await settled('g1-other')
  assert.match(logOf('g1-other'), /grant none \(policy only\)/)
  q.close()
})

test('auto mode: base tools are BRIDGE_AUTO_TOOLS / mcp__pm, unioned with the grant', async () => {
  const { submit, settled, logOf, q } = rig({ resolveGrant: () => ({ id: 'G', version: 3, project: 'p', role: 'worker', agent: 'claude-code', host: 'a', tools: ['Edit'], deny: [] }) })
  submit('au1', { permission_mode: 'auto' })
  await settled('au1')
  assert.deepEqual(sorted(argList(logOf('au1'), '--allowedTools')), sorted(['mcp__pm', 'Edit']))
  assert.match(logOf('au1'), /grant G v3 p\/worker\/claude-code@a/)
  process.env.BRIDGE_AUTO_TOOLS = 'mcp__pm,mcp__x'
  try {
    submit('au2', { permission_mode: 'auto' })
    await settled('au2')
    assert.deepEqual(sorted(argList(logOf('au2'), '--allowedTools')), sorted(['mcp__pm', 'mcp__x', 'Edit']))
  } finally { delete process.env.BRIDGE_AUTO_TOOLS }
  q.close()
})

test('wired fallback: remote grant used without a claude-code grant; revoked -> none; no project -> bridge', async () => {
  const { submit, settled, logOf, q } = rig({ resolveGrant: 'wired' })
  const remote = grants.issueGrant(q.db, { project: 'p3', role: 'worker', agent: 'remote', host: q.machine, issuer: 'alice', approval_id: 'ap', tools: ['Glob'] })
  submit('f1', {}, { project: 'p3' })
  await settled('f1')
  assert.match(logOf('f1'), new RegExp(`grant ${remote.id} v1 p3/worker/remote@a`))
  assert.ok(argList(logOf('f1'), '--allowedTools').includes('Glob'))

  grants.revokeGrant(q.db, remote.id, { by: 'alice', reason: 'test' })
  submit('f2', {}, { project: 'p3' })
  await settled('f2')
  assert.match(logOf('f2'), /grant none \(policy only\)/)
  assert.ok(!argList(logOf('f2'), '--allowedTools').includes('Glob'))

  // a claude-code grant wins over a remote grant for the same key
  grants.issueGrant(q.db, { project: 'p4', role: 'worker', agent: 'remote', host: q.machine, issuer: 'alice', approval_id: 'ap', tools: ['Glob'] })
  const cc = grants.issueGrant(q.db, { project: 'p4', role: 'worker', agent: 'claude-code', host: q.machine, issuer: 'alice', approval_id: 'ap', tools: ['Grep'] })
  submit('f3', {}, { project: 'p4' })
  await settled('f3')
  assert.match(logOf('f3'), new RegExp(`grant ${cc.id} `))

  const br = grants.issueGrant(q.db, { project: 'bridge', role: 'worker', agent: 'claude-code', host: q.machine, issuer: 'alice', approval_id: 'ap', tools: ['LS'] })
  submit('f4', {})
  await settled('f4')
  assert.match(logOf('f4'), new RegExp(`grant ${br.id} v1 bridge/worker/claude-code@a`))
  q.close()
})

test('workerPermissions.resolveGrant maps project/host to the C1 key', () => {
  const { q, perms } = rig({ resolveGrant: 'wired' })
  assert.equal(perms.resolveGrant({ project: null, host: 'a' }), null)
  const g = grants.issueGrant(q.db, { project: 'bridge', role: 'worker', agent: 'remote', host: 'b', issuer: 'x', approval_id: 'y' })
  assert.equal(perms.resolveGrant({ project: '', host: 'b' })?.id, g.id)
  assert.equal(perms.resolveGrant({ project: null, host: 'a' }), null, 'host is part of the key')
  q.close()
})

test('resolveGrant throwing: run still starts with policy only, failure logged', async () => {
  const { submit, settled, logOf, q } = rig({ resolveGrant: () => { throw new Error('grants db locked') } })
  submit('t1', {}, { project: 'p1' })
  const r = await settled('t1')
  assert.ok(r.some((m) => m.type === 'accept'))
  assert.ok(r.some((m) => m.type === 'result'))
  const log = logOf('t1')
  assert.match(log, /grant lookup failed grants db locked/)
  assert.match(log, /grant none \(policy only\)/)
  assert.deepEqual(argList(log, '--allowedTools'), POLICY.headless_tools)
  q.close()
})

test('sources: denied, missing, malformed are refused before any run row or spawn; present proceeds', async () => {
  const { submit, settled, logOf, q } = rig({ resolveGrant: () => null })
  const outsideFile = join(OUTSIDE, 'real.txt'); writeFileSync(outsideFile, 'x')
  const refused = async (id, body) => {
    submit(id, body)
    const r = await settled(id)
    assert.ok(!r.some((m) => m.type === 'accept'), `${id} not accepted`)
    assert.equal(lc.getRun(q.db, id), null, `${id} has no bridge_runs row`)
    assert.doesNotMatch(logOf(id), / spawn /, `${id} never spawned`)
    const err = r.find((m) => m.type === 'error')
    assert.ok(err, `${id} final error`)
    return err.body
  }

  let e = await refused('s-denied', { sources: [join(OUTSIDE, 'absent.txt')] })
  assert.equal(e.state, 'SOURCE_DENIED'); assert.deepEqual(e.denied, [join(OUTSIDE, 'absent.txt')])

  // denial wins over existence: a real file outside the roots is SOURCE_DENIED, not accepted
  e = await refused('s-denied-real', { sources: [outsideFile] })
  assert.equal(e.state, 'SOURCE_DENIED'); assert.deepEqual(e.denied, [outsideFile])
  assert.equal(e.missing, undefined)

  // a relative path escaping cwd is resolved against cwd and denied
  e = await refused('s-escape', { sources: ['../../' + 'x.txt'] })
  assert.equal(e.state, 'SOURCE_DENIED')

  // mixed: one denied, one missing inside -> denial checked first
  e = await refused('s-mixed', { sources: [join(ROOT, 'nope.txt'), outsideFile] })
  assert.equal(e.state, 'SOURCE_DENIED'); assert.deepEqual(e.denied, [outsideFile])

  e = await refused('s-missing', { sources: [join(ROOT, 'nope.txt'), 'rel-missing.txt'] })
  assert.equal(e.state, 'MISSING_SOURCE'); assert.deepEqual(e.missing, [join(ROOT, 'nope.txt'), 'rel-missing.txt'])

  for (const [i, bad] of [['a', 'not-an-array'], ['b', { p: 1 }], ['c', [42]], ['d', ['  ']]]) {
    e = await refused(`s-bad-${i}`, { sources: bad })
    assert.match(e.error, /body\.sources must be an array of paths/)
  }

  mkdirSync(join(ROOT, 'inputs'), { recursive: true })
  writeFileSync(join(ROOT, 'inputs', 'a.txt'), 'a')
  mkdirSync(join(ROOT, 's-ok'), { recursive: true }); writeFileSync(join(ROOT, 's-ok', 'b.txt'), 'b')
  submit('s-ok', { sources: [join(ROOT, 'inputs', 'a.txt'), 'b.txt', ROOT] })
  const r = await settled('s-ok')
  assert.ok(r.some((m) => m.type === 'accept'))
  assert.ok(r.some((m) => m.type === 'result'), JSON.stringify(r.map((m) => [m.type, m.body])))
  assert.match(logOf('s-ok'), / spawn /)
  assert.ok(lc.getRun(q.db, 's-ok'))

  submit('s-empty', { sources: [] })
  assert.ok((await settled('s-empty')).some((m) => m.type === 'result'), 'empty sources list proceeds')
  q.close()
})
