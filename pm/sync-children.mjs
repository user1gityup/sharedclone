// Replication of pm's child tables (comments, artifacts). Their INTEGER
// AUTOINCREMENT ids collide across hosts, so rows are keyed by `uid` instead:
// historical rows get a deterministic uid (same row on two hosts -> same uid),
// new rows get a random one from the insert trigger. `chg` shares the
// sync_state 'chg' counter with sync-schema.mjs, so one cursor covers both.
// Comments may change only acked_by/acked_at; artifacts are immutable.
import { createHash } from 'node:crypto'
import { setState, syncCounter } from './sync-schema.mjs'

export const CHILD_TABLES = ['comments', 'artifacts']
// Content column folded into the deterministic uid.
const CONTENT = { comments: 'body', artifacts: 'ref' }

const columns = (db, t) => db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((r) => r.name)

export function historicalUid(t, row, dup = 0) {
  const base = [row.task_id, row.created_at, row.actor, row.kind, row[CONTENT[t]]].map((v) => String(v ?? '')).join('|')
  return createHash('sha256').update(dup ? `${base}#${dup}` : base).digest('hex').slice(0, 24)
}

/** Add uid/chg columns, deterministic uid backfill, chg backfill, unique index, triggers. Idempotent. */
export function migrateChildren(db) {
  const added = []
  db.exec('CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  db.prepare("INSERT OR IGNORE INTO sync_state (k, v) VALUES ('chg', '0')").run()

  db.exec('SAVEPOINT sync_children_migrate')
  try {
    for (const t of CHILD_TABLES) {
      const have = columns(db, t)
      if (!have.length) continue
      if (!have.includes('uid')) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN uid TEXT`)
        added.push(`${t}.uid`)
      }
      if (!have.includes('chg')) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN chg INTEGER NOT NULL DEFAULT 0`)
        added.push(`${t}.chg`)
      }

      const missing = db.prepare(`SELECT rowid AS r, * FROM ${t} WHERE uid IS NULL ORDER BY rowid`).all()
      if (missing.length) {
        const used = new Set(db.prepare(`SELECT uid FROM ${t} WHERE uid IS NOT NULL`).all().map((x) => x.uid))
        const set = db.prepare(`UPDATE ${t} SET uid = ? WHERE rowid = ?`)
        for (const row of missing) {
          let dup = 0
          let uid = historicalUid(t, row)
          while (used.has(uid)) uid = historicalUid(t, row, ++dup) // identical rows: k-th copy gets #k
          used.add(uid)
          set.run(uid, row.r)
        }
        added.push(`${t}.uid_backfill:${missing.length}`)
      }

      const zero = db.prepare(`SELECT rowid AS r FROM ${t} WHERE chg = 0 ORDER BY rowid`).all()
      if (zero.length) {
        let n = syncCounter(db)
        const set = db.prepare(`UPDATE ${t} SET chg = ? WHERE rowid = ?`)
        for (const { r } of zero) set.run(++n, r)
        setState(db, 'chg', n)
        added.push(`${t}.chg_backfill:${zero.length}`)
      }

      const idx = `sync_${t}_uid`
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(idx)) {
        db.exec(`CREATE UNIQUE INDEX ${idx} ON ${t}(uid)`)
        added.push(`index ${idx}`)
      }

      const next = `UPDATE sync_state SET v = CAST(v AS INTEGER) + 1 WHERE k = 'chg';`
      const cur = `(SELECT CAST(v AS INTEGER) FROM sync_state WHERE k = 'chg')`
      for (const [name, sql] of [
        [`sync_${t}_ins`, `CREATE TRIGGER sync_${t}_ins AFTER INSERT ON ${t} BEGIN ${next}
          UPDATE ${t} SET uid = COALESCE(uid, lower(hex(randomblob(12)))), chg = ${cur} WHERE rowid = NEW.rowid; END`],
        [`sync_${t}_upd`, `CREATE TRIGGER sync_${t}_upd AFTER UPDATE ON ${t} WHEN NEW.chg = OLD.chg BEGIN ${next}
          UPDATE ${t} SET chg = ${cur} WHERE rowid = NEW.rowid; END`],
      ]) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name)) continue
        db.exec(sql)
        added.push(`trigger ${name}`)
      }
    }
    db.exec('RELEASE sync_children_migrate')
  } catch (err) {
    db.exec('ROLLBACK TO sync_children_migrate')
    db.exec('RELEASE sync_children_migrate')
    throw err
  }
  return added
}

/** Child rows with chg > after, ascending, at most limit (1..2000). Rows omit id and chg. */
export function childChangesSince(db, after = 0, limit = 500) {
  const n = Math.floor(Number(limit))
  const lim = Math.min(2000, Math.max(1, Number.isFinite(n) ? n : 500))
  const from = Number(after) || 0
  const rows = []
  for (const t of CHILD_TABLES) {
    const cols = columns(db, t)
    if (!cols.includes('chg') || !cols.includes('uid')) continue
    for (const r of db.prepare(`SELECT * FROM ${t} WHERE chg > ? ORDER BY chg LIMIT ?`).all(from, lim)) {
      const { id, chg, ...row } = r
      rows.push({ t, chg, row: { ...row } })
    }
  }
  rows.sort((a, b) => a.chg - b.chg)
  return { chg: syncCounter(db), rows: rows.slice(0, lim) }
}

function bind(v) {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return v
}

/** Apply peer child rows in one transaction, matched by uid. `peer` is accepted for symmetry with applyChanges. */
export function applyChildChanges(db, rows, peer) {
  void peer
  const out = { inserted: 0, updated: 0, unchanged: 0, errors: [] }
  const cols = {}
  for (const t of CHILD_TABLES) cols[t] = columns(db, t).filter((c) => c !== 'id' && c !== 'chg')

  const fk = db.prepare('PRAGMA foreign_keys').get()?.foreign_keys ?? 1
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN IMMEDIATE')
  try {
    let n = 0
    for (const item of Array.isArray(rows) ? rows : []) {
      const t = item?.t
      const remote = item?.row
      const uid = remote?.uid
      if (!CHILD_TABLES.includes(t) || !cols[t].includes('uid') || !remote || !uid) {
        out.errors.push({ t, uid: uid ?? null, error: 'unknown table or missing uid' })
        continue
      }
      const sp = `sync_child_${n++}`
      db.exec(`SAVEPOINT ${sp}`)
      try {
        applyChildRow(db, t, cols[t].filter((c) => c in remote), remote, out)
        db.exec(`RELEASE ${sp}`)
      } catch (err) {
        db.exec(`ROLLBACK TO ${sp}`)
        db.exec(`RELEASE ${sp}`)
        out.errors.push({ t, uid, error: err.message })
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch {}
    throw err
  } finally {
    db.exec(`PRAGMA foreign_keys = ${fk ? 'ON' : 'OFF'}`)
  }
  return out
}

function applyChildRow(db, t, shared, remote, out) {
  const local = db.prepare(`SELECT * FROM ${t} WHERE uid = ?`).get(remote.uid)
  if (!local) {
    db.prepare(`INSERT INTO ${t} (${shared.join(', ')}) VALUES (${shared.map(() => '?').join(', ')})`)
      .run(...shared.map((c) => bind(remote[c])))
    out.inserted++
    return
  }
  if (t === 'comments' && remote.acked_by && !local.acked_by) {
    db.prepare('UPDATE comments SET acked_by = ?, acked_at = ? WHERE uid = ?')
      .run(bind(remote.acked_by), bind(remote.acked_at ?? null), remote.uid)
    out.updated++
    return
  }
  out.unchanged++
}

