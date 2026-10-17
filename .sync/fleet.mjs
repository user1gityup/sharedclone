#!/usr/bin/env node
/**
 * Fleet sync - what every machine needs beyond the notes.
 *
 * The brain already carries notes, rules, hooks, DSH saved runs and DSH's own
 * credential refs. A machine still drifted in four ways, and each is closed here
 * from a manifest in the brain, so adding a file, a repository or a machine is a
 * manifest line and never a hand copy:
 *
 * 1. Secret files. `fleet/secrets.json` lists files by home-relative path (the
 *    FCC .env, project .env files, ...). Each is sealed AES-256-GCM with the
 *    brain key into `fleet/secrets/<id>.enc` and restored on every machine. The
 *    exchange rule is the one DSH credentials use: a file changed here since the
 *    last sync is shared, one unchanged here takes the other machine's, and one
 *    that differs on first contact stays as each machine has it and is reported.
 *
 * 2. Repositories. `fleet/repos.json` lists checkouts. `follow` ones are cloned
 *    when missing and fast-forwarded when clean and strictly behind their remote
 *    branch; `watch` ones are only reported. Nothing here commits or pushes.
 *
 * 3. DSH build. A checkout marked `"build": "dsh"` is rebuilt by the launcher
 *    when HEAD is not the commit recorded in $DSH_HOME/.built-commit.
 *
 * 4. Host status. `fleet/status/<host>.json` says what this machine has and
 *    lacks - brain key, secrets, repositories, build, logins - so any agent on
 *    any machine can see how far behind another machine is without asking.
 *
 * Commands:
 *   build [--name <repo>]       rebuild a DSH checkout if HEAD moved past the last build
 *   repos [--force]             follow the repositories now (ignores the 10-minute throttle)
 *   apps [--master] [--dry-run] the master records its app versions and settings; others align to them
 *   status                      print every machine's status file
 *   add-secret <path> [--id x]  add a file to the secrets manifest (sealed at next sync)
 *   add-repo <path> [--mode watch|follow] [--build dsh]
 *   take-secret <id>            replace this machine's copy with the brain's (backed up)
 *
 * ASCII only in anything a .cmd prints; this file is node.
 */

import { spawnSync } from 'node:child_process'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SECRETS_MANIFEST = 'fleet/secrets.json'
export const REPOS_MANIFEST = 'fleet/repos.json'
export const STATUS_DIR = 'fleet/status'
const SEALED_MAGIC = 'brain-sealed-file v1 hex'
const REPOS_INTERVAL_MS = 10 * 60_000
const STATUS_REFRESH_MS = 12 * 3600_000
const ID_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/

const QUIET_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' }

function git(cwd, args, { timeout = 60_000 } = {}) {
  const r = spawnSync('git', cwd === null ? args : ['-C', cwd, ...args], { encoding: 'utf8', timeout, env: QUIET_ENV, windowsHide: true })
  const timedOut = r.error?.code === 'ETIMEDOUT'
  return { ok: r.status === 0 && !timedOut, code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() || (r.error ? String(r.error.message) : ''), timedOut }
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const stateDir = dir => join(dir, '.sync-state')

/** `~/a/b` on this machine. Only home-relative paths are accepted in a manifest. */
export function expandHome(path, home) {
  if (typeof path !== 'string' || !/^~(?=$|[\\/])/.test(path)) return null
  const full = resolve(home, `.${path.slice(1)}`.replace(/[\\/]+/g, sep))
  const rel = relative(home, full)
  return rel.startsWith('..') ? null : full
}

export function toTilde(path, home) {
  const rel = relative(home, resolve(path))
  if (rel === '' ) return '~'
  if (rel.startsWith('..') || /^[A-Za-z]:/.test(rel)) return null
  return `~/${rel.split(sep).join('/')}`
}

// ---------------------------------------------------------------------------
// 1. secret files
// ---------------------------------------------------------------------------

/** Hex, not base64: hex can never happen to match a credential shape the pre-push gate looks for. */
export function sealFile(key, id, content) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify({ version: 1, id, content: content.toString('base64') }), 'utf8'), cipher.final()])
  return `${SEALED_MAGIC}\n${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('hex')}\n`
}

export function openFile(key, text) {
  const [magic, encoded] = text.trim().split(/\r?\n/)
  if (magic !== SEALED_MAGIC || !encoded || !/^[0-9a-f]+$/.test(encoded)) return null
  const raw = Buffer.from(encoded, 'hex')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const parsed = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'))
    return typeof parsed?.content === 'string' ? { id: parsed.id, content: Buffer.from(parsed.content, 'base64') } : null
  } catch {
    return null
  }
}

export function readSecretsManifest(dir) {
  const manifest = readJson(join(dir, SECRETS_MANIFEST), { version: 1, files: [] })
  return Array.isArray(manifest.files) ? manifest.files : []
}

/**
 * Exchange every manifest file with its sealed copy.
 * Reports ids and states only; contents never leave the two files.
 */
