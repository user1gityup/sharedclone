// Tests for parseDependencies() in C:\Users\vMixer\.dsh\assemble-ecomm.mjs — the
// function that turns a DSH run's DEPENDENCIES.md table into package.json
// dependencies. The DSH host refuses a staged package.json, so that table is the
// only channel a swarm run has for declaring packages: if this parser is wrong,
// the generated manifest is wrong and every assemble and every writer check
// downstream of it is wrong with it.
//
// Run:  node --test "C:\Users\vMixer\.claude\shared-brain\.sync\assemble-ecomm.parse-deps.test.mjs"
// Expect 9/9. It imports the live ~/.dsh copy, so it tests whatever is installed.
//
// Written 2026-09-27 by Claude Opus 5 while building the assembler (ecomm plan
// item 2); the reordered-header case below caught a real bug — a header written
// | Why | Name | Type | Version | was being parsed as a data row. Kept here
// because it was born in a session scratchpad and would otherwise be paid for
// twice. Subject file lives in ~/.dsh, not in the brain; sibling note is
// handoff-2026-09-27-0105-ecomm-dsh-run-vmixer.md.

import { strict as assert } from 'node:assert'
import test from 'node:test'
import { parseDependencies } from 'file:///C:/Users/vMixer/.dsh/assemble-ecomm.mjs'

test('reads the documented four-column table', () => {
  const { deps, devDeps, warnings } = parseDependencies(`
# DEPENDENCIES

| Package | Version | Kind | Why |
|---|---|---|---|
| next | ^15.0.0 | dependency | app framework |
| @prisma/client | ^6.1.0 | dependency | db access |
| typescript | ^5.6.0 | devDependency | types |
`)
  assert.deepEqual(deps, { next: '^15.0.0', '@prisma/client': '^6.1.0' })
  assert.deepEqual(devDeps, { typescript: '^5.6.0' })
  assert.deepEqual(warnings, [])
})

test('honours a reordered header instead of assuming column order', () => {
  const { deps, devDeps } = parseDependencies(`
| Why | Name | Type | Version |
|---|---|---|---|
| framework | next | dependency | ^15.0.0 |
| linting | eslint | dev | ^9.0.0 |
`)
  assert.deepEqual(deps, { next: '^15.0.0' })
  assert.deepEqual(devDeps, { eslint: '^9.0.0' })
})

test('falls back to name, version, kind, why when there is no header', () => {
  const { deps } = parseDependencies('| zod | ^3.23.0 | dependency | validation |')
  assert.deepEqual(deps, { zod: '^3.23.0' })
})

test('strips backticks around cells', () => {
  const { deps } = parseDependencies('| `zod` | `^3.23.0` | dependency | validation |')
  assert.deepEqual(deps, { zod: '^3.23.0' })
})

test('ignores prose rows that are not package names', () => {
  const { deps, warnings } = parseDependencies(`
| Package | Version | Kind | Why |
|---|---|---|---|
| see note below | | | |
| zod | ^3.23.0 | dependency | validation |
`)
  assert.deepEqual(deps, { zod: '^3.23.0' })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /not an npm package name/)
})

test('warns instead of guessing when a version range is missing', () => {
  const { deps, warnings } = parseDependencies(`
| Package | Version | Kind | Why |
|---|---|---|---|
| zod |  | dependency | validation |
`)
  assert.deepEqual(deps, { zod: 'latest' })
  assert.match(warnings[0], /no version range/)
})

test('two units disagreeing on a range is reported, not silently merged', () => {
  const { deps, warnings } = parseDependencies(`
| Package | Version | Kind | Why |
|---|---|---|---|
| zod | ^3.23.0 | dependency | unit a |
| zod | ^3.24.0 | dependency | unit b |
`)
  assert.deepEqual(deps, { zod: '^3.24.0' })
  assert.match(warnings[0], /two version ranges/)
})

test('a package listed both ways stays a runtime dependency', () => {
  const { deps, devDeps, warnings } = parseDependencies(`
| Package | Version | Kind | Why |
|---|---|---|---|
| zod | ^3.23.0 | devDependency | unit a |
| zod | ^3.23.0 | dependency | unit b |
`)
  assert.deepEqual(deps, { zod: '^3.23.0' })
  assert.deepEqual(devDeps, {})
  assert.match(warnings[0], /both dependency and devDependency/)
})

test('a file with no table yields nothing rather than throwing', () => {
  const { deps, devDeps } = parseDependencies('# DEPENDENCIES\n\nNone yet.\n')
  assert.deepEqual(deps, {})
  assert.deepEqual(devDeps, {})
})
