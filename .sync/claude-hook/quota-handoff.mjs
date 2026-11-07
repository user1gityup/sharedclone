#!/usr/bin/env node
/**
 * Session handoff: tell the running agent to checkpoint at 100k context,
 * four hours or 95% quota, and finish at 150k, eight hours or 99% quota.
 *
 * The standing rule lives in ~/.claude/CLAUDE.md and `quota-handoff-protocol.md`
 * in the brain. A rule alone depends on the agent watching its own quota, which
 * it cannot see: the figures come from `/usage`, cached by the status line at
 * ~/.claude/statusline/usage-cache.json. The hook also samples the beginning
 * and end of the current transcript for elapsed time and latest context usage.
 * It injects the instruction when any threshold is crossed.
 *
 * Wired as a UserPromptSubmit and PostToolUse hook by `install` in
 * .sync/brain-sync.mjs, and shipped from the brain so every machine runs the
 * same version. It never blocks: any failure prints nothing and exits 0.
 *
 * Quota handoff is MANUAL since 2026-09-29 (spec quota-handoff-routine-update.md):
 * reaching the guard threshold only marks "handoff available" (exhausted.json
 * for DSH routing, plus one notice). Nothing is archived, claimed or launched
 * until the user runs the Quota Handoff Routine: `/quota-handoff`
 * (~/.claude/commands/quota-handoff.md), which calls `node quota-handoff.mjs
 * routine`. The routine is archive-first and machine-aware; see runRoutine().
 *
 * Environment overrides (tests): QUOTA_HANDOFF_CACHE, QUOTA_HANDOFF_STATE,
 * QUOTA_HANDOFF_NOW (epoch ms), QUOTA_HANDOFF_NO_REFRESH=1, QUOTA_HANDOFF_HOST,
 * QUOTA_HANDOFF_GUARD (path to quota-guard.mjs).
 */

import { spawn } from 'node:child_process'
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CACHE = process.env.QUOTA_HANDOFF_CACHE ?? join(homedir(), '.claude', 'statusline', 'usage-cache.json')
const STATE = process.env.QUOTA_HANDOFF_STATE ?? join(homedir(), '.claude', 'hooks', 'quota-handoff-state.json')
const REFRESHER = join(homedir(), '.claude', 'statusline', 'usage-cache.mjs')
const NOW = Number(process.env.QUOTA_HANDOFF_NOW ?? Date.now())
/**
 * The resume pointer this machine leaves behind, named after the host.
 *
 * Several machines write into one brain, so picking "the latest handoff" by
 * modification time lands on a peer's unrelated note - that was demonstrated
 * here, not guessed. A host-scoped file names this machine's own note outright.
 */
const RESUME = `~/.claude/shared-brain/resume-${(process.env.QUOTA_HANDOFF_HOST ?? hostname()).toLowerCase()}.md`

/** Figures older than this trigger a background refresh. */
const STALE_MS = 5 * 60 * 1000
/** A reminder at the same level repeats after this long, so it survives compaction. */
const REPEAT_MS = 30 * 60 * 1000
/** Session entries older than this are dropped from the state file. */
const PRUNE_MS = 3 * 24 * 60 * 60 * 1000

const PREPARE = 95
const FINISH = 99
/** User rule 2026-09-18: at 98% of the weekly window every agent stops and hands off. */
const WEEK_STOP = 98
const CHECKPOINT_CONTEXT = 100_000
const HANDOFF_CONTEXT = 150_000
const CHECKPOINT_AGE_MS = 4 * 60 * 60 * 1000
const HANDOFF_AGE_MS = 8 * 60 * 60 * 1000

/**
 * Turn a `/usage` reset stamp such as "Sep 12, 2pm" into epoch ms.
 * @param {string | undefined} stamp
 * @returns {number | undefined} undefined when the stamp cannot be read.
 */
