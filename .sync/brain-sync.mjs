#!/usr/bin/env node
/**
 * Shared brain sync.
 *
 * The brain is a directory of markdown notes that every agent on a machine
 * reads and writes. With more than one machine there is more than one copy,
 * and nothing carried notes between them. This makes the brain a git
 * repository with a private remote, so each machine's copy converges on the
 * same history.
 *
 * Three things make that safe rather than merely possible:
 *
 * 1. Home paths are written as `~`. Each machine has a different user folder
 *    (C:\Users\<name>), so a path copied verbatim is wrong everywhere except
 *    where it was written. Every note is normalised before it is committed.
 *
 * 2. The files several agents append to - the index, the agent log, the push
 *    queue - merge with git's union driver (see .gitattributes), so two
 *    machines appending at once both keep their lines. The push queue is then
 *    reconciled so a request one machine closed is not reopened by the other.
 *
 * 3. A note both machines changed is never silently lost. The local version
 *    stays in place, the other machine's version is committed beside it under
 *    .sync-conflicts/, and every session on both machines is told until an
 *    agent reconciles the two and deletes the sidecar.
 *
 * Pushing is NOT done here. On these machines one agent owns `git push`; this
 * script commits and merges, and the brain is pushed with every other repo.
 *
 * Commands:
 *   start                      commit local changes, fetch, merge (session start)
 *   seed --snapshot <path>     turn an unsynced brain into the first repository,
 *                              rooted at a common snapshot (dir or .tar.gz)
 *   join --remote <url>        attach an unsynced brain to an existing remote
 *   normalize                  rewrite home paths to ~ in the working tree
 *   status                     print the last sync result
 *   install                    install the session hook, the gatekeeper's
 *                              instructions, DSH's AGENTS.md and its launcher
 *   context                    sync and self-install, as a session start does
 *   dsh [--no-sync]            sync, then render $DSH_HOME/AGENTS.md so every
 *                              DeepSeek Harness agent loads the brain
 *
 * Options:
 *   --dir <path>               brain directory (default ~/.claude/shared-brain)
 *   --timeout <ms>             network budget for `start` (default 8000)
 */

import { spawnSync } from 'node:child_process'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expandHome, fleetLines, followRepos, readReposManifest, saveStatusPart, seedBuiltMarker, syncApps, syncSecretFiles, writeHostStatus,
} from './fleet.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else { out[key] = next; i++ }
    } else out._.push(a)
  }
  return out
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** Environment that can never block on a credential prompt. */
const QUIET_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
}

/**
 * Run git in a directory.
 * @returns {{ok: boolean, code: number|null, out: string, err: string, timedOut: boolean}}
 */
function git(dir, args, { timeout = 60_000, env = QUIET_ENV, input } = {}) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout, env, input, windowsHide: true })
  const timedOut = r.error?.code === 'ETIMEDOUT'
  return {
    ok: r.status === 0 && !timedOut,
    code: r.status,
    out: (r.stdout ?? '').trim(),
    err: (r.stderr ?? '').trim() || (r.error ? String(r.error.message) : ''),
    timedOut,
  }
}

function must(result, what) {
  if (!result.ok) throw new Error(`${what} failed: ${result.err || result.out || `exit ${result.code}`}`)
  return result
}

const isRepo = dir => existsSync(join(dir, '.git'))

// ---------------------------------------------------------------------------
// Home-path normalisation
// ---------------------------------------------------------------------------

/** Users whose home directories appear in notes. */
export function knownUsers(dir) {
  const users = new Set()
  try { users.add(userInfo().username) } catch {}
  for (const candidate of [join(dir, '.sync', 'users.json'), join(HERE, 'users.json')]) {
    try { for (const u of JSON.parse(readFileSync(candidate, 'utf8'))) users.add(String(u)) } catch {}
  }
  return [...users].filter(Boolean)
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Rewrite every spelling of a known user's home directory to `~`.
 *
 * Covers `C:\Users\name`, `C:/Users/name`, `C:\\Users\\name` (escaped, as in
 * JSON) and `/c/Users/name` (Git Bash). The separator after the name is kept,
 * so `C:\Users\name\Documents` becomes `~\Documents`.
 */
export function normalizeText(text, users) {
  if (users.length === 0) return text
  const names = users.map(escapeRe).join('|')
  const re = new RegExp(
    String.raw`(?<![A-Za-z0-9])(?:[A-Za-z]:|/[A-Za-z])(?:\\{1,2}|/)Users(?:\\{1,2}|/)(?:${names})(?![A-Za-z0-9_-]|\.[A-Za-z0-9])`,
    'gi',
  )
  return text.replace(re, '~')
}

/**
 * Files whose paths are data for tools, not prose, and so are never rewritten.
 *
 * push-requests.md: each request's heading is the absolute path of the repo it
 * asks to push, and both gatekeepers resolve that path to find the repo. The
 * path is also what says which machine a request belongs to - the commits exist
 * only there. Rewritten to `~`, a request filed on one machine would resolve on
 * every machine, and another machine's gatekeeper would refuse and close it.
 */
export const LITERAL_PATH_FILES = new Set(['push-requests.md'])

/** Notes are the markdown files outside the sync tooling's own directory. */
function listNotes(dir) {
  const out = []
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (['.git', '.sync', '.sync-state', '.rules-drift'].includes(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        if (d === dir && LITERAL_PATH_FILES.has(e.name)) continue
        out.push(p)
      }
    }
  }
  walk(dir)
  return out
}

/** Normalise every note in a directory in place. Returns the files changed. */
export function normalizeTree(dir, users = knownUsers(dir)) {
  const changed = []
  for (const file of listNotes(dir)) {
    const before = readFileSync(file, 'utf8')
    const after = normalizeText(before, users)
    if (after !== before) { writeFileSync(file, after); changed.push(relative(dir, file)) }
  }
  return changed
}

// ---------------------------------------------------------------------------
// Push-queue reconciliation
// ---------------------------------------------------------------------------

const QUEUE_MARKER = 'REQUESTS BELOW THIS LINE'

/**
 * After a union merge a request can carry both machines' Status lines: the
 * `open` it was filed with and the `pushed` the gatekeeper wrote on the other
 * machine. A closed status wins; exact duplicates collapse.
 *
 * A heading with nothing under it is dropped. It is what a union merge leaves
 * when two machines rewrote the same heading differently - the clone restore
 * changed the user folder in every old request's path - so the line from one
 * side ends up stranded above the full request from the other. No request is
 * ever only a heading; every real one carries at least Filed and Status.
 *
 * Nothing else in a request is touched.
 */
