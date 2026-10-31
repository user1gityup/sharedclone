#!/usr/bin/env node
// dsh-stuck-watchdog (E4) — Claude Sonnet 5
//
// Standalone, non-agent script. No LLM calls, no network calls, no agent
// framework. Intended to run as a Windows Scheduled Task, independent of any
// Claude/Codex/DSH process, and to scan a DSH run/session state file for
// records marked RUNNING with no activity for more than the stale threshold
// (default 10 minutes per CLAUDE.md's "10-minute stuck rule").
//
// Only Node.js builtins are imported: node:fs, node:path, node:child_process,
// node:process. child_process is used ONLY to invoke local OS utilities
// (tasklist/taskkill on win32, ps on posix) to check and, if explicitly
// enabled, terminate a stale process. Nothing here opens a socket, makes an
// HTTP request, or calls an LLM. See NOTES.md for the inspection confirming
// this.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOL_NAME = 'dsh-stuck-watchdog';
const SCHEMA_VERSION = 1;
const DEFAULT_STALE_MINUTES = 10;
const DEFAULT_KILL_ALLOWLIST = ['node.exe', 'node', 'dsh-run', 'dsh-auto', 'claude.exe', 'codex.exe'];

function parseArgs(argv) {
  const args = {
    runsFile: null,
    findingsOut: null,
    findingsLog: null,
    staleMinutes: DEFAULT_STALE_MINUTES,
    nowIso: process.env.WATCHDOG_NOW_ISO || null,
    allowKill: false,
    killAllowlist: DEFAULT_KILL_ALLOWLIST,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs-file') args.runsFile = argv[++i];
    else if (a === '--findings-out') args.findingsOut = argv[++i];
    else if (a === '--findings-log') args.findingsLog = argv[++i];
    else if (a === '--stale-minutes') args.staleMinutes = Number(argv[++i]);
    else if (a === '--now') args.nowIso = argv[++i];
    else if (a === '--allow-kill') args.allowKill = true;
    else if (a === '--kill-allowlist') args.killAllowlist = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    `${TOOL_NAME} — non-agent stuck-run watchdog (Claude Sonnet 5, E4)`,
    '',
    'Usage:',
    '  node watchdog.mjs --runs-file <path.json> [options]',
    '',
    'Options:',
    '  --runs-file <path>       JSON array of run/session records (required)',
    '  --findings-out <path>    Latest-snapshot findings file (default: <runsFileDir>/watchdog-findings.json)',
    '  --findings-log <path>    Append-only JSONL audit log (default: <runsFileDir>/watchdog-findings-log.jsonl)',
    '  --stale-minutes <n>      Stale threshold in minutes (default: 10)',
    '  --now <iso>              Override "current time" for deterministic testing (or env WATCHDOG_NOW_ISO)',
    '  --allow-kill             Permit termination of allowlisted, verified-live stale processes (default: off, flag-only)',
    '  --kill-allowlist <csv>   Process-name substrings eligible for termination when --allow-kill is set',
    '  --verbose                Also print a line for every healthy RUNNING record scanned',
    '',
    'Exit codes: 0 = no stale runs found, 2 = stale run(s) found (written to findings file), 1 = error.',
  ].join('\n');
}

function isPidAlive(pid) {
  if (!pid && pid !== 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'EPERM') return true; // exists, no permission to signal
    return false; // ESRCH or similar: no such process
  }
}

function getProcessName(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      const line = out.trim().split(/\r?\n/)[0] || '';
      if (!line || /no tasks/i.test(line)) return null;
      const fields = line.split('","').map((f) => f.replace(/^"|"$/g, ''));
      return fields[0] || null;
    }
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 5000 });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function attemptKill(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: 5000 });
      return { success: true, detail: `taskkill /PID ${pid} /T /F succeeded` };
    }
    process.kill(pid, 'SIGTERM');
    return { success: true, detail: `SIGTERM sent to pid ${pid}` };
  } catch (err) {
    return { success: false, detail: `kill attempt failed: ${err && err.message ? err.message : String(err)}` };
  }
}

function buildFinding(record, staleForMs, action, detail, nowMs) {
  return {
    runId: record.runId ?? null,
    seatId: record.seatId ?? null,
    pid: record.pid ?? null,
    status: record.status ?? null,
    lastActivityAt: record.lastActivityAt ?? null,
    staleForMs: staleForMs === null ? null : staleForMs,
    staleForMinutes: staleForMs === null ? null : Math.round((staleForMs / 60000) * 100) / 100,
    action,
    detail,
    cwd: record.cwd ?? null,
    logFile: record.logFile ?? null,
    detectedAt: new Date(nowMs).toISOString(),
  };
}

