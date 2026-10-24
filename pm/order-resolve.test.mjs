import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTop, resolveProject, flatten, applyMove, sameMembers } from './order-resolve.mjs';

const P = (id, name, sort_order = null) => ({ id, name, sort_order });
const T = (id, project_id, o = {}) => ({ id, project_id, sort_order: null, priority: 2, created_at: '2026-10-01T00:00:00Z', order_override: 0, top_order: null, ...o });
const ids = (rows) => rows.map((r) => r.id);

test('resolveTop: ranked first, NULLs last, then name tie-break', () => {
  const top = resolveTop([P('P-c', 'charlie'), P('P-b', 'bravo', 2), P('P-a', 'alpha'), P('P-d', 'delta', 1)]);
  assert.deepEqual(ids(top), ['P-d', 'P-b', 'P-a', 'P-c']);
  assert.ok(top.every((e) => e.kind === 'project'));
});

test('resolveTop: overridden tasks interleave by top_order; non-overridden ignored', () => {
  const top = resolveTop(
    [P('P-a', 'alpha', 1), P('P-b', 'bravo', 3)],
    [T('T-x', 'P-b', { order_override: 1, top_order: 2 }), T('T-y', 'P-a', { order_override: 0, top_order: 0 })],
  );
  assert.deepEqual(top.map((e) => `${e.kind}:${e.id}`), ['project:P-a', 'task:T-x', 'project:P-b']);
});

test('resolveProject: sort_order NULLs last, then priority, then created_at', () => {
  const out = resolveProject([
    T('T-1', 'P', { priority: 3, created_at: '2026-01-01' }),
    T('T-2', 'P', { priority: 1, created_at: '2026-01-05' }),
    T('T-3', 'P', { sort_order: 5 }),
    T('T-4', 'P', { sort_order: 0 }),
    T('T-5', 'P', { priority: 1, created_at: '2026-01-02' }),
    T('T-6', 'P', { order_override: 1, top_order: 0 }),
  ]);
  assert.deepEqual(ids(out), ['T-4', 'T-3', 'T-5', 'T-2', 'T-1']);
});

const world = (pa, pb) => ({
  projects: [P('P-a', 'alpha', pa), P('P-b', 'bravo', pb)],
  tasks: [
    T('T-a1', 'P-a', { sort_order: 0 }),
    T('T-a2', 'P-a', { sort_order: 1 }),
    T('T-b1', 'P-b', { sort_order: 0 }),
    T('T-b2', 'P-b', { order_override: 1, top_order: 1 }),
  ],
});

test('flatten: project move carries its non-overridden tasks', () => {
  const before = world(0, 2);
  assert.deepEqual(ids(flatten(before.projects, before.tasks)), ['T-a1', 'T-a2', 'T-b2', 'T-b1']);
  const after = world(2, 0);
  assert.deepEqual(ids(flatten(after.projects, after.tasks)), ['T-b1', 'T-b2', 'T-a1', 'T-a2']);
});

test('flatten: overridden task stays put when its project moves', () => {
  const w1 = world(0, 2), w2 = world(0, 3);
  const f1 = flatten(w1.projects, w1.tasks), f2 = flatten(w2.projects, w2.tasks);
  const pos = (f, id) => f.findIndex((r) => r.id === id);
  assert.equal(pos(f1, 'T-b2'), pos(f2, 'T-b2'));
  // moving its project ahead of it does not drag it along
  const w3 = world(2, 0);
  const f3 = flatten(w3.projects, w3.tasks);
  assert.deepEqual(ids(f3).slice(0, 2), ['T-b1', 'T-b2']);
  assert.equal(f3.find((r) => r.id === 'T-b2').overridden, true);
});

test('flatten: effective keys per A1', () => {
  const w = world(0, 2);
  const f = flatten(w.projects, w.tasks);
  assert.deepEqual(f.find((r) => r.id === 'T-a2').key, [0, 1, 2, '2026-10-01T00:00:00Z']);
  assert.deepEqual(f.find((r) => r.id === 'T-b2').key, [1, -1, 2, '2026-10-01T00:00:00Z']);
  assert.deepEqual(f.find((r) => r.id === 'T-b1').key, [2, 0, 2, '2026-10-01T00:00:00Z']);
});

test('flatten: tasks of an unlisted project are appended last', () => {
  const f = flatten([P('P-a', 'alpha')], [T('T-z', 'P-gone'), T('T-a', 'P-a')]);
  assert.deepEqual(ids(f), ['T-a', 'T-z']);
});

test('flatten is deterministic regardless of input order', () => {
  const w = world(null, null);
  const a = ids(flatten(w.projects, w.tasks));
  const b = ids(flatten([...w.projects].reverse(), [...w.tasks].reverse()));
  assert.deepEqual(a, b);
});

const L = ['a', 'b', 'c', 'd'];

test('applyMove: to first and last', () => {
  assert.deepEqual(applyMove(L, 'c', { to_index: 0 }), ['c', 'a', 'b', 'd']);
  assert.deepEqual(applyMove(L, 'a', { to_index: 3 }), ['b', 'c', 'd', 'a']);
  assert.deepEqual(L, ['a', 'b', 'c', 'd'], 'input not mutated');
});

test('applyMove: before and after', () => {
  assert.deepEqual(applyMove(L, 'd', { before: 'b' }), ['a', 'd', 'b', 'c']);
  assert.deepEqual(applyMove(L, 'a', { after: 'c' }), ['b', 'c', 'a', 'd']);
  assert.deepEqual(applyMove(L, 'b', { after: 'd' }), ['a', 'c', 'd', 'b']);
  assert.deepEqual(applyMove(L, 'c', { before: 'a' }), ['c', 'a', 'b', 'd']);
  assert.deepEqual(applyMove(L, 'b', { before: 'b' }), L);
});

test('applyMove: out-of-range clamps', () => {
  assert.deepEqual(applyMove(L, 'b', { to_index: 99 }), ['a', 'c', 'd', 'b']);
  assert.deepEqual(applyMove(L, 'c', { to_index: -5 }), ['c', 'a', 'b', 'd']);
});

test('applyMove: unknown id/anchor or empty spec throws', () => {
  assert.throws(() => applyMove(L, 'x', { to_index: 0 }), /not in list/);
  assert.throws(() => applyMove(L, 'a', { before: 'x' }), /anchor/);
  assert.throws(() => applyMove(L, 'a', {}), /to_index, before or after/);
});

test('sameMembers: ok, dupes, missing, extra', () => {
  assert.deepEqual(sameMembers(['b', 'a'], ['a', 'b']), { ok: true, missing: [], extra: [], dupes: [] });
  assert.deepEqual(sameMembers(['a', 'a', 'b'], ['a', 'b']), { ok: false, missing: [], extra: [], dupes: ['a'] });
  assert.deepEqual(sameMembers(['a'], ['a', 'b']), { ok: false, missing: ['b'], extra: [], dupes: [] });
  assert.deepEqual(sameMembers(['a', 'b', 'z'], ['a', 'b']), { ok: false, missing: [], extra: ['z'], dupes: [] });
});
