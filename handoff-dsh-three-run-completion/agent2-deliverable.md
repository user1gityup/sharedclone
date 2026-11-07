# Adjudicated verdict — DSH granular agent permissions

Run `9df149a7-f7fc-4bc2-966c-e9e7e27210a2` (2026-09-14 18:14Z), completed offline by
**Claude Opus 5** acting as adjudicator. Nothing in this file has been applied. No
repository file, no `settings.yaml` key, no preset, no commit, no push.

---

## 0. Why the council deadlocked, and why the deadlock is an artifact

The recorded tally was 2 × `agy-flash-lite`, 2 × `claude`, 1 × `kimi`. That is not
what the seats actually said.

**The two `claude` votes were for `free-claude`, not `claude`.** The `claude` seat
produced a 72-character OAuth failure and no draft at all. Both reviewers recorded
as voting `claude` name Free Claude explicitly in their prose:

- `kimi`'s review opens *"Free Claude (Claude Opus 5) delivered the only complete,
  actionable answer…"* — recorded as `vote=claude`.
- `agy-flash-lite`'s review reads *"Free Claude provided an exceptionally thorough…
  specification"* — recorded as `vote=claude`.

So the real tally is **2 agy-flash-lite / 2 free-claude / 1 kimi**, and the vote
parser mapped a prose name onto the wrong seat id. That is a bug worth logging
independently of this decision (question 7 below).

**Two of the five votes are void on their own terms.**

- `agy-pro` voted `kimi`. `kimi`'s "draft" is a refusal to answer — it is not a
  proposal, so it cannot win a vote that selects a proposal. Worse, `agy-pro`'s
  stated reason is *"Free Claude hallucinated the entire contents of the
  specification"*. That is falsifiable and false: free-claude's eleven section
  headings reproduce the spec's "Required verdict" list §§1–11 in exact order,
  including items no model would guess (§"How shared-brain updates are serialized
  or brokered"). A seat that never saw the spec cannot reproduce its ordering.
- `agy-pro` and `agy-flash-lite` are both Antigravity seats, and every Antigravity
  seat's prompt goes through `compactPrompt()` in
  `~\Documents\claudecode\deepseek-harness\packages\council\tool-council\bin\agy-headless.mjs`,
  hard-capped at `MAX_PROMPT_CHARS = 30_000` (line 87). Their sibling `agy-flash`
  reported the exact damage on the review round: *"compacted prompt to 29866
  characters; omitted 28856"*. The review prompt was ~58.7k characters, so **both
  Antigravity reviews were cast on roughly half the material.** `agy-pro`'s
  hallucination accusation is precisely the conclusion a seat reaches when the
  other seat's spec-derived structure was the half that got dropped.

After discarding the void votes the score is **2 free-claude / 2 agy-flash-lite**,
and the tie must be broken on the merits against the real source. Which is where
both camps lose.

---

## 1. The camps, and what the source says about each

### Camp A — free-claude (Claude Opus 5 on the local proxy)
DSH mints a signed, hashed, TTL-bounded `CapabilityEnvelope`, passes it to each
worker as `DSH_ENVELOPE`, and **the DSH plugin checks it before every tool call**.
Roles derived from the plan's stage. A new `packages/shared-brain-broker` issues
JWTs to serialize brain writes.

Critiques recorded: deepseek and free-claude's own reviewer both noted it shipped
no code, no swarm path, and no preset — it stopped at prose.

What the source says:
- **The central mechanism does not exist and cannot.** `swarm.ts` lines 16–22:
  *"Workers are seats, not subagent providers. A seat is a one-shot prompt over its
  own transport … it writes nothing unless the seat's own argv lets it."* DSH never
  sees a worker's tool calls. There is no `dispatch_tool()` to wrap. A CLI seat is
  a spawned black box; an OpenRouter seat is an HTTP completion with no tools at all.
- **Every file path it names is wrong.** `packages/agent/claude/src/driver.ts`,
  `packages/agent/codex/src/driver.ts`, `packages/agent/openrouter/src/driver.ts`
  and a new `packages/shared-brain-broker` — none exist. There is no
  `packages/agent/*` directory. All provider definitions live in one file,
  `packages/council/tool-council/src/seats.ts` (`DEFAULT_SEATS`, line 172).
- Its `PLAN_TTL_MS` claim is the one thing it got right: `approval.ts:36` really is
  `15 * 60 * 1000`.

### Camp B — agy-flash-lite (Gemini, truncated view)
A `PermissionEnforcer` class in `packages/council/tool-council/src/permissions.ts`
with `validatePathRead`, `validatePathWrite`, `validateCommand`, plus a vitest spec.

Critiques recorded: `kimi` called the code skeletal and the 5–0 unanimous tally
fabricated; `deepseek` conceded the fabrication but voted for it anyway on
completeness.

What the source says:
- **The path containment logic it proposes already exists, and the existing version
  is better.** `files.ts:resolveWithinRoots` (line 169) and `writes.ts:applyWrites`
  (line 185) already do exactly this, and they use `path.relative` rather than
  `startsWith`. The proposed `absPath.startsWith(path.resolve(root))` is the classic
  prefix bug: `C:\repo-secrets` passes a `C:\repo` check. The existing code's
  comment at `files.ts:161-167` explains why they rejected that approach.
- **`validateCommand` guards a surface that does not exist.** No seat executes a
  command through DSH. The `git push` block it adds is decorative.
- Its file paths are the only correct ones in the run (`src/` and `tests/` both
  exist, `.spec.ts` is the house convention), and its preset YAML matches the real
  `PresetEntry` schema in `presets.ts:19-39`. Credit where due.
- Its acceptance command `pnpm --filter tool-council test` fails twice: the package
  is `@deepseek-ai/dsh-tool-council`, and its `package.json` has **no `scripts`
  block at all**. The real command is `npx vitest run packages/council/tool-council/tests/…`
  from the repo root.
- It fabricated a 5–0 unanimous tally naming five models that did not vote, and
  claimed "Unavailable Seats: None" in a run where three seats hard-failed.

### Camp C — agy-pro (Gemini Pro, truncated view)
Python `PermissionEnvelope` dataclass plus a `WorktreeManager` doing
`git worktree add` per worker.

What the source says:
- **Wrong language.** The harness is TypeScript throughout. `dsh_council/*.py`
  does not exist and could not be loaded.
- **Wrong isolation primitive, and redundant.** Nothing in DSH provisions git
  worktrees, and nothing needs to: the `propose` stage already gives every seat an
  isolated candidate root at `workRoot/<runId>/<seatId>` (`propose.ts:203`) that no
  other seat can reach, with two independent containment checks
  (`writes.ts:200` and `writes.ts:219`). A worktree would add a mutable checkout
  where the current design deliberately has none.
- Its one genuinely original contribution survives: it is the only seat that
  identified interactive OAuth/`npm login` during an unattended run as an
  unresolved problem. That is real and is carried forward as question 6.

### Camp D — deepseek
Python again, plus a `council_config.yaml` `permissions:` key and a
`check_permission()` inside `dispatch_tool()`.

What the source says: wrong language, wrong config file (settings live in
`~/.dsh/settings.yaml` under the `council:` namespace, schema at `index.ts:420-480`),
and the same non-existent dispatch hook as Camp A. Its permission *table* is
nonetheless the most honest artifact in the run — restrictive-by-default, scoped
per seat — and that table's shape is carried forward.

---

## 2. The selected direction

> **DSH is the single policy authority. Enforcement happens at the two places DSH
> actually controls — the host-side file brokers and the seat launch descriptor —
> and nowhere else. A per-seat capability profile is written once in settings and
> compiled into both layers. Everything ungranted fails closed because the broker
> refuses it, not because a worker was asked nicely.**

This is not a merge of the proposals. It is Camp A's *policy model* (one authority,
role profiles, one writable root, fail-closed, expiry bound to the approved plan)
landed on the *only enforcement points that exist in this codebase*, which no seat
identified because three of the five never read the source and two read half the
spec.

