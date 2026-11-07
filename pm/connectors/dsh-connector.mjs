#!/usr/bin/env node
// pm Phase 3: DSH council/swarm connector.
//
// Mirrors real DSH council runs (packages/council/tool-council output, written to
// ~/.dsh/council-runs/<id>.json) into pm as tasks with the request, the published
// plan, the seat reviews, and the terminal state, plus an artifact link back to the
// source run file. Idempotent: re-syncing the same run id updates the existing task
// instead of duplicating it.
//
// This is read-only against DSH and additive-only against pm: it never authorizes,
// dispatches, or cancels anything, and it never changes DSH state. Per the pm plan's
// "Council + swarm integration" section, the central pm service owns tasks/decisions/
// history and DSH orchestration itself is not duplicated here - this only publishes
// what already happened so it is visible and searchable in pm alongside every other
// open task.
//
// Usage:
//   node dsh-connector.mjs sync <run-id-or-path>   sync one run (by id, filename, or path)
//   node dsh-connector.mjs sync-all                sync every run under the runs dir
//   node dsh-connector.mjs sync-recent [n]          sync the n most recently modified runs (default 5)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { call } from '../cli.mjs'

const RUNS_DIR = process.env.DSH_COUNCIL_RUNS_DIR || 'C:\\Users\\ndi2\\.dsh\\council-runs'
const PROJECT = process.env.PM_DSH_PROJECT || 'dsh-council-runs'
const WHO = { actor: 'Claude Sonnet 5', model: 'claude-sonnet-5' }

function loadRun(idOrPath) {
  let p = idOrPath
  if (!existsSync(p)) {
    const candidate = /\.json$/.test(idOrPath) ? idOrPath : `${idOrPath}.json`
    p = join(RUNS_DIR, candidate)
  }
  const run = JSON.parse(readFileSync(p, 'utf8'))
  return { path: resolve(p), run }
}

function statusFor(terminalState) {
  // pm STATUSES: todo | in_progress | review | blocked | uncertain | done
  if (terminalState === 'completed') return 'review' // council finished; a human/reviewer still accepts it Done
  if (terminalState === 'partial') return 'blocked'
  if (terminalState === 'cancelled') return 'blocked'
  return 'in_progress' // still running, or schema predates terminalState
}

function titleFor(run) {
  const q = (run.query || '(no query text)').replace(/\s+/g, ' ').trim()
  const head = q.split('\n')[0]
  return `DSH council ${run.id.slice(0, 8)}: ${head.slice(0, 90)}${head.length > 90 ? '\u2026' : ''}`
}

async function ensureProject() {
  const projects = await call('GET', '/api/projects')
  const found = projects.find((p) => p.name === PROJECT)
  if (found) return found
  return call('POST', '/api/projects', {
    name: PROJECT,
    description: 'Real DSH council runs mirrored by the Phase-3 connector (pm/connectors/dsh-connector.mjs). Read-only against DSH; pm only records what already happened.',
  }, WHO)
}

async function findExisting(run) {
  const tasks = await call('GET', `/api/tasks?${new URLSearchParams({ project: PROJECT, q: run.id }).toString()}`)
  return tasks.find((t) => t.body?.includes(`dsh-run:${run.id}`)) || null
}

function bodyFor(path, run) {
  return [
    `dsh-run:${run.id}`,
    `source: ${path}`,
    `at: ${run.at ? new Date(run.at).toISOString() : 'unknown'}`,
    `seats: ${(run.seatIds || []).join(', ') || 'unknown'}`,
    `terminalState: ${run.terminalState ?? 'unknown'}`,
    `schemaVersion: ${run.schemaVersion ?? 'unknown'}`,
    '',
    '--- query ---',
    run.query || '(none)',
    '',
    '--- plan ---',
    run.plan || '(no plan recorded)',
  ].join('\n')
}

export async function syncRun(idOrPath) {
  const { path, run } = loadRun(idOrPath)
  await ensureProject()
  const existing = await findExisting(run)
  const status = statusFor(run.terminalState)
  const body = bodyFor(path, run)

  let task
  if (existing) {
    task = await call('PATCH', `/api/tasks/${encodeURIComponent(existing.id)}`, { rev: existing.rev, status, body }, WHO)
    await call('POST', `/api/tasks/${encodeURIComponent(existing.id)}/comments`, {
      body: `Re-synced from ${path} (terminalState=${run.terminalState ?? 'unknown'}).`,
    }, WHO)
  } else {
    task = await call('POST', '/api/tasks', { project: PROJECT, title: titleFor(run), body, status, priority: 2 }, WHO)
    await call('POST', `/api/tasks/${encodeURIComponent(task.id)}/artifacts`, { kind: 'run', ref: run.id, note: path }, WHO)
  }

  if (Array.isArray(run.reviews) && run.reviews.length) {
    const tally = {}
    for (const r of run.reviews) tally[r.vote] = (tally[r.vote] || 0) + 1
    const summary = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v}:${c}`).join(', ')
    const quorumMet = run.quorumConfig?.minReviews != null ? run.reviews.length >= run.quorumConfig.minReviews : null
    await call('POST', `/api/tasks/${encodeURIComponent(task.id)}/comments`, {
      body: `Council review: ${run.reviews.length} review(s), votes [${summary}]${quorumMet === null ? '' : quorumMet ? ', quorum met' : ', quorum NOT met'}.`,
    }, WHO)
  }

  return task
}

export async function syncAll() {
  const files = readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json'))
  const results = []
  for (const f of files) {
    try { results.push(await syncRun(join(RUNS_DIR, f))) }
    catch (err) { results.push({ file: f, error: err.message }) }
  }
  return results
}

export async function syncRecent(n = 5) {
  const files = readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, mtime: statSync(join(RUNS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, n)
    .map((x) => x.f)
  const results = []
  for (const f of files) {
    try { results.push(await syncRun(join(RUNS_DIR, f))) }
    catch (err) { results.push({ file: f, error: err.message }) }
  }
  return results
}

async function main(argv) {
  const [cmd, arg] = argv
  if (cmd === 'sync' && arg) { console.log(JSON.stringify(await syncRun(arg), null, 2)); return }
  if (cmd === 'sync-all') { console.log(JSON.stringify(await syncAll(), null, 2)); return }
  if (cmd === 'sync-recent') { console.log(JSON.stringify(await syncRecent(arg ? Number(arg) : 5), null, 2)); return }
  console.log(`usage:
  node dsh-connector.mjs sync <run-id-or-path>
  node dsh-connector.mjs sync-all
  node dsh-connector.mjs sync-recent [n]`)
  process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
