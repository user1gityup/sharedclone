// BLITZ-07 integration coordination (Claude Opus 5.5).
//
// Per repo, a queue of verified task branches (blitz_integration). `process` walks one repo's
// queue in order and, for each entry:
//   rules    the repo must have explicit rules and allow merging (no rules = blocked; never a default)
//   conflict dry-run merge (git merge-tree) against the target; a conflict blocks the entry
//   risk     protected paths, large diffs, migrations, secret patterns -> needs_review until a
//            review by someone other than the builder approves this exact diff fingerprint
//   approval BLITZ-03 assertTaskApproved(ledger, task, 'task_merge', {mergeAction:'local_commit'})
//   merge    a LOCAL merge through the idempotent once() primitive, so a retry never merges twice
// Nothing here pushes. The git runner refuses push/send-pack argv; releases (release.mjs) only
// produce a gatekeeper-queue entry as text for a human/gatekeeper to file.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { PmError } from '../store.mjs'
import { createCampaignStore, requireActor } from './campaigns.mjs'
import { assertTaskApproved } from './gate.mjs'
import { assertNoPush } from './verify.mjs'

export const INTEGRATION_STATES = ['queued', 'blocked', 'needs_review', 'merged', 'dropped']
export const DEFAULT_RISK = {
  protectedPaths: ['.github/', 'package.json', 'package-lock.json', '.env', 'server.mjs'],
  maxDiffLines: 800,
  migrationPattern: /(^|\/)(migrations?|migrate)[^/]*|\.sql$|schema\.(m?js|ts|sql)$/i,
  secretPatterns: [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\b(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i, /\bsk-[A-Za-z0-9]{20,}/],
  secretFiles: /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*)$/i,
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blitz_integration (
  campaign_id TEXT NOT NULL, task_id TEXT NOT NULL, repo TEXT NOT NULL, branch TEXT NOT NULL, target TEXT,
  seq INTEGER NOT NULL, state TEXT NOT NULL, reason TEXT, risk TEXT, fingerprint TEXT, merge_commit TEXT,
  builder TEXT, rev INTEGER NOT NULL DEFAULT 1, enqueued_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, task_id));
CREATE INDEX IF NOT EXISTS blitz_integration_repo ON blitz_integration(repo, state, seq);
CREATE TABLE IF NOT EXISTS blitz_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL, task_id TEXT NOT NULL, reviewer TEXT NOT NULL,
  decision TEXT NOT NULL, fingerprint TEXT NOT NULL, note TEXT, actor TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS blitz_reviews_no_update BEFORE UPDATE ON blitz_reviews
  BEGIN SELECT RAISE(ABORT, 'blitz_reviews is append-only'); END;