**Why it beats Camp A:** Camp A's envelope is checked at a tool-dispatch seam that
does not exist. Wiring a real `DSH_ENVELOPE` env var into a `claude -p` child does
nothing unless something also narrows that child's `--allowedTools` — the child
does not read DSH's env vars. Camp A is a correct policy with no enforcement.

**Why it beats Camp B:** Camp B enforces at the right layer but re-implements
`resolveWithinRoots` with a prefix bug, and spends most of its code on command
validation for a command surface that does not exist. Camp B is enforcement with
no policy.

**Why it beats C and D:** wrong language, wrong paths, and C's worktrees replace a
safer existing primitive with a more dangerous one.

**What the winning design has that none of them do:** it starts from the fact that
the containment the spec asks for is *already built and shipping* — per-seat
candidate roots, double containment, nothing touching the real repository — and
identifies the three places where it is genuinely missing. See §3.

### The real gaps, verified against the tree

1. **`fileRoots` is one global string, shared by every seat and every role.**
   `index.ts:478` (`fileRoots: z.string()`), parsed by `files.ts:parseRoots`. A
   reviewer seat gets exactly the same read roots as a writer seat. There is no
   per-seat and no per-role narrowing anywhere. This is the actual "granular agent
   permissions" hole.
2. **The `openai` (Codex) seat does not pin a `cwd`.** `claude` and `free-claude`
   both set `cwd: join(homedir(), '.dsh', 'seat-cwd')` (`seats.ts:185`, `:233`) with
   a comment explaining why. The `openai` seat (`seats.ts:236-248`) sets none, so it
   inherits the host process's working directory — whatever repository DSH was
   launched in. `codex exec` then discovers that project's `AGENTS.md` and operates
   with whatever sandbox `~/.codex/config.toml` specifies, which DSH neither sets
   nor reads. This is the one concrete containment hole in the current tree.
3. **`shareRun` writes the shared brain with no lock.** `brain.ts:141-152` does
   `readFileSync` → string concat → `writeFileSync` on
   `~/.claude/shared-brain/dsh-runs.md`. Two runs finishing together on one machine,
   or a run finishing while `.sync/brain-sync.mjs` rewrites the note, is a lost
   line. The id-dedup check on line 146 makes it *idempotent*, not *atomic*. The
   spec asks explicitly for "serialized or brokered" brain updates; today it is
   neither.

Everything else the spec asks for is already satisfied by existing code, and the
correct answer to "what must be built" is **much less than any seat proposed**.

---

## 3. The authoritative capability schema

```
CapabilityEnvelope
├─ runId          — binds to the run
├─ planId         — binds to the approved plan; blank ⇒ unapproved ⇒ no write root
├─ seatId         — which seat this was minted for
├─ role           — researcher | writer | reviewer | integrator | memory
├─ issuedAt/expiresAt — expiry mirrors PLAN_TTL_MS (approval.ts:36)
├─ readRoots[]    — absolute; the roots files.ts may serve this seat
├─ writeRoot?     — exactly one absolute candidate root, or absent
└─ protectedPaths[] — absolute; refused even inside a readRoot
```

Role defaults, all fail-closed (no profile ⇒ `researcher` ⇒ no write root):

