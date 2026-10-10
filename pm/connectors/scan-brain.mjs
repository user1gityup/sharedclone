#!/usr/bin/env node
// Sweep this machine's shared brain and emit one inventory line per open item,
// as JSONL on stdout, for import-inventory.mjs to consume.
//
// Sources: handoff-*.md notes, the gatekeeper push queue, and the project notes
// that describe unfinished work but have no handoff file of their own.
//
// Read-only. It never edits the brain and never closes a queue entry.
//
//   node scan-brain.mjs > inventory.jsonl
//   node scan-brain.mjs --only handoffs
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, hostname } from 'node:os'

const BRAIN = process.env.SHARED_BRAIN || join(homedir(), '.claude', 'shared-brain')
const HOST = process.env.PM_MACHINE || hostname()
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const squash = (s) => (s || '').replace(/\s+/g, ' ').trim()

// A note is closed when it says so about itself. Deliberately literal: a file
// that merely *sounds* finished stays open, because a wrong "closed" loses work
// and a wrong "open" only costs a glance.
const CLOSED = /\b(closed|done|resolved|complete|superseded|merged into)\b/i
// MEMORY.md is the index the user maintains by hand, so its one-line status for
// a note outranks anything inferred from the note itself.
const indexStatus = (() => {
  const path = join(BRAIN, 'MEMORY.md')
  const byFile = new Map()
  if (!existsSync(path)) return byFile
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /\]\(([^)]+\.md)\)\s*-\s*(.*)$/.exec(line)
    if (m) byFile.set(m[1].split('/').pop(), squash(m[2]))
  }
  return byFile
})()

const frontmatter = (txt) => /^---\n([\s\S]*?)\n---/.exec(txt)?.[1] || ''
const description = (txt) => squash(/description:\s*([\s\S]*?)(?:\nmetadata:|\nname:|\ntype:|$)/.exec(frontmatter(txt))?.[1] || '')

