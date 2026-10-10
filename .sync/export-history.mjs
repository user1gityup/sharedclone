// Export this machine's local-only agent history into the shared brain as compact, redacted Markdown.
//
// Usage: node export-history.mjs <brainRoot>              export, then scan what was written
//        node export-history.mjs <brainRoot> --scan-only  scan history/ and system/ only
//
// Output is namespaced by host so two machines never write the same file:
//   history/<host>/{claude-code,codex,dsh,gatekeeper}/, history/<host>/README.md
//   system/<host>/dsh-settings.sanitized.yaml
// Each run replaces this host's folders with a fresh snapshot. Exit code 2 means
// the scan found a credential shape, the brain key, an e-mail or a home path.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'

const HOME = os.homedir()
const OUT = path.resolve(process.argv[2] || '.')
const SCAN_ONLY = process.argv.includes('--scan-only')
const EXPORTED = new Date().toISOString()
const HOST = os.hostname().toLowerCase()
const H = `history/${HOST}`
const SYS = `system/${HOST}`

// ---------- redaction ----------
const CRED = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(?:or-v1-|ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bya29\.[A-Za-z0-9._-]{20,}/g,
  /\bnvapi-[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?/g,
  /\b1\/\/0[A-Za-z0-9_-]{30,}/g,
  /(?<![A-Za-z0-9])[a-fA-F0-9]{64}(?![A-Za-z0-9])/g,
]
const NAMED = /\b((?:api[_-]?key|apikey|secret|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|bearer)["']?\s*[:=]\s*["']?)([^\s"',;}{)]{6,})/gi
const HOMEPATH = /[A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+(?!Public\b)[^\\/\s"'`<>|:*?]+/gi
const POSIXHOME = /\/(?:c|mnt\/c)\/Users\/(?!Public\b)[^/\s"'`<>]+/gi
const EMAIL = /\b[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com|anthropic\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
// Encoded project keys (C--Users-<name>-..., --C-Users-<name>-...) carry the account name too.
const USERS = (() => {
  const names = new Set()
  try { names.add(os.userInfo().username) } catch {}
  try { for (const n of JSON.parse(fs.readFileSync(path.join(OUT, '.sync/users.json'), 'utf8'))) names.add(n) } catch {}
  return [...names].filter(Boolean)
})()
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const KEYUSER = USERS.length ? new RegExp(`(Users-+)(?:${USERS.map(esc).join('|')})(?![A-Za-z0-9])`, 'gi') : null
let redactions = 0
function redact(s) {
  if (s == null) return ''
  s = String(s)
  for (const re of CRED) s = s.replace(re, () => (redactions++, '<redacted>'))
  s = s.replace(NAMED, (m, k, v) => (/^<redacted>$|^\$\{|^process\.env|^\$env:|Env$/.test(v) ? m : (redactions++, `${k}<redacted>`)))
  s = s.replace(HOMEPATH, '~').replace(POSIXHOME, '~')
  if (KEYUSER) s = s.replace(KEYUSER, '$1<user>')
  s = s.replace(EMAIL, '<email>')
  return s
}
const one = (s, n) => { s = redact(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + ' …' : s }
const block = (s, n) => { s = redact(s).trim(); return s.length > n ? s.slice(0, n) + `\n… [truncated ${s.length - n} chars]` : s }
const cell = (s, n) => one(s, n).replace(/\|/g, '\\|')
const quote = s => s.split('\n').map(l => '> ' + l).join('\n')
const iso = t => { const d = new Date(t); return isNaN(d) ? '' : d.toISOString().replace('T', ' ').slice(0, 16) + 'Z' }
const src = p => redact(p.replace(/\\/g, '/'))
const kfmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0)
function write(rel, text) {
  const f = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, text.replace(/\r\n/g, '\n'))
}
function lines(file) {
  const out = []
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)) } catch {} }
  return out
}
function walk(dir, filter, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(node_modules|\.git|\.pnpm-store)$/.test(e.name)) walk(p, filter, acc) } else if (filter(p)) acc.push(p)
  }
  return acc
}
const header = (title, source, extra = '') => `# ${title}\n\n- **Exported:** ${EXPORTED} from ${HOST} by .sync/export-history.mjs\n- **Source (local-only on ${HOST}):** ${source}\n${extra}- **Redaction:** credential shapes, secret-named values, e-mail addresses, account names and home paths (as \`~\`) removed. Text is truncated where marked.\n\n`
const coverage = {}

