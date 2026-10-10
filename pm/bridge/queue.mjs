// Bridge queue: crash-safe message store with dedupe, fenced leases, retry with
// backoff, dead-letter, and a replay cursor (seq). Separate SQLite file from
// pm.db so the bridge can never corrupt pm's task state.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { BridgeError, normalizeEnvelope, toEnvelope } from './protocol.mjs'
import { loadPolicy, isTracked, DEADLINE_TYPES } from './delivery.mjs'

export function defaultBridgeDb() {
  return process.env.BRIDGE_DB || join(homedir(), '.claude', 'pm-data', 'bridge.db')
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bridge_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, dedupe_key TEXT NOT NULL UNIQUE, v INTEGER NOT NULL, type TEXT NOT NULL,
  from_machine TEXT NOT NULL, from_agent TEXT NOT NULL, to_machine TEXT NOT NULL, to_agent TEXT NOT NULL,
  correlation_id TEXT, reply_to TEXT, project TEXT, task TEXT, session TEXT,
  body TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 20, next_at TEXT, lease_owner TEXT, lease_until TEXT,
  fence INTEGER NOT NULL DEFAULT 0, last_error TEXT, principal TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT);
CREATE INDEX IF NOT EXISTS bm_state ON bridge_messages(state, to_machine, to_agent, next_at);
CREATE INDEX IF NOT EXISTS bm_corr ON bridge_messages(correlation_id);
CREATE TABLE IF NOT EXISTS bridge_files (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL, rel_path TEXT, final_path TEXT,
  size INTEGER NOT NULL, received INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL, dest_sha256 TEXT,
  mime TEXT, version INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL,
  from_machine TEXT, principal TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS bridge_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, principal TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT, outcome TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS bridge_cursors (
  agent TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0, acked_by TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bridge_presence (
  agent TEXT PRIMARY KEY, principal TEXT, last_seen_at TEXT NOT NULL, last_connect_at TEXT);
`

// Delivery tracking, added beside `state` (see DELIVERY_STATES in protocol.mjs).
// Rows stored before these columns existed keep track = 0 and never go overdue.
const DELIVERY_COLUMNS = {
  priority: "TEXT NOT NULL DEFAULT 'normal'", expects_response: 'INTEGER NOT NULL DEFAULT 0', track: 'INTEGER NOT NULL DEFAULT 0',
  delivered_at: 'TEXT', delivered_by: 'TEXT', acked_at: 'TEXT', acked_by: 'TEXT', responded_at: 'TEXT', response_id: 'TEXT',
  ack_due_at: 'TEXT', response_due_at: 'TEXT', escalations: 'INTEGER NOT NULL DEFAULT 0', escalated_at: 'TEXT',
  delivery_failed: 'INTEGER NOT NULL DEFAULT 0',
}
const LIVE = "state NOT IN ('dead', 'cancelled')"

export function openQueue(path = defaultBridgeDb(), { machine, aliases = [machine], clock = () => new Date(), policy = loadPolicy } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)
  const have = new Set(db.prepare('PRAGMA table_info(bridge_messages)').all().map((c) => c.name))
  for (const [col, type] of Object.entries(DELIVERY_COLUMNS)) if (!have.has(col)) db.exec(`ALTER TABLE bridge_messages ADD COLUMN ${col} ${type}`)
  db.exec('CREATE INDEX IF NOT EXISTS bm_track ON bridge_messages(track, to_agent, acked_at, seq)')
  const now = () => clock().toISOString()
  const mine = new Set(aliases)
  const bootId = randomUUID().slice(0, 8)
  const owner = `${machine}:${process.pid}:${bootId}`

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  const get = (id) => db.prepare('SELECT * FROM bridge_messages WHERE id = ?').get(id)
  const must = (id) => {
    const row = get(id)
    if (!row) throw new BridgeError(404, `no message ${id}`)
    return row
  }

  function audit(principal, action, target, outcome, detail = {}) {
    db.prepare('INSERT INTO bridge_audit (at, principal, action, target, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(now(), principal || 'unknown', action, target ?? null, outcome, JSON.stringify(detail))
  }

  /**
   * Store an envelope. Idempotent: the same id or dedupe_key returns the stored
   * message with `duplicate: true` and changes nothing.
   */
  function enqueue(input, { principal = 'local', maxAttempts } = {}) {
    const e = normalizeEnvelope(input, { self: machine, now: clock() })
    return tx(() => {
      const existing = db.prepare('SELECT * FROM bridge_messages WHERE id = ? OR dedupe_key = ?').get(e.id, e.dedupe_key)
      if (existing) return { ...toEnvelope(existing), duplicate: true }
      const state = mine.has(e.to_machine) ? 'queued' : 'outbox'
      const t = now()
      // Delivery is tracked where the message lands (its target machine), for mailbox agents only.
      const track = state === 'queued' && isTracked(e.to_agent, e.type) ? 1 : 0
      const p = track ? policy() : null
      const after = (s) => new Date(clock().getTime() + s * 1000).toISOString()
      const ackDue = track && DEADLINE_TYPES.includes(e.type) ? after(p.ack_timeout_seconds) : null
      const responseDue = track && e.expects_response ? after(p.response_timeout_seconds) : null
      db.prepare(`INSERT INTO bridge_messages (id, dedupe_key, v, type, from_machine, from_agent, to_machine, to_agent,
        correlation_id, reply_to, project, task, session, body, state, max_attempts, next_at, principal, created_at, updated_at, expires_at,
        priority, expects_response, track, ack_due_at, response_due_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        e.id, e.dedupe_key, e.v, e.type, e.from_machine, e.from_agent, e.to_machine, e.to_agent,
        e.correlation_id, e.reply_to, e.project, e.task, e.session, e.body, state, maxAttempts ?? 20, t, principal, e.created_at, t, e.expires_at,
        e.priority, e.expects_response ? 1 : 0, track, ackDue, responseDue)
      // A reply from the original recipient marks the original responded (it was evidently read).
      if (e.reply_to) {
        const r = db.prepare(`UPDATE bridge_messages SET responded_at = ?, response_id = ?, delivered_at = COALESCE(delivered_at, ?),
          delivered_by = COALESCE(delivered_by, ?), updated_at = ? WHERE id = ? AND to_agent = ? AND responded_at IS NULL`)
          .run(t, e.id, t, e.from_agent, t, e.reply_to, e.from_agent)
        if (r.changes) audit(principal, 'message.responded', e.reply_to, 'ok', { response_id: e.id, by: e.from_agent })
      }
      return { ...toEnvelope(get(e.id)), duplicate: false }
    })
  }

  /** Lease the next due message for one of `agents` on this machine. Fence increments on every lease. */
  function lease(agents, { seconds = 60, types } = {}) {
    if (!agents.length) return null
    return tx(() => {
      const t = now()
      const marks = agents.map(() => '?').join(',')
      const typeSql = types?.length ? ` AND type IN (${types.map(() => '?').join(',')})` : ''
      const row = db.prepare(`SELECT * FROM bridge_messages WHERE state = 'queued' AND to_agent IN (${marks})${typeSql}
        AND (next_at IS NULL OR next_at <= ?) ORDER BY seq LIMIT 1`).get(...agents, ...(types ?? []), t)
      if (!row || !mine.has(row.to_machine)) return null
      const until = new Date(clock().getTime() + seconds * 1000).toISOString()
      db.prepare(`UPDATE bridge_messages SET state = 'leased', lease_owner = ?, lease_until = ?, fence = fence + 1,
        attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(owner, until, t, row.id)
      return { ...toEnvelope(get(row.id)), fence: row.fence + 1 }
    })
  }

  function checkFence(row, fence) {
    if (row.state !== 'leased' || row.fence !== fence) {
      throw new BridgeError(409, `stale fence ${fence} for ${row.id} (state ${row.state}, fence ${row.fence})`)
    }
  }

  function extend(id, fence, seconds = 60) {
    return tx(() => {
      checkFence(must(id), fence)
      const until = new Date(clock().getTime() + seconds * 1000).toISOString()
      db.prepare('UPDATE bridge_messages SET lease_until = ?, updated_at = ? WHERE id = ?').run(until, now(), id)
      return until
    })
  }

  /** Finish a leased message. outcome: done | cancelled | retry | dead. Stale fence = 409. */
  function settle(id, fence, outcome, error = null) {
    return tx(() => {
      const row = must(id)
      checkFence(row, fence)
      let state = outcome
      let next = null
      if (outcome === 'retry') {
        if (row.attempts >= row.max_attempts) state = 'dead'
        else {
          state = 'queued'
          next = new Date(clock().getTime() + backoffMs(row.attempts)).toISOString()
        }
      }
      db.prepare(`UPDATE bridge_messages SET state = ?, next_at = ?, lease_owner = NULL, lease_until = NULL,
        last_error = ?, updated_at = ? WHERE id = ?`).run(state, next, error, now(), id)
      return toEnvelope(get(id))
    })
  }

  /** Mark one mailbox message read and acknowledged (legacy single-id form). */
  function ack(id, by = 'unknown') {
    return tx(() => {
      const row = must(id)
      if (!['queued', 'done'].includes(row.state)) throw new BridgeError(409, `cannot ack ${id} in state ${row.state}`)
      const t = now()
      db.prepare(`UPDATE bridge_messages SET state = 'done', acked_at = COALESCE(acked_at, ?), acked_by = COALESCE(acked_by, ?),
        delivered_at = COALESCE(delivered_at, ?), delivered_by = COALESCE(delivered_by, ?), updated_at = ? WHERE id = ?`).run(t, by, t, by, t, id)
      if (row.track) advanceCursor(row.to_agent, by)
      return toEnvelope(get(id))
    })
  }

  // ---- mailbox delivery ------------------------------------------------------
  const here = [...mine]
  const hereSql = here.map(() => '?').join(',')

  /** Cursor = highest seq below which every tracked message for `agent` is acknowledged. Call inside tx. */
  function advanceCursor(agent, by) {
    const low = db.prepare(`SELECT MIN(seq) AS s FROM bridge_messages WHERE track = 1 AND to_agent = ? AND to_machine IN (${hereSql})
      AND acked_at IS NULL AND ${LIVE}`).get(agent, ...here).s
    const high = db.prepare(`SELECT MAX(seq) AS s FROM bridge_messages WHERE track = 1 AND to_agent = ? AND to_machine IN (${hereSql})`).get(agent, ...here).s
    const cursor = low != null ? Number(low) - 1 : Number(high ?? 0)
    db.prepare(`INSERT INTO bridge_cursors (agent, cursor, acked_by, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(agent) DO UPDATE SET cursor = excluded.cursor, acked_by = excluded.acked_by, updated_at = excluded.updated_at`).run(agent, cursor, by, now())
    return cursor
  }

  /**
   * Unacknowledged mailbox messages for `agent`, oldest first. Nothing is dropped
   * or skipped until it is acknowledged, so a reader that crashes reads them again.
   * `after` pages through one batch; `deliveredBy` (the recipient) stamps delivered_at.
   */
  function inbox(agent, { after = 0, limit = 50, deliveredBy = null } = {}) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 500)
    return tx(() => {
      const rows = db.prepare(`SELECT * FROM bridge_messages WHERE track = 1 AND to_agent = ? AND to_machine IN (${hereSql})
        AND acked_at IS NULL AND ${LIVE} AND seq > ? ORDER BY seq LIMIT ?`).all(agent, ...here, Number(after) || 0, n)
      if (deliveredBy && rows.length) {
        const t = now()
        const mark = db.prepare('UPDATE bridge_messages SET delivered_at = ?, delivered_by = ?, updated_at = ? WHERE id = ? AND delivered_at IS NULL')
        for (const r of rows) mark.run(t, deliveredBy, t, r.id)
      }
      return rows.map((r) => toEnvelope(get(r.id)))
    })
  }

  /** Mark delivered (retrieved by the recipient) without acknowledging. */
  function markDelivered(ids, by) {
    if (!ids.length) return 0
    const t = now()
    const mark = db.prepare('UPDATE bridge_messages SET delivered_at = ?, delivered_by = ?, updated_at = ? WHERE id = ? AND track = 1 AND delivered_at IS NULL')
    return tx(() => ids.reduce((n, id) => n + Number(mark.run(t, by, t, id).changes), 0))
  }

  /**
   * Acknowledge for `agent`: explicit ids and/or everything up to seq `up_to`.
   * Refuses ids addressed to another agent. Idempotent: re-acking changes nothing.
   */
  function ackFor(agent, { ids = [], up_to } = {}, by = agent) {
    return tx(() => {
      const t = now()
      const acked = []
      const already = []
      const targets = new Map()
      for (const id of ids) {
        const row = get(id)
        if (!row) throw new BridgeError(404, `no message ${id}`)
        if (row.to_agent !== agent) throw new BridgeError(403, `message ${id} is addressed to ${row.to_agent}, not ${agent}`)
        targets.set(id, row)
      }
      if (up_to !== undefined && up_to !== null) {
        for (const row of db.prepare(`SELECT * FROM bridge_messages WHERE track = 1 AND to_agent = ? AND to_machine IN (${hereSql})
          AND seq <= ? AND acked_at IS NULL AND ${LIVE}`).all(agent, ...here, Number(up_to) || 0)) targets.set(row.id, row)
      }
      const set = db.prepare(`UPDATE bridge_messages SET acked_at = ?, acked_by = ?, delivered_at = COALESCE(delivered_at, ?),
        delivered_by = COALESCE(delivered_by, ?), state = CASE WHEN state = 'queued' THEN 'done' ELSE state END, updated_at = ? WHERE id = ?`)
      for (const [id, row] of targets) {
        if (row.acked_at) { already.push(id); continue }
        set.run(t, by, t, by, t, id)
        acked.push(id)
      }
      if (acked.length) audit(by, 'message.ack', agent, 'ok', { ids: acked.slice(0, 50), count: acked.length })
      return { agent, acked, already, cursor: advanceCursor(agent, by) }
    })
  }

  /** Pending summary for one agent, or every agent with tracked mail. */
  function pending(agent = null) {
    const t = now()
    const where = `track = 1 AND to_machine IN (${hereSql}) AND acked_at IS NULL AND ${LIVE}${agent ? ' AND to_agent = ?' : ''}`
    const args = agent ? [...here, agent] : here
    const rows = db.prepare(`SELECT to_agent AS agent, COUNT(*) AS unacked,
        SUM(CASE WHEN delivered_at IS NULL THEN 1 ELSE 0 END) AS undelivered,
        SUM(CASE WHEN ack_due_at IS NOT NULL AND ack_due_at <= ? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) AS high,
        SUM(delivery_failed) AS failed, MIN(seq) AS oldest_seq, MIN(created_at) AS oldest_at, MAX(seq) AS last_seq
      FROM bridge_messages WHERE ${where} GROUP BY to_agent ORDER BY to_agent`).all(t, ...args)
    const awaiting = db.prepare(`SELECT to_agent AS agent, COUNT(*) AS n FROM bridge_messages WHERE track = 1 AND to_machine IN (${hereSql})
      AND expects_response = 1 AND responded_at IS NULL AND ${LIVE}${agent ? ' AND to_agent = ?' : ''} GROUP BY to_agent`).all(...args)
    const cursors = Object.fromEntries(db.prepare('SELECT * FROM bridge_cursors').all().map((c) => [c.agent, Number(c.cursor)]))
    const seen = Object.fromEntries(presence().map((p) => [p.agent, p]))
    const out = Object.fromEntries(rows.map((r) => [r.agent, {
      unacked: Number(r.unacked), undelivered: Number(r.undelivered), overdue: Number(r.overdue), high: Number(r.high), failed: Number(r.failed),
      oldest_seq: Number(r.oldest_seq), oldest_at: r.oldest_at, last_seq: Number(r.last_seq),
    }]))
    for (const a of awaiting) (out[a.agent] ??= { unacked: 0 }).awaiting_response = Number(a.n)
    for (const [a, v] of Object.entries(out)) Object.assign(v, { cursor: cursors[a] ?? 0, last_seen_at: seen[a]?.last_seen_at ?? null, last_connect_at: seen[a]?.last_connect_at ?? null })
    return agent ? (out[agent] ?? { unacked: 0, cursor: cursors[agent] ?? 0, last_seen_at: seen[agent]?.last_seen_at ?? null }) : out
  }

  /** Record that an agent's client called in (connect = an MCP initialize). */
  function touch(agent, principal, { connect = false } = {}) {
    const t = now()
    db.prepare(`INSERT INTO bridge_presence (agent, principal, last_seen_at, last_connect_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(agent) DO UPDATE SET principal = excluded.principal, last_seen_at = excluded.last_seen_at,
      last_connect_at = COALESCE(excluded.last_connect_at, bridge_presence.last_connect_at)`).run(agent, principal, t, connect ? t : null)
  }
  const presence = () => db.prepare('SELECT * FROM bridge_presence ORDER BY agent').all().map((r) => ({ ...r }))

  /**
   * Overdue tracked messages: unacknowledged past ack_due_at, or acknowledged but
   * unanswered past response_due_at. Each gets at most max_escalations escalations,
   * spaced by escalation_backoff_seconds; after the last one it is marked failed.
   * Returns the escalations to raise ({ kind: 'ack'|'response'|'failed', message }).
   */
  function sweepOverdue(p = policy()) {
    return tx(() => {
      const t = now()
      const tm = clock().getTime()
      const rows = db.prepare(`SELECT * FROM bridge_messages WHERE track = 1 AND to_machine IN (${hereSql}) AND responded_at IS NULL
        AND delivery_failed = 0 AND ${LIVE} AND ((acked_at IS NULL AND ack_due_at <= ?) OR (acked_at IS NOT NULL AND response_due_at <= ?))
        ORDER BY seq LIMIT 200`).all(...here, t, t)
      const out = []
      const backoff = p.escalation_backoff_seconds
      for (const row of rows) {
        const kind = row.acked_at ? 'response' : 'ack'
        const n = Number(row.escalations)
        if (n > 0 && tm - new Date(row.escalated_at).getTime() < backoff[Math.min(n - 1, backoff.length - 1)] * 1000) continue
        if (n >= p.max_escalations) {
          const error = `no ${kind} after ${n} escalation(s)`
          db.prepare('UPDATE bridge_messages SET delivery_failed = 1, last_error = ?, updated_at = ? WHERE id = ?').run(error, t, row.id)
          audit('dsh-bridge', 'message.delivery_failed', row.id, 'failed', { kind, escalations: n, to: row.to_agent })
          out.push({ kind: 'failed', reason: kind, message: toEnvelope(get(row.id)) })
          continue
        }
        db.prepare('UPDATE bridge_messages SET escalations = escalations + 1, escalated_at = ?, updated_at = ? WHERE id = ?').run(t, t, row.id)
        audit('dsh-bridge', 'message.escalated', row.id, 'overdue', { kind, escalation: n + 1, to: row.to_agent, priority: row.priority })
        out.push({ kind, message: toEnvelope(get(row.id)) })
      }
      return out
    })
  }

  function setState(id, from, to, error = null) {
    return tx(() => {
      const row = must(id)
      if (!from.includes(row.state)) throw new BridgeError(409, `${id} is ${row.state}, expected ${from.join('|')}`)
      db.prepare('UPDATE bridge_messages SET state = ?, last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?')
        .run(to, error, now(), id)
      return toEnvelope(get(id))
    })
  }

  /**
   * Expired leases. Retry-safe agents go back to the queue; everything else
   * becomes `uncertain` so a lost execution is never silently re-run (and re-billed).
   * Also called at boot with `all: true` for leases a previous process held.
   */
  function reconcile({ retrySafe = new Set(), all = false } = {}) {
    return tx(() => {
      const t = now()
      const rows = db.prepare(`SELECT * FROM bridge_messages WHERE state = 'leased' AND (lease_until <= ? OR (? AND lease_owner != ?))`)
        .all(t, all ? 1 : 0, owner)
      const out = []
      for (const row of rows) {
        const state = retrySafe.has(row.to_agent) ? (row.attempts >= row.max_attempts ? 'dead' : 'queued') : 'uncertain'
        db.prepare(`UPDATE bridge_messages SET state = ?, lease_owner = NULL, lease_until = NULL, next_at = ?,
          last_error = ?, updated_at = ? WHERE id = ?`).run(state, t, `lease lost (owner ${row.lease_owner})`, t, row.id)
        out.push({ id: row.id, state })
      }
      const expired = db.prepare(`UPDATE bridge_messages SET state = 'dead', last_error = 'expired', updated_at = ?
        WHERE expires_at IS NOT NULL AND expires_at <= ? AND state IN ('queued', 'outbox', 'held')`).run(t, t)
      if (expired.changes) out.push({ expired: Number(expired.changes) })
      return out
    })
  }

  /** Outbox rows due for forwarding. */
  function due(limit = 50) {
    return db.prepare(`SELECT * FROM bridge_messages WHERE state = 'outbox' AND (next_at IS NULL OR next_at <= ?) ORDER BY seq LIMIT ?`)
      .all(now(), limit).map(toEnvelope)
  }

  function forwardResult(id, ok, error = null) {
    return tx(() => {
      const row = must(id)
      if (row.state !== 'outbox') return toEnvelope(row)
      const attempts = row.attempts + 1
      let state = 'outbox'
      let next = null
      if (ok) state = 'forwarded'
      else if (attempts >= row.max_attempts) state = 'dead'
      else next = new Date(clock().getTime() + backoffMs(attempts)).toISOString()
      db.prepare('UPDATE bridge_messages SET state = ?, attempts = ?, next_at = ?, last_error = ?, updated_at = ? WHERE id = ?')
        .run(state, attempts, next, error, now(), id)
      return toEnvelope(get(id))
    })
  }

  function list({ after = 0, agent, machine, correlation, state, limit = 100 } = {}) {
    const where = ['seq > ?']
    const args = [Number(after) || 0]
    if (agent) { where.push('to_agent = ?'); args.push(agent) }
    if (machine) { where.push('to_machine = ?'); args.push(machine) }
    if (correlation) { where.push('(correlation_id = ? OR id = ?)'); args.push(correlation, correlation) }
    if (state) { where.push('state = ?'); args.push(state) }
    args.push(Math.min(Number(limit) || 100, 500))
    return db.prepare(`SELECT * FROM bridge_messages WHERE ${where.join(' AND ')} ORDER BY seq LIMIT ?`).all(...args).map(toEnvelope)
  }

  function stats() {
    const rows = db.prepare('SELECT state, COUNT(*) AS n FROM bridge_messages GROUP BY state').all()
    return Object.fromEntries(rows.map((r) => [r.state, Number(r.n)]))
  }

  function requeueDead(id) {
    return tx(() => {
      const row = must(id)
      if (!['dead', 'uncertain'].includes(row.state)) throw new BridgeError(409, `${id} is ${row.state}, not dead/uncertain`)
      const state = mine.has(row.to_machine) ? 'queued' : 'outbox'
      db.prepare('UPDATE bridge_messages SET state = ?, attempts = 0, next_at = ?, updated_at = ? WHERE id = ?').run(state, now(), now(), id)
      return toEnvelope(get(id))
    })
  }

  return {
    db, machine, owner, path, now, tx, audit, enqueue, lease, extend, settle, ack, setState, reconcile, due,
    inbox, markDelivered, ackFor, pending, touch, presence, sweepOverdue, policy,
    forwardResult, list, stats, requeueDead, get: (id) => toEnvelope(must(id)), isMine: (m) => mine.has(m),
    close: () => db.close(),
  }
}

export function backoffMs(attempt) {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 60_000)
}