export function reconcilePushRequests(text) {
  const at = text.indexOf(QUEUE_MARKER)
  if (at < 0) return text
  const cut = text.indexOf('\n', at) + 1
  const head = text.slice(0, cut)
  const blocks = text.slice(cut).split(/(?=^## )/m)
    .filter(block => !(block.startsWith('## ') && block.split('\n').slice(1).every(l => l.trim() === '')))
  const fixed = blocks.map(block => {
    const lines = block.split('\n')
    const statusIdx = lines.map((l, i) => (/^Status:/.test(l) ? i : -1)).filter(i => i >= 0)
    if (statusIdx.length <= 1) return block
    const statuses = statusIdx.map(i => lines[i])
    const keep = statuses.find(s => !/^Status:\s*open\s*$/i.test(s)) ?? statuses[0]
    const out = []
    let placed = false
    for (const line of lines) {
      if (!/^Status:/.test(line)) { out.push(line); continue }
      if (!placed) { out.push(keep); placed = true }
    }
    return out.join('\n')
  })
  return head + fixed.join('')
}

/** Count requests still open, robust to duplicated status lines. */
export function countOpenRequests(text) {
  const at = text.indexOf(QUEUE_MARKER)
  if (at < 0) return 0
  return text.slice(at).split(/(?=^## )/m).filter(block => {
    const statuses = block.match(/^Status:.*$/gm) ?? []
    return statuses.length > 0 && statuses.every(s => /^Status:\s*open\s*$/i.test(s))
  }).length
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function stateDir(dir) {
  const d = join(dir, '.sync-state')
  mkdirSync(d, { recursive: true })
  return d
}

function writeState(dir, state) {
  const full = { at: new Date().toISOString(), host: hostname(), ...state }
  writeFileSync(join(stateDir(dir), 'last.json'), JSON.stringify(full, null, 2))
  return full
}

export function readState(dir) {
  try { return JSON.parse(readFileSync(join(dir, '.sync-state', 'last.json'), 'utf8')) } catch { return null }
}

/** Unresolved sidecars, whichever machine created them. */
export function listConflicts(dir) {
  const d = join(dir, '.sync-conflicts')
  if (!existsSync(d)) return []
  return readdirSync(d).filter(f => f.endsWith('.md')).map(f => `.sync-conflicts/${f}`)
}

/** A lock so two sessions starting at once do not fight over the index. */
function withLock(dir, fn) {
  const lock = join(stateDir(dir), 'lock')
  if (existsSync(lock)) {
    const age = Date.now() - statSync(lock).mtimeMs
    if (age < 120_000) return { skipped: true }
    rmSync(lock, { force: true })
  }
  writeFileSync(lock, String(process.pid))
  try { return fn() } finally { rmSync(lock, { force: true }) }
}

// ---------------------------------------------------------------------------
// Commit and merge
// ---------------------------------------------------------------------------

function configure(dir) {
  // Identity for machine-made commits. Private repo, but a noreply address
  // costs nothing and keeps a real address out of history.
  git(dir, ['config', 'user.name', `brain-sync (${hostname()})`])
  git(dir, ['config', 'user.email', 'user1gityup@users.noreply.github.com'])
  git(dir, ['config', 'core.autocrlf', 'false'])
  git(dir, ['config', 'merge.renames', 'false'])
  if (existsSync(join(dir, '.sync', 'hooks'))) git(dir, ['config', 'core.hooksPath', '.sync/hooks'])
}

/** Stage and commit whatever the agents wrote since the last commit. */
function commitLocal(dir, message, pathspec = ['.']) {
  must(git(dir, ['add', '-A', '--', ...pathspec]), 'git add')
  const staged = git(dir, ['diff', '--cached', '--quiet'])
  if (staged.code === 0) return false
  must(git(dir, ['commit', '--no-verify', '-q', '-m', message]), 'git commit')
  return true
}

function finishQueueReconcile(dir) {
  const file = join(dir, 'push-requests.md')
  if (!existsSync(file)) return false
  const before = readFileSync(file, 'utf8')
  const after = reconcilePushRequests(before)
  if (after === before) return false
  writeFileSync(file, after)
  return commitLocal(dir, `brain: reconcile push-request status after merge (${hostname()})`, ['push-requests.md'])
}

/**
 * Merge a ref into the current branch.
 *
 * Union-merged files resolve themselves. Any other file both sides changed
 * keeps this machine's version in place and commits the other side's beside it
 * under .sync-conflicts/, so neither is lost and both machines see it.
 */
export function mergeRef(dir, ref, theirLabel) {
  const conflicts = []
  const r = git(dir, ['merge', '--no-edit', '--no-ff', '-m', `brain: merge ${theirLabel} into ${hostname()}`, ref])
  if (!r.ok) {
    const unmerged = git(dir, ['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean)
    if (unmerged.length === 0) {
      git(dir, ['merge', '--abort'])
      throw new Error(`merge of ${ref} failed: ${r.err || r.out}`)
    }
    const sidecars = join(dir, '.sync-conflicts')
    mkdirSync(sidecars, { recursive: true })
    for (const path of unmerged) {
      const ours = git(dir, ['show', `:2:${path}`])
      const theirs = git(dir, ['show', `:3:${path}`])
      const stem = basename(path).replace(/\.md$/i, '')
      const safeLabel = theirLabel.replace(/[^A-Za-z0-9._-]+/g, '-')
      if (ours.ok && theirs.ok) {
        const sidecar = join(sidecars, `${stem}.from-${safeLabel}.md`)
        writeFileSync(sidecar, readRawBlob(dir, `:3:${path}`))
        writeFileSync(join(dir, path), readRawBlob(dir, `:2:${path}`))
        conflicts.push({ note: path, sidecar: relative(dir, sidecar).split(sep).join('/') })
      } else if (theirs.ok) {
        // Deleted here, changed there: keep their change rather than lose it.
        writeFileSync(join(dir, path), readRawBlob(dir, `:3:${path}`))
        conflicts.push({ note: path, sidecar: null, kind: 'deleted-here-changed-there' })
      } else if (ours.ok) {
        writeFileSync(join(dir, path), readRawBlob(dir, `:2:${path}`))
        conflicts.push({ note: path, sidecar: null, kind: 'deleted-there-changed-here' })
      }
      must(git(dir, ['add', '-A', '--', path]), `git add ${path}`)
    }
    must(git(dir, ['add', '-A', '--', '.sync-conflicts']), 'git add sidecars')
    must(git(dir, ['commit', '--no-verify', '-q', '--no-edit']), 'git commit (merge)')
  }
  finishQueueReconcile(dir)
  return conflicts
}

/** Read a blob exactly, without trimming. */
function readRawBlob(dir, spec) {
  const r = spawnSync('git', ['-C', dir, 'show', spec], { encoding: 'utf8', env: QUIET_ENV, windowsHide: true })
  return r.stdout ?? ''
}

function aheadBehind(dir, upstream) {
  const r = git(dir, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])
  if (!r.ok) return { behind: null, ahead: null }
  const [behind, ahead] = r.out.split(/\s+/).map(Number)
  return { behind, ahead }
}

const DEFAULT_BRANCH = 'main'

// ---------------------------------------------------------------------------
// start - session start
// ---------------------------------------------------------------------------

export function start(dir, { timeout = 8000 } = {}) {
  if (!isRepo(dir)) return writeState(dir, { result: 'not-a-repo' })
  const locked = withLock(dir, () => {
    // A merge interrupted by a crash would block everything after it.
    if (existsSync(join(dir, '.git', 'MERGE_HEAD'))) git(dir, ['merge', '--abort'])

    normalizeTree(dir)
    const committed = commitLocal(dir, `brain: ${hostname()} session changes`)

    const remote = git(dir, ['remote', 'get-url', 'origin'])
    if (!remote.ok) {
      return writeState(dir, { result: 'no-remote', committed, conflicts: [] })
    }

    const fetch = git(dir, ['fetch', '--quiet', 'origin'], { timeout })
    if (!fetch.ok) {
      return writeState(dir, {
        result: 'offline',
        committed,
        reason: fetch.timedOut ? `fetch exceeded ${timeout}ms` : fetch.err.split('\n')[0],
        conflicts: [],
        ...aheadBehind(dir, `origin/${DEFAULT_BRANCH}`),
      })
    }

    const upstream = `origin/${DEFAULT_BRANCH}`
    if (!git(dir, ['rev-parse', '--verify', '--quiet', upstream]).ok) {
      return writeState(dir, { result: 'remote-empty', committed, conflicts: [] })
    }

    const { behind } = aheadBehind(dir, upstream)
    let conflicts = []
    if (behind > 0) conflicts = mergeRef(dir, upstream, 'remote')
    return writeState(dir, {
      result: behind > 0 ? 'merged' : 'up-to-date',
      committed,
      conflicts,
      ...aheadBehind(dir, upstream),
    })
  })
  if (locked?.skipped) return writeState(dir, { result: 'busy' })
  return locked
}

// ---------------------------------------------------------------------------
// publish - send this machine's brain to the shared remote, every sync
// ---------------------------------------------------------------------------
//
// The brain is shared state that belongs to the whole system, not one agent's
// work, so it does not wait for a push cue (user decision, 2026-09-12): a sync
// ends by publishing. Only the brain repository is pushed here; project
// repositories keep the gatekeeper. The pre-push gate runs here first and again
// as the hook git itself calls, so a note with a home path or a credential
// never leaves the machine.

const KEYS_BRANCH = 'keys'

function writePublishState(dir, state) {
  const full = { at: new Date().toISOString(), host: hostname(), ...state }
  try { writeFileSync(join(stateDir(dir), 'publish.json'), JSON.stringify(full, null, 2)) } catch {}
  return full
}

/**
 * Push main (and the keys branch) when the remote lacks them. A push refused
 * because another machine published first is followed by a sync and a retry.
 */
export function publish(dir, { timeout = 20_000, attempts = 3 } = {}) {
  if (!isRepo(dir)) return { result: 'not-a-repo' }
  if (!git(dir, ['remote', 'get-url', 'origin']).ok) return { result: 'no-remote' }
  const upstream = `origin/${DEFAULT_BRANCH}`
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const refs = []
    const hasUpstream = git(dir, ['rev-parse', '--verify', '--quiet', upstream]).ok
    if (!hasUpstream || aheadBehind(dir, upstream).ahead > 0) refs.push(`refs/heads/${DEFAULT_BRANCH}:refs/heads/${DEFAULT_BRANCH}`)
    const localKeys = git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${KEYS_BRANCH}`])
    const remoteKeys = git(dir, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${KEYS_BRANCH}`])
    if (localKeys.ok && localKeys.out !== remoteKeys.out) refs.push(`refs/heads/${KEYS_BRANCH}:refs/heads/${KEYS_BRANCH}`)
    if (refs.length === 0) return writePublishState(dir, { result: 'up-to-date' })
    const problems = verifyPublish(dir, 'HEAD')
    if (problems.length > 0) return writePublishState(dir, { result: 'blocked', problems })
    const push = git(dir, ['push', '--quiet', 'origin', ...refs], { timeout })
    if (push.ok) return writePublishState(dir, { result: 'pushed', refs: refs.map(ref => ref.split(':')[1]), attempt })
    const raced = /rejected|non-fast-forward|fetch first/i.test(push.err)
    if (!raced || attempt === attempts) {
      return writePublishState(dir, { result: push.timedOut ? 'offline' : 'failed', reason: push.err.split('\n').slice(-3).join(' '), attempt })
    }
    // Another machine published first: take its work, then publish again.
    const synced = start(dir, { timeout })
    if (!['merged', 'up-to-date'].includes(synced.result)) {
      return writePublishState(dir, { result: 'failed', reason: `sync before retry: ${synced.result}`, attempt })
    }
  }
  return writePublishState(dir, { result: 'failed', reason: 'out of attempts' })
}

/** The brain key as the shared history carries it on the keys branch, or null. */
export function keyFromHistory(dir) {
  if (!isRepo(dir)) return null
  for (const ref of [`refs/remotes/origin/${KEYS_BRANCH}`, `refs/heads/${KEYS_BRANCH}`]) {
    if (!git(dir, ['rev-parse', '--verify', '--quiet', ref]).ok) continue
    const match = /\b([0-9a-fA-F]{64})\b/.exec(readRawBlob(dir, `${ref}:brain-secrets.key`))
    if (match !== null) return Buffer.from(match[1], 'hex')
  }
  return null
}

/**
 * Put the brain key on the keys branch - an orphan branch holding one file - when
 * the shared history has none. Access to the private repository is the lock
 * (user decision, 2026-09-12), so a new machine joins with no key carried by hand.
 */
export function shareBrainKey(dir, key) {
  if (!isRepo(dir) || keyFromHistory(dir) !== null) return false
  const blob = must(git(dir, ['hash-object', '-w', '--stdin'], { input: `${key.toString('hex')}\n` }), 'hash key')
  const tree = must(git(dir, ['mktree'], { input: `100644 blob ${blob.out}\tbrain-secrets.key\n` }), 'mktree keys')
  const commit = must(git(dir, ['commit-tree', tree.out, '-m', `brain: key for the sealed DSH credentials (${hostname()})`]), 'commit keys')
  must(git(dir, ['update-ref', `refs/heads/${KEYS_BRANCH}`, commit.out]), 'update keys branch')
  return true
}

/** One unattended cycle: sync, self-install, publish. Logged, trimmed to the last 400 lines. */
export function cycle(dir, { timeout = 20_000 } = {}) {
  const synced = context(dir, { timeout })
  // Repositories are followed here, not at session start: a fetch per repository
  // does not fit the session hook's budget. Throttled to every ten minutes.
  try {
    followRepos(dir)
  } catch {}
  // Apps (Claude Code, Codex, Antigravity) follow the master's recorded target; hourly.
  try {
    syncApps(dir)
  } catch {}
  try {
    writeHostStatus(dir)
  } catch {}
  const published = publish(dir, { timeout })
  const line = `${new Date().toISOString()} ${hostname()} sync=${synced.result} publish=${published.result}${published.reason ? ` reason=${published.reason}` : ''}${published.problems ? ` problems=${published.problems.join('; ')}` : ''}`
  try {
    const logPath = join(stateDir(dir), 'cycle.log')
    const previous = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean) : []
    writeFileSync(logPath, `${[...previous, line].slice(-400).join('\n')}\n`)
  } catch {}
  return { sync: synced.result, publish: published.result, lines: synced.lines, ...published.reason ? { reason: published.reason } : {}, ...published.problems ? { problems: published.problems } : {} }
}

// ---------------------------------------------------------------------------
// seed - first repository, rooted at a common snapshot
// ---------------------------------------------------------------------------

/** Resolve a snapshot to a directory holding the brain as it was. */
function materializeSnapshot(snapshot) {
  if (statSync(snapshot).isDirectory()) {
    const nested = join(snapshot, '.claude', 'shared-brain')
    return existsSync(nested) ? nested : snapshot
  }
  if (!/\.t(ar\.)?gz$/i.test(snapshot)) throw new Error(`snapshot must be a directory or .tar.gz: ${snapshot}`)
  const out = mkdtempSync(join(tmpdir(), 'brain-snapshot-'))
  // Windows' own bsdtar understands drive letters; GNU tar reads `C:` as a host.
  const tarBin = process.platform === 'win32' && existsSync('C:\\Windows\\System32\\tar.exe')
    ? 'C:\\Windows\\System32\\tar.exe'
    : 'tar'
  const r = spawnSync(tarBin, ['-xzf', snapshot, '-C', out, '.claude/shared-brain'], { encoding: 'utf8', windowsHide: true })
  const brain = join(out, '.claude', 'shared-brain')
  if (r.status !== 0 || !existsSync(brain)) {
    throw new Error(`could not extract .claude/shared-brain from ${snapshot}: ${(r.stderr || '').trim()}`)
  }
  return brain
}

