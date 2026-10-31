// Blitz hybrid work discovery (BLITZ-02). Sources: pm open tasks, a read-only git
// audit of linked repos, and agent audit reports. Candidates are deduplicated by
// source_ref, then by normalized title within a project, keeping every source in
// provenance[]. Discovery never writes to a repo. `apply` only creates pm tasks for
// new candidates through store.upsertBySource; existing tasks are never changed
// (their priority and meta.blitz.rating stay as they are).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { PmError } from '../store.mjs'
import { topProjects, isOpen, noncodingReason, parseMeta } from './rank.mjs'

export const DEFAULT_PUSH_REQUESTS = join(homedir(), '.claude', 'shared-brain', 'push-requests.md')

const fp = (...parts) => createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 12)
export const normalizeTitle = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const TASK_REF = /\bT-[0-9a-f]{8}\b/g

/** Dependencies of a pm task: meta.blitz.depends_on plus T-xxxxxxxx mentions in title/body. Reported, not enforced. */
export function dependsOn(t) {
  const meta = parseMeta(t)
  const listed = Array.isArray(meta.blitz?.depends_on) ? meta.blitz.depends_on.map(String) : []
  const mentioned = `${t.title ?? ''}\n${t.body ?? ''}`.match(TASK_REF) ?? []
  return [...new Set([...listed, ...mentioned])].filter((id) => id !== t.id)
}

function git(repo, args) {
  // GIT_OPTIONAL_LOCKS=0: `git status` must not refresh the index, so the audit writes nothing.
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim()
}

function openPushRequests(file, repo) {
  if (!file || !existsSync(file)) return []
  const name = basename(resolve(repo)).toLowerCase()
  const out = []
  let entry = null
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const h = line.match(/^## (.+?)(?: — (.*))?$/)
    if (h) { entry = { path: h[1].trim(), branch: h[2]?.trim() ?? '', status: null }; out.push(entry); continue }
    if (entry && entry.status === null && /^Status:/.test(line)) entry.status = line.slice(7).trim()
  }
  // Each machine has its own home folder, so match on the repo folder name.
  return out.filter((e) => /^open\b/i.test(e.status ?? '') && basename(e.path.replace(/\\/g, '/')).toLowerCase() === name)
}

/**
 * Read-only audit of one git repo: uncommitted changes, commits not on the upstream,
 * open push-request entries. Returns candidate items for `project`.
 */
export function auditRepo(repo, { project, pushRequests = DEFAULT_PUSH_REQUESTS } = {}) {
  const path = resolve(repo)
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new PmError(400, `repo ${repo} is not a directory`)
  let top
  try { top = git(path, ['rev-parse', '--show-toplevel']) } catch { throw new PmError(400, `repo ${repo} is not a git checkout`) }
  const name = basename(resolve(top))
  const items = []
  const dirty = git(path, ['status', '--porcelain']).split(/\r?\n/).filter(Boolean).map((l) => l.slice(3)).sort()
  if (dirty.length) {
    items.push({ project, source_ref: `repo:${name}:dirty:${fp(...dirty)}`, title: `Uncommitted changes in ${name} (${dirty.length} files)`,
      body: `Files:\n${dirty.slice(0, 50).join('\n')}`, evidence: { repo: top, files: dirty.length } })
  }
  let ahead = 0
  try { ahead = Number(git(path, ['rev-list', '--count', '@{upstream}..HEAD'])) || 0 } catch { /* no upstream: nothing to compare */ }
  if (ahead) {
    const head = git(path, ['rev-parse', 'HEAD'])
    const branch = git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])
    items.push({ project, source_ref: `repo:${name}:unpushed:${head.slice(0, 12)}`, title: `${ahead} unpushed commits on ${name} ${branch}`,
      body: `HEAD ${head} is ${ahead} ahead of its upstream.`, evidence: { repo: top, branch, head, ahead } })
  }
  for (const e of openPushRequests(pushRequests, top)) {
    items.push({ project, source_ref: `repo:${name}:push-request:${fp(e.path, e.branch, e.status)}`, title: `Open push request for ${name} ${e.branch}`.trim(),
      body: `push-requests.md: ${e.path} — ${e.branch}\nStatus: ${e.status}`, evidence: { repo: top, push_request: e } })
  }
  return items
}

