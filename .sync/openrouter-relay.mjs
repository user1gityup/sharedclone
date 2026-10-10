#!/usr/bin/env node
/**
 * OpenRouter relay: one machine holds the OpenRouter key, every other machine
 * reaches OpenRouter through it with a token of its own.
 *
 * The key holder runs openrouter_proxy (Harness Build) through
 * ~/.dsh/openrouter-control.ps1, which reads the mode written here. A pool
 * machine never sees the key: it holds a relay token, one per machine, sealed
 * in the brain with the brain key so only brain members can open it, and its
 * DSH settings point at the relay instead of openrouter.ai. Revoking one
 * machine's token cuts that machine off without touching the key or the others.
 *
 * Exposure is selectable, for machines in the same room or not:
 *   loopback  127.0.0.1 only (relay off for other machines)
 *   lan       0.0.0.0, firewall allow-list + token        (same network)
 *   tunnel    0.0.0.0, reached over a Tailscale 100.x IP   (different networks)
 *   ssh       127.0.0.1, token required even on loopback; clients forward a port
 *
 * Key holder:
 *   mode <loopback|lan|tunnel|ssh> [--port 8080]
 *   issue <host>          new token for <host>, sealed to relay/tokens/<host>.enc
 *   revoke <host>
 *   allow <ip...>         remote addresses the firewall rule admits (lan mode)
 *   list | status | publish
 * Pool machine:
 *   connect [--route lan|tunnel|ssh] [--url http://host:port]
 *   disconnect
 *
 * Token values never reach stdout. Output is JSON.
 */

import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname, networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrainKey, openCredentials, sealCredentials, writeCredentialRefs } from './brain-sync.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MODES = { loopback: '127.0.0.1', lan: '0.0.0.0', tunnel: '0.0.0.0', ssh: '127.0.0.1' }
export const TOKEN_REF = 'OPENROUTER_RELAY_TOKEN'
const SSH_LOCAL_PORT = 18080
const VIRTUAL_ADAPTER = /vEthernet|WSL|VirtualBox|VMware|Hyper-V|Loopback|Docker/i

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

function paths(options = {}) {
  const dshHome = options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const brain = options.brain ?? dirname(HERE)
  const relayDir = join(dshHome, 'openrouter-relay')
  return {
    dshHome,
    brain,
    relayDir,
    config: join(relayDir, 'config.json'),
    tokens: join(relayDir, 'tokens.json'),
    restore: join(relayDir, 'connect-restore.json'),
    published: join(brain, 'relay', 'openrouter-relay.json'),
    sealedDir: join(brain, 'relay', 'tokens'),
    machine: (options.machine ?? hostname()).toLowerCase(),
  }
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

/** Write then rename, so the proxy's token reload never sees half a file. */
function writeJson(path, value, mode) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, mode === undefined ? undefined : { mode })
  renameSync(temp, path)
}

function brainKey(p, options) {
  const found = findBrainKey({ dir: p.brain, claudeHome: options.claudeHome })
  if (found === null) throw new Error('no brain key on this machine (~/.claude/brain-secrets.key)')
  return found.key
}

const safeHost = host => {
  const name = String(host ?? '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9.-]{0,62}$/.test(name)) throw new Error(`not a host name: ${host}`)
  return name
}

/** This machine's LAN and Tailscale IPv4 addresses. */
export function addresses(interfaces = networkInterfaces()) {
  let lan = null
  let tunnel = null
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue
      if (entry.internal) continue
      const [a, b] = entry.address.split('.').map(Number)
      if (a === 100 && b >= 64 && b <= 127) { tunnel ??= entry.address; continue }
      const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      if (isPrivate && !VIRTUAL_ADAPTER.test(name)) lan ??= entry.address
    }
  }
  return { lan, tunnel }
}

function readConfig(p) {
  return { mode: 'loopback', host: MODES.loopback, port: 8080, trustLoopback: true, allow: [], ...readJson(p.config, {}) }
}

// ---------------------------------------------------------------------------
// Key holder

