#!/usr/bin/env node
/**
 * Refresh the cached Claude Code usage figures.
 *
 * `/usage` is the only source of the real numbers: session and weekly
 * percentages come from the server, and nothing on disk carries them — the
 * session logs record tokens spent, never the allowance they were spent
 * against. So this shells out to the CLI, which answers the slash command
 * locally without an assistant turn.
 *
 * It is cached because that call takes seconds and a status line renders
 * constantly. Rendering never blocks on this; the line shows the last known
 * figures and this runs behind it.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

/** Where the parsed figures live, read by the status line. */
export const CACHE_PATH = join(homedir(), '.claude', 'statusline', 'usage-cache.json')

/**
 * The Claude Code binary.
 *
 * npm puts `claude`, `claude.cmd` and `claude.ps1` on PATH but the real
 * executable lives inside the package. Node refuses to spawn a `.cmd` without
 * a shell (CVE-2024-27980), so the binary is what we want.
 */
function claudeBinary() {
  const candidates = [
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    join(homedir(), '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude'),
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return process.platform === 'win32' ? 'claude.exe' : 'claude'
}

/**
 * Parse the human-readable `/usage` output into figures.
 *
 * Deliberately tolerant: this is prose meant for a person, not a contract, so
 * every field is optional and a wording change costs one field rather than the
 * whole line.
 * @param {string} text - raw `/usage` output.
 * @returns {object} the figures that could be read.
 */
export function parseUsage(text) {
  const out = { capturedAt: Date.now() }

  const session = /Current session:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\n(]+))?/i.exec(text)
  if (session) {
    out.sessionPercent = Number(session[1])
    if (session[2]) out.sessionResets = session[2].trim()
  }

  const week = /Current week[^:]*:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\n(]+))?/i.exec(text)
  if (week) {
    out.weekPercent = Number(week[1])
    if (week[2]) out.weekResets = week[2].trim()
  }

  const day = /Last 24h\s*·\s*(\d+)\s*requests\s*·\s*(\d+)\s*sessions/i.exec(text)
  if (day) {
    out.requests24h = Number(day[1])
    out.sessions24h = Number(day[2])
  }

  const week7 = /Last 7d\s*·\s*(\d+)\s*requests\s*·\s*(\d+)\s*sessions/i.exec(text)
  if (week7) {
    out.requests7d = Number(week7[1])
    out.sessions7d = Number(week7[2])
  }

  // The efficiency levers: what characterised the usage, not what it cost.
  const bigContext = /(\d+)%\s*of your usage was at >\s*(\d+)k context/i.exec(text)
  if (bigContext) {
    out.bigContextPercent = Number(bigContext[1])
    out.bigContextThresholdK = Number(bigContext[2])
  }
  const longSessions = /(\d+)%\s*of your usage came from sessions active for (\d+)\+\s*hours/i.exec(text)
  if (longSessions) {
    out.longSessionPercent = Number(longSessions[1])
    out.longSessionHours = Number(longSessions[2])
  }

  return out
}

/**
 * Run `/usage` and return its raw output.
 *
 * Callers that want more than the cached fields parse this text themselves;
 * the parser here keeps only what a status line has room for.
 * @returns {Promise<string>} raw `/usage` output, empty if the call failed.
 */
export async function readUsageText() {
  return new Promise((resolve) => {
    let stdout = ''
    let child
    try {
      child = spawn(claudeBinary(), ['-p', '/usage'], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      resolve('')
      return
    }
    // A refresh that hangs must not hold a process open behind the status line.
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(stdout) }, 90_000)
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.on('error', () => { clearTimeout(timer); resolve('') })
    child.on('close', () => { clearTimeout(timer); resolve(stdout) })
  })
}

/** Zone the reset stamps are written in, matching what `/usage` printed. */
const ZONE = 'America/Los_Angeles'

/** How long the request counts and spend levers stay worth a `/usage` turn. */
const LEVERS_TTL_MS = 6 * 60 * 60 * 1000

