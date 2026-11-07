// pm Opportunity registry (T-bf6f4f2c: DSH Integration).
//
// pm is the shared source of truth DSH council/swarm runs read and write through: this module
// stores Opportunity records (one row per lead the scraper found) plus the qualification evidence
// and staged-package entries a DSH run writes back onto one. pm never scrapes, qualifies, manages
// or applies anything itself - those stages run elsewhere (outside this repo) and only publish
// their result here, the same way dsh-connector.mjs publishes council runs as tasks without ever
// driving DSH. Every mutation is attributed (actor + model) and logged via store.recordEvent, and
// every route built from these ops goes through server.mjs's existing authorizePm + roles gate
// (the same generic project-scoped 'view'/'run' check every other /api/ route gets) - nothing here
// adds a second permission system.
import { randomBytes } from 'node:crypto'
import { PmError } from './store.mjs'

export const STAGES = ['scraped', 'qualifying', 'qualified', 'staged', 'applied', 'rejected']
export const EVIDENCE_KINDS = ['qualification', 'disqualification', 'note']
export const PACKAGE_STATUSES = ['draft', 'ready', 'submitted']

const SCHEMA = `
CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_ref TEXT UNIQUE,
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'scraped',
  payload TEXT NOT NULL DEFAULT '{}',
  rev INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS opportunities_project ON opportunities(project_id, stage);
CREATE TABLE IF NOT EXISTS opportunity_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id TEXT NOT NULL,
  kind TEXT NOT NULL, body TEXT NOT NULL,
  actor TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS opportunity_evidence_opp ON opportunity_evidence(opportunity_id, id);
CREATE TABLE IF NOT EXISTS opportunity_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', payload TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS opportunity_packages_opp ON opportunity_packages(opportunity_id, id);
`

export function migrate(db) {
  db.exec(SCHEMA)
}

function newId() {
  return `OPP-${randomBytes(4).toString('hex')}`
}

function actor(w) {
  if (!w?.actor) throw new PmError(400, 'actor is required (x-pm-actor)')
  return w
}

function parseOpportunity(r) {
  if (!r) return null
  return { ...r, payload: JSON.parse(r.payload || '{}') }
}

function parseEvidence(r) {
  return { ...r, body: JSON.parse(r.body || '{}') }
}

function parsePackage(r) {
  return { ...r, payload: JSON.parse(r.payload || '{}') }
}

function asPayload(v) {
  if (v === undefined || v === null) return '{}'
  if (typeof v !== 'object' || Array.isArray(v)) throw new PmError(400, 'payload must be an object')
  return JSON.stringify(v)
}

/**
 * @param db - a node:sqlite handle (store.db)
 * @param opts.store - pm store, for project lookup and recordEvent (logging)
 */