/** Validate an agent audit report: { agent, project, items: [{ title, body?, evidence?, fingerprint? }] }. */
export function auditReportItems(report) {
  if (!report || typeof report !== 'object') throw new PmError(400, 'audit report must be an object')
  const agent = String(report.agent ?? '').trim()
  if (!/^[\w.@-]{1,64}$/.test(agent)) throw new PmError(400, 'audit report needs an agent name ([\\w.@-], 1..64)')
  if (!report.project) throw new PmError(400, 'audit report needs a project')
  if (!Array.isArray(report.items)) throw new PmError(400, 'audit report needs items[]')
  return report.items.map((it, i) => {
    if (!it?.title?.trim?.()) throw new PmError(400, `audit item ${i} needs a title`)
    const f = String(it.fingerprint ?? fp(normalizeTitle(it.title))).trim()
    if (!/^[\w.-]{1,64}$/.test(f)) throw new PmError(400, `audit item ${i} fingerprint must match [\\w.-]{1,64}`)
    return { project: report.project, source_ref: `audit:${agent}:${f}`, title: it.title.trim(), body: String(it.body ?? ''), evidence: it.evidence ?? null, agent }
  })
}

/** GitHub issues are out of scope for BLITZ-02 (gh is not authenticated, pm has no client). Reserved ref form: gh:<owner>/<repo>#<n>. */
export function githubIssues() {
  return []
}

/**
 * Discover unfinished coding work across the selected projects (explicit `projects`
 * or the top `n`). `repos`: { <project id or name>: [path, ...] }; tasks may also name
 * repos in meta.repo. `audits`: agent audit reports. `apply` needs `w` (actor).
 */
