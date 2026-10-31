// BLITZ-03 (Q7): comprehensive task rating, stored in tasks.meta.blitz.rating.
// Pure validation plus a read-merge-write through store.updateTask: a plain PATCH
// replaces meta wholesale, so the rating route merges and keeps every other meta key.
import { PmError } from '../store.mjs'

const SCORES = ['priority', 'effort', 'complexity', 'risk']
const RATING_KEYS = [...SCORES, 'resources', 'dependency', 'verification', 'rationale']
const SERVER_KEYS = ['rated_by', 'rated_at', 'rated_model']
const MODEL_CLASSES = ['local', 'free', 'paid']
const QUOTA_COSTS = ['low', 'med', 'high']
export const VERIFICATION_LEVELS = ['unit', 'integration', 'manual', 'independent_review']
const TASK_ID = /^T-[\w-]+$/

const bad = (msg) => { throw new PmError(400, `rating: ${msg}`) }
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
function onlyKeys(o, allowed, where) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`unknown key ${where}${k}`)
}
function str(v, where, max) {
  if (typeof v !== 'string' || !v.trim()) bad(`${where} must be a non-empty string`)
  if (v.length > max) bad(`${where} longer than ${max}`)
  return v.trim()
}
function strList(v, where, { max = 50, len = 500, pattern } = {}) {
  if (!Array.isArray(v)) bad(`${where} must be a list`)
  if (v.length > max) bad(`${where} has more than ${max} entries`)
  return v.map((x, i) => {
    const s = str(x, `${where}[${i}]`, len)
    if (pattern && !pattern.test(s)) bad(`${where}[${i}] is not a task id`)
    return s
  })
}

/** Validates and normalizes a rating. Server-set keys are dropped, unknown keys refused. */
export function validateRating(input) {
  if (!isObj(input)) bad('body must be an object')
  const r = Object.fromEntries(Object.entries(input).filter(([k]) => !SERVER_KEYS.includes(k)))
  onlyKeys(r, RATING_KEYS, '')
  for (const k of RATING_KEYS) if (!(k in r)) bad(`${k} is required`)
  const out = {}
  for (const k of SCORES) {
    if (!Number.isInteger(r[k]) || r[k] < 1 || r[k] > 5) bad(`${k} must be an integer 1-5`)
    out[k] = r[k]
  }

  if (!isObj(r.resources)) bad('resources must be an object')
  onlyKeys(r.resources, ['machine', 'model_class', 'quota_cost', 'seats'], 'resources.')
  out.resources = {}
  if ('machine' in r.resources) out.resources.machine = str(r.resources.machine, 'resources.machine', 100)
  if ('model_class' in r.resources) {
    if (!MODEL_CLASSES.includes(r.resources.model_class)) bad(`resources.model_class must be one of ${MODEL_CLASSES.join(', ')}`)
    out.resources.model_class = r.resources.model_class
  }
  if ('quota_cost' in r.resources) {
    if (!QUOTA_COSTS.includes(r.resources.quota_cost)) bad(`resources.quota_cost must be one of ${QUOTA_COSTS.join(', ')}`)
    out.resources.quota_cost = r.resources.quota_cost
  }
  if ('seats' in r.resources) out.resources.seats = strList(r.resources.seats, 'resources.seats', { max: 20, len: 100 })

  if (!isObj(r.dependency)) bad('dependency must be an object')
  onlyKeys(r.dependency, ['depends_on', 'blocks'], 'dependency.')
  out.dependency = { depends_on: strList(r.dependency.depends_on, 'dependency.depends_on', { max: 100, len: 64, pattern: TASK_ID }) }
  if ('blocks' in r.dependency) out.dependency.blocks = strList(r.dependency.blocks, 'dependency.blocks', { max: 100, len: 64, pattern: TASK_ID })

  if (!isObj(r.verification)) bad('verification must be an object')
  onlyKeys(r.verification, ['level', 'tests'], 'verification.')
  if (!VERIFICATION_LEVELS.includes(r.verification.level)) bad(`verification.level must be one of ${VERIFICATION_LEVELS.join(', ')}`)
  out.verification = { level: r.verification.level }
  if ('tests' in r.verification) out.verification.tests = strList(r.verification.tests, 'verification.tests')

  out.rationale = str(r.rationale, 'rationale', 2000)
  return out
}

export function parseMeta(task) {
  if (isObj(task.meta)) return { ...task.meta }
  try { const m = JSON.parse(task.meta || '{}'); return isObj(m) ? m : {} } catch { return {} }
}

/** PUT /api/tasks/:id/rating body {rev, ...rating}. Stale rev -> 409 from updateTask. */
export function rateTask(store, w, id, body = {}) {
  const { rev, actor, model, ...rating } = body
  if (rev === undefined) throw new PmError(400, 'rev is required: pass the revision you rated')
  const norm = validateRating(rating)
  const task = store.getTask(id)
  const meta = parseMeta(task)
  const blitz = isObj(meta.blitz) ? meta.blitz : {}
  meta.blitz = { ...blitz, rating: { ...norm, rated_by: w.actor ?? null, rated_at: new Date().toISOString(), rated_model: w.model ?? null } }
  return store.updateTask(w, id, { rev, meta })
}
