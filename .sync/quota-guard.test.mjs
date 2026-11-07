// Tests for quota-guard.mjs (Automatic Quota Handoff). Run: node --test .sync/quota-guard.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import {
  assess, buildHandoff, check, claim, env, listHandoffs, loadManifest, readQuota, redact, release, resume,
  simulate, statusText, transition, touchSession, activeSessions,
  desktopSessions, markRestored, markSettingsApplied, settingsPlan, LAUNCHERS,
} from './quota-guard.mjs'

const NOW = Date.parse('2026-09-26T12:00:00Z')
const FAKE_KEY = 'sk-ant-api03-' + 'A'.repeat(40)

/** A sandbox: brain, two accounts' config dirs and guard homes. Nothing touches the real ~/.claude. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'qg-'))
  const brain = join(root, 'brain')
  mkdirSync(brain)
  const make = (name, extra = {}) => env({
    QUOTA_GUARD_BRAIN: brain,
    QUOTA_GUARD_HOME: join(root, `${name}-guard`),
    QUOTA_GUARD_CONFIG_DIR: join(root, `${name}-config`),
    QUOTA_GUARD_CACHE: join(root, `${name}-cache.json`),
    QUOTA_GUARD_DESKTOP_DIR: join(root, `${name}-desktop`),
    QUOTA_GUARD_ACCOUNT: `claude:${name}@test`,
    QUOTA_GUARD_HOST: 'testhost',
    QUOTA_GUARD_USER: name,
    QUOTA_GUARD_NOW: String(NOW),
    QUOTA_GUARD_DEV: '0',
    QUOTA_GUARD_THRESHOLD: '',
    ...extra,
  })
  return { root, brain, make }
}

function setQuota(E, session, weekly) {
  writeFileSync(E.cache, JSON.stringify({ sessionPercent: session, weekPercent: weekly, sessionResets: 'Sep 26, 4:40pm', weekResets: 'Sep 30, 11am', capturedAt: NOW - 60_000 }))
}

function addSession(E, id, { cwd = E.home, prompt = 'Build the widget', extra = [] } = {}) {
  const dir = join(E.configDir, 'projects', 'proj')
  mkdirSync(dir, { recursive: true })
  const lines = [
    { type: 'user', cwd, gitBranch: 'main', timestamp: '2026-09-26T11:00:00Z', message: { role: 'user', content: prompt } },
    { type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [
      { type: 'text', text: `Working on it. key ${FAKE_KEY}` },
      { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/src/widget.js', old_string: 'a', new_string: 'b' } },
      { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/repo/.env' } },
      { type: 'tool_use', id: 't3', name: 'TodoWrite', input: { todos: [{ content: 'write widget', status: 'completed' }, { content: 'add tests', status: 'in_progress' }] } },
    ] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'DATABASE_URL=postgres://u:hunter2secret@db/x' }] }, toolUseResult: { file: { filePath: '/repo/.env', content: 'DATABASE_URL=postgres://u:hunter2secret@db/x' } } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'String not found' }] } },
    ...extra,
  ]
  const path = join(dir, `${id}.jsonl`)
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'))
  utimesSync(path, new Date(NOW - 60_000), new Date(NOW - 60_000))
  return path
}

const recorder = () => {
  const calls = []
  const fn = (_E, args) => { calls.push(args); return { ok: true, detail: `fake ${args.session.source_session_id}` } }
  return { calls, fn }
}

test('96.9% session / 50% weekly -> no handoff', () => {
  const { make } = sandbox(); const E = make('a')
  setQuota(E, 96.9, 50); addSession(E, 's1')
  assert.equal(check(E).action, 'none')
  assert.equal(listHandoffs(E).length, 0)
})

test('97.0% session -> handoff', () => {
  const { make } = sandbox(); const E = make('a')
  setQuota(E, 97.0, 10); addSession(E, 's1')
  const r = check(E)
  assert.equal(r.action, 'created')
  assert.equal(loadManifest(E, r.handoff_id).state, 'READY')
  assert.match(loadManifest(E, r.handoff_id).reason, /Session usage 97%/)
})

test('50% session / 97.0% weekly -> handoff', () => {
  const { make } = sandbox(); const E = make('a')
  setQuota(E, 50, 97.0); addSession(E, 's1')
  const r = check(E)
  assert.equal(r.action, 'created')
  assert.match(loadManifest(E, r.handoff_id).reason, /Weekly usage 97%/)
})

test('97% both -> exactly one handoff', () => {
  const { make } = sandbox(); const E = make('a')
  setQuota(E, 97, 97); addSession(E, 's1')
  assert.equal(check(E).action, 'created')
  assert.equal(listHandoffs(E).length, 1)
})

test('repeated >=97 checks, including a later second window crossing -> no duplicate', () => {
  const { make } = sandbox(); const E = make('a')
  setQuota(E, 97.5, 40); addSession(E, 's1')
  const first = check(E)
  for (let i = 0; i < 5; i++) assert.equal(check(E).action, 'exists')
  setQuota(E, 99, 98)
  assert.equal(check(E).handoff_id, first.handoff_id)
  assert.equal(listHandoffs(E).length, 1)
  // Quota falls back under threshold (window reset): the event closes, a new crossing is a new event.
  setQuota(E, 5, 40); assert.equal(check(E).action, 'none')
  setQuota(E, 97, 40); assert.equal(check(E).action, 'created')
  assert.equal(listHandoffs(E).length, 2)
})

test('threshold is configurable, default exactly 97', () => {
  const { make } = sandbox()
  assert.equal(make('a').threshold, 97)
  const E = make('b', { QUOTA_GUARD_THRESHOLD: '90' })
  setQuota(E, 91, 0)
  assert.equal(assess(readQuota(E), E.threshold).window, 'session')
})

test('quota unavailable -> UNKNOWN, no fabricated percentage, no handoff', () => {
  const { make } = sandbox(); const E = make('a'); addSession(E, 's1')
  const r = readQuota(E)
  assert.equal(r.state, 'UNKNOWN')
  assert.equal(r.session_used_percent, null)
  assert.equal(r.weekly_used_percent, null)
  assert.equal(check(E).action, 'none')
  assert.match(statusText(E), /Session: UNKNOWN/)
  // Figures from a window that already reset say nothing about the new one.
  writeFileSync(E.cache, JSON.stringify({ sessionPercent: 99, sessionResets: 'Sep 26, 1am', capturedAt: NOW - 3_600_000 * 20 }))
  assert.equal(readQuota(E).state, 'UNKNOWN')
})

test('zero active sessions -> valid empty notification handoff', () => {
  const { make } = sandbox(); const E = make('a')
  setQuota(E, 98, 0)
  const r = check(E)
  const m = loadManifest(E, r.handoff_id)
  assert.equal(m.state, 'READY')
  assert.equal(m.sessions.length, 0)
  assert.match(m.notice, /No active sessions/)
})

test('multiple active sessions -> all represented; stale and other-account sessions excluded', () => {
  const { make } = sandbox(); const E = make('a'); const B = make('b')
  setQuota(E, 98, 0)
  addSession(E, 's1'); addSession(E, 's2'); addSession(E, 's3')
  const old = addSession(E, 'stale'); utimesSync(old, new Date(NOW - 7_200_000), new Date(NOW - 7_200_000))
  addSession(B, 'other-account')
  const m = loadManifest(E, check(E).handoff_id)
  assert.deepEqual(m.sessions.map((s) => s.source_session_id), ['s1', 's2', 's3'])
  for (const s of m.sessions) assert.ok(existsSync(join(E.brain, 'quota-handoffs', m.handoff_id, s.package)))
})

test('session registry from the hook is honoured', () => {
  const { make } = sandbox(); const E = make('a')
  const path = addSession(E, 'reg1'); utimesSync(path, new Date(NOW - 7_200_000), new Date(NOW - 7_200_000))
  touchSession(E, { sessionId: 'reg1', transcriptPath: path, cwd: E.home })
  assert.deepEqual(activeSessions(E).map((s) => s.sessionId), ['reg1'])
})

test('snapshot failure -> bundle never becomes READY, retry succeeds under the same id', () => {
  const { make } = sandbox(); const E = make('a')
  setQuota(E, 98, 0); addSession(E, 's1'); addSession(E, 's2')
  const r = check(E, { hooks: { beforeSession: (_s, i) => { if (i === 1) throw new Error('disk full') } } })
  assert.equal(r.action, 'failed')
  const m = loadManifest(E, r.handoff_id)
  assert.equal(m.state, 'FAILED'); assert.equal(m.retryable, true)
  assert.ok(!m.history.some((h) => h.to === 'READY'))
  assert.equal(listHandoffs(E).filter((h) => h.state === 'READY').length, 0)
  const again = check(E)
  assert.equal(again.action, 'created'); assert.equal(again.handoff_id, r.handoff_id)
  assert.equal(loadManifest(E, r.handoff_id).sessions.length, 2)
})

test('power loss before publish -> nothing READY is visible, next check retries', () => {
  const { make } = sandbox(); const E = make('a')
  setQuota(E, 98, 0); addSession(E, 's1')
  // What a process killed mid-snapshot leaves: PREPARING in the guard state and a .partial bundle.
  const id = 'H-20260926-testhost-007'
  mkdirSync(join(E.home), { recursive: true })
  writeFileSync(join(E.home, 'state.json'), JSON.stringify({ events: { 'claude:a@test|REAL': { handoff_id: id, state: 'PREPARING', attempts: 1 } } }))
  mkdirSync(join(E.brain, 'quota-handoffs', `${id}.partial`, 'sessions'), { recursive: true })
  writeFileSync(join(E.brain, 'quota-handoffs', `${id}.partial`, 'manifest.json'), JSON.stringify({ handoff_id: id, state: 'SNAPSHOTTING', created_at: 'x', sessions: [] }))
  assert.equal(listHandoffs(E).length, 0)
  const r = check(E)
  assert.equal(r.action, 'created'); assert.equal(r.handoff_id, id)
  assert.equal(loadManifest(E, id).state, 'READY')
  assert.ok(!existsSync(join(E.brain, 'quota-handoffs', `${id}.partial`)))
})

test('illegal transitions are refused', () => {
  const m = { state: 'READY' }
  assert.throws(() => transition(m, 'ACTIVE', 'x', NOW), /illegal/)
  assert.throws(() => transition({ state: 'NORMAL' }, 'READY', 'x', NOW), /illegal/)
})

test('successful claim -> only one receiver owns; simultaneous claim rejected safely', () => {
  const { make } = sandbox(); const A = make('a'); const B = make('b'); const C = make('c')
  setQuota(A, 98, 0); addSession(A, 's1')
  const id = check(A).handoff_id
  const first = claim(B, id, 'b@test')
  const second = claim(C, id, 'c@test')
  assert.equal(first.ok, true)
  assert.equal(second.ok, false); assert.equal(second.code, 'CLAIMED_BY_OTHER'); assert.equal(second.owner, 'b@test')
  assert.equal(loadManifest(A, id).state, 'CLAIMED')
  assert.equal(resume(C, { id, receiver: 'c@test', launcher: recorder().fn }).code, 'CLAIMED_BY_OTHER')
  // Admin release returns it to READY for another receiver.
  assert.equal(release(A, id, 'admin').ok, true)
  assert.equal(loadManifest(A, id).state, 'READY')
  assert.equal(claim(C, id, 'c@test').ok, true)
})

test('receiver already has sessions -> they are archived first', () => {
  const { make } = sandbox(); const A = make('a'); const B = make('b')
  setQuota(A, 98, 0); addSession(A, 's1')
  check(A)
  addSession(B, 'b-own-1'); addSession(B, 'b-own-2')
  const rec = recorder()
  const r = resume(B, { receiver: 'b@test', launcher: rec.fn })
  assert.equal(r.ok, true)
  const p = loadManifest(B, r.preserved.handoff_id)
  assert.equal(p.kind, 'preserve')
  assert.deepEqual(p.sessions.map((s) => s.source_session_id), ['b-own-1', 'b-own-2'])
  // The preserve archive is written before the claim.
  assert.ok(Date.parse(p.created_at) <= Date.parse(loadManifest(A, r.handoff_id).claim.claimed_at))
  // A preserve archive is never offered as an incoming handoff.
  assert.equal(listHandoffs(B).filter((h) => h.kind === 'quota').length, 1)
})

test('multiple source sessions -> one replacement per source session; successful restore -> ACTIVE', () => {
  const { make } = sandbox(); const A = make('a'); const B = make('b')
  setQuota(A, 98, 0); addSession(A, 's1'); addSession(A, 's2'); addSession(A, 's3')
  check(A)
  const rec = recorder()
  const r = resume(B, { receiver: 'b@test', launcher: rec.fn })
  assert.equal(r.state, 'ACTIVE')
  assert.deepEqual(rec.calls.map((c) => c.session.source_session_id), ['s1', 's2', 's3'])
  // Each replacement gets its own package, not one combined prompt.
  for (const c of rec.calls) {
    assert.match(c.prompt, new RegExp(`source session ${c.session.source_session_id}`))
    assert.equal((c.prompt.match(/# Continuation/g) ?? []).length, 1)
  }
  const states = loadManifest(A, r.handoff_id).history.map((h) => h.to)
  assert.deepEqual(states, ['PREPARING', 'SNAPSHOTTING', 'READY', 'CLAIMED', 'RESTORING', 'ACTIVE'])
  assert.match(statusText(B), /HANDOFF COMPLETE[\s\S]*Receiver sessions launched: 3/)
  // Re-running after success launches nothing new.
  resume(B, { id: r.handoff_id, receiver: 'b@test', launcher: rec.fn })
  assert.equal(rec.calls.length, 3)
})

test('restore interruption -> resumable restoration without duplicates', () => {
  const { make } = sandbox(); const A = make('a'); const B = make('b')
  setQuota(A, 98, 0); addSession(A, 's1'); addSession(A, 's2'); addSession(A, 's3'); addSession(A, 's4')
  const id = check(A).handoff_id
  // Launch 1 fails retryably, then the receiver "exits" (throws) after marking session 3 LAUNCHING.
  let n = 0
  const flaky = (_E, args) => { n++; return args.session.source_session_id === 's2' ? { ok: false, detail: 'launch failed' } : { ok: true } }
  assert.throws(() => resume(B, { id, receiver: 'b@test', launcher: flaky, hooks: { afterMark: (s) => { if (s.source_session_id === 's3') throw new Error('receiver exited') } } }))
  let restore = loadManifest(A, id).restore.sessions
  assert.equal(restore.s1.state, 'RESTORED'); assert.equal(restore.s2.state, 'FAILED_RETRYABLE'); assert.equal(restore.s3.state, 'LAUNCHING')
  assert.equal(restore.s4, undefined)
  assert.equal(loadManifest(A, id).state, 'RESTORING')
  // Re-run: s1 untouched, s2 retried, s3 uncertain (might have launched) is not relaunched blindly, s4 launched.
  const rec = recorder()
  const r2 = resume(B, { id, receiver: 'b@test', launcher: rec.fn })
  assert.deepEqual(rec.calls.map((c) => c.session.source_session_id), ['s2', 's4'])
  assert.equal(r2.sessions.s3, 'UNCERTAIN'); assert.equal(r2.state, 'RESTORING')
  // An explicit retry of the uncertain one completes the handoff.
  const r3 = resume(B, { id, receiver: 'b@test', launcher: rec.fn, retryUncertain: true })
  assert.deepEqual(rec.calls.map((c) => c.session.source_session_id), ['s2', 's4', 's3'])
  assert.equal(r3.state, 'ACTIVE')
  restore = loadManifest(A, id).restore.sessions
  assert.ok(Object.values(restore).every((s) => s.state === 'RESTORED'))
})

test('secrets and auth tokens are excluded or redacted everywhere', () => {
  const { make } = sandbox(); const A = make('a')
  setQuota(A, 98, 0); addSession(A, 's1', { prompt: `use token=${'x'.repeat(20)} and Authorization: Bearer abcdefghijklmnop1234` })
  // Credential files that sit in the config dir are never read.
  writeFileSync(join(A.configDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'OAUTH-SECRET-VALUE-123456' } }))
  const id = check(A).handoff_id
  const dir = join(A.brain, 'quota-handoffs', id)
  const all = []
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else all.push(f.name.endsWith('.gz') ? gunzipSync(readFileSync(p)).toString() : readFileSync(p, 'utf8')) } }
  walk(dir)
  const text = all.join('\n')
  for (const secret of [FAKE_KEY, 'hunter2secret', 'OAUTH-SECRET-VALUE', 'x'.repeat(20), 'abcdefghijklmnop1234']) assert.ok(!text.includes(secret), `leaked ${secret}`)
  assert.ok(text.includes('<redacted>'))
  assert.ok(!/credentials\.json/.test(text))
  assert.equal(redact(redact(`key ${FAKE_KEY}`)), 'key <redacted>')
})

test('full transcript archived but not injected into the replacement session', () => {
  const { make } = sandbox(); const A = make('a'); const B = make('b')
  const filler = Array.from({ length: 200 }, (_, i) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `MIDDLE-OF-TRANSCRIPT-${i} ${'lorem '.repeat(50)}` }] } }))
  setQuota(A, 98, 0); addSession(A, 's1', { extra: [...filler, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Final status: tests pass.' }] } }] })
  check(A)
  const rec = recorder()
  const r = resume(B, { receiver: 'b@test', launcher: rec.fn })
  const prompt = rec.calls[0].prompt
  assert.ok(!prompt.includes('MIDDLE-OF-TRANSCRIPT-10'))
  assert.match(prompt, /Final status: tests pass/)
  assert.match(prompt, /Do NOT load it by default/)
  assert.ok(prompt.length < 8000, `resume prompt is ${prompt.length} chars`)
  const archive = gunzipSync(readFileSync(join(A.brain, 'quota-handoffs', r.handoff_id, 'archive', 's1.jsonl.gz'))).toString()
  assert.ok(archive.includes('MIDDLE-OF-TRANSCRIPT-10'))
  assert.equal(archive.split('\n').length, 205)
})

test('continuation package carries the required fields', () => {
  const { make } = sandbox(); const A = make('a')
  setQuota(A, 98, 0); addSession(A, 's1')
  const id = check(A).handoff_id
  const pkg = JSON.parse(readFileSync(join(A.brain, 'quota-handoffs', id, 'sessions', 's1', 'continuation.json'), 'utf8'))
  for (const k of ['handoff_id', 'source_user', 'source_machine', 'source_session_id', 'provider', 'model', 'project', 'repository', 'working_directory', 'branch', 'git_head', 'task_objective', 'current_status', 'completed_work', 'pending_work', 'next_recommended_action', 'important_decisions', 'relevant_files', 'running_tasks', 'dependencies', 'errors_blockers', 'last_meaningful_session_state', 'created_at']) assert.ok(k in pkg, k)
  assert.equal(pkg.model, 'claude-opus-5-5')
  assert.deepEqual(pkg.completed_work, ['write widget'])
  assert.equal(pkg.next_recommended_action, 'add tests')
  assert.ok(pkg.relevant_files.includes('/repo/src/widget.js'))
  assert.ok(!pkg.relevant_files.some((f) => f.includes('.env')))
})

test('simulation: refused without dev mode, clearly marked with it', () => {
  const { make } = sandbox()
  assert.throws(() => simulate(make('a'), { session: 97.2, weekly: 40 }), /QUOTA_GUARD_DEV=1/)
  const E = make('a', { QUOTA_GUARD_DEV: '1' })
  simulate(E, { session: 97.2, weekly: 40 }); addSession(E, 's1')
  const q = readQuota(E)
  assert.equal(q.simulated, true); assert.equal(q.measurement_source, 'SIMULATED')
  const r = check(E)
  assert.match(r.handoff_id, /^SIM-H-/)
  const m = loadManifest(E, r.handoff_id)
  assert.equal(m.simulated, true); assert.match(m.warning, /SIMULATED/)
  assert.match(statusText(E), /SIMULATED READING - NOT REAL TELEMETRY/)
  // A production reader (dev off) neither sees the simulated reading nor lists the simulated handoff.
  const prod = make('a')
  assert.equal(readQuota(prod).simulated, false)
  assert.equal(listHandoffs(prod).length, 0)
  assert.equal(resume(make('b'), { id: r.handoff_id, receiver: 'b@test', launcher: recorder().fn }).code, 'SIMULATED_REQUIRES_DEV')
})

test('exhausted flag for DSH routing is set at the trigger and cleared when quota drops', () => {
  const { make } = sandbox(); const E = make('a')
  setQuota(E, 97, 0)
  check(E)
  const flag = JSON.parse(readFileSync(join(E.home, 'exhausted.json'), 'utf8'))
  assert.equal(flag.account, 'claude:a@test'); assert.equal(flag.simulated, false); assert.ok(flag.handoff_id)
  setQuota(E, 3, 10); check(E)
  assert.ok(!existsSync(join(E.home, 'exhausted.json')))
})

test('the exhausted account cannot resume its own handoff', () => {
  const { make } = sandbox(); const A = make('a')
  setQuota(A, 98, 0); addSession(A, 's1')
  const id = check(A).handoff_id
  assert.equal(resume(A, { id, receiver: 'a@test', launcher: recorder().fn }).code, 'SAME_ACCOUNT')
  assert.equal(resume(A, { receiver: 'a@test', launcher: recorder().fn }).code, 'NO_READY_HANDOFF')
})

test('handoff notes written through a shell and the host resume pointer are linked', () => {
  const { make } = sandbox(); const A = make('a')
  writeFileSync(join(A.brain, 'resume-testhost.md'), 'Handoff: handoff-2026-09-26-1200-widget.md\nSession: s1\nNext: run the widget tests\n')
  setQuota(A, 98, 0)
  addSession(A, 's1', { extra: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'cat > handoff-2026-09-26-1100-older.md <<EOF' } }] } }] })
  addSession(A, 's2')
  const id = check(A).handoff_id
  const read = (s) => JSON.parse(readFileSync(join(A.brain, 'quota-handoffs', id, 'sessions', s, 'continuation.json'), 'utf8'))
  assert.deepEqual(read('s1').important_decisions.sort(), ['See handoff note shared-brain/handoff-2026-09-26-1100-older.md', 'See handoff note shared-brain/handoff-2026-09-26-1200-widget.md'])
  // s1 has an in-progress todo, which wins; the pointer names s1 only, so s2 gets nothing from it.
  assert.equal(read('s1').next_recommended_action, 'add tests')
  assert.deepEqual(read('s2').important_decisions, [])
})

// ---------------------------------------------------------------- v2: in-app receiver

/** A desktop app record for one CLI session, as the Claude app writes it. */
function addDesktop(E, cli, fields = {}, acct = 'acct-a') {
  const dir = join(E.desktopDir, acct, 'org-1')
  mkdirSync(dir, { recursive: true })
  const local = fields.local ?? `local_${cli}`
  writeFileSync(join(dir, `${local}.json`), JSON.stringify({ sessionId: local, cliSessionId: cli, isArchived: false, cwd: E.home, ...fields }))
  return local
}

