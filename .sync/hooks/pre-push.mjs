// git pre-push: stdin carries "<local ref> <local sha> <remote ref> <remote sha>"
// per ref being pushed. Each local commit being published is checked as a tree.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { verifyPublish } from '../brain-sync.mjs'

const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()
let input = ''
try { input = readFileSync(0, 'utf8') } catch {}
const ZERO = /^0+$/
let failed = false
for (const line of input.split('\n').map(l => l.trim()).filter(Boolean)) {
  const [localRef, localSha] = line.split(/\s+/)
  if (!localSha || ZERO.test(localSha)) continue // deleting a remote ref: nothing to check
  const problems = verifyPublish(root, localSha)
  if (problems.length) {
    failed = true
    console.error(`brain pre-push: refusing ${localRef} (${localSha.slice(0, 10)}):`)
    for (const p of problems) console.error(`  - ${p}`)
  } else {
    console.error(`brain pre-push: ${localRef} (${localSha.slice(0, 10)}) checked - no home paths, credentials or conflicts`)
  }
}
process.exit(failed ? 1 : 0)