| role | readRoots | writeRoot | notes |
|---|---|---|---|
| `researcher` | configured source roots | — | draft/review rounds |
| `writer` | configured source roots | `workRoot/<runId>/<seatId>` | the `propose` stage |
| `reviewer` | source roots + all candidate roots | — | selection round |
| `integrator` | everything above | — | human applies the winner; no agent role writes the checkout |
| `memory` | brain dir | brain dir, via the lock only | `shareRun` |

Note the deliberate difference from all four drafts: **no role, including
`integrator`, is granted write access to the real checkout.** Every draft gave the
integrator role `writeRoot = real checkout`. The existing design's safety property
(`propose.ts:10-13`, *"Nothing here touches a repository … the round can be run,
read and thrown away"*) is stronger, and weakening it to match a proposal would be
a regression. Applying a winning candidate stays a human act.

---

## 4. The code

Complete and ready to apply. **Not written to the repository.** Paths are relative
to `~\Documents\claudecode\deepseek-harness`.

### NEW — `packages/council/tool-council/src/capability.ts`

```typescript
/**
 * What one seat may see and where it may write, decided before it is launched.
 *
 * The council's containment already works in two places and only two: the host
 * reads files on a seat's behalf (`files.ts`) and writes a seat's proposals into
 * a tree of its own (`writes.ts`). A seat itself holds no handle to either. So
 * an envelope that a seat is expected to honour would be decoration — the seat
 * is a one-shot prompt and cannot be trusted to check anything. This module
 * therefore does not describe what a seat promises. It narrows what the host is
 * willing to do on that seat's behalf, and what argv the seat's child process is
 * launched with, from one profile written once.
 *
 * Fail-closed is the default rather than a setting: a seat with no profile
 * resolves to `researcher`, which has no write root at all.
 *
 * @module @deepseek-ai/dsh-tool-council/src/capability
 */

import { isAbsolute, relative, resolve } from 'node:path'
import { PLAN_TTL_MS } from './approval.ts'
import type { SeatConfig } from './seats.ts'

/** What a seat is doing this round. Fixed set: an open one is not a policy. */
export type SeatRole = 'researcher' | 'writer' | 'reviewer' | 'integrator' | 'memory'

/** The roles, in the order the panel should list them. */
export const SEAT_ROLES: readonly SeatRole[] = ['researcher', 'writer', 'reviewer', 'integrator', 'memory']

/** The role a seat gets when nothing says otherwise: read, never write. */
export const DEFAULT_ROLE: SeatRole = 'researcher'

/**
 * Paths no role may read or write, whatever the roots say.
 *
 * Relative to a resolved root at check time, so this list stays portable across
 * the two machines that share this configuration.
 */
export const ALWAYS_PROTECTED: readonly string[] = [
  '.git',
  '.env',
  'node_modules/.cache',
]

/** One seat's grant for one run. */
export interface CapabilityEnvelope {
  /** The run this grant belongs to. */
  readonly runId: string
  /** The approved plan it hangs off. Empty when nothing has been approved. */
  readonly planId: string
  readonly seatId: string
  readonly role: SeatRole
  readonly issuedAt: number
  /** Epoch ms after which the host refuses to act on this envelope. */
  readonly expiresAt: number
  /** Absolute roots the host will read files from for this seat. */
  readonly readRoots: readonly string[]
  /** The one absolute root the host will write this seat's proposals under. */
  readonly writeRoot?: string | undefined
  /** Absolute paths refused even when they sit inside a read root. */
  readonly protectedPaths: readonly string[]
}

/** What a caller knows before an envelope exists. */
export interface CapabilityRequest {
  readonly runId: string
  readonly planId?: string | undefined
  readonly seatId: string
  readonly role?: SeatRole | undefined
  /** Source roots the run was configured with, already absolute. */
  readonly sourceRoots: readonly string[]
  /** Directory seat trees are created under, from `workRoot`. */
  readonly workRoot: string
  /** Candidate roots of other seats, for a reviewer. */
  readonly candidateRoots?: readonly string[] | undefined
  /** Clock, injectable so expiry is testable. */
  readonly now?: number | undefined
}

/**
 * Mint the grant for one seat.
 *
 * A write root is issued only to a `writer`, and only when a plan id is present:
 * an unapproved run has nothing to bind a write to, so it gets none rather than
 * getting one that a later check has to remember to refuse.
 * @param request - what is known about the seat and the run.
 * @returns the envelope, which is the whole of that seat's grant.
 */
export function mintEnvelope(request: CapabilityRequest): CapabilityEnvelope {
  const now = request.now ?? Date.now()
  const role = request.role ?? DEFAULT_ROLE
  const planId = request.planId ?? ''
  const source = request.sourceRoots.map(root => resolve(root))
  const readRoots = role === 'reviewer'
    ? [...source, ...(request.candidateRoots ?? []).map(root => resolve(root))]
    : source
  const writable = role === 'writer' && planId !== ''
    ? resolve(request.workRoot, request.runId, request.seatId)
    : undefined
  return {
    runId: request.runId,
    planId,
    seatId: request.seatId,
    role,
    issuedAt: now,
    expiresAt: now + PLAN_TTL_MS,
    readRoots,
    ...writable === undefined ? {} : { writeRoot: writable },
    protectedPaths: source.flatMap(root => ALWAYS_PROTECTED.map(leaf => resolve(root, leaf))),
  }
}

/**
 * Whether a resolved path sits inside a root.
 *
 * Uses `relative` rather than `startsWith` on purpose: `C:\repo-secrets` starts
 * with `C:\repo` and is not inside it. `files.ts` made the same choice for the
 * same reason, and a second implementation that disagreed would be a hole.
 * @param root - absolute root.
 * @param target - absolute candidate.
 * @returns true when target is strictly below root.
 */
export function within(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Why an envelope refused, or undefined when it did not. */
export type Refusal = string | undefined

/**
 * Whether this envelope still grants anything.
 * @param envelope - the grant.
 * @param now - current time in epoch ms.
 * @returns the refusal, or undefined.
 */
export function expired(envelope: CapabilityEnvelope, now: number = Date.now()): Refusal {
  return now > envelope.expiresAt
    ? `the grant for ${envelope.seatId} expired; ask again to get a fresh one`
    : undefined
}

/**
 * Whether the host will read this path for this seat.
 * @param envelope - the grant.
 * @param target - absolute path the host is about to read.
 * @param now - current time in epoch ms.
 * @returns the refusal, or undefined when the read may proceed.
 */
export function refuseRead(envelope: CapabilityEnvelope, target: string, now?: number): Refusal {
  const stale = expired(envelope, now)
  if (stale !== undefined) return stale
  const absolute = resolve(target)
  for (const guarded of envelope.protectedPaths) {
    if (absolute === resolve(guarded) || within(guarded, absolute)) {
      return `${target} — protected, and no role reads it`
    }
  }
  return envelope.readRoots.some(root => within(root, absolute))
    ? undefined
    : `${target} — outside the directories ${envelope.seatId} may be shown`
}

/**
 * Whether the host will write this path on this seat's behalf.
 * @param envelope - the grant.
 * @param target - absolute destination.
 * @param now - current time in epoch ms.
 * @returns the refusal, or undefined when the write may proceed.
 */
export function refuseWrite(envelope: CapabilityEnvelope, target: string, now?: number): Refusal {
  const stale = expired(envelope, now)
  if (stale !== undefined) return stale
  const root = envelope.writeRoot
  if (root === undefined) {
    return `${envelope.seatId} holds the ${envelope.role} role, which writes nothing`
  }
  return within(root, resolve(target))
    ? undefined
    : `${target} — outside ${envelope.seatId}'s own tree`
}