export function syncSecretFiles(dir, { key, home = homedir(), claudeHome = join(home, '.claude'), stamp = new Date().toISOString().replace(/[:.]/g, '-') } = {}) {
  const files = readSecretsManifest(dir)
  if (files.length === 0) return { status: 'nothing', files: [] }
  if (!key) return { status: 'no-key', files: files.map(file => ({ id: file.id, state: 'no-key' })) }
  const statePath = join(claudeHome, '.fleet-secrets-sync.json')
  const settled = readJson(statePath, {})
  const results = []
  for (const file of files) {
    const id = file?.id
    const local = expandHome(file?.path, home)
    if (typeof id !== 'string' || !ID_SHAPE.test(id) || local === null) {
      results.push({ id: String(id), state: 'invalid-entry' })
      continue
    }
    const blobPath = join(dir, 'fleet', 'secrets', `${id}.enc`)
    const localBuf = existsSync(local) ? readFileSync(local) : null
    let shared = null
    if (existsSync(blobPath)) {
      shared = openFile(key, readFileSync(blobPath, 'utf8'))
      if (shared === null) { results.push({ id, state: 'unreadable' }); continue }
    }
    const ls = localBuf === null ? null : sha256(localBuf)
    const bs = shared === null ? null : sha256(shared.content)
    const last = settled[id]
    const seal = buffer => { mkdirSync(dirname(blobPath), { recursive: true }); writeFileSync(blobPath, sealFile(key, id, buffer)) }
    const restore = () => {
      mkdirSync(dirname(local), { recursive: true })
      if (localBuf !== null) writeFileSync(`${local}.pre-brain-sync-${stamp}`, localBuf, { mode: 0o600 })
      writeFileSync(local, shared.content, { mode: 0o600 })
    }
    let state
    if (ls === null && bs === null) state = 'absent'
    else if (bs === null) { seal(localBuf); settled[id] = ls; state = 'shared' }
    else if (ls === null) { restore(); settled[id] = bs; state = 'restored' }
    else if (ls === bs) { settled[id] = ls; state = 'same' }
    else if (last === undefined) state = 'differs'
    else if (ls !== last) {
      // Changed here. If the other machine changed it too, its version is kept beside this one.
      if (bs !== last) writeFileSync(`${local}.from-brain-${stamp}`, shared.content, { mode: 0o600 })
      seal(localBuf); settled[id] = ls; state = bs !== last ? 'shared-both-changed' : 'shared'
    } else { restore(); settled[id] = bs; state = 'restored' }
    results.push({ id, state })
  }
  writeJson(statePath, settled)
  return { status: 'synced', files: results }
}

/** Replace this machine's copy with the brain's: the way out of `differs`. */
export function takeSecret(dir, id, { key, home = homedir(), claudeHome = join(home, '.claude'), stamp = new Date().toISOString().replace(/[:.]/g, '-') } = {}) {
  const file = readSecretsManifest(dir).find(entry => entry.id === id)
  if (!file) return { status: 'unknown-id' }
  const local = expandHome(file.path, home)
  const blobPath = join(dir, 'fleet', 'secrets', `${id}.enc`)
  if (!existsSync(blobPath)) return { status: 'no-shared-copy' }
  const shared = key ? openFile(key, readFileSync(blobPath, 'utf8')) : null
  if (shared === null) return { status: key ? 'unreadable' : 'no-key' }
  mkdirSync(dirname(local), { recursive: true })
  if (existsSync(local)) writeFileSync(`${local}.pre-brain-sync-${stamp}`, readFileSync(local), { mode: 0o600 })
  writeFileSync(local, shared.content, { mode: 0o600 })
  const statePath = join(claudeHome, '.fleet-secrets-sync.json')
  writeJson(statePath, { ...readJson(statePath, {}), [id]: sha256(shared.content) })
  return { status: 'taken' }
}

