// node --test blitz/rating.test.mjs   (run from pm/)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, PmError } from '../store.mjs'
import { validateRating, rateTask } from './rating.mjs'

const W = { actor: 'Claude Opus 5.5', model: 'claude-opus-5-5' }
export const GOOD = Object.freeze({
  priority: 1, effort: 3, complexity: 4, risk: 2,
  resources: { machine: 'vmixer2o2', model_class: 'paid', quota_cost: 'med', seats: ['claude'] },
  dependency: { depends_on: ['T-abc123'], blocks: [] },
  verification: { level: 'integration', tests: ['node --test'] },
  rationale: 'gate before the controller',
})
const is400 = (fn) => assert.throws(fn, (e) => e instanceof PmError && e.status === 400)

test('valid rating is normalized; server-set keys are dropped', () => {
  const r = validateRating({ ...GOOD, rated_by: 'mallory', rated_at: 'x', rated_model: 'y', rationale: '  why  ' })
  assert.equal(r.rationale, 'why')
  assert.equal(r.rated_by, undefined)
  assert.deepEqual(r.resources, GOOD.resources)
  assert.deepEqual(validateRating({ ...GOOD, resources: {}, dependency: { depends_on: [] }, verification: { level: 'manual' } }).resources, {})
})

test('each bad field is refused with 400', () => {
  for (const k of ['priority', 'effort', 'complexity', 'risk']) {
    is400(() => validateRating({ ...GOOD, [k]: 0 }))
    is400(() => validateRating({ ...GOOD, [k]: 6 }))
    is400(() => validateRating({ ...GOOD, [k]: 2.5 }))
    const { [k]: _, ...missing } = GOOD
    is400(() => validateRating(missing))
  }
  is400(() => validateRating({ ...GOOD, extra: 1 }))
  is400(() => validateRating({ ...GOOD, resources: { gpu: 'x' } }))
  is400(() => validateRating({ ...GOOD, resources: { model_class: 'cheap' } }))
  is400(() => validateRating({ ...GOOD, resources: { quota_cost: 'huge' } }))
  is400(() => validateRating({ ...GOOD, dependency: { depends_on: ['not-a-task'] } }))
  is400(() => validateRating({ ...GOOD, dependency: {} }))
  is400(() => validateRating({ ...GOOD, verification: { level: 'vibes' } }))
  is400(() => validateRating({ ...GOOD, rationale: '' }))
  is400(() => validateRating({ ...GOOD, rationale: 'x'.repeat(2001) }))
  is400(() => validateRating(null))
})

test('rateTask merges into meta, keeps other keys, and refuses a stale rev', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-rating-'))
  const store = openStore(join(dir, 'pm.db'))
  try {
    store.createProject(W, { name: 'p' })
    const t = store.createTask(W, { project: 'p', title: 't', meta: { prepared: { run: 1 }, blitz: { scope: { x: 1 } } } })
    const r = rateTask(store, W, t.id, { rev: t.rev, ...GOOD })
    const meta = JSON.parse(r.meta)
    assert.deepEqual(meta.prepared, { run: 1 })
    assert.deepEqual(meta.blitz.scope, { x: 1 })
    assert.equal(meta.blitz.rating.priority, 1)
    assert.equal(meta.blitz.rating.rated_by, W.actor)
    assert.equal(meta.blitz.rating.rated_model, W.model)
    assert.equal(r.rev, t.rev + 1)
    assert.throws(() => rateTask(store, W, t.id, { rev: t.rev, ...GOOD }), (e) => e instanceof PmError && e.status === 409)
    is400(() => rateTask(store, W, t.id, { ...GOOD }))
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})
