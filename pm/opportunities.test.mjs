// node --test opportunities.test.mjs   (run from pm/)
// T-bf6f4f2c: DSH Integration - Opportunity records + qualification evidence / staged-package
// write-back. Not run here (builder rule): pm runs the checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { openStore, PmError } from './store.mjs'
import { createOpportunityRegistry, STAGES, EVIDENCE_KINDS, PACKAGE_STATUSES } from './opportunities.mjs'

const W = { actor: 'claude-sonnet-builder', model: 'claude-sonnet-5' }
const rejects = (fn, status, re) => assert.throws(fn, (e) => e instanceof PmError && e.status === status && (!re || re.test(e.message)))

function fresh() {
  const store = openStore(':memory:')
  const db = new DatabaseSync(':memory:')
  const project = store.createProject(W, { name: 'lead-intel' })
  const reg = createOpportunityRegistry(db, { store })
  return { store, db, reg, project }
}

test('STAGES/EVIDENCE_KINDS/PACKAGE_STATUSES are the published vocabularies', () => {
  assert.deepEqual(STAGES, ['scraped', 'qualifying', 'qualified', 'staged', 'applied', 'rejected'])
  assert.deepEqual(EVIDENCE_KINDS, ['qualification', 'disqualification', 'note'])
  assert.deepEqual(PACKAGE_STATUSES, ['draft', 'ready', 'submitted'])
})

test('create: requires actor, project and title; defaults stage to scraped; rejects bad stage', () => {
  const { reg, project } = fresh()
  rejects(() => reg.create({}, { project: project.id, title: 'x' }), 400, /actor/)
  rejects(() => reg.create(W, { title: 'x' }), 400, /project is required/)
  rejects(() => reg.create(W, { project: 'P-nope', title: 'x' }), 404, /no project/)
  rejects(() => reg.create(W, { project: project.id, title: '' }), 400, /title/)
  rejects(() => reg.create(W, { project: project.id, title: 'x', stage: 'bogus' }), 400, /stage must be one of/)

  const o = reg.create(W, { project: project.id, title: 'Acme Solar RFP', payload: { url: 'https://example.com/1' } })
  assert.equal(o.stage, 'scraped')
  assert.equal(o.project_id, project.id)
  assert.deepEqual(o.payload, { url: 'https://example.com/1' })
  assert.equal(o.rev, 1)
  assert.equal(reg.get(o.id).id, o.id)
  assert.deepEqual(reg.get(o.id).evidence, [])
  assert.deepEqual(reg.get(o.id).packages, [])
})

test('create: duplicate source_ref is refused; list filters by project/stage/q', () => {
  const { reg, project } = fresh()
  reg.create(W, { project: project.id, title: 'Acme RFP', source_ref: 'scrape:acme:1' })
  rejects(() => reg.create(W, { project: project.id, title: 'Acme RFP dup', source_ref: 'scrape:acme:1' }), 409, /already exists/)

  reg.create(W, { project: project.id, title: 'Beta Solar', stage: 'qualified' })
  const all = reg.list({ project: project.id })
  assert.equal(all.length, 2)
  assert.equal(reg.list({ project: project.id, stage: 'qualified' }).length, 1)
  assert.equal(reg.list({ project: project.id, q: 'Acme' }).length, 1)
})

test('upsertBySource: creates once, updates on changed fields, no-ops when unchanged', () => {
  const { reg, project } = fresh()
  rejects(() => reg.upsertBySource(W, { project: project.id, title: 'x' }), 400, /source_ref is required/)

  const created = reg.upsertBySource(W, { project: project.id, title: 'Gamma Depot', source_ref: 'scrape:gamma:1', stage: 'scraped' })
  assert.equal(created.action, 'created')
  assert.equal(created.opportunity.rev, 1)

  const unchanged = reg.upsertBySource(W, { project: project.id, title: 'Gamma Depot', source_ref: 'scrape:gamma:1', stage: 'scraped' })
  assert.equal(unchanged.action, 'unchanged')
  assert.equal(unchanged.opportunity.rev, 1)

  const updated = reg.upsertBySource(W, { project: project.id, title: 'Gamma Depot', source_ref: 'scrape:gamma:1', stage: 'qualified' })
  assert.equal(updated.action, 'updated')
  assert.equal(updated.opportunity.stage, 'qualified')
  assert.equal(updated.opportunity.rev, 2)
})

