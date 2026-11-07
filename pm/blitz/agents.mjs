// Blitz named agent registry (BLITZ-04, Q3).
//
// A catalogue of named agents the user can pick from. It never picks for them:
// there are no seed rows and no default roster. selectRoster() returns exactly
// the names it is given and refuses an empty or unknown list, so a campaign can
// only run the roster the user chose.
import { DatabaseSync } from 'node:sqlite'
import { PmError } from '../store.mjs'
import { ALIAS_GROUPS, THIS_MACHINE, machineNames } from '../actions.mjs'

export const TRANSPORTS = ['bridge-claude', 'dsh-run', 'codex']
/** Mirrors routingPolicies in deepseek-harness tool-council/src/router/types.ts. */
export const POLICIES = ['TOKEN_EFFICIENT', 'FREE_FIRST', 'SUBSCRIPTION_FIRST', 'PAID_FASTEST', 'LOCAL_FIRST', 'FIXED_ROSTER', 'USER_JOB_PROFILE']
/** Mirrors capabilityLevels in the same file. */
export const LEVELS = ['none', 'low', 'medium', 'high']
export const MAX_CONCURRENT = 16
const NAME = /^[\w][\w .@-]{0,63}$/

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blitz_agents (
  name TEXT PRIMARY KEY, role TEXT NOT NULL, machine TEXT NOT NULL, transport TEXT NOT NULL,
  model_policy TEXT NOT NULL, max_concurrent INTEGER NOT NULL, capabilities TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1, rev INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
`

export function migrate(db) {
  db.exec(SCHEMA)
}

/**
 * The db handle blitz modules write to: the store's own connection when it
 * exposes one, else a second connection on the same WAL file.
 */
export function blitzDb(store) {
  if (store?.db) return store.db
  const db = new DatabaseSync(store?.path && store.path !== ':memory:' ? store.path : ':memory:')
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  return db
}

/** Every machine name pm knows: the alias groups, this host and its extra aliases. */
export function knownMachines() {
  const names = new Set(ALIAS_GROUPS.flat())
  for (const n of machineNames(THIS_MACHINE)) names.add(n)
  for (const n of (process.env.BLITZ_MACHINES || '').split(',').map((x) => x.trim()).filter(Boolean)) names.add(n)
  return names
}

function row(r) {
  if (!r) return null
  return { ...r, enabled: Boolean(r.enabled), model_policy: JSON.parse(r.model_policy), capabilities: JSON.parse(r.capabilities || '{}') }
}

function validPolicy(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new PmError(400, 'model_policy must be an object {policy, allow?, pin?}')
  if (!POLICIES.includes(p.policy)) throw new PmError(400, `model_policy.policy must be one of ${POLICIES.join(', ')}`)
  if (p.allow !== undefined && (!Array.isArray(p.allow) || p.allow.some((x) => typeof x !== 'string' || !x.trim()))) {
    throw new PmError(400, 'model_policy.allow must be a list of model ids or cost classes')
  }
  if (p.pin !== undefined && (typeof p.pin !== 'string' || !p.pin.trim())) throw new PmError(400, 'model_policy.pin must be a model id')
  const out = { policy: p.policy }
  if (p.allow) out.allow = p.allow.map((x) => x.trim())
  if (p.pin) out.pin = p.pin.trim()
  return out
}

function validCapabilities(c = {}) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new PmError(400, 'capabilities must be an object of capability -> level')
  for (const [k, v] of Object.entries(c)) {
    if (!LEVELS.includes(v)) throw new PmError(400, `capability ${k} must be one of ${LEVELS.join(', ')}`)
  }
  return c
}

function validFields(body, machines, partial) {
  const out = {}
  if (!partial || body.role !== undefined) {
    if (typeof body.role !== 'string' || !body.role.trim()) throw new PmError(400, 'role is required')
    out.role = body.role.trim()
  }
  if (!partial || body.machine !== undefined) {
    if (!machines.has(body.machine)) throw new PmError(400, `machine must be one of ${[...machines].join(', ')}`)
    out.machine = body.machine
  }
  if (!partial || body.transport !== undefined) {
    if (!TRANSPORTS.includes(body.transport)) throw new PmError(400, `transport must be one of ${TRANSPORTS.join(', ')}`)
    out.transport = body.transport
  }
  if (!partial || body.model_policy !== undefined) out.model_policy = JSON.stringify(validPolicy(body.model_policy))
  if (!partial || body.max_concurrent !== undefined) {
    const n = body.max_concurrent
    if (!Number.isInteger(n) || n < 1 || n > MAX_CONCURRENT) throw new PmError(400, `max_concurrent must be an integer 1-${MAX_CONCURRENT}`)
    out.max_concurrent = n
  }
  if (body.capabilities !== undefined) out.capabilities = JSON.stringify(validCapabilities(body.capabilities))
  return out
}

function actor(w) {
  if (!w?.actor) throw new PmError(400, 'actor is required (x-pm-actor)')
  return w
}

/**
 * @param db - a node:sqlite handle (see blitzDb)
 * @param opts.store - pm store, for recordEvent; optional
 * @param opts.machines - known machine names; defaults to knownMachines()
 */
export function createAgentRegistry(db, { store = null, clock = () => new Date(), machines } = {}) {
  migrate(db)
  const now = () => clock().toISOString()
  const known = () => machines ?? knownMachines()
  const get = (name) => row(db.prepare('SELECT * FROM blitz_agents WHERE name = ?').get(name))
  const event = (w, name, action, data) => store?.recordEvent?.(w, 'blitz_agent', name, action, data)

  const api = {
    list({ enabled } = {}) {
      const rows = db.prepare('SELECT * FROM blitz_agents ORDER BY name').all().map(row)
      if (enabled === undefined || enabled === '') return rows
      const want = enabled === true || enabled === 'true' || enabled === '1'
      return rows.filter((r) => r.enabled === want)
    },

    get(name) {
      const r = get(name)
      if (!r) throw new PmError(404, `no agent ${name}`)
      return r
    },

    create(w, body = {}) {
      w = actor(w)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!NAME.test(name)) throw new PmError(400, 'name is required: 1-64 chars, letters, digits, space, _ . @ -')
      const f = validFields(body, known(), false)
      if (get(name)) throw new PmError(409, `agent ${name} already exists`)
      const at = now()
      db.prepare(`INSERT INTO blitz_agents (name, role, machine, transport, model_policy, max_concurrent, capabilities, enabled, rev, created_at, created_by, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`)
        .run(name, f.role, f.machine, f.transport, f.model_policy, f.max_concurrent, f.capabilities ?? '{}', at, w.actor, at, w.actor)
      const r = get(name)
      event(w, name, 'created', { role: r.role, machine: r.machine, transport: r.transport })
      return r
    },

    update(w, name, body = {}) {
      w = actor(w)
      const cur = api.get(name)
      if (body.rev === undefined) throw new PmError(400, 'rev is required')
      if (Number(body.rev) !== cur.rev) throw new PmError(409, `stale rev ${body.rev}; current is ${cur.rev}`, { current: cur })
      const f = validFields(body, known(), true)
      if (body.enabled !== undefined) f.enabled = body.enabled ? 1 : 0
      const cols = Object.keys(f)
      if (!cols.length) throw new PmError(400, 'nothing to change')
      const r = db.prepare(`UPDATE blitz_agents SET ${cols.map((c) => `${c} = ?`).join(', ')}, rev = rev + 1, updated_at = ?, updated_by = ? WHERE name = ? AND rev = ?`)
        .run(...cols.map((c) => f[c]), now(), w.actor, name, cur.rev)
      if (r.changes !== 1) throw new PmError(409, 'agent changed concurrently; re-read and retry')
      event(w, name, 'updated', { fields: cols })
      return get(name)
    },

    disable(w, name, { rev } = {}) {
      return api.update(w, name, { rev, enabled: false })
    },

    /** Exactly the agents named, in the order given. Never a default. */
    selectRoster(names) {
      if (!Array.isArray(names) || names.length === 0) throw new PmError(400, 'roster is required: name every agent; there is no default roster')
      if (new Set(names).size !== names.length) throw new PmError(400, 'roster names must be unique')
      return names.map((n) => {
        const r = get(n)
        if (!r) throw new PmError(400, `roster names unknown agent ${n}`)
        if (!r.enabled) throw new PmError(400, `roster names disabled agent ${n}`)
        return r
      })
    },
  }
  return api
}