export function addSecret(dir, path, { id, home = homedir() } = {}) {
  const tilde = toTilde(path, home)
  if (tilde === null) throw new Error(`${path} is not under the home folder`)
  if (!existsSync(expandHome(tilde, home))) throw new Error(`${path} does not exist`)
  const derived = id ?? tilde.slice(2).replace(/^Documents\/claudecode\//, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+/, '')
  if (!ID_SHAPE.test(derived)) throw new Error(`id ${derived} must match ${ID_SHAPE}`)
  const manifestPath = join(dir, SECRETS_MANIFEST)
  const manifest = readJson(manifestPath, { version: 1, files: [] })
  manifest.files = (manifest.files ?? []).filter(entry => entry.id !== derived && entry.path !== tilde)
  manifest.files.push({ id: derived, path: tilde })
  writeJson(manifestPath, manifest)
  return { id: derived, path: tilde }
}

// ---------------------------------------------------------------------------
// 2. repositories
// ---------------------------------------------------------------------------

export function readReposManifest(dir) {
  const manifest = readJson(join(dir, REPOS_MANIFEST), { version: 1, repos: [] })
  return Array.isArray(manifest.repos) ? manifest.repos : []
}

export function addRepo(dir, path, { mode = 'follow', build, home = homedir() } = {}) {
  const tilde = toTilde(path, home)
  if (tilde === null) throw new Error(`${path} is not under the home folder`)
  const branch = git(path, ['branch', '--show-current']).out
  const remote = git(path, ['remote', 'get-url', 'origin']).out
  if (!branch || !remote) throw new Error(`${path} needs a current branch and an origin remote`)
  if (/\/\/[^/@]+@/.test(remote)) throw new Error('the origin URL carries a credential; refusing to put it in the brain')
  const manifestPath = join(dir, REPOS_MANIFEST)
  const manifest = readJson(manifestPath, { version: 1, repos: [] })
  const name = tilde.split('/').pop()
  manifest.repos = (manifest.repos ?? []).filter(entry => entry.name !== name)
  manifest.repos.push({ name, path: tilde, remote, branch, mode, ...(build ? { build } : {}) })
  writeJson(manifestPath, manifest)
  return manifest.repos.at(-1)
}

function followOne(repo, home, { fetchTimeout, cloneTimeout }) {
  const path = expandHome(repo.path, home)
  const base = { name: repo.name, mode: repo.mode, branch: repo.branch }
  if (path === null) return { ...base, state: 'invalid-entry' }
  if (!existsSync(path)) {
    if (repo.mode !== 'follow') return { ...base, state: 'missing' }
    mkdirSync(dirname(path), { recursive: true })
    const cloned = git(null, ['clone', '--quiet', '--branch', repo.branch, repo.remote, path], { timeout: cloneTimeout })
    if (!cloned.ok) return { ...base, state: 'clone-failed', reason: (cloned.timedOut ? 'timed out' : cloned.err.split('\n').pop()).slice(0, 200) }
    return { ...base, state: 'cloned', head: git(path, ['rev-parse', '--short=10', 'HEAD']).out }
  }
  if (!existsSync(join(path, '.git'))) return { ...base, state: 'not-a-repo' }
  const branch = git(path, ['branch', '--show-current']).out
  const fetch = git(path, ['fetch', '--quiet', 'origin', repo.branch], { timeout: fetchTimeout })
  const head = () => git(path, ['rev-parse', '--short=10', 'HEAD']).out
  if (!fetch.ok) return { ...base, state: 'offline', head: head(), reason: (fetch.timedOut ? 'timed out' : fetch.err.split('\n').pop()).slice(0, 200) }
  if (branch !== repo.branch) return { ...base, state: 'other-branch', onBranch: branch, head: head() }
  const counts = git(path, ['rev-list', '--left-right', '--count', `origin/${repo.branch}...HEAD`])
  if (!counts.ok) return { ...base, state: 'no-upstream', head: head() }
  const [behind, ahead] = counts.out.split(/\s+/).map(Number)
  const dirty = git(path, ['status', '--porcelain', '--untracked-files=no']).out !== ''
  if (repo.mode === 'follow' && behind > 0 && ahead === 0 && !dirty) {
    const before = head()
    const merged = git(path, ['merge', '--ff-only', '--quiet', `origin/${repo.branch}`], { timeout: fetchTimeout })
    if (merged.ok) return { ...base, state: 'updated', from: before, head: head(), behind: 0, ahead: 0 }
    return { ...base, state: 'ff-failed', head: before, behind, ahead, reason: merged.err.split('\n').pop().slice(0, 200) }
  }
  const state = behind > 0 && ahead > 0 ? 'diverged' : behind > 0 ? (dirty ? 'dirty-behind' : 'behind') : ahead > 0 ? 'ahead' : 'current'
  return { ...base, state, head: head(), behind, ahead, ...(dirty ? { dirty: true } : {}) }
}

/** Throttled: the listener calls this every cycle, but it works at most every ten minutes. */
export function followRepos(dir, { home = homedir(), force = false, now = Date.now(), fetchTimeout = 120_000, cloneTimeout = 900_000 } = {}) {
  const repos = readReposManifest(dir)
  const lastPath = join(stateDir(dir), 'repos-last.json')
  const last = readJson(lastPath, null)
  if (!force && last !== null && now - Date.parse(last.at) < REPOS_INTERVAL_MS) return { ...last, throttled: true }
  const results = repos.map(repo => {
    try { return followOne(repo, home, { fetchTimeout, cloneTimeout }) } catch (error) { return { name: repo?.name, state: 'error', reason: error.message } }
  })
  const out = { at: new Date(now).toISOString(), repos: results }
  writeJson(lastPath, out)
  return out
}

// ---------------------------------------------------------------------------
// 3. DSH build
// ---------------------------------------------------------------------------

function runStep(command, cwd) {
  console.log(`  fleet: ${command}`)
  const r = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', command], { cwd, stdio: 'inherit', windowsHide: false })
    : spawnSync('sh', ['-c', command], { cwd, stdio: 'inherit' })
  return r.status ?? 1
}

/**
 * First contact: a checkout whose web bundle is newer than its HEAD commit was
 * built from HEAD (or later work), so it is recorded rather than rebuilt.
 */
export function seedBuiltMarker(repoPath, dshHome) {
  const marker = join(dshHome, '.built-commit')
  const bundle = join(repoPath, 'apps', 'web', 'dist', 'index.html')
  if (existsSync(marker) || !existsSync(bundle) || !existsSync(join(repoPath, '.git'))) return false
  const committed = Number(git(repoPath, ['log', '-1', '--format=%ct']).out) * 1000
  if (!(statSync(bundle).mtimeMs >= committed)) return false
  mkdirSync(dshHome, { recursive: true })
  writeFileSync(marker, `${git(repoPath, ['rev-parse', 'HEAD']).out}\n`)
  return true
}

export function buildIfStale(dir, { name, home = homedir(), dshHome = process.env.DSH_HOME || join(home, '.dsh'), run = runStep } = {}) {
  const repo = readReposManifest(dir).find(entry => entry.build === 'dsh' && (name === undefined || entry.name === name))
  if (!repo) return { status: 'no-dsh-repo' }
  const path = expandHome(repo.path, home)
  if (path === null || !existsSync(join(path, '.git'))) return { status: 'missing', path }
  seedBuiltMarker(path, dshHome)
  const head = git(path, ['rev-parse', 'HEAD']).out
  const markerPath = join(dshHome, '.built-commit')
  const built = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : ''
  if (built === head && existsSync(join(path, 'apps', 'web', 'dist', 'index.html'))) return { status: 'current', head }
  let lockChanged = built === '' || !existsSync(join(path, 'node_modules'))
  if (!lockChanged) {
    const diff = git(path, ['diff', '--name-only', built, head, '--', 'pnpm-lock.yaml'])
    lockChanged = !diff.ok || diff.out !== ''
  }
  if (lockChanged && run('pnpm install --frozen-lockfile', path) !== 0) return { status: 'install-failed', head }
  if (run('pnpm run build', path) !== 0) return { status: 'build-failed', head }
  mkdirSync(dshHome, { recursive: true })
  writeFileSync(markerPath, `${head}\n`)
  return { status: 'built', head, from: built || null, installed: lockChanged }
}

// ---------------------------------------------------------------------------
// 4. host status
// ---------------------------------------------------------------------------

const hostKey = host => host.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')

/** Pieces of the report are saved by whoever computed them; this assembles and publishes. */
export function saveStatusPart(dir, part, value) {
  const path = join(stateDir(dir), 'fleet-status-parts.json')
  writeJson(path, { ...readJson(path, {}), [part]: value })
}

function loginsAndTools(home) {
  const onPath = name => {
    const r = process.platform === 'win32'
      ? spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      : spawnSync('which', [name], { encoding: 'utf8', timeout: 5000 })
    return r.status === 0
  }
  const teamviewer = ['C:\\Program Files\\TeamViewer\\TeamViewer.exe', 'C:\\Program Files (x86)\\TeamViewer\\TeamViewer.exe'].some(existsSync)
  return {
    node: process.version,
    git: onPath('git'),
    pnpm: onPath('pnpm'),
    teamviewer,
    codexLogin: existsSync(join(home, '.codex', 'auth.json')),
    claudeLogin: existsSync(join(home, '.claude', '.credentials.json')) || existsSync(join(home, '.claude.json')),
  }
}

export function writeHostStatus(dir, { host = hostname(), home = homedir(), now = Date.now(), tools } = {}) {
  const parts = readJson(join(stateDir(dir), 'fleet-status-parts.json'), {})
  const repos = readJson(join(stateDir(dir), 'repos-last.json'), null)
  const body = {
    host,
    brainKey: parts.brainKey ?? 'unknown',
    dshCredentials: parts.dshCredentials ?? 'unknown',
    secrets: Object.fromEntries((parts.secrets?.files ?? []).map(file => [file.id, file.state])),
    repos: Object.fromEntries((repos?.repos ?? []).map(repo => [repo.name, { state: repo.state, branch: repo.onBranch ?? repo.branch, head: repo.head ?? null, behind: repo.behind ?? null, ahead: repo.ahead ?? null }])),
    reposCheckedAt: repos?.at ?? null,
    dsh: parts.dsh ?? null,
    apps: parts.apps ?? null,
    tools: tools ?? loginsAndTools(home),
  }
  const path = join(dir, STATUS_DIR, `${hostKey(host)}.json`)
  const previous = readJson(path, null)
  const { seen, ...before } = previous ?? {}
  const same = previous !== null && JSON.stringify(before) === JSON.stringify(body)
  if (same && now - Date.parse(seen) < STATUS_REFRESH_MS) return { written: false }
  writeJson(path, { ...body, seen: new Date(now).toISOString() })
  return { written: true }
}

/** What a session should be told about any machine. Silent when every machine is in order. */
export function fleetLines(dir, { host = hostname(), now = Date.now() } = {}) {
  const statusDir = join(dir, STATUS_DIR)
  if (!existsSync(statusDir)) return []
  const lines = []
  for (const name of readdirSync(statusDir).filter(file => file.endsWith('.json')).sort()) {
    const status = readJson(join(statusDir, name), null)
    if (status === null) continue
    const here = hostKey(status.host ?? '') === hostKey(host)
    const problems = []
    if (status.brainKey === 'missing') problems.push('no brain key (sealed secrets cannot open)')
    if (['no-key', 'unreadable'].includes(status.dshCredentials)) problems.push(`DSH credentials ${status.dshCredentials}`)
    const secretIssues = Object.entries(status.secrets ?? {}).filter(([, state]) => ['differs', 'unreadable', 'invalid-entry', 'shared-both-changed'].includes(state))
    if (secretIssues.length) problems.push(`secret files: ${secretIssues.map(([id, state]) => `${id} ${state}`).join(', ')}${secretIssues.some(([, s]) => s === 'differs') ? ' (differs = both machines had a different copy before sync; `node ~/.claude/shared-brain/.sync/fleet.mjs take-secret <id>` on the machine that should take the shared one)' : ''}`)
    const repoIssues = Object.entries(status.repos ?? {}).filter(([, repo]) => ['diverged', 'dirty-behind', 'clone-failed', 'ff-failed', 'other-branch', 'not-a-repo', 'no-upstream', 'error'].includes(repo.state))
    if (repoIssues.length) problems.push(`repos: ${repoIssues.map(([repoName, repo]) => `${repoName} ${repo.state}${repo.state === 'other-branch' ? ` (on ${repo.branch})` : ''}`).join(', ')}`)
    if (status.dsh && ['build-failed', 'install-failed'].includes(status.dsh.status)) problems.push(`DSH ${status.dsh.status} at ${String(status.dsh.head).slice(0, 10)}`)
    const drift = status.apps?.role === 'master' ? [] : appsDrift(status, readJson(join(dir, APPS_MANIFEST), null))
    if (drift.length) problems.push(`apps behind the master: ${drift.join(', ')}`)
    const age = now - Date.parse(status.seen)
    if (!here && age > 3 * 24 * 3600_000) problems.push(`not seen for ${Math.floor(age / (24 * 3600_000))} days`)
    if (problems.length) lines.push(`Fleet: ${here ? 'this machine' : status.host} - ${problems.join('; ')}.`)
  }
  return lines
}

// ---------------------------------------------------------------------------
// 5. apps - Claude Code, Codex and Antigravity kept at the master's versions
// ---------------------------------------------------------------------------
//
// `fleet/apps.json` names the master host and holds its versions, its portable
// Claude Code settings and Codex config, and the code files those settings run.
// The master records it; every other machine aligns to it: npm installs the
// pinned CLIs, the settings are merged with this machine's home, and an
// Antigravity update already downloaded by its own updater is applied. A binary
// locked by a running program is moved aside first (Windows allows moving a
// running .exe), so an open session never blocks an update.

export const APPS_MANIFEST = 'fleet/apps.json'
const APPS_FILES = 'fleet/apps-files'
const APPS_INTERVAL_MS = 60 * 60_000
const HOME_TOKEN = '{{HOME}}'
/** settings.json keys that mean the same on every machine; env, credentials and per-machine keys stay local. */
const CLAUDE_KEYS = ['permissions', 'hooks', 'statusLine', 'autoUpdatesChannel', 'theme', 'autoMode', 'enabledPlugins', 'extraKnownMarketplaces', 'model', 'effortLevel', 'outputStyle']
/** Code the portable settings run that the brain does not install on its own. State files next to them stay local. */
const CLAUDE_CODE_FILES = ['hooks/usage-panel-chip.mjs', 'hooks/usage-panel-budget.mjs', 'statusline/statusline.mjs', 'statusline/usage-cache.mjs', 'statusline/usage-panel.mjs']
const CODEX_TABLE = /^(desktop(\..+)?|windows|features|profiles\..+|plugins\..+)$/
const CODEX_LOCAL_KEYS = new Set(['notify'])
const NPM_PACKAGES = { claudeCode: '@anthropic-ai/claude-code', codex: '@openai/codex' }
const NPM_BINARIES = { claudeCode: 'claude.exe', codex: 'codex.exe' }

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const homePattern = home => new RegExp(home.replace(/[\\/]+$/, '').split(/[\\/]+/).map(escapeRegex).join('[\\\\/]+'), 'gi')
export const tokenizeHome = (text, home) => text.replace(homePattern(home), HOME_TOKEN)
export const expandHomeToken = (text, home) => text.split(HOME_TOKEN).join(home.replace(/\\/g, '/').replace(/\/+$/, ''))

export function appPaths(home = homedir(), env = process.env) {
  let npmRoot = process.platform === 'win32' && env.APPDATA ? join(env.APPDATA, 'npm', 'node_modules') : null
  if (!npmRoot) {
    const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 15_000, windowsHide: true })
    npmRoot = r.status === 0 ? r.stdout.trim() : null
  }
  const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
  return {
    npmRoot,
    antigravityAsar: join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar'),
    antigravityPending: join(localAppData, 'antigravity-updater', 'pending'),
    claudeSettings: join(home, '.claude', 'settings.json'),
    claudeHome: join(home, '.claude'),
    codexConfig: join(home, '.codex', 'config.toml'),
  }
}

