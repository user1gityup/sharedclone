#!/usr/bin/env node
// Agent Project Manager - HTTP server: REST API, web UI, lease reconciler.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openStore, PmError } from './store.mjs'
import { act, available, ACTIONS, THIS_MACHINE, machineNames } from './actions.mjs'
import { createBridge, loadPeers } from './bridge/index.mjs'
import { authorizePm } from './access.mjs'
import { blitzRoutes } from './blitz/routes.mjs' // BLITZ-03
import { orderRoutes } from './order-routes.mjs'
import { insightsRoutes } from './insights.mjs' // goals, usage ledger, budgets (T-805b65ed)
import { progressRoutes } from './progress-routes.mjs' // T-409c621d
import { discoveryRoutes } from './blitz/discovery-routes.mjs' // BLITZ-02
import { recordRoutes } from './record-routes.mjs' // L6a records (Opportunity + Contact Lead)
import { blitzAgentRoutes } from './blitz/agent-routes.mjs' // BLITZ-04
import { opportunityRoutes, resolveOpportunityProject, resolveOpportunityProjectBySource } from './opportunity-routes.mjs' // T-bf6f4f2c: DSH Integration
import { createEngine } from './blitz/engine.mjs' // BLITZ-05..08 composed engine
import { codexReviewEngineOptions } from './blitz/codex-review.mjs' // Codex independent review (BLITZ_CODEX_REVIEW=1)
import { loadRepoRules, DEFAULT_REPO_RULES_PATH, REPO_RULES_ENV } from './blitz/repo-rules.mjs' // integration rules
import { createGitRunner } from './blitz/integrate.mjs'
import { createAgentGate, AGENT_TOKEN_RE, PROOF_HEADER, makeProofVerifier } from './agent-gate.mjs' // T-4dfa4288
import { agentAccessRoutes, freeSwarmRoutes, notifyRoutes } from './wire-routes.mjs' // T-4dfa4288, T-0bf60afc, T-f06d8373
import { notifyTaskChange, notifyCapacity } from './change-notify.mjs' // T-f06d8373
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