test('v2: account identity comes from the signed-in login, not the config dir name', () => {
  const { root } = sandbox()
  const base = { QUOTA_GUARD_CONFIG_DIR: join(root, 'cfg', '.claude'), QUOTA_GUARD_HOST: 'h', QUOTA_GUARD_HOME: join(root, 'g') }
  const one = env({ ...base, QUOTA_GUARD_ACCOUNT_UUID: '11111111-aaaa' })
  const two = env({ ...base, QUOTA_GUARD_ACCOUNT_UUID: '22222222-bbbb' })
  assert.notEqual(one.account, two.account)
  assert.equal(one.account, 'claude:.claude:11111111@h')
  mkdirSync(base.QUOTA_GUARD_CONFIG_DIR, { recursive: true })
  writeFileSync(join(base.QUOTA_GUARD_CONFIG_DIR, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: '33333333-cccc-dddd' } }))
  assert.equal(env(base).account, 'claude:.claude:33333333@h')
})

test('v2: snapshot records each session\'s title, model, effort and permission mode', () => {
  const { make } = sandbox(); const A = make('a')
  setQuota(A, 98, 0)
  addSession(A, 's1', { extra: [{ type: 'custom-title', customTitle: 'Transcript title', sessionId: 's1' }, { type: 'user', permissionMode: 'acceptEdits', message: { role: 'user', content: 'go on' } }] })
  addSession(A, 's2', { extra: [{ type: 'custom-title', customTitle: 'Only in transcript', sessionId: 's2' }, { type: 'assistant', effort: 'high', message: { role: 'assistant', content: 'ok' } }] })
  addDesktop(A, 's1', { title: 'Desktop title', model: 'claude-opus-5-5[1m]', effort: 'xhigh', permissionMode: 'auto' })
  const m = loadManifest(A, check(A).handoff_id)
  const by = Object.fromEntries(m.sessions.map((s) => [s.source_session_id, s.settings]))
  assert.deepEqual(by.s1, { title: 'Desktop title', model: 'claude-opus-5-5[1m]', effort: 'xhigh', permission_mode: 'auto', desktop_session_id: 'local_s1', desktop_account: 'acct-a' })
  assert.equal(by.s2.title, 'Only in transcript'); assert.equal(by.s2.model, 'claude-opus-5-5'); assert.equal(by.s2.effort, 'high')
  const md = readFileSync(join(A.brain, 'quota-handoffs', m.handoff_id, m.sessions[0].package), 'utf8')
  assert.match(md, /Session settings: title "Desktop title", model claude-opus-5-5\[1m\], effort xhigh, permission auto/)
})