/**
 * Narrow a seat's child process to match its grant.
 *
 * This is the other half of enforcement and the half every council proposal
 * missed. A CLI seat spawns an agent that has its own permissions and does not
 * read DSH's environment: handing it an envelope changes nothing, while handing
 * it a shorter `--allowedTools` and a pinned `cwd` changes everything. An
 * OpenRouter seat has no process, so it is returned unchanged — its whole
 * boundary is already the host-side broker.
 * @param seat - the configured seat.
 * @param envelope - that seat's grant.
 * @param neutralCwd - the empty directory a seat with no write root runs in.
 * @returns a seat config that cannot exceed the grant.
 */
export function confineSeat(
  seat: SeatConfig,
  envelope: CapabilityEnvelope,
  neutralCwd: string,
): SeatConfig {
  if (seat.transport !== 'cli') return seat
  // A seat's own cwd is never trusted over the grant: inheriting the host's
  // working directory is how a seat ends up reading whatever repository DSH
  // happened to be launched in.
  const cwd = envelope.writeRoot ?? neutralCwd
  const base = seat.command.replace(/\.(exe|cmd|bat|ps1)$/i, '')
  if (base === 'claude') {
    return { ...seat, cwd, args: withAllowedTools(seat.args ?? [], 'WebSearch,WebFetch,Read,Glob,Grep') }
  }
  if (base === 'codex') {
    // `codex exec` reads its sandbox from ~/.codex/config.toml when nothing is
    // passed, which DSH neither writes nor reads. Stating it on argv is the only
    // way the grant reaches the child.
    return { ...seat, cwd, args: withCodexSandbox(seat.args ?? []) }
  }
  return { ...seat, cwd }
}

/**
 * Force one `--allowedTools` value, replacing any the seat carried.
 * @param args - the seat's argv.
 * @param tools - the allow-list to impose.
 * @returns argv with exactly one allow-list, the imposed one.
 */
function withAllowedTools(args: readonly string[], tools: string): readonly string[] {
  const out: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--allowedTools') {
      index += 1
      continue
    }
    out.push(args[index] ?? '')
  }
  return ['--allowedTools', tools, ...out]
}

/**
 * Force `codex exec` into a read-only sandbox with no approvals to answer.
 *
 * An unattended child cannot answer a prompt, so `never` is the only honest
 * approval policy: the alternative is a worker that hangs until its timeout and
 * reports nothing.
 * @param args - the seat's argv.
 * @returns argv carrying exactly one sandbox and approval setting.
 */
function withCodexSandbox(args: readonly string[]): readonly string[] {
  const dropped = new Set(['--sandbox', '-s', '--ask-for-approval', '-a'])
  const out: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (dropped.has(arg)) {
      index += 1
      continue
    }
    out.push(arg)
  }
  const head = out[0] === 'exec' ? out.slice(1) : out
  return ['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never', ...head]
}
```

### NEW — `packages/council/tool-council/src/brain-lock.ts`

```typescript
/**
 * One writer at a time on the shared note.
 *
 * `shareRun` reads `dsh-runs.md`, appends a line, and writes the whole file
 * back. Two runs finishing together lose one line, and so does a run that lands
 * while `.sync/brain-sync.mjs` is rewriting the same note. The id check in
 * `brain.ts` makes the append idempotent, which is not the same as atomic:
 * idempotence stops a line appearing twice, it does not stop one disappearing.
 *
 * The lock is a directory rather than a file because `mkdir` is atomic on NTFS
 * and on every filesystem the brain is synced across, while "check then create"
 * is not. A stale lock — a process killed mid-write — is broken after
 * `STALE_MS` rather than deadlocking the machine forever.
 *
 * @module @deepseek-ai/dsh-tool-council/src/brain-lock
 */

