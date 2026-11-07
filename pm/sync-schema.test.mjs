// node --test sync-schema.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { openStore } from './store.mjs'
import { ensureScope } from './order-schema.mjs'
import { migrateSync, syncCounter, changesSince, applyChanges, getState, setState } from './sync-schema.mjs'

const W = { actor: 'Claude Opus 5.5 (sync test)', model: 'claude-opus-5-5' }

// Store on :memory: with a settable clock, so updated_at ordering is controlled.
function mk(start = '2026-01-01T00:00:00.000Z') {
  let t = new Date(start).getTime()
  const s = openStore(':memory:', { clock: () => new Date(t) })
  s.tick = (ms = 1000) => { t += ms }
  s.at = (iso) => { t = new Date(iso).getTime() }
  migrateSync(s.db)
  return s
}

const all = (db, t, pk) => db.prepare(`SELECT * FROM ${t} ORDER BY ${pk}`).all().map(({ chg, ...r }) => ({ ...r }))
const rev = (db, t, id) => db.prepare(`SELECT rev FROM ${t} WHERE id = ?`).get(id).rev
const updP = (s, id, c) => s.updateProject(W, id, { ...c, rev: rev(s.db, 'projects', id) })
const updT = (s, id, c) => s.updateTask(W, id, { ...c, rev: rev(s.db, 'tasks', id) })
const pull = (from, to, peer) => applyChanges(to.db, changesSince(from.db, 0, 2000).rows, peer)

