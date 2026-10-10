// Model choice and quota gate for bridge executions. Model choice goes through
// the existing DSH weight router (resolveRoster in the harness); the bridge
// supplies only the candidate list. No router = no unpinned execution.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { BridgeError } from './protocol.mjs'

export function defaultRouterPath() {
  return process.env.BRIDGE_ROUTER ||
    join(homedir(), 'Documents', 'claudecode', 'deepseek-harness', 'packages', 'council', 'tool-council', 'src', 'router', 'index.ts')
}

/** Claude Code candidates the bridge can run. Overridable with BRIDGE_CANDIDATES (JSON). */
export function defaultCandidates() {
  if (process.env.BRIDGE_CANDIDATES) return JSON.parse(process.env.BRIDGE_CANDIDATES)
  const base = { provider: 'anthropic', costClass: 'included', contextTokens: 200_000, available: true, tools: ['code'] }
  return [
    { ...base, id: 'claude-haiku', model: 'haiku', capabilities: { reasoning: 'medium', code: 'medium' }, throughputTokensPerSecond: 150 },
    { ...base, id: 'claude-sonnet', model: 'sonnet', capabilities: { reasoning: 'high', code: 'high' }, throughputTokensPerSecond: 80 },
    { ...base, id: 'claude-opus', model: 'opus', capabilities: { reasoning: 'high', code: 'high' }, throughputTokensPerSecond: 50 },
  ]
}

let routerPromise = null
export function loadRouter(path = defaultRouterPath()) {
  if (!existsSync(path)) return Promise.resolve(null)
  routerPromise ??= import(pathToFileURL(path).href).catch(() => null)
  return routerPromise
}

/**
 * Pick a model. A pinned model is honored only if it is one of the candidates.
 * Returns { model, candidateId, assignment|null, rejections, pinned }.
 */
export async function chooseModel({ pinned, capability = 'medium', policy = 'TOKEN_EFFICIENT', quotaHeadroom } = {}, { router, candidates = defaultCandidates() } = {}) {
  const cands = candidates.map((c) => ({ ...c, quotaHeadroom: quotaHeadroom ?? c.quotaHeadroom }))
  if (pinned) {
    const c = cands.find((x) => x.model === pinned || x.id === pinned)
    if (!c) throw new BridgeError(400, `model ${pinned} is not a bridge candidate (${cands.map((x) => x.model).join(', ')})`)
  }
  const r = router === undefined ? await loadRouter() : router
  if (!r?.resolveRoster) {
    if (pinned) return { model: pinned, candidateId: pinned, assignment: null, rejections: [], pinned: true, router: 'unavailable' }
    throw new BridgeError(503, 'weight router unavailable and no model pinned; refusing to guess')
  }
  const role = { id: 'executor', capabilities: { code: capability, reasoning: capability } }
  const ctx = {
    policy: pinned ? 'FIXED_ROSTER' : policy,
    requiredRoster: pinned ? { executor: cands.find((x) => x.model === pinned || x.id === pinned).id } : undefined,
    estimatedOutputTokens: 4000,
    estimatedPromptTokens: 8000,
    minQuotaHeadroom: 0.05,
  }
  const res = r.resolveRoster([role], cands, ctx)
  const a = res.assignments[0]
  if (!a) throw new BridgeError(429, `weight router filled no executor: ${res.rejections.map((x) => `${x.candidateId}:${x.code}`).join(', ')}`, { rejections: res.rejections })
  return { model: a.model, candidateId: a.candidateId, assignment: a, rejections: res.rejections, pinned: Boolean(pinned), router: 'dsh' }
}

/** Claude subscription quota from the status-line cache. Fails closed when unknown. */
export function quotaGate({ file = join(homedir(), '.claude', 'statusline', 'usage-cache.json'), limit = Number(process.env.BRIDGE_QUOTA_LIMIT) || 95, maxAgeHours = 24, clock = () => new Date() } = {}) {
  if (process.env.BRIDGE_QUOTA_FILE === 'off') return { ok: true, note: 'quota gate disabled by BRIDGE_QUOTA_FILE=off' }
  const path = process.env.BRIDGE_QUOTA_FILE || file
  if (!existsSync(path)) return { ok: false, reason: `quota unknown: ${path} missing` }
  const q = JSON.parse(readFileSync(path, 'utf8'))
  const ageH = (clock().getTime() - Number(q.capturedAt)) / 3_600_000
  if (!(ageH <= maxAgeHours)) return { ok: false, reason: `quota reading is ${ageH.toFixed(1)} h old` }
  const worst = Math.max(Number(q.weekPercent) || 0, Number(q.sessionPercent) || 0)
  if (worst >= limit) return { ok: false, reason: `quota at ${worst}% (limit ${limit}%)`, week: q.weekPercent, session: q.sessionPercent }
  return { ok: true, week: q.weekPercent, session: q.sessionPercent, headroom: (100 - worst) / 100, ageHours: Number(ageH.toFixed(2)) }
}
