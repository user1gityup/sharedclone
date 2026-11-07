// node --test free-swarm.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as F from './free-swarm.mjs'

const NOW = Date.parse('2026-11-01T10:00:00Z')
const fresh = new Date(NOW - 60_000).toISOString()
const mkSeats = () => [
  { id: 'llama', cost_class: 'local', verified_free: true, machine: 'vmixer' },
  { id: 'fc', cost_class: 'free', verified_free: true, machine: 'ndi2', quota: { remaining: 10, as_of: fresh } },
  { id: 'opus', cost_class: 'metered', verified_free: false, machine: 'ndi2' },
  { id: 'sub', cost_class: 'included', verified_free: true, machine: 'ndi2', quota: { remaining: 99, as_of: fresh } },
  { id: 'mystery', cost_class: undefined, machine: 'ndi2' },
  { id: 'unver', cost_class: 'free', verified_free: false, machine: 'ndi2', quota: { remaining: 5, as_of: fresh } },
  { id: 'stale', cost_class: 'free', verified_free: true, machine: 'ndi2', quota: { remaining: 5, as_of: new Date(NOW - 3 * 3600_000).toISOString() } },
]
const OK = { good: new Set(['launch', 'pause', 'reassign', 'edit', 'approve', 'complete']), viewer: new Set([]) }
function mk(seatsArr = mkSeats(), over = {}) {
  const calls = []
  const sw = F.createFreeSwarm({
    seats: () => seatsArr, clock: () => NOW,
    can: (actor, op) => OK[actor]?.has(op) ?? false,
    invoke: async ({ seat, task }) => { calls.push(seat.id); if (over.fail?.(seat.id, calls)) throw new Error('boom'); return `done ${task.id}` },
    ...over,
  })
  return { sw, calls, seatsArr }
}
const EVID = { build: { exit_code: 0 }, tests: { exit_code: 0, passed: 5 }, review: { by: 'rev', verdict: 'pass' } }

test('default mode stays default; only free-only is selected explicitly', () => {
  assert.equal(F.resolveMode({}), 'default'); assert.equal(F.resolveMode({ mode: 'paid' }), 'default'); assert.equal(F.resolveMode({ mode: 'free-only' }), 'free-only')
})

test('eligibility: paid, included, unknown, unverified, stale and exhausted seats are excluded', () => {
  const run = mk().sw.create({ id: 'r', project: 'P', actor: 'good', pool: ['llama', 'fc', 'opus', 'sub', 'mystery', 'unver', 'stale', 'nope'] })
  assert.deepEqual(run.pool, ['llama', 'fc'])
  assert.equal(run.rejected.length, 6)
  assert.ok(run.rejected.every((r) => r.reason))
  assert.match(F.seatEligibility({ id: 'x', cost_class: 'free', verified_free: true, quota: { remaining: 0, as_of: fresh } }, { now: NOW }).reason, /exhausted/)
})

test('paid seats are never invoked, including on retry, failure and quota exhaustion', async () => {
  const seats = mkSeats()
  const { sw, calls } = mk(seats, { fail: (id, c) => c.length < 3 })
  sw.create({ id: 'r', project: 'P', actor: 'good', pool: ['llama', 'fc', 'opus', 'sub'], tasks: [{ id: 'a', approved: true }] })
  for (let i = 0; i < 6; i++) await sw.tick('r')
  assert.ok(calls.length >= 3)
  assert.ok(calls.every((c) => c === 'llama' || c === 'fc'), calls.join())
  // fc turns paid mid-run: dropped on recheck, never called again
  seats.find((s) => s.id === 'fc').cost_class = 'metered'
  sw.create({ id: 'r2', project: 'P', actor: 'good', pool: ['llama', 'fc'], tasks: [{ id: 'b', approved: true }] })
  assert.ok(!calls.includes('opus') && !calls.includes('sub'))
})

test('exhausted pool blocks with a cause instead of switching to paid', async () => {
  const seats = mkSeats(); const { sw, calls } = mk(seats)
  sw.create({ id: 'r', project: 'P', actor: 'good', pool: ['fc'], tasks: [{ id: 'a', approved: true }] })
  seats.find((s) => s.id === 'fc').quota.remaining = 0
  const run = await sw.tick('r')
  assert.equal(run.state, 'blocked'); assert.match(run.blocked_cause, /not falling back to paid/)
  assert.equal(calls.length, 0)
  const empty = mk().sw.create({ id: 'e', project: 'P', actor: 'good', pool: ['opus'] })
  assert.equal(empty.state, 'blocked'); assert.match(empty.blocked_cause, /no eligible free seat/)
})

