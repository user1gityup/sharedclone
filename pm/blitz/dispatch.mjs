#!/usr/bin/env node
// BLITZ-08 dispatch adapters (Claude Opus 5.5), behind the controller's dispatch(task, ctx).
//
// One adapter per transport (agents.mjs TRANSPORTS):
//   dsh-run        node <harness>/packages/council/tool-council/bin/dsh-run.mjs start <BRIEF.md> --out <worktree>
//                  --run <runId> --auto --max-attempts N, with DSH_HOME = the agent's lane. dsh-run has no
//                  roster flag: the seats come from the lane's settings.yaml, so the adapter refuses an agent
//                  with no named seats or no lane home (never the default ~/.dsh roster).
//   codex          node <codex.js> exec --cd <worktree> --sandbox workspace-write --json
//                  --output-last-message <ws>/codex-last-message.md [-m <pin>] -   (brief on stdin),
//                  run detached under `node dispatch.mjs wrap`, which records the exit in blitz-exit.json.
//   bridge-claude  a bridge `submit` to claude-code on the agent's machine (same envelope the pm bridge
//                  auto-dispatcher builds), with a dedupe key per (campaign, task, attempt).
//
// Safety: every adapter refuses to start unless BLITZ_DISPATCH_ENABLED=1 AND the campaign carries
// authorized_by. Every process goes through the injected `spawn`; the git worktree through the
// injected `git`. Starting is wrapped in ctx.once(start:a<attempt>) and uses a deterministic run
// id, so a retried tick never starts a second run; a re-leased task (crash, expired lease) first
// adopts the run named in its last checkpoint instead of starting a new one.
//
// Long runs: dispatch returns {ref} after the 'dispatched' checkpoint. createPoller() reads the
// run artifact back from the task row (durable across pm restarts), heartbeats while it runs,
// and reports through controller.reportResult / reportFailure, or stops it and acks a cancel.
import { spawn as nodeSpawn } from 'node:child_process'
import * as nodeFs from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createAgentRegistry } from './agents.mjs'
import { createController } from './controller.mjs'
import { createGuard, guardController, seatsOf } from './guard.mjs'
import { parseMeta } from './rank.mjs'
import { TERMINAL_CAMPAIGN } from './campaigns.mjs'

const THIS_FILE = fileURLToPath(import.meta.url)
export const ENABLE_ENV = 'BLITZ_DISPATCH_ENABLED'
export const DEFAULT_WORKSPACE_ROOT = join(homedir(), 'Documents', 'claudecode', 'blitz-runs')
export const DEFAULT_DSH_RUN_CLI = join(homedir(), 'Documents', 'claudecode', 'deepseek-harness', 'packages', 'council', 'tool-council', 'bin', 'dsh-run.mjs')
export const RUN_ARTIFACT = 'run'

/** The two locks every real start needs. Throws with the reason; returns the authorizer. */
export function assertDispatchAllowed(env, campaign) {
  if (env?.[ENABLE_ENV] !== '1') throw new Error(`dispatch disabled: ${ENABLE_ENV}=1 is not set in pm's environment; nothing was started`)
  const by = typeof campaign?.authorized_by === 'string' ? campaign.authorized_by.trim() : ''
  if (!by) throw new Error(`dispatch refused: campaign ${campaign?.id ?? '?'} has no authorized_by; nothing was started`)
  return by
}

