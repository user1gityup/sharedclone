// records.mjs - generic pm record-type module (website blitz L6a; T-af9f057e, T-8b68240c, T-d0ab1b37).
//
// ONE engine, MANY record types. Every registered type gets its own
//   - table            rec_<type>            (its own id space, its own status enum)
//   - ACL table        rec_<type>_acl        (a grant here is never a grant anywhere else)
//   - audit table      rec_<type>_audit      (actor, model, timestamp, before/after)
// Nothing is shared between types but this code. An id, a status or an access grant of one
// type is rejected by another, so Lead Management (Opportunity) and the Event Contact CRM
// (Contact Lead) can never bleed into each other.
//
// node built-ins only; `db` is a node:sqlite DatabaseSync handle. Fail closed everywhere.
import { randomBytes } from 'node:crypto'

export class RecordError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.code = code
    this.extra = extra
  }
}
export const recordFail = (code, msg, extra) => { throw new RecordError(code, msg, extra) }

const iso = (v) => (v instanceof Date ? v : new Date(v ?? Date.now())).toISOString()
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''
const TYPE_NAME = /^[a-z][a-z0-9_]{1,31}$/
const ID_PREFIX = /^[A-Z][A-Z0-9]{0,7}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?$/

/** Columns the engine owns; a type may not define a field with one of these names. */
export const RESERVED_FIELDS = Object.freeze([
  'id', 'record_type', 'project', 'owner', 'status', 'rev',
  'created_at', 'created_by', 'created_model', 'updated_at', 'updated_by', 'updated_model',
  'deleted_at', 'deleted_by',
  // the camelCase timestamps every record carries (T-8b68240c names them createdAt/updatedAt)
  'createdAt', 'updatedAt',
])

/** Field kinds a record type may declare. */
export const FIELD_TYPES = Object.freeze(['string', 'text', 'enum', 'boolean', 'date', 'number', 'tags', 'notes', 'links'])

/** Actions a type's ACL and the gate config understand, unless the type narrows them. */
export const DEFAULT_ACTIONS = Object.freeze([
  'read', 'create', 'update', 'status', 'note', 'tag', 'link', 'dedupe_suggest',
  'outbound_message', 'export', 'bulk_delete', 'share_third_party',
])

/**
 * Actions that can only be performed on a field of a given kind. A type that declares no such
 * field does not get the action: see defineRecordType, which drops it rather than advertise it.
 */
export const ACTION_NEEDS = Object.freeze({ link: 'links', tag: 'tags', note: 'notes' })

/** Audit actions the engine writes itself. */
export const AUDIT_ACTIONS = Object.freeze([
  'create', 'update', 'status_change', 'note', 'tag', 'link', 'unlink', 'dedupe_suggest',
  'export', 'delete',
  'acl_grant', 'acl_revoke', 'access_denied', 'approval_required', 'approval_used',
])

/** How a dedupe key normalizes the field values it is built from. */
export const DEDUPE_NORMALIZERS = Object.freeze(['text', 'digits', 'email'])

// ---------------------------------------------------------------- registry

const REGISTRY = new Map()

function signature(def) {
  return JSON.stringify([def.type, def.idPrefix, def.table, def.statuses, def.initialStatus, Object.keys(def.fields)])
}

/**
 * Declare a record type. Returns a frozen descriptor; registering the same declaration twice
 * returns the first one, a different one with the same name throws.
 * Two types may never share an id prefix or a table: that is what keeps the id spaces apart.
 */