// Pull the note's own next action, preferring the LAST one in the file: these
// notes are appended to across sessions and the earlier ones go stale.
function nextAction(txt) {
  const re = /^\s*(?:#+\s*)?\**\s*(?:Exact next action|Next action|Next step|Next)\b\**\s*[:\-]?\s*([\s\S]*?)(?=\n\s*\n|\n\s*(?:#+\s|\*\*[A-Z])|$)/gim
  let last = null
  for (const m of txt.matchAll(re)) if (squash(m[1])) last = squash(m[1])
  return last
}

function blockers(txt) {
  const re = /^\s*(?:#+\s*)?\**\s*(?:Blocker|Blockers|Open question|Blocked on)\b\**\s*[:\-]?\s*([\s\S]*?)(?=\n\s*\n|\n\s*(?:#+\s|\*\*[A-Z])|$)/gim
  let last = null
  for (const m of txt.matchAll(re)) if (squash(m[1])) last = squash(m[1])
  return last
}

function lifecycleFor(desc, next, block) {
  if (/QUOTA STOP|quota stop/i.test(desc)) return 'PAUSED'
  if (block) return 'BLOCKED'
  if (/\bPARTIAL\b|in flight|mid-|uncommitted/i.test(desc)) return 'PAUSED'
  if (/awaiting|waiting|held|user word|user decision/i.test(`${desc} ${next || ''}`)) return 'WAITING'
  if (/verify|re-verify|proven|review/i.test(next || '')) return 'VERIFY'
  return 'READY'
}

function scanHandoffs() {
  const files = readdirSync(BRAIN).filter((f) => /^handoff.*\.md$/i.test(f))
  for (const f of files) {
    const path = join(BRAIN, f)
    const txt = readFileSync(path, 'utf8')
    const desc = description(txt)
    const indexed = indexStatus.get(f) || ''
    if (CLOSED.test(desc) || CLOSED.test(indexed)) continue
    const next = nextAction(txt)
    const block = blockers(txt)
    const title = squash(/^#\s+(.+)$/m.exec(txt)?.[1] || desc || f).slice(0, 110) || f
    out({
      kind: 'handoff',
      source_ref: f,
      title,
      lifecycle: lifecycleFor(desc, next, block),
      origin_machine: HOST,
      checkpoint: desc || indexed || null,
      next_action: next || '(no explicit next action in the note - read it before acting)',
      blockers: block || '',
      artifacts: [`~/.claude/shared-brain/${f}`],
      body: [`Last modified ${statSync(path).mtime.toISOString().slice(0, 16).replace('T', ' ')}.`,
        indexed && `MEMORY.md index line: ${indexed}`].filter(Boolean).join('\n'),
    })
  }
}

// The queue is recorded, never acted on: only the gatekeeper pushes, and only
// the user or the gatekeeper closes an entry.
function scanPushQueue() {
  const path = join(BRAIN, 'push-requests.md')
  if (!existsSync(path)) return
  const txt = readFileSync(path, 'utf8')
  // A real entry is `## <repo> - <branch>` followed by Filed:/Status:. The
  // document's own Rules and Format headings are not entries, so require Filed:.
  const blocks = txt.split(/\n(?=##\s)/).filter((b) => /^##\s/.test(b) && /^Filed:/m.test(b))
  for (const b of blocks) {
    const status = squash(/^Status:\s*(.+)$/m.exec(b)?.[1] || '')
    if (!/^open$/i.test(status)) continue
    const head = squash(/^##\s+(.+)$/m.exec(b)?.[1] || '')
    const filed = squash(/^Filed:\s*(.+)$/m.exec(b)?.[1] || '')
    const host = squash(/^Host:\s*(.+)$/m.exec(b)?.[1] || '')
    const head_sha = squash(/^Head:\s*(.+)$/m.exec(b)?.[1] || '')
    if (!head || !filed || head.includes('<')) continue // `<repo path>` is the doc's own format example
    out({
      kind: 'push-queue',
      source_ref: `push-requests:${head}:${filed.split(' by ')[0]}`,
      title: `Push queued: ${head}`.slice(0, 110),
      lifecycle: 'WAITING',
      origin_machine: host || HOST,
      agent: filed.split(' by ')[1] || null,
      checkpoint: [`filed ${filed}`, head_sha && `head ${head_sha}`].filter(Boolean).join(', ') || null,
      next_action: 'the git gatekeeper pushes this when the user says the session is ending; no other agent pushes and no agent closes the entry',
      blockers: '',
      artifacts: ['~/.claude/shared-brain/push-requests.md'],
    })
  }
}

// Project notes that describe work still to do, with no handoff note of their own.
const PROJECT_NOTES = [
  'project_dsh_team_platform.md', 'dsh-target-architecture.md', 'dsh-runtime-routing.md',
  'dsh-user-profiles.md', 'dsh-platform-completion.md', 'dsh-swarm-profiles.md',
  'project_leadforge.md', 'project_agent_project_manager.md',
]

function scanProjectNotes() {
  for (const f of PROJECT_NOTES) {
    const path = join(BRAIN, f)
    if (!existsSync(path)) continue
    const txt = readFileSync(path, 'utf8')
    const desc = description(txt)
    out({
      kind: 'brain-project',
      source_ref: f,
      title: squash(desc || f).slice(0, 110),
      lifecycle: 'READY',
      origin_machine: HOST,
      project: 'brain-projects',
      checkpoint: desc || null,
      next_action: nextAction(txt) || '(design/spec note - read it before planning work against it)',
      blockers: blockers(txt) || '',
      artifacts: [`~/.claude/shared-brain/${f}`],
    })
  }
}

if (!only || only === 'handoffs') scanHandoffs()
if (!only || only === 'push-queue') scanPushQueue()
if (!only || only === 'projects') scanProjectNotes()
