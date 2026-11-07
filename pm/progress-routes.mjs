// HTTP routes for persisted task progress (T-409c621d, PM_PROGRESS_V1). Claude Sonnet 5.5.
//  POST /api/progress/events          one event or {events:[...]}; actor required, source agent must be trusted
//  GET  /api/tasks/:id/progress       task view (stage, %, age, stale, evidence refs)
//  GET  /api/projects/:id/progress    rollup over ALL project tasks + one lane per task
//  GET  /api/progress/audit?task_id=  append-only audit trail for one task
// Progress never changes task status or lifecycle: it is a separate axis.
import { PmError } from './store.mjs'
import { migrateProgress, recordProgress, taskProgress, projectRollup, auditTrail, ProgressError } from './progress.mjs'

const STATUS = { BAD_REQUEST: 400, UNTRUSTED_SOURCE: 403, FORBIDDEN: 403, UNKNOWN_TASK: 404, CROSS_PROJECT: 403, RUN_MISMATCH: 409, CONFLICT: 409, GENERATION: 409, BAD_STAGE: 422 }
export const DEFAULT_TRUSTED_AGENTS = ['dsh-feed', 'dsh-bridge', 'dsh-runner', 'pm-runner']

/** trusted agents = defaults + comma list in env PM_PROGRESS_TRUSTED; opts.trusted (array) replaces the defaults. */
export function trustedAgentFn(env = process.env, extra = null) {
  const set = new Set(extra ?? DEFAULT_TRUSTED_AGENTS)
  for (const a of String(env.PM_PROGRESS_TRUSTED || '').split(',').map((s) => s.trim()).filter(Boolean)) set.add(a)
  return (agent) => typeof agent === 'string' && set.has(agent)
}

const wrap = (fn) => { try { return fn() } catch (e) { if (e instanceof ProgressError) throw new PmError(STATUS[e.code] ?? 400, e.message, { code: e.code }); throw e } }

export function progressRoutes(store, { trusted = trustedAgentFn(), now = () => Date.now() } = {}) {
  const db = store.db
  migrateProgress(db)
  const taskProject = (id) => db.prepare('SELECT project_id FROM tasks WHERE id=?').get(id)?.project_id ?? null
  const runOwner = (id) => { const r = db.prepare('SELECT task_id FROM runs WHERE id=?').get(id); return r ? { task_id: r.task_id } : null }
  const resolveProject = (ref) => db.prepare('SELECT id FROM projects WHERE id=? OR name=?').get(ref, ref)?.id ?? null
  // a token principal limited to some projects sees only those; loopback/peer/'*' see all
  const visible = (principal) => (!principal || principal.projects?.includes('*') || !principal.projects) ? null : new Set(principal.projects)
  const canWrite = (principal, project) => { const v = visible(principal); return !v || v.has(project) }
  return [
    ['POST', /^\/api\/progress\/events$/, (m, b, w, q, principal) => wrap(() => {
      if (!w.actor) throw new PmError(400, 'actor is required')
      const list = Array.isArray(b.events) ? b.events : [b]
      if (list.length > 500) throw new PmError(413, 'at most 500 events per request')
      const out = []
      for (const ev of list) {
        if (!canWrite(principal, ev.project_id)) throw new PmError(403, 'project not visible to this principal', { code: 'FORBIDDEN' })
        try { out.push({ event_key: ev.event_key, ...(({ status, snapshot }) => ({ status, percent: snapshot?.percent ?? null, stage: snapshot?.stage ?? null }))(recordProgress(db, ev, { actor: w.actor, trustedAgents: trusted, taskProject, runOwner })) }) }
        catch (e) { if (list.length === 1) throw e; out.push({ event_key: ev?.event_key, status: 'rejected', code: e.code, error: e.message }) }
      }
      return { results: out }
    })],
    ['GET', /^\/api\/tasks\/([\w-]+)\/progress$/, (m, b, w, q, principal) => wrap(() => {
      if (!taskProject(m[1])) throw new PmError(404, `no task ${m[1]}`)
      const v = visible(principal)
      if (v && !v.has(taskProject(m[1]))) throw new PmError(403, 'project not visible', { code: 'FORBIDDEN' })
      return taskProgress(db, m[1], { now: now() })
    })],
    ['GET', /^\/api\/projects\/([\w-]+)\/progress$/, (m, b, w, q, principal) => wrap(() => {
      const pid = resolveProject(decodeURIComponent(m[1]))
      if (!pid) throw new PmError(404, `no project ${m[1]}`)
      const v = visible(principal)
      if (v && !v.has(pid)) throw new PmError(403, 'project not visible', { code: 'FORBIDDEN' })
      const tasks = db.prepare('SELECT id, title, status, lifecycle FROM tasks WHERE project_id=? ORDER BY title').all(pid)
      const opts = { now: now() }
      const lanes = tasks.map((t) => ({ task_id: t.id, title: t.title, status: t.status, lifecycle: t.lifecycle, progress: taskProgress(db, t.id, opts) }))
      return { project_id: pid, now: new Date(opts.now).toISOString(), rollup: projectRollup(db, pid, tasks.map((t) => t.id), opts), lanes }
    })],
    ['GET', /^\/api\/progress\/audit$/, (m, b, w, q, principal) => wrap(() => {
      if (!q.task_id) throw new PmError(400, 'task_id required')
      const p = taskProject(q.task_id)
      if (!p) throw new PmError(404, `no task ${q.task_id}`)
      const v = visible(principal)
      if (v && !v.has(p)) throw new PmError(403, 'project not visible', { code: 'FORBIDDEN' })
      return auditTrail(db, q.task_id)
    })],
  ]
}
