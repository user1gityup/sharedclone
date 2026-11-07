// BLITZ-05 campaign routes (Claude Opus 5.5), as server.mjs tuples [method, regex, handler(m, body, w, query)].
// Every pattern is anchored, so BLITZ-02's /api/blitz/campaigns/:id/qa* routes never collide.
// Writes need an actor (w) and campaign writes take rev; worker task calls are fenced by lease
// owner + attempt instead. Nothing here dispatches real work: dispatch is injected (default throws).
import { createController } from './controller.mjs'

const C = String.raw`^\/api\/blitz\/campaigns`
const ID = String.raw`([\w.-]{1,64})`
const re = (s) => new RegExp(`${C}${s}$`)

/**
 * @param o.store    pm store
 * @param o.ledgerDb () => approval-ledger db or null (server.mjs passes () => bridge?.queue?.db ?? null)
 * @param o.controller an existing controller (tests, BLITZ-08); otherwise built from the rest of `o`
 */
export function campaignRoutes({ store, controller, ...deps } = {}) {
  if (!store?.db && !controller) return []
  const ctl = controller ?? createController({ store, ...deps })
  const task = (m, b) => ({ ...b, taskId: decodeURIComponent(m[2]) })
  return [
    ['GET', re(''), (m, b, w, q) => ctl.list({ state: q.state })],
    ['POST', re(''), (m, b, w) => ctl.create(w, b)],
    ['GET', re(`\\/${ID}`), (m) => ctl.get(m[1])],
    ['PATCH', re(`\\/${ID}`), (m, b, w) => ctl.update(w, m[1], b)],
    ['POST', re(`\\/${ID}\\/preflight`), (m, b, w) => ctl.preflight(w, m[1], b)],
    ['POST', re(`\\/${ID}\\/launch`), (m, b, w) => ctl.launch(w, m[1], b)],
    ['POST', re(`\\/${ID}\\/pause`), (m, b, w) => ctl.pause(w, m[1], b)],
    ['POST', re(`\\/${ID}\\/resume`), (m, b, w) => ctl.resume(w, m[1], b)],
    ['POST', re(`\\/${ID}\\/cancel`), (m, b, w) => ctl.cancel(w, m[1], b)],
    ['POST', re(`\\/${ID}\\/tick`), (m, b, w) => ctl.tick(w, m[1], b)],
    ['POST', re(`\\/${ID}\\/recover`), (m, b, w) => ctl.recover(w, m[1])],
    ['GET', re(`\\/${ID}\\/dag`), (m) => ctl.dag(m[1])],
    ['GET', re(`\\/${ID}\\/status`), (m, b, w, q) => ctl.status(m[1], { tail: q.tail })],
    ['GET', re(`\\/${ID}\\/events`), (m, b, w, q) => ctl.events(m[1], { since: q.since, limit: q.limit, task: q.task, kind: q.kind })],
    ['POST', re(`\\/${ID}\\/tasks\\/([\\w-]+)\\/heartbeat`), (m, b, w) => ctl.heartbeat(w, m[1], task(m, b))],
    ['POST', re(`\\/${ID}\\/tasks\\/([\\w-]+)\\/checkpoint`), (m, b, w) => ctl.checkpoint(w, m[1], task(m, b))],
    ['POST', re(`\\/${ID}\\/tasks\\/([\\w-]+)\\/result`), (m, b, w) => ctl.reportResult(w, m[1], task(m, b))],
    ['POST', re(`\\/${ID}\\/tasks\\/([\\w-]+)\\/failure`), (m, b, w) => ctl.reportFailure(w, m[1], task(m, b))],
    ['POST', re(`\\/${ID}\\/tasks\\/([\\w-]+)\\/cancel-ack`), (m, b, w) => ctl.ackCancel(w, m[1], task(m, b))],
    ['POST', re(`\\/${ID}\\/tasks\\/([\\w-]+)\\/requeue`), (m, b, w) => ctl.requeue(w, m[1], task(m, b))],
  ]
}
