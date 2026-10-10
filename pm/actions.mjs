#!/usr/bin/env node
// The operational layer: the buttons, and the rules that decide whether
// pressing one is legal.
//
// PM PREPARES RUNS; IT DOES NOT DISPATCH THEM. The user amended the DSH
// process on 2026-09-28: pm builds a run step by step, the user picks who sits
// on the council and the swarm, the user starts it, and a run that stalls is
// repaired on the spot rather than stopped and restarted. Every rule below
// follows from that.
//
// Four properties this file exists to hold:
//   1. No button is ever a no-op. A refusal is a 409 carrying its `reasons`,
//      never a silent success, so the UI can grey a button out with exactly
//      the rules the server enforces.
//   2. The roster is the user's. `prepare` leaves it empty on purpose and
//      `start` refuses without it. Nothing here defaults a seat, infers one,
//      or carries one over from a previous run.
//   3. Machine ownership is enforced here, not in the driver.
//   4. The driver is injected, so every rule is testable without a DSH.

import { hostname } from 'node:os'
import { PmError } from './store.mjs'

/** This host, as PM records it. Overridable for tests and for the runner. */
export const THIS_MACHINE = process.env.PM_MACHINE || hostname()

/**
 * One machine, several names. The brain and the handoffs call this host
 * `ndi2` (the account), Windows calls it `vmixlaptop2x6` (the hostname), and
 * the reconciled pm rows carry both - 114 tasks say `ndi2`, one says
 * `vmixlaptop2x6`. Without this, every action on a reconciled task would
 * refuse as if it belonged to another machine. Extra pairs go in
 * PM_MACHINE_ALIASES as a comma-separated list of names for THIS host.
 */
export const ALIAS_GROUPS = [['ndi2', 'vmixlaptop2x6']]

/** Every name this run answers to. */
export function machineNames(machine = THIS_MACHINE) {
  const names = new Set([machine])
  for (const group of ALIAS_GROUPS) if (group.includes(machine)) for (const n of group) names.add(n)
  for (const n of (process.env.PM_MACHINE_ALIASES || '').split(',').map((x) => x.trim()).filter(Boolean)) names.add(n)
  return names
}

/** Are these two names the same physical machine? */
export function sameMachine(a, b) {
  if (!a || !b) return true
  return a === b || machineNames(b).has(a) || machineNames(a).has(b)
}

/**
 * Which actions each lifecycle allows. The vocabulary is store.mjs
 * LIFECYCLES; anything not listed refuses.
 *
 * WAITING is where a prepared run sits: built, described, and waiting on the
 * user to pick the seats and press start. It is the only lifecycle `start`
 * is legal from, which is the whole prepare/dispatch split in one line.
 */
export const LEGAL = {
  READY: ['prepare', 'archive'],
  WAITING: ['start', 'prepare', 'archive'],
  PAUSED: ['resume', 'prepare', 'archive'],
  RUNNING: ['continue', 'amend', 'stop', 'archive'],
  VERIFY: ['continue', 'amend', 'archive'],
  FAILED: ['amend', 'prepare', 'archive'],
  BLOCKED: ['archive'],
  COMPLETE: ['archive'],
  ARCHIVED: [],
}

/** Lifecycle a task lands in when an action succeeds. */
const AFTER = {
  prepare: 'WAITING',
  start: 'RUNNING',
  resume: 'RUNNING',
  continue: 'RUNNING',
  amend: 'RUNNING',
  stop: 'PAUSED',
  archive: 'ARCHIVED',
}

/** The `status` that goes with each landing lifecycle (status stays the storage vocabulary). */
const STATUS_FOR = { RUNNING: 'in_progress', WAITING: 'in_progress', PAUSED: 'in_progress', ARCHIVED: 'done' }

export const ACTIONS = Object.keys(AFTER)

/** The two rosters a run needs before it may start. Neither has a default. */
export const ROSTER_SLOTS = ['council', 'swarm']

/** The prepared run recorded on a task, or null. Stored in `meta`, so it survives a restart. */
export function preparedRun(task) {
  try {
    const meta = typeof task.meta === 'string' ? JSON.parse(task.meta || '{}') : (task.meta ?? {})
    return meta.prepared ?? null
  } catch {
    return null
  }
}

/** Which roster slots a prepared run is still missing. */
export function missingRoster(prepared) {
  if (!prepared) return [...ROSTER_SLOTS]
  return ROSTER_SLOTS.filter((slot) => {
    const seats = prepared.roster?.[slot]
    return !Array.isArray(seats) || seats.length === 0
  })
}

