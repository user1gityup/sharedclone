// contact-crm.mjs - central control of the Contact CRM in pm (website blitz L6b, T-c0654b62).
//
// pm is the system of record for Contact Leads. This module holds what pm decides FOR the CRM:
//   settings   owners (and the default owner), named permission sets, retention, export policy
//              and the import policy - one row, versioned, every change audited;
//   import     the one path external tools (event apps, badge scanners, spreadsheets) use to put
//              contacts into pm, row by row, validated, de-duplicated, tagged with where they
//              came from; nothing flows back out except through the gated export action.
// The record-type registry entry itself lives in record-types.mjs (CONTACT_LEAD) and is served
// at GET /api/record-types; this file adds the settings that govern it.
import {
  recordFail, validateRecordData, createRecord, listRecords, appendAudit, grantAccess,
} from './records.mjs'

export const IMPORT_SOURCES = Object.freeze(['event_app', 'badge_scanner', 'spreadsheet', 'other'])
export const DUPLICATE_POLICIES = Object.freeze(['skip', 'flag'])
export const MAX_IMPORT_ROWS = 500

export const DEFAULT_SETTINGS = Object.freeze({
  owners: [],
  default_owner: '',
  permission_sets: {
    viewer: ['read'],
    editor: ['read', 'create', 'update', 'status', 'note', 'tag', 'dedupe_suggest'],
  },
  // days after which a Contact Lead is due for review. Deleting is never automatic: it is the
  // bulk_delete action, which always waits for a human approval.
  retention: { days: null },
  // empty allowed_destinations means any destination may be asked for (each still needs a human
  // approval); a non-empty list refuses an export to anywhere not on it
  export: { allowed_destinations: [], max_records: 500 },
  import: { allowed_sources: ['event_app', 'badge_scanner', 'spreadsheet'], on_duplicate: 'skip' },
})

