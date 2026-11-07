// node --test sync-children.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from './store.mjs'
import { migrateSync, changesSince, applyChanges, syncCounter } from './sync-schema.mjs'
import { CHILD_TABLES, migrateChildren, childChangesSince, applyChildChanges } from './sync-children.mjs'

const W = { actor: 'Claude Opus 5.5 (sync-children test)', model: 'claude-opus-5-5' }
const WB = { actor: 'Claude Opus 5.5 (host B)', model: 'claude-opus-5-5' }

function mk({ migrate = true } = {}) {
  const s = openStore(':memory:', { clock: () => new Date('2026-01-01T00:00:00.000Z') })
  if (migrate) { migrateSync(s.db); migrateChildren(s.db) }
  return s
}
const pullParents = (from, to) => applyChanges(to.db, changesSince(from.db, 0, 2000).rows, 'peer')
const pullKids = (from, to, after = 0) => applyChildChanges(to.db, childChangesSince(from.db, after, 2000).rows, 'peer')
const byUid = (db, t, uid) => db.prepare(`SELECT * FROM ${t} WHERE uid = ?`).get(uid)

// A and B with the same project/task (replicated A -> B).
function pair() {
  const A = mk(), B = mk()
  const p = A.createProject(W, { name: 'proj' })
  const task = A.createTask(W, { project: p.id, title: 'one' })
  assert.equal(pullParents(A, B).errors.length, 0)
  return { A, B, task }
}

test('CHILD_TABLES lists comments and artifacts', () => {
  assert.deepEqual(CHILD_TABLES, ['comments', 'artifacts'])
})

test('migrateChildren is idempotent', () => {
  const s = mk()
  assert.deepEqual(migrateChildren(s.db), [])
  for (const t of CHILD_TABLES) {
    const cols = s.db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((r) => r.name)
    assert.ok(cols.includes('uid') && cols.includes('chg'))
  }
})

test('same historical comment on both hosts gets the same uid; chg backfilled', () => {
  const A = mk({ migrate: false }), B = mk({ migrate: false })
  for (const s of [A, B]) {
    s.db.exec('PRAGMA foreign_keys = OFF')
    // Different local ids on purpose: B has an extra older row first.
    if (s === B) s.db.prepare("INSERT INTO comments (task_id, kind, body, actor, created_at) VALUES ('T0','comment','other','x','2025-01-01')").run()
    s.db.prepare("INSERT INTO comments (task_id, kind, body, actor, created_at) VALUES ('T1','instruction','do it','y','2025-02-02')").run()
    s.db.prepare("INSERT INTO comments (task_id, kind, body, actor, created_at) VALUES ('T1','instruction','do it','y','2025-02-02')").run() // exact duplicate
    s.db.prepare("INSERT INTO artifacts (task_id, kind, ref, actor, created_at) VALUES ('T1','url','https://x','y','2025-02-03')").run()
    migrateSync(s.db)
    migrateChildren(s.db)
  }
  const q = (s) => s.db.prepare("SELECT uid FROM comments WHERE task_id = 'T1' ORDER BY id").all().map((r) => r.uid)
  assert.deepEqual(q(A), q(B))
  assert.equal(new Set(q(A)).size, 2, 'duplicates get distinct uids')
  assert.equal(A.db.prepare('SELECT uid FROM artifacts').get().uid, B.db.prepare('SELECT uid FROM artifacts').get().uid)
  assert.match(q(A)[0], /^[0-9a-f]{24}$/)
  const chgs = A.db.prepare('SELECT chg FROM comments UNION ALL SELECT chg FROM artifacts').all().map((r) => r.chg)
  assert.ok(chgs.every((c) => c > 0))
  assert.equal(new Set(chgs).size, chgs.length)
  assert.equal(syncCounter(A.db), Math.max(...chgs))
  // Pulling between them changes nothing: the rows already match by uid.
  const r = pullKids(A, B)
  assert.deepEqual([r.inserted, r.updated, r.errors.length], [0, 0, 0])
})

test('new comment on A replicates to B with a different local id', () => {
  const { A, B, task } = pair()
  B.addComment(WB, task.id, { body: 'B first, takes id 1' })
  const c = A.addComment(W, task.id, { body: 'hello', kind: 'instruction' })
  const ca = A.db.prepare('SELECT * FROM comments WHERE id = ?').get(c.id)
  assert.match(ca.uid, /^[0-9a-f]{24}$/)
  assert.ok(ca.chg > 0)
  const r = pullKids(A, B)
  assert.deepEqual([r.inserted, r.errors.length], [1, 0])
  const cb = byUid(B.db, 'comments', ca.uid)
  assert.ok(cb)
  assert.notEqual(cb.id, ca.id)
  assert.equal(cb.body, 'hello')
  assert.equal(cb.kind, 'instruction')
  assert.ok(cb.chg > 0)
})