export function publish(options = {}) {
  const p = paths(options)
  const config = readConfig(p)
  const { lan, tunnel } = options.addresses ?? addresses()
  const record = {
    keyHolder: p.machine,
    mode: config.mode,
    port: config.port,
    routes: {
      lan: lan === null ? null : `http://${lan}:${config.port}`,
      tunnel: tunnel === null ? null : `http://${tunnel}:${config.port}`,
      ssh: `http://127.0.0.1:${SSH_LOCAL_PORT}`,
    },
    sshForward: `ssh -N -L ${SSH_LOCAL_PORT}:127.0.0.1:${config.port} <user>@${lan ?? tunnel ?? p.machine}`,
    tokensSealedIn: 'relay/tokens/<host>.enc',
    updated: new Date().toISOString(),
  }
  writeJson(p.published, record)
  return record
}

export function setMode(mode, options = {}) {
  if (!(mode in MODES)) throw new Error(`mode must be one of ${Object.keys(MODES).join(', ')}`)
  const p = paths(options)
  const config = readConfig(p)
  const port = options.port === undefined ? config.port : Number(options.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port: ${options.port}`)
  const next = { ...config, mode, host: MODES[mode], port, trustLoopback: mode !== 'ssh', tokens: p.tokens }
  writeJson(p.config, next)
  const live = Object.values(readJson(p.tokens, { machines: {} }).machines ?? {}).filter(entry => !entry.revoked).length
  return {
    config: next,
    published: publish(options),
    ...(mode !== 'loopback' && live === 0 ? { warning: 'no live tokens: the proxy refuses to bind beyond loopback until one is issued' } : {}),
  }
}

export function issue(host, options = {}) {
  const p = paths(options)
  const name = safeHost(host)
  const token = randomBytes(32).toString('base64url')
  const tokens = readJson(p.tokens, { machines: {} })
  tokens.machines ??= {}
  const replacedPrevious = tokens.machines[name] !== undefined
  tokens.machines[name] = { sha256: createHash('sha256').update(token, 'utf8').digest('hex'), revoked: false, issued: new Date().toISOString() }
  const sealedPath = join(p.sealedDir, `${name}.enc`)
  mkdirSync(p.sealedDir, { recursive: true })
  writeFileSync(sealedPath, sealCredentials(brainKey(p, options), { version: 1, refs: { [TOKEN_REF]: token } }))
  writeJson(p.tokens, tokens, 0o600)
  return { issued: name, sealed: `relay/tokens/${name}.enc`, replacedPrevious }
}

export function revoke(host, options = {}) {
  const p = paths(options)
  const name = safeHost(host)
  const tokens = readJson(p.tokens, { machines: {} })
  const entry = tokens.machines?.[name]
  if (entry === undefined) return { revoked: name, known: false }
  entry.revoked = true
  entry.revokedAt = new Date().toISOString()
  writeJson(p.tokens, tokens, 0o600)
  rmSync(join(p.sealedDir, `${name}.enc`), { force: true })
  return { revoked: name, known: true }
}

export function allow(ips, options = {}) {
  const p = paths(options)
  const config = readConfig(p)
  for (const ip of ips) {
    if (!/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(ip)) throw new Error(`not an IPv4 address or CIDR: ${ip}`)
  }
  const next = { ...config, allow: [...new Set([...(config.allow ?? []), ...ips])] }
  writeJson(p.config, next)
  return { allow: next.allow }
}

export function list(options = {}) {
  const p = paths(options)
  const machines = readJson(p.tokens, { machines: {} }).machines ?? {}
  return Object.entries(machines).map(([host, entry]) => ({
    host, revoked: Boolean(entry.revoked), issued: entry.issued ?? null,
    sealed: existsSync(join(p.sealedDir, `${host}.enc`)),
  }))
}

export async function status(options = {}) {
  const p = paths(options)
  const config = readConfig(p)
  let health = null
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(3000) })
    const body = await response.json()
    health = { status: body.status, models_healthy: body.models_healthy }
  } catch (error) {
    health = { error: error.message }
  }
  return { machine: p.machine, config, tokens: list(options), published: readJson(p.published, null), health }
}

// ---------------------------------------------------------------------------
// Pool machine

// settings.yaml is edited line by line, not through a YAML round trip: a
// round trip reformats the rest of the 85 KB file, and disconnect has to put
// the file back byte for byte. Only block mappings are walked, which is all
// the edited paths go through.

const KEY_LINE = /^( *)([A-Za-z0-9_.-]+):(.*)$/

function lineInfo(line) {
  const body = line.replace(/\r?\n$/, '')
  if (body.trim() === '' || body.trimStart().startsWith('#')) return null
  const indent = body.length - body.trimStart().length
  const match = KEY_LINE.exec(body)
  return { indent, key: match ? match[2] : null, rest: match ? match[3] : null }
}

/** The line range [start, end) of the block under header line `header` (or the whole file). */
function blockEnd(lines, header, parentIndent) {
  for (let i = header + 1; i < lines.length; i += 1) {
    const info = lineInfo(lines[i])
    if (info !== null && info.indent <= parentIndent) return i
  }
  return lines.length
}

/** Where `path` sits: its line, or its parent header and the indent a new leaf takes. */
function locate(lines, path) {
  let start = 0
  let end = lines.length
  let parentIndent = -1
  let header = -1
  for (let depth = 0; depth < path.length; depth += 1) {
    let childIndent = null
    let found = -1
    for (let i = start; i < end; i += 1) {
      const info = lineInfo(lines[i])
      if (info === null || info.indent <= parentIndent) continue
      childIndent ??= info.indent
      if (info.indent === childIndent && info.key === path[depth]) { found = i; break }
    }
    if (found === -1) {
      if (depth < path.length - 1) throw new Error(`settings.yaml has no ${path.slice(0, depth + 1).join('.')}`)
      return { index: -1, header, indent: childIndent ?? parentIndent + 2 }
    }
    if (depth === path.length - 1) return { index: found, header, indent: childIndent }
    header = found
    parentIndent = childIndent
    start = found + 1
    end = blockEnd(lines, found, parentIndent)
  }
  throw new Error('empty settings path')
}

const splitKeepingEol = text => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

/** Set a leaf; returns its raw prior text after the colon, or null when it was absent. */
export function setLeaf(lines, path, value, eol) {
  const at = locate(lines, path)
  const key = path[path.length - 1]
  if (at.index === -1) {
    lines.splice(at.header + 1, 0, `${' '.repeat(at.indent)}${key}: ${value}${eol}`)
    return null
  }
  const line = lines[at.index]
  const lineEol = /\r?\n$/.exec(line)?.[0] ?? ''
  const prior = lineInfo(line).rest
  lines[at.index] = `${' '.repeat(at.indent)}${key}: ${value}${lineEol}`
  return prior
}

/** Put back a raw prior value from setLeaf, or remove a leaf that setLeaf inserted. */
export function restoreLeaf(lines, path, prior) {
  const at = locate(lines, path)
  if (at.index === -1) return
  if (prior === null) { lines.splice(at.index, 1); return }
  const line = lines[at.index]
  const lineEol = /\r?\n$/.exec(line)?.[0] ?? ''
  lines[at.index] = `${' '.repeat(at.indent)}${path[path.length - 1]}:${prior}${lineEol}`
}

/** Every settings.yaml value connect sets, for a relay base URL. */
export function settingsEdits(base) {
  return [
    [['llm-pi-ai', 'providers', 'openrouter', 'baseURL'], `${base}/openrouter/v1`],
    [['llm-pi-ai', 'providers', 'openrouter', 'apiKeyEnv'], TOKEN_REF],
    [['llm-pi-ai', 'providers', 'openrouter-free', 'baseURL'], `${base}/v1`],
    [['llm-pi-ai', 'providers', 'openrouter-free', 'apiKeyEnv'], TOKEN_REF],
    [['council', 'apiKeyEnv'], TOKEN_REF],
    [['council', 'seats', 'openrouter-free', 'baseUrl'], `${base}/v1/chat/completions`],
    [['council', 'seats', 'deepseek', 'baseUrl'], `${base}/openrouter/v1/chat/completions`],
    [['council', 'seats', 'kimi', 'baseUrl'], `${base}/openrouter/v1/chat/completions`],
  ]
}

function editSettings(p, apply) {
  const settingsPath = join(p.dshHome, 'settings.yaml')
  const text = readFileSync(settingsPath, 'utf8')
  const lines = splitKeepingEol(text)
  const result = apply(lines, text.includes('\r\n') ? '\r\n' : '\n')
  const backup = `${settingsPath}.pre-relay-${stamp()}`
  copyFileSync(settingsPath, backup)
  writeFileSync(settingsPath, lines.join(''))
  return { ...result, backup }
}

export function connect(options = {}) {
  const p = paths(options)
  const route = options.route ?? 'lan'
  const published = readJson(p.published, null)
  const base = (options.url ?? published?.routes?.[route] ?? '').replace(/\/+$/, '')
  if (!base) throw new Error(published === null ? 'no relay published in the brain yet (relay/openrouter-relay.json)' : `the relay publishes no ${route} route`)
  const sealedPath = join(p.sealedDir, `${p.machine}.enc`)
  if (!existsSync(sealedPath)) throw new Error(`no token issued for ${p.machine}; the key holder runs: issue ${p.machine}`)
  const token = openCredentials(brainKey(p, options), readFileSync(sealedPath, 'utf8'))?.refs?.[TOKEN_REF]
  if (typeof token !== 'string' || token === '') throw new Error(`relay/tokens/${p.machine}.enc does not open with this machine's brain key`)

  const credsPath = join(p.dshHome, '.credentials.yaml')
  const credsText = existsSync(credsPath) ? readFileSync(credsPath, 'utf8') : ''
  if (credsText !== '') writeFileSync(`${credsPath}.pre-relay-${stamp()}`, credsText, { mode: 0o600 })
  writeFileSync(credsPath, writeCredentialRefs(credsText, new Map([[TOKEN_REF, token]])), { mode: 0o600 })

  // The first connect records what it replaced; a reconnect keeps that record.
  const previous = readJson(p.restore, null)
  const edited = editSettings(p, (lines, eol) => ({
    before: settingsEdits(base).map(([path, value]) => [path, setLeaf(lines, path, value, eol)]),
  }))
  writeJson(p.restore, { ...(previous ?? { values: edited.before, connectedAt: new Date().toISOString() }), base, route: options.url ? 'url' : route })
  return { connected: p.machine, base, route: options.url ? 'url' : route, tokenRef: TOKEN_REF, settingsBackup: edited.backup }
}

export function disconnect(options = {}) {
  const p = paths(options)
  const record = readJson(p.restore, null)
  if (record === null) return { disconnected: false, reason: 'not connected (no connect-restore.json)' }
  const edited = editSettings(p, lines => {
    for (const [path, prior] of [...record.values].reverse()) restoreLeaf(lines, path, prior)
    return {}
  })
  rmSync(p.restore, { force: true })
  return { disconnected: true, settingsBackup: edited.backup }
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const name = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[name] = true
      else { flags[name] = next; i += 1 }
    } else positional.push(arg)
  }
  return { positional, flags }
}

