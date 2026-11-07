#!/usr/bin/env node
// Quota-gated CLI wrapper for the claude/codex CLIs. DSH P-e5d90d43 / E5.
// Claude Sonnet 5 (claude-sonnet-5).
//
// Reads a quota-state JSON file and refuses to launch a new run once usage
// is past a configured threshold -- mechanizes "At 98% of the weekly quota
// every agent stops" and the 95%/100k-context / 4h checkpoint rule from
// ~/.claude/CLAUDE.md, at the one point (process launch) where refusal is
// actually enforceable rather than merely advisory.
//
// Usage:
//   node cli-quota-wrapper.mjs -- <real command> [args...]
//
// Quota state file: $QUOTA_STATE_FILE (default:
// ~/.claude/statusline/quota-state.json), shape:
//   { "weekly_quota_pct": <0-100>, "session_context_tokens": <int>,
//     "session_hours": <number>, "updated": "<ISO8601>" }
// Only the fields present are checked; a missing field is treated as "ok".
//
// Threshold file: $QUOTA_THRESHOLD_FILE (default:
// ~/.claude/statusline/quota-thresholds.json), same field names, each value
// being the "block new launches at or above this" cutoff. Falls back to the
// CLAUDE.md-documented defaults (weekly_quota_pct: 98, session_context_tokens:
// 150000, session_hours: 8) when the threshold file is absent.
//
// Exit codes:
//   0  -- under every threshold; the real command was spawned and its own
//         exit code is propagated.
//   3  -- refused: at or past a configured threshold. Nothing was launched.
//   2  -- usage error (bad args, unreadable/unparseable quota-state file).
//
// This wrapper does not read real quota telemetry itself -- it is given a
// quota-state file path, so it can be pointed at a real exporter's output
// (e.g. the statusline script) in production or at a disposable fixture in
// tests without any code change.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const DEFAULT_THRESHOLDS = {
  weekly_quota_pct: 98,
  session_context_tokens: 150000,
  session_hours: 8,
};

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function evaluate(state, thresholds) {
  const breaches = [];
  for (const key of Object.keys(thresholds)) {
    if (!(key in state)) continue;
    if (Number(state[key]) >= Number(thresholds[key])) {
      breaches.push({ metric: key, value: state[key], threshold: thresholds[key] });
    }
  }
  return breaches;
}

function main() {
  const sepIdx = process.argv.indexOf("--");
  if (sepIdx === -1 || sepIdx === process.argv.length - 1) {
    process.stderr.write("usage: cli-quota-wrapper.mjs -- <command> [args...]\n");
    process.exit(2);
  }
  const cmd = process.argv[sepIdx + 1];
  const cmdArgs = process.argv.slice(sepIdx + 2);

  const statePath = resolve(
    process.env.QUOTA_STATE_FILE || resolve(homedir(), ".claude/statusline/quota-state.json")
  );
  const thresholdPath = resolve(
    process.env.QUOTA_THRESHOLD_FILE || resolve(homedir(), ".claude/statusline/quota-thresholds.json")
  );

  // Live wiring (Claude Opus 5.5): with no explicit state file, read the status
  // line's real caches and check the higher weekly % of the two Claude accounts.
  if (!process.env.QUOTA_STATE_FILE && !existsSync(statePath)) {
    const caches = ["usage-cache.json", "usage-work-cache.json"]
      .map((f) => resolve(homedir(), ".claude/statusline", f))
      .filter((f) => existsSync(f))
      .map((f) => { try { return loadJson(f); } catch { return {}; } });
    const weekly = caches.map((c) => Number(c.weekPercent)).filter(Number.isFinite);
    if (weekly.length > 0) {
      const live = { weekly_quota_pct: Math.max(...weekly) };
      const thresholds = existsSync(thresholdPath) ? { ...DEFAULT_THRESHOLDS, ...loadJson(thresholdPath) } : DEFAULT_THRESHOLDS;
      const breaches = evaluate(live, thresholds);
      if (breaches.length > 0) {
        process.stderr.write("cli-quota-wrapper: REFUSED -- weekly quota " + live.weekly_quota_pct + "% >= " + thresholds.weekly_quota_pct + "%, new run not launched.\n");
        process.exit(3);
      }
      const child = spawn(cmd, cmdArgs, { stdio: "inherit", shell: false });
      child.on("exit", (code) => process.exit(code ?? 0));
      return;
    }
  }

  if (!existsSync(statePath)) {
    process.stderr.write(`cli-quota-wrapper: no quota-state file at ${statePath} -- refusing to guess, allowing launch (nothing to check against).\n`);
    const child = spawn(cmd, cmdArgs, { stdio: "inherit", shell: false });
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  let state;
  try {
    state = loadJson(statePath);
  } catch (err) {
    process.stderr.write(`cli-quota-wrapper: could not parse quota-state file ${statePath}: ${err.message}\n`);
    process.exit(2);
  }

  const thresholds = existsSync(thresholdPath)
    ? { ...DEFAULT_THRESHOLDS, ...loadJson(thresholdPath) }
    : DEFAULT_THRESHOLDS;

  const breaches = evaluate(state, thresholds);
  if (breaches.length > 0) {
    process.stderr.write(
      "cli-quota-wrapper: REFUSED -- quota threshold reached, new run not launched.\n" +
        breaches
          .map((b) => `  ${b.metric}: ${b.value} >= threshold ${b.threshold}`)
          .join("\n") +
        "\nSee ~/.claude/CLAUDE.md 'Checkpoint long or costly sessions' / '98% weekly quota stop'.\n"
    );
    process.exit(3);
  }

  const child = spawn(cmd, cmdArgs, { stdio: "inherit", shell: false });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();