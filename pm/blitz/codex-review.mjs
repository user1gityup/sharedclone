// Codex independent review for the BLITZ-07 verifier (Claude Opus 5.5).
//
// createCodexReview() returns the `review` function createVerifier/createEngine take. It runs the Codex
// CLI headless as an independent, read-only reviewer inside the task's git worktree:
//
//   <codex> exec --cd <worktree> --sandbox read-only --json --output-last-message <tmp>/last-message.json [-m <pin>] -
//
// (the same style as the codex dispatch adapter in dispatch.mjs; flags checked against `codex exec --help`,
// codex-cli 0.153.4). The prompt goes on stdin: task title/body, numbered acceptance criteria, the diff vs
// the task's base (`git diff <base>...HEAD`, plus uncommitted changes and `git status`), and the check
// evidence verify.mjs collected. Codex must answer with one strict JSON object:
//   {"verified": boolean, "criteria": [{"id": n, "criterion": "...", "met": true|false|null, "evidence": "..."}], "reason": "..."}
//
// Fail-closed mapping to verify.mjs's review contract ({agent, verdict:'pass'|'fail'|'uncertain', criteria, reason}):
//   pass       verified === true AND every acceptance criterion matched with met === true
//   fail       some criterion met === false and verified !== true (the work is reviewed and rejected)
//   uncertain  everything else: nonzero exit, timeout, spawn error, missing/garbled/contradictory JSON,
//              an unassessed criterion, no diff base, git failure, refused independence. The task stays open.
// Every verdict is signed with the verifier agent's name (verify.mjs's independence check), and the review
// refuses outright (no Codex run) when the verifier is missing or is one of the task's builders.
//
// createDefaultPolicy() is the default verification policy for tasks without meta.blitz.acceptance/checks:
//   acceptance  meta.blitz.acceptance, else DEFAULT_CRITERION plus checklist / "Acceptance" / "Deliverable"
//               lines parsed from the task body.
//   checks      repoChecks[project id | repo path] if given, else detected in the worktree at verify time:
//               package.json with a real `test` script -> `npm test`; pytest config -> `python -m pytest -q`;
//               node test files (*.test.mjs|js|cjs, test/ dir) -> `node --test`.
//   reviewOnly  RULE: when no runnable check exists, ONLY a docs/research task (task.kind or meta.blitz.kind in
//               REVIEW_ONLY_KINDS) may be verified on the Codex review alone. Every other task stays
//               awaiting_verification with the reason "no runnable check ...". A review-only pass still needs an
//               independent verifier, an isolated worktree and every criterion met === true.
//
// codexReviewEngineOptions(env) is what server.mjs spreads into createEngine: {} unless BLITZ_CODEX_REVIEW=1.
import { spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { codexEntry, defaultGit, redact } from './dispatch.mjs'
import { parseMeta } from './rating.mjs'

export const ENABLE_REVIEW_ENV = 'BLITZ_CODEX_REVIEW'
export const REPO_CHECKS_ENV = 'BLITZ_REPO_CHECKS'
export const DEFAULT_REVIEW_TIMEOUT_MS = 20 * 60 * 1000
export const DEFAULT_GIT_TIMEOUT_MS = 60 * 1000
export const MAX_DIFF_CHARS = 150_000
export const DEFAULT_CRITERION = "The task body's stated deliverables are implemented and working, with evidence"
export const REVIEW_ONLY_KINDS = new Set(['docs', 'doc', 'documentation', 'research'])

const sha = (s) => createHash('sha256').update(String(s ?? '')).digest('hex')
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s }
const norm = (s) => String(s ?? '').toLowerCase().replace(/[`*_"'.,;:!?()\[\]]/g, ' ').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- default policy

/** Acceptance criteria: meta.blitz.acceptance, else the default criterion plus lines parsed from the body. */
export function deriveAcceptance(task) {
  const own = parseMeta(task).blitz?.acceptance
  const list = (Array.isArray(own) ? own : []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
  if (list.length) return list
  return [DEFAULT_CRITERION, ...parseBodyCriteria(task?.body)]
}

/**
 * Criteria lines from a task body: markdown checklist items (`- [ ] x`, `* [x] y`), list items under a heading or
 * label naming Acceptance / Deliverable(s) / Definition of done, and inline `Acceptance: x` / `Deliverable: y` lines.
 */
export function parseBodyCriteria(body, { max = 20, maxLen = 300 } = {}) {
  const out = []
  const add = (s) => {
    s = String(s ?? '').replace(/\s+/g, ' ').trim()
    if (!s || s.length < 3) return
    if (s.length > maxLen) s = `${s.slice(0, maxLen - 1)}…`
    if (!out.some((x) => norm(x) === norm(s)) && norm(s) !== norm(DEFAULT_CRITERION)) out.push(s)
  }
  const HEAD = /^(?:#{1,6}\s*|\*\*)?\s*(acceptance(?:\s+criteria)?|deliverables?|definition\s+of\s+done)\s*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/i
  const INLINE = /^(?:[-*+]\s+)?(?:\*\*)?(acceptance(?:\s+criteria)?|deliverables?)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+)$/i
  const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/
  const CHECK = /^\s*[-*+]\s+\[[ xX]\]\s+(.+)$/
  let inSection = false
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    if (HEAD.test(line.trim())) { inSection = true; continue }
    if (/^#{1,6}\s/.test(line.trim())) { inSection = false; continue }
    const c = line.match(CHECK)
    if (c) { add(c[1]); continue }
    const inl = line.trim().match(INLINE)
    if (inl) { add(inl[2]); continue }
    if (inSection) {
      const it = line.match(ITEM)
      if (it) add(it[1])
      else if (!/^\s/.test(raw)) inSection = false // a plain paragraph ends the list
    }
    if (out.length >= max) break
  }
  return out
}

/** The task's kind for the review-only rule: task.kind, meta.blitz.kind, meta.kind (lowercased). */
export function taskKind(task) {
  const m = parseMeta(task)
  for (const k of [task?.kind, m.blitz?.kind, m.kind]) if (typeof k === 'string' && k.trim()) return k.trim().toLowerCase()
  return null
}

export const isReviewOnlyKind = (task, kinds = REVIEW_ONLY_KINDS) => kinds.has(taskKind(task) ?? '')

const repoKey = (p) => { const r = resolve(String(p)); return process.platform === 'win32' ? r.toLowerCase() : r }

/** repoChecks lookup: by project id, then by repo path (meta repo or the result's repo). */
function mappedChecks(repoChecks, task, result) {
  if (!repoChecks || typeof repoChecks !== 'object') return null
  if (task?.project_id && Array.isArray(repoChecks[task.project_id])) return repoChecks[task.project_id]
  const m = parseMeta(task)
  const repos = [m.blitz?.repo, m.repo, result?.repo].filter((x) => typeof x === 'string' && x.trim())
  const keyed = Object.fromEntries(Object.entries(repoChecks).map(([k, v]) => [repoKey(k), v]))
  for (const r of repos) if (Array.isArray(keyed[repoKey(r)])) return keyed[repoKey(r)]
  return null
}

/** Check commands detected in a worktree: npm test, pytest, node --test. [] when none is runnable. */
export function detectRepoChecks(worktree, { fs = nodeFs } = {}) {
  const has = (p) => { try { return fs.existsSync(join(worktree, p)) } catch { return false } }
  const read = (p) => { try { return fs.readFileSync(join(worktree, p), 'utf8') } catch { return '' } }
  const list = (p) => { try { return fs.readdirSync(join(worktree, p)) } catch { return [] } }
  const out = []
  let pkg = null
  if (has('package.json')) { try { pkg = JSON.parse(read('package.json')) } catch { pkg = null } }
  const testScript = typeof pkg?.scripts?.test === 'string' ? pkg.scripts.test.trim() : ''
  if (testScript && !/no test specified/i.test(testScript)) out.push({ name: 'npm-test', cmd: 'npm test', source: 'detected: package.json scripts.test' })

  const pyproject = read('pyproject.toml')
  const pytest = /\[tool\.pytest/.test(pyproject) || /\bpytest\b/.test(pyproject) || has('pytest.ini') || has('conftest.py')
    || /\[tool:pytest\]/.test(read('setup.cfg')) || /\[pytest\]/.test(read('tox.ini'))
  if (pytest) out.push({ name: 'pytest', cmd: 'python -m pytest -q', source: 'detected: pytest config' })

  if (!out.some((c) => c.name === 'npm-test')) {
    const TEST_FILE = /\.test\.(mjs|cjs|js)$/
    const nodeTests = list('.').some((f) => TEST_FILE.test(f)) || ['test', 'tests'].some((d) => list(d).some((f) => /\.(mjs|cjs|js)$/.test(f)))
    if (nodeTests) out.push({ name: 'node-test', cmd: 'node --test', source: 'detected: node test files' })
  }
  return out
}

/**
 * Default verification policy (see header). repoChecks: {<project id | repo path>: [cmd | {name, cmd, timeoutMs}]}.
 */
export function createDefaultPolicy({ repoChecks = {}, fs = nodeFs, reviewOnlyKinds = REVIEW_ONLY_KINDS } = {}) {
  return {
    acceptance: (task) => deriveAcceptance(task),
    checks(task, { workspace, result } = {}) {
      const mapped = mappedChecks(repoChecks, task, result)
      if (mapped) {
        return mapped.map((c, i) => (typeof c === 'string' ? { name: `repo-check-${i + 1}`, cmd: c } : { name: c?.name ?? `repo-check-${i + 1}`, cmd: c?.cmd, timeoutMs: c?.timeoutMs }))
          .filter((c) => typeof c.cmd === 'string' && c.cmd.trim()).map((c) => ({ ...c, source: 'repoChecks' }))
      }
      return workspace ? detectRepoChecks(workspace, { fs }) : []
    },
    reviewOnly: (task) => isReviewOnlyKind(task, reviewOnlyKinds),
  }
}

// ---------------------------------------------------------------- verdict parsing

/** Pull the first JSON object out of a model message: whole text, a ```json fence, or the outermost braces. */
export function extractJson(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  const tries = [s]
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) tries.push(fence[1].trim())
  const a = s.indexOf('{'); const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) tries.push(s.slice(a, b + 1))
  for (const t of tries) {
    try { const v = JSON.parse(t); if (v && typeof v === 'object' && !Array.isArray(v)) return v } catch { /* next */ }
  }
  return null
}

