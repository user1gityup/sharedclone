// record-routes.mjs - pm HTTP routes for the record types (website blitz L6a;
// T-af9f057e, T-8b68240c, T-d0ab1b37, T-d9cf422d). Registered by server.mjs.
//
// Every route goes through enforceAccess (record-gates.mjs), so one rule holds across all of
// them: a granted INTERNAL action runs straight through, and an EXTERNAL one (outbound
// message, export, bulk delete, third-party share) comes back 428 with a pm approval to
// decide, every time. A second rule holds on the way back out: a write grant is not a read
// grant, so a caller without `read` gets a receipt of what it changed (see receipt() below)
// instead of the record - a tag-only agent cannot read a Contact through the tag route. The records live in the pm database; approvals and roles live in the
// bridge ledger, so without the bridge an external action has nowhere to be approved and is
// refused rather than quietly allowed.
//
// Handlers get (match, body, w, query, principal) like every other pm route. w.actor is the
// identity pm records; for a token principal access.mjs has already forced it to the token name.
import { PmError } from './store.mjs'
import * as roles from './roles.mjs'
import { TRUSTED_PRINCIPALS } from './access.mjs'
import {
  RecordError, requireRecordType, listRecordTypes, appliedMigrations,
  createRecord, updateRecord, setRecordStatus, addNote, setTags, dedupeSuggestions,
  defaultFieldOfKind,
  deleteRecord, exportRecords, getRecord, requireRecord, listRecords,
  grantAccess, revokeAccess, listAccess, auditLog, assertActor,
} from './records.mjs'
import { migrateRecords, RECORD_TYPES, CONTACT_LEAD, OPPORTUNITY } from './record-types.mjs'
import {
  migrateRecordLinks, createTypedLink, removeTypedLink, linksForContact, linksForOpportunity,
  rejectConversion, assertNoConversionIntent, CONVERSION_VERBS, LINK_TYPES,
} from './record-links.mjs'
import {
  migrateContactCrm, getSettings, updateSettings, applyPermissionSet, assertExportAllowed, retentionDue, importContacts,
} from './contact-crm.mjs'
import {
  migrateGates, setGate, revokeGate, listGates, enforceAccess, effectiveActions, checkAccess,
  pendingRecordApprovals, destinationOf, INTERNAL_ACTIONS, EXTERNAL_ACTIONS, GATE_MODES, SUBJECT_KINDS,
} from './record-gates.mjs'

const STATUS = { BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, APPROVAL_REQUIRED: 428 }
function asPm(err) {
  if (err instanceof PmError) return err
  if (err instanceof RecordError) return new PmError(STATUS[err.code] ?? 400, err.message, { code: err.code, ...err.extra })
  return err
}
// every handler below reads body and query directly, so they are normalized here once: a route
// reached without a body (a DELETE, a bare GET) must refuse on its own terms, not on a TypeError
const wrap = (fn) => (m, b, w, q, p) => {
  try { return fn(m, b ?? {}, w, q ?? {}, p) } catch (err) { throw asPm(err) }
}

const TYPE = '([a-z][a-z0-9_]{1,31})'
const ID = '([A-Z][A-Z0-9]{0,7}-[0-9a-f]{4,})'
const trusted = (p) => !p || TRUSTED_PRINCIPALS.has(p.name)

/**
 * The route that performs each action. Every action a type advertises has one, so a grant is
 * always a grant of something that can actually be done: a `tag` grant has POST .../tags, a
 * `dedupe_suggest` grant has GET .../dedupe-suggestions. The registry serves this map, so the
 * admin UI shows an operation beside every action rather than a name with nothing behind it.
 */
export const ACTION_OPERATIONS = Object.freeze({
  read: 'GET /api/records/:type',
  create: 'POST /api/records/:type',
  update: 'PATCH /api/records/:type/:id',
  status: 'POST /api/records/:type/:id/status',
  note: 'POST /api/records/:type/:id/notes',
  tag: 'POST /api/records/:type/:id/tags',
  link: 'POST /api/records/:type/:id/links',
  dedupe_suggest: 'GET /api/records/:type/dedupe-suggestions',
  outbound_message: 'POST /api/records/:type/:id/outbound-message',
  export: 'POST /api/records/:type/export',
  bulk_delete: 'POST /api/records/:type/bulk-delete',
  share_third_party: 'POST /api/records/:type/:id/share',
})

