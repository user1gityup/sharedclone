// BLITZ-06 recovery + escalation routes (Claude Opus 5.5), as server.mjs tuples
// [method, regex, handler(m, body, w, query, principal)], same style as campaign-routes.mjs.
// A role-checked token principal (not loopback or the PM_TOKEN peer) answers only by relay, so
// its answer stays pending_confirm until a direct caller confirms (discovery-routes.mjs rule).
import { TRUSTED_PRINCIPALS } from '../access.mjs'
import { createRecoveringController, bridgeAdapter } from './recovery.mjs'

const ID = String.raw`([\w.-]{1,64})`
const via = (w, p) => ({ ...w, via: w?.via ?? (p && !TRUSTED_PRINCIPALS.has(p.name) ? p.name : null) })

/**
 * @param o.recovery  an attached createRecovery() instance (preferred: share the controller BLITZ-08 runs)
 * @param o.store     pm store; with no recovery given, one is built with its own controller
 * @param o.bridge    pm's createBridge() object (or null); wrapped with bridgeAdapter
 */
export function recoveryRoutes({ store, recovery, bridge = null, ...deps } = {}) {
  if (!recovery && !store?.db) return []
  const rec = recovery ?? createRecoveringController({ store, bridge: bridgeAdapter(() => bridge), ...deps }).recovery
  const E = (s) => new RegExp(String.raw`^\/api\/blitz\/escalations${s}$`)
  const C = (s) => new RegExp(String.raw`^\/api\/blitz\/campaigns\/${ID}\/recovery${s}$`)
  return [
    ['GET', E(''), (m, b, w, q) => rec.list({ campaign: q.campaign, status: q.status, task: q.task })],
    ['GET', E(`\\/${ID}`), (m) => rec.get(m[1])],
    ['POST', E(`\\/${ID}\\/answer`), (m, b, w, q, p) => rec.answer(via(w, p), m[1], b)],
    ['POST', E(`\\/${ID}\\/confirm`), (m, b, w, q, p) => rec.confirm(via(w, p), m[1], b)],
    ['GET', C(''), (m) => rec.status(m[1])],
    ['POST', C('\\/pump'), (m, b, w) => rec.pump(w, m[1])],
    ['POST', C('\\/tick'), (m, b, w) => rec.tick(w, m[1], b)],
  ]
}