export function resetTime(stamp, now = NOW) {
  if (!stamp) return undefined
  const match = /([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(stamp)
  if (!match) return undefined
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
  const month = months[match[1].toLowerCase()]
  if (month === undefined) return undefined
  let hour = Number(match[3]) % 12
  if (match[5].toLowerCase() === 'pm') hour += 12
  const year = new Date(now).getFullYear()
  let target = new Date(year, month, Number(match[2]), hour, Number(match[4] ?? 0)).getTime()
  // A December stamp read in January belongs to last year; one far in the past is next year's.
  if (now - target > 180 * 24 * 60 * 60 * 1000) target = new Date(year + 1, month, Number(match[2]), hour, Number(match[4] ?? 0)).getTime()
  return target
}

/**
 * Decide what, if anything, the session should be told.
 * @param {object} data - usage-cache.json contents.
 * @returns {{ level: number, percent: number, window: string, resets: string, key: string } | undefined}
 */
export function assess(data, now = NOW, session = {}) {
  const windows = [
    ['session', data?.sessionPercent, data?.sessionResets],
    ['week', data?.weekPercent, data?.weekResets],
  ]
  let worst
  for (const [window, percent, resets] of windows) {
    if (typeof percent !== 'number' || percent < PREPARE) continue
    // Figures from before the window reset say nothing about the new window.
    const reset = resetTime(resets, now)
    if (reset !== undefined && reset <= now) continue
    if (!worst || percent > worst.percent) worst = { window, percent, resets: resets ?? 'unknown' }
  }
  const signals = []
  if (worst) signals.push({
    level: worst.window === 'week' && worst.percent >= WEEK_STOP ? 3 : worst.percent >= FINISH ? 2 : 1,
    key: `quota:${worst.window}:${worst.resets}`,
    summary: `${worst.percent}% ${worst.window} quota (resets ${worst.resets})`,
  })
  // Growth above the session's first reading, not the absolute size: a fresh
  // session opens near 78k (system prompt, tools, rules, index), so an absolute
  // 100k fired PREPARE before any work was done.
  const growth = (session.contextTokens ?? 0) - (session.baselineTokens ?? 0)
  if (growth >= CHECKPOINT_CONTEXT) signals.push({
    level: growth >= HANDOFF_CONTEXT ? 2 : 1,
    key: `context:${session.sessionId ?? 'unknown'}`,
    summary: `${Math.round(session.contextTokens / 1000)}k-token context, ${Math.round(growth / 1000)}k above its ${Math.round((session.baselineTokens ?? 0) / 1000)}k start`,
  })
  if (session.ageMs >= CHECKPOINT_AGE_MS) signals.push({
    level: session.ageMs >= HANDOFF_AGE_MS ? 2 : 1,
    key: `age:${session.sessionId ?? 'unknown'}`,
    summary: `${(session.ageMs / 3_600_000).toFixed(1)}-hour session`,
  })
  return signals.sort((a, b) => b.level - a.level)[0]
}

/**
 * Leave the pointer behind. The note itself is long and carries a name only its
 * author knows; this is the one small file a later session can find without
 * being told, and it is replaced wholesale rather than appended to.
 */
function pointerStep() {
  return `Replace ${RESUME} wholesale: frontmatter (name, description, metadata.type: project), then only "Handoff: <note file>", "Topic:", "Updated: YYYY-MM-DD HH:MM", "Session:", "Next: <one line>".`
}

/**
 * Offer the user the continuation as one click.
 *
 * A hook cannot call an MCP tool - it is a plain script talking JSON on stdout -
 * so the instruction carries the literal arguments and the session makes the
 * call. Only offered once this session is ending: at PREPARE the work continues
 * here, and a second session started now would collide with it.
 */
function chipStep() {
  return [
    'Call mcp__ccd_session__spawn_task once, posted silently (skip silently if the tool is absent):',
    '   title: "Continue <short topic>"; tldr: one plain sentence, no paths;',
    `   prompt: Read ${RESUME} and the note it names. Verify its claims against live filesystem, git and processes before editing, claim ownership in the note, then do its Next line. Read shared-agent-log.md only through tail or grep.`,
  ].join('\n')
}

/** Replaces the continuation chip on quota triggers: detection only, execution is the user's call. */
const ROUTINE_STEP = 'Post no continuation chip and start no resume. Tell the user the Quota Handoff Routine is available as /quota-handoff (archive-first, resumes this machine\'s sessions on this machine).'

/** Number a list of steps; a step of several lines keeps its own indented body. */
const numbered = (steps) => steps.map((step, i) => `${i + 1}. ${step}`)

/**
 * The note and bookkeeping steps. Kept short on purpose: every line here is paid
 * each time the hook fires, and the note it asks for is paid by every reader.
 * Notes that grew by appending reached 140 KB; the cap keeps them a page.
 */
const NOTE = 'Note ~/.claude/shared-brain/handoff-YYYY-MM-DD-HHMM-<topic>.md (fields: quota-handoff-protocol.md). Current state only, at most 60 lines of "Key: value"; on refresh Edit only the changed fields, never append history. Reuse an existing note for the same work.'
const BOOKKEEPING = 'MEMORY.md: one line under "## Shared operation", under 150 characters. shared-agent-log.md: add a signed entry with a shell append (>>), never reading the log to do it.'

/** The instruction injected into the session. */
export function message(found, data, ageMs) {
  const read = Number.isFinite(ageMs) ? `${Math.round(ageMs / 60000)} min` : '?'
  const figures = `Trigger: ${found.summary}. Usage ${data?.sessionPercent ?? '?'}% session, ${data?.weekPercent ?? '?'}% week (cache ${read} old)`
  if (found.level >= 3) return [
    `QUOTA STOP - WEEKLY ${data?.weekPercent ?? '?'}% (limit ${WEEK_STOP}%). ${figures}. No new work, no edits beyond the handoff.`,
    ...numbered([
      'TaskStop every subagent and background task this session owns; stop any DSH run it started.',
      `${NOTE} Mark it "continue via Claude in Antigravity or Claude Code via DSH".`,
      pointerStep(),
      `${BOOKKEEPING} No push.`,
      ROUTINE_STEP,
      'One line to the user, with the model name: the note path, and that Antigravity or DSH continues. End the turn.',
    ]),
  ].join('\n')
  const head = found.level >= 2
    ? `QUOTA HANDOFF - FINISH NOW. ${figures}. No new work; finish the handoff this turn.`
    : `QUOTA HANDOFF - PREPARE. ${figures}. Write the handoff, then carry on.`
  return [
    head,
    ...numbered([
      NOTE,
      pointerStep(),
      `${BOOKKEEPING} Commit only already-authorised work; no push.`,
      // Quota triggers never post a continuation chip: the Quota Handoff Routine is manual.
      ...(found.level >= 2 ? [found.key?.startsWith('quota:') ? ROUTINE_STEP : chipStep()] : []),
      'One line to the user, with the model name: the note path.',
    ]),
  ].join('\n')
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

/** Sum the prompt side of one usage record; NaN when the line carries none. */
function usageTokens(line) {
  try {
    const item = JSON.parse(line)
    const usage = item?.message?.usage ?? item?.usage
    if (!usage) return NaN
    return Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0)
  } catch { return NaN }
}

/**
 * Read only the ends of a Claude JSONL transcript; never load a long session wholesale.
 * The head's first usage record is the session's startup size, which the context
 * thresholds are measured above; startup attachments run to a few hundred KB,
 * so the head read is 1 MiB.
 */
function transcriptSignals(path, now) {
  if (!path || !existsSync(path)) return {}
  let fd
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const first = Buffer.alloc(Math.min(size, 1024 * 1024))
    readSync(fd, first, 0, first.length, 0)
    const tail = Buffer.alloc(Math.min(size, 512 * 1024))
    readSync(fd, tail, 0, tail.length, size - tail.length)
    const head = first.toString('utf8')
    const timestamp = /"timestamp"\s*:\s*"([^"]+)"/.exec(head)?.[1]
    let baselineTokens = 0
    for (const line of head.split(/\r?\n/)) {
      const tokens = usageTokens(line)
      if (tokens > 0) { baselineTokens = tokens; break }
    }
    // The latest reading, not the largest: after compaction the context shrinks.
    let contextTokens = 0
    for (const line of tail.toString('utf8').split(/\r?\n/)) {
      const tokens = usageTokens(line)
      if (tokens > 0) contextTokens = tokens
    }
    const started = timestamp ? Date.parse(timestamp) : NaN
    return { contextTokens, baselineTokens: Math.min(baselineTokens, contextTokens), ageMs: Number.isFinite(started) ? Math.max(0, now - started) : 0 }
  } catch { return {} } finally { if (fd !== undefined) try { closeSync(fd) } catch {} }
}

