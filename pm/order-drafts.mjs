// order-drafts.mjs - preview/confirm order drafts (Claude Opus (S6)).
// Wired as createDrafts({ ...store.orderDeps, orderOps: store.orderOps }).
// Drafts never expire (user 2026-10-18): the only protection is the stale check at commit,
// which goes through orderOps.setOrder so audit and rev logic are shared with autosave/manual.

import { PmError } from './store.mjs'
import { sameMembers } from './order-resolve.mjs'
import { orderDiff } from './order-audit.mjs'

const fail = (status, msg, extra) => new PmError(status, msg, extra)

export function createDrafts({ db, tx, now, newId, orderOps, event, who }) {
  const rowOf = (id) => {
    const r = db.prepare('SELECT * FROM order_drafts WHERE id = ?').get(id)
    if (!r) throw fail(404, `no order draft ${id}`)
    return { ...r, ids: JSON.parse(r.ids) }
  }
  const setState = (id, state, at = null) =>
    db.prepare('UPDATE order_drafts SET state = ?, committed_at = COALESCE(?, committed_at) WHERE id = ?').run(state, at, id)

  // Items of `cur` rearranged into `ids` (members already validated).
  const previewOf = (cur, ids) => {
    const byId = new Map(cur.items.map((i) => [i.id, i]))
    return ids.map((id) => byId.get(id) ?? { id })
  }

  function view(d) {
    const cur = orderOps.getOrder(d.scope)
    const curIds = cur.items.map((i) => i.id)
    return {
      draft: d,
      preview: previewOf(cur, d.ids),
      diff: orderDiff(curIds, d.ids),
      stale: d.state === 'stale' || (d.state === 'open' && cur.rev !== d.base_rev),
      current: { rev: cur.rev, items: cur.items },
    }
  }

  return {
    /** -> { draft, preview, diff } */
    create(w, { scope, base_rev, ids } = {}) {
      w = who(w)
      const s = orderOps.normScope(scope)
      if (!Array.isArray(ids)) throw fail(400, 'ids must be an array')
      return tx(() => {
        const cur = orderOps.getOrder(s)
        const curIds = cur.items.map((i) => i.id)
        const base = base_rev === undefined || base_rev === null || base_rev === '' ? cur.rev : Number(base_rev)
        if (base !== cur.rev) {
          throw fail(409, `order ${s} changed since revision ${base_rev} (now ${cur.rev})`, { current: { rev: cur.rev, items: cur.items }, rejected: { ids } })
        }
        const m = sameMembers(ids, curIds)
        if (!m.ok) {
          throw fail(400, `ids must be exactly the members of ${s}` +
            (m.missing.length ? `; missing: ${m.missing.join(', ')}` : '') +
            (m.extra.length ? `; extra: ${m.extra.join(', ')}` : '') +
            (m.dupes.length ? `; duplicate: ${m.dupes.join(', ')}` : ''), { missing: m.missing, extra: m.extra, dupes: m.dupes })
        }
        const id = newId('D')
        const diff = orderDiff(curIds, ids)
        db.prepare('INSERT INTO order_drafts (id, scope, base_rev, ids, state, actor, model, created_at) VALUES (?, ?, ?, ?, \'open\', ?, ?, ?)')
          .run(id, s, base, JSON.stringify(ids), w.actor, w.model, now())
        event(w, 'order', s, 'draft_created', { draft_id: id, base_rev: base, moved: diff, before: curIds, after: [...ids] })
        return { draft: rowOf(id), preview: previewOf(cur, ids), diff }
      })
    },

    /** -> { draft, preview, diff, stale, current } */
    get(id) {
      return view(rowOf(id))
    },

    /** Apply via orderOps.setOrder. 409 (scope moved on) -> draft 'stale' + current order. -> { draft, order } */
    commit(w, id) {
      w = who(w)
      const d = rowOf(id)
      if (d.state === 'committed' || d.state === 'discarded') {
        throw fail(409, `order draft ${id} is ${d.state}`, { draft: d })
      }
      let order
      try {
        order = orderOps.setOrder(w, d.scope, { base_rev: d.base_rev, ids: d.ids, mode: 'confirm', draft_id: id, action: 'draft_committed' })
      } catch (e) {
        if (e?.status === 409 || e?.status === 400) {
          setState(id, 'stale')
          const cur = orderOps.getOrder(d.scope)
          throw fail(409, `order draft ${id} is stale: ${e.message}`, { ...(e.extra || {}), current: { rev: cur.rev, items: cur.items }, draft: rowOf(id) })
        }
        throw e
      }
      setState(id, 'committed', now())
      return { draft: rowOf(id), order }
    },

    /** Idempotent. Committed drafts cannot be discarded (409). -> draft */
    discard(w, id) {
      w = who(w)
      const d = rowOf(id)
      if (d.state === 'discarded') return d
      if (d.state === 'committed') throw fail(409, `order draft ${id} is already committed`, { draft: d })
      tx(() => {
        setState(id, 'discarded')
        event(w, 'order', d.scope, 'draft_discarded', { draft_id: id, base_rev: d.base_rev, previous_state: d.state })
      })
      return rowOf(id)
    },
  }
}
