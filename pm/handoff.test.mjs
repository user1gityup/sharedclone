// node --test handoff.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as H from './handoff.mjs'

const NOTE = (o = {}) => `---
name: handoff-x
description: d
type: project
---
Handoff id: ${o.id ?? 'handoff-2026-11-01-1200-x'}
State: ${o.state ?? 'ready'}
Time: 2026-11-01 12:00Z
Host: ${o.host ?? 'ndi2'}
Session: local_1
Model: Claude Opus 5.5
Repo: ~/r branch b
Owner: Claude Opus 5.5
Ask: do x
Verified: tests 5/0
Partial: none
Processes/ports: none
Permissions: none
Remote Control: ${o.rc ?? 'off'}
Open questions: none
Next: do y
Verification: node --test
Do not repeat: z
`

test('thresholds: none / checkpoint / finalize / stop-all', () => {
  assert.equal(H.checkpointAction({ contextTokens: 99_999, hours: 3.9, quotaPct: 94 }).tier, 'none')
  const c = H.checkpointAction({ contextTokens: 100_000 })
  assert.deepEqual([c.tier, c.writeNote, c.startNewScope], ['checkpoint', true, true])
  assert.equal(H.checkpointAction({ hours: 4 }).tier, 'checkpoint')
  assert.equal(H.checkpointAction({ quotaPcts: [10, 95] }).tier, 'checkpoint')
  for (const t of [{ providerWarning: 1 }, { compactionLoss: 1 }, { contextConfusion: 1 }]) assert.equal(H.checkpointAction(t).tier, 'checkpoint')
  for (const t of [{ contextTokens: 150_000 }, { hours: 8 }, { quotaPct: 99 }, { imminentExhaustion: 1 }]) {
    const f = H.checkpointAction(t)
    assert.deepEqual([f.tier, f.startNewScope, f.writeNote], ['finalize', false, true])
  }
  const s = H.checkpointAction({ weeklyPct: 98 })
  assert.deepEqual([s.tier, s.stopAllAgents, s.reportNotePath, s.startNewScope], ['stop-all', true, true, false])
  assert.equal(H.checkpointAction({ weeklyPct: 97.9 }).stopAllAgents, false)
})

test('valid note parses and validates', () => {
  const n = H.parseNote(NOTE())
  assert.equal(n.fields.host, 'ndi2')
  assert.equal(n.fields['remote control'], 'off')
  assert.deepEqual(H.validateNote(n), [])
})

test('missing fields, bad RC, bad state are reported', () => {
  const bad = NOTE().replace(/^Ask:.*\n/m, '').replace('Remote Control: off', 'Remote Control: maybe').replace('State: ready', 'State: wat')
  const p = H.validateNote(H.parseNote(bad))
  assert.ok(p.includes('missing field: ask'))
  assert.ok(p.includes('remote control must be on|off'))
  assert.ok(p.includes('bad state wat'))
  assert.ok(H.validateNote(H.parseNote(NOTE({ rc: 'on' }))).some((x) => /peer handle/.test(x)))
  assert.deepEqual(H.validateNote(H.parseNote(NOTE({ rc: 'on (host ndi2, session local_1, ref ab12)' }))), [])
  assert.ok(H.validateNote(H.parseNote('no frontmatter')).some((x) => /frontmatter/.test(x)))
})

test('index line and signed log entry are required', () => {
  const id = 'handoff-x'
  assert.deepEqual(H.checkRegistered({ id, index: `- [x](${id}.md)`, log: `${id} - Claude Opus 5.5`, model: 'Claude Opus 5.5' }), [])
  assert.deepEqual(H.checkRegistered({ id, index: '', log: '' }), ['no index line', 'no log entry'])
  assert.deepEqual(H.checkRegistered({ id, index: id, log: `${id} - me`, model: 'Claude Opus 5.5' }), ['log entry not signed with the model name'])
})