export function discover(store, { projects, n, repos = {}, audits = [], apply = false, pushRequests = DEFAULT_PUSH_REQUESTS } = {}, w = null) {
  const db = store.db
  const top = topProjects(db, { n, projects })
  const selected = new Map(top.projects.map((p) => [p.id, p]))
  const resolveProject = (ref) => db.prepare('SELECT id FROM projects WHERE id = ? OR name = ?').get(ref, ref)?.id ?? null
  const excluded = []
  const raw = []

  // 1. pm
  const repoPaths = new Map([...selected.keys()].map((id) => [id, new Set()]))
  for (const pid of selected.keys()) {
    for (const t of db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority, created_at').all(pid).map((r) => ({ ...r }))) {
      if (!isOpen(t)) continue
      const meta = parseMeta(t)
      if (typeof meta.repo === 'string' && meta.repo) repoPaths.get(pid).add(meta.repo)
      const why = noncodingReason(t)
      if (why) { excluded.push({ source_ref: t.source_ref ?? `pm:${t.id}`, task_id: t.id, project_id: pid, title: t.title, reason: why }); continue }
      raw.push({ project_id: pid, source_ref: t.source_ref ?? `pm:${t.id}`, task_id: t.id, title: t.title, body: t.body, priority: t.priority,
        kind: t.kind, depends_on: dependsOn(t), provenance: [{ source: 'pm', ref: `pm:${t.id}`, task_id: t.id }] })
    }
  }

  // 2. repo audit (read-only)
  for (const [ref, paths] of Object.entries(repos ?? {})) {
    const pid = resolveProject(ref)
    if (!pid) throw new PmError(400, `repos: unknown project ${ref}`)
    if (!selected.has(pid)) { excluded.push({ project_id: pid, reason: 'project not selected', repos: paths }); continue }
    for (const p of Array.isArray(paths) ? paths : [paths]) repoPaths.get(pid).add(String(p))
  }
  for (const [pid, paths] of repoPaths) {
    for (const path of paths) {
      for (const it of auditRepo(path, { project: pid, pushRequests })) {
        raw.push({ project_id: pid, source_ref: it.source_ref, task_id: null, title: it.title, body: it.body, priority: 2, kind: null, depends_on: [],
          provenance: [{ source: 'repo', ref: it.source_ref, evidence: it.evidence }] })
      }
    }
  }

  // 3. agent audits
  for (const report of Array.isArray(audits) ? audits : [audits]) {
    for (const it of auditReportItems(report)) {
      const pid = resolveProject(it.project)
      if (!pid) throw new PmError(400, `audit: unknown project ${it.project}`)
      if (!selected.has(pid)) { excluded.push({ source_ref: it.source_ref, project_id: pid, title: it.title, reason: 'project not selected' }); continue }
      raw.push({ project_id: pid, source_ref: it.source_ref, task_id: null, title: it.title, body: it.body, priority: 2, kind: null, depends_on: [],
        provenance: [{ source: 'audit', ref: it.source_ref, agent: it.agent, evidence: it.evidence }] })
    }
  }

  // 4. dedupe: an earlier source_ref already in pm wins; then source_ref; then normalized title per project.
  const byRef = new Map()
  const byTitle = new Map()
  const candidates = []
  const merge = (into, c) => {
    into.provenance.push(...c.provenance)
    if (!into.task_id && c.task_id) Object.assign(into, { task_id: c.task_id, priority: c.priority, kind: c.kind, source_ref: c.source_ref })
    into.depends_on = [...new Set([...into.depends_on, ...c.depends_on])]
  }
  for (const c of raw) {
    if (!c.task_id) {
      const existing = db.prepare('SELECT * FROM tasks WHERE source_ref = ?').get(c.source_ref)
      if (existing && !isOpen(existing)) { excluded.push({ source_ref: c.source_ref, task_id: existing.id, project_id: c.project_id, title: c.title, reason: `already ${existing.status}` }); continue }
      if (existing) c.provenance.push({ source: 'pm', ref: `pm:${existing.id}`, task_id: existing.id })
      if (existing) Object.assign(c, { task_id: existing.id, priority: existing.priority, kind: existing.kind })
    }
    const tKey = `${c.project_id}\n${normalizeTitle(c.title)}`
    const hit = byRef.get(c.source_ref) ?? (c.task_id ? candidates.find((x) => x.task_id === c.task_id) : null) ?? byTitle.get(tKey)
    if (hit) { merge(hit, c); byRef.set(c.source_ref, hit); continue }
    const item = { ...c, provenance: [...c.provenance] }
    candidates.push(item)
    byRef.set(c.source_ref, item)
    if (!byTitle.has(tKey)) byTitle.set(tKey, item)
  }

  // 5. apply: create pm tasks for new candidates only.
  const applied = []
  if (apply) {
    if (!w?.actor) throw new PmError(400, 'apply needs an actor')
    for (const c of candidates) {
      if (c.task_id) { applied.push({ source_ref: c.source_ref, action: 'exists', task_id: c.task_id }); continue }
      const r = store.upsertBySource(w, { project: c.project_id, title: c.title, body: c.body, priority: c.priority, source_ref: c.source_ref,
        meta: { blitz: { discovery: { provenance: c.provenance } } } })
      c.task_id = r.task.id
      applied.push({ source_ref: c.source_ref, action: r.action, task_id: r.task.id })
    }
  }

  return {
    selection: top,
    candidates,
    excluded,
    sources: { pm: raw.filter((c) => c.provenance[0].source === 'pm').length, repo: raw.filter((c) => c.provenance[0].source === 'repo').length,
      audit: raw.filter((c) => c.provenance[0].source === 'audit').length, github: 'out of scope (gh not authenticated)' },
    applied: apply ? applied : null,
  }
}