`
export function migrate(db) { db.exec(SCHEMA) }

const json = (s, d) => { if (s == null) return d; try { return JSON.parse(s) } catch { return d } }
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const entryRow = (r) => (r ? { ...r, risk: json(r.risk, null) } : null)

/** Classifies a diff {files:[{path, added, deleted}], text?}. Returns {risky, reasons[], lines}. */
export function assessRisk(diff, cfg = {}) {
  const c = { ...DEFAULT_RISK, ...cfg }
  const files = Array.isArray(diff?.files) ? diff.files : []
  const reasons = []
  const lines = files.reduce((n, f) => n + (Number(f.added) || 0) + (Number(f.deleted) || 0), 0)
  const prot = files.filter((f) => c.protectedPaths.some((p) => (p.endsWith('/') ? f.path.startsWith(p) || f.path.includes(`/${p}`) : f.path === p || f.path.endsWith(`/${p}`))))
  if (prot.length) reasons.push(`touches protected paths: ${prot.map((f) => f.path).join(', ')}`)
  if (lines > c.maxDiffLines) reasons.push(`large diff: ${lines} lines > ${c.maxDiffLines}`)
  const mig = files.filter((f) => c.migrationPattern.test(f.path))
  if (mig.length) reasons.push(`migration: ${mig.map((f) => f.path).join(', ')}`)
  const sec = files.filter((f) => c.secretFiles.test(f.path))
  if (sec.length) reasons.push(`secret-like files: ${sec.map((f) => f.path).join(', ')}`)
  if (typeof diff?.text === 'string' && c.secretPatterns.some((re) => re.test(diff.text))) reasons.push('diff text matches a secret pattern')
  return { risky: reasons.length > 0, reasons, lines, files: files.length }
}

/**
 * Real git runner over `git -C <repo>`. Read-only except `merge`, which builds the merge commit
 * with merge-tree + commit-tree and moves the target ref with a compare-and-swap update-ref.
 * By default it refuses when the target branch is checked out in any worktree (the working tree would
 * go stale). With checkedOut: 'merge-if-clean' (server.mjs uses it once repo rules are loaded) a target
 * checked out in a worktree with NO uncommitted tracked changes is merged there with
 * `git merge --no-ff --no-edit` after the same clean merge-tree dry run and a HEAD compare; any failure
 * aborts the merge and refuses. A dirty worktree is always refused. It never pushes.
 */
export function createGitRunner({ exec, checkedOut = 'refuse' } = {}) {
  const git = exec ?? ((repo, args) => new Promise((done) => {
    assertNoPush(args)
    execFile('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      done({ exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: stdout ?? '', stderr: stderr ?? '' }))
  }))
  const ok = async (repo, args) => {
    assertNoPush(args)
    const r = await git(repo, args)
    if (r.exitCode !== 0) throw new PmError(500, `git ${args.join(' ')} exited ${r.exitCode}: ${r.stderr.trim()}`)
    return r.stdout.trim()
  }
  return {
    async head(repo, ref) { return ok(repo, ['rev-parse', '--verify', `${ref}^{commit}`]) },
    async diff(repo, target, branch) {
      const num = await ok(repo, ['diff', '--numstat', `${target}...${branch}`])
      const text = await ok(repo, ['diff', `${target}...${branch}`])
      const files = num.split(/\r?\n/).filter(Boolean).map((l) => { const [a, d, ...p] = l.split('\t'); return { path: p.join('\t'), added: Number(a) || 0, deleted: Number(d) || 0 } })
      return { files, text }
    },
    async mergeTree(repo, target, branch) {
      assertNoPush(['merge-tree'])
      const r = await git(repo, ['merge-tree', '--write-tree', '--name-only', '--no-messages', target, branch])
      const lines = r.stdout.split(/\r?\n/).filter(Boolean)
      if (r.exitCode === 0) return { clean: true, tree: lines[0], conflicts: [] }
      if (r.exitCode === 1) return { clean: false, tree: lines[0], conflicts: lines.slice(1) }
      throw new PmError(500, `git merge-tree exited ${r.exitCode}: ${r.stderr.trim()}`)
    },
    async merge(repo, target, branch, { message }) {
      const wt = await ok(repo, ['worktree', 'list', '--porcelain'])
      let holder = null; let cur = null
      for (const l of wt.split(/\r?\n/)) {
        if (l.startsWith('worktree ')) cur = l.slice(9)
        else if (l === `branch refs/heads/${target}`) holder = cur
      }
      if (holder !== null && checkedOut !== 'merge-if-clean') throw new PmError(409, `target ${target} is checked out in a worktree of ${repo}; merge it there by hand or check out another branch`)
      const old = await ok(repo, ['rev-parse', '--verify', `refs/heads/${target}`])
      const tip = await ok(repo, ['rev-parse', '--verify', `${branch}^{commit}`])
      const mt = await this.mergeTree(repo, target, branch)
      if (!mt.clean) throw new PmError(409, `merge of ${branch} into ${target} conflicts: ${mt.conflicts.join(', ')}`)
      if (holder !== null) {
        const dirty = await ok(holder, ['status', '--porcelain', '--untracked-files=no'])
        if (dirty) throw new PmError(409, `target ${target} is checked out in ${holder} with uncommitted changes; not merging`)
        const head = await ok(holder, ['rev-parse', '--verify', 'HEAD'])
        if (head !== old) throw new PmError(409, `target ${target} moved during the merge (${head} != ${old})`)
        const margs = ['merge', '--no-ff', '--no-edit', '-m', message, tip]
        assertNoPush(margs)
        const r = await git(holder, margs)
        if (r.exitCode !== 0) {
          try { await git(holder, ['merge', '--abort']) } catch { /* nothing to abort */ }
          throw new PmError(409, `git merge of ${branch} into checked-out ${target} at ${holder} failed (${r.exitCode}): ${String(r.stderr ?? '').trim().slice(0, 300)}`)
        }
        const commit = await ok(holder, ['rev-parse', '--verify', 'HEAD'])
        return { commit, previous: old, worktree: holder }
      }
      const commit = await ok(repo, ['commit-tree', mt.tree, '-p', old, '-p', tip, '-m', message])
      await ok(repo, ['update-ref', '-m', `blitz merge ${branch}`, `refs/heads/${target}`, commit, old])
      return { commit, previous: old }
    },
  }
}

/**
 * @param o.db        blitz db (store.db)
 * @param o.store     pm store (tasks are read from store.db)
 * @param o.ledgerDb  () => approval ledger db or null
 * @param o.git       {diff, mergeTree, merge, head?} (createGitRunner() for real repos; fakes in tests)
 * @param o.rules     {[repo]: {target, allowMerge, risk?}} - a repo without rules never merges
 * @param o.controller optional: its once() is used so merge keys share the controller's ctx.once space
 */
export function createIntegrator({ db, store, ledgerDb = () => null, git, rules = {}, controller = null, clock = () => new Date(), onEvent = null } = {}) {
  if (!db) throw new Error('createIntegrator needs the blitz db')
  if (!git) throw new Error('createIntegrator needs a git runner (createGitRunner() or a fake)')
  migrate(db)
  const cs = createCampaignStore(db, { clock, onEvent })
  const getLedger = typeof ledgerDb === 'function' ? ledgerDb : () => ledgerDb
  const tdb = store?.db ?? db
  const now = () => clock().toISOString()

  const entry = (cid, tid) => entryRow(db.prepare('SELECT * FROM blitz_integration WHERE campaign_id = ? AND task_id = ?').get(cid, tid))
  function setEntry(cid, tid, rev, fields) {
    const cols = Object.keys(fields)
    const vals = cols.map((c) => (fields[c] !== null && typeof fields[c] === 'object' ? JSON.stringify(fields[c]) : fields[c]))
    const r = db.prepare(`UPDATE blitz_integration SET ${cols.map((c) => `${c} = ?`).join(', ')}, rev = rev + 1, updated_at = ? WHERE campaign_id = ? AND task_id = ? AND rev = ?`)
      .run(...vals, now(), cid, tid, rev)
    if (r.changes !== 1) throw new PmError(409, `integration entry ${tid} changed concurrently`)
    return entry(cid, tid)
  }

  /** Same semantics and key space as controller.once (`<campaign>:fx:<key>`). */
  async function once(cid, key, fn) {
    if (controller?.once) return controller.once(cid, key, fn)
    const k = `${cid}:fx:${key}`
    if (!cs.claimKey(k, cid, 'effect')) {
      const prev = cs.idem(k)
      if (prev.status === 'done') return { ...(prev.result ?? {}), replayed: true }
      throw new PmError(409, `side effect ${key} is ${prev.status}; reconcile before retrying`)
    }
    try { const out = await fn(); cs.settleKey(k, 'done', out ?? null); return out } catch (err) { cs.settleKey(k, 'failed', { error: String(err?.message ?? err) }); throw err }
  }

  function liveTask(id) {
    const r = tdb.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
    if (!r) throw new PmError(404, `no task ${id}`)
    return { ...r }
  }

  const api = {
    /** Queues one verified task's branch. The result must name repo + branch. Idempotent. */
    enqueue(w, campaignId, taskId) {
      w = requireActor(w)
      return cs.tx(() => {
        const prev = entry(campaignId, taskId)
        if (prev) return { ...prev, replayed: true }
        const row = cs.task(campaignId, taskId)
        if (row.state !== 'verified') throw new PmError(409, `task ${taskId} is ${row.state}; only verified tasks are integrated`)
        const res = row.result ?? {}
        if (typeof res.repo !== 'string' || !res.repo.trim() || typeof res.branch !== 'string' || !res.branch.trim()) throw new PmError(400, `result of ${taskId} names no repo and branch to integrate`)
        const seq = (db.prepare('SELECT MAX(seq) AS m FROM blitz_integration').get().m ?? 0) + 1
        const at = now()
        db.prepare(`INSERT INTO blitz_integration (campaign_id, task_id, repo, branch, target, seq, state, builder, enqueued_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
          .run(campaignId, taskId, res.repo, res.branch, rules[res.repo]?.target ?? res.base ?? null, seq, row.agent ?? null, at, at)
        cs.event(campaignId, 'integration_queued', { repo: res.repo, branch: res.branch, seq }, { taskId, actor: w.actor })
        return entry(campaignId, taskId)
      })
    },

    /** Queues every verified task of the campaign that is not queued yet. */
    enqueueVerified(w, campaignId) {
      const out = []
      for (const r of cs.tasks(campaignId, { state: 'verified' })) {
        if (entry(campaignId, r.task_id)) continue
        try { out.push(api.enqueue(w, campaignId, r.task_id)) } catch (err) { if (!(err instanceof PmError)) throw err; cs.event(campaignId, 'integration_skipped', { reason: err.message }, { taskId: r.task_id, actor: requireActor(w).actor }) }
      }
      return out
    },

    queue({ campaignId, repo, state } = {}) {
      const where = []; const args = []
      if (campaignId) { where.push('campaign_id = ?'); args.push(campaignId) }
      if (repo) { where.push('repo = ?'); args.push(repo) }
      if (state) { where.push('state = ?'); args.push(state) }
      return db.prepare(`SELECT * FROM blitz_integration ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY repo, seq`).all(...args).map(entryRow)
    },

    /** Records a review of a risky entry. The reviewer may not be the task's builder. */
    review(w, campaignId, taskId, { reviewer, decision, fingerprint, note } = {}) {
      w = requireActor(w)
      const e = entry(campaignId, taskId)
      if (!e) throw new PmError(404, `task ${taskId} is not in the integration queue`)
      if (typeof reviewer !== 'string' || !reviewer.trim()) throw new PmError(400, 'reviewer is required')
      if (!['approved', 'rejected'].includes(decision)) throw new PmError(400, 'decision must be approved or rejected')
      if (reviewer === e.builder || reviewer === cs.task(campaignId, taskId).agent) throw new PmError(403, `refused: ${reviewer} built ${taskId} and cannot review it`)
      if (!e.fingerprint || fingerprint !== e.fingerprint) throw new PmError(409, `review must name the current diff fingerprint ${e.fingerprint ?? '(not assessed yet: run process first)'}`)
      return cs.tx(() => {
        db.prepare('INSERT INTO blitz_reviews (campaign_id, task_id, reviewer, decision, fingerprint, note, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(campaignId, taskId, reviewer.trim(), decision, fingerprint, note ?? null, w.actor, now())
        cs.event(campaignId, 'integration_review', { reviewer, decision, fingerprint }, { taskId, actor: w.actor })
        let cur = entry(campaignId, taskId)
        if (cur.state === 'needs_review') cur = setEntry(campaignId, taskId, cur.rev, decision === 'approved' ? { state: 'queued', reason: `review approved by ${reviewer}` } : { state: 'blocked', reason: `review: rejected by ${reviewer}` })
        return cur
      })
    },

    /** Puts a blocked / needs_review entry back in the queue (after rework, rule or approval change). */
    retry(w, campaignId, taskId, { reason = '' } = {}) {
      w = requireActor(w)
      return cs.tx(() => {
        const e = entry(campaignId, taskId)
        if (!e) throw new PmError(404, `task ${taskId} is not in the integration queue`)
        if (!['blocked', 'needs_review'].includes(e.state)) throw new PmError(409, `entry ${taskId} is ${e.state}`)
        cs.event(campaignId, 'integration_retry', { from: e.state, reason }, { taskId, actor: w.actor })
        return setEntry(campaignId, taskId, e.rev, { state: 'queued', reason: `retry: ${reason}` })
      })
    },

    /**
     * One pass over a repo's queued entries, in order. Returns {merged, blocked, needs_review}.
     * Entries are processed one at a time, so each dry run sees the target after earlier merges.
     */
    async process(w, { repo, campaignId } = {}) {
      w = requireActor(w)
      if (!repo) throw new PmError(400, 'repo is required: integration runs one repo at a time')
      const out = { repo, merged: [], blocked: [], needs_review: [] }
      const block = (e, state, reason, extra = {}) => cs.tx(() => {
        const cur = entry(e.campaign_id, e.task_id)
        const r = setEntry(e.campaign_id, e.task_id, cur.rev, { state, reason, ...extra })
        cs.event(e.campaign_id, state === 'needs_review' ? 'integration_needs_review' : 'integration_blocked', { repo, reason, ...extra }, { taskId: e.task_id, actor: w.actor })
        out[state === 'needs_review' ? 'needs_review' : 'blocked'].push({ task_id: e.task_id, reason })
        return r
      })
      const rule = rules[repo]
      for (const e of api.queue({ repo, campaignId, state: 'queued' })) {
        if (!rule) { block(e, 'blocked', `rules: no repo rules for ${repo}; merging is never defaulted`); continue }
        if (rule.allowMerge !== true) { block(e, 'blocked', `rules: ${repo} does not allow blitz merges`); continue }
        const target = rule.target ?? e.target
        if (!target) { block(e, 'blocked', `rules: no target branch for ${repo}`); continue }
        if (rule.protectedTargets?.includes(target)) { block(e, 'blocked', `rules: ${target} is protected in ${repo}`); continue }

        let dry, diff
        try {
          dry = await git.mergeTree(repo, target, e.branch)
          diff = await git.diff(repo, target, e.branch)
        } catch (err) { block(e, 'blocked', `git: ${String(err?.message ?? err)}`); continue }
        if (!dry.clean) { block(e, 'blocked', `conflict: ${e.branch} vs ${target}: ${(dry.conflicts ?? []).join(', ') || 'unknown files'}`); continue }

        const risk = assessRisk(diff, rule.risk)
        const fingerprint = sha(JSON.stringify({ target, branch: e.branch, files: diff.files, text: diff.text ?? null }))
        if (risk.risky) {
          const ok = db.prepare("SELECT 1 FROM blitz_reviews WHERE campaign_id = ? AND task_id = ? AND fingerprint = ? AND decision = 'approved' AND reviewer <> ? LIMIT 1")
            .get(e.campaign_id, e.task_id, fingerprint, e.builder ?? '')
          if (!ok) { block(e, 'needs_review', `review: ${risk.reasons.join('; ')}`, { risk, fingerprint }); continue }
        }

        let task
        try { task = liveTask(e.task_id) } catch (err) { block(e, 'blocked', `task: ${err.message}`); continue }
        try {
          assertTaskApproved(getLedger(), task, 'task_merge', { now: clock(), mergeAction: 'local_commit' })
        } catch (err) {
          if (!(err instanceof PmError) || err.status !== 409) throw err
          block(e, 'blocked', `approval: ${(err.extra?.reasons ?? [err.message]).join('; ')}`, { risk, fingerprint })
          continue
        }

        let m
        try {
          m = await once(e.campaign_id, `${e.task_id}:merge:${sha(`${repo}\n${e.branch}`).slice(0, 16)}`, async () => {
            const r = await git.merge(repo, target, e.branch, { message: `blitz: merge ${e.branch} (${e.task_id}, campaign ${e.campaign_id})\n\nVerified and approved (task_merge, local_commit). Merged by ${w.actor}.` })
            return { commit: r.commit, previous: r.previous ?? null }
          })
        } catch (err) { block(e, 'blocked', `merge: ${String(err?.message ?? err)}`, { risk, fingerprint }); continue }
        cs.tx(() => {
          const cur = entry(e.campaign_id, e.task_id)
          setEntry(e.campaign_id, e.task_id, cur.rev, { state: 'merged', reason: m.replayed ? 'merged (replayed)' : null, merge_commit: m.commit, target, risk, fingerprint })
          cs.event(e.campaign_id, 'integration_merged', { repo, target, branch: e.branch, commit: m.commit, replayed: !!m.replayed }, { taskId: e.task_id, actor: w.actor })
        })
        out.merged.push({ task_id: e.task_id, commit: m.commit, replayed: !!m.replayed })
      }
      return out
    },
  }
  return api
}
