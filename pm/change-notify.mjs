// Phase 5: notifications on meaningful change, plus capacity and usage views (T-f06d8373).
// Builds on notify.mjs (emit/dedupe/fanout) and usage-ledger.mjs; adds no new tables.
//  - Only meaningful task transitions notify: review, done, blocked, uncertain, and recovery from
//    blocked/uncertain. Churn (rev bumps, checkpoint, assignee, comment edits, same-status writes)
//    never does.
//  - Dedupe key is the transition plus the task rev, so a replayed write cannot notify twice.
//  - Capacity: a source crossing the warn (80%) or critical (95%) line notifies once per
//    threshold per reset window; stale or unknown sources are shown as such, never as healthy.
import { emit } from './notify.mjs'
import { summarize } from './usage-ledger.mjs'

export const WARN_PCT = 80
export const CRIT_PCT = 95
export const STALE_MS = 30 * 60_000

const TO = {
  review: { type: 'awaiting_approval', severity: 'info', word: 'needs review' },
  done: { type: 'completed', severity: 'info', word: 'is done' },
  blocked: { type: 'stall', severity: 'warn', word: 'is blocked' },
  uncertain: { type: 'stall', severity: 'warn', word: 'is uncertain (lease expired?)' },
}
const RECOVERING = new Set(['blocked', 'uncertain'])

/** null when the change is not worth a notification. */
export function meaningfulChange(prev, next) {
  if (!next || !prev || prev.status === next.status) return null
  const t = TO[next.status]
  if (t) return { ...t, summary: `${next.title ?? next.id} ${t.word}` }
  if (RECOVERING.has(prev.status)) return { type: 'resuming', severity: 'info', summary: `${next.title ?? next.id} resumed (${prev.status} -> ${next.status})` }
  return null
}

/** Emit for a task transition. Returns { notified, event?, created? }. */
export function notifyTaskChange(db, prev, next, { project = next?.project_id, machine = null } = {}) {
  const m = meaningfulChange(prev, next)
  if (!m) return { notified: false }
  const identities = [next.assignee, next.claimed_by, next.created_by].filter(Boolean)
  const r = emit(db, {
    type: m.type, severity: m.severity, summary: m.summary, project, machine, owner: next.assignee ?? null, task_id: next.id,
    dedupe_key: `task:${next.id}:${prev.status}->${next.status}:r${next.rev ?? 0}`,
    audience: { roles: ['admin', 'manager'], identities: [...new Set(identities)] },
    detail: { from: prev.status, to: next.status, rev: next.rev ?? null },
  })
  return { notified: r.created, event: r.event, created: r.created }
}

/**
 * Capacity view from source rows { name, used, limit, as_of, reset_at? }.
 * status: ok | warn | critical | stale | unknown. Unknown/stale never reads as ok.
 */
export function capacityView(sources, { now = Date.now(), staleMs = STALE_MS } = {}) {
  return sources.map((s) => {
    const base = { name: s.name, used: s.used ?? null, limit: s.limit ?? null, as_of: s.as_of ?? null, reset_at: s.reset_at ?? null }
    if (typeof s.used !== 'number' || typeof s.limit !== 'number' || s.limit <= 0) return { ...base, pct: null, status: 'unknown' }
    const pct = Math.round((s.used / s.limit) * 100)
    if (!s.as_of || now - Date.parse(s.as_of) > staleMs) return { ...base, pct, status: 'stale' }
    return { ...base, pct, status: pct >= CRIT_PCT ? 'critical' : pct >= WARN_PCT ? 'warn' : 'ok' }
  })
}

/** Notify for sources at warn/critical; one event per source, threshold and reset window. */
export function notifyCapacity(db, sources, opts = {}) {
  const out = []
  for (const v of capacityView(sources, opts)) {
    if (v.status !== 'warn' && v.status !== 'critical') continue
    const src = sources.find((s) => s.name === v.name)
    const r = emit(db, {
      type: 'machine_health', severity: v.status === 'critical' ? 'error' : 'warn',
      summary: `${v.name} quota at ${v.pct}%${v.reset_at ? ` (resets ${v.reset_at})` : ''}`,
      machine: src?.machine ?? null,
      dedupe_key: `capacity:${v.name}:${v.status}:${v.reset_at ?? 'noreset'}`,
      audience: { roles: ['admin', 'manager'] }, detail: v,
    })
    if (r.created) out.push(r.event)
  }
  return out
}

/** Usage view from the ledger: totals, by cost class, and the share that actually costs money. */
export function usageView(ledgerDb, filter = {}) {
  const s = summarize(ledgerDb, filter)
  const metered = s.by_cost_class.metered ?? { events: 0, tokens: 0, cost_usd: 0 }
  return {
    events: s.events, tokens: s.tokens, cost_usd: Math.round(s.cost_usd * 1e6) / 1e6,
    by_cost_class: s.by_cost_class, by_basis: s.by_basis,
    metered_token_share: s.tokens ? Math.round((metered.tokens / s.tokens) * 1000) / 10 : 0,
    estimated_only: Object.keys(s.by_basis).length === 1 && !!s.by_basis.estimated,
  }
}
