#!/usr/bin/env node
// Blitz capacity and quota poller (BLITZ-04, Q4).
//
// Runs on each machine, reads what that machine already knows about its quotas
// and its local model, and reports one snapshot to pm. It makes no live
// provider call: Claude comes from the status line's usage cache, Codex,
// Antigravity and AWS from the last readings the DSH quota plugins published
// into ~/.dsh/settings.yaml, the local model from its own /health endpoint.
// A value nobody measured stays null - a guessed number would silently decide
// routing.
//
//   node pm/blitz/capacity.mjs [--once] [--watch SECONDS] [--post] [--slots N] [--machine NAME] [--no-llama]
import { existsSync, readFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PmError } from '../store.mjs'
import { sameMachine } from '../actions.mjs'
import { knownMachines } from './agents.mjs'

export const STALE_SOURCE_MS = 30 * 60_000
export const DEFAULT_INTERVAL_MS = 60_000
const ENDED_RUNS = new Set(['done', 'failed', 'cancelled'])
const MAX_SNAPSHOT_BYTES = 64 * 1024

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
const pctLeft = (used) => (Number.isFinite(used) && used >= 0 ? Math.max(0, 100 - used) : null)
const minOrNull = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x))
  return v.length ? Math.min(...v) : null
}

/** Claude: the status line's cache plus the quota guard's exhausted marker. */
export function readClaude({
  usageFile = join(homedir(), '.claude', 'statusline', 'usage-cache.json'),
  exhaustedFile = join(homedir(), '.claude', 'quota-guard', 'exhausted.json'),
  now = Date.now(),
  maxAgeMs = STALE_SOURCE_MS,
} = {}) {
  const out = { source: 'usage-cache', asOf: null, sessionPercent: null, weekPercent: null, sessionResets: null, weekResets: null, headroomPercent: null, stale: true, exhausted: false, error: null }
  try {
    if (!existsSync(usageFile)) out.error = 'usage cache missing'
    else {
      const u = readJson(usageFile)
      out.asOf = Number.isFinite(u.capturedAt) ? u.capturedAt : null
      out.sessionPercent = Number.isFinite(u.sessionPercent) ? u.sessionPercent : null
      out.weekPercent = Number.isFinite(u.weekPercent) ? u.weekPercent : null
      out.sessionResets = u.sessionResets ?? null
      out.weekResets = u.weekResets ?? null
      out.stale = out.asOf === null || now - out.asOf > maxAgeMs
      out.headroomPercent = out.stale ? null : minOrNull([pctLeft(out.sessionPercent), pctLeft(out.weekPercent)])
    }
  } catch (err) {
    out.error = `usage cache unreadable: ${err.message}`
  }
  try {
    if (existsSync(exhaustedFile)) {
      out.exhausted = true
      out.exhaustedDetail = readJson(exhaustedFile)
      out.headroomPercent = 0
    }
  } catch (err) {
    out.exhausted = true
    out.exhaustedDetail = { error: `exhausted marker unreadable: ${err.message}` }
    out.headroomPercent = 0
  }
  return out
}

function scalar(raw) {
  const v = raw.trim()
  if (v === '') return null
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  if (v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v) } catch { return v.slice(1, -1) }
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (v === 'true' || v === 'false') return v === 'true'
  return v
}

/**
 * The flat key: value pairs of one top-level section of a YAML file. Enough
 * for the quota sections DSH writes (scalars and folded quoted JSON strings);
 * pm stays dependency-free, so this is not a YAML parser.
 */
export function yamlSection(text, key) {
  const lines = text.split(/\r?\n/)
  const start = lines.indexOf(`${key}:`)
  if (start < 0) return null
  const raw = {}
  let cur = null
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^\S/.test(l)) break
    const m = /^ {2}([\w-]+):(?: (.*))?$/.exec(l)
    if (m) { cur = m[1]; raw[cur] = m[2] ?? ''; continue }
    if (cur && /^ {4,}\S/.test(l)) raw[cur] += ' ' + l.trim()
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, scalar(v)]))
}

