// Secure remote access helpers for the DSH PM (T-4daea442). Pure functions: nothing here opens a
// socket, edits a firewall, runs tailscale or restarts a service. Plans are returned as data for an
// operator (or an approved step) to apply; funnel/public exposure is not representable.
//  - classifyAddress: loopback | lan | tailnet | public (RFC1918, 100.64.0.0/10, fd7a:115c:a1e0::/48).
//  - checkBind: a non-loopback bind needs PM_TOKEN; a wildcard bind is flagged, a public IP refused.
//  - principalOrigin: forwarding headers are believed only when the socket peer is loopback
//    (tailscale serve proxies from 127.0.0.1); anything else uses the socket address.
//  - tailscaleServePlan / firewallPlan: commands as data, private HTTPS only, LAN+tailnet scope.
//  - probeFleet: honest machine status. A machine is `offline` only after consecutive failures;
//    otherwise `degraded`; never probed = `unknown`. Each failure carries an actionable diagnosis.
//  - assertNoLocalhostBase: a page served from a non-loopback origin must not call localhost.

export function classifyAddress(addr) {
  const a = String(addr ?? '').trim().replace(/^::ffff:/i, '').toLowerCase()
  if (a === '::1' || /^127\./.test(a) || a === 'localhost') return 'loopback'
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [x, y] = [Number(m[1]), Number(m[2])]
    if ([m[1], m[2], m[3], m[4]].some((n) => Number(n) > 255)) return 'public'
    if (x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254)) return 'lan'
    if (x === 100 && y >= 64 && y <= 127) return 'tailnet'
    return 'public'
  }
  if (a.startsWith('fd7a:115c:a1e0:')) return 'tailnet'
  if (a.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(a)) return 'lan'
  return 'public'
}

/** Is the bind configuration acceptable? */
export function checkBind({ host = '127.0.0.1', token = '' } = {}) {
  const wildcard = host === '0.0.0.0' || host === '::'
  const cls = wildcard ? 'wildcard' : classifyAddress(host)
  if (cls === 'loopback') return { ok: true, exposure: 'loopback', warnings: [] }
  if (!token) return { ok: false, exposure: cls, reason: 'non-loopback bind requires PM_TOKEN', warnings: [] }
  if (cls === 'public') return { ok: false, exposure: cls, reason: 'refusing to bind a public address; bind a LAN or tailnet address', warnings: [] }
  const warnings = []
  if (wildcard) warnings.push('wildcard bind reaches every interface; restrict with a LAN/tailnet firewall rule or bind a specific address')
  return { ok: true, exposure: cls, warnings }
}

/** Where a request really came from. Forwarding headers count only from a loopback proxy. */
export function principalOrigin({ socketAddr, headers = {} }) {
  const direct = classifyAddress(socketAddr)
  if (direct !== 'loopback') return { addr: socketAddr, via: 'direct', class: direct }
  const fwd = String(headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  const tsLogin = headers['tailscale-user-login']
  if (fwd) return { addr: fwd, via: 'proxy', class: classifyAddress(fwd), tailscale_user: tsLogin ?? null }
  return { addr: socketAddr, via: 'direct', class: 'loopback' }
}

const verGte = (v, min) => {
  const a = String(v).split('.').map(Number), b = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i] }
  return true
}

/** Tailscale Serve plan (private tailnet HTTPS). Syntax depends on the installed version; verify first. */
export function tailscaleServePlan({ version, port = 4480, httpsPort = 443, funnel = false } = {}) {
  if (funnel) throw new Error('funnel/public exposure is not allowed without explicit user approval')
  if (!version) throw new Error('tailscale version required: run `tailscale version` and pass it')
  const target = `http://127.0.0.1:${port}`
  const modern = verGte(version, '1.52.0')
  return {
    syntax: modern ? 'serve --bg' : 'serve (legacy)',
    verify_first: ['tailscale version', 'tailscale status', 'tailscale serve status'],
    apply: [modern ? `tailscale serve --bg --https=${httpsPort} ${target}` : `tailscale serve https:${httpsPort} / ${target}`],
    rollback: [modern ? `tailscale serve --https=${httpsPort} off` : `tailscale serve https:${httpsPort} / off`],
    needs_user_approval: false, public: false,
  }
}