/** The last agent message in `codex exec --json` stdout (JSONL), used only when the last-message file is missing. */
export function lastAgentMessage(jsonl) {
  let last = null
  for (const line of String(jsonl ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    const item = e?.item ?? e?.msg ?? e
    const type = item?.type ?? item?.item_type
    if ((type === 'agent_message' || type === 'assistant_message') && typeof (item.text ?? item.message) === 'string') last = item.text ?? item.message
  }
  return last
}

/**
 * Maps Codex's JSON onto the canonical acceptance list. Returns {verdict, reason, criteria} for verify.mjs.
 * Fail-closed: anything missing, malformed or contradictory is 'uncertain'.
 */
export function parseVerdict(text, acceptance) {
  const j = extractJson(text)
  if (!j) return { verdict: 'uncertain', reason: 'codex output is not a JSON verdict', criteria: [] }
  if (typeof j.verified !== 'boolean') return { verdict: 'uncertain', reason: 'codex verdict has no boolean "verified"', criteria: [] }
  if (!Array.isArray(j.criteria)) return { verdict: 'uncertain', reason: 'codex verdict has no "criteria" list', criteria: [] }
  const reason = typeof j.reason === 'string' ? j.reason.trim().slice(0, 2000) : ''
  const got = j.criteria.filter((c) => c && typeof c === 'object')
  const criteria = acceptance.map((criterion, i) => {
    const hit = got.find((c) => Number(c.id) === i + 1 && (c.criterion === undefined || norm(c.criterion) === norm(criterion)))
      ?? got.find((c) => typeof c.criterion === 'string' && norm(c.criterion) === norm(criterion))
      ?? got.find((c) => Number(c.id) === i + 1)
    const met = hit && (hit.met === true || hit.met === false) ? hit.met : null
    return { criterion, met, note: typeof hit?.evidence === 'string' ? hit.evidence.slice(0, 1000) : (typeof hit?.note === 'string' ? hit.note.slice(0, 1000) : null) }
  })
  const unmet = criteria.filter((c) => c.met === false)
  const unknown = criteria.filter((c) => c.met === null)
  if (j.verified === true) {
    if (unmet.length) return { verdict: 'uncertain', reason: `contradictory codex verdict: verified=true but unmet: ${unmet.map((c) => c.criterion).join('; ')}`, criteria }
    if (unknown.length) return { verdict: 'uncertain', reason: `codex did not assess: ${unknown.map((c) => c.criterion).join('; ')}`, criteria }
    return { verdict: 'pass', reason: reason || 'all criteria met', criteria }
  }
  if (unmet.length) return { verdict: 'fail', reason: reason || `unmet: ${unmet.map((c) => c.criterion).join('; ')}`, criteria }
  return { verdict: 'uncertain', reason: `codex did not verify and named no unmet criterion${reason ? `: ${reason}` : ''}`, criteria }
}

// ---------------------------------------------------------------- prompt

export function reviewPrompt({ task, acceptance, checks, diff, reviewOnly, base, verifier }) {
  const crit = acceptance.map((c, i) => `${i + 1}. ${redact(c)}`).join('\n')
  const ev = (checks ?? []).map((c) => [
    `- ${c.name}: \`${c.cmd}\` exit ${c.exit_code}${c.timed_out ? ' (timed out)' : ''} in ${c.cwd}`,
    c.stdout_tail ? `  stdout tail:\n${clip(redact(c.stdout_tail), 3000).replace(/^/gm, '    ')}` : '',
    c.stderr_tail ? `  stderr tail:\n${clip(redact(c.stderr_tail), 1500).replace(/^/gm, '    ')}` : '',
  ].filter(Boolean).join('\n')).join('\n') || (reviewOnly ? '(none: docs/research task, review only)' : '(none)')
  return [
    `You are ${verifier}, an INDEPENDENT code reviewer for a pm Blitz task. You did not build this work.`,
    'You are in a read-only sandbox in the task\'s git worktree. Do not modify files. You may read files and run read-only commands (git log, git diff, cat) to check claims.',
    'Decide, for each acceptance criterion, whether the work in this worktree meets it. Be strict: mark met=true only with concrete evidence (file, function, test, check output). If you cannot tell, use met=null.',
    '',
    'Reply with EXACTLY one JSON object and nothing else, in this shape:',
    '{"verified": <true only if every criterion is met>, "criteria": [{"id": <criterion number>, "criterion": "<the criterion text, verbatim>", "met": true|false|null, "evidence": "<short evidence>"}], "reason": "<one paragraph>"}',
    '',
    `# Task ${task.id}: ${redact(task.title ?? '')}`,
    '',
    clip(redact(task.body ?? '(no body)'), 20_000),
    '',
    '# Acceptance criteria',
    crit,
    '',
    '# Check evidence (run by the pm verifier in this worktree)',
    ev,
    '',
    `# Diff vs base ${base}`,
    '```diff',
    diff || '(empty diff)',
    '```',
  ].join('\n')
}

// ---------------------------------------------------------------- codex runner

/** Spawns one process with stdin input and a timeout. Resolves {code, stdout, stderr, timedOut, error}; never rejects. */
export function runWithTimeout(spawn, cmd, args, { cwd, env, input, timeoutMs }) {
  return new Promise((done) => {
    let child
    try { child = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) } catch (err) { return done({ code: null, stdout: '', stderr: '', timedOut: false, error: String(err?.message ?? err) }) }
    let stdout = ''; let stderr = ''; let settled = false; let timedOut = false
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); done(r) } }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        else child.kill?.('SIGKILL')
      } catch { try { child.kill?.() } catch { /* gone */ } }
      finish({ code: null, stdout, stderr, timedOut: true, error: `timed out after ${timeoutMs} ms` })
    }, timeoutMs)
    child.stdout?.on('data', (d) => { if (stdout.length < 4e6) stdout += d })
    child.stderr?.on('data', (d) => { if (stderr.length < 1e6) stderr += d })
    child.on('error', (err) => finish({ code: null, stdout, stderr, timedOut, error: String(err?.message ?? err) }))
    child.on('close', (code) => finish({ code: timedOut ? null : code, stdout, stderr, timedOut, error: null }))
    try { child.stdin?.end(input) } catch { /* error event reports it */ }
  })
}

