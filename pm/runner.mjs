#!/usr/bin/env node
// pm Phase 4 - the machine runner.
//
//   node runner.mjs run [--once] [--remote]     claim, prepare, heartbeat, ack cancels
//   node runner.mjs spawn <task-id> [--shell] -- <command> [args...]
//   node runner.mjs cancel <run-id> [reason]
//   node runner.mjs status
//
// WHAT THE RUNNER DOES ON ITS OWN, AND WHAT IT NEVER DOES.
// pm prepares runs and never dispatches one. The daemon (`run`) only does
// plumbing: it connects outbound to pm, registers this machine, claims tasks
// explicitly routed to it (assignee = this runner AND execution_machine = one
// of this machine's names), gives each claim its own workspace (a separate git
// clone when the task names a repo), keeps the lease alive, delivers pending
// instructions into the workspace, and acknowledges cancellation after it has
// observed the process gone. Then it waits.
//
// It never starts a DSH council, pipeline or swarm (those kinds are not even
// claimable: they start only through actions.mjs prepare/start, with seats the
// user picked), never defaults a roster, and never launches a process. The one
// way anything executes is `spawn`, a command the user types, naming the
// command to run. There is no default command, so a paid session can only
// start because the user wrote it on the command line.
import { spawn as spawnChild, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync, createWriteStream } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { THIS_MACHINE, machineNames } from './actions.mjs'

export const DSH_KINDS = ['dsh-council', 'dsh-pipeline']
const LIVE_STATES = ['held', 'starting', 'running']
const safe = (s) => String(s).replace(/[^\w.-]/g, '_')

export function runnerConfig(env = process.env) {
  const machine = env.PM_MACHINE || THIS_MACHINE
  const lease = Number(env.PM_RUNNER_LEASE) || 120
  return {
    url: (env.PM_URL || 'http://127.0.0.1:4480').replace(/\/$/, ''),
    token: env.PM_TOKEN || '',
    machine,
    machines: [...machineNames(machine)],
    actor: env.PM_RUNNER_ACTOR || `pm-runner@${machine}`,
    root: env.PM_RUNNER_ROOT || join(homedir(), '.claude', 'pm-data', 'runner'),
    leaseSeconds: lease,
    pollMs: (Number(env.PM_RUNNER_POLL) || Math.max(5, Math.floor(lease / 4))) * 1000,
    slots: Number(env.PM_RUNNER_SLOTS) || 1,
  }
}

/** Read PM_URL / PM_TOKEN from ~/.claude/pm-remote.env (the sealed remote pair). */
export function loadRemoteEnv(file = join(homedir(), '.claude', 'pm-remote.env')) {
  const out = {}
  if (!existsSync(file)) throw new Error(`--remote needs ${file}`)
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(PM_URL|PM_TOKEN)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

export function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

function killTree(pid) {
  if (!pidAlive(pid)) return
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  } else {
    try { process.kill(Number(pid), 'SIGTERM') } catch {}
  }
}

async function waitDead(pid, ms = 5000) {
  const until = Date.now() + ms
  while (pidAlive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 100))
  return !pidAlive(pid)
}