/** Copy the repository scaffolding (.gitattributes, .gitignore) into a tree. */
function copyScaffold(from, to) {
  for (const f of ['.gitattributes', '.gitignore']) {
    if (existsSync(join(from, f))) cpSync(join(from, f), join(to, f))
  }
}

export function seed(dir, { snapshot, label = 'clone base', toolingFrom = dirname(HERE) } = {}) {
  if (isRepo(dir)) throw new Error(`${dir} is already a git repository`)
  if (!snapshot) throw new Error('seed needs --snapshot <dir|tar.gz>')

  const users = knownUsers(dir)
  const snapDir = materializeSnapshot(snapshot)

  // Work on a copy of the snapshot: normalising must never write to the source.
  const base = mkdtempSync(join(tmpdir(), 'brain-base-'))
  cpSync(snapDir, base, { recursive: true })
  rmSync(join(base, '.git'), { recursive: true, force: true })
  copyScaffold(toolingFrom, base)
  normalizeTree(base, users)

  must(git(dir, ['init', '-q', '-b', DEFAULT_BRANCH]), 'git init')
  configure(dir)

  // 1. The snapshot, committed from its own work tree so the live brain is untouched.
  must(git(dir, [`--work-tree=${base}`, 'add', '-A']), 'git add (snapshot)')
  must(git(dir, [`--work-tree=${base}`, 'commit', '--no-verify', '-q', '-m', `brain: snapshot (${label})`]), 'git commit (snapshot)')

  // 2. This machine's brain as it is now, on top of the snapshot.
  copyScaffold(toolingFrom, dir)
  normalizeTree(dir, users)
  commitLocal(dir, `brain: ${hostname()} state since the snapshot`, ['.', ':!.sync'])

  // 3. The tooling, if it is not already in place.
  if (toolingFrom !== dir && !existsSync(join(dir, '.sync', 'brain-sync.mjs'))) {
    cpSync(join(toolingFrom, '.sync'), join(dir, '.sync'), { recursive: true })
  }
  commitLocal(dir, 'brain: add sync tooling')
  configure(dir)

  rmSync(base, { recursive: true, force: true })
  return writeState(dir, {
    result: 'seeded',
    commits: git(dir, ['rev-list', '--count', 'HEAD']).out,
    conflicts: [],
  })
}

// ---------------------------------------------------------------------------
// join - attach an unsynced brain to an existing remote
// ---------------------------------------------------------------------------

export function join_(dir, { remote, backupRoot = dirname(dir) } = {}) {
  if (isRepo(dir)) throw new Error(`${dir} is already a git repository`)
  if (!remote) throw new Error('join needs --remote <url>')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = join(backupRoot, `${basename(dir)}.pre-sync-${stamp}`)
  cpSync(dir, backup, { recursive: true })

  try {
    must(git(dir, ['init', '-q', '-b', DEFAULT_BRANCH]), 'git init')
    configure(dir)
    must(git(dir, ['remote', 'add', 'origin', remote]), 'git remote add')
    must(git(dir, ['fetch', '--quiet', 'origin'], { timeout: 180_000 }), 'git fetch')
    const upstream = `origin/${DEFAULT_BRANCH}`
    must(git(dir, ['rev-parse', '--verify', upstream]), `find ${upstream}`)

    const roots = git(dir, ['rev-list', '--max-parents=0', upstream]).out.split('\n').filter(Boolean)
    if (roots.length !== 1) throw new Error(`expected one snapshot root on ${upstream}, found ${roots.length}`)
    const root = roots[0]

    // Point the branch at the snapshot without touching the working tree: the
    // files on disk are this machine's copy, and they are what gets committed.
    must(git(dir, ['reset', '-q', root]), 'git reset to snapshot')
    must(git(dir, ['checkout', root, '--', '.gitattributes', '.gitignore']), 'restore scaffold')
    normalizeTree(dir)
    commitLocal(dir, `brain: ${hostname()} state since the snapshot`, ['.', ':!.sync'])

    const conflicts = mergeRef(dir, upstream, 'remote')
    git(dir, ['branch', '--set-upstream-to', upstream])
    configure(dir)
    return writeState(dir, { result: 'joined', backup, conflicts, ...aheadBehind(dir, upstream) })
  } catch (error) {
    // Put the directory back exactly as it was: empty it, then restore the copy.
    for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true })
    cpSync(backup, dir, { recursive: true })
    throw new Error(`${error.message} (brain restored from ${backup})`)
  }
}

// ---------------------------------------------------------------------------
// verifyPublish - the pre-push gate
// ---------------------------------------------------------------------------

/**
 * Secret shapes. Built from parts so this file never matches its own patterns.
 * A match anywhere in the tree being pushed blocks the push.
 */
const SECRET_SHAPES = [
  ['sk-ant-', '[A-Za-z0-9_-]{20,}'],
  ['sk-or-v1-', '[a-f0-9]{32,}'],
  ['sk-', '(?:proj-)?[A-Za-z0-9]{32,}'],
  ['gh' + 'p_', '[A-Za-z0-9]{30,}'],
  ['github_' + 'pat_', '[A-Za-z0-9_]{30,}'],
  ['AK' + 'IA', '[0-9A-Z]{16}'],
  ['AI' + 'za', '[0-9A-Za-z_-]{35}'],
  ['nv' + 'api-', '[A-Za-z0-9_-]{30,}'],
  ['xo' + 'x[baprs]-', '[A-Za-z0-9-]{10,}'],
  ['-----BEGIN ' + '(?:RSA |EC |OPENSSH |DSA )?PRIVATE', ' KEY-----'],
].map(([head, tail]) => new RegExp(`${head}${tail}`))

/**
 * Check the tree a push would publish. Returns the problems; empty means publish.
 *
 * This is what makes the brain pushable by either gatekeeper: the PowerShell one
 * refuses any repository without a pre-push hook, and a hook that checks nothing
 * would be a formality. These three are the ways a brain push can do harm.
 */
export function verifyPublish(dir, sha = 'HEAD') {
  const problems = []
  const users = knownUsers(dir)
  const files = git(dir, ['ls-tree', '-r', '--name-only', sha]).out.split('\n').filter(Boolean)
  for (const path of files) {
    const blob = readRawBlob(dir, `${sha}:${path}`)
    if (blob.includes('\0')) continue
    const isNote = path.toLowerCase().endsWith('.md') && !path.startsWith('.sync/')
    if (isNote && !LITERAL_PATH_FILES.has(path) && normalizeText(blob, users) !== blob) {
      problems.push(`${path}: names a home folder (C:\\Users\\<name>); write ~ instead`)
    }
    if (isNote && /^(<{7}|>{7}) /m.test(blob)) {
      problems.push(`${path}: contains an unresolved merge-conflict marker`)
    }
    for (const shape of SECRET_SHAPES) {
      const m = shape.exec(blob)
      if (m) { problems.push(`${path}: looks like a credential (${m[0].slice(0, 8)}…)`); break }
    }
  }
  if (files.includes('push-requests.md') && !readRawBlob(dir, `${sha}:push-requests.md`).includes(QUEUE_MARKER)) {
    problems.push('push-requests.md: the REQUESTS BELOW THIS LINE marker is missing; both gatekeepers need it')
  }
  return problems
}

// ---------------------------------------------------------------------------
// install - wire session start to the sync, on this machine
// ---------------------------------------------------------------------------

const HOOK_NAME = 'dsh-memory-index.mjs'
/** Sync, the Codex rule render and the index together; the old 10s cap was for the index alone. */
const HOOK_TIMEOUT_SECONDS = 45
/** Injects long-session/context/quota handoff instructions; see quota-handoff-protocol.md. */
const QUOTA_HOOK_NAME = 'quota-handoff.mjs'
const QUOTA_HOOK_EVENTS = ['UserPromptSubmit', 'PostToolUse']
/** Where the clone restores the user-operated PowerShell gatekeeper, under the home folder. */
const GATEKEEPER_DIR = ['Documents', 'Codex', '2026-09-07', 'can-you-check-the-agent-history', 'outputs', 'gatekeeper']
const GATEKEEPER_FILES = ['Gatekeeper.ps1', 'queue-build.mjs']
/** FCC controller and DSH health monitor, shipped from .sync/dsh into each host's DSH home. */
const DSH_SHIPPED_FILES = ['fcc-control.ps1', 'fcc-session.cjs']
const LISTENER_NAME = 'SharedBrainListener.ps1'

/**
 * Install the session-start hook that ships with the notes, and give it room
 * to run. Idempotent: a second run changes nothing and says so.
 *
 * The hook and settings live outside the brain, in ~/.claude, so they cannot
 * travel by merge alone. Shipping the hook inside the repository and installing
 * it from there is what keeps every machine on the same version.
 */
