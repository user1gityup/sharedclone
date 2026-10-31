// Blitz Phase-1 engine (Claude Opus 5.5): ONE composed run engine per pm process.
//
//   controller = guard( recovery( createController({ dispatch: real adapters, verify: BLITZ-07, escalate: BLITZ-06 }) ) )
//
// - BLITZ-05 controller: state machine, leases, approvals gate, idempotent dispatch.
// - BLITZ-06 recovery: escalate hook, held-provider registry filter, wrapped dispatch, maxAttempts 1;
//   its pump() runs before every tick (requeues retries/reassignments, services escalations).
// - BLITZ-07 verifier: independent verification; fails closed until a `review` fn is configured.
// - BLITZ-08 guard (quota stop + ceilings, via the registry it narrows during tick), dispatch
//   adapters (refuse unless BLITZ_DISPATCH_ENABLED=1 and the campaign has authorized_by), poller, runner.
//
// The exposed `controller` is what every route set, the poller and the runner use:
//   tick         = recovery.tick  (pump, then the guarded tick)
//   reportResult = a quota error reported as success (recovery.looksRateLimited) becomes reportFailure,
//                  so it is classified RATE_LIMIT and parked, never verified and never retried in a loop.
// Integration: with non-empty repo `rules` (server.mjs loads them from blitz-repo-rules.json), every runner
// pass ends with integratePass(): verified tasks are queued and each queued repo is processed by the
// integrator (dry-run conflict check, risk review, task_merge approval, LOCAL merge). With rules {} the
// runner never integrates, exactly as before. Nothing pushes.
// Nothing here starts a process on construction; start() starts the runner (interval passes).
import { createAgentRegistry } from './agents.mjs'
import { createController } from './controller.mjs'
import { createGuard, guardController } from './guard.mjs'
import { createRecovery, bridgeAdapter, looksRateLimited } from './recovery.mjs'
import { createVerifier } from './verify.mjs'
import { createIntegrator, createGitRunner } from './integrate.mjs'
import { createDispatcher, createPoller, defaultAdapters, defaultGit } from './dispatch.mjs'
import { startRunner } from './runner.mjs'
import { campaignRoutes } from './campaign-routes.mjs'
import { recoveryRoutes } from './recovery-routes.mjs'
import { verifyRoutes } from './verify-routes.mjs'
import { statusRoutes } from './status-routes.mjs'

const textOf = (v) => (typeof v === 'string' ? v : [v?.result, v?.text, v?.message, v?.error, v?.summary].filter((s) => typeof s === 'string').join('\n'))

/**
 * @param o.store, o.db, o.ledgerDb, o.bridge   pm store, blitz db (store.db), approval ledger getter, pm bridge (or null)
 * @param o.env, o.spawn, o.git, o.fs, o.adapters, o.dshHomes, o.workspaceRoot   dispatch (BLITZ-08)
 * @param o.readSnapshot, o.ceilings, o.stopPercent, o.unknown, o.guardProviderOf   guard (BLITZ-08)
 * @param o.review, o.run, o.levelChecks, o.pickVerifier, o.verifyPolicy   verification (BLITZ-07); review null = nothing verifies;
 *        verifyPolicy = default acceptance/check policy for tasks without meta (codex-review.mjs)
 * @param o.rules, o.integrationGit   integration (BLITZ-07); rules {} = nothing ever merges
 * @param o.recoveryPolicy, o.escalationAgent, o.fallbackAgents, o.specialists, o.escalationBridge   recovery (BLITZ-06)
 */
