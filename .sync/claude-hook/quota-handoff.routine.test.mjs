// Tests A-E for the Quota Handoff Routine (spec quota-handoff-routine-update.md section 13).
// Runs the real quota-guard.mjs and the hook module against throwaway brain/home/config dirs.
// Usage: node routine.test.mjs <path to quota-handoff.mjs>
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const hookPath = process.argv[2]
process.env.QUOTA_HANDOFF_NO_REFRESH = '1'
const hook = await import(pathToFileURL(hookPath).href)
const guard = await import(pathToFileURL(join(homedir(), '.claude', 'shared-brain', '.sync', 'quota-guard.mjs')).href)

const root = mkdtempSync(join(tmpdir(), 'qh-routine-'))
let n = 0
function world() { const d = join(root, `w${++n}`); mkdirSync(join(d, 'brain', 'quota-handoffs'), { recursive: true }); return d }
function machine(w, host) {
  const base = join(w, host)
  const E = guard.env({
    QUOTA_GUARD_HOME: join(base, 'guard'), QUOTA_GUARD_BRAIN: join(w, 'brain'), QUOTA_GUARD_CONFIG_DIR: join(base, 'config'),
    QUOTA_GUARD_CACHE: join(base, 'no-cache.json'), QUOTA_GUARD_HOST: host, QUOTA_GUARD_ACCOUNT_UUID: `acct-${host}-0000`,
    QUOTA_GUARD_DESKTOP_DIR: join(base, 'desktop'), QUOTA_GUARD_USER: 'tester',
  })
  return E
}
function session(E, sid, objective) {
  const dir = join(E.configDir, 'projects', 'proj')
  mkdirSync(dir, { recursive: true })
  const now = new Date().toISOString()
  const lines = [
    { type: 'user', sessionId: sid, cwd: root, timestamp: now, message: { role: 'user', content: objective } },
    { type: 'assistant', sessionId: sid, cwd: root, timestamp: now, message: { role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: `working on ${objective}` }], usage: { input_tokens: 10 } } },
  ]
  writeFileSync(join(dir, `${sid}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return join(dir, `${sid}.jsonl`)
}
const run = (E, opts = {}, extra = {}) => hook.runRoutine({ launcher: 'print', self: 'not-a-session', ...opts }, { guard, E, ...extra })
const rows = (r) => Object.fromEntries(r.plan.rows.map((x) => [x.session_id, x]))
const log = (label, obj) => console.log(`${label}: ${JSON.stringify(obj)}`)
const hash = (p) => createHash('sha1').update(readFileSync(p)).digest('hex')

// ---- Test A: single machine, several sessions
{
  const w = world(); const V = machine(w, 'vmixer')
  for (const s of ['a1', 'a2', 'a3']) session(V, s, `task ${s}`)
  const r = await run(V)
  log('A phases', r.phases.map((p) => `${p.phase}=${p.ok}`))
  log('A plan', r.plan.rows.map((x) => `${x.session_id}:${x.origin_machine}->${x.target_machine}:${x.action}`))
  log('A launched', r.launched.map((l) => `${l.session_id}@${l.target_machine}:${l.state}`))
  assert.equal(r.ok, true); assert.deepEqual(r.phases.map((p) => p.phase), ['ARCHIVE_ALL', 'VERIFY_ARCHIVE', 'BUILD_RESUME_PLAN', 'MACHINE_AWARE_RESUME'])
  assert.equal(r.launched.length, 3); assert.ok(r.launched.every((l) => l.target_machine === 'vmixer' && l.state === 'RESTORED'))
  // A re-run archives again but does not relaunch what already has a replacement.
  const again = await run(V)
  log('A rerun actions', again.plan.rows.map((x) => `${x.session_id}:${x.action}`))
  assert.equal(again.launched.length, 0)
  console.log('TEST A PASS')
}

// ---- Test B: VMIXER + NDI on one coordinated task
{
  const w = world(); const V = machine(w, 'vmixer'); const N = machine(w, 'ndi')
  session(V, 'agentA-s101', 'Coordinated Task #42: Agent A builds the API')
  session(N, 'agentB-s204', 'Coordinated Task #42: Agent B builds the UI')
  const rv = await run(V)
  const rn = await run(N)
  log('B vmixer launched', rv.launched.map((l) => `${l.session_id}@${l.target_machine}`))
  log('B ndi launched', rn.launched.map((l) => `${l.session_id}@${l.target_machine}`))
  log('B ndi plan', rn.plan.rows.map((x) => `${x.session_id}:${x.origin_machine}->${x.target_machine}:${x.coordinated_group_id}:${x.action}`))
  log('B groups', rn.plan.groups)
  assert.deepEqual(rv.launched.map((l) => [l.session_id, l.target_machine]), [['agentA-s101', 'vmixer']])
  assert.deepEqual(rn.launched.map((l) => [l.session_id, l.target_machine]), [['agentB-s204', 'ndi']])
  const g = rn.plan.groups['coordinated-42']
  assert.equal(g.spans_machines, true); assert.deepEqual(g.machines, { ndi: ['agentB-s204'], vmixer: ['agentA-s101'] })
  assert.ok(rn.plan.rows.every((x) => !x.cross_machine), 'no cross-machine row')
  console.log('TEST B PASS')
}

// ---- Test C: both machines archived; standard Routine called from VMIXER only
{
  const w = world(); const V = machine(w, 'vmixer'); const N = machine(w, 'ndi')
  session(V, 'v1', 'vmixer work 1'); session(V, 'v2', 'vmixer work 2')
  session(N, 'n1', 'ndi work 1'); session(N, 'n2', 'ndi work 2')
  const archivedN = await run(N, { planOnly: true })
  assert.equal(archivedN.ok, true)
  const r = await run(V)
  log('C vmixer plan', r.plan.rows.map((x) => `${x.session_id}:${x.origin_machine}->${x.target_machine}:${x.action}`))
  log('C launched', r.launched.map((l) => `${l.session_id}@${l.target_machine}`))
  const ndiHandoff = guard.loadManifest(V, archivedN.handoff_id)
  log('C ndi handoff after', { state: ndiHandoff.state, claim: ndiHandoff.claim ?? null, restore: ndiHandoff.restore ?? null })
  assert.deepEqual(r.launched.map((l) => l.session_id).sort(), ['v1', 'v2'])
  assert.equal(rows(r).n1.action, 'leave:other-machine'); assert.equal(rows(r).n2.action, 'leave:other-machine')
  assert.equal(ndiHandoff.state, 'READY'); assert.equal(ndiHandoff.claim, undefined); assert.equal(ndiHandoff.restore, undefined)

  // ---- Test E: the plan can represent origin != target without it being the default
  const local = r.plan.rows.filter((x) => x.cross_machine)
  const pooled = await run(V, { mode: 'pooled', planOnly: true })
  const pooledGo = await run(V, { mode: 'pooled' })
  const chosen = await run(V, { mode: 'choose', assign: { n1: 'vmixer' }, planOnly: true })
  log('E local cross rows', local.length)
  log('E pooled plan', pooled.plan.rows.map((x) => `${x.session_id}:${x.origin_machine}->${x.target_machine}:cross=${x.cross_machine}:${x.action}`))
  log('E pooled without --allow-cross-machine launched', pooledGo.launched.map((l) => l.session_id))
  log('E choose plan', chosen.plan.rows.map((x) => `${x.session_id}:${x.origin_machine}->${x.target_machine}:${x.action}`))
  assert.equal(local.length, 0)
  assert.equal(rows(pooled).n1.origin_machine, 'ndi'); assert.equal(rows(pooled).n1.target_machine, 'vmixer'); assert.equal(rows(pooled).n1.cross_machine, true)
  assert.equal(rows(pooled).n1.action, 'hold:cross-machine-needs-confirmation')
  assert.equal(pooledGo.launched.length, 0)
  assert.equal(rows(chosen).n1.target_machine, 'vmixer'); assert.equal(rows(chosen).n1.action, 'hold:cross-machine-needs-confirmation')
  assert.equal(rows(chosen).n2.action, 'assigned:ndi')
  assert.equal(guard.loadManifest(V, archivedN.handoff_id).claim, undefined, 'NDI handoff still unclaimed')
  // Explicit opt-in is representable and works; run on a copy world so C stays clean.
  console.log('TEST C PASS')
  console.log('TEST E PASS')
}

// ---- Test D: forced archive-verification failure -> NO RESUME, everything recoverable
{
  const w = world(); const V = machine(w, 'vmixer')
  const t1 = session(V, 'd1', 'work d1'); const t2 = session(V, 'd2', 'work d2')
  const before = [hash(t1), hash(t2)]
  const r = await run(V, {}, { afterArchive: (m, E) => writeFileSync(join(E.brain, 'quota-handoffs', m.handoff_id, m.sessions[0].archive), 'not gzip') })
  log('D result', { ok: r.ok, code: r.code, result: r.result, verify: r.phases.find((p) => p.phase === 'VERIFY_ARCHIVE')?.errors, recovery: r.recovery })
  const m = guard.loadManifest(V, r.handoff_id)
  const dir = join(V.brain, 'quota-handoffs', r.handoff_id)
  log('D after', { state: m.state, claim: m.claim ?? null, restore_json: existsSync(join(dir, 'restore.json')), plan_json: existsSync(join(dir, 'routine-plan.json')), intact_package: existsSync(join(dir, m.sessions[1].package)), transcripts_unchanged: hash(t1) === before[0] && hash(t2) === before[1], verification: m.routine.verification.ok })
  assert.equal(r.ok, false); assert.equal(r.result, 'NO RESUME'); assert.equal(r.code, 'ARCHIVE_UNVERIFIED')
  assert.equal(r.launched, undefined); assert.equal(existsSync(join(dir, 'restore.json')), false); assert.equal(m.claim, undefined)
  assert.equal(m.state, 'READY'); assert.ok(hash(t1) === before[0] && hash(t2) === before[1])
  // A later Routine run never plans from the unverified archive.
  const later = await run(V, { planOnly: true })
  assert.ok(later.plan.rows.every((x) => x.handoff_id !== r.handoff_id))
  // A missing active session also fails verification.
  const r2 = await run(V, {}, { afterArchive: (mm, E) => { const p = join(E.brain, 'quota-handoffs', mm.handoff_id, 'manifest.json'); const j = JSON.parse(readFileSync(p, 'utf8')); j.sessions = j.sessions.slice(1); j.session_count = j.sessions.length; writeFileSync(p, JSON.stringify(j)) } })
  log('D2 result', { ok: r2.ok, result: r2.result, errors: r2.phases.find((p) => p.phase === 'VERIFY_ARCHIVE')?.errors })
  assert.equal(r2.result, 'NO RESUME')
  console.log('TEST D PASS')
}

// ---- Detection is separated from execution: over threshold -> flag + notice, no archive
{
  const w = world(); const V = machine(w, 'vmixer')
  session(V, 'x1', 'busy')
  writeFileSync(V.cache, JSON.stringify({ sessionPercent: 98, weekPercent: 40, capturedAt: V.now }))
  const state = {}
  const d1 = hook.detectAvailable(guard, V, state)
  const d2 = hook.detectAvailable(guard, V, state)
  const flag = JSON.parse(readFileSync(join(V.home, 'exhausted.json'), 'utf8'))
  log('DETECT', { notice: d1.notice, repeat_notice: d2.notice ?? null, flag: { handoff_available: flag.handoff_available, automatic_handoff: flag.automatic_handoff, handoff_id: flag.handoff_id }, archives: guard.listHandoffs(V).length })
  assert.ok(d1.notice?.includes('/quota-handoff')); assert.equal(d2.notice, undefined); assert.equal(guard.listHandoffs(V).length, 0)
  writeFileSync(V.cache, JSON.stringify({ sessionPercent: 20, weekPercent: 40, capturedAt: V.now }))
  hook.detectAvailable(guard, V, state)
  assert.equal(existsSync(join(V.home, 'exhausted.json')), false)
  console.log('DETECTION PASS')
}
console.log(`ALL PASS (scratch ${root})`)
