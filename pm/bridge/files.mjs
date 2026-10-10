// Bridge file transfer. A file is "delivered" only after this node has
// recomputed its SHA-256 from the bytes on disk and it matches the sender's.
// Files land under named roots only; names are canonicalized and an existing
// file is never overwritten (a new version gets a .vN suffix).
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, openSync, writeSync, closeSync, existsSync, statSync, renameSync, rmSync, createReadStream } from 'node:fs'
import { join, resolve, relative, isAbsolute, extname, basename, dirname, sep } from 'node:path'
import { homedir } from 'node:os'
import { BridgeError } from './protocol.mjs'

export const MAX_FILE_BYTES = Number(process.env.BRIDGE_MAX_FILE) || 200 * 1024 * 1024
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024

/** Named destination roots. `brain` writes only into its bridge-inbox, never over canonical notes. */
export function defaultRoots() {
  const home = homedir()
  return {
    inbox: process.env.BRIDGE_INBOX || join(home, '.claude', 'pm-data', 'bridge-files'),
    brain: join(home, '.claude', 'shared-brain', 'bridge-inbox'),
  }
}

/** Reject traversal, absolute paths, drive letters, device names; return a safe relative path. */
export function safeRelative(input) {
  if (typeof input !== 'string' || !input.trim()) throw new BridgeError(400, 'path is required')
  if (input.length > 255) throw new BridgeError(400, 'path too long')
  if (/[\0<>:"|?*]/.test(input)) throw new BridgeError(400, `path has forbidden characters: ${input}`)
  const norm = input.replace(/\\/g, '/')
  if (isAbsolute(input) || norm.startsWith('/')) throw new BridgeError(400, `absolute path refused: ${input}`)
  const parts = norm.split('/').filter((p) => p !== '' && p !== '.')
  if (!parts.length) throw new BridgeError(400, 'empty path')
  for (const p of parts) {
    if (p === '..') throw new BridgeError(400, `path traversal refused: ${input}`)
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(p)) throw new BridgeError(400, `reserved device name refused: ${p}`)
    if (/[. ]$/.test(p)) throw new BridgeError(400, `trailing dot or space refused: ${p}`)
  }
  return parts.join('/')
}

export function inside(root, target) {
  const rel = relative(resolve(root), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export async function fileSha256(path) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path)) h.update(chunk)
  return h.digest('hex')
}

