// node --test progress-routes.test.mjs - progress routes, DSH feed adapter, Pac-Man lanes (T-409c621d, Claude Sonnet 5.5)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStore } from './store.mjs'
import { createServer } from './server.mjs'
import { createFeedAdapter, stagesFor, httpSink } from './progress-feed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const A = { actor: 'Claude Sonnet 5.5', model: 'x' }

async function boot(dbPath = ':memory:') {
  const store = openStore(dbPath)
  const server = createServer(store)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-pm-actor': 'tester' }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, body: await r.json() }
  }
  return { store, server, base, call, close: () => new Promise((r) => { server.close(() => { store.close(); r() }); server.closeAllConnections() }) }
}
function seed(store, n = 3) {
  const p = store.createProject(A, { name: 'demo' }), q = store.createProject(A, { name: 'other' })
  const tasks = [], runs = []
  for (let i = 0; i < n; i++) {
    const t = store.createTask(A, { project: 'demo', title: i === 0 ? '00 — preflight' : `${String(i).padStart(2, '0')} — task ${i}` })
    tasks.push(t.id); runs.push(store.startRun(A, t.id, { kind: 'dsh-pipeline', machine: 'vmixer2o2' }).id)
  }
  const ot = store.createTask(A, { project: 'other', title: 'foreign' })
  return { p, q, tasks, runs, ot, orun: store.startRun(A, ot.id, { kind: 'dsh-pipeline', machine: 'vmixer2o2' }).id }
}
let seq = 0
const ev = (s, i, o = {}) => ({ event_key: `e${++seq}`, task_id: s.tasks[i], project_id: s.p.id, run_id: s.runs[i], generation: 1, seq, stage: 'running', percent: 30,
  source_agent: 'dsh-feed', event_time: new Date().toISOString(), ...o })

test('routes: persist across restart, dedupe, late, forged and untrusted events rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-prog-')); const path = join(dir, 'pm.db')
  let h = await boot(path); const s = seed(h.store)
  const e1 = ev(s, 1)
  let r = await h.call('POST', '/api/progress/events', e1); assert.equal(r.status, 200); assert.equal(r.body.results[0].status, 'applied')
  r = await h.call('POST', '/api/progress/events', e1); assert.equal(r.body.results[0].status, 'duplicate')
  r = await h.call('POST', '/api/progress/events', ev(s, 1, { seq: 1, percent: 20 })); assert.equal(r.body.results[0].status, 'late')
  // cross-project forgery: task of project demo claimed under project other
  r = await h.call('POST', '/api/progress/events', ev(s, 1, { project_id: s.q.id })); assert.equal(r.status, 403)
  // run of another task
  r = await h.call('POST', '/api/progress/events', ev(s, 1, { run_id: s.orun })); assert.equal(r.status, 409)
  r = await h.call('POST', '/api/progress/events', ev(s, 1, { source_agent: 'rando' })); assert.equal(r.status, 403)
  const status0 = h.store.getTask(s.tasks[1]).status
  await h.close()
  h = await boot(path)
  r = await h.call('GET', `/api/tasks/${s.tasks[1]}/progress`)
  assert.equal(r.body.percent, 30); assert.equal(r.body.known, true)
  assert.equal(h.store.getTask(s.tasks[1]).status, status0) // lifecycle untouched
  r = await h.call('GET', `/api/progress/audit?task_id=${s.tasks[1]}`); assert.ok(r.body.some((a) => a.outcome === 'rejected'))
  r = await h.call('GET', `/api/tasks/${s.tasks[2]}/progress`); assert.equal(r.body.known, false); assert.equal(r.body.label, 'UNKNOWN')
  await h.close(); rmSync(dir, { recursive: true, force: true })
})

test('project rollup counts unknown tasks, never fakes 100 from a report', async () => {
  const h = await boot(); const s = seed(h.store, 4)
  await h.call('POST', '/api/progress/events', ev(s, 0, { stage: 'report_written', report_ref: 'r.md' }))
  let r = await h.call('GET', `/api/projects/${s.p.id}/progress`)
  assert.equal(r.body.rollup.total, 4); assert.equal(r.body.rollup.unknown, 3); assert.equal(r.body.rollup.verified, 0)
  assert.equal(r.body.rollup.percent_of_all, Math.round(85 / 4)); assert.equal(r.body.lanes.length, 4)
  assert.equal(r.body.lanes[0].progress.animate_success, false)
  await h.call('POST', '/api/progress/events', ev(s, 0, { stage: 'verified_pass', check_ref: 'c.json' }))
  r = await h.call('GET', `/api/projects/${s.p.id}/progress`)
  assert.equal(r.body.rollup.verified, 1); assert.equal(r.body.lanes.find((l) => l.task_id === s.tasks[0]).progress.animate_success, true)
  assert.equal((await h.call('GET', '/api/projects/nope/progress')).status, 404)
  await h.close()
})

