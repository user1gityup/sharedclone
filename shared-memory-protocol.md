---
name: shared-memory-protocol
description: "One memory store above all projects, shared by Claude Code and Codex: where it really lives, how the junctions work, and who writes what"
metadata:
  node_type: memory
  type: project
---

Codex CLI was connected on 2026-09-05 and now shares this memory with Claude
Code. The store is not owned by either agent and is not keyed to a project.

**Real path:** `~/.claude/shared-brain/`. Everything else is a
pointer to it.

Claude Code keys its memory directory by project path, which used to mean one
isolated store per repository — notes written while working on the harness were
invisible while working on the billboard platform. Every one of those paths,
`~/.claude/projects/<key>/memory`, is now a Windows junction to the
brain, so the built-in memory tooling reads and writes the shared files without
knowing anything changed. The `SessionStart` hook
`~/.claude/hooks/dsh-memory-index.mjs` creates that junction for the current
directory when it is missing, so a brand-new project directory joins the brain
on its first session instead of starting an isolated store. The hook then
injects `MEMORY.md` — the index only, never the notes.

The pre-migration copies are kept at `memory.pre-shared-brain` beside the two
junctions that had content, under the `...-green-energy-platform` and
`...-Documents-claudecode` project keys.

**Codex** reaches the same files through `~/.codex/AGENTS.md`, which Codex loads
into every session the way Claude Code loads `~/.claude/CLAUDE.md`.

**DSH** (2026-09-11) has no session-start hook, so the brain reaches it through
files. `.sync/brain-sync.mjs` renders `~/.dsh/AGENTS.md`: the store path, how to
read and sign the log, the index, and `~/.claude/CLAUDE.md` verbatim, between
`SHARED-BRAIN` markers (text outside them is kept). DSH's `agent-instructions`
plugin loads that file into every agent session. Measured with its own loader:
present in the baseline for the harness root, a nested package,
billboard-platform and `~/Documents/claudecode`, 18-41 KB of the 64 KiB budget,
nothing truncated. It is re-rendered at every Claude Code session start and at
every DSH launch - `install` adds one line to `~/.dsh/launch-dsh.cmd` that runs
`brain-sync.mjs dsh` (sync, then render; output discarded; about 2.5 s).
Council seats and swarm workers get the index through the council's
`resolveMemory`: it writes `~/.dsh/memory/council-context.md` (index ahead of
the agent-memory digest) for CLI seats and inlines the same text for hosted
ones. `council.brainIndex: false` in settings turns that off.

**Tooling installs itself.** `context` runs `install` after every sync, so a
hook, gatekeeper or DSH change that arrives through a merge is live at that
machine's next session start or DSH launch, with no join to rerun.

The two files used to carry the same rules typed out twice, which meant a rule
changed in one silently diverged from the other. They no longer do.
`~/.claude/CLAUDE.md` is the single source: `~/.claude/hooks/sync-agent-rules.mjs`
renders it into `AGENTS.md` between `<!-- BEGIN SHARED-RULES -->` and
`<!-- END SHARED-RULES -->`, and the SessionStart hook runs that script at every
Claude Code session, so an edit to CLAUDE.md reaches Codex without anyone
remembering to copy it. Everything outside the markers is Codex's own preamble:
its council seat, how to reach the store without a hook, the note format, and
the approval gate.

An edit made inside Codex's generated block does not survive — it is copied to
`.rules-drift/` in this directory and then reverted, and the session that
reverted it is told so. Change a rule in `CLAUDE.md`, never in `AGENTS.md`.
`node ~/.claude/hooks/sync-agent-rules.mjs --check` reports drift without
writing and exits 1.

**Across machines (2026-09-11).** There is more than one machine now — this one
and the vMixer server it was cloned to — and until today each had its own copy
of the brain with nothing carrying notes between them. The vMixer gatekeeper
closed a push request in vMixer's copy while this machine's copy still said
`open`. The brain is now a git repository with a private remote,
`github.com/user1gityup/shared-brain`, branch `main`. Its root commit is the
brain exactly as the clone bundle packed it (2026-09-09T16:38Z,
`config-claude.tar.gz` sha256 `217a58dd…`), which is what every machine's copy
descends from, so merges are three-way and a note conflicts only when two
machines changed it since the clone.

