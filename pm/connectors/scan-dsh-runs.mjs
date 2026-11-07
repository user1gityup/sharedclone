#!/usr/bin/env node
// Emit one inventory line per DSH council run on this machine.
//
// Supersedes the ad-hoc task shape dsh-connector.mjs wrote: same run ids, so
// importing this updates those tasks in place and gives them a lifecycle, an
// origin machine and a run reference like every other item in pm.
//
// Read-only against DSH.
//
//   node scan-dsh-runs.mjs > dsh.jsonl
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, hostname } from 'node:os'

const RUNS_DIR = process.env.DSH_COUNCIL_RUNS_DIR || join(homedir(), '.dsh', 'council-runs')
const HOST = process.env.PM_MACHINE || hostname()
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const squash = (s) => (s || '').replace(/\s+/g, ' ').trim()

// terminalState: completed | partial | cancelled | failed | awaiting_resume.
// Absent in records written before the field existed - reported, never guessed.
const LIFECYCLE = {
  completed: 'VERIFY',
  awaiting_resume: 'PAUSED',
  partial: 'FAILED',
  cancelled: 'FAILED',
  failed: 'FAILED',
}

if (!existsSync(RUNS_DIR)) process.exit(0)

for (const f of readdirSync(RUNS_DIR).filter((x) => x.endsWith('.json'))) {
  const path = join(RUNS_DIR, f)
  let run
  try { run = JSON.parse(readFileSync(path, 'utf8')) } catch { continue }
  if (!run?.id) continue
  const head = squash(run.query || '(no query text)').slice(0, 88)
  const state = run.terminalState
  out({
    kind: 'dsh-run',
    source_ref: run.id,
    title: `DSH council ${run.id.slice(0, 8)}: ${head}`,
    lifecycle: LIFECYCLE[state] || 'VERIFY',
    origin_machine: HOST,
    run_ref: run.id,
    checkpoint: [
      state ? `terminalState ${state}` : 'no terminalState field (record predates it)',
      `seats ${(run.seatIds || []).join(', ') || 'none recorded'}`,
      `${(run.reviews || []).length} reviews, ${run.amendments ?? 0} amendments`,
      `file mtime ${statSync(path).mtime.toISOString().slice(0, 16).replace('T', ' ')}`,
    ].join('; '),
    next_action: state === 'awaiting_resume'
      ? `resume this run: the council tool takes resume "${run.id}" and re-asks only the seats that failed (max 3 amendments)`
      : 'none recorded - this is the run record, not an open task; open it to read the plan and reviews',
    blockers: state ? '' : 'terminalState absent in this record - state inferred from content, not asserted',
    artifacts: [path],
    body: run.plan ? `**Published plan:**\n\n${squash(run.plan).slice(0, 1200)}` : '',
  })
}