function evaluateRuns(runs, { nowMs, staleThresholdMs, allowKillEnabled, killAllowlist }) {
  const findings = [];
  const healthy = [];

  for (const record of runs) {
    if (!record || record.status !== 'RUNNING') continue;

    const lastActivityMs = record.lastActivityAt ? Date.parse(record.lastActivityAt) : NaN;
    if (Number.isNaN(lastActivityMs)) {
      findings.push(
        buildFinding(record, null, 'flagged-missing-activity-timestamp', 'lastActivityAt missing or unparseable; cannot confirm liveness', nowMs)
      );
      continue;
    }

    const staleForMs = nowMs - lastActivityMs;
    if (staleForMs < staleThresholdMs) {
      healthy.push(record.runId ?? '(unknown)');
      continue;
    }

    const pid = record.pid ?? null;
    if (!pid) {
      findings.push(
        buildFinding(record, staleForMs, 'flagged-no-pid', 'No pid recorded; cannot verify or terminate a process, hub must investigate', nowMs)
      );
      continue;
    }

    if (!isPidAlive(pid)) {
      findings.push(
        buildFinding(record, staleForMs, 'flagged-process-not-found', `pid ${pid} not found on host; record is stale but process already gone`, nowMs)
      );
      continue;
    }

    const procName = getProcessName(pid);
    const recordAllowsKill = record.allowKill !== false;
    const nameAllowed = !!procName && killAllowlist.some((pat) => procName.toLowerCase().includes(pat.toLowerCase()));

    if (!allowKillEnabled || !recordAllowsKill || !nameAllowed) {
      findings.push(
        buildFinding(
          record,
          staleForMs,
          'flagged-not-terminated',
          `pid ${pid} (${procName ?? 'unknown name'}) is stale; termination skipped (allowKillEnabled=${allowKillEnabled}, recordAllowsKill=${recordAllowsKill}, nameAllowed=${nameAllowed})`,
          nowMs
        )
      );
      continue;
    }

    const killResult = attemptKill(pid);
    findings.push(
      buildFinding(record, staleForMs, killResult.success ? 'terminated' : 'terminate-failed', killResult.detail, nowMs)
    );
  }

  return { findings, healthy };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.runsFile) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
    return;
  }

  const runsFilePath = resolve(args.runsFile);
  const runsDir = dirname(runsFilePath);
  const findingsOutPath = resolve(args.findingsOut || join(runsDir, 'watchdog-findings.json'));
  const findingsLogPath = resolve(args.findingsLog || join(runsDir, 'watchdog-findings-log.jsonl'));
  const staleThresholdMs = (Number.isFinite(args.staleMinutes) ? args.staleMinutes : DEFAULT_STALE_MINUTES) * 60 * 1000;
  const nowMs = args.nowIso ? Date.parse(args.nowIso) : Date.now();

  if (!existsSync(runsFilePath)) {
    console.error(`${TOOL_NAME}: runs file not found: ${runsFilePath}`);
    process.exit(1);
    return;
  }
  if (Number.isNaN(nowMs)) {
    console.error(`${TOOL_NAME}: --now / WATCHDOG_NOW_ISO value is not a valid ISO timestamp`);
    process.exit(1);
    return;
  }

  let runs;
  try {
    runs = JSON.parse(readFileSync(runsFilePath, 'utf8'));
    if (!Array.isArray(runs)) throw new Error('runs file must contain a JSON array');
  } catch (err) {
    console.error(`${TOOL_NAME}: failed to read/parse runs file: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  const { findings, healthy } = evaluateRuns(runs, {
    nowMs,
    staleThresholdMs,
    allowKillEnabled: args.allowKill,
    killAllowlist: args.killAllowlist,
  });

  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    tool: TOOL_NAME,
    generatedAt: new Date(nowMs).toISOString(),
    staleThresholdMinutes: staleThresholdMs / 60000,
    runsFile: runsFilePath,
    totalRunsScanned: runs.length,
    staleCount: findings.length,
    findings,
  };

  try {
    writeFileSync(findingsOutPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    appendFileSync(findingsLogPath, JSON.stringify(snapshot) + '\n', 'utf8');
  } catch (err) {
    console.error(`${TOOL_NAME}: failed to write findings output: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  console.log(`${TOOL_NAME} v${SCHEMA_VERSION} — scan complete`);
  console.log(`  runsFile: ${runsFilePath}`);
  console.log(`  now: ${new Date(nowMs).toISOString()}`);
  console.log(`  staleThresholdMinutes: ${staleThresholdMs / 60000}`);
  console.log(`  totalRunsScanned: ${runs.length}`);
  console.log(`  staleFound: ${findings.length}`);
  console.log(`  findingsWritten: ${findingsOutPath}`);
  console.log(`  findingsAppended: ${findingsLogPath}`);

  if (args.verbose && healthy.length) {
    console.log('');
    console.log('HEALTHY (skipped, within stale threshold):');
    for (const runId of healthy) console.log(`  ${runId}`);
  }

  if (findings.length) {
    console.log('');
    console.log('STALE RUN(S) DETECTED:');
    for (const f of findings) {
      console.log(`  runId: ${f.runId}`);
      console.log(`    seatId: ${f.seatId}`);
      console.log(`    pid: ${f.pid}`);
      console.log(`    staleForMinutes: ${f.staleForMinutes}`);
      console.log(`    action: ${f.action}`);
      console.log(`    detail: ${f.detail}`);
    }
  }

  process.exit(findings.length ? 2 : 0);
}

main();