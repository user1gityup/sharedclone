// BLITZ-07 independent verification (Claude Opus 5.5). Plugs into createController as `verify`.
//
// A task is verified only when ALL of these hold:
//   1. an independent verifier exists: a roster agent with role `verifier` that did not build
//      the task (the builder is the campaign row's `agent`, plus any agent the result names);
//   2. the task names check commands (meta.blitz.checks, or levelChecks[rating.verification.level]),
//      or, with a default `policy`, a check is detected in the worktree; with no runnable check at all,
//      only a docs/research task may pass on review alone (policy.reviewOnly), every other task stays open;
//   3. the task names acceptance criteria (meta.blitz.acceptance, or the policy's derived criteria);
//   4. the result names an isolated workspace (a per-task worktree, not the repo checkout);
//   5. every check ran there and exited 0 (real integer exit code, no timeout, no runner error);
//   6. the injected verifier review, run as the verifier agent, passes every acceptance criterion.
// Failed checks or a failing review -> {failed:true}. Anything uncertain (missing checks, no
// verifier, a timeout, review not wired, UI-only evidence) -> neither verified nor failed, so the
// controller keeps the task awaiting_verification. Evidence (command, exit code, output tails,
// sha256 of full output, timestamps) is written as blitz_run_events and returned as `evidence`.
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { PmError } from '../store.mjs'
import { createCampaignStore } from './campaigns.mjs'
import { parseMeta } from './rating.mjs'

export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000
export const DEFAULT_MAX_OUTPUT = 4000
export const REVIEW_NOT_WIRED = 'verifier review not wired'
const UI_KINDS = new Set(['ui', 'screenshot', 'video', 'visual', 'manual'])

const sha = (s) => createHash('sha256').update(String(s ?? '')).digest('hex')
const tail = (s, n) => { s = String(s ?? ''); return s.length > n ? `…${s.slice(-n)}` : s }

/**
 * Real command runner: spawns `cmd` through the shell in `cwd`, kills it at `timeoutMs`.
 * Resolves {exitCode, stdout, stderr, timedOut}; never rejects for a nonzero exit.
 * Refuses any command that would push.
 */
export function shellRun(cmd, { cwd, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS } = {}) {
  assertNoPush(cmd)
  return new Promise((done) => {
    const win = process.platform === 'win32'
    const child = spawn(cmd, { cwd, shell: true, windowsHide: true, detached: !win })
    let stdout = ''; let stderr = ''; let timedOut = false; let settled = false
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); done(r) } }
    const cap = (s, d) => (s.length > 1e6 ? s.slice(-1e6) : s) + d
    child.stdout.on('data', (d) => { stdout = cap(stdout, d) })
    child.stderr.on('data', (d) => { stderr = cap(stderr, d) })
    // A timeout kills the whole tree (the shell's children too) and resolves at once.
    const timer = setTimeout(() => {
      timedOut = true
      const result = () => finish({ exitCode: null, stdout, stderr, timedOut })
      try {
        if (win) {
          const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          k.on('exit', result); k.on('error', result)
          setTimeout(result, 10000).unref()
          return
        }
        process.kill(-child.pid, 'SIGKILL')
      } catch { child.kill('SIGKILL') }
      result()
    }, timeoutMs)
    child.on('error', (err) => finish({ exitCode: null, stdout, stderr: `${stderr}${err.message}`, timedOut }))
    child.on('close', (code) => finish({ exitCode: timedOut ? null : code, stdout, stderr, timedOut }))
  })
}

/** Nothing in BLITZ-07 may push. Throws on any command or git argv that names push. */
export function assertNoPush(cmdOrArgs) {
  const words = Array.isArray(cmdOrArgs) ? cmdOrArgs.map(String) : String(cmdOrArgs).split(/[\s;&|]+/)
  if (words.some((w) => /^push$/i.test(w) || /^send-pack$/i.test(w))) throw new PmError(403, `refused: BLITZ-07 never pushes (${Array.isArray(cmdOrArgs) ? cmdOrArgs.join(' ') : cmdOrArgs})`)
}