// ---------- Claude Code ----------
function commitSubject(cmd) {
  if (!/git\b[^\n]*\bcommit\b/.test(cmd)) return null
  const m = cmd.match(/-m\s+(?:"([^"]+)"|'([^']+)'|\$\(cat <<'?EOF'?\n([^\n]+))/) || cmd.match(/@'\r?\n([^\n]+)/)
  return m ? (m[1] || m[2] || m[3] || m[4]) : '(commit, message not parsed)'
}
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b.type === 'text').map(b => b.text).join('\n')
}
function claudeSession(file, subDir) {
  const recs = lines(file)
  const s = { id: path.basename(file, '.jsonl'), file, start: null, end: null, cwd: '', branch: '', version: '', entry: '', title: '', ai: '', models: {}, usage: { in: 0, cw: 0, cr: 0, out: 0 }, prompts: [], last: '', tools: {}, files: new Set(), commits: [], pushes: 0, apiErr: 0, toolErr: 0, final: '', subs: [] }
  const seen = new Map()
  for (const r of recs) {
    if (r.timestamp) { if (!s.start || r.timestamp < s.start) s.start = r.timestamp; if (!s.end || r.timestamp > s.end) s.end = r.timestamp }
    if (r.cwd && !s.cwd) s.cwd = r.cwd
    if (r.gitBranch && r.gitBranch !== 'HEAD') s.branch = r.gitBranch
    if (r.version) s.version = r.version
    if (r.entrypoint) s.entry = r.entrypoint
    if (r.type === 'custom-title') s.title = r.customTitle
    if (r.type === 'ai-title') s.ai = r.aiTitle
    if (r.type === 'last-prompt') s.last = r.lastPrompt
    if (r.type === 'system' && r.subtype === 'api_error') s.apiErr++
    if (r.type === 'user' && !r.isSidechain) {
      const c = r.message?.content
      if (Array.isArray(c)) for (const b of c) if (b.type === 'tool_result' && b.is_error) s.toolErr++
      const hasResult = Array.isArray(c) && c.some(b => b.type === 'tool_result')
      const t = textOf(c).trim()
      if (!hasResult && t && !/^<(command-|local-command|system-reminder|task-notification|user-prompt-submit)/.test(t) && !r.isMeta) s.prompts.push({ at: r.timestamp, t })
    }
    if (r.type === 'assistant' && r.message) {
      const m = r.message
      if (m.model && m.model !== '<synthetic>') s.models[m.model] = (s.models[m.model] || 0) + 1
      if (m.usage) seen.set(m.id || r.uuid, m.usage)
      for (const b of m.content || []) {
        if (b.type === 'text' && b.text.trim()) s.final = b.text
        if (b.type === 'tool_use') {
          s.tools[b.name] = (s.tools[b.name] || 0) + 1
          const i = b.input || {}
          if (/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(b.name) && (i.file_path || i.notebook_path)) s.files.add(i.file_path || i.notebook_path)
          if (/^(Bash|PowerShell)$/.test(b.name) && typeof i.command === 'string') {
            const c = commitSubject(i.command); if (c) s.commits.push(c)
            if (/git\b[^\n]*\bpush\b/.test(i.command)) s.pushes++
          }
        }
      }
    }
  }
  for (const u of seen.values()) { s.usage.in += u.input_tokens || 0; s.usage.cw += u.cache_creation_input_tokens || 0; s.usage.cr += u.cache_read_input_tokens || 0; s.usage.out += u.output_tokens || 0 }
  if (subDir && fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir).filter(f => f.endsWith('.meta.json'))) {
      try { const m = JSON.parse(fs.readFileSync(path.join(subDir, f), 'utf8')); s.subs.push(m.agentType || m.subagent_type || m.description || 'agent') } catch { s.subs.push('agent') }
    }
    if (!s.subs.length) s.subs = fs.readdirSync(subDir).filter(f => f.endsWith('.jsonl')).map(() => 'agent')
  }
  return s
}
function exportClaude() {
  const root = path.join(HOME, '.claude/projects')
  if (!fs.existsSync(root)) { coverage.claude = { missing: '~/.claude/projects' }; return }
  const sessions = []
  for (const proj of fs.readdirSync(root)) {
    const pd = path.join(root, proj)
    if (!fs.statSync(pd).isDirectory()) continue
    for (const f of fs.readdirSync(pd).filter(f => f.endsWith('.jsonl'))) {
      const s = claudeSession(path.join(pd, f), path.join(pd, path.basename(f, '.jsonl'), 'subagents'))
      s.project = proj
      if (s.start && (s.prompts.length || Object.keys(s.models).length)) sessions.push(s)
    }
  }
  sessions.sort((a, b) => a.start.localeCompare(b.start))
  const isSeat = s => /dsh-(seat|search)-cwd/.test(s.project)
  const human = sessions.filter(s => !isSeat(s))
  const seats = sessions.filter(isSeat)
  const byMonth = {}
  for (const s of human) (byMonth[s.start.slice(0, 7)] ||= []).push(s)
  for (const [month, list] of Object.entries(byMonth)) {
    let md = header(`Claude Code sessions on ${HOST} — ${month}`, '`~/.claude/projects/<project-key>/<session-id>.jsonl` (+ `<session-id>/subagents/`)', `- **Sessions:** ${list.length}, oldest first. DSH council seat calls are in [dsh-seat-calls.md](dsh-seat-calls.md).\n`)
    for (const s of list) {
      const tools = Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')
      const files = [...s.files].map(src)
      md += `## ${iso(s.start)} — ${cell(s.title || s.ai || s.prompts[0]?.t || '(untitled)', 100)}\n\n`
      md += `- **Session:** \`${s.id}\` · project key \`${redact(s.project)}\` · cwd \`${src(s.cwd)}\`${s.branch ? ` · branch \`${s.branch}\`` : ''}\n`
      md += `- **Span:** ${iso(s.start)} → ${iso(s.end)} · Claude Code ${s.version} (${s.entry})\n`
      md += `- **Models:** ${Object.keys(s.models).join(', ') || 'none'} · **tokens:** in ${kfmt(s.usage.in)}, cache-write ${kfmt(s.usage.cw)}, cache-read ${kfmt(s.usage.cr)}, out ${kfmt(s.usage.out)}\n`
      md += `- **Prompts:** ${s.prompts.length} · **tools:** ${tools || 'none'}${s.subs.length ? ` · **subagents:** ${s.subs.join(', ')}` : ''}\n`
      if (s.apiErr || s.toolErr) md += `- **Errors:** API ${s.apiErr}, tool results ${s.toolErr}\n`
      if (files.length) md += `- **Files edited (${files.length}):** ${files.slice(0, 20).map(f => '`' + f + '`').join(', ')}${files.length > 20 ? ' …' : ''}\n`
      if (s.commits.length) md += `- **Commits made:** ${s.commits.slice(0, 10).map(c => '“' + one(c, 120) + '”').join('; ')}\n`
      if (s.pushes) md += `- **git push commands:** ${s.pushes}\n`
      md += `\n**Asks (first ${Math.min(3, s.prompts.length)} of ${s.prompts.length}):**\n\n`
      for (const p of s.prompts.slice(0, 3)) md += `- ${iso(p.at)}: ${one(p.t, 400)}\n`
      if (s.prompts.length > 3) md += `- … last: ${one(s.prompts.at(-1).t, 400)}\n`
      md += `\n**Final reply (truncated):**\n\n${quote(block(s.final || '(none)', 700))}\n\n`
    }
    write(`${H}/claude-code/sessions-${month}.md`, md)
  }
  let sm = header(`DSH seat calls made through Claude Code on ${HOST}`, '`~/.claude/projects/*dsh-seat-cwd*/` and `*dsh-search-cwd*/`', `- **Calls:** ${seats.length}. Each is one headless council seat, search or vote call made by DSH, not a human session.\n`)
  sm += '| Start (UTC) | Session | Kind | Model | Tokens in/cache-read/out | Ask | Answer |\n|---|---|---|---|---|---|---|\n'
  for (const s of seats) sm += `| ${iso(s.start)} | \`${s.id.slice(0, 8)}\` | ${/search/.test(s.project) ? 'search' : 'seat'} | ${Object.keys(s.models).join(', ')} | ${kfmt(s.usage.in + s.usage.cw)}/${kfmt(s.usage.cr)}/${kfmt(s.usage.out)} | ${cell(s.prompts[0]?.t, 140)} | ${cell(s.final, 160)} |\n`
  write(`${H}/claude-code/dsh-seat-calls.md`, sm)
  coverage.claude = { sessions: human.length, seats: seats.length, first: sessions[0]?.start, last: sessions.at(-1)?.start, months: Object.keys(byMonth) }
}

// ---------- Codex ----------
function exportCodex() {
  const files = walk(path.join(HOME, '.codex/sessions'), p => p.endsWith('.jsonl')).sort()
  const sessions = []
  for (const f of files) {
    const recs = lines(f)
    const s = { file: f, id: '', start: '', cwd: '', origin: '', cli: '', models: new Set(), effort: '', asks: [], finals: [], tokens: null, tools: {}, files: new Set(), commits: [], errors: 0 }
    for (const r of recs) {
      const p = r.payload || {}
      if (r.type === 'session_meta') { s.id = p.id; s.start = p.timestamp || r.timestamp; s.cwd = p.cwd; s.origin = p.originator; s.cli = p.cli_version }
      if (r.type === 'turn_context') { if (p.model) s.models.add(p.model); if (p.effort) s.effort = p.effort }
      if (r.type === 'response_item' && p.type === 'message' && p.role === 'user') {
        const t = (p.content || []).map(c => c.text || '').join('\n').trim()
        if (t && !/^<|^# AGENTS\.md|^<environment_context>/.test(t)) s.asks.push({ at: r.timestamp, t })
      }
      if (r.type === 'event_msg' && p.type === 'task_complete' && p.last_agent_message) s.finals.push(p.last_agent_message)
      if (r.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) s.tokens = p.info.total_token_usage
      if (r.type === 'event_msg' && /error/i.test(p.type || '')) s.errors++
      if (r.type === 'response_item' && /function_call$|custom_tool_call$/.test(p.type)) {
        s.tools[p.name] = (s.tools[p.name] || 0) + 1
        const input = String(p.input ?? p.arguments ?? '')
        for (const m of input.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n\\"]+)/g)) s.files.add(m[1].trim())
        const c = commitSubject(input.replace(/\\n/g, '\n').replace(/\\"/g, '"')); if (c) s.commits.push(c)
      }
    }
    if (s.start) sessions.push(s)
  }
  sessions.sort((a, b) => a.start.localeCompare(b.start))
  const seat = s => s.origin === 'codex_exec'
  const desk = sessions.filter(s => !seat(s)), execs = sessions.filter(seat)
  let md = header(`Codex sessions on ${HOST} (interactive)`, '`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`', `- **Sessions:** ${desk.length}, oldest first. Headless \`codex exec\` calls (DSH council seat) are in [exec-calls.md](exec-calls.md). Workspace folders: [workspaces.md](workspaces.md).\n`)
  for (const s of desk) {
    const tools = Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')
    md += `## ${iso(s.start)} — ${cell(s.asks[0]?.t || '(no user text)', 100)}\n\n`
    md += `- **Session:** \`${s.id}\` · file \`${src(path.relative(path.join(HOME, '.codex'), s.file))}\` · cwd \`${src(s.cwd)}\`\n`
    md += `- **Client:** ${s.origin} ${s.cli} · **models:** ${[...s.models].join(', ') || 'unknown'}${s.effort ? ` (effort ${s.effort})` : ''}\n`
    if (s.tokens) md += `- **Tokens (session total):** in ${kfmt(s.tokens.input_tokens)}, cached ${kfmt(s.tokens.cached_input_tokens)}, out ${kfmt(s.tokens.output_tokens)}, reasoning ${kfmt(s.tokens.reasoning_output_tokens)}\n`
    md += `- **Turns:** ${s.asks.length} asks, ${s.finals.length} completions · **tools:** ${tools || 'none'}${s.errors ? ` · **error events:** ${s.errors}` : ''}\n`
    if (s.files.size) md += `- **Files patched (${s.files.size}):** ${[...s.files].slice(0, 20).map(f => '`' + src(f) + '`').join(', ')}\n`
    if (s.commits.length) md += `- **Commits made:** ${s.commits.slice(0, 10).map(c => '“' + one(c, 120) + '”').join('; ')}\n`
    md += `\n**Asks (first ${Math.min(3, s.asks.length)} of ${s.asks.length}):**\n\n`
    for (const a of s.asks.slice(0, 3)) md += `- ${iso(a.at)}: ${one(a.t, 400)}\n`
    if (s.asks.length > 3) md += `- … last: ${one(s.asks.at(-1).t, 400)}\n`
    md += `\n**Final reply (truncated):**\n\n${quote(block(s.finals.at(-1) || '(none)', 700))}\n\n`
  }
  write(`${H}/codex/sessions.md`, md)
  let em = header(`Codex exec calls on ${HOST} (DSH council seat)`, '`~/.codex/sessions/**/rollout-*.jsonl` with originator `codex_exec`', `- **Calls:** ${execs.length}.\n`)
  em += '| Start (UTC) | Session | Model | Tokens in/cached/out | Ask | Answer |\n|---|---|---|---|---|---|\n'
  for (const s of execs) em += `| ${iso(s.start)} | \`${s.id.slice(0, 13)}\` | ${[...s.models].join(', ')} | ${s.tokens ? `${kfmt(s.tokens.input_tokens)}/${kfmt(s.tokens.cached_input_tokens)}/${kfmt(s.tokens.output_tokens)}` : ''} | ${cell(s.asks[0]?.t, 140)} | ${cell(s.finals.at(-1), 160)} |\n`
  write(`${H}/codex/exec-calls.md`, em)

  // ~/Documents/Codex workspaces
  const wroot = path.join(HOME, 'Documents/Codex')
  let wm = header(`Codex workspace folders on ${HOST}`, '`~/Documents/Codex/<date>/<task-slug>/`', '- One folder per Codex Desktop task. Source code, `work/` clones, `node_modules` and the pnpm store are not exported. Hand-written output documents are copied under [outputs/](outputs/).\n')
  wm += '| Folder | Files (excl. deps) | Top-level entries | Codex session (by cwd) | Copied outputs |\n|---|---|---|---|---|\n'
  let copied = 0
  const dates = fs.existsSync(wroot) ? fs.readdirSync(wroot).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : []
  for (const date of dates) {
    for (const slug of fs.readdirSync(path.join(wroot, date)).sort()) {
      const dir = path.join(wroot, date, slug)
      if (!fs.statSync(dir).isDirectory()) continue
      const all = walk(dir, () => true)
      const top = fs.readdirSync(dir).slice(0, 8).join(', ')
      const sess = desk.filter(s => path.resolve(s.cwd || '') === path.resolve(dir)).map(s => '`' + s.id.slice(0, 13) + '`').join(', ')
      const docs = all.filter(p => /\.md$/i.test(p) && !/[\\/](work|test-runs|state)[\\/]/.test(p) && fs.statSync(p).size < 200_000)
      const names = []
      for (const d of docs) {
        const rel = path.relative(wroot, d).replace(/\\/g, '/')
        write(`${H}/codex/outputs/${rel}`, `<!-- Copied ${EXPORTED} from ~/Documents/Codex/${rel} on ${HOST} (redacted). -->\n` + redact(fs.readFileSync(d, 'utf8')))
        names.push(`[${path.basename(d)}](outputs/${rel})`); copied++
      }
      wm += `| \`${date}/${slug}\` | ${all.length} | ${cell(top, 120)} | ${sess} | ${names.join(', ')} |\n`
    }
  }
  write(`${H}/codex/workspaces.md`, wm)
  coverage.codex = { sessions: desk.length, execs: execs.length, first: sessions[0]?.start, last: sessions.at(-1)?.start, workspaces: dates.length, copied }
}

// ---------- DSH council runs ----------
function exportDsh() {
  const dir = path.join(HOME, '.dsh/council-runs')
  const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => { try { return [{ f, j: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }] } catch { return [] } }).sort((a, b) => a.j.at - b.j.at) : []
  let idx = header(`DSH on ${HOST}`, '`~/.dsh/council-runs/<run-id>.json`, `journal/*.jsonl`, `~/.dsh/sessions/**/session.jsonl.zstd`', `- **Council runs:** ${runs.length}. One-line digests already live in [../../../dsh-runs.md](../../../dsh-runs.md); these files add the query, plan, each seat's draft, votes and critiques.\n- **DSH agent sessions:** [sessions.md](sessions.md).\n`)
  idx += '| Date (UTC) | Run | Terminal state | Seats | Votes | Query |\n|---|---|---|---|---|---|\n'
  for (const { f, j } of runs) {
    j.terminalState ??= j.state ?? j.status ?? '— (not recorded, older schema)'
    const date = iso(j.at), name = `${date.slice(0, 10)}-${String(j.id).slice(0, 8)}.md`
    const votes = (j.reviews || []).map(r => `${r.seat}→${r.vote}`).join(', ')
    idx += `| ${date} | [${String(j.id).slice(0, 8)}](council-runs/${name}) | ${j.terminalState} | ${(j.seatIds || []).join(', ')} | ${cell(votes, 120)} | ${cell(j.query, 160)} |\n`
    let md = header(`DSH council run ${j.id}`, `\`~/.dsh/council-runs/${f}\``)
    md += `- **At:** ${date} · **terminal state:** ${j.terminalState} · **schema:** ${j.schemaVersion} · **amendments:** ${j.amendments ?? 0} · **quorum:** ${JSON.stringify(j.quorumConfig || {})}\n- **Seats:** ${(j.seatIds || []).join(', ')}\n\n`
    md += `## Query\n\n${quote(block(j.query, 3000))}\n\n## Plan\n\n${quote(block(j.plan || '(none)', 2500))}\n\n## Drafts\n\n`
    for (const d of j.drafts || []) md += `### ${d.seat} (${Math.round((d.ms || 0) / 1000)} s)${d.error ? ' — ERROR' : ''}\n\n${d.error ? `Error: ${one(d.error, 500)}\n\n` : ''}${d.text ? quote(block(d.text, 1500)) + '\n\n' : ''}`
    md += '## Reviews\n\n'
    for (const r of j.reviews || []) md += `### ${r.seat}: vote ${r.vote}, confidence ${r.confidence} (${Math.round((r.ms || 0) / 1000)} s)\n\n${quote(block(r.critique || '', 1200))}\n\n`
    if ((j.evidenceUrls || []).length) md += `## Evidence URLs\n\n${j.evidenceUrls.map(u => '- ' + redact(u)).join('\n')}\n`
    write(`${H}/dsh/council-runs/${name}`, md)
  }
  const jd = path.join(dir, 'journal')
  const jfiles = fs.existsSync(jd) ? fs.readdirSync(jd).filter(f => f.endsWith('.jsonl')) : []
  idx += `\n## Run journals\n\nContinuation journals DSH writes while a run is in flight (${jfiles.length}):\n\n`
  let jfirst = null, jlast = null
  for (const f of jfiles) {
    const recs = lines(path.join(jd, f))
    let md = header(`DSH run journal ${f}`, `\`~/.dsh/council-runs/journal/${f}\``, `- **Records:** ${recs.length}\n`)
    md += '| Time | Event | Stage/seat | Status | Detail |\n|---|---|---|---|---|\n'
    for (const r of recs.slice(0, 500)) {
      const t = r.at || r.ts || r.timestamp || r.time
      if (t) { const s = iso(t); if (s) { if (!jfirst || s < jfirst) jfirst = s; if (!jlast || s > jlast) jlast = s } }
      const ev = r.type || r.kind || r.event || r.op || r.key || ''
      const stage = [r.stage, r.phase, r.seat, r.seatId, r.unit, r.taskId].filter(Boolean).join(' / ')
      const status = r.status || r.state || r.result || r.outcome || ''
      const detail = r.error || r.message || r.reason || r.reply || r.text || r.summary || (ev ? '' : Object.keys(r).join(','))
      md += `| ${iso(t)} | ${cell(ev, 40)} | ${cell(stage, 60)} | ${cell(typeof status === 'object' ? JSON.stringify(status) : status, 40)} | ${cell(typeof detail === 'object' ? JSON.stringify(detail) : detail, 220)} |\n`
    }
    if (recs.length > 500) md += `\n… ${recs.length - 500} more records not exported.\n`
    const name = f.replace(/\.jsonl$/, '.md')
    write(`${H}/dsh/journal/${name}`, md)
    idx += `- [${name}](journal/${name}) — ${recs.length} records\n`
  }
  write(`${H}/dsh/README.md`, idx)
  coverage.dsh = { runs: runs.length, first: runs[0] && iso(runs[0].j.at), last: runs.at(-1) && iso(runs.at(-1).j.at), journals: jfiles.length, jfirst, jlast }
}

// ---------- DSH agent sessions ----------
// session.jsonl.zstd is a chain of independent Zstandard frames (header frame, then
// one frame per durable batch). zstdDecompressSync reads one frame, so split first.
const ZSTD_MAGIC = 0xFD2FB528
function zstdFrames(buf) {
  const out = []
  let o = 0
  while (o + 4 <= buf.length && buf.readUInt32LE(o) === ZSTD_MAGIC) {
    const start = o
    o += 4
    const d = buf[o++]
    const fcs = d >>> 6, single = (d & 0x20) !== 0, checksum = (d & 0x04) !== 0, dict = d & 0x03
    o += (single ? 0 : 1) + (dict === 3 ? 4 : dict) + (fcs === 0 ? (single ? 1 : 0) : 1 << fcs)
    for (;;) {
      if (o + 3 > buf.length) return out
      const h = buf.readUIntLE(o, 3)
      o += 3 + (((h >>> 1) & 3) === 1 ? 1 : h >>> 3)
      if (h & 1) break
    }
    if (checksum) o += 4
    if (o > buf.length) return out
    out.push(buf.subarray(start, o))
  }
  return out
}
function dshRecords(file) {
  const buf = fs.readFileSync(file)
  let text = ''
  if (file.endsWith('.zstd')) {
    const parts = []
    for (const f of zstdFrames(buf)) { try { parts.push(zlib.zstdDecompressSync(f)) } catch { break } }
    text = Buffer.concat(parts).toString('utf8')
  } else text = buf.toString('utf8')
  const out = []
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)) } catch {} }
  return out
}
const contentText = c => (Array.isArray(c) ? c : []).filter(b => b && b.type === 'text').map(b => b.text).join('\n')
function exportDshSessions() {
  const root = path.join(HOME, '.dsh/sessions')
  if (typeof zlib.zstdDecompressSync !== 'function') { coverage.dshSessions = { skipped: `Node ${process.version} has no zstd` }; return }
  const files = walk(root, p => /[\\/]session\.jsonl(\.zstd)?$/.test(p))
  const sessions = []
  for (const f of files) {
    let recs
    try { recs = dshRecords(f) } catch { continue }
    const h = recs[0]
    if (!h || h.type !== 'session') continue
    const s = { id: h.id, cwd: h.cwd || '', created: h.createdAt, origin: h.origin || '', parent: h.parentSession || '', preset: h.agentPreset || '', title: '', models: new Set(), turns: 0, asks: [], final: '', tools: {}, retries: 0, commands: [], compactions: 0, end: h.createdAt, bytes: fs.statSync(f).size }
    for (const r of recs.slice(1)) {
      const d = r.data || {}
      const t = r.time ?? r.time0
      if (t > s.end) s.end = t
      if (r.type === 'session/title' && d.title) s.title = d.title
      else if (r.type === 'request/context' && d.model) s.models.add(`${d.provider}/${d.model}`)
      else if (r.type === 'turn/start') s.turns++
      else if (r.type === 'user/message') { const x = contentText(d.content).trim(); if (x) s.asks.push({ at: t, t: x }) }
      else if (r.type === 'assistant/message') { const x = contentText(d.message?.content).trim(); if (x) s.final = x }
      else if (r.type === 'tool/call' && d.name) s.tools[d.name] = (s.tools[d.name] || 0) + 1
      else if (r.type === 'llm/retry') s.retries++
      else if (r.type === 'command/run') s.commands.push(`/${d.name}${d.args || ''}`)
      else if (r.type === 'compaction/start') s.compactions++
    }
    sessions.push(s)
  }
  sessions.sort((a, b) => a.created - b.created)
  const top = sessions.filter(s => s.origin !== 'subagent' && (s.asks.length || s.final))
  const subs = sessions.filter(s => s.origin === 'subagent')
  let md = header(`DSH agent sessions on ${HOST}`, '`~/.dsh/sessions/<project-key>/<session-id>/session.jsonl.zstd`', `- **Sessions:** ${top.length} with user messages, oldest first; ${subs.length} subagent sessions in the table at the end; ${sessions.length - top.length - subs.length} empty.\n`)
  for (const s of top) {
    const tools = Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')
    md += `## ${iso(s.created)} — ${cell(s.title || s.asks[0]?.t || '(untitled)', 100)}\n\n`
    md += `- **Session:** \`${s.id}\` · cwd \`${src(s.cwd)}\` · preset ${s.preset || '—'} · log ${kfmt(s.bytes)} bytes compressed\n`
    md += `- **Span:** ${iso(s.created)} → ${iso(s.end)} · **models:** ${[...s.models].join(', ') || 'unknown'}\n`
    md += `- **Turns:** ${s.turns} · **tools:** ${tools || 'none'}${s.retries ? ` · **LLM retries:** ${s.retries}` : ''}${s.compactions ? ` · **compactions:** ${s.compactions}` : ''}\n`
    if (s.commands.length) md += `- **Slash commands:** ${s.commands.slice(0, 12).map(c => '`' + one(c, 60) + '`').join(', ')}\n`
    md += `\n**Asks (first ${Math.min(3, s.asks.length)} of ${s.asks.length}):**\n\n`
    for (const a of s.asks.slice(0, 3)) md += `- ${iso(a.at)}: ${one(a.t, 400)}\n`
    if (s.asks.length > 3) md += `- … last: ${one(s.asks.at(-1).t, 400)}\n`
    md += `\n**Final reply (truncated):**\n\n${quote(block(s.final || '(none)', 700))}\n\n`
  }
  md += '## Subagent sessions\n\n| Start (UTC) | Session | Parent | Models | Tools | Ask | Answer |\n|---|---|---|---|---|---|---|\n'
  for (const s of subs) md += `| ${iso(s.created)} | \`${String(s.id).slice(0, 8)}\` | \`${String(s.parent).replace(/^session-/, '').slice(0, 8)}\` | ${[...s.models].join(', ')} | ${cell(Object.entries(s.tools).map(([k, v]) => `${k} ${v}`).join(', '), 60)} | ${cell(s.asks[0]?.t, 140)} | ${cell(s.final, 160)} |\n`
  write(`${H}/dsh/sessions.md`, md)
  coverage.dshSessions = { files: files.length, withAsks: top.length, subagents: subs.length, first: sessions[0] && iso(sessions[0].created), last: sessions.at(-1) && iso(sessions.at(-1).created) }
}