test('scheduler: approval, dependencies, parallel cap and quota reservation', async () => {
  const { sw, calls } = mk(mkSeats(), { maxParallel: 1 })
  sw.create({ id: 'r', project: 'P', actor: 'good', pool: ['llama'], tasks: [{ id: 'a', approved: true }, { id: 'b', deps: ['a'], approved: true }, { id: 'c', approved: false }] })
  await sw.tick('r')
  assert.equal(sw.get('r').tasks.a.status, 'returned'); assert.equal(sw.get('r').tasks.b.status, 'queued'); assert.equal(sw.get('r').tasks.c.status, 'queued')
  assert.equal(calls.length, 1)
  await sw.tick('r'); assert.equal(sw.get('r').tasks.b.status, 'queued') // a returned, not verified yet
  sw.complete('r', 'good', 'a', EVID)
  await sw.tick('r'); assert.equal(sw.get('r').tasks.b.status, 'returned')
  assert.equal(sw.get('r').tasks.c.attempts.length, 0)
  // quota reservation: fc has 10 units, a 15-unit task cannot be admitted
  const big = mk(); big.sw.create({ id: 'q', project: 'P', actor: 'good', pool: ['fc'], tasks: [{ id: 'x', units: 15, approved: true }] })
  const r = await big.sw.tick('q'); assert.equal(r.state, 'blocked'); assert.equal(big.calls.length, 0)
})

test('completion needs build+test+review evidence; agent return alone is not done', async () => {
  const { sw } = mk()
  sw.create({ id: 'r', project: 'P', actor: 'good', pool: ['llama'], tasks: [{ id: 'a', approved: true }] })
  assert.throws(() => sw.complete('r', 'good', 'a', EVID), (e) => e.code === 'NOT_RETURNED')
  await sw.tick('r')
  assert.throws(() => sw.complete('r', 'good', 'a', { ...EVID, review: { verdict: 'fail', by: 'x' } }), (e) => e.code === 'EVIDENCE')
  assert.throws(() => sw.complete('r', 'good', 'a', {}), /build exit 0, tests passing, review pass/)
  sw.complete('r', 'good', 'a', EVID)
  assert.equal(sw.view('r').state, 'done'); assert.equal(sw.view('r').tasks[0].verified, true)
})

test('PM permissions gate every operation and audit denials; free seat selection grants nothing', () => {
  const { sw } = mk()
  assert.throws(() => sw.create({ id: 'r', project: 'P', actor: 'viewer', pool: ['llama'] }), (e) => e.code === 'FORBIDDEN')
  const run = sw.create({ id: 'r', project: 'P', actor: 'good', pool: ['llama'], tasks: [{ id: 'a' }] })
  for (const op of [() => sw.pause('r', 'viewer'), () => sw.approve('r', 'viewer', 'a'), () => sw.reassign('r', 'viewer', 'a', 'llama'), () => sw.complete('r', 'viewer', 'a', EVID), () => sw.expand('r', 'viewer', 'fc', ['fc'])]) {
    assert.throws(op, (e) => e.code === 'FORBIDDEN')
  }
  assert.ok(run.audit.some((a) => a.outcome === 'denied'))
  assert.equal(sw.get('r').paused, false)
})

test('reassign and expand stay inside the chosen free pool', () => {
  const { sw } = mk()
  sw.create({ id: 'r', project: 'P', actor: 'good', pool: ['llama'], tasks: [{ id: 'a' }] })
  assert.throws(() => sw.reassign('r', 'good', 'a', 'fc'), (e) => e.code === 'INELIGIBLE')
  assert.throws(() => sw.reassign('r', 'good', 'a', 'opus'), (e) => e.code === 'INELIGIBLE')
  assert.equal(sw.expand('r', 'good', 'fc', ['llama']), false)
  assert.equal(sw.expand('r', 'good', 'opus', ['opus']), false)
  assert.equal(sw.expand('r', 'good', 'fc', ['llama', 'fc']), true)
  assert.doesNotThrow(() => sw.reassign('r', 'good', 'a', 'fc'))
})

test('view shows seats, reasons, quota, machine and blockers', () => {
  const { sw } = mk()
  sw.create({ id: 'r', project: 'P', actor: 'good', pool: ['llama', 'fc', 'opus'] })
  const v = sw.view('r')
  assert.deepEqual(v.seats.map((s) => [s.id, s.machine, s.quota_remaining]), [['llama', 'vmixer', null], ['fc', 'ndi2', 10]])
  assert.equal(v.rejected[0].seat, 'opus')
})
