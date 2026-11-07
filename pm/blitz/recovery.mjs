// BLITZ-06 recovery and human escalation for the blitz run controller (Claude Opus 5.5).
// Contract: CONTROLLER.md (BLITZ-05). Plugs into createController as deps:
//   escalate  - classifies each problem and decides: bounded retry with backoff, reassignment to
//               another roster agent of the same role, a quota park, or a human escalation.
//   registry  - the BLITZ-04 registry with held agents/providers filtered out of selectRoster, so a
//               rate-limited provider gets no new work until its reset or a human answer.
//   dispatch  - the real dispatch wrapped: an attempt marker on every error (the controller raises
//               each (task, reason) once, so a repeat error text would otherwise never be seen), a
//               quota error reported as success is turned back into a failure, and the last real
//               checkpoint is handed back as resumeFrom (session restoration).
//   maxAttempts: 1 - the controller never retries on its own; every retry goes through pump().
//
// Reassignment is per task: the requeue carries avoidAgents=[failing agent], so the controller's tick
// prefers another same-role agent for THAT task only; the failing agent keeps its other work.
// TEST_FAILURE (verification_failed) is requeued here and only here: verify.mjs never requeues, the
// controller's own retry is off (maxAttempts: 1), so a rework attempt happens exactly once per decision.
// Retries never happen inside escalate(): the task is parked (escalated) and pump() requeues it
// through controller.requeue once its backoff has passed or its hold is released. RATE_LIMIT is
// never retried immediately (on 10-23 a retry loop drained Claude and Codex quota in minutes).
//
// Human escalations are durable rows in blitz_escalations (idempotent on dedupe_key, rev'd) with
// options A-D, the recommended one first. They go to the task as a pm comment and to the
// companion agent over the bridge (correlation_id = escalation id). A bridge outage falls back to
// the comment (undelivered_bridge) and delivery is retried; an agent that never acks by the
// deadline is treated as absent even when it looks present. Relayed answers stay pending_confirm
// until a direct caller confirms. Silence never approves: expiry sends reminders, then the task
// stays parked with the escalation open.
import { randomBytes } from 'node:crypto'
import { PmError } from '../store.mjs'
import { createAgentRegistry } from './agents.mjs'
import { createController, defaultDeps } from './controller.mjs'
import { requireActor, TERMINAL_CAMPAIGN } from './campaigns.mjs'

export const ESCALATION_AGENT = process.env.BLITZ_ESCALATION_AGENT || process.env.BLITZ_QA_AGENT || 'chatgpt'
export const FROM_AGENT = 'pm-blitz'
export const CLASSES = ['RATE_LIMIT', 'TRANSPORT', 'TIMEOUT', 'TEST_FAILURE', 'APPROVAL', 'CONFLICT', 'DEPENDENCY', 'VERIFIER', 'UNKNOWN']

export const DEFAULT_POLICY = Object.freeze({
  maxAttempts: 3,              // dispatch attempts per task before a human decides (an answer grants one more)
  backoffBaseSeconds: 30,      // TRANSPORT/TIMEOUT/TEST_FAILURE retry delay: base * 2^(attempt-1)
  backoffCapSeconds: 900,
  cooldownSeconds: 600,        // unused since reassignment became per-task (avoidAgents); agent:<name> holds are still honoured if set
  maxResetWaitSeconds: 7 * 86400, // a parsed quota reset further out than this needs a human
  ackSeconds: 600,             // bridge recipient must ack within this, or it is treated as absent
  presenceSeconds: 300,        // "looks present" = seen within this window
  sendRetrySeconds: [60, 300, 900], // bridge re-send delays after an outage
  ttlSeconds: 86400,           // an unanswered escalation gets a reminder after this
  maxReminders: 3,             // then it stays open and parked; it never resolves itself
})

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blitz_recovery (
  campaign_id TEXT NOT NULL, task_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('retry_wait', 'parked', 'human', 'requeued', 'released')),
  class TEXT, action TEXT, last_kind TEXT, reason TEXT, agent TEXT, attempt INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0, rate_hits INTEGER NOT NULL DEFAULT 0, extra_attempts INTEGER NOT NULL DEFAULT 0,
  not_before TEXT, hold_key TEXT, escalation_id TEXT, resume TEXT, history TEXT NOT NULL DEFAULT '[]',
  rev INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY (campaign_id, task_id));
