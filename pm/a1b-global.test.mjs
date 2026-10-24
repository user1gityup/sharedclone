// The user's sort pick (2026-10-19, "a1 but i want the pinned and up an down arrows to the left
// of the number"): every Home/Projects/Tasks row carries the A1b cluster - pin, ▲/▼, position -
// placed before the name, not bare arrows on the right.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const HTML = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8')
const fn = (name) => HTML.slice(HTML.indexOf(`function ${name}(`), HTML.indexOf('\n}\n', HTML.indexOf(`function ${name}(`)))

test('global cluster: pin, then arrows, then position input', () => {
  const b = fn('stepBtns')
  assert.match(b, /class="pinbtn/)
  const r = b.slice(b.indexOf('return `<span class="gctl"'))
  const seq = ['class="gctl"', '${pinBtn}', 'class="arrows gstep"', 'class="pos"'].map((s) => r.indexOf(s))
  seq[0] = seq[0] === 0 ? 1 : seq[0]
  assert.ok(seq.every((v, i) => v > 0 && (i === 0 || v > seq[i - 1])), `cluster order ${seq}`)
  assert.match(b, /data-gpos="\$\{kind\}"/)
})

test('cluster sits left of the name on every row type', () => {
  const tr = fn('taskRow')
  assert.ok(tr.indexOf('taskStepBtns(t)') < tr.indexOf('<span class="t"'), 'task row')
  const pl = fn('projectsList')
  for (const name of ['<strong>${escapeHtml(p.name)}</strong>', '<span class="t">${escapeHtml(p.name)}</span>']) {
    const at = pl.indexOf(name)
    assert.ok(at > 0 && pl.lastIndexOf('projStepBtns(p)', at) > 0 && pl.lastIndexOf('projStepBtns(p)', at) > pl.lastIndexOf('<div', at) - 400, `project ${name}`)
  }
  assert.doesNotMatch(HTML, /float:right">\$\{taskStepBtns/)
  assert.doesNotMatch(HTML, /<span class="tag">\$\{p\.done_count\} done<\/span>\$\{projStepBtns/)
})

test('position typing and pin are wired', () => {
  assert.match(HTML, /const gk = e\.target\.dataset && e\.target\.dataset\.gpos;/)
  assert.match(HTML, /case 'gpin':.*pinItem\(/)
  assert.match(HTML, /case 'gnoop': e\.stopPropagation\(\)/)
})

test('moveIds moves one id to a clamped index', () => {
  const src = fn('moveIds') + '\n}'
  const moveIds = new Function(src + '; return moveIds')()
  assert.deepEqual(moveIds(['a', 'b', 'c', 'd'], 'd', 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(moveIds(['a', 'b', 'c'], 'a', 99), ['b', 'c', 'a'])
  assert.equal(moveIds(['a', 'b'], 'a', 0), null)
  assert.equal(moveIds(['a'], 'z', 0), null)
})

test('Attention panel and Continue cards follow the global order with the A1b cluster', () => {
  const att = fn('viewAttention')
  assert.match(att, /byGlobal\(attentionItems\(S\.tasks, S\.runs\), \(i\) => i\.kind === 'run' \? i\.task_id : i\.id\)/)
  assert.ok(att.indexOf('taskStepBtns(taskById(i.id))') < att.indexOf('<span class="t">'), 'attention cluster left of title')
  const home = fn('viewHome')
  assert.match(home, /byGlobal\(continueCandidates\(S\.tasks, Infinity\), \(t\) => t\.id\)\.slice\(0, 6\)/)
  assert.ok(home.indexOf('${taskStepBtns(t)}${taskChipHtml(t)}') > 0, 'continue card cluster first')
  const byGlobal = new Function('S', fn('byGlobal') + '\n}; return byGlobal')({ tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
  assert.deepEqual(byGlobal([{ id: 'c' }, { id: 'x' }, { id: 'a' }], (t) => t.id).map((t) => t.id), ['a', 'c', 'x'])
})