export function defineRecordType(spec = {}) {
  const type = spec.type
  if (!TYPE_NAME.test(String(type))) recordFail('BAD_REQUEST', `record type name must match ${TYPE_NAME}`)
  if (!ID_PREFIX.test(String(spec.idPrefix))) recordFail('BAD_REQUEST', `${type}: idPrefix must match ${ID_PREFIX}`)
  const statuses = spec.statuses
  if (!Array.isArray(statuses) || !statuses.length || !statuses.every(nonEmpty) || new Set(statuses).size !== statuses.length)
    recordFail('BAD_REQUEST', `${type}: statuses must be a non-empty list of distinct names`)
  const initialStatus = spec.initialStatus ?? statuses[0]
  if (!statuses.includes(initialStatus)) recordFail('BAD_REQUEST', `${type}: initialStatus ${initialStatus} is not one of its statuses`)
  const fields = spec.fields ?? {}
  if (typeof fields !== 'object' || Array.isArray(fields)) recordFail('BAD_REQUEST', `${type}: fields must be an object`)
  for (const [name, f] of Object.entries(fields)) {
    if (RESERVED_FIELDS.includes(name)) recordFail('BAD_REQUEST', `${type}: field ${name} collides with an engine column`)
    if (!FIELD_TYPES.includes(f?.type)) recordFail('BAD_REQUEST', `${type}.${name}: type must be one of ${FIELD_TYPES.join(', ')}`)
    if (f.type === 'enum' && (!Array.isArray(f.values) || !f.values.length)) recordFail('BAD_REQUEST', `${type}.${name}: enum needs values`)
    if (f.type === 'links' && !nonEmpty(f.linkTo)) recordFail('BAD_REQUEST', `${type}.${name}: links needs linkTo`)
  }
  if (spec.idField && (RESERVED_FIELDS.includes(spec.idField) && spec.idField !== 'id')) recordFail('BAD_REQUEST', `${type}: idField collides with an engine column`)
  const transitions = spec.transitions ?? null
  if (transitions) {
    for (const [from, to] of Object.entries(transitions)) {
      if (!statuses.includes(from)) recordFail('BAD_REQUEST', `${type}: transition from unknown status ${from}`)
      if (!Array.isArray(to) || !to.every((s) => statuses.includes(s))) recordFail('BAD_REQUEST', `${type}: transitions.${from} must list known statuses`)
    }
  }
  // dedupe keys: what makes two records of this type look like the same thing. They are
  // declared per type (nothing is guessed across types) and only ever read, never written.
  const dedupe = spec.dedupe ?? []
  if (!Array.isArray(dedupe)) recordFail('BAD_REQUEST', `${type}: dedupe must be a list of keys`)
  for (const k of dedupe) {
    if (!nonEmpty(k?.key)) recordFail('BAD_REQUEST', `${type}: a dedupe key needs a key name`)
    if (!Array.isArray(k.fields) || !k.fields.length) recordFail('BAD_REQUEST', `${type}.${k.key}: dedupe key needs fields`)
    for (const f of k.fields) {
      if (!(f in fields)) recordFail('BAD_REQUEST', `${type}.${k.key}: ${f} is not a field of this record type`)
      if (['notes', 'links', 'tags'].includes(fields[f].type)) recordFail('BAD_REQUEST', `${type}.${k.key}: ${f} is a ${fields[f].type} field and cannot key a duplicate`)
    }
    if (k.normalize && !DEDUPE_NORMALIZERS.includes(k.normalize)) recordFail('BAD_REQUEST', `${type}.${k.key}: normalize must be one of ${DEDUPE_NORMALIZERS.join(', ')}`)
  }
  // A type never advertises an action it cannot perform. `link` needs a links field, `tag` a
  // tags field, `note` a notes field and `dedupe_suggest` at least one dedupe key - without
  // them there is nothing for the action to touch, and a grant of it would be a grant of a
  // name with no operation behind it. Taking the default list, the action is simply dropped;
  // asking for it explicitly is a declaration error and says so.
  const declaredActions = spec.actions ?? null
  if (declaredActions && (!Array.isArray(declaredActions) || !declaredActions.every(nonEmpty))) {
    recordFail('BAD_REQUEST', `${type}: actions must be a list of action names`)
  }
  const wanted = declaredActions ?? DEFAULT_ACTIONS
  const hasField = (kind) => Object.values(fields).some((f) => f.type === kind)
  const unperformable = wanted.filter((a) => (ACTION_NEEDS[a] ? !hasField(ACTION_NEEDS[a]) : a === 'dedupe_suggest' && !dedupe.length))
  if (declaredActions && unperformable.length) {
    recordFail('BAD_REQUEST', `${type}: ${unperformable.join(', ')} cannot be performed by this type (it declares no ${
      unperformable.map((a) => ACTION_NEEDS[a] ?? 'dedupe key').join('/')} field)`)
  }
  const actions = wanted.filter((a) => !unperformable.includes(a))
  const def = Object.freeze({
    type,
    label: spec.label ?? type,
    idPrefix: spec.idPrefix,
    idField: spec.idField ?? null,
    table: spec.table ?? `rec_${type}`,
    aclTable: `rec_${type}_acl`,
    auditTable: `rec_${type}_audit`,
    statuses: Object.freeze([...statuses]),
    initialStatus,
    terminal: Object.freeze([...(spec.terminal ?? [])]),
    transitions: transitions ? Object.freeze(Object.fromEntries(Object.entries(transitions).map(([k, v]) => [k, Object.freeze([...v])]))) : null,
    fields: Object.freeze(fields),
    actions: Object.freeze([...actions]),
    dedupe: Object.freeze(dedupe.map((k) => Object.freeze({
      key: k.key, fields: Object.freeze([...k.fields]), normalize: k.normalize ?? 'text', label: k.label ?? k.key,
    }))),
    version: Number(spec.version ?? 1),
  })
  const existing = REGISTRY.get(type)
  if (existing) {
    if (signature(existing) !== signature(def)) recordFail('CONFLICT', `record type ${type} is already registered with a different shape`)
    return existing
  }
  for (const other of REGISTRY.values()) {
    if (other.idPrefix === def.idPrefix) recordFail('CONFLICT', `id prefix ${def.idPrefix} already belongs to ${other.type}: record types never share an id space`)
    if (other.table === def.table) recordFail('CONFLICT', `table ${def.table} already belongs to ${other.type}`)
  }
  REGISTRY.set(type, def)
  return def
}

/** The names of this type's fields of one kind ('tags', 'links', 'notes', ...), in order. */
export function fieldsOfKind(def, kind) {
  return Object.keys(def.fields).filter((n) => def.fields[n].type === kind)
}

/**
 * The field an action works on when the caller names none: a type's first field of that kind,
 * or null when it has none. Nothing is guessed across types - 'contact_links' belongs to the
 * Opportunity because the Opportunity declares it, not because the name is hard-coded anywhere.
 */
export function defaultFieldOfKind(def, kind) {
  return fieldsOfKind(def, kind)[0] ?? null
}

