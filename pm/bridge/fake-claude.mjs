// TEST DOUBLE ONLY - stands in for `claude -p --output-format stream-json` in bridge/test.mjs.
// Never used by the running bridge. Prompt "SLOW" sleeps 30 s; "FAIL" exits 1.
let prompt = ''
process.stdin.on('data', (d) => { prompt += d })
process.stdin.on('end', async () => {
  const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
  const model = process.argv[process.argv.indexOf('--model') + 1]
  say({ type: 'system', subtype: 'init', session_id: 'fake-session-1', model })
  say({ type: 'assistant', session_id: 'fake-session-1', message: { content: [{ type: 'text', text: `working on: ${prompt.slice(0, 40)}` }] } })
  if (prompt.includes('SLOW')) await new Promise((r) => setTimeout(r, 30_000))
  if (prompt.includes('FAIL')) { process.stderr.write('fake failure\n'); process.exit(1) }
  say({ type: 'result', subtype: 'success', is_error: false, result: `FAKE:${prompt}`, session_id: 'fake-session-1', total_cost_usd: 0, duration_ms: 5 })
})
