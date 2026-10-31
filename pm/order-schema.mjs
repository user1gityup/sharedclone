// Ordering schema: project/task rank columns plus per-scope revision and draft tables.
// Upgrade-in-place like store.mjs migrate(): nullable/defaulted ALTER TABLE only,
// no existing row is rewritten, so current views look identical until a reorder.

export const ORDER_COLUMNS = [
  ['projects', 'sort_order', 'INTEGER'],
  ['tasks', 'sort_order', 'INTEGER'],
  ['tasks', 'order_override', 'INTEGER NOT NULL DEFAULT 0'],
  ['tasks', 'top_order', 'INTEGER'],
]

const ORDER_SCHEMA = `
CREATE TABLE IF NOT EXISTS order_scopes (
  scope TEXT PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_drafts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL, base_rev INTEGER NOT NULL,
  ids TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','committed','discarded','stale')),
  actor TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL, committed_at TEXT);
CREATE INDEX IF NOT EXISTS tasks_order ON tasks(project_id, sort_order);
`

/** Add the ordering columns/tables/index. Idempotent; returns the columns added as 'table.column'. */
export function migrateOrder(db) {
  const added = []
  const cols = new Map()
  for (const [table, col, type] of ORDER_COLUMNS) {
    if (!cols.has(table)) {
      cols.set(table, new Set(db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name)))
    }
    if (cols.get(table).has(col)) continue
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
    cols.get(table).add(col)
    added.push(`${table}.${col}`)
  }
  db.exec(ORDER_SCHEMA)
  return added
}

/** Insert the order_scopes row at rev 0 if missing; returns the current row. */
export function ensureScope(db, scope, now) {
  if (typeof scope !== 'string' || !(scope === 'top' || /^project:.+/.test(scope))) {
    throw new Error(`invalid order scope: ${scope}`)
  }
  const at = now || new Date().toISOString()
  db.prepare('INSERT OR IGNORE INTO order_scopes (scope, rev, updated_at) VALUES (?, 0, ?)').run(scope, at)
  return { ...db.prepare('SELECT scope, rev, updated_at FROM order_scopes WHERE scope = ?').get(scope) }
}