test('migrateSync is idempotent and backfills distinct chg', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, updated_at TEXT);
    INSERT INTO projects VALUES ('P1','a','x'),('P2','b','x');
    INSERT INTO tasks VALUES ('T1','P1','t','x'),('T2','P1','t','x'),('T3','P2','t','x');`)
  const added = migrateSync(db)
  assert.ok(added.includes('sync_state'))
  assert.ok(added.includes('projects.chg') && added.includes('tasks.chg'))
  assert.ok(added.includes('trigger sync_tasks_upd'))
  assert.ok(!added.some((a) => a.startsWith('order_scopes')), 'absent table skipped')
  const chgs = [...db.prepare('SELECT chg FROM projects').all(), ...db.prepare('SELECT chg FROM tasks').all()].map((r) => r.chg)
  assert.equal(new Set(chgs).size, 5)
  assert.ok(chgs.every((c) => c > 0))
  assert.equal(syncCounter(db), 5)
  assert.deepEqual(migrateSync(db), [])
  assert.equal(syncCounter(db), 5)
  db.close()
})

test('insert and update bump chg; chg-only writes do not loop', () => {
  const s = mk()
  const c0 = syncCounter(s.db)
  const p = s.createProject(W, { name: 'alpha' })
  const c1 = syncCounter(s.db)
  assert.ok(c1 > c0)
  assert.equal(s.db.prepare('SELECT chg FROM projects WHERE id = ?').get(p.id).chg, c1)
  updP(s, p.id, { description: 'd' })
  const c2 = syncCounter(s.db)
  assert.equal(c2, c1 + 1)
  assert.equal(s.db.prepare('SELECT chg FROM projects WHERE id = ?').get(p.id).chg, c2)
  s.db.prepare('UPDATE projects SET chg = 999 WHERE id = ?').run(p.id)
  assert.equal(syncCounter(s.db), c2, 'explicit chg write is not re-bumped')
  s.close()
})

test('changesSince pages in ascending chg across tables', () => {
  const s = mk()
  const p = s.createProject(W, { name: 'p' })
  for (let i = 0; i < 5; i++) s.createTask(W, { project: p.id, title: `t${i}` })
  ensureScope(s.db, 'top', '2026-01-01T00:00:00.000Z')
  const total = changesSince(s.db, 0, 2000)
  assert.equal(total.chg, syncCounter(s.db))
  assert.deepEqual(new Set(total.rows.map((r) => r.t)), new Set(['projects', 'tasks', 'order_scopes']))
  assert.ok(total.rows.every((r) => !('chg' in r.row)))
  const seen = []
  let after = 0
  for (;;) {
    const page = changesSince(s.db, after, 2)
    if (!page.rows.length) break
    assert.ok(page.rows.length <= 2)
    for (const r of page.rows) { assert.ok(r.chg > after); seen.push(r.chg); after = r.chg }
  }
  assert.deepEqual(seen, total.rows.map((r) => r.chg))
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b))
  assert.equal(changesSince(s.db, 0, 0).rows.length, 1, 'limit clamps to >= 1')
  s.close()
})

test('A -> B, B newer -> A, echo unchanged, older remote kept_local', () => {
  const A = mk(), B = mk()
  const p = A.createProject(W, { name: 'proj' })
  const t1 = A.createTask(W, { project: p.id, title: 'one' })
  A.createTask(W, { project: p.id, title: 'two' })
  ensureScope(A.db, `project:${p.id}`, '2026-01-01T00:00:00.000Z')

  const r1 = pull(A, B, 'A')
  assert.equal(r1.inserted, 4)
  assert.deepEqual(r1.errors, [])
  for (const [t, pk] of [['projects', 'id'], ['tasks', 'id'], ['order_scopes', 'scope']]) assert.deepEqual(all(B.db, t, pk), all(A.db, t, pk), t)

  B.at('2026-02-01T00:00:00.000Z')
  updT(B, t1.id, { title: 'one (edited on B)' })
  const r2 = pull(B, A, 'B')
  assert.equal(r2.updated, 1)
  assert.equal(A.getTask(t1.id).title, 'one (edited on B)')

  const r3 = pull(A, B, 'A')
  assert.equal(r3.updated, 0)
  assert.equal(r3.kept_local, 0)
  assert.equal(r3.unchanged, r3.inserted + r3.unchanged + r3.updated + r3.kept_local)
  assert.deepEqual(all(B.db, 'tasks', 'id'), all(A.db, 'tasks', 'id'))

  // B edits again later; a stale A row aimed at B is kept_local.
  const stale = changesSince(A.db, 0, 2000).rows.filter((r) => r.row.id === t1.id)
  B.tick(60000)
  updT(B, t1.id, { title: 'newest on B' })
  const r4 = applyChanges(B.db, stale, 'A')
  assert.equal(r4.kept_local, 1)
  assert.equal(B.getTask(t1.id).title, 'newest on B')
  A.close(); B.close()
})

test('project name clash renames with peer suffix and stays stable', () => {
  const A = mk(), B = mk()
  const pa = A.createProject(W, { name: 'shared' })
  const pb = B.createProject(W, { name: 'shared' })
  const r1 = pull(A, B, 'A')
  assert.deepEqual(r1.renamed, [{ id: pa.id, from: 'shared', to: 'shared (A)' }])
  const r2 = pull(B, A, 'B')
  assert.deepEqual(r2.renamed, [{ id: pb.id, from: 'shared', to: 'shared (B)' }])
  assert.equal(r2.updated, 0)
  for (let i = 0; i < 2; i++) {
    const x = pull(A, B, 'A'), y = pull(B, A, 'B')
    for (const r of [x, y]) {
      assert.equal(r.updated + r.inserted + r.kept_local, 0, JSON.stringify(r))
      assert.deepEqual(r.renamed, [])
    }
  }
  // A newer edit on the renamed project keeps B's local suffix.
  A.at('2026-03-01T00:00:00.000Z')
  updP(A, pa.id, { description: 'new' })
  const r3 = pull(A, B, 'A')
  assert.equal(r3.updated, 1)
  const onB = B.db.prepare('SELECT name, description FROM projects WHERE id = ?').get(pa.id)
  assert.equal(onB.name, 'shared (A)')
  assert.equal(onB.description, 'new')
  assert.equal(pull(B, A, 'B').updated, 0)
  A.close(); B.close()
})

test('order_scopes replicates; task before project in batch works', () => {
  const A = mk(), B = mk()
  const p = A.createProject(W, { name: 'p' })
  A.createTask(W, { project: p.id, title: 't' })
  ensureScope(A.db, 'top', '2026-01-01T00:00:00.000Z')
  const rows = changesSince(A.db, 0, 2000).rows.reverse()
  assert.equal(rows[0].t, 'order_scopes')
  assert.equal(rows.at(-1).t, 'projects')
  const r = applyChanges(B.db, rows, 'A')
  assert.deepEqual(r.errors, [])
  assert.equal(r.inserted, 3)
  assert.deepEqual(all(B.db, 'order_scopes', 'scope'), all(A.db, 'order_scopes', 'scope'))
  assert.equal(B.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys restored')
  assert.deepEqual(B.db.prepare('PRAGMA foreign_key_check').all(), [])
  A.close(); B.close()
})

test('unknown remote columns ignored, bad rows go to errors without aborting', () => {
  const A = mk(), B = mk()
  const p = A.createProject(W, { name: 'p' })
  const rows = changesSince(A.db, 0).rows.map((r) => ({ ...r, row: { ...r.row, future_col: 'x', chg: 12345 } }))
  rows.push({ t: 'tasks', chg: 0, row: { id: 'T-bad' } }) // missing NOT NULL columns
  rows.push({ t: 'nope', chg: 0, row: { id: 'x' } })
  const r = applyChanges(B.db, rows, 'A')
  assert.equal(r.inserted, 1)
  assert.equal(r.errors.length, 2)
  assert.ok(B.db.prepare('SELECT chg FROM projects WHERE id = ?').get(p.id).chg !== 12345)
  A.close(); B.close()
})

test('getState/setState round trip', () => {
  const s = mk()
  assert.equal(getState(s.db, 'cursor:ndi2'), null)
  setState(s.db, 'cursor:ndi2', 42)
  setState(s.db, 'cursor:ndi2', 43)
  assert.equal(getState(s.db, 'cursor:ndi2'), '43')
  s.close()
})
