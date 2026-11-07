// node --test opportunity-routes.test.mjs   (run from pm/)
// T-bf6f4f2c: DSH Integration - end-to-end through createServer on an ephemeral port, proving the
// Opportunity/evidence/package routes go through the same authorizePm + roles gate as every other
// /api/ route (no bespoke permission system added). Pattern follows the ordering e2e test in
// test.mjs. Not run here (builder rule): pm runs the checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from './store.mjs'
import { createServer } from './server.mjs'
import { OPPORTUNITY_BY_ID, OPPORTUNITY_UPSERT, OPPORTUNITY_COLLECTION } from './opportunity-routes.mjs'

const W = { actor: 'claude-sonnet-builder', model: 'claude-sonnet-5' }
const DIR = mktemp()
function mktemp() { return mkdtempSync(join(tmpdir(), 'pm-opportunity-routes-test-')) }

test('OPPORTUNITY_BY_ID matches a single opportunity (and its evidence/packages sub-resources) but not the collection root or /upsert', () => {
  assert.ok(OPPORTUNITY_BY_ID.test('/api/opportunities/OPP-abcd1234'))
  assert.ok(OPPORTUNITY_BY_ID.test('/api/opportunities/OPP-abcd1234/evidence'))
  assert.ok(OPPORTUNITY_BY_ID.test('/api/opportunities/OPP-abcd1234/packages'))
  assert.ok(!OPPORTUNITY_BY_ID.test('/api/opportunities'))
  assert.ok(!OPPORTUNITY_BY_ID.test('/api/opportunities/upsert'))
})

test('OPPORTUNITY_UPSERT and OPPORTUNITY_COLLECTION match only their own path', () => {
  assert.ok(OPPORTUNITY_UPSERT.test('/api/opportunities/upsert'))
  assert.ok(!OPPORTUNITY_UPSERT.test('/api/opportunities'))
  assert.ok(!OPPORTUNITY_UPSERT.test('/api/opportunities/OPP-abcd1234'))
  assert.ok(OPPORTUNITY_COLLECTION.test('/api/opportunities'))
  assert.ok(!OPPORTUNITY_COLLECTION.test('/api/opportunities/upsert'))
  assert.ok(!OPPORTUNITY_COLLECTION.test('/api/opportunities/OPP-abcd1234'))
})