CREATE TABLE IF NOT EXISTS blitz_recovery_holds (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, until TEXT, reason TEXT, campaign_id TEXT, task_id TEXT, escalation_id TEXT,
  released_at TEXT, rev INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blitz_recovery_cursor (campaign_id TEXT PRIMARY KEY, event_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blitz_escalations (
  id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, campaign_id TEXT NOT NULL, task_id TEXT,
  kind TEXT NOT NULL, problem TEXT NOT NULL, options TEXT NOT NULL, recommended TEXT NOT NULL, recommendation TEXT NOT NULL,
  correlation_id TEXT NOT NULL, hold_key TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'superseded')),
  answer TEXT, answer_note TEXT, answer_until TEXT, answer_state TEXT CHECK (answer_state IN ('pending_confirm', 'confirmed')),
  answered_by TEXT, answered_at TEXT, confirmed_by TEXT, applied TEXT,
  comment_id INTEGER, comment_at TEXT,
  bridge_agents TEXT NOT NULL DEFAULT '[]', bridge_index INTEGER NOT NULL DEFAULT 0, bridge_agent TEXT,
  bridge_state TEXT NOT NULL DEFAULT 'pending' CHECK (bridge_state IN ('pending', 'sent', 'delivered', 'acked', 'undelivered_bridge', 'absent', 'none')),
  bridge_message_id TEXT, sent_ids TEXT NOT NULL DEFAULT '[]', bridge_sent_at TEXT, delivered_at TEXT, acked_at TEXT, ack_due_at TEXT,
  send_attempts INTEGER NOT NULL DEFAULT 0, next_send_at TEXT, last_error TEXT,
  expires_at TEXT NOT NULL, reminders INTEGER NOT NULL DEFAULT 0, unanswered_at TEXT,
  rev INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS blitz_escalations_campaign ON blitz_escalations(campaign_id, status);
CREATE TABLE IF NOT EXISTS blitz_escalation_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, escalation_id TEXT NOT NULL REFERENCES blitz_escalations(id),
  choice TEXT, note TEXT, until TEXT, state TEXT NOT NULL, source TEXT NOT NULL,
  actor TEXT NOT NULL, model TEXT, via TEXT, message_id TEXT, at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS blitz_escalation_answers_message ON blitz_escalation_answers(message_id) WHERE message_id IS NOT NULL;
`

export function migrate(db) { db.exec(SCHEMA) }

const json = (s, d) => { if (s == null) return d; try { return JSON.parse(s) } catch { return d } }
const enc = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)

// ---------- classification ----------
const RATE = /rate[ _-]?limit|too many requests|\b429\b|quota|usage limit|limit reached|hit your (?:usage |weekly |session )?limit|insufficient_quota|resource[ _]exhausted|credit balance is too low|out of credits|weekly limit|session limit/i
const TIMEOUT = /timed? ?out|\btimeout\b|ETIMEDOUT|deadline exceeded|lease expired|SIGTERM|SIGKILL/i
const APPROVAL = /not approved|needs? approval|approval required|permission_required|permission denied|task_scope/i
const CONFLICT = /merge conflict|\bconflicts?\b|\b409\b|stale rev|changed concurrently|non-fast-forward|cannot rebase|needs merge/i
const TRANSPORT = /ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network|\b50[234]\b|\b529\b|bad gateway|service unavailable|overloaded|transport|bridge (?:is )?(?:down|off|unreachable)|connection (?:closed|reset|refused)|spawn \S+ ENOENT/i
const TESTS = /tests? fail|failing tests?|AssertionError|verification failed|npm ERR! test|\b\d+ failed\b|# fail [1-9]/i

const textOf = (v) => {
  if (typeof v === 'string') return v
  if (!v || typeof v !== 'object') return ''
  return [v.result, v.text, v.message, v.error, v.summary, v.stderr].filter((s) => typeof s === 'string').join('\n')
}

/** Problem -> one of CLASSES. RATE_LIMIT is checked first: the DSH CLI reports quota errors as transport or success. */
export function classify(problem = {}) {
  if (problem.kind === 'approval') return 'APPROVAL'
  if (problem.kind === 'cycle' || problem.kind === 'dependency_failed') return 'DEPENDENCY'
  const text = [problem.reason, problem.error, problem.stderr, textOf(problem.result)].filter((s) => typeof s === 'string').join('\n')
  const exit = problem.exit ?? {}
  if (RATE.test(text)) return 'RATE_LIMIT'
  if (problem.kind === 'lease_expired' || exit.timedOut || exit.code === 124 || ['SIGTERM', 'SIGKILL'].includes(exit.signal) || TIMEOUT.test(text)) return 'TIMEOUT'
  if (APPROVAL.test(text)) return 'APPROVAL'
  if (CONFLICT.test(text)) return 'CONFLICT'
  if (TRANSPORT.test(text)) return 'TRANSPORT'
  if (problem.kind === 'verification_failed' || TESTS.test(text)) return 'TEST_FAILURE'
  return 'UNKNOWN'
}

// Pointer artifacts the BLITZ-08 poller adds to every result (dispatch.mjs resultOf): not evidence of work.
const POINTER_KINDS = new Set(['branch', 'worktree', 'log', 'errLog', 'lastMessage', 'exitFile', 'brief'])

/** A runner "success" that is really a quota error (short, no work artifacts, or flagged is_error). */
export function looksRateLimited(result) {
  const text = textOf(result)
  if (!text || !RATE.test(text)) return false
  if (result?.is_error === true) return true
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts.filter((a) => !POINTER_KINDS.has(a?.kind)).length : 0
  return artifacts === 0 && text.length < 2000
}

const unitSeconds = (u = 's') => {
  u = u.toLowerCase()
  if (u === 'ms') return 0.001
  if (u.startsWith('h')) return 3600
  if (u.startsWith('m')) return 60
  return 1
}

/** Quota reset time from error text, or null when none is stated (then a human decides). */
export function parseReset(text, now = new Date()) {
  const s = String(text ?? '')
  let m = s.match(/reset[s_]*(?:_?at| at| on)?"?\s*[:=]?\s*"?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/i)
  if (m) { const d = new Date(m[1].replace(' ', 'T')); if (!Number.isNaN(d.getTime())) return d }
  m = s.match(/reset[s_]*_?at"?\s*[:=]\s*(\d{10})\b/i)
  if (m) return new Date(Number(m[1]) * 1000)
  m = s.match(/retry[- ]after"?\s*[:=]?\s*(\d+)\s*(ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)?\b/i)
  if (m) return new Date(now.getTime() + Number(m[1]) * unitSeconds(m[2]) * 1000)
  m = s.match(/(?:try again|resets?) in\s*(\d+)\s*(ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b/i)
  if (m) return new Date(now.getTime() + Number(m[1]) * unitSeconds(m[2]) * 1000)
  return null
}

/** Quota is per provider account. Override with createRecovery({providerOf}). */
export function defaultProviderOf(agent) {
  const pin = String(agent?.model_policy?.pin ?? '').toLowerCase()
  if (/claude|opus|sonnet|haiku|fable/.test(pin)) return 'anthropic'
  if (/gpt|codex|\bo\d/.test(pin)) return 'openai'
  if (/deepseek/.test(pin)) return 'deepseek'
  if (pin) return pin.split(/[-/:]/)[0]
  if (agent?.transport === 'bridge-claude') return 'anthropic'
  if (agent?.transport === 'codex') return 'openai'
  return `agent:${agent?.name ?? 'unknown'}`
}

// ---------- options ----------
const OPTION = {
  retry: (p) => ({ action: 'retry', label: 'Retry now', detail: p.exhausted ? `grant one more attempt (${p.attempt}/${p.budget} used) and requeue now` : 'requeue the task now' }),
  reassign: () => ({ action: 'reassign', label: 'Reassign', detail: 'cool down the failing agent and requeue, so another roster agent of the same role takes it' }),
  hold: (p) => ({ action: 'hold', label: p.holdLabel ?? 'Hold', detail: p.holdDetail ?? 'keep the task parked; answer with until=<ISO time> to resume it then' }),
  abandon: () => ({ action: 'abandon', label: 'Leave parked', detail: 'stop here; the task stays escalated for manual work and its dependents keep waiting' }),
}
const PLAN = {
  RATE_LIMIT: { order: ['hold', 'reassign', 'retry', 'abandon'], hold: ['Wait for quota reset', 'keep the task and its provider parked; answer with until=<reset time> to resume then'],
    rec: 'Wait for the quota reset (answer A with until=<reset time>). Retrying now would spend quota on a failing call again.' },
  TRANSPORT: { order: ['retry', 'reassign', 'hold', 'abandon'], rec: 'Retry once more; the failures look transient (network or transport).' },
  TIMEOUT: { order: ['retry', 'reassign', 'hold', 'abandon'], rec: 'Retry from the last checkpoint; the attempt timed out or its lease expired.' },
  TEST_FAILURE: { order: ['retry', 'reassign', 'hold', 'abandon'], rec: 'Grant one more rework attempt; it resumes from the last checkpoint with the failing evidence.' },
  CONFLICT: { order: ['hold', 'retry', 'reassign', 'abandon'], hold: ['Resolve by hand first', 'keep the task parked while the conflict is resolved or rebased; then answer again with retry'],
    rec: 'Resolve or rebase the conflict by hand, then retry. An automatic retry would hit the same conflict.' },
  APPROVAL: { order: ['hold', 'retry', 'abandon'], hold: ['Approve in pm', 'approve the task_scope in the pm approval ledger; the task resumes by itself. An answer here never approves.'],
    rec: 'Review and approve the task_scope in pm. Nothing runs until the ledger approves it.' },
  VERIFIER: { order: ['hold', 'abandon'], hold: ['Add a verifier', 'add an enabled verifier-role agent (not the builder) to the roster, then POST /api/blitz/campaigns/:id/tasks/:task/verify; the built work is kept'],
    rec: 'Add an independent verifier and re-verify. The task stays awaiting_verification; nothing is rebuilt.' },
  DEPENDENCY: { order: ['hold', 'abandon'], hold: ['Fix dependencies', 'fix depends_on (break the cycle) and preflight again'], rec: 'Break the dependency cycle in depends_on, then preflight again.' },
  UNKNOWN: { order: ['hold', 'retry', 'reassign', 'abandon'], rec: 'Diagnose first: the failure is unclassified, so an automatic retry could repeat it.' },
}

export function optionsFor(cls, p = {}) {
  const plan = PLAN[cls] ?? PLAN.UNKNOWN
  const ctx = { ...p, holdLabel: plan.hold?.[0], holdDetail: plan.hold?.[1] }
  const options = plan.order.map((k, i) => ({ letter: 'ABCD'[i], ...OPTION[k](ctx), recommended: i === 0 }))
  return { options, recommended: 'A', recommendation: plan.rec }
}

/**
 * @param o.store          pm store (comments go through store.addComment)
 * @param o.db             db holding the blitz tables; default store.db
 * @param o.bridge         {available?(), send(envelope) -> {id}, message?(id), replies?(correlationId), presence?(agent)}
 *                         or null (bridge off). bridgeAdapter(() => bridge) wraps pm's createBridge() object.
 * @param o.registry       the BLITZ-04 registry to wrap; default createAgentRegistry(db, {store, clock, machines})
 * @param o.agent          default bridge recipient (env BLITZ_ESCALATION_AGENT, then BLITZ_QA_AGENT, then chatgpt)
 * @param o.fallbackAgents bridge recipients tried in turn when one is absent
 * @param o.specialists    {CLASS: agent} specialist recipient per failure class
 */
export function createRecovery({
  store, db = store?.db, bridge = null, registry = null, machines, clock = () => new Date(), policy = {},
  agent = ESCALATION_AGENT, fallbackAgents = [], specialists = {}, providerOf = defaultProviderOf,
} = {}) {
  if (!db) throw new Error('createRecovery needs a pm store with a db handle')
  migrate(db)
  const P = { ...DEFAULT_POLICY, ...policy }
  const inner = registry ?? createAgentRegistry(db, { store, clock, machines })
  let ctl = null
  const cs = () => { if (!ctl) throw new Error('recovery is not attached to a controller: call attach(controller)'); return ctl.store }
  const tx = (fn) => cs().tx(fn)
  const nowIso = () => clock().toISOString()
  const plus = (s) => new Date(clock().getTime() + s * 1000).toISOString()
  const ev = (cid, kind, data, taskId = null, actor = FROM_AGENT) => cs().event(cid, kind, data, { taskId, actor })
  const who = (w) => {
    const actor = typeof w?.actor === 'string' ? w.actor.trim() : ''
    if (!actor) throw new PmError(400, 'actor is required: name who is answering (for an agent, its model name)')
    return { actor, model: typeof w.model === 'string' && w.model.trim() ? w.model.trim() : null, via: w.via || null }
  }
  const budgetOf = (r) => P.maxAttempts + (r?.extra_attempts ?? 0)
  const backoff = (attempt) => Math.min(P.backoffBaseSeconds * 2 ** Math.max(0, attempt - 1), P.backoffCapSeconds)

  // ---------- holds (provider quota parks, agent cooldowns) ----------
  const holdRow = (key) => { const r = db.prepare('SELECT * FROM blitz_recovery_holds WHERE key = ?').get(key); return r ? { ...r } : null }
  const holdActive = (key, at = nowIso()) => {
    if (!key) return false
    const h = holdRow(key)
    return Boolean(h) && !h.released_at && (!h.until || h.until > at)
  }
  /** Create or extend a hold. An active indefinite hold stays indefinite (only a human answer ends it). */
  function putHold(key, { kind, until = null, reason = '', campaign_id = null, task_id = null }) {
    const t = nowIso()
    const cur = holdRow(key)
    if (cur && !cur.released_at && (!cur.until || cur.until > t)) {
      const next = cur.until === null || until === null ? null : (until > cur.until ? until : cur.until)
      db.prepare('UPDATE blitz_recovery_holds SET until = ?, reason = ?, rev = rev + 1, updated_at = ? WHERE key = ?').run(next, reason, t, key)
    } else if (cur) {
      db.prepare(`UPDATE blitz_recovery_holds SET kind = ?, until = ?, reason = ?, campaign_id = ?, task_id = ?, escalation_id = NULL, released_at = NULL,
        created_at = ?, rev = rev + 1, updated_at = ? WHERE key = ?`).run(kind, until, reason, campaign_id, task_id, t, t, key)
    } else {
      db.prepare('INSERT INTO blitz_recovery_holds (key, kind, until, reason, campaign_id, task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(key, kind, until, reason, campaign_id, task_id, t, t)
    }
    return holdRow(key)
  }
  const setHold = (key, fields) => {
    const cols = Object.keys(fields)
    db.prepare(`UPDATE blitz_recovery_holds SET ${cols.map((c) => `${c} = ?`).join(', ')}, rev = rev + 1, updated_at = ? WHERE key = ?`).run(...cols.map((c) => fields[c]), nowIso(), key)
  }
  const releaseHold = (key) => db.prepare('UPDATE blitz_recovery_holds SET released_at = ?, rev = rev + 1, updated_at = ? WHERE key = ? AND released_at IS NULL').run(nowIso(), nowIso(), key)

  const agentFree = (a, at) => !holdActive(`provider:${providerOf(a)}`, at) && !holdActive(`agent:${a.name}`, at)
  /** Held providers drop out; a cooling agent drops out only while a same-role agent is free. */
  function filterRoster(list) {
    const at = nowIso()
    const out = list.filter((a) => !holdActive(`provider:${providerOf(a)}`, at))
    return out.filter((a) => !holdActive(`agent:${a.name}`, at) || !out.some((b) => b !== a && b.role === a.role && !holdActive(`agent:${b.name}`, at)))
  }
  const wrappedRegistry = new Proxy(inner, {
    get(t, k) {
      if (k === 'selectRoster') return (names, ...rest) => filterRoster(t.selectRoster(names, ...rest))
      const v = Reflect.get(t, k)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
  const rosterOf = (c) => {
    try { return inner.selectRoster((c.roster ?? []).map((e) => (typeof e === 'string' ? e : e?.agent))) } catch { return [] }
  }

  // ---------- recovery rows ----------
  const recRow = (cid, tid) => {
    const r = db.prepare('SELECT * FROM blitz_recovery WHERE campaign_id = ? AND task_id = ?').get(cid, tid)
    return r ? { ...r, resume: json(r.resume, null), history: json(r.history, []) } : null
  }
  function setRec(cid, tid, fields, historyEntry = null) {
    const t = nowIso()
    let cur = recRow(cid, tid)
    if (!cur) {
      db.prepare("INSERT INTO blitz_recovery (campaign_id, task_id, state, updated_at) VALUES (?, ?, 'released', ?)").run(cid, tid, t)
      cur = recRow(cid, tid)
    }
    const f = { ...fields }
    if (historyEntry) f.history = [...cur.history, { at: t, ...historyEntry }].slice(-50)
    const cols = Object.keys(f)
    const r = db.prepare(`UPDATE blitz_recovery SET ${cols.map((c) => `${c} = ?`).join(', ')}${cols.length ? ',' : ''} rev = rev + 1, updated_at = ?
      WHERE campaign_id = ? AND task_id = ? AND rev = ?`).run(...cols.map((c) => enc(f[c]) ?? null), t, cid, tid, cur.rev)
    if (r.changes !== 1) throw new PmError(409, `recovery row ${cid}/${tid} changed concurrently`)
    return recRow(cid, tid)
  }
  const bestCheckpoint = (cp, prev) => (cp && cp.stage && cp.stage !== 'leased' ? cp : prev ?? null)

  /** Parks an idle task as escalated through the controller (lease expiry; raise() parks the rest). */
  function parkTask(w, cid, tid, reason) {
    return ctl.park(w, cid, { taskId: tid, reason, ref: 'recovery' })
  }

  /** Requeue through the controller; `avoid` names agents this task should not get again (per-task reassignment). */
  function requeueNow(w, cid, tid, reason, key, avoid = null) {
    try {
      const t = ctl.requeue(w, cid, { taskId: tid, reason, ...(key ? { idempotencyKey: key } : {}), ...(avoid?.length ? { avoidAgents: avoid } : {}) })
      if (recRow(cid, tid)) setRec(cid, tid, { state: 'requeued', not_before: null }, { action: 'requeued', reason })
      return { ok: true, state: t.state }
    } catch (err) {
      if (!(err instanceof PmError)) throw err
      return { ok: false, error: err.message }
    }
  }

  // ---------- escalations ----------
  const escRow = (r) => (r ? { ...r, problem: json(r.problem, {}), options: json(r.options, []), applied: json(r.applied, null), bridge_agents: json(r.bridge_agents, []), sent_ids: json(r.sent_ids, []) } : null)
  const must = (id) => {
    const e = escRow(db.prepare('SELECT * FROM blitz_escalations WHERE id = ?').get(id))
    if (!e) throw new PmError(404, `no escalation ${id}`)
    return e
  }
  function upd(id, fields) {
    const cur = must(id)
    const cols = Object.keys(fields)
    const r = db.prepare(`UPDATE blitz_escalations SET ${cols.map((c) => `${c} = ?`).join(', ')}, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ?`)
      .run(...cols.map((c) => enc(fields[c]) ?? null), nowIso(), id, cur.rev)
    if (r.changes !== 1) throw new PmError(409, `escalation ${id} changed concurrently`)
    return must(id)
  }

  async function note(w, e, text) {
    if (!e.task_id || !store?.addComment) return null
    try { return store.addComment({ actor: w.actor, model: w.model ?? null }, e.task_id, { body: `[blitz-escalation ${e.id}] ${text}` }) } catch (err) {
      upd(e.id, { last_error: `pm comment: ${String(err?.message ?? err)}` })
      return null
    }
  }

  function commentText(e) {
    const p = e.problem
    const lines = [
      `run ${e.campaign_id} task ${e.task_id ?? '-'} needs a decision (${e.kind}${p.attempt ? `, attempt ${p.attempt}/${p.budget ?? P.maxAttempts}` : ''}).`,
      `Problem: ${p.reason ?? p.kind}`,
      'Options:',
      ...e.options.map((o) => `  ${o.letter}${o.recommended ? ' (recommended)' : ''}: ${o.label} - ${o.detail}`),
      `Recommendation: ${e.recommendation}`,
      `Answer: POST /api/blitz/escalations/${e.id}/answer {"choice":"A"} (add "until" for a timed hold). Silence is never approval; a relayed answer needs direct confirmation.`,
    ]
    return lines.join('\n')
  }

  function envelope(e, to) {
    return {
      type: 'message', to: { agent: to }, from: { agent: FROM_AGENT }, correlation_id: e.id,
      dedupe_key: `blitz-esc-${e.id}-${e.bridge_index}-${e.reminders}`, project: e.task_id ? cs().task(e.campaign_id, e.task_id).project_id : undefined,
      task: e.task_id ?? undefined, priority: 'high', expects_response: true,
      body: {
        kind: 'blitz_escalation', escalation: e.id, run: e.campaign_id, task: e.task_id, problem: { class: e.kind, ...e.problem },
        options: e.options, recommended: e.recommended, recommendation: e.recommendation, reminder: e.reminders,
        answer_with: `POST /api/blitz/escalations/${e.id}/answer {choice}`, or_reply_on_thread: e.id,
        note: 'Silence is not approval. A relayed answer stays pending until a direct caller confirms it.',
      },
    }
  }

  async function trySend(w, e) {
    const to = e.bridge_agents[e.bridge_index]
    if (!to) { if (e.bridge_state !== 'none') upd(e.id, { bridge_state: 'none' }); return }
    if (e.next_send_at && e.next_send_at > nowIso()) return
    const off = !bridge || (typeof bridge.available === 'function' && !bridge.available())
    let msg = null
    let err = null
    if (off) err = 'bridge is off'
    else {
      try {
        msg = await bridge.send(envelope(e, to))
        if (!msg?.id) err = 'bridge send returned no message id'
      } catch (x) { err = String(x?.message ?? x) }
    }
    const n = e.send_attempts + 1
    if (err) {
      const delays = P.sendRetrySeconds
      const first = e.bridge_state !== 'undelivered_bridge'
      upd(e.id, { bridge_state: 'undelivered_bridge', bridge_agent: to, send_attempts: n, next_send_at: plus(delays[Math.min(n - 1, delays.length - 1)]), last_error: err })
      ev(e.campaign_id, 'escalation_bridge_undelivered', { escalation: e.id, agent: to, error: err, attempt: n }, e.task_id, w.actor)
      if (first) await note(w, e, `bridge to ${to} is unavailable (${err}); this pm comment is the channel until bridge delivery succeeds. Delivery is retried.`)
      return
    }
    upd(e.id, { bridge_state: 'sent', bridge_agent: to, bridge_message_id: msg.id, sent_ids: [...e.sent_ids, msg.id], bridge_sent_at: nowIso(),
      ack_due_at: plus(P.ackSeconds), send_attempts: n, next_send_at: null, last_error: null })
    ev(e.campaign_id, 'escalation_sent', { escalation: e.id, agent: to, message: msg.id, after_outage: e.bridge_state === 'undelivered_bridge' }, e.task_id, w.actor)
  }

  function replies(e) {
    if (!bridge?.replies || !e.sent_ids.length) return []
    let list
    try { list = bridge.replies(e.id) ?? [] } catch { return [] }
    return list.filter((m) => !e.sent_ids.includes(m.id) && m.from?.agent !== FROM_AGENT)
  }

  async function checkAck(w, e) {
    let m = null
    try { m = bridge?.message ? await bridge.message(e.bridge_message_id) : null } catch { m = null }
    const d = m?.delivery ?? m ?? {}
    const got = replies(e)
    if (d.acked_at || got.length) {
      e = upd(e.id, { bridge_state: 'acked', acked_at: d.acked_at ?? got[0]?.created_at ?? nowIso(), delivered_at: e.delivered_at ?? d.delivered_at ?? nowIso() })
      ev(e.campaign_id, 'escalation_acked', { escalation: e.id, agent: e.bridge_agent, message: e.bridge_message_id, by_reply: !d.acked_at }, e.task_id, w.actor)
      return e
    }
    if (d.delivered_at && e.bridge_state === 'sent') e = upd(e.id, { bridge_state: 'delivered', delivered_at: d.delivered_at })
    if (e.ack_due_at && e.ack_due_at <= nowIso()) {
      // False presence: whatever presence says, no ack by the deadline means absent.
      let seen = null
      try { seen = bridge?.presence ? await bridge.presence(e.bridge_agent) : null } catch { seen = null }
      seen = typeof seen === 'string' ? seen : seen?.last_seen_at ?? null
      const looked = Boolean(seen) && clock().getTime() - Date.parse(seen) <= P.presenceSeconds * 1000
      e = upd(e.id, { bridge_state: 'absent' })
      ev(e.campaign_id, looked ? 'escalation_false_presence' : 'escalation_unacked', { escalation: e.id, agent: e.bridge_agent, last_seen_at: seen, ack_due_at: e.ack_due_at, delivered_at: e.delivered_at }, e.task_id, w.actor)
      await note(w, e, `${e.bridge_agent} ${looked ? `looked present (last seen ${seen})` : 'is not present'} but did not acknowledge within ${P.ackSeconds}s; treated as absent. This pm comment is the channel; answer here or via the route.`)
      if (e.bridge_index + 1 < e.bridge_agents.length) {
        e = upd(e.id, { bridge_index: e.bridge_index + 1, bridge_state: 'pending', next_send_at: null, send_attempts: 0 })
        await trySend(w, e)
      }
    }
    return must(e.id)
  }

  async function pullAnswers(e) {
    const got = []
    for (const m of replies(e)) {
      if (db.prepare('SELECT 1 FROM blitz_escalation_answers WHERE message_id = ?').get(m.id)) continue
      const body = typeof m.body === 'string' ? (() => { try { return JSON.parse(m.body) } catch { return { text: m.body } } })() : (m.body ?? {})
      const raw = [body.choice, body.answer, body.text, body.message].find((v) => typeof v === 'string' && v.trim()) ?? ''
      const letter = raw.match(/^\s*(?:option\s*)?([A-D])\b/i)?.[1]?.toUpperCase()
      const from = `${m.from?.agent ?? 'unknown'}@${m.from?.machine ?? 'unknown'}`
      const cur = must(e.id)
      if (cur.status !== 'open' || !letter || !cur.options.some((o) => o.letter === letter)) {
        db.prepare('INSERT INTO blitz_escalation_answers (escalation_id, choice, note, state, source, actor, via, message_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(e.id, letter ?? null, raw.slice(0, 500), 'ignored', 'bridge', from, 'bridge', m.id, nowIso())
        ev(e.campaign_id, 'escalation_reply_ignored', { escalation: e.id, message: m.id, from, reason: cur.status !== 'open' ? `escalation is ${cur.status}` : 'no valid choice' }, e.task_id)
        continue
      }
      await api.answer({ actor: from, model: body.model ?? null, via: 'bridge' }, e.id, { choice: letter, until: body.until ?? null, note: body.note ?? null }, { source: 'bridge', messageId: m.id })
      got.push({ escalation: e.id, message: m.id, choice: letter })
    }
    return got
  }

  /** Durable human escalation, idempotent on dedupe; delivered as a pm comment and over the bridge. */
  async function openEscalation(w, { campaign_id, task_id = null, cls, problem, dedupe, holdKey = null }) {
    const { options, recommended, recommendation } = optionsFor(cls, { exhausted: problem.attempt >= (problem.budget ?? P.maxAttempts), attempt: problem.attempt, budget: problem.budget })
    const id = `E-${randomBytes(4).toString('hex')}`
    const t = nowIso()
    const agents = [...new Set([specialists[cls] ?? agent, ...fallbackAgents].filter(Boolean))]
    const r = db.prepare(`INSERT INTO blitz_escalations (id, dedupe_key, campaign_id, task_id, kind, problem, options, recommended, recommendation,
      correlation_id, hold_key, bridge_agents, expires_at, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING`).run(id, dedupe, campaign_id, task_id, cls, JSON.stringify(problem), JSON.stringify(options), recommended, recommendation,
      id, holdKey, JSON.stringify(agents), plus(P.ttlSeconds), t, w.actor, t)
    let e = escRow(db.prepare('SELECT * FROM blitz_escalations WHERE dedupe_key = ?').get(dedupe))
    if (r.changes === 1) {
      ev(campaign_id, 'escalation_created', { escalation: e.id, class: cls, recommended, agents, hold: holdKey }, task_id, w.actor)
      if (holdKey) setHold(holdKey, { escalation_id: e.id })
    }
    if (!e.comment_id && e.task_id) {
      const c = await note(w, e, commentText(e))
      if (c?.id) e = upd(e.id, { comment_id: c.id, comment_at: nowIso() })
    }
    if (['pending', 'undelivered_bridge'].includes(e.bridge_state)) await trySend(w, must(e.id))
    return must(e.id)
  }

  /** Decide what a failed attempt gets. The task is (or will be) parked; pump() acts on the decision. */
  async function handleFailure(w, cid, problem, { park = false } = {}) {
    const c = cs().get(cid)
    const task = cs().task(cid, problem.task_id)
    const attempt = Number(problem.attempt ?? task.attempt) || 0
    const prev = recRow(cid, task.task_id)
    if (prev && prev.attempt === attempt && prev.last_kind === problem.kind && ['retry_wait', 'parked', 'human'].includes(prev.state)) {
      return { escalated: true, ref: prev.escalation_id ?? `recovery:${cid}:${task.task_id}`, replayed: true }
    }
    const cls = classify(problem)
    const agentName = problem.agent ?? task.agent ?? task.lease_owner ?? null
    const roster = rosterOf(c)
    const me = roster.find((a) => a.name === agentName) ?? null
    const budget = budgetOf(prev)
    const left = attempt < budget
    const at = nowIso()
    const base = {
      class: cls, reason: problem.reason ?? null, agent: agentName, attempt, last_kind: problem.kind,
      failures: (prev?.failures ?? 0) + 1, resume: bestCheckpoint(problem.checkpoint ?? task.checkpoint, prev?.resume), hold_key: null, not_before: null, escalation_id: null,
    }
    let d
    if (cls === 'RATE_LIMIT') {
      const key = `provider:${me ? providerOf(me) : `agent:${agentName}`}`
      const rateHits = (prev?.rate_hits ?? 0) + 1
      const reset = parseReset(problem.reason, clock())
      const far = reset && reset.getTime() - clock().getTime() > P.maxResetWaitSeconds * 1000
      base.rate_hits = rateHits
      if (holdActive(key) && left) d = { state: 'parked', action: 'join_hold', hold_key: key }
      else if (reset && reset.toISOString() > at && !far && rateHits <= 1 && left) {
        putHold(key, { kind: 'rate_limit', until: reset.toISOString(), reason: problem.reason, campaign_id: cid, task_id: task.task_id })
        d = { state: 'parked', action: 'park_until_reset', hold_key: key, until: reset.toISOString() }
      } else {
        putHold(key, { kind: 'rate_limit', until: null, reason: problem.reason, campaign_id: cid, task_id: task.task_id })
        d = { state: 'human', action: 'human', hold_key: key }
      }
    } else if ((cls === 'TRANSPORT' || cls === 'TIMEOUT') && left) {
      const alts = roster.filter((a) => a.name !== agentName && (!me || a.role === me.role) && agentFree(a, at))
      if (me && alts.length) {
        // per-task: requeued with avoidAgents=[agentName]; the agent stays free for other tasks
        d = { state: 'retry_wait', action: 'reassign', not_before: at, to: alts.map((a) => a.name) }
      } else d = { state: 'retry_wait', action: 'retry', not_before: plus(backoff(attempt)) }
    } else if (cls === 'TEST_FAILURE' && left) {
      d = { state: 'retry_wait', action: 'retry', not_before: plus(backoff(attempt)) }
    } else d = { state: 'human', action: 'human' }

    tx(() => setRec(cid, task.task_id, { ...base, state: d.state, action: d.action, hold_key: d.hold_key ?? null, not_before: d.not_before ?? null },
      { attempt, class: cls, action: d.action, kind: problem.kind, reason: problem.reason ?? null }))
    ev(cid, 'recovery_decision', { class: cls, kind: problem.kind, attempt, budget, action: d.action, not_before: d.not_before ?? null, hold: d.hold_key ?? null, until: d.until ?? null, to: d.to ?? null }, task.task_id, w.actor)
    if (park) parkTask(w, cid, task.task_id, `${cls} (${d.action})`)
    if (d.state === 'human') {
      const e = await openEscalation(w, { campaign_id: cid, task_id: task.task_id, cls, holdKey: d.hold_key ?? null,
        problem: { kind: problem.kind, reason: problem.reason ?? null, attempt, budget, agent: agentName }, dedupe: `${cid}:${task.task_id}:${cls}:${attempt}:${problem.kind}` })
      tx(() => setRec(cid, task.task_id, { escalation_id: e.id }))
      return { escalated: true, ref: e.id }
    }
    return { escalated: true, ref: `recovery:${cid}:${task.task_id}` }
  }

  /** Act on a confirmed answer. Only a confirmed answer ever reaches here. */
  async function apply(w, id) {
    const e = must(id)
    const opt = e.options.find((o) => o.letter === e.answer)
    const cid = e.campaign_id
    const tid = e.task_id
    const row = tid ? recRow(cid, tid) : null
    const grant = () => { if (row && row.attempt >= budgetOf(row)) tx(() => setRec(cid, tid, { extra_attempts: row.extra_attempts + 1 }, { action: 'extra_attempt', by: w.actor })) }
    const result = { action: opt.action }
    const live = (() => { try { const c = cs().get(cid); return !TERMINAL_CAMPAIGN.includes(c.state) && !c.cancel_requested_at } catch { return false } })()
    if (!live && opt.action !== 'abandon') result.skipped = 'campaign is no longer running'
    else if (opt.action === 'retry') {
      if (e.hold_key) releaseHold(e.hold_key)
      grant()
      if (tid) result.requeue = requeueNow(w, cid, tid, `escalation ${id}: ${opt.label} (${e.answered_by})`, `esc.${id}.retry`)
    } else if (opt.action === 'reassign') {
      grant()
      if (tid) result.requeue = requeueNow(w, cid, tid, `escalation ${id}: reassign (${e.answered_by})`, `esc.${id}.reassign`, row?.agent ? [row.agent] : null)
    } else if (opt.action === 'hold') {
      if (e.answer_until) {
        if (e.hold_key) setHold(e.hold_key, { until: e.answer_until, released_at: null })
        if (row) { grant(); tx(() => setRec(cid, tid, { state: 'retry_wait', not_before: e.answer_until }, { action: 'hold_until', until: e.answer_until, by: w.actor })) }
        result.until = e.answer_until
      } else result.parked = true
    } else result.parked = true
    upd(id, { status: 'resolved', applied: { ...result, at: nowIso(), by: w.actor } })
    ev(cid, 'escalation_resolved', { escalation: id, choice: e.answer, ...result, by: w.actor }, tid, w.actor)
    return result
  }

  /** One maintenance pass over an open escalation: delivery, ack, false presence, answers, expiry. */
  async function service(w, id) {
    let e = must(id)
    if (e.status !== 'open') return e
    if (e.kind === 'APPROVAL' && e.task_id) {
      // The ledger, not this escalation, approves. Once the task has left its approval block it is moot.
      const t = cs().task(e.campaign_id, e.task_id)
      if (!(t.state === 'blocked' && String(t.reason).startsWith('approval:')) && t.state !== 'escalated') {
        e = upd(id, { status: 'superseded', applied: { reason: `task is ${t.state}; the approval ledger decided`, at: nowIso() } })
        ev(e.campaign_id, 'escalation_superseded', { escalation: id, task_state: t.state }, e.task_id, w.actor)
        return e
      }
    }
    if (['pending', 'undelivered_bridge'].includes(e.bridge_state)) await trySend(w, e)
    else if (['sent', 'delivered'].includes(e.bridge_state)) await checkAck(w, e)
    await pullAnswers(must(id))
    e = must(id)
    if (e.status === 'open' && e.answer_state !== 'confirmed' && e.expires_at <= nowIso()) {
      if (e.reminders < P.maxReminders) {
        const reach = ['acked', 'sent', 'delivered'].includes(e.bridge_state)
        e = upd(id, { reminders: e.reminders + 1, expires_at: plus(P.ttlSeconds), ...(reach ? { bridge_state: 'pending', next_send_at: null } : {}) })
        ev(e.campaign_id, 'escalation_reminder', { escalation: id, reminder: e.reminders }, e.task_id, w.actor)
        await note(w, e, `reminder ${e.reminders}/${P.maxReminders}: still waiting for a decision. Silence is not approval; the task stays parked.`)
        if (reach) await trySend(w, e)
      } else if (!e.unanswered_at) {
        e = upd(id, { unanswered_at: nowIso() })
        ev(e.campaign_id, 'escalation_unanswered', { escalation: id, reminders: e.reminders, task_stays: 'parked' }, e.task_id, w.actor)
      }
    }
    return must(id)
  }

  const cursorOf = (cid) => Number(db.prepare('SELECT event_id FROM blitz_recovery_cursor WHERE campaign_id = ?').get(cid)?.event_id ?? 0)
  const setCursor = (cid, n) => db.prepare('INSERT INTO blitz_recovery_cursor (campaign_id, event_id) VALUES (?, ?) ON CONFLICT(campaign_id) DO UPDATE SET event_id = excluded.event_id').run(cid, n)

  const api = {
    policy: P,
    registry: wrappedRegistry,
    classify, parseReset, looksRateLimited,

    attach(controller) { ctl = controller; return api },

    /** Deps for createController: {escalate, registry, dispatch, maxAttempts: 1}. */
    deps({ dispatch } = {}) {
      return { escalate: api.escalate, registry: wrappedRegistry, dispatch: api.wrapDispatch(dispatch ?? defaultDeps.dispatch), maxAttempts: 1 }
    },

    wrapDispatch(inner) {
      return async (task, ctx) => {
        const row = recRow(ctx.campaign.id, task.id)
        const c2 = row?.resume && (!ctx.resumeFrom || ctx.resumeFrom.stage === 'leased') ? { ...ctx, resumeFrom: row.resume } : ctx
        let out
        try { out = await inner(task, c2) } catch (err) {
          const e2 = new Error(`${String(err?.message ?? err)} [attempt ${ctx.attempt}]`)
          e2.cause = err
          throw e2
        }
        if (out && out.result !== undefined && looksRateLimited(out.result)) {
          throw new Error(`quota error reported as success: ${textOf(out.result).slice(0, 300)} [attempt ${ctx.attempt}]`)
        }
        return out
      }
    },

    /** controller escalate hook. */
    async escalate(problem, ctx = {}) {
      const w = { actor: ctx.actor ?? FROM_AGENT, model: null }
      const cid = problem.campaign_id
      if (problem.kind === 'dependency_failed') {
        ev(cid, 'recovery_dependents_wait', { reason: problem.reason }, problem.task_id, w.actor)
        return { escalated: false, recorded: true }
      }
      if (problem.kind === 'verifier_unavailable') {
        // the task stays awaiting_verification (built work is kept); a verifier joining + reverify settles it
        const e = await openEscalation(w, { campaign_id: cid, task_id: problem.task_id ?? null, cls: 'VERIFIER',
          problem: { kind: problem.kind, reason: problem.reason, attempt: problem.attempt ?? null }, dedupe: `${cid}:${problem.task_id ?? '-'}:VERIFIER:${problem.attempt ?? '-'}` })
        return { escalated: false, ref: e.id }
      }
      if (problem.kind === 'approval' || problem.kind === 'cycle') {
        const cls = classify(problem)
        const e = await openEscalation(w, { campaign_id: cid, task_id: problem.task_id ?? null, cls,
          problem: { kind: problem.kind, reason: problem.reason }, dedupe: `${cid}:${problem.task_id ?? '-'}:${cls}:${problem.reason}` })
        return { escalated: false, ref: e.id } // stays blocked: an approval in the ledger unblocks it on its own
      }
      if (!problem.task_id) {
        const e = await openEscalation(w, { campaign_id: cid, cls: 'UNKNOWN', problem: { kind: problem.kind, reason: problem.reason }, dedupe: `${cid}:-:${problem.kind}:${problem.reason}` })
        return { escalated: false, ref: e.id }
      }
      return handleFailure(w, cid, problem)
    },

    /**
     * One recovery pass for a campaign; call before each controller tick (tick() does).
     * Reclaims expired leases and bounds them, requeues tasks whose backoff or hold has ended,
     * services open escalations.
     */
    async pump(w, id) {
      w = requireActor(w)
      const out = { reclaimed: [], requeued: [], escalated: [], escalations: [] }
      const c = cs().get(id)
      const live = ['launched', 'running', 'paused'].includes(c.state) && !c.cancel_requested_at
      if (live) {
        out.reclaimed = ctl.recover(w, id).reclaimed
        let last = cursorOf(id)
        for (const e of cs().events(id, { since: last, kind: 'lease_expired', limit: 5000 })) {
          const row = cs().task(id, e.task_id)
          if (row.state === 'pending' && e.data.to === 'pending') {
            await handleFailure(w, id, { kind: 'lease_expired', campaign_id: id, task_id: e.task_id, attempt: e.data.attempt, agent: e.data.owner,
              checkpoint: e.data.checkpoint, reason: `lease expired at ${e.data.lease_until} (${e.data.owner}, attempt ${e.data.attempt})` }, { park: true })
          }
          last = e.id
        }
        setCursor(id, last)
        const at = nowIso()
        for (const r of db.prepare("SELECT task_id FROM blitz_recovery WHERE campaign_id = ? AND state IN ('retry_wait', 'parked') ORDER BY updated_at").all(id).map((x) => recRow(id, x.task_id))) {
          if (r.not_before && r.not_before > at) continue
          if (holdActive(r.hold_key, at)) continue
          const t = cs().task(id, r.task_id)
          if (t.state !== 'escalated') { tx(() => setRec(id, r.task_id, { state: 'released' }, { action: 'released', reason: `task is ${t.state}` })); continue }
          if (r.attempt >= budgetOf(r)) {
            tx(() => setRec(id, r.task_id, { state: 'human' }, { action: 'budget_exhausted' }))
            const e = await openEscalation(w, { campaign_id: id, task_id: r.task_id, cls: r.class ?? 'UNKNOWN', holdKey: r.hold_key,
              problem: { kind: 'retry_budget', reason: r.reason, attempt: r.attempt, budget: budgetOf(r), agent: r.agent }, dedupe: `${id}:${r.task_id}:${r.class}:${r.attempt}:budget` })
            tx(() => setRec(id, r.task_id, { escalation_id: e.id }))
            out.escalated.push(r.task_id)
            continue
          }
          const res = requeueNow(w, id, r.task_id, `recovery: ${r.class} ${r.action} after attempt ${r.attempt}`, `rec.${r.task_id}.${r.attempt}.${r.rev}`, r.action === 'reassign' && r.agent ? [r.agent] : null)
          if (res.ok) out.requeued.push(r.task_id)
        }
      }
      for (const e of db.prepare("SELECT id FROM blitz_escalations WHERE campaign_id = ? AND status = 'open' ORDER BY created_at").all(id)) {
        const s = await service(w, e.id)
        out.escalations.push({ id: s.id, status: s.status, bridge_state: s.bridge_state, answer_state: s.answer_state })
      }
      return out
    },

    /** pump() then the controller's tick. */
    async tick(w, id, body = {}) {
      const recovery = await api.pump(w, id)
      const r = await ctl.tick(w, id, body)
      return { ...r, recovery }
    },

    /**
     * Record an answer. A relayed one (bridge reply, via, token principal) stays pending_confirm and
     * changes nothing until a direct caller confirms; a direct one is applied at once.
     */
    async answer(w, id, { choice, until = null, note: text = null, rev, relayed = false, via = null } = {}, { source = 'api', messageId = null } = {}) {
      w = who(w)
      if (via) w.via = String(via)
      const isRelayed = relayed === true || Boolean(w.via) || source === 'bridge'
      const letter = String(choice ?? '').trim().toUpperCase()
      let e = must(id)
      if (e.status !== 'open') throw new PmError(409, `escalation ${id} is ${e.status}`)
      if (rev !== undefined && Number(rev) !== e.rev) throw new PmError(409, `escalation ${id} changed since revision ${rev} (now ${e.rev})`, { current: e })
      if (!e.options.some((o) => o.letter === letter)) throw new PmError(400, `choice must be one of ${e.options.map((o) => o.letter).join(', ')}`)
      if (until !== null && until !== undefined && Number.isNaN(Date.parse(until))) throw new PmError(400, 'until must be an ISO date')
      const untilIso = until ? new Date(until).toISOString() : null
      tx(() => {
        db.prepare('INSERT INTO blitz_escalation_answers (escalation_id, choice, note, until, state, source, actor, model, via, message_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, letter, text, untilIso, isRelayed ? 'pending_confirm' : 'confirmed', source, w.actor, w.model, w.via, messageId, nowIso())
        upd(id, { answer: letter, answer_note: text, answer_until: untilIso, answer_state: isRelayed ? 'pending_confirm' : 'confirmed', answered_by: w.actor, answered_at: nowIso(),
          ...(e.bridge_state !== 'acked' && source === 'bridge' ? { bridge_state: 'acked', acked_at: nowIso() } : {}) })
      })
      e = must(id)
      ev(e.campaign_id, isRelayed ? 'escalation_answer_relayed' : 'escalation_answered', { escalation: id, choice: letter, by: w.actor, via: w.via, source, message: messageId }, e.task_id, w.actor)
      await note(w, e, `answer ${letter} from ${w.actor}${isRelayed ? ` (relayed via ${w.via ?? source}; awaiting direct confirmation: POST /api/blitz/escalations/${id}/confirm)` : ''}`)
      if (!isRelayed) await apply(w, id)
      return api.get(id)
    },

    /** Confirm a relayed answer. Only a direct (non-relayed) caller may. */
    async confirm(w, id, { relayed = false, via = null } = {}) {
      w = who(w)
      if (relayed === true || via || w.via) throw new PmError(403, 'a relayed caller cannot confirm an answer')
      const e = must(id)
      if (e.status !== 'open' || e.answer_state !== 'pending_confirm') throw new PmError(409, `escalation ${id} has no answer awaiting confirmation`)
      tx(() => {
        db.prepare('INSERT INTO blitz_escalation_answers (escalation_id, choice, note, until, state, source, actor, model, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, e.answer, e.answer_note, e.answer_until, 'confirmed', 'confirm', w.actor, w.model, nowIso())
        upd(id, { answer_state: 'confirmed', confirmed_by: w.actor })
      })
      ev(e.campaign_id, 'escalation_confirmed', { escalation: id, choice: e.answer, relayed_by: e.answered_by, by: w.actor }, e.task_id, w.actor)
      await note(w, e, `answer ${e.answer} confirmed by ${w.actor}`)
      await apply(w, id)
      return api.get(id)
    },

    get(id) {
      const e = must(id)
      e.history = db.prepare('SELECT * FROM blitz_escalation_answers WHERE escalation_id = ? ORDER BY id').all(id).map((r) => ({ ...r }))
      return e
    },

    /** Lists escalations; bridge replies on open threads are recorded first (as relayed answers). */
    async list({ campaign, status, task } = {}) {
      if (ctl) {
        const open = db.prepare(`SELECT id FROM blitz_escalations WHERE status = 'open' ${campaign ? 'AND campaign_id = ?' : ''}`).all(...(campaign ? [campaign] : []))
        for (const r of open) await pullAnswers(must(r.id))
      }
      const where = []
      const args = []
      if (campaign) { where.push('campaign_id = ?'); args.push(campaign) }
      if (status) { where.push('status = ?'); args.push(status) }
      if (task) { where.push('task_id = ?'); args.push(task) }
      return db.prepare(`SELECT * FROM blitz_escalations ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at, id`).all(...args).map(escRow)
    },

    /** Recovery view of a campaign: per-task decisions, active holds, escalations. */
    status(id) {
      cs().get(id)
      const at = nowIso()
      return {
        campaign: id,
        tasks: db.prepare('SELECT task_id FROM blitz_recovery WHERE campaign_id = ? ORDER BY task_id').all(id).map((r) => recRow(id, r.task_id)),
        holds: db.prepare('SELECT * FROM blitz_recovery_holds WHERE released_at IS NULL AND (until IS NULL OR until > ?) ORDER BY key').all(at).map((r) => ({ ...r })),
        escalations: db.prepare('SELECT * FROM blitz_escalations WHERE campaign_id = ? ORDER BY created_at, id').all(id).map(escRow),
      }
    },

    holdActive: (key) => holdActive(key),
    recoveryRow: (cid, tid) => recRow(cid, tid),
  }
  return api
}

/** createRecovery + createController wired together. Returns {controller, recovery}. */
export function createRecoveringController({ store, db, bridge = null, registry, machines, clock, dispatch, verify, ledgerDb, onEvent, leaseSeconds,
  policy, agent, fallbackAgents, specialists, providerOf } = {}) {
  const recovery = createRecovery({ store, db, bridge, registry, machines, clock, policy, agent, fallbackAgents, specialists, providerOf })
  const controller = createController({ store, db, ledgerDb, verify, clock, onEvent, leaseSeconds, machines, ...recovery.deps({ dispatch }) })
  recovery.attach(controller)
  return { controller, recovery }
}

/** Escalation bridge over pm's createBridge() object (or a getter for it); qa.mjs conventions. */
export function bridgeAdapter(source) {
  const q = () => { const b = typeof source === 'function' ? source() : source; return b?.queue ?? null }
  return {
    available: () => Boolean(q()),
    send: (env) => q().enqueue(env, { principal: FROM_AGENT }),
    message: (id) => q()?.list({ correlation: id, limit: 500 }).find((m) => m.id === id) ?? null,
    replies: (cid) => q()?.list({ correlation: cid, limit: 500 }) ?? [],
    presence: (a) => q()?.pending(a)?.last_seen_at ?? null,
  }
}