export function createOpportunityRegistry(db, { store, clock = () => new Date() } = {}) {
  migrate(db)
  const now = () => clock().toISOString()
  const event = (w, id, action, data) => store?.recordEvent?.(w, 'opportunity', id, action, data)

  function resolveProject(ref) {
    const s = typeof ref === 'string' ? ref.trim() : ''
    if (!s) throw new PmError(400, 'project is required')
    const p = store?.listProjects?.().find((x) => x.id === s || x.name === s)
    if (!p) throw new PmError(404, `no project ${s}`)
    return p
  }

  function row(id) {
    const r = parseOpportunity(db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id))
    if (!r) throw new PmError(404, `no opportunity ${id}`)
    return r
  }

  function evidenceRows(opportunityId) {
    return db.prepare('SELECT * FROM opportunity_evidence WHERE opportunity_id = ? ORDER BY id').all(opportunityId).map(parseEvidence)
  }

  function packageRows(opportunityId) {
    return db.prepare('SELECT * FROM opportunity_packages WHERE opportunity_id = ? ORDER BY id').all(opportunityId).map(parsePackage)
  }

  function insert(w, { project, source_ref, title, stage, payload }) {
    const p = resolveProject(project)
    if (!title?.trim()) throw new PmError(400, 'title is required')
    const st = stage || 'scraped'
    if (!STAGES.includes(st)) throw new PmError(400, `stage must be one of ${STAGES.join(', ')}`)
    const ref = source_ref == null ? null : String(source_ref).trim() || null
    // Pre-check rather than catch-and-match the driver's constraint error text, the same way
    // store.mjs's createProject checks for a duplicate name before inserting.
    if (ref && db.prepare('SELECT 1 FROM opportunities WHERE source_ref = ?').get(ref)) {
      throw new PmError(409, `opportunity with source_ref ${ref} already exists`)
    }
    const id = newId()
    const at = now()
    db.prepare(`INSERT INTO opportunities (id, project_id, source_ref, title, stage, payload, created_at, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, p.id, ref, title.trim(), st, asPayload(payload), at, w.actor, at)
    event(w, id, 'created', { project: p.name, source_ref: ref, stage: st })
    return row(id)
  }

  const api = {
    list({ project, stage, q, limit = 500 } = {}) {
      const where = []
      const args = []
      if (project) { where.push('project_id = ?'); args.push(resolveProject(project).id) }
      if (stage) { where.push('stage = ?'); args.push(stage) }
      if (q) { where.push('title LIKE ?'); args.push(`%${q}%`) }
      const sql = `SELECT * FROM opportunities ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`
      return db.prepare(sql).all(...args, Math.min(Number(limit) || 500, 5000)).map(parseOpportunity)
    },

    get(id) {
      const o = row(id)
      o.evidence = evidenceRows(id)
      o.packages = packageRows(id)
      return o
    },

    create(w, body = {}) {
      w = actor(w)
      return insert(w, body)
    },

    // Idempotent import path for scraper/connector consumers: one opportunity per source_ref,
    // updated in place on a re-sync instead of duplicated. Mirrors store.upsertBySource for tasks.
    // project is resolved and checked against the EXISTING record up front (not just used to
    // create a new one): source_ref is looked up globally, so without this check a caller could
    // name its own project while addressing another project's opportunity by source_ref
    // (T-bf6f4f2c: DSH Integration bypass fix - access.mjs's authorizePm also authorizes this
    // route by the existing record's real project via resolveOpportunityProjectBySource; this is
    // the defense-in-depth check at the data layer itself).
    upsertBySource(w, body = {}) {
      w = actor(w)
      const ref = body.source_ref == null ? '' : String(body.source_ref).trim()
      if (!ref) throw new PmError(400, 'source_ref is required')
      const p = resolveProject(body.project)
      const existing = parseOpportunity(db.prepare('SELECT * FROM opportunities WHERE source_ref = ?').get(ref))
      if (!existing) return { action: 'created', opportunity: insert(w, body) }
      if (existing.project_id !== p.id) {
        throw new PmError(409, `opportunity with source_ref ${ref} belongs to a different project`)
      }
      const changes = {}
      if (body.title !== undefined && body.title.trim() && body.title.trim() !== existing.title) changes.title = body.title.trim()
      if (body.stage !== undefined && body.stage !== existing.stage) changes.stage = body.stage
      if (body.payload !== undefined && JSON.stringify(body.payload) !== JSON.stringify(existing.payload)) changes.payload = body.payload
      if (!Object.keys(changes).length) return { action: 'unchanged', opportunity: existing }
      return { action: 'updated', opportunity: api.update(w, existing.id, { ...changes, rev: existing.rev }) }
    },

    // Stage/title/payload update, rev-gated like tasks.updateTask: the caller names the
    // revision it read, and a stale one is rejected with the current row for merge.
    update(w, id, changes = {}) {
      w = actor(w)
      const fields = ['title', 'stage', 'payload'].filter((k) => k in changes)
      if (!fields.length) throw new PmError(400, 'nothing to change')
      if (changes.rev === undefined) throw new PmError(400, 'rev is required: pass the revision you edited')
      if ('stage' in changes && !STAGES.includes(changes.stage)) throw new PmError(400, `stage must be one of ${STAGES.join(', ')}`)
      const current = row(id)
      if (Number(changes.rev) !== current.rev) throw new PmError(409, `opportunity ${id} changed since revision ${changes.rev} (now ${current.rev})`, { current })
      const before = Object.fromEntries(fields.map((k) => [k, current[k]]))
      const vals = fields.map((k) => (k === 'payload' ? asPayload(changes[k]) : String(changes[k]).trim()))
      db.prepare(`UPDATE opportunities SET ${fields.map((k) => `${k} = ?`).join(', ')}, rev = rev + 1, updated_at = ? WHERE id = ?`)
        .run(...vals, now(), id)
      event(w, id, 'updated', { before, after: Object.fromEntries(fields.map((k) => [k, changes[k]])) })
      return row(id)
    },

    // Qualification evidence write-back: append-only, one entry per DSH finding. Never
    // mutates the opportunity itself - call update() to move its stage.
    addEvidence(w, opportunityId, { kind = 'qualification', body } = {}) {
      w = actor(w)
      row(opportunityId) // 404s if unknown
      if (!EVIDENCE_KINDS.includes(kind)) throw new PmError(400, `kind must be one of ${EVIDENCE_KINDS.join(', ')}`)
      if (body === undefined || body === null) throw new PmError(400, 'body is required')
      const payload = typeof body === 'object' ? JSON.stringify(body) : JSON.stringify({ note: String(body) })
      const r = db.prepare('INSERT INTO opportunity_evidence (opportunity_id, kind, body, actor, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(opportunityId, kind, payload, w.actor, w.model ?? null, now())
      event(w, opportunityId, 'evidence_added', { evidence_id: Number(r.lastInsertRowid), kind })
      return parseEvidence(db.prepare('SELECT * FROM opportunity_evidence WHERE id = ?').get(r.lastInsertRowid))
    },

    listEvidence(opportunityId) {
      row(opportunityId)
      return evidenceRows(opportunityId)
    },

    // Staged-package write-back: append-only, one entry per package a DSH run prepares
    // (e.g. a drafted application). The newest row is the current package for the opportunity.
    addPackage(w, opportunityId, { status = 'draft', payload } = {}) {
      w = actor(w)
      row(opportunityId)
      if (!PACKAGE_STATUSES.includes(status)) throw new PmError(400, `status must be one of ${PACKAGE_STATUSES.join(', ')}`)
      const r = db.prepare('INSERT INTO opportunity_packages (opportunity_id, status, payload, actor, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(opportunityId, status, asPayload(payload), w.actor, w.model ?? null, now())
      event(w, opportunityId, 'package_staged', { package_id: Number(r.lastInsertRowid), status })
      return parsePackage(db.prepare('SELECT * FROM opportunity_packages WHERE id = ?').get(r.lastInsertRowid))
    },

    listPackages(opportunityId) {
      row(opportunityId)
      return packageRows(opportunityId)
    },
  }

  return api
}
