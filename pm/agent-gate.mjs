// Entry-point wiring for agent-access.mjs (T-4dfa4288). One gate, three doors: REST, MCP, bridge.
// An agent token (pmat_...) never reaches the trusted loopback/peer path: every request carrying one
// is mapped to a governed PM action + exact project and passed through authorize(); unmapped routes,
// tools and missing projects are denied (deny by default). Revocation is immediate because
// authorize() re-reads state on every call. PM permissions only: DSH swarm commands are not touched.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { authorize, ACTIONS } from './agent-access.mjs'

export const AGENT_TOKEN_RE = /^Bearer\s+(pmat_[0-9a-f]+)$/
export const PROOF_HEADER = 'x-dsh-proof'
export const PROOF_MAX_AGE_MS = 5 * 60_000
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** DSH side: sign {agent_id, machine, ts} with the secret shared with pm (PM_DSH_PROOF_SECRET). */
export function signDshProof(secret, { agent_id, machine }, now = Date.now()) {
  const body = b64({ agent_id, machine, ts: now })
  return `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** pm side verifier. No secret configured = nothing verifies (fail closed). */
export function makeProofVerifier(secret, { clock = () => Date.now(), maxAgeMs = PROOF_MAX_AGE_MS } = {}) {
  return (proof) => {
    if (!secret || typeof proof !== 'string') return null
    const [body, sig] = proof.split('.')
    if (!body || !sig) return null
    const want = createHmac('sha256', secret).update(body).digest('hex')
    if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
      if (typeof p.ts !== 'number' || Math.abs(clock() - p.ts) > maxAgeMs) return null
      return { agent_id: p.agent_id, machine: p.machine }
    } catch { return null }
  }
}

/** REST route -> governed action. null = not reachable by an agent token. */
export function restAction(method, pathname) {
  const m = (re) => pathname.match(re)
  if (method === 'GET') {
    // reads are per project: /api/tasks needs ?project=, projects/events/health list across projects and stay closed
    if (m(/^\/api\/tasks$/) || m(/^\/api\/tasks\/[\w-]+(\/actions)?$/)) return { action: 'read' }
    return null
  }
  if (method === 'POST' && m(/^\/api\/tasks$/)) return { action: 'create' }
  if (method === 'PATCH' && m(/^\/api\/tasks\/[\w-]+$/)) return { action: 'update', patch: true }
  if (method === 'POST' && m(/^\/api\/tasks\/[\w-]+\/(comments|artifacts)$/)) return { action: 'update' }
  if (method === 'POST' && m(/^\/api\/tasks\/[\w-]+\/claim$/)) return { action: 'start' }
  if (method === 'POST' && m(/^\/api\/tasks\/[\w-]+\/heartbeat$/)) return { action: 'update' }
  if (method === 'POST' && m(/^\/api\/tasks\/[\w-]+\/release$/)) return { action: 'update', patch: true } // release sets the resulting status
  if (method === 'POST' && m(/^\/api\/tasks\/[\w-]+\/(prepare|start|resume|continue|amend|stop)$/)) return { action: 'start' }
  if (method === 'POST' && m(/^\/api\/free-swarm\/runs/)) return { action: 'swarm' }
  return null
}

/** MCP / bridge pm_* tool -> governed action (only these tools are exposed to agent tokens). */
export const TOOL_ACTIONS = {
  pm_list_projects: 'read', pm_list_tasks: 'read', pm_get_task: 'read', pm_events: 'read', pm_task_actions: 'read',
  pm_create_task: 'create', pm_update_task: 'update', pm_comment: 'update', pm_add_artifact: 'update',
  pm_claim_task: 'start', pm_heartbeat: 'update',
}
// a status the agent may not set through a plain `update` without the stronger action
const STATUS_ACTION = { review: 'review', done: 'complete' }
const LIFECYCLE_ACTION = { VERIFY: 'review', COMPLETE: 'complete', ARCHIVED: 'complete' }
const RANK = ['update', 'assign', 'review', 'complete']
/** A plain update that also sets status/lifecycle/assignee needs the stronger action for it. */
export function escalate(fields = {}) {
  const wanted = ['update']
  if (STATUS_ACTION[fields.status]) wanted.push(STATUS_ACTION[fields.status])
  if (LIFECYCLE_ACTION[fields.lifecycle]) wanted.push(LIFECYCLE_ACTION[fields.lifecycle])
  if ('assignee' in fields) wanted.push('assign')
  return wanted.sort((a, b) => RANK.indexOf(b) - RANK.indexOf(a))[0]
}

export function createAgentGate({ db, store, verifyDshProof, clock = () => new Date() }) {
  const ctx = () => ({ now: clock(), verifyDshProof })
  const projectOf = ({ taskId, project }) => {
    if (taskId) { try { return store.getTask(taskId)?.project?.name ?? null } catch { return null } }
    if (!project) return null
    try { return store.listProjects().find((p) => p.id === project || p.name === project)?.name ?? project } catch { return project }
  }
  function check({ entry, token, proof, action, taskId, project, target }) {
    const proj = projectOf({ taskId, project })
    if (!proj) return authorize(db, { entry, token, proof, action, project: '', target }, ctx())
    return authorize(db, { entry, token, proof, action, project: proj, target: target ?? taskId ?? proj }, ctx())
  }
  /** REST: returns { allow, actor, reason, status }. */
  function rest(req, url, body) {
    const token = req.headers.authorization?.match(AGENT_TOKEN_RE)?.[1]
    const proof = req.headers[PROOF_HEADER]
    const spec = restAction(req.method, url.pathname)
    if (!spec) return { ...authorize(db, { entry: 'rest', token, proof, action: '?', project: '' }, ctx()), allow: false, reason: 'route not available to agent credentials', status: 403 }
    const taskId = url.pathname.match(/^\/api\/tasks\/([\w-]+)/)?.[1]
    const project = body?.project ?? url.searchParams.get('project') ?? req.headers['x-pm-project']
    let action = spec.action
    if (spec.patch) action = escalate(body ?? {})
    const r = check({ entry: 'rest', token, proof, action, taskId, project })
    return { ...r, status: r.allow ? 200 : 403 }
  }
  /** MCP / bridge tool call: returns { allow, actor, reason }. */
  function tool(entry, token, proof, name, args = {}) {
    const base = TOOL_ACTIONS[name]
    if (!base) return authorize(db, { entry, token, proof, action: '?', project: '' }, ctx()) && { allow: false, reason: `tool ${name} is not available to agent credentials` }
    let action = base
    if (name === 'pm_update_task') action = escalate(args)
    return check({ entry, token, proof, action, taskId: args.id, project: args.project, target: args.id ?? args.project })
  }
  /** True when the token exists, is unrevoked and unexpired, and its agent is not revoked (no action is authorized). */
  function tokenLive(token) {
    if (!token) return false
    const tk = db.prepare('SELECT * FROM agent_tokens WHERE token_hash=?').get(createHash('sha256').update(String(token)).digest('hex'))
    if (!tk || tk.revoked_at || Date.parse(tk.expires_at) <= clock().getTime()) return false
    const ag = db.prepare('SELECT revoked_at FROM agent_identities WHERE agent_id=?').get(tk.agent_id)
    return Boolean(ag && !ag.revoked_at)
  }
  return { rest, tool, check, tokenLive, agentOf: (token) => db.prepare('SELECT agent_id FROM agent_tokens WHERE token_hash=?').get(createHash('sha256').update(String(token)).digest('hex'))?.agent_id ?? null }
}

export { ACTIONS }
