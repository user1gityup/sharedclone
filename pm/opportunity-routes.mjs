// pm HTTP routes for Opportunity records, qualification evidence and staged-package write-back
// (T-bf6f4f2c: DSH Integration). Handler signature follows server.mjs: (match, body, w, query) ->
// JSON result; PmError -> status. Spread into server.mjs `routes`; permission gates and actor
// logging are not reimplemented here - every route runs through server.mjs's existing
// authorizePm + roles.assertAllowed ('view' on GET, 'run' otherwise). /upsert is scoped by the
// EXISTING record's own project when its source_ref already belongs to one (resolveOpportunityProjectBySource
// below), not the caller-supplied body.project, so a project-scoped worker cannot claim a project
// it holds and use it to touch another project's record by source_ref; opportunities.mjs's
// upsertBySource also refuses the write itself if the two disagree (defense in depth). The bare
// collection root (GET with no project) requires an explicit project unless BOTH the caller's role
// can view every project (roles.canViewAllProjects) AND its bridge token's own `projects` list is
// unrestricted - a token limited to one project must still name it even when the identity it
// authenticates holds a global role, since the role and the token are independent restrictions
// (access.mjs's authorizePm; T-bf6f4f2c bypass fix 2). Without that, either gap alone would return
// every project's rows: assertAllowed's unscoped check passes trivially with no project named, and
// a token's own project list is never consulted when no project is named either. Every /:id route (plus its evidence/packages sub-resources) is scoped by the
// opportunity's OWN project via resolveOpportunityProject below, since those requests carry no
// project field of their own. Every mutation is logged via store.recordEvent inside opportunities.mjs.
import { createOpportunityRegistry } from './opportunities.mjs'

// Path for every /api/opportunities/:id route (single opportunity, evidence, packages) but not
// the collection root or /upsert. Used by resolveOpportunityProject below so the permission gate
// scopes a sub-resource write to the opportunity's OWN project, not just whatever project (if any)
// happens to be in the request body - the same way /api/order resolves its target via resolveOrder.
export const OPPORTUNITY_BY_ID = /^\/api\/opportunities\/(?!upsert$)([\w-]+)(?:\/(?:evidence|packages))?$/

// The /upsert path and the bare collection root - both carry a project only in the request body/
// query (no opportunity id in the path), so access.mjs's authorizePm matches on these separately
// from OPPORTUNITY_BY_ID above.
export const OPPORTUNITY_UPSERT = /^\/api\/opportunities\/upsert$/
export const OPPORTUNITY_COLLECTION = /^\/api\/opportunities$/

/**
 * project_id of an opportunity, or null if unknown - for access.mjs's authorizePm to scope a
 * sub-resource route (evidence/package write-back, update) by the opportunity it already belongs
 * to. A plain SELECT, not the full registry: this runs on every request, including ones for an id
 * that turns out not to exist, which the route handler itself still 404s.
 */
export function resolveOpportunityProject(db, id) {
  if (typeof id !== 'string' || !id) return null
  return db.prepare('SELECT project_id FROM opportunities WHERE id = ?').get(id)?.project_id ?? null
}

/**
 * project_id of the opportunity a /upsert call would touch, by source_ref, or null if none exists
 * yet (a plain create, scoped by body.project as normal). Lets authorizePm authorize an upsert by
 * the record's REAL project instead of whatever project the caller's body claims - the same
 * resolve-the-actual-target pattern as resolveOpportunityProject above, needed because
 * upsertBySource looks up source_ref globally (T-bf6f4f2c: DSH Integration bypass fix).
 */
export function resolveOpportunityProjectBySource(db, sourceRef) {
  const ref = typeof sourceRef === 'string' ? sourceRef.trim() : ''
  if (!ref) return null
  return db.prepare('SELECT project_id FROM opportunities WHERE source_ref = ?').get(ref)?.project_id ?? null
}

export function opportunityRoutes({ store, db = store.db, clock } = {}) {
  const reg = createOpportunityRegistry(db, { store, clock })
  const id = (m) => decodeURIComponent(m[1])
  return [
    ['GET', /^\/api\/opportunities$/, (m, b, w, q) => reg.list(q)],
    ['POST', /^\/api\/opportunities$/, (m, b, w) => reg.create(w, b)],
    ['POST', /^\/api\/opportunities\/upsert$/, (m, b, w) => reg.upsertBySource(w, b)],
    ['GET', /^\/api\/opportunities\/([\w-]+)$/, (m) => reg.get(id(m))],
    ['PATCH', /^\/api\/opportunities\/([\w-]+)$/, (m, b, w) => reg.update(w, id(m), b)],
    ['GET', /^\/api\/opportunities\/([\w-]+)\/evidence$/, (m) => reg.listEvidence(id(m))],
    ['POST', /^\/api\/opportunities\/([\w-]+)\/evidence$/, (m, b, w) => reg.addEvidence(w, id(m), b)],
    ['GET', /^\/api\/opportunities\/([\w-]+)\/packages$/, (m) => reg.listPackages(id(m))],
    ['POST', /^\/api\/opportunities\/([\w-]+)\/packages$/, (m, b, w) => reg.addPackage(w, id(m), b)],
  ]
}
