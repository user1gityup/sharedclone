#!/usr/bin/env node
// PM driver for a DeepSeek Harness (DSH) instance on THIS machine.
//
// DSH exposes no council/pipeline/swarm API. A pipeline run is driven exactly
// the way the browser panel drives it (packages/client/ui-council-budget/src/
// client/PipelineControl.tsx): a prompt starts it, the `council` settings
// namespace carries its whole durable state, gates are approved by a settings
// write FOLLOWED BY a prompt (the deliberate two-factor in tool-council/src/
// approval.ts), and stop is a settings write, never a prompt.
//
// The settings plane is loopback-only (packages/client/connection/src/index.ts
// PRIVILEGED_METHODS), so this driver can only ever drive the DSH on its own
// host. Cross-machine work is the runner's problem, not this file's.
//
// Never sets council.autoApprove: the two-factor approval gate is deliberate.
// Zero dependencies, like the rest of pm.

import { pathToFileURL } from 'node:url'

const DEFAULT_BASE = process.env.DSH_BASE || 'http://127.0.0.1:3080'

/** A DSH call that came back `ok: false`, or a transport failure. */
export class DshError extends Error {
  constructor(message, { method, code, details } = {}) {
    super(message)
    this.name = 'DshError'
    this.method = method
    this.code = code
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// The panel's prompts, copied verbatim so a PM-started run is indistinguishable
// from a user-started one. Keep in step with PipelineControl.tsx.
// ---------------------------------------------------------------------------

/** The prompt that starts a run. Mirror of PipelineControl.startPrompt(). */
export function startPrompt(request, stages = '', mode = '') {
  const order = String(stages).trim() === '' ? '' : ` Pass stages as \`${String(stages).trim()}\`.`
  const m = String(mode).trim() === '' ? '' : ` Pass mode as \`${String(mode).trim()}\`.`
  return `Run the pipeline tool on this request, one stage at a time.${order}${m} Request: ${request}`
}

/** The prompt that advances a run already in progress. */
export const CONTINUE_PROMPT = 'Continue the pipeline — call the pipeline tool again to advance the next stage.'

/** The prompt that abandons the run in progress and starts a fresh one. */
export const RESTART_PROMPT = 'Restart the pipeline: call the pipeline tool with restart set to true.'

/** Recover a stalled council whose stored plan has been approved. */
export const ADVANCE_TO_SWARM_PROMPT = 'Advance this approved pipeline council plan directly to swarm: call the pipeline tool with advanceToSwarm set to true. Keep the existing run and its stored plan.'

/**
 * Every key a stop writes, in write order, with the value that clears it.
 * `pipelineStoppedId` goes first so a stage still in flight sees the stop
 * before `pipelineId` clears. Nothing here approves or spends.
 */
export function stopWrites(id) {
  return [
    ['pipelineStoppedId', id], ['pipelineAuto', false], ['pipelineId', ''],
    ['pipelineQuery', ''], ['pipelineStage', ''], ['pipelineStages', ''],
    ['pipelinePlan', ''], ['pipelineWinner', ''], ['pipelineProfile', ''],
    ['pipelineTasks', ''], ['pipelineUnits', ''], ['pipelineCandidates', ''],
    ['pipelinePicked', ''], ['pipelineHoldDetail', ''], ['pipelineHoldSeat', ''],
    ['pipelineHoldResumeAt', 0], ['pipelineHoldSource', ''],
    ['pendingProposeId', ''], ['approvedProposeId', ''],
    ['pendingSwarmId', ''], ['approvedSwarmId', ''],
    ['pendingPlanId', ''], ['approvedPlanId', ''],
  ]
}

/**
 * The three gates a pipeline can stop at, as (pending field, approved id
 * field, approved-at field, what the second-factor prompt must say).
 */
export const GATES = [
  { name: 'plan', pending: 'pendingPlanId', approvedId: 'approvedPlanId', approvedAt: 'approvedAt',
    prompt: 'The council plan is approved. Continue the pipeline — call the pipeline tool again to advance the next stage.' },
  { name: 'swarm', pending: 'pendingSwarmId', approvedId: 'approvedSwarmId', approvedAt: 'approvedSwarmAt',
    prompt: 'The swarm task list is approved. Continue the pipeline — call the pipeline tool again to advance the next stage.' },
  { name: 'propose', pending: 'pendingProposeId', approvedId: 'approvedProposeId', approvedAt: 'approvedProposeAt',
    prompt: 'The proposal is approved. Continue the pipeline — call the pipeline tool again to advance the next stage.' },
]

/**
 * The settings ops that seat exactly `roster` for one run, and the ops that
 * put every touched flag back the way the user layer had it.
 *
 * DSH's pipeline tool takes no seat list, and it re-reads the council
 * namespace at every stage, so a per-run roster has to be the enabled flags
 * themselves for the life of the run. Only `enabled` is written - per path,
 * never by replacing a section - so a model or command the user changes while
 * the run is live survives the restore. A flag the user layer never set is
 * unset on restore (the whole entry, when the user layer had none) rather than pinned to the value it happened to have.
 *
 * The seat universe is what settings carries: `seats`, `extraSeats`, and for
 * the swarm also `swarmRoster`. A shipped seat with no settings entry at all
 * cannot be seen from here and keeps its shipped default.
 * @param council - { value, user } from council().
 * @param roster - { council: [seat ids], swarm: [seat ids] }.
 * @returns { ops, restore, unknown } - unknown lists ids settings does not know.
 */
export function rosterWrites({ value = {}, user = {} } = {}, roster = {}) {
  const onCouncil = new Set(roster.council ?? [])
  const onSwarm = new Set(roster.swarm ?? [])
  const builtin = Object.keys(value.seats ?? {})
  const extra = Object.keys(value.extraSeats ?? {}).filter((id) => !builtin.includes(id))
  const seatIds = [...builtin, ...extra]
  const swarmIds = [...new Set([...seatIds, ...Object.keys(value.swarmRoster ?? {})])]
  const unknown = [
    ...[...onCouncil].filter((id) => !seatIds.includes(id)).map((id) => `council:${id}`),
    ...[...onSwarm].filter((id) => !swarmIds.includes(id)).map((id) => `swarm:${id}`),
  ]
  const ops = []
  const restore = []
  const seat = (section, id, want) => {
    const path = [section, id, 'enabled']
    const entry = user?.[section]?.[id]
    const was = entry?.enabled
    ops.push({ op: 'set', path, value: want })
    // An entry the user layer never had is removed whole, so no empty `{}`
    // is left behind for the schema to materialise defaults into.
    restore.push(entry === undefined ? { op: 'unset', path: [section, id] }
      : was === undefined ? { op: 'unset', path } : { op: 'set', path, value: was })
  }
  for (const id of builtin) seat('seats', id, onCouncil.has(id))
  for (const id of extra) seat('extraSeats', id, onCouncil.has(id))
  for (const id of swarmIds) seat('swarmRoster', id, onSwarm.has(id))
  return { ops, restore, unknown }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * A client for one DSH instance.
 * @param base - origin, default http://127.0.0.1:3080 or $DSH_BASE.
 */
export function openDsh({ base = DEFAULT_BASE, fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  const origin = base.replace(/\/+$/, '')
  let seq = 0

  /**
   * One RPC. The browser-trust fence reads Host and Fetch-Metadata, so both
   * are sent the way the panel sends them; privileged methods additionally
   * need loopback, which is where this process already is.
   */
  async function rpc(method, payload = {}) {
    const rpcId = `pm-${Date.now().toString(36)}-${++seq}`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    let res
    try {
      res = await fetchImpl(`${origin}/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal: ac.signal,
      })
    } catch (err) {
      throw new DshError(`${method}: ${err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(err?.message ?? err)}`, { method })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new DshError(`${method}: HTTP ${res.status}`, { method, code: `http-${res.status}` })
    const body = await res.json()
    const result = body?.result
    if (!result?.ok) {
      throw new DshError(`${method}: ${result?.error?.message ?? 'call failed'}`, { method, code: result?.error?.code, details: result?.error?.details })
    }
    return result.value
  }

  /** Is this DSH answering at all? */
  async function alive() {
    try { await rpc('session.list', {}); return true } catch { return false }
  }

  /** The `council` namespace: its current values and the revision to write against. */
  async function council() {
    const view = await rpc('settings.describe', {})
    const ns = (view.namespaces ?? []).find((n) => n.ns === 'council')
    if (!ns) throw new DshError('this DSH has no `council` settings namespace - the council plugin is not loaded', { method: 'settings.describe', code: 'no-council' })
    return { revision: ns.revision, value: ns.value ?? {}, user: ns.user ?? {} }
  }

  /**
   * Write council fields. Pairs are applied as one `set` op each, in the
   * order given, under one optimistic revision.
   */
  async function write(pairs, expectedRevision) {
    const ops = pairs.map(([field, value]) => ({ op: 'set', path: [field], value }))
    return rpc('settings.mutate', { ns: 'council', ops, ...(expectedRevision === undefined ? {} : { expectedRevision }) })
  }

  /**
   * Apply raw path ops to the council namespace, retrying against a fresh
   * revision when a live run wrote in between. Only for ops that are safe to
   * re-apply, which every roster op is.
   */
  async function mutate(ops, { attempts = 4 } = {}) {
    let last
    for (let i = 0; i < attempts; i++) {
      const { revision } = await council()
      try {
        return await rpc('settings.mutate', { ns: 'council', ops, expectedRevision: revision })
      } catch (err) {
        last = err
        if (!/changed since it was read/i.test(err.message)) throw err
      }
    }
    throw new DshError(`council write kept losing the revision race after ${attempts} attempts: ${last?.message}`, { method: 'settings.mutate', code: 'write-contended' })
  }

  /**
   * Seat exactly this roster: every council and swarm enabled flag DSH has in
   * settings is set on or off. Refuses, writing nothing, when the roster
   * names a seat this DSH does not have.
   * @returns { applied: roster, restore: ops } - hand `restore` to restoreRoster.
   */
  async function applyRoster(roster) {
    const plan = rosterWrites(await council(), roster)
    if (plan.unknown.length) {
      throw new DshError(`this DSH has no seat ${plan.unknown.join(', ')}; refusing to start with a roster it cannot honour`, { code: 'unknown-seat', details: { unknown: plan.unknown } })
    }
    await mutate(plan.ops)
    return { applied: { council: [...(roster.council ?? [])], swarm: [...(roster.swarm ?? [])] }, restore: plan.restore }
  }

  /** Put back the flags applyRoster changed. */
  async function restoreRoster(restore) {
    if (!Array.isArray(restore) || restore.length === 0) return { restored: 0 }
    await mutate(restore)
    return { restored: restore.length }
  }

  /**
   * The session a run is driven through: an existing non-running session for
   * `cwd` when there is one, otherwise a fresh session. Reuse keeps the
   * council's stored run and its journal in one conversation, which is what
   * `resume` depends on.
   */
  async function session({ cwd, agentPreset, sessionId, fresh = false } = {}) {
    if (sessionId) return sessionId
    // A corrected relaunch must not inherit the conversation that produced the
    // plan being corrected, so `fresh` skips reuse entirely.
    if (fresh) {
      const made = await rpc('session.create', { ...(cwd ? { cwd } : {}), ...(agentPreset ? { agentPreset } : {}) })
      return made.sessionId ?? made.id
    }
    const { items = [] } = await rpc('session.list', {})
    const want = cwd ? items.filter((s) => s.cwd === cwd) : items
    const free = want.find((s) => !s.running)
    if (free) return free.sessionId
    const created = await rpc('session.create', { ...(cwd ? { cwd } : {}), ...(agentPreset ? { agentPreset } : {}) })
    return created.sessionId ?? created.id
  }

  /** Send one prompt into a session. `queue` is what the panel uses. */
  async function prompt(sessionId, text, mode = 'queue') {
    return rpc('session.prompt', { sessionId, mode, content: [{ type: 'text', text }] })
  }

  /** The run's state, read straight out of the council namespace. */
  async function status() {
    const { value, revision } = await council()
    const gate = GATES.find((g) => value[g.pending] && value[g.pending] !== value[g.approvedId])
    return {
      revision,
      runId: value.pipelineId || '',
      stoppedId: value.pipelineStoppedId || '',
      stage: value.pipelineStage || '',
      stages: value.pipelineStages || '',
      query: value.pipelineQuery || '',
      profile: value.pipelineProfile || '',
      winner: value.pipelineWinner || '',
      auto: Boolean(value.pipelineAuto),
      hold: value.pipelineHoldResumeAt ? { resumeAt: value.pipelineHoldResumeAt, seat: value.pipelineHoldSeat || '', detail: value.pipelineHoldDetail || '', source: value.pipelineHoldSource || '' } : null,
      // A gate left behind by a stopped run still sits in settings; it is not
      // something to approve. `stale` is what tells the two apart.
      gate: gate ? { name: gate.name, id: value[gate.pending], stale: !value.pipelineId } : null,
      running: Boolean(value.pipelineId),
    }
  }

  /**
   * Wait until `test(status)` holds. Polls the council namespace; DSH has no
   * push channel a non-browser client can cheaply join.
   */
  async function waitFor(test, { timeoutMs: waitMs = 120_000, everyMs = 2_000 } = {}) {
    const deadline = Date.now() + waitMs
    let last = await status()
    while (!test(last)) {
      if (Date.now() > deadline) throw new DshError(`timed out after ${waitMs}ms waiting on the pipeline (stage ${last.stage || 'none'}, run ${last.runId || 'none'})`, { code: 'wait-timeout', details: last })
      await new Promise((r) => setTimeout(r, everyMs))
      last = await status()
    }
    return last
  }

  /**
   * Start a pipeline run. Returns the status once DSH has written a
   * `pipelineId`, which is the only proof the run really started.
   */
  //
  // With a `roster`, the seats are applied before the prompt and left in place
  // for the run - DSH reads them at every stage. The result's `roster.restore`
  // is what puts the user's flags back once the run is over. If the start
  // fails before the prompt is accepted the flags are restored here; once the
  // prompt is in, a run may still come up, so the roster stays and the error
  // carries `rosterRestore` for the caller to keep.
  async function start({ request, stages = '', mode = '', cwd, agentPreset, sessionId, fresh = false, roster, waitMs = 180_000 }) {
    if (!request) throw new DshError('start needs a request', { code: 'bad-request' })
    const before = await status()
    if (before.running) throw new DshError(`this DSH already has pipeline ${before.runId} at stage ${before.stage || 'unknown'}; stop or resume it instead of starting a second run`, { code: 'already-running', details: before })
    const seated = roster ? await applyRoster(roster) : null
    let prompted = false
    try {
      const sid = await session({ cwd, agentPreset, sessionId, fresh })
      await prompt(sid, startPrompt(request, stages, mode))
      prompted = true
      const after = await waitFor((s) => Boolean(s.runId), { timeoutMs: waitMs })
      return { ...after, sessionId: sid, ...(seated ? { roster: seated } : {}) }
    } catch (err) {
      if (seated && !prompted) await restoreRoster(seated.restore).catch(() => {})
      else if (seated) err.rosterRestore = seated.restore
      throw err
    }
  }

  /** Advance a run that is already in progress. */
  async function advance({ sessionId, cwd, text = CONTINUE_PROMPT } = {}) {
    const s = await status()
    if (!s.runId) throw new DshError('no pipeline is in progress on this DSH', { code: 'not-running' })
    if (s.hold && s.hold.resumeAt > Date.now()) {
      throw new DshError(`pipeline is holding until ${new Date(s.hold.resumeAt).toISOString()} (${s.hold.seat || 'seat'}: ${s.hold.detail || 'no detail'})`, { code: 'held', details: s.hold })
    }
    const sid = await session({ cwd, sessionId })
    await prompt(sid, text)
    return { ...s, sessionId: sid }
  }

  /**
   * Clear a pending gate: the settings write first, then a prompt. Both are
   * required - the settings write alone is one factor and tool-council will
   * not act on it (approval.ts). Never touches autoApprove.
   */
  async function approveGate({ sessionId, cwd, force = false } = {}) {
    const { value, revision } = await council()
    const gate = GATES.find((g) => value[g.pending] && value[g.pending] !== value[g.approvedId])
    if (!gate) return { approved: null }
    const id = value[gate.pending]
    // A gate with no live pipelineId belongs to a run that was stopped. The
    // panel leaves it in settings; approving it would authorise a stage
    // nothing is going to ask for.
    if (!value.pipelineId && !force) {
      throw new DshError(`the pending ${gate.name} gate ${id} is stale - no pipeline is running (council.pipelineId is empty). Pass force to approve it anyway.`, { code: 'stale-gate', details: { gate: gate.name, id } })
    }
    await write([[gate.approvedId, id], [gate.approvedAt, Date.now()]], revision)
    const sid = await session({ cwd, sessionId })
    await prompt(sid, gate.prompt)
    return { approved: { gate: gate.name, id }, sessionId: sid }
  }

  /**
   * Stop the run. A settings write in the panel's order, never a prompt.
   *
   * A live run writes the council namespace constantly, so an optimistic
   * revision taken a moment ago is often already stale - and a stop that
   * loses that race is exactly the stop that matters. It is retried against
   * the fresh revision; every value it writes revokes, so re-applying it is
   * safe.
   */
  async function stop(runId, { attempts = 4 } = {}) {
    let last
    for (let i = 0; i < attempts; i++) {
      const s = await status()
      const id = runId || s.runId || s.stoppedId
      if (!id) return { stopped: null }
      try {
        await write(stopWrites(id), s.revision)
        return { stopped: id, attempts: i + 1 }
      } catch (err) {
        last = err
        if (!/changed since it was read/i.test(err.message)) throw err
      }
    }
    throw new DshError(`stop kept losing the revision race after ${attempts} attempts: ${last?.message}`, { code: 'stop-contended' })
  }

  /**
   * Repair a stalled run where it stands: same run id, council.pipeline*
   * untouched, the seat journal reused (it replays free while the prompt
   * digest matches). This is the user's rule for a run that does not
   * complete - fix it on the spot, do not stop and start again.
   *
   * It is a prompt, not a settings write, so nothing about the run's stored
   * state is disturbed. A stopped run cannot be amended: there is no longer
   * anything to carry on from.
   */
  async function amend({ fix, sessionId, cwd } = {}) {
    if (!fix) throw new DshError('amend needs a fix: what to tell the run so it can carry on', { code: 'bad-request' })
    const s = await status()
    if (!s.runId) throw new DshError('no pipeline is in progress on this DSH, so there is nothing to amend in place. A stopped run has to be started again as a new run.', { code: 'not-running', details: s })
    const sid = await session({ cwd, sessionId })
    await prompt(sid, `Correction for the pipeline run in progress. Keep this run and its stored plan - do NOT restart and do NOT call the pipeline tool with restart. ${fix}

Then continue the pipeline: call the pipeline tool again to advance from where it stopped.`)
    return { ...s, sessionId: sid, amended: true }
  }

  /**
   * Abandon the run and start a fresh one. Separate from amend, and named,
   * because it throws the journal away and resets lastUserTurnAt - the
   * expensive thing to do by accident.
   */
  async function restart({ sessionId, cwd, confirm = false } = {}) {
    if (!confirm) throw new DshError('restart discards the run journal and resets lastUserTurnAt. Pass confirm to say you mean it; amend repairs a stalled run in place instead.', { code: 'restart-unconfirmed' })
    const s = await status()
    const sid = await session({ cwd, sessionId })
    await prompt(sid, RESTART_PROMPT)
    return { ...s, sessionId: sid, restarted: true }
  }

  /**
   * Resume a run DSH still holds: it continues from the stored `pipelineId`
   * rather than starting a new one. Refuses when the stored run is a
   * different one, so a resume can never silently restart.
   */
  async function resume({ runId, sessionId, cwd } = {}) {
    const s = await status()
    if (!s.runId) throw new DshError('this DSH holds no pipeline to resume; its council.pipelineId is empty', { code: 'nothing-to-resume', details: s })
    if (runId && runId !== s.runId) throw new DshError(`this DSH holds pipeline ${s.runId}, not ${runId} - refusing to resume, it would run the wrong work`, { code: 'wrong-run', details: s })
    if (s.gate) return { ...(await approveGate({ sessionId, cwd })), runId: s.runId, resumedVia: 'gate' }
    return { ...(await advance({ sessionId, cwd })), resumedVia: 'continue' }
  }

  return { base: origin, rpc, alive, council, write, mutate, applyRoster, restoreRoster, session, prompt, status, waitFor, start, advance, approveGate, amend, restart, stop, resume }
}

// ---------------------------------------------------------------------------
// CLI: node drivers/dsh.mjs <status|start|continue|approve|resume|stop> [...]
// Exists so every claim about this driver can be checked by hand.
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2)
  const a = {}
  const pos = []
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) a[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') ? true : rest[++i]
    else pos.push(rest[i])
  }
  const dsh = openDsh({ base: a.base })
  const out = (v) => console.log(JSON.stringify(v, null, 2))
  try {
    if (cmd === 'status') out(await dsh.status())
    else if (cmd === 'council') out((await dsh.council()).value)
    else if (cmd === 'start') out(await dsh.start({ request: a.request ?? pos[0], stages: a.stages ?? '', mode: a.mode ?? '', cwd: a.cwd, fresh: Boolean(a.fresh) }))
    else if (cmd === 'continue') out(await dsh.advance({ cwd: a.cwd }))
    else if (cmd === 'approve') out(await dsh.approveGate({ cwd: a.cwd, force: Boolean(a.force) }))
    else if (cmd === 'resume') out(await dsh.resume({ runId: a.run, cwd: a.cwd }))
    else if (cmd === 'amend') out(await dsh.amend({ fix: a.fix ?? pos[0], cwd: a.cwd }))
    else if (cmd === 'restart') out(await dsh.restart({ cwd: a.cwd, confirm: Boolean(a.confirm) }))
    else if (cmd === 'stop') out(await dsh.stop(a.run))
    else {
      console.log(`dsh driver - ${dsh.base}
  status                       read council.pipeline* state
  start --request "..." [--stages a,b --mode m --cwd path --fresh]
  continue                     send the panel's CONTINUE_PROMPT
  approve [--force]            clear the pending gate (settings write, then prompt)
  resume [--run <id>]          approve-or-continue the run this DSH already holds
  amend --fix "..."            repair the running pipeline in place, keeping its id and journal
  restart --confirm            abandon the run and start over (discards the journal)
  stop [--run <id>]            the panel's stopWrites order`)
      process.exitCode = cmd ? 2 : 0
    }
  } catch (err) {
    console.error(`error: ${err.message}`)
    if (err.details) console.error(JSON.stringify(err.details, null, 2))
    process.exitCode = 1
  }
}