/** Windows firewall rule limited to LAN + tailnet (needs elevation, so it needs user approval). */
export function firewallPlan({ port = 4480, name = 'DSH PM LAN+tailnet' } = {}) {
  return {
    needs_elevation: true, needs_user_approval: true,
    apply: [`netsh advfirewall firewall add rule name="${name}" dir=in action=allow protocol=TCP localport=${port} remoteip=LocalSubnet,100.64.0.0/10 profile=private`],
    rollback: [`netsh advfirewall firewall delete rule name="${name}"`],
    backup: ['netsh advfirewall export "pm-firewall-backup.wfw"'],
  }
}

function diagnose(err, status) {
  if (status === 401 || status === 403) return { kind: 'auth', hint: 'peer rejected the credential: check PM_TOKEN on both machines' }
  if (status) return { kind: `http_${status}`, hint: `peer answered HTTP ${status}: pm is up but unhealthy, check its log` }
  const m = String(err?.cause?.code ?? err?.code ?? err?.name ?? err)
  if (/ECONNREFUSED/.test(m)) return { kind: 'refused', hint: 'host reachable but pm not listening: start pm or fix PM_HOST/port' }
  if (/Abort|Timeout|ETIMEDOUT/i.test(m)) return { kind: 'timeout', hint: 'no answer: check machine is on, Tailscale/LAN link and firewall rule' }
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return { kind: 'dns', hint: 'name did not resolve: check MagicDNS or use the IP' }
  return { kind: 'error', hint: m }
}

/**
 * machines: [{ name, url, token? }]. prior: Map name -> { fails, last_ok }. Returns { fleet, prior }.
 * offline needs >= offlineAfter consecutive failures; fewer is `degraded`.
 */
export async function probeFleet(machines, { fetchImpl = globalThis.fetch, prior = new Map(), now = Date.now(), timeoutMs = 3000, offlineAfter = 3 } = {}) {
  const next = new Map(prior)
  const fleet = await Promise.all(machines.map(async (m) => {
    const p = prior.get(m.name) ?? { fails: 0, last_ok: null }
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs)
      const res = await fetchImpl(`${m.url.replace(/\/$/, '')}/api/health`, { signal: ac.signal, headers: m.token ? { authorization: `Bearer ${m.token}` } : {} })
      clearTimeout(t)
      if (res.ok) { next.set(m.name, { fails: 0, last_ok: now }); return { name: m.name, status: 'online', last_ok: now, fails: 0 } }
      throw Object.assign(new Error('http'), { httpStatus: res.status })
    } catch (err) {
      const fails = p.fails + 1
      next.set(m.name, { fails, last_ok: p.last_ok })
      return { name: m.name, status: fails >= offlineAfter ? 'offline' : 'degraded', last_ok: p.last_ok, fails, diagnosis: diagnose(err, err.httpStatus) }
    }
  }))
  for (const m of machines) if (!fleet.find((f) => f.name === m.name)) fleet.push({ name: m.name, status: 'unknown' })
  return { fleet, prior: next }
}

/** Reject an API base that would make a remote browser call its own localhost. */
export function assertNoLocalhostBase(apiBase, pageOrigin) {
  if (!apiBase) return true // same-origin relative calls are the safe default
  let a, p
  try { a = new URL(apiBase, pageOrigin); p = new URL(pageOrigin) } catch { throw new Error('bad url') }
  if (classifyAddress(p.hostname) !== 'loopback' && classifyAddress(a.hostname) === 'loopback') {
    throw new Error(`page at ${p.origin} must not call ${a.origin}; use a same-origin /api path`)
  }
  return true
}