test('v2: chips launcher offers one chip per session; hook confirmations take it to ACTIVE', () => {
  const { make } = sandbox(); const A = make('a'); const B = make('b')
  setQuota(A, 98, 0); addSession(A, 's1'); addSession(A, 's2')
  addDesktop(A, 's1', { title: 'Build widget', model: 'claude-opus-5-5', effort: 'high', permissionMode: 'auto' })
  const id = check(A).handoff_id
  const r = resume(B, { receiver: 'b@test', launcher: 'chips' })
  assert.equal(r.ok, true); assert.equal(r.state, 'RESTORING')
  assert.deepEqual(r.sessions, { s1: 'OFFERED', s2: 'OFFERED' })
  assert.equal(r.chips.length, 2)
  assert.equal(r.chips[0].title, 'Build widget')
  assert.match(r.chips[0].prompt, new RegExp(`^Resume quota handoff ${id}, source session s1\\. Read .+ and continue`))
  assert.ok(r.chips.every((c) => c.cwd && c.tldr))
  // A re-run posts no second set of chips.
  const again = resume(B, { id, receiver: 'b@test', launcher: 'chips' })
  assert.equal(again.chips, undefined)
  assert.match(statusText(B), /2 chip\(s\) offered, not yet started/)
  // Only the claiming account may confirm.
  assert.equal(markRestored(A, id, 's1', { sessionId: 'x' }).code, 'CLAIMED_BY_OTHER')
  assert.equal(markRestored(B, id, 'nope', { sessionId: 'x' }).code, 'UNKNOWN_SOURCE_SESSION')
  assert.equal(markRestored(B, id, 's1', { sessionId: 'new-1' }).state, 'RESTORING')
  // A second session from the same chip does not steal the row.
  assert.equal(markRestored(B, id, 's1', { sessionId: 'new-dup' }).already, true)
  assert.equal(markRestored(B, id, 's2', { sessionId: 'new-2' }).state, 'ACTIVE')
  const rs = loadManifest(A, id).restore.sessions
  assert.equal(rs.s1.receiver_session_id, 'new-1'); assert.equal(rs.s2.receiver_session_id, 'new-2')
})

