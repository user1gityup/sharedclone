#!/usr/bin/env node
// OPERATIONAL INTEGRATION TESTS - real pm server(s), real `claude -p` runs, real files.
//   node bridge/integration.mjs <scratch-dir> [--only 1,2,...] [--peer <url> --peer-machine <name>]
// --peer: use a real remote pm (e.g. vmixer2o2) as node-b instead of a local :4481
// instance; token from PM_TOKEN or ~/.claude/pm-remote.env. Test 7 needs the peer
// restarted, so it reports BLOCKED in peer mode.
// Needs: pm on 127.0.0.1:4480 with the bridge (BRIDGE_ALLOW_FAILOVER=1, BRIDGE_PEERS
// naming node-b at :4481). This script starts/stops node-b itself (second pm
// instance, separate DBs, PM_MACHINE=node-b) as the "other machine" until
// vmixer2o2 is reachable. Evidence: ~/.claude/pm-data/bridge-evidence/<stamp>.json
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, hostname } from 'node:os'
import { fileURLToPath } from 'node:url'
import { pushFile, pullFile, fileSha256 } from './files.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const S = process.argv[2]
if (!S) { console.error('usage: integration.mjs <scratch-dir> [--only 1,2]'); process.exit(2) }
const onlyIdx = process.argv.indexOf('--only')
const ONLY = onlyIdx > 0 ? new Set(process.argv[onlyIdx + 1].split(',')) : null
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const PEER = arg('--peer')
const PB = PEER ? (arg('--peer-machine') || 'vmixer2o2') : 'node-b'
const envFile = join(homedir(), '.claude', 'pm-remote.env')
const TOKEN = process.env.PM_TOKEN || (existsSync(envFile) ? (readFileSync(envFile, 'utf8').match(/^PM_TOKEN=(.+)$/m)?.[1].trim() ?? null) : null)
const A = 'http://127.0.0.1:4480'
const B = PEER || 'http://127.0.0.1:4481'
const BTOK = PEER ? TOKEN : undefined
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const evDir = join(homedir(), '.claude', 'pm-data', 'bridge-evidence')
mkdirSync(evDir, { recursive: true })
const report = { started_at: new Date().toISOString(), host: hostname(), node_a: A, node_b: PEER ? `${B} (remote peer ${PB})` : `${B} (second local pm instance, PM_MACHINE=node-b)`, tests: [] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(base, method, path, body, token = base === B ? BTOK : undefined) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const post = (base, env) => api(base, 'POST', '/api/bridge/messages', env).then((r) => { if (r.status !== 200) throw new Error(`POST ${r.status} ${JSON.stringify(r.body)}`); return r.body })
const thread = (base, id) => api(base, 'GET', `/api/bridge/threads/${id}`).then((r) => r.body)
async function until(fn, ms, what) {
  const end = Date.now() + ms
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(500) }
  throw new Error(`timeout: ${what}`)
}
const final = (base, id, ms = 300_000) => until(async () => (await thread(base, id)).find((m) => m.correlation_id === id && m.id !== id && ['result', 'error'].includes(m.type)), ms, `final reply to ${id}`)