/** package.json version inside an Electron app.asar, read from its header without unpacking. */
export function asarPackageVersion(path) {
  let fd
  try {
    fd = openSync(path, 'r')
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(4)
    const jsonLength = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    readSync(fd, json, 0, jsonLength, 16)
    const entry = JSON.parse(json.toString('utf8')).files?.['package.json']
    if (!entry || entry.unpacked) return null
    const body = Buffer.alloc(entry.size)
    readSync(fd, body, 0, entry.size, 8 + headerSize + Number(entry.offset))
    return JSON.parse(body.toString('utf8')).version ?? null
  } catch { return null } finally { if (fd !== undefined) closeSync(fd) }
}

export function appVersions(paths) {
  const npmVersion = pkg => paths.npmRoot ? readJson(join(paths.npmRoot, ...pkg.split('/'), 'package.json'), null)?.version ?? null : null
  return {
    claudeCode: npmVersion(NPM_PACKAGES.claudeCode),
    codex: npmVersion(NPM_PACKAGES.codex),
    antigravity: existsSync(paths.antigravityAsar) ? asarPackageVersion(paths.antigravityAsar) : null,
  }
}

/** The shareable part of settings.json, home paths replaced by a token. */
export function portableClaudeSettings(settings, home) {
  const picked = {}
  for (const key of CLAUDE_KEYS) if (settings?.[key] !== undefined) picked[key] = settings[key]
  return JSON.parse(tokenizeHome(JSON.stringify(picked), home.replace(/\\/g, '\\\\')))
}