export function getRecordType(type) {
  return REGISTRY.get(String(type)) ?? null
}
export function requireRecordType(type) {
  const def = getRecordType(type)
  if (!def) recordFail('NOT_FOUND', `unknown record type ${type}`)
  return def
}
export function listRecordTypes() {
  return [...REGISTRY.values()]
}

// ---------------------------------------------------------------- migration

const COLUMNS = [
  ['id', 'TEXT PRIMARY KEY'],
  ['project', "TEXT NOT NULL DEFAULT ''"],
  ['owner', "TEXT NOT NULL DEFAULT ''"],
  ['status', "TEXT NOT NULL DEFAULT ''"],
  ['data', "TEXT NOT NULL DEFAULT '{}'"],
  ['rev', 'INTEGER NOT NULL DEFAULT 1'],
  ['created_at', "TEXT NOT NULL DEFAULT ''"],
  ['created_by', "TEXT NOT NULL DEFAULT ''"],
  ['created_model', 'TEXT'],
  ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ['updated_by', "TEXT NOT NULL DEFAULT ''"],
  ['updated_model', 'TEXT'],
  ['deleted_at', 'TEXT'],
  ['deleted_by', 'TEXT'],
]

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))
}

/**
 * Create (or bring forward) one record type's three tables. Idempotent, and safe on a
 * database whose table predates a column: missing columns are ALTERed in.
 * Returns {type, table, added:[...], version}.
 */
