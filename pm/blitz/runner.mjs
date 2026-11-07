// BLITZ-08 run driver (Claude Opus 5.5).
//
// startRunner({controller, poller?, guard?, intervalMs}) recovers every live campaign once at
// start-up (recoverAll), then on each interval, for each campaign that is launched, running or
// paused (cancelling included):
//   1. refreshes the guard's quota snapshot (once per pass),
//   2. recover(): reclaims leases that expired since the last pass,
//   3. tick() (launched/running only; the guarded controller's tick applies quota and ceilings),
//   4. poller.pollCampaign(): heartbeats live runs, reports finished ones, stops + acks cancels.
// With o.recovery (BLITZ-06, engine.mjs), the controller's tick is recovery.tick (pump, then the
// guarded tick); a campaign that is not ticked (paused, cancelling) still gets recovery.pump() so
// its escalations are delivered, acked and answered.
// With o.integrate (engine.mjs, only when repo rules are loaded), each pass ends with one integration
// pass: verified tasks are queued and each queued repo is processed by the BLITZ-07 integrator (local
// merges only, under the repo rules; nothing pushes). Its outcome is in stats().last_integration.
// It does nothing for draft, preflighted or terminal campaigns, so no work starts unless a
// campaign was launched (which needs authorizedBy). Passes never overlap. It does not touch
// server.mjs; the orchestrator wires it (see RUNBOOK.md).
import { TERMINAL_CAMPAIGN } from './campaigns.mjs'

export const DEFAULT_INTERVAL_MS = 15_000
const LIVE = ['launched', 'running', 'paused']

export function startRunner({
  controller, poller = null, guard = null, recovery = null, integrate = null, intervalMs = DEFAULT_INTERVAL_MS,
  actor = { actor: 'blitz-runner', model: null }, timers = { setInterval, clearInterval }, log = console, autoStart = true,
} = {}) {
  if (!controller) throw new Error('startRunner needs a controller')
  const stats = { started_at: new Date().toISOString(), passes: 0, last_pass_at: null, last_error: null, recovered_at_start: [], running: false, stopped: false, last: [], last_integration: null }
  let timer = null
  let inFlight = null

  function liveCampaigns() {
    return controller.list().filter((c) => LIVE.includes(c.state) && !TERMINAL_CAMPAIGN.includes(c.state))
  }

  async function passOnce() {
    const out = []
    const live = liveCampaigns()
    if (!live.length) { await integratePass(); return out }
    if (guard) await guard.refresh()
    for (const c of live) {
      const rec = { id: c.id }
      try {
        rec.recovered = controller.recover(actor, c.id).reclaimed
        const cur = controller.get(c.id)
        if (['launched', 'running'].includes(cur.state) && !cur.cancel_requested_at) {
          const t = await controller.tick(actor, c.id)
          rec.tick = { leased: t.leased, dispatched: t.dispatched, failed: t.failed, skipped: t.skipped, deferred: t.deferred,
            ...(t.recovery ? { requeued: t.recovery.requeued, escalated: t.recovery.escalated } : {}) }
        } else if (recovery) {
          const p = await recovery.pump(actor, c.id)
          rec.pump = { requeued: p.requeued, escalated: p.escalated, escalations: p.escalations.length }
        }
        if (poller) rec.poll = await poller.pollCampaign(c.id)
        rec.state = controller.get(c.id).state
      } catch (err) {
        rec.error = String(err?.message ?? err)
        stats.last_error = { at: new Date().toISOString(), campaign: c.id, error: rec.error }
      }
      out.push(rec)
    }
    await integratePass()
    return out
  }

  async function integratePass() {
    if (!integrate) return
    try { stats.last_integration = { at: new Date().toISOString(), ...(await integrate(actor)) } } catch (err) {
      stats.last_integration = { at: new Date().toISOString(), error: String(err?.message ?? err) }
      stats.last_error = { at: stats.last_integration.at, error: `integration: ${stats.last_integration.error}` }
    }
  }

  /** One pass; concurrent callers share the pass already running. */
  function runOnce() {
    if (stats.stopped) return Promise.resolve([])
    if (inFlight) return inFlight
    stats.running = true
    inFlight = passOnce().then((r) => {
      stats.passes++
      stats.last_pass_at = new Date().toISOString()
      stats.last = r
      return r
    }).finally(() => { inFlight = null; stats.running = false })
    return inFlight
  }

  try {
    stats.recovered_at_start = controller.recoverAll(actor).map((r) => ({ id: r.id, reclaimed: r.reclaimed, state: r.campaign?.state }))
  } catch (err) {
    stats.last_error = { at: new Date().toISOString(), error: `recoverAll: ${err?.message ?? err}` }
    log?.error?.('blitz runner recoverAll', err)
  }
  if (autoStart) {
    timer = timers.setInterval(() => { runOnce().catch((err) => log?.error?.('blitz runner', err)) }, intervalMs)
    timer?.unref?.()
  }

  return {
    runOnce,
    async stop() {
      stats.stopped = true
      if (timer) timers.clearInterval(timer)
      timer = null
      if (inFlight) await inFlight.catch(() => {})
    },
    stats: () => ({ ...stats, interval_ms: intervalMs, poller: poller?.stats?.() ?? null }),
  }
}