/**
 * Why an action would be refused, as a list. Empty means it is allowed.
 * Pure: no I/O.
 */
export function refusals(task, action, { machine = THIS_MACHINE } = {}) {
  const out = []
  const lifecycle = task.lifecycle || 'READY'
  if (!ACTIONS.includes(action)) out.push(`${action} is not an action; try ${ACTIONS.join(', ')}`)
  else if (!(LEGAL[lifecycle] ?? []).includes(action)) {
    out.push(`a ${lifecycle} task allows ${(LEGAL[lifecycle] ?? []).join(', ') || 'no actions'}, not ${action}`)
  }
  if (action !== 'archive') {
    const owner = task.execution_machine
    if (owner && !sameMachine(owner, machine)) out.push(`${task.id} executes on ${owner}, and this is ${machine}; move it deliberately or run it there`)
  }
  if (action === 'start') {
    const prepared = preparedRun(task)
    if (!prepared) out.push('no prepared run: call prepare first, then pick the seats')
    else {
      const missing = missingRoster(prepared)
      if (missing.length) out.push(`the user picks the seats: the ${missing.join(' and ')} roster is empty, and pm never defaults one`)
    }
  }
  if (action === 'resume' && !task.run_ref && !task.checkpoint) {
    out.push('nothing to resume from: the task has neither a run_ref nor a checkpoint')
  }
  if (action === 'amend' && !task.run_ref) {
    out.push('nothing to amend: the task has no run_ref, so there is no run to repair in place')
  }
  return out
}

/** What each button would do right now, for a UI that must not offer dead buttons. */
export function available(task, { machine = THIS_MACHINE } = {}) {
  return ACTIONS.map((action) => {
    const why = refusals(task, action, { machine })
    return { action, allowed: why.length === 0, reasons: why }
  })
}

/**
 * Drivers by run kind. Injected so the rules above can be tested with no DSH,
 * and so a second driver (claude-code) plugs in without touching this file.
 */
export function defaultDrivers() {
  return {
    'dsh-pipeline': async () => (await import('./drivers/dsh.mjs')).openDsh(),
    'dsh-council': async () => (await import('./drivers/dsh.mjs')).openDsh(),
  }
}

/**
 * Run one action against a task.
 * @param store - an open pm store.
 * @param w - who is acting ({ actor, model }).
 * @param id - task id.
 * @param action - prepare|start|resume|continue|amend|stop|archive.
 * @param opts - { machine, drivers, request, stages, mode, cwd, roster, fix, restart, note }.
 */
