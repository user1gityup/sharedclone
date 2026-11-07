#!/usr/bin/env node
// One-off: the v1 tasks carry their origin as a `source-handoff:<file>` or
// `dsh-run:<id>` marker inside the body, because there was no column for it.
// Copy that marker into the new source_ref column so the connectors recognise
// those tasks instead of creating duplicates beside them.
//
// Also gives every pre-existing task an origin_machine, since v1 predates the
// idea that work belongs to a machine.
//
//   node backfill-source-refs.mjs [--dry]
import { call } from '../cli.mjs'
import { WHO, HOST } from './lib.mjs'

const dry = process.argv.includes('--dry')
const tasks = await call('GET', '/api/tasks?limit=5000', undefined, WHO)

let touched = 0
let already = 0
let none = 0
for (const t of tasks) {
  const m = /(?:source-handoff:\s*(\S+))|(?:dsh-run:\s*([0-9a-fA-F-]{8,64}))/.exec(t.body || '')
  const ref = m?.[1]?.trim() || m?.[2]?.trim() || null
  const changes = {}
  if (ref && !t.source_ref) changes.source_ref = ref
  if (!t.origin_machine) changes.origin_machine = HOST
  if (!t.execution_machine) changes.execution_machine = HOST
  if (!Object.keys(changes).length) { if (t.source_ref) already++; else none++; continue }
  if (dry) { console.log(`would set ${t.id}`, changes); touched++; continue }
  await call('PATCH', `/api/tasks/${t.id}`, { rev: t.rev, ...changes }, WHO)
  console.log(`${t.id}  ${Object.entries(changes).map(([k, v]) => `${k}=${v}`).join('  ')}`)
  touched++
}
console.log(`\n${tasks.length} tasks: ${touched} ${dry ? 'would be ' : ''}updated, ${already} already keyed, ${none} with no marker`)
