// BLITZ-08 monitoring routes (Claude Opus 5.5), as server.mjs tuples [method, regex, handler(m, body, w, query)].
// Read-only. Anchored and distinct from BLITZ-05's /campaigns/:id/(status|dag|events) routes.
//   GET /api/blitz/monitor                       every campaign, one line each
//   GET /api/blitz/campaigns/:id/monitor         aggregated status (lifecycle, agents, quota, cost, waves, throughput, ETAs)
//   GET /api/blitz/campaigns/:id/report          final report {campaign, markdown, status}
//   GET /api/blitz/runner                        runner and poller stats (runner: object or () => object)
import { buildStatus, finalReport, overview } from './status.mjs'

const ID = String.raw`([\w.-]{1,64})`

export function statusRoutes({ controller, guard = null, runner = null, clock, costPerAttemptUsd, defaultTaskMinutes } = {}) {
  if (!controller) return []
  const o = { guard, ...(clock ? { clock } : {}), ...(costPerAttemptUsd ? { costPerAttemptUsd } : {}), ...(defaultTaskMinutes ? { defaultTaskMinutes } : {}) }
  return [
    ['GET', /^\/api\/blitz\/monitor$/, () => overview(controller, o)],
    ['GET', new RegExp(String.raw`^\/api\/blitz\/campaigns\/${ID}\/monitor$`), (m) => buildStatus(controller, m[1], o)],
    ['GET', new RegExp(String.raw`^\/api\/blitz\/campaigns\/${ID}\/report$`), (m) => {
      const s = buildStatus(controller, m[1], o)
      return { campaign: m[1], markdown: finalReport(s), status: s }
    }],
    ['GET', /^\/api\/blitz\/runner$/, () => { const r = typeof runner === 'function' ? runner() : runner; return r ? r.stats() : { wired: false } }],
  ]
}