test('ack on B flows to A; echo back is unchanged', () => {
  const { A, B, task } = pair()
  const c = A.addComment(W, task.id, { body: 'please ack', kind: 'instruction' })
  const uid = A.db.prepare('SELECT uid FROM comments WHERE id = ?').get(c.id).uid
  pullKids(A, B)
  const local = byUid(B.db, 'comments', uid)
  const before = local.chg
  B.ackInstruction(WB, local.id)
  const acked = byUid(B.db, 'comments', uid)
  assert.ok(acked.chg > before, 'update trigger bumped chg')

  const aCur = syncCounter(A.db)
  const r = pullKids(B, A)
  assert.equal(r.errors.length, 0)
  assert.equal(r.updated, 1)
  const onA = byUid(A.db, 'comments', uid)
  assert.equal(onA.acked_by, WB.actor)
  assert.equal(onA.acked_at, acked.acked_at)

  // Echo: A's changed row goes back to B -> unchanged, and B's ack is not undone.
  const echo = applyChildChanges(B.db, childChangesSince(A.db, aCur, 2000).rows, 'A')
  assert.deepEqual([echo.inserted, echo.updated, echo.unchanged, echo.errors.length], [0, 0, 1, 0])
  // A remote row without an ack never clears a local ack.
  const stale = { ...onA, acked_by: null, acked_at: null }
  delete stale.id; delete stale.chg
  const s2 = applyChildChanges(A.db, [{ t: 'comments', chg: 1, row: stale }], 'B')
  assert.equal(s2.unchanged, 1)
  assert.equal(byUid(A.db, 'comments', uid).acked_by, WB.actor)
})

test('artifacts replicate once and stay immutable', () => {
  const { A, B, task } = pair()
  A.addArtifact(W, task.id, { kind: 'url', ref: 'https://example.test/a', note: 'n' })
  const first = pullKids(A, B)
  assert.deepEqual([first.inserted, first.errors.length], [1, 0])
  const again = pullKids(A, B)
  assert.deepEqual([again.inserted, again.updated, again.unchanged], [0, 0, 1])
  const uid = A.db.prepare('SELECT uid FROM artifacts').get().uid
  const changed = { ...byUid(A.db, 'artifacts', uid), note: 'tampered' }
  delete changed.id; delete changed.chg
  const r = applyChildChanges(B.db, [{ t: 'artifacts', chg: 99, row: changed }], 'A')
  assert.equal(r.unchanged, 1)
  assert.equal(byUid(B.db, 'artifacts', uid).note, 'n')
  assert.equal(B.db.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n, 1)
})

test('childChangesSince omits id/chg, orders by chg, honours cursor and limit', () => {
  const { A, task } = pair()
  A.addComment(W, task.id, { body: 'c1' })
  A.addArtifact(W, task.id, { kind: 'file', ref: 'f.txt' })
  A.addComment(W, task.id, { body: 'c2' })
  const { chg, rows } = childChangesSince(A.db, 0, 500)
  assert.equal(chg, syncCounter(A.db))
  assert.deepEqual(rows.map((r) => r.t), ['comments', 'artifacts', 'comments'])
  assert.ok(rows.every((r, i) => i === 0 || r.chg > rows[i - 1].chg))
  assert.ok(rows.every((r) => !('id' in r.row) && !('chg' in r.row) && r.row.uid))
  assert.equal(childChangesSince(A.db, rows[0].chg, 500).rows.length, 2)
  assert.equal(childChangesSince(A.db, 0, 1).rows.length, 1)
  // Shared counter: parent and child chg values never collide.
  const parent = changesSince(A.db, 0, 2000).rows.map((r) => r.chg)
  assert.equal(new Set([...parent, ...rows.map((r) => r.chg)]).size, parent.length + rows.length)
})

test('bad rows are reported, not thrown', () => {
  const s = mk()
  const r = applyChildChanges(s.db, [{ t: 'events', row: { uid: 'x' } }, { t: 'comments', row: {} }, null], 'p')
  assert.equal(r.errors.length, 3)
})
