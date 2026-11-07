#!/usr/bin/env node
// PreToolUse policy guard -- Claude Sonnet 5 (claude-sonnet-5), DSH P-e5d90d43 / E1.
//
// Reads a PreToolUse hook event (Claude Code's documented JSON: tool_name,
// tool_input, plus whatever session/agent metadata the harness supplies) from
// stdin or from a fixture file, evaluates it against rules/policy.json, and
// emits the harness's PreToolUse response shape on stdout:
//   { "hookSpecificOutput": { "hookEventName": "PreToolUse",
//                              "permissionDecision": "allow"|"ask"|"deny",
//                              "permissionDecisionReason": "<matched rule>" } }
// Exit code: 0 for allow/ask, 2 for deny (Claude Code's own block convention;
// stderr also carries the reason so a non-JSON-aware caller still sees it).
//
// Usage:
//   node pretooluse-policy-guard.mjs <policy.json> [fixture.json]
//   (omit fixture.json to read the event from stdin)
//
// Every decision is additionally appended as one JSON line to the log file at
// POLICY_LOG_PATH (default ./policy-guard.log) -- see NOTES.md for the record
// shape this is meant to become once wired into the real shared-brain logger.

import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

function readStdinSync() {
  const chunks = [];
  const fd = 0;
  const buf = Buffer.alloc(65536);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let bytes;
    try {
      bytes = readSync(fd, buf, 0, buf.length, null);
    } catch (err) {
      if (err.code === "EAGAIN") continue;
      if (err.code === "EOF") break;
      throw err;
    }
    if (bytes === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
import { readSync } from "node:fs";

function globToRegExp(glob) {
  // Fixed by Claude Opus 5.5: the original never escaped '*', so '**/x' became
  // an invalid regex and the hook crashed (fail-open) on every call.
  const esc = normalizePath(glob).replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  const withGlobs = esc
    .replace(/\*\*\//g, "\u0001")
    .replace(/\*\*/g, "\u0002")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0001/g, "(?:.*/)?")
    .replace(/\u0002/g, ".*");
  return new RegExp("^" + withGlobs + "$", "i");
}

function normalizePath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function loadPolicy(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

// Claude Opus 5.5 (2026-10-26): "shell-code" view of a command, so text rules
// match what the shell would run rather than words that only appear in it.
// - heredoc bodies are dropped, unless the heredoc feeds a shell or sqlite3
// - unquoted # comments are dropped
// - inside quotes, separators and redirections (; & | < > newline and a bare
//   "(" or ")") become "_", so a quoted sentence cannot fake command position;
//   $(...) and backtick spans inside double quotes are kept, since they run
// - payloads of sh/bash/zsh -c, pwsh/powershell -Command and eval are appended
//   as extra lines and get the same treatment
const HEREDOC_RUNNERS = /(?:^|[\s;&|(`])(?:\S*[/\\])?(?:(?:ba|z|da)?sh|sqlite3)(?:\.exe)?\b[^\n]*$/i;

function stripHeredocs(cmd) {
  const lines = cmd.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = /<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/.exec(line);
    if (!m) continue;
    const keep = HEREDOC_RUNNERS.test(line.slice(0, m.index));
    const tabs = m[1] === "-";
    for (i++; i < lines.length; i++) {
      const body = tabs ? lines[i].replace(/^\t+/, "") : lines[i];
      if (body === m[3]) { out.push(lines[i]); break; }
      out.push(keep ? lines[i] : "");
    }
  }
  return out.join("\n");
}

function shellPayloads(cmd) {
  const found = [];
  const re = /(?:\b(?:ba|z|da)?sh(?:\.exe)?\s+(?:-\w+\s+)*-\w*c|\b(?:pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*-c(?:ommand)?|\beval)\s+(["'])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/gi;
  for (const m of cmd.matchAll(re)) found.push(m[1] === '"' ? m[2].replace(/\\(["\\$`])/g, "$1") : m[2]);
  return found;
}

function neutralizeQuotes(cmd) {
  let out = "";
  let i = 0;
  const n = cmd.length;
  const soft = (c) => (/[;&|<>\n()]/.test(c) ? "_" : c);
  while (i < n) {
    const c = cmd[i];
    if (c === "\\") { out += cmd.slice(i, i + 2); i += 2; continue; }
    if (c === "#" && (i === 0 || /\s/.test(cmd[i - 1]))) {
      while (i < n && cmd[i] !== "\n") i++;
      continue;
    }
    if (c === "'") {
      out += c; i++;
      while (i < n && cmd[i] !== "'") out += soft(cmd[i++]);
      if (i < n) out += cmd[i++];
      continue;
    }
    if (c === '"') {
      out += c; i++;
      while (i < n && cmd[i] !== '"') {
        if (cmd[i] === "\\") { out += cmd.slice(i, i + 2); i += 2; continue; }
        if (cmd[i] === "`") {
          const end = cmd.indexOf("`", i + 1);
          const stop = end < 0 ? n : end + 1;
          out += cmd.slice(i, stop); i = stop; continue;
        }
        if (cmd[i] === "$" && cmd[i + 1] === "(") {
          let depth = 0, j = i + 1;
          for (; j < n; j++) {
            if (cmd[j] === "(") depth++;
            else if (cmd[j] === ")" && --depth === 0) { j++; break; }
          }
          out += cmd.slice(i, j); i = j; continue;
        }
        out += soft(cmd[i++]);
      }
      if (i < n) out += cmd[i++];
      continue;
    }
    out += c; i++;
  }
  return out;
}

function shellCodeView(cmd, depth = 0) {
  const base = stripHeredocs(String(cmd).replace(/\r\n?/g, "\n"));
  const parts = [neutralizeQuotes(base)];
  if (depth < 3) for (const p of shellPayloads(base)) parts.push(shellCodeView(p, depth + 1));
  return parts.join("\n");
}

function ruleMatches(rule, cmd) {
  const subject = rule.match.sanitize === "shell-code" ? shellCodeView(cmd) : cmd;
  const patterns = rule.match.patterns || [rule.match.pattern];
  return patterns.some((p) => new RegExp(p, rule.match.flags ?? "i").test(subject));
}

function evalBlockedCommands(policy, event, trace) {
  if (event.tool_name !== "Bash") return null;
  const cmd = String(event.tool_input?.command || "");
  for (const rule of policy.blockedCommands || []) {
    if (ruleMatches(rule, cmd)) {
      trace.push(`blockedCommands:${rule.id} matched command`);
      if (allowIfSatisfied(rule.allowIf, event)) {
        trace.push(`  allowIf satisfied -> downgraded to allow`);
        continue;
      }
      return { action: rule.action, rule };
    }
  }
  return null;
}

function evalProtectedPaths(policy, event, trace) {
  const tool = event.tool_name;
  let candidatePaths = [];
  if (tool === "Write" || tool === "Edit") {
    if (event.tool_input?.file_path) candidatePaths.push(normalizePath(event.tool_input.file_path));
  } else if (tool === "Bash") {
    // best-effort: scan the command string for path-shaped tokens
    const cmd = String(event.tool_input?.command || "");
    candidatePaths = cmd.split(/\s+/).map(normalizePath).filter((t) => t.includes("/"));
  }
  for (const rule of policy.protectedPaths || []) {
    if (!rule.tools.includes(tool)) continue;
    const re = globToRegExp(rule.pathPattern);
    for (const p of candidatePaths) {
      if (re.test(p)) {
        trace.push(`protectedPaths:${rule.id} matched path ${p}`);
        if (allowIfSatisfied(rule.allowIf, event)) {
          trace.push(`  allowIf satisfied -> downgraded to allow`);
          continue;
        }
        return { action: rule.action, rule };
      }
    }
  }
  return null;
}

function evalBannedSeats(policy, event, trace) {
  const actor = event.agent || event.model || event.seat || "";
  if (!actor) return null;
  for (const rule of policy.bannedSeats || []) {
    const re = new RegExp(rule.matchPattern, "i");
    if (re.test(actor)) {
      trace.push(`bannedSeats:${rule.id} matched actor ${actor}`);
      return { action: rule.action, rule };
    }
  }
  return null;
}

function allowIfSatisfied(allowIf, event) {
  if (!allowIf || allowIf.length === 0) return false;
  // Only the simple "agent==X" predicate is implemented; the harness must
  // supply event.agent for this to ever fire. Fail closed otherwise.
  if (!event.agent) return false;
  return allowIf.some((cond) => {
    const m = /^agent==(.+)$/.exec(cond.trim());
    return m && m[1] === event.agent;
  });
}

function decide(policy, event) {
  const trace = [];
  const checks = [evalBannedSeats, evalBlockedCommands, evalProtectedPaths];
  let worst = { action: "allow", rule: null };
  const rank = { allow: 0, ask: 1, block: 2 };
  for (const check of checks) {
    const hit = check(policy, event, trace);
    if (hit && rank[hit.action] > rank[worst.action]) worst = hit;
  }
  return { ...worst, trace };
}

function main() {
  const [, , policyPathArg, fixturePathArg] = process.argv;
  if (!policyPathArg) {
    process.stderr.write("usage: pretooluse-policy-guard.mjs <policy.json> [fixture.json]\n");
    process.exit(1);
  }
  const policy = loadPolicy(resolve(policyPathArg));
  const raw = fixturePathArg ? readFileSync(resolve(fixturePathArg), "utf8") : readStdinSync();
  let event;
  try {
    event = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`invalid JSON event: ${err.message}\n`);
    process.exit(1);
  }

  // Claude Code names a subagent in `agent_type`; the policy speaks of `agent`.
  if (!event.agent && event.agent_type) event.agent = event.agent_type;
  const result = decide(policy, event);
  const permissionDecision = result.action === "block" ? "deny" : result.action;
  const reason = result.rule
    ? `[${result.rule.id}] ${result.rule.rule}`
    : "no policy rule matched; default allow";

  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      permissionDecisionReason: reason,
    },
  };

  const logPath = process.env.POLICY_LOG_PATH ||
    resolve(process.env.USERPROFILE || process.env.HOME || ".", ".claude/shared-brain/enforcement/policy-guard-decisions.jsonl");
  const logRecord = {
    ts: new Date().toISOString(),
    tool: event.tool_name,
    toolInputSummary:
      event.tool_name === "Bash"
        ? event.tool_input?.command
        : event.tool_input?.file_path,
    matchedRuleId: result.rule?.id ?? null,
    decision: result.action,
    reason,
    trace: result.trace,
  };
  try {
    appendFileSync(logPath, JSON.stringify(logRecord) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(`warning: could not write policy log (${logPath}): ${err.message}\n`);
  }

  process.stdout.write(JSON.stringify(output) + "\n");
  if (result.action === "block") {
    process.stderr.write(reason + "\n");
    process.exit(2);
  }
  process.exit(0);
}

main();