test('v2: settings plan lists only what differs, per desktop session, and records applied rows', () => {
  const { make } = sandbox(); const A = make('a'); const B = make('b')
  setQuota(A, 98, 0); addSession(A, 's1')
  addDesktop(A, 's1', { title: 'Build widget', model: 'claude-opus-5-5[1m]', effort: 'xhigh', permissionMode: 'acceptEdits' })
  const id = check(A).handoff_id
  resume(B, { receiver: 'b@test', launcher: 'chips' })
  let plan = settingsPlan(B, id)
  assert.equal(plan.sessions[0].state, 'OFFERED'); assert.equal(plan.sessions[0].desktop_session_id, null)
  markRestored(B, id, 's1', { sessionId: 'new-1' })
  addDesktop(B, 'new-1', { local: 'local_B1', title: 'Build widget', model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'auto' }, 'acct-b')
  plan = settingsPlan(B, id)
  assert.equal(plan.sessions[0].desktop_session_id, 'local_B1')
  assert.deepEqual(plan.sessions[0].change, { model: 'claude-opus-5-5[1m]', effort: 'xhigh', permission_mode: 'acceptEdits' })
  assert.equal(plan.sessions[0].applied, false)
  assert.equal(markSettingsApplied(B, id, 's1').ok, true)
  assert.equal(settingsPlan(B, id).sessions[0].applied, true)
})