export function createEngine({
  store, db = store?.db, ledgerDb = () => null, bridge = null,
  env = process.env, spawn, git, fs, adapters, dshHomes, workspaceRoot,
  readSnapshot, ceilings, stopPercent, unknown, guardProviderOf,
  review = null, run, levelChecks, pickVerifier, verifyPolicy = null, rules = {}, integrationGit,
  recoveryPolicy, escalationAgent, fallbackAgents, specialists, escalationBridge, recoveryProviderOf,
  clock = () => new Date(), leaseSeconds, machines, registry, onEvent, runnerIntervalMs,
} = {}) {
  if (!store?.db) throw new Error('createEngine needs a pm store with a db handle')
  const base = registry ?? createAgentRegistry(db, { store, clock, machines })
  const guard = createGuard({ db, clock, ceilings, stopPercent, unknown, ...(guardProviderOf ? { providerOf: guardProviderOf } : {}), ...(readSnapshot ? { readSnapshot } : {}) })
  const recovery = createRecovery({
    store, db, clock, machines, registry: base, bridge: escalationBridge ?? bridgeAdapter(() => bridge),
    ...(recoveryPolicy ? { policy: recoveryPolicy } : {}), ...(escalationAgent ? { agent: escalationAgent } : {}),
    ...(fallbackAgents ? { fallbackAgents } : {}), ...(specialists ? { specialists } : {}), ...(recoveryProviderOf ? { providerOf: recoveryProviderOf } : {}),
  })
  const verifier = createVerifier({ db, clock, review, policy: verifyPolicy, ...(run ? { run } : {}), ...(levelChecks ? { levelChecks } : {}), ...(pickVerifier ? { pickVerifier } : {}) })
  const ad = adapters ?? defaultAdapters({ ...(spawn ? { spawn } : {}), env, ...(fs ? { fs } : {}), dshHomes, bridge })

  let raw = null
  const realDispatch = createDispatcher({
    adapters: ad, getCampaign: (id) => raw.get(id), env, ...(fs ? { fs } : {}),
    git: git ?? defaultGit(...(spawn ? [spawn] : [])), ...(workspaceRoot ? { root: workspaceRoot } : {}),
  })
  const deps = recovery.deps({ dispatch: realDispatch }) // {escalate, registry (held providers filtered), dispatch (wrapped), maxAttempts: 1}
  raw = createController({
    store, db, ledgerDb, clock, machines, onEvent, ...(leaseSeconds ? { leaseSeconds } : {}),
    verify: verifier, escalate: deps.escalate, dispatch: deps.dispatch, maxAttempts: deps.maxAttempts,
    registry: guard.wrapRegistry(deps.registry),
  })
  const guarded = guardController(raw, guard)
  recovery.attach(guarded)

  const controller = {
    ...guarded,
    tick: (w, id, body) => recovery.tick(w, id, body),
    async reportResult(w, id, body = {}) {
      if (looksRateLimited(body.result)) {
        guarded.store.event(id, 'quota_as_success', { attempt: body.attempt ?? null, text: textOf(body.result).slice(0, 300) }, { taskId: body.taskId ?? null, actor: w?.actor ?? null })
        const { result, ...rest } = body
        return guarded.reportFailure(w, id, { ...rest, error: `quota error reported as success: ${textOf(result).slice(0, 300)}` })
      }
      return guarded.reportResult(w, id, body)
    },
  }
  verifier.attach(controller)
  const integrator = createIntegrator({ db, store, ledgerDb, git: integrationGit ?? createGitRunner(), rules, clock, controller })
  const taskTitle = (id) => { try { return store.db.prepare('SELECT title FROM tasks WHERE id = ?').get(id)?.title ?? '' } catch { return '' } }
  // bridge-claude builders cannot run git on vmixer: pm commits their worktree changes before verification
  const poller = createPoller({ controller, adapters: ad, git: git ?? defaultGit(...(spawn ? [spawn] : [])), taskTitle, backgroundVerify: Number(env?.BLITZ_VERIFY_CONCURRENCY ?? 0) })
  const integrationOn = Object.keys(rules ?? {}).length > 0
  const skipped = new Set() // (campaign:task) that could not be queued; the skip event is written once

  /** One integration pass: queue every verified task, then process each repo that has queued entries. */
  async function integratePass(w = { actor: 'blitz-integrator', model: null }) {
    const queued = []
    for (const c of controller.list().filter((x) => ['launched', 'running', 'paused', 'completed'].includes(x.state))) {
      const have = new Set(integrator.queue({ campaignId: c.id }).map((e) => e.task_id))
      for (const r of controller.store.tasks(c.id, { state: 'verified' })) {
        const k = `${c.id}:${r.task_id}`
        if (have.has(r.task_id) || skipped.has(k)) continue
        try { integrator.enqueue(w, c.id, r.task_id); queued.push(r.task_id) } catch (err) {
          skipped.add(k)
          controller.store.event(c.id, 'integration_skipped', { reason: String(err?.message ?? err) }, { taskId: r.task_id, actor: w.actor })
        }
      }
    }
    const repos = [...new Set(integrator.queue({ state: 'queued' }).map((e) => e.repo))]
    const processed = []
    for (const repo of repos) processed.push(await integrator.process(w, { repo }))
    return { queued, processed }
  }

  const engine = {
    controller, raw, guard, recovery, verifier, integrator, poller, adapters: ad, registry: base, runner: null,
    integrationOn, integratePass,
    /** Every blitz route set on the shared instances (campaign, recovery, verify, status). */
    routes() {
      return [
        ...campaignRoutes({ store, controller }),
        ...recoveryRoutes({ store, recovery }),
        ...verifyRoutes({ store, ledgerDb, verifier, controller, integrator, clock }),
        ...statusRoutes({ controller, guard, runner: () => engine.runner }),
      ]
    },
    /** Starts the runner (recoverAll now, then a pass every intervalMs). */
    start({ intervalMs = runnerIntervalMs, autoStart = true, log } = {}) {
      if (engine.runner) return engine.runner
      engine.runner = startRunner({ controller, poller, guard, recovery, autoStart, ...(integrationOn ? { integrate: integratePass } : {}), ...(intervalMs ? { intervalMs } : {}), ...(log !== undefined ? { log } : {}) })
      return engine.runner
    },
    async stop() { await engine.runner?.stop() },
  }
  return engine
}