export function install(dir, options = {}) {
  const claudeHome = options.claudeHome ?? join(homedir(), '.claude')
  const dshHome = options.dshHome ?? defaultDshHome(options.claudeHome)
  const changes = []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  // The master rule set first: the DSH render below carries CLAUDE.md verbatim.
  try {
    const rules = syncRules(dir, { claudeHome, stamp })
    if (rules.status === 'pushed') changes.push('collected the master rules (CLAUDE.md) into the brain')
    if (rules.status === 'pulled') {
      changes.push(`replaced this machine's CLAUDE.md with the master rules from the brain (previous copy: ${rules.backup ?? 'none'})`)
      // Codex's copy is rendered by the session hook before this sync runs, so
      // render it again now rather than a session late. Real homes only.
      const renderer = join(claudeHome, 'hooks', 'sync-agent-rules.mjs')
      if (options.claudeHome === undefined && existsSync(renderer)) {
        spawnSync(process.execPath, [renderer, '--json'], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
      }
    }
  } catch (error) {
    changes.push(`WARNING: the master rules were not synced: ${error.message}`)
  }

  // Files that live in ~/.claude but must be the same on every machine, so they
  // ship in the brain and are installed from it. An existing file is backed up
  // beside itself before it is replaced.
  // The PowerShell gatekeeper reads the same push queue on every machine, so it
  // has to agree with the other machines' gatekeepers on which requests are its
  // own. Updated only where it is already installed.
  const gatekeeperDir = join(options.userHome ?? dirname(claudeHome), ...GATEKEEPER_DIR)
  const shipped = [
    [join(dir, '.sync', 'claude-hook', HOOK_NAME), join(claudeHome, 'hooks', HOOK_NAME)],
    [join(dir, '.sync', 'claude-agents', 'git-gatekeeper.md'), join(claudeHome, 'agents', 'git-gatekeeper.md')],
    [join(dir, '.sync', 'claude-hook', QUOTA_HOOK_NAME), join(claudeHome, 'hooks', QUOTA_HOOK_NAME)],
    ...(existsSync(gatekeeperDir)
      ? GATEKEEPER_FILES.map(name => [join(dir, '.sync', 'gatekeeper', name), join(gatekeeperDir, name)])
      : []),
    // The FCC controller and the DSH health monitor live only in each host's
    // DSH home; no repository carries them. Updated only where DSH is installed.
    ...(existsSync(dshHome)
      ? DSH_SHIPPED_FILES.map(name => [join(dir, '.sync', 'dsh', name), join(dshHome, name)])
      : []),
  ]
  for (const [source, target] of shipped) {
    if (!existsSync(source)) continue
    const name = basename(target)
    const wanted = readFileSync(source, 'utf8')
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    // Line endings alone are not a difference: a clone may check the source out
    // with CRLF on one machine and LF on another, and replacing a file over that
    // would swap it back and forth on every install.
    if (current !== null && current.replace(/\r\n/g, '\n') === wanted.replace(/\r\n/g, '\n')) continue
    mkdirSync(dirname(target), { recursive: true })
    if (current !== null) {
      const backup = `${target}.pre-brain-sync-${stamp}`
      writeFileSync(backup, current)
      changes.push(`backed up ${name} to ${basename(backup)}`)
    }
    writeFileSync(target, wanted)
    changes.push(`installed ${name}`)
  }

  // One per-machine startup entry keeps the brain current even when an agent
  // has no session hook (notably Codex desktop). The listener is idempotent and
  // its named mutex prevents duplicate background instances.
  const userHome = options.userHome ?? dirname(claudeHome)
  const startup = join(userHome, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  const listenerSource = join(dir, '.sync', LISTENER_NAME)
  if (existsSync(listenerSource)) {
    const listenerTarget = join(claudeHome, 'hooks', LISTENER_NAME)
    const wanted = readFileSync(listenerSource, 'utf8')
    mkdirSync(dirname(listenerTarget), { recursive: true })
    if (!existsSync(listenerTarget) || readFileSync(listenerTarget, 'utf8').replace(/\r\n/g, '\n') !== wanted.replace(/\r\n/g, '\n')) {
      writeFileSync(listenerTarget, wanted)
      changes.push(`installed ${LISTENER_NAME}`)
    }
    mkdirSync(startup, { recursive: true })
    const startupFile = join(startup, 'Shared-Agent-Listeners.cmd')
    const gatekeeper = join(userHome, ...GATEKEEPER_DIR, 'Gatekeeper.ps1')
    // A serving host has already published relay/llm-targets/<host>.json via
    // llama-relay.mjs setup/publish (see that file). That is the only signal
    // that distinguishes a host that should run `llama-relay.mjs serve` from
    // every other machine the brain syncs to, which only ever `connect`s.
    // Without this gate, this block was overwriting a hand-added relay-serve
    // line back out on every sync tick (the actual cause of the "silent
    // revert" chased across handoff-2026-09-18-0121-local-llm-routing-targets):
    // the template here is authoritative and rewrites the file whenever it
    // differs, so any addition not reflected in the template was transient.
    const relayScript = join(dir, '.sync', 'llama-relay.mjs')
    const relayPublished = join(dir, 'relay', 'llm-targets', `${hostname().toLowerCase()}.json`)
    const relayServeLine = 'start "Llama Relay" /min node "%USERPROFILE%\\.claude\\shared-brain\\.sync\\llama-relay.mjs" serve'
    const startupBody = [
      '@echo off',
      'start "Shared brain" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%USERPROFILE%\\.claude\\hooks\\SharedBrainListener.ps1"',
      ...(existsSync(gatekeeper) ? ['start "Git gatekeeper" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%USERPROFILE%\\Documents\\Codex\\2026-09-07\\can-you-check-the-agent-history\\outputs\\gatekeeper\\Gatekeeper.ps1"'] : []),
      ...(existsSync(relayScript) && existsSync(relayPublished) ? [relayServeLine] : []),
      '',
    ].join('\r\n')
    if (!existsSync(startupFile) || readFileSync(startupFile, 'utf8') !== startupBody) {
      writeFileSync(startupFile, startupBody)
      changes.push('installed continuous shared-brain and gatekeeper startup listener')
    }
  }

  // One click to bring DSH up to date: a Desktop launcher for the updater that
  // ships in the brain. Only where DSH is installed; rewritten only if it differs.
  const desktop = join(options.userHome ?? dirname(claudeHome), 'Desktop')
  if (existsSync(dshHome) && existsSync(desktop) && existsSync(join(dir, '.sync', 'UPDATE-DSH.cmd'))) {
    const shortcut = join(desktop, 'UPDATE-DSH.cmd')
    const body = [
      '@echo off',
      'REM Installed by the shared brain. The updater itself lives in the brain and updates with it.',
      `call "${join(dir, '.sync', 'UPDATE-DSH.cmd')}" %*`,
      '',
    ].join('\r\n')
    if (!existsSync(shortcut) || readFileSync(shortcut, 'utf8') !== body) {
      writeFileSync(shortcut, body)
      changes.push('placed UPDATE-DSH.cmd on the Desktop')
    }
  }

  const settingsPath = join(claudeHome, 'settings.json')
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf8')
    const settings = JSON.parse(raw)
    let found = false
    let bumped = false
    for (const group of settings?.hooks?.SessionStart ?? []) {
      for (const hook of group?.hooks ?? []) {
        if (typeof hook?.command === 'string' && hook.command.includes(HOOK_NAME)) {
          found = true
          if ((hook.timeout ?? 0) < HOOK_TIMEOUT_SECONDS) { hook.timeout = HOOK_TIMEOUT_SECONDS; bumped = true }
        }
      }
    }
    // The quota handoff hook has to fire on every prompt and tool call, which
    // no merge can wire: add it to settings.json where it is missing.
    const wired = []
    const quotaHook = join(claudeHome, 'hooks', QUOTA_HOOK_NAME)
    if (existsSync(quotaHook)) {
      settings.hooks ??= {}
      for (const event of QUOTA_HOOK_EVENTS) {
        const groups = (settings.hooks[event] ??= [])
        const present = groups.some(group => (group?.hooks ?? []).some(hook => typeof hook?.command === 'string' && hook.command.includes(QUOTA_HOOK_NAME)))
        if (present) continue
        groups.push({ hooks: [{ type: 'command', command: `node "${quotaHook.replaceAll('\\', '/')}"`, timeout: 10 }] })
        wired.push(event)
      }
    }
    if (bumped || wired.length > 0) {
      writeFileSync(`${settingsPath}.pre-brain-sync-${stamp}`, raw)
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
      JSON.parse(readFileSync(settingsPath, 'utf8'))
      if (bumped) changes.push(`raised the ${HOOK_NAME} SessionStart timeout to ${HOOK_TIMEOUT_SECONDS}s (settings.json backed up)`)
      if (wired.length > 0) changes.push(`wired ${QUOTA_HOOK_NAME} to ${wired.join(' and ')} (settings.json backed up)`)
    }
    if (!found) changes.push(`WARNING: no SessionStart hook in settings.json runs ${HOOK_NAME}; sync will not run at session start`)
  } else {
    changes.push('WARNING: no settings.json found; sync will not run at session start')
  }

  // DeepSeek Harness has no session-start hook of its own. Every DSH agent loads
  // $DSH_HOME/AGENTS.md into its session, so the brain reaches DSH through that
  // file, and the launcher refreshes it before DSH starts.
  if (existsSync(dshHome)) {
    // Collect before rendering: a first collection adds the two notes to the
    // index, and the render carries that index into DSH.
    const collected = collectDsh(dir, { dshHome })
    if (collected.runs > 0 || collected.facts > 0) {
      changes.push(`collected ${collected.runs} DSH run(s) and ${collected.facts} remembered fact(s) into the brain`)
    }
    try {
      const presets = syncDshPresets(dir, { dshHome, stamp })
      if (presets.pushed.length > 0) changes.push(`collected DSH saved run(s) into the brain: ${presets.pushed.join(', ')}`)
      if (presets.pulled.length > 0) changes.push(`restored DSH saved run(s) from another machine: ${presets.pulled.join(', ')} (DSH lists them from its next launch)`)
      if (presets.unshared.length > 0) changes.push(`removed DSH saved run(s) deleted on this machine from the brain: ${presets.unshared.join(', ')}`)
      if (presets.removed.length > 0) changes.push(`removed DSH saved run(s) deleted on another machine: ${presets.removed.join(', ')}`)
    } catch (error) {
      changes.push(`WARNING: DSH saved runs were not synced: ${error.message}`)
    }
    try {
      const credentials = syncDshCredentials(dir, { dshHome, claudeHome, stamp })
      saveStatusPart(dir, 'dshCredentials', credentials.status)
      if (credentials.status === 'no-key') {
        changes.push(`WARNING: the brain carries DSH credentials (the OpenRouter key among them) but this machine has no brain key; put CLONE-KEY.txt on the Desktop, or the key in ~/.claude/${BRAIN_KEY_NAME}`)
      } else if (credentials.status === 'unreadable') {
        changes.push(`WARNING: this machine's brain key does not open ${DSH_CREDENTIALS_BLOB}; DSH credentials were not synced`)
      } else if (credentials.status === 'synced') {
        if (credentials.blobWritten) changes.push(`collected DSH credential ref(s) into the brain, encrypted: ${credentials.pushed.join(', ') || 'merged'}`)
        if (credentials.pulled.length > 0) changes.push(`restored DSH credential ref(s) from another machine: ${credentials.pulled.join(', ')} (restart DSH to load them)`)
      }
    } catch (error) {
      changes.push(`WARNING: DSH credentials were not synced: ${error.message}`)
    }
    const rendered = renderDsh(dir, { claudeHome, dshHome })
    if (rendered.status === 'created' || rendered.status === 'rewritten') changes.push(`${rendered.status} AGENTS.md for DSH agents`)
    const launcher = patchDshLauncher(dshHome, stamp)
    if (launcher !== null) changes.push(launcher)
    const dshRepo = readReposManifest(dir).find(entry => entry.build === 'dsh')
    const dshPath = dshRepo === undefined ? null : expandHome(dshRepo.path, userHome)
    if (dshPath !== null) {
      if (seedBuiltMarker(dshPath, dshHome)) changes.push('recorded the current DSH build as up to date (.built-commit)')
      const builder = patchDshLauncherBuild(dshHome, stamp)
      if (builder !== null) changes.push(builder)
    }
  }

  // Fleet: the brain key (kept on the keys branch for machines that lack it) and
  // the sealed secret files named in fleet/secrets.json.
  try {
    const found = findBrainKey({ claudeHome, home: userHome, dir })
    saveStatusPart(dir, 'brainKey', found === null ? 'missing' : found.opens === false ? 'does-not-open-credentials' : 'present')
    if (found?.backup) changes.push(`replaced this machine's brain key with the one that opens ${DSH_CREDENTIALS_BLOB} (from ${found.source}; old key backed up beside it)`)
    else if (found?.copied) changes.push(`installed the brain key from ${found.source}`)
    if (found !== null && found.opens !== false && shareBrainKey(dir, found.key)) changes.push('put the brain key on the keys branch for machines that lack it')
    const secrets = syncSecretFiles(dir, { key: found?.key, home: userHome, claudeHome, stamp })
    saveStatusPart(dir, 'secrets', secrets)
    const by = state => secrets.files.filter(file => file.state === state).map(file => file.id)
    if (by('shared').length) changes.push(`sealed secret file(s) into the brain: ${by('shared').join(', ')}`)
    if (by('restored').length) changes.push(`restored secret file(s) from another machine: ${by('restored').join(', ')} (previous copies backed up)`)
    if (by('shared-both-changed').length) changes.push(`WARNING: secret file(s) changed on two machines at once; this machine's copy was shared and the other kept beside it as .from-brain-*: ${by('shared-both-changed').join(', ')}`)
    if (by('differs').length) changes.push(`WARNING: secret file(s) differ from the brain's copy on first contact and were left alone: ${by('differs').join(', ')} (fleet.mjs take-secret <id> takes the brain's)`)
    if (by('unreadable').length) changes.push(`WARNING: this machine's brain key does not open sealed secret file(s): ${by('unreadable').join(', ')}`)
    if (secrets.status === 'no-key') changes.push('WARNING: the brain carries sealed secret files but this machine has no brain key')
  } catch (error) {
    changes.push(`WARNING: fleet secrets were not synced: ${error.message}`)
  }

  return { result: changes.length ? 'installed' : 'already-installed', changes }
}

// ---------------------------------------------------------------------------
// dsh - carry the brain and the standing rules into DeepSeek Harness
// ---------------------------------------------------------------------------

const DSH_BEGIN = '<!-- BEGIN SHARED-BRAIN -->'
const DSH_END = '<!-- END SHARED-BRAIN -->'
/** What marks a launcher that already refreshes the brain. */
const DSH_LAUNCH_MARK = 'brain-sync.mjs" dsh'

const DSH_PREAMBLE = [
  '# AGENTS.md - user-global instructions for DeepSeek Harness',
  '',
  'DSH loads this file into every agent session on this machine. The section between',
  'the SHARED-BRAIN markers is generated; anything written outside them is kept.',
].join('\n')

/**
 * Where DSH keeps its home. Beside an explicit Claude home when one is given, so
 * a test or a rehearsal never reaches the real one.
 */
function defaultDshHome(claudeHome) {
  if (claudeHome !== undefined) return join(dirname(claudeHome), '.dsh')
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

const lf = text => text.replace(/\r\n/g, '\n')

/**
 * The generated section of $DSH_HOME/AGENTS.md: the brain, its index, and the
 * standing rules from ~/.claude/CLAUDE.md. Only stable content goes in - no sync
 * status, no counts - because DSH re-reads the file when it changes, and a
 * section that moved every session would re-inject itself into every session.
 */
export function renderDshBlock(dir, claudeHome) {
  let rules = ''
  try { rules = lf(readFileSync(join(claudeHome, 'CLAUDE.md'), 'utf8')).trim() } catch {}
  let index = ''
  try { index = lf(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).trim() } catch {}
  const store = dir.split('\\').join('/')
  return [
    DSH_BEGIN,
    '<!--',
    '  GENERATED by the shared brain (.sync/brain-sync.mjs) from ~/.claude/CLAUDE.md and',
    "  the brain's MEMORY.md. Rewritten at every Claude Code session start and every DSH",
    '  launch, so an edit between these markers does not survive: change a rule in',
    '  ~/.claude/CLAUDE.md, and a note in the brain. Text outside the markers is kept.',
    '-->',
    '',
    '# Shared brain and standing rules',
    '',
    'Every agent on this machine - Claude Code, Codex, and every DeepSeek Harness agent,',
    'council seat and swarm worker - works from one memory store and one set of standing',
    'rules. This section carries both into DSH.',
    '',
    '## The shared brain',
    '',
    `Store: ${store}`,
    '',
    '- The index below names every note, one line each. Before working on anything a note',
    '  covers - the council, the harness, the plugins, FCC, a push, a project it names -',
    '  read that note file from the store. Treat notes as decisions already made.',
    '- `shared-agent-log.md` is the cross-agent timeline. Read its newest entries before',
    '  starting work. Append an entry, signed with your model name, when work lands,',
    '  commits are made or a council run decides something - never for reads.',
    '- A lasting fact goes in one note file, with the frontmatter the other notes use,',
    '  plus one line in `MEMORY.md` under its heading. Update an existing note rather than',
    '  adding a duplicate. Inside notes write home paths as `~`: the brain is shared with',
    '  other machines through git, and each has a different user folder.',
    '- Never run `git push`. Commit locally and file a request in `push-requests.md`, as',
    '  the standing rules below say.',
    '',
    '### Index (MEMORY.md)',
    '',
    index || '_The index could not be read._',
    '',
    '## Standing rules',
    '',
    "The user's own standing instructions, written for Claude Code and reproduced verbatim",
    "so every agent runs on one set of rules. They are in the user's first person: \"I\" and",
    '"my" are the user, not you. Where they say Claude Code, read it as whichever agent is',
    'running, and name yourself by your model.',
    '',
    '---',
    '',
    rules || '_~/.claude/CLAUDE.md could not be read._',
    '',
    DSH_END,
  ].join('\n')
}

/**
 * Write the generated section into $DSH_HOME/AGENTS.md. Creates the file when
 * DSH is installed and the file is missing, replaces only the marked section
 * when it exists, and appends the section - after a backup - to an AGENTS.md
 * someone wrote by hand. Does nothing on a machine without DSH.
 */
export function renderDsh(dir, options = {}) {
  const claudeHome = options.claudeHome ?? join(homedir(), '.claude')
  const dshHome = options.dshHome ?? defaultDshHome(options.claudeHome)
  const target = join(dshHome, 'AGENTS.md')
  if (!existsSync(dshHome)) return { status: 'no-dsh', path: target }
  const block = renderDshBlock(dir, claudeHome)
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null
  let next
  let adopted = false
  if (current === null) {
    next = `${DSH_PREAMBLE}\n\n${block}\n`
  } else {
    const text = lf(current)
    const start = text.indexOf(DSH_BEGIN)
    const stop = text.indexOf(DSH_END)
    if (start !== -1 && stop > start) {
      next = text.slice(0, start) + block + text.slice(stop + DSH_END.length)
    } else {
      next = `${text.trimEnd()}\n\n${block}\n`
      adopted = true
    }
    if (next === text) return { status: 'in-sync', path: target, bytes: Buffer.byteLength(text) }
  }
  if (adopted) writeFileSync(`${target}.pre-brain-sync-${new Date().toISOString().replace(/[:.]/g, '-')}`, current)
  writeFileSync(target, next)
  return { status: current === null ? 'created' : 'rewritten', path: target, bytes: Buffer.byteLength(next) }
}

/**
 * Make the DSH launcher sync the brain and refresh AGENTS.md before DSH starts,
 * so a machine that only runs DSH still receives the other machines' notes.
 * The line never blocks the launch: output is discarded and a failed sync
 * leaves the last render in place.
 * @returns a change line, a warning, or null when there was nothing to do.
 */
function patchDshLauncher(dshHome, stamp) {
  const launch = join(dshHome, 'launch-dsh.cmd')
  if (!existsSync(launch)) return null
  const raw = readFileSync(launch, 'utf8')
  if (raw.includes(DSH_LAUNCH_MARK)) return null
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  let at = lines.findIndex(line => /^node\s+"%~dp0fcc-session\.cjs"/i.test(line.trim()))
  if (at === -1) at = lines.findIndex(line => /^echo\s+Starting DSH/i.test(line.trim()))
  if (at === -1) return 'WARNING: launch-dsh.cmd has no recognisable start line; DSH launches will not sync the brain'
  lines.splice(at, 0,
    "REM Shared brain: merge the other machines' notes and refresh AGENTS.md before any",
    'REM DSH agent starts. Never blocks the launch. Installed by brain-sync.mjs.',
    'if exist "%USERPROFILE%\\.claude\\shared-brain\\.sync\\brain-sync.mjs" node "%USERPROFILE%\\.claude\\shared-brain\\.sync\\brain-sync.mjs" dsh --timeout 6000 >nul 2>&1',
    '',
  )
  writeFileSync(`${launch}.pre-brain-sync-${stamp}`, raw)
  writeFileSync(launch, lines.join(eol))
  return 'launch-dsh.cmd now syncs the brain before DSH starts (backed up)'
}

/** What marks a launcher that already rebuilds a stale checkout. */
const DSH_BUILD_MARK = 'fleet.mjs" build'

/**
 * Rebuild before launch: right after the launcher changes into the checkout, and
 * before its missing-bundle check, so a checkout the fleet sync pulled forward
 * (or never built) is built rather than launched stale. Output is shown, since a
 * build takes minutes; a failed build still launches the previous bundle.
 */
export function patchDshLauncherBuild(dshHome, stamp) {
  const launch = join(dshHome, 'launch-dsh.cmd')
  if (!existsSync(launch)) return null
  const raw = readFileSync(launch, 'utf8')
  if (raw.includes(DSH_BUILD_MARK)) return null
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  const at = lines.findIndex(line => /^cd\s+\/d\s+/i.test(line.trim()))
  if (at === -1) return 'WARNING: launch-dsh.cmd has no cd /d line; DSH launches will not rebuild a stale checkout'
  lines.splice(at + 1, 0,
    '',
    'REM Fleet: rebuild when HEAD moved past the last build (pulled by the brain sync or by hand).',
    'REM Installed by brain-sync.mjs.',
    'if exist "%USERPROFILE%\\.claude\\shared-brain\\.sync\\fleet.mjs" node "%USERPROFILE%\\.claude\\shared-brain\\.sync\\fleet.mjs" build',
  )
  writeFileSync(`${launch}.pre-brain-sync-${stamp}`, raw)
  writeFileSync(launch, lines.join(eol))
  return 'launch-dsh.cmd now rebuilds DSH when its checkout moved past the last build (backed up)'
}

// ---------------------------------------------------------------------------
// dsh state - saved runs and remembered facts, collected into the brain
// ---------------------------------------------------------------------------
//
// DSH keeps both on the machine that produced them: run records in
// $DSH_HOME/council-runs, remembered facts in the digest it renders for its
// seats. Neither travelled, so a run saved on one machine was invisible on
// every other. These notes are the shared copy: one line per run and per fact,
// union-merged, appended and never edited. DSH appends as it goes; this
// collection also catches everything already on disk, including runs made
// before a machine joined the brain.

const DSH_RUNS_NOTE = 'dsh-runs.md'
const DSH_FACTS_NOTE = 'dsh-memory.md'
const DSH_APPEND_MARKER = '<!-- ENTRIES BELOW THIS LINE -->'

const DSH_RUNS_HEADER = [
  '---',
  'name: dsh-runs',
  'description: Council, pipeline and swarm runs saved on any machine - one line each, appended by DSH and by the brain sync',
  'metadata:',
  '  type: reference',
  '---',
  '',
  '# DSH saved runs',
  '',
  'One line per finished run, from every machine that shares this brain. The full',
  'record stays where it was made, at `~/.dsh/council-runs/<id>.json` on the machine',
  'the line names; this file is what makes the run visible everywhere. Written when',
  'DSH files a run, and again by the brain sync at every session start and DSH',
  'launch, so runs made before a machine joined are picked up too.',
  '',
  'Lines are appended, never edited or reordered: the file merges by union, so two',
  'machines writing at once both keep their lines.',
  '',
  DSH_APPEND_MARKER,
  '',
].join('\n')

const DSH_FACTS_HEADER = [
  '---',
  'name: dsh-memory',
  'description: Facts DSH agents remembered on any machine - the shared copy of every machine\'s memory digest',
  'metadata:',
  '  type: reference',
  '---',
  '',
  '# DSH remembered facts',
  '',
  'What DSH agents wrote with `memory_write`, from every machine that shares this',
  'brain. Each line names the machine it was remembered on and carries the id DSH',
  'derives from the text, so the same fact remembered twice appears once.',
  '',
  'Appended, never edited: the file merges by union. A fact that is wrong is',
  'corrected by remembering the correction, not by rewriting history here.',
  '',
  DSH_APPEND_MARKER,
  '',
].join('\n')

/**
 * The id DSH's memory tools derive from a fact's text. Kept identical to
 * `idFor` in the harness's agent-memory tools, so a line this collection writes
 * and a line DSH writes for the same fact carry the same id and appear once.
 */
export function dshFactId(text) {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) | 0
  return `m${(hash >>> 0).toString(36)}`
}

/**
 * Append the lines whose marker the note does not already carry.
 * @returns how many lines were added.
 */
function appendNoteLines(path, header, entries, users) {
  if (entries.length === 0) return 0
  if (!existsSync(path)) writeFileSync(path, header)
  const text = readFileSync(path, 'utf8')
  const seen = new Set()
  // A DSH fact or query often names the machine it was written on
  // (C:\Users\<name>\...). These notes are shared, and the pre-push gate refuses
  // a home path in one, so every line is normalised as it is written.
  for (const entry of entries) entry.line = normalizeText(entry.line, users)
  const fresh = entries.filter(({ key, line }) => {
    if (text.includes(key) || seen.has(key)) return false
    seen.add(key)
    return typeof line === 'string' && line !== ''
  })
  if (fresh.length === 0) return 0
  const body = fresh.map(({ line }) => line).join('\n')
  writeFileSync(path, `${text.replace(/\s*$/, '')}\n${body}\n`)
  return fresh.length
}

/** One saved run as a line: what it was, which seats answered, on which machine. */
function dshRunLine(record, machine) {
  const at = new Date(typeof record.at === 'number' && record.at > 0 ? record.at : 0).toISOString().slice(0, 16).replace('T', ' ')
  const query = String(record.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || '(no query recorded)'
  const drafts = Array.isArray(record.drafts) ? record.drafts : []
  const reviews = Array.isArray(record.reviews) ? record.reviews : []
  const ok = drafts.filter(draft => draft?.error === undefined && draft?.text !== '').length
  const seats = (Array.isArray(record.seatIds) ? record.seatIds : []).join(' ') || 'unknown'
  const amendments = typeof record.amendments === 'number' ? record.amendments : 0
  return {
    key: `dsh-run id=${record.id}`,
    line: `- ${at}Z on ${machine} - "${query}" - seats: ${seats}; drafts ${ok}/${drafts.length}; reviews ${reviews.length}; amendments ${amendments} <!-- dsh-run id=${record.id} machine=${machine} -->`,
  }
}

/** Every fact in a DSH digest, as lines for the shared note. */
function dshFactLines(digest, machine, users) {
  const lines = []
  let kind = 'fact'
  for (const raw of digest.split(/\r?\n/)) {
    const heading = /^##\s+([A-Za-z][\w-]*)/.exec(raw)
    if (heading !== null) {
      kind = heading[1]
      continue
    }
    const bullet = /^-\s+(.+)$/.exec(raw.trim())
    if (bullet === null) continue
    const body = bullet[1].trim()
    if (body === '' || body.startsWith('_No memories')) continue
    const text = body.replace(/\s*_\([^)]*\)_\s*$/, '').trim()
    if (text === '') continue
    // Hash the NORMALISED text, never the raw digest line. A fact naming the
    // machine it was written on ("the harness at C:\Users\<name>\...") is the
    // same fact everywhere, but its raw text differs per machine: hashing first
    // gave every machine its own id, the dedupe missed, and one fact appeared
    // once per machine - identical on screen, since the line is normalised
    // before it is written. Found by Claude Opus 5 on vmixer2o2, 2026-09-12.
    const id = dshFactId(normalizeText(text, users))
    lines.push({
      key: `dsh-fact id=${id}`,
      line: `- [${kind}] ${body} - remembered on ${machine} <!-- dsh-fact id=${id} machine=${machine} -->`,
    })
  }
  return lines
}

/** Give the two DSH notes their index lines, once. */
function indexDshNotes(dir) {
  const path = join(dir, 'MEMORY.md')
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  const wanted = [
    [DSH_RUNS_NOTE, `- [DSH saved runs](${DSH_RUNS_NOTE}) - one line per council, pipeline or swarm run saved on any machine; the full record stays on that machine`],
    [DSH_FACTS_NOTE, `- [DSH remembered facts](${DSH_FACTS_NOTE}) - what DSH agents remembered, from every machine, as the digest rendered it`],
  ].filter(([note]) => !text.includes(`(${note})`))
  if (wanted.length === 0) return
  const heading = '## DSH, council, harness'
  const added = wanted.map(([, line]) => line).join('\n')
  writeFileSync(path, text.includes(heading)
    ? text.replace(heading, `${heading}\n${added}`)
    : `${text.replace(/\s*$/, '')}\n\n${heading}\n${added}\n`)
}

/**
 * Collect this machine's DSH runs and remembered facts into the brain.
 * Idempotent: a line already carrying the run or fact id is not written again.
 * @returns how many run and fact lines were added.
 */
export function collectDsh(dir, { dshHome, machine = hostname() } = {}) {
  const home = dshHome ?? defaultDshHome(undefined)
  const added = { runs: 0, facts: 0 }
  if (!existsSync(home) || !existsSync(dir)) return added
  const users = knownUsers(dir)
  const runsDir = join(home, 'council-runs')
  if (existsSync(runsDir)) {
    const records = []
    for (const name of readdirSync(runsDir)) {
      if (!name.endsWith('.json')) continue
      try {
        const record = JSON.parse(readFileSync(join(runsDir, name), 'utf8'))
        if (record !== null && typeof record === 'object' && typeof record.id === 'string') records.push(record)
      } catch {
        // A record that cannot be read is not worth failing a session start over.
      }
    }
    records.sort((left, right) => (left.at ?? 0) - (right.at ?? 0))
    added.runs = appendNoteLines(join(dir, DSH_RUNS_NOTE), DSH_RUNS_HEADER, records.map(record => dshRunLine(record, machine)), users)
  }
  const digest = join(home, 'memory', 'digest.md')
  if (existsSync(digest)) {
    try {
      added.facts = appendNoteLines(join(dir, DSH_FACTS_NOTE), DSH_FACTS_HEADER, dshFactLines(readFileSync(digest, 'utf8'), machine, users), users)
    } catch {
      // Same: a digest that cannot be read costs the collection, not the session.
    }
  }
  if (added.runs > 0 || added.facts > 0) indexDshNotes(dir)
  return added
}

// ---------------------------------------------------------------------------
// rules - one master CLAUDE.md for every agent on every machine
// ---------------------------------------------------------------------------
//
// ~/.claude/CLAUDE.md is the rule set Claude Code loads and the source Codex's
// and DSH's AGENTS.md are rendered from. It lived outside the brain, so a rule
// changed on one machine never reached another. The brain now carries it at
// rules/CLAUDE.md. An edit made here since the last sync is shared; otherwise
// this machine takes the brain's copy - on first contact too, because the point
// is one rule set, not one per machine. The replaced copy is backed up beside it.

/** Share or take the master rules. @returns status pushed | pulled | same | nothing. */
export function syncRules(dir, { claudeHome = join(homedir(), '.claude'), stamp = fileStamp() } = {}) {
  const localPath = join(claudeHome, 'CLAUDE.md')
  const sharedPath = join(dir, 'rules', 'CLAUDE.md')
  const statePath = join(claudeHome, '.rules-sync.json')
  const users = knownUsers(dir)
  const local = existsSync(localPath) ? normalizeText(readFileSync(localPath, 'utf8').replace(/\r\n/g, '\n'), users) : null
  const shared = existsSync(sharedPath) ? readFileSync(sharedPath, 'utf8').replace(/\r\n/g, '\n') : null
  if (local === null && shared === null) return { status: 'nothing' }
  const settle = text => writeFileSync(statePath, `${JSON.stringify({ digest: digestOf(text) }, null, 2)}\n`)
  if (local === shared) {
    settle(local)
    return { status: 'same' }
  }
  const synced = readSyncState(statePath).digest
  const editedHere = local !== null && synced !== undefined && synced !== digestOf(local)
  if (local !== null && (shared === null || editedHere)) {
    mkdirSync(dirname(sharedPath), { recursive: true })
    writeFileSync(sharedPath, local)
    settle(local)
    return { status: 'pushed' }
  }
  let backup = null
  mkdirSync(claudeHome, { recursive: true })
  if (existsSync(localPath)) {
    backup = `CLAUDE.md.pre-brain-sync-${stamp}`
    writeFileSync(join(claudeHome, backup), readFileSync(localPath, 'utf8'))
  }
  writeFileSync(localPath, shared)
  settle(shared)
  return { status: 'pulled', backup }
}

// ---------------------------------------------------------------------------
// dsh saved runs and credentials - carried between machines
// ---------------------------------------------------------------------------
//
// Two things DSH keeps only in its own home, so a second machine never had
// them: the pipeline panel's saved runs (`council.pipelinePresets` in
// settings.yaml) and the provider keys (`.credentials.yaml`, where the
// OpenRouter key lives). Saved runs travel as one text file per run under
// dsh-presets/. Credentials travel as one AES-256-GCM blob that only a machine
// holding the brain key can open; the key never enters the repository.
//
// Both follow one rule. A value this machine changed since the last sync is
// shared; a value it did not change takes the other machine's; a value that
// differs on first contact is left alone on both sides, so a machine-specific
// value is never overwritten. A sync never deletes: what is missing here is
// restored, not removed there.

const DSH_PRESETS_DIR = 'dsh-presets'
const DSH_CREDENTIALS_BLOB = 'dsh-credentials.enc'
const CREDENTIALS_MAGIC = 'BRAIN1'
const BRAIN_KEY_NAME = 'brain-secrets.key'
/** Kept equal to PRESET_ID in the harness's tool-council/src/presets.ts. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,31}\/[a-z0-9][a-z0-9-]{0,47}$/

const digestOf = text => createHash('sha256').update(text).digest('hex')
const fileStamp = () => new Date().toISOString().replace(/[:.]/g, '-')

function readSyncState(path) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'))
    return state !== null && typeof state === 'object' ? state : {}
  } catch {
    return {}
  }
}

/**
 * Decide, per id, what this machine shares and what it takes.
 * @param local - id -> value on this machine.
 * @param shared - id -> value in the brain.
 * @param synced - id -> digest of the value both held at the last sync.
 *
 * The last-sync digests double as tombstones. A run missing on one side that
 * the other side still holds exactly as it was last synced was deleted (or
 * renamed away) there, so the deletion travels instead of the run coming back.
 * A run changed since the last sync is never dropped: the edit wins over the
 * delete, and it is restored.
 */
function planExchange(local, shared, synced, { tombstones = false } = {}) {
  const push = []
  const pull = []
  const dropLocal = []
  const dropShared = []
  for (const [id, value] of local) {
    const held = shared.get(id)
    if (held === value) continue
    if (held === undefined) (tombstones && synced[id] === digestOf(value) ? dropLocal : push).push(id)
    else if (synced[id] === undefined) continue
    else if (synced[id] !== digestOf(value)) push.push(id)
    else pull.push(id)
  }
  for (const [id, value] of shared) {
    if (!local.has(id)) (tombstones && synced[id] === digestOf(value) ? dropShared : pull).push(id)
  }
  return { push, pull, dropLocal, dropShared }
}

/** Digests of every id both sides now hold identically. */
function settledState(local, shared, pulled) {
  const state = {}
  for (const [id, value] of shared) {
    const mine = pulled.includes(id) ? value : local.get(id)
    if (mine === value) state[id] = digestOf(value)
  }
  return state
}

/** Whether line `index` sits directly under the top-level `council:` key. */
function underCouncil(lines, index) {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (/^\S/.test(lines[at])) return /^council:\s*$/.test(lines[at])
  }
  return false
}