let nodeB = null
function startB() {
  if (PEER) return until(async () => (await api(B, 'GET', '/api/bridge/health').catch(() => ({}))).status === 200, 15_000, `${PB} bridge up`)
  nodeB = spawn(process.execPath, [join(HERE, '..', 'server.mjs')], {
    env: { ...process.env, PM_PORT: '4481', PM_MACHINE: 'node-b', PM_DB: join(S, 'pm-b.db'), BRIDGE_DB: join(S, 'bridge-b.db'),
      BRIDGE_PEERS: join(S, 'peers-b.json'), BRIDGE_INBOX: join(S, 'inbox-b'), BRIDGE_ALLOW_FAILOVER: '' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  nodeB.stdout.on('data', (d) => writeFileSync(join(S, 'node-b.log'), d, { flag: 'a' }))
  nodeB.stderr.on('data', (d) => writeFileSync(join(S, 'node-b.log'), d, { flag: 'a' }))
  return until(async () => (await api(B, 'GET', '/api/bridge/health').catch(() => ({}))).status === 200, 15_000, 'node-b up')
}
function killB() {
  if (PEER || !nodeB) return
  try { execFileSync('taskkill', ['/PID', String(nodeB.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  nodeB = null
}

async function run(n, name, fn) {
  if (ONLY && !ONLY.has(String(n))) return
  const t0 = Date.now()
  const entry = { n, name, started_at: new Date().toISOString() }
  try {
    entry.evidence = await fn()
    entry.outcome = entry.evidence?.blocked ? 'BLOCKED' : 'PASS'
  } catch (err) {
    entry.outcome = 'FAIL'
    entry.error = String(err.stack ?? err)
  }
  entry.seconds = Math.round((Date.now() - t0) / 100) / 10
  report.tests.push(entry)
  console.log(`${entry.outcome.padEnd(7)} ${n}. ${name} (${entry.seconds}s)${entry.error ? `\n   ${entry.error.split('\n')[0]}` : ''}`)
}

const PROMPT = (s) => `Reply with exactly the text "${s}" and nothing else. Do not use any tools.`

await startB()
try {
  await run(1, `message to a DSH node, correlated reply (node-a -> ${PB} -> node-a)`, async () => {
    const m = await post(A, { type: 'ping', to: { machine: PB, agent: 'node' }, from: { agent: 'it' }, body: { probe: stamp } })
    const r = await until(async () => (await thread(A, m.id)).find((x) => x.reply_to === m.id), 30_000, 'pong')
    if (r.from.machine !== PB || r.correlation_id !== m.id || r.body.echo.probe !== stamp) throw new Error(`bad reply ${JSON.stringify(r)}`)
    return { sent: m.id, reply: r.id, reply_from: r.from, correlation_id: r.correlation_id, received_at: r.body.received_at }
  })

  await run(2, 'Claude Code through DSH: real generated response', async () => {
    const word = `BRIDGE-OK-${stamp.slice(11, 19)}`
    const m = await post(A, { type: 'submit', to: { agent: 'claude-code' }, from: { agent: 'it' }, body: { prompt: PROMPT(word), capability: 'low', max_turns: 2 } })
    const f = await final(A, m.id)
    const t = await thread(A, m.id)
    if (f.type !== 'result' || !String(f.body.text).includes(word)) throw new Error(`unexpected: ${JSON.stringify(f.body)}`)
    const acc = t.find((x) => x.type === 'accept')
    return { submit: m.id, model: f.body.model, router: acc.body.router, candidate: acc.body.candidate, reason: acc.body.reason, quota: acc.body.quota,
      session: f.body.session, exit_code: f.body.exit_code, cost_usd: f.body.cost_usd, text: f.body.text, log: f.body.log, events: t.map((x) => x.type) }
  })

  await run(3, 'Claude Desktop-compatible MCP transport (stdio shim -> /mcp)', async () => {
    const shim = spawn(process.execPath, [join(HERE, 'cli.mjs'), 'mcp-stdio'], { env: { ...process.env, BRIDGE_URL: A }, stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = []
    shim.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)))
    const send = (o) => shim.stdin.write(`${JSON.stringify(o)}\n`)
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'it', version: '1' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bridge_send', arguments: { to_agent: 'node', type: 'ping', from_agent: 'claude-desktop' } } })
    await until(() => lines.length >= 3, 15_000, 'shim replies')
    shim.stdin.end()
    const res = lines.map((l) => JSON.parse(l))
    const id = res.find((r) => r.id === 3).result.structuredContent.result.id
    const pong = await until(async () => (await thread(A, id)).find((x) => x.reply_to === id), 20_000, 'pong via mcp')
    return { transport: 'stdio MCP shim (bridge/cli.mjs mcp-stdio) -> HTTP /mcp on node-a', server: res[0].result.serverInfo, tools: res[1].result.tools.map((t) => t.name), call_id: id, reply: pong.type,
      limitation: 'Claude Desktop app itself not registered/restarted by this run: needs the mcpServers entry in claude_desktop_config.json and a Desktop restart (GUI). MCP gives tool exchange only, not control of the Desktop UI.' }
  })

  await run(4, 'real file both directions, SHA-256 recomputed at destination', async () => {
    const src = join(S, `payload-${stamp}.bin`)
    writeFileSync(src, Buffer.concat([Buffer.from(`bridge payload ${stamp}\n`), Buffer.alloc(2_500_000, 7)]))
    if (PEER) {
      const ab = await pushFile({ url: B, token: BTOK, file: src, fromMachine: 'vmixlaptop2x6' })
      const back = join(S, `pulled-from-${PB}-${stamp}.bin`)
      await pullFile({ url: B, token: BTOK, id: ab.id, dest: back })
      const backHash = await fileSha256(back)
      if (ab.dest_sha256 !== ab.source_sha256 || backHash !== ab.source_sha256) throw new Error('hash mismatch')
      return { a_to_b: { id: ab.id, bytes: ab.size, source_sha256: ab.source_sha256, dest_sha256_node: ab.dest_sha256, path_on_peer: ab.final_path, state: ab.state },
        b_to_a: { pulled_from: PB, id: ab.id, dest: back, dest_sha256_recomputed: backHash } }
    }
    const ab = await pushFile({ url: B, file: src, fromMachine: 'vmixlaptop2x6' })
    const destHash = await fileSha256(ab.final_path)
    const realFile = join(HERE, 'protocol.mjs') // an actual project file for B -> A
    const ba = await pushFile({ url: A, file: realFile, path: `from-node-b/protocol-${stamp}.mjs`, fromMachine: 'node-b' })
    const baHash = await fileSha256(ba.final_path)
    if (destHash !== ab.source_sha256 || baHash !== ba.source_sha256) throw new Error('hash mismatch')
    return { a_to_b: { id: ab.id, bytes: ab.size, source_sha256: ab.source_sha256, dest_sha256_node: ab.dest_sha256, dest_sha256_recomputed: destHash, path: ab.final_path, state: ab.state },
      b_to_a: { id: ba.id, bytes: ba.size, source_sha256: ba.source_sha256, dest_sha256_recomputed: baHash, path: ba.final_path, state: ba.state } }
  })

  await run(5, 'headless job: progress, logs, result, cancellation, failure', async () => {
    const long = await post(A, { type: 'submit', to: { agent: 'claude-code' }, from: { agent: 'it' },
      body: { prompt: 'Count slowly from 1 to 200, one number per line, explaining each number in one sentence.', model: 'haiku', max_turns: 2 } })
    await until(async () => (await thread(A, long.id)).some((x) => x.type === 'progress'), 120_000, 'progress')
    await post(A, { type: 'cancel', to: { agent: 'claude-code' }, from: { agent: 'it' }, correlation_id: long.id })
    const c = await final(A, long.id, 60_000)
    const st = (await api(A, 'GET', `/api/bridge/messages/${long.id}`)).body.state
    if (!c.body.cancelled || st !== 'cancelled') throw new Error(`cancel not observed: ${JSON.stringify(c.body)} state=${st}`)
    const bad = await post(A, { type: 'submit', to: { agent: 'claude-code' }, from: { agent: 'it' }, body: { prompt: 'x', model: 'gpt-9' } })
    const e = await final(A, bad.id, 30_000)
    if (e.type !== 'error') throw new Error('failure not reported')
    const log = c.body.log
    return { cancelled_submit: long.id, cancel_reply: c.body, state: st, log, log_lines: existsSync(log) ? readFileSync(log, 'utf8').split('\n').length : 0,
      failure_submit: bad.id, failure_error: e.body.error }
  })

  await run(6, 'parallel tasks within slots (BRIDGE_EXEC_SLOTS default 2)', async () => {
    const ids = []
    for (let i = 0; i < 3; i++) ids.push((await post(A, { type: 'submit', to: { agent: 'claude-code' }, from: { agent: 'it' }, body: { prompt: PROMPT(`P${i}`), model: 'haiku', max_turns: 2 } })).id)
    let maxRunning = 0
    const done = new Set()
    const end = Date.now() + 300_000
    while (done.size < ids.length && Date.now() < end) {
      const h = (await api(A, 'GET', '/api/bridge/health')).body
      maxRunning = Math.max(maxRunning, h.running.length)
      for (const id of ids) if ((await thread(A, id)).some((m) => m.correlation_id === id && m.id !== id && ['result', 'error'].includes(m.type))) done.add(id)
      await sleep(300)
    }
    const finals = await Promise.all(ids.map((id) => final(A, id, 1000)))
    if (maxRunning < 2) throw new Error(`never ran in parallel (max ${maxRunning})`)
    if (maxRunning > 2) throw new Error(`slot limit violated (max ${maxRunning})`)
    return { submits: ids, max_concurrent_observed: maxRunning, slots: 2, results: finals.map((f) => ({ type: f.type, text: f.body.text, model: f.body.model })) }
  })

  await run(7, 'node stop/restart during queued work: persistence, retry, dedupe, no double execution', async () => {
    if (PEER) return { blocked: true, reason: `peer mode: restarting ${PB}'s pm needs the agent on that machine; run test 7 locally or coordinate a restart` }
    killB()
    const key = `restart-${stamp}`
    const m1 = await post(A, { type: 'ping', to: { machine: PB, agent: 'node' }, from: { agent: 'it' }, dedupe_key: key, body: {} })
    const m2 = await post(A, { type: 'ping', to: { machine: PB, agent: 'node' }, from: { agent: 'it' }, dedupe_key: key, body: {} })
    if (!m2.duplicate || m2.id !== m1.id) throw new Error('dedupe failed')
    await sleep(4000)
    const during = (await api(A, 'GET', `/api/bridge/messages/${m1.id}`)).body
    await startB()
    const pong = await until(async () => (await thread(A, m1.id)).find((x) => x.reply_to === m1.id), 90_000, 'pong after restart')
    // execution lease lost mid-run on node-b must become uncertain, not re-run
    const sub = await post(B, { type: 'submit', to: { agent: 'claude-code' }, from: { agent: 'it' }, body: { prompt: 'Write a 300-word story about a lighthouse.', model: 'haiku', max_turns: 2 } })
    await until(async () => (await thread(B, sub.id)).some((x) => x.type === 'accept'), 60_000, 'node-b accept')
    killB()
    await startB()
    const after = await until(async () => { const s = (await api(B, 'GET', `/api/bridge/messages/${sub.id}`)).body; return s.state !== 'leased' && s }, 30_000, 'reconcile')
    await sleep(3000)
    const accepts = (await thread(B, sub.id)).filter((x) => x.type === 'accept').length
    if (after.state !== 'uncertain' || accepts !== 1) throw new Error(`expected uncertain + 1 accept, got ${after.state} + ${accepts}`)
    return { dedupe: { first: m1.id, second_duplicate: m2.duplicate }, while_down: { state: during.state, attempts: during.attempts, last_error: during.last_error },
      after_restart_reply: pong.id, lost_execution: { submit: sub.id, state: after.state, last_error: after.last_error, accepts } }
  })

  await run(8, 'origin-machine default + policy-controlled failover', async () => {
    const m = await post(A, { type: 'submit', to: { agent: 'claude-code' }, from: { agent: 'it' }, body: { prompt: PROMPT('ORIGIN'), model: 'haiku', max_turns: 2 } })
    const f = await final(A, m.id)
    if (f.body.machine !== 'vmixlaptop2x6') throw new Error(`ran on ${f.body.machine}`)
    // node-a has BRIDGE_ALLOW_FAILOVER=1; node-c does not exist, so delivery fails and the submit moves to node-b
    const fo = await post(A, { type: 'submit', to: { machine: 'node-c', agent: 'claude-code' }, from: { agent: 'it' },
      body: { prompt: PROMPT('FAILOVER'), model: 'haiku', max_turns: 2, failover_to: [PB], failover_after: 2 } })
    const ff = await final(A, fo.id, 180_000)
    const orig = (await api(A, 'GET', `/api/bridge/messages/${fo.id}`)).body
    // node-b has no failover policy: its submit to node-c must stay undelivered, not move
    const nf = await post(B, { type: 'submit', to: { machine: 'node-c', agent: 'claude-code' }, from: { agent: 'it' }, body: { prompt: 'x', model: 'haiku', failover_to: ['vmixlaptop2x6'], failover_after: 1 } })
    await sleep(8000)
    const nfState = (await api(B, 'GET', `/api/bridge/messages/${nf.id}`)).body
    const moved = (await api(B, 'GET', `/api/bridge/messages?correlation=${nf.id}`)).body.filter((x) => x.id !== nf.id)
    if (ff.body.machine !== PB || orig.state !== 'dead' || moved.length) throw new Error(`failover wrong: ran ${ff.body.machine}, orig ${orig.state}, moved ${moved.length}`)
    await api(B, 'POST', '/api/bridge/messages', { type: 'cancel', to: { agent: 'claude-code' }, correlation_id: nf.id }) // tidy
    return { origin_default: { submit: m.id, ran_on: f.body.machine }, failover: { submit: fo.id, original_state: orig.state, original_error: orig.last_error, ran_on: ff.body.machine, text: ff.body.text },
      no_policy: { submit: nf.id, state: nfState.state, attempts: nfState.attempts, moved: moved.length } }
  })

  await run(9, 'reject unauthorized actions, bad credentials, traversal, disallowed roots', async () => {
    // node-b is reached on loopback; credential checks are proven over the LAN interface with a forced token header
    const bad = await api(A, 'GET', '/api/bridge/health', null, 'not-a-token')
    const trav = await api(A, 'POST', '/api/bridge/files', { name: 'x', path: '../../shared-brain/MEMORY.md', size: 1, sha256: 'a'.repeat(64) })
    const root = await api(A, 'POST', '/api/bridge/files', { name: 'x', root: 'C:', size: 1, sha256: 'a'.repeat(64) })
    const cwd = await post(A, { type: 'submit', to: { agent: 'claude-code' }, from: { agent: 'it' }, body: { prompt: 'x', model: 'haiku', cwd: 'C:/Windows' } })
    const cwdErr = await final(A, cwd.id, 30_000)
    if (bad.status !== 401 || trav.status !== 400 || root.status !== 400 || !/outside BRIDGE_EXEC_ROOTS/.test(cwdErr.body.error)) throw new Error('a rejection did not happen')
    return { invalid_token: bad, traversal: trav, unknown_root: root, cwd_outside_roots: cwdErr.body.error,
      scope_and_project_checks: 'covered by unit test "auth: no token, bad token, missing scope, project limit" (bridge/test.mjs) against a real HTTP server with trustLoopback=false' }
  })

  await run(10, 'limits and free-first escalation via the DSH weight router', async () => {
    const { chooseModel, loadRouter, quotaGate } = await import('./weight.mjs')
    const router = await loadRouter()
    if (!router) throw new Error('router not loadable')
    const low = await chooseModel({ capability: 'low' }, { router })
    const high = await chooseModel({ capability: 'high' }, { router })
    const free = await chooseModel({ capability: 'low' }, { router, candidates: [
      { id: 'local-llm', provider: 'llama', model: 'local', costClass: 'local', local: true, capabilities: { code: 'medium', reasoning: 'medium' }, contextTokens: 32000, throughputTokensPerSecond: 30, available: true, tools: ['code'] },
      { id: 'claude-haiku', provider: 'anthropic', model: 'haiku', costClass: 'included', capabilities: { code: 'medium', reasoning: 'medium' }, contextTokens: 200000, throughputTokensPerSecond: 150, available: true, tools: ['code'] }] })
    let exhausted
    try { await chooseModel({ capability: 'low', quotaHeadroom: 0.01 }, { router }) } catch (e) { exhausted = e.message }
    return { low: { model: low.model, reason: low.assignment.reason }, high: { model: high.model, reason: high.assignment.reason },
      free_first: { model: free.model, costClass: free.assignment.costClass, reason: free.assignment.reason }, quota_exhausted: exhausted, quota_now: quotaGate() }
  })

  await run(11, 'ChatGPT -> DSH -> Claude -> DSH -> ChatGPT round trip', async () => ({ blocked: true,
    reason: 'BLOCKED - connector unavailable: /mcp listens on loopback only; public HTTPS (Tailscale Funnel) deferred by user 2026-10-08.',
    next_prerequisite: 'Tailscale Funnel on ndi2 -> https://<host>.ts.net/mcp, a bridge token with send,read,execute (bridge/cli.mjs token-add chatgpt send,read,execute), then add it as a custom MCP connector in ChatGPT (developer mode) and call bridge_run_claude.' }))
} finally {
  killB()
  report.finished_at = new Date().toISOString()
  const file = join(evDir, `integration-${stamp}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`evidence: ${file}`)
}
