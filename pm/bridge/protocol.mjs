// Bridge protocol v1 - the message envelope every node, adapter and client speaks.
// Pure functions only: validation and normalization, no I/O.
import { randomUUID } from 'node:crypto'

export const PROTOCOL_VERSION = 1

export const MESSAGE_TYPES = [
  'message', // free-form directed message
  'ping', // liveness probe, answered by the node agent
  'submit', // ask an executor agent to run a task
  'accept', // executor took the submit
  'status', // status query or status report
  'progress', // incremental output during a run
  'log', // diagnostic line during a run
  'cancel', // stop a submit (correlation_id = the submit id)
  'pause', // hold a queued submit
  'resume', // release a held submit
  'result', // final success output
  'error', // final failure output
  'ack', // final acknowledgment of a result or transfer
]

/** States a stored message moves through. */
export const MESSAGE_STATES = [
  'outbox', // addressed to another machine, waiting for the forwarder
  'forwarded', // the target machine stored it (its id came back)
  'queued', // on its target machine, waiting for a handler or a reader
  'held', // paused before execution
  'leased', // a handler holds it under a fenced lease
  'done', // handled or acknowledged by its reader
  'uncertain', // an execution lease was lost; never auto-retried (could double-bill)
  'cancelled',
  'dead', // retries exhausted or expired
]

/**
 * Delivery states, tracked beside `state` for mailbox messages (agents that pull,
 * such as chatgpt). Storing or forwarding a message never means it was read:
 *   queued -> delivered (the recipient pulled it) -> acknowledged (the recipient
 *   said so explicitly) -> responded (a message with reply_to = its id arrived).
 *   failed = dead/uncertain or still unacknowledged after the last escalation;
 *   expired = its expires_at passed before anyone handled it.
 */
export const DELIVERY_STATES = ['queued', 'forwarded', 'delivered', 'acknowledged', 'responded', 'failed', 'expired']
export const PRIORITIES = ['normal', 'high']

export const MAX_BODY_BYTES = 256 * 1024
const NAME = /^[\w.@:-]{1,80}$/

export class BridgeError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

function name(value, field, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null
    throw new BridgeError(400, `${field} is required`)
  }
  if (typeof value !== 'string' || !NAME.test(value)) throw new BridgeError(400, `${field} must match ${NAME}`)
  return value
}

/**
 * Validate an incoming envelope and fill defaults. Throws BridgeError(400).
 * `self` is this node's machine name, used when `from.machine` / `to.machine` are omitted.
 */
