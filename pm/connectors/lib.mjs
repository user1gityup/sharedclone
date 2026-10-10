// Shared helpers for the pm connectors.
//
// Every connector emits, or consumes, one "inventory line" per open item - the
// same JSON shape an agent on another machine can produce by hand:
//
//   {kind, source_ref, title, lifecycle, origin_machine, agent, provider, model_id,
//    checkpoint, next_action, blockers, artifacts[], body?, project?, priority?}
//
// `source_ref` is the idempotency key: re-importing the same line updates the
// existing task in place instead of creating a second one.
import { hostname } from 'node:os'
import { call } from '../cli.mjs'

export const HOST = process.env.PM_MACHINE || hostname()
export const WHO = {
  actor: process.env.PM_ACTOR || 'Claude Opus 5',
  model: process.env.PM_MODEL || 'claude-opus-5',
}

// pm STATUSES are the storage vocabulary; LIFECYCLES are what the control
// surface shows. A task carries both, and this is the one place they are tied.
const STATUS_FOR = {
  READY: 'todo',
  RUNNING: 'in_progress',
  PAUSED: 'todo',
  WAITING: 'blocked',
  BLOCKED: 'blocked',
  VERIFY: 'review',
  FAILED: 'blocked',
  COMPLETE: 'done',
  ARCHIVED: 'done',
}

export function statusFor(lifecycle) {
  return STATUS_FOR[lifecycle] || 'todo'
}

const projectCache = new Map()

export async function ensureProject(name, description = '') {
  if (projectCache.has(name)) return projectCache.get(name)
  const projects = await call('GET', '/api/projects', undefined, WHO)
  let found = projects.find((p) => p.name === name)
  if (!found) found = await call('POST', '/api/projects', { name, description }, WHO)
  projectCache.set(name, found)
  return found
}

// Where a line lands. Keeps the existing brain-handoffs-* grouping rather than
// inventing a parallel set of projects beside it.
const THEMES = [
  [/council|swarm|pipeline|gatekeeper|dsh-run|seat|roster|ecomm|openclaw|canna|commerce/i, 'brain-handoffs-dsh-council-swarm'],
  [/openrouter|relay|tailscale|network|proxy|fcc|free.?claude|cheaperinference/i, 'brain-handoffs-network-relay'],
  [/llama|moe|gguf|gpu|benchmark|hardware|context.?size|throughput/i, 'brain-handoffs-hardware-llama'],
  [/quota|account|seat setup|aws|kiro|bedrock|antigravity|handoff token/i, 'brain-handoffs-accounts-quota'],
]

export function projectFor(line) {
  if (line.project) return line.project
  switch (line.kind) {
    case 'cc-session': return 'live-sessions'
    case 'dsh-run': return 'dsh-council-runs'
    case 'push-queue': return 'push-queue'
    default: break
  }
  const hay = `${line.title || ''} ${line.source_ref || ''} ${line.checkpoint || ''}`
  for (const [re, project] of THEMES) if (re.test(hay)) return project
  return 'brain-handoffs-other'
}

export const PROJECT_DESCRIPTIONS = {
  'live-sessions': 'Claude Code sessions that are genuinely in flight, one task each. Imported by connectors/cc-sessions.mjs; archived sessions are never imported.',
  'push-queue': 'Open entries in ~/.claude/shared-brain/push-requests.md. Recorded only - pm never pushes and never closes a queue entry.',
  'brain-handoffs-other': 'Open handoff notes that do not fit the other brain-handoffs-* groupings.',
  'brain-projects': 'Shared-brain design and project notes that describe unfinished work but have no handoff note of their own.',
}

// The body is what a resuming agent reads first, so it carries the real next
// action rather than a summary of one.
export function bodyFor(line) {
  const parts = [`source-handoff:${line.source_ref}`, '']
  if (line.origin_machine) parts.push(`**Origin machine:** ${line.origin_machine}`)
  if (line.agent) parts.push(`**Last agent:** ${line.agent}`)
  if (line.checkpoint) parts.push('', '**Checkpoint (last verified state):**', line.checkpoint)
  if (line.next_action) parts.push('', '**Next action (verbatim from the source):**', line.next_action)
  if (line.blockers) parts.push('', '**Blockers:**', line.blockers)
  if (line.artifacts?.length) parts.push('', '**Artifacts:**', ...line.artifacts.map((a) => `- ${a}`))
  if (line.body) parts.push('', line.body)
  return parts.join('\n')
}

export async function upsertLine(line, who = WHO) {
  const project = await ensureProject(projectFor(line), PROJECT_DESCRIPTIONS[projectFor(line)] || '')
  const lifecycle = line.lifecycle || 'READY'
  return call('POST', '/api/tasks/upsert', {
    project: project.id,
    source_ref: line.source_ref,
    title: line.title,
    body: bodyFor(line),
    status: statusFor(lifecycle),
    priority: line.priority ?? (['RUNNING', 'BLOCKED', 'FAILED'].includes(lifecycle) ? 1 : 2),
    lifecycle,
    kind: line.kind,
    origin_machine: line.origin_machine || HOST,
    execution_machine: line.execution_machine || line.origin_machine || HOST,
    session_ref: line.session_ref || (line.kind === 'cc-session' ? line.source_ref : null),
    agent: line.agent || null,
    provider: line.provider || null,
    model_id: line.model_id || null,
    checkpoint: line.checkpoint || null,
    next_action: line.next_action || null,
    blockers: line.blockers || null,
  }, who)
}

export function tally() {
  const counts = { created: 0, updated: 0, unchanged: 0 }
  return {
    add(action) { counts[action] = (counts[action] || 0) + 1 },
    counts,
    toString() { return Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') },
  }
}
