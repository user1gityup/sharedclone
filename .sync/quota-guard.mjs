#!/usr/bin/env node
/**
 * Automatic Quota Handoff - the quota guard.
 *
 * When the Claude account running this machine's sessions reaches the handoff
 * threshold (97% by default) of EITHER its session window or its weekly window,
 * the guard snapshots every active session into one handoff in the brain, and
 * another authorized account continues the work from it with `resume`.
 *
 * It transfers WORK STATE, never ACCOUNT IDENTITY: no credential file, cookie,
 * token or `.env` value is read into a handoff, and everything that is written
 * passes through `redact()` first. The receiver authenticates as itself.
 *
 * Reuses, rather than duplicates:
 * - quota: `~/.claude/statusline/usage-cache.json`, which the status line and
 *   DSH's `quota-claude` package already keep fresh from `/api/oauth/usage`
 *   (free) and `/usage`. Model context size is a different measurement and is
 *   never read here; that belongs to `quota-handoff.mjs`.
 * - sessions: the Claude Code transcripts under `<config>/projects`, plus the
 *   registry `quota-handoff.mjs` writes on every prompt and tool call.
 * - shared storage and sync: the brain itself (`quota-handoffs/` in this repo),
 *   carried between machines by brain-sync; no new sync service.
 * - DSH routing: `exhausted.json` below is read by the council's swarm seat
 *   gate, which then routes no new work to the Claude subscription seat.
 *
 * No Context Compiler exists yet (dsh-target-architecture.md), so the resume
 * layer is compiled here, mechanically, without spending model tokens.
 *
 * Environment:
 *   QUOTA_GUARD_HOME       local guard state (default ~/.claude/quota-guard)
 *   QUOTA_GUARD_BRAIN      brain root holding quota-handoffs/ (default: this repo)
 *   QUOTA_GUARD_CONFIG_DIR Claude config dir whose sessions/quota are read (default CLAUDE_CONFIG_DIR or ~/.claude)
 *   QUOTA_GUARD_CACHE      quota cache file (default the status line's)
 *   QUOTA_GUARD_THRESHOLD  handoff threshold percent (default 97)
 *   QUOTA_GUARD_DEV=1      allows simulated quota readings; never set in production
 *   QUOTA_GUARD_NOW        epoch ms, tests only
 *   QUOTA_GUARD_HOST       machine name override, tests only
 */

import { spawnSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync,
} from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------- environment

/** Resolve every path and knob from the environment at call time, so tests can swap them. */
export function env(overrides = {}) {
  const e = { ...process.env, ...overrides }
  const home = e.QUOTA_GUARD_HOME ?? join(homedir(), '.claude', 'quota-guard')
  const configDir = e.QUOTA_GUARD_CONFIG_DIR ?? e.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const file = readJson(join(home, 'config.json')) ?? {}
  const threshold = Number(e.QUOTA_GUARD_THRESHOLD ?? file.threshold ?? 97)
  const host = (e.QUOTA_GUARD_HOST ?? hostname()).toLowerCase()
  // The signed-in login, not the config dir: the desktop app switches accounts
  // inside one ~/.claude, so the dir name alone cannot tell two accounts apart.
  const accountUuid = e.QUOTA_GUARD_ACCOUNT_UUID ?? loginUuid(configDir)
  return {
    home,
    brain: e.QUOTA_GUARD_BRAIN ?? resolve(HERE, '..'),
    configDir,
    cache: e.QUOTA_GUARD_CACHE ?? (basename(configDir) === '.claude-work'
      ? join(homedir(), '.claude', 'statusline', 'usage-work-cache.json')
      : join(configDir, 'statusline', 'usage-cache.json')),
    threshold: Number.isFinite(threshold) && threshold > 0 && threshold <= 100 ? threshold : 97,
    warmAt: Number(file.warmAt ?? 95),
    activeWindowMs: Number(file.activeWindowMinutes ?? 30) * 60_000,
    dev: e.QUOTA_GUARD_DEV === '1',
    now: Number(e.QUOTA_GUARD_NOW ?? Date.now()),
    host,
    user: e.QUOTA_GUARD_USER ?? safeUser(),
    accountUuid: accountUuid ?? null,
    account: e.QUOTA_GUARD_ACCOUNT ?? `claude:${basename(configDir)}${accountUuid ? `:${accountUuid.slice(0, 8)}` : ''}@${host}`,
    // Claude desktop app session records (title, model, effort, permission mode per session).
    desktopDir: e.QUOTA_GUARD_DESKTOP_DIR ?? join(e.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude-code-sessions'),
  }
}

/**
 * The handoff came from this same login. Quota belongs to the login, so the same
 * login on another machine is just as exhausted and must not receive it.
 */
export function sameLogin(E, m) {
  if (m.source_account_uuid && E.accountUuid) return m.source_account_uuid === E.accountUuid
  return m.source_account === E.account
}

function safeUser() { try { return userInfo().username } catch { return 'unknown' } }

/** accountUuid of the login in this config dir; only that field is read, never a token. */
function loginUuid(configDir) {
  const file = resolve(configDir) === resolve(join(homedir(), '.claude')) ? join(homedir(), '.claude.json') : join(configDir, '.claude.json')
  const uuid = readJson(file)?.oauthAccount?.accountUuid
  return typeof uuid === 'string' && /^[0-9a-f-]{8,}$/i.test(uuid) ? uuid : undefined
}
const queueDir = (E) => join(E.brain, 'quota-handoffs')

// ---------------------------------------------------------------- small io

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

/** Write via a temp file and rename, so a reader never sees half a file. */
export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}

/** Create a file only if it does not exist. The one atomic primitive claims rest on. */
function createExclusive(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  let fd
  try { fd = openSync(path, 'wx') } catch (err) { if (err.code === 'EEXIST') return false; throw err }
  try { writeSync(fd, JSON.stringify(value, null, 2)) } finally { closeSync(fd) }
  return true
}

// ---------------------------------------------------------------- redaction

// The same credential shapes export-history.mjs strips; that module runs on
// import, so its function cannot be imported and the patterns live here too.
const CRED = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(?:or-v1-|ant-[a-z0-9]*-?|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bya29\.[A-Za-z0-9._-]{20,}/g,
  /\bnvapi-[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?/g,
  /\b1\/\/0[A-Za-z0-9_-]{30,}/g,
  /(?<![A-Za-z0-9])[a-fA-F0-9]{64}(?![A-Za-z0-9])/g,
]
const NAMED = /\b((?:api[_-]?key|apikey|secret|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|bearer|cookie|set-cookie|session[_-]?key|oauth[_-]?token|accessToken|refreshToken)["']?\s*[:=]\s*["']?(?:Bearer\s+)?)([^\s"',;}{)]{6,})/gi
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g

