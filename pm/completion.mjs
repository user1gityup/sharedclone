// Completion recommendation (T-0ee62fe6). pm only RECOMMENDS; a human or reviewer moves a task
// to done. Pure over a store snapshot: store.getTask(id) plus listRuns({task_id}).

/** { recommend: 'done'|'review'|'rework'|'wait', reasons } for a task. Never changes anything. */
export function recommendCompletion(store, id) {
  const t = store.getTask(id)
  const runs = store.listRuns({ task_id: id })
  const reasons = []
  const live = runs.filter((r) => ['requested', 'starting', 'running', 'held'].includes(r.state))
  if (live.length) return { recommend: 'wait', reasons: [`${live.length} run(s) still live`] }
  const last = runs[0]
  if (!last) return { recommend: 'wait', reasons: ['no run recorded'] }
  if (last.state === 'failed' || last.state === 'cancelled') return { recommend: 'rework', reasons: [`last run ${last.state}`] }
  const artifacts = t.artifacts ?? []
  const evidence = artifacts.filter((a) => ['commit', 'evidence', 'file', 'url'].includes(a.kind))
  if (!evidence.length) reasons.push('no commit/evidence/file artifact')
  const open = (t.comments ?? []).filter((c) => c.kind === 'instruction' && !c.acked_by)
  if (open.length) reasons.push(`${open.length} unacknowledged instruction(s)`)
  if (reasons.length) return { recommend: 'review', reasons }
  return { recommend: 'done', reasons: ['run finished, evidence attached, no open instructions'] }
}