export function migrateContactCrm(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS contact_crm_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), settings TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`)
}

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''
const isoOf = (now) => (now instanceof Date ? now : now ? new Date(now) : new Date()).toISOString()
const clone = (o) => JSON.parse(JSON.stringify(o))

export function getSettings(db) {
  const row = db.prepare('SELECT * FROM contact_crm_settings WHERE id = 1').get()
  if (!row) return { ...clone(DEFAULT_SETTINGS), rev: 0, updated_by: null, updated_at: null }
  let stored = {}
  try { stored = JSON.parse(row.settings) } catch { stored = {} }
  return { ...clone(DEFAULT_SETTINGS), ...stored, rev: row.rev, updated_by: row.updated_by, updated_at: row.updated_at }
}

/** Check a whole settings object against the Contact Lead type; throws BAD_REQUEST listing problems. */
export function validateSettings(def, input) {
  const s = input ?? {}
  const problems = []
  const out = {}
  const known = Object.keys(DEFAULT_SETTINGS)
  for (const k of Object.keys(s)) if (!known.includes(k)) problems.push(`unknown setting ${k}`)
  if (s.owners !== undefined) {
    if (!Array.isArray(s.owners) || !s.owners.every(nonEmpty)) problems.push('owners must be a list of identities')
    else out.owners = [...new Set(s.owners.map((o) => o.trim()))]
  }
  if (s.default_owner !== undefined) {
    if (typeof s.default_owner !== 'string') problems.push('default_owner must be a string')
    else out.default_owner = s.default_owner.trim()
  }
  if (s.permission_sets !== undefined) {
    const ps = s.permission_sets
    if (!ps || typeof ps !== 'object' || Array.isArray(ps)) problems.push('permission_sets must be an object of name -> actions')
    else {
      out.permission_sets = {}
      for (const [name, actions] of Object.entries(ps)) {
        if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name)) { problems.push(`permission set name ${name} is not a short lower-case name`); continue }
        if (!Array.isArray(actions) || !actions.length || !actions.every(nonEmpty)) { problems.push(`permission set ${name} needs a non-empty list of actions`); continue }
        const bad = actions.filter((a) => a !== '*' && !def.actions.includes(a))
        if (bad.length) { problems.push(`permission set ${name}: ${def.type} has no action ${bad.join(', ')}`); continue }
        out.permission_sets[name] = [...new Set(actions)]
      }
    }
  }
  if (s.retention !== undefined) {
    const d = s.retention?.days
    if (d !== null && d !== undefined && (!Number.isInteger(d) || d < 1 || d > 36500)) problems.push('retention.days must be a whole number of days, or null for no limit')
    else out.retention = { days: d ?? null }
  }
  if (s.export !== undefined) {
    const e = s.export ?? {}
    const dest = e.allowed_destinations ?? []
    const max = e.max_records ?? 500
    if (!Array.isArray(dest) || !dest.every(nonEmpty)) problems.push('export.allowed_destinations must be a list of destinations')
    else if (!Number.isInteger(max) || max < 1 || max > 5000) problems.push('export.max_records must be between 1 and 5000')
    else out.export = { allowed_destinations: [...new Set(dest.map((d) => d.trim()))], max_records: max }
  }
  if (s.import !== undefined) {
    const i = s.import ?? {}
    const src = i.allowed_sources ?? DEFAULT_SETTINGS.import.allowed_sources
    const dup = i.on_duplicate ?? 'skip'
    if (!Array.isArray(src) || !src.length || !src.every((x) => IMPORT_SOURCES.includes(x))) problems.push(`import.allowed_sources must be a non-empty list of: ${IMPORT_SOURCES.join(', ')}`)
    else if (!DUPLICATE_POLICIES.includes(dup)) problems.push(`import.on_duplicate must be one of: ${DUPLICATE_POLICIES.join(', ')}`)
    else out.import = { allowed_sources: [...new Set(src)], on_duplicate: dup }
  }
  if (problems.length) recordFail('BAD_REQUEST', `contact CRM settings: ${problems.join('; ')}`)
  return out
}

/** Merge a (validated) partial change into the stored settings; audited on the Contact Lead log. */
export function updateSettings(db, def, patch, { actor, expectedRev, now } = {}) {
  if (!nonEmpty(actor)) recordFail('BAD_REQUEST', 'actor is required: name who is changing the settings')
  const clean = validateSettings(def, patch)
  const before = getSettings(db)
  if (expectedRev !== undefined && expectedRev !== null && Number(expectedRev) !== before.rev) {
    recordFail('CONFLICT', `settings are at revision ${before.rev}, not ${expectedRev}: reload and retry`)
  }
  const { rev, updated_by, updated_at, ...current } = before // eslint-disable-line no-unused-vars
  const merged = { ...current, ...clean }
  const at = isoOf(now)
  db.prepare(`INSERT INTO contact_crm_settings (id, settings, rev, updated_by, updated_at) VALUES (1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, rev = contact_crm_settings.rev + 1,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(JSON.stringify(merged), 1, actor.trim(), at)
  const after = getSettings(db)
  appendAudit(db, def, { record_id: '-', action: 'settings_update', actor, now: at, before: current, after: merged, detail: { changed: Object.keys(clean) } })
  return after
}

/** Grant a stored permission set to a subject on the Contact Lead ACL. Admin-only upstream. */
export function applyPermissionSet(db, def, name, { subject, project = '', by, now } = {}) {
  const set = getSettings(db).permission_sets[name]
  if (!set) recordFail('NOT_FOUND', `no permission set ${name}`)
  return grantAccess(db, def, { subject, project, actions: set, by, now })
}

/** Is an export to `destination` of `count` records within the stored export policy? */
export function assertExportAllowed(db, { destination, count } = {}) {
  const { export: policy } = getSettings(db)
  if (count > policy.max_records) recordFail('BAD_REQUEST', `export policy allows at most ${policy.max_records} records at a time, not ${count}`)
  if (policy.allowed_destinations.length && !policy.allowed_destinations.includes(String(destination ?? '').trim())) {
    recordFail('FORBIDDEN', `export policy: ${destination || '(no destination)'} is not an allowed export destination (${policy.allowed_destinations.join(', ')})`)
  }
}

/** Contact Leads older than the retention window. Reported for review; never deleted here. */
export function retentionDue(db, def, { now, project } = {}) {
  const { retention } = getSettings(db)
  if (!retention.days) return { days: null, due: [] }
  const cutoff = new Date(new Date(isoOf(now)).getTime() - retention.days * 86400000).toISOString()
  const due = listRecords(db, def, { project, limit: 2000 }).filter((r) => r.created_at < cutoff)
    .map((r) => ({ id: r.id, project: r.project, owner: r.owner, status: r.status, created_at: r.created_at }))
  return { days: retention.days, cutoff, due }
}

// ---------------------------------------------------------------- import