test('upsertBySource: refuses a project that disagrees with the existing record (source_ref is looked up globally, so this is the only thing stopping a caller naming its own project from touching another project\'s opportunity)', () => {
  const { store, reg, project } = fresh()
  const other = store.createProject(W, { name: 'lead-intel-other' })
  reg.upsertBySource(W, { project: project.id, title: 'Gamma Depot', source_ref: 'scrape:gamma:1' })

  rejects(() => reg.upsertBySource(W, { project: other.id, source_ref: 'scrape:gamma:1', stage: 'qualified' }), 409, /different project/)
  // the record is untouched
  const row = reg.list({ project: project.id })[0]
  assert.equal(row.stage, 'scraped')
  assert.equal(row.rev, 1)
})

test('update: rev-gated like tasks.updateTask; stale rev returns 409 with current row', () => {
  const { reg, project } = fresh()
  const o = reg.create(W, { project: project.id, title: 'Delta' })
  rejects(() => reg.update(W, o.id, { stage: 'qualified' }), 400, /rev is required/)
  rejects(() => reg.update(W, o.id, { stage: 'bogus', rev: o.rev }), 400, /stage must be one of/)

  const first = reg.update(W, o.id, { stage: 'qualified', rev: o.rev })
  assert.equal(first.stage, 'qualified')
  assert.equal(first.rev, 2)

  assert.throws(() => reg.update(W, o.id, { stage: 'staged', rev: o.rev }), (e) => {
    assert.equal(e.status, 409)
    assert.equal(e.extra.current.rev, 2)
    assert.equal(e.extra.current.stage, 'qualified')
    return true
  })
})

test('addEvidence/listEvidence: append-only qualification write-back; validates kind and 404s on unknown opportunity', () => {
  const { reg, project, store } = fresh()
  const o = reg.create(W, { project: project.id, title: 'Epsilon' })
  rejects(() => reg.addEvidence(W, 'OPP-nope', { body: {} }), 404, /no opportunity/)
  rejects(() => reg.addEvidence(W, o.id, { kind: 'bogus', body: {} }), 400, /kind must be one of/)
  rejects(() => reg.addEvidence(W, o.id, {}), 400, /body is required/)

  const e1 = reg.addEvidence(W, o.id, { kind: 'qualification', body: { score: 0.82, reason: 'matches ICP' } })
  const e2 = reg.addEvidence(W, o.id, { kind: 'note', body: 'checked site traffic' })
  assert.deepEqual(e1.body, { score: 0.82, reason: 'matches ICP' })
  assert.deepEqual(e2.body, { note: 'checked site traffic' })
  assert.deepEqual(reg.listEvidence(o.id).map((e) => e.id), [e1.id, e2.id])

  // logged via store.recordEvent, visible on the normal events feed (Q54/Q58 logging)
  const events = store.events().filter((ev) => ev.entity === 'opportunity' && ev.entity_id === o.id)
  assert.ok(events.some((ev) => ev.action === 'created'))
  assert.ok(events.some((ev) => ev.action === 'evidence_added' && ev.data.kind === 'qualification'))
})

test('addPackage/listPackages: append-only staged-package write-back; validates status and 404s on unknown opportunity', () => {
  const { reg, project, store } = fresh()
  const o = reg.create(W, { project: project.id, title: 'Zeta' })
  rejects(() => reg.addPackage(W, 'OPP-nope', { payload: {} }), 404, /no opportunity/)
  rejects(() => reg.addPackage(W, o.id, { status: 'bogus' }), 400, /status must be one of/)

  const p1 = reg.addPackage(W, o.id, { status: 'draft', payload: { form: 'application.pdf' } })
  const p2 = reg.addPackage(W, o.id, { status: 'ready', payload: { form: 'application-v2.pdf' } })
  assert.deepEqual(reg.listPackages(o.id).map((p) => p.id), [p1.id, p2.id])
  assert.equal(reg.get(o.id).packages.at(-1).status, 'ready')

  const events = store.events().filter((ev) => ev.entity === 'opportunity' && ev.entity_id === o.id && ev.action === 'package_staged')
  assert.equal(events.length, 2)
})
