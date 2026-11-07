// Tests for the C6 broker roots, error codes and dual write. Temp dirs only.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { brainWrite, setApprovalResolver } from './brain-write.mjs'

let dir, brain, copy
const sha = (s) => createHash('sha256').update(s).digest('hex')
const code = (fn) => { try { fn() } catch (e) { return e.data?.code } return 'NO_ERROR' }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bw-'))
  brain = join(dir, 'brain'); copy = join(dir, 'repo')
  process.env.PM_BRAIN_DIR = brain
  process.env.PM_BRAIN_AUDIT = join(dir, 'audit.jsonl')
  delete process.env.PM_BRAIN_COPY_DIR
  setApprovalResolver(null)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }); setApprovalResolver(null) })

test('reports/, prompts/, projects/<name>/ accepted', () => {
  for (const p of ['reports/a.md', 'prompts/b.txt', 'projects/lead-hub/notes.md']) {
    const r = brainWrite({ path: p, content: 'x' })
    assert.equal(r.path, p)
    assert.equal(readFileSync(join(brain, ...p.split('/')), 'utf8'), 'x')
  }
})

test('OUTSIDE_ROOTS for other roots and bare projects/ files', () => {
  assert.equal(code(() => brainWrite({ path: 'MEMORY.md', content: 'x' })), 'OUTSIDE_ROOTS')
  assert.equal(code(() => brainWrite({ path: 'rules/CLAUDE.md', content: 'x' })), 'OUTSIDE_ROOTS')
  assert.equal(code(() => brainWrite({ path: 'projects/x.md', content: 'x' })), 'OUTSIDE_ROOTS')
})

test('TRAVERSAL refused', () => {
  assert.equal(code(() => brainWrite({ path: 'reports/../MEMORY.md', content: 'x' })), 'TRAVERSAL')
  assert.equal(code(() => brainWrite({ path: 'reports\\..\\..\\x.md', content: 'x' })), 'TRAVERSAL')
})

test('CONFLICT on stale sha; replace with matching sha', () => {
  brainWrite({ path: 'reports/c.md', content: 'one' })
  assert.equal(code(() => brainWrite({ path: 'reports/c.md', content: 'two', expected_sha256: sha('nope') })), 'CONFLICT')
  assert.equal(brainWrite({ path: 'reports/c.md', content: 'two', expected_sha256: sha('one') }).replaced, true)
})

test('handoff-*.md needs an approved handoff_write approval', () => {
  const p = 'handoff-2026-10-12-test.md'
  assert.equal(code(() => brainWrite({ path: p, content: 'h' })), 'APPROVAL_REQUIRED')
  const store = {
    a1: { id: 'a1', kind: 'handoff_write', status: 'approved', scope: { path: p } },
    a2: { id: 'a2', kind: 'handoff_write', status: 'pending', scope: {} },
    a3: { id: 'a3', kind: 'grant', status: 'approved', scope: {} },
    a4: { id: 'a4', kind: 'handoff_write', status: 'approved', scope: { path: 'handoff-other.md' } },
    a5: { id: 'a5', kind: 'handoff_write', status: 'approved', scope: {}, valid_until: '2000-01-01T00:00:00Z' },
  }
  assert.equal(code(() => brainWrite({ path: p, content: 'h', approval_id: 'a1' })), 'APPROVAL_REQUIRED', 'no resolver fails closed')
  setApprovalResolver((id) => store[id] ?? null)
  for (const id of ['a2', 'a3', 'a4', 'a5', 'missing']) assert.equal(code(() => brainWrite({ path: p, content: 'h', approval_id: id })), 'APPROVAL_REQUIRED', id)
  assert.equal(brainWrite({ path: p, content: 'h', approval_id: 'a1' }).path, p)
  assert.equal(code(() => brainWrite({ path: 'notes.md', content: 'h', approval_id: 'a1' })), 'OUTSIDE_ROOTS')
})

test('dual write lands in repo copy with provenance header', () => {
  const r = brainWrite({ path: 'projects/demo/r.md', content: 'body', actor: 'Claude Opus 5.5', model: 'claude-opus-5-5', run_id: 'run-1' }, { copyDir: copy })
  const text = readFileSync(join(copy, 'projects', 'demo', 'r.md'), 'utf8')
  const m = text.match(/^<!-- provenance: (.*) -->\n([\s\S]*)$/)
  assert.ok(m, 'header present')
  const prov = JSON.parse(m[1])
  assert.deepEqual(Object.keys(prov).sort(), ['actor', 'at', 'model', 'run_id', 'sha256'])
  assert.equal(prov.sha256, r.sha256); assert.equal(prov.run_id, 'run-1'); assert.equal(prov.actor, 'Claude Opus 5.5')
  assert.equal(m[2], 'body')
  assert.equal(readFileSync(join(brain, 'projects', 'demo', 'r.md'), 'utf8'), 'body', 'brain copy has no header')
})

test('dual write for .json uses a provenance sidecar; env var enables copy', () => {
  process.env.PM_BRAIN_COPY_DIR = copy
  brainWrite({ path: 'reports/d.json', content: '{"a":1}', run_id: 'r2' })
  assert.deepEqual(JSON.parse(readFileSync(join(copy, 'reports', 'd.json'), 'utf8')), { a: 1 })
  assert.equal(JSON.parse(readFileSync(join(copy, 'reports', 'd.json.provenance.json'), 'utf8')).run_id, 'r2')
})

test('refused write produces no copy', () => {
  assert.equal(code(() => brainWrite({ path: 'MEMORY.md', content: 'x' }, { copyDir: copy })), 'OUTSIDE_ROOTS')
  assert.equal(existsSync(copy), false)
})
