---
name: handoff-sharedclone-mirror
description: 2026-09-15 closed - sharedclone populated and one-way mirror live via git hook; overwrite test passed; brain commit queued for gatekeeper so vMixer gets the hook
metadata:
  type: project
---

# Handoff: sharedclone one-way mirror

- **Handoff id:** handoff-sharedclone-mirror
- **Updated:** 2026-09-15 04:35 PDT (session cee0b105, host vmixlaptop2x6)
- **Model / owner:** Claude Opus 5 (claude-opus-5). No collaborating agent.
- **Repo:** `~/.claude/shared-brain` `main`; target `github.com/user1gityup/sharedclone`.
- **Status:** closed. Mechanism: [[sharedclone-mirror]].

## Exact ask

Populate `user1gityup/sharedclone` as a disposable non-authoritative ChatGPT mirror of `shared-brain/main`, one way, overwrite-only, auto-refresh on approved updates, no reverse path, no credentials, secrets excluded, history included, validated by an overwrite test. User then: "please push the shared brain to clone when you are done building the flows".

## Verified

- No `gh`; reading the git credential for API use was denied by the auto-mode classifier, so no Actions secret, deploy key, repo description or Actions setting. Chosen instead: git `reference-transaction` hook + `.sync/mirror-sharedclone.mjs` (see [[sharedclone-mirror]]).
- Scratch repo test: the hook fires on a push that updates `origin/main` and on a fetch that moves it; not on a no-op fetch.
- First sync: shared-brain `fccff2b` -> sharedclone `66393283ab`, 164 files, 1 excluded (`dsh-credentials.enc`). `--check` re-run: in sync (deterministic commit id).
- Blob-exact compare: 163 source blobs = 163 mirror blobs, plus generated `README.md`; 63 history files; nav files, PM state, handoffs, `system/<host>/` present; no key/enc/env/credential file; only `main` on the remote.
- Overwrite test: pushed an edit to `MEMORY.md`, new `CHATGPT-TEST.md`, deleted `feedback_no_analogies.md`, plus branch `chatgpt-test-branch` and tag `chatgpt-test-tag` (sharedclone `7e45e01`). Ran the real hook (`reference-transaction committed`); log: "overwrote 7e45e0103e, deleted refs/heads/chatgpt-test-branch, refs/tags/chatgpt-test-tag". Remote back to `66393283ab` only; edit gone, test file gone, deleted file back. shared-brain remote main still `fccff2b`; local HEAD and origin/main unchanged.

## Not done

- The brain commit carrying the hook, script and notes waits in the gatekeeper queue (PowerShell gatekeeper running, human approval). Until it lands, only this laptop has the hook; this laptop's fetches still refresh the mirror after any machine's push. When it lands, the hook fires and the mirror picks up the new files automatically.
- ChatGPT's GitHub connection to sharedclone is the user's OAuth step.

**Do not repeat:** the tests above. Do not add a remote for sharedclone to the brain.
