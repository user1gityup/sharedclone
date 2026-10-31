// BLITZ-07 routes (Claude Opus 5.5): verification evidence, integration queue, releases.
// server.mjs tuples [method, regex, handler(m, body, w, query)], anchored like campaign-routes.mjs,
// so none of them collides with BLITZ-05 /campaigns/:id/* or BLITZ-02 /campaigns/:id/qa*.
// Nothing here pushes or deploys: a release is a record plus, at most, gatekeeper-entry TEXT.
import { createVerifier } from './verify.mjs'
import { createIntegrator, createGitRunner } from './integrate.mjs'
import { createReleaser } from './release.mjs'

const B = String.raw`^\/api\/blitz`
const ID = String.raw`([\w.-]{1,64})`
const TASK = String.raw`([\w-]+)`
const re = (s) => new RegExp(`${B}${s}$`)
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean))

/**
 * @param o.store     pm store
 * @param o.ledgerDb  () => approval ledger db or null
 * @param o.verifier  the verify function also passed to createController (default: createVerifier, review not wired)
 * @param o.controller the controller that verifier is wired into: re-verify runs through controller.reverify
 * @param o.integrator / o.releaser  existing instances (tests); otherwise built here
 * @param o.git       git runner for integration (default createGitRunner(): real git, never pushes)
 * @param o.rules     per-repo merge rules; empty = nothing ever merges
 */
export function verifyRoutes({ store, ledgerDb = () => null, verifier, controller = null, integrator, releaser, git, rules = {}, clock, ...verifyOpts } = {}) {
  if (!store?.db) return []
  const db = store.db
  const v = verifier ?? createVerifier({ db, clock, ...verifyOpts })
  const integ = integrator ?? createIntegrator({ db, store, ledgerDb, git: git ?? createGitRunner(), rules, clock, controller })
  const rel = releaser ?? createReleaser({ db, store, ledgerDb, clock })
  return [
    ['GET', re(`\\/campaigns\\/${ID}\\/evidence`), (m, b, w, q) => v.evidenceOf(m[1], { task: q.task })],
    ['POST', re(`\\/campaigns\\/${ID}\\/tasks\\/${TASK}\\/verify`), (m, b, w) => (controller ?? v).reverify(w, m[1], decodeURIComponent(m[2]))],
    ['POST', re(`\\/campaigns\\/${ID}\\/integration`), (m, b, w) => integ.enqueueVerified(w, m[1])],
    ['POST', re(`\\/campaigns\\/${ID}\\/tasks\\/${TASK}\\/review`), (m, b, w) => integ.review(w, m[1], decodeURIComponent(m[2]), b)],
    ['POST', re(`\\/campaigns\\/${ID}\\/tasks\\/${TASK}\\/integration-retry`), (m, b, w) => integ.retry(w, m[1], decodeURIComponent(m[2]), b)],
    ['GET', re('\\/integration'), (m, b, w, q) => integ.queue({ campaignId: q.campaign, repo: q.repo, state: q.state })],
    ['POST', re('\\/integration\\/process'), (m, b, w) => integ.process(w, { repo: b.repo, campaignId: b.campaign })],
    ['GET', re('\\/releases\\/summary'), (m, b, w, q) => rel.summary(list(q.campaigns))],
    ['GET', re('\\/releases'), (m, b, w, q) => rel.list({ campaign: q.campaign })],
    ['POST', re('\\/releases'), (m, b, w) => rel.create(w, { campaigns: list(b.campaigns), model: b.model })],
    ['GET', re(`\\/releases\\/(R-[0-9a-f]{8})`), (m) => rel.get(m[1])],
  ]
}
