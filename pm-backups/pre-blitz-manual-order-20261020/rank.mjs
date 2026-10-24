// Blitz top-N project ranking (BLITZ-02). Read-only over pm's projects and tasks.
// Rank keys, in order: projects.priority (NULL last), min open coding-task priority,
// count of priority-1 open coding tasks (more first), count of open coding tasks
// (more first), oldest open coding task (older first), project id. Every row carries
// its inputs so the order can be audited.
import { PmError } from '../store.mjs'

/** Task kinds that are never coding work: imported handoffs, brain notes, misc. */
export const NONCODING_KINDS = ['handoff', 'brain-project', 'other']
export const DEFAULT_TOP_N = 10
export const MAX_TOP_N = 100

export function parseMeta(t) {
  if (t?.meta && typeof t.meta === 'object') return t.meta
  try { return JSON.parse(t?.meta || '{}') ?? {} } catch { return {} }
}

export function isOpen(t) {
  return t.status !== 'done' && !['ARCHIVED', 'COMPLETE'].includes(t.lifecycle)
}

/** Why a task is not coding work, or null when it is. `meta.blitz.coding` overrides the kind. */
export function noncodingReason(t) {
  const coding = parseMeta(t).blitz?.coding
  if (coding === false) return 'meta.blitz.coding=false'
  if (coding === true) return null
  if (NONCODING_KINDS.includes(t.kind)) return `kind ${t.kind}`
  return null
}

/** `projects` as an array or a comma-separated string; ids or names. */
export function parseProjectList(projects) {
  if (projects === undefined || projects === null || projects === '') return null
  const list = Array.isArray(projects) ? projects : String(projects).split(',')
  const out = list.map((p) => String(p).trim()).filter(Boolean)
  return out.length ? out : null
}

function parseN(n) {
  if (n === undefined || n === null || n === '') return DEFAULT_TOP_N
  const v = Number(n)
  if (!Number.isInteger(v) || v < 1 || v > MAX_TOP_N) throw new PmError(400, `n must be an integer 1..${MAX_TOP_N}`)
  return v
}

function inputsFor(db, project) {
  const tasks = db.prepare('SELECT id, status, lifecycle, kind, priority, created_at, meta FROM tasks WHERE project_id = ?').all(project.id)
    .map((r) => ({ ...r }))
  const open = tasks.filter((t) => isOpen(t) && !noncodingReason(t))
  return {
    project_priority: project.priority ?? null,
    min_open_priority: open.length ? Math.min(...open.map((t) => t.priority)) : null,
    p1_open: open.filter((t) => t.priority === 1).length,
    open_coding: open.length,
    oldest_open: open.length ? open.map((t) => t.created_at).sort()[0] : null,
  }
}

const nullsLast = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1)

export function compareRanked(a, b) {
  const x = a.inputs
  const y = b.inputs
  return nullsLast(x.project_priority, y.project_priority)
    || nullsLast(x.min_open_priority, y.min_open_priority)
    || y.p1_open - x.p1_open
    || y.open_coding - x.open_coding
    || nullsLast(x.oldest_open, y.oldest_open)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Top-N projects. With `projects` the caller's list (ids or names) is used in the
 * caller's order instead of the ranking; unknown or archived entries are a 400.
 */
export function topProjects(db, { n, projects } = {}) {
  const cap = parseN(n)
  const explicit = parseProjectList(projects)
  if (explicit) {
    const seen = new Set()
    const rows = []
    for (const ref of explicit) {
      const p = db.prepare('SELECT * FROM projects WHERE id = ? OR name = ?').get(ref, ref)
      if (!p) throw new PmError(400, `unknown project ${ref}`)
      if (p.status !== 'active') throw new PmError(400, `project ${ref} is ${p.status}`)
      if (seen.has(p.id)) continue
      seen.add(p.id)
      rows.push({ id: p.id, name: p.name, inputs: inputsFor(db, p) })
    }
    return { mode: 'explicit', n: cap, projects: rows.slice(0, cap).map((r, i) => ({ rank: i + 1, ...r })) }
  }
  const rows = db.prepare("SELECT * FROM projects WHERE status = 'active'").all()
    .map((p) => ({ id: p.id, name: p.name, inputs: inputsFor(db, p) }))
    .filter((r) => r.inputs.open_coding > 0)
    .sort(compareRanked)
  return { mode: 'ranked', n: cap, projects: rows.slice(0, cap).map((r, i) => ({ rank: i + 1, ...r })) }
}
