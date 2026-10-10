#!/usr/bin/env node
/**
 * Emit the Claude Code usage panel as a ready-to-render widget fragment.
 *
 * Reuses the status line's `/usage` call, adds the fields a one-line readout
 * has no room for (attribution, reset epochs, pace), and prints HTML on
 * stdout. The caller passes that straight to the visualize widget tool, so a
 * scheduled run spends no tokens deciding what the panel should look like.
 *
 * Usage: node usage-panel.mjs [--json] [--from-cache]
 *
 * --from-cache skips the `/usage` call and draws the last stored figures, so a
 * re-render costs nothing against quota.
 */

import { readLive, CACHE_PATH } from './usage-cache.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

/** Milliseconds a zone is offset from UTC at a given instant. */
function zoneOffset(epoch, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(epoch)).reduce((acc, part) => {
    acc[part.type] = part.value
    return acc
  }, {})
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  )
  return asUtc - epoch
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Turn a reset stamp like "Sep 8, 1am" into an epoch.
 *
 * The stamp carries no year, so one is inferred: a date landing more than a
 * month in the past belongs to next year.
 * @param {string|undefined} stamp - the printed reset time.
 * @param {string} zone - IANA zone the stamp is written in.
 * @returns {number|undefined} epoch milliseconds, undefined if unreadable.
 */