/** Split config.toml into its top-level lines and its [tables], raw text kept. */
export function tomlBlocks(text) {
  const blocks = [{ name: null, lines: [] }]
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const header = /^\s*\[([^\[\]].*)\]\s*$/.exec(line)
    if (header) blocks.push({ name: header[1].trim(), lines: [line] })
    else blocks.at(-1).lines.push(line)
  }
  return blocks
}
const tomlKey = line => /^\s*([A-Za-z0-9_.\-"']+)\s*=/.exec(line)?.[1] ?? null

export function portableCodexConfig(text, home) {
  const blocks = tomlBlocks(tokenizeHome(text, home))
  const top = blocks[0].lines.filter(line => { const key = tomlKey(line); return key !== null && !CODEX_LOCAL_KEYS.has(key) })
  const tables = blocks.slice(1).filter(block => CODEX_TABLE.test(block.name)).map(block => ({ name: block.name, text: block.lines.join('\n').trimEnd() }))
  return { top, tables }
}

/** This machine's config.toml with the master's portable keys and tables laid over it; everything else kept. */
export function mergeCodexConfig(localText, portable, home) {
  const expand = text => expandHomeToken(text, home.replace(/\//g, '\\'))
  const blocks = tomlBlocks(localText)
  const topKeys = new Map(portable.top.map(line => [tomlKey(line), expand(line)]))
  const top = blocks[0].lines.map(line => {
    const key = tomlKey(line)
    if (key === null || !topKeys.has(key)) return line
    const next = topKeys.get(key)
    topKeys.delete(key)
    return next
  })
  while (top.length && top.at(-1).trim() === '') top.pop()
  top.push(...topKeys.values())
  const tables = new Map(portable.tables.map(table => [table.name, expand(table.text)]))
  const out = [top.join('\n').trimEnd()]
  for (const block of blocks.slice(1)) {
    if (tables.has(block.name)) { out.push(tables.get(block.name)); tables.delete(block.name) } else out.push(block.lines.join('\n').trimEnd())
  }
  out.push(...tables.values())
  return `${out.filter(part => part !== '').join('\n\n')}\n`
}

const digest = value => sha256(JSON.stringify(value)).slice(0, 16)
const codexDigest = portable => digest({ top: [...portable.top].sort(), tables: [...portable.tables].sort((a, b) => a.name.localeCompare(b.name)) })

/** The master's portable Codex lines and tables are all present here; local extras (a plugin only this host has) are not drift. */
export function codexCovers(portable, target) {
  if (!portable || !target) return false
  const have = new Map(portable.tables.map(table => [table.name, table.text]))
  return target.top.every(line => portable.top.includes(line)) && target.tables.every(table => have.get(table.name) === table.text)
}

function readText(path) { try { return readFileSync(path, 'utf8') } catch { return null } }

/** What this machine has, in the manifest's terms. */
export function detectApps(home = homedir(), paths = appPaths(home)) {
  const settings = readJson(paths.claudeSettings, null)
  const codexText = readText(paths.codexConfig)
  const claude = settings ? portableClaudeSettings(settings, home) : null
  const codex = codexText === null ? null : portableCodexConfig(codexText, home)
  return {
    versions: appVersions(paths),
    claudeSettings: claude, claudeDigest: claude ? digest(claude) : null,
    codexConfig: codex, codexDigest: codex ? codexDigest(codex) : null,
  }
}

/** Master: publish its versions, settings and the code they run. */
export function recordAppsTarget(dir, { host = hostname(), home = homedir(), paths = appPaths(home), now = Date.now() } = {}) {
  const found = detectApps(home, paths)
  const files = {}
  for (const rel of CLAUDE_CODE_FILES) {
    const text = readText(join(paths.claudeHome, ...rel.split('/')))
    if (text === null) continue
    const target = join(dir, APPS_FILES, 'claude', ...rel.split('/'))
    if (readText(target) !== text) { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text) }
    files[rel] = sha256(text).slice(0, 16)
  }
  const manifestPath = join(dir, APPS_MANIFEST)
  const previous = readJson(manifestPath, {})
  const body = { master: previous.master ?? hostKey(host), versions: found.versions, claudeSettings: found.claudeSettings, claudeDigest: found.claudeDigest, codexConfig: found.codexConfig, codexDigest: found.codexDigest, claudeFiles: files }
  const { recorded, ...before } = previous
  if (JSON.stringify(before) !== JSON.stringify(body)) writeJson(manifestPath, { ...body, recorded: new Date(now).toISOString() })
  return { role: 'master', ...found.versions, claudeDigest: found.claudeDigest, codexDigest: found.codexDigest }
}

function processRunning(image) {
  if (process.platform !== 'win32') return false
  const r = spawnSync('tasklist.exe', ['/FI', `IMAGENAME eq ${image}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
  return (r.stdout ?? '').toLowerCase().includes(`"${image.toLowerCase()}"`)
}

function findFiles(root, name, depth = 6) {
  if (depth < 0 || !existsSync(root)) return []
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) out.push(...findFiles(full, name, depth - 1))
    else if (entry.name.toLowerCase() === name) out.push(full)
  }
  return out
}

/** Move a package's native binaries out of the way so npm can replace them while they run. */
function moveBinariesAside(dir, packageDir, binary, stamp) {
  const aside = join(stateDir(dir), 'old-binaries')
  mkdirSync(aside, { recursive: true })
  for (const old of readdirSync(aside)) try { unlinkSync(join(aside, old)) } catch {}
  let moved = 0
  for (const file of findFiles(packageDir, binary)) {
    try { renameSync(file, join(aside, `${stamp}-${moved}-${binary}`)); moved++ } catch {}
  }
  return moved
}

function npmInstall(spec) {
  const r = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `npm i -g ${spec}`], { encoding: 'utf8', timeout: 15 * 60_000, windowsHide: true })
    : spawnSync('npm', ['i', '-g', spec], { encoding: 'utf8', timeout: 15 * 60_000 })
  return { ok: r.status === 0, err: `${r.stderr ?? ''}`.trim().split('\n').slice(-3).join(' ') }
}

function exeVersion(path) {
  if (process.platform !== 'win32') return null
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${path.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8', timeout: 20_000, windowsHide: true })
  return r.status === 0 ? r.stdout.trim() : null
}

const sameVersion = (a, b) => String(a ?? '').replace(/(\.0)+$/, '') === String(b ?? '').replace(/(\.0)+$/, '')
/** Numeric dotted-version order: negative when a is older than b. */
export function compareVersion(a, b) {
  const pa = String(a ?? '').split(/[.+-]/).map(n => parseInt(n, 10) || 0)
  const pb = String(b ?? '').split(/[.+-]/).map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** Follower: install and merge to the master's target. The injectable steps exist for the self-test. */
export function alignApps(dir, {
  home = homedir(), paths = appPaths(home), dryRun = false,
  stamp = new Date().toISOString().replace(/[:.]/g, '-'),
  install = npmInstall, running = processRunning, moveAside = moveBinariesAside, pendingVersion = exeVersion,
  launch = file => spawnSync(file, ['/S', '--updated'], { timeout: 10 * 60_000, windowsHide: true }).status === 0,
} = {}) {
  const target = readJson(join(dir, APPS_MANIFEST), null)
  if (!target) return { role: 'follower', state: 'no-target', items: {} }
  const found = detectApps(home, paths)
  const result = { role: 'follower', master: target.master, items: {} }
  const note = (item, state, extra = {}) => { result.items[item] = { state, ...extra } }

  for (const item of ['claudeCode', 'codex']) {
    const want = target.versions?.[item]
    const have = found.versions[item]
    if (!want) { note(item, 'no-target'); continue }
    if (have === want) { note(item, 'same', { version: have }); continue }
    // Never downgrade: a follower newer than the master waits for the master to catch up.
    if (have && compareVersion(have, want) > 0) { note(item, 'ahead-of-master', { version: have, target: want }); continue }
    if (dryRun) { note(item, 'would-install', { from: have, to: want }); continue }
    if (have && paths.npmRoot) moveAside(dir, join(paths.npmRoot, ...NPM_PACKAGES[item].split('/')), NPM_BINARIES[item], stamp)
    const done = install(`${NPM_PACKAGES[item]}@${want}`)
    const after = appVersions(paths)[item]
    note(item, done.ok && after === want ? 'installed' : 'install-failed', { from: have, to: want, ...(done.ok ? {} : { error: done.err }) })
  }

  const wantAgy = target.versions?.antigravity
  const haveAgy = found.versions.antigravity
  if (!haveAgy) note('antigravity', 'not-installed')
  else if (!wantAgy) note('antigravity', 'no-target', { version: haveAgy })
  else if (sameVersion(haveAgy, wantAgy)) note('antigravity', 'same', { version: haveAgy })
  else if (compareVersion(haveAgy, wantAgy) > 0) note('antigravity', 'ahead-of-master', { version: haveAgy, target: wantAgy })
  else {
    const pending = existsSync(paths.antigravityPending) ? readdirSync(paths.antigravityPending).filter(name => name.toLowerCase().endsWith('.exe')).map(name => join(paths.antigravityPending, name)) : []
    const ready = pending.find(file => sameVersion(pendingVersion(file), wantAgy))
    if (!ready) note('antigravity', 'behind-no-installer', { from: haveAgy, to: wantAgy, hint: 'Antigravity downloads it itself on its next launch' })
    else if (dryRun) note('antigravity', 'would-install', { from: haveAgy, to: wantAgy })
    else if (running('Antigravity.exe')) note('antigravity', 'deferred-running', { from: haveAgy, to: wantAgy })
    else {
      const ok = launch(ready)
      const after = appVersions(paths).antigravity
      note('antigravity', ok && sameVersion(after, wantAgy) ? 'installed' : 'install-failed', { from: haveAgy, to: wantAgy })
    }
  }

  // Code files first: the settings may name them.
  const filesMissing = []
  const filesWritten = []
  for (const rel of Object.keys(target.claudeFiles ?? {})) {
    const text = readText(join(dir, APPS_FILES, 'claude', ...rel.split('/')))
    if (text === null) { filesMissing.push(rel); continue }
    const local = join(paths.claudeHome, ...rel.split('/'))
    const have = readText(local)
    if (have === text) continue
    filesWritten.push(rel)
    if (dryRun) continue
    if (have !== null) writeFileSync(`${local}.pre-fleet-${stamp}`, have)
    mkdirSync(dirname(local), { recursive: true })
    writeFileSync(local, text)
  }
  note('claudeFiles', filesMissing.length ? 'missing-in-brain' : filesWritten.length ? (dryRun ? 'would-write' : 'written') : 'same', { ...(filesMissing.length ? { missing: filesMissing } : {}), ...(filesWritten.length ? { files: filesWritten } : {}) })

  if (!target.claudeSettings) note('claudeSettings', 'no-target')
  else if (found.claudeDigest === target.claudeDigest) note('claudeSettings', 'same')
  else {
    const expanded = JSON.parse(expandHomeToken(JSON.stringify(target.claudeSettings), home))
    const willExist = file => dryRun && filesWritten.some(rel => file.replace(/\\/g, '/').toLowerCase().endsWith(`/.claude/${rel}`.toLowerCase()))
    const referenced = []
    for (const text of JSON.stringify([expanded.hooks ?? {}, expanded.statusLine ?? {}]).matchAll(/"command":"((?:[^"\\]|\\.)*)"/g)) {
      const command = JSON.parse(`"${text[1]}"`)
      for (const m of command.matchAll(/"([^"]+\.(?:mjs|cjs|js|ps1))"/g)) referenced.push(m[1])
    }
    const missing = referenced.filter(file => !existsSync(file) && !willExist(file))
    if (missing.length) note('claudeSettings', 'missing-files', { missing })
    else if (dryRun) note('claudeSettings', 'would-merge', { keys: Object.keys(expanded) })
    else {
      const before = readText(paths.claudeSettings)
      const next = { ...readJson(paths.claudeSettings, {}) }
      if (before !== null) writeFileSync(`${paths.claudeSettings}.pre-fleet-${stamp}`, before)
      for (const key of CLAUDE_KEYS) if (expanded[key] === undefined) delete next[key]; else next[key] = expanded[key]
      writeJson(paths.claudeSettings, next)
      note('claudeSettings', 'merged')
    }
  }

  if (!target.codexConfig) note('codexConfig', 'no-target')
  else if (found.codexDigest === target.codexDigest || codexCovers(found.codexConfig, target.codexConfig)) note('codexConfig', 'same')
  else if (dryRun) note('codexConfig', 'would-merge', { tables: target.codexConfig.tables.length, top: target.codexConfig.top.length })
  else {
    const before = readText(paths.codexConfig) ?? ''
    if (before) writeFileSync(`${paths.codexConfig}.pre-fleet-${stamp}`, before)
    mkdirSync(dirname(paths.codexConfig), { recursive: true })
    writeFileSync(paths.codexConfig, mergeCodexConfig(before, target.codexConfig, home))
    note('codexConfig', codexCovers(portableCodexConfig(readText(paths.codexConfig), home), target.codexConfig) ? 'merged' : 'merged-differs')
  }
  return result
}

/** One apps pass: the master records, the others align; the outcome goes into the host status. Throttled unless forced. */
export function syncApps(dir, { host = hostname(), home = homedir(), force = false, dryRun = false, now = Date.now(), ...options } = {}) {
  const lastPath = join(stateDir(dir), 'apps-last.json')
  const last = readJson(lastPath, null)
  if (!force && !dryRun && last && now - Date.parse(last.at) < APPS_INTERVAL_MS) return { skipped: 'throttled', at: last.at }
  const target = readJson(join(dir, APPS_MANIFEST), null)
  const isMaster = target !== null && target.master === hostKey(host)
  const paths = options.paths ?? appPaths(home)
  const result = isMaster ? recordAppsTarget(dir, { host, home, now, paths }) : alignApps(dir, { home, dryRun, ...options, paths })
  if (dryRun) return result
  const found = detectApps(home, paths)
  saveStatusPart(dir, 'apps', { role: result.role, versions: found.versions, claudeDigest: found.claudeDigest, codexDigest: found.codexDigest, ...(isMaster ? {} : { codexCovers: codexCovers(found.codexConfig, target?.codexConfig) }), items: result.items ?? null, at: new Date(now).toISOString() })
  writeJson(lastPath, { at: new Date(now).toISOString(), result })
  return result
}

/** How far a host's apps are from the target, for the fleet lines. */
export function appsDrift(status, target) {
  if (!target || !status?.apps) return []
  const drift = []
  for (const [item, want] of Object.entries(target.versions ?? {})) {
    const have = status.apps.versions?.[item]
    if (want && !have) drift.push(`${item} missing`)
    else if (want && !sameVersion(have, want)) drift.push(compareVersion(have, want) > 0 ? `${item} ${have} ahead of the master (${want})` : `${item} ${have} (target ${want})`)
  }
  if (target.claudeDigest && status.apps.claudeDigest !== target.claudeDigest) drift.push('Claude settings differ')
  if (target.codexDigest && status.apps.codexDigest !== target.codexDigest && status.apps.codexCovers !== true) drift.push('Codex config differs')
  return drift
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
  runCli()
}

async function runCli() {
  const argv = process.argv.slice(2)
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) args[argv[i].slice(2)] = true
      else { args[argv[i].slice(2)] = next; i++ }
    } else args._.push(argv[i])
  }
  const dir = args.dir ?? join(homedir(), '.claude', 'shared-brain')
  const [cmd, target] = args._
  try {
    let result
    if (cmd === 'build') {
      result = buildIfStale(dir, { name: args.name })
      if (result.status !== 'current' && result.status !== 'no-dsh-repo') console.log(`  fleet: DSH build ${result.status}`)
      saveStatusPart(dir, 'dsh', { status: result.status, head: result.head ?? null })
      process.exit(['install-failed', 'build-failed'].includes(result.status) ? 1 : 0)
    } else if (cmd === 'repos') {
      result = followRepos(dir, { force: Boolean(args.force) })
      writeHostStatus(dir)
    } else if (cmd === 'apps') {
      if (args.master) writeJson(join(dir, APPS_MANIFEST), { ...readJson(join(dir, APPS_MANIFEST), {}), master: hostKey(hostname()) })
      result = syncApps(dir, { force: true, dryRun: Boolean(args['dry-run']) })
      if (!args['dry-run']) writeHostStatus(dir)
    } else if (cmd === 'status') {
      const statusDir = join(dir, STATUS_DIR)
      result = existsSync(statusDir) ? readdirSync(statusDir).filter(f => f.endsWith('.json')).map(f => readJson(join(statusDir, f), null)) : []
    } else if (cmd === 'add-secret' && target) {
      result = addSecret(dir, target, { id: args.id })
    } else if (cmd === 'add-repo' && target) {
      result = addRepo(dir, resolve(target), { mode: args.mode ?? 'follow', build: args.build })
    } else if (cmd === 'take-secret' && target) {
      const { findBrainKey } = await import('./brain-sync.mjs')
      result = takeSecret(dir, target, { key: findBrainKey({ dir })?.key })
    } else {
      console.error('usage: fleet.mjs build [--name n] | repos [--force] | apps [--master] [--dry-run] | status | add-secret <path> [--id x] | add-repo <path> [--mode follow|watch] [--build dsh] | take-secret <id>')
      process.exit(2)
    }
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(`fleet: ${error.message}`)
    process.exit(1)
  }
}
