// Peer mail replication: every node keeps a copy of the mailbox mail the others
// own (messages, delivery, ack and response state), so either node serves the full
// inbox for chatgpt, claude-code and the rest while the other is off.
//
// Pull-based. Each node asks each peer for mailbox rows changed after its stored
// cursor (GET /api/bridge/replica?after=<rev>), merges them (queue.applyReplica,
// idempotent by id) and advances the cursor. After an outage the next pull pages
// through everything it missed. A peer whose counter went backwards (its database
// was recreated) is read again from 0. Acks taken on a replica flow back the same
// way, because the owner pulls the replica node too.
//
// Token hashes follow the same path (GET /api/bridge/replica/tokens) so a client
// token issued on one node (the chatgpt connector's) is accepted on the other.
// Imported entries carry from_peer and are dropped when the peer drops them;
// local entries are never touched and imported ones are never re-exported.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { defaultTokenFile } from './auth.mjs'

/** One entry per distinct peer URL (bridge-peers.json may list aliases of one host). */
export function uniquePeers(peers) {
  const seen = new Map()
  for (const [name, p] of Object.entries(peers ?? {})) {
    if (!p?.url) continue
    const url = p.url.replace(/\/$/, '')
    if (!seen.has(url)) seen.set(url, { name, url, token: p.token })
  }
  return [...seen.values()]
}

/** Local token entries, safe to hand a peer: hashes only, never imported ones. */
export function exportTokens(file = defaultTokenFile()) {
  if (!existsSync(file)) return []
  const data = JSON.parse(readFileSync(file, 'utf8'))
  return (data.tokens ?? []).filter((t) => !t.from_peer && typeof t.sha256 === 'string')
    .map(({ name, sha256, scopes, projects, agents }) => ({ name, sha256, scopes, projects, ...(agents ? { agents } : {}) }))
}

/** Mirror a peer's local tokens into ours. Returns { added, removed }. */
export function mergeTokens(peer, remote, file = defaultTokenFile()) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { tokens: [] }
  const tokens = data.tokens ?? []
  const want = new Map(remote.filter((t) => t && typeof t.sha256 === 'string' && /^[0-9a-f]{64}$/.test(t.sha256) && t.name).map((t) => [t.sha256, t]))
  const have = new Set(tokens.map((t) => t.sha256))
  const kept = tokens.filter((t) => t.from_peer !== peer || want.has(t.sha256))
  const removed = tokens.length - kept.length
  let added = 0
  for (const [h, t] of want) {
    if (have.has(h)) continue
    kept.push({ name: t.name, sha256: h, scopes: (t.scopes ?? []).filter((s) => s !== 'admin' && s !== 'replicate'),
      projects: t.projects ?? ['*'], ...(t.agents ? { agents: t.agents } : {}), from_peer: peer })
    added++
  }
  if (added || removed) {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ ...data, tokens: kept }, null, 2))
    renameSync(tmp, file)
  }
  return { added, removed }
}

export function createReplicator(queue, peers, {
  intervalMs = Number(process.env.BRIDGE_REPLICA_MS ?? 5000),
  pageSize = 200,
  tokenFile = defaultTokenFile(),
  syncTokens = true,
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  const list = uniquePeers(peers)
  let timer = null
  let busy = false

  async function get(peer, path) {
    const res = await fetchImpl(`${peer.url}${path}`, {
      headers: peer.token ? { authorization: `Bearer ${peer.token}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`peer ${peer.name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return res.json()
  }

  /** Pull everything a peer changed since our cursor. */
  async function pull(peer) {
    let after = Number(queue.replicaCursor(peer.name)?.after_rev ?? 0)
    const total = { inserted: 0, merged: 0, unchanged: 0, skipped: 0, pages: 0 }
    try {
      for (;;) {
        const page = await get(peer, `/api/bridge/replica?after=${after}&limit=${pageSize}`)
        if (Number(page.rev) < after) { after = 0; continue } // peer counter reset: read it all again
        const r = queue.applyReplica(page.rows ?? [], peer.name)
        for (const k of ['inserted', 'merged', 'unchanged', 'skipped']) total[k] += r[k]
        total.pages++
        if (page.rows?.length) after = Number(page.rows[page.rows.length - 1].rev)
        queue.setReplicaCursor(peer.name, { url: peer.url, after_rev: after, ok: true, pulled: page.rows?.length ?? 0 })
        if (!page.rows || page.rows.length < pageSize) break
      }
      if (syncTokens) total.tokens = mergeTokens(peer.name, (await get(peer, '/api/bridge/replica/tokens')).tokens ?? [], tokenFile)
      return { peer: peer.name, ok: true, after, ...total }
    } catch (err) {
      const error = String(err.message ?? err).slice(0, 300)
      queue.setReplicaCursor(peer.name, { url: peer.url, ok: false, error })
      return { peer: peer.name, ok: false, error, after, ...total }
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
      if (list.length && intervalMs > 0) {
        syncAll().catch(() => {})
        timer = setInterval(() => syncAll().catch(() => {}), intervalMs)
        timer.unref?.()
      }
      return this
    },
    stop() { clearInterval(timer) },
  }
}