/**
 * The quota guard, shipped in the brain beside this hook's source. Its archive
 * (buildHandoff), claim, restore bookkeeping and launchers are reused by the
 * Quota Handoff Routine below, never copied.
 */
const GUARD = process.env.QUOTA_HANDOFF_GUARD ?? join(homedir(), '.claude', 'shared-brain', '.sync', 'quota-guard.mjs')
const loadGuard = () => import(pathToFileURL(GUARD).href)
/** Where the user calls the Routine: ~/.claude/commands/quota-handoff.md. */
const ROUTINE_COMMAND = '/quota-handoff'

/**
 * Feed the quota guard: record this session in its registry (the Routine's
 * archive step reads it to know which sessions are active) and DETECT the
 * handoff threshold. Detection only - it no longer spawns the guard's `check`,
 * which archived automatically. Skipped in hook tests
 * (QUOTA_HANDOFF_NO_REFRESH=1) so they never write the real registry. Never throws.
 */
async function quotaGuard(input, data, state, event) {
  const out = { changed: false, context: undefined, notice: undefined }
  if (process.env.QUOTA_HANDOFF_NO_REFRESH === '1' || !existsSync(GUARD)) return out
  try {
    const guard = await loadGuard()
    const E = guard.env()
    guard.touchSession(E, { sessionId: input.session_id, transcriptPath: input.transcript_path, cwd: input.cwd })
    const detected = detectAvailable(guard, E, state)
    if (detected.changed) out.changed = true
    if (detected.notice) { out.notice = detected.notice; out.context = `${detected.notice} Mention it to the user in one line; do not run it yourself.` }
    if (event !== 'UserPromptSubmit') return out
    // A replacement session started from a Routine chip or window confirms itself.
    const marker = guard.RESUME_MARKER?.exec(String(input.prompt ?? ''))
    if (marker) {
      const r = guard.markRestored(E, marker[1], marker[2], { sessionId: input.session_id })
      if (r.ok && !r.already) out.context = `Quota handoff ${marker[1]}: this session is the confirmed replacement for source session ${marker[2]}. Verify the package's claims before editing.`
      return out
    }
    // The session running the legacy cross-account resume procedure: record it,
    // so its own snapshot and the archive step leave it out.
    const resumer = /resume-handoff\.md for handoff ([A-Za-z0-9-]+)/.exec(String(input.prompt ?? ''))
    if (resumer && input.session_id) {
      guard.writeJsonAtomic(join(E.home, 'resumers', `${resumer[1]}.json`), { sessionId: input.session_id, at: new Date(NOW).toISOString() })
      return out
    }
    const incoming = incomingNotice(guard, E, state)
    if (incoming) { out.context = out.context ? `${out.context}\n\n${incoming}` : incoming; out.changed = true }
  } catch {}
  return out
}

