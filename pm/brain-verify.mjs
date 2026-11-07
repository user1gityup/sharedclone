// Shared Brain verification (T-5c6c9d9b, T-68852e15). Pure functions plus a directory manifest.
//  - Cross-machine consistency: manifest(dir) hashes every note; diffManifests reports drift.
//    Per-machine evidence (.rules-drift, .sync-conflicts, .git) is excluded, as the sync does.
//  - Conflict recovery: mergeNote(base, local, remote) never loses content. One-sided edits win,
//    identical edits collapse, non-overlapping line edits merge, anything else is a conflict
//    that keeps BOTH full versions (backup of local + remote sidecar) for an agent to reconcile.
//  - Rules drift: revertRulesDrift(master, edited) returns the master and the evidence file text.
//  - Layering: the Shared Brain / PM / Context Compiler / DSH / agent authority table.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const EXCLUDED = new Set(['.git', '.rules-drift', '.sync-conflicts', 'node_modules'])
const sha = (s) => createHash('sha256').update(s).digest('hex')
const lf = (s) => s.replace(/\r\n/g, '\n')

/** { 'rel/path.md': sha256 } over every file; line endings normalised so CRLF never reads as drift. */
export function manifest(dir) {
  const out = {}
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (EXCLUDED.has(name)) continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else out[relative(dir, p).split(sep).join('/')] = sha(lf(readFileSync(p, 'utf8')))
    }
  }
  walk(dir)
  return out
}

/** Drift between two manifests: zero diff means consistent. */
export function diffManifests(a, b) {
  const onlyA = Object.keys(a).filter((k) => !(k in b)).sort()
  const onlyB = Object.keys(b).filter((k) => !(k in a)).sort()
  const changed = Object.keys(a).filter((k) => k in b && a[k] !== b[k]).sort()
  return { consistent: !onlyA.length && !onlyB.length && !changed.length, onlyA, onlyB, changed }
}

/**
 * Three-way merge of one note. Returns
 *  { result: 'same'|'local'|'remote'|'merged'|'conflict', merged, backup?, sidecar? }
 * On conflict `merged` is the LOCAL text (nothing is overwritten), `backup` is the local text
 * kept aside and `sidecar` is the remote text, so both versions stay recoverable.
 */
export function mergeNote(base, local, remote) {
  const [b, l, r] = [lf(base), lf(local), lf(remote)]
  if (l === r) return { result: 'same', merged: l }
  if (l === b) return { result: 'remote', merged: r }
  if (r === b) return { result: 'local', merged: l }
  const bl = b.split('\n'), ll = l.split('\n'), rl = r.split('\n')
  if (bl.length === ll.length && bl.length === rl.length) {
    const out = []
    let ok = true
    for (let i = 0; i < bl.length; i++) {
      if (ll[i] === rl[i]) out.push(ll[i])
      else if (ll[i] === bl[i]) out.push(rl[i])
      else if (rl[i] === bl[i]) out.push(ll[i])
      else { ok = false; break }
    }
    if (ok) return { result: 'merged', merged: out.join('\n') }
  }
  // append-only on both sides (logs): keep base, then both tails
  if (l.startsWith(b) && r.startsWith(b)) {
    const tails = [l.slice(b.length), r.slice(b.length)].filter(Boolean)
    return { result: 'merged', merged: b + tails.join('') }
  }
  return { result: 'conflict', merged: l, backup: l, sidecar: r }
}

/** No content from either side may vanish from a non-conflict merge, except lines both replaced. */
export function preservesContent(base, local, remote, merged) {
  const m = new Set(lf(merged).split('\n'))
  const b = new Set(lf(base).split('\n'))
  return [local, remote].every((side) => lf(side).split('\n').every((line) => b.has(line) || m.has(line)))
}

/** The edited copy of a generated rules file is evidence; the master replaces it. */
export function revertRulesDrift(master, edited, { name = 'codex', at = new Date().toISOString() } = {}) {
  if (lf(master) === lf(edited)) return { drifted: false, text: master }
  return { drifted: true, text: master, evidencePath: `.rules-drift/${name}-${at.replace(/[:.]/g, '-')}.md`, evidence: edited }
}

// ---- layering ---------------------------------------------------------------------------
export const LAYERS = ['shared-brain', 'pm', 'context-compiler', 'dsh', 'agent']
/** Domain -> the single layer whose record wins. Compiler output is derived, never authoritative. */
export const AUTHORITY = {
  rules: 'shared-brain',
  memory: 'shared-brain',
  handoff: 'shared-brain',
  'task-state': 'pm',
  'resume': 'pm',
  roster: 'pm',
  'run-execution': 'dsh',
  brief: 'context-compiler',
}
export const DERIVED = new Set(['brief'])

export function authorityFor(domain) {
  const l = AUTHORITY[domain]
  if (!l) throw new Error(`no authority defined for ${domain}`)
  return l
}

/**
 * Pick the winning claim for a domain. Claims from the authoritative layer win; a claim from
 * the compiler or an agent can never override a record layer. Unknown layers are rejected.
 */
export function resolveClaims(domain, claims) {
  const auth = authorityFor(domain)
  for (const c of claims) if (!LAYERS.includes(c.layer)) throw new Error(`unknown layer ${c.layer}`)
  const win = claims.find((c) => c.layer === auth)
  if (!win) return { winner: null, authority: auth, reason: `no ${auth} record; derived or agent claims are not authority`, overridden: claims }
  return { winner: win, authority: auth, overridden: claims.filter((c) => c !== win && c.value !== win.value) }
}

/** A brief is rebuildable: same inputs, same hash; and it must cite its sources. */
export function briefHash(inputs) {
  return sha(JSON.stringify(Object.keys(inputs).sort().map((k) => [k, inputs[k]])))
}