/**
 * The saved runs in a settings.yaml, as raw text chunks keyed by id.
 * Raw text, not parsed YAML: the brain tooling has no dependencies, and a chunk
 * copied line for line is exactly what DSH wrote, block scalars included.
 */
export function readPresetChunks(text) {
  const lines = text.split(/\r?\n/)
  const chunks = new Map()
  const start = lines.findIndex((line, index) => /^  pipelinePresets:\s*(\{\s*\})?\s*$/.test(line) && underCouncil(lines, index))
  if (start === -1) return { lines, start, end: -1, chunks }
  let end = start + 1
  while (end < lines.length && (lines[end].trim() === '' || /^ {3,}/.test(lines[end]))) end += 1
  while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
  let id = null
  let from = 0
  const close = at => { if (id !== null) chunks.set(id, { from, to: at, text: lines.slice(from, at).join('\n') }) }
  for (let index = start + 1; index < end; index += 1) {
    const key = /^ {4}(?:'([^']+)'|"([^"]+)"|([^\s'"][^:]*)):\s*$/.exec(lines[index])
    if (key === null) continue
    close(index)
    id = key[1] ?? key[2] ?? key[3]
    from = index
  }
  close(end)
  return { lines, start, end, chunks }
}

/** settings.yaml with these chunks added or replaced, and nothing else touched. */
export function writePresetChunks(text, updates) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let { lines, start, end, chunks } = readPresetChunks(text)
  if (start === -1) {
    const council = lines.findIndex(line => /^council:\s*$/.test(line))
    if (council === -1) {
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
      lines.push('council:', '  pipelinePresets:', '')
      start = lines.length - 2
    } else {
      lines.splice(council + 1, 0, '  pipelinePresets:')
      start = council + 1
    }
    ;({ lines, start, end, chunks } = readPresetChunks(lines.join('\n')))
  }
  lines[start] = '  pipelinePresets:'
  const added = [...updates].filter(([id]) => !chunks.has(id)).flatMap(([, chunk]) => chunk.split('\n'))
  lines.splice(end, 0, ...added)
  const replaced = [...updates].filter(([id]) => chunks.has(id)).sort(([a], [b]) => chunks.get(b).from - chunks.get(a).from)
  for (const [id, chunk] of replaced) {
    const { from, to } = chunks.get(id)
    lines.splice(from, to - from, ...chunk.split('\n'))
  }
  return lines.join(eol)
}

