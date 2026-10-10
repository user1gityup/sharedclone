#!/usr/bin/env node
// Agent Project Manager - CLI and MCP (stdio) client. Both talk to the server's
// REST API, so every machine and agent shares one source of truth.
//   node cli.mjs help            node cli.mjs mcp   (MCP server over stdio)
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const BASE = (process.env.PM_URL || 'http://127.0.0.1:4480').replace(/\/$/, '')

export async function call(method, path, body, { actor, model } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (process.env.PM_TOKEN) headers.authorization = `Bearer ${process.env.PM_TOKEN}`
  const who = { actor: actor || process.env.PM_ACTOR, model: model || process.env.PM_MODEL }
  if (who.actor) headers['x-pm-actor'] = who.actor
  if (who.model) headers['x-pm-model'] = who.model
  let res
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch (err) {
    throw new Error(`cannot reach pm server at ${BASE} (${err.cause?.code ?? err.message}); start it with START-PM.cmd`)
  }
  const data = await res.json()
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.data = data
    throw err
  }
  return data
}

const enc = encodeURIComponent
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')).toString()
const WHO = { actor: { type: 'string', description: 'Who is acting. Agents: your model name, e.g. "Claude Opus 5".' }, model: { type: 'string', description: 'Exact model id, if an agent.' } }
const s = (description) => ({ type: 'string', description })
const n = (description) => ({ type: 'number', description })