import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Lock directory name, beside the note it guards. */
export const LOCK_DIR = '.dsh-runs.lock'

/** A lock older than this belonged to a process that died holding it. */
export const STALE_MS = 30_000

/** How long to keep retrying before giving up on the append. */
export const WAIT_MS = 3_000

/** How long to sleep between attempts, busily — the hold is milliseconds long. */
const RETRY_MS = 25

/** Block this thread briefly. Deliberate: the critical section is a file append. */
function pause(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) { /* spin */ }
}

/**
 * Run `body` with nobody else writing the note.
 *
 * Returns false rather than throwing when the lock cannot be taken: a finished
 * council run must not fail because a note was busy. The run record on disk is
 * the durable copy, and `brain-sync.mjs` collects it on the next pass.
 * @param brainDir - the shared brain directory.
 * @param body - the read-modify-write to perform while holding the lock.
 * @param now - clock, injectable for tests.
 * @returns whether the body ran.
 */
export function withNoteLock(brainDir: string, body: () => void, now: () => number = Date.now): boolean {
  const lock = join(brainDir, LOCK_DIR)
  const deadline = now() + WAIT_MS
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch {
      let age = 0
      try {
        age = now() - statSync(lock).mtimeMs
      } catch {
        // It vanished between the failed mkdir and the stat: try again at once.
        continue
      }
      if (age > STALE_MS) {
        try {
          rmSync(lock, { recursive: true, force: true })
          continue
        } catch {
          return false
        }
      }
      if (now() >= deadline) return false
      pause(RETRY_MS)
    }
  }
  try {
    try {
      writeFileSync(join(lock, 'owner'), String(process.pid))
    } catch {
      // The marker is for a human reading a stuck lock, not for correctness.
    }
    body()
    return true
  } finally {
    try {
      rmSync(lock, { recursive: true, force: true })
    } catch {
      // Left behind; the next writer breaks it after STALE_MS.
    }
  }
}
```

### CHANGED — `packages/council/tool-council/src/brain.ts`

Exact unified diff against the current tree:

```diff
--- a/packages/council/tool-council/src/brain.ts
+++ b/packages/council/tool-council/src/brain.ts
@@ -18,6 +18,7 @@
 import { spawn } from 'node:child_process'
 import { existsSync, readFileSync, writeFileSync } from 'node:fs'
 import { homedir, hostname } from 'node:os'
 import { join } from 'node:path'
+import { withNoteLock } from './brain-lock.ts'
 
 /** The note every machine's runs are listed in. */
 export const RUNS_NOTE = 'dsh-runs.md'