test('feed adapter: stage mapping, change-only polling, skip unmapped, retry generation, failure never success', async () => {
  assert.deepEqual(stagesFor({ status: 'running', pct: 99 }).map((x) => x.percent), [80])
  assert.equal(stagesFor({ status: 'pass' }, {})[0].stage, 'running') // no report evidence: no pass
  assert.deepEqual(stagesFor({ status: 'pass' }, { reportRef: 'r' }).map((x) => x.stage), ['report_written', 'verifying'])
  assert.deepEqual(stagesFor({ status: 'pass' }, { reportRef: 'r', checkRef: 'c' }).map((x) => x.stage), ['report_written', 'verified_pass'])
  assert.equal(stagesFor({ status: 'fail', note: 'bad' }).at(-1).stage, 'check_failed')

  const h = await boot(); const s = seed(h.store, 3)
  let feed = { tasks: [{ id: s.tasks[0], status: 'running', pct: 40 }, { id: s.tasks[1], status: 'fail', pct: 90, note: 'judge failed' }, { id: 'T-unmapped', status: 'running', pct: 20 }] }
  let clock = 1_000_000
  const runIds = Object.fromEntries(s.tasks.map((t, i) => [t, s.runs[i]]))
  const ad = createFeedAdapter({ projectId: s.p.id, readState: () => feed, runIdFor: (t) => runIds[t.id] ?? null, now: () => (clock += 1000),
    post: httpSink(h.base, 'dsh-feed') })
  let out = await ad.poll()
  assert.equal(out.sent, 2); assert.equal(out.skipped[0].id, 'T-unmapped'); assert.ok(out.results.every((x) => x.status === 'applied'))
  out = await ad.poll(); assert.equal(out.sent, 0) // unchanged feed -> nothing sent
  feed.tasks[0].pct = 60
  out = await ad.poll(); assert.equal(out.sent, 1)
  let r = await h.call('GET', `/api/tasks/${s.tasks[1]}/progress`)
  assert.equal(r.body.stage, 'check_failed'); assert.equal(r.body.percent, 90); assert.equal(r.body.done, false); assert.equal(r.body.animate_success, false)
  assert.equal((await h.call('GET', `/api/tasks/${s.tasks[0]}/progress`)).body.percent, 60)
  await h.close()
})

// ---- UI: extract the progress block from index.html and run it with stubs ----
function loadUi() {
  const html = readFileSync(join(HERE, 'public', 'index.html'), 'utf8')
  const a = html.indexOf('// ---------- progress view'), b = html.indexOf('// ---------- end progress view')
  assert.ok(a > 0 && b > a)
  const src = html.slice(a, b)
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const S = { projects: [{ id: 'P1', name: 'demo' }] }
  const fn = new Function('S', 'store', 'escapeHtml', 'chipHtml', 'mapStatusToChip', 'api', '$', 'document', 'location', 'history', 'renderMain', `${src}; return { viewProgress, laneHtml }`)
  const ui = fn(S, { get: () => null, set() {} }, esc, () => '', (x) => x, async () => ({}), () => null, { addEventListener() {} }, { hash: '' }, {}, () => {})
  return { S, ...ui }
}
const lane = (i, progress, status = 'todo') => ({ task_id: `T-${i}`, title: `${String(i).padStart(2, '0')} — t${i}`, status, lifecycle: 'READY', progress })
const unk = { known: false, label: 'UNKNOWN', percent: null }

test('UI: 0/1/14/50+ lanes, gates, failure never success, reduced-motion bar, unknown text', () => {
  const ui = loadUi()
  const render = (n, mk) => { ui.S.prog.pid = 'P1'; ui.S.prog.data = { project_id: 'P1', now: 'now', rollup: { total: n, known: 0, unknown: n, verified: 0, failed: 0, stale: 0, percent_of_all: 0, verified_pct: 0 }, lanes: Array.from({ length: n }, (_, i) => mk(i)) }; return ui.viewProgress() }
  assert.match(render(0, () => 0), /No tasks match/)
  assert.equal((render(1, (i) => lane(i, unk)).match(/class="lane"/g) || []).length, 1)
  const h14 = render(14, (i) => lane(i, unk)); assert.equal((h14.match(/class="lane"/g) || []).length, 14)
  assert.match(h14, /Preflight gate/); assert.match(h14, /UNKNOWN \(no progress evidence\)/)
  assert.equal((render(60, (i) => lane(i + 1, unk)).match(/class="lane"/g) || []).length, 60)
  const fail = ui.laneHtml(lane(3, { known: true, stage: 'check_failed', label: 'CHECK_FAILED', percent: 90, result: 'fail', generation: 1, run_id: 'R', age_label: '1m ago', animate_success: false, error: 'x' }), false)
  assert.match(fail, /CHECK FAILED \(not done\)/); assert.doesNotMatch(fail, /class="track[^"]*won/); assert.doesNotMatch(fail, /VERIFIED PASS/)
  const ok = ui.laneHtml(lane(4, { known: true, stage: 'verified_pass', label: 'VERIFIED_PASS', percent: 100, generation: 1, run_id: 'R', age_label: 'now', animate_success: true, check_ref: 'c' }), false)
  assert.match(ok, /track  won/); assert.match(ok, /VERIFIED PASS/); assert.match(ok, /role="progressbar"/)
  assert.match(readFileSync(join(HERE, 'public', 'index.html'), 'utf8'), /prefers-reduced-motion: reduce\) \{ \.track/)
})