test('v2: the resuming session itself is not preserved as receiver work', () => {
  const { make } = sandbox(); const A = make('a'); const B = make('b')
  setQuota(A, 98, 0); addSession(A, 's1')
  const id = check(A).handoff_id
  addSession(B, 'b-own'); addSession(B, 'b-resumer')
  mkdirSync(join(B.home, 'resumers'), { recursive: true })
  writeFileSync(join(B.home, 'resumers', `${id}.json`), JSON.stringify({ sessionId: 'b-resumer' }))
  const r = resume(B, { receiver: 'b@test', launcher: 'chips' })
  assert.deepEqual(loadManifest(B, r.preserved.handoff_id).sessions.map((s) => s.source_session_id), ['b-own'])
})

test('v2: desktop records are read only for this login when its uuid is known', () => {
  const { make } = sandbox(); const A = make('a', { QUOTA_GUARD_ACCOUNT_UUID: 'acct-a' })
  addDesktop(A, 'mine', {}, 'acct-a'); addDesktop(A, 'theirs', {}, 'acct-z')
  assert.deepEqual([...desktopSessions(A).keys()], ['mine'])
})

test('v2: the same login on another machine cannot receive its own handoff', () => {
  const { make } = sandbox()
  const A = make('a', { QUOTA_GUARD_ACCOUNT_UUID: 'same-login', QUOTA_GUARD_ACCOUNT: '' })
  const B = make('b', { QUOTA_GUARD_ACCOUNT_UUID: 'same-login', QUOTA_GUARD_ACCOUNT: '', QUOTA_GUARD_HOST: 'otherhost' })
  A.account = 'claude:.claude:same-log@testhost'; B.account = 'claude:.claude:same-log@otherhost'
  setQuota(A, 98, 0); addSession(A, 's1')
  const id = check(A).handoff_id
  assert.equal(resume(B, { id, receiver: 'b@test', launcher: 'chips' }).code, 'SAME_ACCOUNT')
  assert.equal(resume(B, { receiver: 'b@test', launcher: 'chips' }).code, 'NO_READY_HANDOFF')
  const C = make('c', { QUOTA_GUARD_ACCOUNT_UUID: 'other-login' })
  assert.equal(resume(C, { receiver: 'c@test', launcher: 'chips' }).ok, true)
})