export function createServer(store, { token = '', bridge = null, sync = null, blitz = null, insightsAuthDb = null, dshInvoke = null, dshProofSecret = process.env.PM_DSH_PROOF_SECRET || '', verifyDshProof = null, clock = null } = {}) {
  const order = orderRoutes(store)
  const routes = [
    ...order,
    ...insightsRoutes({ store, authDb: () => (insightsAuthDb === null ? bridge?.queue?.db ?? null : insightsAuthDb || null) }),
    ...progressRoutes(store), // T-409c621d
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
    // --- T-bf6f4f2c: DSH Integration - Opportunity records + qualification evidence / staged
    // package write-back for DSH council/swarm consumers (opportunity-routes.mjs). pm only stores
    // what those stages publish; the scraper/qualification/management/application logic itself
    // stays out of this repo. Gated by the same authorizePm + roles check as every other route.
    ...opportunityRoutes({ store }),
    // --- end T-bf6f4f2c ---
  ]
  // --- BLITZ-03: rating + per-task approval routes, and the approval gate (blitz/gate.mjs) ---
  const gate03 = blitzRoutes(store, () => bridge?.queue?.db ?? null)
  routes.push(...gate03.routes)
  // --- end BLITZ-03 ---
  // --- BLITZ-02: top-N ranking, discovery, project-by-project Q&A (blitz/discovery-routes.mjs) ---
  routes.push(...discoveryRoutes({ store, bridge }))
  // --- end BLITZ-02 ---
  // --- BLITZ-05..08: one engine (blitz/engine.mjs); campaign, recovery, verify and status routes share it.
  // Without `blitz` an engine is built here with no runner (tests); main() passes the running one.
  const engine = blitz ?? createEngine({ store, ledgerDb: () => bridge?.queue?.db ?? null, bridge })
  routes.push(...engine.routes())
  // --- end BLITZ-05..08 ---
  // --- PM-SYNC: peer replication of projects/tasks (sync.mjs); auth in access.mjs authorizePm ---
  routes.push(...syncRoutes(store.db, sync))
  // --- end PM-SYNC ---
  // --- L6a: record types (Lead Management + Contact Lead), their ACLs, audit logs and gates.
  // Records live in the pm db; approvals and roles in the bridge ledger (record-routes.mjs).
  routes.push(...recordRoutes(store, () => bridge?.queue?.db ?? null))
  // --- end L6a ---
  // --- T-4dfa4288: scoped DSH agent access. One gate for REST (below), MCP and bridge (bridge/index.mjs).
  // State lives beside role_assignments (the bridge db when the bridge is on). ---
  const accessDb = bridge?.queue?.db ?? store.db
  routes.push(...agentAccessRoutes(accessDb))
  const gate = createAgentGate({ db: accessDb, store, verifyDshProof: verifyDshProof ?? makeProofVerifier(dshProofSecret), ...(clock ? { clock } : {}) })
  bridge?.setAgentGate?.(gate)
  // --- T-0bf60afc: free-agents-only PM swarm (config + seats + runs); default mode untouched ---
  const free = freeSwarmRoutes({ db: store.db, roleDb: accessDb, store, gate, invoke: dshInvoke ?? undefined })
  routes.push(...free.routes)
  // --- T-f06d8373: notify on meaningful task change; capacity + usage views ---
  const notif = notifyRoutes({ db: store.db, ledgerDb: () => bridge?.queue?.db ?? null, seats: free.seats })
  routes.push(...notif.routes)
  const projectName = (id) => { try { return store.listProjects().find((p) => p.id === id)?.name ?? id } catch { return id } }
  store.setChangeHook((prev, next) => notifyTaskChange(store.db, prev, next, { project: projectName(next.project_id) }))
  // --- end T-4dfa4288 / T-0bf60afc / T-f06d8373 ---

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://pm')
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(readFileSync(join(HERE, 'public', 'index.html')))
      }
      // L6a: the records admin page (record types, per-type ACLs, permission gates, approval queue)
      if (req.method === 'GET' && (url.pathname === '/records' || url.pathname === '/records.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(readFileSync(join(HERE, 'public', 'records.html')))
      }
      if (bridge && (await bridge.handle(req, res, url))) return
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' })
      // T-4dfa4288: an agent credential (pmat_) never takes the trusted loopback/peer path. It is mapped to a
      // governed action and project and authorized on every request; anything unmapped is refused.
      if (req.headers.authorization?.match(AGENT_TOKEN_RE)) {
        const body = req.method === 'GET' ? {} : await readJson(req)
        const runId = url.pathname.match(/^\/api\/free-swarm\/runs\/([\w-]+)\//)?.[1]
        if (runId) body.project = free.runProject(runId) ?? undefined // the run's own project, never the caller's claim
        const verdict = gate.rest(req, url, body)
        if (!verdict.allow) return send(res, 403, { error: verdict.reason })
        const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname))
        if (!route) return send(res, 404, { error: `no route ${req.method} ${url.pathname}` })
        gate03.guard(req.method, url.pathname)
        const w = { actor: verdict.actor, model: null }
        const principal = { agent: true, name: `agent:${verdict.actor}`, token: req.headers.authorization.match(AGENT_TOKEN_RE)[1], proof: req.headers[PROOF_HEADER] }
        const result = await route[2](url.pathname.match(route[1]), body, w, Object.fromEntries(url.searchParams), principal)
        store.drainChanges()
        return send(res, 200, result)
      }
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
        try {
          forcedActor = authorizePm(bridge.queue.db, principal, req.method, {
            body, query, pathname: url.pathname, resolveOrder: order.resolveOrder,
            resolveOpportunityProject: (id) => resolveOpportunityProject(store.db, id),
            resolveOpportunityProjectBySource: (ref) => resolveOpportunityProjectBySource(store.db, ref),
          })
        } catch (err) { return send(res, err.status ?? 403, { error: err.message }) }
      }
      const w = {
        actor: forcedActor ?? body.actor ?? req.headers['x-pm-actor'],
        model: body.model ?? req.headers['x-pm-model'],
      }
      gate03.guard(req.method, url.pathname) // BLITZ-03: governed tasks need an approved task_scope
      const result = await route[2](url.pathname.match(route[1]), body, w, query, principal)
      store.drainChanges() // T-f06d8373: changes written outside store.tx (sync, blitz) still notify
      send(res, 200, result)
    } catch (err) {
      if (err instanceof PmError) return send(res, err.status, { error: err.message, ...err.extra })
      console.error(err)
      send(res, 500, { error: String(err?.message ?? err) })
    }
  })
  /** Notify for seats at the warn/critical quota line (once per threshold and reset window). */
  server.capacityTick = () => notifyCapacity(store.db, notif.sources())
  return server
}