/** settings.yaml without these saved runs, and nothing else touched. */
export function removePresetChunks(text, ids) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const { lines, start, chunks } = readPresetChunks(text)
  const gone = [...ids].filter(id => chunks.has(id)).sort((a, b) => chunks.get(b).from - chunks.get(a).from)
  for (const id of gone) {
    const { from, to } = chunks.get(id)
    lines.splice(from, to - from)
  }
  // An empty block would read as null; DSH expects a map.
  if (start !== -1 && gone.length > 0 && gone.length === chunks.size) lines[start] = '  pipelinePresets: {}'
  return lines.join(eol)
}

/**
 * Exchange DSH's saved runs with the brain.
 * @returns the ids shared into the brain, restored from it, and deleted from
 * either side because the other side deleted them.
 */
export function syncDshPresets(dir, { dshHome, stamp = fileStamp() } = {}) {
  const settingsPath = join(dshHome, 'settings.yaml')
  const store = join(dir, DSH_PRESETS_DIR)
  if (!existsSync(settingsPath)) return { pushed: [], pulled: [], unshared: [], removed: [] }
  const users = knownUsers(dir)
  const text = readFileSync(settingsPath, 'utf8')
  const local = new Map([...readPresetChunks(text).chunks].map(([id, chunk]) => [id, normalizeText(chunk.text, users).replace(/\s+$/, '')]))
  const shared = new Map()
  if (existsSync(store)) {
    for (const area of readdirSync(store)) {
      if (!statSync(join(store, area)).isDirectory()) continue
      for (const name of readdirSync(join(store, area))) {
        if (name.endsWith('.yaml')) shared.set(`${area}/${name.slice(0, -5)}`, readFileSync(join(store, area, name), 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, ''))
      }
    }
  }
  const statePath = join(dshHome, '.presets-sync.json')
  const { push, pull, dropLocal, dropShared } = planExchange(local, shared, readSyncState(statePath), { tombstones: true })

  // Deleted here since the last sync: take it out of the brain too.
  const unshared = []
  for (const id of dropShared) {
    if (!PRESET_ID.test(id)) continue
    const [area, name] = id.split('/')
    rmSync(join(store, area, `${name}.yaml`), { force: true })
    if (readdirSync(join(store, area)).length === 0) rmSync(join(store, area), { recursive: true, force: true })
    shared.delete(id)
    unshared.push(id)
  }

  const pushed = []
  for (const id of push) {
    const value = local.get(id)
    // A saved run is a request written out by hand; one that quotes a key would
    // fail the pre-push gate for the whole brain, so it stays on this machine.
    if (!PRESET_ID.test(id) || SECRET_SHAPES.some(shape => shape.test(value))) continue
    const [area, name] = id.split('/')
    mkdirSync(join(store, area), { recursive: true })
    writeFileSync(join(store, area, `${name}.yaml`), `${value}\n`)
    shared.set(id, value)
    pushed.push(id)
  }
  const pulled = pull.filter(id => PRESET_ID.test(id))
  // Deleted on another machine since the last sync: take it out of settings.
  const removed = dropLocal.filter(id => PRESET_ID.test(id))
  for (const id of removed) local.delete(id)
  if (pulled.length > 0 || removed.length > 0) {
    writeFileSync(`${settingsPath}.pre-brain-sync-${stamp}`, text)
    const kept = removed.length > 0 ? removePresetChunks(text, removed) : text
    writeFileSync(settingsPath, pulled.length > 0 ? writePresetChunks(kept, new Map(pulled.map(id => [id, shared.get(id)]))) : kept)
  }
  // Both machines keep their own version of a run changed on both at once; the
  // other version is in history, so its sidecar carries nothing to reconcile.
  const sidecars = join(dir, '.sync-conflicts')
  if (existsSync(sidecars)) {
    for (const name of readdirSync(sidecars)) if (/\.yaml\.from-.+\.md$/.test(name)) rmSync(join(sidecars, name), { force: true })
  }
  writeFileSync(statePath, `${JSON.stringify(settledState(local, shared, pulled), null, 2)}\n`)
  return { pushed, pulled, unshared, removed }
}

