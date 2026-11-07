import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from './store.mjs'
import { compileBrief, storeBrief, applicableRules } from './brief.mjs'

const A = { actor: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5' }

test('brief: compact, from pm state only, history excluded, stored as brief artifact', () => {
  const s = openStore(':memory:')
  s.createProject(A, { name: 'demo' })
  const t = s.createTask(A, { project: 'demo', title: 'T', body: 'obj', next_action: 'do x', checkpoint: 'cp1', blockers: ['need key'] })
  s.addArtifact(A, t.id, { kind: 'evidence', ref: 'tests', note: '5 pass 0 fail' })
  s.addComment(A, t.id, { body: 'SECRET-HISTORY-COMMENT' })
  const text = compileBrief(s.getTask(t.id))
  for (const k of ['obj', 'do x', 'cp1', 'need key', '5 pass 0 fail', 'pm_get_task']) assert.ok(text.includes(k), k)
  assert.ok(!text.includes('SECRET-HISTORY-COMMENT'))
  const r = storeBrief(s, A, t.id)
  const arts = s.getTask(t.id).artifacts.filter((a) => a.kind === 'brief')
  assert.equal(arts.length, 1)
  assert.equal(arts[0].note, r.text)
  assert.ok(!compileBrief(s.getTask(t.id)).includes('brief:resume-brief'))
})

test('brief: rules list is small and tolerates a missing file', () => {
  assert.ok(applicableRules().length <= 5)
  assert.deepEqual(applicableRules('/nonexistent/x.md'), [])
})
