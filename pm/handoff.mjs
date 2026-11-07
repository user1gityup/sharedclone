// Session handoff and recovery verification (T-538550c7, T-dc454614, T-3f52f2ef).
// Pure and injectable: no I/O. Encodes the rules in quota-handoff-protocol.md so tests (and a
// future hook) can prove them: checkpoint/handoff thresholds, the note's required fields,
// receiver verification against filesystem/git/process/log state, and the resume plan
// (Remote Control first, then contact the prior agent, origin host or cross-host).

export const CHECKPOINT = { contextTokens: 100_000, hours: 4, quotaPct: 95 }
export const FINALIZE = { contextTokens: 150_000, hours: 8, quotaPct: 99 }
export const WEEKLY_STOP_PCT = 98
export const STATES = ['active', 'ready', 'claimed', 'blocked', 'complete']
export const REQUIRED_FIELDS = ['handoff id', 'time', 'host', 'session', 'model', 'repo', 'owner', 'ask',
  'verified', 'partial', 'processes', 'permissions', 'remote control', 'open questions', 'next', 'verification', 'do not repeat']

export class HandoffError extends Error { constructor(code, msg) { super(msg); this.code = code } }

/** What the agent must do given its telemetry. Highest tier wins; reasons are all that fired. */
export function checkpointAction(t = {}) {
  const ctx = Number(t.contextTokens) || 0
  const hrs = Number(t.hours) || 0
  const quota = Math.max(0, ...(t.quotaPcts ?? [t.quotaPct ?? 0]).map(Number))
  const reasons = []
  if (ctx >= CHECKPOINT.contextTokens) reasons.push('context>=100k')
  if (hrs >= CHECKPOINT.hours) reasons.push('hours>=4')
  if (quota >= CHECKPOINT.quotaPct) reasons.push('quota>=95')
  if (t.providerWarning) reasons.push('provider-warning')
  if (t.compactionLoss) reasons.push('compaction-loss')
  if (t.contextConfusion) reasons.push('context-confusion')
  const final = []
  if (ctx >= FINALIZE.contextTokens) final.push('context>=150k')
  if (hrs >= FINALIZE.hours) final.push('hours>=8')
  if (quota >= FINALIZE.quotaPct) final.push('quota>=99')
  if (t.imminentExhaustion) final.push('imminent-exhaustion')
  const weekly = Number(t.weeklyPct) >= WEEKLY_STOP_PCT
  if (weekly) final.push('weekly>=98')
  const tier = weekly ? 'stop-all' : final.length ? 'finalize' : reasons.length ? 'checkpoint' : 'none'
  return {
    tier,
    reasons: [...reasons, ...final],
    writeNote: tier !== 'none',
    startNewScope: tier === 'none' || tier === 'checkpoint',
    stopAllAgents: tier === 'stop-all',
    reportNotePath: tier === 'stop-all',
  }
}

const norm = (k) => k.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
const ALIASES = {
  time: ['time', 'updated'], repo: ['repo', 'repository'], next: ['next', 'next action'],
  processes: ['processes', 'processes ports'],
}

/** Parse a handoff note: frontmatter + "Key: value" lines. Returns { meta, fields }. */
export function parseNote(text) {
  const src = text.replace(/\r\n/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src)
  const meta = {}
  let body = src
  if (m) {
    for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim() }
    body = src.slice(m[0].length)
  }
  const fields = {}
  for (const l of body.split('\n')) {
    const i = l.indexOf(':')
    if (i < 1) continue
    const k = norm(l.slice(0, i))
    let canon = k
    for (const [c, al] of Object.entries(ALIASES)) if (al.includes(k)) canon = c
    if (!(canon in fields)) fields[canon] = l.slice(i + 1).trim()
  }
  return { meta, fields }
}

/** Missing required fields, bad state, bad Remote Control record. Empty list = valid. */
export function validateNote(note) {
  const f = note.fields
  const problems = []
  for (const k of REQUIRED_FIELDS) if (!f[k]) problems.push(`missing field: ${k}`)
  for (const k of ['name', 'description', 'type']) if (!note.meta[k]) problems.push(`missing frontmatter: ${k}`)
  const rc = (f['remote control'] ?? '').toLowerCase()
  if (f['remote control'] && !/^(on|off)\b/.test(rc)) problems.push('remote control must be on|off')
  if (/^on\b/.test(rc) && !/(host|session|ref|handle)/.test(rc)) problems.push('remote control on needs a peer handle (host, session id, short ref)')
  if (f.state && !STATES.includes(f.state.toLowerCase())) problems.push(`bad state ${f.state}`)
  return problems
}