/**
 * The brain key: 64 hex characters, never in the main history. A machine keeps it
 * at ~/.claude/brain-secrets.key. Other sources, in order: the brain's keys
 * branch (so a machine with repository access needs nothing carried by hand),
 * then the clone bundle's CLONE-KEY.txt wherever the migration left it - the
 * Desktop, or \clone on any drive.
 *
 * A stale key is worse than none: an old CLONE-KEY.txt no longer opens the
 * sealed credentials. When the brain carries dsh-credentials.enc, the first
 * candidate that actually opens it wins, and a key file it replaces is backed up.
 */
export function findBrainKey({ claudeHome, home, dir } = {}) {
  const base = home ?? (claudeHome === undefined ? homedir() : dirname(claudeHome))
  const kept = join(claudeHome ?? join(base, '.claude'), BRAIN_KEY_NAME)
  const hexIn = text => /\b([0-9a-fA-F]{64})\b/.exec(text)?.[1]?.toLowerCase() ?? null
  const fromFile = path => () => { try { return hexIn(readFileSync(path, 'utf8')) } catch { return null } }
  const sources = [
    ['file', kept, fromFile(kept)],
    ...(dir === undefined ? [] : [['keys-branch', null, () => keyFromHistory(dir)?.toString('hex') ?? null]]),
    ...[join(base, 'Desktop', 'CLONE-KEY.txt'), join(base, 'OneDrive', 'Desktop', 'CLONE-KEY.txt')].map(path => ['clone-key', path, fromFile(path)]),
  ]
  if (claudeHome === undefined && process.platform === 'win32') {
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const path = `${letter}:\\clone\\CLONE-KEY.txt`
      sources.push(['clone-key', path, fromFile(path)])
    }
  }
  const blobPath = dir === undefined ? null : join(dir, DSH_CREDENTIALS_BLOB)
  const blob = blobPath !== null && existsSync(blobPath) ? readFileSync(blobPath, 'utf8') : null
  const seen = new Set()
  let first = null
  let chosen = null
  for (const [source, , read] of sources) {
    const hex = read()
    if (hex === null || seen.has(hex)) continue
    seen.add(hex)
    const found = { hex, source }
    first ??= found
    if (blob === null) { chosen = found; break }
    if (openCredentials(Buffer.from(hex, 'hex'), blob) !== null) { chosen = found; break }
  }
  const pick = chosen ?? first
  if (pick === null) return null
  let copied = false
  let backup = null
  if (chosen !== null && pick.source !== 'file') {
    try {
      mkdirSync(dirname(kept), { recursive: true })
      const previous = existsSync(kept) ? readFileSync(kept, 'utf8') : null
      if (previous !== null && hexIn(previous) !== pick.hex) {
        backup = `${kept}.pre-brain-sync-${fileStamp()}`
        writeFileSync(backup, previous, { mode: 0o600 })
      }
      writeFileSync(kept, `${pick.hex}
`, { mode: 0o600 })
      copied = true
    } catch {}
  }
  return { key: Buffer.from(pick.hex, 'hex'), copied, source: pick.source, opens: blob === null ? null : chosen !== null, ...(backup ? { backup } : {}) }
}

