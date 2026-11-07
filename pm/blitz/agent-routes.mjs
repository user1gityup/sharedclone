// BLITZ-04 REST routes, as server.mjs route tuples [method, regex, handler(m, body, w, query)].
// Kept apart from pm/blitz/routes.mjs, which BLITZ-02 and BLITZ-03 share.
import { blitzDb, createAgentRegistry } from './agents.mjs'
import { createCapacityStore } from './capacity.mjs'

export function blitzAgentRoutes({ store, db = blitzDb(store), machines, clock } = {}) {
  const agents = createAgentRegistry(db, { store, machines, clock })
  const capacity = createCapacityStore(db, { store, machines, clock })
  const name = (m) => decodeURIComponent(m[1])
  return [
    ['GET', /^\/api\/blitz\/agents$/, (m, b, w, q) => agents.list(q)],
    ['POST', /^\/api\/blitz\/agents$/, (m, b, w) => agents.create(w, b)],
    ['GET', /^\/api\/blitz\/agents\/([^/]+)$/, (m) => agents.get(name(m))],
    ['PATCH', /^\/api\/blitz\/agents\/([^/]+)$/, (m, b, w) => agents.update(w, name(m), b)],
    ['POST', /^\/api\/blitz\/agents\/([^/]+)\/disable$/, (m, b, w) => agents.disable(w, name(m), b)],
    ['GET', /^\/api\/blitz\/capacity$/, () => capacity.list()],
    ['POST', /^\/api\/blitz\/capacity\/report$/, (m, b, w) => capacity.report(w, b)],
  ]
}