export function migrateRecordType(db, def) {
  db.exec(`CREATE TABLE IF NOT EXISTS record_migrations (
    record_type TEXT NOT NULL, version INTEGER NOT NULL, applied_at TEXT NOT NULL,
    PRIMARY KEY (record_type, version))`)
  const added = []
  if (!tableExists(db, def.table)) {
    db.exec(`CREATE TABLE ${def.table} (${COLUMNS.map(([n, t]) => `${n} ${t}`).join(', ')})`)
  } else {
    const have = new Set(db.prepare(`SELECT name FROM pragma_table_info('${def.table}')`).all().map((r) => r.name))
    for (const [name, type] of COLUMNS) {
      if (have.has(name) || name === 'id') continue
      // an ALTER cannot add a NOT NULL column without a default; the defaults above supply one
      db.exec(`ALTER TABLE ${def.table} ADD COLUMN ${name} ${type}`)
      added.push(name)
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS ${def.table}_project ON ${def.table}(project, status)`)
  db.exec(`CREATE INDEX IF NOT EXISTS ${def.table}_owner ON ${def.table}(owner)`)
  db.exec(`CREATE TABLE IF NOT EXISTS ${def.aclTable} (
    subject TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', actions TEXT NOT NULL,
    granted_by TEXT NOT NULL, granted_at TEXT NOT NULL, revoked_at TEXT,
    PRIMARY KEY (subject, project))`)
  db.exec(`CREATE TABLE IF NOT EXISTS ${def.auditTable} (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, record_type TEXT NOT NULL,
    action TEXT NOT NULL, actor TEXT NOT NULL, model TEXT, at TEXT NOT NULL,
    before TEXT, after TEXT, detail TEXT NOT NULL DEFAULT '{}')`)
  db.exec(`CREATE INDEX IF NOT EXISTS ${def.auditTable}_record ON ${def.auditTable}(record_id, seq)`)
  db.prepare('INSERT OR IGNORE INTO record_migrations (record_type, version, applied_at) VALUES (?,?,?)')
    .run(def.type, def.version, iso())
  return { type: def.type, table: def.table, added, version: def.version }
}

/** Versions applied for a type (oldest first). */
export function appliedMigrations(db, type) {
  if (!tableExists(db, 'record_migrations')) return []
  return db.prepare('SELECT version, applied_at FROM record_migrations WHERE record_type = ? ORDER BY version')
    .all(String(type)).map((r) => ({ ...r }))
}

// ---------------------------------------------------------------- validation

function badFields(problems) {
  recordFail('BAD_REQUEST', problems.join('; '), { fields: problems })
}

function coerceField(def, name, spec, value, problems) {
  const where = `${def.type}.${name}`
  switch (spec.type) {
    case 'string':
    case 'text': {
      if (typeof value !== 'string') { problems.push(`${where} must be a string`); return undefined }
      const v = value.trim()
      const max = spec.max ?? (spec.type === 'text' ? 20000 : 500)
      if (v.length > max) { problems.push(`${where} is longer than ${max} characters`); return undefined }
      if (spec.pattern === 'email' && v && !EMAIL.test(v)) { problems.push(`${where} is not an email address`); return undefined }
      return v
    }
    case 'enum':
      if (!spec.values.includes(value)) { problems.push(`${where} must be one of ${spec.values.join(', ')}`); return undefined }
      return value
    case 'boolean':
      if (typeof value !== 'boolean') { problems.push(`${where} must be true or false`); return undefined }
      return value
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) { problems.push(`${where} must be a finite number`); return undefined }
      if (spec.min != null && value < spec.min) { problems.push(`${where} must be at least ${spec.min}`); return undefined }
      return value
    case 'date':
      if (typeof value !== 'string' || !DATE.test(value.trim()) || Number.isNaN(Date.parse(value.trim()))) {
        problems.push(`${where} must be a date (YYYY-MM-DD or ISO timestamp)`); return undefined
      }
      return value.trim()
    case 'tags': {
      if (!Array.isArray(value) || !value.every((t) => nonEmpty(t))) { problems.push(`${where} must be a list of tags`); return undefined }
      const tags = [...new Set(value.map((t) => t.trim().toLowerCase()))]
      if (tags.length > (spec.max ?? 50)) { problems.push(`${where} holds more than ${spec.max ?? 50} tags`); return undefined }
      return tags
    }
    case 'links': {
      if (!Array.isArray(value) || !value.every((t) => nonEmpty(t))) { problems.push(`${where} must be a list of record ids`); return undefined }
      const target = getRecordType(spec.linkTo)
      if (!target) { problems.push(`${where} links to unknown record type ${spec.linkTo}`); return undefined }
      const bad = value.filter((v) => !isIdOf(target, v))
      if (bad.length) { problems.push(`${where} only takes ${target.type} ids (${target.idPrefix}-...): ${bad.join(', ')}`); return undefined }
      return [...new Set(value)]
    }
    case 'notes':
      problems.push(`${where} is append-only: use addNote, it cannot be set directly`)
      return undefined
    default:
      problems.push(`${where} has an unsupported type`)
      return undefined
  }
}

/** Did a coerced value come out empty? ' ' trims to '' and must not pass for a required field. */
function isBlank(v) {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

/**
 * Normalize and check an input object against a type's fields.
 * Unknown keys are refused (fail closed); with partial:true missing required fields are allowed.
 * A required field is required after coercion too: ' ' is not a name.
 */
export function validateRecordData(def, input = {}, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) recordFail('BAD_REQUEST', `${def.type}: data must be an object`)
  const problems = []
  const out = {}
  for (const key of Object.keys(input)) {
    if (!(key in def.fields)) problems.push(`${def.type}.${key} is not a field of this record type`)
  }
  for (const [name, spec] of Object.entries(def.fields)) {
    const present = Object.prototype.hasOwnProperty.call(input, name)
    const value = input[name]
    if (!present || value === undefined || value === null || value === '') {
      if (spec.type === 'notes') continue
      if (present) {
        // an explicit null/'' clears an optional field; a required one may never be cleared
        if (spec.required) problems.push(`${def.type}.${name} is required`)
        else out[name] = spec.type === 'tags' || spec.type === 'links' ? [] : null
        continue
      }
      if (!partial) {
        if (spec.required) problems.push(`${def.type}.${name} is required`)
        else if (spec.default !== undefined) out[name] = spec.default
      }
      continue
    }
    const v = coerceField(def, name, spec, value, problems)
    if (v === undefined) continue
    // a required field may not be satisfied by whitespace, an empty string or an empty list
    if (spec.required && isBlank(v)) { problems.push(`${def.type}.${name} is required`); continue }
    out[name] = v
  }
  if (problems.length) badFields(problems)
  return out
}

/** Is `id` an id of this record type? Keeps one type's ids out of another's lookups. */
export function isIdOf(def, id) {
  return typeof id === 'string' && id.startsWith(`${def.idPrefix}-`) && id.length > def.idPrefix.length + 1
}

export function newRecordId(def) {
  return `${def.idPrefix}-${randomBytes(5).toString('hex')}`
}

// ---------------------------------------------------------------- rows

function rowToRecord(def, row) {
  if (!row) return null
  let data = {}
  try { data = JSON.parse(row.data || '{}') } catch { data = {} }
  const out = {
    id: row.id,
    record_type: def.type,
    project: row.project ?? '',
    owner: row.owner ?? '',
    status: row.status,
    rev: row.rev,
    created_at: row.created_at,
    created_by: row.created_by,
    created_model: row.created_model ?? null,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    updated_model: row.updated_model ?? null,
    deleted_at: row.deleted_at ?? null,
    // T-8b68240c names these createdAt/updatedAt; they are the same two engine columns
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...data,
  }
  if (def.idField) out[def.idField] = row.id
  return out
}

/**
 * The identity to record, checked.
 * An agent must say which model it is: when `agent` names one, `model` is not optional, so no
 * agent mutation can land in an audit log with a null model.
 */
function who(actor, { model = null, agent = null } = {}) {
  if (!nonEmpty(actor)) recordFail('BAD_REQUEST', 'actor is required: name who is making this change (for an agent, its model name)')
  if (nonEmpty(agent) && !nonEmpty(model)) {
    recordFail('BAD_REQUEST', `${agent.trim()} is an agent: model is required so the audit entry says which model made this change`)
  }
  return actor.trim()
}

/** who(), exported: the route layer checks the same rule before it touches a record. */
export function assertActor({ actor, model = null, agent = null } = {}) {
  return who(actor, { model, agent })
}

// ---------------------------------------------------------------- audit

/**
 * Append one audit entry to a type's own log. Never shared between types.
 * Pass `agent` when the actor is an agent: the entry is then refused without a model.
 */
export function appendAudit(db, def, { record_id, action, actor, model = null, agent = null, before = null, after = null, detail = {}, now } = {}) {
  const at = iso(now)
  db.prepare(`INSERT INTO ${def.auditTable} (record_id, record_type, action, actor, model, at, before, after, detail)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    String(record_id ?? '-'), def.type, String(action), who(actor, { model, agent }), model ? String(model) : null, at,
    before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), JSON.stringify(detail ?? {}))
  return { record_id: String(record_id ?? '-'), record_type: def.type, action, actor, model, at }
}