/**
 * Who is acting, and in what capacity, for the gate check.
 * actor: the recorded identity. role: from the bridge role_assignments (never invented).
 * agent: the agent name a gate can be written against - a token principal is always itself.
 *
 * An identified agent must also name its model (x-pm-model or body.model): every audit entry
 * an agent causes has to say which model it was, so a missing model is a 400 here, not a null
 * in the log. A human on the loopback UI names no agent and needs no model.
 */
function actorContext(ledgerDb, w, body, query, principal, project) {
  const actor = w?.actor
  if (typeof actor !== 'string' || !actor.trim()) {
    throw new PmError(400, 'actor is required: name who is making this change (for an agent, its model name)')
  }
  const agent = trusted(principal) ? (body?.agent ?? query?.agent ?? null) : principal.name
  const model = typeof w?.model === 'string' && w.model.trim() ? w.model.trim() : null
  try {
    assertActor({ actor, model, agent })
  } catch (err) {
    throw new PmError(400, err.message)
  }
  let role = null
  if (ledgerDb) { try { role = roles.roleOf(ledgerDb, actor.trim(), project || undefined) } catch { role = null } }
  // this machine's own user on the loopback pm UI is its administrator, as everywhere else in pm
  if (!role && principal?.name === 'loopback') role = 'admin'
  if (!role && !principal) role = 'admin'
  return { actor: actor.trim(), model, role, agent }
}

/** Gate configuration and ACL writes are administrator-only. */
function requireAdmin(ledgerDb, w, principal) {
  if (trusted(principal)) return (w?.actor ?? 'pm')
  if (!ledgerDb) throw new PmError(503, 'role checks need the bridge (PM_BRIDGE is off)')
  try {
    roles.assertAllowed(ledgerDb, principal.name, 'bridge_settings', {})
  } catch (err) {
    throw new PmError(403, err.message)
  }
  return principal.name
}

const projectOf = (body, query, record) => String(record?.project ?? body?.project ?? query?.project ?? '')

/**
 * @param store   the pm store (records live in store.db)
 * @param getDb   () => the bridge ledger db (approvals + roles) or null when the bridge is off
 */