/** Engine options main() adds: Codex review (env-gated) and repo integration rules (file-gated). */
export function blitzMainOptions(env = process.env, store = null, { fs, log = console } = {}) {
  const review = codexReviewEngineOptions(env, { db: store?.db ?? null })
  if (review.review) log?.log?.('blitz: Codex independent review ON (BLITZ_CODEX_REVIEW=1)')
  const loaded = loadRepoRules(env[REPO_RULES_ENV] || DEFAULT_REPO_RULES_PATH, { ...(fs ? { fs } : {}), log })
  const integration = loaded.loaded ? { rules: loaded.rules, integrationGit: createGitRunner({ checkedOut: 'merge-if-clean' }) } : {}
  // BLITZ_GLOBAL_CEILING: integer 1-16 -> guard ceilings.global; unset or invalid keeps the guard default (4)
  const raw = env.BLITZ_GLOBAL_CEILING
  const n = raw !== undefined && /^\d+$/.test(String(raw).trim()) ? Number(raw) : NaN
  if (raw !== undefined && !(n >= 1 && n <= 16)) log?.warn?.(`blitz: BLITZ_GLOBAL_CEILING=${raw} is not an integer 1-16; using the default`)
  const ceiling = n >= 1 && n <= 16 ? { ceilings: { global: n } } : {}
  return { ...review, ...integration, ...ceiling }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Operator switches for blitz and the bridge (BLITZ_*, BRIDGE_EXEC_*), one KEY=VALUE per line.
  // Loaded before the bridge and engine read them; a variable already set in the environment wins.
  const blitzEnv = process.env.PM_BLITZ_ENV || join(homedir(), '.claude', 'pm-data', 'blitz.env')
  try {
    process.loadEnvFile(blitzEnv)
    console.log(`blitz: loaded ${blitzEnv}`)
  } catch (err) {
    if (err?.code !== 'ENOENT') console.warn(`blitz: could not load ${blitzEnv}: ${err.message}`)
  }
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
    store.drainChanges()
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
  // --- BLITZ-05..08: the run engine. Dispatch stays refused unless BLITZ_DISPATCH_ENABLED=1; nothing
  // runs unless a campaign is launched with authorizedBy. Verification fails closed unless
  // BLITZ_CODEX_REVIEW=1, which wires the Codex independent review + default verification policy.
  // Integration merges nothing unless blitz-repo-rules.json (BLITZ_REPO_RULES) loads valid rules; then
  // verified, conflict-free tasks are merged LOCALLY under those rules. Nothing ever pushes. ---
  const blitz = createEngine({ store, ledgerDb: () => bridge?.queue?.db ?? null, bridge, ...blitzMainOptions(process.env, store) })
  blitz.start()
  // --- end BLITZ-05..08 ---
  const server = createServer(store, { token, bridge, sync, blitz })
  const capTimer = setInterval(() => { try { server.capacityTick() } catch (err) { console.error('capacity notify', err?.message ?? err) } }, 60_000)
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `port ${port} is already in use` : err)
    process.exit(1)
  })
  server.listen(port, host, () => console.log(`pm listening on http://${host}:${port}  db ${store.path}`))
  const stop = async () => {
    clearInterval(timer); clearInterval(capTimer)
    await blitz.stop().catch((err) => console.error('blitz runner stop', err))
    sync?.stop(); bridge?.stop(); server.close(); store.close(); process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
