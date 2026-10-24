// Integration of the Step 2 permission modules (CONTRACTS.md C1-C5) into the bridge.
// Each workstream module owns its own tables; this file only calls their migrate()
// functions on the bridge database and hands the workers their approval and
// notification hooks, so nothing in 2a/2b/2c needs to know about the others.
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as grants from './grants.mjs'
import * as approvals from './approvals.mjs'
import * as roles from './roles.mjs'
import * as notify from './notify.mjs'
import { setApprovalResolver } from './brain-write.mjs'
import { defaultBridgeDb } from './bridge/queue.mjs'

/** A permission pause outside any project is filed under this project, never '*'. */
export const UNSCOPED_PROJECT = 'bridge'

/** Create every permission table on `db` (idempotent: each migrate is CREATE ... IF NOT EXISTS). */
export function migrateAll(db) {
  grants.migrate(db)
  approvals.migrate(db)
  roles.migrate(db)
  notify.migrate(db)
}

/**
 * Worker options for createWorkers: a requestApproval that records a C2 approval in
 * the bridge database, and lifecycle hooks that emit C5 notify events there.
 * `toast` and `bridgeInbox` are optional fanout targets passed through to notify.
 */
export function workerPermissions(db, { toast = null, bridgeInbox = null } = {}) {
  migrateAll(db)
  if (toast || bridgeInbox) notify.setFanout({ toast, bridgeInbox })
  return {
    requestApproval: (req) => approvals.requestApproval(db, {
      ...req, scope: { ...req.scope, project: req.scope?.project || UNSCOPED_PROJECT },
    }),
    // Resume only on an approved, unexpired permission_resume approval for this very run.
    approvalValid: (id, runId) => {
      const a = approvals.getApproval(db, id)
      return !!a && a.kind === 'permission_resume' && a.run_id === runId && approvals.isApprovalValid(db, id)
    },
    hooks: { emit: (hookDb, ev) => notify.emit(hookDb ?? db, ev) },
    // C1 grant for a headless worker run: claude-code first, then the generic 'remote' agent.
    resolveGrant: ({ project, host }) => {
      const key = { project: project || UNSCOPED_PROJECT, role: 'worker', host }
      return grants.resolveGrant(db, { ...key, agent: 'claude-code' }) ?? grants.resolveGrant(db, { ...key, agent: 'remote' })
    },
  }
}

// Mailboxes that execute work: a notice is never queued to them (dispatch could act on it).
const EXECUTOR_AGENTS = new Set(['claude-code', 'node'])

/** Native Windows toast through PowerShell; only called when PM_TOAST=1. */
function nativeToast(ev) {
  const text = `${ev.summary}`.replace(/[^\w .:>/@-]/g, ' ').slice(0, 200)
  const ps = `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]>$null;` +
    `$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(1);` +
    `$x.GetElementsByTagName('text')[0].AppendChild($x.CreateTextNode('pm ${ev.type}: ${text}'))>$null;` +
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('pm').Show([Windows.UI.Notifications.ToastNotification]::new($x))`
  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

/**
 * Default C5 fanout for a bridge queue: bridgeInbox queues a status notice to the run owner's
 * mailbox; toast appends to notify-toast.jsonl beside the bridge db and shows a native toast
 * only when PM_TOAST=1 (vmixer is a production vMix box, so the default is off).
 * `override` (tests) replaces both.
 */
export function notifyFanout(queue, override) {
  if (override) return override
  const toastLog = queue.path && queue.path !== ':memory:' ? join(dirname(queue.path), 'notify-toast.jsonl') : null
  return {
    bridgeInbox: (ev) => {
      if (!ev.owner || EXECUTOR_AGENTS.has(ev.owner)) return
      queue.enqueue({ v: 1, type: 'status', dedupe_key: `notify-${ev.dedupe_key}`.slice(0, 200), project: ev.project ?? undefined,
        from: { machine: queue.machine, agent: 'pm' }, to: { machine: queue.machine, agent: ev.owner },
        body: { notice: ev.type, run_id: ev.run_id, severity: ev.severity, summary: ev.summary, at: ev.at } }, { principal: `pm@${queue.machine}` })
    },
    toast: (ev) => {
      if (toastLog) appendFileSync(toastLog, JSON.stringify({ at: ev.at, type: ev.type, severity: ev.severity, run_id: ev.run_id, summary: ev.summary }) + '\n')
      if (process.env.PM_TOAST === '1') nativeToast(ev)
    },
  }
}

/**
 * Point brain-write's handoff approval check at the bridge database. The CLI/MCP
 * process runs brainWrite locally, so it opens its own read-only handle; a missing
 * database (pm never started here) resolves nothing, which refuses handoffs.
 * Returns a function that closes the handle.
 */
export function wireBrainWriteApprovals(path = defaultBridgeDb()) {
  let db = null
  setApprovalResolver((id) => {
    try {
      db ??= new DatabaseSync(path, { readOnly: true })
      return approvals.getApproval(db, id)
    } catch {
      return null
    }
  })
  return () => { db?.close(); db = null }
}
