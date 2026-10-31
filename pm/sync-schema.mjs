// Two-way row replication schema for pm's project/task store.
// Every replicated row carries `chg`, a local monotonic change number kept by
// triggers; a peer pulls rows with chg > its cursor and applies them with
// last-writer-wins on updated_at (local wins ties). Zero dependencies.

export const SYNC_TABLES = [
  ['projects', 'id'],
  ['order_scopes', 'scope'],
  ['tasks', 'id'],
]
const PK = Object.fromEntries(SYNC_TABLES)
const ORDER = Object.fromEntries(SYNC_TABLES.map(([t], i) => [t, i]))

const columns = (db, t) => db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((r) => r.name)

function ensureStateTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
}

export function getState(db, k) {
  ensureStateTable(db)
  const row = db.prepare('SELECT v FROM sync_state WHERE k = ?').get(k)
  return row ? row.v : null
}

export function setState(db, k, v) {
  ensureStateTable(db)
  db.prepare('INSERT INTO sync_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v))
}

export function syncCounter(db) {
  return Number(getState(db, 'chg') ?? 0)
}

/** Add sync_state, chg columns, backfill and triggers. Idempotent; returns what it added. */
export function migrateSync(db) {
  const added = []
  const hadState = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_state'").get()
  ensureStateTable(db)
  if (!hadState) added.push('sync_state')
  db.prepare("INSERT OR IGNORE INTO sync_state (k, v) VALUES ('chg', '0')").run()

  db.exec('SAVEPOINT sync_migrate')
  try {
    for (const [t] of SYNC_TABLES) {
      const have = columns(db, t)
      if (!have.length) continue // table absent in this DB version
      if (!have.includes('chg')) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN chg INTEGER NOT NULL DEFAULT 0`)
        added.push(`${t}.chg`)
      }
      // Backfill: distinct increasing numbers from the counter.
      const zero = db.prepare(`SELECT rowid AS r FROM ${t} WHERE chg = 0 ORDER BY rowid`).all()
      if (zero.length) {
        let n = syncCounter(db)
        const set = db.prepare(`UPDATE ${t} SET chg = ? WHERE rowid = ?`)
        for (const { r } of zero) set.run(++n, r)
        setState(db, 'chg', n)
        added.push(`${t}.backfill:${zero.length}`)
      }
      const bump = `UPDATE sync_state SET v = CAST(v AS INTEGER) + 1 WHERE k = 'chg';
        UPDATE ${t} SET chg = (SELECT CAST(v AS INTEGER) FROM sync_state WHERE k = 'chg') WHERE rowid = NEW.rowid;`
      for (const [name, sql] of [
        [`sync_${t}_ins`, `CREATE TRIGGER ${'sync_' + t}_ins AFTER INSERT ON ${t} BEGIN ${bump} END`],
        [`sync_${t}_upd`, `CREATE TRIGGER ${'sync_' + t}_upd AFTER UPDATE ON ${t} WHEN NEW.chg = OLD.chg BEGIN ${bump} END`],
      ]) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name)) continue
        db.exec(sql)
        added.push(`trigger ${name}`)
      }
    }
    db.exec('RELEASE sync_migrate')
  } catch (err) {
    db.exec('ROLLBACK TO sync_migrate')
    db.exec('RELEASE sync_migrate')
    throw err
  }
  return added
}

/** Rows of all three tables with chg > after, ascending, at most limit (1..2000). */
export function changesSince(db, after = 0, limit = 500) {
  const n = Math.floor(Number(limit))
  const lim = Math.min(2000, Math.max(1, Number.isFinite(n) ? n : 500))
  const from = Number(after) || 0
  const rows = []
  for (const [t] of SYNC_TABLES) {
    if (!columns(db, t).includes('chg')) continue
    for (const r of db.prepare(`SELECT * FROM ${t} WHERE chg > ? ORDER BY chg LIMIT ?`).all(from, lim)) {
      const { chg, ...row } = r
      rows.push({ t, chg, row: { ...row } })
    }
  }
  rows.sort((a, b) => a.chg - b.chg)
  return { chg: syncCounter(db), rows: rows.slice(0, lim) }
}

// "X" and "X (peer)" are the same project name: the suffix is a rename made on clash.
const SUFFIX = / \([^()]*\)$/
function sameName(a, b) {
  if (a === b) return true
  if (typeof a !== 'string' || typeof b !== 'string') return false
  return (SUFFIX.test(a) && a.replace(SUFFIX, '') === b) || (SUFFIX.test(b) && b.replace(SUFFIX, '') === a)
}

function sameValue(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  return String(a) === String(b)
}

function bind(v) {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return v
}

/** Apply peer rows in one transaction. Local wins ties and newer local rows. */
export function applyChanges(db, rows, peer) {
  const out = { inserted: 0, updated: 0, unchanged: 0, kept_local: 0, renamed: [], errors: [] }
  const list = (Array.isArray(rows) ? rows : [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (ORDER[a.r?.t] ?? 9) - (ORDER[b.r?.t] ?? 9) || a.i - b.i)
    .map((x) => x.r)
  const cols = {}
  for (const [t] of SYNC_TABLES) cols[t] = columns(db, t).filter((c) => c !== 'chg')

  const fk = db.prepare('PRAGMA foreign_keys').get()?.foreign_keys ?? 1
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN IMMEDIATE')
  try {
    let n = 0
    for (const item of list) {
      const t = item?.t
      const pk = PK[t]
      const remote = item?.row
      const key = remote?.[pk]
      if (!pk || !cols[t].length || !remote || key === undefined || key === null) {
        out.errors.push({ t, pk: key ?? null, error: 'unknown table or missing primary key' })
        continue
      }
      const sp = `sync_row_${n++}`
      db.exec(`SAVEPOINT ${sp}`)
      try {
        applyRow(db, t, pk, cols[t].filter((c) => c in remote), remote, peer, out)
        db.exec(`RELEASE ${sp}`)
      } catch (err) {
        db.exec(`ROLLBACK TO ${sp}`)
        db.exec(`RELEASE ${sp}`)
        out.errors.push({ t, pk: key, error: err.message })
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

function applyRow(db, t, pk, shared, remote, peer, out) {
  const local = db.prepare(`SELECT * FROM ${t} WHERE ${pk} = ?`).get(remote[pk])
  const vals = Object.fromEntries(shared.map((c) => [c, bind(remote[c])]))

  if (!local) {
    if (t === 'projects' && 'name' in vals) {
      const clash = db.prepare('SELECT id FROM projects WHERE name = ? AND id != ?').get(vals.name, vals.id)
      if (clash) {
        const to = `${vals.name} (${peer})`
        out.renamed.push({ id: vals.id, from: vals.name, to })
        vals.name = to
      }
    }
    db.prepare(`INSERT INTO ${t} (${shared.join(', ')}) VALUES (${shared.map(() => '?').join(', ')})`)
      .run(...shared.map((c) => vals[c]))
    out.inserted++
    return
  }

  const same = shared.every((c) => (t === 'projects' && c === 'name' ? sameName(local[c], vals[c]) : sameValue(local[c], vals[c])))
  const ru = String(remote.updated_at ?? '')
  const lu = String(local.updated_at ?? '')
  if (ru > lu) {
    if (same) { out.unchanged++; return }
    const sets = shared.filter((c) => c !== pk)
    if (t === 'projects' && 'name' in vals) {
      if (sameName(local.name, vals.name)) vals.name = local.name // keep any local rename suffix
      else if (db.prepare('SELECT 1 FROM projects WHERE name = ? AND id != ?').get(vals.name, vals.id)) {
        const to = `${vals.name} (${peer})`
        out.renamed.push({ id: vals.id, from: vals.name, to })
        vals.name = to
      }
    }
    if (sets.length) {
      db.prepare(`UPDATE ${t} SET ${sets.map((c) => `${c} = ?`).join(', ')} WHERE ${pk} = ?`)
        .run(...sets.map((c) => vals[c]), remote[pk])
    }
    out.updated++
    return
  }
  if (ru === lu && same) out.unchanged++
  else out.kept_local++
}
