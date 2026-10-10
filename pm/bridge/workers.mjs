// Bridge workers: the local agents that consume queued messages, and the
// forwarder that moves outbox messages to their target machine.
//
//   node         answers ping / status / message on this machine (retry-safe)
//   claude-code  runs `claude -p` headless; never auto-retried after a lost lease
//
// The user pre-approved bridge-started Claude Code runs on 2026-10-08 ("preapprove
// create code fastest possible"). The gate that remains: the caller needs the
// `execute` scope, the quota gate must pass, the weight router picks (or
// validates) the model, and at most BRIDGE_EXEC_SLOTS runs at once.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { replyTo } from './protocol.mjs'
import { chooseModel, quotaGate } from './weight.mjs'
import { inside } from './files.mjs'

export function claudeBinary() {
  if (process.env.BRIDGE_CLAUDE_BIN) return process.env.BRIDGE_CLAUDE_BIN
  const exe = join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  return existsSync(exe) ? exe : 'claude'
}

export const PERMISSION_MODES = ['default', 'acceptEdits', 'auto']

/** First root is the per-run scratch area; the shared brain (notes + pm) is always reachable. */
export function execRoots() {
  const extra = (process.env.BRIDGE_EXEC_ROOTS || '').split(';').map((s) => s.trim()).filter(Boolean)
  return [join(homedir(), '.claude', 'pm-data', 'bridge-work'), join(homedir(), '.claude', 'shared-brain'), ...extra]
}

function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  } else {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch {} }
  }
}