/** The diff base: meta.blitz.base (unless HEAD), result.base, else the source repo's current HEAD commit. */
async function resolveBase({ task, result, git, timeoutMs }) {
  const metaBase = parseMeta(task).blitz?.base
  if (typeof metaBase === 'string' && metaBase.trim() && metaBase.trim() !== 'HEAD') return { base: metaBase.trim() }
  if (typeof result?.base === 'string' && result.base.trim() && result.base.trim() !== 'HEAD') return { base: result.base.trim() }
  if (typeof result?.repo === 'string' && result.repo.trim()) {
    try {
      const r = await git(['-C', result.repo, 'rev-parse', 'HEAD'], { timeoutMs })
      const h = String(r.stdout ?? '').trim()
      if (r.code === 0 && /^[0-9a-f]{7,64}$/i.test(h)) return { base: h }
      return { error: `git rev-parse HEAD in ${result.repo} failed (${r.code})` }
    } catch (err) { return { error: `git rev-parse HEAD in ${result.repo}: ${String(err?.message ?? err)}` } }
  }
  return { error: 'no diff base: task has no meta.blitz.base and the result names no repo' }
}

/**
 * @param o.spawn       spawn-compatible fn (default node:child_process.spawn); every Codex run goes through it
 * @param o.git         async (args, {cwd, timeoutMs}) => {code, stdout, stderr}; default git via the same spawn
 * @param o.entry       {cmd, pre} Codex entry (default dispatch.mjs codexEntry: BLITZ_CODEX_JS, npm global, `codex`)
 * @param o.env         env for the Codex process (default process.env)
 * @param o.fs          fs (tmp dir + last-message file)
 * @param o.timeoutMs   Codex run timeout (default 20 min)
 * @param o.model       fixed -m model, or o.modelFor(verifierName) / o.db (blitz_agents.model_policy.pin)
 */