export async function act(store, w, id, action, opts = {}) {
  const machine = opts.machine || THIS_MACHINE
  const drivers = opts.drivers ?? defaultDrivers()
  const task = store.getTask(id) // throws 404 when there is no such task

  const why = refusals(task, action, { machine })
  if (why.length) throw new PmError(409, `${action} refused: ${why.join('; ')}`, { task, action, reasons: why })

  if (action === 'archive') {
    // A run's seats are put back when it is archived, unless DSH is still
    // running it: flipping seats under a live run changes who works on it.
    const pending = rosterRestoreOf(task)
    if (pending) {
      const open = drivers[task.kind && kind_is_run(task.kind) ? task.kind : 'dsh-pipeline']
      const dsh = open ? await open() : null
      const live = dsh ? await dsh.status().catch(() => null) : null
      if (dsh && live && !live.running) {
        await dsh.restoreRoster(pending)
        return settle(store, w, id, 'ARCHIVED', { note: `${opts.note ?? 'archived'}; restored the DSH seat flags this run's roster had changed`, fields: { meta: JSON.stringify(mergeMeta(task, { rosterRestore: null })) } })
      }
      return settle(store, w, id, 'ARCHIVED', { note: `${opts.note ?? 'archived'}; DSH seat flags NOT restored (${live?.running ? `pipeline ${live.runId} still running` : 'DSH unreachable'}) - meta.rosterRestore still holds them` })
    }
    return settle(store, w, id, 'ARCHIVED', { note: opts.note ?? 'archived' })
  }

  // store.startRun compares execution_machine by exact string, so a run on an
  // aliased host is recorded under the name the task already uses. One machine
  // must not end up with rows under two names.
  const runMachine = task.execution_machine && sameMachine(task.execution_machine, machine) ? task.execution_machine : machine

  // `prepare` touches no DSH at all. That is the point: it is the step the
  // user walks through with pm before anything is spent.
  if (action === 'prepare') return prepare(store, w, task, { ...opts, machine: runMachine })

  const kind = task.kind && kind_is_run(task.kind) ? task.kind : 'dsh-pipeline'
  const open = drivers[kind]
  if (!open) throw new PmError(501, `no driver for kind ${kind}; have ${Object.keys(drivers).join(', ') || 'none'}`, { task })
  const dsh = await open()

  if (action === 'stop') {
    const stopped = await dsh.stop()
    if (task.run_ref) store.updateRun(w, task.run_ref, { state: 'cancelled', last_checkpoint: `stopped ${stopped.stopped ?? 'nothing'}` })
    // The run is over, so the seats it was given go back to the user's own.
    const pending = rosterRestoreOf(task)
    if (pending) {
      await dsh.restoreRoster(pending)
      return settle(store, w, id, 'PAUSED', {
        note: `stopped ${stopped.stopped ?? '(no run was in progress)'}; restored the DSH seat flags the roster had changed`,
        fields: { meta: JSON.stringify(mergeMeta(task, { rosterRestore: null })) },
      })
    }
    return settle(store, w, id, 'PAUSED', { note: `stopped ${stopped.stopped ?? '(no run was in progress)'}` })
  }

  if (action === 'start') {
    const prepared = preparedRun(task)
    const run = store.startRun(w, id, { kind, machine: runMachine, state: 'starting', detail: { action, prepared } })
    let live
    try {
      live = await dsh.start({
        request: prepared.request,
        stages: prepared.stages ?? '',
        mode: prepared.mode ?? '',
        cwd: prepared.cwd,
        fresh: prepared.fresh !== false,
        // The seats the user picked for THIS run. Without it DSH runs on
        // whatever its settings happen to have enabled, paid seats included.
        roster: { council: [...prepared.roster.council], swarm: [...prepared.roster.swarm] },
      })
    } catch (err) {
      store.updateRun(w, run.id, { state: 'failed', last_checkpoint: `start failed: ${err.message}` })
      // A prompt that went in may still bring a run up on the applied roster;
      // keep the undo so stop/archive can put the seats back.
      const fields = err.rosterRestore ? { meta: JSON.stringify(mergeMeta(task, { rosterRestore: err.rosterRestore })) } : {}
      settle(store, w, id, 'FAILED', { note: `start failed: ${err.message}`, fields })
      throw new PmError(502, `DSH refused the start: ${err.message}`, { task, run: run.id, detail: err.details })
    }
    store.updateRun(w, run.id, { state: 'running', external_id: live.runId, last_checkpoint: `stage ${live.stage || 'starting'}`, detail: { action, prepared, roster: live.roster ?? null } })
    store.addArtifact(w, id, { kind: 'run', ref: live.runId, note: `DSH pipeline on ${runMachine}, session ${live.sessionId}, council seats ${prepared.roster.council.join('/')}, swarm seats ${prepared.roster.swarm.join('/')}` })
    return settle(store, w, id, 'RUNNING', {
      note: `started DSH pipeline ${live.runId} (stage ${live.stage || 'starting'}) on ${runMachine}`,
      fields: { session_ref: live.sessionId, execution_machine: runMachine, meta: live.roster ? JSON.stringify(mergeMeta(store.getTask(id), { rosterRestore: live.roster.restore })) : undefined },
      run: run.id, external: live.runId, live,
    })
  }

  // `amend` is the user's rule 5: a run that stalls is repaired where it
  // stands. Same run id, council.pipeline* kept, the seat journal replayed -
  // which is why it must not become a restart. restart:true is the driver's,
  // and only when asked for by that name.
  if (action === 'amend') {
    const fix = opts.fix
    if (!fix) throw new PmError(400, 'amend needs `fix`: what to tell the run so it can carry on from where it stalled')
    if (opts.restart) {
      throw new PmError(400, 'amend repairs a run in place and will not restart it. Restarting discards the journal and resets lastUserTurnAt; if that is really what you want, ask for restart by name.', { task })
    }
    const live = await dsh.amend({ fix, cwd: opts.cwd }).catch((err) => {
      throw new PmError(502, `DSH could not amend this run: ${err.message}`, { task, detail: err.details })
    })
    if (task.run_ref) store.updateRun(w, task.run_ref, { state: 'running', last_checkpoint: `amended in place: ${String(fix).slice(0, 200)}` })
    return settle(store, w, id, 'RUNNING', {
      note: `amended DSH pipeline ${live.runId ?? '(current)'} in place, keeping the run and its journal`,
      fields: { session_ref: live.sessionId ?? undefined },
      external: live.runId, live,
    })
  }

  // resume / continue: both advance a run DSH already holds. The difference is
  // only which lifecycle you came from, so the driver call is the same one.
  const live = await dsh.resume({ cwd: opts.cwd }).catch((err) => {
    throw new PmError(502, `DSH could not ${action} this task: ${err.message}`, { task, detail: err.details })
  })
  if (task.run_ref) {
    store.updateRun(w, task.run_ref, { state: 'running', external_id: live.runId ?? undefined, last_checkpoint: `${action} via ${live.resumedVia ?? 'continue'}` })
  }
  return settle(store, w, id, 'RUNNING', {
    note: `${action}d DSH pipeline ${live.runId ?? '(current)'} via ${live.resumedVia ?? 'continue'}`,
    fields: { session_ref: live.sessionId ?? undefined },
    external: live.runId, live,
  })
}

