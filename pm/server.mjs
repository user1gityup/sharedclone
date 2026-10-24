#!/usr/bin/env node
// Agent Project Manager - HTTP server: REST API, web UI, lease reconciler.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openStore, PmError } from './store.mjs'
import { act, available, ACTIONS, THIS_MACHINE, machineNames } from './actions.mjs'
import { createBridge, loadPeers } from './bridge/index.mjs'
import { authorizePm } from './access.mjs'
import { blitzRoutes } from './blitz/routes.mjs' // BLITZ-03
import { orderRoutes } from './order-routes.mjs'
import { discoveryRoutes } from './blitz/discovery-routes.mjs' // BLITZ-02
import { blitzAgentRoutes } from './blitz/agent-routes.mjs' // BLITZ-04
import { createPmSync, routes as syncRoutes } from './sync.mjs' // PM-SYNC
import { migrateSync } from './sync-schema.mjs' // PM-SYNC
import { migrateChildren } from './sync-children.mjs' // PM-SYNC

const HERE = dirname(fileURLToPath(import.meta.url))
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 5_000_000) throw new PmError(413, 'body too large')
  }
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new PmError(400, 'body is not valid JSON')
  }
}

export function createServer(store, { token = '', bridge = null, sync = null } = {}) {
  const order = orderRoutes(store)
  const routes = [
    ...order,
    ['GET', /^\/api\/health$/, () => ({ ok: true, db: store.path })],
    ['GET', /^\/api\/projects$/, (m, b, w, q) => store.listProjects(q)],
    ['POST', /^\/api\/projects$/, (m, b, w) => store.createProject(w, b)],
    ['POST', /^\/api\/projects\/([\w-]+)\/archive$/, (m, b, w) => store.archiveProject(w, m[1], b)],
    ['PATCH', /^\/api\/projects\/([\w-]+)$/, (m, b, w) => store.updateProject(w, m[1], b)],
    ['GET', /^\/api\/tasks$/, (m, b, w, q) => store.listTasks(q)],
    ['POST', /^\/api\/tasks$/, (m, b, w) => store.createTask(w, b)],
    ['POST', /^\/api\/tasks\/upsert$/, (m, b, w) => store.upsertBySource(w, b)],
    ['GET', /^\/api\/runs$/, (m, b, w, q) => store.listRuns(q)],
    ['POST', /^\/api\/tasks\/([\w-]+)\/runs$/, (m, b, w) => store.startRun(w, m[1], b)],
    ['PATCH', /^\/api\/runs\/([\w-]+)$/, (m, b, w) => store.updateRun(w, m[1], b)],
    ['GET', /^\/api\/runs\/([\w-]+)$/, (m) => store.getRun(m[1])],
    ['POST', /^\/api\/runs\/([\w-]+)\/heartbeat$/, (m, b, w) => store.runnerHeartbeat(w, m[1], b)],
    ['POST', /^\/api\/runs\/([\w-]+)\/runner-update$/, (m, b, w) => store.runnerUpdate(w, m[1], b)],
    ['POST', /^\/api\/runs\/([\w-]+)\/reattach$/, (m, b, w) => store.reattachRun(w, m[1], b)],
    ['POST', /^\/api\/runs\/([\w-]+)\/cancel$/, (m, b, w) => store.requestCancel(w, m[1], b)],
    ['POST', /^\/api\/runs\/([\w-]+)\/cancel-ack$/, (m, b, w) => store.cancelAck(w, m[1], b)],
    ['POST', /^\/api\/runs\/([\w-]+)\/finish$/, (m, b, w) => store.finishRun(w, m[1], b)],
    ['GET', /^\/api\/runners$/, () => store.listRunners()],
    ['POST', /^\/api\/runners\/register$/, (m, b, w) => store.registerRunner(w, b)],
    ['POST', /^\/api\/runners\/claim$/, (m, b, w) => store.claimForRunner(w, b)],
    ['GET', /^\/api\/tasks\/([\w-]+)\/actions$/, (m) => available(store.getTask(m[1]))],
    ['POST', /^\/api\/tasks\/([\w-]+)\/(prepare|start|resume|continue|amend|stop|archive)$/, (m, b, w) => act(store, w, m[1], m[2], b)],
    ['POST', /^\/api\/next$/, (m, b, w) => store.claimNext(w, b)],
    ['GET', /^\/api\/tasks\/([\w-]+)$/, (m) => store.getTask(m[1])],
    ['PATCH', /^\/api\/tasks\/([\w-]+)$/, (m, b, w) => store.updateTask(w, m[1], b)],
    ['POST', /^\/api\/tasks\/([\w-]+)\/claim$/, (m, b, w) => store.claimTask(w, m[1], b)],
    ['POST', /^\/api\/tasks\/([\w-]+)\/heartbeat$/, (m, b, w) => store.heartbeat(w, m[1], b)],
    ['POST', /^\/api\/tasks\/([\w-]+)\/release$/, (m, b, w) => store.releaseTask(w, m[1], b)],
    ['POST', /^\/api\/tasks\/([\w-]+)\/comments$/, (m, b, w) => store.addComment(w, m[1], b)],
    ['POST', /^\/api\/tasks\/([\w-]+)\/artifacts$/, (m, b, w) => store.addArtifact(w, m[1], b)],
    ['POST', /^\/api\/comments\/(\d+)\/ack$/, (m, b, w) => store.ackInstruction(w, Number(m[1]))],
    ['GET', /^\/api\/events$/, (m, b, w, q) => store.events(q)],
    ['POST', /^\/api\/backup$/, (m, b) => store.backup(b.dest)],
    ...blitzAgentRoutes({ store, db: store.db }),
  ]
  // --- BLITZ-03: rating + per-task approval routes, and the approval gate (blitz/gate.mjs) ---
  const blitz = blitzRoutes(store, () => bridge?.queue?.db ?? null)
  routes.push(...blitz.routes)
  // --- end BLITZ-03 ---
  // --- BLITZ-02: top-N ranking, discovery, project-by-project Q&A (blitz/discovery-routes.mjs) ---
  routes.push(...discoveryRoutes({ store, bridge }))
  // --- end BLITZ-02 ---
  // --- PM-SYNC: peer replication of projects/tasks (sync.mjs); auth in access.mjs authorizePm ---
  routes.push(...syncRoutes(store.db, sync))
  // --- end PM-SYNC ---

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://pm')
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(readFileSync(join(HERE, 'public', 'index.html')))
      }
      if (bridge && (await bridge.handle(req, res, url))) return
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' })
      // a local reverse proxy (tailscale serve/funnel) arrives from loopback with forwarding headers
      const proxied = Boolean(req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['tailscale-funnel-request'])
      const remote = proxied || !LOOPBACK.has(req.socket.remoteAddress)
      // With the bridge on, identity is the bridge principal: loopback and the PM_TOKEN peer keep
      // full access; a bridge-tokens.json principal is role-checked (access.mjs authorizePm).
      let principal = null
      if (bridge?.auth && bridge.queue?.db) {
        try { principal = bridge.auth(req) } catch (err) { return send(res, err.status ?? 401, { error: err.message }) }
      } else if (remote && (!token || req.headers.authorization !== `Bearer ${token}`)) {
        return send(res, 401, { error: token ? 'bearer token required' : 'remote access needs PM_TOKEN set on the server' })
      }
      const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname))
      if (!route) return send(res, 404, { error: `no route ${req.method} ${url.pathname}` })
      const body = req.method === 'GET' ? {} : await readJson(req)
      const query = Object.fromEntries(url.searchParams)
      let forcedActor = null
      if (principal) {
        try { forcedActor = authorizePm(bridge.queue.db, principal, req.method, { body, query, pathname: url.pathname, resolveOrder: order.resolveOrder }) } catch (err) { return send(res, err.status ?? 403, { error: err.message }) }
      }
      const w = {
        actor: forcedActor ?? body.actor ?? req.headers['x-pm-actor'],
        model: body.model ?? req.headers['x-pm-model'],
      }
      blitz.guard(req.method, url.pathname) // BLITZ-03: governed tasks need an approved task_scope
      const result = await route[2](url.pathname.match(route[1]), body, w, query, principal)
      send(res, 200, result)
    } catch (err) {
      if (err instanceof PmError) return send(res, err.status, { error: err.message, ...err.extra })
      console.error(err)
      send(res, 500, { error: String(err?.message ?? err) })
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PM_PORT) || 4480
  const host = process.env.PM_HOST || '127.0.0.1'
  const token = process.env.PM_TOKEN || ''
  if (!LOOPBACK.has(host) && host !== 'localhost' && !token) {
    console.error(`refusing to listen on ${host} without PM_TOKEN`)
    process.exit(2)
  }
  const store = openStore()
  const timer = setInterval(() => {
    const expired = store.reconcile()
    if (expired.length) console.log(`lease expired -> uncertain: ${expired.join(', ')}`)
  }, 15_000)
  // The bridge is on unless PM_BRIDGE=0. See bridge/README.md.
  const bridge = process.env.PM_BRIDGE === '0' ? null : createBridge({ machine: THIS_MACHINE, aliases: [...machineNames(THIS_MACHINE)],
    notify: (action, d) => store.recordEvent({ actor: 'dsh-bridge' }, 'bridge', d.id, action, d) })
  bridge?.start()
  // --- PM-SYNC: pull peers' projects/tasks from bridge-peers.json unless PM_SYNC=0 ---
  migrateSync(store.db)
  migrateChildren(store.db)
  let sync = null
  if (process.env.PM_SYNC !== '0') {
    const names = machineNames(THIS_MACHINE)
    const all = loadPeers()
    const self = [...(process.env.PM_SELF_URLS || '').split(',').map((u) => u.trim()).filter(Boolean),
      ...Object.entries(all).filter(([name, p]) => names.has(name) && p?.url).map(([, p]) => p.url)]
    const peers = Object.fromEntries(Object.entries(all).filter(([name]) => !names.has(name)))
    sync = createPmSync(store.db, peers, { self }).start()
  }
  // --- end PM-SYNC ---
  const server = createServer(store, { token, bridge, sync })
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `port ${port} is already in use` : err)
    process.exit(1)
  })
  server.listen(port, host, () => console.log(`pm listening on http://${host}:${port}  db ${store.path}`))
  const stop = () => { clearInterval(timer); sync?.stop(); bridge?.stop(); server.close(); store.close(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