/** Deterministic id for one (campaign, task, attempt); valid for dsh-run --run and bridge ids. */
export function runIdFor(prefix, campaignId, taskId, attempt) {
  return `${prefix}-${campaignId}-${taskId}-a${attempt}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80)
}

/** Strips obvious credentials from text that goes into a brief file. */
export function redact(text) {
  return String(text ?? '')
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|xox[abpr]|AKIA)[-_A-Za-z0-9]{12,}\b/g, '[redacted]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redacted]')
    .replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|APIKEY|KEY))\s*[=:]\s*\S+/g, '$1=[redacted]')
}

/** Promise wrapper over a spawn-compatible function. */
export function runProc(spawn, cmd, args, { cwd, env, input, timeoutMs = 120_000 } = {}) {
  return new Promise((res, rej) => {
    let child
    try { child = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) } catch (err) { return rej(err) }
    let stdout = ''
    let stderr = ''
    const t = timeoutMs ? setTimeout(() => { try { child.kill?.() } catch {} rej(new Error(`${cmd} timed out after ${timeoutMs} ms`)) }, timeoutMs) : null
    child.stdout?.on('data', (d) => { stdout += d })
    child.stderr?.on('data', (d) => { stderr += d })
    child.on('error', (err) => { if (t) clearTimeout(t); rej(err) })
    child.on('close', (code) => { if (t) clearTimeout(t); res({ code, stdout, stderr }) })
    if (input !== undefined) child.stdin?.end(input)
    else child.stdin?.end()
  })
}

export const defaultGit = (spawn = nodeSpawn) => (args, opts = {}) => runProc(spawn, 'git', args, opts)

function pidAliveDefault(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}

/** Repo path for a task: meta.blitz.repo, then meta.repo. */
export function repoOf(task) {
  const m = parseMeta(task)
  const r = m.blitz?.repo ?? m.repo
  return typeof r === 'string' && r.trim() ? r.trim() : null
}

/**
 * Isolated per-task workspace: <root>/<campaign>/<task>/ holding BRIEF.md and logs, with a git
 * worktree at ./repo on branch blitz/<campaign>/<task>. Reused when it already exists.
 */
export async function ensureWorkspace({ task, campaignId, root, git, fs = nodeFs }) {
  const repo = repoOf(task)
  if (!repo) throw new Error(`task ${task.id} names no repo (meta.blitz.repo or meta.repo); no workspace can be made`)
  const workspace = resolve(root, campaignId, task.id)
  const worktree = join(workspace, 'repo')
  const branch = `blitz/${campaignId}/${task.id}`
  const base = parseMeta(task).blitz?.base ?? 'HEAD'
  fs.mkdirSync(workspace, { recursive: true })
  if (fs.existsSync(join(worktree, '.git'))) return { repo, workspace, worktree, branch, base, created: false }
  const has = await git(['-C', repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  const args = has.code === 0 ? ['-C', repo, 'worktree', 'add', worktree, branch] : ['-C', repo, 'worktree', 'add', '-b', branch, worktree, base]
  const r = await git(args)
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed (${r.code}): ${String(r.stderr).trim().slice(0, 400)}`)
  return { repo, workspace, worktree, branch, base, created: true }
}

/** The brief file text. No secrets: the task body is redacted, no env is copied. */
function previousText(prev) {
  const v = prev?.verification
  if (!v || v.verified || !(v.reason || v.evidence)) return []
  // the verifier's per-criterion notes name the files and lines; the summary alone sent builders round in loops
  const unmet = (v.evidence?.review?.criteria ?? []).filter((c) => c && c.met === false)
  const detail = unmet.length
    ? ['', 'Unmet criteria, with the verifier\'s notes:', '', ...unmet.map((c) => `- ${redact(String(c.criterion ?? ''))}\n  Verifier: ${redact(String(c.note ?? '(no note)'))}`)]
    : []
  // a failed check named only its exit code; the builder needs the failing tests from its output
  const failed = (v.evidence?.checks ?? []).filter((c) => c && (c.timed_out || c.error || (Number.isInteger(c.exit_code) && c.exit_code !== 0)))
  // a builder without a shell read the files, judged them fine and changed nothing (T-97d03640 a4: CRLF broke a test regex)
  const checks = failed.length
    ? ['', 'Failed checks. This output is from the branch as it stands now, so the failure is real even if the files read correctly.',
      'Run the checks in the worktree if your tools allow. If they do not, work out from the exact file contents (line endings',
      'included) why each failing assertion fails, then change the code or the test. Never finish with "no edits needed" while a check fails:', '', ...failed.map((c) => {
      const out = [c.stdout_tail, c.stderr_tail].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n')
      const at = out.lastIndexOf('failing tests:')
      return `- ${redact(String(c.name ?? 'check'))}: \`${redact(String(c.cmd ?? ''))}\` exit ${c.exit_code ?? (c.timed_out ? 'timeout' : 'error')}${c.error ? ` (${redact(String(c.error))})` : ''}\n\n\`\`\`\n${redact(at >= 0 ? out.slice(at) : out).slice(-4000)}\n\`\`\``
    })]
    : []
  return ['## Previous attempt feedback', '', 'The last attempt was not accepted. Fix every gap named here; the branch already holds the earlier commits.', '',
    redact(String(v.reason ?? '')).slice(0, 6000), ...[detail.join('\n').slice(0, 12000)].filter(Boolean), ...[checks.join('\n').slice(0, 10000)].filter(Boolean), '']
}

/** The criteria the verifier checks (meta.blitz.acceptance). They can be clarified after the body was approved, so they win. */
function acceptanceText(task) {
  const b = parseMeta(task).blitz ?? {}
  const list = (Array.isArray(b.acceptance) ? b.acceptance : []).map((c) => String(c ?? '').trim()).filter(Boolean)
  if (!list.length) return []
  const why = b.acceptance_clarification?.quote ? ['', `Clarified: ${redact(String(b.acceptance_clarification.quote))}`] : []
  return ['## Acceptance criteria the verifier checks', '', 'These are authoritative: where they differ from criteria in the task text above, follow these.', ...why, '',
    ...list.map((c, i) => `${i + 1}. ${redact(c)}`), '']
}

