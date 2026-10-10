// Normalise home paths in every staged note, then re-stage it.
//
// brain-sync normalises before its own commits; this catches a commit an agent
// makes by hand, which would otherwise carry C:\Users\<name> into history.
// Files in LITERAL_PATH_FILES keep their paths: tools read them.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { knownUsers, LITERAL_PATH_FILES, normalizeText } from '../brain-sync.mjs'

const git = args => spawnSync('git', args, { encoding: 'utf8' })
const root = git(['rev-parse', '--show-toplevel']).stdout.trim()
const users = knownUsers(root)
const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACM']).stdout.split('\n')
  .filter(p => p.toLowerCase().endsWith('.md') && !p.startsWith('.sync/') && !LITERAL_PATH_FILES.has(p))

for (const path of staged) {
  const file = join(root, path)
  const before = readFileSync(file, 'utf8')
  const after = normalizeText(before, users)
  if (after !== before) {
    writeFileSync(file, after)
    git(['add', '--', path])
    console.error(`brain: normalised home paths in ${path}`)
  }
}