export function recordRoutes(store, getDb = () => null) {
  // same guard every other pm route set carries: without a pm database there is nothing to mount,
  // and createServer must not throw for a caller that passes a store stub
  if (!store?.db) return []
  const db = store.db
  migrateRecords(db)
  migrateGates(db)
  migrateRecordLinks(db)
  migrateContactCrm(db)

  const ledger = () => { try { return getDb() } catch { return null } }

  /**
   * Run one action through the gate, then do it. Throws 428 when a human must approve.
   * `project` overrides what the caller said: a batch is authorized in the project its records
   * actually live in, never in the one the request claims.
   */
  function guarded(def, { action, w, body, query, principal, record = null, record_ids = [], project: forced = null, destination = '' }, run) {
    const ledgerDb = ledger()
    const project = forced == null ? projectOf(body, query, record) : String(forced)
    const who = actorContext(ledgerDb, w, body, query, principal, project)
    const verdict = enforceAccess(db, def, {
      action, actor: who.actor, model: who.model, role: who.role, agent: who.agent, project, destination,
      record, record_ids, approval_id: body?.approval_id ?? query?.approval_id ?? null, approvalsDb: ledgerDb,
    })
    return run(who, verdict, project)
  }

  /**
   * The answer to a write, and never more than the caller may see.
   *
   * `tag`, `note`, `link`, `status` and `update` are grants to CHANGE something. `read` is the
   * separate grant to SEE a record, and holding one is not holding the other. So a caller
   * without read gets a receipt - the id, the new revision, and the fields this very call
   * touched - instead of the whole record. An agent granted tagging (or one a gate explicitly
   * denies read) therefore cannot pull a Contact's name, email, phone or notes back out
   * through the one route it is allowed to call. With read, the record comes back whole.
   */
  function receipt(def, record, who, project, fields = [], extra = {}) {
    if (!record || typeof record !== 'object') return record
    if (def.actions.includes('read')) {
      const read = checkAccess(db, def, { action: 'read', actor: who.actor, role: who.role, agent: who.agent, project, record })
      if (read.decision === 'allow') return record
    }
    const out = {
      id: record.id, record_type: def.type, rev: record.rev,
      updated_at: record.updated_at, updated_by: record.updated_by, updated_model: record.updated_model ?? null,
      // said plainly, so a caller knows it is holding a receipt and not a record
      redacted: true, readable: false,
      ...extra,
    }
    if (def.idField) out[def.idField] = record.id
    for (const f of fields) if (f in record) out[f] = record[f]
    return out
  }

  /**
   * Resolve a batch of ids to records and to the ONE project they live in.
   * A batch that spans projects is refused rather than authorized in whichever project the
   * caller named, and a caller-supplied project that disagrees with the records is refused too.
   */
  function batchOf(def, ids, body, query) {
    const records = ids.map((id) => requireRecord(db, def, id))
    const projects = [...new Set(records.map((r) => String(r.project ?? '')))]
    if (projects.length > 1) {
      throw new PmError(400, `this batch spans projects (${projects.map((p) => p || '(none)').join(', ')}): run one batch per project, so a human approves one project at a time`)
    }
    const project = projects[0] ?? ''
    const claimed = String(body?.project ?? query?.project ?? '')
    if (claimed && claimed !== project) {
      throw new PmError(400, `these records are in ${project || '(no project)'}, not ${claimed}: a batch is authorized in the project its records are in`)
    }
    return { records, project }
  }

  const typeOf = (m) => requireRecordType(m[1])

  // ---- Contact <-> Opportunity cross-links (L6b) -----------------------------------------
  // The link is held on the Opportunity, so creating or removing one - from either side - is the
  // Opportunity's `link` action in the Opportunity's project. A Contact grant is not a link
  // grant, and an Opportunity link grant does not read Contacts.
  const linkBody = (b) => {
    assertNoConversionIntent(b)
    return { linkType: b.link_type ?? 'related', reason: typeof b.reason === 'string' ? b.reason : '' }
  }
  function doLink(m, b, w, q, p, oppId, contactId) {
    const record = requireRecord(db, OPPORTUNITY, oppId)
    const field = defaultFieldOfKind(OPPORTUNITY, 'links')
    const { linkType, reason } = linkBody(b)
    return guarded(OPPORTUNITY, { action: 'link', w, body: b, query: q, principal: p, record }, (who, verdict, project) => {
      const out = createTypedLink(db, OPPORTUNITY, record.id, { field, targetId: contactId, linkType, reason, actor: who.actor, model: who.model, agent: who.agent })
      return { ...receipt(OPPORTUNITY, out.record, who, project, [field]), link: out.link, created: out.created }
    })
  }
  function doUnlink(m, b, w, q, p, oppId, contactId) {
    assertNoConversionIntent(b)
    const record = requireRecord(db, OPPORTUNITY, oppId)
    const field = defaultFieldOfKind(OPPORTUNITY, 'links')
    return guarded(OPPORTUNITY, { action: 'link', w, body: b, query: q, principal: p, record }, (who, verdict, project) => {
      const out = removeTypedLink(db, OPPORTUNITY, record.id, { field, targetId: contactId, reason: b.reason ?? q.reason ?? '', actor: who.actor, model: who.model, agent: who.agent })
      return { ...receipt(OPPORTUNITY, out.record, who, project, [field]), removed: out.removed }
    })
  }
  // the other side of a link is described by reference only (id, type, reason, creator); its
  // title / name / status appear only when this caller may separately read that record
  function describe(def, otherDef, who, rows, idKey) {
    return rows.map((l) => {
      const other = getRecord(db, otherDef, l[idKey])
      let summary = null
      if (other && !other.deleted_at) {
        const read = checkAccess(db, otherDef, { action: 'read', actor: who.actor, role: who.role, agent: who.agent, project: other.project, record: other })
        if (read.decision === 'allow') summary = otherDef.type === 'opportunity'
          ? { title: other.title, status: other.status, project: other.project }
          : { name: other.name, status: other.status, project: other.project }
      }
      const { project, ...rest } = l // eslint-disable-line no-unused-vars
      return { ...rest, other_type: otherDef.type, other_visible: Boolean(summary), other: summary }
    })
  }
  function conversionRoute(method) {
    const verbs = CONVERSION_VERBS.map((v) => v.replace(/[-_]/g, '[-_]')).join('|')
    return [method, new RegExp(`^/api/(?:records/${TYPE}(?:/${ID})?|contact-crm|record-links|opportunities)/(?:${verbs})(?:/.*)?$`), wrap((m) => rejectConversion(null, null, 'conversion'))]
  }
  const settingsFor = () => getSettings(db)

  return [
    // ---- conversion guard: every spelling of "turn this into that" is refused, any method -----
    ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(conversionRoute),

    // ---- Contact <-> Opportunity links, visible and removable from BOTH sides ---------------
    ['GET', /^\/api\/record-link-types$/, wrap(() => ({ link_types: LINK_TYPES, conversion: 'never: links are references only' }))],

    ['POST', /^\/api\/record-links$/, wrap((m, b, w, q, p) => doLink(m, b, w, q, p, String(b.opportunity_id ?? ''), String(b.contact_id ?? '')))],
    ['DELETE', /^\/api\/record-links$/, wrap((m, b, w, q, p) => doUnlink(m, b, w, q, p, String(b.opportunity_id ?? q.opportunity_id ?? ''), String(b.contact_id ?? q.contact_id ?? '')))],

    // Contact side: which Opportunities is this Contact tied to? Needs read on the Contact.
    ['GET', new RegExp(`^/api/records/contact_lead/${ID}/opportunities$`), wrap((m, b, w, q, p) => {
      const record = requireRecord(db, CONTACT_LEAD, m[1])
      return guarded(CONTACT_LEAD, { action: 'read', w, body: b, query: q, principal: p, record }, (who) =>
        describe(CONTACT_LEAD, OPPORTUNITY, who, linksForContact(db, OPPORTUNITY, record.id), 'opportunity_id'))
    })],
    ['POST', new RegExp(`^/api/records/contact_lead/${ID}/opportunities$`), wrap((m, b, w, q, p) => {
      requireRecord(db, CONTACT_LEAD, m[1])
      return doLink(m, b, w, q, p, String(b.opportunity_id ?? ''), m[1])
    })],
    ['DELETE', new RegExp(`^/api/records/contact_lead/${ID}/opportunities/${ID}$`), wrap((m, b, w, q, p) => {
      requireRecord(db, CONTACT_LEAD, m[1])
      return doUnlink(m, b, w, q, p, m[2], m[1])
    })],

    // Opportunity side: which Contacts is this Opportunity tied to? Needs read on the Opportunity.
    ['GET', new RegExp(`^/api/records/opportunity/${ID}/contacts$`), wrap((m, b, w, q, p) => {
      const record = requireRecord(db, OPPORTUNITY, m[1])
      return guarded(OPPORTUNITY, { action: 'read', w, body: b, query: q, principal: p, record }, (who) =>
        describe(OPPORTUNITY, CONTACT_LEAD, who, linksForOpportunity(db, OPPORTUNITY, record.id), 'contact_id'))
    })],
    ['POST', new RegExp(`^/api/records/opportunity/${ID}/contacts$`), wrap((m, b, w, q, p) => doLink(m, b, w, q, p, m[1], String(b.contact_id ?? '')))],
    ['DELETE', new RegExp(`^/api/records/opportunity/${ID}/contacts/${ID}$`), wrap((m, b, w, q, p) => doUnlink(m, b, w, q, p, m[1], m[2]))],

    // ---- central control of the Contact CRM -------------------------------------------------
    ['GET', /^\/api\/contact-crm\/settings$/, wrap((m, b, w, q, p) =>
      guarded(CONTACT_LEAD, { action: 'read', w, body: b, query: q, principal: p }, () => settingsFor()))],

    ['PUT', /^\/api\/contact-crm\/settings$/, wrap((m, b, w, q, p) => {
      const by = requireAdmin(ledger(), w, p)
      const { rev, ...patch } = b // eslint-disable-line no-unused-vars
      delete patch.actor; delete patch.model; delete patch.agent
      return updateSettings(db, CONTACT_LEAD, patch, { actor: by, expectedRev: b.rev })
    })],

    ['POST', new RegExp('^/api/contact-crm/permission-sets/([a-z][a-z0-9_-]{1,31})/apply$'), wrap((m, b, w, q, p) => {
      const by = requireAdmin(ledger(), w, p)
      return applyPermissionSet(db, CONTACT_LEAD, m[1], { subject: b.subject, project: b.project ?? '', by })
    })],

    ['GET', /^\/api\/contact-crm\/retention$/, wrap((m, b, w, q, p) =>
      guarded(CONTACT_LEAD, { action: 'read', w, body: b, query: q, principal: p }, () => retentionDue(db, CONTACT_LEAD, { project: q.project })))],

    // the one way external tools (event apps, badge scanners, spreadsheets) feed pm
    ['POST', /^\/api\/contact-crm\/import$/, wrap((m, b, w, q, p) => {
      assertNoConversionIntent(b)
      return guarded(CONTACT_LEAD, { action: 'create', w, body: b, query: q, principal: p }, (who, verdict, project) =>
        importContacts(db, CONTACT_LEAD, {
          source: b.source, rows: b.rows, batch: b.batch, project, dryRun: b.dry_run === true,
          actor: who.actor, model: who.model, agent: who.agent,
        }))
    })],


    // ---- registry and gate administration -------------------------------------------------
    ['GET', /^\/api\/record-types$/, wrap(() => listRecordTypes().map((d) => ({
      type: d.type, label: d.label, id_prefix: d.idPrefix, id_field: d.idField, table: d.table,
      statuses: d.statuses, initial_status: d.initialStatus, terminal: d.terminal, transitions: d.transitions,
      actions: d.actions, internal_actions: INTERNAL_ACTIONS.filter((a) => d.actions.includes(a)),
      external_actions: EXTERNAL_ACTIONS.filter((a) => d.actions.includes(a)),
      operations: Object.fromEntries(d.actions.map((a) => [a, ACTION_OPERATIONS[a] ?? null])),
      dedupe_keys: d.dedupe.map((k) => ({ key: k.key, label: k.label, fields: [...k.fields], normalize: k.normalize })),
      fields: Object.fromEntries(Object.entries(d.fields).map(([n, f]) => [n, { ...f }])),
      version: d.version, migrations: appliedMigrations(db, d.type),
    })))],

    ['GET', /^\/api\/record-gates$/, wrap((m, b, w, q) => ({
      modes: GATE_MODES, subject_kinds: SUBJECT_KINDS,
      internal_actions: INTERNAL_ACTIONS, external_actions: EXTERNAL_ACTIONS,
      gates: listGates(db, { record_type: q.record_type, subject: q.subject, action: q.action, includeRevoked: q.all === '1' }),
    }))],

    // only these fields come from the body: `by` and `now` are the server's, so a caller can
    // neither write a gate in someone else's name nor backdate when it was configured
    ['POST', /^\/api\/record-gates$/, wrap((m, b, w, q, p) => {
      const by = requireAdmin(ledger(), w, p)
      return setGate(db, {
        record_type: b.record_type, subject_kind: b.subject_kind, subject: b.subject,
        project: b.project ?? '', action: b.action, mode: b.mode, note: b.note ?? '', by,
      })
    })],

    ['DELETE', /^\/api\/record-gates\/(\d+)$/, wrap((m, b, w, q, p) => {
      const by = requireAdmin(ledger(), w, p)
      return revokeGate(db, Number(m[1]), { by })
    })],

    // the approval queue hook: record actions still waiting on a human
    ['GET', /^\/api\/record-approvals$/, wrap((m, b, w, q) =>
      pendingRecordApprovals(ledger(), { record_type: q.record_type, limit: q.limit }))],

    // what this identity may do right now (advisory; the server still enforces)
    ['GET', new RegExp(`^/api/records/${TYPE}/effective-actions$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const who = actorContext(ledger(), w, b, q, p, String(q.project ?? ''))
      return { record_type: def.type, actor: who.actor, role: who.role, agent: who.agent, actions: effectiveActions(db, def, { ...who, project: String(q.project ?? '') }) }
    })],

    // duplicate suggestions: read-only and its own grant. It PROPOSES duplicates within one
    // type; merging them is an update, so dedupe_suggest alone can never change a record.
    // Registered before the per-record routes: an id starts with an upper-case prefix, so
    // 'dedupe-suggestions' can never be read as one.
    ['GET', new RegExp(`^/api/records/${TYPE}/dedupe-suggestions$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = q.record_id ? requireRecord(db, def, q.record_id) : null
      return guarded(def, { action: 'dedupe_suggest', w, body: b, query: q, principal: p, record }, (who, verdict, project) =>
        dedupeSuggestions(db, def, {
          project, record_id: q.record_id ?? null, limit: q.limit,
          actor: who.actor, model: who.model, agent: who.agent,
        }))
    })],

    // ---- per-type ACL ---------------------------------------------------------------------
    ['GET', new RegExp(`^/api/records/${TYPE}/acl$`), wrap((m, b, w, q) => listAccess(db, typeOf(m), { subject: q.subject }))],

    ['POST', new RegExp(`^/api/records/${TYPE}/acl$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const by = requireAdmin(ledger(), w, p)
      return grantAccess(db, def, { subject: b.subject, project: b.project ?? '', actions: b.actions, by })
    })],

    ['DELETE', new RegExp(`^/api/records/${TYPE}/acl$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const by = requireAdmin(ledger(), w, p)
      const subject = b.subject ?? q.subject
      if (!subject) throw new PmError(400, 'subject required')
      return revokeAccess(db, def, { subject, project: b.project ?? q.project ?? '', by })
    })],

    // ---- audit log (one per type) ---------------------------------------------------------
    // A read authorized in one project returns that project's entries only. Reading the whole
    // log - engine-wide ACL and gate entries included - takes a global read (admin or an
    // unscoped ACL grant), which is what a request with no project is checked against.
    ['GET', new RegExp(`^/api/records/${TYPE}/audit$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = q.record_id ? requireRecord(db, def, q.record_id) : null
      return guarded(def, { action: 'read', w, body: b, query: q, principal: p, record }, (who, verdict, project) =>
        auditLog(db, def, { record_id: q.record_id, action: q.action, actor: q.actor, project, limit: q.limit }))
    })],

    // ---- external actions (always a human approval) ---------------------------------------
    // Each one binds its destination into the approval, so an approved export cannot be
    // replayed somewhere else, and each approval is spent the first time it is used.
    ['POST', new RegExp(`^/api/records/${TYPE}/export$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : []
      if (!ids.length) throw new PmError(400, 'ids must be a non-empty list of record ids')
      const { project } = batchOf(def, ids, b, q)
      const destination = destinationOf(b.destination)
      if (def.type === 'contact_lead') assertExportAllowed(db, { destination, count: ids.length })
      return guarded(def, { action: 'export', w, body: b, query: q, principal: p, record_ids: ids, project, destination }, (who) =>
        exportRecords(db, def, { ids, actor: who.actor, model: who.model, agent: who.agent, destination, approval_id: b.approval_id ?? null }))
    })],

    ['POST', new RegExp(`^/api/records/${TYPE}/bulk-delete$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : []
      if (!ids.length) throw new PmError(400, 'ids must be a non-empty list of record ids')
      const { project } = batchOf(def, ids, b, q)
      return guarded(def, { action: 'bulk_delete', w, body: b, query: q, principal: p, record_ids: ids, project }, (who) =>
        ids.map((id) => deleteRecord(db, def, id, { actor: who.actor, model: who.model, agent: who.agent, reason: b.reason ?? 'bulk delete' })))
    })],

    ['POST', new RegExp(`^/api/records/${TYPE}/${ID}/outbound-message$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      const destination = destinationOf(b.to ?? b.recipient ?? record.email ?? '')
      return guarded(def, { action: 'outbound_message', w, body: b, query: q, principal: p, record, destination }, (who, verdict, project) =>
        receipt(def, addNote(db, def, record.id, {
          field: defaultFieldOfKind(def, 'notes') ?? 'notes',
          text: `outbound message sent${destination ? ` to ${destination}` : ''}: ${String(b.subject ?? b.text ?? '').slice(0, 500)}`,
          actor: who.actor, model: who.model, agent: who.agent,
        }), who, project, [], { sent_to: destination }))
    })],

    ['POST', new RegExp(`^/api/records/${TYPE}/${ID}/share$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      const destination = destinationOf(b.destination) || 'third party'
      if (def.type === 'contact_lead') assertExportAllowed(db, { destination, count: 1 })
      return guarded(def, { action: 'share_third_party', w, body: b, query: q, principal: p, record, destination }, (who) =>
        exportRecords(db, def, { ids: [record.id], actor: who.actor, model: who.model, agent: who.agent, destination, approval_id: b.approval_id ?? null }))
    })],

    // ---- records --------------------------------------------------------------------------
    ['GET', new RegExp(`^/api/records/${TYPE}$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      return guarded(def, { action: 'read', w, body: b, query: q, principal: p }, () =>
        listRecords(db, def, { project: q.project, owner: q.owner, status: q.status, includeDeleted: q.deleted === '1', limit: q.limit }))
    })],

    ['POST', new RegExp(`^/api/records/${TYPE}$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      assertNoConversionIntent(b)
      return guarded(def, { action: 'create', w, body: b, query: q, principal: p }, (who) =>
        createRecord(db, def, { project: b.project ?? '', owner: b.owner ?? who.actor, status: b.status, data: b.data ?? {}, actor: who.actor, model: who.model, agent: who.agent }))
    })],

    ['GET', new RegExp(`^/api/records/${TYPE}/${ID}$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      return guarded(def, { action: 'read', w, body: b, query: q, principal: p, record }, () => getRecord(db, def, record.id))
    })],

    // moving a record to another project needs update in BOTH projects: the one it is leaving
    // and the one it would land in, so a grant in one project cannot pull records into it
    ['PATCH', new RegExp(`^/api/records/${TYPE}/${ID}$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      const moveTo = b.new_project == null ? null : String(b.new_project)
      if (moveTo != null && moveTo !== String(record.project ?? '')) {
        guarded(def, { action: 'update', w, body: b, query: q, principal: p, record, project: moveTo }, () => null)
      }
      return guarded(def, { action: 'update', w, body: b, query: q, principal: p, record }, (who, verdict, project) =>
        receipt(def, updateRecord(db, def, record.id, { patch: b.patch ?? {}, owner: b.owner, project: moveTo ?? undefined, actor: who.actor, model: who.model, agent: who.agent, expectedRev: b.rev }),
          who, project, Object.keys(b.patch ?? {})))
    })],

    ['POST', new RegExp(`^/api/records/${TYPE}/${ID}/status$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      return guarded(def, { action: 'status', w, body: b, query: q, principal: p, record }, (who, verdict, project) =>
        receipt(def, setRecordStatus(db, def, record.id, { status: b.status, reason: b.reason ?? '', actor: who.actor, model: who.model, agent: who.agent }),
          who, project, ['status']))
    })],

    // a note grant writes notes; it does not read the record back, nor the notes already on it
    ['POST', new RegExp(`^/api/records/${TYPE}/${ID}/notes$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      const field = b.field ?? defaultFieldOfKind(def, 'notes')
      return guarded(def, { action: 'note', w, body: b, query: q, principal: p, record }, (who, verdict, project) => {
        const after = addNote(db, def, record.id, { field, text: b.text, actor: who.actor, model: who.model, agent: who.agent })
        return receipt(def, after, who, project, [], { note_count: Array.isArray(after[field]) ? after[field].length : 0 })
      })
    })],

    // tagging is its own action with its own route, so a `tag` grant is something an agent can
    // actually run. It reaches a tags field and nothing else: every other field is still a
    // PATCH, and PATCH is still `update`. A tag grant is therefore neither a general write
    // grant nor a read grant: without `read` the answer is a receipt, the tags and nothing else.
    ['POST', new RegExp(`^/api/records/${TYPE}/${ID}/tags$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      const field = b.field ?? defaultFieldOfKind(def, 'tags')
      return guarded(def, { action: 'tag', w, body: b, query: q, principal: p, record }, (who, verdict, project) =>
        receipt(def, setTags(db, def, record.id, {
          field,
          add: b.add ?? (b.tag ? [b.tag] : []), remove: b.remove ?? [], set: b.set ?? null,
          actor: who.actor, model: who.model, agent: who.agent,
        }), who, project, [field]))
    })],

    ['DELETE', new RegExp(`^/api/records/${TYPE}/${ID}/tags$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      const one = b.tag ?? q.tag
      const remove = Array.isArray(b.remove) ? b.remove : (one ? [one] : [])
      const field = b.field ?? q.field ?? defaultFieldOfKind(def, 'tags')
      return guarded(def, { action: 'tag', w, body: b, query: q, principal: p, record }, (who, verdict, project) =>
        receipt(def, setTags(db, def, record.id, {
          field, remove,
          actor: who.actor, model: who.model, agent: who.agent,
        }), who, project, [field]))
    })],

    // cross-link only: nothing is copied and the linked type's own permissions still govern it.
    // The field defaults to this type's OWN links field - a type that declares none advertises
    // no `link` action at all, so the gate refuses the call before anything is validated.
    ['POST', new RegExp(`^/api/records/${TYPE}/${ID}/links$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      const field = b.field ?? defaultFieldOfKind(def, 'links')
      assertNoConversionIntent(b)
      return guarded(def, { action: 'link', w, body: b, query: q, principal: p, record }, (who, verdict, project) =>
        receipt(def, createTypedLink(db, def, record.id, {
          field, targetId: b.target_id, linkType: b.link_type ?? 'related', reason: typeof b.reason === 'string' ? b.reason : '',
          actor: who.actor, model: who.model, agent: who.agent,
        }).record, who, project, [field]))
    })],

    ['DELETE', new RegExp(`^/api/records/${TYPE}/${ID}/links$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      const field = b.field ?? q.field ?? defaultFieldOfKind(def, 'links')
      return guarded(def, { action: 'link', w, body: b, query: q, principal: p, record }, (who, verdict, project) =>
        receipt(def, removeTypedLink(db, def, record.id, { field, targetId: b.target_id ?? q.target_id, reason: b.reason ?? q.reason ?? '', actor: who.actor, model: who.model, agent: who.agent }).record,
          who, project, [field]))
    })],

    ['DELETE', new RegExp(`^/api/records/${TYPE}/${ID}$`), wrap((m, b, w, q, p) => {
      const def = typeOf(m)
      const record = requireRecord(db, def, m[2])
      return guarded(def, { action: 'update', w, body: b, query: q, principal: p, record }, (who, verdict, project) =>
        receipt(def, deleteRecord(db, def, record.id, { actor: who.actor, model: who.model, agent: who.agent, reason: b.reason ?? '' }),
          who, project, ['status', 'deleted_at']))
    })],
  ]
}

export { RECORD_TYPES }
