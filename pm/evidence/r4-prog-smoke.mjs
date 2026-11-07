// smoke: P-244afbc3 read-only feed -> temp pm :4493 (copy of live db)
import { DatabaseSync } from 'node:sqlite'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
const R = 'C:/Users/vMixer/Documents/claudecode/blitz-runs/r4-prog/pm/'
const { createFeedAdapter, fileState, httpSink } = await import('file:///' + R + 'progress-feed.mjs')
const base = 'http://127.0.0.1:4493', root = join(homedir(), 'Documents/claudecode/dsh-runs/evidence-closure')
const j = async (m, p, b) => (await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', 'x-pm-actor': 'Claude Sonnet 5.5' }, body: b ? JSON.stringify(b) : undefined })).json()
const feedPath = join(root, 'progress/state.json'), state = fileState(feedPath)()
const runs = {}
for (const t of state.tasks) runs[t.id] = (await j('POST', `/api/tasks/${t.id}/runs`, { actor: 'Claude Sonnet 5.5', kind: 'dsh-pipeline', machine: 'vmixer2o2' })).id
const dir = (t) => join(root, `${t.nn}-${t.id}`)
const ad = createFeedAdapter({ projectId: 'P-244afbc3', readState: fileState(feedPath), runIdFor: (t) => runs[t.id], agent: 'dsh-feed', machine: 'vmixer2o2', model: 'dsh evidence-closure feed',
  reportRefFor: (t) => existsSync(join(dir(t), 'out/REPORT.md')) ? join(dir(t), 'out/REPORT.md') : null,
  checkRefFor: (t) => existsSync(join(dir(t), 'CHECK.json')) ? join(dir(t), 'CHECK.json') : null,
  post: httpSink(base, 'dsh-feed') })
const out = await ad.poll(); console.log('poll1', out.sent, JSON.stringify(out.skipped), out.results.filter((r) => r.status !== 'applied').length, 'non-applied')
const out2 = await ad.poll(); console.log('poll2 (unchanged feed)', out2.sent)
const pr = await j('GET', '/api/projects/P-244afbc3/progress')
console.log('rollup', JSON.stringify(pr.rollup))
for (const l of pr.lanes.filter((l) => /^\d\d /.test(l.title))) console.log(l.task_id, l.title.slice(0, 28).padEnd(28), l.status.padEnd(11), l.progress.known ? `${l.progress.stage} ${l.progress.percent}% anim=${l.progress.animate_success}` : 'UNKNOWN')
