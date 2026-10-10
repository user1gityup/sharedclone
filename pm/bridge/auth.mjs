// Bridge auth: who is calling and what they may do. Checked at every ingress,
// including node-to-node calls. Tokens are stored as SHA-256 hashes only.
//
// ~/.claude/pm-data/bridge-tokens.json (outside git):
//   { "tokens": [ { "name": "chatgpt", "sha256": "<hex>", "scopes": ["send","read"], "projects": ["*"] } ] }
// Create one with: node bridge/cli.mjs token-add <name> <scope,scope>
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { BridgeError } from './protocol.mjs'

// `auto`: may start Claude Code runs in permission mode auto (user approved for the
// chatgpt token 2026-10-08). Without it a run is limited to default/acceptEdits.
export const SCOPES = ['send', 'read', 'execute', 'file', 'admin', 'auto']
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

export function defaultTokenFile() {
  return process.env.BRIDGE_TOKENS || join(homedir(), '.claude', 'pm-data', 'bridge-tokens.json')
}

export function loadTokens(file = defaultTokenFile()) {
  if (!existsSync(file)) return []
  const data = JSON.parse(readFileSync(file, 'utf8'))
  return (data.tokens ?? []).map((t) => ({ ...t, scopes: t.scopes ?? [], projects: t.projects ?? ['*'] }))
}

/**
 * Build an authenticator.
 *  - tokens: entries from bridge-tokens.json
 *  - peerToken: the pm PM_TOKEN shared between machines (scopes: peerScopes)
 *  - trustLoopback: loopback callers without a token get every scope (the pm convention)
 */
export function createAuth({ tokens = loadTokens(), peerToken = process.env.PM_TOKEN || '', peerScopes, trustLoopback = true } = {}) {
  const peer = peerToken ? sha256(peerToken) : null
  const pScopes = peerScopes ?? (process.env.BRIDGE_PEER_SCOPES || 'send,read,file,execute,auto').split(',').map((s) => s.trim())
  return function authenticate(req) {
    const header = req.headers.authorization || ''
    const m = header.match(/^Bearer\s+(\S+)$/)
    // A local reverse proxy (tailscale serve/funnel) connects from loopback but carries
    // forwarding headers: treat it as remote so public callers never get loopback trust.
    const proxied = Boolean(req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['tailscale-funnel-request'])
    const remote = proxied || !LOOPBACK.has(req.socket.remoteAddress)
    if (!m) {
      if (!remote && trustLoopback) return { name: 'loopback', scopes: [...SCOPES], projects: ['*'], agents: ['*'] }
      throw new BridgeError(401, 'bearer token required')
    }
    const h = sha256(m[1])
    const eq = (a) => a.length === h.length && timingSafeEqual(Buffer.from(a), Buffer.from(h))
    // agents: the mailboxes this caller may acknowledge for (a token speaks for its own name
    // unless bridge-tokens.json lists "agents"); the machine-to-machine peer token speaks for all.
    if (peer && eq(peer)) return { name: 'peer', scopes: pScopes, projects: ['*'], agents: ['*'] }
    const t = tokens.find((x) => typeof x.sha256 === 'string' && eq(x.sha256))
    if (!t) throw new BridgeError(401, 'invalid token')
    return { name: t.name, scopes: t.scopes, projects: t.projects, agents: t.agents ?? [t.name] }
  }
}

export function requireScope(principal, scope, project = null) {
  if (!principal.scopes.includes(scope)) throw new BridgeError(403, `token "${principal.name}" lacks scope ${scope}`)
  if (project && !principal.projects.includes('*') && !principal.projects.includes(project)) {
    throw new BridgeError(403, `token "${principal.name}" may not act on project ${project}`)
  }
}
