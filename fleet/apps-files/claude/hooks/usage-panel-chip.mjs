#!/usr/bin/env node
/**
 * Ask the assistant to post the usage-panel task chip at the start of a session.
 *
 * The chip is what makes the panel reachable in one click from any chat: it
 * opens its own session, renders the panel, and leaves the refresh control
 * there. Nothing here reads quota or calls the network — the cost of putting
 * the button in every chat is this block of context and nothing else.
 *
 * SessionStart fires on resume and compaction too, not only on a new chat, so
 * the instruction is emitted at most once per session id. Without that guard a
 * long session collects a duplicate chip every time it resumes.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOOK_DIR = join(homedir(), '.claude', 'hooks')
const SEEN_PATH = join(HOOK_DIR, 'chip-hook-seen.json')
const LOG_PATH = join(HOOK_DIR, 'chip-hook.log')

/** Read the hook payload on stdin. Absent or unparseable is not fatal. */
async function readPayload() {
  if (process.stdin.isTTY) return {}
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  try { return JSON.parse(raw) } catch { return {} }
}

/**
 * Record a session id, reporting whether it had already been recorded.
 *
 * The store is trimmed rather than grown without bound: only recent sessions
 * can still be resumed, so older ids carry no information.
 * @param {string} id - the session id from the hook payload.
 * @returns {boolean} true if this id was already seen.
 */
function alreadySeen(id) {
  let seen = []
  try { seen = JSON.parse(readFileSync(SEEN_PATH, 'utf8')) } catch { seen = [] }
  if (seen.includes(id)) return true
  seen.push(id)
  try {
    mkdirSync(HOOK_DIR, { recursive: true })
    writeFileSync(SEEN_PATH, JSON.stringify(seen.slice(-200)))
  } catch { /* a failed write costs a duplicate chip, not a broken session */ }
  return false
}

const context = [
  'Before your first reply in this session, call mcp__ccd_session__spawn_task once',
  'with the arguments below. This is a standing instruction from the user, set up',
  'deliberately: they want the usage panel reachable in one click from every chat.',
  'Post it whatever else this session is about, then carry on with their request.',
  '',
  '  title: "Show Claude Code usage panel"',
  '  tldr:  "Opens the usage panel in its own session, with a refresh button."',
  '  prompt: Render the Claude Code usage panel. Run',
  '          node "C:/Users/ndi2/.claude/statusline/usage-panel.mjs"',
  '          for a live reading (about 30 seconds, one request against quota), or add',
  '          --from-cache to redraw the last stored figures for free. Call',
  '          mcp__visualize__read_me with modules ["data_viz"], then pass the script\'s',
  '          stdout to mcp__visualize__show_widget verbatim as widget_code, titled',
  '          claude_code_usage_panel. Do not rewrite the HTML; the script owns the',
  '          design. The panel carries a button that sends "refresh the usage panel" —',
  '          on that message, run the script live again and re-render. Add no text the',
  '          panel already shows. The user prefers terse caveman-style replies; invoke',
  '          the anthropic-skills:caveman skill before the first substantive reply.',
  '',
  'Post the chip silently: no announcement, no mention of it in your reply.',
  'If mcp__ccd_session__spawn_task is not among your tools, this surface does not',
  'render chips: skip all of the above and say nothing about it.',
].join('\n')

const payload = await readPayload()
const sessionId = payload.session_id ?? payload.sessionId ?? ''
const repeat = sessionId ? alreadySeen(sessionId) : false

try {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} fired session=${sessionId || 'unknown'} repeat=${repeat}\n`)
} catch { /* a diagnostic must never break the hook */ }

// A resumed session already carries the instruction in its transcript; sending
// it again only buys a second chip.
process.stdout.write(JSON.stringify(
  repeat ? {} : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } },
))
