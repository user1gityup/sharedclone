// node --test blitz/campaigns.test.mjs   (run from pm/)   BLITZ-05, Claude Opus 5.5
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore, PmError } from '../store.mjs'
import { createCampaignStore, migrate } from './campaigns.mjs'
import { openQa } from './qa.mjs'

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const rejects = (fn, status, re) => assert.throws(fn, (e) => e instanceof PmError && e.status === status && (!re || re.test(e.message)))

test('tables are created idempotently; campaign round-trips; ids match qa.mjs', () => {
  const store = openStore(':memory:')
  migrate(store.db); migrate(store.db)
  const cs = createCampaignStore(store.db)
  const c = cs.insert(W, { projects: ['P-1'], roster: ['Ada'], schedule: { at: 'now' } })
  assert.match(c.id, /^C-[0-9a-f]{8}$/)
  assert.equal(c.state, 'draft')
  assert.equal(c.rev, 1)
  assert.deepEqual(c.projects, ['P-1'])
  assert.deepEqual(c.roster, ['Ada'])
  assert.deepEqual(c.schedule, { at: 'now' })
  assert.equal(c.created_by, 'Claude Opus 5.5')
  rejects(() => cs.insert(W, { id: c.id, projects: [], roster: [] }), 409)
  rejects(() => cs.insert(W, { id: 'bad id!', projects: [], roster: [] }), 400)
  rejects(() => cs.insert({}, { projects: [], roster: [] }), 400, /actor/)
  rejects(() => cs.get('C-none'), 404)
  // the same id works as a BLITZ-02 Q&A campaign id
  const p = store.createProject(W, { name: 'demo' })
  const qa = openQa(store)
  const q = qa.ask(W, c.id, { project: p.id, question: 'which branch?' })
  assert.equal(q.campaign_id, c.id)
})

test('update checks rev (optimistic concurrency)', () => {
  const store = openStore(':memory:')
  const cs = createCampaignStore(store.db)
  const c = cs.insert(W, { projects: [], roster: [] })
  const c2 = cs.update(W, c.id, c.rev, { title: 'x' })
  assert.equal(c2.rev, 2)
  rejects(() => cs.update(W, c.id, 1, { title: 'y' }), 409, /stale rev/)
  rejects(() => cs.update(W, c.id, undefined, { title: 'y' }), 400)
})

test('run events are append-only; onEvent fires after commit, not on rollback', () => {
  const store = openStore(':memory:')
  const seen = []
  const cs = createCampaignStore(store.db, { onEvent: (e) => seen.push(e.kind) })
  const c = cs.insert(W, { projects: [], roster: [] })
  cs.event(c.id, 'one', { a: 1 })
  assert.throws(() => cs.tx(() => { cs.event(c.id, 'rolled_back'); throw new Error('boom') }), /boom/)
  cs.tx(() => cs.event(c.id, 'two', { b: 2 }, { taskId: 'T-1' }))
  assert.deepEqual(seen, ['one', 'two'])
  assert.deepEqual(cs.events(c.id).map((e) => e.kind), ['one', 'two'])
  assert.deepEqual(cs.events(c.id, { task: 'T-1' })[0].data, { b: 2 })
  assert.throws(() => store.db.prepare("UPDATE blitz_run_events SET kind = 'x'").run(), /append-only/)
  assert.throws(() => store.db.prepare('DELETE FROM blitz_run_events').run(), /append-only/)
})

test('idempotency keys: claim once, settle, read back', () => {
  const store = openStore(':memory:')
  const cs = createCampaignStore(store.db)
  assert.equal(cs.claimKey('k1', 'C-1', 'dispatch'), true)
  assert.equal(cs.claimKey('k1', 'C-1', 'dispatch'), false)
  assert.equal(cs.idem('k1').status, 'pending')
  cs.settleKey('k1', 'done', { ref: 'r' })
  assert.deepEqual(cs.idem('k1').result, { ref: 'r' })
  assert.equal(cs.idem('nope'), null)
})