/**
 * Build (or refine) the prepared run recorded on a task, and stop there.
 *
 * Nothing is dispatched and no DSH is contacted. Seats given in `roster` are
 * recorded; seats not given stay empty, and an empty roster is reported as a
 * question for the user rather than filled in. Calling prepare again merges,
 * so the run can be built one answer at a time the way the user asked.
 */
function prepare(store, w, task, opts) {
  const previous = preparedRun(task)
  const request = opts.request ?? previous?.request ?? task.next_action ?? task.title
  if (!request) throw new PmError(400, 'prepare needs a request; the task has no next_action or title to fall back on')

  // Deliberately NOT inherited by default: the user picks the seats per run.
  // Carrying a roster over silently is exactly how a default sneaks in, so it
  // takes an explicit keepRoster to reuse the last one.
  const roster = { council: [], swarm: [] }
  for (const slot of ROSTER_SLOTS) {
    const given = opts.roster?.[slot]
    if (Array.isArray(given)) roster[slot] = given.filter(Boolean)
    else if (typeof given === 'string' && given.trim()) roster[slot] = given.split(',').map((x) => x.trim()).filter(Boolean)
    else if (opts.keepRoster && Array.isArray(previous?.roster?.[slot])) roster[slot] = previous.roster[slot]
  }

  const prepared = {
    request,
    stages: opts.stages ?? previous?.stages ?? '',
    mode: opts.mode ?? previous?.mode ?? '',
    cwd: opts.cwd ?? previous?.cwd ?? undefined,
    fresh: opts.fresh ?? previous?.fresh ?? true,
    machine: opts.machine,
    roster,
    preparedAt: new Date().toISOString(),
    preparedBy: w?.actor ?? null,
  }
  const missing = missingRoster(prepared)
  const meta = mergeMeta(task, { prepared })

  const note = missing.length
    ? `prepared a run, not started. Still needed from the user: the ${missing.join(' and ')} roster. pm does not choose seats.`
    : 'prepared a run with a full roster. It starts when the user says start; pm will not start it on its own.'

  return {
    ...settle(store, w, task.id, 'WAITING', { note, fields: { meta: JSON.stringify(meta) } }),
    prepared,
    missing,
    question: missing.length ? `Who should sit on the ${missing[0]}? Pick from the seats enabled on ${opts.machine}.` : null,
  }
}

/** The undo for a roster a run applied to DSH, or null when nothing is pending. */
function rosterRestoreOf(task) {
  try {
    const meta = typeof task.meta === 'string' ? JSON.parse(task.meta || '{}') : (task.meta ?? {})
    return Array.isArray(meta.rosterRestore) && meta.rosterRestore.length ? meta.rosterRestore : null
  } catch {
    return null
  }
}

/** Merge into the task's `meta` JSON without losing what else is in there. */
function mergeMeta(task, patch) {
  let meta = {}
  try {
    meta = typeof task.meta === 'string' ? JSON.parse(task.meta || '{}') : (task.meta ?? {})
  } catch {
    meta = {}
  }
  return { ...meta, ...patch }
}

/** A run kind pm knows how to execute (vs a descriptive task kind). */
function kind_is_run(kind) {
  return ['dsh-council', 'dsh-pipeline', 'claude-code', 'shell'].includes(kind)
}

/**
 * Record the outcome: lifecycle, matching status, a comment saying what
 * happened, and whatever fields the action learned. One place, so no action
 * can land without leaving a trace.
 */
function settle(store, w, id, lifecycle, { note, fields = {}, run, external, live } = {}) {
  const before = store.getTask(id)
  const changes = { rev: before.rev, lifecycle, ...clean(fields) }
  const status = STATUS_FOR[lifecycle]
  if (status && before.status !== status) changes.status = status
  const task = store.updateTask(w, id, changes)
  if (note) store.addComment(w, id, { body: note })
  return { task, lifecycle, note, run, external, live, available: available(task) }
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