/**
 * Credential refs that never travel through the brain. The OpenRouter key stays
 * on the machine that runs the relay (see openrouter-relay.mjs); every other
 * machine holds only its own relay token, sealed per machine, never in the
 * shared blob.
 */
export const LOCAL_ONLY_REFS = new Set(['OPENROUTER_API_KEY', 'OPENROUTER_RELAY_TOKEN'])
/** Ref name prefixes that stay local too: llama relay tokens, one per serving host (llama-relay.mjs). */
export const LOCAL_ONLY_REF_PREFIXES = ['LLAMA_RELAY_TOKEN_']
export const isLocalOnlyRef = name => LOCAL_ONLY_REFS.has(name) || LOCAL_ONLY_REF_PREFIXES.some(prefix => name.startsWith(prefix))

export function sealCredentials(key, payload) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return `${CREDENTIALS_MAGIC}\n${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}\n`
}

export function openCredentials(key, text) {
  const [magic, encoded] = text.trim().split(/\r?\n/)
  if (magic !== CREDENTIALS_MAGIC || !encoded) return null
  const raw = Buffer.from(encoded, 'base64')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const parsed = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'))
    return parsed !== null && typeof parsed?.refs === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** The `refs:` entries of DSH's .credentials.yaml, with where each sits. */
function readCredentialRefs(text) {
  const lines = text.split(/\r?\n/)
  const refs = new Map()
  let inRefs = false
  let last = -1
  lines.forEach((line, index) => {
    if (/^refs:\s*$/.test(line)) { inRefs = true; last = index; return }
    if (/^\S/.test(line)) { inRefs = false; return }
    const entry = inRefs ? /^\s+([A-Za-z0-9_.-]+):[ \t]*(\S.*?)\s*$/.exec(line) : null
    if (entry !== null) { refs.set(entry[1], { value: entry[2], index }); last = index }
  })
  return { lines, refs, last }
}

export function writeCredentialRefs(text, updates) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let doc = text.trim() === '' ? 'version: 1\nrefs:\n' : text
  if (!/^refs:\s*$/m.test(doc)) doc = `${doc.replace(/\s*$/, '')}${eol}refs:${eol}`
  const { lines, refs, last } = readCredentialRefs(doc)
  const added = []
  for (const [name, value] of updates) {
    const held = refs.get(name)
    if (held === undefined) added.push(`  ${name}: ${value}`)
    else lines[held.index] = `  ${name}: ${value}`
  }
  lines.splice(last + 1, 0, ...added)
  return lines.join(eol)
}

/**
 * Exchange DSH's credential refs with the sealed copy in the brain.
 * Names are reported; values never leave this function except into the two files.
 */
export function syncDshCredentials(dir, { dshHome, claudeHome, home, stamp = fileStamp() } = {}) {
  const blobPath = join(dir, DSH_CREDENTIALS_BLOB)
  const credsPath = join(dshHome, '.credentials.yaml')
  const text = existsSync(credsPath) ? readFileSync(credsPath, 'utf8') : ''
  const { refs } = readCredentialRefs(text)
  const blobThere = existsSync(blobPath)
  if (!blobThere && refs.size === 0) return { status: 'nothing' }
  const found = findBrainKey({ claudeHome, home, dir })
  if (found === null) return { status: blobThere ? 'no-key' : 'nothing' }

  let shared = new Map()
  if (blobThere) {
    const opened = openCredentials(found.key, readFileSync(blobPath, 'utf8'))
    if (opened === null) return { status: 'unreadable' }
    shared = new Map(Object.entries(opened.refs).filter(([, value]) => typeof value === 'string'))
  }
  const sorted = map => JSON.stringify([...map].sort(([a], [b]) => a.localeCompare(b)))
  const inBlob = blobThere ? sorted(shared) : null
  // A local-only ref already in the blob is dropped: the next seal rewrites it without.
  for (const name of [...shared.keys()]) if (isLocalOnlyRef(name)) shared.delete(name)
  // Sealed on two machines at once: keep this side's values, add the other's names.
  const sidecarDir = join(dir, '.sync-conflicts')
  const sidecars = existsSync(sidecarDir) ? readdirSync(sidecarDir).filter(name => name.startsWith(`${DSH_CREDENTIALS_BLOB}.from-`)) : []
  for (const name of sidecars) {
    const other = openCredentials(found.key, readFileSync(join(sidecarDir, name), 'utf8'))
    for (const [ref, value] of Object.entries(other?.refs ?? {})) if (!shared.has(ref) && !isLocalOnlyRef(ref) && typeof value === 'string') shared.set(ref, value)
  }

  const local = new Map([...refs].filter(([name]) => !isLocalOnlyRef(name)).map(([name, ref]) => [name, ref.value]))
  const statePath = join(dshHome, '.credentials-sync.json')
  const { push, pull } = planExchange(local, shared, readSyncState(statePath))
  for (const name of push) shared.set(name, local.get(name))
  const blobWritten = sorted(shared) !== inBlob
  if (blobWritten) writeFileSync(blobPath, sealCredentials(found.key, { version: 1, refs: Object.fromEntries(shared) }))
  for (const name of sidecars) rmSync(join(sidecarDir, name), { force: true })
  if (pull.length > 0) {
    mkdirSync(dshHome, { recursive: true })
    if (text !== '') writeFileSync(`${credsPath}.pre-brain-sync-${stamp}`, text, { mode: 0o600 })
    writeFileSync(credsPath, writeCredentialRefs(text, new Map(pull.map(name => [name, shared.get(name)]))), { mode: 0o600 })
  }
  writeFileSync(statePath, `${JSON.stringify(settledState(local, shared, pull), null, 2)}\n`)
  return { status: 'synced', pushed: push, pulled: pull, blobWritten, keyCopied: found.copied }
}

/**
 * What the DSH launcher runs: a session-start sync (which also self-installs
 * tooling), then the render. The render runs even when the sync cannot.
 */
export function refreshDsh(dir, { timeout = 6000, sync = true, claudeHome, dshHome } = {}) {
  const synced = sync && existsSync(join(dir, '.git')) ? context(dir, { timeout, claudeHome, dshHome }) : null
  const rendered = renderDsh(dir, { claudeHome, dshHome })
  return { sync: synced?.result ?? 'skipped', lines: synced?.lines ?? [], ...rendered }
}

// ---------------------------------------------------------------------------
// context - what a session needs to be told
// ---------------------------------------------------------------------------

/**
 * Sync, then describe the result as lines for the session's opening context.
 * Silent when everything is in order: a healthy sync costs the session nothing.
 */
export function context(dir, { timeout = 6000, claudeHome, dshHome } = {}) {
  let state
  try { state = start(dir, { timeout }) } catch (error) { state = { result: 'error', reason: error.message } }
  const lines = []
  const unresolved = listConflicts(dir)

  if (state.result === 'offline') {
    lines.push(`Brain sync could not reach the remote (${state.reason}). This session is working from this machine's copy; the next session start will try again.`)
  } else if (state.result === 'error') {
    lines.push(`Brain sync failed: ${state.reason}. Notes are intact; nothing was merged.`)
  } else if (state.result === 'busy') {
    lines.push('Brain sync skipped: another session on this machine was syncing at the same moment.')
  }
  if (state.result === 'merged') {
    lines.push("Brain sync merged the other machine's notes into this one before this session began.")
  }
  if (unresolved.length > 0) {
    lines.push(
      `${unresolved.length} note${unresolved.length === 1 ? ' was' : 's were'} changed on two machines at once. Each copy that did not stay in place is kept beside it: ${unresolved.join(', ')}.`,
      'Reconcile each one into its note, delete the sidecar, and say so in shared-agent-log.md. Do not delete a sidecar without merging it: it is the only copy of that machine\'s edit outside history.',
    )
  }
  if (typeof state.ahead === 'number' && state.ahead > 0) {
    lines.push(`The brain has ${state.ahead} commit${state.ahead === 1 ? '' : 's'} the remote does not. It is pushed like any other repo: include ~/.claude/shared-brain when the push cue scans for work.`)
  }

  // Tooling that arrived with the notes installs itself: the session hook, the
  // gatekeeper's instructions, DSH's AGENTS.md and its launcher. A machine never
  // runs older tooling than its notes carry, and nobody has to rerun the join.
  try {
    const installed = install(dir, { claudeHome, dshHome })
    for (const change of installed.changes) {
      if (change.endsWith('AGENTS.md for DSH agents')) continue
      lines.push(change.startsWith('WARNING') ? `Brain tooling: ${change}` : `Brain tooling updated from the shared history: ${change}.`)
    }
    // A collected run or fact is in the working tree now. Commit it here so it
    // is in history for the next sync, rather than waiting for the one after.
    if (installed.changes.some(change => change.startsWith('collected '))) {
      try { commitLocal(dir, `brain: ${hostname()} DSH runs and remembered facts`) } catch {}
    }
  } catch (error) {
    lines.push(`Brain tooling could not install itself: ${error.message}`)
  }

  // This machine's status is published for the others; every machine's problems are told here.
  // Real homes only: a rehearsal with a fake home must not report the real machine.
  try {
    if (claudeHome === undefined) writeHostStatus(dir)
    lines.push(...fleetLines(dir))
  } catch {}

  let openRequests = 0
  try { openRequests = countOpenRequests(readFileSync(join(dir, 'push-requests.md'), 'utf8')) } catch {}
  return { result: state.result, lines, openRequests }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const invokedDirectly = (() => {
  if (!process.argv[1]) return false
  const norm = p => p.replace(/[\\/]+/g, '/').toLowerCase()
  return norm(fileURLToPath(import.meta.url)) === norm(process.argv[1])
})()

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2))
  const dir = args.dir ?? join(homedir(), '.claude', 'shared-brain')
  const cmd = args._[0]
  try {
    let result
    if (cmd === 'start') result = start(dir, { timeout: Number(args.timeout ?? 8000) })
    else if (cmd === 'context') result = context(dir, { timeout: Number(args.timeout ?? 6000) })
    else if (cmd === 'install') result = install(dir, { claudeHome: args['claude-home'] || undefined, dshHome: args['dsh-home'] || undefined })
    else if (cmd === 'dsh') {
      result = refreshDsh(dir, {
        timeout: Number(args.timeout ?? 6000),
        sync: !args['no-sync'],
        claudeHome: args['claude-home'] || undefined,
        dshHome: args['dsh-home'] || undefined,
      })
    }
    else if (cmd === 'seed') result = seed(dir, { snapshot: args.snapshot, label: args.label })
    else if (cmd === 'join') result = join_(dir, { remote: args.remote })
    else if (cmd === 'normalize') result = { changed: normalizeTree(dir) }
    else if (cmd === 'status') result = { ...(readState(dir) ?? {}), unresolved: listConflicts(dir) }
    else if (cmd === 'cycle') result = cycle(dir, { timeout: Number(args.timeout ?? 20_000) })
    else {
      console.error('usage: brain-sync.mjs start|cycle|seed --snapshot <p>|join --remote <url>|normalize|status [--dir <p>]')
      process.exit(2)
    }
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(`brain-sync: ${error.message}`)
    process.exit(1)
  }
}
