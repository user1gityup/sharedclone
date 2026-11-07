#!/usr/bin/env node
/**
 * Shared brain loader.
 *
 * One memory store serves every project and both agents (Claude Code and
 * Codex). It lives at ~/.claude/shared-brain — above the project tree, not
 * inside it, so a note written while working on one repository is visible while
 * working on any other.
 *
 * Claude Code keys its memory directory by project path. Each of those paths is
 * a junction pointing at the shared brain, so the built-in memory tooling reads
 * and writes the shared files without knowing anything has changed. This hook
 * creates that junction for the current directory if it is missing, which is
 * what makes a brand-new project directory join the shared brain on its first
 * session instead of starting an isolated store.
 *
 * Only the index is injected, never the notes: roughly thirty lines, each
 * naming a file the session can read on demand. Per-turn cost stays near zero
 * while the whole store stays discoverable.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'

const BRAIN = join(homedir(), '.claude', 'shared-brain')

// The profile this session runs under. A second Anthropic account runs the same
// binary with CLAUDE_CONFIG_DIR pointed at its own profile directory, and that
// is where Claude Code keys its projects/<key>/memory store. The brain itself
// always stays under the default profile: one store, every account.
const DEFAULT_CONFIG = join(homedir(), '.claude')
const CONFIG = process.env.CLAUDE_CONFIG_DIR || DEFAULT_CONFIG

// Profile directories other than the default that share these rules and notes.
const EXTRA_PROFILES = ['.claude-work']

// Claude Code's project key: every separator, drive colon and dot becomes a
// dash. C:\Users\ndi2\Documents\claudecode -> C--Users-ndi2-Documents-claudecode
const projectKey = (cwd) => cwd.replace(/[\\\/:.]/g, '-')

/** Point this project's memory directory at the shared brain. */
function linkProjectStore(cwd) {
  if (!cwd) return
  const store = join(CONFIG, 'projects', projectKey(cwd), 'memory')
  if (existsSync(store)) {
    // Claude Code creates this directory itself the first time a session in the
    // project writes memory, and an empty real directory here is what keeps a
    // project out of the brain for good. An empty one is safe to replace; one
    // with notes in it is a real store and is left alone.
    try {
      if (lstatSync(store).isSymbolicLink() || readdirSync(store).length > 0) return
      rmdirSync(store)
    } catch {
      return
    }
  }
  try {
    mkdirSync(dirname(store), { recursive: true })
    symlinkSync(BRAIN, store, 'junction')
  } catch {
    // A failed link costs this project the shared store, not the session.
  }
}

let stdin = ''
try {
  stdin = readFileSync(0, 'utf8')
} catch {}
let cwd = process.cwd()
try {
  cwd = JSON.parse(stdin).cwd || cwd
} catch {}

linkProjectStore(cwd)

/**
 * Re-render the standing rules into Codex's AGENTS.md from ~/.claude/CLAUDE.md.
 * Running it here is what enforces the two agents sharing one set of rules: an
 * edit to CLAUDE.md reaches Codex at the next Claude Code session, and an edit
 * made directly to Codex's generated block is preserved to .rules-drift/ and
 * then reverted.
 */
function syncAgentRules() {
  const script = join(homedir(), '.claude', 'hooks', 'sync-agent-rules.mjs')
  if (!existsSync(script)) return null
  try {
    const run = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf8', timeout: 10_000 })
    return JSON.parse(run.stdout)
  } catch {
    return null // A failed sync is not worth a failed session start.
  }
}

const rules = syncAgentRules()

/**
 * Carry the standing rules into a second account's profile.
 *
 * ~/.claude/CLAUDE.md is the one master rule set, and a session started with
 * CLAUDE_CONFIG_DIR reads its OWN profile's CLAUDE.md, so without this copy the
 * second account would run with no rules at all. Same contract as Codex's
 * AGENTS.md: edit the master, every copy follows at the next session start.
 * Only the default profile's session writes these copies; a session already
 * running inside such a profile leaves them alone.
 */
function syncProfileRules() {
  if (CONFIG !== DEFAULT_CONFIG) return
  let master
  try {
    master = readFileSync(join(DEFAULT_CONFIG, 'CLAUDE.md'), 'utf8')
  } catch {
    return
  }
  for (const dir of EXTRA_PROFILES) {
    const target = join(homedir(), dir, 'CLAUDE.md')
    if (!existsSync(join(homedir(), dir))) continue
    try {
      if (existsSync(target) && readFileSync(target, 'utf8') === master) continue
      writeFileSync(target, master)
    } catch {
      // A profile left with stale rules is not worth a failed session start.
    }
  }
}

syncProfileRules()

