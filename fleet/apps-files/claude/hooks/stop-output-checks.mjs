#!/usr/bin/env node
/**
 * stop-output-checks.mjs - Claude Code Stop hook (pm E6, T-804e8b21).
 * Author: Claude Opus 5.5.
 *
 * Checks the assistant's final message of the turn against three output rules
 * in ~/.claude/CLAUDE.md and bounces a failing message back to the agent with
 * {"decision":"block","reason":...} on stdout, so it repairs the message
 * instead of ending the turn:
 *
 *   1. model-self-id  - a message that reports work names a model
 *                       ("Claude Opus 5.5", "GPT-6", "DeepSeek-V3", ...).
 *   2. eta-format     - a message that reports launching / status of a run,
 *                       swarm, council, workflow, build or background job
 *                       carries an ETA with a UTC clock time, a Pacific clock
 *                       time, a duration, and "measured" or "estimated".
 *   3. qa-card-format - a message that asks the user a question with lettered
 *                       choices carries "Question X of Y · Z remaining"
 *                       (Z = Y - X) and options A-D (A and B at least,
 *                       contiguous, nothing past D).
 *
 * Contract (code.claude.com/docs/en/hooks, Stop): stdin JSON has session_id,
 * transcript_path, cwd, hook_event_name, stop_hook_active and, on current
 * builds, last_assistant_message. The hook prefers last_assistant_message and
 * falls back to the transcript JSONL.
 *
 * Guards: stop_hook_active === true never blocks (loop guard). Any internal
 * error fails open: logged, nothing on stdout, exit 0.
 *
 * Every decision is appended as one JSON line to the log named by
 * stop-output-checks.config.json ("logPath"). Overrides for tests:
 * STOP_CHECKS_CONFIG (config path), STOP_CHECKS_LOG (log path).
 * Zero dependencies.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// Claude Opus 5.5 2026-10-26: home-relative so the same file works on every fleet machine.
const DEFAULT_LOG = join(homedir(), '.claude', 'shared-brain', 'enforcement', 'stop-hook-decisions.jsonl')

// Headless workers whose final text is machine-parsed (DSH council seats, swarm
// lanes, pm-bridge blitz runs). Bouncing them would append text to output that
// DSH parses, so they are skipped by default.
const DEFAULT_SKIP_CWD = [
  // Matched against the cwd with backslashes turned into forward slashes.
  '/\\.dsh/(?:seat-cwd|search-cwd|runs-)',
  '/blitz-runs/',
  '/pm-data/bridge-work',
]
const DEFAULT_SKIP_ENTRYPOINTS = ['pm-bridge', 'sdk-cli', 'sdk-ts', 'sdk-py']

/** Why this session is exempt, or null. */
export function skipReason({ cwd, entrypoint }, cfg) {
  if (entrypoint && cfg.skipEntrypoints.includes(entrypoint)) return `entrypoint ${entrypoint}`
  const norm = typeof cwd === 'string' ? cwd.replace(/\\/g, '/') : ''
  if (norm && cfg.skipCwdPatterns.some((re) => re.test(norm))) return `cwd ${cwd}`
  return null
}

/** entrypoint field of the last transcript line that carries one. */
export function transcriptEntrypoint(transcriptPath) {
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split(/\r?\n/)
    for (let i = lines.length - 1; i >= 0; i--) { const m = /"entrypoint":"([^"]+)"/.exec(lines[i]); if (m) return m[1] }
  } catch { /* fall through */ }
  return null
}

export function loadConfig() {
  const cfgPath = process.env.STOP_CHECKS_CONFIG ?? join(HERE, 'stop-output-checks.config.json')
  let cfg = {}
  try { if (existsSync(cfgPath)) cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) } catch { cfg = {} }
  return {
    logPath: process.env.STOP_CHECKS_LOG ?? cfg.logPath ?? DEFAULT_LOG,
    minWorkReportChars: Number(cfg.minWorkReportChars ?? 300),
    rules: { 'model-self-id': true, 'eta-format': true, 'qa-card-format': true, ...(cfg.rules ?? {}) },
    skipCwdPatterns: (cfg.skipCwdPatterns ?? DEFAULT_SKIP_CWD).map((p) => new RegExp(p, 'i')),
    skipEntrypoints: cfg.skipEntrypoints ?? DEFAULT_SKIP_ENTRYPOINTS,
  }
}

// ---------------------------------------------------------------- message --

/** Text of the last assistant message in a transcript JSONL (all text blocks of that message id). */
export function lastAssistantText(transcriptPath) {
  const lines = readFileSync(transcriptPath, 'utf8').split(/\r?\n/)
  const entries = []
  for (const line of lines) {
    if (!line.trim()) continue
    try { entries.push(JSON.parse(line)) } catch { /* skip a torn line */ }
  }
  const textOf = (e) => {
    const c = e?.message?.content
    if (typeof c === 'string') return c
    if (!Array.isArray(c)) return ''
    return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
  }
  const isAssistant = (e) => e && (e.type === 'assistant' || e?.message?.role === 'assistant') && !e.isSidechain
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (!isAssistant(e) || !textOf(e).trim()) continue
    const id = e.message?.id
    if (!id) return textOf(e)
    // One API message can be split over several transcript lines; join its text blocks in order.
    const parts = []
    for (let j = 0; j <= i; j++) if (isAssistant(entries[j]) && entries[j].message?.id === id) parts.push(textOf(entries[j]))
    return parts.filter((p) => p.trim()).join('\n')
  }
  return ''
}

