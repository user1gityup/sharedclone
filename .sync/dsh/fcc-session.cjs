'use strict';
// DSH owns this monitor: no timer survives the DSH child exiting.
const {spawn} = require('node:child_process');
const path = require('node:path');

function createMonitor({check, recover, report, alive, limit = 3, cooldownTicks = 20, name = 'Free Claude'}) {
  let attempts = 0;
  let cooldown = 0;
  let previous;
  return async function tick() {
    if (!alive()) return;
    let ready = await check();
    if (!alive()) return;
    // The budget is three CONSECUTIVE failures, not three for the life of the
    // host. A plain healthy check clears it, so a service that dies hours after
    // an earlier recovery is still brought back.
    if (ready) { attempts = 0; cooldown = 0; }
    // A spent budget is not permanent: after cooldownTicks idle checks (20 x 30s
    // = ~10 minutes) the budget resets and a fresh burst of attempts runs. Only a
    // healthy check used to clear it, which a dead service never produces.
    if (!ready && attempts >= limit && cooldownTicks > 0) {
      if (cooldown === 0) cooldown = cooldownTicks;
      else if (--cooldown === 0) {
        attempts = 0;
        previous = undefined;
        report(`${name}: cool-down over, trying recovery again.`);
      }
    }
    if (!ready && attempts < limit) {
      report(`${name} unavailable; recovery ${++attempts}/${limit}.`);
      ready = await recover();
    }
    if (!alive()) return;
    const state = ready ? `${name} ready.` :
      `${name} unavailable.${attempts >= limit ? ` Automatic recovery paused after ${limit} consecutive attempts; retrying after a ${cooldownTicks}-check cool-down.` : ''}`;
    if (state !== previous) report(state);
    previous = state;
    return {ready, recoveryAttempts: attempts, recoveryLimit: limit, cooldownRemaining: cooldown};
  };
}

