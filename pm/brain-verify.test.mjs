// node --test brain-verify.test.mjs   (run from this folder)
// BRAIN_SELFTEST=1 also runs the full .sync/selftest.mjs (about 2 minutes) as the live conflict proof.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as B from './brain-verify.mjs'

const tree = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'bv-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c) }
  return d
}

test('two identical trees (CRLF vs LF, evidence dirs ignored) have zero drift', () => {
  const a = tree({ 'MEMORY.md': 'x\ny\n', 'n/a.md': 'a', '.rules-drift/e.md': 'only here', '.git/HEAD': 'a' })
  const b = tree({ 'MEMORY.md': 'x\r\ny\r\n', 'n/a.md': 'a' })
  const d = B.diffManifests(B.manifest(a), B.manifest(b))
  assert.deepEqual(d, { consistent: true, onlyA: [], onlyB: [], changed: [] })
  rmSync(a, { recursive: true }); rmSync(b, { recursive: true })
})

test('drift reports missing and changed notes', () => {
  const a = tree({ 'one.md': '1', 'two.md': '2', 'only-a.md': 'a' })
  const b = tree({ 'one.md': '1', 'two.md': 'CHANGED', 'only-b.md': 'b' })
  const d = B.diffManifests(B.manifest(a), B.manifest(b))
  assert.equal(d.consistent, false)
  assert.deepEqual([d.onlyA, d.onlyB, d.changed], [['only-a.md'], ['only-b.md'], ['two.md']])
  rmSync(a, { recursive: true }); rmSync(b, { recursive: true })
})

test('one-sided and identical edits resolve without conflict', () => {
  assert.equal(B.mergeNote('a', 'a', 'b').result, 'remote')
  assert.equal(B.mergeNote('a', 'b', 'a').result, 'local')
  assert.equal(B.mergeNote('a', 'b', 'b').result, 'same')
})

test('non-overlapping line edits merge and lose nothing', () => {
  const base = 'l1\nl2\nl3'
  const local = 'L1\nl2\nl3'
  const remote = 'l1\nl2\nR3'
  const m = B.mergeNote(base, local, remote)
  assert.equal(m.result, 'merged')
  assert.equal(m.merged, 'L1\nl2\nR3')
  assert.ok(B.preservesContent(base, local, remote, m.merged))
})

test('append-only logs merge keeping both tails', () => {
  const m = B.mergeNote('log\n', 'log\nA\n', 'log\nB\n')
  assert.equal(m.result, 'merged')
  assert.ok(m.merged.includes('A') && m.merged.includes('B'))
})

test('same-line concurrent edit is a conflict that keeps both full versions', () => {
  const base = 'status: open\nnote'
  const local = 'status: local\nnote'
  const remote = 'status: remote\nnote'
  const m = B.mergeNote(base, local, remote)
  assert.equal(m.result, 'conflict')
  assert.equal(m.backup, local)
  assert.equal(m.sidecar, remote)
  assert.equal(m.merged, local) // nothing silently overwritten
})

test('rules drift: edited copy is kept as evidence and master is restored', () => {
  assert.equal(B.revertRulesDrift('M\n', 'M\r\n').drifted, false)
  const r = B.revertRulesDrift('MASTER', 'EDITED', { at: '2026-11-01T00:00:00.000Z' })
  assert.deepEqual([r.drifted, r.text, r.evidence], [true, 'MASTER', 'EDITED'])
  assert.match(r.evidencePath, /^\.rules-drift\/codex-2026-11-01T00-00-00-000Z\.md$/)
})

test('layering: record layers win, compiler and agents never override', () => {
  assert.equal(B.authorityFor('resume'), 'pm')
  assert.equal(B.authorityFor('rules'), 'shared-brain')
  assert.throws(() => B.authorityFor('vibes'), /no authority/)
  const r = B.resolveClaims('task-state', [{ layer: 'agent', value: 'done' }, { layer: 'context-compiler', value: 'done' }, { layer: 'pm', value: 'review' }])
  assert.equal(r.winner.value, 'review')
  assert.equal(r.overridden.length, 2)
  const none = B.resolveClaims('task-state', [{ layer: 'agent', value: 'done' }])
  assert.equal(none.winner, null)
  assert.throws(() => B.resolveClaims('rules', [{ layer: 'pm-ui', value: 1 }]), /unknown layer/)
})

test('brief hash is stable under key order and changes with inputs', () => {
  assert.equal(B.briefHash({ a: 1, b: 2 }), B.briefHash({ b: 2, a: 1 }))
  assert.notEqual(B.briefHash({ a: 1 }), B.briefHash({ a: 2 }))
})

test('live brain-sync selftest (conflict sidecar, rules revert, two-machine joins)', { skip: !process.env.BRAIN_SELFTEST }, () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const r = spawnSync(process.execPath, [join(here, '..', '.sync', 'selftest.mjs')], { encoding: 'utf8', timeout: 600000 })
  assert.equal(r.status, 0, r.stdout.slice(-400))
  assert.match(r.stdout, /=== \d+\/\d+ passed ===/)
  assert.match(r.stdout, /join: sidecar is committed/)
})