export function createRunner(opts = {}) {
  const cfg = { ...runnerConfig(), ...opts }
  const fetchImpl = opts.fetchImpl ?? fetch
  const log = opts.log ?? ((m) => console.log(`[runner ${cfg.actor}] ${m}`))
  const tracked = new Map() // runId -> { taskId, workspace }

  async function call(method, path, body) {
    const headers = { 'content-type': 'application/json', 'x-pm-actor': cfg.actor }
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`
    let res
    try {
      res = await fetchImpl(cfg.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch (err) {
      throw Object.assign(new Error(`cannot reach pm at ${cfg.url} (${err.cause?.code ?? err.message})`), { status: 0 })
    }
    const data = await res.json()
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data })
    return data
  }

  const capabilities = {
    kinds: ['shell', 'claude-code'],
    dispatch: 'user-triggered spawn only; never starts DSH runs',
    isolation: 'directory + separate git clone per assignment',
    platform: process.platform,
  }

  function workspaceFor(taskId, runId) {
    const dir = resolve(cfg.root, safe(cfg.machine), safe(taskId), safe(runId))
    if (!dir.startsWith(resolve(cfg.root) + sep)) throw new Error(`workspace ${dir} escapes ${cfg.root}`)
    return dir
  }

  // One directory per assignment; a separate clone when the task names a repo.
  // An existing directory is only ever reused for the SAME run (recovery).
  function prepareWorkspace(task, run) {
    const dir = workspaceFor(task.id, run.id)
    let meta = {}
    try { meta = JSON.parse(task.meta || '{}') } catch {}
    const repo = meta.repo ?? meta.workspace?.repo ?? null
    const branch = meta.branch ?? meta.workspace?.branch ?? null
    mkdirSync(dir, { recursive: true })
    let cwd = dir
    if (repo) {
      cwd = join(dir, 'repo')
      if (!existsSync(join(cwd, '.git'))) {
        const args = ['clone', '--quiet', ...(branch ? ['--branch', branch] : []), repo, cwd]
        execFileSync('git', args, { stdio: ['ignore', 'ignore', 'pipe'] })
      }
    }
    writeFileSync(join(dir, 'PM-TASK.json'), JSON.stringify({
      task: task.id, run: run.id, title: task.title, body: task.body, next_action: task.next_action,
      checkpoint: task.checkpoint, pm: cfg.url, runner: cfg.actor, repo, cwd,
      note: 'Prepared by the pm runner. Nothing runs here until the user types: node runner.mjs spawn ' + task.id + ' -- <command>',
    }, null, 2))
    return { workspace: dir, cwd, repo }
  }

  function deliverInstructions(entry, instructions) {
    if (!instructions?.length || !entry.workspace) return
    const text = instructions.map((i) => `## #${i.id} from ${i.actor} at ${i.created_at}\n\n${i.body}\n`).join('\n')
    writeFileSync(join(entry.workspace, 'PM-INSTRUCTIONS.md'), `# Unacknowledged pm instructions\n\nAcknowledge each with pm_ack_instruction once acted on.\n\n${text}`)
  }

  async function handleCancel(runId, run) {
    const pid = run.pid
    let observed
    if (pid && pidAlive(pid)) {
      killTree(pid)
      if (!(await waitDead(pid))) {
        log(`cancel ${runId}: pid ${pid} still alive; leaving the cancel as requested`)
        return false
      }
      observed = `process ${pid} terminated by runner and observed gone`
    } else {
      observed = pid ? `process ${pid} was already gone` : 'no process was running (run was held)'
    }
    try {
      await call('POST', `/api/runs/${runId}/cancel-ack`, { observed })
      log(`cancel ${runId} acknowledged: ${observed}`)
    } catch (err) {
      if (err.status !== 409) throw err
      log(`cancel ${runId}: ack refused (${err.message})`)
    }
    tracked.delete(runId)
    return true
  }

  const runner = {
    cfg,
    tracked,
    call,

    register() {
      return call('POST', '/api/runners/register', { machine: cfg.machine, capabilities, pid: process.pid })
    },

    // Restart recovery: take back what this runner still owns, relaunch nothing.
    async recover() {
      const report = { reattached: [], failed: [], dropped: [] }
      for (const state of LIVE_STATES) {
        const runs = await call('GET', `/api/runs?owner=${encodeURIComponent(cfg.actor)}&state=${state}`)
        for (const run of runs) {
          try {
            await call('POST', `/api/runs/${run.id}/reattach`, { leaseSeconds: cfg.leaseSeconds })
          } catch (err) {
            if (err.status !== 409) throw err
            report.dropped.push(run.id)
            log(`recover ${run.id}: not ours any more (${err.message})`)
            continue
          }
          if (state !== 'held' && !pidAlive(run.pid)) {
            await call('POST', `/api/runs/${run.id}/finish`, { exit_code: null, note: `process ${run.pid ?? '(none)'} gone after runner restart; exit code unknown; not relaunched` })
            report.failed.push(run.id)
            continue
          }
          tracked.set(run.id, { taskId: run.task_id, workspace: run.detail?.workspace ?? null })
          report.reattached.push(run.id)
        }
      }
      return report
    },

    // One pass: heartbeat and service what is held, then claim up to `slots`.
    async tick() {
      const out = { heartbeats: 0, cancelled: [], lost: [], claimed: [] }
      for (const [runId, entry] of [...tracked]) {
        let hb
        try {
          hb = await call('POST', `/api/runs/${runId}/heartbeat`, { leaseSeconds: cfg.leaseSeconds })
        } catch (err) {
          if (err.status !== 409 && err.status !== 404) throw err
          tracked.delete(runId)
          out.lost.push(runId)
          log(`lost ${runId}: ${err.message}`)
          continue
        }
        out.heartbeats++
        deliverInstructions(entry, hb.instructions)
        if (hb.cancel_requested && (await handleCancel(runId, hb.run))) out.cancelled.push(runId)
      }
      while (tracked.size < cfg.slots) {
        const got = await call('POST', '/api/runners/claim', { machines: cfg.machines, leaseSeconds: cfg.leaseSeconds })
        if (!got) break
        const { task, run } = got
        try {
          const ws = prepareWorkspace(task, run)
          await call('POST', `/api/runs/${run.id}/runner-update`, { detail: ws, last_checkpoint: `workspace ready at ${ws.workspace}; waiting for the user to spawn` })
          tracked.set(run.id, { taskId: task.id, workspace: ws.workspace })
          out.claimed.push({ task: task.id, run: run.id, ...ws })
          log(`claimed ${task.id} as ${run.id}; workspace ${ws.workspace}; nothing started`)
        } catch (err) {
          await call('POST', `/api/runs/${run.id}/finish`, { exit_code: null, note: `workspace preparation failed: ${err.message}` }).catch(() => {})
          log(`claim ${task.id}: workspace failed: ${err.message}`)
        }
      }
      return out
    },

    async loop({ signal } = {}) {
      await runner.register()
      const rec = await runner.recover()
      log(`registered on ${cfg.machine} (${cfg.machines.join('/')}); recovered ${JSON.stringify(rec)}`)
      while (!signal?.aborted) {
        try {
          await runner.tick()
        } catch (err) {
          log(`tick failed: ${err.message}`)
        }
        await new Promise((r) => { const t = setTimeout(r, cfg.pollMs); signal?.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true }) })
      }
    },

    requestCancel(runId, reason = '') {
      return call('POST', `/api/runs/${runId}/cancel`, { reason })
    },

    // THE ONLY WAY ANYTHING EXECUTES. Called by the user, with the command.
    async spawn(taskId, argv, { shell = false, stdio = 'inherit' } = {}) {
      if (!argv?.length) throw new Error('spawn needs the command to run after `--`; the runner has no default command')
      const task = await call('GET', `/api/tasks/${encodeURIComponent(taskId)}`)
      if (DSH_KINDS.includes(task.kind)) throw new Error(`${taskId} is a ${task.kind} task: DSH runs start only through pm prepare/start with the seats the user picks, never through the runner`)
      if (!task.run_ref) throw new Error(`${taskId} has no run; the runner must claim it first (assign it to ${cfg.actor} with execution_machine ${cfg.machine})`)
      const run = await call('GET', `/api/runs/${task.run_ref}`)
      if (run.owner !== cfg.actor) throw new Error(`run ${run.id} is owned by ${run.owner ?? 'nobody'}, not ${cfg.actor}`)
      if (run.state !== 'held') throw new Error(`run ${run.id} is ${run.state}; spawn starts only a held run, and never relaunches one`)
      if (run.cancel_requested_at) throw new Error(`run ${run.id} has a cancel pending`)
      const cwd = run.detail?.cwd ?? run.detail?.workspace
      if (!cwd || !existsSync(cwd)) throw new Error(`run ${run.id} has no prepared workspace`)

      await call('POST', `/api/runs/${run.id}/runner-update`, { state: 'starting', last_checkpoint: `user spawn: ${argv.join(' ').slice(0, 200)}` })
      const logFile = join(run.detail.workspace ?? cwd, 'run.log')
      const child = spawnChild(argv[0], argv.slice(1), { cwd, shell, stdio: stdio === 'inherit' ? ['inherit', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], windowsHide: true })
      const out = createWriteStream(logFile, { flags: 'a' })
      child.stdout.on('data', (d) => { out.write(d); if (stdio === 'inherit') process.stdout.write(d) })
      child.stderr.on('data', (d) => { out.write(d); if (stdio === 'inherit') process.stderr.write(d) })
      const exited = new Promise((r) => {
        child.on('error', (err) => r({ code: null, error: err.message }))
        child.on('exit', (code) => r({ code }))
      })
      if (child.pid) await call('POST', `/api/runs/${run.id}/runner-update`, { state: 'running', pid: child.pid, detail: { command: argv, log: logFile } })

      let cancelling = false
      const beat = setInterval(async () => {
        try {
          const hb = await call('POST', `/api/runs/${run.id}/heartbeat`, { leaseSeconds: cfg.leaseSeconds })
          if (hb.cancel_requested && !cancelling) { cancelling = true; killTree(child.pid) }
        } catch {}
      }, Math.min(cfg.pollMs, 2000))
      const result = await exited
      clearInterval(beat)
      await new Promise((r) => out.end(r))

      if (cancelling) {
        await call('POST', `/api/runs/${run.id}/cancel-ack`, { observed: `process ${child.pid} exited after cancel (code ${result.code})` }).catch((err) => log(`cancel-ack: ${err.message}`))
        return { runId: run.id, cancelled: true, exit_code: result.code }
      }
      try {
        const fin = await call('POST', `/api/runs/${run.id}/finish`, { exit_code: result.code, note: result.error ?? `${argv[0]} exited ${result.code}; log ${logFile}` })
        return { runId: run.id, exit_code: result.code, state: fin.run.state, task_status: fin.task.status }
      } catch (err) {
        // A cancel handled by the daemon, or a reassignment: the fence refuses the stale write.
        return { runId: run.id, exit_code: result.code, refused: err.message }
      }
    },

    async status() {
      const runs = []
      for (const state of LIVE_STATES) runs.push(...(await call('GET', `/api/runs?owner=${encodeURIComponent(cfg.actor)}&state=${state}`)))
      return { runner: cfg.actor, machine: cfg.machine, url: cfg.url, runs: runs.map((r) => ({ id: r.id, task: r.task_id, state: r.state, pid: r.pid, cancel_requested: Boolean(r.cancel_requested_at), workspace: r.detail?.workspace })) }
    },
  }
  return runner
}

