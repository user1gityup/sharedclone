// pm peer sync: every node keeps the projects and tasks the other nodes hold, so
// either node serves the whole board while the other is off.
//
// Pull-based, modelled on bridge/replica.mjs. Each node asks each peer for rows
// changed after its stored cursor (GET /api/sync/changes?after=<chg>), merges them
// (sync-schema.applyChanges, idempotent) and advances the cursor. After an outage
// the next pull pages through everything it missed. A peer whose counter went
// backwards (its database was recreated) is read again from 0. Cursors and per-peer
// status live in sync_state, so they survive a restart.
import { uniquePeers } from './bridge/replica.mjs'
import { syncCounter, changesSince, applyChanges, getState, setState } from './sync-schema.mjs'
import { CHILD_TABLES, childChangesSince, applyChildChanges } from './sync-children.mjs'

/** Parents (projects, order_scopes, tasks) and children (comments, artifacts) share one chg counter: merge by chg, cut at limit. */
export function allChangesSince(db, after = 0, limit = 500) {
  const a = changesSince(db, after, limit)
  const b = childChangesSince(db, after, limit)
  const rows = [...a.rows, ...b.rows].sort((x, y) => x.chg - y.chg).slice(0, a.rows.length + b.rows.length ? Math.max(1, Math.min(Number(limit) || 500, 2000)) : 0)
  return { chg: a.chg, rows }
}

/** Parents first so child rows find their task; results summed. */
export function applyAll(db, rows, peer) {
  const kids = rows.filter((r) => CHILD_TABLES.includes(r.t))
  const parents = rows.filter((r) => !CHILD_TABLES.includes(r.t))
  const a = parents.length ? applyChanges(db, parents, peer) : {}
  const b = kids.length ? applyChildChanges(db, kids, peer) : {}
  const out = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = count(a[k]) + count(b[k])
  return out
}

const TOTAL_KEYS = ['inserted', 'updated', 'unchanged', 'kept_local', 'renamed', 'errors']
const count = (v) => (Array.isArray(v) ? v.length : Number(v) || 0)

function readJson(db, k) {
  const v = getState(db, k)
  if (v == null) return null
  try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null }
}

export function createPmSync(db, peers, {
  intervalMs = Number(process.env.PM_SYNC_MS ?? 5000),
  pageSize = 500,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  self = [],
} = {}) {
  const own = new Set((self ?? []).map((u) => String(u).replace(/\/$/, '')))
  const list = uniquePeers(peers).filter((p) => !own.has(p.url))
  let timer = null
  let busy = false

  async function get(peer, path) {
    const res = await fetchImpl(`${peer.url}${path}`, {
      headers: peer.token ? { authorization: `Bearer ${peer.token}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`peer ${peer.name} HTTP ${res.status}: ${String(await res.text()).slice(0, 200)}`)
    return res.json()
  }

  /** Pull everything a peer changed since our cursor. Never throws. */
  async function pull(peer) {
    const prev = readJson(db, `status:${peer.name}`) ?? {}
    let after = Number(getState(db, `cursor:${peer.name}`) ?? 0) || 0
    const total = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]))
    total.pages = 0
    try {
      for (let guard = 0; guard < 100_000; guard++) {
        const page = await get(peer, `/api/sync/changes?after=${after}&limit=${pageSize}`)
        const rows = page?.rows ?? []
        if (Number(page?.chg) < after) { after = 0; setState(db, `cursor:${peer.name}`, '0'); continue } // peer counter reset
        const r = rows.length ? applyAll(db, rows, peer.name) : {}
        for (const k of TOTAL_KEYS) total[k] += count(r?.[k])
        total.pages++
        if (rows.length) after = Number(rows[rows.length - 1].chg)
        setState(db, `cursor:${peer.name}`, String(after))
        if (rows.length < pageSize) break
      }
      const status = { peer: peer.name, url: peer.url, after, ok: true, last_ok_at: new Date().toISOString(),
        last_error: prev.last_error ?? null, last_error_at: prev.last_error_at ?? null, totals: total }
      setState(db, `status:${peer.name}`, JSON.stringify(status))
      return status
    } catch (err) {
      const error = String(err?.message ?? err).slice(0, 300)
      const status = { peer: peer.name, url: peer.url, after, ok: false, last_ok_at: prev.last_ok_at ?? null,
        last_error: error, last_error_at: new Date().toISOString(), totals: total }
      try { setState(db, `status:${peer.name}`, JSON.stringify(status)) } catch { /* status is best effort */ }
      return status
    }
  }

  async function syncAll() {
    if (busy) return []
    busy = true
    try {
      const out = []
      for (const p of list) out.push(await pull(p))
      return out
    } finally {
      busy = false
    }
  }

  return {
    peers: list,
    pull,
    syncAll,
    start() {
      if (list.length && intervalMs > 0 && !timer) {
        syncAll().catch(() => {})
        timer = setInterval(() => syncAll().catch(() => {}), intervalMs)
        timer.unref?.()
      }
      return this
    },
    stop() { clearInterval(timer); timer = null },
    status() {
      return list.map((p) => readJson(db, `status:${p.name}`) ?? { peer: p.name, url: p.url, after: Number(getState(db, `cursor:${p.name}`) ?? 0) || 0, ok: null })
    },
  }
}

/** Route triples in the pm server format: [method, regex, handler(m, body, w, query)]. */
export function routes(db, sync) {
  return [
    ['GET', /^\/api\/sync\/changes$/, (m, b, w, q = {}) =>
      allChangesSince(db, Number(q.after ?? 0) || 0, q.limit === undefined ? undefined : Number(q.limit))],
    ['GET', /^\/api\/sync\/status$/, () => ({ chg: syncCounter(db), peers: sync?.status() ?? [] })],
    ['POST', /^\/api\/sync\/now$/, () => (sync ? sync.syncAll() : [])],
  ]
}
