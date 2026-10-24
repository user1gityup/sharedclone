// node --test sync-ui.test.mjs - header sync pill in public/index.html (Claude Opus 5.5).
// syncPill() is read from the SYNC block of index.html (ago() from the CORE block); page wiring is
// checked against the markup and the GET /api/sync/status shape served by sync.mjs routes().
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HTML = readFileSync(join(HERE, 'public', 'index.html'), 'utf8')
const CORE = HTML.slice(HTML.indexOf('/*CORE-BEGIN*/'), HTML.indexOf('/*CORE-END*/'))
const SYNC = HTML.slice(HTML.indexOf('/*SYNC-BEGIN*/'), HTML.indexOf('/*SYNC-END*/'))
const { syncPill } = new Function(`${CORE}; ${SYNC}; return { syncPill }`)()

const NOW = Date.parse('2026-10-19T12:00:10Z')

test('hidden when there is no status, no peers, or the route failed', () => {
  assert.equal(syncPill(null, NOW), null)
  assert.equal(syncPill({ chg: 4, peers: [] }, NOW), null)
  assert.equal(syncPill({}, NOW), null)
})

test('ok peer: name, check mark and age of last success', () => {
  const v = syncPill({ chg: 9, peers: [{ peer: 'ndi2', url: 'http://x', ok: true, after: 5, last_ok_at: '2026-10-19T12:00:07Z', last_error: null, last_error_at: null, totals: {} }] }, NOW)
  assert.equal(v.text, 'Sync: ndi2 ✓ 3s ago')
  assert.equal(v.cls, 'ok')
})

test('failing peer: cross and the error, full error in the tooltip', () => {
  const long = 'peer ndi2 HTTP 502: ' + 'x'.repeat(200)
  const v = syncPill({ peers: [{ peer: 'ndi2', ok: false, last_ok_at: null, last_error: long, last_error_at: '2026-10-19T12:00:00Z' }] }, NOW)
  assert.equal(v.cls, 'bad')
  assert.match(v.text, /^Sync: ndi2 ✗ peer ndi2 HTTP 502: x+$/)
  assert.ok(v.text.length < 80)
  assert.ok(v.title.includes(long) && v.title.includes('10s ago'))
})

test('never-synced peer, name/url fallback, several peers', () => {
  assert.equal(syncPill({ peers: [{ peer: 'ndi2', ok: null, after: 0 }] }, NOW).text, 'Sync: ndi2 …')
  assert.equal(syncPill({ peers: [{ name: 'a', ok: null }] }, NOW).text, 'Sync: a …')
  const v = syncPill({ peers: [{ peer: 'a', ok: true, last_ok_at: '2026-10-19T12:00:10Z' }, { url: 'http://b', ok: false, last_error: 'boom' }] }, NOW)
  assert.equal(v.text, 'Sync: a ✓ 0s ago · http://b ✗ boom')
  assert.equal(v.cls, 'bad')
})

test('page wiring: header pill, 10s poll of /api/sync/status, no token prompt', () => {
  assert.match(HTML, /<span id="syncPill" class="syncpill hidden" role="status"><\/span>/)
  assert.match(HTML, /\.syncpill\.ok \{ color:var\(--ok\); background:var\(--ok-bg\); \}/)
  assert.match(HTML, /api\('GET', '\/api\/sync\/status', undefined, false\)/)
  assert.match(HTML, /setInterval\(pollSync, 10000\)/)
  const fn = HTML.slice(HTML.indexOf('async function pollSync('), HTML.indexOf('\n}\n', HTML.indexOf('async function pollSync(')))
  assert.match(fn, /catch \{\}/, '404 / network error hides the pill instead of throwing')
  assert.match(fn, /classList\.toggle\('hidden', !v\)/)
})

test('matches the sync.mjs route', () => {
  const src = readFileSync(join(HERE, 'sync.mjs'), 'utf8')
  assert.match(src, /\/\^\\\/api\\\/sync\\\/status\$\//)
  assert.match(src, /chg: syncCounter\(db\), peers: sync\?\.status\(\) \?\? \[\]/)
})
