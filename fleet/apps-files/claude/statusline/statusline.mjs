#!/usr/bin/env node
/**
 * Claude Code status line: quota, and what is driving it.
 *
 * Shows the same figures as the usage menu without opening it, plus the two
 * levers that actually change consumption — how much of your usage sits above
 * a large context, and how much comes from marathon sessions. Those are the
 * difference between a cheap query and an expensive one, and they are invisible
 * in a plain percentage.
 *
 * Renders from cache and never blocks. The cache is refreshed behind the line
 * when it goes stale, because reading the real figures costs a subprocess and
 * a status line redraws constantly.
 */

import { spawn } from 'node:child_process'
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HERE = join(homedir(), '.claude', 'statusline')
const CACHE = join(HERE, 'usage-cache.json')
/** Past this age the figures are refreshed behind the line. */
const STALE_MS = 5 * 60 * 1000
/** Past this age they stop being shown as current. */
const ANCIENT_MS = 60 * 60 * 1000
/** Last background refresh attempt; a failing refresh must not respawn on every redraw. */
const ATTEMPT = join(HERE, '.refresh-attempt')
/** Minimum gap between background refresh attempts. */
const ATTEMPT_GAP_MS = 2 * 60 * 1000
/** Zone the reset stamps are written in, matching usage-cache.mjs. */
const ZONE = 'America/Los_Angeles'

const RESET = '[0m'
const DIM = '[2m'
const BOLD = '[1m'
const GREEN = '[32m'
const YELLOW = '[33m'
const RED = '[31m'
const CYAN = '[36m'

/**
 * Colour a percentage by how close it is to the limit.
 * @param {number} percent - usage percentage.
 * @returns {string} the ANSI colour to use.
 */
function severity(percent) {
  if (percent >= 90) return RED
  if (percent >= 70) return YELLOW
  return GREEN
}

/**
 * A short bar, so the number is readable at a glance rather than parsed.
 * @param {number} percent - usage percentage.
 * @returns {string} the bar.
 */
