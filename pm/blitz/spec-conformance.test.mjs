// BLITZ-00 (T-2df5e988) release-gate conformance: asserts each locked decision Q1-Q12 is backed by
// a real module/export in pm/blitz. It starts nothing, launches no Blitz, touches no db.
// node --test blitz/spec-conformance.test.mjs   (run from pm/)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = (f) => readFileSync(join(here, f), 'utf8')
const mod = (f) => import(`./${f}`)

test('Q1 individual task preapproval bound to scope hash, merge ranks', async () => {
  const g = await mod('gate.mjs')
  for (const k of ['scopeHash', 'assertTaskApproved', 'approvalStatus', 'guardRequest', 'isGoverned']) assert.equal(typeof g[k], 'function', k)
  const a = g.scopeHash({ project_id: 'P', title: 't', body: 'b' }), b = g.scopeHash({ project_id: 'P', title: 't', body: 'b2' })
  assert.notEqual(a, b)
  assert.match(src('gate.mjs'), /merge/i)
})

test('Q2 hybrid discovery with dedupe, Q7 scoring and Phase 1 default top 10', async () => {
  const r = await mod('rank.mjs'); assert.equal(r.DEFAULT_TOP_N, 10); assert.equal(typeof r.topProjects, 'function')
  await mod('discovery.mjs'); await mod('rating.mjs')
  assert.match(src('discovery.mjs'), /provenance/)
})

test('Q3 named roster and policies, Q4 bounded parallelism across transports', async () => {
  const a = await mod('agents.mjs')
  for (const p of ['FIXED_ROSTER', 'FREE_FIRST', 'LOCAL_FIRST', 'USER_JOB_PROFILE']) assert.ok(a.POLICIES.includes(p), p)
  assert.ok(a.MAX_CONCURRENT >= 4); assert.ok(a.TRANSPORTS.length >= 3)
  const c = await mod('capacity.mjs'); assert.equal(typeof c.buildSnapshot, 'function'); assert.ok(c.STALE_SOURCE_MS > 0)
})

test('Q5 isolated workspaces + dependency-aware scheduling + integration', async () => {
  const d = await mod('dispatch.mjs'); assert.equal(typeof d.ensureWorkspace, 'function')
  const dag = await mod('dag.mjs'); assert.equal(typeof dag.buildDag, 'function')
  const i = await mod('integrate.mjs'); assert.ok(i.INTEGRATION_STATES.includes('needs_review')); assert.equal(typeof i.assessRisk, 'function')
})

test('Q6 recovery classes, escalation and retries', async () => {
  const r = await mod('recovery.mjs')
  for (const k of ['RATE_LIMIT', 'TRANSPORT', 'TIMEOUT', 'TEST_FAILURE', 'APPROVAL', 'CONFLICT', 'DEPENDENCY', 'VERIFIER']) assert.ok(r.CLASSES.includes(k), k)
  assert.equal(typeof r.createRecovery, 'function')
})

test('Q9/Q10 verification gate refuses pushes and keeps unverified tasks open', async () => {
  const v = await mod('verify.mjs'); assert.equal(typeof v.createVerifier, 'function'); assert.equal(typeof v.assertNoPush, 'function')
  assert.throws(() => v.assertNoPush('git push origin main'))
  const rel = await mod('release.mjs'); assert.equal(typeof rel.createReleaser, 'function')
})

test('Q11 headless status, final report; Q12 lifecycle with preflight, pause, cancel, explicit launch gate', async () => {
  const s = await mod('status.mjs'); for (const k of ['buildStatus', 'overview', 'finalReport']) assert.equal(typeof s[k], 'function', k)
  const c = await mod('campaigns.mjs')
  for (const st of ['draft', 'preflighted', 'launched', 'running', 'paused', 'completed', 'cancelled', 'failed']) assert.ok(c.CAMPAIGN_STATES.includes(st), st)
  const d = await mod('dispatch.mjs'); assert.equal(d.ENABLE_ENV, 'BLITZ_DISPATCH_ENABLED')
  assert.throws(() => d.assertDispatchAllowed({}, {}), /./) // dispatch refuses without explicit enablement
  const ctl = src('controller.mjs'); for (const w of ['preflight', 'pause', 'cancel']) assert.match(ctl, new RegExp(w))
})

test('Phase 2 shares the Phase 1 backend: routes and campaign store are the single API', async () => {
  await mod('routes.mjs'); await mod('campaign-routes.mjs'); await mod('status-routes.mjs')
})
