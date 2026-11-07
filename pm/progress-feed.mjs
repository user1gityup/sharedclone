// DSH progress feed adapter (T-409c621d, PM_PROGRESS_V1). Claude Sonnet 5.5.
// Reads a DSH feed snapshot (the progress/state.json written by dsh-runs/*/progress-feed.mjs) and turns each lane
// into PM progress events. Read-only on the feed; never launches runs. Everything external is injected:
//   readState() -> {tasks:[{nn,id,status,pct,run,verdict,note}], updatedAt}
//   runIdFor(task) -> PM run id | null     (tasks without a mapped PM run are skipped, never invented)
//   reportRefFor(task) / checkRefFor(task) -> evidence ref | null
//   post(events) -> Promise<{results:[...]}>
// Stage rules mirror progress.mjs: a report without evidence stays RUNNING at 80, pass without a check_ref
// stays VERIFYING at 90, fail is CHECK_FAILED 90, stopped is BLOCKED. A changed run id starts a new generation (retry).
import { readFileSync } from 'node:fs'

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? Math.round(n) : lo))

/** Pure: feed task -> ordered list of event bodies (without key/seq/generation/run). */
export function stagesFor(t, { reportRef = null, checkRef = null } = {}) {
  const err = String(t.note || t.verdict || 'verification failed').slice(0, 300)
  switch (t.status) {
    case 'queued': return [{ stage: 'queued' }]
    case 'running': return [{ stage: 'running', percent: clamp(t.pct, 10, 80) }]
    case 'checking': return reportRef ? [{ stage: 'report_written', report_ref: reportRef }] : [{ stage: 'running', percent: 80 }]
    case 'pass':
      if (reportRef && checkRef) return [{ stage: 'report_written', report_ref: reportRef }, { stage: 'verified_pass', check_ref: checkRef }]
      return reportRef ? [{ stage: 'report_written', report_ref: reportRef }, { stage: 'verifying' }] : [{ stage: 'running', percent: 80 }]
    case 'fail': return [...(reportRef ? [{ stage: 'report_written', report_ref: reportRef }] : []), { stage: 'check_failed', error: err, ...(checkRef ? { check_ref: checkRef } : {}) }]
    case 'stopped': return [{ stage: 'blocked', result: 'blocked', error: 'run stopped' }]
    default: return [{ stage: 'unknown' }]
  }
}

export function createFeedAdapter({ projectId, readState, runIdFor, post, reportRefFor = () => null, checkRefFor = () => null,
  agent = 'dsh-feed', machine = null, model = null, now = () => Date.now(), memory = {} }) {
  /** One poll: emits only changes. Returns {sent, skipped:[{id,reason}], results}. */
  async function poll() {
    const feed = readState()
    const events = [], skipped = []
    const t0 = now()
    for (const t of feed.tasks ?? []) {
      const run = runIdFor(t)
      if (!run) { skipped.push({ id: t.id, reason: 'no PM run mapped' }); continue }
      const bodies = stagesFor(t, { reportRef: reportRefFor(t), checkRef: checkRefFor(t) })
      const sig = JSON.stringify([run, bodies])
      const m = memory[t.id] ?? (memory[t.id] = { gen: 1, run, seq: 0, sig: '' })
      if (m.sig === sig) continue
      let retry = {}
      if (m.run !== run) { m.gen += 1; m.run = run; retry = { retry: true, retry_reason: `feed run changed to ${run}` } }
      for (const b of bodies) {
        m.seq = Math.max(m.seq + 1, t0)
        events.push({ event_key: `${t.id}:g${m.gen}:${m.seq}:${b.stage}`, task_id: t.id, project_id: projectId, run_id: run, generation: m.gen,
          seq: m.seq, result: b.result, ...b, ...retry, source_agent: agent, source_machine: machine, source_model: model,
          event_time: new Date(t0).toISOString() })
        retry = {}
      }
      m.sig = sig
    }
    const out = events.length ? await post(events) : { results: [] }
    return { sent: events.length, skipped, results: out.results }
  }
  return { poll, memory }
}

export const fileState = (path) => () => JSON.parse(readFileSync(path, 'utf8'))
export const httpSink = (base, actor, fetchImpl = fetch) => async (events) => {
  const r = await fetchImpl(`${base}/api/progress/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pm-actor': actor }, body: JSON.stringify({ actor, events }) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}
