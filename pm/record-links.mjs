// record-links.mjs - typed cross-links between a Contact Lead and Opportunities (website blitz
// L6b, T-a9bf1b8f).
//
// The link itself stays where L6a put it: the Opportunity's contact_links field (an id list).
// This module adds what that list cannot carry - the link type, the reason and the creator -
// in record_link_meta, and makes the link VISIBLE FROM BOTH SIDES: a reverse lookup from the
// Contact, an audit entry on the Contact's own log for every link and unlink, and a guard that
// rejects any attempt to convert, promote or copy-as between the two types.
//
// A link is a reference. Nothing here copies a field, changes a status or creates a record of
// the other type, and a caller who may see one side learns only ids, type, reason and creator of
// the other (never its fields) unless it is separately allowed to read that side.
import {
  recordFail, requireRecordType, requireRecord, listRecords, linkRecord, unlinkRecord,
  appendAudit, defaultFieldOfKind,
} from './records.mjs'

/** The reasons a Contact and an Opportunity are tied together. Typed, not free text. */
export const LINK_TYPES = Object.freeze(['related', 'referral', 'decision_maker', 'same_organization', 'event_followup', 'other'])

/** Operations that would turn one record type into the other. All of them are refused. */
export const CONVERSION_VERBS = Object.freeze(['convert', 'promote', 'copy-as', 'copy_as', 'convert-to', 'convert_to', 'demote', 'transform', 'clone-as', 'clone_as'])

export function migrateRecordLinks(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS record_link_meta (
    source_type TEXT NOT NULL, source_id TEXT NOT NULL, field TEXT NOT NULL, target_id TEXT NOT NULL,
    link_type TEXT NOT NULL DEFAULT 'related', reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_model TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY (source_type, source_id, field, target_id))`)
  db.exec('CREATE INDEX IF NOT EXISTS record_link_meta_target ON record_link_meta(target_id)')
}

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''
const isoOf = (now) => (now instanceof Date ? now : now ? new Date(now) : new Date()).toISOString()

/** The guard. Throws for any conversion request between Contact Lead and Opportunity. */
export function rejectConversion(from, to, verb = 'convert') {
  recordFail('BAD_REQUEST',
    `${verb} refused: a Contact Lead and an Opportunity are separate records and are never converted, promoted or copied into one another${from && to ? ` (${from} -> ${to})` : ''}. Create the other record on its own and cross-link them instead.`,
    { conversion_rejected: true })
}

/** Body keys that smuggle a conversion into a link or create request. */
const CONVERSION_KEYS = ['convert', 'convert_to', 'promote', 'promote_to', 'copy_as', 'copy_to', 'converted_from', 'promoted_from', 'copied_from', 'source_record']
export function assertNoConversionIntent(body = {}) {
  for (const k of CONVERSION_KEYS) if (body && body[k] !== undefined && body[k] !== false && body[k] !== null) rejectConversion(null, null, k)
  const mode = String(body?.mode ?? body?.operation ?? '').toLowerCase()
  if (CONVERSION_VERBS.includes(mode) || ['conversion', 'promotion'].includes(mode)) rejectConversion(null, null, mode)
}

/** The Opportunity type's own contact-links field, or a clear refusal. */
function linkField(oppDef) {
  const f = defaultFieldOfKind(oppDef, 'links')
  if (!f) recordFail('BAD_REQUEST', `${oppDef.type} has no links field`)
  return f
}

function getLink(db, sourceType, sourceId, field, targetId) {
  return db.prepare('SELECT * FROM record_link_meta WHERE source_type=? AND source_id=? AND field=? AND target_id=?').get(sourceType, sourceId, field, targetId) ?? null
}

/**
 * Create a typed link and audit it on BOTH records.
 * `def`/`id` is the linking record (the Opportunity); targetId a record of the linked type.
 */
export function createTypedLink(db, def, id, { field, targetId, linkType = 'related', reason = '', actor, model = null, agent = null, now } = {}) {
  const f = field ?? linkField(def)
  if (!LINK_TYPES.includes(linkType)) recordFail('BAD_REQUEST', `link type must be one of: ${LINK_TYPES.join(', ')}`)
  if (!nonEmpty(reason)) recordFail('BAD_REQUEST', 'a link needs a reason: say why this Contact and this Opportunity are tied together')
  if (reason.length > 500) recordFail('BAD_REQUEST', 'link reason is at most 500 characters')
  const before = requireRecord(db, def, id)
  const had = Array.isArray(before[f]) && before[f].includes(targetId)
  const after = linkRecord(db, def, id, {
    field: f, targetId, actor, model, agent, now, detail: { link_type: linkType, reason: reason.trim() },
  })
  if (!had) {
    const target = requireRecordType(def.fields[f].linkTo)
    db.prepare(`INSERT OR REPLACE INTO record_link_meta (source_type, source_id, field, target_id, link_type, reason, created_by, created_model, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(def.type, id, f, targetId, linkType, reason.trim(), String(actor).trim(), model ? String(model) : null, isoOf(now))
    // the other side's own log: the Contact can see, from its audit, who tied it to what and why
    appendAudit(db, target, {
      record_id: targetId, action: 'link', actor, model, agent, now,
      detail: { linked_from: def.type, source_id: id, link_type: linkType, reason: reason.trim() },
    })
  }
  return { record: after, link: getLink(db, def.type, id, f, targetId), created: !had }
}

/** Remove a link and audit the removal on BOTH records. */
export function removeTypedLink(db, def, id, { field, targetId, actor, model = null, agent = null, now, reason = '' } = {}) {
  const f = field ?? linkField(def)
  const before = requireRecord(db, def, id)
  const had = Array.isArray(before[f]) && before[f].includes(targetId)
  const meta = had ? getLink(db, def.type, id, f, targetId) : null
  const after = unlinkRecord(db, def, id, { field: f, targetId, actor, model, agent, now, detail: { reason: String(reason ?? '') } })
  if (had) {
    db.prepare('DELETE FROM record_link_meta WHERE source_type=? AND source_id=? AND field=? AND target_id=?').run(def.type, id, f, targetId)
    const target = requireRecordType(def.fields[f].linkTo)
    appendAudit(db, target, {
      record_id: targetId, action: 'unlink', actor, model, agent, now,
      detail: { unlinked_from: def.type, source_id: id, link_type: meta?.link_type ?? null, reason: String(reason ?? '') },
    })
  }
  return { record: after, removed: had }
}

const shape = (oppId, contactId, m) => ({
  opportunity_id: oppId, contact_id: contactId,
  link_type: m?.link_type ?? null, reason: m?.reason ?? null,
  created_by: m?.created_by ?? null, created_model: m?.created_model ?? null, created_at: m?.created_at ?? null,
  // a link made before types and reasons existed has none: say so rather than invent one
  recorded: Boolean(m),
})

/** Every Opportunity linked to this Contact (the reverse lookup the Contact side needs). */
export function linksForContact(db, oppDef, contactId) {
  const field = linkField(oppDef)
  return listRecords(db, oppDef, { limit: 2000 })
    .filter((o) => Array.isArray(o[field]) && o[field].includes(contactId))
    .map((o) => ({ ...shape(o.id, contactId, getLink(db, oppDef.type, o.id, field, contactId)), project: o.project }))
}

/** Every Contact linked from this Opportunity. */
export function linksForOpportunity(db, oppDef, oppId) {
  const field = linkField(oppDef)
  const o = requireRecord(db, oppDef, oppId)
  return (o[field] ?? []).map((cid) => ({ ...shape(oppId, cid, getLink(db, oppDef.type, oppId, field, cid)), project: o.project }))
}