async function main(argv) {
  const [cmd, ...rest] = argv
  const env = { ...process.env }
  if (rest.includes('--remote')) Object.assign(env, loadRemoteEnv())
  const cfg = runnerConfig(env)
  const r = createRunner(cfg)
  switch (cmd) {
    case 'run': {
      if (rest.includes('--once')) {
        await r.register()
        const rec = await r.recover()
        const out = await r.tick()
        console.log(JSON.stringify({ runner: cfg.actor, machine: cfg.machine, recovered: rec, tick: out }))
        return 0
      }
      const ac = new AbortController()
      process.on('SIGINT', () => ac.abort())
      process.on('SIGTERM', () => ac.abort())
      await r.loop({ signal: ac.signal })
      return 0
    }
    case 'spawn': {
      const dash = rest.indexOf('--')
      const taskId = rest[0]
      if (!taskId || dash < 0) throw new Error('usage: node runner.mjs spawn <task-id> [--shell] -- <command> [args...]')
      const res = await r.spawn(taskId, rest.slice(dash + 1), { shell: rest.slice(0, dash).includes('--shell') })
      console.log(JSON.stringify(res))
      return res.exit_code ?? 1
    }
    case 'cancel': {
      if (!rest[0]) throw new Error('usage: node runner.mjs cancel <run-id> [reason]')
      console.log(JSON.stringify(await r.requestCancel(rest[0], rest.slice(1).filter((x) => x !== '--remote').join(' '))))
      return 0
    }
    case 'status':
      console.log(JSON.stringify(await r.status(), null, 2))
      return 0
    default:
      console.log('usage: node runner.mjs run [--once] | spawn <task-id> [--shell] -- <cmd...> | cancel <run-id> [reason] | status   (add --remote to use ~/.claude/pm-remote.env)')
      return cmd ? 2 : 0
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // exitCode, not process.exit(): exiting with fetch handles still open trips a
  // libuv assertion on Windows (0xC0000409) and hides the real result.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (err) => { console.error(err.message); process.exitCode = 1 })
}