/** Index line + signed log entry present for this handoff id. */
export function checkRegistered({ id, index = '', log = '', model }) {
  const out = []
  if (!index.includes(id)) out.push('no index line')
  const entry = log.split('\n').find((l) => l.includes(id))
  if (!entry) out.push('no log entry')
  else if (model && !entry.includes(model)) out.push('log entry not signed with the model name')
  return out
}

/**
 * Receiver verification: compare the record against current state. Evidence, not authority:
 * newer state wins and every difference is returned for the receiver to record in the note.
 * observed = { files: {path:bool}, git: {head, dirty:[paths]}, processes: [{pid}], logNewer: [lines] }
 * claimed  = { files:[paths], head, uncommitted:[paths], processes:[{pid,port}] }
 */
export function verifyRecord(claimed, observed) {
  const diffs = []
  for (const p of claimed.files ?? []) if (!observed.files?.[p]) diffs.push({ kind: 'file-missing', path: p })
  if (claimed.head && observed.git?.head && !observed.git.head.startsWith(claimed.head) && !claimed.head.startsWith(observed.git.head)) {
    diffs.push({ kind: 'head-moved', claimed: claimed.head, observed: observed.git.head })
  }
  const dirty = new Set(observed.git?.dirty ?? [])
  for (const p of claimed.uncommitted ?? []) if (!dirty.has(p)) diffs.push({ kind: 'uncommitted-gone', path: p })
  for (const p of dirty) if (!(claimed.uncommitted ?? []).includes(p)) diffs.push({ kind: 'unrecorded-change', path: p })
  const live = new Set((observed.processes ?? []).map((x) => x.pid))
  for (const p of claimed.processes ?? []) if (!live.has(p.pid)) diffs.push({ kind: 'process-dead', pid: p.pid, port: p.port ?? null })
  for (const l of observed.logNewer ?? []) diffs.push({ kind: 'newer-log', line: l })
  return { ok: diffs.length === 0, diffs, authority: 'current-state' }
}

const ALIAS_GROUPS = [['ndi2', 'vmixlaptop2x6'], ['vmixer2o2', 'vmixer']]
export const sameHost = (a, b) => a === b || ALIAS_GROUPS.some((g) => g.includes(a) && g.includes(b))

/**
 * Claim + resume plan. pm is the resume authority, the note is the fallback. Steps are ordered:
 * Remote Control first (when the prior session had it on), then claim, verify, then contact the
 * prior agent. An active live owner blocks the claim. Cross-host is flagged, never refused.
 */
export function planResume(note, { thisHost, pmTask = null, priorAgentLive = false, rcCanEnable = true, model }) {
  const f = note.fields
  const steps = []
  const warnings = []
  const state = (f.state ?? note.meta.state ?? 'ready').toLowerCase()
  if (state === 'complete') throw new HandoffError('COMPLETE', 'handoff is complete; nothing to resume')
  if (state === 'active' && priorAgentLive) throw new HandoffError('LIVE_OWNER', 'originating session still owns this handoff; coordinate first')
  const origin = f.host ?? ''
  const crossHost = !sameHost(origin, thisHost)
  const rcOn = /^on\b/i.test(f['remote control'] ?? '')
  if (rcOn) {
    if (rcCanEnable) steps.push('enable-remote-control')
    else warnings.push('remote control could not be enabled; recorded in note')
  }
  steps.push(pmTask ? 'read-pm-task' : 'pm-unavailable-use-note')
  steps.push('claim-note', 'verify-record')
  if (rcOn) steps.push('contact-prior-agent')
  else if (priorAgentLive) warnings.push('prior agent live but note records Remote Control off; no channel')
  if (pmTask?.execution_machine && !sameHost(pmTask.execution_machine, thisHost)) {
    warnings.push(`pm task executes on ${pmTask.execution_machine}; resume there or move it deliberately`)
  }
  if (crossHost) warnings.push(`cross-host resume: origin ${origin}, this ${thisHost}`)
  return { steps, warnings, crossHost, originHost: origin, remoteControlFirst: rcOn && rcCanEnable, claimAs: { state: 'claimed', model, host: thisHost } }
}

/** Apply the claim to note text: state -> claimed, new owner recorded, history kept. */
export function claimNote(text, { model, host, session, at }) {
  const line = `Claimed: ${model} on ${host} (${session}) at ${at}`
  const t = text.replace(/\r\n/g, '\n')
  const out = /^State:.*$/m.test(t) ? t.replace(/^State:.*$/m, 'State: claimed') : t.replace(/\n---\n/, '\n---\nState: claimed\n')
  return `${out.trimEnd()}\n${line}\n`
}
