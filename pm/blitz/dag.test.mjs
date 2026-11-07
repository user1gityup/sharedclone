// node --test blitz/dag.test.mjs   (run from pm/)   BLITZ-05, Claude Opus 5.5
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDag, dependsOnOf } from './dag.mjs'

const t = (id, deps, asString = false) => {
  const meta = deps ? { blitz: { depends_on: deps } } : {}
  return { id, meta: asString ? JSON.stringify(meta) : meta }
}

test('waves follow the longest dependency path; ties keep input order', () => {
  const d = buildDag([t('A'), t('B', ['A']), t('C', ['A']), t('D', ['B', 'C']), t('E'), t('F', ['A', 'D'], true)])
  assert.deepEqual(d.waves, [['A', 'E'], ['B', 'C'], ['D'], ['F']])
  assert.deepEqual(d.cycles, [])
  assert.equal(d.has_cycles, false)
  assert.deepEqual(d.blocked, [])
  assert.equal(d.waveOf.F, 3)
})

test('cycles are returned, not thrown; downstream of a cycle is blocked; the rest still waves', () => {
  const d = buildDag([t('A', ['C']), t('B', ['A']), t('C', ['B']), t('D', ['C']), t('E'), t('S', ['S'])])
  assert.equal(d.has_cycles, true)
  assert.deepEqual(d.cycles.map((c) => [...c].sort()), [['A', 'B', 'C'], ['S']])
  assert.deepEqual(d.blocked.sort(), ['A', 'B', 'C', 'D', 'S'])
  assert.deepEqual(d.waves, [['E']])
})

test('dependencies outside the set are reported as external, not edges', () => {
  const d = buildDag([t('A', ['T-outside']), t('B', ['A', 'T-other'])])
  assert.deepEqual(d.waves, [['A'], ['B']])
  assert.deepEqual(d.nodes.find((n) => n.id === 'B'), { id: 'B', depends_on: ['A'], external: ['T-other'] })
  assert.deepEqual(dependsOnOf(t('X', ['X', 'Y', 'Y'])), ['Y'])
})

test('a long chain does not overflow and malformed meta is ignored', () => {
  const chain = Array.from({ length: 3000 }, (_, i) => t(`N${i}`, i ? [`N${i - 1}`] : null))
  const d = buildDag(chain)
  assert.equal(d.waves.length, 3000)
  const bad = buildDag([{ id: 'A', meta: '{not json' }, { id: 'B', meta: { blitz: { depends_on: 'A' } } }])
  assert.deepEqual(bad.waves, [['A', 'B']])
})