// the names external tools use for our fields
const ALIASES = {
  full_name: 'name', contact_name: 'name', company: 'organization', org: 'organization', organisation: 'organization',
  title: 'role_title', job_title: 'role_title', mail: 'email', email_address: 'email', phone_number: 'phone', mobile: 'phone',
  event: 'event_name', venue: 'event_venue', date: 'event_date',
}
const SOURCE_CHANNEL = { badge_scanner: 'badge_scan' }

const digits = (s) => String(s ?? '').replace(/\D/g, '')
const emailKey = (s) => String(s ?? '').trim().toLowerCase()

function normalizeRow(row, source) {
  const data = {}
  for (const [k, v] of Object.entries(row ?? {})) {
    const key = ALIASES[k] ?? k
    if (key in data && data[key] !== undefined && data[key] !== '') continue
    data[key] = v
  }
  if (!data.type) data.type = 'person'
  if (!data.source_channel && SOURCE_CHANNEL[source]) data.source_channel = SOURCE_CHANNEL[source]
  return data
}

/**
 * Import rows from an external tool. Row by row: a bad row is reported and the rest still land,
 * unless dryRun is set, in which case nothing is written and every row is only checked.
 * Imported contacts carry no consent unless the row says so, and are tagged import:<source>
 * and batch:<batch>, so where they came from is on the record.
 */
export function importContacts(db, def, { source, rows, batch, project = '', dryRun = false, actor, model = null, agent = null, now } = {}) {
  const settings = getSettings(db)
  if (!IMPORT_SOURCES.includes(source)) recordFail('BAD_REQUEST', `source must be one of: ${IMPORT_SOURCES.join(', ')}`)
  if (!settings.import.allowed_sources.includes(source)) recordFail('FORBIDDEN', `imports from ${source} are not enabled in the Contact CRM settings`)
  if (!Array.isArray(rows) || !rows.length) recordFail('BAD_REQUEST', 'rows must be a non-empty list')
  if (rows.length > MAX_IMPORT_ROWS) recordFail('BAD_REQUEST', `an import takes at most ${MAX_IMPORT_ROWS} rows, got ${rows.length}`)
  const batchId = nonEmpty(batch) ? batch.trim() : `${source}-${isoOf(now).slice(0, 10)}`
  const owner = settings.default_owner || undefined
  // who is already in pm, by the two keys that most reliably mean "the same person"
  const known = { email: new Map(), phone: new Map() }
  for (const r of listRecords(db, def, { project: project || undefined, limit: 2000 })) {
    if (r.email) known.email.set(emailKey(r.email), r.id)
    if (digits(r.phone).length >= 5) known.phone.set(digits(r.phone), r.id)
  }
  const result = { source, batch: batchId, dry_run: Boolean(dryRun), received: rows.length, created: [], duplicates: [], errors: [] }
  rows.forEach((raw, index) => {
    try {
      const data = normalizeRow(raw, source)
      const tags = [...new Set([...(Array.isArray(data.tags) ? data.tags : []), `import:${source}`, `batch:${batchId}`])]
      data.tags = tags
      const clean = validateRecordData(def, data, { partial: false })
      const dupOf = (clean.email && known.email.get(emailKey(clean.email))) || (digits(clean.phone).length >= 5 && known.phone.get(digits(clean.phone))) || null
      if (dupOf && settings.import.on_duplicate === 'skip') { result.duplicates.push({ row: index, duplicate_of: dupOf, action: 'skipped' }); return }
      if (dupOf) clean.tags = [...new Set([...clean.tags, 'possible-duplicate'])]
      if (dryRun) { result.created.push({ row: index, id: null, flagged_duplicate_of: dupOf }); return }
      const rec = createRecord(db, def, { project, owner, data: clean, actor, model, agent, now })
      if (clean.email) known.email.set(emailKey(clean.email), rec.id)
      if (digits(clean.phone).length >= 5) known.phone.set(digits(clean.phone), rec.id)
      result.created.push({ row: index, id: rec.id, flagged_duplicate_of: dupOf })
      if (dupOf) result.duplicates.push({ row: index, duplicate_of: dupOf, action: 'flagged' })
    } catch (err) {
      result.errors.push({ row: index, error: err.message })
    }
  })
  if (!dryRun) {
    appendAudit(db, def, {
      record_id: '-', action: 'import', actor, model, agent, now,
      detail: { source, batch: batchId, project, received: rows.length, created: result.created.length, duplicates: result.duplicates.length, errors: result.errors.length },
    })
  }
  return result
}