// ---------- Gatekeeper ----------
function exportGatekeeper() {
  const gk = path.join(HOME, 'Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper')
  const sd = path.join(gk, 'state')
  if (!fs.existsSync(sd)) { coverage.gatekeeper = { missing: '~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/state' }; return }
  const rows = [], raw = []
  for (const f of fs.readdirSync(sd).sort()) {
    if (!fs.statSync(path.join(sd, f)).isFile()) continue
    const text = fs.readFileSync(path.join(sd, f), 'utf8').replace(/^﻿/, '')
    const id = f.replace(/\.json$/, '').slice(0, 12)
    let j = null
    try { j = JSON.parse(text) } catch {}
    const mtime = fs.statSync(path.join(sd, f)).mtime.toISOString()
    if (j && typeof j === 'object') {
      const flat = {}
      ;(function flatten(o, pre) { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, pre + k + '.'); else flat[pre + k] = v } })(j, '')
      const pick = re => { const k = Object.keys(flat).find(k => re.test(k)); return k ? flat[k] : '' }
      rows.push({ t: pick(/(^|\.)(time|timestamp|at|updatedAt|createdAt|completedAt|finishedAt)$/i) || mtime, id, repo: pick(/repo|path/i), branch: pick(/branch|ref/i), head: pick(/head|sha|commit/i), status: pick(/status|result|state|outcome/i), msg: pick(/error|message|reason|detail/i) })
      raw.push(JSON.stringify({ receipt: id, source: `state/${id}….json`, mtime, data: JSON.parse(redact(JSON.stringify(j))) }))
    } else {
      rows.push({ t: mtime, id, repo: '', branch: '', head: '', status: 'non-JSON receipt', msg: text })
      raw.push(JSON.stringify({ receipt: id, source: `state/${id}….json`, mtime, text: redact(text) }))
    }
  }
  rows.sort((a, b) => String(a.t).localeCompare(String(b.t)))
  let md = header(`PowerShell gatekeeper receipts on ${HOST}`, '`~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/state/*.json`', `- **Receipts:** ${rows.length}. Full redacted records: [receipts.jsonl](receipts.jsonl). Claude \`git-gatekeeper\` pushes are recorded in [../../../push-requests.md](../../../push-requests.md) and [../../../shared-agent-log.md](../../../shared-agent-log.md), not here.\n`)
  md += '| Time | Receipt | Repo | Branch | Head | Status | Detail |\n|---|---|---|---|---|---|---|\n'
  for (const r of rows) md += `| ${cell(r.t, 30)} | \`${r.id}\` | ${cell(r.repo, 70)} | ${cell(r.branch, 40)} | ${cell(String(r.head).slice(0, 12), 14)} | ${cell(r.status, 30)} | ${cell(r.msg, 220)} |\n`
  write(`${H}/gatekeeper/receipts.md`, md)
  write(`${H}/gatekeeper/receipts.jsonl`, raw.join('\n') + '\n')
  coverage.gatekeeper = { receipts: rows.length, first: rows[0]?.t, last: rows.at(-1)?.t }
}

