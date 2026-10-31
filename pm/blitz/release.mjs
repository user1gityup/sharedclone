// BLITZ-07 coordinated releases (Claude Opus 5.5).
//
// A release is a RECORD, never a push or a deployment. Per repo it lists the merged task
// commits; across campaigns/projects it summarizes every task as verified / unverified /
// failed / blocked / cancelled with pointers to its evidence. When - and only when - every
// merged task in a repo holds a task_merge approval that allows `queue_gatekeeper`, the record
// carries a push-requests.md entry as TEXT for the gatekeeper flow. This module never writes
// push-requests.md and never runs git.
import { randomBytes } from 'node:crypto'
import { PmError } from '../store.mjs'
import { createCampaignStore, requireActor } from './campaigns.mjs'
import { assertTaskApproved } from './gate.mjs'
import { migrate as migrateIntegration } from './integrate.mjs'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blitz_releases (
  id TEXT PRIMARY KEY, campaigns TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, model TEXT);
CREATE TRIGGER IF NOT EXISTS blitz_releases_no_update BEFORE UPDATE ON blitz_releases
  BEGIN SELECT RAISE(ABORT, 'blitz_releases is append-only'); END;
`
export function migrate(db) { db.exec(SCHEMA) }

const json = (s, d) => { if (s == null) return d; try { return JSON.parse(s) } catch { return d } }

export function categoryOf(taskState, integrationState) {
  if (taskState === 'failed') return 'failed'
  if (taskState === 'cancelled') return 'cancelled'
  if (['blocked', 'escalated'].includes(taskState)) return 'blocked'
  if (taskState === 'verified') return ['blocked', 'needs_review'].includes(integrationState) ? 'blocked' : 'verified'
  return 'unverified'
}

/** push-requests.md entry text (format of the shared queue). Data only: the caller files it. */
export function gatekeeperEntry({ repo, branch, model, commits, notes, at }) {
  const d = new Date(at)
  const stamp = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`
  return [
    `## ${repo} — ${branch}`,
    `Filed: ${stamp} by ${model}`,
    'Status: open',
    'Remote: (gatekeeper to confirm)',
    `Commits: ${commits.join('\n         ')}`,
    `Notes: ${notes}`,
  ].join('\n')
}

/**
 * @param o.db       blitz db
 * @param o.store    pm store (tasks for the approval check)
 * @param o.ledgerDb () => approval ledger db or null
 */
