# Brain sync

The shared brain is one directory of notes that every agent on a machine reads
and writes. With more than one machine there is more than one copy. This
directory makes the brain a git repository with a private remote, so every
machine's copy converges on the same history.

It lives inside the brain so it travels with the notes: a machine that has the
notes has the version of the sync that wrote them.

## What happens at session start

`~/.claude/hooks/dsh-memory-index.mjs` runs `brain-sync.mjs context` before it
reads the index:

1. Rewrite home paths in every note to `~`.
2. Commit whatever the agents wrote since the last commit.
3. Fetch the remote, with a 6-second budget. An unreachable remote is reported
   and the session carries on from this machine's copy.
4. Merge the remote into this machine's history.
5. Tell the session anything it needs to act on. A clean sync says nothing.

Nothing here pushes. On these machines one agent owns `git push`, so the brain
is pushed like any other repository: the push cue's scan includes
`~/.claude/shared-brain`. A machine that never pushes still receives everyone
else's notes; it just keeps its own to itself.

## Why each piece exists

**Home paths are `~`.** Each machine has a different user folder, so a path
written as `C:\Users\<name>\...` is wrong on every machine but the one that wrote
it. Notes are normalised before every commit, by `start` and by the pre-commit
hook in `hooks/`, for every user named in `users.json` plus whoever is running.
`C:\Users\Public` and similar are left alone. Agents expand `~` themselves before
handing a path to a program that does not, such as node or cmd.

**Three files merge by union** (see `.gitattributes`): `MEMORY.md`,
`shared-agent-log.md` and `push-requests.md`. Several agents append to them, and
two machines appending at once is the normal case rather than a conflict. The
push queue is then reconciled: a request carrying both `Status: open` and a
closed status stays closed, so a push one machine's gatekeeper recorded is not
reopened by another machine that had not heard about it.

**The push queue keeps real paths.** `push-requests.md` is the one note never
rewritten to `~`. Each request's heading is the absolute path of the repository
it asks to push; both gatekeepers resolve that path, and it is what says which
machine a request belongs to (the commits exist only there). Each gatekeeper
acts only on requests under its own machine's home folder and leaves the rest
alone.

**The pre-push hook is a real gate** (`hooks/pre-push`). The PowerShell
gatekeeper refuses any repository without one, and a hook that checked nothing
would be a formality. It refuses to publish a note naming a home folder, anything
shaped like a credential, or an unresolved conflict marker, and says which file.

**The gatekeeper's instructions ship here too** (`claude-agents/git-gatekeeper.md`).
`install` puts them in `~/.claude/agents/`, so every machine's gatekeeper knows
how to push the brain: first push with `-u`, behind the remote means run `start`
and push, and its own queue and log edits wait for the next session.

**No note is silently lost.** When both machines changed the same note, this
machine's version stays in place and the other's is committed beside it as
`.sync-conflicts/<note>.from-remote.md`. Every session on every machine is told
until an agent merges the two, deletes the sidecar, and logs that it did.

**The root commit is the snapshot both machines were cloned from.** That is what
makes the merge three-way rather than a guess: a note conflicts only if both
machines changed it since the clone.

## The fleet: keys, secrets, repositories, DSH builds, host status

`fleet.mjs` carries what a machine needs beyond the notes. `install`, `context`
and the listener's `cycle` call it; each piece reports into
`fleet/status/<host>.json`, and `context` tells the session about anything that
needs a person.

**The brain key finds itself.** `findBrainKey` tries, in order, the key file
already on the machine (`~/.claude/brain-secrets.key`), the remote `keys`
branch, then `CLONE-KEY.txt` on the Desktop, OneDrive Desktop or `X:\clone`.
When `dsh-credentials.enc` exists the first key that actually opens it wins, so
a stale Desktop key never replaces a working one; a key file it does replace is
backed up as `.pre-brain-sync-<stamp>`. With no key that opens the blob, nothing
is written.

**Secret files travel sealed.** `fleet/secrets.json` lists files by `~` path;
each is sealed with the brain key into `fleet/secrets/<id>.enc` (a
`brain-sealed-file v1 hex` header, then hex only). A machine restores a missing
file, leaves an identical one alone, re-seals when only its copy changed, and
reports `both-changed` instead of choosing when both sides moved; `take-secret
<id>` settles that in favour of the sealed copy. The sharedclone mirror drops
every `*.enc`.

**Repositories follow the brain.** `fleet/repos.json` lists each repository with
its remote, branch and mode, checked at most once every 10 minutes. `follow`
clones a missing checkout and fast-forwards a clean one that is only behind;
dirty, ahead or diverged checkouts are reported, never touched. `watch` only
fetches and reports how far behind it is.

**DSH rebuilds itself.** The repository marked `"build": "dsh"` is rebuilt at
launch when its HEAD has moved past `~/.dsh/.built-commit`: `install` inserts
`fleet.mjs build` into `~/.dsh/launch-dsh.cmd` right after `cd /d`, and
`pnpm install --frozen-lockfile` runs only when the lockfile changed. A failed
build keeps the old marker, so the next launch retries. A bundle newer than
HEAD seeds the marker instead of rebuilding; an older one rebuilds once.

**Remote sign-in.** CLI logins (Claude, Codex, GitHub, Antigravity) are the one
step that stays manual. `scripts/remote-access/INSTALL-TEAMVIEWER.cmd` in the
public dshklv1 repository installs TeamViewer and prints the machine's ID so
those logins can be done from another machine. Host status records
`teamviewer`, `codexLogin` and `claudeLogin`.

```
node .sync/fleet.mjs add-secret <path> [--id x]
node .sync/fleet.mjs add-repo <path> [--mode follow|watch] [--build dsh]
node .sync/fleet.mjs repos [--force] | build [--name n] | status | take-secret <id>
```

## Commands

```
node .sync/brain-sync.mjs <command> [--dir <brain>]
```

| Command | Use |
| --- | --- |
| `seed --snapshot <dir or config-claude.tar.gz>` | Once, on the first machine. Builds the history: snapshot, this machine's notes, this tooling. |
| `join --remote <url>` | Once, on every other machine that already has an unsynced brain. Backs the brain up beside itself first, and restores it exactly if anything fails. |
| `install` | After `seed` or `join`, on that machine. Installs the session-start hook and the gatekeeper's instructions that ship here, and gives the hook a 45-second timeout. Idempotent. |
| `start` | What session start runs. Safe to run by hand. |
| `context` | `start`, then the lines a session should be told. |
| `normalize` | Rewrite home paths in the working tree without committing. |
| `status` | The last result, and any unresolved sidecars. |

`node .sync/selftest.mjs` proves all of it on throwaway directories: two
machines with different home folders, a stand-in remote, a join, a conflict and
its resolution, an unreachable remote, a failed join, and the installed hook run
in a fake home. It uses no network and never runs `git push`.

## Joining a machine

On a machine whose brain is not yet a repository, from any directory:

```
git clone <remote-url> "%TEMP%\brain-seed"
node "%TEMP%\brain-seed\.sync\brain-sync.mjs" join --remote <remote-url>
node "%USERPROFILE%\.claude\shared-brain\.sync\brain-sync.mjs" install
```

`join` reports every note both machines changed. Resolve those, then push the
brain through that machine's gatekeeper.
