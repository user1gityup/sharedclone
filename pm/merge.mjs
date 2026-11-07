// merge.mjs - C6: same-file edit conflict -> proposal for a reviewer.
// Pure: never writes to disk, never overwrites. The caller stores/surfaces the proposal.
import { createHash, randomUUID } from 'node:crypto';

const lines = (s) => (s == null ? [] : String(s).replace(/\r\n/g, '\n').split('\n'));
const sha256 = (s) => createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex');

/** Line diff via LCS. Returns ops [{op:' '|'-'|'+', line}]. */
export function diffLines(a, b) {
  const A = lines(a), B = lines(b), n = A.length, m = B.length;
  const t = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    t[i][j] = A[i] === B[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ op: ' ', line: A[i] }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) ops.push({ op: '-', line: A[i++] });
    else ops.push({ op: '+', line: B[j++] });
  }
  while (i < n) ops.push({ op: '-', line: A[i++] });
  while (j < m) ops.push({ op: '+', line: B[j++] });
  return ops;
}

/** Unified-style text (no hunk headers; full context). */
export function unifiedDiff(a, b, { from = 'a', to = 'b' } = {}) {
  return [`--- ${from}`, `+++ ${to}`, ...diffLines(a, b).map((o) => o.op + o.line)].join('\n');
}

/**
 * Same-file edit conflict -> proposal for a reviewer; never auto-overwrites.
 * @returns {{ id, path, diff, status:'proposed', actor, created_at, base_sha256, ours_sha256,
 *            theirs_sha256, identical:boolean, diffs:{ base_ours, base_theirs, ours_theirs } }}
 */
export function proposeMerge({ path, base, ours, theirs, actor } = {}) {
  if (!path || typeof path !== 'string') throw Object.assign(new Error('path required'), { code: 'BAD_REQUEST' });
  if (!actor || typeof actor !== 'string') throw Object.assign(new Error('actor required'), { code: 'BAD_REQUEST' });
  if (typeof ours !== 'string' || typeof theirs !== 'string')
    throw Object.assign(new Error('ours and theirs must be strings'), { code: 'BAD_REQUEST' });
  const b = typeof base === 'string' ? base : '';
  const diff = unifiedDiff(ours, theirs, { from: `${path} (current)`, to: `${path} (proposed by ${actor})` });
  return Object.freeze({
    id: randomUUID(),
    path,
    diff,
    status: 'proposed',
    actor,
    created_at: new Date().toISOString(),
    base_sha256: sha256(b),
    ours_sha256: sha256(ours),
    theirs_sha256: sha256(theirs),
    identical: ours === theirs,
    diffs: Object.freeze({
      base_ours: unifiedDiff(b, ours, { from: `${path} (base)`, to: `${path} (current)` }),
      base_theirs: unifiedDiff(b, theirs, { from: `${path} (base)`, to: `${path} (proposed)` }),
      ours_theirs: diff,
    }),
  });
}