@@ -134,21 +135,26 @@
 export function shareRun(record: ShareableRun, options: ShareRunOptions = {}): boolean {
   const dir = brainDirectory(options.brainDir)
   if (dir === undefined) return false
   const path = join(dir, RUNS_NOTE)
   if (!existsSync(path)) return false
   const key = `dsh-run id=${record.id}`
-  let text: string
-  try {
-    text = readFileSync(path, 'utf8')
-  } catch {
-    return false
-  }
-  if (text.includes(key)) return false
-  try {
-    writeFileSync(path, `${text.replace(/\s*$/, '')}\n${runLine(record, options.machine ?? hostname())}\n`)
-  } catch {
-    // A run that answered must not fail because the shared note is read-only.
-    return false
-  }
+  // The read and the write are one critical section. Checking for the id and
+  // then appending are only safe together: between them another writer can
+  // append a line this one is about to overwrite.
+  let appended = false
+  const held = withNoteLock(dir, () => {
+    let text: string
+    try {
+      text = readFileSync(path, 'utf8')
+    } catch {
+      return
+    }
+    if (text.includes(key)) return
+    try {
+      writeFileSync(path, `${text.replace(/\s*$/, '')}\n${runLine(record, options.machine ?? hostname())}\n`)
+      appended = true
+    } catch {
+      // A run that answered must not fail because the note is read-only.
+    }
+  })
+  if (!held || !appended) return false
   if (options.sync !== false) {
```

### NEW — `packages/council/tool-council/tests/capability.spec.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { PLAN_TTL_MS } from '../src/approval.ts'
import type { SeatConfig } from '../src/seats.ts'
import {
  DEFAULT_ROLE,
  confineSeat,
  expired,
  mintEnvelope,
  refuseRead,
  refuseWrite,
  within,
} from '../src/capability.ts'

const SOURCE = resolve('/repo')
const WORK = resolve('/work')
const NEUTRAL = resolve('/neutral')

/** Mint against a pinned clock, so expiry is the test's choice not the wall's. */
function mint(over: Partial<Parameters<typeof mintEnvelope>[0]> = {}) {
  return mintEnvelope({
    runId: 'run-1',
    planId: 'plan-1',
    seatId: 'kimi',
    sourceRoots: [SOURCE],
    workRoot: WORK,
    now: 1_000,
    ...over,
  })
}

describe('within', () => {
  it('accepts a path below the root', () => {
    expect(within(SOURCE, join(SOURCE, 'src', 'a.ts'))).toBe(true)
  })

  it('rejects the root itself', () => {
    expect(within(SOURCE, SOURCE)).toBe(false)
  })

  it('rejects a sibling that merely shares the prefix', () => {
    expect(within(SOURCE, resolve('/repo-secrets/key.pem'))).toBe(false)
  })

  it('rejects an escape through ..', () => {
    expect(within(SOURCE, join(SOURCE, '..', 'elsewhere'))).toBe(false)
  })
})

describe('mintEnvelope', () => {
  it('defaults to the role that writes nothing', () => {
    const envelope = mint({ role: undefined })
    expect(envelope.role).toBe(DEFAULT_ROLE)
    expect(envelope.writeRoot).toBeUndefined()
  })

  it('gives a writer its own tree under the run', () => {
    expect(mint({ role: 'writer' }).writeRoot).toBe(join(WORK, 'run-1', 'kimi'))
  })

  it('withholds a write root when no plan was approved', () => {
    expect(mint({ role: 'writer', planId: '' }).writeRoot).toBeUndefined()
  })

  it('adds the other seats trees for a reviewer', () => {
    const other = join(WORK, 'run-1', 'deepseek')
    expect(mint({ role: 'reviewer', candidateRoots: [other] }).readRoots).toContain(other)
  })

  it('expires with the approval gate', () => {
    expect(mint().expiresAt).toBe(1_000 + PLAN_TTL_MS)
  })
})

describe('refuseRead', () => {
  it('allows a file inside a granted root', () => {
    expect(refuseRead(mint(), join(SOURCE, 'src', 'a.ts'), 2_000)).toBeUndefined()
  })

  it('refuses a file outside every root', () => {
    expect(refuseRead(mint(), resolve('/elsewhere/a.ts'), 2_000)).toMatch(/outside/)
  })

  it('refuses .git even inside a granted root', () => {
    expect(refuseRead(mint(), join(SOURCE, '.git', 'config'), 2_000)).toMatch(/protected/)
  })

  it('refuses .env even inside a granted root', () => {
    expect(refuseRead(mint(), join(SOURCE, '.env'), 2_000)).toMatch(/protected/)
  })

  it('refuses everything once the grant has expired', () => {
    expect(refuseRead(mint(), join(SOURCE, 'a.ts'), 1_000 + PLAN_TTL_MS + 1)).toMatch(/expired/)
  })
})

describe('refuseWrite', () => {
  it('allows a writer inside its own tree', () => {
    const envelope = mint({ role: 'writer' })
    expect(refuseWrite(envelope, join(WORK, 'run-1', 'kimi', 'src', 'a.ts'), 2_000)).toBeUndefined()
  })

  it('refuses a writer reaching another seats tree', () => {
    const envelope = mint({ role: 'writer' })
    expect(refuseWrite(envelope, join(WORK, 'run-1', 'deepseek', 'a.ts'), 2_000)).toMatch(/own tree/)
  })

  it('refuses a writer reaching the real checkout', () => {
    const envelope = mint({ role: 'writer' })
    expect(refuseWrite(envelope, join(SOURCE, 'src', 'a.ts'), 2_000)).toMatch(/own tree/)
  })

  it('refuses every non-writer role by name', () => {
    expect(refuseWrite(mint({ role: 'reviewer' }), join(WORK, 'x'), 2_000)).toMatch(/reviewer/)
    expect(refuseWrite(mint({ role: 'integrator' }), join(SOURCE, 'x'), 2_000)).toMatch(/integrator/)
  })
})

describe('expired', () => {
  it('is undefined inside the window', () => {
    expect(expired(mint(), 2_000)).toBeUndefined()
  })
})

describe('confineSeat', () => {
  const claude: SeatConfig = {
    id: 'claude', name: 'Claude', transport: 'cli', command: 'claude',
    args: ['--allowedTools', 'Bash,Write,Edit', '-p', '{prompt}'], enabled: true,
  }
  const codex: SeatConfig = {
    id: 'openai', name: 'OpenAI', transport: 'cli', command: 'codex',
    args: ['exec', '{prompt}'], enabled: true,
  }
  const hosted: SeatConfig = {
    id: 'kimi', name: 'Kimi', transport: 'openrouter', model: 'moonshotai/kimi-k2', enabled: true,
  }

  it('replaces a seats own tool allow-list rather than appending to it', () => {
    const args = confineSeat(claude, mint(), NEUTRAL).args ?? []
    expect(args.filter(one => one === '--allowedTools')).toHaveLength(1)
    expect(args).not.toContain('Bash,Write,Edit')
    expect(args[1]).toBe('WebSearch,WebFetch,Read,Glob,Grep')
  })

  it('pins a reader to the neutral directory, never the host cwd', () => {
    expect(confineSeat(claude, mint(), NEUTRAL).cwd).toBe(NEUTRAL)
  })

  it('pins a writer to its own tree', () => {
    expect(confineSeat(claude, mint({ role: 'writer' }), NEUTRAL).cwd).toBe(join(WORK, 'run-1', 'kimi'))
  })

  it('states the codex sandbox on argv instead of leaving it to config.toml', () => {
    const args = confineSeat(codex, mint(), NEUTRAL).args ?? []
    expect(args.slice(0, 5)).toEqual(['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never'])
    expect(args).toContain('{prompt}')
  })

  it('gives codex somewhere to run other than whatever repo dsh was launched in', () => {
    expect(codex.cwd).toBeUndefined()
    expect(confineSeat(codex, mint(), NEUTRAL).cwd).toBe(NEUTRAL)
  })

  it('leaves a hosted seat alone, since it has no process to confine', () => {
    expect(confineSeat(hosted, mint(), NEUTRAL)).toBe(hosted)
  })
})
```

### NEW — `packages/council/tool-council/tests/brain-lock.spec.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOCK_DIR, STALE_MS, withNoteLock } from '../src/brain-lock.ts'

/** A throwaway brain directory; the lock is a real directory, so this needs disk. */
function brain(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-brain-'))
}

describe('withNoteLock', () => {
  it('runs the body and releases the lock', () => {
    const dir = brain()
    try {
      let ran = false
      expect(withNoteLock(dir, () => { ran = true })).toBe(true)
      expect(ran).toBe(true)
      expect(existsSync(join(dir, LOCK_DIR))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('releases the lock even when the body throws', () => {
    const dir = brain()
    try {
      expect(() => withNoteLock(dir, () => { throw new Error('boom') })).toThrow('boom')
      expect(existsSync(join(dir, LOCK_DIR))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses rather than throwing when another writer holds it', () => {
    const dir = brain()
    try {
      mkdirSync(join(dir, LOCK_DIR))
      let ran = false
      // A clock already past the wait, so the test does not spin for 3s.
      expect(withNoteLock(dir, () => { ran = true }, () => Date.now() + 10_000)).toBe(false)
      expect(ran).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('breaks a lock left by a process that died holding it', () => {
    const dir = brain()
    try {
      mkdirSync(join(dir, LOCK_DIR))
      let ran = false
      expect(withNoteLock(dir, () => { ran = true }, () => Date.now() + STALE_MS + 1_000)).toBe(true)
      expect(ran).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

### Wiring, once the two modules exist

These are the call sites that consume the above. They are listed rather than
diffed because each depends on which questions in §7 the user answers.

- `index.ts:1141`, `:1408`, `:1677`, `:1739`, `:1826`, `:2116` — each currently passes
  `parseRoots(config.fileRoots)` to a round. Each becomes `mintEnvelope(...)` per
  seat, with `envelope.readRoots` passed instead.
- `propose.ts:204` — `applyWrites(options.writes, seatRoot, options.fileRoots, …)`
  becomes a `refuseWrite` check against the seat's envelope before the existing
  containment checks, not instead of them.
- `seats.ts:askSeat` call sites — wrap the `SeatConfig` in `confineSeat(seat,
  envelope, join(homedir(), '.dsh', 'seat-cwd'))` before spawning.
- A new settings key `seatRoles?: string` (comma-separated `seatId:role` pairs) at
  `index.ts:~478`, beside `fileRoots`. Flat string for the reason `files.ts:79-84`
  gives: a nested schemastery default materialises an empty object and fails its
  own required fields at boot.

---

## 5. The fastest collision-free swarm path

Three waves. Write sets are disjoint within each wave; every edge is a real
consumption, not an ordering preference.

**Wave 1 — two tasks in parallel, no dependencies**

| | `t1-capability` | `t2-brain-lock` |
|---|---|---|
| goal | the grant type, role defaults, refusals, seat confinement | serialize the shared-note append |
| applies | `src/capability.ts`, `tests/capability.spec.ts` | `src/brain-lock.ts`, `tests/brain-lock.spec.ts` |
| depends on | — | — |
| allowed files | those two, exactly | those two, exactly |
| forbidden files | everything else, `.git`, `settings.yaml` included | same |
| acceptance | `npx vitest run packages/council/tool-council/tests/capability.spec.ts` | `npx vitest run packages/council/tool-council/tests/brain-lock.spec.ts` |
| worker class | `fastest` | `fastest` |
| integration owner | human, applying a picked candidate | same |

**Wave 2 — one task, consumes `t2`**

`t3-brain-wiring` — apply the `brain.ts` diff. Depends on `t2-brain-lock` because
the diff imports `./brain-lock.ts` and does not typecheck without it. Allowed:
`src/brain.ts` only. Forbidden: everything else, `brain-lock.ts` included — `t3`
must not edit what `t2` wrote. Acceptance:
`npx vitest run packages/council/tool-council/tests/brain-runs.spec.ts`.

**Wave 3 — one task, consumes `t1`**

`t4-capability-wiring` — the §4 wiring list. Depends on `t1-capability` for the
same reason. Allowed: `src/index.ts`, `src/propose.ts`, `src/seats.ts`. Forbidden:
everything else. Acceptance: `npm run typecheck` then
`npx vitest run packages/council/tool-council`.

**Critical path:** `t1 → t4`. Wave 1 is bounded by whichever of `t1`/`t2` is
slower, and `t1` is the larger file, so the whole build is `t1 + t4`; `t2 → t3`
runs entirely inside that shadow and costs no wall-clock. Nothing else can be
parallelised without two tasks writing `index.ts`.

**One correction the swarm path forces.** `t4` is a three-file edit against a
107k-character `index.ts`. `writes.ts:32` caps one proposed file at
`MAX_WRITE_CHARS = 20_000` and refuses rather than truncates. **A seat cannot
propose `index.ts`.** `t4` is therefore not swarmable as written, and must either
be done by hand or restructured so the new call-site logic lives in
`capability.ts` and `index.ts` changes by a handful of lines. This is question 3.

---

## 6. The saved run, presented for approval

**Not saved.** The spec mandates `stages: swarm,review`, and §7 question 1 explains
why that is very likely wrong for this work. Both versions are given.

### 6a. Exactly as the specification mandates

```yaml
id: dsh/agent-permissions-build
name: Agent permissions build
stages: swarm,review
mode: fastest
autoAdvance: false
query: >
  Build the DSH granular agent permission layer. The authoritative code and build
  DAG are the adjudicated verdict recorded against council run
  ~/.dsh/council-runs/9df149a7-f7fc-4bc2-966c-e9e7e27210a2.json — treat that record
  as the specification and do not redesign it.

  Waves, in order. Wave 1 in parallel: t1-capability writes
  packages/council/tool-council/src/capability.ts and
  packages/council/tool-council/tests/capability.spec.ts and touches nothing else;
  t2-brain-lock writes packages/council/tool-council/src/brain-lock.ts and
  packages/council/tool-council/tests/brain-lock.spec.ts and touches nothing else.
  Wave 2: t3-brain-wiring applies the brain.ts diff, consuming t2, and touches only
  packages/council/tool-council/src/brain.ts. Wave 3: t4-capability-wiring applies
  the call-site changes, consuming t1, and touches only src/index.ts, src/propose.ts
  and src/seats.ts. No two tasks write the same file.

  Acceptance per task is the vitest command named in the record, run from the repo
  root as npx vitest run <spec path>. Run npm run typecheck before declaring t4 done.

  No pushes. Commit locally and append a request to
  ~/.claude/shared-brain/push-requests.md for the gatekeeper; do not run git push.
  Do not modify ~/.dsh/settings.yaml. Do not touch .git, .env or any repository
  other than deepseek-harness. Every agent names its actual model in anything the
  user reads.
```

The equivalent `save_pipeline_preset` argument object, which is what would actually
be called:

```json
{
  "id": "dsh/agent-permissions-build",
  "name": "Agent permissions build",
  "stages": "swarm,review",
  "mode": "fastest",
  "autoAdvance": false,
  "query": "<the query above, verbatim>"
}
```

Verified against the real schema: `presets.ts:45` `PRESET_ID` accepts
`dsh/agent-permissions-build`; `presets.ts:56` `MAX_QUERY` is 64,000 and this query
is ~1.6k; `index.ts:445-450` accepts exactly `mode | name | query | autoAdvance |
stages`, with `mode` constrained to `council | economy | fastest`. It will save.

### 6b. What I would save instead

Identical but for one line:

```yaml
stages: council,propose,swarm,review
```

Because `propose` is the only stage in this harness in which a seat writes a file.
See question 1.

---

## 7. Questions that must be answered before any of this is applied

**1. `swarm,review` cannot build this. Change the stages, or change the plan?**
`swarm.ts:16-22` states that swarm workers are seats, not subagents: *"a unit's
worker reads, searches and reports; it does not hold a session and it writes
nothing unless the seat's own argv lets it."* The harness's own `pipeline` tool
description (`index.ts:1514`) says *"For work that has to produce CODE, pass stages
as `council,propose,swarm,review`."* A `swarm,review` run will produce reports
about the code, not the code. The spec's mandated shape appears to predate that
knowledge.
→ **Recommendation: `council,propose,swarm,review` (preset 6b).** This is the
single highest-consequence question here.

**2. Am I right that no agent role may write the real checkout?**
All four council drafts gave an `integrator` role write access to the live
repository. The existing design refuses that to everyone (`propose.ts:10-13`,
`writes.ts:15-19`), and I kept the refusal. It means applying a winning candidate
stays something you do.
→ **Recommendation: keep the refusal.** It costs one manual copy per accepted
candidate and removes the entire class of "an agent wrote the wrong repo".

**3. `t4` edits a 107k-character `index.ts`, which no seat can propose.**
`MAX_WRITE_CHARS = 20_000` per file (`writes.ts:32`), refused rather than
truncated. Options: (a) you or I apply `t4` by hand after the swarm lands `t1`–`t3`;
(b) restructure so `index.ts` changes by ~6 lines and the logic sits in
`capability.ts`; (c) raise the cap.
→ **Recommendation: (b), falling back to (a).** Raising the cap makes every future
seat able to rewrite huge files, which is a different decision wearing this one's
clothes.

**4. Should the `openai` (Codex) seat be pinned now, independently of all this?**
`seats.ts:236-248` sets no `cwd`, so that seat inherits whatever directory DSH was
launched in and reads that project's `AGENTS.md`; its sandbox comes from
`~/.codex/config.toml`, which DSH neither writes nor reads. `claude` and
`free-claude` are both pinned to `~/.dsh/seat-cwd` with a comment explaining why.
The seat is currently `enabled: false` in your settings, so nothing is leaking
today.
→ **Recommendation: yes, as a standalone three-line fix before the rest.** It is
the only live containment hole and it does not need the new architecture.

**5. Per-seat roles, or per-stage roles?**
I designed `seatRoles` as a settings key mapping seat id → role, which is static.
The alternative is deriving the role from the stage (`propose` ⇒ writer, selection
⇒ reviewer), which is dynamic and needs no configuration.
→ **Recommendation: derive from stage, and let `seatRoles` only *narrow* it.** A
static map means a seat you meant to keep read-only becomes a writer the moment
you run a `propose` stage.

**6. Interactive auth during an unattended run — out of scope?**
`agy-pro` raised the only genuinely unresolved item in the run: an unattended child
that hits an OAuth prompt or `npm login` has no way to answer. Your `claude` seat
died in this very run with *"OAuth session expired and could not be refreshed"*.
→ **Recommendation: out of scope for the permission layer, tracked separately.**
A seat with a dead credential should fail loudly, which it did. Proxying a login is
a different and much more dangerous feature.

**7. The vote parser maps a prose name onto the wrong seat id — file it?**
Two reviewers who named "Free Claude" were recorded as `vote=claude`, and `claude`
is a different seat that failed. Every split vote in this harness is suspect until
that is fixed. It is unrelated to the permission work.
→ **Recommendation: log it in the shared brain now, fix it separately.**

**8. Nothing in this file has been applied. Which parts do you want applied, by
whom, and when?**
No file was written outside this scratchpad. No settings key touched. No preset
saved. No commit, no push, no build, no spend.
