// node --test remote.test.mjs   (run from this folder)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as R from './remote.mjs'

test('classifyAddress: loopback, lan, tailnet, public', () => {
  const c = R.classifyAddress
  assert.equal(c('127.0.0.1'), 'loopback'); assert.equal(c('::1'), 'loopback'); assert.equal(c('::ffff:127.0.0.1'), 'loopback')
  assert.equal(c('10.0.0.241'), 'lan'); assert.equal(c('192.168.1.5'), 'lan'); assert.equal(c('172.20.0.1'), 'lan'); assert.equal(c('172.32.0.1'), 'public')
  assert.equal(c('100.64.1.2'), 'tailnet'); assert.equal(c('100.127.9.9'), 'tailnet'); assert.equal(c('100.128.0.1'), 'public')
  assert.equal(c('fd7a:115c:a1e0::1'), 'tailnet'); assert.equal(c('8.8.8.8'), 'public'); assert.equal(c('999.1.1.1'), 'public'); assert.equal(c(''), 'public')
})

test('checkBind: token required off loopback, public refused, wildcard warned', () => {
  assert.equal(R.checkBind({}).ok, true)
  assert.equal(R.checkBind({ host: '10.0.0.5' }).ok, false)
  assert.equal(R.checkBind({ host: '10.0.0.5', token: 't' }).ok, true)
  assert.equal(R.checkBind({ host: '0.0.0.0', token: 't' }).warnings.length, 1)
  assert.equal(R.checkBind({ host: '0.0.0.0' }).ok, false)
  assert.match(R.checkBind({ host: '8.8.8.8', token: 't' }).reason, /public/)
})

test('principalOrigin trusts forwarding headers only from a loopback proxy', () => {
  const h = { 'x-forwarded-for': '100.64.0.9, 1.1.1.1', 'tailscale-user-login': 'a@b' }
  assert.deepEqual(R.principalOrigin({ socketAddr: '127.0.0.1', headers: h }), { addr: '100.64.0.9', via: 'proxy', class: 'tailnet', tailscale_user: 'a@b' })
  const spoof = R.principalOrigin({ socketAddr: '203.0.113.7', headers: { 'x-forwarded-for': '127.0.0.1' } })
  assert.equal(spoof.addr, '203.0.113.7'); assert.equal(spoof.class, 'public'); assert.equal(spoof.via, 'direct')
  assert.equal(R.principalOrigin({ socketAddr: '127.0.0.1' }).class, 'loopback')
})

test('tailscale plans: version-aware syntax, rollback, funnel refused, firewall needs approval', () => {
  const m = R.tailscaleServePlan({ version: '1.78.1' }), o = R.tailscaleServePlan({ version: '1.40.0' })
  assert.match(m.apply[0], /serve --bg --https=443 http:\/\/127\.0\.0\.1:4480/); assert.match(o.apply[0], /serve https:443/)
  assert.ok(m.rollback.length && o.rollback.length); assert.equal(m.public, false)
  assert.throws(() => R.tailscaleServePlan({ version: '1.78.1', funnel: true }), /not allowed/)
  assert.throws(() => R.tailscaleServePlan({}), /version/)
  const f = R.firewallPlan({})
  assert.equal(f.needs_user_approval, true); assert.match(f.apply[0], /remoteip=LocalSubnet,100\.64\.0\.0\/10/); assert.ok(f.rollback.length && f.backup.length)
})

const fetchMap = (map) => async (url, { signal }) => {
  const h = new URL(url).hostname; const v = map[h]
  if (v === 'hang') return new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))))
  if (v instanceof Error) throw v
  return { ok: v === 200, status: v }
}

test('probeFleet: online, degraded then offline only after consecutive failures, with diagnoses', async () => {
  const machines = [{ name: 'vmixer', url: 'http://a:1' }, { name: 'ndi2', url: 'http://b:1' }]
  const f = fetchMap({ a: 200, b: Object.assign(new Error('c'), { cause: { code: 'ECONNREFUSED' } }) })
  let prior = new Map(), r
  r = await R.probeFleet(machines, { fetchImpl: f, prior, now: 1000 }); prior = r.prior
  assert.equal(r.fleet[0].status, 'online'); assert.equal(r.fleet[1].status, 'degraded'); assert.equal(r.fleet[1].diagnosis.kind, 'refused')
  r = await R.probeFleet(machines, { fetchImpl: f, prior, now: 2000 }); prior = r.prior
  assert.equal(r.fleet[1].status, 'degraded')
  r = await R.probeFleet(machines, { fetchImpl: f, prior, now: 3000 }); prior = r.prior
  assert.equal(r.fleet[1].status, 'offline'); assert.equal(r.fleet[1].last_ok, null)
  // recovery resets
  r = await R.probeFleet(machines, { fetchImpl: fetchMap({ a: 200, b: 200 }), prior, now: 4000 })
  assert.equal(r.fleet[1].status, 'online'); assert.equal(r.fleet[1].fails, 0)
})

test('probeFleet: timeout and auth diagnoses are distinct; credentials are sent only as a bearer header', async () => {
  const seen = []
  const f = async (url, o) => { seen.push([url, o.headers.authorization]); if (url.includes('hang')) return fetchMap({ hang: 'hang' })(url, o); return { ok: false, status: 401 } }
  const r = await R.probeFleet([{ name: 'h', url: 'http://hang:1' }, { name: 'p', url: 'http://p:1', token: 'sekret' }], { fetchImpl: f, timeoutMs: 20 })
  assert.equal(r.fleet[0].diagnosis.kind, 'timeout'); assert.equal(r.fleet[1].diagnosis.kind, 'auth')
  assert.ok(!seen.some(([u]) => u.includes('sekret'))); assert.equal(seen[1][1], 'Bearer sekret')
  assert.ok(!JSON.stringify(r).includes('sekret'))
})

test('assertNoLocalhostBase blocks localhost API calls from a remote origin only', () => {
  assert.equal(R.assertNoLocalhostBase('', 'https://vmixer.tail1234.ts.net'), true)
  assert.equal(R.assertNoLocalhostBase('/api', 'https://vmixer.tail1234.ts.net'), true)
  assert.throws(() => R.assertNoLocalhostBase('http://127.0.0.1:4480', 'https://vmixer.tail1234.ts.net'), /same-origin/)
  assert.throws(() => R.assertNoLocalhostBase('http://localhost:4480/api', 'http://10.0.0.5:4480'), /must not call/)
  assert.equal(R.assertNoLocalhostBase('http://127.0.0.1:4480', 'http://127.0.0.1:4480'), true)
})