export function createFiles(queue, { roots = defaultRoots() } = {}) {
  const { db, now } = queue
  const row = (id) => {
    const r = db.prepare('SELECT * FROM bridge_files WHERE id = ?').get(id)
    if (!r) throw new BridgeError(404, `no transfer ${id}`)
    return { ...r }
  }
  const partial = (r) => join(roots[r.root], '.partial', `${r.id}.part`)

  function begin(principal, { name, size, sha256, root = 'inbox', path, mime, from_machine }) {
    if (!roots[root]) throw new BridgeError(400, `unknown root ${root}; roots: ${Object.keys(roots).join(', ')}`)
    const rel = safeRelative(path ?? name)
    const n = Number(size)
    if (!Number.isInteger(n) || n < 0) throw new BridgeError(400, 'size must be a non-negative integer')
    if (n > MAX_FILE_BYTES) throw new BridgeError(413, `file exceeds ${MAX_FILE_BYTES} bytes`)
    if (!/^[0-9a-f]{64}$/.test(sha256 ?? '')) throw new BridgeError(400, 'sha256 must be 64 lowercase hex chars')
    const id = randomUUID()
    const t = now()
    db.prepare(`INSERT INTO bridge_files (id, name, root, rel_path, size, sha256, mime, state, from_machine, principal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?)`).run(id, basename(rel), root, rel, n, sha256, mime ?? null, from_machine ?? null, principal, t, t)
    mkdirSync(join(roots[root], '.partial'), { recursive: true })
    closeSync(openSync(partial(row(id)), 'w'))
    return row(id)
  }

  /** Append a chunk at `offset` (must equal bytes received so far; a repeated chunk is ignored, so retries are safe). */
  function chunk(id, offset, buf) {
    const r = row(id)
    if (r.state !== 'uploading') throw new BridgeError(409, `transfer ${id} is ${r.state}`)
    const off = Number(offset)
    if (off + buf.length <= r.received) return r // retried chunk already stored
    if (off !== r.received) throw new BridgeError(409, `offset ${off} != received ${r.received}`, { received: r.received })
    if (r.received + buf.length > r.size) throw new BridgeError(413, 'more bytes than declared size')
    const fd = openSync(partial(r), 'r+')
    try { writeSync(fd, buf, 0, buf.length, off) } finally { closeSync(fd) }
    db.prepare('UPDATE bridge_files SET received = ?, updated_at = ? WHERE id = ?').run(r.received + buf.length, now(), id)
    return row(id)
  }

  /** Verify the bytes on disk; only a matching SHA-256 moves the file into place as delivered. */
  async function complete(id) {
    const r = row(id)
    if (r.state === 'delivered') return r
    if (r.state !== 'uploading') throw new BridgeError(409, `transfer ${id} is ${r.state}`)
    const part = partial(r)
    const size = statSync(part).size
    const dest = await fileSha256(part)
    if (size !== r.size || dest !== r.sha256) {
      rmSync(part, { force: true })
      db.prepare("UPDATE bridge_files SET state = 'rejected', dest_sha256 = ?, error = ?, updated_at = ? WHERE id = ?")
        .run(dest, `checksum or size mismatch (got ${size} bytes, ${dest})`, now(), id)
      throw new BridgeError(422, 'checksum mismatch; transfer rejected', { transfer: row(id) })
    }
    const base = resolve(roots[r.root])
    let target = join(base, r.rel_path)
    if (!inside(base, target)) throw new BridgeError(400, 'resolved path escapes root')
    let version = 1
    const ext = extname(target)
    const stem = target.slice(0, target.length - ext.length)
    while (existsSync(target)) {
      version += 1
      target = `${stem}.v${version}${ext}`
    }
    mkdirSync(dirname(target), { recursive: true })
    renameSync(part, target)
    const t = now()
    db.prepare(`UPDATE bridge_files SET state = 'delivered', dest_sha256 = ?, final_path = ?, version = ?, delivered_at = ?, updated_at = ? WHERE id = ?`)
      .run(dest, target, version, t, t, id)
    return row(id)
  }

  function contentPath(id) {
    const r = row(id)
    if (r.state !== 'delivered') throw new BridgeError(409, `transfer ${id} is ${r.state}`)
    const base = resolve(roots[r.root])
    if (!inside(base, r.final_path)) throw new BridgeError(400, 'stored path escapes root')
    return r
  }

  const list = (limit = 50) => db.prepare('SELECT * FROM bridge_files ORDER BY created_at DESC LIMIT ?').all(limit).map((r) => ({ ...r }))

  return { begin, chunk, complete, get: row, contentPath, list, roots }
}

/** Client side: push a local file to a node. fetchImpl defaults to global fetch. */
export async function pushFile({ url, token, file, root = 'inbox', path, fromMachine, chunkBytes = 1024 * 1024 }) {
  const { readFileSync } = await import('node:fs')
  const sha = await fileSha256(file)
  const size = statSync(file).size
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }
  const call = async (method, p, body, extra = {}) => {
    const res = await fetch(`${url}${p}`, { method, headers: { ...headers, ...extra }, body })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new BridgeError(res.status, json.error || `HTTP ${res.status}`, json)
    return json
  }
  const t = await call('POST', '/api/bridge/files', JSON.stringify({ name: basename(file), path: path ?? basename(file), size, sha256: sha, root, from_machine: fromMachine }))
  const data = readFileSync(file)
  for (let off = 0; off < size || (size === 0 && off === 0); off += chunkBytes) {
    if (size === 0) break
    await call('PUT', `/api/bridge/files/${t.id}?offset=${off}`, data.subarray(off, off + chunkBytes), { 'content-type': 'application/octet-stream' })
  }
  const done = await call('POST', `/api/bridge/files/${t.id}/complete`, '{}')
  return { ...done, source_sha256: sha, source_path: file }
}

/** Client side: pull a delivered file from a node and verify its SHA-256 locally. */
export async function pullFile({ url, token, id, dest }) {
  const { writeFileSync } = await import('node:fs')
  const headers = token ? { authorization: `Bearer ${token}` } : {}
  const res = await fetch(`${url}/api/bridge/files/${id}/content`, { headers })
  if (!res.ok) throw new BridgeError(res.status, (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  const expected = res.headers.get('x-sha256')
  const buf = Buffer.from(await res.arrayBuffer())
  const got = createHash('sha256').update(buf).digest('hex')
  if (got !== expected) throw new BridgeError(422, `pulled bytes hash ${got}, node says ${expected}`)
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest)) throw new BridgeError(409, `${dest} exists; refusing to overwrite`)
  writeFileSync(dest, buf)
  const disk = await fileSha256(dest)
  if (disk !== expected) throw new BridgeError(422, 'written file hash mismatch')
  return { id, dest, sha256: disk, bytes: buf.length }
}