// A DSH left listening on the web port (an earlier window, or one an agent started)
// makes the new host die with EADDRINUSE. Replace a leftover DSH; refuse anything else.
function freeDshPort(report, port = 3080) {
  const {spawnSync} = require('node:child_process');
  const script = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $c) { exit 0 }
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
if ($p.CommandLine -notmatch 'bin\\.(js|ts)["]? +web') { Write-Output "$($c.OwningProcess) $($p.Name)"; exit 2 }
Write-Output $p.ProcessId
& taskkill.exe /PID $p.ProcessId /T /F | Out-Null
for ($i = 0; $i -lt 40; $i++) { if (-not (Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue)) { exit 1 }; Start-Sleep -Milliseconds 250 }
exit 3`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {windowsHide: true, encoding: 'utf8'});
  const who = (result.stdout || '').trim();
  if (result.status === 1) report(`Stopped leftover DSH (PID ${who}) that held port ${port}.`);
  if (result.status === 2) throw new Error(`Port ${port} is held by ${who}, which is not DSH. Close it and start DSH again.`);
  if (result.status === 3) throw new Error(`Leftover DSH (PID ${who}) did not release port ${port}.`);
}

// The Antigravity quota panel only reads seats that are running; nothing else
// starts them until a council run needs one. Start every signed-in seat here.
function startAntigravitySeats(report) {
  const fs = require('node:fs');
  const os = require('node:os');
  const root = process.env.DSH_ANTIGRAVITY_ROOT || path.join(os.homedir(), '.dsh', 'antigravity');
  const tool = path.join(__dirname, 'bin', 'agy-profile.mjs');
  let seats;
  try {
    const body = fs.readFileSync(path.join(root, 'accounts.json'), 'utf8').replace(/^﻿/, '');
    seats = JSON.parse(body).seats || [];
  } catch { return; }
  const ids = seats
    .filter(seat => typeof seat.id === 'string' && fs.existsSync(path.join(seat.geminiDir || path.join(root, 'profiles', seat.id), '.gemini', 'jetski-standalone-oauth-token')))
    .map(seat => seat.id);
  if (!ids.length || !fs.existsSync(tool)) return;
  const {spawnSync} = require('node:child_process');
  const result = spawnSync(process.execPath, [tool, 'start', ...ids], {windowsHide: true, encoding: 'utf8', timeout: 30000});
  const started = (result.stdout || '').split(/\r?\n/).filter(line => line.includes(': started')).length;
  if (result.status !== 0) report(`Antigravity seats did not start: ${(result.stderr || result.error?.message || '').trim()}`);
  else report(`Antigravity seats: ${ids.length} signed in, ${started} started.`);
}

async function main() {
  const fs = require('node:fs');
  const controller = path.join(__dirname, 'fcc-control.ps1');
  const report = message => {
    console.log(`[FCC] ${message}`);
    fs.appendFileSync(path.join(__dirname, 'fcc-monitor.log'), `${new Date().toISOString()} ${message}\n`);
  };
  const attached = process.argv[2] === '--watch';
  const ownerPid = process.argv[3];
  const ownerStarted = process.argv[4];
  if (attached && (!/^\d+$/.test(ownerPid) || !/^\d+$/.test(ownerStarted))) throw new Error('Watch requires the DSH PID and verified start ticks.');
  const runController = (script, action) => new Promise(resolve => {
    const ownerArgs = action === 'owner' ? ['-OwnerPid', ownerPid, '-OwnerStarted', ownerStarted] : [];
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, ...ownerArgs], {windowsHide: true, stdio: ['status', 'owner'].includes(action) ? 'ignore' : 'inherit'});
    child.once('error', error => { report(error.message); resolve(false); });
    child.once('exit', code => resolve(code === 0));
  });
  const control = action => runController(controller, action);
  // The openrouter-free seat and provider point at 127.0.0.1:8080; nothing else starts that proxy.
  const openrouterController = path.join(__dirname, 'openrouter-control.ps1');
  const openrouter = fs.existsSync(openrouterController) ? action => runController(openrouterController, action) : null;
  if (attached && !(await control('owner'))) throw new Error('The requested DSH process is no longer running.');
  if (!attached) freeDshPort(report);
  startAntigravitySeats(report);
  await Promise.all([control('start'), openrouter?.('start')]);
  const dsh = attached ? null : spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', ...process.argv.slice(2)], {stdio: 'inherit'});
  let running = true;
  let timer;
  let pending = Promise.resolve();
  let finishing = false;
  const tick = createMonitor({check: () => control('status'), recover: () => control('restart'), report, alive: () => running});
  const openrouterTick = openrouter && createMonitor({check: () => openrouter('status'), recover: () => openrouter('restart'), report, alive: () => running, name: 'OpenRouter Free'});
  const writeStatus = (file, status) => fs.writeFileSync(path.join(__dirname, file), JSON.stringify({
    ...status, monitoring: true, checkedAt: new Date().toISOString(), monitorPid: process.pid,
    dshPid: attached ? Number(ownerPid) : dsh.pid, intervalSeconds: 30,
  }, null, 2));
  async function poll() {
    if (attached && !(await control('owner'))) {
      running = false;
      setImmediate(() => { void finish(0); });
      return;
    }
    const [status, openrouterStatus] = await Promise.all([tick(), openrouterTick?.()]);
    if (running && status) writeStatus('fcc-status.json', status);
    if (running && openrouterStatus) writeStatus('openrouter-status.json', openrouterStatus);
    if (running) timer = setTimeout(() => { pending = poll(); }, 30000);
  }
  async function finish(code) {
    if (finishing) return;
    finishing = true;
    running = false;
    clearTimeout(timer);
    await pending;
    await Promise.all([control('stop'), openrouter?.('stop')]);
    try { fs.writeFileSync(path.join(__dirname, 'openrouter-status.json'), JSON.stringify({monitoring: false, checkedAt: new Date().toISOString(), monitorPid: process.pid}, null, 2)); } catch {}
    try {
      const clusterScript = path.join(__dirname, 'cluster-control.ps1');
      spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', clusterScript, '-Action', 'stop'], {windowsHide: true, stdio: 'ignore'});
    } catch {}
    fs.writeFileSync(path.join(__dirname, 'fcc-status.json'), JSON.stringify({monitoring: false, checkedAt: new Date().toISOString(), monitorPid: process.pid}, null, 2));
    report('DSH exited; health monitoring stopped.');
    process.exit(code);
  }
  dsh?.once('error', error => { report(error.message); void finish(1); });
  dsh?.once('exit', code => { void finish(code ?? 1); });
  // Console signals are delivered to the inherited DSH console as well.
  process.on('SIGINT', () => { dsh?.kill('SIGINT'); void finish(130); });
  process.on('SIGTERM', () => { dsh?.kill(); void finish(143); });
  report(`Health monitor active; checks every 30 seconds${attached ? ` for DSH PID ${ownerPid}` : ''}.`);
  pending = poll();
}

module.exports = {createMonitor};
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