function parseJsonField(v) {
  if (v === null || v === undefined) return null
  try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null }
}

const reading = (sec, now, maxAgeMs) => {
  const asOf = Number.isFinite(sec?.capturedAt) ? sec.capturedAt : null
  return { state: sec?.refreshState ?? null, asOf, stale: asOf === null || now - asOf > maxAgeMs }
}

/** Codex, Antigravity and AWS: the last readings the DSH quota plugins published. */
export function readDshQuotas({ settingsFile = join(homedir(), '.dsh', 'settings.yaml'), now = Date.now(), maxAgeMs = STALE_SOURCE_MS } = {}) {
  const none = (error) => ({ codex: { error }, antigravity: { error }, aws: { error } })
  let text
  try {
    if (!existsSync(settingsFile)) return none('DSH settings missing')
    text = readFileSync(settingsFile, 'utf8')
  } catch (err) {
    return none(`DSH settings unreadable: ${err.message}`)
  }

  const codexSec = yamlSection(text, 'codex-quota')
  const codex = codexSec ? (() => {
    const r = reading(codexSec, now, maxAgeMs)
    const buckets = parseJsonField(codexSec.bucketsJson) ?? []
    const left = buckets.flatMap((b) => [b?.primary?.remaining, b?.secondary?.remaining])
    return { ...r, buckets, headroomPercent: r.stale ? null : minOrNull(left) }
  })() : { error: 'no codex-quota section' }

  const agySec = yamlSection(text, 'antigravity-quota')
  const antigravity = agySec ? (() => {
    const r = reading(agySec, now, maxAgeMs)
    const buckets = parseJsonField(agySec.bucketsJson) ?? []
    const seats = parseJsonField(agySec.seatsJson)
    return {
      ...r,
      buckets,
      seats: Array.isArray(seats) ? seats.length : null,
      headroomPercent: r.stale ? null : minOrNull(buckets.map((b) => b?.remaining)),
    }
  })() : { error: 'no antigravity-quota section' }

  const awsSec = yamlSection(text, 'aws-quota')
  const aws = awsSec ? (() => {
    const r = reading(awsSec, now, maxAgeMs)
    const accounts = parseJsonField(awsSec.accountsJson) ?? []
    const seat = parseJsonField(awsSec.seatJson)
    return { ...r, accounts: accounts.length, health: seat?.health ?? null, headroomPercent: null }
  })() : { error: 'no aws-quota section' }

  return { codex, antigravity, aws }
}

/** The local model server: up or not, and which model. Never a throughput guess. */
export async function probeLlama({ url = process.env.BLITZ_LLAMA_URL || 'http://127.0.0.1:8090', timeoutMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  const get = async (path) => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetchImpl(`${url}${path}`, { signal: ctl.signal })
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
    } finally {
      clearTimeout(t)
    }
  }
  try {
    const h = await get('/health')
    if (!h.ok) return { url, up: false, status: h.status, model: null, tokensPerSecond: null }
    let model = null
    try {
      const m = await get('/v1/models')
      model = m.body?.data?.[0]?.id ?? null
    } catch { /* model name is optional */ }
    return { url, up: true, status: h.status, model, tokensPerSecond: null }
  } catch (err) {
    return { url, up: false, error: err.name === 'AbortError' ? 'timeout' : String(err.message ?? err), model: null, tokensPerSecond: null }
  }
}

