// Roles and browser-control guard (CONTRACTS.md C3).
// Roles come only from recorded assignments; nothing is invented. Unknown -> null.
// Approval power (E7): Admin any scope; Manager only inside a project it was itself
// assigned; Worker/Client never. OpenClaw is a browser-control client acting for a
// human (seq 494): never a principal, role or grant subject.
// Self-contained: does not import grants.mjs / approvals.mjs.

export const ROLES = ['admin', 'manager', 'worker', 'client']

// Server-side action table. Anything not listed is denied (fail closed).
const ACTIONS = {
  approve: ['admin', 'manager'],
  browser_control: ['admin', 'manager'],
  bridge_settings: ['admin'],
  view: ['admin', 'manager', 'worker', 'client'],
  run: ['admin', 'manager', 'worker'],
  reorder: ['admin', 'manager', 'worker'],
}
// Actions where a manager is limited to its own assigned projects.
const MANAGER_SCOPED = new Set(['approve', 'browser_control', 'run', 'reorder'])

const METHODS = {
  admin: ['otp', 'pm_ui', 'interactive', 'link'],
  manager: ['otp', 'pm_ui', 'interactive'],
  worker: [],
  client: [],
}

const NON_PRINCIPALS = /^openclaw(\b|[:/@._-]|$)/i

export function forbidden(message) {
  const e = new Error(message)
  e.code = 'FORBIDDEN'
  return e
}

export function isNonPrincipal(identity) {
  return typeof identity !== 'string' || !identity.trim() || NON_PRINCIPALS.test(identity.trim())
}

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS role_assignments (
    identity TEXT NOT NULL,
    role TEXT NOT NULL,
    project TEXT NOT NULL DEFAULT '',
    assigned_by TEXT NOT NULL,
    assigned_at TEXT NOT NULL,
    revoked_at TEXT,
    PRIMARY KEY (identity, project)
  )`)
}

/** Records a role assignment. project '' = global (admin only); managers need an exact project. */
export function assignRole(db, { identity, role, project = '', by, now = new Date().toISOString() }) {
  if (isNonPrincipal(identity)) throw forbidden(`${identity} cannot hold a role`)
  if (!ROLES.includes(role)) throw new Error(`unknown role ${role}`)
  if (!by) throw new Error('assigned_by required')
  if (project === '*') throw new Error("project '*' is not allowed")
  if (role === 'manager' && !project) throw new Error('manager assignment needs a project')
  db.prepare(`INSERT INTO role_assignments (identity, role, project, assigned_by, assigned_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(identity, project) DO UPDATE SET role = excluded.role, assigned_by = excluded.assigned_by,
      assigned_at = excluded.assigned_at, revoked_at = NULL`).run(identity, role, project, by, now)
}

export function revokeRole(db, { identity, project = '', now = new Date().toISOString() }) {
  db.prepare('UPDATE role_assignments SET revoked_at = ? WHERE identity = ? AND project = ? AND revoked_at IS NULL')
    .run(now, identity, project)
}

function activeRows(db, identity) {
  if (isNonPrincipal(identity)) return []
  return db.prepare('SELECT role, project FROM role_assignments WHERE identity = ? AND revoked_at IS NULL')
    .all(identity).map((r) => ({ role: r.role, project: r.project }))
}

const RANK = { admin: 4, manager: 3, worker: 2, client: 1 }

/** Role of an identity from recorded assignments; never invented. Unknown -> null.
 *  With a project, returns the role effective for that project. */
export function roleOf(db, identity, project) {
  let best = null
  for (const r of activeRows(db, identity)) {
    if (!ROLES.includes(r.role)) continue
    if (project !== undefined && r.project && r.project !== project) continue
    if (!best || RANK[r.role] > RANK[best]) best = r.role
  }
  return best
}

/** Throws {code:'FORBIDDEN'} unless identity's role may do action. */
export function assertAllowed(db, identity, action, scope = {}) {
  if (isNonPrincipal(identity)) throw forbidden(`${identity || 'anonymous'} is not a principal`)
  const allowed = ACTIONS[action]
  if (!allowed) throw forbidden(`unknown action ${action}`)
  const rows = activeRows(db, identity)
  if (rows.some((r) => r.role === 'admin')) return 'admin'
  const project = scope?.project
  if (project === '*') throw forbidden("scope project '*' is not allowed")
  // the top (cross-project) order list: admin, any manager, unscoped worker (user decision 2026-10-18)
  if (scope?.top) {
    for (const r of rows) {
      if (!allowed.includes(r.role)) continue
      if (r.role === 'manager' || (r.role === 'worker' && !r.project)) return r.role
    }
    throw forbidden(`${identity} may not ${action} the top list`)
  }
  for (const r of rows) {
    if (!allowed.includes(r.role)) continue
    if (r.role === 'manager' && MANAGER_SCOPED.has(action)) {
      if (project && r.project === project) return 'manager'
      continue
    }
    if (!r.project || !project || r.project === project) return r.role
  }
  throw forbidden(`${identity} may not ${action}${project ? ` in ${project}` : ''}`)
}

/** Active assignments, optionally for one identity. */
export function listRoles(db, { identity } = {}) {
  const sql = 'SELECT identity, role, project, assigned_by, assigned_at FROM role_assignments WHERE revoked_at IS NULL'
  const rows = identity ? db.prepare(sql + ' AND identity = ? ORDER BY project').all(identity) : db.prepare(sql + ' ORDER BY identity, project').all()
  return rows.map((r) => ({ ...r }))
}

export function allowedApprovalMethods(role) {
  return [...(METHODS[role] || [])]
}

/** Advisory: may this role do action at all (UI greys controls; server still enforces). */
export function roleCan(role, action) {
  return Boolean(ACTIONS[action]?.includes(role))
}
