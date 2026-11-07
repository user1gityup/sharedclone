// E4 10-minute stuck rule, live wiring - Claude Opus 5.5 (claude-opus-5-5), 2026-10-26.
// Builds the watchdog's runs file from real DSH state, then runs watchdog.mjs over it.
// Sources: dsh-run records (~/.dsh/council-runs/active/RUN-*.json) whose status is still
// starting/running, plus the in-app pipeline in ~/.dsh/settings.yaml when its stage is set.
// Activity = newest of the record's updatedAt and its log/journal file mtimes.
// Findings go to the shared brain so the hub session sees them. Flag-only: no kills.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const home = homedir()
const here = dirname(fileURLToPath(import.meta.url))
const out = join(home, '.claude/shared-brain/enforcement')
mkdirSync(out, { recursive: true })

const mtime = path => { try { return statSync(path).mtimeMs } catch { return 0 } }
const iso = ms => new Date(ms).toISOString()
const runs = []

const active = join(home, '.dsh/council-runs/active')
for (const name of readdirSync(active).filter(f => /^RUN-.*\.json$/.test(f))) {
  let r
  try { r = JSON.parse(readFileSync(join(active, name), 'utf8')) } catch { continue }
  if (!['starting', 'running'].includes(String(r.status))) continue
  const last = Math.max(Number(r.updatedAt) || 0, mtime(r.stdout), mtime(r.stderr), mtime(join(active, name)))
  runs.push({
    runId: r.runId, seatId: r.pipelineName ?? r.pipeline ?? 'dsh-run', status: 'RUNNING', pid: Number(r.pid) || null,
    startedAt: iso(Number(r.createdAt) || last), lastActivityAt: iso(last), cwd: r.cwd ?? '', logFile: r.stdout ?? '', allowKill: false,
  })
}

const settings = readFileSync(join(home, '.dsh/settings.yaml'), 'utf8')
const field = key => (settings.match(new RegExp(`^  ${key}: "?([^"\\n]*)"?$`, 'm')) ?? [])[1] ?? ''
const pipelineId = field('pipelineId')
if (pipelineId && field('pipelineStage')) {
  const journal = join(home, '.dsh/council-runs/journal', `${pipelineId}.jsonl`)
  // Journal only: settings.yaml is rewritten by unrelated UI state and would mask a dead run.
  const last = mtime(journal)
  runs.push({
    runId: pipelineId, seatId: `pipeline:${field('pipelineStage')}`, status: 'RUNNING', pid: null,
    startedAt: iso(last), lastActivityAt: iso(last), cwd: join(home, '.dsh'), logFile: journal, allowKill: false,
  })
}

const runsFile = join(out, 'watchdog-runs.json')
writeFileSync(runsFile, JSON.stringify(runs, null, 2))
const r = spawnSync(process.execPath, [join(here, 'watchdog.mjs'), '--runs-file', runsFile,
  '--findings-out', join(out, 'watchdog-findings.json'), '--findings-log', join(out, 'watchdog-findings-log.jsonl')],
{ encoding: 'utf8' })
process.stdout.write(r.stdout ?? '')
process.stderr.write(r.stderr ?? '')
process.exit(r.status ?? 1)