export function createCodexReview({
  spawn = nodeSpawn, git, entry, env = process.env, fs = nodeFs, timeoutMs = DEFAULT_REVIEW_TIMEOUT_MS,
  gitTimeoutMs = DEFAULT_GIT_TIMEOUT_MS, model = null, modelFor = null, db = null, tmpRoot = tmpdir(), maxDiff = MAX_DIFF_CHARS,
} = {}) {
  const g = git ?? defaultGit(spawn)
  const ent = entry ?? codexEntry(env, fs)
  const pinOf = (name) => {
    if (model) return model
    if (modelFor) return modelFor(name) ?? null
    if (!db) return null
    try {
      const row = db.prepare('SELECT model_policy FROM blitz_agents WHERE name = ?').get(name)
      const mp = typeof row?.model_policy === 'string' ? JSON.parse(row.model_policy) : row?.model_policy
      return typeof mp?.pin === 'string' && mp.pin.trim() ? mp.pin.trim() : null
    } catch { return null }
  }

  /** Command line for one review (exported for the report and tests). */
  function command(worktree, lastMessage, verifierName) {
    const pin = pinOf(verifierName)
    return { cmd: ent.cmd, args: [...ent.pre, 'exec', '--cd', worktree, '--sandbox', 'read-only', '--json', '--output-last-message', lastMessage, ...(pin ? ['-m', pin] : []), '-'] }
  }

  async function review(a, b, c) {
    // verify.mjs calls review({task, result, verifier, builders, checks, acceptance, workspace, reviewOnly});
    // review(task, result, ctx) is accepted too.
    const x = b === undefined && a && typeof a === 'object' && 'task' in a ? a : { task: a, result: b, ...(c ?? {}) }
    const { task, result } = x
    const verifierName = x.verifier?.name ?? (typeof x.verifier === 'string' ? x.verifier : null)
    const builders = new Set([...(x.builders ?? []), ...(typeof x.agent === 'string' ? [x.agent] : [])])
    const workspace = x.workspace ?? result?.worktree ?? null
    const acceptance = Array.isArray(x.acceptance) && x.acceptance.length ? x.acceptance : deriveAcceptance(task)
    const out = (verdict, reason, extra = {}) => ({ agent: verifierName, verdict, reason, criteria: [], transport: 'codex', ...extra })

    if (!verifierName) return out('uncertain', 'refused: no verifier agent in ctx to sign the review')
    if (builders.has(verifierName)) return out('uncertain', `refused: verifier ${verifierName} built this task; a builder never reviews its own work`)
    if (typeof workspace !== 'string' || !workspace.trim()) return out('uncertain', 'refused: no task worktree to review')

    const b0 = await resolveBase({ task, result, git: g, timeoutMs: gitTimeoutMs })
    if (b0.error) return out('uncertain', b0.error)
    const gitText = async (args, what) => {
      try {
        const r = await g(['-C', workspace, ...args], { cwd: workspace, timeoutMs: gitTimeoutMs })
        if (r.code !== 0) return { error: `${what} failed (${r.code}): ${String(r.stderr ?? '').trim().slice(0, 300)}` }
        return { text: String(r.stdout ?? '') }
      } catch (err) { return { error: `${what}: ${String(err?.message ?? err)}` } }
    }
    const committed = await gitText(['diff', `${b0.base}...HEAD`], `git diff ${b0.base}...HEAD`)
    if (committed.error) return out('uncertain', committed.error)
    const uncommitted = await gitText(['diff', 'HEAD'], 'git diff HEAD')
    if (uncommitted.error) return out('uncertain', uncommitted.error)
    const status = await gitText(['status', '--porcelain'], 'git status')
    if (status.error) return out('uncertain', status.error)
    let diff = committed.text
    if (uncommitted.text.trim()) diff += `\n# --- uncommitted changes (git diff HEAD) ---\n${uncommitted.text}`
    if (status.text.trim()) diff += `\n# --- git status --porcelain ---\n${status.text}`
    const diffSha = sha(diff)
    diff = clip(redact(diff), maxDiff)

    const prompt = reviewPrompt({ task, acceptance, checks: x.checks, diff, reviewOnly: !!x.reviewOnly, base: b0.base, verifier: verifierName })
    let dir
    try { dir = fs.mkdtempSync(join(tmpRoot, 'blitz-codex-review-')) } catch (err) { return out('uncertain', `could not make a temp dir: ${String(err?.message ?? err)}`) }
    const lastMessage = join(dir, 'last-message.json')
    const { cmd, args } = command(workspace, lastMessage, verifierName)
    const t0 = Date.now()
    const r = await runWithTimeout(spawn, cmd, args, { cwd: workspace, env, input: prompt, timeoutMs })
    let text = null
    try { if (fs.existsSync(lastMessage)) text = fs.readFileSync(lastMessage, 'utf8') } catch { text = null }
    try { fs.rmSync?.(dir, { recursive: true, force: true }) } catch { /* temp */ }
    if (text === null || !text.trim()) text = lastAgentMessage(r.stdout)
    const run = {
      command: [cmd, ...args].join(' '), exit_code: r.code, timed_out: r.timedOut, error: r.error, duration_ms: Date.now() - t0,
      base: b0.base, diff_sha256: diffSha, prompt_sha256: sha(prompt), output_sha256: sha(text), stderr_tail: String(r.stderr ?? '').slice(-1000),
    }
    if (r.timedOut) return out('uncertain', `codex review timed out after ${timeoutMs} ms`, { run })
    if (r.error) return out('uncertain', `codex review could not run: ${r.error}`, { run })
    if (r.code !== 0) return out('uncertain', `codex review exited ${r.code}`, { run })
    const v = parseVerdict(text, acceptance)
    return { agent: verifierName, verdict: v.verdict, reason: v.reason, criteria: v.criteria, transport: 'codex', run, raw: String(text ?? '').slice(0, 4000) }
  }
  review.command = command
  return review
}

// ---------------------------------------------------------------- server wiring

/** createEngine options for server.mjs: {review, verifyPolicy} only when BLITZ_CODEX_REVIEW=1, else {} (fail closed). */
export function codexReviewEngineOptions(env = process.env, { db = null, spawn, fs } = {}) {
  if (env[ENABLE_REVIEW_ENV] !== '1') return {}
  let repoChecks = {}
  if (env[REPO_CHECKS_ENV]) {
    try { repoChecks = JSON.parse(env[REPO_CHECKS_ENV]) } catch { throw new Error(`${REPO_CHECKS_ENV} is not valid JSON`) }
  }
  return {
    review: createCodexReview({ env, db, ...(spawn ? { spawn } : {}), ...(fs ? { fs } : {}) }),
    verifyPolicy: createDefaultPolicy({ repoChecks, ...(fs ? { fs } : {}) }),
  }
}
