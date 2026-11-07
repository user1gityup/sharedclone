// node --test blitz/agents.test.mjs   (run from pm/)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, PmError } from '../store.mjs'
import { createAgentRegistry, blitzDb, knownMachines } from './agents.mjs'

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
const MACHINES = new Set(['vmixer2o2', 'ndi2'])
const rejects = (fn, status, re) => assert.throws(fn, (e) => e instanceof PmError && e.status === status && (!re || re.test(e.message)))
const agent = (over = {}) => ({ name: 'Ada', role: 'builder', machine: 'vmixer2o2', transport: 'dsh-run', model_policy: { policy: 'FREE_FIRST', allow: ['local'] }, max_concurrent: 2, ...over })

function fresh() {
  const store = openStore(':memory:')
  const db = new DatabaseSync(':memory:')
  return { store, db, reg: createAgentRegistry(db, { store, machines: MACHINES }) }
}

test('a fresh registry has no agents and no default roster', () => {
  const { reg } = fresh()
  assert.deepEqual(reg.list(), [])
  rejects(() => reg.selectRoster([]), 400, /no default roster/)
  rejects(() => reg.selectRoster(undefined), 400)
})

test('create, get, list; record shape round-trips', () => {
  const { reg } = fresh()
  const a = reg.create(W, agent({ capabilities: { code: 'high' } }))
  assert.equal(a.rev, 1)
  assert.equal(a.enabled, true)
  assert.deepEqual(a.model_policy, { policy: 'FREE_FIRST', allow: ['local'] })
  assert.deepEqual(a.capabilities, { code: 'high' })
  assert.equal(a.created_by, 'Claude Opus 5.5')
  assert.deepEqual(reg.get('Ada'), a)
  assert.equal(reg.list().length, 1)
  rejects(() => reg.get('nobody'), 404)
})

test('validation refuses bad input', () => {
  const { reg } = fresh()
  rejects(() => reg.create({}, agent()), 400, /actor/)
  rejects(() => reg.create(W, agent({ name: '' })), 400, /name/)
  rejects(() => reg.create(W, agent({ name: '../x' })), 400, /name/)
  rejects(() => reg.create(W, agent({ role: ' ' })), 400, /role/)
  rejects(() => reg.create(W, agent({ machine: 'mars' })), 400, /machine/)
  rejects(() => reg.create(W, agent({ transport: 'ssh' })), 400, /transport/)
  rejects(() => reg.create(W, agent({ model_policy: { policy: 'CHEAPEST' } })), 400, /policy/)
  rejects(() => reg.create(W, agent({ model_policy: 'FREE_FIRST' })), 400, /model_policy/)
  rejects(() => reg.create(W, agent({ model_policy: { policy: 'FREE_FIRST', allow: [1] } })), 400, /allow/)
  rejects(() => reg.create(W, agent({ max_concurrent: 0 })), 400, /max_concurrent/)
  rejects(() => reg.create(W, agent({ max_concurrent: 1.5 })), 400, /max_concurrent/)
  rejects(() => reg.create(W, agent({ capabilities: { code: 'great' } })), 400, /capability/)
  assert.deepEqual(reg.list(), [])
})

test('duplicate name is 409', () => {
  const { reg } = fresh()
  reg.create(W, agent())
  rejects(() => reg.create(W, agent()), 409)
})

test('update needs the current rev; stale rev is 409', () => {
  const { reg } = fresh()
  reg.create(W, agent())
  rejects(() => reg.update(W, 'Ada', { role: 'reviewer' }), 400, /rev/)
  const u = reg.update(W, 'Ada', { rev: 1, role: 'reviewer', max_concurrent: 3 })
  assert.equal(u.rev, 2)
  assert.equal(u.role, 'reviewer')
  assert.equal(u.max_concurrent, 3)
  assert.equal(u.machine, 'vmixer2o2')
  rejects(() => reg.update(W, 'Ada', { rev: 1, role: 'x' }), 409)
  rejects(() => reg.update(W, 'Ada', { rev: 2 }), 400, /nothing/)
  rejects(() => reg.update(W, 'Ada', { rev: 2, machine: 'mars' }), 400)
})

test('disable keeps the row and removes it from rosters', () => {
  const { reg } = fresh()
  reg.create(W, agent())
  reg.create(W, agent({ name: 'Grace', transport: 'bridge-claude', model_policy: { policy: 'TOKEN_EFFICIENT', pin: 'sonnet' } }))
  const d = reg.disable(W, 'Ada', { rev: 1 })
  assert.equal(d.enabled, false)
  assert.equal(reg.list().length, 2)
  assert.deepEqual(reg.list({ enabled: 'true' }).map((a) => a.name), ['Grace'])
  assert.deepEqual(reg.list({ enabled: 'false' }).map((a) => a.name), ['Ada'])
  rejects(() => reg.selectRoster(['Ada']), 400, /disabled/)
})

test('selectRoster returns exactly the named agents, in order', () => {
  const { reg } = fresh()
  reg.create(W, agent())
  reg.create(W, agent({ name: 'Grace' }))
  reg.create(W, agent({ name: 'Linus' }))
  assert.deepEqual(reg.selectRoster(['Linus', 'Ada']).map((a) => a.name), ['Linus', 'Ada'])
  rejects(() => reg.selectRoster(['Ada', 'Ada']), 400, /unique/)
  rejects(() => reg.selectRoster(['Ada', 'Nobody']), 400, /unknown/)
})

test('changes are recorded as pm events', () => {
  const { reg, store } = fresh()
  reg.create(W, agent())
  reg.update(W, 'Ada', { rev: 1, role: 'reviewer' })
  const ev = store.events({}).filter((e) => e.entity === 'blitz_agent')
  assert.deepEqual(ev.map((e) => e.action).sort(), ['created', 'updated'])
  assert.equal(ev[0].actor, 'Claude Opus 5.5')
})

test('known machines include both physical hosts and their aliases', () => {
  const m = knownMachines()
  for (const n of ['ndi2', 'vmixlaptop2x6', 'vmixer2o2', 'vmixer']) assert.ok(m.has(n), n)
})

test('second connection on the pm db file: both see writes, no lock errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-agents-'))
  try {
    const store = openStore(join(dir, 'pm.db'))
    const db = blitzDb(store)
    assert.notEqual(db, undefined)
    const reg = createAgentRegistry(db, { store, machines: MACHINES })
    store.createProject(W, { name: 'p' })
    for (let i = 0; i < 20; i++) {
      reg.create(W, agent({ name: `a${i}` }))
      store.createTask(W, { project: 'p', title: `t${i}` })
    }
    assert.equal(reg.list().length, 20)
    assert.equal(store.listTasks({}).length, 20)
    assert.equal(store.events({}).filter((e) => e.entity === 'blitz_agent').length, 20)
    if (db !== store.db) db.close()
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