/**
 * Threshold detection, separated from execution. Over the guard threshold it
 * keeps exhausted.json current (DSH's seat gate routes no new work to this
 * account) marked `handoff_available`, and returns one notice per exhaustion
 * event. It archives nothing and launches nothing. A real reading below the
 * threshold clears the flag and re-arms the notice.
 */
export function detectAvailable(guard, E, state) {
  const res = { changed: false, notice: undefined }
  const reading = guard.readQuota(E)
  const found = guard.assess(reading, E.threshold)
  const flagPath = join(E.home, 'exhausted.json')
  state.available ??= {}
  if (!found) {
    if (reading?.state === 'OK') {
      if (existsSync(flagPath)) rmSync(flagPath, { force: true })
      if (Object.keys(state.available).length) { state.available = {}; res.changed = true }
    }
    return res
  }
  const flag = guard.readJson(flagPath)
  if (!flag || flag.window !== found.window || flag.percent !== found.percent || !flag.handoff_available) {
    guard.writeJsonAtomic(flagPath, {
      account: E.account, provider: 'claude', host: E.host, reason: found.reason, window: found.window,
      percent: found.percent, resets_at: found.resetAt, simulated: Boolean(reading.simulated),
      since: flag?.since ?? new Date(E.now).toISOString(), handoff_id: flag?.handoff_id ?? null,
      handoff_available: true, handoff_routine: ROUTINE_COMMAND, automatic_handoff: false,
    })
  }
  if (state.available[found.key]) return res
  state.available[found.key] = NOW
  res.changed = true
  res.notice = `Quota Handoff available: ${found.reason} (threshold ${E.threshold}%). Nothing was archived or launched; run ${ROUTINE_COMMAND} when the handoff is wanted.`
  return res
}

/** Repeat the incoming-handoff notice for one handoff at most this often. */
const OFFER_EVERY_MS = 30 * 60 * 1000

/**
 * A handoff from another login is READY. Formerly the hook asked the session to
 * post a "Resume handoff" chip; now it only says the handoff exists. Continuing
 * it is the user's explicit call through the Routine.
 */
function incomingNotice(guard, E, state) {
  const m = guard.listHandoffs(E).find((h) => h.kind === 'quota' && h.state === 'READY' && !(guard.sameLogin?.(E, h) ?? h.source_account === E.account))
  if (!m) return undefined
  state.offers ??= {}
  if (NOW - (state.offers[m.handoff_id] ?? 0) < OFFER_EVERY_MS) return undefined
  state.offers[m.handoff_id] = NOW
  return `INCOMING QUOTA HANDOFF ${m.handoff_id} from ${m.source_machine} (${m.source_account}), ${m.sessions.length} session(s), READY. It is not resumed automatically. Mention it to the user in one line: ${ROUTINE_COMMAND} continues it (its own machine's sessions by default). Post no chip; carry on with the user's request.`
}

// ---------------------------------------------------------------- Quota Handoff Routine
//
// Manual only. ARCHIVE ALL -> VERIFY ARCHIVE -> read machine-origin data ->
// detect current machine -> BUILD RESUME PLAN -> resume this machine's sessions.
// Nothing resumes unless the archive verified; nothing is ever deleted or
// stopped, so the archive stays the recovery point if a resume fails.

/**
 * Resume modes. The key is the choice the user makes; the value is the
 * machine mode it maps to. Only `local` is the default. `pooled` never moves a
 * session to another machine unless `allowCross` is also given.
 */
