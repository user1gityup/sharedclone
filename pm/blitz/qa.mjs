// Blitz project-by-project Q&A (BLITZ-02, Q8 = finish Q&A one project at a time).
// Questions live in blitz_questions on pm's own database; every answer is kept in
// blitz_answers, so history survives re-answers. A question on a task is also posted
// as a plain pm comment ([blitz-question <qid>]): comments.kind only allows
// comment|instruction. Questions of the campaign's current project are mirrored to a
// bridge message whose correlation_id is the qid; a reply on that thread is a relayed
// answer. Relayed answers (bridge replies, role-checked token principals, or
// relayed/via in the body) stay pending_confirm and keep the question open until a
// direct caller confirms them - the same rule approvals.mjs applies.
import { randomBytes } from 'node:crypto'
import { PmError } from '../store.mjs'

export const QA_AGENT = process.env.BLITZ_QA_AGENT || 'chatgpt'
const FROM_AGENT = 'pm-blitz'
const ID = /^[\w.-]{1,64}$/

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blitz_questions (
  qid TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), task_id TEXT,
  seq INTEGER NOT NULL, question TEXT NOT NULL, options TEXT, decision_key TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'superseded')),
  answer TEXT, answer_state TEXT CHECK (answer_state IN ('confirmed', 'pending_confirm')), answered_by TEXT, answered_model TEXT,
  answered_at TEXT, reused_from TEXT, correlation_id TEXT NOT NULL, mirror_id TEXT, mirrored_at TEXT,
  rev INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT NOT NULL, created_model TEXT);
CREATE INDEX IF NOT EXISTS blitz_questions_campaign ON blitz_questions(campaign_id, status, seq);
CREATE INDEX IF NOT EXISTS blitz_questions_decision ON blitz_questions(decision_key, status);
CREATE TABLE IF NOT EXISTS blitz_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, qid TEXT NOT NULL REFERENCES blitz_questions(qid), answer TEXT NOT NULL,
  state TEXT NOT NULL, source TEXT NOT NULL, actor TEXT NOT NULL, model TEXT, via TEXT, message_id TEXT, at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS blitz_answers_message ON blitz_answers(message_id) WHERE message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS blitz_qa_order (
  campaign_id TEXT NOT NULL, project_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (campaign_id, project_id));
