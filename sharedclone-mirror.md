---
name: sharedclone-mirror
description: user1gityup/sharedclone is a disposable, non-authoritative ChatGPT-readable mirror of shared-brain main; one-way, overwrite-only, refreshed by a git hook; ChatGPT proposes, never changes
metadata:
  type: reference
---

# sharedclone: ChatGPT's read-only mirror

`github.com/user1gityup/sharedclone` (private) is a disposable copy of `shared-brain` `main` for ChatGPT to read. **It is not authoritative.** The authoritative brain is `github.com/user1gityup/shared-brain` and this folder.

## Mechanism

- `.sync/mirror-sharedclone.mjs` reads the live `shared-brain` main sha (`ls-remote`), takes that tree from the local object store, drops security material (`*.enc` such as `dsh-credentials.enc`, keys, certificates, env and credential files, `brain-secrets*`, `.github/`), refuses to sync on any credential shape or the literal brain key, adds a generated `README.md` warning, and force-pushes one deterministic parentless commit to `sharedclone` `main`. Every other branch and tag on sharedclone is deleted. The `keys` branch is never read.
- Trigger: `.sync/hooks/reference-transaction` (brain `core.hooksPath`) launches it detached whenever `refs/remotes/origin/main` moves, which is every successful gatekeeper push and every fetch that brings in another machine's push. Log: `.sync-state/mirror-sharedclone.log`. Manual: `node .sync/mirror-sharedclone.mjs` (`--check` reports only). Off switch: `SHAREDCLONE_MIRROR_OFF=1`.
- One way by construction: the script never fetches from sharedclone, never writes a brain ref, and the brain has no remote for it. sharedclone holds no credential; the push uses the git credential helper of the machine running the brain. A repo-to-repo pull request is impossible (sharedclone is not a fork), and a workflow committed there would get only sharedclone's own token and be deleted at the next sync.

## ChatGPT change process

ChatGPT analyses and recommends; it does not change authoritative state.

`ChatGPT -> proposed change request -> Project Manager -> authorized agent/workflow -> gatekeeper -> authoritative Shared Brain`

Anything committed to sharedclone is discarded.
