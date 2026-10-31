// Blitz repo integration rules loader (Claude Opus 5.5).
//
// server.mjs main() loads ~/.claude/pm-data/blitz-repo-rules.json (BLITZ_REPO_RULES overrides the path):
//   { "<repo path>": { "target": "main", "allowMerge": true, "protectedTargets"?: ["release"], "risk"?: {...} } }
// and hands it to the engine's integrator. Missing file, unreadable file, invalid JSON or a non-object
// root -> {} (nothing ever merges), logged once. Entries without a string `target` or with allowMerge
// other than true are dropped (logged), so a malformed entry never merges. Lookups are path-normalized
// (resolve + case-insensitive on Windows), so `C:\x\repo`, `c:/x/repo` and `C:\x\repo\` name one repo.
// Nothing here pushes; integrate.mjs's git runner refuses push argv.
import * as nodeFs from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const REPO_RULES_ENV = 'BLITZ_REPO_RULES'
export const DEFAULT_REPO_RULES_PATH = join(homedir(), '.claude', 'pm-data', 'blitz-repo-rules.json')

export const repoKey = (p) => {
  const r = resolve(String(p)).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** Wraps a {repo: rule} map so rules[x] also finds the entry under any spelling of the same path. */
export function normalizedRules(map = {}) {
  const byKey = new Map(Object.entries(map).map(([k, v]) => [repoKey(k), v]))
  return new Proxy(map, {
    get(t, k) {
      if (typeof k !== 'string') return Reflect.get(t, k)
      if (Object.prototype.hasOwnProperty.call(t, k)) return t[k]
      if (!k || !/[\\/]/.test(k)) return undefined
      return byKey.get(repoKey(k))
    },
  })
}

/**
 * @returns {rules, path, loaded:boolean, error:string|null, dropped:[{repo, reason}]}
 * `rules` is always usable: {} when nothing valid was loaded.
 */
export function loadRepoRules(path = DEFAULT_REPO_RULES_PATH, { fs = nodeFs, log = console } = {}) {
  const none = (error) => {
    log?.warn?.(`blitz repo rules: ${error}; integration merges nothing`)
    return { rules: normalizedRules({}), path, loaded: false, error, dropped: [] }
  }
  let text
  try {
    if (!fs.existsSync(path)) return none(`no rules file at ${path}`)
    text = fs.readFileSync(path, 'utf8')
  } catch (err) { return none(`cannot read ${path}: ${err?.message ?? err}`) }
  let raw
  try { raw = JSON.parse(String(text).replace(/^\uFEFF/, '')) } catch (err) { return none(`invalid JSON in ${path}: ${err?.message ?? err}`) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return none(`${path} is not a {repoPath: rule} object`)
  const rules = {}
  const dropped = []
  for (const [repo, r] of Object.entries(raw)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { dropped.push({ repo, reason: 'rule is not an object' }); continue }
    if (typeof r.target !== 'string' || !r.target.trim()) { dropped.push({ repo, reason: 'no target branch' }); continue }
    if (r.allowMerge !== true) { dropped.push({ repo, reason: 'allowMerge is not true' }); continue }
    if (r.protectedTargets !== undefined && !(Array.isArray(r.protectedTargets) && r.protectedTargets.every((x) => typeof x === 'string'))) { dropped.push({ repo, reason: 'protectedTargets is not a list of branch names' }); continue }
    if (r.risk !== undefined && (!r.risk || typeof r.risk !== 'object' || Array.isArray(r.risk))) { dropped.push({ repo, reason: 'risk is not an object' }); continue }
    rules[repo] = { target: r.target.trim(), allowMerge: true, ...(r.protectedTargets ? { protectedTargets: r.protectedTargets } : {}), ...(r.risk ? { risk: r.risk } : {}) }
  }
  if (dropped.length) log?.warn?.(`blitz repo rules: dropped ${dropped.length} invalid entr${dropped.length === 1 ? 'y' : 'ies'}: ${dropped.map((d) => `${d.repo} (${d.reason})`).join(', ')}`)
  log?.log?.(`blitz repo rules: ${Object.keys(rules).length} repo(s) allow local merges (${path}); nothing pushes`)
  return { rules: normalizedRules(rules), path, loaded: Object.keys(rules).length > 0, error: null, dropped }
}