test('verifyRecord: clean state passes; every drift is reported, newer state wins', () => {
  const claimed = { files: ['a'], head: 'abc123', uncommitted: ['u'], processes: [{ pid: 7, port: 80 }] }
  const ok = { files: { a: true }, git: { head: 'abc123def', dirty: ['u'] }, processes: [{ pid: 7 }], logNewer: [] }
  assert.equal(H.verifyRecord(claimed, ok).ok, true)
  const r = H.verifyRecord(claimed, { files: { a: false }, git: { head: 'ffff', dirty: ['other'] }, processes: [], logNewer: ['newer entry'] })
  assert.deepEqual(r.diffs.map((d) => d.kind).sort(), ['file-missing', 'head-moved', 'newer-log', 'process-dead', 'uncommitted-gone', 'unrecorded-change'])
  assert.equal(r.authority, 'current-state')
})

test('resume on origin host with RC on: RC first, contact prior agent last', () => {
  const n = H.parseNote(NOTE({ rc: 'on (host ndi2, session local_1)' }))
  const p = H.planResume(n, { thisHost: 'vmixlaptop2x6', pmTask: { execution_machine: 'ndi2' }, priorAgentLive: true, model: 'Claude Opus 5.5' })
  assert.equal(p.crossHost, false) // alias of ndi2
  assert.deepEqual(p.steps, ['enable-remote-control', 'read-pm-task', 'claim-note', 'verify-record', 'contact-prior-agent'])
  assert.equal(p.remoteControlFirst, true)
})

test('cross-host resume is flagged; pm down falls back to note', () => {
  const n = H.parseNote(NOTE({ rc: 'on (host ndi2, session local_1)', host: 'ndi2' }))
  const p = H.planResume(n, { thisHost: 'vmixer2o2', pmTask: { execution_machine: 'ndi2' }, model: 'm' })
  assert.equal(p.crossHost, true)
  assert.ok(p.warnings.some((w) => /cross-host/.test(w)) && p.warnings.some((w) => /executes on ndi2/.test(w)))
  assert.equal(H.planResume(n, { thisHost: 'ndi2', model: 'm' }).steps[1], 'pm-unavailable-use-note')
})

test('RC cannot be enabled: warning, not silent; RC off: no channel step', () => {
  const on = H.parseNote(NOTE({ rc: 'on (host ndi2, session s)' }))
  const p = H.planResume(on, { thisHost: 'ndi2', rcCanEnable: false, model: 'm' })
  assert.ok(!p.steps.includes('enable-remote-control'))
  assert.ok(p.warnings.some((w) => /could not be enabled/.test(w)))
  const off = H.planResume(H.parseNote(NOTE()), { thisHost: 'ndi2', priorAgentLive: true, model: 'm' })
  assert.ok(!off.steps.includes('contact-prior-agent'))
  assert.ok(off.warnings.some((w) => /Remote Control off/.test(w)))
})

test('live active owner blocks claim; complete handoff refused', () => {
  assert.throws(() => H.planResume(H.parseNote(NOTE({ state: 'active' })), { thisHost: 'ndi2', priorAgentLive: true, model: 'm' }), { code: 'LIVE_OWNER' })
  assert.throws(() => H.planResume(H.parseNote(NOTE({ state: 'complete' })), { thisHost: 'ndi2', model: 'm' }), { code: 'COMPLETE' })
  assert.doesNotThrow(() => H.planResume(H.parseNote(NOTE({ state: 'active' })), { thisHost: 'ndi2', priorAgentLive: false, model: 'm' }))
})

test('claimNote sets state and keeps history', () => {
  const out = H.claimNote(NOTE({ state: 'ready' }), { model: 'Claude Sonnet 5.5', host: 'ndi2', session: 's2', at: 'T' })
  assert.match(out, /^State: claimed$/m)
  assert.match(out, /Claimed: Claude Sonnet 5.5 on ndi2 \(s2\) at T/)
  assert.match(out, /Do not repeat: z/)
})
