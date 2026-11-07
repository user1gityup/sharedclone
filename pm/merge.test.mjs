import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeMerge, diffLines, unifiedDiff } from './merge.mjs';

test('proposeMerge returns a proposal with contract shape', () => {
  const p = proposeMerge({ path: 'reports/x.md', base: 'a\nb\n', ours: 'a\nB1\n', theirs: 'a\nB2\n', actor: 'claude-code' });
  assert.equal(p.status, 'proposed');
  assert.equal(p.path, 'reports/x.md');
  assert.match(p.id, /^[0-9a-f-]{36}$/);
  assert.match(p.diff, /^-B1$/m);
  assert.match(p.diff, /^\+B2$/m);
  assert.equal(p.identical, false);
  assert.equal(p.ours_sha256.length, 64);
});

test('proposeMerge never touches the file on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'merge-'));
  try {
    const f = join(dir, 'x.md');
    writeFileSync(f, 'ours\n');
    proposeMerge({ path: f, base: 'base\n', ours: 'ours\n', theirs: 'theirs\n', actor: 'a' });
    assert.equal(readFileSync(f, 'utf8'), 'ours\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ids are unique and proposal is frozen', () => {
  const args = { path: 'p', base: '', ours: 'x', theirs: 'y', actor: 'a' };
  const a = proposeMerge(args), b = proposeMerge(args);
  assert.notEqual(a.id, b.id);
  assert.throws(() => { a.status = 'merged'; });
});

test('identical sides flagged', () => {
  assert.equal(proposeMerge({ path: 'p', ours: 'z', theirs: 'z', actor: 'a' }).identical, true);
});

test('bad input rejected with code', () => {
  assert.throws(() => proposeMerge({ ours: 'a', theirs: 'b', actor: 'x' }), { code: 'BAD_REQUEST' });
  assert.throws(() => proposeMerge({ path: 'p', ours: 'a', theirs: 'b' }), { code: 'BAD_REQUEST' });
  assert.throws(() => proposeMerge({ path: 'p', ours: 1, theirs: 'b', actor: 'x' }), { code: 'BAD_REQUEST' });
});

test('diffLines handles CRLF and insert/delete', () => {
  const ops = diffLines('a\r\nb\r\nc', 'a\nc\nd');
  assert.deepEqual(ops.map((o) => o.op + o.line), [' a', '-b', ' c', '+d']);
  assert.equal(unifiedDiff('x', 'x').split('\n')[2], ' x');
});
