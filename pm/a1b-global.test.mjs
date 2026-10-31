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

// User 2026-10-23: "drag and drop not working i want to add drag and drop order to all sections".
test('⠿ drag handle is the first item of the A1b cluster, a draggable span keyed by group', () => {
  const b = fn('stepBtns')
  assert.ok(b.indexOf('${handle}${pinBtn}') > 0, 'handle before pin')
  assert.match(b, /class="ghandle" role="button"/)
  assert.match(b, /draggable="\$\{off \? 'false' : 'true'\}"/)
  assert.match(b, /data-gdrag="\$\{kind\}"/)
  assert.match(b, /kind === 'project' \|\| \(pin && pin\.on\) \? 'top' : 'p:'/)
  assert.doesNotMatch(b, /<button class="ghandle/)
})

test('Top order drag starts from a span handle, not a <button> on a draggable row', () => {
  const r = fn('orderRowHtml')
  assert.match(r, /<span class="handle" data-oact="handle" role="button"/)
  assert.doesNotMatch(r, /<button class="handle"/)
  assert.ok(r.includes('data-id="${escapeHtml(it.id)}">\n<span class="handle"'), 'row itself is not draggable')
  const b = fn('bindOrder')
  assert.match(b, /const clean = \(\) =>/)
  assert.match(b, /dragFrom = -1; clean\(\); dragDone\(\);\n\s+saveOrder\(orderMove\(/)
})

test('re-render is held while a drag is in flight', () => {
  assert.match(HTML, /function render\(\) \{ if \(S\.drag\) \{ S\.dragPending = true; return \}/)
  assert.match(fn('renderMain'), /if \(S\.drag\) \{ S\.dragPending = true; return \}/)
  assert.match(fn('dragDone'), /S\.drag = null; if \(S\.dragPending\)/)
})

test('drops write through stepItem with a target id, same group only, reorder-gated', () => {
  assert.match(HTML, /async function stepItem\(kind, id, dir, to, toId\)/)
  assert.match(fn('stepItem'), /to = orderRows\(S\.order\)\.findIndex\(\(r\) => r\.id === toId\)/)
  assert.match(fn('stepItem'), /if \(toId != null\) \{ to = cur\.indexOf\(toId\)/)
  assert.match(fn('dragTargetOf'), /h\.dataset\.grp === S\.drag\.grp/)
  assert.match(HTML, /if \(t\) stepItem\(d\.kind, d\.id, 0, null, t\.id\)/)
  assert.match(HTML, /h\.getAttribute\('aria-disabled'\) === 'true' \|\| !can\('reorder'\)/)
  assert.match(HTML, /stepItem\(h\.dataset\.gdrag, h\.dataset\.id, e\.key === 'ArrowUp' \? -1 : 1\)/)
})

test('drop rows cover every section: board cards, cards (Continue, project cards), heads (lists, Attention)', () => {
  assert.match(HTML, /const dragRowOf = \(el\) => el && el\.closest && el\.closest\('\.bcard, \.card, \.head'\)/)
  for (const f of ['viewHome', 'viewAttention']) assert.match(fn(f), /taskStepBtns\(/, f)
  assert.match(fn('projectsList'), /projStepBtns\(p\)/)
  assert.match(fn('taskRow'), /taskStepBtns\(t\)/)
})