// ------------------------------------------------------------------ rules --

export const MODEL_NAME_RE =
  /\b(?:Claude\s+(?:Opus|Sonnet|Haiku|Fable)\s+\d+(?:\.\d+)?|GPT-\d+(?:\.\d+)?\w*|DeepSeek-V\d+(?:\.\d+)?|Kimi[\s-]K\d+(?:\.\d+)?|Gemini\s+\d+(?:\.\d+)?(?:\s+(?:Pro|Flash))?|Qwen\d*(?:\.\d+)?[\w-]*|Llama[\s-]?\d+(?:\.\d+)?|Mistral[\s-]\w+|Grok[\s-]?\d+)/i

// "Reports work": first-person past/perfect action verb, or a work-report heading.
const WORK_VERBS = 'built|fixed|committed|ran|tested|launched|started|deployed|wrote|created|updated|installed|verified|implemented|queued|restarted|added|removed|changed|edited|patched|merged|rebased|dispatched|stopped|killed|finished|completed|applied|recorded|logged|moved|renamed|deleted|configured|rebuilt|re-ran|reran'
const WORK_REPORT_RE = new RegExp(
  `(?:\\b(?:I|I've|I have|we|we've)\\s+(?:also\\s+|just\\s+|now\\s+)?(?:${WORK_VERBS})\\b)` +
  `|(?:^|\\n)\\s*(?:#+\\s*|\\*\\*)?(?:What I did|Done|Changes|Verified|Result|Results|Summary)\\b`,
  'i')

export function checkModelSelfId(text, cfg) {
  if (text.length < cfg.minWorkReportChars) return null
  if (!WORK_REPORT_RE.test(text)) return null
  if (MODEL_NAME_RE.test(text)) return null
  return 'model-self-id: this message reports work but names no model. Refer to yourself by your model name (for example "Claude Opus 5.5"), never anonymously.'
}

const JOB_NOUN = '(?:runs?|swarms?|council|workflows?|builds?|background\\s+(?:jobs?|tasks?|runs?)|jobs?|lanes?)'
const JOB_VERB = '(?:launch(?:ed|ing)?|start(?:ed|ing)|kick(?:ed|ing)\\s+off|dispatch(?:ed|ing)?|running|in\\s+flight|in\\s+progress|still\\s+running|queued|stalled|resum(?:ed|ing)|relaunch(?:ed|ing)?)'
export const JOB_STATUS_RE = new RegExp(
  `\\b${JOB_VERB}\\b[^.\\n]{0,40}\\b${JOB_NOUN}\\b|\\b${JOB_NOUN}\\b[^.\\n]{0,40}\\b${JOB_VERB}\\b`, 'i')
const UTC_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:UTC|GMT|Z)\b|\b\d{1,2}:\d{2}Z\b/i
const PACIFIC_RE = /\b\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?\s*)?(?:PT|PDT|PST|Pacific)\b/i
const DURATION_RE = /\b\d+(?:\.\d+)?\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)\b|\b\d+h\s*\d+m\b/i
const MARK_RE = /\b(?:measured|estimated|est)\b/i

// A trigger phrase that is negated ("launched nothing", "none of the runs have
// started", "hasn't started") reports that no job is in flight, so no ETA is due.
const NEGATION_RE = /\b(?:not|no|none|nothing|never|nor|without)\b|n't\b/i

/** First job-status phrase that is not negated, or null. */
export function jobStatusPhrase(text) {
  const re = new RegExp(JOB_STATUS_RE.source, 'gi')
  for (const m of text.matchAll(re)) {
    // Look at the phrase plus up to 25 chars before it on the same line.
    const start = Math.max(0, text.lastIndexOf('\n', m.index) + 1, m.index - 25)
    if (!NEGATION_RE.test(text.slice(start, m.index + m[0].length))) return m[0]
  }
  return null
}

export function checkEta(text) {
  if (!jobStatusPhrase(text)) return null
  const missing = []
  if (!UTC_RE.test(text)) missing.push('a UTC clock time (e.g. 04:30 UTC)')
  if (!PACIFIC_RE.test(text)) missing.push('a Pacific clock time (e.g. 21:30 PT)')
  if (!DURATION_RE.test(text)) missing.push('a duration (e.g. ~45 min)')
  if (!MARK_RE.test(text)) missing.push('"measured" or "estimated"')
  if (!missing.length) return null
  return `eta-format: this message reports a run/swarm/council/workflow/build/job but its ETA is missing ${missing.join(', ')}. Give an ETA per job and for the set, as UTC and Pacific clock time plus duration, marked measured or estimated.`
}