/** Strip anything shaped like a credential. Idempotent. */
export function redact(text) {
  if (text == null) return ''
  let s = String(text)
  for (const re of CRED) s = s.replace(re, '<redacted>')
  s = s.replace(BEARER, '$1<redacted>')
  s = s.replace(NAMED, (m, k, v) => (/^<redacted>$|^\$\{|^process\.env|^\$env:|Env$/.test(v) ? m : `${k}<redacted>`))
  return s
}

/** Files whose contents never enter a handoff, even redacted. */
export const SECRET_FILE = /(^|[\\/])(\.env(\..*)?|\.credentials\.json|credentials(\.json)?|cookies?(\.sqlite)?|.*\.(pem|key|p12|pfx|enc)|id_(rsa|ed25519|ecdsa)|auth\.json|\.netrc|\.npmrc|\.pypirc)$/i

/** A transcript record whose tool input or result touched a secret file loses its content. */
function scrubRecord(record) {
  const text = JSON.stringify(record)
  if (!SECRET_FILE.test(text) && !/\.env\b/.test(text)) return record
  const touches = (v) => typeof v === 'string' && SECRET_FILE.test(v.trim())
  const content = record?.message?.content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'tool_use' && Object.values(part.input ?? {}).some(touches)) {
        part.input = Object.fromEntries(Object.entries(part.input).map(([k, v]) => [k, touches(v) ? v : (typeof v === 'string' ? '<secret-file content omitted>' : v)]))
        part._secretFile = true
      }
    }
  }
  const tur = record?.toolUseResult
  if (tur && typeof tur === 'object' && Object.values(tur.file ?? tur).some(touches)) record.toolUseResult = { omitted: 'secret file' }
  return record
}

/** Results of reading a secret file are also dropped: the tool_result follows its tool_use. */
function scrubTranscript(records) {
  const secretUses = new Set()
  for (const r of records) {
    const content = r?.message?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part?.type === 'tool_use') {
        scrubRecord(r)
        if (part._secretFile) { secretUses.add(part.id); delete part._secretFile }
      }
      if (part?.type === 'tool_result' && secretUses.has(part.tool_use_id)) {
        part.content = '<secret-file content omitted>'
        if (r.toolUseResult) r.toolUseResult = { omitted: 'secret file' }
      }
    }
  }
  return records
}

// ---------------------------------------------------------------- quota providers

/** When a `/usage` reset stamp such as "Sep 26, 4:40pm" falls, as epoch ms. */
export function resetTime(stamp, now) {
  if (!stamp) return undefined
  const m = /([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(stamp)
  if (!m) return undefined
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
  const month = months[m[1].toLowerCase()]
  if (month === undefined) return undefined
  let hour = Number(m[3]) % 12
  if (m[5].toLowerCase() === 'pm') hour += 12
  const year = new Date(now).getFullYear()
  let t = new Date(year, month, Number(m[2]), hour, Number(m[4] ?? 0)).getTime()
  if (now - t > 180 * 86_400_000) t = new Date(year + 1, month, Number(m[2]), hour, Number(m[4] ?? 0)).getTime()
  return t
}

const UNKNOWN = (provider, account, source, now, why) => ({
  provider, account, state: 'UNKNOWN', session_used_percent: null, weekly_used_percent: null,
  session_reset_at: null, weekly_reset_at: null, measurement_source: source, measurement_confidence: 'none',
  timestamp: new Date(now).toISOString(), simulated: false, note: why,
})

/**
 * QuotaProvider for a Claude Code subscription account.
 *
 * Reads the shared cache only - it never calls `/usage`, which would spend a
 * request of the very quota it measures. A window whose reset has passed is
 * reported as null: those figures describe the previous window.
 */
export function claudeProvider(E) {
  return {
    name: 'claude',
    read() {
      const data = readJson(E.cache)
      const ok = (v) => typeof v === 'number' && Number.isFinite(v)
      if (!data || (!ok(data.sessionPercent) && !ok(data.weekPercent))) {
        return UNKNOWN('claude', E.account, `cache:${E.cache}`, E.now, data ? 'cache carries no percentages' : 'no quota cache')
      }
      const age = data.capturedAt ? E.now - data.capturedAt : Infinity
      const window = (percent, stamp) => {
        if (!ok(percent)) return { percent: null, reset: null }
        const reset = resetTime(stamp, E.now)
        if (reset !== undefined && reset <= E.now) return { percent: null, reset: null }
        return { percent, reset: reset === undefined ? null : new Date(reset).toISOString() }
      }
      const s = window(data.sessionPercent, data.sessionResets)
      const w = window(data.weekPercent, data.weekResets)
      return {
        provider: 'claude',
        account: E.account,
        state: s.percent === null && w.percent === null ? 'UNKNOWN' : 'OK',
        session_used_percent: s.percent,
        weekly_used_percent: w.percent,
        session_reset_at: s.reset,
        weekly_reset_at: w.reset,
        session_reset_label: data.sessionResets ?? null,
        weekly_reset_label: data.weekResets ?? null,
        measurement_source: 'statusline-cache (/api/oauth/usage or /usage)',
        // Older than 15 minutes still counts - quota only rises inside a window - but says so.
        measurement_confidence: age <= 15 * 60_000 ? 'high' : 'stale',
        timestamp: new Date(data.capturedAt ?? E.now).toISOString(),
        simulated: false,
      }
    },
  }
}

/**
 * Codex exposes its rate limits only through its app-server over a spawned
 * CLI (DSH `quota-codex`), which costs a process launch per read; nothing is
 * cached on disk. Reported honestly as UNKNOWN until such a cache exists.
 */
export function codexProvider(E) {
  return { name: 'codex', read: () => UNKNOWN('codex', `codex@${E.host}`, 'none', E.now, 'no cached Codex rate-limit reading on disk') }
}

const simFile = (E) => join(E.home, 'SIMULATED-QUOTA.json')

/**
 * Simulated readings for development. Honoured only with QUOTA_GUARD_DEV=1,
 * marked `simulated: true` and `measurement_source: SIMULATED`, and every
 * handoff built from one carries a `SIM-` id and `simulated: true`.
 */
export function simulationProvider(E) {
  return {
    name: 'simulation',
    read() {
      if (!E.dev) return undefined
      const sim = readJson(simFile(E))
      if (!sim) return undefined
      const reset = (h) => new Date(E.now + h * 3_600_000).toISOString()
      return {
        provider: 'claude', account: E.account, state: 'OK',
        session_used_percent: sim.session ?? null, weekly_used_percent: sim.weekly ?? null,
        session_reset_at: reset(5), weekly_reset_at: reset(72),
        session_reset_label: 'SIMULATED', weekly_reset_label: 'SIMULATED',
        measurement_source: 'SIMULATED', measurement_confidence: 'simulated',
        timestamp: new Date(E.now).toISOString(), simulated: true,
      }
    },
  }
}

export function simulate(E, { session, weekly }) {
  if (!E.dev) throw new Error('simulation refused: set QUOTA_GUARD_DEV=1 (development/testing only)')
  writeJsonAtomic(simFile(E), { session: session ?? null, weekly: weekly ?? null, setAt: new Date(E.now).toISOString(), warning: 'SIMULATED QUOTA - NOT REAL TELEMETRY' })
}

export function clearSimulation(E) { rmSync(simFile(E), { force: true }) }

/** The reading the guard acts on: a dev simulation when one is set, else the real provider. */
export function readQuota(E) {
  return simulationProvider(E).read() ?? claudeProvider(E).read()
}

/**
 * Whether a reading crosses the threshold, and which window did.
 * @returns undefined below threshold or UNKNOWN; never a fabricated trigger.
 */
const eventKey = (reading) => `${reading.account}|${reading.simulated ? 'SIM' : 'REAL'}`

export function assess(reading, threshold) {
  if (!reading || reading.state !== 'OK') return undefined
  const hits = [
    ['session', reading.session_used_percent, reading.session_reset_at, reading.session_reset_label],
    ['weekly', reading.weekly_used_percent, reading.weekly_reset_at, reading.weekly_reset_label],
  ].filter(([, p]) => typeof p === 'number' && p >= threshold)
  if (!hits.length) return undefined
  hits.sort((a, b) => b[1] - a[1])
  const [window, percent, resetAt] = hits[0]
  return {
    window, percent, resetAt, windows: hits.map(([w, p]) => ({ window: w, percent: p })),
    reason: hits.map(([w, p]) => `${w === 'session' ? 'Session' : 'Weekly'} usage ${p}%`).join(', '),
    // One exhaustion event per account: it opens at the first crossing of either
    // window and closes only when a real reading shows both below threshold. A
    // session crossing followed by a weekly crossing is still the same event.
    key: eventKey(reading),
  }
}

// ---------------------------------------------------------------- state machine

export const STATES = ['NORMAL', 'PREPARING', 'SNAPSHOTTING', 'READY', 'CLAIMED', 'RESTORING', 'ACTIVE', 'FAILED']
const NEXT = {
  NORMAL: ['PREPARING'],
  PREPARING: ['SNAPSHOTTING', 'FAILED'],
  SNAPSHOTTING: ['READY', 'FAILED'],
  READY: ['CLAIMED'],
  CLAIMED: ['RESTORING', 'READY'],
  RESTORING: ['ACTIVE', 'READY'],
  ACTIVE: [],
  FAILED: ['PREPARING'],
}

/** Move a manifest to its next state, recording who and when. Throws on an illegal edge. */
export function transition(manifest, to, by, now, detail) {
  const from = manifest.state ?? 'NORMAL'
  if (!NEXT[from]?.includes(to)) throw new Error(`illegal handoff transition ${from} -> ${to}`)
  manifest.state = to
  manifest.history = [...(manifest.history ?? []), { from, to, at: new Date(now).toISOString(), by, ...(detail ? { detail } : {}) }]
  return manifest
}

// ---------------------------------------------------------------- session registry

const registryDir = (E) => join(E.home, 'sessions')

/** Called by the quota hook on each prompt/tool call; cheap and race-free (one file per session). */
export function touchSession(E, { sessionId, transcriptPath, cwd }) {
  if (!sessionId) return
  const path = join(registryDir(E), `${sessionId.replace(/[^A-Za-z0-9_-]/g, '')}.json`)
  const prev = readJson(path)
  if (prev && E.now - Date.parse(prev.lastSeen) < 60_000 && prev.transcriptPath === transcriptPath) return
  writeJsonAtomic(path, { sessionId, transcriptPath, cwd, configDir: E.configDir, host: E.host, lastSeen: new Date(E.now).toISOString() })
}

/**
 * Sessions this account has active on this machine: registry entries and
 * top-level transcripts touched within the active window. Subagent transcripts
 * belong to their parent session and are not separate work.
 */
export function activeSessions(E, { exclude = [] } = {}) {
  const found = new Map()
  const since = E.now - E.activeWindowMs
  for (const f of safeList(registryDir(E))) {
    const r = readJson(join(registryDir(E), f))
    if (!r?.sessionId || Date.parse(r.lastSeen) < since) continue
    if (r.configDir && resolve(r.configDir) !== resolve(E.configDir)) continue
    if (r.transcriptPath && existsSync(r.transcriptPath)) found.set(r.sessionId, { sessionId: r.sessionId, transcriptPath: r.transcriptPath, cwd: r.cwd })
  }
  const projects = join(E.configDir, 'projects')
  for (const dir of safeList(projects)) {
    for (const f of safeList(join(projects, dir))) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(projects, dir, f)
      let mtime
      try { mtime = statSync(path).mtimeMs } catch { continue }
      if (mtime < since || mtime > E.now + 60_000) continue
      const sessionId = f.slice(0, -'.jsonl'.length)
      if (!found.has(sessionId)) found.set(sessionId, { sessionId, transcriptPath: path })
    }
  }
  for (const id of exclude) found.delete(id)
  return [...found.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId))
}