/** @returns {string} an ISO instant as `/usage` printed it, e.g. `Sep 15, 12:59am`. */
function stamp(iso) {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return undefined
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(at).replace(/\s*(AM|PM)$/, (_, p) => p.toLowerCase())
}

/**
 * Read session and weekly quota from the endpoint the CLI's own usage menu calls.
 *
 * `claude -p /usage` stopped printing quota around 2026-09-14 (it now prints
 * the cost summary), so the text route returns nothing. The OAuth token is
 * read from the CLI's credential file and sent only to api.anthropic.com.
 * @returns {Promise<object>} parseUsage-shaped figures, or `{ failed, reason }`.
 */
export async function readUsageApi() {
  let token
  try {
    token = JSON.parse(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth.accessToken
  } catch { return { failed: true, reason: 'no Claude Code credentials' } }
  let res
  try {
    res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) { return { failed: true, reason: error.message } }
  if (!res.ok) return { failed: true, reason: `HTTP ${res.status}${res.headers.get('retry-after') ? `, retry after ${res.headers.get('retry-after')}s` : ''}` }
  const body = await res.json().catch(() => ({}))
  const out = { capturedAt: Date.now(), zone: ZONE }
  const pct = value => Math.round(Number(value))
  if (body.five_hour && body.five_hour.utilization != null) {
    out.sessionPercent = pct(body.five_hour.utilization)
    out.sessionResets = stamp(body.five_hour.resets_at)
  }
  if (body.seven_day && body.seven_day.utilization != null) {
    out.weekPercent = pct(body.seven_day.utilization)
    out.weekResets = stamp(body.seven_day.resets_at)
  }
  if (out.sessionPercent === undefined && out.weekPercent === undefined) return { failed: true, reason: 'no quota in response' }
  return out
}

/** @returns {object} the cached figures, or an empty object. */
function readCache() {
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) } catch { return {} }
}

/**
 * Live quota figures.
 *
 * The endpoint comes first: free, sub-second and always current, where a
 * `/usage` turn costs a CLI spawn and goes stale between refreshes. The text
 * is spawned only for the request counts and spend levers it alone carries,
 * and only once those are {@link LEVERS_TTL_MS} old.
 * @returns {Promise<{ figures: object, text: string }>} figures may be `{ failed, reason }`.
 */
export async function readLive() {
  const cached = readCache()
  const api = await readUsageApi()
  const { capturedAt, sessionPercent, sessionResets, weekPercent, weekResets, zone, ...levers } = cached
  if (!api.failed && Date.now() - (cached.leversAt ?? 0) < LEVERS_TTL_MS) {
    return { figures: { ...levers, ...api }, text: '' }
  }
  const text = await readUsageText()
  const parsed = parseUsage(text)
  if (parsed.sessionPercent !== undefined || parsed.weekPercent !== undefined) {
    // Prefer the endpoint's percentages even here: the text is a snapshot of
    // when the CLI answered, which can be a minute old by the time it exits.
    const fresher = api.failed ? {} : api
    return { figures: { ...parsed, leversAt: parsed.requests24h === undefined ? cached.leversAt : Date.now(), ...fresher }, text }
  }
  if (api.failed) return { figures: api, text }
  return { figures: { ...levers, ...api }, text }
}

/**
 * Read live figures and write them to the cache.
 * @returns {Promise<object>} the figures written.
 */
export async function refresh() {
  const { figures: parsed } = await readLive()
  // Never overwrite good figures with an empty read: a failed refresh should
  // leave the last known numbers in place, marked stale by their timestamp.
  if (parsed.sessionPercent === undefined && parsed.weekPercent === undefined) {
    return { ...parsed, failed: true }
  }
  mkdirSync(dirname(CACHE_PATH), { recursive: true })
  writeFileSync(CACHE_PATH, JSON.stringify(parsed, null, 2))
  return parsed
}

// Run directly: refresh once and report.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const result = await refresh()
  console.log(JSON.stringify(result, null, 2))
}