function bar(percent) {
  const width = 8
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/**
 * Turn a reset stamp into time remaining, which is what you actually want.
 *
 * Falls back to the raw text when the stamp cannot be read: a wrong countdown
 * would be worse than the words the CLI printed.
 * @param {string | undefined} stamp - e.g. "Sep 2, 4:50am".
 * @returns {string} a short "in 3h 12m", or the stamp.
 */
function untilReset(stamp) {
  if (!stamp) return ''
  const match = /([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(stamp)
  if (!match) return stamp
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
  const month = months[match[1].toLowerCase()]
  if (month === undefined) return stamp
  let hour = Number(match[3]) % 12
  if (match[5].toLowerCase() === 'pm') hour += 12
  const now = new Date()
  const minute = match[4] === undefined ? 0 : Number(match[4])
  let target = new Date(now.getFullYear(), month, Number(match[2]), hour, minute)
  // A stamp only weeks old is stale cache, not a date eleven months away.
  // Rolling it to next year turned a two-hour session window into "363d 16h".
  const elapsedMs = now.getTime() - target.getTime()
  if (elapsedMs > 0) {
    if (elapsedMs < 30 * 24 * 60 * 60 * 1000) return 'stale'
    target = new Date(now.getFullYear() + 1, month, Number(match[2]), hour, minute)
  }
  const minutes = Math.round((target.getTime() - now.getTime()) / 60000)
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Kick a refresh off behind the line, detached so nothing waits on it. */
function refreshInBackground() {
  try {
    // Every redraw of a stale line used to spawn a refresh; with the refresh
    // failing, that hammered the usage endpoint into a standing 429.
    if (existsSync(ATTEMPT) && Date.now() - statSync(ATTEMPT).mtimeMs < ATTEMPT_GAP_MS) return
    writeFileSync(ATTEMPT, String(Date.now()))
    const child = spawn(process.execPath, [join(HERE, 'usage-cache.mjs')], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
  } catch {
    // A failed refresh is not worth a broken status line.
  }
}

/** @returns {string | undefined} epoch seconds as `/usage` printed them, e.g. `Sep 15, 12:59am`. */
function stamp(seconds) {
  if (!Number.isFinite(seconds)) return undefined
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(seconds * 1000).replace(/\s*(AM|PM)$/, (_, p) => p.toLowerCase())
}

/**
 * Store the quota Claude Code hands the status line on stdin (`rate_limits`).
 * Free and current: no subprocess, no network. Keeps the cached request
 * counts and spend levers, which only `/usage` text ever carried.
 * @param {object} input - the stdin payload.
 * @returns {boolean} whether stdin carried quota.
 */
function storeRateLimits(input) {
  const session = input?.rate_limits?.five_hour
  const week = input?.rate_limits?.seven_day
  if (typeof session?.used_percentage !== 'number' && typeof week?.used_percentage !== 'number') return false
  let old = {}
  try { old = JSON.parse(readFileSync(CACHE, 'utf8')) } catch {}
  const next = { ...old, capturedAt: Date.now(), zone: ZONE, source: 'statusline' }
  for (const key of ['sessionPercent', 'sessionResets', 'weekPercent', 'weekResets']) delete next[key]
  if (typeof session?.used_percentage === 'number') {
    next.sessionPercent = Math.round(session.used_percentage)
    next.sessionResets = stamp(session.resets_at)
  }
  if (typeof week?.used_percentage === 'number') {
    next.weekPercent = Math.round(week.used_percentage)
    next.weekResets = stamp(week.resets_at)
  }
  const same = ['sessionPercent', 'sessionResets', 'weekPercent', 'weekResets'].every(key => next[key] === old[key])
  // Redraws are constant; rewrite only on change or once a minute so the age stays honest.
  if (same && Date.now() - (old.capturedAt ?? 0) < 60_000) return true
  try {
    mkdirSync(HERE, { recursive: true })
    writeFileSync(CACHE, JSON.stringify(next, null, 2))
  } catch {
    // A read-only cache is not worth a broken status line.
  }
  return true
}

/**
 * Read the cached figures, refreshing behind the line when stale.
 * @returns {{ data: object | undefined, ageMs: number }} figures and their age.
 */
function readCache() {
  if (!existsSync(CACHE)) {
    refreshInBackground()
    return { data: undefined, ageMs: Infinity }
  }
  let data
  try {
    data = JSON.parse(readFileSync(CACHE, 'utf8'))
  } catch {
    refreshInBackground()
    return { data: undefined, ageMs: Infinity }
  }
  const ageMs = Date.now() - (statSync(CACHE).mtimeMs || 0)
  if (ageMs > STALE_MS) refreshInBackground()
  return { data, ageMs }
}

/**
 * Build the status line.
 * @param {object} input - the payload Claude Code supplies on stdin.
 * @returns {string} the rendered line.
 */
function render(input) {
  storeRateLimits(input)
  const { data, ageMs } = readCache()
  const parts = []

  const model = input?.model?.display_name ?? input?.model?.id
  if (model) parts.push(`${DIM}${model}${RESET}`)

  if (!data) {
    parts.push(`${DIM}usage: reading…${RESET}`)
    return parts.join(` ${DIM}·${RESET} `)
  }

  if (typeof data.sessionPercent === 'number') {
    const colour = severity(data.sessionPercent)
    const left = untilReset(data.sessionResets)
    parts.push(`${colour}${bar(data.sessionPercent)} ${BOLD}${data.sessionPercent}%${RESET}${colour} session${RESET}${left ? ` ${DIM}(${left})${RESET}` : ''}`)
  }

  if (typeof data.weekPercent === 'number') {
    const colour = severity(data.weekPercent)
    const left = untilReset(data.weekResets)
    parts.push(`${colour}${data.weekPercent}% week${RESET}${left ? ` ${DIM}(${left})${RESET}` : ''}`)
  }

  // The efficiency lever. Large-context turns are what burn a session
  // allowance fastest, so it earns a place beside the percentages.
  if (typeof data.bigContextPercent === 'number' && data.bigContextPercent >= 50) {
    const colour = data.bigContextPercent >= 90 ? YELLOW : DIM
    parts.push(`${colour}${data.bigContextPercent}% >${data.bigContextThresholdK ?? 150}k ctx${RESET}`)
  }

  if (typeof data.requests24h === 'number') {
    parts.push(`${DIM}${data.requests24h} req/24h${RESET}`)
  }

  if (ageMs > ANCIENT_MS) {
    parts.push(`${DIM}(figures ${Math.round(ageMs / 60000)}m old)${RESET}`)
  }

  return parts.join(` ${DIM}·${RESET} `)
}

/** Read the JSON payload Claude Code writes to stdin, tolerating none. */
async function readInput() {
  if (process.stdin.isTTY) return {}
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return {}
  }
}

process.stdout.write(render(await readInput()))
