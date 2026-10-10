#!/usr/bin/env node
// Import an inventory JSONL into pm. One line per open item, in the shape
// documented in lib.mjs. Lines with kind "summary" are reported, not imported.
//
// This is the single import path: the ndi2 scanners pipe into it, and an agent
// on another machine sends the same JSONL back over Remote Control for it.
//
// Idempotent - re-importing the same file updates in place, so it is safe to
// re-run after every sweep.
//
//   node import-inventory.mjs <file.jsonl> [--dry]
import { readFileSync } from 'node:fs'
import { upsertLine, tally, projectFor } from './lib.mjs'

const [file, ...flags] = process.argv.slice(2)
if (!file) {
  console.error('usage: node import-inventory.mjs <file.jsonl> [--dry]')
  process.exit(2)
}
const dry = flags.includes('--dry')

const lines = readFileSync(file, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('{'))
  .map((l, i) => {
    try { return JSON.parse(l) } catch (err) { throw new Error(`line ${i + 1} is not valid JSON: ${err.message}`) }
  })

const t = tally()
const skipped = []
for (const line of lines) {
  if (line.kind === 'summary') { console.log('source summary:', JSON.stringify(line.counts)); continue }
  if (!line.source_ref || !line.title) { skipped.push(line); continue }
  if (dry) { console.log(`would import [${projectFor(line)}] ${line.lifecycle || 'READY'} ${line.source_ref}`); continue }
  const res = await upsertLine(line)
  t.add(res.action)
  console.log(`${res.action.padEnd(9)} ${res.task.id}  [${projectFor(line)}]  ${line.lifecycle || 'READY'}  ${line.source_ref}`)
}
if (skipped.length) console.log(`skipped ${skipped.length} line(s) missing source_ref or title`)
if (!dry) console.log(`\n${t}`)
