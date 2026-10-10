// End-to-end proof of brain-sync, on throwaway directories.
//
// Two machines, one remote, one common snapshot:
//
//   A  - user ndi2,   seeds the repository from the snapshot
//   V  - user vMixer, joins it later with its own diverged copy
//
// The remote is a bare repository on disk. Nothing here runs `git push`: work
// reaches the remote by the remote FETCHING from a machine, which is the same
// transfer without handing push rights to a test. No network is used.
//
//   node .sync/selftest.mjs

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  countOpenRequests, join_, listConflicts, normalizeText, reconcilePushRequests, seed, start,
} from './brain-sync.mjs'

const TOOLING = dirname(dirname(fileURLToPath(import.meta.url)))
// Every DSH home in this test is a fake one; an inherited DSH_HOME would point
// the install and the render at the real harness home.
delete process.env.DSH_HOME
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` - ${detail}`}`)
}
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
const read = (dir, f) => readFileSync(join(dir, f), 'utf8')
const write = (dir, f, s) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), s) }
const append = (dir, f, s) => writeFileSync(join(dir, f), read(dir, f) + s)

// ---------------------------------------------------------------------------
console.log('\n=== 1. home-path normalisation ===')
{
  const users = ['ndi2', 'vMixer']
  const cases = [
    ['C:\\Users\\ndi2\\Documents\\x', '~\\Documents\\x'],
    ['C:/Users/ndi2/.claude/shared-brain/', '~/.claude/shared-brain/'],
    ['"C:\\\\Users\\\\ndi2\\\\.claude\\\\hooks"', '"~\\\\.claude\\\\hooks"'],
    ['/c/Users/ndi2/Documents', '~/Documents'],
    ['c:\\users\\VMIXER\\Documents', '~\\Documents'],
    ['`C:\\Users\\vMixer`', '`~`'],
    ['C:\\Users\\Public\\Desktop', 'C:\\Users\\Public\\Desktop'],
    ['C:\\Users\\ndi2x\\Documents', 'C:\\Users\\ndi2x\\Documents'],
    ['Home is C:\\Users\\vMixer.', 'Home is ~.'],
    ['C:\\Users\\ndi2.old\\x', 'C:\\Users\\ndi2.old\\x'],
    ['C:\\Users\\ndi2-backup', 'C:\\Users\\ndi2-backup'],
    ['projects/C--Users-ndi2-Documents-claudecode', 'projects/C--Users-ndi2-Documents-claudecode'],
  ]
  for (const [input, expected] of cases) {
    const got = normalizeText(input, users)
    check(`${JSON.stringify(input)}`, got === expected, got === expected ? undefined : `got ${JSON.stringify(got)}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. push-queue reconciliation ===')
{
  const queue = [
    '# Push requests', '<!-- REQUESTS BELOW THIS LINE -->', '',
    '## repo-a — main', 'Filed: x', 'Status: open', 'Status: pushed 2026-09-10 by GPT-6', 'Commits: a', '',
    '## repo-b — main', 'Filed: y', 'Status: open', 'Commits: b', '',
    '## repo-c — main', 'Status: pushed once', 'Status: pushed once', '',
    '## C:/Users/vMixer/repo-d — main',
    '## C:/Users/ndi2/repo-d — main', 'Filed: z', 'Status: skipped', '',
  ].join('\n')
  const fixed = reconcilePushRequests(queue)
  check('closed status wins over open', fixed.includes('## repo-a — main\nFiled: x\nStatus: pushed 2026-09-10 by GPT-6\nCommits: a'))
  check('a genuinely open request stays open', fixed.includes('## repo-b — main\nFiled: y\nStatus: open\nCommits: b'))
  check('duplicate identical status collapses', (fixed.match(/Status: pushed once/g) ?? []).length === 1)
  check('count before reconcile ignores a closed-and-open block', countOpenRequests(queue) === 1, String(countOpenRequests(queue)))
  check('count after reconcile', countOpenRequests(fixed) === 1)
  check('a heading stranded by a merge is dropped', !fixed.includes('## C:/Users/vMixer/repo-d') && fixed.includes('## C:/Users/ndi2/repo-d — main\nFiled: z\nStatus: skipped'))
  check('the marker and the text above it survive', fixed.startsWith('# Push requests\n<!-- REQUESTS BELOW THIS LINE -->\n'))
  check('idempotent', reconcilePushRequests(fixed) === fixed)
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. seed, join, and ongoing sync across two machines ===')
const root = mkdtempSync(join(tmpdir(), 'brain-selftest-'))
try {
  const QUEUE_HEAD = '# Push requests\n\n<!-- REQUESTS BELOW THIS LINE -->\n'

  // The snapshot both machines were cloned from, written with ndi2's paths.
  const snap = join(root, 'snapshot')
  write(snap, 'MEMORY.md', '## Git\n- [Push method](git-push-method.md) — PowerShell\n\n## Projects\n- [Green](green.md) — solar\n')
  write(snap, 'shared-agent-log.md', '# Log\n\n## 2026-09-08 — Claude Opus 5\nbase entry\n')
  write(snap, 'push-requests.md', `${QUEUE_HEAD}\n## C:/Users/ndi2/Documents/claudecode/deepseek-harness — feat\nFiled: 2026-09-09\nStatus: open\nCommits: x\n`)
  write(snap, 'git-push-method.md', 'Push from C:\\Users\\ndi2\\Documents\\claudecode with PowerShell.\n')
  write(snap, 'green.md', 'Green energy platform.\nLine two.\n')
  write(snap, 'shared-note.md', 'Original line.\n')
  write(snap, '.rules-drift/codex-old.md', 'drift evidence, never committed\n')

  // Machine A: ndi2, kept working after the clone.
  const A = join(root, 'A', 'shared-brain')
  cpSync(snap, A, { recursive: true })
  append(A, 'shared-agent-log.md', '\n## 2026-09-10 — Claude Opus 5 on A\nA did a thing\n')
  write(A, 'MEMORY.md', read(A, 'MEMORY.md').replace('— PowerShell\n', '— PowerShell\n- [dshklv1](dshklv1.md) — public repo\n'))
  write(A, 'dshklv1.md', 'Checkout at C:\\Users\\ndi2\\Documents\\claudecode\\dsh-council-plugins.\n')
  write(A, 'shared-note.md', 'Original line.\nA added this.\n')

  // Machine V: vMixer. The restore rewrote its paths, and its gatekeeper closed the queue entry.
  const V = join(root, 'V', 'shared-brain')
  cpSync(snap, V, { recursive: true })
  for (const f of ['push-requests.md', 'git-push-method.md']) write(V, f, read(V, f).replaceAll('Users/ndi2', 'Users/vMixer').replaceAll('Users\\ndi2', 'Users\\vMixer'))
  write(V, 'push-requests.md', read(V, 'push-requests.md').replace('Status: open', 'Status: pushed 2026-09-10 by GPT-6 on vMixer'))
  append(V, 'shared-agent-log.md', '\n## 2026-09-10 — GPT-6 on V\nV did a different thing\n')
  write(V, 'MEMORY.md', read(V, 'MEMORY.md').replace('— solar\n', '— solar\n- [Clone](clone.md) — vMixer migration\n'))
  write(V, 'clone.md', 'RUN-ALL lives at G:\\clone. Home is C:\\Users\\vMixer.\n')
  write(V, 'shared-note.md', 'Original line.\nV added something else.\n')
  write(V, 'green.md', 'Green energy platform.\nLine two, edited on V.\n')

  // ---- A seeds --------------------------------------------------------------
  const seeded = seed(A, { snapshot: snap, toolingFrom: TOOLING })
  check('seed: result', seeded.result === 'seeded', JSON.stringify(seeded))
  check('seed: three commits (snapshot, A state, tooling)', git(A, 'rev-list', '--count', 'HEAD').stdout.trim() === '3')
  const rootMsg = git(A, 'log', '--max-parents=0', '--format=%s').stdout.trim()
  check('seed: root commit is the snapshot', /snapshot/.test(rootMsg), rootMsg)
  check('seed: snapshot committed with normalised paths', git(A, 'show', 'HEAD~2:git-push-method.md').stdout.includes('~\\Documents'))
  check('seed: live notes normalised', read(A, 'dshklv1.md').includes('~\\Documents\\claudecode'))
  check('seed: push queue keeps its literal machine paths', git(A, 'show', 'HEAD~2:push-requests.md').stdout.includes('## C:/Users/ndi2/Documents/claudecode/deepseek-harness'))
  check('seed: .rules-drift not tracked', !git(A, 'ls-files').stdout.includes('.rules-drift'))
  check('seed: tooling tracked', git(A, 'ls-files').stdout.includes('.sync/brain-sync.mjs'))
  check('seed: hooksPath set', git(A, 'config', 'core.hooksPath').stdout.trim() === '.sync/hooks')
  check('seed: tree clean', git(A, 'status', '--porcelain').stdout.trim() === '')

  // ---- The remote learns A's history (by fetching, not by A pushing) ---------
  const remote = join(root, 'remote.git')
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  const got = spawnSync('git', ['-C', remote, 'fetch', '-q', A, 'main:main'], { encoding: 'utf8' })
  check('remote received A', got.status === 0, got.stderr.trim())

  // ---- V joins ----------------------------------------------------------------
  const joined = join_(V, { remote, backupRoot: join(root, 'V') })
  check('join: result', joined.result === 'joined', JSON.stringify({ result: joined.result, conflicts: joined.conflicts }))
  check('join: backup kept', existsSync(joined.backup))
  const vLog = read(V, 'shared-agent-log.md')
  check('join: log keeps A entry', vLog.includes('A did a thing'))
  check('join: log keeps V entry', vLog.includes('V did a different thing'))
  check('join: log base entry appears once', (vLog.match(/base entry/g) ?? []).length === 1)
  const vMem = read(V, 'MEMORY.md')
  check('join: index has both new lines', vMem.includes('dshklv1.md') && vMem.includes('clone.md'))
  const vQueue = read(V, 'push-requests.md')
  check('join: queue entry closed by V stays closed', vQueue.includes('Status: pushed 2026-09-10 by GPT-6 on vMixer') && !/^Status: open$/m.test(vQueue), vQueue.split('\n').filter(l => l.startsWith('Status')).join(' | '))
  check('join: queue keeps the literal path that says which machine', vQueue.includes('## C:/Users/vMixer/Documents/claudecode/deepseek-harness') && !vQueue.includes('## ~/'))
  check('join: non-conflicting V edit kept', read(V, 'green.md').includes('edited on V'))
  check('join: A-only note arrived', existsSync(join(V, 'dshklv1.md')))
  check('join: V-only note kept and normalised', read(V, 'clone.md').includes('Home is ~.'))
  check('join: both-edited note keeps V copy in place', read(V, 'shared-note.md').includes('V added something else'))
  const sidecars = listConflicts(V)
  check('join: A copy saved as a tracked sidecar', sidecars.length === 1 && read(V, sidecars[0]).includes('A added this'), sidecars.join(','))
  check('join: sidecar is committed', git(V, 'ls-files', '.sync-conflicts').stdout.trim() !== '')
  check('join: tooling arrived, hooksPath set', existsSync(join(V, '.sync', 'brain-sync.mjs')) && git(V, 'config', 'core.hooksPath').stdout.trim() === '.sync/hooks')
  check('join: tree clean', git(V, 'status', '--porcelain').stdout.trim() === '', git(V, 'status', '--porcelain').stdout)
  check('join: ahead of remote, behind nothing', joined.behind === 0 && joined.ahead > 0, `ahead=${joined.ahead} behind=${joined.behind}`)

  // ---- The remote learns V; A's next session start merges it ----------------
  spawnSync('git', ['-C', remote, 'fetch', '-q', V, 'main:main'])
  append(A, 'shared-agent-log.md', '\n## 2026-09-11 — Claude Opus 5 on A\nwritten between sessions, not yet committed\n')
  write(A, 'late.md', 'Found at C:/Users/ndi2/Downloads during the session.\n')
  git(A, 'remote', 'add', 'origin', remote)
  const sA = start(A, { timeout: 15_000 })
  check('A start: merged', sA.result === 'merged', JSON.stringify({ result: sA.result, reason: sA.reason }))
  check('A start: uncommitted work was committed first', git(A, 'log', '--format=%s').stdout.includes('session changes'))
  check('A start: late note normalised', read(A, 'late.md').includes('~/Downloads'))
  const aLog = read(A, 'shared-agent-log.md')
  check('A start: log has all three entries', aLog.includes('A did a thing') && aLog.includes('V did a different thing') && aLog.includes('written between sessions'))
  check('A start: queue closed on A too', !/^Status: open$/m.test(read(A, 'push-requests.md')))
  check('A start: sidecar visible on A', listConflicts(A).length === 1)
  check('A start: now even or ahead of remote', sA.behind === 0, `ahead=${sA.ahead} behind=${sA.behind}`)
  check('A start: tree clean', git(A, 'status', '--porcelain').stdout.trim() === '')

  // ---- An agent resolves the conflict on A; V picks that up -----------------
  write(A, 'shared-note.md', 'Original line.\nA added this.\nV added something else.\n')
  rmSync(join(A, '.sync-conflicts'), { recursive: true, force: true })
  start(A, { timeout: 15_000 })
  spawnSync('git', ['-C', remote, 'fetch', '-q', A, 'main:main'])
  const sV = start(V, { timeout: 15_000 })
  check('V start: merged the resolution', sV.result === 'merged', sV.result)
  check('V start: sidecar gone on V', listConflicts(V).length === 0)
  check('V start: resolved note has both lines', read(V, 'shared-note.md').includes('A added this') && read(V, 'shared-note.md').includes('V added something else'))

  // ---- Nothing to do ---------------------------------------------------------
  const again = start(V, { timeout: 15_000 })
  check('V start again: up to date', again.result === 'up-to-date', again.result)

  // ---- A manual commit by an agent is normalised by the hook ----------------
  write(V, 'manual.md', 'See C:\\Users\\vMixer\\Desktop\\notes.txt\n')
  git(V, 'add', 'manual.md')
  const hooked = spawnSync('git', ['-C', V, 'commit', '-q', '-m', 'manual'], { encoding: 'utf8' })
  const committedText = git(V, 'show', 'HEAD:manual.md').stdout
  check('pre-commit hook normalised a manual commit', hooked.status === 0 && committedText.includes('~\\Desktop'), hooked.stderr.trim() || committedText.trim())

  // ---- Unreachable remote must not hang a session start ----------------------
  git(V, 'remote', 'set-url', 'origin', 'https://127.0.0.1:9/nothing.git')
  const t0 = Date.now()
  const off = start(V, { timeout: 4000 })
  const took = Date.now() - t0
  check('unreachable remote: reported offline', off.result === 'offline', `${off.result} - ${off.reason}`)
  check('unreachable remote: returned within budget', took < 8000, `${took}ms`)

  // ---- A failed join leaves the brain exactly as it was ----------------------
  const W = join(root, 'W', 'shared-brain')
  cpSync(snap, W, { recursive: true })
  write(W, 'only-w.md', 'W was here. C:\\Users\\ndi2\\x\n')
  const beforeW = read(W, 'only-w.md')
  let threw = false
  try { join_(W, { remote: join(root, 'no-such-remote.git'), backupRoot: join(root, 'W') }) } catch { threw = true }
  check('failed join: threw', threw)
  check('failed join: no .git left behind', !existsSync(join(W, '.git')))
  check('failed join: files untouched (not even normalised)', read(W, 'only-w.md') === beforeW)

  // ---------------------------------------------------------------------------
  console.log('\n=== 4. install and the session-start hook, in a fake home ===')
  const H = join(root, 'home')
  const claudeHome = join(H, '.claude')
  cpSync(V, join(claudeHome, 'shared-brain'), { recursive: true })
  write(claudeHome, 'hooks/dsh-memory-index.mjs', '// the old hook\n')
  write(claudeHome, 'agents/git-gatekeeper.md', '# the old gatekeeper\n')
  const gkDir = join(H, 'Documents', 'Codex', '2026-09-07', 'can-you-check-the-agent-history', 'outputs', 'gatekeeper')
  write(gkDir, 'Gatekeeper.ps1', '# the old monitor\n')
  write(claudeHome, 'settings.json', JSON.stringify({
    model: 'keep-me',
    hooks: { SessionStart: [{ hooks: [
      { type: 'command', command: 'node other-hook.mjs', timeout: 10 },
      { type: 'command', command: `node "${join(claudeHome, 'hooks', 'dsh-memory-index.mjs')}"`, timeout: 10 },
    ] }] },
  }, null, 2))

  const { install } = await import('./brain-sync.mjs')
  const brainH = join(claudeHome, 'shared-brain')
  const first = install(brainH, { claudeHome })
  const settingsAfter = JSON.parse(read(claudeHome, 'settings.json'))
  const hooksAfter = settingsAfter.hooks.SessionStart[0].hooks
  check('install: hook replaced', read(claudeHome, 'hooks/dsh-memory-index.mjs').includes('function syncBrain()'))
  check('install: old hook backed up', first.changes.some(c => c.startsWith('backed up')))
  check('install: memory hook timeout raised', hooksAfter[1].timeout === 45, String(hooksAfter[1].timeout))
  check('install: other hooks untouched', hooksAfter[0].timeout === 10 && settingsAfter.model === 'keep-me')
  check('install: quota handoff hook installed', read(claudeHome, 'hooks/quota-handoff.mjs').includes('QUOTA HANDOFF'))
  check('install: quota handoff wired to UserPromptSubmit and PostToolUse', ['UserPromptSubmit', 'PostToolUse'].every(e =>
    (settingsAfter.hooks[e] ?? []).some(g => g.hooks.some(h => h.command.includes('quota-handoff.mjs')))), JSON.stringify(Object.keys(settingsAfter.hooks)))
  const second = install(brainH, { claudeHome })
  const settingsSecond = JSON.parse(read(claudeHome, 'settings.json'))
  check('install: quota handoff not wired twice', ['UserPromptSubmit', 'PostToolUse'].every(e => settingsSecond.hooks[e].length === 1))

  // The quota hook, fed a fake cache: silent below 95, prepares at 95, finishes at 99, no repeat inside 30 min.
  const quotaRun = (cache, now, session = 's1', transcript) => {
    if (cache === null) rmSync(join(H, 'quota', 'cache.json'), { force: true })
    else write(H, 'quota/cache.json', JSON.stringify(cache))
    const r = spawnSync(process.execPath, [join(claudeHome, 'hooks', 'quota-handoff.mjs')], {
      input: JSON.stringify({ session_id: session, hook_event_name: 'PostToolUse', ...(transcript ? { transcript_path: transcript } : {}) }),
      encoding: 'utf8',
      env: { ...process.env, QUOTA_HANDOFF_CACHE: join(H, 'quota', 'cache.json'), QUOTA_HANDOFF_STATE: join(H, 'quota', 'state.json'), QUOTA_HANDOFF_NOW: String(now), QUOTA_HANDOFF_NO_REFRESH: '1', QUOTA_HANDOFF_HOST: 'testhost' },
      timeout: 20_000,
    })
    try { return { code: r.status, out: JSON.parse(r.stdout) } } catch { return { code: r.status, out: undefined } }
  }
  const qNow = new Date(2026, 8, 12, 13, 0).getTime()
  const qCache = pct => ({ capturedAt: qNow, sessionPercent: pct, sessionResets: 'Sep 12, 2pm', weekPercent: 40, weekResets: 'Sep 15, 1am' })
  const q94 = quotaRun(qCache(94), qNow)
  check('quota hook: silent at 94%', q94.code === 0 && q94.out === undefined)
  const q95 = quotaRun(qCache(95), qNow)
  check('quota hook: prepares at 95%', q95.out?.hookSpecificOutput?.hookEventName === 'PostToolUse' && q95.out.hookSpecificOutput.additionalContext.includes('PREPARE') && Boolean(q95.out.systemMessage))
  check('quota hook: no repeat within 30 min', quotaRun(qCache(96), qNow + 60_000).out === undefined)
  const q99 = quotaRun(qCache(99), qNow + 120_000)
  check('quota hook: finishes at 99%', q99.out?.hookSpecificOutput?.additionalContext.includes('FINISH NOW'))
  // Preparing, the session keeps working, so a second session would collide: pointer yes, chip no.
  check('quota hook: preparing writes the pointer and offers no chip',
    q95.out.hookSpecificOutput.additionalContext.includes('resume-testhost.md')
    && !q95.out.hookSpecificOutput.additionalContext.includes('spawn_task'))
  // Manual Routine (2026-09-29): quota never posts a resume chip; the user runs /quota-handoff.
  check('quota hook: finishing points to /quota-handoff and offers no chip',
    !q99.out?.hookSpecificOutput?.additionalContext.includes('mcp__ccd_session__spawn_task')
    && q99.out.hookSpecificOutput.additionalContext.includes('/quota-handoff'))
  check('quota hook: repeats after 30 min', quotaRun(qCache(99), qNow + 120_000 + 31 * 60_000).out?.hookSpecificOutput !== undefined)
  check('quota hook: another session is told separately', quotaRun(qCache(95), qNow + 60_000, 's2').out !== undefined)
  check('quota hook: figures from before the reset are ignored', quotaRun(qCache(99), new Date(2026, 8, 12, 14, 5).getTime(), 's3').out === undefined)
  check('quota hook: weekly quota counts too', quotaRun({ ...qCache(10), weekPercent: 97 }, qNow, 's4').out?.hookSpecificOutput?.additionalContext.includes('97% week'))
  check('quota hook: the weekly stop offers no chip either', (() => { const c = quotaRun({ ...qCache(10), weekPercent: 98 }, qNow, 's4b').out?.hookSpecificOutput?.additionalContext ?? ''
    return c !== '' && !c.includes('mcp__ccd_session__spawn_task') })())
  check('quota hook: missing cache is silent without another trigger', quotaRun(null, qNow, 's5').out === undefined)
  const transcript = join(H, 'quota', 'session.jsonl')
  write(H, 'quota/session.jsonl', [
    JSON.stringify({ timestamp: new Date(qNow - 5 * 60 * 60 * 1000).toISOString(), type: 'user' }),
    JSON.stringify({ timestamp: new Date(qNow).toISOString(), message: { usage: { input_tokens: 25_000, cache_read_input_tokens: 85_000 } } }),
  ].join('\n'))
  const qLong = quotaRun(qCache(10), qNow, 's6', transcript)
  check('quota hook: four-hour or 100k context checkpoint', qLong.out?.hookSpecificOutput?.additionalContext.includes('PREPARE') && /110k-token|5\.0-hour/.test(qLong.out.hookSpecificOutput.additionalContext))
  write(H, 'quota/session.jsonl', [
    JSON.stringify({ timestamp: new Date(qNow - 9 * 60 * 60 * 1000).toISOString(), type: 'user' }),
    JSON.stringify({ timestamp: new Date(qNow).toISOString(), message: { usage: { input_tokens: 50_000, cache_read_input_tokens: 110_000 } } }),
  ].join('\n'))
  const qHard = quotaRun(qCache(10), qNow, 's7', transcript)
  check('quota hook: eight-hour or 150k context finishes handoff', qHard.out?.hookSpecificOutput?.additionalContext.includes('FINISH NOW'))
  // Context counts growth above the first reading: a 78k start is not work done.
  const grown = (latest) => write(H, 'quota/session.jsonl', [
    JSON.stringify({ timestamp: new Date(qNow - 60 * 60 * 1000).toISOString(), message: { usage: { input_tokens: 2, cache_creation_input_tokens: 78_000 } } }),
    JSON.stringify({ timestamp: new Date(qNow).toISOString(), message: { usage: { input_tokens: 2, cache_read_input_tokens: latest } } }),
  ].join('\n'))
  grown(150_000)
  check('quota hook: a 78k start plus 72k of work is silent', quotaRun(qCache(10), qNow, 's8', transcript).out === undefined)
  grown(180_000)
  const qGrown = quotaRun(qCache(10), qNow, 's9', transcript)
  check('quota hook: 100k above the start checkpoints', qGrown.out?.hookSpecificOutput?.additionalContext.includes('PREPARE') && qGrown.out.hookSpecificOutput.additionalContext.includes('102k above its 78k start'))
  check('quota hook: the note is capped and the log appended unread', qGrown.out?.hookSpecificOutput?.additionalContext.includes('at most 60 lines') && qGrown.out.hookSpecificOutput.additionalContext.includes('never reading the log'))
  check('install: gatekeeper definition installed from the brain', read(claudeHome, 'agents/git-gatekeeper.md').includes('## The shared brain') && read(claudeHome, 'agents/git-gatekeeper.md').includes('Only act on this machine'))
  check('install: old gatekeeper definition backed up', first.changes.some(c => c.startsWith('backed up git-gatekeeper.md')))
  check('install: PowerShell gatekeeper skips other machines\' requests', read(gkDir, 'Gatekeeper.ps1').includes('function Test-OtherMachine') && read(gkDir, 'queue-build.mjs').includes('Host: ${hostname().toLowerCase()}'))
  check('install: gatekeeper resolves the current machine home and marks each repository safe', read(gkDir, 'Gatekeeper.ps1').includes('function Resolve-LocalRepoPath') && read(gkDir, 'Gatekeeper.ps1').includes('safe.directory=$safeRepo') && read(gkDir, 'queue-build.mjs').includes('resolveLocalRepo'))
  check('install: continuous listener starts the brain and gatekeeper from machine-local paths', read(join(H, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), 'Shared-Agent-Listeners.cmd').includes('%USERPROFILE%\\.claude\\hooks\\SharedBrainListener.ps1'))
  check('install: old PowerShell gatekeeper backed up', first.changes.some(c => c.startsWith('backed up Gatekeeper.ps1')))
  const noGkHome = join(root, 'home-no-gatekeeper', '.claude')
  mkdirSync(noGkHome, { recursive: true })
  install(brainH, { claudeHome: noGkHome })
  check('install: no PowerShell gatekeeper is created where none was installed', !existsSync(join(root, 'home-no-gatekeeper', 'Documents')))
  check('install: no Desktop updater where DSH or a Desktop is missing', !existsSync(join(root, 'home-no-gatekeeper', 'Desktop', 'UPDATE-DSH.cmd')))
  const deskHome = join(root, 'home-desktop')
  mkdirSync(join(deskHome, 'Desktop'), { recursive: true })
  mkdirSync(join(deskHome, '.dsh'), { recursive: true })
  const deskOpts = { claudeHome: join(deskHome, '.claude'), dshHome: join(deskHome, '.dsh') }
  mkdirSync(deskOpts.claudeHome, { recursive: true })
  write(deskOpts.dshHome, 'fcc-control.ps1', "$FccDir = 'C:\\old\\free-claude-code'\n")
  const withDesktop = install(brainH, deskOpts)
  check('install: no FCC controller or monitor where DSH is missing', !existsSync(join(root, 'home-no-gatekeeper', '.dsh')))
  check('install: FCC controller shipped into the DSH home with the catalog timeout fix', read(deskOpts.dshHome, 'fcc-control.ps1').includes('FCC_CATALOG_TIMEOUT_SEC') && read(deskOpts.dshHome, 'fcc-control.ps1').includes('-TimeoutSec $CatalogTimeoutSec') && !read(deskOpts.dshHome, 'fcc-control.ps1').includes('ndi2'), JSON.stringify(withDesktop.changes))
  check('install: FCC monitor shipped into the DSH home with the cool-down fix', read(deskOpts.dshHome, 'fcc-session.cjs').includes('cooldownTicks'))
  check('install: old FCC controller backed up before it is replaced', withDesktop.changes.some(c => c.startsWith('backed up fcc-control.ps1')) && readdirSync(deskOpts.dshHome).some(f => f.startsWith('fcc-control.ps1.pre-brain-sync-')))
  check('install: FCC files not rewritten when unchanged', !install(brainH, deskOpts).changes.some(c => c.includes('fcc-')))
  check('install: Desktop updater placed where DSH is installed', existsSync(join(deskHome, 'Desktop', 'UPDATE-DSH.cmd')) && read(join(deskHome, 'Desktop'), 'UPDATE-DSH.cmd').includes('UPDATE-DSH.cmd" %*'), JSON.stringify(withDesktop.changes))
  check('install: Desktop updater not rewritten when unchanged', !install(brainH, deskOpts).changes.some(c => c.includes('UPDATE-DSH')))
  check('install: second run changes nothing', second.result === 'already-installed', JSON.stringify(second.changes))
  writeFileSync(join(claudeHome, 'hooks', 'dsh-memory-index.mjs'), read(claudeHome, 'hooks/dsh-memory-index.mjs').replace(/\r?\n/g, '\r\n'))
  const crlf = install(brainH, { claudeHome })
  check('install: a line-ending-only difference is not a change', crlf.result === 'already-installed', JSON.stringify(crlf.changes))

  // A resume pointer of this machine's own, as the quota hook has a session
  // running out of context leave behind.
  const resumeHost = hostname().toLowerCase()
  const pointer = (updated) => [
    '---', `name: resume-${resumeHost}`, 'description: pointer', 'metadata:', '  type: project', '---', '',
    'Handoff: handoff-2026-09-12-1300-unfinished.md', 'Topic: the unfinished thing',
    `Updated: ${updated}`, 'Session: s1', 'Next: finish the unfinished thing',
  ].join('\n')
  const today = new Date().toISOString().slice(0, 10)
  write(brainH, 'handoff-2026-09-12-1300-unfinished.md', 'the note body\n')
  write(brainH, `resume-${resumeHost}.md`, pointer(`${today} 09:00`))

  // Run the installed hook exactly as Claude Code would: stdin JSON, home redirected.
  const indexHook = () => spawnSync(process.execPath, [join(claudeHome, 'hooks', 'dsh-memory-index.mjs')], {
    input: JSON.stringify({ cwd: join(H, 'Documents', 'some-project') }),
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: H, HOME: H },
    timeout: 60_000,
  })
  const contextOf = (run) => { try { return JSON.parse(run.stdout).hookSpecificOutput.additionalContext } catch { return '' } }
  const hookRun = indexHook()
  const ctx = contextOf(hookRun)
  check('hook: emits context', ctx.length > 0, hookRun.stderr.trim().slice(0, 200) || undefined)
  // Auto memory loads MEMORY.md through the junction, so the hook does not send it twice.
  check('hook: does not repeat the index auto memory already loads', !ctx.includes('clone.md') && ctx.includes('already in context through auto memory'), ctx.slice(0, 400))
  const noAuto = spawnSync(process.execPath, [join(claudeHome, 'hooks', 'dsh-memory-index.mjs')], {
    input: JSON.stringify({ cwd: join(H, 'Documents', 'some-project') }), encoding: 'utf8',
    env: { ...process.env, USERPROFILE: H, HOME: H, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }, timeout: 60_000,
  })
  check('hook: injects the whole index when auto memory is off', contextOf(noAuto).includes('clone.md'))
  check('hook: tells the session about ~', ctx.includes('write home paths as `~`'))
  check('hook: reports the unreachable remote', /could not reach the remote/.test(ctx))
  check('hook: reports unpushed commits', /commits? the remote does not/.test(ctx))
  check('hook: no phantom push request', !/requests? waiting/.test(ctx))
  check('hook: names the resume pointer left on this machine', ctx.includes('Unfinished work on this machine: the unfinished thing')
    && ctx.includes('handoff-2026-09-12-1300-unfinished.md') && ctx.includes('finish the unfinished thing'), ctx.slice(-400))
  // A pointer whose note is gone, or that nobody has touched in a week, is worse
  // than none: it sends the session to work that has already moved on.
  write(brainH, `resume-${resumeHost}.md`, pointer('2026-01-01 09:00'))
  check('hook: a stale pointer says nothing', !contextOf(indexHook()).includes('Unfinished work on this machine'))
  write(brainH, `resume-${resumeHost}.md`, pointer(`${today} 09:00`).replace('handoff-2026-09-12-1300-unfinished.md', 'handoff-gone.md'))
  check('hook: a pointer to a missing note says nothing', !contextOf(indexHook()).includes('Unfinished work on this machine'))
  check('hook: sync actually ran', JSON.parse(read(brainH, '.sync-state/last.json')).result === 'offline')

  // ---------------------------------------------------------------------------
  console.log('\n=== 5. the pre-push gate ===')
  const { verifyPublish } = await import('./brain-sync.mjs')
  const cleanProblems = verifyPublish(A, 'HEAD')
  check('gate: a clean brain passes', cleanProblems.length === 0, cleanProblems.join(' | ') || undefined)
  const commitRaw = (dir, file, content, msg) => { write(dir, file, content); git(dir, 'add', file); git(dir, 'commit', '--no-verify', '-q', '-m', msg) }
  const runHook = (dir, sha) => spawnSync(process.execPath, [join(dir, '.sync', 'hooks', 'pre-push.mjs'), 'origin', 'x'], {
    cwd: dir, input: `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`, encoding: 'utf8',
  })
  const clean = git(A, 'rev-parse', 'HEAD').stdout.trim()
  const hookClean = runHook(A, clean)
  check('gate hook: clean push allowed', hookClean.status === 0, hookClean.stderr.trim())

  commitRaw(A, 'leaky.md', ['Checkout at C:', 'Users', 'vMixer', 'Documents', 'x'].join('\\') + '\n', 'bypass the normaliser')
  const leaky = verifyPublish(A, 'HEAD')
  check('gate: home path in a note refused', leaky.some(p => p.startsWith('leaky.md') && p.includes('home folder')), leaky.join(' | '))
  const hookLeaky = runHook(A, git(A, 'rev-parse', 'HEAD').stdout.trim())
  check('gate hook: refuses and says why', hookLeaky.status === 1 && hookLeaky.stderr.includes('leaky.md: names a home folder'), hookLeaky.stderr.trim())
  git(A, 'reset', '-q', '--hard', clean)

  const fakeKey = ['sk', 'or', 'v1', 'a'.repeat(64)].join('-')
  commitRaw(A, 'oops.md', `key: ${fakeKey}\n`, 'a credential')
  check('gate: credential shape refused', verifyPublish(A, 'HEAD').some(p => p.startsWith('oops.md') && p.includes('credential')))
  git(A, 'reset', '-q', '--hard', clean)

  commitRaw(A, 'shared-note.md', 'Original line.\n' + '<'.repeat(7) + ' HEAD\nmine\n=======\ntheirs\n' + '>'.repeat(7) + ' remote\n', 'a botched merge')
  check('gate: conflict marker refused', verifyPublish(A, 'HEAD').some(p => p.startsWith('shared-note.md') && p.includes('conflict')))
  git(A, 'reset', '-q', '--hard', clean)

  check('gate: literal paths in the push queue are allowed', read(A, 'push-requests.md').includes('C:/Users/') && verifyPublish(A, 'HEAD').length === 0)
  check('gate: hook is where both gatekeepers look for it', git(A, 'rev-parse', '--git-path', 'hooks/pre-push').stdout.trim().split('\\').join('/').endsWith('.sync/hooks/pre-push'))

  // ---------------------------------------------------------------------------
  console.log('\n=== 6. DSH: the generated AGENTS.md and the launcher, in a fake home ===')
  const { renderDsh } = await import('./brain-sync.mjs')
  const dshHome = join(H, '.dsh')
  const agentsPath = join(dshHome, 'AGENTS.md')
  write(claudeHome, 'CLAUDE.md', '# Standing context\r\n\r\n- **Rule one.** Do the thing.\r\n')
  const noDsh = renderDsh(brainH, { claudeHome })
  check('dsh: no DSH on the machine, nothing written', noDsh.status === 'no-dsh' && !existsSync(dshHome), noDsh.status)

  write(dshHome, 'launch-dsh.cmd', ['@echo off', 'title DSH', 'cd /d "D:\\harness"', '', 'echo.', 'echo Starting DSH...', 'echo.', '', 'node "%~dp0fcc-session.cjs" %*', 'set CODE=%ERRORLEVEL%', 'exit /b %CODE%', ''].join('\r\n'))
  const created = renderDsh(brainH, { claudeHome })
  const agents = readFileSync(agentsPath, 'utf8')
  check('dsh: AGENTS.md created in the DSH home', created.status === 'created', created.status)
  check('dsh: carries the standing rules verbatim', agents.includes('- **Rule one.** Do the thing.'))
  check('dsh: carries the brain index', agents.includes('clone.md'))
  check('dsh: names the store by its real path', agents.includes(`Store: ${brainH.split('\\').join('/')}`))
  check('dsh: read and sign the log, never push', agents.includes('shared-agent-log.md') && agents.includes('model name') && agents.includes('Never run `git push`'))
  check('dsh: line endings normalised', !agents.includes('\r'))
  check('dsh: second render is in sync', renderDsh(brainH, { claudeHome }).status === 'in-sync')

  writeFileSync(agentsPath, `${agents.replace('Do the thing.', 'Hand-edited.')}\nMy own note after the block.\n`)
  const reverted = renderDsh(brainH, { claudeHome })
  const agents2 = readFileSync(agentsPath, 'utf8')
  check('dsh: an edit inside the markers is reverted', reverted.status === 'rewritten' && agents2.includes('Do the thing.') && !agents2.includes('Hand-edited.'), reverted.status)
  check('dsh: text outside the markers is kept', agents2.includes('My own note after the block.'))
  append(brainH, 'MEMORY.md', '- [Late note](late-note.md) - arrived from the other machine\n')
  const lateRender = renderDsh(brainH, { claudeHome })
  check('dsh: a new index line reaches DSH', lateRender.status === 'rewritten' && readFileSync(agentsPath, 'utf8').includes('late-note.md'), lateRender.status)
  writeFileSync(agentsPath, "# Someone's own AGENTS.md\n")
  const adopted = renderDsh(brainH, { claudeHome })
  const agents3 = readFileSync(agentsPath, 'utf8')
  check('dsh: an unmarked AGENTS.md keeps its text and gains the section', adopted.status === 'rewritten' && agents3.startsWith("# Someone's own AGENTS.md") && agents3.includes('BEGIN SHARED-BRAIN'))
  check('dsh: an unmarked AGENTS.md is backed up first', readdirSync(dshHome).some(f => f.startsWith('AGENTS.md.pre-brain-sync-')))

  const wired = install(brainH, { claudeHome })
  const launchText = readFileSync(join(dshHome, 'launch-dsh.cmd'), 'utf8')
  const launchLines = launchText.split('\r\n')
  const syncAt = launchLines.findIndex(l => l.includes('brain-sync.mjs" dsh'))
  const startAt = launchLines.findIndex(l => l.startsWith('node "%~dp0fcc-session.cjs"'))
  check('install: launcher syncs the brain before DSH starts', syncAt !== -1 && syncAt < startAt, `${syncAt} < ${startAt}`)
  check('install: launcher keeps its CRLF line endings', !/[^\r]\n/.test(launchText))
  check('install: launcher backed up and reported', wired.changes.some(c => c.includes('launch-dsh.cmd')) && readdirSync(dshHome).some(f => f.startsWith('launch-dsh.cmd.pre-brain-sync-')), JSON.stringify(wired.changes))
  const rewired = install(brainH, { claudeHome })
  check('install: second run leaves DSH alone', rewired.result === 'already-installed', JSON.stringify(rewired.changes))

  // The CLI exactly as the patched launcher runs it, with the home redirected.
  append(brainH, 'MEMORY.md', '- [Launch note](launch-note.md) - written between DSH launches\n')
  const launchRun = spawnSync(process.execPath, [join(brainH, '.sync', 'brain-sync.mjs'), 'dsh', '--dir', brainH, '--timeout', '2000'], {
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: H, HOME: H },
    timeout: 60_000,
  })
  let launched = {}
  try { launched = JSON.parse(launchRun.stdout) } catch {}
  check('dsh cli: exit 0', launchRun.status === 0, launchRun.stderr.trim().slice(0, 200) || undefined)
  check('dsh cli: synced before rendering', launched.sync === 'offline', launched.sync)
  check('dsh cli: the new note reached AGENTS.md', readFileSync(agentsPath, 'utf8').includes('launch-note.md'))

  // ---------------------------------------------------------------------------
  console.log('\n=== 7. DSH saved runs and remembered facts reach the brain ===')
  const { collectDsh, dshFactId } = await import('./brain-sync.mjs')
  const runId = '11111111-2222-4333-8444-555555555555'
  write(dshHome, `council-runs/${runId}.json`, JSON.stringify({
    id: runId,
    query: 'Check the pipeline end to end\n on a small task',
    at: Date.UTC(2026, 8, 11, 9, 30),
    seatIds: ['claude', 'kimi'],
    amendments: 1,
    drafts: [{ seat: 'claude', text: 'a draft' }, { seat: 'kimi', text: '', error: 'timeout' }],
    reviews: [{ seat: 'claude', text: 'ok' }],
  }))
  write(dshHome, 'council-runs/broken.json', '{ not json')
  write(dshHome, 'memory/digest.md', ['# Shared agent memory', '', '## fact', '', '- The council runs a planning round first. _(council, cost)_', `- The harness is at ${['C:', 'Users', 'ndi2', 'Documents', 'claudecode'].join('\\')}.`, '', '## preference', '', '- Budget is $60 a month.', ''].join('\n'))

  const collected = collectDsh(brainH, { dshHome, machine: 'VMIXER2O2' })
  const runsNote = read(brainH, 'dsh-runs.md')
  const factsNote = read(brainH, 'dsh-memory.md')
  const factId = dshFactId('The council runs a planning round first.')
  check('dsh state: one run and three facts collected', collected.runs === 1 && collected.facts === 3, JSON.stringify(collected))
  check('dsh state: a fact naming a home folder is written with ~', factsNote.includes('The harness is at ~\\Documents\\claudecode.') && !factsNote.includes('Users\\ndi2'), factsNote.split('\n').find(l => l.includes('The harness is at')))
  check('dsh state: the run line carries machine, seats, drafts and amendments', runsNote.includes(`- 2026-09-11 09:30Z on VMIXER2O2 - "Check the pipeline end to end on a small task" - seats: claude kimi; drafts 1/2; reviews 1; amendments 1 <!-- dsh-run id=${runId} machine=VMIXER2O2 -->`), runsNote.split('\n').filter(l => l.startsWith('- ')).join(' | '))
  check('dsh state: an unreadable record is skipped, not fatal', !runsNote.includes('broken'))
  check('dsh state: facts keep their kind, tags and DSH id', factsNote.includes(`- [fact] The council runs a planning round first. _(council, cost)_ - remembered on VMIXER2O2 <!-- dsh-fact id=${factId} machine=VMIXER2O2 -->`) && factsNote.includes('- [preference] Budget is $60 a month.'))
  check('dsh state: both notes reach the index', read(brainH, 'MEMORY.md').includes('(dsh-runs.md)') && read(brainH, 'MEMORY.md').includes('(dsh-memory.md)'))
  const recollected = collectDsh(brainH, { dshHome, machine: 'VMIXER2O2' })
  check('dsh state: a second collection adds nothing', recollected.runs === 0 && recollected.facts === 0, JSON.stringify(recollected))
  check('dsh state: the index is not duplicated', (read(brainH, 'MEMORY.md').match(/\(dsh-runs\.md\)/g) ?? []).length === 1)
  const fromElsewhere = collectDsh(brainH, { dshHome, machine: 'OTHERBOX' })
  check('dsh state: the same run and fact from another machine is not doubled', fromElsewhere.runs === 0 && fromElsewhere.facts === 0, JSON.stringify(fromElsewhere))

  // The same fact, remembered on a machine with a different user folder. Its
  // raw digest text differs, so an id taken before normalisation diverges and
  // the fact lands twice - identical on screen, because the line is normalised
  // as it is written. This is what happened between the laptop and vmixer2o2.
  write(dshHome, 'memory/digest.md', ['# Shared agent memory', '', '## fact', '', `- The harness is at ${['C:', 'Users', 'vMixer', 'Documents', 'claudecode'].join('\\')}.`, ''].join('\n'))
  const otherHome = collectDsh(brainH, { dshHome, machine: 'OTHERBOX' })
  check('dsh state: one fact naming two different home folders stays one line', otherHome.facts === 0, JSON.stringify(otherHome))
  check('dsh state: and it is still there once', (read(brainH, 'dsh-memory.md').match(/The harness is at ~/g) ?? []).length === 1)

  // Two machines appending runs at the same time: the union driver keeps both.
  write(A, 'dsh-runs.md', `# DSH saved runs\n\n${'<!-- ENTRIES BELOW THIS LINE -->'}\n\n- the run that was already there <!-- dsh-run id=base -->\n`)
  git(A, 'add', 'dsh-runs.md')
  git(A, 'commit', '--no-verify', '-q', '-m', 'dsh runs note')
  git(A, 'checkout', '-q', '-b', 'machine-v')
  append(A, 'dsh-runs.md', '- a run saved on V <!-- dsh-run id=onV -->\n')
  git(A, 'add', 'dsh-runs.md')
  git(A, 'commit', '--no-verify', '-q', '-m', 'V saved a run')
  git(A, 'checkout', '-q', 'main')
  append(A, 'dsh-runs.md', '- a run saved on A <!-- dsh-run id=onA -->\n')
  git(A, 'add', 'dsh-runs.md')
  git(A, 'commit', '--no-verify', '-q', '-m', 'A saved a run')
  const unionMerge = git(A, 'merge', '-q', '--no-edit', 'machine-v')
  const mergedRuns = read(A, 'dsh-runs.md')
  check('dsh state: a union merge keeps both machines\' run lines', unionMerge.status === 0 && mergedRuns.includes('id=onV') && mergedRuns.includes('id=onA') && mergedRuns.includes('id=base'), unionMerge.stderr.trim() || mergedRuns.replace(/\n/g, ' | '))
  check('dsh state: the notes pass the pre-push gate', verifyPublish(A, 'HEAD').length === 0, verifyPublish(A, 'HEAD').join(' | '))

  // ---------------------------------------------------------------------------
  console.log('\n=== 8. DSH saved runs and credentials travel between machines ===')
  const { syncDshPresets, syncDshCredentials, readPresetChunks, sealCredentials, openCredentials } = await import('./brain-sync.mjs')
  const shareBrain = join(root, 'share-brain')
  mkdirSync(shareBrain, { recursive: true })
  const laptop = join(root, 'laptop')
  const server = join(root, 'server')
  const laptopDsh = join(laptop, '.dsh')
  const serverDsh = join(server, '.dsh')
  const settingsWith = presets => ['ui-onboarding:', '  done: true', 'council:', '  seats: []', ...(presets.length > 0 ? ['  pipelinePresets:', ...presets] : []), '  pendingPlanId: "keep-me"', 'ui-theme: dark', ''].join('\n')
  write(laptopDsh, 'settings.yaml', settingsWith([
    '    dsh/pipeline-smoke:', '      name: Pipeline smoke', `      query: 'Check ${['C:', 'Users', 'ndi2', 'Documents'].join('\\')} end to end'`, '      autoAdvance: false',
    '    leadforge/council-run:', '      name: LeadForge', '      query: |-', '        line one', '', '        line three', '      stages: council,review',
  ]))
  write(serverDsh, 'settings.yaml', settingsWith(['    apps/debug-plan:', '      name: Debug plan', '      query: >-', '        fold me', '      autoAdvance: false']))

  const up = syncDshPresets(shareBrain, { dshHome: laptopDsh, stamp: 't1' })
  check('saved runs: the laptop shares both of its runs', up.pushed.length === 2 && existsSync(join(shareBrain, 'dsh-presets', 'leadforge', 'council-run.yaml')), JSON.stringify(up))
  check('saved runs: a home folder in a run is written as ~', read(shareBrain, 'dsh-presets/dsh/pipeline-smoke.yaml').includes("'Check ~\\Documents end to end'"))
  const down = syncDshPresets(shareBrain, { dshHome: serverDsh, stamp: 't2' })
  const serverSettings = read(serverDsh, 'settings.yaml')
  check('saved runs: the server receives the laptop runs and shares its own', down.pulled.length === 2 && down.pushed.join() === 'apps/debug-plan' && readPresetChunks(serverSettings).chunks.size === 3, JSON.stringify(down))
  check('saved runs: a block scalar with a blank line arrives whole', serverSettings.includes('      query: |-\n        line one\n\n        line three\n      stages: council,review'))
  check('saved runs: the rest of settings.yaml is untouched', serverSettings.startsWith('ui-onboarding:\n  done: true\ncouncil:\n  seats: []\n  pipelinePresets:\n') && serverSettings.endsWith('  pendingPlanId: "keep-me"\nui-theme: dark\n'), JSON.stringify(serverSettings))
  check('saved runs: settings.yaml is backed up before the edit', existsSync(join(serverDsh, 'settings.yaml.pre-brain-sync-t2')))
  const back = syncDshPresets(shareBrain, { dshHome: laptopDsh, stamp: 't3' })
  check('saved runs: the server run reaches the laptop', back.pulled.join() === 'apps/debug-plan' && readPresetChunks(read(laptopDsh, 'settings.yaml')).chunks.has('apps/debug-plan'), JSON.stringify(back))
  const still = syncDshPresets(shareBrain, { dshHome: laptopDsh, stamp: 't4' })
  check('saved runs: a second sync changes nothing', still.pushed.length === 0 && still.pulled.length === 0, JSON.stringify(still))
  write(serverDsh, 'settings.yaml', read(serverDsh, 'settings.yaml').replace('      name: Debug plan', '      name: Debug plan v2'))
  const edited = syncDshPresets(shareBrain, { dshHome: serverDsh, stamp: 't5' })
  const editArrived = syncDshPresets(shareBrain, { dshHome: laptopDsh, stamp: 't6' })
  check('saved runs: an edit on one machine replaces the run on the other', edited.pushed.join() === 'apps/debug-plan' && editArrived.pulled.join() === 'apps/debug-plan' && read(laptopDsh, 'settings.yaml').includes('name: Debug plan v2') && !read(laptopDsh, 'settings.yaml').includes('name: Debug plan\n'), JSON.stringify({ edited, editArrived }))
  const freshDsh = join(root, 'fresh', '.dsh')
  write(freshDsh, 'settings.yaml', 'council:\n  seats: []\nui-theme: dark\n')
  syncDshPresets(shareBrain, { dshHome: freshDsh, stamp: 't7' })
  check('saved runs: a machine with none gets the block created under council', readPresetChunks(read(freshDsh, 'settings.yaml')).chunks.size === 3 && read(freshDsh, 'settings.yaml').endsWith('  seats: []\nui-theme: dark\n'), JSON.stringify(read(freshDsh, 'settings.yaml')))

  // Deletes and renames travel; the brain must not hand a deleted run back.
  const { removePresetChunks } = await import('./brain-sync.mjs')
  syncDshPresets(shareBrain, { dshHome: serverDsh, stamp: 't8' })
  write(laptopDsh, 'settings.yaml', removePresetChunks(read(laptopDsh, 'settings.yaml'), ['apps/debug-plan']))
  const deleted = syncDshPresets(shareBrain, { dshHome: laptopDsh, stamp: 't9' })
  check('saved runs: a run deleted on the laptop leaves the brain', deleted.unshared.join() === 'apps/debug-plan' && deleted.pulled.length === 0 && !existsSync(join(shareBrain, 'dsh-presets', 'apps')), JSON.stringify(deleted))
  const deleteArrived = syncDshPresets(shareBrain, { dshHome: serverDsh, stamp: 't10' })
  check('saved runs: and the server deletes it too, backing up first', deleteArrived.removed.join() === 'apps/debug-plan' && !readPresetChunks(read(serverDsh, 'settings.yaml')).chunks.has('apps/debug-plan') && existsSync(join(serverDsh, 'settings.yaml.pre-brain-sync-t10')), JSON.stringify(deleteArrived))
  check('saved runs: the rest of the server settings survive the delete', read(serverDsh, 'settings.yaml').endsWith('  pendingPlanId: "keep-me"\nui-theme: dark\n') && readPresetChunks(read(serverDsh, 'settings.yaml')).chunks.size === 2)
  const stayGone = syncDshPresets(shareBrain, { dshHome: laptopDsh, stamp: 't11' })
  check('saved runs: the deleted run does not come back', stayGone.pulled.length === 0 && !readPresetChunks(read(laptopDsh, 'settings.yaml')).chunks.has('apps/debug-plan'), JSON.stringify(stayGone))

  const renamedText = read(laptopDsh, 'settings.yaml').replace('    leadforge/council-run:', '    leadforge/council-run-2:')
  write(laptopDsh, 'settings.yaml', renamedText)
  const renamed = syncDshPresets(shareBrain, { dshHome: laptopDsh, stamp: 't12' })
  const renameArrived = syncDshPresets(shareBrain, { dshHome: serverDsh, stamp: 't13' })
  const serverIds = [...readPresetChunks(read(serverDsh, 'settings.yaml')).chunks.keys()].sort().join()
  check('saved runs: a rename moves the run on both machines', renamed.unshared.join() === 'leadforge/council-run' && renamed.pushed.join() === 'leadforge/council-run-2' && renameArrived.removed.join() === 'leadforge/council-run' && renameArrived.pulled.join() === 'leadforge/council-run-2' && serverIds === 'dsh/pipeline-smoke,leadforge/council-run-2', JSON.stringify({ renamed, renameArrived, serverIds }))

  write(laptopDsh, 'settings.yaml', removePresetChunks(read(laptopDsh, 'settings.yaml'), ['dsh/pipeline-smoke']))
  write(serverDsh, 'settings.yaml', read(serverDsh, 'settings.yaml').replace('      name: Pipeline smoke', '      name: Pipeline smoke v2'))
  syncDshPresets(shareBrain, { dshHome: serverDsh, stamp: 't14' })
  const editWins = syncDshPresets(shareBrain, { dshHome: laptopDsh, stamp: 't15' })
  check('saved runs: an edit elsewhere wins over a delete here', editWins.pulled.join() === 'dsh/pipeline-smoke' && editWins.unshared.length === 0 && read(laptopDsh, 'settings.yaml').includes('name: Pipeline smoke v2'), JSON.stringify(editWins))

  const emptied = removePresetChunks(settingsWith(['    a/b:', '      name: B', '      query: q']), ['a/b'])
  check('saved runs: removing the last run leaves an empty map, not null', emptied.includes('  pipelinePresets: {}\n  pendingPlanId: "keep-me"') && readPresetChunks(emptied).chunks.size === 0, JSON.stringify(emptied))

  const keyHex = 'ab'.repeat(32)
  const laptopClaude = join(laptop, '.claude')
  const serverClaude = join(server, '.claude')
  write(laptop, 'Desktop/CLONE-KEY.txt', `Clone bundle key\n\n${keyHex}\n`)
  const orKey = ['sk', 'or', 'v1', 'f'.repeat(64)].join('-')
  const searchKey = ['srch', 'a'.repeat(40)].join('-')
  write(laptopDsh, '.credentials.yaml', `version: 1\nrefs:\n  FCC_DSH_API_KEY: laptop-fcc\n  SEARCH_API_KEY: ${searchKey}\n  OPENROUTER_API_KEY: ${orKey}\n  OPENROUTER_RELAY_TOKEN: laptop-relay-token\n`)
  write(serverDsh, '.credentials.yaml', 'version: 1\nrefs:\n  FCC_DSH_API_KEY: server-fcc\n')
  const sealed = syncDshCredentials(shareBrain, { dshHome: laptopDsh, claudeHome: laptopClaude, stamp: 'c1' })
  const blob = read(shareBrain, 'dsh-credentials.enc')
  check('credentials: the laptop seals its shareable refs into the brain', sealed.status === 'synced' && sealed.blobWritten && sealed.pushed.sort().join() === 'FCC_DSH_API_KEY,SEARCH_API_KEY', JSON.stringify(sealed))
  check('credentials: CLONE-KEY.txt is kept as the brain key', sealed.keyCopied && read(laptopClaude, 'brain-secrets.key').trim() === keyHex)
  check('credentials: the blob holds no name or value in the clear', !blob.includes(orKey) && !blob.includes('laptop-fcc') && !blob.includes('SEARCH'))
  const sealedRefs = Object.keys(openCredentials(Buffer.from(keyHex, 'hex'), blob)?.refs ?? {})
  check('credentials: the OpenRouter key and relay token are never sealed', sealedRefs.length === 2 && !sealedRefs.some(name => name.startsWith('OPENROUTER')), JSON.stringify(sealedRefs))
  const locked = syncDshCredentials(shareBrain, { dshHome: serverDsh, claudeHome: serverClaude })
  check('credentials: a machine without the key is told, and nothing changes', locked.status === 'no-key' && !read(serverDsh, '.credentials.yaml').includes('OPENROUTER'), JSON.stringify(locked))
  write(serverClaude, 'brain-secrets.key', `${'cd'.repeat(32)}\n`)
  check('credentials: a wrong key is refused', syncDshCredentials(shareBrain, { dshHome: serverDsh, claudeHome: serverClaude }).status === 'unreadable')
  write(serverClaude, 'brain-secrets.key', `${keyHex}\n`)
  const opened = syncDshCredentials(shareBrain, { dshHome: serverDsh, claudeHome: serverClaude, stamp: 'c2' })
  const serverCreds = read(serverDsh, '.credentials.yaml')
  check('credentials: the server receives the shared key and never the OpenRouter key', opened.pulled.join() === 'SEARCH_API_KEY' && serverCreds.includes(`  SEARCH_API_KEY: ${searchKey}`) && !serverCreds.includes('OPENROUTER'), JSON.stringify(opened))
  check('credentials: a value that differs on first contact is not overwritten', serverCreds.includes('  FCC_DSH_API_KEY: server-fcc') && !opened.pushed.includes('FCC_DSH_API_KEY'))
  check('credentials: the previous file is backed up', existsSync(join(serverDsh, '.credentials.yaml.pre-brain-sync-c2')))
  const rotatedKey = ['srch', 'e'.repeat(40)].join('-')
  write(laptopDsh, '.credentials.yaml', read(laptopDsh, '.credentials.yaml').replace(searchKey, rotatedKey))
  const rotated = syncDshCredentials(shareBrain, { dshHome: laptopDsh, claudeHome: laptopClaude })
  const received = syncDshCredentials(shareBrain, { dshHome: serverDsh, claudeHome: serverClaude, stamp: 'c3' })
  check('credentials: a key rotated on one machine reaches the other', rotated.pushed.join() === 'SEARCH_API_KEY' && received.pulled.join() === 'SEARCH_API_KEY' && read(serverDsh, '.credentials.yaml').includes(rotatedKey), JSON.stringify({ rotated, received }))
  const quiet = syncDshCredentials(shareBrain, { dshHome: serverDsh, claudeHome: serverClaude })
  check('credentials: a second sync rewrites nothing', quiet.blobWritten === false && quiet.pulled.length === 0 && quiet.pushed.length === 0, JSON.stringify(quiet))
  // A blob sealed before the deny-list still carries the key: nobody pulls it, and the next seal drops it.
  const legacy = openCredentials(Buffer.from(keyHex, 'hex'), read(shareBrain, 'dsh-credentials.enc'))
  write(shareBrain, 'dsh-credentials.enc', sealCredentials(Buffer.from(keyHex, 'hex'), { version: 1, refs: { ...legacy.refs, OPENROUTER_API_KEY: orKey } }))
  const purged = syncDshCredentials(shareBrain, { dshHome: serverDsh, claudeHome: serverClaude, stamp: 'c4' })
  const purgedRefs = Object.keys(openCredentials(Buffer.from(keyHex, 'hex'), read(shareBrain, 'dsh-credentials.enc'))?.refs ?? {})
  check('credentials: a legacy blob key is not pulled and is dropped on the next seal', purged.blobWritten && !purged.pulled.includes('OPENROUTER_API_KEY') && !read(serverDsh, '.credentials.yaml').includes('OPENROUTER') && !purgedRefs.includes('OPENROUTER_API_KEY'), JSON.stringify({ purged, purgedRefs }))

  // ---------------------------------------------------------------------------
  console.log('\n=== 9. One master rule set for every machine ===')
  const { syncRules } = await import('./brain-sync.mjs')
  const rulesBrain = join(root, 'rules-brain')
  mkdirSync(rulesBrain, { recursive: true })
  const homePath = ['C:', 'Users', 'ndi2', '.claude', 'shared-brain'].join('/')
  write(laptopClaude, 'CLAUDE.md', `# Rules\n\n- Never tell me to run anything myself.\n\nStore: ${homePath}\n`)
  write(serverClaude, 'CLAUDE.md', '# Rules\n\n- An older rule only this machine had.\n')
  const shared = syncRules(rulesBrain, { claudeHome: laptopClaude, stamp: 'r1' })
  check('rules: the first machine shares its rules', shared.status === 'pushed' && read(rulesBrain, 'rules/CLAUDE.md').includes('Never tell me to run anything myself.'), JSON.stringify(shared))
  check('rules: the shared copy writes home folders as ~', read(rulesBrain, 'rules/CLAUDE.md').includes('Store: ~/.claude/shared-brain') && !read(rulesBrain, 'rules/CLAUDE.md').includes('Users/ndi2'))
  const replaced = syncRules(rulesBrain, { claudeHome: serverClaude, stamp: 'r2' })
  check('rules: a machine with different rules takes the master on first contact', replaced.status === 'pulled' && read(serverClaude, 'CLAUDE.md') === read(rulesBrain, 'rules/CLAUDE.md'), JSON.stringify(replaced))
  check('rules: its old rules are backed up, not lost', existsSync(join(serverClaude, 'CLAUDE.md.pre-brain-sync-r2')) && read(serverClaude, 'CLAUDE.md.pre-brain-sync-r2').includes('An older rule'))
  write(serverClaude, 'CLAUDE.md', `${read(serverClaude, 'CLAUDE.md')}- A rule added on the server.\n`)
  const serverEdit = syncRules(rulesBrain, { claudeHome: serverClaude, stamp: 'r3' })
  const laptopTakes = syncRules(rulesBrain, { claudeHome: laptopClaude, stamp: 'r4' })
  check('rules: a rule edited on one machine reaches the other', serverEdit.status === 'pushed' && laptopTakes.status === 'pulled' && read(laptopClaude, 'CLAUDE.md').includes('A rule added on the server.'), JSON.stringify({ serverEdit, laptopTakes }))
  const settled = syncRules(rulesBrain, { claudeHome: laptopClaude, stamp: 'r5' })
  check('rules: a second sync changes nothing', settled.status === 'same', JSON.stringify(settled))
  check('rules: the shared copy passes the home-path gate', normalizeText(read(rulesBrain, 'rules/CLAUDE.md'), ['ndi2', 'vMixer']) === read(rulesBrain, 'rules/CLAUDE.md'))

  // ---------------------------------------------------------------------------
  console.log('\n=== 10. Every machine publishes; a new machine gets the key from history ===')
  const { publish, keyFromHistory, shareBrainKey } = await import('./brain-sync.mjs')
  const hub = join(root, 'hub.git')
  git(root, 'init', '-q', '--bare', '-b', 'main', hub)
  const P = join(root, 'pub-p')
  const Q = join(root, 'pub-q')
  const identify = dir => { git(dir, 'config', 'user.name', 'selftest'); git(dir, 'config', 'user.email', 'selftest@example.invalid') }
  mkdirSync(P, { recursive: true })
  git(P, 'init', '-q', '-b', 'main')
  identify(P)
  git(P, 'remote', 'add', 'origin', hub)
  write(P, '.gitignore', '.sync-state/\n')
  write(P, 'note.md', 'first\n')
  git(P, 'add', '-A')
  git(P, 'commit', '-q', '-m', 'first')
  const headOf = (dir, ref = 'HEAD') => git(dir, 'rev-parse', ref).stdout.trim()
  const firstPush = publish(P, { timeout: 30_000 })
  check('publish: a machine with no upstream pushes main', firstPush.result === 'pushed' && headOf(hub, 'main') === headOf(P), JSON.stringify(firstPush))
  git(root, 'clone', '-q', hub, Q)
  identify(Q)
  check('publish: nothing to send is up-to-date', publish(Q).result === 'up-to-date')
  write(Q, 'note-q.md', 'from Q\n')
  git(Q, 'add', '-A')
  git(Q, 'commit', '-q', '-m', 'Q')
  check('publish: the other machine publishes', publish(Q, { timeout: 30_000 }).result === 'pushed')
  write(P, 'note-p.md', 'from P\n')
  git(P, 'add', '-A')
  git(P, 'commit', '-q', '-m', 'P')
  const raced = publish(P, { timeout: 30_000 })
  check('publish: a push that lost the race syncs and retries', raced.result === 'pushed' && raced.attempt === 2 && existsSync(join(P, 'note-q.md')) && headOf(hub, 'main') === headOf(P), JSON.stringify(raced))
  write(P, 'leak.md', `token ${['sk', 'ant', 'x'.repeat(30)].join('-')}\n`)
  git(P, 'add', '-A')
  git(P, 'commit', '-q', '-m', 'leak')
  const blocked = publish(P)
  check('publish: the pre-push gate stops a credential', blocked.result === 'blocked' && headOf(hub, 'main') !== headOf(P), JSON.stringify(blocked))
  git(P, 'reset', '-q', '--hard', 'HEAD~1')

  const historyKey = Buffer.from('12'.repeat(32), 'hex')
  check('keys: shared once onto an orphan keys branch', shareBrainKey(P, historyKey) === true && shareBrainKey(P, historyKey) === false)
  const keysPush = publish(P)
  check('keys: the keys branch is published', keysPush.result === 'pushed' && (keysPush.refs ?? []).join() === 'refs/heads/keys', JSON.stringify(keysPush))
  check('keys: main never carries the key', !git(P, 'ls-tree', '-r', '--name-only', 'main').stdout.includes('brain-secrets.key'))
  git(Q, 'fetch', '-q', 'origin')
  check('keys: another machine reads the key from history', keyFromHistory(Q)?.equals(historyKey) === true)

  // ---------------------------------------------------------------------------
  console.log('\n=== 11. Fleet: brain key, sealed files, repositories, DSH build, host status ===')
  const { findBrainKey, syncDshCredentials: sealCreds, verifyPublish: gateCheck, patchDshLauncherBuild } = await import('./brain-sync.mjs')
  const fleet = await import('./fleet.mjs')
  const F = join(root, 'fleet')
  const keyHexH = historyKey.toString('hex')

  // -- the keys branch reaches a keyless machine, and beats a stale CLONE-KEY.txt
  const sealer = join(F, 'sealer')
  write(sealer, '.claude/brain-secrets.key', `${keyHexH}\n`)
  write(sealer, '.dsh/.credentials.yaml', 'version: 1\nrefs:\n  OPENROUTER_API_KEY: or-value\n')
  sealCreds(Q, { dshHome: join(sealer, '.dsh'), claudeHome: join(sealer, '.claude'), stamp: 'k0' })
  const staleHex = '99'.repeat(32)
  const keyless = join(F, 'keyless')
  write(keyless, 'Desktop/CLONE-KEY.txt', `old bundle key\n${staleHex}\n`)
  const viaBranch = findBrainKey({ claudeHome: join(keyless, '.claude'), dir: Q })
  check('fleet key: a keyless machine takes the key from the keys branch', viaBranch?.source === 'keys-branch' && viaBranch.opens === true && viaBranch.key.equals(historyKey), JSON.stringify({ source: viaBranch?.source, opens: viaBranch?.opens }))
  check('fleet key: it is kept as the machine key file', read(keyless, '.claude/brain-secrets.key').trim() === keyHexH)
  const staleHome = join(F, 'stale')
  write(staleHome, '.claude/brain-secrets.key', `${staleHex}\n`)
  const staleReplaced = findBrainKey({ claudeHome: join(staleHome, '.claude'), dir: Q })
  check('fleet key: a stale key file is replaced by one that opens the credentials', staleReplaced?.source === 'keys-branch' && read(staleHome, '.claude/brain-secrets.key').trim() === keyHexH, JSON.stringify({ source: staleReplaced?.source }))
  check('fleet key: the stale key is backed up, not lost', typeof staleReplaced?.backup === 'string' && readFileSync(staleReplaced.backup, 'utf8').trim() === staleHex)
  const noBranch = join(F, 'no-branch-brain')
  write(noBranch, 'dsh-credentials.enc', read(Q, 'dsh-credentials.enc'))
  const wrongOnly = join(F, 'wrong-only')
  write(wrongOnly, 'Desktop/CLONE-KEY.txt', `${staleHex}\n`)
  const refused = findBrainKey({ claudeHome: join(wrongOnly, '.claude'), dir: noBranch })
  check('fleet key: a key that opens nothing is reported and not installed', refused?.opens === false && !existsSync(join(wrongOnly, '.claude', 'brain-secrets.key')), JSON.stringify({ opens: refused?.opens }))
  const noBlobHome = join(F, 'no-blob')
  write(noBlobHome, 'Desktop/CLONE-KEY.txt', `${staleHex}\n`)
  const noBlob = findBrainKey({ claudeHome: join(noBlobHome, '.claude'), dir: join(F, 'empty-brain') })
  check('fleet key: with nothing sealed yet, CLONE-KEY.txt is still accepted', noBlob?.copied === true && noBlob.opens === null)

  // -- sealed secret files
  const S = join(F, 'secret-brain')
  mkdirSync(S, { recursive: true })
  const L = join(F, 'home-l')
  const HV = join(F, 'home-v')
  const leakShape = ['sk', 'ant', 'api03', 'Q'.repeat(40)].join('-')
  write(L, 'Documents/claudecode/proj/.env', `ANTHROPIC_API_KEY=${leakShape}\n`)
  const entry = fleet.addSecret(S, join(L, 'Documents', 'claudecode', 'proj', '.env'), { home: L })
  check('fleet secrets: add-secret writes a home-relative manifest entry', entry.id === 'proj-.env' && entry.path === '~/Documents/claudecode/proj/.env', JSON.stringify(entry))
  const opts = (home, stamp) => ({ key: historyKey, home, claudeHome: join(home, '.claude'), stamp })
  const stateOf = result => Object.fromEntries(result.files.map(file => [file.id, file.state]))
  const s1 = fleet.syncSecretFiles(S, opts(L, 's1'))
  const sealedText = read(S, 'fleet/secrets/proj-.env.enc')
  check('fleet secrets: the first machine seals its file', stateOf(s1)['proj-.env'] === 'shared', JSON.stringify(s1))
  check('fleet secrets: the blob holds no plain text and is hex only', !sealedText.includes(leakShape) && !sealedText.includes('ANTHROPIC') && /^brain-sealed-file v1 hex\n[0-9a-f]+\n$/.test(sealedText))
  const s2 = fleet.syncSecretFiles(S, opts(HV, 's2'))
  check('fleet secrets: a machine without the file receives it', stateOf(s2)['proj-.env'] === 'restored' && read(HV, 'Documents/claudecode/proj/.env') === read(L, 'Documents/claudecode/proj/.env'), JSON.stringify(s2))
  check('fleet secrets: a second sync is quiet', stateOf(fleet.syncSecretFiles(S, opts(HV, 's3')))['proj-.env'] === 'same')
  write(L, 'Documents/claudecode/proj/.env', 'ANTHROPIC_API_KEY=rotated\n')
  const rot = fleet.syncSecretFiles(S, opts(L, 's4'))
  const gotRot = fleet.syncSecretFiles(S, opts(HV, 's5'))
  check('fleet secrets: a rotation on one machine reaches the other, backed up', stateOf(rot)['proj-.env'] === 'shared' && stateOf(gotRot)['proj-.env'] === 'restored' && read(HV, 'Documents/claudecode/proj/.env') === 'ANTHROPIC_API_KEY=rotated\n' && existsSync(join(HV, 'Documents', 'claudecode', 'proj', '.env.pre-brain-sync-s5')), JSON.stringify({ rot, gotRot }))
  const W2 = join(F, 'home-w')
  write(W2, 'Documents/claudecode/proj/.env', 'ANTHROPIC_API_KEY=w-own\n')
  const firstContact = fleet.syncSecretFiles(S, opts(W2, 's6'))
  check('fleet secrets: a different copy on first contact is left alone', stateOf(firstContact)['proj-.env'] === 'differs' && read(W2, 'Documents/claudecode/proj/.env') === 'ANTHROPIC_API_KEY=w-own\n', JSON.stringify(firstContact))
  const taken = fleet.takeSecret(S, 'proj-.env', opts(W2, 's7'))
  check('fleet secrets: take-secret replaces it with the brain copy, backed up', taken.status === 'taken' && read(W2, 'Documents/claudecode/proj/.env') === 'ANTHROPIC_API_KEY=rotated\n' && existsSync(join(W2, 'Documents', 'claudecode', 'proj', '.env.pre-brain-sync-s7')) && stateOf(fleet.syncSecretFiles(S, opts(W2, 's8')))['proj-.env'] === 'same', JSON.stringify(taken))
  write(L, 'Documents/claudecode/proj/.env', 'ANTHROPIC_API_KEY=from-l\n')
  fleet.syncSecretFiles(S, opts(L, 's9'))
  write(HV, 'Documents/claudecode/proj/.env', 'ANTHROPIC_API_KEY=from-v\n')
  const both = fleet.syncSecretFiles(S, opts(HV, 's10'))
  check('fleet secrets: changed on both machines, this one is shared and the other kept beside it', stateOf(both)['proj-.env'] === 'shared-both-changed' && read(HV, 'Documents/claudecode/proj/.env.from-brain-s10') === 'ANTHROPIC_API_KEY=from-l\n' && fleet.openFile(historyKey, read(S, 'fleet/secrets/proj-.env.enc')).content.toString() === 'ANTHROPIC_API_KEY=from-v\n', JSON.stringify(both))
  check('fleet secrets: a wrong key is reported, not overwritten', stateOf(fleet.syncSecretFiles(S, { ...opts(HV, 's11'), key: Buffer.from(staleHex, 'hex') }))['proj-.env'] === 'unreadable')
  write(P, 'fleet/secrets/proj-.env.enc', sealedText)
  git(P, 'add', '-A')
  git(P, 'commit', '-q', '-m', 'sealed file')
  const gate = gateCheck(P, 'HEAD')
  check('fleet secrets: the pre-push gate passes a sealed blob of a credential', gate.length === 0, JSON.stringify(gate))
  git(P, 'reset', '-q', '--hard', 'HEAD~1')

  // -- repositories
  const upstream = join(F, 'up.git')
  const work = join(F, 'up-work')
  git(root, 'init', '-q', '--bare', '-b', 'main', upstream)
  mkdirSync(work, { recursive: true })
  git(work, 'init', '-q', '-b', 'main')
  identify(work)
  const commitWork = (file, text) => {
    write(work, file, text)
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', file)
    git(upstream, 'fetch', '-q', work, 'main:main')
  }
  commitWork('a.txt', 'one\n')
  const R = join(F, 'home-r')
  mkdirSync(R, { recursive: true })
  write(F, 'repo-brain/fleet/repos.json', JSON.stringify({ version: 1, repos: [
    { name: 'followed', path: '~/Documents/followed', remote: upstream, branch: 'main', mode: 'follow' },
    { name: 'watched', path: '~/Documents/watched', remote: upstream, branch: 'main', mode: 'watch' },
    { name: 'absent-watch', path: '~/Documents/absent', remote: upstream, branch: 'main', mode: 'watch' },
  ] }))
  const RB = join(F, 'repo-brain')
  const repoStates = out => Object.fromEntries(out.repos.map(repo => [repo.name, repo.state]))
  const followedPath = join(R, 'Documents', 'followed')
  const watchedPath = join(R, 'Documents', 'watched')
  git(root, 'clone', '-q', upstream, watchedPath)
  const r1 = fleet.followRepos(RB, { home: R, force: true })
  check('fleet repos: a followed repository missing here is cloned', repoStates(r1).followed === 'cloned' && existsSync(join(followedPath, 'a.txt')), JSON.stringify(r1))
  check('fleet repos: a watched repository missing here is only reported', repoStates(r1)['absent-watch'] === 'missing' && !existsSync(join(R, 'Documents', 'absent')))
  check('fleet repos: the next call inside ten minutes is throttled', fleet.followRepos(RB, { home: R }).throttled === true)
  commitWork('b.txt', 'two\n')
  const r2 = fleet.followRepos(RB, { home: R, force: true })
  check('fleet repos: a clean followed checkout is fast-forwarded', repoStates(r2).followed === 'updated' && existsSync(join(followedPath, 'b.txt')), JSON.stringify(r2))
  check('fleet repos: a watched checkout is never pulled', repoStates(r2).watched === 'behind' && !existsSync(join(watchedPath, 'b.txt')))
  write(followedPath, 'a.txt', 'local edit\n')
  commitWork('c.txt', 'three\n')
  const r3 = fleet.followRepos(RB, { home: R, force: true })
  check('fleet repos: a dirty checkout that is behind is left alone', repoStates(r3).followed === 'dirty-behind' && read(followedPath, 'a.txt') === 'local edit\n' && !existsSync(join(followedPath, 'c.txt')), JSON.stringify(r3))
  git(followedPath, 'checkout', '-q', '--', 'a.txt')
  identify(followedPath)
  write(followedPath, 'local.txt', 'mine\n')
  git(followedPath, 'add', '-A')
  git(followedPath, 'commit', '-q', '-m', 'local')
  const r4 = fleet.followRepos(RB, { home: R, force: true })
  check('fleet repos: a diverged checkout is reported, not merged', repoStates(r4).followed === 'diverged' && !existsSync(join(followedPath, 'c.txt')), JSON.stringify(r4))
  const added = fleet.addRepo(RB, watchedPath, { mode: 'watch', home: R })
  check('fleet repos: add-repo records path, remote and branch', added.path === '~/Documents/watched' && added.branch === 'main' && added.mode === 'watch', JSON.stringify(added))

  // -- DSH build
  const B = join(F, 'home-b')
  const dshRepo = join(B, 'Documents', 'harness')
  const dshHomeB = join(B, '.dsh')
  git(root, 'clone', '-q', upstream, dshRepo)
  identify(dshRepo)
  write(F, 'build-brain/fleet/repos.json', JSON.stringify({ version: 1, repos: [{ name: 'harness', path: '~/Documents/harness', remote: upstream, branch: 'main', mode: 'follow', build: 'dsh' }] }))
  const BB = join(F, 'build-brain')
  const ran = []
  const fakeRun = (command, cwd) => {
    ran.push(command)
    if (command === 'pnpm run build') write(cwd, 'apps/web/dist/index.html', '<html></html>')
    return 0
  }
  const b1 = fleet.buildIfStale(BB, { home: B, dshHome: dshHomeB, run: fakeRun })
  const headB = () => git(dshRepo, 'rev-parse', 'HEAD').stdout.trim()
  check('fleet build: a never-built checkout is installed and built', b1.status === 'built' && ran.join('|') === 'pnpm install --frozen-lockfile|pnpm run build' && read(dshHomeB, '.built-commit').trim() === headB(), JSON.stringify({ b1, ran }))
  ran.length = 0
  check('fleet build: an unchanged checkout is not rebuilt', fleet.buildIfStale(BB, { home: B, dshHome: dshHomeB, run: fakeRun }).status === 'current' && ran.length === 0)
  mkdirSync(join(dshRepo, 'node_modules'), { recursive: true })
  write(dshRepo, 'src.txt', 'x\n')
  git(dshRepo, 'add', 'src.txt')
  git(dshRepo, 'commit', '-q', '-m', 'code')
  const b2 = fleet.buildIfStale(BB, { home: B, dshHome: dshHomeB, run: fakeRun })
  check('fleet build: a code change rebuilds without reinstalling', b2.status === 'built' && ran.join('|') === 'pnpm run build' && b2.installed === false, JSON.stringify({ b2, ran }))
  ran.length = 0
  write(dshRepo, 'pnpm-lock.yaml', 'lock: 2\n')
  git(dshRepo, 'add', 'pnpm-lock.yaml')
  git(dshRepo, 'commit', '-q', '-m', 'lock')
  const b3 = fleet.buildIfStale(BB, { home: B, dshHome: dshHomeB, run: fakeRun })
  check('fleet build: a lockfile change reinstalls first', b3.status === 'built' && ran.join('|') === 'pnpm install --frozen-lockfile|pnpm run build', JSON.stringify({ b3, ran }))
  write(dshRepo, 'src.txt', 'y\n')
  git(dshRepo, 'commit', '-q', '-am', 'broken')
  const before = read(dshHomeB, '.built-commit')
  const b4 = fleet.buildIfStale(BB, { home: B, dshHome: dshHomeB, run: command => (command === 'pnpm run build' ? 1 : 0) })
  check('fleet build: a failed build keeps the last good marker', b4.status === 'build-failed' && read(dshHomeB, '.built-commit') === before, JSON.stringify(b4))
  const seedHome = join(F, 'seed-dsh')
  check('fleet build: an existing fresh bundle is recorded, not rebuilt', fleet.seedBuiltMarker(dshRepo, seedHome) === true && read(seedHome, '.built-commit').trim() === headB() && fleet.seedBuiltMarker(dshRepo, seedHome) === false)
  write(dshHomeB, 'launch-dsh.cmd', '@echo off\r\ntitle DSH\r\ncd /d "C:\\somewhere\\harness"\r\n\r\nif not exist "apps\\web\\dist\\index.html" (\r\n  exit /b 1\r\n)\r\n')
  const patched = patchDshLauncherBuild(dshHomeB, 'l1')
  const fleetLaunchText = read(dshHomeB, 'launch-dsh.cmd')
  const fleetLaunchLines = fleetLaunchText.split('\r\n')
  const cdAt = fleetLaunchLines.findIndex(line => line.startsWith('cd /d'))
  const buildAt = fleetLaunchLines.findIndex(line => line.includes('fleet.mjs" build'))
  check('fleet build: the launcher builds right after cd, before the bundle check', typeof patched === 'string' && buildAt > cdAt && buildAt < fleetLaunchLines.findIndex(line => line.startsWith('if not exist')) && !fleetLaunchText.replace(/\r\n/g, '').includes('\n'), JSON.stringify(fleetLaunchLines))
  check('fleet build: patching the launcher twice changes nothing', patchDshLauncherBuild(dshHomeB, 'l2') === null && !existsSync(join(dshHomeB, 'launch-dsh.cmd.pre-brain-sync-l2')))

  // -- host status
  const SH = join(F, 'status-brain')
  const tools = { node: 'v0', git: true, pnpm: true, teamviewer: true, codexLogin: true, claudeLogin: true }
  const tStatus = Date.parse('2026-09-16T00:00:00Z')
  fleet.saveStatusPart(SH, 'brainKey', 'present')
  fleet.saveStatusPart(SH, 'secrets', { status: 'synced', files: [{ id: 'proj-.env', state: 'same' }] })
  check('fleet status: first write', fleet.writeHostStatus(SH, { host: 'Box-One', now: tStatus, tools }).written === true && JSON.parse(read(SH, 'fleet/status/box-one.json')).secrets['proj-.env'] === 'same')
  check('fleet status: unchanged within 12 hours is not rewritten', fleet.writeHostStatus(SH, { host: 'Box-One', now: tStatus + 3600_000, tools }).written === false)
  check('fleet status: unchanged after 12 hours refreshes its seen time', fleet.writeHostStatus(SH, { host: 'Box-One', now: tStatus + 13 * 3600_000, tools }).written === true)
  check('fleet status: a machine in order produces no lines', fleet.fleetLines(SH, { host: 'box-one', now: tStatus + 13 * 3600_000 }).length === 0)
  fleet.saveStatusPart(SH, 'secrets', { status: 'synced', files: [{ id: 'proj-.env', state: 'differs' }] })
  check('fleet status: a change is written at once', fleet.writeHostStatus(SH, { host: 'Box-One', now: tStatus + 14 * 3600_000, tools }).written === true)
  const told = fleet.fleetLines(SH, { host: 'other', now: tStatus + 5 * 24 * 3600_000 })
  check('fleet status: another machine is told what is wrong and how long it has been silent', told.length === 1 && told[0].includes('Box-One') && told[0].includes('proj-.env differs') && told[0].includes('take-secret') && told[0].includes('not seen for'), JSON.stringify(told))
  const statusText = read(SH, 'fleet/status/box-one.json')
  check('fleet status: the status file names no home folder', normalizeText(statusText, ['ndi2', 'vMixer']) === statusText && !statusText.includes('Users'))
} finally {
  rmSync(root, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
console.log('\n=== 12. OpenRouter relay: modes, per-machine tokens, connect and disconnect ===')
{
  const { createHash } = await import('node:crypto')
  const relay = await import('./openrouter-relay.mjs')
  const { openCredentials } = await import('./brain-sync.mjs')
  const R = mkdtempSync(join(tmpdir(), 'relay-selftest-'))
  try {
    const dshHome = join(R, 'dsh')
    const brain = join(R, 'brain')
    const claudeHome = join(R, 'home', '.claude')
    for (const dir of [dshHome, brain, claudeHome]) mkdirSync(dir, { recursive: true })
    // Comments, a decoy openrouter-free under another map, and leaves that are
    // missing, so every edit has to stay inside its own parent block.
    const settings = [
      '# DSH settings',
      'llm-pi-ai:',
      '  providers:',
      '    openrouter:',
      '      apiKeyEnv: OPENROUTER_API_KEY  # the raw key',
      '      models: [a]',
      '    openrouter-free:',
      '      baseURL: http://127.0.0.1:8080/v1',
      '      apiKeyEnv: OPENROUTER_API_KEY',
      'kinds:',
      '  openrouter-free:',
      '    baseURL: keep-me',
      'council:',
      '  seats:',
      '    openrouter-free:',
      '      model: x',
      '    deepseek:',
      '      model: y',
      '    kimi:',
      '      model: z',
      '',
    ].join('\n')
    write(dshHome, 'settings.yaml', settings)
    write(dshHome, '.credentials.yaml', 'version: 1\nrefs:\n  FAKE_A: fake-a\n')
    const keyHex = '5a'.repeat(32)
    write(claudeHome, 'brain-secrets.key', `${keyHex}\n`)
    const base = { dshHome, brain, claudeHome, addresses: { lan: '192.168.50.10', tunnel: '100.70.1.2' } }
    const server = { ...base, machine: 'keyholder' }
    const client = { ...base, machine: 'poolbox' }
    const tokensFile = () => JSON.parse(read(dshHome, 'openrouter-relay/tokens.json'))

    const m = relay.setMode('lan', server)
    check('relay mode lan: binds 0.0.0.0, trusts loopback, warns while no token exists', m.config.host === '0.0.0.0' && m.config.trustLoopback === true && typeof m.warning === 'string', JSON.stringify(m.config))
    check('relay mode lan: publishes the lan and tunnel routes', m.published.routes.lan === 'http://192.168.50.10:8080' && m.published.routes.tunnel === 'http://100.70.1.2:8080', JSON.stringify(m.published.routes))
    const ssh = relay.setMode('ssh', server)
    check('relay mode ssh: loopback bind without loopback trust', ssh.config.host === '127.0.0.1' && ssh.config.trustLoopback === false)
    relay.setMode('lan', server)

    const issued = relay.issue('poolbox', server)
    const sealed = read(brain, 'relay/tokens/poolbox.enc')
    const token = openCredentials(Buffer.from(keyHex, 'hex'), sealed)?.refs?.[relay.TOKEN_REF]
    check('relay issue: the sealed token opens with the brain key', typeof token === 'string' && token.length >= 40)
    check('relay issue: tokens.json holds the SHA-256 of that token', token !== undefined && createHash('sha256').update(token, 'utf8').digest('hex') === tokensFile().machines.poolbox.sha256)
    check('relay issue: the result carries no token value', token !== undefined && !JSON.stringify(issued).includes(token))
    check('relay issue: another key does not open it', openCredentials(Buffer.from('11'.repeat(32), 'hex'), sealed) === null)

    relay.issue('victim', server)
    const revoked = relay.revoke('victim', server)
    check('relay revoke: sealed file deleted, digest marked revoked, others untouched', revoked.known && !existsSync(join(brain, 'relay/tokens/victim.enc')) && tokensFile().machines.victim.revoked === true && tokensFile().machines.poolbox.revoked === false)
    const listed = relay.list(server)
    check('relay list: both hosts with the right sealed flags', listed.length === 2 && listed.find(e => e.host === 'poolbox')?.sealed === true && listed.find(e => e.host === 'victim')?.sealed === false, JSON.stringify(listed))
    check('relay allow: addresses and subnets are stored', relay.allow(['192.168.50.20', '192.168.50.0/24'], server).allow.length === 2)
    let rejected = false
    try { relay.allow(['not-an-ip'], server) } catch { rejected = true }
    check('relay allow: a non-address is refused', rejected)
    const pub = relay.publish(server)
    check('relay publish: names the key holder and its routes', pub.keyHolder === 'keyholder' && pub.routes.lan === 'http://192.168.50.10:8080')

    const connected = relay.connect({ ...client, route: 'lan' })
    const creds = read(dshHome, '.credentials.yaml')
    check('relay connect: token written to the credentials, other refs kept', token !== undefined && creds.includes(`${relay.TOKEN_REF}: ${token}`) && creds.includes('FAKE_A: fake-a'))
    check('relay connect: the result carries no token value', token !== undefined && !JSON.stringify(connected).includes(token))
    const B = 'http://192.168.50.10:8080'
    const expected = [
      '# DSH settings',
      'llm-pi-ai:',
      '  providers:',
      '    openrouter:',
      `      baseURL: ${B}/openrouter/v1`,
      '      apiKeyEnv: OPENROUTER_RELAY_TOKEN',
      '      models: [a]',
      '    openrouter-free:',
      `      baseURL: ${B}/v1`,
      '      apiKeyEnv: OPENROUTER_RELAY_TOKEN',
      'kinds:',
      '  openrouter-free:',
      '    baseURL: keep-me',
      'council:',
      '  apiKeyEnv: OPENROUTER_RELAY_TOKEN',
      '  seats:',
      '    openrouter-free:',
      `      baseUrl: ${B}/v1/chat/completions`,
      '      model: x',
      '    deepseek:',
      `      baseUrl: ${B}/openrouter/v1/chat/completions`,
      '      model: y',
      '    kimi:',
      `      baseUrl: ${B}/openrouter/v1/chat/completions`,
      '      model: z',
      '',
    ].join('\n')
    const afterConnect = read(dshHome, 'settings.yaml')
    check('relay connect: exactly the eight leaves change, each inside its own block', afterConnect === expected, afterConnect === expected ? undefined : JSON.stringify(afterConnect))
    check('relay reconnect: a second route switches the base', relay.connect({ ...client, route: 'tunnel' }).base === 'http://100.70.1.2:8080' && read(dshHome, 'settings.yaml').includes('baseUrl: http://100.70.1.2:8080/v1/chat/completions'))
    relay.disconnect(client)
    check('relay disconnect: settings.yaml byte-identical to before connect, comment included', read(dshHome, 'settings.yaml') === settings)
    check('relay disconnect: restore record removed', !existsSync(join(dshHome, 'openrouter-relay/connect-restore.json')))
    check('relay disconnect: a second disconnect changes nothing', relay.disconnect(client).disconnected === false && read(dshHome, 'settings.yaml') === settings)

    // CRLF files keep their line endings through a round trip.
    const crlf = settings.replace(/\n/g, '\r\n')
    write(dshHome, 'settings.yaml', crlf)
    relay.connect({ ...client, route: 'lan' })
    const crlfAfter = read(dshHome, 'settings.yaml')
    check('relay connect: a CRLF file stays CRLF', !crlfAfter.replace(/\r\n/g, '').includes('\n') && crlfAfter.replace(/\r\n/g, '\n') === expected)
    relay.disconnect(client)
    check('relay disconnect: a CRLF file comes back byte-identical', read(dshHome, 'settings.yaml') === crlf)
  } finally {
    rmSync(R, { recursive: true, force: true })
  }
}

console.log('\n=== 13. Llama relay: per-host tokens, token gate, streaming proxy, target record, connect ===')
{
  const { createHash } = await import('node:crypto')
  const { createServer } = await import('node:http')
  const relay = await import('./llama-relay.mjs')
  const { openCredentials, isLocalOnlyRef } = await import('./brain-sync.mjs')
  const R = mkdtempSync(join(tmpdir(), 'llama-relay-selftest-'))
  const servers = []
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => { servers.push(server); resolve(server.address().port) }))
  try {
    const serverDsh = join(R, 'gpu-dsh')
    const clientDsh = join(R, 'pool-dsh')
    const brain = join(R, 'brain')
    const claudeHome = join(R, 'home', '.claude')
    for (const dir of [serverDsh, clientDsh, brain, claudeHome]) mkdirSync(dir, { recursive: true })
    const keyHex = '6b'.repeat(32)
    write(claudeHome, 'brain-secrets.key', `${keyHex}\n`)
    write(clientDsh, '.credentials.yaml', 'version: 1\nrefs:\n  FAKE_A: fake-a\n')

    // Mock llama router: records what reached it, streams a chat in two chunks.
    const seen = []
    const upstream = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null, body })
        if (req.url === '/v1/models') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ data: [{ id: 'Qwen3.6-35B-A3B-UD-Q4_K_M', status: { value: 'loaded' } }, { id: 'lfm25-8b-a1b-Q5_K_M', status: { value: 'unloaded' } }] }))
        } else if (req.url === '/v1/chat/completions') {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.write('data: {"a":1}\n\n')
          setTimeout(() => res.end('data: [DONE]\n\n'), 50)
        } else { res.writeHead(200); res.end('admin') }
      })
    })
    const upstreamUrl = `http://127.0.0.1:${await listen(upstream)}`
    const base = { brain, claudeHome, addresses: { lan: '192.168.50.20', tunnel: null } }
    const gpu = { ...base, dshHome: serverDsh, machine: 'gpubox', upstream: upstreamUrl }
    const pool = { ...base, dshHome: clientDsh, machine: 'poolbox' }

    check('llama relay: token ref is per serving host', relay.tokenRefFor('vmixer2o2') === 'LLAMA_RELAY_TOKEN_VMIXER2O2')
    check('llama relay: its token refs never enter the shared blob', isLocalOnlyRef('LLAMA_RELAY_TOKEN_GPUBOX') && !isLocalOnlyRef('FAKE_A'))
    let refused = null
    try { await relay.serve({ ...gpu, host: '0.0.0.0', port: 0, log: () => {} }) } catch (error) { refused = error.message }
    check('llama relay serve: refuses a LAN bind with no live token', refused !== null && refused.includes('refusing to bind'), refused)
    let selfIssue = null
    try { relay.issue('gpubox', gpu) } catch (error) { selfIssue = error.message }
    check('llama relay issue: no token for the serving host itself', selfIssue !== null)

    const issued = relay.issue('poolbox', gpu)
    const sealed = read(brain, 'relay/llama-tokens/gpubox/poolbox.enc')
    const token = openCredentials(Buffer.from(keyHex, 'hex'), sealed)?.refs?.LLAMA_RELAY_TOKEN_GPUBOX
    const tokensText = read(serverDsh, 'llama-relay/tokens.json')
    check('llama relay issue: sealed token opens under the per-host ref', typeof token === 'string' && token.length >= 40)
    check('llama relay issue: tokens.json holds only its SHA-256', token !== undefined && JSON.parse(tokensText).machines.poolbox.sha256 === createHash('sha256').update(token, 'utf8').digest('hex') && !tokensText.includes(token))
    check('llama relay issue: result carries no token value', !JSON.stringify(issued).includes(token))

    const logs = []
    const live = await relay.serve({ ...gpu, host: '127.0.0.1', port: 0, log: line => logs.push(line) })
    servers.push(live)
    const url = `http://127.0.0.1:${live.address().port}`
    const auth = { authorization: `Bearer ${token}` }
    check('llama relay: no token is 401', (await fetch(`${url}/v1/models`)).status === 401)
    check('llama relay: a wrong token is 401', (await fetch(`${url}/v1/models`, { headers: { authorization: 'Bearer nope' } })).status === 401)
    const models = await fetch(`${url}/v1/models`, { headers: auth })
    const modelsBody = await models.json()
    check('llama relay: model list passes with the token', models.status === 200 && modelsBody.data.length === 2)
    check('llama relay: reports in-flight count', models.headers.get('x-relay-inflight') === '0')
    const admin = await fetch(`${url}/models/load`, { method: 'POST', headers: auth, body: '{}' })
    check('llama relay: router admin paths are not relayed', admin.status === 404 && !seen.some(entry => entry.url === '/models/load'))
    const chat = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm', stream: true }) })
    const streamed = await chat.text()
    check('llama relay: chat streams through intact', chat.status === 200 && streamed === 'data: {"a":1}\n\ndata: [DONE]\n\n', JSON.stringify(streamed))
    check('llama relay: request body reaches the router', seen.some(entry => entry.url === '/v1/chat/completions' && entry.body.includes('"stream":true')))
    check('llama relay: caller Authorization never reaches the router', seen.length > 0 && seen.every(entry => entry.authorization === null), JSON.stringify(seen.map(entry => entry.authorization)))
    check('llama relay: loopback health needs no token', (await fetch(`${url}/health`)).status === 200)
    check('llama relay: request log names the client, never the token', logs.some(line => line.includes('poolbox@')) && !logs.some(line => line.includes(token)))

    relay.revoke('poolbox', gpu)
    check('llama relay revoke: token refused on the next request without restart', (await fetch(`${url}/v1/models`, { headers: auth })).status === 401)
    check('llama relay revoke: sealed copy removed', !existsSync(join(brain, 'relay/llama-tokens/gpubox/poolbox.enc')))
    relay.issue('poolbox', gpu)

    write(brain, 'relay/llm-measured/gpubox.json', JSON.stringify({ maxLoaded: 1, models: { 'Qwen3.6-35B-A3B': { tokensPerSecond: 20, loadSeconds: 52, contextTokens: 131072, capabilities: { coding: 'medium' } } } }))
    const record = await relay.publish({ ...gpu, port: 8091 })
    const onDisk = JSON.parse(read(brain, 'relay/llm-targets/gpubox.json'))
    check('llama relay publish: record in the resolver shape', onDisk.host === 'gpubox' && onDisk.upstream === upstreamUrl && onDisk.relay.tokenRef === 'LLAMA_RELAY_TOKEN_GPUBOX' && onDisk.relay.routes.lan === 'http://192.168.50.20:8091', JSON.stringify(onDisk.relay))
    check('llama relay publish: live model ids with measured figures merged by prefix', record.models.length === 2 && record.models[0].tokensPerSecond === 20 && record.models[0].capabilities.coding === 'medium' && record.models[1].tokensPerSecond === undefined, JSON.stringify(record.models))

    const set = await relay.setup(['poolbox', 'laptop2'], { ...gpu, port: 8091 })
    check('llama relay setup: issues only missing tokens and publishes', set.issued.join() === 'laptop2' && set.kept.join() === 'poolbox' && set.models.length === 2 && JSON.parse(read(serverDsh, 'llama-relay/config.json')).port === 8091, JSON.stringify(set))
    const connected = relay.connect(pool)
    const creds = read(clientDsh, '.credentials.yaml')
    const poolToken = openCredentials(Buffer.from(keyHex, 'hex'), read(brain, 'relay/llama-tokens/gpubox/poolbox.enc')).refs.LLAMA_RELAY_TOKEN_GPUBOX
    check('llama relay connect: writes the per-host ref, keeps other refs', creds.includes(`LLAMA_RELAY_TOKEN_GPUBOX: ${poolToken}`) && creds.includes('FAKE_A: fake-a'))
    check('llama relay connect: result carries no token value', !JSON.stringify(connected).includes(poolToken))
    check('llama relay connect: the serving host itself is loopback', relay.connect(gpu).servers[0].route === 'loopback')
    const out = relay.disconnect(pool)
    const after = read(clientDsh, '.credentials.yaml')
    check('llama relay disconnect: ref removed, others kept', out.removed.includes('LLAMA_RELAY_TOKEN_GPUBOX') && !after.includes('LLAMA_RELAY') && after.includes('FAKE_A: fake-a'))
  } finally {
    for (const server of servers) { server.closeAllConnections?.(); server.close() }
    rmSync(R, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== Fleet apps: Claude Code, Codex, Antigravity follow the master ===')
  const fleet = await import('./fleet.mjs')
  const A = mkdtempSync(join(tmpdir(), 'brain-apps-'))
  try {
    const brainDir = join(A, 'brain')
    mkdirSync(join(brainDir, 'fleet'), { recursive: true })
    const asar = (dir, version) => {
      const pkg = Buffer.from(JSON.stringify({ name: 'antigravity', version }))
      const header = Buffer.from(JSON.stringify({ files: { 'package.json': { size: pkg.length, offset: '0' } } }))
      const pickle = Buffer.alloc(8); pickle.writeUInt32LE(header.length + 4, 0); pickle.writeUInt32LE(header.length, 4)
      const size = Buffer.alloc(8); size.writeUInt32LE(4, 0); size.writeUInt32LE(pickle.length + header.length, 4)
      write(dir, 'Local/Programs/antigravity/resources/app.asar', '')
      writeFileSync(join(dir, 'Local/Programs/antigravity/resources/app.asar'), Buffer.concat([size, pickle, header, pkg]))
    }
    const machine = (name, { claude, codex, agy, settings, toml }) => {
      const home = join(A, name, 'Users', name)
      const npmRoot = join(A, name, 'npm')
      write(npmRoot, '@anthropic-ai/claude-code/package.json', JSON.stringify({ version: claude }))
      write(npmRoot, '@openai/codex/package.json', JSON.stringify({ version: codex }))
      asar(join(A, name), agy)
      write(home, '.claude/settings.json', JSON.stringify(settings(home.replace(/\\/g, '\\\\')), null, 2))
      write(home, '.codex/config.toml', toml(home))
      const paths = { npmRoot, antigravityAsar: join(A, name, 'Local/Programs/antigravity/resources/app.asar'), antigravityPending: join(A, name, 'Local/antigravity-updater/pending'), claudeSettings: join(home, '.claude/settings.json'), claudeHome: join(home, '.claude'), codexConfig: join(home, '.codex/config.toml') }
      return { home, npmRoot, paths }
    }
    const master = machine('ndi2', {
      claude: '2.1.263', codex: '0.153.4', agy: '2.12.2',
      settings: h => ({ env: { SECRET_ONLY_HERE: 'x' }, theme: 'dark', permissions: { defaultMode: 'auto' }, statusLine: { type: 'command', command: `node "${h}\\.claude\\statusline\\statusline.mjs"` }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${h}\\.claude\\hooks\\usage-panel-chip.mjs"` }] }] } }),
      toml: h => `notify = [ "${h}\\AppData\\Local\\OpenAI\\notify.exe" ]\nmodel = "gpt-6"\n\n[desktop]\nsansFontSize = 14\n\n[plugins."pdf@openai"]\nenabled = true\n\n[projects.'${h.toLowerCase()}\\work']\ntrust_level = "trusted"\n`,
    })
    write(master.home, '.claude/statusline/statusline.mjs', 'console.log("status")\n')
    write(master.home, '.claude/hooks/usage-panel-chip.mjs', 'console.log("chip")\n')
    const follower = machine('vmix', {
      claude: '2.1.200', codex: '0.150.0', agy: '2.11.0',
      settings: () => ({ env: { LOCAL_KEY: 'keep-me' }, theme: 'light', model: 'old-model' }),
      toml: h => `notify = [ "${h}\\local-notify.exe" ]\nmodel = "gpt-5"\n\n[desktop]\nsansFontSize = 12\n\n[mcp_servers.local]\ncommand = '${h}\\tool.exe'\n`,
    })
    write(follower.paths.antigravityPending, 'Antigravity-x64.exe', 'fake installer')

    check('apps asar: the Antigravity version is read from app.asar', fleet.asarPackageVersion(master.paths.antigravityAsar) === '2.12.2')
    const d = fleet.detectApps(master.home, master.paths)
    check('apps detect: npm and asar versions', JSON.stringify(d.versions) === JSON.stringify({ claudeCode: '2.1.263', codex: '0.153.4', antigravity: '2.12.2' }), JSON.stringify(d.versions))
    check('apps detect: env and home paths stay out of the shared settings', !JSON.stringify(d.claudeSettings).includes('SECRET_ONLY_HERE') && !JSON.stringify(d).toLowerCase().includes(master.home.toLowerCase().replace(/\\/g, '\\\\')) && !JSON.stringify(d).includes('ndi2'))
    check('apps detect: notify and projects stay out of the shared Codex config', !d.codexConfig.top.some(l => l.startsWith('notify')) && !d.codexConfig.tables.some(t => t.name.startsWith('projects')))

    writeFileSync(join(brainDir, 'fleet/apps.json'), JSON.stringify({ master: 'ndi2' }))
    const rec = fleet.syncApps(brainDir, { host: 'NDI2', home: master.home, paths: master.paths, force: true })
    const target = JSON.parse(read(brainDir, 'fleet/apps.json'))
    check('apps master: records versions and the code files', rec.role === 'master' && target.versions.claudeCode === '2.1.263' && Object.keys(target.claudeFiles).length === 2 && existsSync(join(brainDir, 'fleet/apps-files/claude/hooks/usage-panel-chip.mjs')), JSON.stringify(target.claudeFiles))

    const dry = fleet.alignApps(brainDir, { home: follower.home, paths: follower.paths, dryRun: true, pendingVersion: () => '2.12.2.0', running: () => false })
    check('apps dry run: plans, changes nothing', dry.items.claudeCode.state === 'would-install' && dry.items.antigravity.state === 'would-install' && dry.items.claudeSettings.state === 'would-merge' && dry.items.codexConfig.state === 'would-merge' && JSON.parse(read(follower.home, '.claude/settings.json')).theme === 'light', JSON.stringify(dry.items))

    const installs = []
    const fakeInstall = spec => {
      installs.push(spec)
      const [, pkg, version] = /^(.+)@([^@]+)$/.exec(spec)
      write(follower.npmRoot, `${pkg}/package.json`, JSON.stringify({ version }))
      return { ok: true }
    }
    const busy = fleet.alignApps(brainDir, { home: follower.home, paths: follower.paths, install: fakeInstall, moveAside: () => 1, pendingVersion: () => '2.12.2.0', running: () => true, launch: () => { throw new Error('must not launch') }, stamp: 't1' })
    check('apps follower: pinned CLIs installed at the master versions', installs.join() === '@anthropic-ai/claude-code@2.1.263,@openai/codex@0.153.4' && busy.items.claudeCode.state === 'installed' && busy.items.codex.state === 'installed', JSON.stringify({ installs, items: busy.items }))
    check('apps follower: a running Antigravity is not updated under it', busy.items.antigravity.state === 'deferred-running')
    const merged = JSON.parse(read(follower.home, '.claude/settings.json'))
    check('apps follower: settings merged, local env kept, home rewritten', busy.items.claudeSettings.state === 'merged' && merged.env.LOCAL_KEY === 'keep-me' && merged.theme === 'dark' && merged.model === undefined && merged.statusLine.command.includes(follower.home.replace(/\\/g, '/')) && !JSON.stringify(merged).includes('Users/ndi2/.claude') && !JSON.stringify(merged).includes('ndi2\\Users'), JSON.stringify(merged))
    check('apps follower: the code files the settings run are installed', read(follower.home, '.claude/hooks/usage-panel-chip.mjs') === 'console.log("chip")\n' && existsSync(join(follower.home, '.claude/settings.json.pre-fleet-t1')))
    const toml = read(follower.home, '.codex/config.toml')
    check('apps follower: Codex portable keys taken, local notify and MCP kept', busy.items.codexConfig.state === 'merged' && toml.includes('model = "gpt-6"') && toml.includes('sansFontSize = 14') && toml.includes('[plugins."pdf@openai"]') && toml.includes('local-notify.exe') && toml.includes('[mcp_servers.local]') && !toml.includes('ndi2\Users'), toml)

    const agyLaunched = []
    const again = fleet.alignApps(brainDir, { home: follower.home, paths: follower.paths, install: () => { throw new Error('no install expected') }, pendingVersion: () => '2.12.2.0', running: () => false, launch: file => { agyLaunched.push(file); asar(join(A, 'vmix'), '2.12.2'); return true }, stamp: 't2' })
    check('apps follower: pending Antigravity installer applied when it is closed', agyLaunched.length === 1 && again.items.antigravity.state === 'installed', JSON.stringify(again.items.antigravity))
    check('apps follower: a second pass is quiet', ['claudeCode', 'codex', 'claudeSettings', 'codexConfig', 'claudeFiles'].every(k => again.items[k].state === 'same'), JSON.stringify(again.items))

    const status = { apps: { role: 'follower', versions: { claudeCode: '2.1.200', codex: '0.153.4', antigravity: '2.12.2' }, claudeDigest: target.claudeDigest, codexDigest: 'x' } }
    const drift = fleet.appsDrift(status, target)
    check('apps drift: names what lags the master', drift.includes('claudeCode 2.1.200 (target 2.1.263)') && drift.includes('Codex config differs') && drift.length === 2, JSON.stringify(drift))

    const tc = target.codexConfig
    check('apps codex: a local extra table still covers the master', fleet.codexCovers({ top: [...tc.top], tables: [...tc.tables, { name: 'plugins."sites@openai-bundled"', text: '[plugins."sites@openai-bundled"]\nenabled = true' }] }, tc))
    check('apps codex: a changed master table does not cover', tc.tables.length === 0 || !fleet.codexCovers({ top: [...tc.top], tables: tc.tables.map((t, i) => i ? t : { ...t, text: `${t.text}\nx = 1` }) }, tc))
    check('apps drift: a covering Codex config is not drift', !fleet.appsDrift({ apps: { ...status.apps, codexCovers: true } }, target).includes('Codex config differs'))

    check('apps drift: a newer follower is named ahead, not behind', fleet.appsDrift({ apps: { versions: { claudeCode: '2.1.267', codex: '0.153.4', antigravity: '2.13.0' }, claudeDigest: target.claudeDigest, codexDigest: target.codexDigest } }, target).join() === 'claudeCode 2.1.267 ahead of the master (2.1.263),antigravity 2.13.0 ahead of the master (2.12.2)')
    write(follower.npmRoot, '@anthropic-ai/claude-code/package.json', JSON.stringify({ version: '2.1.267' }))
    asar(join(A, 'vmix'), '2.13.0')
    const newer = fleet.alignApps(brainDir, { home: follower.home, paths: follower.paths, install: () => { throw new Error('must not downgrade') }, pendingVersion: () => '2.12.2.0', running: () => false, launch: () => { throw new Error('must not downgrade') }, stamp: 't4' })
    check('apps follower: never downgrades a newer app', newer.items.claudeCode.state === 'ahead-of-master' && newer.items.antigravity.state === 'ahead-of-master' && fleet.detectApps(follower.home, follower.paths).versions.claudeCode === '2.1.267', JSON.stringify(newer.items))
    check('apps version order: numeric, not text', fleet.compareVersion('2.1.267', '2.1.263') > 0 && fleet.compareVersion('2.10.0', '2.9.9') > 0 && fleet.compareVersion('2.12.2.0', '2.12.2') === 0 && fleet.compareVersion('0.150.0', '0.153.4') < 0)

    rmSync(join(follower.home, '.claude/hooks/usage-panel-chip.mjs'))
    rmSync(join(brainDir, 'fleet/apps-files/claude/hooks/usage-panel-chip.mjs'))
    write(follower.home, '.claude/settings.json', JSON.stringify({ theme: 'light' }))
    const guarded = fleet.alignApps(brainDir, { home: follower.home, paths: follower.paths, install: () => ({ ok: true }), running: () => true, stamp: 't3' })
    check('apps follower: settings naming a missing script are not applied', guarded.items.claudeSettings.state === 'missing-files' && JSON.parse(read(follower.home, '.claude/settings.json')).theme === 'light', JSON.stringify(guarded.items.claudeSettings))
  } finally {
    rmSync(A, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== FCC health monitor: bounded cool-down, never a permanent give-up ===')
{
  const { createRequire } = await import('node:module')
  const { createMonitor } = createRequire(import.meta.url)('./dsh/fcc-session.cjs')
  const reports = []
  let up = false
  let recoveries = 0
  const tick = createMonitor({
    check: async () => up,
    recover: async () => { recoveries++; return false },
    report: m => reports.push(m),
    alive: () => true,
    limit: 3,
    cooldownTicks: 4,
  })
  for (let i = 0; i < 3; i++) await tick()
  check('monitor: three consecutive failures spend the recovery budget', recoveries === 3 && reports.includes('Free Claude unavailable; recovery 3/3.'), JSON.stringify(reports))
  let paused = 0
  for (let i = 0; i < 4; i++) { await tick(); paused++ }
  check('monitor: no recovery during the cool-down', recoveries === 3, `${recoveries} after ${paused} paused ticks`)
  check('monitor: the pause is reported as temporary', reports.some(m => m.includes('recovery paused after 3 consecutive attempts')))
  const resumed = await tick()
  check('monitor: after the cool-down the budget resets and recovery runs again', recoveries === 4 && reports.includes('Free Claude: cool-down over, trying recovery again.') && resumed.recoveryAttempts === 1, JSON.stringify(resumed))
  await tick(); await tick()
  const second = []
  for (let i = 0; i < 5; i++) second.push(await tick())
  check('monitor: a second cool-down follows a second spent budget', recoveries === 7, `${recoveries} recoveries`)
  up = true
  const healthy = await tick()
  check('monitor: a healthy check clears attempts and the cool-down', healthy.ready && healthy.recoveryAttempts === 0 && healthy.cooldownRemaining === 0 && reports.at(-1) === 'Free Claude ready.', JSON.stringify(healthy))
  up = false
  await tick()
  check('monitor: a fresh outage after recovery gets a fresh budget at once', recoveries === 8, `${recoveries} recoveries`)
}

const failed = results.filter(r => !r.ok)
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`)
if (failed.length) for (const f of failed) console.log(`  - ${f.name}`)
process.exit(failed.length ? 1 : 0)