`

const row = (r) => (r ? { ...r, options: r.options ? JSON.parse(r.options) : null } : r)

/** Q&A service over a pm store; `bridge` (optional) is the createBridge() object, used for its queue. */
export function openQa(store, { bridge = null, agent = QA_AGENT, clock = () => new Date() } = {}) {
  const db = store.db
  db.exec(SCHEMA)
  const now = () => clock().toISOString()
  const queue = bridge?.queue ?? null

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE')
    try { const out = fn(); db.exec('COMMIT'); return out } catch (err) { db.exec('ROLLBACK'); throw err }
  }
  const who = (w) => {
    const actor = typeof w?.actor === 'string' ? w.actor.trim() : ''
    if (!actor) throw new PmError(400, 'actor is required: name who is making this change (for an agent, its model name)')
    return { actor, model: typeof w.model === 'string' && w.model.trim() ? w.model.trim() : null, via: w.via || null }
  }
  const campaignId = (id) => {
    if (!ID.test(String(id ?? ''))) throw new PmError(400, 'campaign id must match [\\w.-]{1,64}')
    return String(id)
  }
  const projectId = (ref) => {
    const p = db.prepare('SELECT id, status FROM projects WHERE id = ? OR name = ?').get(ref, ref)
    if (!p) throw new PmError(400, `unknown project ${ref}`)
    return p.id
  }
  const must = (qid) => {
    const q = row(db.prepare('SELECT * FROM blitz_questions WHERE qid = ?').get(qid))
    if (!q) throw new PmError(404, `no question ${qid}`)
    return q
  }
  const note = (w, q, action, data = {}) => store.recordEvent(w, 'blitz_question', q.qid, action, { campaign: q.campaign_id, project: q.project_id, ...data })
  const comment = (w, q, text) => { if (q.task_id) store.addComment(w, q.task_id, { body: text }) }

  function order(campaign) {
    return db.prepare('SELECT project_id FROM blitz_qa_order WHERE campaign_id = ? ORDER BY position').all(campaign).map((r) => r.project_id)
  }

  /** The first project, in campaign order, that still has an open question. */
  function currentProject(campaign) {
    for (const pid of order(campaign)) {
      if (db.prepare("SELECT 1 FROM blitz_questions WHERE campaign_id = ? AND project_id = ? AND status = 'open' LIMIT 1").get(campaign, pid)) return pid
    }
    return null
  }

  /** Mirror the current project's unmirrored open questions to the bridge. Later projects wait. */
  function syncMirror(campaign) {
    const pid = currentProject(campaign)
    if (!pid || !queue) return []
    const due = db.prepare("SELECT * FROM blitz_questions WHERE campaign_id = ? AND project_id = ? AND status = 'open' AND mirrored_at IS NULL ORDER BY seq").all(campaign, pid).map(row)
    for (const q of due) {
      const m = queue.enqueue({ type: 'message', to: { agent }, from: { agent: FROM_AGENT }, correlation_id: q.qid, dedupe_key: `blitz-q-${q.qid}`, project: q.project_id,
        task: q.task_id ?? undefined, body: { kind: 'blitz_question', qid: q.qid, campaign: campaign, project: q.project_id, task: q.task_id, question: q.question,
          options: q.options, answer_with: `POST /api/blitz/qa/${q.qid}/answer {answer}`, or_reply_on_thread: q.qid } }, { principal: FROM_AGENT })
      db.prepare('UPDATE blitz_questions SET mirror_id = ?, mirrored_at = ? WHERE qid = ?').run(m.id, now(), q.qid)
    }
    return due.map((q) => q.qid)
  }

  function record(w, q, answer, { state, source, messageId = null, reusedFrom = null }) {
    const at = now()
    db.prepare('INSERT INTO blitz_answers (qid, answer, state, source, actor, model, via, message_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(q.qid, answer, state, source, w.actor, w.model, w.via, messageId, at)
    db.prepare(`UPDATE blitz_questions SET answer = ?, answer_state = ?, answered_by = ?, answered_model = ?, answered_at = ?, reused_from = ?,
      status = ?, rev = rev + 1 WHERE qid = ?`).run(answer, state, w.actor, w.model, at, reusedFrom, state === 'confirmed' ? 'answered' : 'open', q.qid)
  }

  const api = {
    agent,

    /** Set (or extend) the campaign's project order. Projects already ordered keep their place unless listed. */
    setOrder(w, campaign, { projects } = {}) {
      who(w)
      campaign = campaignId(campaign)
      if (!Array.isArray(projects) || !projects.length) throw new PmError(400, 'projects[] is required')
      const ids = [...new Set(projects.map(projectId))]
      tx(() => {
        const rest = order(campaign).filter((p) => !ids.includes(p))
        db.prepare('DELETE FROM blitz_qa_order WHERE campaign_id = ?').run(campaign)
        const ins = db.prepare('INSERT INTO blitz_qa_order (campaign_id, project_id, position) VALUES (?, ?, ?)')
        ;[...ids, ...rest].forEach((p, i) => ins.run(campaign, p, i))
      })
      syncMirror(campaign)
      return { campaign, order: order(campaign), current: currentProject(campaign) }
    },

    ask(w, campaign, { project, task = null, question, options = null, decision_key = null } = {}) {
      w = who(w)
      campaign = campaignId(campaign)
      if (!question?.trim?.()) throw new PmError(400, 'question is required')
      if (options !== null && !Array.isArray(options)) throw new PmError(400, 'options must be an array')
      if (decision_key !== null && !/^[\w.:/@-]{1,128}$/.test(String(decision_key))) throw new PmError(400, 'decision_key must match [\\w.:/@-]{1,128}')
      const pid = projectId(project)
      if (task) {
        const t = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(task)
        if (!t) throw new PmError(400, `unknown task ${task}`)
        if (t.project_id !== pid) throw new PmError(400, `task ${task} is not in project ${project}`)
      }
      const qid = `Q-${randomBytes(4).toString('hex')}`
      const reuse = decision_key
        ? db.prepare("SELECT * FROM blitz_questions WHERE decision_key = ? AND status = 'answered' AND answer_state = 'confirmed' ORDER BY answered_at DESC LIMIT 1").get(decision_key)
        : null
      tx(() => {
        if (!db.prepare('SELECT 1 FROM blitz_qa_order WHERE campaign_id = ? AND project_id = ?').get(campaign, pid)) {
          const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM blitz_qa_order WHERE campaign_id = ?').get(campaign).n
          db.prepare('INSERT INTO blitz_qa_order (campaign_id, project_id, position) VALUES (?, ?, ?)').run(campaign, pid, pos)
        }
        const seq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM blitz_questions WHERE campaign_id = ?').get(campaign).n
        db.prepare(`INSERT INTO blitz_questions (qid, campaign_id, project_id, task_id, seq, question, options, decision_key, correlation_id, created_at, created_by, created_model)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(qid, campaign, pid, task, seq, question.trim(), options ? JSON.stringify(options) : null,
          decision_key, qid, now(), w.actor, w.model)
        if (reuse) record({ actor: 'blitz-reuse', model: null, via: null }, { qid }, reuse.answer, { state: 'confirmed', source: 'reuse', reusedFrom: reuse.qid })
      })
      const q = must(qid)
      note(w, q, 'asked', { task, decision_key, reused_from: q.reused_from })
      comment(w, q, `[blitz-question ${qid}] ${q.question}${options ? `\nOptions: ${options.join(' | ')}` : ''}${q.reused_from ? `\nAuto-answered from ${q.reused_from}: ${q.answer}` : ''}`)
      syncMirror(campaign)
      return api.get(qid)
    },

    /**
     * Answer (or re-answer). Relayed answers stay pending_confirm. `rev`, when given,
     * must match the question's revision.
     */
    answer(w, qid, { answer, rev, relayed = false, via = null } = {}, { source = 'api', messageId = null } = {}) {
      w = who(w)
      if (typeof answer !== 'string' || !answer.trim()) throw new PmError(400, 'answer is required')
      if (via) w.via = String(via)
      const isRelayed = relayed === true || Boolean(w.via) || source === 'bridge'
      const q = tx(() => {
        const q = must(qid)
        if (q.status === 'superseded') throw new PmError(409, `question ${qid} is superseded`)
        if (rev !== undefined && Number(rev) !== q.rev) throw new PmError(409, `question ${qid} changed since revision ${rev} (now ${q.rev})`, { current: q })
        record(w, q, answer.trim(), { state: isRelayed ? 'pending_confirm' : 'confirmed', source, messageId })
        return q
      })
      note(w, q, isRelayed ? 'answer_relayed' : 'answered', { source, via: w.via, message_id: messageId })
      comment(w, q, `[blitz-answer ${qid}]${isRelayed ? ' (relayed, awaiting confirmation)' : ''} ${answer.trim()}`)
      syncMirror(q.campaign_id)
      return api.get(qid)
    },

    /** Confirm a pending relayed answer. Only a direct (non-relayed) caller may confirm. */
    confirm(w, qid, { relayed = false, via = null } = {}) {
      w = who(w)
      if (relayed === true || via || w.via) throw new PmError(403, 'a relayed caller cannot confirm an answer')
      const q = tx(() => {
        const q = must(qid)
        if (q.answer_state !== 'pending_confirm') throw new PmError(409, `question ${qid} has no answer awaiting confirmation`)
        record(w, q, q.answer, { state: 'confirmed', source: 'confirm', reusedFrom: q.reused_from })
        return q
      })
      note(w, q, 'answer_confirmed', { relayed_by: q.answered_by })
      comment(w, q, `[blitz-answer ${qid}] confirmed by ${w.actor}`)
      syncMirror(q.campaign_id)
      return api.get(qid)
    },

    /** Read replies on mirrored threads (correlation_id = qid) and record them as relayed answers. */
    pullBridgeAnswers(campaign = null) {
      if (!queue) return []
      const open = db.prepare(`SELECT * FROM blitz_questions WHERE mirror_id IS NOT NULL AND status = 'open' ${campaign ? 'AND campaign_id = ?' : ''}`)
        .all(...(campaign ? [campaign] : [])).map(row)
      const got = []
      for (const q of open) {
        for (const m of queue.list({ correlation: q.qid, limit: 500 })) {
          if (m.id === q.mirror_id || m.from?.agent === FROM_AGENT) continue
          if (db.prepare('SELECT 1 FROM blitz_answers WHERE message_id = ?').get(m.id)) continue
          const body = typeof m.body === 'string' ? (() => { try { return JSON.parse(m.body) } catch { return { text: m.body } } })() : (m.body ?? {})
          const text = [body.answer, body.text, body.result, body.message].find((v) => typeof v === 'string' && v.trim())
          if (!text) continue
          api.answer({ actor: `${m.from.agent}@${m.from.machine}`, model: body.model ?? null, via: 'bridge' }, q.qid, { answer: text }, { source: 'bridge', messageId: m.id })
          got.push({ qid: q.qid, message: m.id })
        }
      }
      return got
    },

    get(qid) {
      const q = must(qid)
      q.history = db.prepare('SELECT * FROM blitz_answers WHERE qid = ? ORDER BY id').all(qid).map((r) => ({ ...r }))
      return q
    },

    list({ campaign, project, status } = {}) {
      api.pullBridgeAnswers(campaign || null)
      const where = []
      const args = []
      if (campaign) { where.push('campaign_id = ?'); args.push(campaign) }
      if (project) { where.push('project_id = ?'); args.push(projectId(project)) }
      if (status) { where.push('status = ?'); args.push(status) }
      return db.prepare(`SELECT * FROM blitz_questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY campaign_id, seq`).all(...args).map(row)
    },

    /** Where a campaign's Q&A stands: the active project, its open questions, and the queue behind it. Safe to call after a restart. */
    current(campaign) {
      campaign = campaignId(campaign)
      api.pullBridgeAnswers(campaign)
      syncMirror(campaign)
      const pid = currentProject(campaign)
      const openBy = (p) => db.prepare("SELECT * FROM blitz_questions WHERE campaign_id = ? AND project_id = ? AND status = 'open' ORDER BY seq").all(campaign, p).map(row)
      return {
        campaign,
        order: order(campaign),
        project: pid,
        open: pid ? openBy(pid) : [],
        queued: order(campaign).filter((p) => p !== pid).map((p) => ({ project: p, open: openBy(p).length })).filter((x) => x.open),
        done: !pid,
      }
    },
  }
  return api
}