export const MODES = {
  local: 'LOCAL', // [Resume This Machine Only] - default
  original: 'COORDINATED', // [Resume on Original Machines] - every session assigned back to its own machine
  choose: 'COORDINATED', // [Choose Machines] - explicit per-session assignments, cross-machine needs allowCross
  pooled: 'POOLED', // [Use Shared Machine Pool] - future; this machine takes pool work only with allowCross
}
/** Archives older than this are not planned; they remain in the brain as history. */
const ROUTINE_WINDOW_MS = 48 * 60 * 60 * 1000
const TASK_ID = /\bT-[0-9a-f]{8}\b/
const GROUP_ID = /\bcoordinated[ _-]?(?:task|group)\s*[:#]?\s*#?([A-Za-z0-9_-]+)/i
/** Restore states that mean a session already has, or is being given, a replacement. */
const TAKEN = ['RESTORED', 'OFFERED', 'LAUNCHING', 'UNCERTAIN']

const handoffDir = (E, id) => join(E.brain, 'quota-handoffs', id)
/** Write a manifest back without the claim/restore sidecars loadManifest merges in. */
function writeManifest(guard, E, manifest) {
  const { claim: _c, restore: _r, ...plain } = manifest
  guard.writeJsonAtomic(join(handoffDir(E, manifest.handoff_id), 'manifest.json'), plain)
}

/**
 * Machine-origin metadata for one archived session. origin_machine is where the
 * work first ran: a session that was itself started from a handoff inherits
 * its source's origin, so the Routine running here never claims every session
 * as native. last_execution_machine is the machine whose transcript was read.
 * Explicit tags in <guard home>/assignments.json ({ sessionId: { workflow_id,
 * coordinated_group_id, origin_machine } }) override what is read from text.
 */
export function sessionMetadata(guard, E, manifest, s) {
  const sid = s.source_session_id
  const dir = handoffDir(E, manifest.handoff_id)
  const pkg = guard.readJson(join(dir, 'sessions', sid, 'continuation.json')) ?? {}
  const text = [pkg.task_objective, pkg.latest_request].filter(Boolean).join('\n')
  const tags = guard.readJson(join(E.home, 'assignments.json'))?.[sid] ?? {}
  const marker = guard.RESUME_MARKER?.exec(text)
  let inherited
  if (marker) {
    const prior = guard.loadManifest(E, marker[1])
    inherited = prior?.routine?.sessions?.[marker[2]] ?? (prior ? { origin_machine: prior.source_machine } : undefined)
  }
  const workflow = tags.workflow_id ?? TASK_ID.exec(text)?.[0] ?? inherited?.task_workflow_id ?? null
  const group = GROUP_ID.exec(text)
  return {
    session_id: sid,
    agent_id: pkg.settings?.desktop_session_id ?? `claude-code:${sid}`,
    model: s.model ?? pkg.model ?? null,
    origin_machine: tags.origin_machine ?? inherited?.origin_machine ?? manifest.source_machine,
    last_execution_machine: manifest.source_machine,
    task_workflow_id: workflow,
    coordinated_group_id: tags.coordinated_group_id ?? (group ? `coordinated-${group[1]}` : null) ?? inherited?.coordinated_group_id ?? workflow,
    resumed_from: marker ? { handoff_id: marker[1], session_id: marker[2] } : null,
    archive_reference: `quota-handoffs/${manifest.handoff_id}/${s.archive}`,
    resume_reference: `quota-handoffs/${manifest.handoff_id}/${s.package}`,
    timestamp: manifest.created_at,
    last_activity: pkg.last_meaningful_session_state ?? null,
    working_directory: s.working_directory ?? null,
  }
}

/**
 * ARCHIVE ALL: the guard's buildHandoff snapshots every active session on this
 * machine (the running one included - it is work too) into one handoff, written
 * to `<id>.partial/` and published by rename. Machine-origin metadata is then
 * added to the published manifest under `routine`.
 */
export function archiveAll(guard, E, { self = [] } = {}) {
  const expected = guard.activeSessions(E).map((s) => s.sessionId)
  const manifest = guard.buildHandoff(E, {
    reason: `Quota Handoff Routine (manual) on ${E.host}`, kind: 'quota', reading: guard.readQuota(E),
    trigger: { routine: true, manual: true },
  })
  if (manifest.state !== 'READY') return { ok: false, manifest, expected, error: manifest.error ?? `state ${manifest.state}` }
  const published = guard.loadManifest(E, manifest.handoff_id)
  published.routine = {
    version: 1, manual: true, invoked_on: E.host, invoked_at: new Date(E.now).toISOString(), self_session_ids: self,
    sessions: Object.fromEntries(published.sessions.map((s) => [s.source_session_id, sessionMetadata(guard, E, published, s)])),
  }
  writeManifest(guard, E, published)
  return { ok: true, manifest: published, expected }
}

/**
 * VERIFY ARCHIVE: re-read what was published, never trust the in-memory copy.
 * Every session active before the archive must be in it; every package must be
 * readable; every transcript archive must gunzip to exactly the record count
 * its package states; every session must carry its machine origin.
 */
export function verifyArchive(guard, E, id, expected = []) {
  const errors = [], checks = []
  const m = guard.loadManifest(E, id)
  if (!m) return { ok: false, errors: ['manifest missing'], checks }
  const dir = handoffDir(E, id)
  if (m.state !== 'READY') errors.push(`state ${m.state}, expected READY`)
  if (!m.routine?.sessions) errors.push('machine-origin metadata missing')
  const ids = new Set(m.sessions.map((s) => s.source_session_id))
  for (const sid of expected) if (!ids.has(sid)) errors.push(`active session ${sid} not archived`)
  if ((m.session_count ?? m.sessions.length) !== m.sessions.length) errors.push('session_count disagrees with sessions')
  for (const s of m.sessions) {
    const sid = s.source_session_id
    try { if (!statSync(join(dir, s.package)).size) throw new Error() } catch { errors.push(`${sid}: continuation package missing or empty`); continue }
    const pkg = guard.readJson(join(dir, 'sessions', sid, 'continuation.json'))
    if (!pkg) { errors.push(`${sid}: continuation.json unreadable`); continue }
    let records
    try { const text = gunzipSync(readFileSync(join(dir, s.archive))).toString('utf8'); records = text ? text.split('\n').length : 0 } catch { errors.push(`${sid}: transcript archive missing or corrupt`); continue }
    if (records !== pkg.transcript_records) errors.push(`${sid}: archive holds ${records} records, package says ${pkg.transcript_records}`)
    const meta = m.routine?.sessions?.[sid]
    if (!meta?.origin_machine || !meta?.last_execution_machine) errors.push(`${sid}: machine origin not recorded`)
    checks.push({ session_id: sid, records, origin_machine: meta?.origin_machine ?? null, last_execution_machine: meta?.last_execution_machine ?? null })
  }
  return { ok: errors.length === 0, errors, checks }
}

/**
 * BUILD RESUME PLAN from every verified Routine archive in the brain (all
 * machines, within the window), newest archive winning per session. The plan
 * can say origin_machine != target_machine (`cross_machine`), but only an
 * explicit mode plus allowCross ever launches such a row here.
 */
export function buildPlan(guard, E, { mode = 'local', assign = {}, pool = [], allowCross = false, self = [], windowMs = ROUTINE_WINDOW_MS } = {}) {
  const receiver = `${E.user}@${E.host}`
  const handoffs = guard.listHandoffs(E).filter((m) => m.kind === 'quota' && m.routine?.sessions && m.routine.verification?.ok
    && E.now - Date.parse(m.created_at) <= windowMs)
  const taken = new Set()
  for (const m of handoffs) for (const [sid, r] of Object.entries(m.restore?.sessions ?? {})) if (TAKEN.includes(r?.state)) taken.add(sid)
  const seen = new Set(), rows = []
  for (const m of handoffs) {
    for (const s of m.sessions) {
      const meta = m.routine.sessions[s.source_session_id]
      if (!meta || seen.has(meta.session_id)) continue
      seen.add(meta.session_id)
      const home = meta.last_execution_machine ?? meta.origin_machine
      let target = home
      if (mode === 'choose' && assign[meta.session_id]) target = String(assign[meta.session_id]).toLowerCase()
      if (mode === 'pooled' && (pool.length ? pool : [E.host]).includes(E.host)) target = E.host
      const cross = target !== home
      let action
      if (self.includes(meta.session_id)) action = 'skip:routine-runner'
      else if (taken.has(meta.session_id)) action = 'skip:already-resumed'
      else if (m.claim && m.claim.receiver !== receiver) action = `skip:claimed-by ${m.claim.receiver}`
      else if (target !== E.host) action = mode === 'local' ? 'leave:other-machine' : `assigned:${target}`
      else if (cross && !allowCross) action = 'hold:cross-machine-needs-confirmation'
      else action = 'resume-here'
      rows.push({ ...meta, handoff_id: m.handoff_id, target_machine: target, cross_machine: cross, origin_is_target: meta.origin_machine === target, action })
    }
  }
  const groups = {}
  for (const r of rows) {
    if (!r.coordinated_group_id) continue
    const g = (groups[r.coordinated_group_id] ??= { machines: {} })
    ;(g.machines[r.target_machine] ??= []).push(r.session_id)
  }
  for (const g of Object.values(groups)) g.spans_machines = Object.keys(g.machines).length > 1
  return { mode, machine_mode: MODES[mode], current_machine: E.host, receiver, allow_cross_machine: Boolean(allowCross), rows, groups }
}

/**
 * MACHINE-AWARE RESUME: only rows whose action is `resume-here`. Each source
 * handoff is claimed exclusively first (guard.claim), then every session is
 * recorded LAUNCHING before its launch and OFFERED/RESTORED/FAILED_RETRYABLE
 * after, in the handoff's restore.json - the same bookkeeping as guard.resume,
 * so a re-run continues instead of duplicating and one failed launch leaves the
 * rest and the archive intact.
 */
export function resumeHere(guard, E, plan, { launcher = 'chips' } = {}) {
  const launch = typeof launcher === 'function' ? launcher : guard.LAUNCHERS[launcher]
  if (!launch) return { ok: false, code: 'UNKNOWN_LAUNCHER' }
  const byHandoff = new Map()
  for (const r of plan.rows) if (r.action === 'resume-here') (byHandoff.get(r.handoff_id) ?? byHandoff.set(r.handoff_id, []).get(r.handoff_id)).push(r)
  const launched = [], chips = []
  for (const [id, rows] of byHandoff) {
    const c = guard.claim(E, id, plan.receiver)
    if (!c.ok) { for (const r of rows) r.action = `skip:${c.code}${c.owner ? ` ${c.owner}` : ''}`; continue }
    const manifest = guard.loadManifest(E, id)
    if (manifest.state === 'CLAIMED') { guard.transition(manifest, 'RESTORING', plan.receiver, E.now, `Quota Handoff Routine on ${E.host}`); writeManifest(guard, E, manifest) }
    const restorePath = join(handoffDir(E, id), 'restore.json')
    const restore = guard.readJson(restorePath) ?? { receiver: plan.receiver, sessions: {} }
    for (const r of rows) {
      const s = manifest.sessions.find((x) => x.source_session_id === r.session_id)
      const entry = restore.sessions[r.session_id] ?? { state: 'PENDING', attempts: 0 }
      Object.assign(entry, { state: 'LAUNCHING', attempts: (entry.attempts ?? 0) + 1, at: new Date(E.now).toISOString(), routine: true, origin_machine: r.origin_machine, target_machine: r.target_machine })
      restore.sessions[r.session_id] = entry
      guard.writeJsonAtomic(restorePath, restore)
      const promptFile = join(E.home, 'resume-prompts', `${id}--${r.session_id}.md`)
      const prompt = guard.resumePrompt(E, manifest, s)
      mkdirSync(dirname(promptFile), { recursive: true })
      writeFileSync(promptFile, prompt)
      const cwd = s.working_directory && existsSync(s.working_directory) ? s.working_directory : homedir()
      let result
      try { result = launch(E, { prompt, promptFile, cwd, session: s, manifest }) } catch (err) { result = { ok: false, detail: String(err?.message ?? err) } }
      entry.state = result?.ok ? (result.offered ? 'OFFERED' : 'RESTORED') : 'FAILED_RETRYABLE'
      entry.detail = guard.redact(result?.detail ?? '')
      if (result?.chip) { entry.chip = result.chip; chips.push({ source_session_id: r.session_id, ...result.chip }) }
      guard.writeJsonAtomic(restorePath, restore)
      r.action = `resumed:${entry.state}`
      launched.push({ handoff_id: id, session_id: r.session_id, target_machine: r.target_machine, state: entry.state })
    }
  }
  return { ok: launched.every((l) => l.state !== 'FAILED_RETRYABLE'), launched, chips }
}

/**
 * The Quota Handoff Routine. Returns a report; `ok: false` with
 * `result: 'NO RESUME'` whenever archive or verification fails.
 * @param {{ mode?: string, assign?: object, pool?: string[], allowCross?: boolean, planOnly?: boolean, launcher?: string|Function, self?: string, windowMs?: number }} opts
 * @param {{ guard?: object, E?: object, afterArchive?: Function }} hooks - tests only.
 */
export async function runRoutine(opts = {}, hooks = {}) {
  const guard = hooks.guard ?? await loadGuard()
  const E = hooks.E ?? guard.env()
  const mode = opts.mode ?? 'local'
  if (!MODES[mode]) return { ok: false, code: 'UNKNOWN_MODE', modes: Object.keys(MODES) }
  const self = [opts.self ?? process.env.CLAUDE_CODE_SESSION_ID].filter(Boolean)
  const report = { routine: 'quota-handoff', manual: true, current_machine: E.host, account: E.account, mode, machine_mode: MODES[mode], phases: [] }

  const archived = archiveAll(guard, E, { self })
  report.handoff_id = archived.manifest?.handoff_id ?? null
  report.phases.push({ phase: 'ARCHIVE_ALL', ok: archived.ok, active_before: archived.expected.length, archived: archived.manifest?.sessions?.length ?? 0, ...(archived.error ? { error: archived.error } : {}) })
  if (!archived.ok) return { ok: false, code: 'ARCHIVE_FAILED', result: 'NO RESUME', ...report }
  hooks.afterArchive?.(archived.manifest, E)

  const verified = verifyArchive(guard, E, archived.manifest.handoff_id, archived.expected)
  const fresh = guard.loadManifest(E, archived.manifest.handoff_id)
  if (fresh?.routine) { fresh.routine.verification = { ok: verified.ok, at: new Date(E.now).toISOString(), errors: verified.errors }; writeManifest(guard, E, fresh) }
  report.phases.push({ phase: 'VERIFY_ARCHIVE', ok: verified.ok, sessions: verified.checks, errors: verified.errors })
  if (!verified.ok) return { ok: false, code: 'ARCHIVE_UNVERIFIED', result: 'NO RESUME', recovery: `quota-handoffs/${archived.manifest.handoff_id}/ kept; no session was stopped or changed`, ...report }

  const plan = buildPlan(guard, E, { mode, assign: opts.assign, pool: opts.pool, allowCross: opts.allowCross, self, windowMs: opts.windowMs })
  report.phases.push({ phase: 'BUILD_RESUME_PLAN', ok: true, rows: plan.rows.length, resume_here: plan.rows.filter((r) => r.action === 'resume-here').length })
  if (opts.planOnly) { saveRoutinePlan(guard, E, archived.manifest.handoff_id, plan); return { ok: true, result: 'PLAN ONLY', ...report, plan } }

  const resumed = resumeHere(guard, E, plan, { launcher: opts.launcher ?? 'chips' })
  saveRoutinePlan(guard, E, archived.manifest.handoff_id, plan)
  report.phases.push({ phase: 'MACHINE_AWARE_RESUME', ok: resumed.ok, launched: resumed.launched?.length ?? 0, ...(resumed.code ? { code: resumed.code } : {}) })
  return { ok: resumed.ok, result: resumed.ok ? 'RESUMED' : 'PARTIAL', ...report, plan, launched: resumed.launched ?? [], chips: resumed.chips ?? [] }
}

/** The plan, as decided, beside the archive it was built after. */
function saveRoutinePlan(guard, E, id, plan) {
  guard.writeJsonAtomic(join(handoffDir(E, id), 'routine-plan.json'), { ...plan, decided_at: new Date(E.now).toISOString() })
}

/** `node quota-handoff.mjs routine [--mode local|original|choose|pooled] [--assign sid=machine,...] [--pool m1,m2] [--allow-cross-machine] [--plan-only] [--launcher chips|print|terminal] [--self id] [--window-hours N]` */
export async function routineCli(argv) {
  const f = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const [k, v] = argv[i].slice(2).split('=')
    f[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true)
  }
  const list = (v) => (typeof v === 'string' ? v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : [])
  const assign = Object.fromEntries(list(f.assign).map((p) => p.split('=')).filter((p) => p.length === 2))
  const result = await runRoutine({
    mode: f.mode ?? 'local', assign, pool: list(f.pool), allowCross: Boolean(f['allow-cross-machine']),
    planOnly: Boolean(f['plan-only']), launcher: f.launcher ?? 'chips', self: typeof f.self === 'string' ? f.self : undefined,
    windowMs: f['window-hours'] ? Number(f['window-hours']) * 3_600_000 : undefined,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return result
}

async function readInput() {
  if (process.stdin.isTTY) return {}
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return {} }
}

async function main() {
  const input = await readInput()
  const event = input.hook_event_name ?? 'UserPromptSubmit'
  const sessionId = input.session_id ?? 'unknown'
  const state = readJson(STATE) ?? { sessions: {} }
  state.sessions ??= {}
  let stateChanged = false

  const data = readJson(CACHE)
  const ageMs = data?.capturedAt ? NOW - data.capturedAt : Infinity

  // Keep the figures fresh even when no status line is rendering, at most once per stale window.
  if (ageMs > STALE_MS && process.env.QUOTA_HANDOFF_NO_REFRESH !== '1' && existsSync(REFRESHER)
    && NOW - (state.lastRefreshSpawn ?? 0) > STALE_MS) {
    try {
      spawn(process.execPath, [REFRESHER], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      state.lastRefreshSpawn = NOW
      stateChanged = true
    } catch {}
  }

  const guarded = await quotaGuard(input, data, state, event)
  if (guarded.changed) stateChanged = true

  const session = { sessionId, ...transcriptSignals(input.transcript_path, NOW) }
  const found = assess(data, NOW, session)
  let output
  if (found) {
    const last = state.sessions[sessionId]
    const sameWindow = last?.key === found.key
    const due = !sameWindow || found.level > last.level || NOW - last.at > REPEAT_MS
    if (due) {
      const firstForWindow = !sameWindow || found.level > last.level
      state.sessions[sessionId] = { key: found.key, level: found.level, at: NOW }
      stateChanged = true
      output = {
        hookSpecificOutput: { hookEventName: event, additionalContext: message(found, data, ageMs) },
        ...(firstForWindow ? { systemMessage: `Claude handoff trigger (${found.summary}): the agent is writing a handoff note to the shared brain.` } : {}),
      }
    }
  }

  for (const [id, entry] of Object.entries(state.sessions)) {
    if (NOW - (entry?.at ?? 0) > PRUNE_MS) { delete state.sessions[id]; stateChanged = true }
  }
  if (stateChanged) {
    try {
      mkdirSync(dirname(STATE), { recursive: true })
      writeFileSync(STATE, JSON.stringify(state, null, 2))
    } catch {}
  }
  if (guarded.context) {
    output ??= { hookSpecificOutput: { hookEventName: event, additionalContext: '' } }
    const prior = output.hookSpecificOutput.additionalContext
    output.hookSpecificOutput.additionalContext = prior ? `${prior}\n\n${guarded.context}` : guarded.context
  }
  // The user sees "handoff available" themselves; running it stays their call.
  if (guarded.notice) {
    output.systemMessage = output.systemMessage ? `${output.systemMessage} ${guarded.notice}` : guarded.notice
  }
  if (output) process.stdout.write(JSON.stringify(output))
}

const direct = process.argv[1] && import.meta.url.toLowerCase().endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop().toLowerCase())
if (direct && process.argv[2] === 'routine') {
  // The Quota Handoff Routine, called by /quota-handoff - never by the hook itself.
  let result
  try { result = await routineCli(process.argv.slice(3)) } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: 'ROUTINE_ERROR', result: 'NO RESUME', error: String(err?.message ?? err) })}\n`)
  }
  process.exit(result?.ok ? 0 : 1)
} else if (direct) {
  try { await main() } catch {}
  process.exit(0)
}