function resetEpoch(stamp, zone) {
  const match = /([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(stamp ?? '')
  if (!match) return undefined
  const month = MONTHS.indexOf(match[1].toLowerCase())
  if (month < 0) return undefined
  let hour = Number(match[3]) % 12
  if (/pm/i.test(match[5])) hour += 12
  const day = Number(match[2])
  const minute = Number(match[4] ?? 0)
  let year = new Date().getUTCFullYear()
  let guess = Date.UTC(year, month, day, hour, minute)
  if (guess < Date.now() - 31 * 864e5) guess = Date.UTC(year + 1, month, day, hour, minute)
  // Two passes: the first offset can be read on the wrong side of a DST edge.
  const first = guess - zoneOffset(guess, zone)
  return guess - zoneOffset(first, zone)
}

/** Read the fields the status line's parser discards. */
function parseExtras(text) {
  const out = {}
  const zone = /resets[^(\n]*\(([^)]+)\)/i.exec(text)
  out.zone = zone ? zone[1].trim() : 'America/Los_Angeles'
  const skills = /Top skills:\s*([^\n]+)/i.exec(text)
  if (skills) out.topSkills = skills[1].trim()
  const plugins = /Top plugins:\s*([^\n]+)/i.exec(text)
  if (plugins) out.topPlugins = plugins[1].trim()
  return out
}

/** Escape text destined for HTML. */
function esc(value) {
  return String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
}

/** Build the widget fragment from a set of figures. */
function render(f) {
  const pct = value => (typeof value === 'number' ? value : 0)
  const perSession = f.requests7d && f.sessions7d ? Math.round(f.requests7d / f.sessions7d) : undefined

  const chips = []
  const chip = (text, accent) => `<span style="font-size:13px;background:var(${accent ? '--bg-accent' : '--surface-1'});color:var(${accent ? '--text-accent' : '--text-secondary'});border-radius:var(--radius);padding:6px 10px">${esc(text)}</span>`
  if (f.topSkills) chips.push(chip(`Skills · ${f.topSkills}`, true))
  if (f.topPlugins) chips.push(chip(`Plugins · ${f.topPlugins}`, true))
  if (f.sessions24h !== undefined) chips.push(chip(`${f.sessions24h} sessions today`, false))

  const quota = (label, value, resets, slot) => `<div class="up-card">
<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px"><span class="up-lbl">${label}</span><span class="up-num">${pct(value)}%</span></div>
<div class="up-bar"><div class="up-fill" style="width:${pct(value)}%;background:var(--text-accent)"></div></div>
<div class="up-lbl" style="margin-top:8px">Resets ${esc(resets ?? 'unknown')} · <span id="${slot}">—</span></div>
</div>`

  const meter = (label, value) => `<div>
<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:14px;color:var(--text-primary)">${label}</span><span style="font-size:14px;font-weight:500;color:var(--text-warning)">${pct(value)}%</span></div>
<div class="up-bar"><div class="up-fill" style="width:${pct(value)}%;background:var(--text-warning)"></div></div>
</div>`

  const metric = (label, value) => `<div class="up-card"><div class="up-lbl">${label}</div><div class="up-num">${value ?? '—'}</div></div>`

  const captured = new Date(f.capturedAt ?? Date.now()).toLocaleString('en-US', {
    timeZone: f.zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  return `<style>
.up-bar{height:8px;border-radius:4px;background:var(--surface-0);overflow:hidden}
.up-fill{height:100%;border-radius:4px}
.up-card{background:var(--surface-1);border-radius:var(--radius);padding:1rem}
.up-lbl{font-size:13px;color:var(--text-secondary)}
.up-num{font-size:24px;font-weight:500;color:var(--text-primary);line-height:1.2}
.up-sec{font-size:13px;font-weight:500;color:var(--text-secondary);margin:0 0 12px}
.up-btn{font-size:13px;font-weight:500;background:var(--bg-accent);color:var(--text-accent);border:0.5px solid var(--border);border-radius:var(--radius);padding:8px 14px;cursor:pointer}
.up-btn:hover{opacity:0.85}
</style>
<div style="padding:1rem 0;display:flex;flex-direction:column;gap:1.5rem">
<h2 style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Claude Code usage: session quota ${pct(f.sessionPercent)} percent used, weekly quota ${pct(f.weekPercent)} percent used, with request counts and the characteristics driving spend. A refresh button re-reads the figures.</h2>
<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--surface-1);border-radius:var(--radius);padding:10px 12px">
<span class="up-lbl">Reading from <code>/usage</code></span>
<button id="up-refresh" class="up-btn" type="button" onclick="sendPrompt('refresh the usage panel')">↻ Refresh</button>
</div>
<div>
<div class="up-sec">Quota</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
${quota('Session', f.sessionPercent, f.sessionResets, 'up-s-left')}
${quota('Week, all models', f.weekPercent, f.weekResets, 'up-w-left')}
</div>
<div id="up-pace" class="up-lbl" style="margin-top:10px;display:flex;align-items:center;gap:6px"></div>
</div>
<div>
<div class="up-sec">Throughput</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
${metric('Requests 24h', f.requests24h)}
${metric('Requests 7d', f.requests7d)}
${metric('Sessions 7d', f.sessions7d)}
${metric('Requests / session', perSession)}
</div>
</div>
<div>
<div class="up-sec">What drives the cost</div>
<div style="background:var(--surface-2);border:0.5px solid var(--border);border-radius:12px;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:14px">
${meter(`Usage at over ${f.bigContextThresholdK ?? 150}k context`, f.bigContextPercent)}
${meter(`From sessions active ${f.longSessionHours ?? 8}+ hours`, f.longSessionPercent)}
<div class="up-lbl" style="border-top:0.5px solid var(--border);padding-top:12px">Independent characteristics, not a breakdown. Long sessions re-send the whole transcript each turn, so length drives spend more than difficulty.</div>
</div>
</div>
${chips.length ? `<div><div class="up-sec">Attribution, last 24h</div><div style="display:flex;gap:8px;flex-wrap:wrap">${chips.join('')}</div></div>` : ''}
<div style="border-top:0.5px solid var(--border);padding-top:1rem;font-size:13px;color:var(--text-muted)">Local sessions on this machine only. Captured ${esc(captured)}${f.stale ? ' — refresh failed, figures are the last good read' : f.cached ? ' — cached figures, no /usage call made' : ''}.</div>
</div>
<script>
(function(){
  var btn=document.getElementById('up-refresh');
  if(btn) btn.addEventListener('click',function(){
    if(typeof sendPrompt==='function') sendPrompt('refresh the usage panel');
  });
  var sReset=${f.sessionResetEpoch ?? 'null'}, wReset=${f.weekResetEpoch ?? 'null'}, now=Date.now();
  function left(ms){ if(ms===null) return 'unknown'; if(ms<=0) return 'reset due';
    var h=Math.floor(ms/36e5), m=Math.round((ms%36e5)/6e4);
    return h>=24? Math.floor(h/24)+'d '+(h%24)+'h left' : (h>0? h+'h '+m+'m left' : m+'m left'); }
  document.getElementById('up-s-left').textContent=left(sReset===null?null:sReset-now);
  document.getElementById('up-w-left').textContent=left(wReset===null?null:wReset-now);
  var el=document.getElementById('up-pace');
  if(wReset===null){ el.textContent=''; return; }
  var elapsed=Math.max(1,Math.min(100,Math.round((now-(wReset-7*864e5))/(7*864e5)*100)));
  var used=${pct(f.weekPercent)}, ahead=used<elapsed;
  el.innerHTML='<i class="ti '+(ahead?'ti-trending-down':'ti-alert-triangle')+'" aria-hidden="true" style="font-size:16px;color:var(--text-'+(ahead?'success':'warning')+')"></i>'+
    '<span>Week '+elapsed+'% elapsed, '+used+'% of quota used — '+(ahead?'running under pace':'running ahead of pace')+
    '. At this rate the week lands near '+Math.round(used/elapsed*100)+'%.</span>';
})();
</script>`
}

const fromCache = process.argv.includes('--from-cache')
const live = fromCache ? { figures: {}, text: '' } : await readLive()
const text = live.text
const parsed = live.figures
let figures

if (parsed.sessionPercent === undefined && parsed.weekPercent === undefined) {
  // No live figures: either --from-cache asked for none, or the call failed.
  // Both draw the last stored read; only the footer wording separates them.
  try {
    figures = { zone: 'America/Los_Angeles', ...JSON.parse(readFileSync(CACHE_PATH, 'utf8')) }
  } catch {
    figures = { zone: 'America/Los_Angeles', capturedAt: Date.now() }
  }
  if (fromCache) figures.cached = true
  else figures.stale = true
} else {
  figures = { ...parsed, ...parseExtras(text) }
  // The status line reads the same cache; a panel run refreshes it for free.
  try { writeFileSync(CACHE_PATH, JSON.stringify(parsed, null, 2)) } catch { /* the panel does not depend on the cache */ }
}

figures.sessionResetEpoch = resetEpoch(figures.sessionResets, figures.zone)
figures.weekResetEpoch = resetEpoch(figures.weekResets, figures.zone)

if (process.argv.includes('--json')) console.log(JSON.stringify(figures, null, 2))
else console.log(render(figures))