const isMain = () => {
  if (!process.argv[1]) return false
  const norm = path => path.replace(/\\/g, '/').toLowerCase()
  return norm(fileURLToPath(import.meta.url)) === norm(process.argv[1])
}

if (isMain()) {
  const { positional: [cmd, ...rest], flags } = parseArgs(process.argv.slice(2))
  const options = {
    ...(flags['dsh-home'] ? { dshHome: flags['dsh-home'] } : {}),
    ...(flags.harness ? { harness: flags.harness } : {}),
    ...(flags.port ? { port: flags.port } : {}),
    ...(flags.route ? { route: flags.route } : {}),
    ...(flags.url ? { url: flags.url } : {}),
  }
  try {
    let result
    if (cmd === 'mode') result = setMode(rest[0], options)
    else if (cmd === 'issue') result = issue(rest[0], options)
    else if (cmd === 'revoke') result = revoke(rest[0], options)
    else if (cmd === 'allow') result = allow(rest, options)
    else if (cmd === 'list') result = list(options)
    else if (cmd === 'status') result = await status(options)
    else if (cmd === 'publish') result = publish(options)
    else if (cmd === 'connect') result = connect(options)
    else if (cmd === 'disconnect') result = disconnect(options)
    else {
      console.error('usage: openrouter-relay.mjs mode <loopback|lan|tunnel|ssh> | issue <host> | revoke <host> | allow <ip...> | list | status | publish | connect [--route lan|tunnel|ssh] [--url u] | disconnect')
      process.exit(2)
    }
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(`openrouter-relay: ${error.message}`)
    process.exit(1)
  }
}