export function briefText({ task, campaign, agent, attempt, ws, previous: ctxPrev = null }) {
  const seats = seatsOf(agent)
  return [
    `# Blitz task ${task.id}: ${redact(task.title)}`,
    '',
    `- Campaign: ${campaign.id}${campaign.title ? ` (${redact(campaign.title)})` : ''}, authorized by ${campaign.authorized_by}`,
    `- Agent: ${agent.name} (${agent.transport} on ${agent.machine}), seats: ${seats.length ? seats.join(', ') : 'none named'}, attempt ${attempt}`,
    `- Project: ${task.project_id}`,
    `- Workspace: ${ws.worktree} (branch ${ws.branch}, base ${ws.base}, repo ${ws.repo})`,
    '',
    '## Task',
    '',
    redact(task.body || '(no body)'),
    '',
    ...acceptanceText(task),
    ...previousText(ctxPrev),
    '## Rules',
    '',
    '- Work only inside the workspace above. Commit locally on its branch. Do not read or write files outside it',
    '  (no shared-brain handoff notes, no other repos): calls outside the workspace are denied and end the run.',
    '- Commit early and often; you have a turn limit, so commit each working piece before moving on.',
    '- Never git push, merge into another branch, deploy, or spend money.',
    '- Put no secrets in files, commits or this run\'s output.',
    '- End with a short summary: what changed, which files, and which tests you ran with their exit codes.',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// adapters: build() is pure (tests check the exact command); start/poll/stop do the work
// ---------------------------------------------------------------------------

/** dsh-run: lane home per agent from o.dshHomes[name] or env BLITZ_DSH_HOME__<NAME>. */
export function dshRunAdapter({ spawn = nodeSpawn, env = process.env, fs = nodeFs, cli = env.BLITZ_DSH_RUN_CLI || DEFAULT_DSH_RUN_CLI, dshHomes = {}, maxAttempts = 1, node = process.execPath } = {}) {
  const homeOf = (agent) => dshHomes[agent.name] ?? env[`BLITZ_DSH_HOME__${agent.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] ?? null
  const childEnv = (home) => ({ ...env, DSH_HOME: home })
  const api = {
    transport: 'dsh-run',
    build(task, ctx, ws) {
      const seats = seatsOf(ctx.agent)
      if (!seats.length) throw new Error(`agent ${ctx.agent.name} names no seats (model_policy.pin/allow); dsh-run never runs a default roster`)
      const home = homeOf(ctx.agent)
      if (!home) throw new Error(`agent ${ctx.agent.name} has no DSH lane home (dshHomes or BLITZ_DSH_HOME__${ctx.agent.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}); the default ~/.dsh roster is never used`)
      const runId = runIdFor('BLITZ', ctx.campaign.id, task.id, ctx.attempt)
      const b = parseMeta(task).blitz ?? {}
      const args = [cli, 'start', ws.brief, '--out', ws.worktree, '--run', runId, '--auto', '--max-attempts', String(maxAttempts),
        ...(typeof b.stages === 'string' ? ['--stages', b.stages] : []), ...(typeof b.mode === 'string' ? ['--mode', b.mode] : [])]
      return { cmd: node, args, env: { DSH_HOME: home }, ref: runId, seats, home }
    },
    async start(task, ctx, ws) {
      const b = api.build(task, ctx, ws)
      if (!fs.existsSync(join(b.home, 'settings.yaml'))) throw new Error(`DSH lane ${b.home} has no settings.yaml`)
      const r = await runProc(spawn, b.cmd, b.args, { cwd: ws.workspace, env: childEnv(b.home) })
      if (r.code !== 0) throw new Error(`dsh-run start exited ${r.code}: ${String(r.stderr || r.stdout).trim().slice(0, 400)}`)
      return { ref: b.ref, home: b.home, seats: b.seats, log: join(ws.worktree, `${b.ref}.out.log`), errLog: join(ws.worktree, `${b.ref}.err.log`) }
    },
    async poll(art) {
      const r = await runProc(spawn, node, [cli, 'list', '--json'], { env: childEnv(art.home), timeoutMs: 60_000 })
      if (r.code !== 0) throw new Error(`dsh-run list exited ${r.code}`)
      let runs
      try { runs = JSON.parse(r.stdout) } catch { throw new Error('dsh-run list --json was not JSON') }
      const run = runs.find((x) => x.runId === art.ref)
      if (!run) return { state: 'failed', error: `dsh-run has no run ${art.ref}` }
      if (run.status === 'complete') return { state: 'done', result: { summary: `dsh-run ${art.ref} complete`, status: run.status, exitCode: run.exitCode ?? null } }
      if (['failed', 'blocked', 'stopped', 'paused'].includes(run.status)) {
        return { state: 'failed', error: `dsh-run ${art.ref} ${run.status}${run.auto?.blocker ? `: ${JSON.stringify(run.auto.blocker).slice(0, 300)}` : ''}` }
      }
      return { state: 'running', detail: run.status }
    },
    async stop(art) {
      const r = await runProc(spawn, node, [cli, 'stop', art.ref], { env: childEnv(art.home), timeoutMs: 60_000 })
      return { stopped: r.code === 0, code: r.code }
    },
  }
  return api
}

/** codex.js path: BLITZ_CODEX_JS, else the npm global install, else `codex` on PATH. */
export function codexEntry(env = process.env, fs = nodeFs) {
  if (env.BLITZ_CODEX_JS) return { cmd: process.execPath, pre: [env.BLITZ_CODEX_JS] }
  const js = join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  if (fs.existsSync(js)) return { cmd: process.execPath, pre: [js] }
  return { cmd: 'codex', pre: [] }
}

export function codexAdapter({ spawn = nodeSpawn, env = process.env, fs = nodeFs, entry = codexEntry(env, fs), node = process.execPath, pidAlive = pidAliveDefault, sandbox = 'workspace-write' } = {}) {
  const api = {
    transport: 'codex',
    build(task, ctx, ws) {
      const ref = runIdFor('codex', ctx.campaign.id, task.id, ctx.attempt)
      const files = {
        exitFile: join(ws.workspace, `${ref}.exit.json`), lastMessage: join(ws.workspace, `${ref}.last-message.md`),
        log: join(ws.workspace, `${ref}.out.jsonl`), errLog: join(ws.workspace, `${ref}.err.log`),
      }
      const pin = ctx.agent.model_policy?.pin
      const codex = [...entry.pre, 'exec', '--cd', ws.worktree, '--sandbox', sandbox, '--json', '--output-last-message', files.lastMessage, ...(pin ? ['-m', pin] : []), '-']
      const args = [THIS_FILE, 'wrap', '--exit', files.exitFile, '--stdin', ws.brief, '--stdout', files.log, '--stderr', files.errLog, '--', entry.cmd, ...codex]
      return { cmd: node, args, ref, ...files }
    },
    async start(task, ctx, ws) {
      const b = api.build(task, ctx, ws)
      if (fs.existsSync(b.exitFile)) throw new Error(`codex run ${b.ref} already finished once; a new attempt gets a new id`)
      const child = spawn(b.cmd, b.args, { cwd: ws.workspace, env, detached: true, stdio: 'ignore', windowsHide: true })
      const pid = await new Promise((res, rej) => {
        child.once?.('error', rej)
        if (child.pid) res(child.pid)
        else child.once?.('spawn', () => res(child.pid))
      })
      child.unref?.()
      return { ref: b.ref, pid, exitFile: b.exitFile, lastMessage: b.lastMessage, log: b.log, errLog: b.errLog }
    },
    async poll(art) {
      if (fs.existsSync(art.exitFile)) {
        let ex
        try { ex = JSON.parse(fs.readFileSync(art.exitFile, 'utf8')) } catch { return { state: 'failed', error: `codex exit record ${art.exitFile} unreadable` } }
        const summary = fs.existsSync(art.lastMessage) ? fs.readFileSync(art.lastMessage, 'utf8').slice(0, 4000) : ''
        if (ex.code === 0) return { state: 'done', result: { summary, exitCode: 0 } }
        return { state: 'failed', error: `codex exited ${ex.code}${ex.error ? `: ${ex.error}` : ''}` }
      }
      if (pidAlive(art.pid)) return { state: 'running' }
      return { state: 'failed', error: `codex wrapper pid ${art.pid} is gone without an exit record` }
    },
    async stop(art) {
      if (!pidAlive(art.pid)) return { stopped: true, already: true }
      const r = process.platform === 'win32'
        ? await runProc(spawn, 'taskkill', ['/PID', String(art.pid), '/T', '/F'])
        : await runProc(spawn, 'kill', ['-TERM', String(art.pid)])
      return { stopped: r.code === 0, code: r.code }
    },
  }
  return api
}

/** bridge.queue-backed submit/thread/cancel, used when pm passes its bridge. */
export function queueBridge(queue) {
  if (!queue) return null
  const principal = `blitz@${queue.machine}`
  return {
    submit: (envelope) => queue.enqueue(envelope, { principal }),
    thread: (id) => queue.list({ correlation: id, limit: 500 }),
    cancel: (envelope) => queue.enqueue(envelope, { principal }),
    // the submit's queue state ('uncertain' = its worker died with a pm restart), or null
    runState: (id) => { try { return queue.db?.prepare('SELECT state FROM bridge_messages WHERE id = ?').get(id)?.state ?? null } catch { return null } },
    machine: queue.machine,
  }
}

const statusBody = (m) => { try { return typeof m.body === 'string' ? JSON.parse(m.body) : m.body } catch { return null } }

export function bridgeClaudeAdapter({ bridge = null, permissionMode = 'acceptEdits', maxTurns = 200, fs = nodeFs } = {}) {
  const need = () => { if (!bridge) throw new Error('bridge-claude needs the pm bridge (PM_BRIDGE is off or not wired)'); return bridge }
  const api = {
    transport: 'bridge-claude',
    build(task, ctx, ws, prompt) {
      const id = runIdFor('blitz', ctx.campaign.id, task.id, ctx.attempt)
      return {
        ref: id,
        envelope: {
          v: 1, id, dedupe_key: id, type: 'submit',
          from: { agent: 'blitz' }, to: { machine: ctx.agent.machine, agent: 'claude-code' },
          correlation_id: id, project: task.project_id, task: task.id,
          body: { prompt, model: ctx.agent.model_policy?.pin, cwd: ws.worktree, permission_mode: permissionMode, max_turns: maxTurns,
            blitz: { campaign: ctx.campaign.id, task: task.id, attempt: ctx.attempt, agent: ctx.agent.name } },
        },
      }
    },
    async start(task, ctx, ws) {
      const prompt = fs.readFileSync(ws.brief, 'utf8')
      const b = api.build(task, ctx, ws, prompt)
      const sent = await need().submit(b.envelope)
      return { ref: b.ref, machine: ctx.agent.machine, duplicate: Boolean(sent?.duplicate) }
    },
    async poll(art) {
      const msgs = await need().thread(art.ref)
      const end = msgs.find((m) => m.id !== art.ref && m.correlation_id === art.ref && ['result', 'error'].includes(m.type))
      if (!end) {
        // A run that ended on a denied tool parks as AWAITING_APPROVAL (a status, never a result): it has
        // finished. Exit 0 means its work is done and only an out-of-workspace call was refused.
        const parked = msgs.find((m) => m.correlation_id === art.ref && m.type === 'status' && statusBody(m)?.state === 'AWAITING_APPROVAL')
        if (!parked) {
          if (bridge?.runState?.(art.ref) === 'uncertain') return { state: 'failed', error: 'bridge error: run lost (its worker died with a pm restart); retry starts a fresh attempt' }
          return { state: 'running' }
        }
        const pb = statusBody(parked)
        const denied = (pb.denials ?? []).map((d) => `${d.tool_name} ${JSON.stringify(d.tool_input ?? {}).slice(0, 160)}`).join('; ')
        if (pb.exit_code === 0) return { state: 'done', result: { summary: `run finished (exit 0); denied outside the workspace: ${denied}`.slice(0, 4000), message: parked.id } }
        return { state: 'failed', error: `bridge error: claude exited ${pb.exit_code} after denied tool calls: ${denied}`.slice(0, 400) }
      }
      const body = typeof end.body === 'string' ? JSON.parse(end.body) : end.body
      if (end.type === 'result') return { state: 'done', result: { summary: String(body?.text ?? body?.result ?? '').slice(0, 4000), message: end.id } }
      return { state: 'failed', error: `bridge error: ${String(body?.error ?? 'unspecified').slice(0, 400)}` }
    },
    async stop(art) {
      const b = need()
      await b.cancel({ v: 1, type: 'cancel', dedupe_key: `${art.ref}-cancel`.slice(0, 80), from: { agent: 'blitz' }, to: { machine: art.machine, agent: 'claude-code' }, correlation_id: art.ref, body: { submit_id: art.ref, reason: 'blitz campaign cancel' } })
      return { stopped: true, requested: true }
    },
  }
  return api
}

/** The run artifact of a task row's checkpoint, or null. */
export function runArtifact(row) {
  return row?.checkpoint?.artifacts?.find?.((a) => a?.kind === RUN_ARTIFACT) ?? null
}

/**
 * dispatch(task, ctx) for createController.
 * @param o.adapters    {transport: adapter}
 * @param o.getCampaign (id) => campaign row (for authorized_by)
 * @param o.env         environment holding BLITZ_DISPATCH_ENABLED
 */
export function createDispatcher({ adapters, getCampaign, env = process.env, root = env.BLITZ_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT, git = defaultGit(), fs = nodeFs } = {}) {
  if (!adapters || !getCampaign) throw new Error('createDispatcher needs adapters and getCampaign')
  return async function dispatch(task, ctx) {
    const campaign = getCampaign(ctx.campaign.id)
    assertDispatchAllowed(env, campaign)
    const adapter = adapters[ctx.agent.transport]
    if (!adapter) throw new Error(`no dispatch adapter for transport ${ctx.agent.transport}`)

    // A re-leased task adopts the run its last checkpoint names, if that run is alive or done and
    // its outcome was never reported (a crash or expired lease); a reported failure is never re-adopted.
    const prior = runArtifact({ checkpoint: ctx.resumeFrom })
    if (prior && prior.transport === adapter.transport && !ctx.reported?.(prior.attempt)) {
      let st = null
      try { st = await adapter.poll(prior) } catch { st = null }
      if (st && (st.state === 'running' || st.state === 'done')) {
        const art = { ...prior, adopted_from_attempt: prior.attempt, attempt: ctx.attempt }
        ctx.checkpoint({ stage: 'dispatched', artifacts: [art] })
        return st.state === 'done' ? { ref: art.ref, result: resultOf(art, st) } : { ref: art.ref }
      }
    }

    const ws = await ctx.once(`workspace:a${ctx.attempt}`, async () => {
      const w = await ensureWorkspace({ task, campaignId: campaign.id, root, git, fs })
      // the commit the worktree starts from: the verifier and codex-review diff base...HEAD
      let head = null
      try { const r = await git(['-C', w.worktree, 'rev-parse', 'HEAD']); if (r.code === 0 && /^[0-9a-f]{7,64}$/i.test(String(r.stdout).trim())) head = String(r.stdout).trim() } catch { head = null }
      // a retry's worktree already holds earlier attempts' commits: diff from the branch's fork point off
      // the source repo, so the verifier sees the task's whole work, not only this attempt's (never 'no changes')
      try {
        const src = await git(['-C', w.repo, 'rev-parse', 'HEAD'])
        const sh = String(src.stdout ?? '').trim()
        if (head && src.code === 0 && /^[0-9a-f]{7,64}$/i.test(sh)) {
          const mb = await git(['-C', w.worktree, 'merge-base', 'HEAD', sh])
          const m = String(mb.stdout ?? '').trim()
          if (mb.code === 0 && /^[0-9a-f]{7,64}$/i.test(m)) head = m
        }
      } catch { /* keep HEAD */ }
      return { ...w, base_commit: head }
    })
    ws.brief = join(ws.workspace, 'BRIEF.md')
    fs.writeFileSync(ws.brief, briefText({ task, campaign, agent: ctx.agent, attempt: ctx.attempt, ws, previous: ctx.previous ?? null }))
    ctx.checkpoint({ stage: 'workspace', artifacts: [{ kind: 'workspace', path: ws.workspace, worktree: ws.worktree, branch: ws.branch, repo: ws.repo, brief: ws.brief }] })
    if (ctx.cancelRequested()) throw new Error('cancel requested before start; nothing was started')

    const started = await ctx.once(`start:a${ctx.attempt}`, () => adapter.start(task, ctx, ws))
    const art = {
      kind: RUN_ARTIFACT, transport: adapter.transport, attempt: ctx.attempt, agent: ctx.agent.name, machine: ctx.agent.machine,
      workspace: ws.workspace, worktree: ws.worktree, branch: ws.branch, repo: ws.repo, brief: ws.brief, base_commit: ws.base_commit ?? null,
      ...Object.fromEntries(Object.entries(started).filter(([k]) => k !== 'replayed')),
    }
    ctx.checkpoint({ stage: 'dispatched', artifacts: [art] })
    return { ref: art.ref }
  }
}

function resultOf(art, st) {
  const files = ['log', 'errLog', 'lastMessage', 'exitFile', 'brief'].filter((k) => art[k]).map((k) => ({ kind: k, path: art[k] }))
  return {
    transport: art.transport, ref: art.ref, workspace: art.workspace, worktree: art.worktree, branch: art.branch, repo: art.repo,
    ...(art.base_commit ? { base: art.base_commit } : {}),
    ...(st.result ?? {}), artifacts: [{ kind: 'branch', ref: art.branch, repo: art.repo }, { kind: 'worktree', path: art.worktree }, ...files],
  }
}

/**
 * Durable poller: walks running tasks of live campaigns, reads each run artifact from the task row,
 * heartbeats live runs, reports finished ones, and stops + acks runs whose cancel was requested.
 */
export const COMMIT_TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
export const COMMIT_TRANSPORTS = new Set(['bridge-claude'])

/**
 * pm commits a bridge-claude builder's working-tree changes (the vmixer bridge policy denies the worker
 * Bash/PowerShell, so it can edit but not commit). `git add -A` + `git commit` in the task worktree; never
 * pushes. Returns {committed, no_changes, base, head, commit_error?}. No changes = nothing staged AND HEAD
 * still at the base commit; the verifier then fails closed with reason 'no changes'.
 */
export async function commitWorktree({ git, art, campaignId, taskId, attempt, title }) {
  const wt = art.worktree
  const g = async (args) => { assertNoGitPush(args); return git(['-C', wt, ...args], { cwd: wt }) }
  const headOf = async () => { const r = await g(['rev-parse', 'HEAD']); return r.code === 0 ? String(r.stdout).trim() : null }
  const st = await g(['status', '--porcelain'])
  if (st.code !== 0) return { committed: false, no_changes: false, commit_error: `git status failed (${st.code}): ${String(st.stderr).trim().slice(0, 300)}` }
  const base = art.base_commit ?? null
  if (!String(st.stdout).trim()) {
    const head = await headOf()
    return { committed: false, no_changes: !!base && head === base, base, head }
  }
  const add = await g(['add', '-A'])
  if (add.code !== 0) return { committed: false, no_changes: false, base, commit_error: `git add -A failed (${add.code}): ${String(add.stderr).trim().slice(0, 300)}` }
  const subject = `blitz ${campaignId} ${taskId} a${attempt}: ${String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)}`
  const msg = ['commit', '-m', subject, '-m', COMMIT_TRAILER]
  let c = await g(msg)
  if (c.code !== 0 && /tell me who you are|user\.email|user\.name|empty ident/i.test(`${c.stderr}${c.stdout}`)) {
    c = await g(['-c', 'user.name=pm blitz', '-c', 'user.email=noreply@anthropic.com', ...msg]) // no identity configured
  }
  if (c.code !== 0) return { committed: false, no_changes: false, base, commit_error: `git commit failed (${c.code}): ${String(c.stderr || c.stdout).trim().slice(0, 300)}` }
  return { committed: true, no_changes: false, base, head: await headOf() }
}

function assertNoGitPush(args) {
  if (args.some((a) => /^(push|send-pack)$/i.test(String(a)))) throw new Error(`refused: blitz never pushes (${args.join(' ')})`)
}

export function createPoller({ controller, adapters, actor = { actor: 'blitz-poller', model: null }, git = null, taskTitle = () => '', backgroundVerify = 0 }) {
  const stats = { polls: 0, reported: 0, failed: 0, cancelled: 0, errors: [], verifying: 0, reverified: 0 }
  const note = (e) => { stats.errors.push({ at: new Date().toISOString(), ...e }); if (stats.errors.length > 50) stats.errors.shift() }
  // backgroundVerify > 0: a finished run's report (which runs the verifier and repo checks, minutes long)
  // goes off the runner pass, at most that many at once, so verification never stalls dispatch.
  const verifying = new Map()
  const reverifyTried = new Set()
  const bg = (key, ctx, fn) => {
    const p = Promise.resolve().then(fn).catch((err) => note({ ...ctx, error: String(err?.message ?? err) })).finally(() => { verifying.delete(key); stats.verifying = verifying.size })
    verifying.set(key, p); stats.verifying = verifying.size
    return p
  }

  async function pollCampaign(id) {
    const c = controller.get(id)
    if (TERMINAL_CAMPAIGN.includes(c.state) || ['draft', 'preflighted'].includes(c.state)) return []
    const out = []
    for (const row of controller.store.tasks(id, { state: 'running' })) {
      const art = runArtifact(row)
      if (!art || art.attempt !== row.attempt) continue
      const adapter = adapters[art.transport]
      if (!adapter) { note({ campaign: id, task: row.task_id, error: `no adapter ${art.transport}` }); continue }
      const fence = { taskId: row.task_id, owner: row.lease_owner, attempt: row.attempt }
      try {
        if (row.cancel_requested) {
          const s = await adapter.stop(art)
          await controller.ackCancel(actor, id, { taskId: row.task_id, owner: row.lease_owner, observed: `stopped ${art.ref}: ${JSON.stringify(s)}` })
          stats.cancelled++
          out.push({ task: row.task_id, action: 'cancel-acked' })
          continue
        }
        stats.polls++
        const st = await adapter.poll(art)
        if (st.state === 'running') {
          controller.heartbeat(actor, id, fence)
          out.push({ task: row.task_id, action: 'heartbeat' })
        } else if (st.state === 'done') {
          let result = resultOf(art, st)
          if (git && COMMIT_TRANSPORTS.has(art.transport) && art.worktree) {
            // once per (campaign, task, attempt): a retry of this report never commits twice
            const c = await controller.once(id, `${row.task_id}:commit:a${row.attempt}`, () => commitWorktree({ git, art, campaignId: id, taskId: row.task_id, attempt: row.attempt, title: taskTitle(row.task_id) }))
            result = { ...result, ...(c.base ? { base: c.base } : {}), commit: { committed: !!c.committed, head: c.head ?? null, error: c.commit_error ?? null }, ...(c.no_changes ? { no_changes: true } : {}), ...(c.commit_error ? { commit_error: c.commit_error } : {}) }
          }
          const key = `${id}:${row.task_id}:a${row.attempt}`
          if (backgroundVerify > 0) bg(key, { campaign: id, task: row.task_id }, () => controller.reportResult(actor, id, { ...fence, result }))
          else await controller.reportResult(actor, id, { ...fence, result })
          stats.reported++
          out.push({ task: row.task_id, action: 'result' })
        } else {
          await controller.reportFailure(actor, id, { ...fence, error: st.error ?? 'run failed' })
          stats.failed++
          out.push({ task: row.task_id, action: 'failure' })
        }
      } catch (err) {
        note({ campaign: id, task: row.task_id, error: String(err?.message ?? err) })
        out.push({ task: row.task_id, action: 'error', error: String(err?.message ?? err) })
      }
    }
    // a verification orphaned by a pm restart (awaiting_verification, no verifier running here) is re-run once
    if (backgroundVerify > 0 && typeof controller.reverify === 'function') {
      for (const row of controller.store.tasks(id, { state: 'awaiting_verification' })) {
        const key = `${id}:${row.task_id}:a${row.attempt}`
        if (verifying.size >= backgroundVerify) break
        if (verifying.has(key) || reverifyTried.has(key)) continue
        reverifyTried.add(key); stats.reverified++
        bg(key, { campaign: id, task: row.task_id }, () => controller.reverify(actor, id, row.task_id))
        out.push({ task: row.task_id, action: 'reverify' })
      }
    }
    return out
  }

  return { pollCampaign, stats: () => ({ ...stats, errors: [...stats.errors] }) }
}

/** The three real adapters (each refuses unless BLITZ_DISPATCH_ENABLED=1 and the campaign is authorized). */
export function defaultAdapters({ spawn = nodeSpawn, env = process.env, fs = nodeFs, dshHomes, bridge = null } = {}) {
  return {
    'dsh-run': dshRunAdapter({ spawn, env, fs, dshHomes }),
    codex: codexAdapter({ spawn, env, fs }),
    'bridge-claude': bridgeClaudeAdapter({ bridge: queueBridge(bridge?.queue), fs }),
  }
}

/**
 * BLITZ-08 engine without recovery/verification (kept for its tests and the pilot). pm itself uses
 * engine.mjs createEngine, which composes guard(recovery(controller)) with BLITZ-07 verification.
 *
 * Everything wired together for server.mjs: one guarded controller shared by the REST routes,
 * the runner, the poller and the status routes.
 */
export function createBlitzEngine({
  store, db = store?.db, ledgerDb = () => null, bridge = null, env = process.env, spawn = nodeSpawn, git, fs = nodeFs,
  adapters, readSnapshot, ceilings, stopPercent, unknown, providerOf, dshHomes, workspaceRoot,
  verify, escalate, clock = () => new Date(), leaseSeconds, maxAttempts, machines, registry,
} = {}) {
  const base = registry ?? createAgentRegistry(db, { store, clock, machines })
  const guard = createGuard({ db, clock, ceilings, stopPercent, unknown, ...(providerOf ? { providerOf } : {}), ...(readSnapshot ? { readSnapshot } : {}) })
  const ad = adapters ?? defaultAdapters({ spawn, env, fs, dshHomes, bridge })
  let ctl = null
  const dispatch = createDispatcher({ adapters: ad, getCampaign: (id) => ctl.get(id), env, fs, git: git ?? defaultGit(spawn), ...(workspaceRoot ? { root: workspaceRoot } : {}) })
  const raw = createController({
    store, db, ledgerDb, registry: guard.wrapRegistry(base), dispatch, clock,
    ...(verify ? { verify } : {}), ...(escalate ? { escalate } : {}),
    ...(leaseSeconds ? { leaseSeconds } : {}), ...(maxAttempts ? { maxAttempts } : {}),
  })
  ctl = guardController(raw, guard)
  const poller = createPoller({ controller: ctl, adapters: ad })
  return { controller: ctl, raw, guard, poller, adapters: ad, dispatch, registry: base }
}

// ---------------------------------------------------------------------------
// `node dispatch.mjs wrap --exit F --stdin F --stdout F --stderr F -- cmd args...`
// Runs one command with files for stdio and writes {code, signal, at} to --exit when it ends,
// so a detached run's outcome survives a pm restart.
// ---------------------------------------------------------------------------
export async function wrapMain(argv, { spawn = nodeSpawn, fs = nodeFs } = {}) {
  const sep = argv.indexOf('--')
  if (sep < 0 || sep === argv.length - 1) throw new Error('wrap needs -- <command> [args...]')
  const opts = {}
  for (let i = 0; i < sep; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1]
  if (!opts.exit) throw new Error('wrap needs --exit <file>')
  const [cmd, ...args] = argv.slice(sep + 1)
  const fd = (f, mode) => (f ? fs.openSync(f, mode) : 'ignore')
  const write = (rec) => { const tmp = `${opts.exit}.tmp`; fs.writeFileSync(tmp, JSON.stringify(rec)); fs.renameSync(tmp, opts.exit) }
  return new Promise((res) => {
    let child
    try {
      child = spawn(cmd, args, { stdio: [fd(opts.stdin, 'r'), fd(opts.stdout, 'a'), fd(opts.stderr, 'a')], windowsHide: true })
    } catch (err) { write({ code: -1, error: String(err.message), at: new Date().toISOString() }); return res(1) }
    child.on('error', (err) => { write({ code: -1, error: String(err.message), at: new Date().toISOString() }); res(1) })
    child.on('close', (code, signal) => { write({ code, signal, at: new Date().toISOString() }); res(code ?? 1) })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv[2] === 'wrap') {
  wrapMain(process.argv.slice(3)).then((code) => process.exit(code), (err) => { console.error(err.message); process.exit(2) })
}