/**
 * Bring this machine's brain up to date with the other machines' before the
 * index is read, so the session starts from merged notes rather than from
 * whatever this copy last saw.
 *
 * The brain is a git repository with a private remote, and the logic lives in
 * the repository itself (.sync/brain-sync.mjs), so every machine runs the
 * version that came with the notes. A brain that is not a repository, a remote
 * that cannot be reached, or a sync that fails all leave the notes as they are:
 * a slow or broken sync is never worth a failed session start.
 */
function syncBrain() {
  const script = join(BRAIN, '.sync', 'brain-sync.mjs')
  if (!existsSync(join(BRAIN, '.git')) || !existsSync(script)) return null
  try {
    const run = spawnSync(process.execPath, [script, 'context', '--dir', BRAIN, '--timeout', '6000'], {
      encoding: 'utf8',
      timeout: 25_000,
      windowsHide: true,
    })
    return JSON.parse(run.stdout)
  } catch {
    return { result: 'error', lines: ['Brain sync did not finish before the session started; notes are as this machine last left them.'] }
  }
}

const brain = syncBrain()

/**
 * Count push requests still waiting for the gatekeeper. Agents that cannot run
 * git push - Codex, the council seats, subagents - commit locally and file a
 * request in the brain. Surfacing the count here is what makes that queue a
 * handoff rather than a file nobody opens.
 *
 * A request counts as open only when every Status line it carries says so.
 * After two machines' queues merge, one request can hold both the `open` it was
 * filed with and the `pushed` another machine's gatekeeper wrote.
 */
function openPushRequests() {
  if (typeof brain?.openRequests === 'number') return brain.openRequests
  try {
    const text = readFileSync(join(BRAIN, 'push-requests.md'), 'utf8')
    // Everything above the marker is the file's own documentation, example
    // request included, so counting the whole file would report a phantom.
    const queue = text.split('REQUESTS BELOW THIS LINE')[1] ?? ''
    return queue.split(/(?=^## )/m).filter(block => {
      const statuses = block.match(/^Status:.*$/gm) ?? []
      return statuses.length > 0 && statuses.every(s => /^Status:\s*open\s*$/i.test(s))
    }).length
  } catch {
    return 0
  }
}

const pending = openPushRequests()

/** A pointer older than this says nothing: the work it named has moved on. */
const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The resume pointer for this machine, if one is waiting.
 *
 * quota-handoff.mjs has a session that is running out of context write
 * resume-<hostname>.md naming the handoff note it leaves behind. One line about
 * it here is what tells a fresh session there is unfinished work, at the cost of
 * that line: the note itself is read on demand, like every other note in the
 * index.
 *
 * Host-scoped on purpose. Several machines write into this brain, and picking
 * the most recently modified handoff instead was demonstrated to select a peer's
 * unrelated note. A pointer that is stale, or that names a note no longer here,
 * says nothing rather than something wrong.
 */
function resumePointer() {
  let text
  try {
    text = readFileSync(join(BRAIN, `resume-${hostname().toLowerCase()}.md`), 'utf8')
  } catch {
    return null
  }
  const field = (name) => new RegExp(`^${name}:[ \t]*(.+)$`, 'mi').exec(text)?.[1]?.trim()
  const note = field('Handoff')
  if (!note || !/^[\w.-]+\.md$/.test(note) || !existsSync(join(BRAIN, note))) return null
  const updated = field('Updated')
  const at = updated ? Date.parse(updated.replace(' ', 'T')) : NaN
  if (Number.isFinite(at) && Date.now() - at > RESUME_MAX_AGE_MS) return null
  return { note, topic: field('Topic'), next: field('Next'), updated }
}

const resume = resumePointer()

let index
try {
  index = readFileSync(join(BRAIN, 'MEMORY.md'), 'utf8').trim()
} catch {
  // The brain is gone or renamed. A missing index is not worth a failed session
  // start; say nothing and let the session run.
  process.stdout.write('{}')
  process.exit(0)
}

/**
 * Claude Code's own auto memory already loads MEMORY.md from the junction - its
 * first 200 lines or about 24.4 KB - so injecting the whole index again paid for
 * it twice (measured 2026-09-26: 50.6 KB here plus 25.4 KB there, of a 77.5k
 * startup). Only the lines past that cut are sent, and of those only live ones:
 * closed, done, superseded or merged notes stay findable with grep. Mojibake
 * left by past encoding round trips is folded back to a dash on the way out.
 */
const AUTO_MEMORY_LINES = 200
const AUTO_MEMORY_BYTES = 24_000
const CLOSED = /^- \[[^\]]*\]\([^)]*\)\s*\S*\s*(?:CLOSED|DONE|SUPERSEDED|MERGED)\b|^- \[[^\]]*\bCLOSED\b/