- **Session start syncs.** The same `dsh-memory-index.mjs` hook runs
  `.sync/brain-sync.mjs context` before it reads the index: rewrite home paths to
  `~`, commit what agents wrote since last time, fetch with a 6-second budget,
  merge. An unreachable remote is reported and the session carries on from the
  local copy. A clean sync adds nothing to the session's context.
- **Home paths are `~`.** Each machine has a different user folder, so notes
  never carry `C:\Users\<name>`. The sync and a pre-commit hook rewrite it for
  every user in `.sync/users.json`. PowerShell cmdlets expand `~`; git, node and
  cmd do not — expand it before handing a path to them. `$env:USERPROFILE` is
  the portable spelling inside a runnable snippet.
  The rewrite cannot tell a path that should follow the reader from one that
  quotes another machine on purpose, so it rewrites both. To record another
  machine's literal folder, name the user instead of writing the path - "the
  ndi2 user folder" - which the rewrite leaves alone.
- **The index, this log and the push queue merge by union**, so two machines
  appending at once both keep their lines, and a push request one machine closed
  stays closed after the merge. `dsh-runs.md` and `dsh-memory.md` merge the same
  way. Deleting a line from a union-merged note is safe **only while another line
  sits between it and the end of the file**: union resurrects a deleted line when
  the deletion and another machine's append fall in the same hunk. Proven on
  2026-09-12 by Claude Opus 5 on vmixer2o2, in a throwaway repo seeded from the
  real file - prune on one branch, append on another, merged clean with no
  resurrection, because a kept line stood between them. A prune that removes the
  LAST line of such a note loses that buffer and has to be retested.
- **A note both machines changed** keeps this machine's version in place and
  commits the other beside it as `.sync-conflicts/<note>.from-remote.md`. Every
  session on every machine is told until someone merges the two, deletes the
  sidecar, and logs it here.
- **Nothing pushes automatically.** The brain goes out with every other repo
  through the gatekeeper; the push cue's scan includes it
  ([[git-push-cue]]). A machine that has not pushed still receives the others'
  notes. Its pre-push hook refuses home paths in notes, credential shapes and
  conflict markers, which is also what lets the PowerShell gatekeeper push it.
- **`push-requests.md` keeps literal paths**, never `~`: a request's heading is
  the repo path both gatekeepers resolve, and it says which machine the commits
  are on. A gatekeeper acts only on requests under its own home folder. File
  requests with the real absolute path and a `Host:` line.
- **Another machine joins** with one double-click: `.sync/JOIN-BRAIN.cmd` (also on
  the clone drive as `\clone\JOIN-BRAIN.cmd`). It backs the local brain up, merges
  it three-way into the shared history, installs the hook and the gatekeeper's
  instructions, runs the self-test, and never pushes.
- **Brain pushes go through the Claude `git-gatekeeper` on every machine** (the push
  cue). The user-operated PowerShell gatekeeper needs a clean tree and a HEAD
  pinned at filing time, and the brain holds neither for long: filing a request
  writes into the brain itself, and agents append to the log all day. It stays
  the route for project repos. The brain's pre-push hook still satisfies it if
  the tree happens to be clean.
  `node .sync/selftest.mjs` proves the whole flow on throwaway directories
  (89 checks, no network, no push).

The tooling lives in the repository, in `.sync/`, so each machine runs the
version that came with its notes. `.rules-drift/` is not synced: it is evidence
for one machine's Codex rule render, not a note.

**`shared-agent-log.md`** is the cross-agent timeline. Append when a unit of
work finishes, when commits land, when a push goes out, or when a council run
decides something. Do not append for reads or for questions answered without
changing anything. Newest entry at the bottom; never rewrite another agent's
entry.

**Why:** the user wants each agent to know what the other is doing, has done,
and what the council decided, rather than re-deriving it or duplicating work —
and wants that knowledge to follow them across projects rather than stopping at
a directory boundary. See [[feedback_shared_workdir_collisions]] for what goes
wrong when two agents share a directory without sharing state.

**How to apply:** read `MEMORY.md` and `shared-agent-log.md` at session start.
Write facts as notes in the brain, one fact per file, and index them under the
heading they belong to. Sign every log entry with the model name — see
[[agents-self-identify-by-model]]. Council decisions belong in the log so the
other agent does not re-run the same deliberation; see [[dsh-council-plugin]].

