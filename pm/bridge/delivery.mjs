// Delivery policy for mailbox messages: who may acknowledge for an agent, and the
// admin-changeable timeouts that drive overdue detection and escalation.
//
// ~/.claude/pm-data/bridge-policy.json (outside git, optional; missing keys use defaults):
//   { "ack_timeout_seconds": 300, "response_timeout_seconds": 1800,
//     "escalation_backoff_seconds": [300, 900, 1800], "max_escalations": 3,
//     "escalate_to": [ { "agent": "claude-code" } ] }
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { BridgeError } from './protocol.mjs'

export const DEFAULT_POLICY = Object.freeze({
  ack_timeout_seconds: 300,
  response_timeout_seconds: 1800,
  escalation_backoff_seconds: [300, 900, 1800],
  max_escalations: 3,
  escalate_to: [],
})

/** Messages these agents handle themselves are not mailbox messages and are never tracked. */
export const HANDLED = { node: null, 'claude-code': ['submit', 'cancel', 'pause', 'resume'] }
/** Only these types get an ack deadline; accept/progress/log are informational. */
export const DEADLINE_TYPES = ['message', 'submit', 'result', 'error']

export function isTracked(toAgent, type) {
  if (!(toAgent in HANDLED)) return true
  const types = HANDLED[toAgent]
  return types !== null && !types.includes(type)
}

export function policyFile() {
  return process.env.BRIDGE_POLICY || join(homedir(), '.claude', 'pm-data', 'bridge-policy.json')
}

export function loadPolicy(file = policyFile()) {
  try {
    return { ...DEFAULT_POLICY, ...(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) }
  } catch {
    return { ...DEFAULT_POLICY }
  }
}

const positive = (v, field) => {
  if (!(Number.isFinite(v) && v > 0)) throw new BridgeError(400, `${field} must be a positive number`)
  return v
}

/** Merge validated changes into the stored policy and return the result. */
export function savePolicy(changes = {}, file = policyFile()) {
  const next = loadPolicy(file)
  for (const k of ['ack_timeout_seconds', 'response_timeout_seconds', 'max_escalations']) {
    if (changes[k] !== undefined) next[k] = positive(Number(changes[k]), k)
  }
  if (changes.escalation_backoff_seconds !== undefined) {
    const b = changes.escalation_backoff_seconds
    if (!Array.isArray(b) || !b.length) throw new BridgeError(400, 'escalation_backoff_seconds must be a non-empty array')
    next.escalation_backoff_seconds = b.map((x, i) => positive(Number(x), `escalation_backoff_seconds[${i}]`))
  }
  if (changes.escalate_to !== undefined) {
    if (!Array.isArray(changes.escalate_to) || changes.escalate_to.some((t) => !t || typeof t.agent !== 'string')) {
      throw new BridgeError(400, 'escalate_to must be an array of { agent, machine? }')
    }
    next.escalate_to = changes.escalate_to.map((t) => ({ agent: t.agent, ...(t.machine ? { machine: t.machine } : {}) }))
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2))
  return next
}

/** Only the recipient (or an admin) may mark a message delivered or acknowledged. */
export function canActFor(principal, agent) {
  const agents = principal.agents ?? []
  return agents.includes('*') || agents.includes(agent) || principal.scopes.includes('admin')
}

export function requireActFor(principal, agent) {
  if (!canActFor(principal, agent)) throw new BridgeError(403, `token "${principal.name}" may not acknowledge for agent ${agent}`)
}
