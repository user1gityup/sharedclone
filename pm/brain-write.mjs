// Bounded shared-brain write broker, exposed as the pm_brain_write MCP tool.
//
// Claude Code treats every file under ~/.claude as sensitive, so a headless
// bridge run (claude -p, nobody to answer a prompt) can never Write into the
// shared brain, whatever --allowedTools says. This broker is the one narrow way
// in: it writes only below the named roots, refuses traversal and any symlink or
// junction on the path, never silently overwrites (an existing file is replaced
// only when the caller passes the sha256 of what it read; otherwise 409 with the
// current hash), writes atomically, and appends every attempt to an audit log.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { safeRelative } from './bridge/files.mjs'

export const BRAIN_WRITE_ROOTS = ['reports', 'prompts', 'projects']
const HANDOFF_RE = /^handoff-[A-Za-z0-9._-]+\.md$/
const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

// C2 approval lookup (approvals.mjs, owned by ws-2a). Injected so this module
// loads without it; with no resolver every handoff write fails closed.
let approvalResolver = null
export function setApprovalResolver(fn) { approvalResolver = typeof fn === 'function' ? fn : null }

/** Project repo copy root for the dual write (E5/Q5); null = no copy. */
// PM_BRAIN_COPY_DIR wins ('off' disables); otherwise the live brain copies to ~/.claude/pm-data/brain-copy.
// A PM_BRAIN_DIR override (tests, other brains) gets no default copy, so tests never write into home.
export function copyDir() {
  const v = process.env.PM_BRAIN_COPY_DIR
  if (v) return v.toLowerCase() === 'off' ? null : v
  return process.env.PM_BRAIN_DIR ? null : join(homedir(), '.claude', 'pm-data', 'brain-copy')
}
export const MAX_BRAIN_WRITE_BYTES = 1024 * 1024

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

export function brainDir() {
  return process.env.PM_BRAIN_DIR || join(homedir(), '.claude', 'shared-brain')
}

export function auditFile() {
  return process.env.PM_BRAIN_AUDIT || join(homedir(), '.claude', 'pm-data', 'brain-write-audit.jsonl')
}

function fail(code, error, extra = {}) {
  const err = new Error(error)
  err.data = { code, ...extra }
  throw err
}

/** Throw if any existing component from the brain root down to target is a symlink or junction. */
function refuseLinks(root, parts) {
  let p = root
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) fail('LINK_REFUSED', `brain root is a link: ${p}`)
  for (const part of parts) {
    p = join(p, part)
    if (!existsSync(p)) return
    if (lstatSync(p).isSymbolicLink()) fail('LINK_REFUSED', `link on path refused: ${p}`)
  }
}

/**
 * Write `content` to <brain>/<path>. path must start with one of BRAIN_WRITE_ROOTS
 * and end in .md, .json or .txt. Returns { path, bytes, sha256, replaced }.
 */
export function brainWrite({ path, content, expected_sha256, actor, model, approval_id, run_id } = {}, opts = {}) {
  const audit = (outcome, extra = {}) => {
    try {
      mkdirSync(dirname(auditFile()), { recursive: true })
      appendFileSync(auditFile(), JSON.stringify({ at: new Date().toISOString(), actor: actor ?? process.env.PM_ACTOR ?? null, model: model ?? process.env.PM_MODEL ?? null, path, outcome, ...extra }) + '\n')
    } catch {}
  }
  try {
    if (typeof content !== 'string') fail('BAD_REQUEST', 'content must be a string')
    const bytes = Buffer.from(content, 'utf8')
    if (bytes.length > MAX_BRAIN_WRITE_BYTES) fail('TOO_LARGE', `content is ${bytes.length} bytes; limit ${MAX_BRAIN_WRITE_BYTES}`)
    if (typeof path === 'string' && path.replace(/\\/g, '/').split('/').includes('..')) fail('TRAVERSAL', `path traversal refused: ${path}`)
    let rel
    try { rel = safeRelative(path) } catch (err) { fail('BAD_PATH', err.message) }
    const parts = rel.split('/')
    if (parts.length === 1 && HANDOFF_RE.test(parts[0])) {
      const lookup = opts.getApproval ?? approvalResolver
      const appr = approval_id && lookup ? lookup(approval_id) : null
      const ok = appr && appr.kind === 'handoff_write' && appr.status === 'approved' &&
        (!appr.valid_until || Date.parse(appr.valid_until) > Date.now()) &&
        (!appr.scope?.path || appr.scope.path === rel)
      if (!ok) fail('APPROVAL_REQUIRED', `${rel} needs an approved handoff_write approval_id`, { approval_id: approval_id ?? null })
    } else if (parts.length < 2 || !BRAIN_WRITE_ROOTS.includes(parts[0])) {
      fail('OUTSIDE_ROOTS', `path must be under reports/, prompts/, projects/<name>/ or an approved handoff-*.md: ${rel}`)
    } else if (parts[0] === 'projects' && (parts.length < 3 || !PROJECT_NAME_RE.test(parts[1]))) {
      fail('OUTSIDE_ROOTS', `projects/ writes need projects/<name>/<file>: ${rel}`)
    }
    if (!/\.(md|json|txt)$/i.test(rel)) fail('BAD_PATH', `only .md, .json or .txt: ${rel}`)
    const root = brainDir()
    refuseLinks(root, parts)
    const target = join(root, ...parts)
    let replaced = false
    if (existsSync(target)) {
      const current = sha(readFileSync(target))
      if (!expected_sha256) fail('EXISTS', `${rel} exists; read it and pass expected_sha256 to replace it`, { current_sha256: current })
      if (expected_sha256 !== current) fail('CONFLICT', `${rel} changed since you read it; merge for review instead of overwriting`, { current_sha256: current })
      replaced = true
    }
    mkdirSync(dirname(target), { recursive: true })
    refuseLinks(root, parts) // re-check after mkdir: nothing may have swapped a link in
    const tmp = `${target}.${randomUUID()}.tmp`
    try {
      writeFileSync(tmp, bytes, { flag: 'wx' })
      renameSync(tmp, target)
    } finally {
      if (existsSync(tmp)) rmSync(tmp, { force: true })
    }
    const result = { path: rel, bytes: bytes.length, sha256: sha(bytes), replaced }
    const cdir = opts.copyDir ?? copyDir()
    if (cdir) result.copy = writeCopy(cdir, parts, content, { actor: actor ?? process.env.PM_ACTOR ?? null, model: model ?? process.env.PM_MODEL ?? null, run_id: run_id ?? null, sha256: result.sha256, at: new Date().toISOString() })
    audit('ok', result)
    return result
  } catch (err) {
    audit('refused', { error: err.message, code: err.data?.code })
    throw err
  }
}

/** Dual write: project repo copy with a provenance header { actor, model, run_id, sha256, at }. */
function writeCopy(cdir, parts, content, prov) {
  refuseLinks(cdir, parts)
  const target = join(cdir, ...parts)
  mkdirSync(dirname(target), { recursive: true })
  const ext = parts.at(-1).toLowerCase()
  let body, sidecar = null
  if (ext.endsWith('.json')) { body = content; sidecar = target + '.provenance.json' }
  else body = `<!-- provenance: ${JSON.stringify(prov)} -->\n` + content
  const tmp = `${target}.${randomUUID()}.tmp`
  try { writeFileSync(tmp, body, { flag: 'wx' }); renameSync(tmp, target) } finally { if (existsSync(tmp)) rmSync(tmp, { force: true }) }
  if (sidecar) writeFileSync(sidecar, JSON.stringify(prov, null, 2) + '\n')
  return { path: parts.join('/'), provenance: prov }
}