export function createReleaser({ db, store, ledgerDb = () => null, clock = () => new Date() } = {}) {
  if (!db) throw new Error('createReleaser needs the blitz db')
  migrateIntegration(db)
  migrate(db)
  const cs = createCampaignStore(db, { clock })
  const getLedger = typeof ledgerDb === 'function' ? ledgerDb : () => ledgerDb
  const tdb = store?.db ?? db

  function lastEvent(cid, tid, kind) {
    const list = cs.events(cid, { task: tid, kind, limit: 5000 })
    return list.length ? list[list.length - 1] : null
  }

  /** Cross-project summary of one or more campaigns, read-only. */
  function summary(campaignIds) {
    const ids = Array.isArray(campaignIds) ? campaignIds : [campaignIds]
    if (!ids.length) throw new PmError(400, 'name at least one campaign')
    const tasks = []
    for (const cid of ids) {
      cs.get(cid)
      for (const r of cs.tasks(cid)) {
        const integ = db.prepare('SELECT * FROM blitz_integration WHERE campaign_id = ? AND task_id = ?').get(cid, r.task_id)
        const ev = lastEvent(cid, r.task_id, 'verify_evidence')
        tasks.push({
          campaign_id: cid, task_id: r.task_id, project_id: r.project_id, state: r.state, attempt: r.attempt,
          category: categoryOf(r.state, integ?.state), reason: integ && ['blocked', 'needs_review'].includes(integ.state) ? integ.reason : r.reason,
          builder: r.agent ?? null, verifier: r.verification?.evidence?.verifier ?? ev?.data?.evidence?.verifier ?? null,
          evidence: { event_id: ev?.id ?? null, sha256: r.verification?.evidence?.sha256 ?? ev?.data?.evidence?.sha256 ?? null, checks: (r.verification?.evidence?.checks ?? []).map((c) => ({ name: c.name, exit_code: c.exit_code })) },
          integration: integ ? { repo: integ.repo, branch: integ.branch, state: integ.state, merge_commit: integ.merge_commit, reason: integ.reason } : null,
        })
      }
    }
    const counts = {}
    for (const t of tasks) counts[t.category] = (counts[t.category] ?? 0) + 1
    const byProject = {}
    for (const t of tasks) { const p = (byProject[t.project_id] ??= {}); p[t.category] = (p[t.category] ?? 0) + 1 }
    return { campaigns: ids, counts, by_project: byProject, tasks }
  }

  const api = {
    summary,

    /**
     * Builds and stores a release record for the given campaigns: per-repo merged commits, the
     * cross-project summary, and (only if approved) a gatekeeper entry as text. Never pushes.
     */
    create(w, { campaigns, model } = {}) {
      w = requireActor(w)
      const ids = Array.isArray(campaigns) ? campaigns : campaigns ? [campaigns] : []
      const sum = summary(ids)
      const at = clock().toISOString()
      const repos = {}
      for (const cid of ids) {
        for (const e of db.prepare("SELECT * FROM blitz_integration WHERE campaign_id = ? ORDER BY seq").all(cid)) {
          const r = (repos[e.repo] ??= { repo: e.repo, target: e.target, merged: [], held: [] })
          if (e.state === 'merged') r.merged.push({ campaign_id: cid, task_id: e.task_id, branch: e.branch, commit: e.merge_commit })
          else r.held.push({ campaign_id: cid, task_id: e.task_id, branch: e.branch, state: e.state, reason: e.reason })
        }
      }
      const ledger = getLedger()
      for (const r of Object.values(repos)) {
        r.head = r.merged.length ? r.merged[r.merged.length - 1].commit : null
        r.gatekeeper_request = null
        if (!r.merged.length) { r.gatekeeper_blocked = 'nothing merged'; continue }
        const refusals = []
        for (const m of r.merged) {
          const t = tdb.prepare('SELECT * FROM tasks WHERE id = ?').get(m.task_id)
          if (!t) { refusals.push(`${m.task_id}: task missing`); continue }
          try { assertTaskApproved(ledger, { ...t }, 'task_merge', { now: clock(), mergeAction: 'queue_gatekeeper' }) } catch (err) {
            if (!(err instanceof PmError)) throw err
            refusals.push(`${m.task_id}: ${(err.extra?.reasons ?? [err.message]).join('; ')}`)
          }
        }
        if (refusals.length) { r.gatekeeper_blocked = `queue_gatekeeper not approved: ${refusals.join(' | ')}`; continue }
        r.gatekeeper_request = gatekeeperEntry({
          repo: r.repo, branch: r.target ?? '(target)', model: model ?? w.actor, at,
          commits: r.merged.map((m) => `${String(m.commit).slice(0, 10)} blitz merge ${m.branch} (${m.task_id})`),
          notes: `BLITZ-07 release of campaign(s) ${ids.join(', ')}; ${r.merged.length} verified+approved task merge(s); ${r.held.length} held back. Text only: not filed, not pushed.`,
        })
      }
      const id = `R-${randomBytes(4).toString('hex')}`
      const data = { id, at, by: w.actor, repos: Object.values(repos), summary: sum, pushed: false, deployed: false }
      cs.tx(() => {
        db.prepare('INSERT INTO blitz_releases (id, campaigns, data, created_at, created_by, model) VALUES (?, ?, ?, ?, ?, ?)').run(id, JSON.stringify(ids), JSON.stringify(data), at, w.actor, w.model ?? null)
        for (const cid of ids) cs.event(cid, 'release_recorded', { release: id, repos: data.repos.map((r) => ({ repo: r.repo, merged: r.merged.length, held: r.held.length, gatekeeper_request: !!r.gatekeeper_request })), counts: sum.counts }, { actor: w.actor })
      })
      return data
    },

    get(id) {
      const r = db.prepare('SELECT * FROM blitz_releases WHERE id = ?').get(id)
      if (!r) throw new PmError(404, `no release ${id}`)
      return json(r.data, null)
    },

    list({ campaign } = {}) {
      return db.prepare('SELECT * FROM blitz_releases ORDER BY created_at, id').all()
        .filter((r) => !campaign || json(r.campaigns, []).includes(campaign))
        .map((r) => ({ id: r.id, campaigns: json(r.campaigns, []), created_at: r.created_at, created_by: r.created_by }))
    },
  }
  return api
}