**DSH writes back (2026-09-11).** The append-only, union-merged notes [[dsh-runs]] and [[dsh-memory]] collect saved runs and remembered facts from every joined machine. The full run records remain in that machine's ~/.dsh/council-runs directory. collectDsh in .sync/brain-sync.mjs collects existing records and digest facts at session start and DSH launch, including records saved before joining; this path needs no harness rebuild. The council's saveRun calls shareRun immediately, and the memory digest refresh calls shareFacts and includes other machines' facts. The immediate writers require the rebuilt libraries loaded by a new DSH host. Writers deduplicate matching records and normalise home paths to ~. Synchronisation never pushes; another machine receives new records after the originating machine pushes and the receiving machine syncs. GPT-6 reran the brain self-test on 2026-09-11: 120/120 passed, exit 0.

**DSH saved runs and credentials travel (2026-09-12).** "Saved runs" in the DSH pipeline panel are `council.pipelinePresets` in `~/.dsh/settings.yaml`, not the council-run records - those were already identical on both machines. `install` (so every session start and every DSH launch) now exchanges both things DSH kept only locally. Saved runs: one file per run at `dsh-presets/<area>/<name>.yaml`, the settings chunk copied line for line, home paths as `~`; a run missing locally is written into settings.yaml (backup `settings.yaml.pre-brain-sync-<stamp>`), and DSH lists it from its next launch. Credentials: `~/.dsh/.credentials.yaml` refs sealed AES-256-GCM into `dsh-credentials.enc`; the key is 64 hex at `~/.claude/brain-secrets.key`, never in the repo, and the clone bundle's `CLONE-KEY.txt` on the Desktop or in `\clone` on any drive is accepted and copied there - one key opens the bundle and the brain. A machine without the key is warned at session start and changes nothing. Rule for both: a value changed here since the last sync is shared, one unchanged here takes the other machine's, one that differs on first contact stays as each machine has it (per-machine state in `~/.dsh/.presets-sync.json` and `.credentials-sync.json`). Nothing is deleted by a sync, so a saved run deleted on one machine returns from the other. Self-test 142/142. - Claude Opus 5 (vmixlaptop2x6)

**One master rule set (2026-09-12).** The user wants one rule set for every agent on every machine - no per-agent or per-machine rules. `~/.claude/CLAUDE.md` is that set, and the brain now carries it at `rules/CLAUDE.md` (`syncRules` in `.sync/brain-sync.mjs`, run first in `install`, so at every Claude Code session start and DSH launch). An edit to CLAUDE.md made on a machine since its last sync is shared into the brain; otherwise the machine takes the brain's copy, including on first contact, and its previous CLAUDE.md is kept as `CLAUDE.md.pre-brain-sync-<stamp>`. After taking it, Codex's `~/.codex/AGENTS.md` is re-rendered at once and DSH's `~/.dsh/AGENTS.md` in the same install. Two machines editing the rules between syncs produce a `.sync-conflicts/` sidecar that sessions are told to reconcile. Per-machine state: `~/.claude/.rules-sync.json`. - Claude Opus 5 (vmixlaptop2x6)

**The fleet (2026-09-16).** `.sync/fleet.mjs`, wired into `install`, `context` and the listener `cycle`, makes a joined machine self-sufficient except for CLI sign-ins. The brain key is found from the local key file, the remote `keys` branch or `CLONE-KEY.txt`, preferring whichever opens `dsh-credentials.enc`. Secret files listed in `fleet/secrets.json` travel sealed with that key in `fleet/secrets/*.enc` (hex only; the sharedclone mirror excludes them). Repositories in `fleet/repos.json` are cloned or fast-forwarded (`follow`) or only reported (`watch`), never forced. DSH rebuilds at launch when its HEAD passed `~/.dsh/.built-commit`. Each host writes `fleet/status/<host>.json`. Sign-ins are done remotely through TeamViewer, installed by dshklv1 `scripts/remote-access/INSTALL-TEAMVIEWER.cmd`. Detail: `.sync/README.md`. Self-test 220/220. - Claude Opus 5 (vmixlaptop2x6)

**Context Compiler (target, 2026-09-17).** Delivery is planned to move from index injection to task-specific compiled context from PM plus the brain ([[dsh-target-architecture]]). Until that is built and verified, the mechanics above stay the delivery path. - Claude Opus 5 (vmixlaptop2x6)
