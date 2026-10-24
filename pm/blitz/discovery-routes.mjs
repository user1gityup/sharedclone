// BLITZ-02 pm routes: top-N ranking, discovery, project-by-project Q&A. Registered by
// server.mjs next to BLITZ-03's blitz/routes.mjs. Handlers get (match, body, w, query, principal);
// a role-checked token principal (not loopback or the PM_TOKEN peer) answers only by relay.
import { TRUSTED_PRINCIPALS } from '../access.mjs'
import { topProjects } from './rank.mjs'
import { discover } from './discovery.mjs'
import { openQa } from './qa.mjs'

const via = (w, p) => ({ ...w, via: p && !TRUSTED_PRINCIPALS.has(p.name) ? p.name : null })

export function discoveryRoutes({ store, bridge = null } = {}) {
  if (!store?.db) return []
  const qa = openQa(store, { bridge })
  return [
    ['GET', /^\/api\/blitz\/top-projects$/, (m, b, w, q) => topProjects(store.db, { n: q.n, projects: q.projects })],
    ['POST', /^\/api\/blitz\/discover$/, (m, b, w) => discover(store, { projects: b.projects, n: b.n, repos: b.repos, audits: b.audits, apply: b.apply === true }, w)],
    ['POST', /^\/api\/blitz\/campaigns\/([\w.-]+)\/qa$/, (m, b, w) => qa.ask(w, m[1], b)],
    ['PUT', /^\/api\/blitz\/campaigns\/([\w.-]+)\/qa\/order$/, (m, b, w) => qa.setOrder(w, m[1], b)],
    ['GET', /^\/api\/blitz\/campaigns\/([\w.-]+)\/qa\/current$/, (m) => qa.current(m[1])],
    ['GET', /^\/api\/blitz\/qa$/, (m, b, w, q) => qa.list(q)],
    ['GET', /^\/api\/blitz\/qa\/([\w-]+)$/, (m) => qa.get(m[1])],
    ['POST', /^\/api\/blitz\/qa\/([\w-]+)\/answer$/, (m, b, w, q, p) => qa.answer(via(w, p), m[1], b)],
    ['POST', /^\/api\/blitz\/qa\/([\w-]+)\/confirm$/, (m, b, w, q, p) => qa.confirm(via(w, p), m[1], b)],
  ]
}
