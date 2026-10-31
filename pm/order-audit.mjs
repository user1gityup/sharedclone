// order-audit.mjs - pure audit helpers for manual ordering (Claude Opus (S5)).
// No store imports: S3 calls reorderEvent() and passes the result to store event().

export const ORDER_MODES = Object.freeze(['autosave', 'manual', 'confirm'])
export const ORDER_ACTIONS = Object.freeze([
  'reordered', 'override_set', 'override_cleared', 'draft_committed', 'draft_created', 'draft_discarded',
])
export const HISTORY_DEFAULT_LIMIT = 50
export const HISTORY_MAX_LIMIT = 500

// Ids whose 1-based position changed. Ids only in one list get from/to null.
export function orderDiff(before = [], after = []) {
  const posB = new Map(), posA = new Map()
  before.forEach((id, i) => { if (!posB.has(id)) posB.set(id, i + 1) })
  after.forEach((id, i) => { if (!posA.has(id)) posA.set(id, i + 1) })
  const moved = []
  for (const [id, to] of posA) {
    const from = posB.has(id) ? posB.get(id) : null
    if (from !== to) moved.push({ id, from, to })
  }
  for (const [id, from] of posB) if (!posA.has(id)) moved.push({ id, from, to: null })
  return moved
}

export function reorderEvent({ scope, mode, draft_id, base_rev, rev, before = [], after = [], action = 'reordered' } = {}) {
  if (typeof scope !== 'string' || !scope) throw new Error('order-audit: scope required')
  if (!ORDER_MODES.includes(mode)) throw new Error(`order-audit: invalid mode ${JSON.stringify(mode)}`)
  if (!ORDER_ACTIONS.includes(action)) throw new Error(`order-audit: invalid action ${JSON.stringify(action)}`)
  const data = { mode }
  if (draft_id != null) data.draft_id = draft_id
  data.base_rev = base_rev ?? null
  data.rev = rev ?? null
  data.moved = orderDiff(before, after)
  data.before = [...before]
  data.after = [...after]
  return { entity: 'order', entity_id: scope, action, data }
}

// events columns (store.mjs): id, at, actor, model, entity, entity_id, action, data
export function historyQuery(scope, limit) {
  let n = Number.parseInt(limit, 10)
  if (!Number.isFinite(n) || n < 1) n = HISTORY_DEFAULT_LIMIT
  n = Math.min(n, HISTORY_MAX_LIMIT)
  const cols = 'id, at, actor, model, entity, entity_id, action, data'
  if (scope != null && scope !== '') {
    return { sql: `SELECT ${cols} FROM events WHERE entity='order' AND entity_id=? ORDER BY id DESC LIMIT ?`, args: [String(scope), n] }
  }
  return { sql: `SELECT ${cols} FROM events WHERE entity='order' ORDER BY id DESC LIMIT ?`, args: [n] }
}