const parseOr = (s, fallback) => {
  if (s == null) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

/**
 * Audit entries for this type, newest first. A malformed row never hides the rest of the log.
 * `project` narrows the log to the records of that project - what a caller authorized in one
 * project may read. Engine-wide entries (ACL and gate rows, record_id '-') belong to no
 * project and are therefore outside a project-scoped read.
 */
export function auditLog(db, def, { record_id, action, actor, project, limit = 200 } = {}) {
  const where = []
  const args = []
  for (const [col, v] of [['record_id', record_id], ['action', action], ['actor', actor]]) {
    if (nonEmpty(v)) { where.push(`${col} = ?`); args.push(v) }
  }
  if (nonEmpty(project)) {
    where.push(`record_id IN (SELECT id FROM ${def.table} WHERE project = ?)`)
    args.push(project.trim())
  }
  const n = Math.min(Math.max(Number(limit) || 200, 1), 2000)
  return db.prepare(`SELECT * FROM ${def.auditTable}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ${n}`)
    .all(...args).map((r) => ({
      ...r,
      before: parseOr(r.before, null),
      after: parseOr(r.after, null),
      detail: parseOr(r.detail || '{}', {}),
    }))
}

// ---------------------------------------------------------------- ACL (per type)

function aclRows(db, def, subject) {
  return db.prepare(`SELECT * FROM ${def.aclTable} WHERE subject = ? AND revoked_at IS NULL`)
    .all(String(subject)).map((r) => ({ ...r, actions: parseOr(r.actions, []) }))
}

/** Grant a subject some actions on THIS record type, globally ('' project) or in one project. */
export function grantAccess(db, def, { subject, project = '', actions, by, now } = {}) {
  if (!nonEmpty(subject)) recordFail('BAD_REQUEST', 'subject required')
  if (!nonEmpty(by)) recordFail('BAD_REQUEST', 'by (who grants) required')
  if (project === '*') recordFail('BAD_REQUEST', "project '*' is not allowed; use '' for every project")
  const list = Array.isArray(actions) ? actions : [actions]
  if (!list.length || !list.every(nonEmpty)) recordFail('BAD_REQUEST', 'actions must be a non-empty list')
  const unknown = list.filter((a) => a !== '*' && !def.actions.includes(a))
  if (unknown.length) recordFail('BAD_REQUEST', `${def.type} has no action ${unknown.join(', ')}`)
  const at = iso(now)
  db.prepare(`INSERT INTO ${def.aclTable} (subject, project, actions, granted_by, granted_at, revoked_at)
    VALUES (?,?,?,?,?,NULL)
    ON CONFLICT(subject, project) DO UPDATE SET actions = excluded.actions, granted_by = excluded.granted_by,
      granted_at = excluded.granted_at, revoked_at = NULL`)
    .run(String(subject), String(project), JSON.stringify([...new Set(list)]), String(by), at)
  appendAudit(db, def, { record_id: '-', action: 'acl_grant', actor: by, now: at, after: { subject, project, actions: [...new Set(list)] } })
  return listAccess(db, def, { subject })
}

export function revokeAccess(db, def, { subject, project = '', by = 'pm', now } = {}) {
  if (!nonEmpty(subject)) recordFail('BAD_REQUEST', 'subject required')
  const at = iso(now)
  db.prepare(`UPDATE ${def.aclTable} SET revoked_at = ? WHERE subject = ? AND project = ? AND revoked_at IS NULL`)
    .run(at, String(subject), String(project))
  appendAudit(db, def, { record_id: '-', action: 'acl_revoke', actor: by, now: at, before: { subject, project } })
  return listAccess(db, def, { subject })
}

export function listAccess(db, def, { subject } = {}) {
  const sql = `SELECT subject, project, actions, granted_by, granted_at FROM ${def.aclTable} WHERE revoked_at IS NULL`
  const rows = nonEmpty(subject)
    ? db.prepare(`${sql} AND subject = ? ORDER BY project`).all(subject)
    : db.prepare(`${sql} ORDER BY subject, project`).all()
  return rows.map((r) => ({ ...r, record_type: def.type, actions: parseOr(r.actions, []) }))
}

/** Actions this subject holds on this type in this project (global rows count too). */
export function accessActions(db, def, subject, project = '') {
  const out = new Set()
  for (const r of aclRows(db, def, subject)) {
    if (r.project && project && r.project !== project) continue
    if (r.project && !project) continue
    for (const a of r.actions) out.add(a)
  }
  return [...out]
}

/** Does the per-type ACL allow this action? A grant on another type is invisible here. */
export function accessAllows(db, def, subject, action, project = '') {
  if (!nonEmpty(subject) || !nonEmpty(action)) return false
  const have = accessActions(db, def, subject, project)
  return have.includes('*') || have.includes(action)
}

// ---------------------------------------------------------------- records

export function getRecord(db, def, id) {
  if (!isIdOf(def, id)) return null // another type's id is simply not a record here
  return rowToRecord(def, db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(String(id)))
}

export function requireRecord(db, def, id) {
  const r = getRecord(db, def, id)
  if (!r) recordFail('NOT_FOUND', `no ${def.type} ${id}`)
  return r
}

export function listRecords(db, def, { project, owner, status, includeDeleted = false, limit = 200 } = {}) {
  const where = []
  const args = []
  for (const [col, v] of [['project', project], ['owner', owner], ['status', status]]) {
    if (nonEmpty(v)) { where.push(`${col} = ?`); args.push(v) }
  }
  if (!includeDeleted) where.push('deleted_at IS NULL')
  const n = Math.min(Math.max(Number(limit) || 200, 1), 2000)
  return db.prepare(`SELECT * FROM ${def.table}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT ${n}`)
    .all(...args).map((r) => rowToRecord(def, r))
}

export function countRecords(db, def) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${def.table}`).get().n)
}

/** Create a record of this type. Writes a 'create' audit entry. */
export function createRecord(db, def, { project = '', owner, status, data = {}, actor, model = null, agent = null, now } = {}) {
  const by = who(actor, { model, agent })
  const at = iso(now)
  const st = status ?? def.initialStatus
  if (!def.statuses.includes(st)) recordFail('BAD_REQUEST', `${def.type} status must be one of ${def.statuses.join(', ')}`)
  const clean = validateRecordData(def, data, { partial: false })
  for (const [name, spec] of Object.entries(def.fields)) if (spec.type === 'notes') clean[name] = []
  const id = newRecordId(def)
  db.prepare(`INSERT INTO ${def.table} (id, project, owner, status, data, rev, created_at, created_by, created_model, updated_at, updated_by, updated_model)
    VALUES (?,?,?,?,?,1,?,?,?,?,?,?)`)
    .run(id, String(project ?? ''), String(owner ?? by), st, JSON.stringify(clean), at, by, model ? String(model) : null, at, by, model ? String(model) : null)
  const after = getRecord(db, def, id)
  appendAudit(db, def, { record_id: id, action: 'create', actor: by, model, agent, before: null, after, now: at })
  return after
}

function writeBack(db, def, rec, { data, project, owner, status, actor, model, now }) {
  const at = iso(now)
  db.prepare(`UPDATE ${def.table} SET project = ?, owner = ?, status = ?, data = ?, rev = rev + 1,
      updated_at = ?, updated_by = ?, updated_model = ? WHERE id = ?`)
    .run(String(project), String(owner), String(status), JSON.stringify(data), at, actor, model ? String(model) : null, rec.id)
  return getRecord(db, def, rec.id)
}

function dataOf(def, rec) {
  const out = {}
  for (const name of Object.keys(def.fields)) if (name in rec) out[name] = rec[name]
  return out
}

/**
 * Patch a record's fields, owner or project. Status is NOT changed here - a status change is
 * its own audited action (setRecordStatus), so the pipeline history stays readable.
 */
export function updateRecord(db, def, id, { patch = {}, owner, project, actor, model = null, agent = null, now, expectedRev } = {}) {
  const by = who(actor, { model, agent })
  const before = requireRecord(db, def, id)
  if (before.deleted_at) recordFail('CONFLICT', `${def.type} ${id} is deleted`)
  if (expectedRev != null && Number(expectedRev) !== before.rev) recordFail('CONFLICT', `${def.type} ${id} is at rev ${before.rev}, not ${expectedRev}`)
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'status')) recordFail('BAD_REQUEST', 'use the status action to change a status; it is audited separately')
  const clean = validateRecordData(def, patch, { partial: true })
  const data = { ...dataOf(def, before), ...clean }
  const after = writeBack(db, def, before, {
    data, project: project ?? before.project, owner: owner ?? before.owner, status: before.status, actor: by, model, now,
  })
  appendAudit(db, def, { record_id: before.id, action: 'update', actor: by, model, agent, before, after, now, detail: { fields: Object.keys(clean) } })
  return after
}

/** Move a record along its own pipeline. Validates the type's status enum and transitions. */
export function setRecordStatus(db, def, id, { status, actor, model = null, agent = null, now, reason = '' } = {}) {
  const by = who(actor, { model, agent })
  const before = requireRecord(db, def, id)
  if (before.deleted_at) recordFail('CONFLICT', `${def.type} ${id} is deleted`)
  if (!def.statuses.includes(status)) recordFail('BAD_REQUEST', `${def.type} status must be one of ${def.statuses.join(', ')}`)
  if (status !== before.status) {
    if (def.terminal.includes(before.status)) recordFail('CONFLICT', `${def.type} ${id} is ${before.status}, a final status`)
    const allowed = def.transitions?.[before.status]
    if (allowed && !allowed.includes(status)) recordFail('CONFLICT', `${def.type} cannot go ${before.status} -> ${status} (allowed: ${allowed.join(', ') || 'none'})`)
  }
  const after = writeBack(db, def, before, { data: dataOf(def, before), project: before.project, owner: before.owner, status, actor: by, model, now })
  appendAudit(db, def, {
    record_id: before.id, action: 'status_change', actor: by, model, agent, now,
    before: { status: before.status }, after: { status }, detail: { reason: String(reason ?? '') },
  })
  return after
}

/** Append a note to a notes field. Notes are append-only and each one is audited. */
export function addNote(db, def, id, { field = 'notes', text, actor, model = null, agent = null, now } = {}) {
  const by = who(actor, { model, agent })
  const spec = def.fields[field]
  if (spec?.type !== 'notes') recordFail('BAD_REQUEST', `${def.type} has no notes field ${field}`)
  if (!nonEmpty(text)) recordFail('BAD_REQUEST', 'note text required')
  if (text.length > 20000) recordFail('BAD_REQUEST', 'note is longer than 20000 characters')
  const before = requireRecord(db, def, id)
  const at = iso(now)
  const note = { at, actor: by, model: model ? String(model) : null, text: text.trim() }
  const data = dataOf(def, before)
  data[field] = [...(Array.isArray(before[field]) ? before[field] : []), note]
  const after = writeBack(db, def, before, { data, project: before.project, owner: before.owner, status: before.status, actor: by, model, now: at })
  appendAudit(db, def, { record_id: before.id, action: 'note', actor: by, model, agent, now: at, before: null, after: note })
  return after
}

/** The tags field named, checked. A type may declare several; 'tags' is the usual one. */
function tagsField(def, field) {
  const spec = def.fields[field]
  if (spec?.type !== 'tags') recordFail('BAD_REQUEST', `${def.type} has no tags field ${field}`)
  return spec
}

function normalizeTags(list, where) {
  if (!Array.isArray(list)) recordFail('BAD_REQUEST', `${where} must be a list of tags`)
  const out = []
  for (const t of list) {
    if (!nonEmpty(t)) recordFail('BAD_REQUEST', `${where} must be a list of non-empty tags`)
    const v = t.trim().toLowerCase()
    if (!out.includes(v)) out.push(v)
  }
  return out
}

/**
 * Tag a record: its own audited action, so a `tag` grant is an operation and not just a label.
 * add / remove / set reach ONLY a tags field - no other field of the record can be touched
 * here, which is what makes a tag-only grant safe to hand to an agent. Writing any other
 * field is still updateRecord, and still needs `update`.
 */
export function setTags(db, def, id, { field = 'tags', add = [], remove = [], set = null, actor, model = null, agent = null, now } = {}) {
  const by = who(actor, { model, agent })
  const spec = tagsField(def, field)
  const where = `${def.type}.${field}`
  const added = normalizeTags(add ?? [], where)
  const removed = normalizeTags(remove ?? [], where)
  if (set != null && (added.length || removed.length)) recordFail('BAD_REQUEST', 'set replaces the whole list: do not pass add or remove with it')
  if (set == null && !added.length && !removed.length) recordFail('BAD_REQUEST', 'nothing to do: pass add, remove or set')
  const before = requireRecord(db, def, id)
  if (before.deleted_at) recordFail('CONFLICT', `${def.type} ${id} is deleted`)
  const have = Array.isArray(before[field]) ? before[field] : []
  const next = set != null
    ? normalizeTags(set, where)
    : [...have.filter((t) => !removed.includes(t)), ...added.filter((t) => !have.includes(t))]
  const max = spec.max ?? 50
  if (next.length > max) recordFail('BAD_REQUEST', `${where} holds more than ${max} tags`)
  // nothing actually changed: no revision, no audit entry - the log stays a log of changes
  if (next.length === have.length && next.every((t, i) => t === have[i])) return before
  const data = dataOf(def, before)
  data[field] = next
  const after = writeBack(db, def, before, { data, project: before.project, owner: before.owner, status: before.status, actor: by, model, now })
  appendAudit(db, def, {
    record_id: before.id, action: 'tag', actor: by, model, agent, now,
    before: { [field]: have }, after: { [field]: next },
    detail: { field, added: next.filter((t) => !have.includes(t)), removed: have.filter((t) => !next.includes(t)) },
  })
  return after
}

// ---------------------------------------------------------------- duplicate suggestions

/** One dedupe key's value for one record, or '' when the record cannot key on it. */
function dedupeValue(normalize, parts) {
  const joined = parts.join(' ').trim().toLowerCase()
  if (!joined) return ''
  if (normalize === 'digits') {
    const digits = joined.replace(/\D+/g, '')
    return digits.length >= 7 ? digits : '' // too few digits to call two records the same person
  }
  if (normalize === 'email') return joined.replace(/\s+/g, '')
  return joined.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

/**
 * Suggest duplicates within ONE record type. Read-only: it proposes, it never merges.
 * An agent holding dedupe_suggest can run this as often as it likes and propose merges; it
 * cannot act on them, because merging records is an update and this grant is not that.
 * Every run writes a dedupe_suggest audit entry, so the log says who asked and what came back.
 */
export function dedupeSuggestions(db, def, { project, record_id = null, limit = 50, actor, model = null, agent = null, now } = {}) {
  const by = who(actor, { model, agent })
  if (!def.dedupe.length) recordFail('BAD_REQUEST', `${def.type} declares no dedupe keys`)
  const anchor = nonEmpty(record_id) ? requireRecord(db, def, record_id) : null
  const scope = anchor ? String(anchor.project ?? '') : (nonEmpty(project) ? project.trim() : undefined)
  const rows = listRecords(db, def, { project: scope, limit: 2000 })
  const groups = []
  for (const key of def.dedupe) {
    const buckets = new Map()
    for (const r of rows) {
      const parts = key.fields.map((f) => (r[f] == null ? '' : String(r[f])))
      if (parts.some((p) => !p.trim())) continue // a key is only as good as its whole value
      const value = dedupeValue(key.normalize, parts)
      if (!value) continue
      if (!buckets.has(value)) buckets.set(value, [])
      buckets.get(value).push(r)
    }
    for (const [value, members] of buckets) {
      if (members.length < 2) continue
      if (anchor && !members.some((m) => m.id === anchor.id)) continue
      groups.push({
        record_type: def.type, key: key.key, label: key.label, value,
        project: String(members[0].project ?? ''),
        record_ids: members.map((m) => m.id),
        records: members.map((m) => ({ id: m.id, status: m.status, owner: m.owner, project: String(m.project ?? ''), updated_at: m.updated_at })),
      })
    }
  }
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500)
  const out = groups.slice(0, n)
  appendAudit(db, def, {
    record_id: anchor?.id ?? '-', action: 'dedupe_suggest', actor: by, model, agent, now,
    after: { groups: out.length },
    detail: { project: scope ?? '', record_id: anchor?.id ?? null, keys: def.dedupe.map((k) => k.key), suggested: out.map((g) => g.record_ids) },
  })
  return { record_type: def.type, project: scope ?? '', scanned: rows.length, keys: def.dedupe.map((k) => k.key), groups: out }
}

/**
 * Cross-link a record to a record of another type. LINK ONLY: nothing is copied or converted,
 * and the target type's own permissions still govern the target.
 */
export function linkRecord(db, def, id, { field, targetId, actor, model = null, agent = null, now, detail = {} } = {}) {
  const by = who(actor, { model, agent })
  const spec = def.fields[field]
  if (spec?.type !== 'links') recordFail('BAD_REQUEST', `${def.type} has no links field ${field}`)
  const target = requireRecordType(spec.linkTo)
  if (!isIdOf(target, targetId)) recordFail('BAD_REQUEST', `${field} only takes ${target.type} ids (${target.idPrefix}-...)`)
  if (!getRecord(db, target, targetId)) recordFail('NOT_FOUND', `no ${target.type} ${targetId}`)
  const before = requireRecord(db, def, id)
  const have = Array.isArray(before[field]) ? before[field] : []
  if (have.includes(targetId)) return before
  const data = dataOf(def, before)
  data[field] = [...have, targetId]
  const after = writeBack(db, def, before, { data, project: before.project, owner: before.owner, status: before.status, actor: by, model, now })
  appendAudit(db, def, { record_id: before.id, action: 'link', actor: by, model, agent, now, before: { [field]: have }, after: { [field]: data[field] }, detail: { ...detail, links_to: target.type, target_id: targetId } })
  return after
}

export function unlinkRecord(db, def, id, { field, targetId, actor, model = null, agent = null, now, detail = {} } = {}) {
  const by = who(actor, { model, agent })
  const spec = def.fields[field]
  if (spec?.type !== 'links') recordFail('BAD_REQUEST', `${def.type} has no links field ${field}`)
  const before = requireRecord(db, def, id)
  const have = Array.isArray(before[field]) ? before[field] : []
  if (!have.includes(targetId)) return before
  const data = dataOf(def, before)
  data[field] = have.filter((x) => x !== targetId)
  const after = writeBack(db, def, before, { data, project: before.project, owner: before.owner, status: before.status, actor: by, model, now })
  appendAudit(db, def, { record_id: before.id, action: 'unlink', actor: by, model, agent, now, before: { [field]: have }, after: { [field]: data[field] }, detail: { ...detail, target_id: targetId } })
  return after
}

/** Soft delete. The row and its audit stay; nothing is erased. */
export function deleteRecord(db, def, id, { actor, model = null, agent = null, now, reason = '' } = {}) {
  const by = who(actor, { model, agent })
  const before = requireRecord(db, def, id)
  if (before.deleted_at) return before
  const at = iso(now)
  db.prepare(`UPDATE ${def.table} SET deleted_at = ?, deleted_by = ?, rev = rev + 1, updated_at = ?, updated_by = ?, updated_model = ? WHERE id = ?`)
    .run(at, by, at, by, model ? String(model) : null, before.id)
  const after = getRecord(db, def, before.id)
  appendAudit(db, def, { record_id: before.id, action: 'delete', actor: by, model, agent, now: at, before, after, detail: { reason: String(reason ?? '') } })
  return after
}

/**
 * Take records out of pm. The gate layer is what demands a human approval first; this
 * function records what left, for whom and under which approval.
 */
export function exportRecords(db, def, { ids, actor, model = null, agent = null, now, destination = '', approval_id = null } = {}) {
  const by = who(actor, { model, agent })
  if (!Array.isArray(ids) || !ids.length || !ids.every(nonEmpty)) recordFail('BAD_REQUEST', 'ids must be a non-empty list of record ids')
  const at = iso(now)
  const rows = ids.map((id) => requireRecord(db, def, id))
  for (const r of rows) {
    appendAudit(db, def, {
      record_id: r.id, action: 'export', actor: by, model, agent, now: at, before: null, after: r,
      detail: { destination: String(destination ?? ''), approval_id: approval_id ? String(approval_id) : null, count: rows.length },
    })
  }
  return { record_type: def.type, at, destination: String(destination ?? ''), approval_id, records: rows }
}