// ---------- DSH settings snapshot ----------
function loadYaml() {
  const pnpm = path.join(HOME, 'Documents/claudecode/deepseek-harness/node_modules/.pnpm')
  let dirs = []
  try { dirs = fs.readdirSync(pnpm).filter(d => /^yaml@\d/.test(d)).sort().reverse() } catch {}
  for (const d of dirs) { try { return createRequire(path.join(pnpm, d, 'node_modules/yaml/package.json'))('yaml') } catch {} }
  return null
}
const SECRET_KEY = /(key|token|secret|password|passwd|auth|bearer|cookie|credential)/i
function exportSettings() {
  const file = path.join(HOME, '.dsh/settings.yaml')
  if (!fs.existsSync(file)) { coverage.settings = { missing: '~/.dsh/settings.yaml' }; return }
  const rawText = fs.readFileSync(file, 'utf8')
  const YAML = loadYaml()
  let body, mode
  let presetIds = []
  if (YAML) {
    mode = 'parsed'
    const clean = (v, k = '') => {
      if (Array.isArray(v)) return v.map(x => clean(x, k))
      if (v && typeof v === 'object') {
        const o = {}
        for (const [kk, vv] of Object.entries(v)) {
          if (kk === 'pipelinePresets' && vv && typeof vv === 'object') { presetIds = Object.keys(vv); o[kk] = `<omitted: ${presetIds.length} saved runs, exported one file each under dsh-presets/>`; continue }
          o[kk] = clean(vv, kk)
        }
        return o
      }
      if (typeof v === 'string') {
        if (SECRET_KEY.test(k) && !/Env$/.test(k) && v) { redactions++; return '<redacted>' }
        const r = redact(v)
        return r.length > 1500 ? r.slice(0, 1500) + ` … [truncated ${r.length - 1500} chars]` : r
      }
      return v
    }
    body = YAML.stringify(clean(YAML.parse(rawText)), { lineWidth: 0 })
  } else {
    // No yaml package on this machine: sanitize line by line and drop the pipelinePresets block.
    mode = 'line-based (yaml package not found)'
    const out = []
    let skipIndent = -1
    for (const line of rawText.replace(/\r\n/g, '\n').split('\n')) {
      const indent = line.match(/^\s*/)[0].length
      if (skipIndent >= 0) { if (!line.trim() || indent > skipIndent) continue; skipIndent = -1 }
      const preset = line.match(/^(\s*)pipelinePresets\s*:/)
      if (preset) { skipIndent = preset[1].length; out.push(`${preset[1]}pipelinePresets: "<omitted: saved runs are exported under dsh-presets/>"`); continue }
      const kv = line.match(/^(\s*(?:-\s+)?["']?([\w.-]+)["']?\s*:\s*)(\S.*)$/)
      if (kv && SECRET_KEY.test(kv[2]) && !/Env$/.test(kv[2]) && !/^[|>]/.test(kv[3])) { redactions++; out.push(`${kv[1]}"<redacted>"`); continue }
      const r = redact(line)
      out.push(r.length > 1500 ? r.slice(0, 1500) + ' … [truncated]' : r)
    }
    body = out.join('\n') + '\n'
  }
  const head = `# SANITIZED SNAPSHOT of ~/.dsh/settings.yaml on ${HOST} — not the live file, not loaded by DSH.\n# Exported ${EXPORTED} by .sync/export-history.mjs (${mode}).\n# Removed: values under secret-named keys, credential-shaped strings, e-mail addresses, account names, home paths (~).\n# Kept: env-var NAMES (apiKeyEnv), providers, models, council seats, swarm roster, quota readings.\n# Truncated: long transient text at 1500 chars. pipelinePresets omitted (see dsh-presets/).\n`
  write(`${SYS}/dsh-settings.sanitized.yaml`, head + body)
  coverage.settings = { mode, presets: presetIds.length, mtime: fs.statSync(file).mtime.toISOString() }
}

// ---------- READMEs ----------
function hostReadme() {
  const c = coverage
  const n = (o, k) => (o && !o.missing && !o.skipped ? o[k] ?? 0 : `— (${o?.missing ? `no ${o.missing}` : o?.skipped || 'not exported'})`)
  const span = o => (o && o.first ? `${String(o.first).slice(0, 10)} → ${String(o.last).slice(0, 10)}` : '')
  let md = `# History exports — ${HOST}\n\nRedacted, compact exports of agent records that otherwise exist only on ${HOST}'s disk. **Evidence snapshots**, not live state and not a second brain; the live notes (\`MEMORY.md\`, \`shared-agent-log.md\`, handoffs, \`push-requests.md\`) stay authoritative.\n\n`
  md += `- **Exported:** ${EXPORTED} by \`.sync/export-history.mjs\`. Each run replaces this folder and \`system/${HOST}/\`. Refresh with \`.sync/EXPORT-HISTORY.cmd\`.\n`
  md += `- **Redaction:** credential shapes (API keys, JWTs, private keys, 64-hex keys), values under secret-named keys, e-mail addresses, account names and home paths (\`~\`). Long text truncated where marked. Exact user wording is kept only for the first three and the last ask of each session, each up to 400 characters. ${redactions} values redacted this run.\n- **Scan:** the exporter re-reads every file it wrote and fails on a credential shape, the brain key, an e-mail or a home path.\n\n`
  md += '| Export | Source (local-only) | Count | Span |\n|---|---|---|---|\n'
  md += `| [claude-code/](claude-code/) sessions by month | \`~/.claude/projects/<key>/<session>.jsonl\` | ${n(c.claude, 'sessions')} | ${span(c.claude)} |\n`
  md += `| [claude-code/dsh-seat-calls.md](claude-code/dsh-seat-calls.md) | \`~/.claude/projects/*dsh-seat-cwd*\` | ${n(c.claude, 'seats')} | |\n`
  md += `| [codex/sessions.md](codex/sessions.md) | \`~/.codex/sessions/**/rollout-*.jsonl\` | ${n(c.codex, 'sessions')} | ${span(c.codex)} |\n`
  md += `| [codex/exec-calls.md](codex/exec-calls.md) | same, originator \`codex_exec\` | ${n(c.codex, 'execs')} | |\n`
  md += `| [codex/workspaces.md](codex/workspaces.md), [codex/outputs/](codex/outputs/) | \`~/Documents/Codex/<date>/<slug>/\` | ${n(c.codex, 'workspaces')} dates, ${n(c.codex, 'copied')} docs | |\n`
  md += `| [dsh/README.md](dsh/README.md) council runs + journals | \`~/.dsh/council-runs/\` | ${n(c.dsh, 'runs')} runs, ${n(c.dsh, 'journals')} journals | ${span(c.dsh)} |\n`
  md += `| [dsh/sessions.md](dsh/sessions.md) | \`~/.dsh/sessions/**/session.jsonl.zstd\` | ${n(c.dshSessions, 'withAsks')} sessions, ${n(c.dshSessions, 'subagents')} subagent | ${span(c.dshSessions)} |\n`
  md += `| [gatekeeper/receipts.md](gatekeeper/receipts.md) | PowerShell gatekeeper \`state/*.json\` | ${n(c.gatekeeper, 'receipts')} | ${c.gatekeeper?.first ? `${String(c.gatekeeper.first).slice(0, 10)} → ${String(c.gatekeeper.last).slice(0, 10)}` : ''} |\n`
  md += `| [../../system/${HOST}/dsh-settings.sanitized.yaml](../../system/${HOST}/dsh-settings.sanitized.yaml) | \`~/.dsh/settings.yaml\` | ${c.settings?.missing ? '— (missing)' : c.settings?.mode} | |\n\n`
  md += '## Still local-only\n\n- Full transcripts: tool inputs and outputs, reasoning, every message. Only summaries are exported.\n- `~/.dsh/memory`, DSH seat homes, Antigravity seat state and every auth folder.\n- `~/.dsh/.credentials.yaml` (sealed copy: `../../dsh-credentials.enc`), `~/.claude/brain-secrets.key` and the local `keys` branch. **Never exported.**\n- Codex workspace code, `work/` staging clones, `test-runs/`, dependencies.\n'
  write(`${H}/README.md`, md)
  write('history/README.md', '# History exports\n\nOne folder per machine: `history/<hostname>/`, with the sanitized DSH settings in `system/<hostname>/`. Each folder\'s `README.md` says when it was exported, what it covers and what stays local-only.\n\nThe exports are redacted evidence snapshots of records that otherwise exist only on that machine (Claude Code and Codex sessions, DSH council runs, journals and agent sessions, PowerShell gatekeeper receipts). The live notes stay authoritative.\n\nRefresh a machine by running `.sync/EXPORT-HISTORY.cmd` on it (or `EXPORT-HISTORY.cmd` on the clone drive): it syncs the brain, exports, scans and commits locally. It never pushes.\n')
}

// ---------- scan ----------
function scan(roots) {
  const hits = []
  let key = ''
  try { key = fs.readFileSync(path.join(HOME, '.claude/brain-secrets.key'), 'utf8').trim() } catch {}
  const probes = [...CRED, HOMEPATH, POSIXHOME, EMAIL, ...(KEYUSER ? [KEYUSER] : [])]
  for (const root of roots) {
    for (const f of walk(root, () => true)) {
      const text = fs.readFileSync(f, 'utf8')
      const rel = path.relative(OUT, f).replace(/\\/g, '/')
      for (const re of probes) {
        re.lastIndex = 0
        const m = re.exec(text)
        if (m) { hits.push(`${rel}: matches ${String(re).slice(0, 40)} at "${m[0].slice(0, 6)}…"`); break }
      }
      if (key.length >= 16 && text.includes(key)) hits.push(`${rel}: contains the brain key`)
    }
  }
  return hits
}

if (!SCAN_ONLY) {
  // Fresh snapshot for this host; the pre-2026-09-15 host-less layout is retired.
  for (const rel of [H, SYS, 'history/claude-code', 'history/codex', 'history/dsh', 'history/gatekeeper', 'system/dsh-settings.sanitized.yaml', '.export-coverage.json']) {
    fs.rmSync(path.join(OUT, rel), { recursive: true, force: true })
  }
  exportClaude(); exportCodex(); exportDsh(); exportDshSessions(); exportGatekeeper(); exportSettings(); hostReadme()
  write(`${H}/.export-coverage.json`, JSON.stringify({ exported: EXPORTED, host: HOST, node: process.version, redactions, coverage }, null, 2))
}
const hits = scan(SCAN_ONLY ? [path.join(OUT, 'history'), path.join(OUT, 'system')] : [path.join(OUT, H), path.join(OUT, SYS)])
console.log(JSON.stringify({ host: HOST, scanOnly: SCAN_ONLY, redactions, coverage, scanHits: hits }, null, 1))
process.exit(hits.length ? 2 : 0)
