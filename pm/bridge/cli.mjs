#!/usr/bin/env node
// Bridge CLI.
//   node bridge/cli.mjs send <to_agent> <type> [json-body] [--machine M] [--corr ID] [--dedupe K]
//   node bridge/cli.mjs run-claude "<prompt>" [--machine M] [--model haiku] [--dedupe K] [--wait]
//   node bridge/cli.mjs thread <id> | inbox <agent> [--after N] | status | cancel <id> [--machine M]
//   node bridge/cli.mjs push-file <path> [--root inbox] [--as rel/path]
//   node bridge/cli.mjs pull-file <transfer-id> <dest>
//   node bridge/cli.mjs token-add <name> <scope,scope> [--projects a,b]   (prints the token once)
//   node bridge/cli.mjs mcp-stdio            stdio MCP shim to the node's /mcp (for Claude Desktop)
// Env: BRIDGE_URL (default http://127.0.0.1:4480), BRIDGE_TOKEN.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { pushFile, pullFile } from './files.mjs'
import { defaultTokenFile, sha256, SCOPES } from './auth.mjs'

const BASE = (process.env.BRIDGE_URL || 'http://127.0.0.1:4480').replace(/\/$/, '')
const TOKEN = process.env.BRIDGE_TOKEN || ''
const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv.splice(i, 2)[1] : undefined }
const bool = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv.splice(i, 1), true) : false }

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) { console.error(JSON.stringify({ status: res.status, ...j })); process.exit(1) }
  return j
}
const out = (x) => console.log(JSON.stringify(x, null, 2))

export async function waitThread(id, { timeoutMs = 600_000, get = (p) => api('GET', p) } = {}) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const t = await get(`/api/bridge/threads/${id}`)
    if (t.some((m) => m.id !== id && m.correlation_id === id && ['result', 'error'].includes(m.type))) return t
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for ${id}`)
}

const cmd = argv.shift()
const machine = flag('machine')
switch (cmd) {
  case 'send': {
    const corr = flag('corr'); const dedupe = flag('dedupe')
    const [agent, type, body] = argv
    out(await api('POST', '/api/bridge/messages', { type, to: { machine, agent }, body: body ? JSON.parse(body) : {}, correlation_id: corr, dedupe_key: dedupe }))
    break
  }
  case 'run-claude': {
    const model = flag('model'); const dedupe = flag('dedupe'); const wait = bool('wait')
    const m = await api('POST', '/api/bridge/messages', { type: 'submit', to: { machine, agent: 'claude-code' }, dedupe_key: dedupe, body: { prompt: argv[0], model } })
    out(wait ? await waitThread(m.id) : m)
    break
  }
  case 'thread': out(await api('GET', `/api/bridge/threads/${argv[0]}`)); break
  case 'inbox': out(await api('GET', `/api/bridge/messages?agent=${encodeURIComponent(argv[0])}&after=${flag('after') ?? 0}`)); break
  case 'status': out(await api('GET', '/api/bridge/health')); break
  case 'cancel': out(await api('POST', '/api/bridge/messages', { type: 'cancel', to: { machine, agent: 'claude-code' }, correlation_id: argv[0], body: {} })); break
  case 'push-file': out(await pushFile({ url: BASE, token: TOKEN, file: argv[0], root: flag('root') ?? 'inbox', path: flag('as'), fromMachine: process.env.PM_MACHINE })); break
  case 'pull-file': out(await pullFile({ url: BASE, token: TOKEN, id: argv[0], dest: argv[1] })); break
  case 'token-add': {
    const projects = (flag('projects') ?? '*').split(',')
    const [name, scopes] = argv
    const list = (scopes ?? '').split(',').filter(Boolean)
    const bad = list.filter((s) => !SCOPES.includes(s))
    if (!name || !list.length || bad.length) { console.error(`usage: token-add <name> <${SCOPES.join(',')}>`); process.exit(2) }
    const file = defaultTokenFile()
    const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { tokens: [] }
    const token = randomBytes(32).toString('base64url')
    data.tokens = data.tokens.filter((t) => t.name !== name).concat({ name, sha256: sha256(token), scopes: list, projects, created_at: new Date().toISOString() })
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2))
    console.log(token)
    console.error(`stored hash for "${name}" in ${file}; the token is not stored anywhere else. Restart pm to load it.`)
    break
  }
  case 'token-scopes': {
    const [name, scopes] = argv
    const list = (scopes ?? '').split(',').filter(Boolean)
    const bad = list.filter((s) => !SCOPES.includes(s))
    if (!name || !list.length || bad.length) { console.error(`usage: token-scopes <name> <${SCOPES.join(',')}>`); process.exit(2) }
    const file = defaultTokenFile()
    const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { tokens: [] }
    const t = data.tokens.find((x) => x.name === name)
    if (!t) { console.error(`no token named "${name}" in ${file}`); process.exit(1) }
    t.scopes = list
    writeFileSync(file, JSON.stringify(data, null, 2))
    console.error(`"${name}" scopes now ${list.join(',')}. Restart pm to load it.`)
    break
  }
  case 'mcp-stdio': {
    const rl = createInterface({ input: process.stdin })
    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: line })
        if (res.status === 202) continue
        process.stdout.write(`${JSON.stringify(await res.json())}\n`)
      } catch (err) {
        let id = null
        try { id = JSON.parse(line).id ?? null } catch {}
        if (id !== null) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: `bridge unreachable: ${err.message}` } })}\n`)
      }
    }
    break
  }
  case undefined:
  default:
    if (cmd !== '__import__') {
      console.error('commands: send, run-claude, thread, inbox, status, cancel, push-file, pull-file, token-add, token-scopes, mcp-stdio')
      process.exit(2)
    }
}