// One table drives both the MCP tools and the CLI commands.
export const TOOLS = [
  { name: 'pm_list_projects', cli: 'projects', description: 'List projects with task counts.', props: {}, required: [],
    run: () => call('GET', '/api/projects') },
  { name: 'pm_create_project', cli: 'project-add', args: ['name'], description: 'Create a project.', props: { name: s('Unique project name'), description: s('What it is') }, required: ['name'],
    run: (a) => call('POST', '/api/projects', { name: a.name, description: a.description }, a) },
  { name: 'pm_list_tasks', cli: 'tasks', description: 'List tasks, highest priority first. Filter by project, status, claimed_by, or text q.', props: { project: s('Project id or name'), status: s('todo|in_progress|review|blocked|uncertain|done'), claimed_by: s('Holder'), q: s('Text search') }, required: [],
    run: (a) => call('GET', `/api/tasks?${qs({ project: a.project, status: a.status, claimed_by: a.claimed_by, q: a.q })}`) },
  { name: 'pm_get_task', cli: 'show', args: ['id'], description: 'Task with its comments, instructions, artifacts, continuation briefs and full history. Read before working on a task.', props: { id: s('Task id') }, required: ['id'],
    run: (a) => call('GET', `/api/tasks/${enc(a.id)}`) },
  { name: 'pm_create_task', cli: 'add', args: ['project', 'title'], description: 'Create a task in a project.', props: { project: s('Project id or name'), title: s('Title'), body: s('Requirements, markdown'), priority: n('1 high, 2 normal, 3 low'), assignee: s('Only this actor may claim it via next') }, required: ['project', 'title'],
    run: (a) => call('POST', '/api/tasks', { project: a.project, title: a.title, body: a.body, priority: a.priority, assignee: a.assignee }, a) },
  { name: 'pm_update_task', cli: 'set', args: ['id'], description: 'Edit a task. rev must be the revision you read; a stale rev returns 409 with the current task and your rejected fields.', props: { id: s('Task id'), rev: n('Revision you edited'), title: s('Title'), body: s('Body'), status: s('todo|in_progress|review|blocked|uncertain|done'), priority: n('1-3'), assignee: s('Assignee') }, required: ['id', 'rev'],
    run: (a) => call('PATCH', `/api/tasks/${enc(a.id)}`, pick(a, ['rev', 'title', 'body', 'status', 'priority', 'assignee']), a) },
  { name: 'pm_claim_task', cli: 'claim', args: ['id'], description: 'Claim a task with a lease. Fails with 409 if another actor holds it.', props: { id: s('Task id'), leaseSeconds: n('Lease length, default 900') }, required: ['id'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/claim`, { leaseSeconds: a.leaseSeconds }, a) },
  { name: 'pm_claim_next', cli: 'next', description: 'Atomically claim the highest-priority open task. Returns null when nothing is open.', props: { project: s('Limit to a project'), leaseSeconds: n('Lease length, default 900') }, required: [],
    run: (a) => call('POST', '/api/next', { project: a.project, leaseSeconds: a.leaseSeconds }, a) },
  { name: 'pm_heartbeat', cli: 'beat', args: ['id'], description: 'Extend your lease. Call before it runs out or the task becomes uncertain.', props: { id: s('Task id'), leaseSeconds: n('New lease from now') }, required: ['id'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/heartbeat`, { leaseSeconds: a.leaseSeconds }, a) },
  { name: 'pm_release_task', cli: 'release', args: ['id'], description: 'Release your claim, set the resulting status, and leave a continuation brief for whoever picks it up.', props: { id: s('Task id'), status: s('Resulting status, e.g. review or done'), brief: s('Continuation brief: done, half-done, next action'), force: { type: 'boolean', description: 'Take back another holder\'s claim' } }, required: ['id'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/release`, { status: a.status, brief: a.brief, force: a.force === true || a.force === 'true' }, a) },
  { name: 'pm_comment', cli: 'comment', args: ['id', 'body'], description: 'Add a discussion comment, or with kind=instruction an execution instruction the worker must acknowledge.', props: { id: s('Task id'), body: s('Text'), kind: s('comment (default) or instruction') }, required: ['id', 'body'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/comments`, { body: a.body, kind: a.kind }, a) },
  { name: 'pm_ack_instruction', cli: 'ack', args: ['comment_id'], description: 'Acknowledge an instruction.', props: { comment_id: n('Comment id') }, required: ['comment_id'],
    run: (a) => call('POST', `/api/comments/${enc(a.comment_id)}/ack`, {}, a) },
  { name: 'pm_add_artifact', cli: 'artifact', args: ['id', 'kind', 'ref'], description: 'Attach evidence: a commit, file, url, run id, verification output or brief.', props: { id: s('Task id'), kind: s('brief|commit|file|url|evidence|run'), ref: s('Hash, path, url or id'), note: s('What it shows') }, required: ['id', 'kind', 'ref'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/artifacts`, { kind: a.kind, ref: a.ref, note: a.note }, a) },
  { name: 'pm_task_actions', cli: 'actions', args: ['id'], description: 'Which of prepare/start/resume/continue/amend/stop/archive this task allows right now, and why the others are refused.', props: { id: s('Task id') }, required: ['id'],
    run: (a) => call('GET', `/api/tasks/${enc(a.id)}/actions`) },
  { name: 'pm_prepare_run', cli: 'prepare', args: ['id'], description: 'Build a run for the task and STOP. Records the query, stages, mode and the seat roster; starts nothing. pm never picks seats - an empty roster comes back as a question for the user.', props: { id: s('Task id'), request: s('What to run, in your own words. Defaults to the task next_action, then its title'), stages: s('Stage order, e.g. council,propose,swarm,review'), mode: s('Pipeline mode'), cwd: s('Working directory for the DSH session'), council: s('Council seat ids, comma-separated. The user picks these.'), swarm: s('Swarm seat ids, comma-separated. The user picks these.'), keepRoster: { type: 'boolean', description: 'Reuse the roster from the last prepare instead of clearing it' } }, required: ['id'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/prepare`, { request: a.request, stages: a.stages, mode: a.mode, cwd: a.cwd, keepRoster: a.keepRoster, roster: { council: a.council, swarm: a.swarm } }, a) },
  { name: 'pm_start_run', cli: 'start', args: ['id'], description: 'Start the run the task already has prepared. Refuses while the roster is empty - the user picks the seats.', props: { id: s('Task id') }, required: ['id'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/start`, {}, a) },
  { name: 'pm_amend_run', cli: 'amend', args: ['id', 'fix'], description: 'Repair a stalled run where it stands: same run id, same journal. This is the fix-on-the-spot path; it will not restart.', props: { id: s('Task id'), fix: s('What to tell the run so it can carry on from where it stopped'), cwd: s('Working directory') }, required: ['id', 'fix'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/amend`, { fix: a.fix, cwd: a.cwd }, a) },
  { name: 'pm_stop_task', cli: 'stop', args: ['id'], description: 'Stop the running pipeline and park the task at PAUSED. A settings write, so it works even when the model is mid-turn or out of quota.', props: { id: s('Task id') }, required: ['id'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/stop`, {}, a) },
  { name: 'pm_archive_task', cli: 'archive', args: ['id'], description: 'Archive the task. Legal from any lifecycle and starts nothing.', props: { id: s('Task id'), note: s('Why') }, required: ['id'],
    run: (a) => call('POST', `/api/tasks/${enc(a.id)}/archive`, { note: a.note }, a) },
  { name: 'pm_events', cli: 'log', description: 'Attributed change history across everything, after event id `since`.', props: { since: n('Last event id seen'), limit: n('Max rows') }, required: [],
    run: (a) => call('GET', `/api/events?${qs({ since: a.since, limit: a.limit })}`) },
]
for (const t of TOOLS) Object.assign(t.props, WHO)

function pick(o, keys) {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, ['rev', 'priority'].includes(k) ? Number(o[k]) : o[k]]))
}

async function mcp() {
  const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue }
    if (msg.id === undefined) continue // notification
    const reply = (result) => out({ jsonrpc: '2.0', id: msg.id, result })
    if (msg.method === 'initialize') {
      reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'pm', version: '1.0.0' } })
    } else if (msg.method === 'ping') {
      reply({})
    } else if (msg.method === 'tools/list') {
      reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: 'object', properties: t.props, required: t.required } })) })
    } else if (msg.method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === msg.params?.name)
      if (!tool) { out({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `unknown tool ${msg.params?.name}` } }); continue }
      try {
        reply({ content: [{ type: 'text', text: JSON.stringify(await tool.run(msg.params.arguments ?? {}), null, 2) }] })
      } catch (err) {
        reply({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: err.message, ...(err.data ?? {}) }, null, 2) }] })
      }
    } else {
      out({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } })
    }
  }
}

function help() {
  const lines = TOOLS.map((t) => `  ${[t.cli, ...(t.args ?? []).map((x) => `<${x}>`)].join(' ').padEnd(34)} ${t.description}`)
  console.log(`pm - Agent Project Manager CLI   server: ${BASE}
Options are --key value (e.g. --status review --brief "..."). Identity: --actor/--model or PM_ACTOR/PM_MODEL.
Add --json for raw output.
  mcp                                MCP server over stdio
${lines.join('\n')}`)
}

function brief(data) {
  if (data === null) return 'nothing open'
  const row = (t) => `${t.id}  [${t.status}] p${t.priority} rev${t.rev}  ${t.title}${t.claimed_by ? `  (claimed: ${t.claimed_by} until ${t.lease_until})` : ''}`
  if (Array.isArray(data)) {
    if (!data.length) return '(none)'
    if ('title' in data[0]) return data.map(row).join('\n')
    if ('task_count' in data[0]) return data.map((p) => `${p.id}  ${p.name}  ${p.done_count}/${p.task_count} done`).join('\n')
    if ('action' in data[0]) return data.map((e) => `#${e.id} ${e.at} ${e.actor}${e.model ? ` (${e.model})` : ''} ${e.entity}:${e.entity_id} ${e.action}`).join('\n')
  }
  if (data?.history) {
    return [row(data), '', data.body, '',
      ...data.comments.map((c) => `${c.kind === 'instruction' ? 'INSTRUCTION' : 'comment'} #${c.id} ${c.actor}: ${c.body}${c.kind === 'instruction' ? (c.acked_by ? ` [acked by ${c.acked_by}]` : ' [NOT ACKED]') : ''}`),
      ...data.artifacts.map((x) => `${x.kind}: ${x.ref}${x.note ? ` - ${x.note}` : ''}  (${x.actor})`),
      '', ...data.history.map((e) => `  ${e.at} ${e.actor} ${e.action}`)].join('\n')
  }
  if (data?.title !== undefined) return row(data)
  if (data?.name !== undefined && data.id?.startsWith('P-')) return `${data.id}  ${data.name}`
  if (data?.kind !== undefined && data.created_at) return `#${data.id} ${data.kind} added`
  return JSON.stringify(data, null, 2)
}

async function main(argv) {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === 'help' || cmd === '--help') return help()
  if (cmd === 'mcp') return mcp()
  const tool = TOOLS.find((t) => t.cli === cmd)
  if (!tool) { console.error(`unknown command ${cmd}`); help(); process.exitCode = 2; return }
  const a = {}
  const positional = []
  let json = false
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json') json = true
    else if (rest[i].startsWith('--')) a[rest[i].slice(2)] = rest[++i]
    else positional.push(rest[i])
  }
  ;(tool.args ?? []).forEach((name, i) => { if (positional[i] !== undefined) a[name] = positional[i] })
  const missing = tool.required.filter((k) => a[k] === undefined)
  if (missing.length) { console.error(`missing: ${missing.join(', ')}`); process.exitCode = 2; return }
  try {
    const data = await tool.run(a)
    console.log(json ? JSON.stringify(data, null, 2) : brief(data))
  } catch (err) {
    console.error(`error: ${err.message}`)
    if (err.data?.rejected) console.error(`your rejected change: ${JSON.stringify(err.data.rejected)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
