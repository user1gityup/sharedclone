// node --test attention-pill.test.mjs - attention pill in the header bar beside Role (Claude Opus 5.5).
// Reads public/index.html as text: the pill sits in header.top right before the Role label,
// opens the Attention panel, and the full-width attention strip is gone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'public', 'index.html'), 'utf8')
const HEADER = HTML.match(/<header class="top">([\s\S]*?)<\/header>/)[1]

test('pill is in the header bar, directly before the Role select', () => {
  assert.match(HEADER, /<button id="attPill"[^>]*data-act="nav" data-v="attention"[^>]*><\/button>\s*<label class="muted">Role <select id="roleSel"/)
})

test('pill renders count + severity and is refreshed with the strip', () => {
  const fn = HTML.match(/function renderAttPill\(\) \{[\s\S]*?\n\}/)[0]
  assert.match(fn, /attentionSummary\(attentionItems\(S\.tasks, S\.runs\)\)/)
  assert.match(fn, /sum\.high \? 'high' : \(sum\.medium \? 'med' : ''\)/)
  assert.match(fn, /need attention/)
  assert.match(HTML, /function renderStrip\(\) \{\s*const el = \$\('#alertStrip'\);\s*renderAttPill\(\);/)
})

test('full-width attention strip is removed; only network/load errors use the strip', () => {
  assert.doesNotMatch(HTML, /Open Attention panel<\/button><\/div>`/)
  const strip = HTML.match(/function renderStrip\(\) \{[\s\S]*?\n\}/)[0]
  assert.doesNotMatch(strip, /attentionSummary/)
  assert.match(strip, /el\.innerHTML = '';/)
})
