---
name: git-push-method
description: How a git push actually gets out from this machine — PowerShell not Bash, helper already wired, per-repo identity, and a slow repo-wide pre-push hook
metadata:
  type: reference
---

What an agent needs in order to push from this machine. Verified 2026-09-05.

## 1. No tool pushes any more — hand the command to the user

**Superseded 2026-09-07.** This section used to say the PowerShell tool worked
where Bash did not. It does not. `git push` is now refused through **both**
tools by the Claude Code auto-mode classifier, and refused with the user's
explicit go-ahead in chat, because chat is not a channel that gate reads.
Confirmed four times in one session, including from inside the `git-gatekeeper`
subagent — being the designated pusher is the user's policy, not a permission
the harness grants.

An agent editing `~/.claude/settings.json` to add the allow-rule is itself
denied, correctly: an agent must not widen its own permissions. The denial text
tells the USER to add a Bash permission rule; an older reading of this note said
no such rule helped, so treat that as unverified either way and do not burn
turns testing it.

The working pattern: commit locally, file the request in [[push-requests]], and
give the user the exact command to run themselves.

```
git -C "~\Documents\claudecode\deepseek-harness" push origin <branch>
```

See [[reference_git_push_method]], which recorded the PowerShell route closing
on 2026-09-05.

```
git -C "~\Documents\claudecode\deepseek-harness" push origin feat/heterogeneous-teammates
```

Always pass `-C <absolute repo path>`; the shell working directory is not
reliable across tools.

## 2. Auth is already wired — never ask the user for a token

There is no `~/.gitconfig`, so `git config --global --list` fails with
"unable to read config file". That is expected, not a fault to fix. Auth comes
from the system-level Git Credential Manager (`credential.helper=manager`),
already holding the user's GitHub login, so an HTTPS push succeeds without a
prompt.

`gh` is not installed. There is no GitHub CLI fallback and no API token an
agent can read: creating repos, changing visibility, and opening pull requests
have to be done by the user in the browser.

## 3. Identity is per repo, not global

- `~/Documents/claudecode/deepseek-harness` — default branch `master`, work
  branch `feat/heterogeneous-teammates`. `origin` is the private repo
  `user1gityup/lseekv1` (was `user1gityup/deepseek-harness` until 2026-09-17); `upstream` is `deepseek-ai/deepseek-harness`.
  Commits authored as `user1gityup <info@420smoking.club>`.
- `~/Documents/claudecode/dsh-council-plugins` — branch `main`, `origin` is the
  public `user1gityup/dshklv1`. Commits authored as
  `user1gityup <user1gityup@users.noreply.github.com>`.

Never let the private fork's identity reach `dshklv1`. See
[[deepseek-harness-fork]] for the leak scan required before shipping public.

## 4. The pre-push hook is slow and repo-wide

In `deepseek-harness`, lefthook's `pre-push` job runs `pnpm run typecheck`,
which expands to `npm run build:lib:host && npm run typecheck:contracts-ready`
(`tsc -b tsconfig.client.json`) — a full host build, roughly 105 seconds. It
typechecks the whole working tree, so uncommitted or untracked work anywhere in
the repo can fail the push even when the commit being pushed is one CSS file.
The first push on 2026-09-03 failed on an untracked
`tool-council/tests/swarm.spec.ts`; a one-line `?? ''` fixed it and the retry
went through.

Never reach for `--no-verify`. Fix the typecheck failure, or ask.

## 5. Timing

Pushing is gated by [[no-live-git-pushes]]: hold every push until the user says
the session is ending, then offer and wait for a clear yes. Local commits are
fine at any time. See also [[nothing-without-permission]].
