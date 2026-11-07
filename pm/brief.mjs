// pm Phase 4 - the minimal continuation brief, compiled from pm state only.
// Deeper history stays a separate explicit fetch (pm_get_task); it is never part
// of the resume payload. The result is stored as an artifact of kind `brief`.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RULES_FILE = join(HERE, '..', 'rules', 'CLAUDE.md')
const clip = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const parse = (v) => { if (v == null || typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }

/** Bold bullet titles from the master rule set, limited to the few that govern a resume. */
export function applicableRules(file = RULES_FILE, max = 5) {
  const want = /nothing without permission|hold git pushes|verify before claiming|pm is the resume|name the model/i
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^- \*\*(.+?)\*\*/)
    if (m && want.test(m[1])) out.push(m[1].replace(/\.$/, ''))
    if (out.length >= max) break
  }
  return out
}

export function compileBrief(task, { rules = applicableRules() } = {}) {
  const meta = parse(task.meta) || {}
  const blockers = parse(task.blockers)
  const deps = meta.dependencies || meta.depends_on || []
  const arts = (task.artifacts || []).filter((a) => a.kind !== 'brief')
  const verified = [...arts].reverse().find((a) => a.kind === 'evidence')
  const lines = [
    `# Brief: ${task.id} - ${clip(task.title, 120)}`,
    `Lifecycle: ${task.lifecycle || 'n/a'} (status ${task.status}) | machine: ${task.execution_machine || 'unset'}`,
    `Objective: ${clip(task.body, 400) || 'none recorded'}`,
    `Checkpoint: ${clip(task.checkpoint, 400) || 'none'}`,
    `Blockers: ${Array.isArray(blockers) ? blockers.map((b) => clip(typeof b === 'string' ? b : JSON.stringify(b), 120)).join('; ') || 'none' : clip(blockers, 300) || 'none'}`,
    `Dependencies: ${Array.isArray(deps) && deps.length ? deps.join(', ') : 'none'}`,
    `Rules: ${rules.length ? rules.join('; ') : 'see ~/.claude/rules/CLAUDE.md'}`,
    `Artifacts: ${arts.length ? arts.slice(-8).map((a) => `${a.kind}:${clip(a.ref, 80)}`).join(', ') : 'none'}`,
    `Last verified: ${verified ? clip(`${verified.ref} ${verified.note || ''}`, 200) : 'nothing verified yet'}`,
    `Next action: ${clip(task.next_action, 600) || 'none recorded'}`,
    `More history: pm_get_task ${task.id} (explicit fetch, not part of this brief)`,
  ]
  return lines.join('\n')
}

/** Compile and store as a versioned, attributed `brief` artifact. */
export function storeBrief(store, who, taskId, opts) {
  const text = compileBrief(store.getTask(taskId), opts)
  const art = store.addArtifact(who, taskId, { kind: 'brief', ref: 'resume-brief', note: text })
  return { text, artifact: art }
}
