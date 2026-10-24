// node --test order-schema.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from './store.mjs'
import { migrateOrder, ensureScope } from './order-schema.mjs'

const A = { actor: 'Claude Opus (S1)', model: 'claude-opus-5-5' }

const cols = (db, t) => db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((r) => r.name)
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
const indexes = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name)
const ORDER_COLS = { projects: ['sort_order'], tasks: ['sort_order', 'order_override', 'top_order'] }

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'pm-order-'))
  return { dir, path: join(dir, 'pm.db'), done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('fresh store has all four order columns, both tables and the index', () => {
  const t = tmpDb()
  try {
    const s = openStore(t.path)
    s.close()
    const db = new DatabaseSync(t.path)
    for (const c of ORDER_COLS.projects) assert.ok(cols(db, 'projects').includes(c), `projects.${c}`)
    for (const c of ORDER_COLS.tasks) assert.ok(cols(db, 'tasks').includes(c), `tasks.${c}`)
    assert.ok(tables(db).includes('order_scopes'))
    assert.ok(tables(db).includes('order_drafts'))
    assert.ok(indexes(db).includes('tasks_order'))
    assert.deepEqual(migrateOrder(db), [])
    db.close()
  } finally { t.done() }
})

test(':memory: migrateOrder on v1 tables adds everything, second run returns []', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 2, rev INTEGER NOT NULL DEFAULT 1);
    INSERT INTO projects VALUES ('P-1', 'demo', 3);
    INSERT INTO tasks VALUES ('T-1', 'P-1', 'one', 1, 5), ('T-2', 'P-1', 'two', 2, 1);`)
  const beforeP = db.prepare('SELECT * FROM projects ORDER BY id').all().map((r) => ({ ...r }))
  const beforeT = db.prepare('SELECT * FROM tasks ORDER BY id').all().map((r) => ({ ...r }))
  assert.deepEqual(migrateOrder(db), ['projects.sort_order', 'tasks.sort_order', 'tasks.order_override', 'tasks.top_order'])
  assert.deepEqual(db.prepare('SELECT * FROM projects ORDER BY id').all().map((r) => ({ ...r })),
    beforeP.map((r) => ({ ...r, sort_order: null })))
  assert.deepEqual(db.prepare('SELECT * FROM tasks ORDER BY id').all().map((r) => ({ ...r })),
    beforeT.map((r) => ({ ...r, sort_order: null, order_override: 0, top_order: null })))
  assert.deepEqual(migrateOrder(db), [])
  db.close()
})

test('pre-order pm.db upgrades on open; existing rows unchanged except new NULL/0 columns', () => {
  const t = tmpDb()
  try {
    const s = openStore(t.path)
    s.createProject(A, { name: 'demo' })
    s.createTask(A, { project: 'demo', title: 'one' })
    s.createTask(A, { project: 'demo', title: 'two', priority: 1 })
    s.close()
    // Strip the order schema to get the shape of a pm.db from before this change.
    let db = new DatabaseSync(t.path)
    db.exec(`DROP INDEX tasks_order; DROP TABLE order_scopes; DROP TABLE order_drafts;
      ALTER TABLE projects DROP COLUMN sort_order; ALTER TABLE tasks DROP COLUMN sort_order;
      ALTER TABLE tasks DROP COLUMN order_override; ALTER TABLE tasks DROP COLUMN top_order;`)
    const beforeP = db.prepare('SELECT * FROM projects ORDER BY id').all().map((r) => ({ ...r }))
    const beforeT = db.prepare('SELECT * FROM tasks ORDER BY id').all().map((r) => ({ ...r }))
    const beforeE = db.prepare('SELECT COUNT(*) AS n FROM events').get().n
    db.close()

    const s2 = openStore(t.path)
    assert.equal(s2.listTasks({ project: 'demo' }).length, 2)
    s2.close()

    db = new DatabaseSync(t.path)
    assert.deepEqual(db.prepare('SELECT * FROM projects ORDER BY id').all().map((r) => ({ ...r })),
      beforeP.map((r) => ({ ...r, sort_order: null })))
    assert.deepEqual(db.prepare('SELECT * FROM tasks ORDER BY id').all().map((r) => ({ ...r })),
      beforeT.map((r) => ({ ...r, sort_order: null, order_override: 0, top_order: null })))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, beforeE)
    assert.deepEqual(migrateOrder(db), [])
    db.close()
  } finally { t.done() }
})

test('ensureScope inserts at rev 0 once and leaves an existing row alone', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT)')
  migrateOrder(db)
  assert.deepEqual(ensureScope(db, 'top', '2026-10-18T00:00:00.000Z'), { scope: 'top', rev: 0, updated_at: '2026-10-18T00:00:00.000Z' })
  db.exec("UPDATE order_scopes SET rev = 4 WHERE scope = 'top'")
  assert.deepEqual(ensureScope(db, 'top', '2026-10-19T00:00:00.000Z'), { scope: 'top', rev: 4, updated_at: '2026-10-18T00:00:00.000Z' })
  assert.equal(ensureScope(db, 'project:P-1', '2026-10-18T00:00:00.000Z').rev, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_scopes').get().n, 2)
  assert.throws(() => ensureScope(db, 'bogus', 'x'))
  db.close()
})

test('order_drafts rejects an unknown state', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT)')
  migrateOrder(db)
  db.prepare("INSERT INTO order_drafts (id, scope, base_rev, ids, actor, created_at) VALUES ('D-1', 'top', 0, '[]', 'a', 'now')").run()
  assert.equal(db.prepare("SELECT state FROM order_drafts WHERE id = 'D-1'").get().state, 'open')
  assert.throws(() => db.prepare("INSERT INTO order_drafts (id, scope, base_rev, ids, state, actor, created_at) VALUES ('D-2', 'top', 0, '[]', 'expired', 'a', 'now')").run())
  db.close()
})