test('opportunities: loopback is trusted; a role-less token is refused view and run; a project-scoped worker may act only inside its project', async (t) => {
  const { createBridge } = await import('./bridge/index.mjs')
  const { createAuth, sha256 } = await import('./bridge/auth.mjs')
  const roles = await import('./roles.mjs')
  const PEER = 'opp-routes-peer'
  const TOK = { nobody: 'nobody-secret', client1: 'client1-secret', wrk1: 'wrk1-secret', wrk2: 'wrk2-secret' }
  const cleanups = []
  t.after(() => {
    for (const fn of cleanups.reverse()) { try { fn() } catch {} }
    try { rmSync(DIR, { recursive: true, force: true }) } catch {}
  })

  const bdir = join(DIR, 'bridge')
  mkdirSync(bdir, { recursive: true })
  const tokens = Object.entries(TOK).map(([name, secret]) => ({ name, sha256: sha256(secret), scopes: ['send', 'read'], projects: ['*'] }))
  const bridge = createBridge({
    machine: 'testbox', dbPath: join(bdir, 'bridge.db'), peers: {}, policyPath: join(bdir, 'policy.json'),
    tokenFile: join(bdir, 'tokens.json'), replica: { intervalMs: 0 },
    auth: createAuth({ tokens, tokenFile: join(bdir, 'tokens.json'), peerToken: PEER, trustLoopback: true }),
    workers: { router: null, logDir: join(bdir, 'logs') },
  })
  const store = openStore(join(DIR, 'pm.db'))
  const server = createServer(store, { token: PEER, bridge })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  cleanups.push(() => { server.close(); bridge.stop(); store.close() })

  const p1 = store.createProject(W, { name: 'lead-intel-p1' })
  const p2 = store.createProject(W, { name: 'lead-intel-p2' })
  // 'nobody' gets no role at all; 'client1' is a client (view-only, never run);
  // 'wrk1' is a worker scoped to p1 only; 'wrk2' is a worker scoped to p2 only.
  roles.assignRole(bridge.queue.db, { identity: 'client1', role: 'client', by: 'test' })
  roles.assignRole(bridge.queue.db, { identity: 'wrk1', role: 'worker', project: p1.id, by: 'test' })
  roles.assignRole(bridge.queue.db, { identity: 'wrk2', role: 'worker', project: p2.id, by: 'test' })

  const url = `http://127.0.0.1:${server.address().port}`
  // Under a full blitz slot load a connection can be transiently refused/reset before the
  // listener is scheduled, or a request can simply time out under CPU contention; retry the
  // fetch itself (not the response body - a real 2xx/4xx/5xx is returned as-is on the first
  // try). Mirrors the /mcp retry in access.test.mjs, with a larger budget: this test makes many
  // more sequential round-trips than that one, so it has more chances to hit a transient slot
  // under a full blitz roster (many concurrent builder processes on one machine).
  const call = async (method, path, body, who) => {
    for (let i = 0; ; i++) {
      try {
        const res = await fetch(url + path, {
          method,
          headers: { 'content-type': 'application/json', 'x-pm-actor': who ?? 'loopback-test', ...(who ? { authorization: `Bearer ${TOK[who]}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        return { status: res.status, body: await res.json().catch(() => null) }
      } catch (err) {
        if (i >= 19) throw err
        await new Promise((ok) => setTimeout(ok, 300))
      }
    }
  }

  // loopback (no token): full access regardless of role tables
  const asLoopback = await call('POST', '/api/opportunities', { project: p1.id, title: 'loopback opp' })
  assert.equal(asLoopback.status, 200, JSON.stringify(asLoopback.body))
  const loopbackOpp = asLoopback.body

  // a role-less identity is refused both view and run
  const noView = await call('GET', `/api/opportunities?project=${p1.id}`, undefined, 'nobody')
  assert.equal(noView.status, 403)
  const noRun = await call('POST', '/api/opportunities', { project: p1.id, title: 'nope' }, 'nobody')
  assert.equal(noRun.status, 403)

  // a client may view but never run (create/evidence/package write-back refused)
  const clientView = await call('GET', `/api/opportunities?project=${p1.id}`, undefined, 'client1')
  assert.equal(clientView.status, 200, JSON.stringify(clientView.body))
  const clientRun = await call('POST', '/api/opportunities', { project: p1.id, title: 'client tries' }, 'client1')
  assert.equal(clientRun.status, 403)

  // a worker scoped to p1 may create and write back inside p1
  const createdInP1 = await call('POST', '/api/opportunities', { project: p1.id, title: 'wrk1 opp', source_ref: 'scrape:wrk1:1' }, 'wrk1')
  assert.equal(createdInP1.status, 200, JSON.stringify(createdInP1.body))
  const oppId = createdInP1.body.id
  const evidence = await call('POST', `/api/opportunities/${oppId}/evidence`, { kind: 'qualification', body: { score: 0.9 } }, 'wrk1')
  assert.equal(evidence.status, 200, JSON.stringify(evidence.body))
  const pkg = await call('POST', `/api/opportunities/${oppId}/packages`, { status: 'draft', payload: { form: 'app.pdf' } }, 'wrk1')
  assert.equal(pkg.status, 200, JSON.stringify(pkg.body))
  const got = await call('GET', `/api/opportunities/${oppId}`, undefined, 'wrk1')
  assert.equal(got.status, 200)
  assert.equal(got.body.evidence.length, 1)
  assert.equal(got.body.packages.length, 1)

  // the SAME worker is refused outside its own project scope (create under p2)
  const wrongProject = await call('POST', '/api/opportunities', { project: p2.id, title: 'wrk1 in p2' }, 'wrk1')
  assert.equal(wrongProject.status, 403, JSON.stringify(wrongProject.body))

  // a worker scoped to p2 can act in p2, independently of p1's data
  const createdInP2 = await call('POST', '/api/opportunities', { project: p2.id, title: 'wrk2 opp' }, 'wrk2')
  assert.equal(createdInP2.status, 200, JSON.stringify(createdInP2.body))

  // the sub-resource routes carry no project field of their own - the gate must scope them by
  // the opportunity's OWN project (resolveOpportunityProject), not fall through unscoped. wrk2
  // (p2-only) is refused write-back and view on p1's opportunity, and the SAME worker acts fine
  // on its own project's opportunity.
  const crossEvidence = await call('POST', `/api/opportunities/${oppId}/evidence`, { kind: 'note', body: 'nope' }, 'wrk2')
  assert.equal(crossEvidence.status, 403, JSON.stringify(crossEvidence.body))
  const crossPkg = await call('POST', `/api/opportunities/${oppId}/packages`, { payload: {} }, 'wrk2')
  assert.equal(crossPkg.status, 403, JSON.stringify(crossPkg.body))
  const crossGet = await call('GET', `/api/opportunities/${oppId}`, undefined, 'wrk2')
  assert.equal(crossGet.status, 403, JSON.stringify(crossGet.body))
  const crossPatch = await call('PATCH', `/api/opportunities/${oppId}`, { stage: 'qualified', rev: 1 }, 'wrk2')
  assert.equal(crossPatch.status, 403, JSON.stringify(crossPatch.body))

  const p2OppId = createdInP2.body.id
  const ownEvidence = await call('POST', `/api/opportunities/${p2OppId}/evidence`, { kind: 'note', body: 'fine' }, 'wrk2')
  assert.equal(ownEvidence.status, 200, JSON.stringify(ownEvidence.body))

  // GET /api/opportunities with no project named: refused for a project-restricted worker (the
  // generic unscoped view check otherwise passes trivially with no project named, which would
  // return every project's rows to anyone holding 'view' at all) but still unrestricted for
  // loopback, which is always trusted.
  const listNoProjectWrk1 = await call('GET', '/api/opportunities', undefined, 'wrk1')
  assert.equal(listNoProjectWrk1.status, 403, JSON.stringify(listNoProjectWrk1.body))
  const listNoProjectLoopback = await call('GET', '/api/opportunities')
  assert.equal(listNoProjectLoopback.status, 200, JSON.stringify(listNoProjectLoopback.body))

  // /upsert is scoped by the EXISTING opportunity's own project (resolveOpportunityProjectBySource),
  // not the caller-claimed body.project: wrk1 (p1-only) cannot touch p2's opportunity by naming
  // its own project in the body alongside p2's source_ref.
  const p2WithRef = await call('POST', '/api/opportunities', { project: p2.id, title: 'wrk2 synced lead', source_ref: 'scrape:wrk2:1' }, 'wrk2')
  assert.equal(p2WithRef.status, 200, JSON.stringify(p2WithRef.body))
  const upsertBypass = await call('POST', '/api/opportunities/upsert', { project: p1.id, source_ref: 'scrape:wrk2:1', title: 'hijacked', stage: 'qualified' }, 'wrk1')
  assert.equal(upsertBypass.status, 403, JSON.stringify(upsertBypass.body))
  const stillP2 = await call('GET', `/api/opportunities/${p2WithRef.body.id}`, undefined, 'wrk2')
  assert.equal(stillP2.status, 200, JSON.stringify(stillP2.body))
  assert.equal(stillP2.body.title, 'wrk2 synced lead')
  assert.equal(stillP2.body.stage, 'scraped')

  // confirm the writes landed and are logged on the normal events feed
  const events = store.events().filter((ev) => ev.entity === 'opportunity')
  assert.ok(events.some((ev) => ev.entity_id === loopbackOpp.id && ev.action === 'created'))
  assert.ok(events.some((ev) => ev.entity_id === oppId && ev.action === 'evidence_added'))
  assert.ok(events.some((ev) => ev.entity_id === oppId && ev.action === 'package_staged'))
})

// T-bf6f4f2c: DSH Integration bypass fix 2. A ROLE assignment and a bridge TOKEN's own `projects`
// list are two independent restrictions. The first fix only closed the unscoped-listing gap for a
// project-restricted ROLE (roles.canViewAllProjects); it missed that a token whose own `projects`
// list names a single project, but which authenticates an identity holding a GLOBAL role (an
// unscoped worker/client, assigned with no project), still passed the collection-GET gate -
// roles.canViewAllProjects said yes, requireScope never runs its project check when no project is
// named, and reg.list(q) with no project filter returned every project's rows. This test proves
// that gap is closed: such a token can list its OWN project, is refused naming any other project
// (ordinary token-scope enforcement), and - the actual bug - is refused the bare unscoped listing
// too, even though its role alone would have allowed it.
test('opportunities: a token whose OWN projects list is restricted cannot list the collection across projects, even holding a global role', async (t) => {
  const { createBridge } = await import('./bridge/index.mjs')
  const { createAuth, sha256 } = await import('./bridge/auth.mjs')
  const roles = await import('./roles.mjs')
  const PEER = 'opp-routes-tokenscope-peer'
  const SECRET = 'globalscoped-secret'
  const dir = mktemp()
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch {} })

  // Projects must exist before the token list is built: the token's own restriction names a
  // project id, not just whatever its role happens to allow.
  const store = openStore(join(dir, 'pm.db'))
  const p1 = store.createProject(W, { name: 'tokenscope-p1' })
  const p2 = store.createProject(W, { name: 'tokenscope-p2' })

  const bdir = join(dir, 'bridge')
  mkdirSync(bdir, { recursive: true })
  const tokens = [{ name: 'globalscoped', sha256: sha256(SECRET), scopes: ['send', 'read'], projects: [p1.id] }]
  const bridge = createBridge({
    machine: 'testbox', dbPath: join(bdir, 'bridge.db'), peers: {}, policyPath: join(bdir, 'policy.json'),
    tokenFile: join(bdir, 'tokens.json'), replica: { intervalMs: 0 },
    auth: createAuth({ tokens, tokenFile: join(bdir, 'tokens.json'), peerToken: PEER, trustLoopback: true }),
    workers: { router: null, logDir: join(bdir, 'logs') },
  })
  const server = createServer(store, { token: PEER, bridge })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => { server.close(); bridge.stop(); store.close() })

  // A GLOBAL worker role - no project - which alone made roles.canViewAllProjects true.
  roles.assignRole(bridge.queue.db, { identity: 'globalscoped', role: 'worker', by: 'test' })

  const url = `http://127.0.0.1:${server.address().port}`
  const call = async (path) => {
    for (let i = 0; ; i++) {
      try {
        const res = await fetch(url + path, { headers: { authorization: `Bearer ${SECRET}`, 'x-pm-actor': 'globalscoped' } })
        return { status: res.status, body: await res.json().catch(() => null) }
      } catch (err) {
        if (i >= 19) throw err
        await new Promise((ok) => setTimeout(ok, 300))
      }
    }
  }

  // The actual bug: no project named, role is global, but the token itself is scoped to p1 only.
  const noProject = await call('/api/opportunities')
  assert.equal(noProject.status, 403, JSON.stringify(noProject.body))

  // Naming its own (token-scoped) project still works.
  const own = await call(`/api/opportunities?project=${p1.id}`)
  assert.equal(own.status, 200, JSON.stringify(own.body))

  // Naming a project outside the token's own list is refused by ordinary token scope.
  const other = await call(`/api/opportunities?project=${p2.id}`)
  assert.equal(other.status, 403, JSON.stringify(other.body))
})
