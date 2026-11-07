#!/usr/bin/env node
/**
 * Cap the usage panel at two renders per session.
 *
 * Each render appends the script's stdout and the widget copy of the same HTML
 * to the transcript — roughly 8k tokens that are then re-sent on every later
 * turn. Cost therefore grows with the square of the render count, while a
 * fresh session pays a flat startup instead. Past two renders relaunching is
 * cheaper, so the third call is denied and the assistant is told to relaunch.
 *
 * Nothing is deleted here: a hook has no way to end or archive a session, and
 * the tokens of renders one and two are already spent. Only the next append is
 * prevented.
 *
 * Wired as PreToolUse on Bash. --from-cache runs count too: they skip the
 * `/usage` request but append the same HTML.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOOK_DIR = join(homedir(), '.claude', 'hooks')
const COUNT_PATH = join(HOOK_DIR, 'panel-budget.json')
const LOG_PATH = join(HOOK_DIR, 'panel-budget.log')
const LIMIT = 2

/** Read the hook payload on stdin. Absent or unparseable is not fatal. */
async function readPayload() {
  if (process.stdin.isTTY) return {}
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  try { return JSON.parse(raw) } catch { return {} }
}

/**
 * Count this session's renders, returning the number including this one.
 *
 * The store is trimmed rather than grown without bound: only recent sessions
 * can still spend tokens, so older ids carry no information.
 * @param {string} id - the session id from the hook payload.
 * @returns {number} renders this session has now asked for.
 */
function bump(id) {
  let counts = {}
  try { counts = JSON.parse(readFileSync(COUNT_PATH, 'utf8')) } catch { counts = {} }
  const next = (counts[id] ?? 0) + 1
  counts[id] = next
  const ids = Object.keys(counts)
  if (ids.length > 200) for (const stale of ids.slice(0, ids.length - 200)) delete counts[stale]
  try {
    mkdirSync(HOOK_DIR, { recursive: true })
    writeFileSync(COUNT_PATH, JSON.stringify(counts))
  } catch { /* a failed write costs an uncapped render, not a broken session */ }
  return next
}

const payload = await readPayload()
const command = payload.tool_input?.command ?? ''
const sessionId = payload.session_id ?? payload.sessionId ?? ''

// Anything that is not a panel render passes through untouched.
if (!/usage-panel\.mjs/.test(command)) {
  process.stdout.write('{}')
  process.exit(0)
}

// Without a session id there is nothing to count against; never block blind.
if (!sessionId) {
  process.stdout.write('{}')
  process.exit(0)
}

const count = bump(sessionId)

try {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} session=${sessionId} render=${count}\n`)
} catch { /* a diagnostic must never break the hook */ }

if (count <= LIMIT) {
  process.stdout.write('{}')
  process.exit(0)
}

const reason = [
  `This session has already rendered the usage panel ${LIMIT} times.`,
  'Each render appends about 8k tokens that are re-sent on every later turn, so a',
  'third one costs more than starting over. Do not run the script here and do not',
  'reconstruct the panel from earlier output.',
  '',
  'Tell the user, in one line, that the panel is capped at two renders per session',
  'and that the task chip posted at session start opens a fresh one.',
].join('\n')

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  },
}))