const autoMemoryLoads = () => {
  if (process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY) return false
  try {
    if (JSON.parse(readFileSync(join(CONFIG, 'settings.json'), 'utf8')).autoMemoryEnabled === false) return false
  } catch {}
  try {
    return lstatSync(join(CONFIG, 'projects', projectKey(cwd), 'memory')).isSymbolicLink()
  } catch {
    return false
  }
}

const demojibake = (text) => text.replace(/\s*(?:[ÃÂâ][\u0080-ÿŒ-™]*){2,}\s*/g, ' - ')

function indexForSession(text) {
  if (!autoMemoryLoads()) return { lines: demojibake(text), skipped: 0, loaded: false }
  const all = text.split(/\r?\n/)
  let bytes = 0
  let cut = 0
  while (cut < all.length && cut < AUTO_MEMORY_LINES && bytes + Buffer.byteLength(all[cut]) + 1 <= AUTO_MEMORY_BYTES) {
    bytes += Buffer.byteLength(all[cut]) + 1
    cut++
  }
  // The index carries several lines for one note after merges; the first one wins.
  const target = (line) => /^- \[[^\]]*\]\(([^)]+)\)/.exec(line)?.[1]
  const seen = new Set(all.slice(0, cut).map(target).filter(Boolean))
  const rest = all.slice(cut).filter(line => line.trim())
  const live = rest.filter(line => {
    const file = target(line)
    if (file && seen.has(file)) return false
    if (file) seen.add(file)
    return !CLOSED.test(demojibake(line))
  })
  return { lines: demojibake(live.join('\n')), skipped: rest.length - live.length, loaded: true, cut }
}

const shown = indexForSession(index)

const context = [
  'Shared brain — one memory store for every project and for both agents on this',
  'machine (Claude Code and Codex). It sits above the project tree, so a note',
  'written on one repository is visible while working on any other. Every',
  'per-project memory directory is a junction pointing here.',
  '',
  `Store: ${BRAIN.replaceAll('\\', '/')}`,
  '',
  ...(shown.loaded
    ? [
        `MEMORY.md, the index, is already in context through auto memory (its first ${shown.cut} lines).`,
        ...(shown.lines ? ['Live index lines past that cut:', shown.lines] : []),
        ...(shown.skipped ? [`${shown.skipped} closed or duplicate lines past the cut are omitted; grep MEMORY.md to find them.`] : []),
      ]
    : [shown.lines]),
  '',
  'Read the note file before working on the harness, the council, the plugins,',
  'FCC, or a push. Treat these as decisions already made, not suggestions.',
  'For what the other agent did last, read only the tail of shared-agent-log.md',
  '(tail -n 40) or grep its "## " headers - never the whole file. Append to it',
  'when work lands. Codex reads the same files through ~/.codex/AGENTS.md, and every',
  'DSH agent through ~/.dsh/AGENTS.md, which the brain sync renders from these notes.',
  ...(resume
    ? [
        '',
        `Unfinished work on this machine: ${resume.topic ?? resume.note}.`,
        `Its handoff note is ${resume.note}${resume.updated ? `, updated ${resume.updated}` : ''},`,
        `named by the pointer resume-${hostname().toLowerCase()}.md.`,
        ...(resume.next ? [`Recorded next action: ${resume.next}`] : []),
        'Read that note in full before doing related work, and check what it claims',
        'against the live state - it was written by a session that was running out of',
        'context. If this session is about something else, leave it where it is.',
      ]
    : []),
  ...(brain
    ? [
        '',
        'The brain is also shared across machines through git, and each machine has a',
        'different home folder, so notes write home paths as `~`. Expand `~` yourself',
        'before handing a path to a program that does not, such as node or cmd.',
      ]
    : []),
  ...(brain?.lines?.length ? ['', ...brain.lines] : []),
  ...(pending > 0
    ? [
        '',
        `push-requests.md has ${pending} request${pending === 1 ? '' : 's'} waiting for the`,
        'git gatekeeper - work another agent committed and handed off. Mention it when',
        'the user says the session is ending; do not push, and do not ask for approval.',
      ]
    : []),
  ...(rules && rules.status === 'rewritten'
    ? [
        '',
        "Codex's copy of the standing rules had drifted from ~/.claude/CLAUDE.md and",
        'was just re-rendered from it. The old block is kept under',
        'shared-brain/.rules-drift/ - if it held a rule change someone meant to keep,',
        'it belongs in CLAUDE.md, which is the only source.',
      ]
    : []),
  ...(rules && !rules.ok
    ? ['', `Warning: the Codex rule sync reported "${rules.status}" for ${rules.path}.`]
    : []),
].join('\n')

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
}))
