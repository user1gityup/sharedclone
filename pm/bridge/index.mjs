// Bridge HTTP surface, mounted inside the pm server:
//   /api/bridge/*   REST (messages, inbox, threads, files, status, audit)
//   /mcp            MCP Streamable HTTP (JSON responses) for MCP clients
// Every request is authenticated and scope-checked here, loopback included
// (loopback gets every scope only while trustLoopback is on, the pm default).
import { existsSync, readFileSync, createReadStream } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { BridgeError, PROTOCOL_VERSION } from './protocol.mjs'
import { openQueue } from './queue.mjs'
import { createAuth, requireScope } from './auth.mjs'
import { createFiles } from './files.mjs'
import { createWorkers, httpForwarder, PERMISSION_MODES } from './workers.mjs'
import { canActFor, requireActFor, savePolicy, loadPolicy, policyFile } from './delivery.mjs'

export const MCP_PROTOCOL = '2025-06-18'

/** Peers: ~/.claude/pm-data/bridge-peers.json { "vmixer2o2": { "url": "http://10.0.0.241:4480", "token": "<PM_TOKEN>" } } */
export function loadPeers(file = process.env.BRIDGE_PEERS || join(homedir(), '.claude', 'pm-data', 'bridge-peers.json')) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req, limit) {
  const chunks = []
  let n = 0
  for await (const c of req) {
    n += c.length
    if (n > limit) throw new BridgeError(413, 'body too large')
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}
const parse = (buf) => {
  if (!buf.length) return {}
  try { return JSON.parse(buf.toString('utf8')) } catch { throw new BridgeError(400, 'body is not valid JSON') }
}

export function createBridge({ machine, aliases, dbPath, auth = createAuth(), peers = loadPeers(), workers: workerOpts = {}, roots, notify = null, policyPath = policyFile() } = {}) {
  const queue = openQueue(dbPath, { machine, aliases, policy: () => loadPolicy(policyPath) })
  const files = createFiles(queue, roots ? { roots } : {})
  const workers = createWorkers(queue, { forwardTo: Object.keys(peers).length ? httpForwarder(peers) : null, notify, ...workerOpts })

  /** A token limited to some projects never sees messages from other projects. */
  const visible = (p, rows) => (p.projects.includes('*') ? rows : rows.filter((r) => r.project && p.projects.includes(r.project)))
  const visibleOne = (p, row) => {
    if (!visible(p, [row]).length) throw new BridgeError(404, `no message ${row.id}`)
    return row
  }

  /** Unacknowledged mail for `agent`; only the recipient's own read counts as delivery. */
  function readInbox(p, agent, { after, limit } = {}) {
    requireScope(p, 'read')
    if (!agent) throw new BridgeError(400, 'agent is required')
    const mine = canActFor(p, agent)
    if (mine && p.name !== 'loopback') queue.touch(agent, p.name)
    const messages = visible(p, queue.inbox(agent, { after, limit, deliveredBy: mine ? p.name : null }))
    const pend = queue.pending(agent)
    return { agent, messages, next_after: messages.length ? messages[messages.length - 1].seq : Number(after) || 0,
      cursor: pend.cursor ?? 0, pending: pend.unacked ?? 0, delivered_marked: mine,
      note: mine ? 'Read is recorded as delivered. Call bridge_ack with the ids (or up_to) once handled; unacknowledged messages are returned again.'
        : `This token does not speak for ${agent}: messages are shown but not marked delivered.` }
  }

  function ackMessages(p, { agent, ids, up_to } = {}) {
    requireScope(p, 'read')
    if (!agent) throw new BridgeError(400, 'agent is required')
    requireActFor(p, agent)
    if (p.name !== 'loopback') queue.touch(agent, p.name)
    return queue.ackFor(agent, { ids: Array.isArray(ids) ? ids : ids ? [ids] : [], up_to }, p.name)
  }

  function deliveryStatus(p, { agent, id } = {}) {
    requireScope(p, 'read')
    if (id) {
      const m = visibleOne(p, queue.get(id))
      return { id: m.id, seq: m.seq, type: m.type, from: m.from, to: m.to, priority: m.priority, expects_response: m.expects_response,
        queue_state: m.state, last_error: m.last_error, created_at: m.created_at, ...m.delivery }
    }
    return { machine: queue.machine, policy: queue.policy(), pending: queue.pending(agent || null), presence: queue.presence() }
  }

  /** Shared by REST and MCP: store a message after policy checks. */
  function submit(principal, env) {
    requireScope(principal, 'send', env.project)
    if (env.to?.agent === 'claude-code' && ['submit', 'cancel', 'pause', 'resume'].includes(env.type)) requireScope(principal, 'execute', env.project)
    const mode = env.body?.permission_mode
    if (mode !== undefined && mode !== null && !PERMISSION_MODES.includes(mode)) throw new BridgeError(400, `permission_mode must be one of ${PERMISSION_MODES.join(', ')}`)
    if (mode === 'auto') requireScope(principal, 'auto', env.project)
    const out = queue.enqueue(env, { principal: principal.name })
    queue.audit(principal.name, `message.${env.type}`, out.id, out.duplicate ? 'duplicate' : 'stored', { to: out.to, project: out.project })
    return out
  }

  const routes = [
    ['GET', /^\/api\/bridge\/health$/, 'read', () => ({ ok: true, protocol: PROTOCOL_VERSION, machine: queue.machine, queue: queue.stats(), running: [...api.workers.running.keys()], peers: Object.keys(peers), pending: queue.pending() })],
    ['POST', /^\/api\/bridge\/messages$/, 'send', (m, b, p) => submit(p, b)],
    ['GET', /^\/api\/bridge\/messages$/, 'read', (m, b, p, q) => visible(p, queue.list(q))],
    ['GET', /^\/api\/bridge\/messages\/([\w.@:-]+)$/, 'read', (m, b, p) => visibleOne(p, queue.get(m[1]))],
    ['POST', /^\/api\/bridge\/messages\/([\w.@:-]+)\/ack$/, 'read', (m, b, p) => {
      requireActFor(p, visibleOne(p, queue.get(m[1])).to.agent)
      const r = queue.ack(m[1], p.name)
      queue.audit(p.name, 'message.ack', m[1], 'ok')
      return r
    }],
    ['POST', /^\/api\/bridge\/messages\/([\w.@:-]+)\/requeue$/, 'admin', (m, b, p) => { const r = queue.requeueDead(m[1]); queue.audit(p.name, 'message.requeue', m[1], 'ok'); return r }],
    ['GET', /^\/api\/bridge\/threads\/([\w.@:-]+)$/, 'read', (m, b, p) => visible(p, queue.list({ correlation: m[1], limit: 500 }))],
    ['GET', /^\/api\/bridge\/inbox\/([\w.@:-]+)$/, 'read', (m, b, p, q) => readInbox(p, m[1], q)],
    ['POST', /^\/api\/bridge\/ack$/, 'read', (m, b, p) => ackMessages(p, b)],
    ['GET', /^\/api\/bridge\/delivery$/, 'read', (m, b, p, q) => deliveryStatus(p, q)],
    ['GET', /^\/api\/bridge\/delivery\/([\w.@:-]+)$/, 'read', (m, b, p) => deliveryStatus(p, { id: m[1] })],
    ['GET', /^\/api\/bridge\/policy$/, 'read', () => queue.policy()],
    ['PUT', /^\/api\/bridge\/policy$/, 'admin', (m, b, p) => { const r = savePolicy(b, policyPath); queue.audit(p.name, 'policy.update', null, 'ok', b); return r }],
    ['GET', /^\/api\/bridge\/audit$/, 'admin', (m, b, p, q) => queue.db.prepare('SELECT * FROM bridge_audit WHERE id > ? ORDER BY id LIMIT 200').all(Number(q.after) || 0).map((r) => ({ ...r }))],
    ['POST', /^\/api\/bridge\/files$/, 'file', (m, b, p) => { const r = files.begin(p.name, b); queue.audit(p.name, 'file.begin', r.id, 'ok', { name: r.name, size: r.size, root: r.root }); return r }],
    ['GET', /^\/api\/bridge\/files$/, 'file', () => files.list()],
    ['POST', /^\/api\/bridge\/files\/([\w-]+)\/complete$/, 'file', async (m, b, p) => {
      try {
        const r = await files.complete(m[1])
        queue.audit(p.name, 'file.delivered', m[1], 'ok', { sha256: r.dest_sha256, path: r.final_path })
        return r
      } catch (err) {
        queue.audit(p.name, 'file.rejected', m[1], 'rejected', { error: err.message })
        throw err
      }
    }],
    ['GET', /^\/api\/bridge\/files\/([\w-]+)$/, 'file', (m) => files.get(m[1])],
  ]

  // ---- MCP ------------------------------------------------------------------
  const TOOLS = [
    { name: 'bridge_send', description: 'Send a directed message to an agent on a DSH machine. Returns the stored envelope (id, seq).',
      inputSchema: { type: 'object', required: ['to_agent', 'type'], properties: {
        to_machine: { type: 'string' }, to_agent: { type: 'string' }, type: { type: 'string' }, body: { type: 'object' },
        correlation_id: { type: 'string' }, dedupe_key: { type: 'string' }, project: { type: 'string' }, from_agent: { type: 'string' },
        reply_to: { type: 'string', description: 'id of the message this answers; marks it responded' },
        priority: { type: 'string', enum: ['normal', 'high'] }, expects_response: { type: 'boolean' },
        ttl_seconds: { type: 'number', description: 'expire unhandled after this many seconds' } } } },
    { name: 'bridge_run_claude', description: 'Run a Claude Code headless task on a DSH machine. Returns the submit id; follow it with bridge_thread.',
      inputSchema: { type: 'object', required: ['prompt'], properties: {
        prompt: { type: 'string' }, machine: { type: 'string' }, model: { type: 'string' }, capability: { type: 'string', enum: ['low', 'medium', 'high'] },
        dedupe_key: { type: 'string' }, project: { type: 'string' }, from_agent: { type: 'string' }, max_turns: { type: 'number' },
        permission_mode: { type: 'string', enum: PERMISSION_MODES, description: 'auto lets the run use tools (shared brain, pm MCP) without prompts; needs the auto scope' },
        cwd: { type: 'string', description: 'working directory; must be inside an exec root (bridge-work or the shared brain)' } } } },
    { name: 'bridge_thread', description: 'All messages in a conversation (by submit or correlation id), oldest first.',
      inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    { name: 'bridge_inbox', description: 'Messages addressed to an agent. unacked=true returns every unacknowledged message (read marks delivered; call bridge_ack after handling). Without it: the legacy seq-cursor list.',
      inputSchema: { type: 'object', required: ['agent'], properties: { agent: { type: 'string' }, after: { type: 'number' }, unacked: { type: 'boolean' }, limit: { type: 'number' } } } },
    { name: 'bridge_ack', description: 'Acknowledge messages for your agent once handled: ids and/or every message up to seq up_to. Only the recipient may ack.',
      inputSchema: { type: 'object', required: ['agent'], properties: { agent: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, up_to: { type: 'number' } } } },
    { name: 'bridge_delivery_status', description: 'Delivery state of one message (id), or pending counts/presence for an agent or all agents.',
      inputSchema: { type: 'object', properties: { agent: { type: 'string' }, id: { type: 'string' } } } },
    { name: 'bridge_cancel', description: 'Cancel a Claude Code submit by id.',
      inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, machine: { type: 'string' } } } },
    { name: 'bridge_status', description: 'Queue state of this DSH node.', inputSchema: { type: 'object', properties: {} } },
  ]

  function callTool(p, name, a = {}) {
    switch (name) {
      case 'bridge_send':
        return submit(p, { type: a.type, to: { machine: a.to_machine, agent: a.to_agent }, from: { agent: a.from_agent ?? 'mcp' }, body: a.body ?? {},
          correlation_id: a.correlation_id, dedupe_key: a.dedupe_key, project: a.project, reply_to: a.reply_to,
          priority: a.priority, expects_response: a.expects_response, ttl_seconds: a.ttl_seconds })
      case 'bridge_run_claude':
        return submit(p, { type: 'submit', to: { machine: a.machine, agent: 'claude-code' }, from: { agent: a.from_agent ?? 'mcp' }, dedupe_key: a.dedupe_key, project: a.project,
          body: { prompt: a.prompt, model: a.model, capability: a.capability, max_turns: a.max_turns, permission_mode: a.permission_mode, cwd: a.cwd } })
      case 'bridge_thread':
        requireScope(p, 'read')
        return visible(p, queue.list({ correlation: a.id, limit: 500 }))
      case 'bridge_inbox': {
        if (a.unacked) return readInbox(p, a.agent, { after: a.after, limit: a.limit })
        requireScope(p, 'read')
        const rows = visible(p, queue.list({ agent: a.agent, after: a.after, machine: queue.machine, limit: a.limit }))
        // Legacy reads still count as delivery when the caller is the recipient.
        if (a.agent && canActFor(p, a.agent)) {
          queue.markDelivered(rows.map((r) => r.id), p.name)
          if (p.name !== 'loopback') queue.touch(a.agent, p.name)
        }
        return rows
      }
      case 'bridge_ack':
        return ackMessages(p, a)
      case 'bridge_delivery_status':
        return deliveryStatus(p, a)
      case 'bridge_cancel':
        return submit(p, { type: 'cancel', to: { machine: a.machine, agent: 'claude-code' }, from: { agent: 'mcp' }, correlation_id: a.id, body: {} })
      case 'bridge_status':
        requireScope(p, 'read')
        return { machine: queue.machine, queue: queue.stats(), running: [...api.workers.running.keys()] }
      default:
        throw new BridgeError(404, `unknown tool ${name}`)
    }
  }

  async function mcp(req, res, principal) {
    if (req.method !== 'POST') return json(res, 405, { error: 'MCP endpoint accepts POST only' })
    const msg = parse(await readBody(req, 1_000_000))
    const one = async (m) => {
      if (m.id === undefined) return null // notification
      const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result })
      try {
        switch (m.method) {
          case 'initialize': {
            const mine = (principal.agents ?? []).filter((x) => x !== '*')
            for (const agent of mine) queue.touch(agent, principal.name, { connect: true })
            const counts = mine.map((agent) => `${agent}: ${queue.pending(agent).unacked ?? 0} unacknowledged`).join('; ')
            return ok({ protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'dsh-bridge', version: '1.1.0' },
              instructions: `DSH bridge. Read mail with bridge_inbox {agent, unacked:true}; acknowledge with bridge_ack once handled; reply with bridge_send reply_to=<id>.${counts ? ` Pending - ${counts}.` : ''}` })
          }
          case 'ping':
            return ok({})
          case 'tools/list':
            return ok({ tools: TOOLS })
          case 'tools/call': {
            const out = callTool(principal, m.params?.name, m.params?.arguments)
            return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: { result: out } })
          }
          default:
            return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } }
        }
      } catch (err) {
        if (err instanceof BridgeError && m.method === 'tools/call') {
          return ok({ isError: true, content: [{ type: 'text', text: `${err.status}: ${err.message}` }] })
        }
        return { jsonrpc: '2.0', id: m.id, error: { code: -32603, message: String(err.message ?? err) } }
      }
    }
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map(one))).filter(Boolean)
      return out.length ? json(res, 200, out) : (res.writeHead(202), res.end())
    }
    const out = await one(msg)
    if (!out) { res.writeHead(202); return res.end() }
    return json(res, 200, out)
  }

  /** Returns true when the request was a bridge request (handled), false otherwise. */
  async function handle(req, res, url) {
    // /mcp/<token>: secret-path form for MCP clients that cannot send a bearer header
    // (ChatGPT connectors behind Tailscale Funnel). Only bridge-tokens.json tokens, never PM_TOKEN.
    // tailscale serve (1.44) forwards a path mount as /mcp/<token>/, so allow one trailing slash
    const pathToken = url.pathname.match(/^\/mcp\/([A-Za-z0-9_-]{32,})\/?$/)?.[1]
    const isMcp = url.pathname === '/mcp' || Boolean(pathToken)
    if (!isMcp && !url.pathname.startsWith('/api/bridge/')) return false
    let principal = null
    try {
      if (pathToken) {
        if (req.headers.authorization) throw new BridgeError(400, 'send the token in the path or the header, not both')
        req.headers.authorization = `Bearer ${pathToken}`
      }
      principal = auth(req)
      if (pathToken && principal.name === 'peer') throw new BridgeError(403, 'the peer token is not accepted in a URL path')
      if (isMcp) { await mcp(req, res, principal); return true }
      const chunk = url.pathname.match(/^\/api\/bridge\/files\/([\w-]+)$/)
      if (req.method === 'PUT' && chunk) {
        requireScope(principal, 'file')
        const buf = await readBody(req, 4 * 1024 * 1024)
        json(res, 200, files.chunk(chunk[1], url.searchParams.get('offset') ?? 0, buf))
        return true
      }
      const content = url.pathname.match(/^\/api\/bridge\/files\/([\w-]+)\/content$/)
      if (req.method === 'GET' && content) {
        requireScope(principal, 'file')
        const r = files.contentPath(content[1])
        res.writeHead(200, { 'content-type': r.mime || 'application/octet-stream', 'content-length': r.size, 'x-sha256': r.dest_sha256, 'x-transfer-id': r.id })
        createReadStream(r.final_path).pipe(res)
        queue.audit(principal.name, 'file.read', r.id, 'ok')
        return true
      }
      const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname))
      if (!route) throw new BridgeError(404, `no route ${req.method} ${url.pathname}`)
      requireScope(principal, route[2])
      const body = req.method === 'GET' ? {} : parse(await readBody(req, 1_000_000))
      json(res, 200, await route[3](url.pathname.match(route[1]), body, principal, Object.fromEntries(url.searchParams)))
    } catch (err) {
      const status = err instanceof BridgeError ? err.status : 500
      if (status >= 400 && status < 500) {
        try { queue.audit(principal?.name ?? 'anonymous', `${req.method} ${url.pathname}`, null, `refused ${status}`, { error: err.message, from: req.socket.remoteAddress }) } catch {}
      }
      if (status === 500) console.error(err)
      json(res, status, { error: err.message, ...(err.extra ?? {}) })
    }
    return true
  }

  const api = { handle, queue, files, workers, start: () => api.workers.start(), stop: () => { api.workers.stop(); queue.close() } }
  return api
}