const OPTION_LINE_RE = /^\s*(?:[-*>]\s*)?(?:\*\*)?\(?([A-Z])(?:\)|\.|:|\*\*|\s+[—–-])(?:\*\*)?\s+\S/
const QA_HEADER_RE = /Question\s+(\d+)\s+of\s+(\d+)\s*[·•|-]\s*(\d+)\s+remaining/i

export function checkQaCard(text) {
  if (!text.includes('?')) return null
  const letters = []
  for (const line of text.split(/\r?\n/)) {
    const m = OPTION_LINE_RE.exec(line)
    if (m) letters.push(m[1].toUpperCase())
  }
  const set = [...new Set(letters)]
  // Trigger: at least A and B as lettered option lines.
  if (!(set.includes('A') && set.includes('B'))) return null
  const problems = []
  const hubAsk = /^\s*HUB-ASK:/.test(text)
  if (!hubAsk) {
    const h = QA_HEADER_RE.exec(text)
    if (!h) problems.push('the header "Question X of Y · Z remaining" is missing')
    else {
      const [x, y, z] = [Number(h[1]), Number(h[2]), Number(h[3])]
      if (x < 1 || x > y || z !== y - x) problems.push(`the header count is wrong (Question ${x} of ${y} must show ${Math.max(0, y - x)} remaining)`)
    }
  }
  const beyond = set.filter((l) => l > 'D')
  if (beyond.length) problems.push(`options go past D (${beyond.join(', ')}); use A-D only`)
  const inRange = set.filter((l) => l <= 'D').sort()
  const contiguous = inRange.every((l, i) => l === 'ABCD'[i])
  if (!contiguous) problems.push(`options must run A, B, C, D in order without gaps (found ${inRange.join(', ')})`)
  if (!problems.length) return null
  return `qa-card-format: this message asks a lettered-choice question but ${problems.join('; ')}. Use the Q&A card: "Question X of Y · Z remaining", short question, options A-D with the recommended one first and marked.`
}

export function evaluate(text, cfg) {
  const failures = []
  if (cfg.rules['model-self-id']) { const r = checkModelSelfId(text, cfg); if (r) failures.push(r) }
  if (cfg.rules['eta-format']) { const r = checkEta(text); if (r) failures.push(r) }
  if (cfg.rules['qa-card-format']) { const r = checkQaCard(text); if (r) failures.push(r) }
  return failures
}

// -------------------------------------------------------------------- run --

function log(cfg, record) {
  try {
    mkdirSync(dirname(cfg.logPath), { recursive: true })
    appendFileSync(cfg.logPath, JSON.stringify({ ts: new Date().toISOString(), hook: 'stop-output-checks', ...record }) + '\n')
  } catch { /* logging must never break the turn */ }
}

export function run(raw) {
  let cfg
  try {
    cfg = loadConfig()
    const input = JSON.parse(raw)
    if (!input || typeof input !== 'object') throw new Error('stdin is not a JSON object')
    const base = { session_id: input.session_id ?? null }
    if (input.stop_hook_active === true) {
      log(cfg, { ...base, decision: 'allow', why: 'loop-guard: stop_hook_active' })
      return { stdout: '', code: 0 }
    }
    const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ||
      (typeof input.transcript_path === 'string' ? transcriptEntrypoint(input.transcript_path) : null)
    const skip = skipReason({ cwd: input.cwd, entrypoint }, cfg)
    if (skip) {
      log(cfg, { ...base, decision: 'allow', why: `skip: headless worker (${skip})` })
      return { stdout: '', code: 0 }
    }
    let text =typeof input.last_assistant_message === 'string' ? input.last_assistant_message : ''
    let source = 'last_assistant_message'
    if (!text.trim()) {
      if (typeof input.transcript_path !== 'string' || !input.transcript_path) throw new Error('no transcript_path and no last_assistant_message')
      text = lastAssistantText(input.transcript_path)
      source = 'transcript'
    }
    const failures = evaluate(text, cfg)
    const excerpt = text.slice(0, 160)
    if (!failures.length) {
      log(cfg, { ...base, decision: 'allow', source, chars: text.length, excerpt })
      return { stdout: '', code: 0 }
    }
    const reason = `Stop hook (stop-output-checks) bounced your final message. Fix it and resend:\n- ${failures.join('\n- ')}`
    log(cfg, { ...base, decision: 'block', source, chars: text.length, rules: failures.map((f) => f.split(':')[0]), excerpt })
    return { stdout: JSON.stringify({ decision: 'block', reason }), code: 0 }
  } catch (err) {
    log(cfg ?? { logPath: process.env.STOP_CHECKS_LOG ?? DEFAULT_LOG }, { decision: 'allow', why: 'fail-open', error: String(err?.message ?? err) })
    return { stdout: '', code: 0 }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => { raw += d })
  process.stdin.on('end', () => {
    let out
    try { out = run(raw) } catch { out = { stdout: '', code: 0 } }
    if (out.stdout) process.stdout.write(out.stdout + '\n')
    process.exitCode = out.code
  })
  process.stdin.on('error', () => { process.exitCode = 0 })
}