/** One machine's snapshot, ready to report. */
export async function buildSnapshot({
  machine = process.env.PM_MACHINE || hostname(),
  slots = Number(process.env.BLITZ_SLOTS) || null,
  llama = true,
  now = Date.now(),
  intervalMs = DEFAULT_INTERVAL_MS,
  claude = {},
  dsh = {},
  llamaOpts = {},
} = {}) {
  const q = readDshQuotas({ now, ...dsh })
  return {
    machine,
    taken_at: new Date(now).toISOString(),
    interval_ms: intervalMs,
    slots: { max: Number.isInteger(slots) && slots > 0 ? slots : null },
    quota: { claude: readClaude({ now, ...claude }), codex: q.codex, antigravity: q.antigravity, aws: q.aws },
    local: llama ? await probeLlama(llamaOpts) : null,
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blitz_capacity (
  machine TEXT PRIMARY KEY, snapshot TEXT NOT NULL, reported_at TEXT NOT NULL, reported_by TEXT NOT NULL);
`

export function migrate(db) {
  db.exec(SCHEMA)
}

/** pm side: hold the latest snapshot per machine and serve them with live slot use. */
export function createCapacityStore(db, { store = null, clock = () => new Date(), machines } = {}) {
  migrate(db)
  return {
    report(w, body = {}) {
      if (!w?.actor) throw new PmError(400, 'actor is required (x-pm-actor)')
      const known = machines ?? knownMachines()
      if (!known.has(body.machine)) throw new PmError(400, `machine must be one of ${[...known].join(', ')}`)
      if (!body.quota || typeof body.quota !== 'object') throw new PmError(400, 'quota is required')
      const json = JSON.stringify(body)
      if (json.length > MAX_SNAPSHOT_BYTES) throw new PmError(413, 'snapshot too large')
      const at = clock().toISOString()
      db.prepare(`INSERT INTO blitz_capacity (machine, snapshot, reported_at, reported_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(machine) DO UPDATE SET snapshot = excluded.snapshot, reported_at = excluded.reported_at, reported_by = excluded.reported_by`)
        .run(body.machine, json, at, w.actor)
      return { machine: body.machine, reported_at: at }
    },

    list() {
      const now = clock().getTime()
      const runs = store?.listRuns ? store.listRuns({ limit: 2000 }).filter((r) => !ENDED_RUNS.has(r.state)) : null
      return db.prepare('SELECT * FROM blitz_capacity ORDER BY machine').all().map((r) => {
        const snap = JSON.parse(r.snapshot)
        const interval = Number(snap.interval_ms) > 0 ? Number(snap.interval_ms) : DEFAULT_INTERVAL_MS
        const used = runs ? runs.filter((x) => sameMachine(x.machine, r.machine)).length : null
        return {
          ...snap,
          slots: { max: snap.slots?.max ?? null, used, free: snap.slots?.max != null && used != null ? Math.max(0, snap.slots.max - used) : null },
          reported_at: r.reported_at,
          reported_by: r.reported_by,
          stale: now - Date.parse(r.reported_at) > 2 * interval,
        }
      })
    },
  }
}

function loadRemoteEnv() {
  const file = join(homedir(), '.claude', 'pm-remote.env')
  if (process.env.PM_URL || !existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^(PM_URL|PM_TOKEN)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const watch = Number(arg('--watch')) || 0
  const opts = {
    machine: arg('--machine') || undefined,
    slots: arg('--slots') ? Number(arg('--slots')) : undefined,
    llama: !argv.includes('--no-llama'),
    intervalMs: watch ? watch * 1000 : DEFAULT_INTERVAL_MS,
  }
  const post = argv.includes('--post')
  if (post) loadRemoteEnv()
  const once = async () => {
    const snap = await buildSnapshot(Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)))
    if (!post) return console.log(JSON.stringify(snap, null, 2))
    const base = process.env.PM_URL || 'http://127.0.0.1:4480'
    const res = await fetch(`${base}/api/blitz/capacity/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pm-actor': `blitz-capacity@${snap.machine}`,
        ...process.env.PM_TOKEN ? { authorization: `Bearer ${process.env.PM_TOKEN}` } : {},
      },
      body: JSON.stringify(snap),
    })
    console.log(res.status, await res.text())
    if (!res.ok) process.exitCode = 1
  }
  await once()
  if (watch) setInterval(() => once().catch((err) => console.error(err)), watch * 1000)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err); process.exit(1) })
}