export function createWorkers(queue, {
  slots = Number(process.env.BRIDGE_EXEC_SLOTS) || 2,
  pollMs = 300,
  leaseSeconds = 60,
  logDir = join(homedir(), '.claude', 'pm-data', 'bridge-logs'),
  forwardTo = null, // async (peerMachine, envelope) => void ; throws on failure
  router, // undefined = load the DSH router; null = none (tests)
  quota = quotaGate,
  bin = claudeBinary(),
  binArgs = [], // prefix args (tests run a fake claude through node)
  notify = null, // (action, data) => void ; records delivery escalations as pm events
  sweepMs = 5000,
} = {}) {
  const running = new Map() // submit id -> { child, fence, cancelled }
  let timer = null
  let busy = false
  let stopped = false
  mkdirSync(logDir, { recursive: true })

  const send = (env) => queue.enqueue(env, { principal: `worker@${queue.machine}` })
  const log = (id, line) => appendFileSync(join(logDir, `${id}.log`), `${new Date().toISOString()} ${line}\n`)

  // ---- node agent: retry-safe, answers immediately -------------------------
  function handleNode(msg) {
    if (msg.type === 'ping' || msg.type === 'message') {
      send(replyTo(msg, 'result', { pong: msg.type === 'ping', echo: msg.body, machine: queue.machine, received_at: queue.now() }, { agent: 'node' }))
    } else if (msg.type === 'status') {
      send(replyTo(msg, 'status', { machine: queue.machine, queue: queue.stats(), running: [...running.keys()], slots }, { agent: 'node' }))
    } else {
      send(replyTo(msg, 'error', { error: `node agent does not handle ${msg.type}` }, { agent: 'node' }))
    }
    queue.settle(msg.id, msg.fence, 'done')
  }

  // ---- claude-code executor -------------------------------------------------
  async function startClaude(msg) {
    const b = msg.body
    const fail = (error, extra = {}) => {
      send(replyTo(msg, 'error', { error, ...extra }, { agent: 'claude-code' }))
      queue.settle(msg.id, msg.fence, 'done', error)
    }
    if (typeof b.prompt !== 'string' || !b.prompt.trim()) return fail('body.prompt is required')
    const q = quota()
    if (!q.ok) return fail(`quota gate: ${q.reason}`, { quota: q })
    let choice
    try {
      choice = await chooseModel({ pinned: b.model, capability: b.capability, policy: b.policy, quotaHeadroom: q.headroom }, router === undefined ? {} : { router })
    } catch (err) {
      return fail(`weight router: ${err.message}`, err.extra ?? {})
    }
    const workRoot = execRoots()[0]
    const cwd = b.cwd ? resolve(b.cwd) : join(workRoot, msg.id)
    if (b.cwd && !execRoots().some((r) => inside(r, cwd) || resolve(r) === cwd)) return fail(`cwd ${b.cwd} is outside BRIDGE_EXEC_ROOTS`)
    mkdirSync(cwd, { recursive: true })
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', choice.model,
      '--permission-mode', PERMISSION_MODES.includes(b.permission_mode) ? b.permission_mode : 'default']
    for (const r of execRoots().slice(1)) if (existsSync(r) && resolve(r) !== cwd) args.push('--add-dir', r)
    // headless -p does not prompt, so MCP tools must be allowlisted: auto runs get the pm server
    if (b.permission_mode === 'auto') args.push('--allowedTools', process.env.BRIDGE_AUTO_TOOLS || 'mcp__pm')
    if (b.resume_session) args.push('--resume', String(b.resume_session))
    if (Number(b.max_turns) > 0) args.push('--max-turns', String(Math.min(Number(b.max_turns), 50)))
    log(msg.id, `spawn ${bin} ${args.join(' ')} cwd=${cwd} model=${choice.model} via=${choice.router}`)
    send(replyTo(msg, 'accept', { machine: queue.machine, model: choice.model, candidate: choice.candidateId, router: choice.router,
      reason: choice.assignment?.reason ?? 'pinned', quota: q, cwd, log: join(logDir, `${msg.id}.log`) }, { agent: 'claude-code' }))

    const child = spawn(bin, [...binArgs, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'pm-bridge' } })
    const run = { child, fence: msg.fence, cancelled: false, session: null, lastText: '' }
    running.set(msg.id, run)
    child.stdin.end(b.prompt)
    const hb = setInterval(() => { try { queue.extend(msg.id, msg.fence, leaseSeconds) } catch {} }, (leaseSeconds * 1000) / 3)
    let buf = ''
    let result = null
    let progressAt = 0
    let pending = ''
    child.stdout.on('data', (d) => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let ev
        try { ev = JSON.parse(line) } catch { log(msg.id, `out ${line.slice(0, 2000)}`); continue }
        if (ev.session_id) run.session = ev.session_id
        if (ev.type === 'stream_event') {
          // partial chunks: batch text deltas into at most one progress message per second
          const d = ev.event?.delta
          if (d?.type === 'text_delta') pending += d.text
          const t = Date.now()
          if (pending && t - progressAt > 1000) {
            progressAt = t
            send(replyTo(msg, 'progress', { text: pending.slice(-4000), partial: true, session: run.session }, { agent: 'claude-code' }))
            pending = ''
          }
          continue
        }
        log(msg.id, `out ${line.slice(0, 2000)}`)
        if (ev.type === 'assistant') {
          const text = (ev.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('')
          const tools = (ev.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => c.name)
          const t = Date.now()
          if ((text || tools.length) && t - progressAt > 1000) {
            progressAt = t
            send(replyTo(msg, 'progress', { text: text.slice(0, 4000), tools, session: run.session }, { agent: 'claude-code' }))
          }
        } else if (ev.type === 'result') result = ev
      }
    })
    child.stderr.on('data', (d) => log(msg.id, `err ${String(d).trim().slice(0, 2000)}`))
    child.on('error', (err) => log(msg.id, `spawn error ${err.message}`))
    child.on('close', (code) => {
      clearInterval(hb)
      running.delete(msg.id)
      log(msg.id, `exit ${code}`)
      const common = { exit_code: code, session: run.session ?? result?.session_id ?? null, model: choice.model, machine: queue.machine,
        cost_usd: result?.total_cost_usd ?? null, duration_ms: result?.duration_ms ?? null, usage: result?.usage ?? null, log: join(logDir, `${msg.id}.log`) }
      try {
        if (run.cancelled) {
          send(replyTo(msg, 'error', { ...common, cancelled: true, error: 'cancelled' }, { agent: 'claude-code' }))
          queue.settle(msg.id, msg.fence, 'cancelled', 'cancelled')
        } else if (code === 0 && result && !result.is_error) {
          send(replyTo(msg, 'result', { ...common, text: result.result }, { agent: 'claude-code' }))
          queue.settle(msg.id, msg.fence, 'done')
        } else {
          send(replyTo(msg, 'error', { ...common, error: result?.result || `claude exited ${code}` }, { agent: 'claude-code' }))
          queue.settle(msg.id, msg.fence, 'done', `exit ${code}`)
        }
      } catch (err) {
        log(msg.id, `settle failed ${err.message}`) // stale fence: someone else owns it now; do not double-report
      }
    })
  }

  // ---- control messages addressed to the executor ---------------------------
  function handleControl(msg) {
    const target = msg.correlation_id
    let outcome
    try {
      const sub = queue.get(target)
      if (msg.type === 'cancel') {
        const run = running.get(target)
        if (run) { run.cancelled = true; killTree(run.child.pid); outcome = 'cancelling' }
        else if (['queued', 'held'].includes(sub.state)) { queue.setState(target, ['queued', 'held'], 'cancelled', 'cancelled before start'); outcome = 'cancelled' }
        else outcome = `nothing to cancel (state ${sub.state})`
      } else if (msg.type === 'pause') {
        if (running.has(target)) outcome = 'running; a started Claude run cannot be paused, only cancelled'
        else { queue.setState(target, ['queued'], 'held'); outcome = 'held' }
      } else if (msg.type === 'resume') {
        queue.setState(target, ['held'], 'queued'); outcome = 'queued'
      }
    } catch (err) {
      outcome = `error: ${err.message}`
    }
    send(replyTo(msg, 'status', { target, outcome }, { agent: 'claude-code' }))
    queue.settle(msg.id, msg.fence, 'done')
  }

  // Cross-machine failover. Default: a submit stays bound to its target machine.
  // It moves only when policy allows it (BRIDGE_ALLOW_FAILOVER=1), the sender
  // listed alternatives (body.failover_to), it is not resuming a machine-local
  // session, and the target has refused delivery `failover_after` times. The
  // undelivered original is marked dead so only one copy can ever execute.
  function failover(m) {
    const b = m.body ?? {}
    if (m.type !== 'submit' || process.env.BRIDGE_ALLOW_FAILOVER !== '1') return
    if (!Array.isArray(b.failover_to) || !b.failover_to.length || b.resume_session) return
    if (m.state !== 'dead' && m.attempts < (Number(b.failover_after) || 3)) return
    const [next, ...rest] = b.failover_to
    if (m.state === 'outbox') queue.setState(m.id, ['outbox'], 'dead', `failover to ${next}`)
    send({ v: 1, type: 'submit', id: `${m.id}.fo-${next}`.slice(0, 80), from: m.from, to: { machine: next, agent: m.to.agent },
      correlation_id: m.correlation_id ?? m.id, project: m.project ?? undefined, task: m.task ?? undefined,
      body: { ...b, failover_to: rest, failed_over_from: m.to.machine, original_id: m.id } })
  }

  // ---- delivery escalation ----------------------------------------------------
  // An overdue message is reported, never "re-delivered": a pull-only client such as
  // ChatGPT is not reachable until its user starts a turn, so the bridge says so
  // (pm event + a message to the policy's escalate_to agents for high priority).
  let lastSweep = 0
  function escalate() {
    const policy = queue.policy()
    for (const e of queue.sweepOverdue(policy)) {
      const m = e.message
      const what = e.kind === 'failed' ? `gave up: no ${e.reason}` : e.kind === 'ack' ? 'not acknowledged' : 'acknowledged but not answered'
      const data = { id: m.id, seq: m.seq, to_agent: m.to.agent, from_agent: m.from.agent, kind: e.kind, priority: m.priority,
        escalations: m.delivery.escalations, created_at: m.created_at, subject: m.body?.subject ?? null, status: what,
        last_seen_at: queue.pending(m.to.agent).last_seen_at ?? null }
      try { notify?.(e.kind === 'failed' ? 'delivery_failed' : 'delivery_overdue', data) } catch (err) { console.error('bridge notify', err) }
      if (m.priority !== 'high' || e.kind === 'failed') continue
      for (const target of policy.escalate_to) {
        if (target.agent === m.to.agent) continue
        send({ v: 1, type: 'message', dedupe_key: `esc-${m.id}-${m.delivery.escalations}`.slice(0, 80), from: { agent: 'dsh-bridge' },
          to: { machine: target.machine, agent: target.agent }, correlation_id: m.correlation_id ?? m.id, project: m.project ?? undefined,
          body: { subject: `Escalation: ${m.to.agent} ${what} (seq ${m.seq})`, escalation: data,
            note: `${m.to.agent} has not been reached: the bridge stored the message but ${m.to.agent} has not ${e.kind === 'ack' ? 'retrieved and acknowledged it' : 'replied'}. Last seen ${data.last_seen_at ?? 'never'}.` } })
      }
    }
  }

  async function tick() {
    if (busy || stopped) return
    busy = true
    try {
      queue.reconcile({ retrySafe: new Set(['node']) })
      if (Date.now() - lastSweep >= sweepMs) { lastSweep = Date.now(); escalate() }
      for (let m; (m = queue.lease(['node'], { seconds: leaseSeconds })); ) handleNode(m)
      for (let m; (m = queue.lease(['claude-code'], { seconds: leaseSeconds, types: ['cancel', 'pause', 'resume'] })); ) handleControl(m)
      while (running.size < slots) {
        const m = queue.lease(['claude-code'], { seconds: leaseSeconds, types: ['submit'] })
        if (!m) break
        await startClaude(m)
      }
      if (forwardTo) {
        for (const m of queue.due()) {
          try {
            await forwardTo(m.to.machine, m)
            queue.forwardResult(m.id, true)
          } catch (err) {
            const after = queue.forwardResult(m.id, false, String(err.message ?? err).slice(0, 500))
            failover(after)
          }
        }
      }
    } catch (err) {
      console.error('bridge tick', err)
    } finally {
      busy = false
    }
  }

  return {
    start() {
      // Leases held by a previous process: node work is requeued, executions become uncertain.
      const lost = queue.reconcile({ retrySafe: new Set(['node']), all: true })
      if (lost.length) console.log('bridge boot reconcile', JSON.stringify(lost))
      timer = setInterval(tick, pollMs)
      return this
    },
    stop() { stopped = true; clearInterval(timer); for (const r of running.values()) { r.cancelled = true; killTree(r.child.pid) } },
    tick,
    escalate,
    running,
  }
}

/** Forwarder over HTTP to peer pm nodes. peers: { machine: { url, token } } */
export function httpForwarder(peers) {
  return async (machine, env) => {
    const p = peers[machine]
    if (!p) throw new Error(`no peer configured for machine ${machine}`)
    const { state, attempts, last_error, seq, updated_at, delivery, ...wire } = env
    const res = await fetch(`${p.url.replace(/\/$/, '')}/api/bridge/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(p.token ? { authorization: `Bearer ${p.token}` } : {}) },
      body: JSON.stringify(wire),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`peer ${machine} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}