/** Check list of a task: [{name, cmd, timeoutMs?}] from meta.blitz.checks, else levelChecks[level]. */
export function checksOf(task, levelChecks = {}) {
  const meta = parseMeta(task)
  const norm = (list, src) => (Array.isArray(list) ? list : []).map((c, i) => {
    const o = typeof c === 'string' ? { cmd: c } : c && typeof c === 'object' ? c : {}
    return { name: String(o.name ?? `check-${i + 1}`), cmd: typeof o.cmd === 'string' ? o.cmd.trim() : '', timeoutMs: Number.isInteger(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : null, source: src }
  }).filter((c) => c.cmd)
  const own = norm(meta.blitz?.checks, 'meta.blitz.checks')
  if (own.length) return own
  const level = meta.blitz?.rating?.verification?.level ?? null
  return level ? norm(levelChecks[level], `levelChecks.${level}`) : []
}

export function acceptanceOf(task) {
  const a = parseMeta(task).blitz?.acceptance
  return (Array.isArray(a) ? a : []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
}

/** Agents that built this attempt: the campaign row's agent plus any agent the result claims. */
export function buildersOf(row, result) {
  const out = new Set()
  if (row?.agent) out.add(row.agent)
  if (row?.lease_owner) out.add(row.lease_owner)
  for (const k of ['agent', 'builder', 'built_by']) if (typeof result?.[k] === 'string' && result[k].trim()) out.add(result[k].trim())
  return out
}

/** Default verifier pick: the first enabled roster agent with role `verifier` that is not a builder. */
export function defaultPickVerifier(db) {
  return ({ campaign, builders }) => {
    for (const e of campaign.roster ?? []) {
      const name = typeof e === 'string' ? e : e?.agent
      if (!name || builders.has(name)) continue
      let a = null
      try { a = db.prepare('SELECT name, role, enabled FROM blitz_agents WHERE name = ?').get(name) } catch { a = null }
      if (a && a.enabled && a.role === 'verifier') return { name: a.name, role: a.role }
    }
    return null
  }
}

/** Where checks run: the per-task git worktree (BLITZ-08 results name both; `workspace` there is its parent dir). */
function workspaceOf(result) {
  const ws = result?.worktree ?? result?.workspace ?? null
  if (typeof ws !== 'string' || !ws.trim()) return { error: 'result names no workspace (per-task worktree)' }
  if (!isAbsolute(ws)) return { error: `workspace ${ws} is not an absolute path` }
  if (typeof result.repo === 'string' && resolve(result.repo) === resolve(ws)) return { error: `workspace ${ws} is the repo checkout itself, not an isolated worktree` }
  return { path: ws }
}

/**
 * @param o.db           db holding the blitz tables (store.db)
 * @param o.run          async (cmd, {cwd, timeoutMs}) => {exitCode, stdout, stderr, timedOut?}; default shellRun
 * @param o.review       async ({task, result, verifier, builders, checks, acceptance, workspace}) =>
 *                       {agent, verdict:'pass'|'fail'|'uncertain', reason?, criteria:[{criterion, met, note?}]}
 *                       default: not wired, so nothing is verified
 * @param o.escalate     async (problem, ctx) => {...}; called when no independent verifier is available and the
 *                       caller passed no ctx.escalate (the controller always passes its own, which dedupes and parks)
 * @param o.pickVerifier ({campaign, task, builders}) => {name, role} | null
 * @param o.levelChecks  {unit|integration|...: [cmd]} fallback checks by rating verification level
 * @param o.policy       optional default policy for tasks without explicit meta (codex-review.mjs createDefaultPolicy):
 *                       { acceptance(task) => [criterion], checks(task, {workspace, result}) => [{name, cmd, source}],
 *                         reviewOnly(task) => boolean }. Used only where meta.blitz.acceptance / checks (and level
 *                       checks) are absent. Without it, behaviour is unchanged.
 */
export function createVerifier({
  db, run = shellRun, review = null, escalate = null, pickVerifier, levelChecks = {},
  clock = () => new Date(), maxOutput = DEFAULT_MAX_OUTPUT, defaultTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS, policy = null,
} = {}) {
  if (!db) throw new Error('createVerifier needs the blitz db')
  const cs = createCampaignStore(db, { clock })
  const pick = pickVerifier ?? defaultPickVerifier(db)
  const at = () => clock().toISOString()

  async function verify(task, result, ctx = {}) {
    const campaign = ctx.campaign ?? null
    const cid = campaign?.id
    if (!cid) return { verified: false, reason: 'verify needs ctx.campaign' }
    // the controller passes the builder (ctx.agent) and its escalate (ctx.escalate); a bare call reads the row
    const row = ctx.agent !== undefined && ctx.attempt !== undefined ? { agent: ctx.agent, attempt: ctx.attempt } : cs.task(cid, task.id)
    const actor = ctx.actor ?? 'blitz-verify'
    const esc = ctx.escalate ?? (escalate ? (p) => escalate(p, { campaign, actor, now: clock() }) : null)
    const ev = (kind, data) => cs.event(cid, kind, data, { taskId: task.id, actor })
    const builders = buildersOf(row, result)
    let acceptance = acceptanceOf(task)
    let acceptanceSource = 'meta.blitz.acceptance'
    if (!acceptance.length && typeof policy?.acceptance === 'function') {
      try { acceptance = (policy.acceptance(task) ?? []).map((x) => String(x ?? '').trim()).filter(Boolean) } catch { acceptance = [] }
      acceptanceSource = 'default-policy'
    }
    const evidence = { task_id: task.id, attempt: ctx.attempt ?? row.attempt, builders: [...builders], verifier: null, workspace: null, checks: [], acceptance, acceptance_source: acceptance.length ? acceptanceSource : null, review: null, review_only: false, started_at: at(), finished_at: null }
    const finish = (verdict) => {
      evidence.finished_at = at()
      evidence.sha256 = sha(JSON.stringify(evidence))
      const e = ev('verify_evidence', { verdict: { verified: !!verdict.verified, failed: !!verdict.failed, reason: verdict.reason ?? null }, evidence })
      evidence.event_id = e.id
      return { ...verdict, evidence }
    }

    // 1. independent verifier
    const verifier = pick({ campaign, task, builders })
    if (!verifier || builders.has(verifier.name)) {
      const reason = `no independent verifier: roster has no enabled 'verifier' agent other than the builder (${[...builders].join(', ') || 'unknown'})`
      ev('verifier_unavailable', { reason, builders: [...builders] })
      if (esc) {
        try { await esc({ kind: 'verifier_unavailable', campaign_id: cid, task_id: task.id, attempt: evidence.attempt, reason }) } catch (err) { ev('escalation_error', { error: String(err?.message ?? err) }) }
      }
      return finish({ verified: false, reason })
    }
    evidence.verifier = verifier.name

    // 2-4. checks, acceptance, workspace
    if (result?.no_changes === true && workspaceOf(result).path) return finish({ verified: false, reason: 'no changes' })
    let checks = checksOf(task, levelChecks)
    let reviewOnly = false
    let policyNote = ''
    if (!checks.length && policy) {
      // default policy: detect a runnable check in the task's worktree (per-repo map, then package.json/pytest/node)
      const pws = workspaceOf(result)
      if (pws.error) return finish({ verified: false, reason: pws.error })
      try { checks = (await policy.checks?.(task, { workspace: pws.path, result })) ?? [] } catch (err) { policyNote = `check detection error: ${String(err?.message ?? err)}`; checks = [] }
      checks = (Array.isArray(checks) ? checks : []).filter((c) => c && typeof c.cmd === 'string' && c.cmd.trim())
        .map((c, i) => ({ name: String(c.name ?? `default-check-${i + 1}`), cmd: c.cmd.trim(), timeoutMs: Number.isInteger(c.timeoutMs) && c.timeoutMs > 0 ? c.timeoutMs : null, source: c.source ?? 'default-policy' }))
      if (!checks.length && policy.reviewOnly?.(task) === true) reviewOnly = true
    }
    evidence.review_only = reviewOnly
    const uiOnly = Array.isArray(result?.evidence) && result.evidence.length > 0 && result.evidence.every((x) => UI_KINDS.has(String(x?.kind ?? x?.type ?? '').toLowerCase()))
    if (!checks.length && !reviewOnly) {
      if (policy) return finish({ verified: false, reason: `no runnable check: the task names none and none was detected in the worktree (no repoChecks entry, no package.json test script, no pytest config, no node test files)${policyNote ? `; ${policyNote}` : ''}; review alone verifies only docs/research tasks` })
      return finish({ verified: false, reason: uiOnly ? 'UI-only evidence is not verification; the task names no check commands' : 'task names no check commands (meta.blitz.checks or a level check)' })
    }
    if (!evidence.acceptance.length) return finish({ verified: false, reason: 'task names no acceptance criteria (meta.blitz.acceptance)' })
    const ws = workspaceOf(result)
    if (ws.error) return finish({ verified: false, reason: ws.error })
    evidence.workspace = ws.path
    // pm's commit step (dispatch.mjs commitWorktree) found nothing to verify, or could not commit
    if (result?.no_changes === true) return finish({ verified: false, reason: 'no changes' })
    if (typeof result?.commit_error === 'string' && result.commit_error) return finish({ verified: false, reason: `builder changes not committed: ${result.commit_error}` })

    // 5. run checks in the isolated workspace
    for (const c of checks) {
      const timeoutMs = c.timeoutMs ?? defaultTimeoutMs
      const started = clock(); const t0 = Date.now()
      let r
      // BLITZ_CHECK_RETRIES: a check that exits non-zero is re-run that many times before it fails the
      // task (suites with timing tests flake under a full slot load); a timeout or spawn error is final
      const retries = Math.max(0, Number(process.env.BLITZ_CHECK_RETRIES) || 0)
      for (let n = 0; ; n++) {
        try {
          assertNoPush(c.cmd)
          r = await run(c.cmd, { cwd: ws.path, timeoutMs })
        } catch (err) {
          r = { exitCode: null, stdout: '', stderr: '', error: String(err?.message ?? err) }
        }
        if (n >= retries || r?.timedOut || r?.error || r?.exitCode === 0 || !Number.isInteger(r?.exitCode)) break
        ev('verify_check_retry', { name: c.name, exit_code: r.exitCode, attempt: n + 1 })
      }
      const rec = {
        name: c.name, cmd: c.cmd, source: c.source, cwd: ws.path, timeout_ms: timeoutMs,
        exit_code: Number.isInteger(r?.exitCode) ? r.exitCode : null, timed_out: r?.timedOut === true, error: r?.error ?? null,
        started_at: started.toISOString(), finished_at: at(), duration_ms: Date.now() - t0,
        stdout_tail: tail(r?.stdout, maxOutput), stderr_tail: tail(r?.stderr, maxOutput),
        stdout_sha256: sha(r?.stdout), stderr_sha256: sha(r?.stderr), stdout_bytes: String(r?.stdout ?? '').length, stderr_bytes: String(r?.stderr ?? '').length,
      }
      evidence.checks.push(rec)
      ev('verify_check', rec)
      if (rec.timed_out) return finish({ verified: false, reason: `check ${c.name} timed out after ${timeoutMs} ms` })
      if (rec.error) return finish({ verified: false, reason: `check ${c.name} could not run: ${rec.error}` })
      if (rec.exit_code === null) return finish({ verified: false, reason: `check ${c.name} returned no exit code` })
      if (rec.exit_code !== 0) return finish({ verified: false, failed: true, reason: `check ${c.name} exited ${rec.exit_code}: ${c.cmd}` })
    }

    // 6. independent review against the acceptance criteria
    if (!review) return finish({ verified: false, reason: REVIEW_NOT_WIRED })
    let rv
    try {
      rv = await review({ task, result, verifier, builders: [...builders], checks: evidence.checks, acceptance: evidence.acceptance, workspace: ws.path, campaign, reviewOnly })
    } catch (err) {
      return finish({ verified: false, reason: `verifier review error: ${String(err?.message ?? err)}` })
    }
    evidence.review = rv ?? null
    const reviewer = rv?.agent ?? verifier.name
    if (builders.has(reviewer)) return finish({ verified: false, reason: `refused: review by ${reviewer}, who built the task` })
    if (reviewer !== verifier.name) return finish({ verified: false, reason: `review came from ${reviewer}, not the selected verifier ${verifier.name}` })
    if (rv?.verdict === 'fail') return finish({ verified: false, failed: true, reason: `verifier ${reviewer} failed it: ${rv.reason ?? ''}`.trim() })
    if (rv?.verdict !== 'pass') return finish({ verified: false, reason: `verifier ${reviewer} is not certain: ${rv?.reason ?? rv?.verdict ?? 'no verdict'}` })
    const criteria = Array.isArray(rv.criteria) ? rv.criteria : []
    const unmet = evidence.acceptance.filter((a) => !criteria.some((c) => c?.criterion === a && c.met === true))
    if (unmet.length) {
      const failedOnes = unmet.filter((a) => criteria.some((c) => c?.criterion === a && c.met === false))
      if (failedOnes.length) return finish({ verified: false, failed: true, reason: `acceptance not met: ${failedOnes.join('; ')}` })
      return finish({ verified: false, reason: `acceptance not assessed: ${unmet.join('; ')}` })
    }
    return finish({ verified: true, reason: reviewOnly
      ? `verified by ${reviewer} (review only, docs/research task): ${evidence.acceptance.length} criteria met`
      : `verified by ${reviewer}: ${checks.length} checks exit 0, ${evidence.acceptance.length} criteria met` })
  }

  /** Evidence trail of one task (or the whole campaign): verify_evidence + verify_check events. */
  function evidenceOf(campaignId, { task } = {}) {
    cs.get(campaignId)
    const ev = cs.events(campaignId, { task, kind: 'verify_evidence', limit: 5000 })
    const checks = cs.events(campaignId, { task, kind: 'verify_check', limit: 5000 })
    return { campaign: campaignId, task: task ?? null, verdicts: ev.map((e) => ({ id: e.id, task_id: e.task_id, at: e.at, ...e.data })), checks: checks.map((e) => ({ id: e.id, task_id: e.task_id, at: e.at, ...e.data })) }
  }

  /** Re-verification goes through the controller (ctl.reverify): same fence, escalation and settle. */
  let controller = null
  async function reverify(w, campaignId, taskId) {
    if (!controller?.reverify) throw new PmError(503, 'reverify needs the controller: verify.attach(controller)')
    return controller.reverify(w, campaignId, taskId)
  }

  verify.evidenceOf = evidenceOf
  verify.reverify = reverify
  verify.attach = (ctl) => { controller = ctl; return verify }
  return verify
}