function safeList(dir) { try { return readdirSync(dir) } catch { return [] } }

/**
 * Claude desktop app records, keyed by CLI session id. Layout:
 * <desktopDir>/<accountUuid>/<orgUuid>/local_<id>.json. Only sessions of this
 * login are read when its uuid is known. Fields copied are the ones the app
 * lets a session set on another: title, model, effort, permission mode.
 */
export function desktopSessions(E) {
  const out = new Map()
  const accounts = E.accountUuid ? [E.accountUuid] : safeList(E.desktopDir)
  for (const acct of accounts) {
    for (const org of safeList(join(E.desktopDir, acct))) {
      for (const f of safeList(join(E.desktopDir, acct, org))) {
        if (!/^local_.*\.json$/.test(f)) continue
        const r = readJson(join(E.desktopDir, acct, org, f))
        if (!r?.cliSessionId) continue
        out.set(r.cliSessionId, {
          desktop_session_id: r.sessionId ?? f.slice(0, -5), desktop_account: acct,
          title: r.title ?? null, model: r.model ?? null, effort: r.effort ?? null,
          permission_mode: r.permissionMode ?? null, cwd: r.cwd ?? null, archived: Boolean(r.isArchived),
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- snapshot

function readTranscript(path) {
  const records = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try { records.push(JSON.parse(line)) } catch {}
  }
  return records
}

const textOf = (content) => typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : ''
const clip = (s, n) => { s = redact(s).replace(/\s+\n/g, '\n').trim(); return s.length > n ? `${s.slice(0, n)} ...[${s.length - n} more chars in archive]` : s }
/** Harness-injected turns (hook output, reminders, command wrappers) are not the user's words. */
const isHumanPrompt = (t) => t && !/^\s*<(system-reminder|command-|local-command|user-prompt-submit-hook|task-notification)/.test(t) && !t.startsWith('Caveat:')

function git(cwd, args) {
  if (!cwd || !existsSync(cwd)) return undefined
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 8000, windowsHide: true })
  return r.status === 0 ? r.stdout.trim() : undefined
}

/**
 * Build one session's continuation package (resume layer) from its transcript.
 * Mechanical - no model call - and redacted.
 */
export function summarizeSession(E, session, records, desktop) {
  let cwd = session.cwd, branch, model, firstPrompt, lastPrompt, lastAssistant, todos, lastAt, title, permissionMode, effort
  const files = new Map(), errors = [], running = new Map(), notes = new Set()
  for (const r of records) {
    cwd = r.cwd ?? cwd
    branch = r.gitBranch ?? branch
    if (r.timestamp) lastAt = r.timestamp
    if (r.type === 'custom-title' && r.customTitle) title = r.customTitle
    if (typeof r.permissionMode === 'string') permissionMode = r.permissionMode
    if (typeof r.effort === 'string') effort = r.effort
    const msg = r.message
    if (!msg) continue
    if (r.type === 'user' && msg.role === 'user' && !r.isMeta) {
      const t = textOf(msg.content)
      if (isHumanPrompt(t)) { firstPrompt ??= t; lastPrompt = t }
    }
    if (r.type === 'assistant') {
      model = msg.model ?? model
      const t = textOf(msg.content)
      if (t.trim()) lastAssistant = t
    }
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part?.type === 'tool_use') {
        const input = part.input ?? {}
        const file = input.file_path ?? input.notebook_path ?? input.path
        if (typeof file === 'string' && !SECRET_FILE.test(file)) {
          files.set(file, part.name)
          if (/shared-brain[\\/](handoff-[^\\/]+\.md)$/i.test(file)) notes.add(file)
        }
        // Notes written through a shell (heredoc, >>) name themselves in the command.
        if (typeof input.command === 'string') for (const m of input.command.matchAll(/(?:^|[\s"'/\\])(handoff-[\w.-]+\.md)\b/g)) notes.add(m[1])
        if (part.name === 'TodoWrite' && Array.isArray(input.todos)) todos = input.todos
        if (input.run_in_background) running.set(part.id, clip(input.command ?? input.description ?? part.name, 160))
      }
      if (part?.type === 'tool_result') {
        running.delete(part.tool_use_id)
        if (part.is_error) errors.push(clip(textOf(part.content) || String(part.content ?? ''), 240))
      }
    }
  }
  // The quota hook has sessions keep resume-<host>.md current; when it names
  // this session, its Handoff and Next lines are the session's own words.
  const pointer = (() => { try { return readFileSync(join(E.brain, `resume-${E.host}.md`), 'utf8') } catch { return '' } })()
  const pointed = pointer.includes(session.sessionId)
  const pointerLine = (key) => (pointed ? new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(pointer)?.[1]?.trim() : undefined)
  if (pointerLine('Handoff')) notes.add(pointerLine('Handoff'))
  const status = git(cwd, ['status', '--porcelain'])
  const repo = git(cwd, ['rev-parse', '--show-toplevel'])
  const pendingTodos = (todos ?? []).filter((t) => t.status !== 'completed')
  const doneTodos = (todos ?? []).filter((t) => t.status === 'completed')
  return {
    source_session_id: session.sessionId,
    provider: 'claude-code',
    model: model ?? null,
    project: repo ? basename(repo) : (cwd ? basename(cwd) : null),
    repository: repo ?? null,
    working_directory: cwd ?? null,
    branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? (branch && branch !== 'HEAD' ? branch : null),
    git_head: git(cwd, ['rev-parse', 'HEAD']) ?? null,
    uncommitted_changes: status ? status.split('\n').slice(0, 40) : [],
    task_objective: firstPrompt ? clip(firstPrompt, 1200) : null,
    latest_request: lastPrompt && lastPrompt !== firstPrompt ? clip(lastPrompt, 800) : null,
    current_status: lastAssistant ? clip(lastAssistant, 1200) : null,
    completed_work: doneTodos.map((t) => clip(t.content, 200)),
    pending_work: pendingTodos.map((t) => `${t.status === 'in_progress' ? '[in progress] ' : ''}${clip(t.content, 200)}`),
    next_recommended_action: pendingTodos[0]
      ? clip(pendingTodos.find((t) => t.status === 'in_progress')?.content ?? pendingTodos[0].content, 300)
      : pointerLine('Next') ? clip(pointerLine('Next'), 300) : 'Verify the last status against the repository, then continue the objective.',
    important_decisions: [...new Set([...notes].map((n) => basename(n.replace(/\\/g, '/'))))].map((n) => `See handoff note shared-brain/${redact(n)}`),
    relevant_files: [...files.keys()].slice(-25).map(redact),
    running_tasks: [...running.values()],
    dependencies: [],
    errors_blockers: [...new Set(errors)].slice(-5),
    last_meaningful_session_state: lastAt ?? null,
    transcript_records: records.length,
    // What the replacement session is set to: the desktop record when the app
    // ran it (its model id is the picker's, e.g. "...[1m]"), else the transcript.
    settings: {
      title: clip(desktop?.title ?? title ?? (firstPrompt ? firstPrompt.split('\n')[0] : '') ?? '', 80) || null,
      model: desktop?.model ?? model ?? null,
      effort: desktop?.effort ?? effort ?? null,
      permission_mode: desktop?.permission_mode ?? permissionMode ?? null,
      desktop_session_id: desktop?.desktop_session_id ?? null,
      desktop_account: desktop?.desktop_account ?? null,
    },
  }
}

/** The compact resume text a replacement session is started with. */
export function continuationMarkdown(manifest, pkg, archiveRel) {
  const list = (xs) => (xs?.length ? xs.map((x) => `- ${x}`).join('\n') : '- none recorded')
  return redact([
    `# Continuation ${manifest.handoff_id} / ${pkg.source_session_id}${manifest.simulated ? ' (SIMULATED)' : ''}`,
    '',
    `Source: ${manifest.source_user}@${manifest.source_machine}, account ${manifest.source_account}, model ${pkg.model ?? 'unknown'}`,
    `Reason: ${manifest.reason}`,
    `Repository: ${pkg.repository ?? 'n/a'}  cwd: ${pkg.working_directory ?? 'n/a'}`,
    `Branch: ${pkg.branch ?? 'n/a'}  HEAD: ${pkg.git_head ?? 'n/a'}  uncommitted: ${pkg.uncommitted_changes.length}`,
    `Session settings: title "${pkg.settings?.title ?? 'n/a'}", model ${pkg.settings?.model ?? 'n/a'}, effort ${pkg.settings?.effort ?? 'n/a'}, permission ${pkg.settings?.permission_mode ?? 'n/a'}`,
    '',
    '## Objective', pkg.task_objective ?? '(not recorded)',
    ...(pkg.latest_request ? ['', '## Latest request', pkg.latest_request] : []),
    '', '## Last status', pkg.current_status ?? '(not recorded)',
    '', '## Pending', list(pkg.pending_work),
    '', '## Next action', pkg.next_recommended_action,
    '', '## Decisions / notes', list(pkg.important_decisions),
    '', '## Files', list(pkg.relevant_files.slice(-12)),
    '', '## Running when handed off', list(pkg.running_tasks),
    '', '## Errors / blockers', list(pkg.errors_blockers),
    '',
    `Full archived transcript (redacted, gzip JSONL): ${archiveRel}. Do NOT load it by default; open it only when this package lacks something you need.`,
    'Before editing: verify these claims against the live filesystem, git state and processes. Work under your own account; no credentials were transferred.',
  ].join('\n'))
}

// ---------------------------------------------------------------- guard state

const guardState = (E) => readJson(join(E.home, 'state.json')) ?? { events: {} }
const saveGuardState = (E, s) => writeJsonAtomic(join(E.home, 'state.json'), s)
const exhaustedPath = (E) => join(E.home, 'exhausted.json')

/** Short, cross-process lock for one exhaustion event on this machine. */
function lock(E, key) {
  const dir = join(E.home, 'locks', createHash('sha1').update(key).digest('hex').slice(0, 16))
  mkdirSync(dirname(dir), { recursive: true })
  try { mkdirSync(dir) } catch (err) {
    if (err.code !== 'EEXIST') throw err
    // A lock older than 10 minutes belongs to a process that died mid-snapshot.
    try { if (E.now - statSync(dir).mtimeMs < 10 * 60_000) return undefined } catch {}
    rmSync(dir, { recursive: true, force: true })
    try { mkdirSync(dir) } catch { return undefined }
  }
  return () => rmSync(dir, { recursive: true, force: true })
}

function nextId(E, simulated) {
  const day = new Date(E.now).toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `${simulated ? 'SIM-' : ''}H-${day}-${E.host}-`
  let n = 0
  for (const f of safeList(queueDir(E))) {
    const m = f.startsWith(prefix) ? /-(\d{3})(?:\.|$)/.exec(f.slice(prefix.length - 1)) : null
    if (m) n = Math.max(n, Number(m[1]))
  }
  return `${prefix}${String(n + 1).padStart(3, '0')}`
}

// ---------------------------------------------------------------- source side

/**
 * Snapshot every active session into one handoff.
 *
 * Everything is written into `<id>.partial/`; only after every session's
 * package and archive exist is the directory renamed to `<id>/` with state
 * READY. A failure leaves a FAILED (retryable) handoff and the original
 * sessions untouched - nothing here ever modifies or stops a source session.
 */
export function buildHandoff(E, { reason, kind = 'quota', reading, trigger, exclude = [], hooks = {} }) {
  const simulated = Boolean(reading?.simulated)
  const id = hooks.id ?? nextId(E, simulated)
  const q = queueDir(E)
  const partial = join(q, `${id}.partial`)
  rmSync(partial, { recursive: true, force: true })
  const manifest = {
    handoff_id: id, kind, simulated,
    ...(simulated ? { warning: 'SIMULATED QUOTA HANDOFF - built from injected test readings, not real telemetry' } : {}),
    state: 'NORMAL', reason, trigger: trigger ?? null,
    quota: reading ?? null,
    source_user: E.user, source_machine: E.host, source_account: E.account, source_account_uuid: E.accountUuid ?? null,
    created_at: new Date(E.now).toISOString(), sessions: [], history: [],
  }
  transition(manifest, 'PREPARING', E.account, E.now)
  const sessions = activeSessions(E, { exclude })
  const desktop = desktopSessions(E)
  transition(manifest, 'SNAPSHOTTING', E.account, E.now, `${sessions.length} active session(s)`)
  mkdirSync(partial, { recursive: true })
  writeJsonAtomic(join(partial, 'manifest.json'), manifest)
  try {
    for (const [i, s] of sessions.entries()) {
      hooks.beforeSession?.(s, i)
      const records = scrubTranscript(readTranscript(s.transcriptPath))
      const pkg = { handoff_id: id, source_user: E.user, source_machine: E.host, ...summarizeSession(E, s, records, desktop.get(s.sessionId)), created_at: new Date(E.now).toISOString() }
      const dir = join(partial, 'sessions', s.sessionId)
      const archive = join(partial, 'archive', `${s.sessionId}.jsonl.gz`)
      mkdirSync(dirname(archive), { recursive: true })
      writeFileSync(archive, gzipSync(redact(records.map((r) => JSON.stringify(r)).join('\n'))))
      const archiveRel = `quota-handoffs/${id}/archive/${s.sessionId}.jsonl.gz`
      writeJsonAtomic(join(dir, 'continuation.json'), { ...pkg, archive: archiveRel })
      writeFileSync(join(dir, 'continuation.md'), continuationMarkdown(manifest, pkg, archiveRel))
      manifest.sessions.push({ source_session_id: s.sessionId, model: pkg.model, project: pkg.project, working_directory: pkg.working_directory, settings: pkg.settings, package: `sessions/${s.sessionId}/continuation.md`, archive: `archive/${s.sessionId}.jsonl.gz` })
    }
    manifest.session_count = manifest.sessions.length
    if (!manifest.sessions.length) manifest.notice = 'No active sessions: this handoff only notifies the receiver that the source account is exhausted.'
    transition(manifest, 'READY', E.account, E.now)
    writeJsonAtomic(join(partial, 'manifest.json'), manifest)
    hooks.beforePublish?.()
    // The rename is the commit point: before it no reader sees the handoff at all.
    rmSync(join(q, id), { recursive: true, force: true })
    renameSync(partial, join(q, id))
    return manifest
  } catch (err) {
    manifest.error = redact(String(err?.message ?? err))
    manifest.retryable = true
    transition(manifest, 'FAILED', E.account, E.now, manifest.error)
    rmSync(join(q, id), { recursive: true, force: true })
    try { writeJsonAtomic(join(partial, 'manifest.json'), manifest); renameSync(partial, join(q, id)) } catch {}
    return manifest
  }
}

/**
 * One guard pass: read quota, and on the first crossing of the threshold for
 * an exhaustion event, mark the account exhausted for DSH and build the handoff.
 * Repeated passes above the threshold return the existing handoff.
 */
export function check(E, { hooks } = {}) {
  const reading = readQuota(E)
  const found = assess(reading, E.threshold)
  const state = guardState(E)
  if (!found) {
    // Below threshold or the window reset: the event closes and the account may
    // take work again. UNKNOWN proves nothing either way, so it changes nothing.
    if (reading?.state === 'OK') {
      rmSync(exhaustedPath(E), { force: true })
      if (state.events[eventKey(reading)]) { delete state.events[eventKey(reading)]; saveGuardState(E, state) }
    }
    return { action: 'none', reading, threshold: E.threshold }
  }
  writeJsonAtomic(exhaustedPath(E), {
    account: E.account, provider: 'claude', host: E.host, reason: found.reason, window: found.window,
    percent: found.percent, resets_at: found.resetAt, simulated: Boolean(reading.simulated), since: new Date(E.now).toISOString(),
    handoff_id: state.events[found.key]?.handoff_id ?? null,
  })
  // PREPARING/SNAPSHOTTING in the record with no lock held means a run died mid-snapshot: retry it.
  const settled = (ev) => ev && !['FAILED', 'PREPARING', 'SNAPSHOTTING'].includes(ev.state)
  const prior = state.events[found.key]
  if (settled(prior)) return { action: 'exists', handoff_id: prior.handoff_id, state: prior.state, reading }
  const release = lock(E, found.key)
  if (!release) return { action: 'busy', reading }
  try {
    const again = guardState(E).events[found.key]
    if (settled(again)) return { action: 'exists', handoff_id: again.handoff_id, state: again.state, reading }
    // Persist PREPARING with its id before any snapshot work, so an interrupted
    // run is retried under the same id instead of forgotten or duplicated.
    const handoffId = again?.handoff_id ?? nextId(E, Boolean(reading.simulated))
    const event = { handoff_id: handoffId, state: 'PREPARING', since: again?.since ?? new Date(E.now).toISOString(), attempts: (again?.attempts ?? 0) + 1 }
    const pre = guardState(E)
    pre.events[found.key] = event
    saveGuardState(E, pre)
    const manifest = buildHandoff(E, { reason: found.reason, reading, trigger: found, hooks: { ...hooks, id: handoffId } })
    const latest = guardState(E)
    latest.events[found.key] = { ...event, state: manifest.state, at: new Date(E.now).toISOString() }
    saveGuardState(E, latest)
    const flag = readJson(exhaustedPath(E))
    if (flag) writeJsonAtomic(exhaustedPath(E), { ...flag, handoff_id: manifest.handoff_id })
    return { action: manifest.state === 'READY' ? 'created' : 'failed', handoff_id: manifest.handoff_id, state: manifest.state, sessions: manifest.session_count ?? 0, error: manifest.error, reading }
  } finally { release() }
}

// ---------------------------------------------------------------- queue

export function loadManifest(E, id) {
  const m = readJson(join(queueDir(E), id, 'manifest.json'))
  if (!m) return undefined
  const claim = readJson(join(queueDir(E), id, 'claim.json'))
  const restore = readJson(join(queueDir(E), id, 'restore.json'))
  return { ...m, ...(claim ? { claim } : {}), ...(restore ? { restore } : {}) }
}

export function listHandoffs(E, { includeSimulated = E.dev } = {}) {
  return safeList(queueDir(E))
    .filter((f) => !f.endsWith('.partial') && existsSync(join(queueDir(E), f, 'manifest.json')))
    .map((f) => loadManifest(E, f))
    .filter((m) => m && (includeSimulated || !m.simulated))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

function saveManifest(E, manifest) {
  const { claim: _c, restore: _r, ...plain } = manifest
  writeJsonAtomic(join(queueDir(E), manifest.handoff_id, 'manifest.json'), plain)
}

// ---------------------------------------------------------------- receiver side

/**
 * Take the handoff for one receiver. `claim.json` is created exclusively: of
 * two receivers on one filesystem exactly one succeeds. Across machines the
 * brain's git sync turns two different claims into an add/add conflict that
 * brain-sync refuses to auto-merge, so the second claim never silently wins.
 */
export function claim(E, id, receiver) {
  const m = loadManifest(E, id)
  if (!m) return { ok: false, code: 'NOT_FOUND' }
  if (m.kind !== 'quota') return { ok: false, code: 'NOT_RESUMABLE', state: m.state }
  if (m.claim) return m.claim.receiver === receiver ? { ok: true, resumed: true, manifest: m } : { ok: false, code: 'CLAIMED_BY_OTHER', owner: m.claim.receiver }
  if (m.state !== 'READY') return { ok: false, code: 'NOT_READY', state: m.state }
  const record = { receiver, account: E.account, host: E.host, claimed_at: new Date(E.now).toISOString(), nonce: randomBytes(6).toString('hex') }
  if (!createExclusive(join(queueDir(E), id, 'claim.json'), record)) {
    const owner = readJson(join(queueDir(E), id, 'claim.json'))
    return owner?.receiver === receiver ? { ok: true, resumed: true, manifest: loadManifest(E, id) } : { ok: false, code: 'CLAIMED_BY_OTHER', owner: owner?.receiver }
  }
  const fresh = loadManifest(E, id)
  transition(fresh, 'CLAIMED', receiver, E.now)
  saveManifest(E, fresh)
  return { ok: true, resumed: false, manifest: loadManifest(E, id) }
}

/** Administrator release: the claim goes, the handoff returns to READY, the restore log stays as history. */
export function release(E, id, admin) {
  const m = loadManifest(E, id)
  if (!m?.claim) return { ok: false, code: 'NOT_CLAIMED' }
  if (m.state === 'ACTIVE') return { ok: false, code: 'ALREADY_ACTIVE' }
  const dir = join(queueDir(E), id)
  if (m.restore) renameSync(join(dir, 'restore.json'), join(dir, `restore.released-${E.now}.json`))
  rmSync(join(dir, 'claim.json'), { force: true })
  const plain = loadManifest(E, id)
  transition(plain, 'READY', `admin:${admin}`, E.now, `released claim of ${m.claim.receiver}`)
  saveManifest(E, plain)
  return { ok: true }
}

/** The prompt a replacement session starts with: the package itself, not the transcript. */
export function resumePrompt(E, manifest, session) {
  const pkgPath = join(queueDir(E), manifest.handoff_id, session.package)
  const body = existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : '(package missing)'
  return `${resumeMarker(manifest.handoff_id, session.source_session_id)} Package file: ${pkgPath}\n\n${body}`
}

/** First words of every replacement session's prompt; quota-handoff.mjs matches them to confirm the restore. */
export const resumeMarker = (id, source) => `Resume quota handoff ${id}, source session ${source}.`
export const RESUME_MARKER = /Resume quota handoff ([A-Za-z0-9-]+), source session ([A-Za-z0-9_-]+)\./

/**
 * Launchers start one replacement session under the receiver's own login.
 * `terminal` opens a new console running the Claude Code CLI with the resume
 * prompt; `print` only writes the prompt file and reports the command (dry run).
 * A test passes its own function.
 */
export const LAUNCHERS = {
  print: (E, { prompt, cwd, promptFile }) => ({ ok: true, detail: `claude (cwd ${cwd}) with prompt file ${promptFile}` }),
  // In-app: the Claude desktop app exposes no start_session tool, so the
  // resuming session posts one spawn_task chip per source session. The launch is
  // only OFFERED until the new session's hook confirms it (`restored`).
  chips: (E, { cwd, promptFile, session, manifest }) => ({
    ok: true, offered: true, detail: 'spawn_task chip',
    chip: {
      title: (session.settings?.title || `Resume ${session.project ?? session.source_session_id}`).slice(0, 60),
      tldr: `Continues a session handed off from ${manifest.source_machine} when its account ran out of quota.`,
      prompt: `${resumeMarker(manifest.handoff_id, session.source_session_id)} Read ${promptFile} and continue the work it describes.`,
      cwd,
    },
  }),
  terminal: (E, { cwd, promptFile, session, manifest }) => {
    // The prompt travels as a file the new session is told to read; a long
    // prompt never passes through a shell's argument parser.
    const ask = `${resumeMarker(manifest.handoff_id, session.source_session_id)} Read ${promptFile} and continue the work it describes.`
    const env = { ...process.env, ...(E.receiverConfigDir ? { CLAUDE_CONFIG_DIR: E.receiverConfigDir } : {}) }
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"start "Resume handoff" /D "${cwd}" claude "${ask}""`], { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true, env })
      : spawn('x-terminal-emulator', ['-e', 'claude', ask], { cwd, detached: true, stdio: 'ignore', env })
    child.unref()
    return { ok: true, detail: `terminal claude in ${cwd}` }
  },
}

/**
 * Resume Handoff - the receiver's one-click routine.
 *
 * 1. Snapshot this receiver's own active sessions (a `preserve` archive) before touching anything.
 * 2. Pick the named handoff, or the newest READY one not from this account.
 * 3. Claim it atomically.
 * 4. Launch one replacement session per source session, recording each one's
 *    state in `restore.json` so a re-run continues instead of duplicating.
 */
export function resume(E, { id, receiver = `${E.user}@${E.host}`, launcher = 'terminal', retryUncertain = false, hooks = {} } = {}) {
  let target = id ? loadManifest(E, id) : undefined
  if (!id) {
    const mine = listHandoffs(E).find((m) => m.kind === 'quota' && m.claim?.receiver === receiver && m.state !== 'ACTIVE')
    target = mine ?? listHandoffs(E).find((m) => m.kind === 'quota' && m.state === 'READY' && !sameLogin(E, m))
  }
  if (!target) return { ok: false, code: 'NO_READY_HANDOFF' }
  if (target.simulated && !E.dev) return { ok: false, code: 'SIMULATED_REQUIRES_DEV' }
  if (sameLogin(E, target) && !E.dev) return { ok: false, code: 'SAME_ACCOUNT', detail: 'the exhausted account cannot receive its own handoff' }

  const alreadyMine = target.claim?.receiver === receiver
  // The session running the resume (recorded by quota-handoff.mjs) is not work to preserve.
  const self = hooks.currentSessionIds ?? [readJson(join(E.home, 'resumers', `${target.handoff_id}.json`))?.sessionId].filter(Boolean)
  let preserved = null
  if (!alreadyMine) {
    const receiverSessions = activeSessions(E, { exclude: self })
    if (receiverSessions.length) {
      const p = buildHandoff(E, { reason: `Receiver ${receiver} preserved its sessions before resuming ${target.handoff_id}`, kind: 'preserve', reading: null, exclude: self })
      if (p.state !== 'READY') return { ok: false, code: 'RECEIVER_SNAPSHOT_FAILED', error: p.error }
      preserved = { handoff_id: p.handoff_id, sessions: p.session_count }
    }
  }

  const c = claim(E, target.handoff_id, receiver)
  if (!c.ok) return { ok: false, ...c, preserved }
  const dir = join(queueDir(E), target.handoff_id)
  const restorePath = join(dir, 'restore.json')
  const restore = readJson(restorePath) ?? { receiver, sessions: {} }
  const manifest = loadManifest(E, target.handoff_id)
  if (manifest.state === 'CLAIMED') { transition(manifest, 'RESTORING', receiver, E.now); saveManifest(E, manifest) }
  const launch = typeof launcher === 'function' ? launcher : LAUNCHERS[launcher]
  if (!launch) return { ok: false, code: 'UNKNOWN_LAUNCHER' }

  const chips = []
  for (const s of manifest.sessions) {
    const entry = restore.sessions[s.source_session_id] ?? { state: 'PENDING', attempts: 0 }
    if (entry.state === 'RESTORED') continue
    if (entry.state === 'OFFERED' && !retryUncertain) continue
    if (entry.state === 'LAUNCHING' && !retryUncertain) { entry.state = 'UNCERTAIN'; restore.sessions[s.source_session_id] = entry; continue }
    if (entry.state === 'UNCERTAIN' && !retryUncertain) continue
    entry.state = 'LAUNCHING'
    entry.attempts += 1
    entry.at = new Date(E.now).toISOString()
    restore.sessions[s.source_session_id] = entry
    writeJsonAtomic(restorePath, restore)
    hooks.afterMark?.(s)
    const promptFile = join(E.home, 'resume-prompts', `${target.handoff_id}--${s.source_session_id}.md`)
    mkdirSync(dirname(promptFile), { recursive: true })
    const prompt = resumePrompt(E, manifest, s)
    writeFileSync(promptFile, prompt)
    const cwd = s.working_directory && existsSync(s.working_directory) ? s.working_directory : homedir()
    let result
    try { result = launch(E, { prompt, promptFile, cwd, session: s, manifest }) } catch (err) { result = { ok: false, detail: String(err?.message ?? err) } }
    entry.state = result?.ok ? (result.offered ? 'OFFERED' : 'RESTORED') : 'FAILED_RETRYABLE'
    if (result?.chip) { entry.chip = result.chip; chips.push({ source_session_id: s.source_session_id, ...result.chip }) }
    entry.detail = redact(result?.detail ?? '')
    if (cwd !== s.working_directory) entry.note = `source cwd ${s.working_directory ?? 'unknown'} absent here; launched in ${cwd}`
    writeJsonAtomic(restorePath, restore)
  }
  writeJsonAtomic(restorePath, restore)
  const states = Object.fromEntries(manifest.sessions.map((s) => [s.source_session_id, restore.sessions[s.source_session_id]?.state ?? 'PENDING']))
  const done = Object.values(states).every((v) => v === 'RESTORED')
  const final = loadManifest(E, target.handoff_id)
  if (done && final.state === 'RESTORING') { transition(final, 'ACTIVE', receiver, E.now, `${manifest.sessions.length} session(s) launched`); saveManifest(E, final) }
  return { ok: true, handoff_id: target.handoff_id, state: loadManifest(E, target.handoff_id).state, sessions: states, preserved, resumed: c.resumed, ...(chips.length ? { chips } : {}) }
}

/**
 * A replacement session confirms it is running: its hook saw the resume
 * marker in the first prompt. Idempotent; the last confirmation moves the
 * handoff to ACTIVE. Only the claiming account may confirm.
 */
export function markRestored(E, id, source, { sessionId } = {}) {
  const m = loadManifest(E, id)
  if (!m) return { ok: false, code: 'NOT_FOUND' }
  if (!m.claim) return { ok: false, code: 'NOT_CLAIMED' }
  if (m.claim.account !== E.account) return { ok: false, code: 'CLAIMED_BY_OTHER', owner: m.claim.receiver }
  if (!m.sessions.some((s) => s.source_session_id === source)) return { ok: false, code: 'UNKNOWN_SOURCE_SESSION' }
  const restorePath = join(queueDir(E), id, 'restore.json')
  const restore = readJson(restorePath) ?? { receiver: m.claim.receiver, sessions: {} }
  const entry = restore.sessions[source] ?? { attempts: 0 }
  // A second session opened from the same chip does not take over the first one's row.
  if (entry.state === 'RESTORED' && entry.receiver_session_id && entry.receiver_session_id !== sessionId) return { ok: true, already: true, receiver_session_id: entry.receiver_session_id }
  entry.state = 'RESTORED'
  if (sessionId) entry.receiver_session_id = sessionId
  entry.confirmed_at = new Date(E.now).toISOString()
  restore.sessions[source] = entry
  writeJsonAtomic(restorePath, restore)
  const done = m.sessions.every((s) => restore.sessions[s.source_session_id]?.state === 'RESTORED')
  const fresh = loadManifest(E, id)
  if (done && fresh.state === 'RESTORING') { transition(fresh, 'ACTIVE', m.claim.receiver, E.now, `${m.sessions.length} session(s) confirmed running`); saveManifest(E, fresh) }
  return { ok: true, state: loadManifest(E, id).state }
}

/**
 * The settings still to copy onto confirmed replacement sessions: one row per
 * session with the desktop id the session-management tools take. A session
 * cannot change its own model or effort, so the resuming session applies them.
 */
export function settingsPlan(E, id) {
  const m = loadManifest(E, id)
  if (!m) return { ok: false, code: 'NOT_FOUND' }
  const desktop = desktopSessions(E)
  const rows = m.sessions.map((s) => {
    const entry = m.restore?.sessions?.[s.source_session_id] ?? {}
    const d = entry.receiver_session_id ? desktop.get(entry.receiver_session_id) : undefined
    const want = s.settings ?? {}
    const change = {}
    for (const [k, have] of [['title', d?.title], ['model', d?.model], ['effort', d?.effort], ['permission_mode', d?.permission_mode]]) {
      if (want[k] && want[k] !== have) change[k] = want[k]
    }
    return {
      source_session_id: s.source_session_id, state: entry.state ?? 'PENDING',
      receiver_session_id: entry.receiver_session_id ?? null, desktop_session_id: d?.desktop_session_id ?? null,
      applied: Boolean(entry.settings_applied_at), change,
    }
  })
  return { ok: true, handoff_id: id, sessions: rows }
}

/** Record that the resuming session applied one row of the settings plan. */
export function markSettingsApplied(E, id, source) {
  const restorePath = join(queueDir(E), id, 'restore.json')
  const restore = readJson(restorePath)
  const entry = restore?.sessions?.[source]
  if (!entry) return { ok: false, code: 'NOT_FOUND' }
  entry.settings_applied_at = new Date(E.now).toISOString()
  writeJsonAtomic(restorePath, restore)
  return { ok: true }
}

// ---------------------------------------------------------------- status text

const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 10) / 10}%` : 'UNKNOWN')

export function statusText(E) {
  const r = readQuota(E)
  const flag = readJson(exhaustedPath(E))
  const lines = [
    `QUOTA GUARD${r.simulated ? '  [SIMULATED READING - NOT REAL TELEMETRY]' : ''}`,
    '',
    `Account: ${E.account}`,
    `Session: ${pct(r.session_used_percent)}`,
    `Weekly: ${pct(r.weekly_used_percent)}`,
    `Threshold: ${E.threshold}%  Source: ${r.measurement_source} (${r.measurement_confidence})`,
  ]
  if (r.state === 'UNKNOWN') lines.push(`Quota: UNKNOWN - ${r.note ?? 'no reading'}`)
  if (flag) lines.push(`Routing: EXHAUSTED - DSH assigns no new work to this account (${flag.reason})`)
  const own = listHandoffs(E).filter((m) => sameLogin(E, m) && m.kind === 'quota').slice(0, 3)
  for (const m of own) lines.push('', `Handoff ${m.handoff_id}${m.simulated ? ' (SIMULATED)' : ''}`, `${m.session_count ?? m.sessions.length} active sessions archived`, `Status: ${m.state}${m.claim ? ` (claimed by ${m.claim.receiver})` : ''}`)
  for (const m of listHandoffs(E).filter((h) => h.kind === 'quota' && !sameLogin(E, h) && ['READY', 'CLAIMED', 'RESTORING'].includes(h.state))) {
    const offered = Object.values(m.restore?.sessions ?? {}).filter((s) => s.state === 'OFFERED').length
    lines.push('', `INCOMING HANDOFF${m.simulated ? ' (SIMULATED)' : ''}`, '', `Id: ${m.handoff_id}`, `Source: ${m.source_machine} (${m.source_account})`, `Reason: ${m.reason}`, `Sessions: ${m.sessions.length}`, `Status: ${m.state}${offered ? ` (${offered} chip(s) offered, not yet started)` : ''}`, '', '[Resume Handoff]  .sync/RESUME-HANDOFF.cmd, or the resume-handoff skill in the Claude app')
  }
  for (const m of listHandoffs(E).filter((h) => h.kind === 'quota' && h.claim?.account === E.account && h.state === 'ACTIVE').slice(0, 1)) {
    const n = Object.values(m.restore?.sessions ?? {}).filter((s) => s.state === 'RESTORED').length
    lines.push('', 'HANDOFF COMPLETE', '', `Source sessions archived: ${m.sessions.length}`, `Receiver sessions launched: ${n}`, `Status: ${m.state}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- cli

function flags(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true)
    } else out._.push(a)
  }
  return out
}

const USAGE = `quota-guard - Automatic Quota Handoff
  quota status                       quota reading (QuotaProvider fields)
  status                             QUOTA GUARD / INCOMING HANDOFF view
  check                              one guard pass (hook runs this); creates at most one handoff per event
  prepare [--reason text]            build a handoff now, whatever the quota
  simulate --session N --weekly N    (QUOTA_GUARD_DEV=1) inject a reading, then run check
  simulate --clear                   remove the simulated reading
  list                               handoffs, newest first
  inspect <id>                       manifest, claim and restore state
  resume [id] [--receiver name] [--launcher terminal|print|chips] [--retry-uncertain]
  restored <id> <source-session> [--session id]   a replacement session confirms it runs
  settings <id>                      title/model/effort/permission still to apply per session
  applied <id> <source-session>      record one settings row as applied
  desktop                            this login's desktop session records
  release <id> --admin name          administrator releases a claim`

export async function cli(argv, E = env()) {
  const f = flags(argv)
  const [cmd, sub] = f._
  const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  switch (cmd) {
    case 'quota': return print(readQuota(E))
    case 'status': return print(statusText(E))
    case 'check': return print(check(E))
    case 'prepare': return print(buildHandoff(E, { reason: f.reason ?? 'Manual prepare', reading: readQuota(E) }))
    case 'simulate':
      if (f.clear) { clearSimulation(E); return print('simulation cleared') }
      simulate(E, { session: f.session === undefined ? null : Number(f.session), weekly: f.weekly === undefined ? null : Number(f.weekly) })
      return print(check(E))
    case 'list': return print(listHandoffs(E).map((m) => ({ id: m.handoff_id, kind: m.kind, state: m.state, simulated: m.simulated, source: m.source_account, sessions: m.sessions.length, claim: m.claim?.receiver ?? null, created_at: m.created_at })))
    case 'inspect': return print(loadManifest(E, sub) ?? { error: 'NOT_FOUND' })
    case 'resume': {
      if (f['receiver-config-dir']) E.receiverConfigDir = E.configDir = f['receiver-config-dir']
      const result = resume(E, { id: sub, receiver: f.receiver ?? `${E.user}@${E.host}`, launcher: f.launcher ?? 'terminal', retryUncertain: Boolean(f['retry-uncertain']) })
      print(result)
      if (result.ok) print(statusText(E))
      return result
    }
    case 'release': return print(release(E, sub, f.admin ?? 'unknown'))
    case 'restored': return print(markRestored(E, sub, f._[2], { sessionId: f.session }))
    case 'settings': return print(settingsPlan(E, sub))
    case 'applied': return print(markSettingsApplied(E, sub, f._[2]))
    case 'desktop': return print([...desktopSessions(E)].map(([cli, d]) => ({ cli_session_id: cli, ...d })))
    default: return print(USAGE)
  }
}

const direct = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (direct) {
  const argv = process.argv.slice(2)
  // `quota status` reads as one command.
  const result = await cli(argv[0] === 'quota' && argv[1] === 'status' ? ['quota'] : argv[0] === 'handoff' ? argv.slice(1) : argv)
  if (result && result.ok === false) process.exitCode = 1
}
