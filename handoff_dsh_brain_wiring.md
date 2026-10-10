---
name: handoff_dsh_brain_wiring
description: Handoff (2026-09-11, Claude Opus 5 to Codex) - the shared brain now reaches DSH both ways; what is proven, what is left, and how the vMixer run becomes visible everywhere
metadata:
  type: project
---

Handoff written 2026-09-11 by Claude Opus 5 (session claudecode-91 on vmixlaptop2x6),
out of quota. Codex picks this up. Nothing here is pushed.

## What now exists

**Brain into DSH.** `.sync/brain-sync.mjs` renders `~/.dsh/AGENTS.md` between
`SHARED-BRAIN` markers: store path, how to read and sign the log, the index, and
`~/.claude/CLAUDE.md` verbatim. DSH's `agent-instructions` plugin loads it into
every agent session. `install` also patches `~/.dsh/launch-dsh.cmd` with one
`brain-sync.mjs dsh` line, and `context` self-installs, so any machine picks up
newer tooling at its next session start or DSH launch with no join to rerun.

**DSH into the brain.** Two union-merged notes, both appended and never edited:

- `dsh-runs.md` - one line per council/pipeline/swarm run, from every machine.
  The full record stays where it was made (`~/.dsh/council-runs/<id>.json`).
- `dsh-memory.md` - one line per remembered fact, from every machine.

Three writers keep them current:

1. `collectDsh` in `.sync/brain-sync.mjs`, run from `install` (so: every session
   start and every DSH launch). It reads `$DSH_HOME/council-runs/*.json` and
   `$DSH_HOME/memory/digest.md`, so runs made **before** a machine joined the
   brain are picked up. This is the path that needs no harness build.
2. `shareRun` in `packages/council/tool-council/src/brain.ts`, called by
   `saveRun`, so a run lands in the note as it is filed, plus a throttled
   background `brain-sync start` (once a minute at most).
3. `shareFacts` in `packages/memory/agent-memory/src/brain.ts`, called on every
   digest refresh. It also renders the other machines' facts into the digest
   under `## remembered on other machines`, which is what seats read.

Lines from writer 1 and writers 2-3 are byte-identical for the same run or fact,
so a run appears once. Every line is written with `~` for home folders, because
the brain's pre-push gate refuses a note naming a user folder (this was a real
defect: a collected fact carried `~\...` before it was fixed).

Seats also get the brain index ahead of the memory digest through
`resolveMemory` (`council-context.md`), from commit `e78282a8`.

## Proven

- Brain self-test: **120/120** (`node ~/.claude/shared-brain/.sync/selftest.mjs`),
  including the DSH sections: AGENTS.md render, launcher patch, collection,
  dedupe, `~` rewriting, and a real union merge of two machines' run lines.
- DSH's own loader includes `~/.dsh/AGENTS.md` for the harness root, a nested
  package, billboard-platform and `~/Documents/claudecode`; 18-41 KB of the
  64 KiB budget, nothing truncated.
- Real collection on this machine: 5 runs and 8 facts into the two notes.
- Harness: 27 tests in the two new specs, 416 in the council suite before the
  last commit, `tsc -b` clean, both libs rebuilt with tsdown `-F`, and the
  compiled libs carry the change.
- Commits (local only): `e78282a8` seats get the brain index, `c5a54779`
  runs and facts cross machines.

## Left to do

1. **Re-run the suites after `c5a54779`**, which landed after the last full run:
   `pnpm exec vitest run packages/council/tool-council/tests packages/memory/agent-memory/tests`.
2. **Notes not yet written**: the runs/facts half of
   [[shared-memory-protocol]] (it documents only the AGENTS.md half),
   a line in [[dsh-council-plugin]], and
   [[project_clone_migration_vmixer]].
3. **DSH restart**: the host running since 2026-09-10 23:54 still uses the old
   libs. New DSH sessions already load `~/.dsh/AGENTS.md`; the run and fact
   sharing needs the next launch.
4. **Pushes, all held for the user's session-ending cue** (never push on your
   own): the brain, and `deepseek-harness` 5 commits ahead, including another
   session's Antigravity work. File requests in `push-requests.md`.

## The vMixer run the user asked about

Codex saved a run on VMIXER2O2. vMixer has **not joined the brain**, so nothing
of it can travel yet. The chain, in order:

1. Push the brain and `deepseek-harness` from this machine (user's cue).
2. On vMixer: `G:\clone\JOIN-BRAIN.cmd`, or `G:\clone\RUN-ALL.cmd`, which now
   has it as step 8b. The USB drive is on ndi2 as `D:` and carries both.
3. vMixer's next session start or DSH launch runs `collectDsh`, which finds
   `~/.dsh/council-runs/*.json` - including Codex's run, made before the join -
   and appends its line to `dsh-runs.md`.
4. Push the brain from vMixer with the push cue in a Claude Code session there.
5. Any machine's next session start merges it; the line is then in every
   machine's `dsh-runs.md`, and the index points at it.

Nothing in that chain needs the harness build on vMixer. The council-side
writers (2 and 3 above) need `deepseek-harness` pulled and rebuilt there.

**Why:** the user wants one memory that is the same on every machine they clone,
with DSH writing into it as it works rather than at the end. See
[[shared-memory-protocol]], [[feedback_one_click_bundling]].

## GPT-6 continuation — 2026-09-11

- Completed the post-c5a54779 rerun: 29 test files, 429 tests passed, exit 0. pnpm.cmd exec could not resolve vitest in this shell; invoking node node_modules/vitest/vitest.mjs with the same suite arguments passed.
- Brain self-test rerun: 120/120 passed, exit 0.
- Completed the three outstanding memory-note additions: shared-memory-protocol, dsh-council-plugin and project_clone_migration_vmixer.
- Verified the compiled council library includes shareRun and council-context; the memory library includes shareFacts and the other-machine digest section.
- DSH restart remains outstanding. fcc-status.json identified host PID 20024, started 2026-09-11 16:47:50 PDT; libraries were rebuilt at 17:09:14 and 17:09:43 PDT. The old host date above is stale, but the current host still predates these builds. Windows denied CIM process inspection in this sandbox; no host was stopped.
- No push performed. The harness remains five commits ahead of its local upstream reference, with a clean checkout. vMixer join and propagation remain unverified.

GPT-6 finalisation blocker: Git could not create .git/index.lock (Permission denied), including after an explicit write grant for that .git directory and an unchanged retry. Note edits are saved but uncommitted. No new queue entries were filed because the brain changes are not committed. The five existing harness commits still need the held gatekeeper handoff. DSH restart and vMixer propagation remain outstanding.