export function normalizeEnvelope(input, { self, now = new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BridgeError(400, 'envelope must be an object')
  const v = input.v ?? PROTOCOL_VERSION
  if (v !== PROTOCOL_VERSION) throw new BridgeError(400, `unsupported protocol version ${v}; this node speaks ${PROTOCOL_VERSION}`)
  if (!MESSAGE_TYPES.includes(input.type)) throw new BridgeError(400, `type must be one of ${MESSAGE_TYPES.join(', ')}`)
  const from = input.from ?? {}
  const to = input.to ?? {}
  const body = input.body ?? {}
  if (typeof body !== 'object' || Array.isArray(body)) throw new BridgeError(400, 'body must be an object')
  const bodyText = JSON.stringify(body)
  if (Buffer.byteLength(bodyText) > MAX_BODY_BYTES) throw new BridgeError(413, `body exceeds ${MAX_BODY_BYTES} bytes`)
  const id = input.id === undefined ? randomUUID() : name(input.id, 'id')
  const ttl = input.ttl_seconds === undefined ? null : Number(input.ttl_seconds)
  if (ttl !== null && !(ttl > 0 && ttl <= 30 * 86400)) throw new BridgeError(400, 'ttl_seconds must be 1..2592000')
  const created = input.created_at ? new Date(input.created_at) : now
  if (Number.isNaN(created.getTime())) throw new BridgeError(400, 'created_at is not a date')
  // A forwarded envelope carries expires_at but no ttl_seconds; keep its expiry.
  let expires = ttl ? new Date(created.getTime() + ttl * 1000) : null
  if (!expires && input.expires_at) {
    expires = new Date(input.expires_at)
    if (Number.isNaN(expires.getTime())) throw new BridgeError(400, 'expires_at is not a date')
  }
  const priority = input.priority ?? 'normal'
  if (!PRIORITIES.includes(priority)) throw new BridgeError(400, `priority must be one of ${PRIORITIES.join(', ')}`)
  return {
    v,
    id,
    dedupe_key: name(input.dedupe_key, 'dedupe_key', { optional: true }) ?? id,
    type: input.type,
    from_machine: name(from.machine ?? self, 'from.machine'),
    from_agent: name(from.agent ?? 'cli', 'from.agent'),
    to_machine: name(to.machine ?? self, 'to.machine'),
    to_agent: name(to.agent, 'to.agent'),
    correlation_id: name(input.correlation_id, 'correlation_id', { optional: true }),
    reply_to: name(input.reply_to, 'reply_to', { optional: true }),
    project: name(input.project, 'project', { optional: true }),
    task: name(input.task, 'task', { optional: true }),
    session: name(input.session, 'session', { optional: true }),
    body: bodyText,
    created_at: created.toISOString(),
    expires_at: expires ? expires.toISOString() : null,
    priority,
    expects_response: input.expects_response === true,
  }
}

const ms = (a, b) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null)

/** Where a stored row stands on the delivery path (see DELIVERY_STATES). */
export function deliveryState(row) {
  if (row.state === 'dead' && row.last_error === 'expired') return 'expired'
  if (row.responded_at) return 'responded'
  if (row.acked_at) return 'acknowledged'
  if (['dead', 'uncertain'].includes(row.state) || row.delivery_failed) return 'failed'
  if (row.delivered_at) return 'delivered'
  if (row.state === 'forwarded') return 'forwarded'
  return 'queued'
}

/** Wire form of a stored row. */
export function toEnvelope(row) {
  if (!row) return row
  return {
    v: row.v,
    seq: row.seq,
    id: row.id,
    dedupe_key: row.dedupe_key,
    type: row.type,
    from: { machine: row.from_machine, agent: row.from_agent },
    to: { machine: row.to_machine, agent: row.to_agent },
    correlation_id: row.correlation_id,
    reply_to: row.reply_to,
    project: row.project,
    task: row.task,
    session: row.session,
    body: JSON.parse(row.body),
    state: row.state,
    attempts: row.attempts,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    priority: row.priority ?? 'normal',
    expects_response: Boolean(row.expects_response),
    delivery: {
      state: deliveryState(row),
      delivered_at: row.delivered_at ?? null, delivered_by: row.delivered_by ?? null,
      acked_at: row.acked_at ?? null, acked_by: row.acked_by ?? null,
      responded_at: row.responded_at ?? null, response_id: row.response_id ?? null,
      ack_due_at: row.ack_due_at ?? null, response_due_at: row.response_due_at ?? null,
      escalations: row.escalations ?? 0, escalated_at: row.escalated_at ?? null,
      latency_ms: { deliver: ms(row.created_at, row.delivered_at), ack: ms(row.created_at, row.acked_at), respond: ms(row.created_at, row.responded_at) },
    },
  }
}

/** Build a reply envelope addressed back to the sender of `msg`. */
export function replyTo(msg, type, body, { agent } = {}) {
  return {
    v: PROTOCOL_VERSION,
    type,
    from: { machine: msg.to.machine, agent: agent ?? msg.to.agent },
    to: { machine: msg.from.machine, agent: msg.from.agent },
    correlation_id: msg.correlation_id ?? msg.id,
    reply_to: msg.id,
    project: msg.project ?? undefined,
    task: msg.task ?? undefined,
    session: msg.session ?? undefined,
    body,
  }
}
