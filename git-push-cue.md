---
name: git-push-cue
description: The one sentence that triggers a push, and exactly what the session does with it — scan every repo, then hand the whole list to the git-gatekeeper subagent
metadata:
  type: feedback
---

**Cue phrase: "ok let's push the updates."** Also "push it", "ship it",
"session is ending, push". Set up 2026-09-05 at the user's request.

That sentence is the user's full approval to push **everything that is ahead of
its remote, in every repo**, without a single follow-up question. Do not ask
which repo, which branch, or whether they are sure. Asking defeats the point of
the cue.

**What the session does on hearing it:**

1. Scan for work. Through the PowerShell tool:

```
$repos = @(Get-ChildItem -Path "$env:USERPROFILE\Documents\claudecode" -Directory -Depth 1 -Force -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName ".git") } | ForEach-Object FullName)
# The shared brain is a repository too, and it sits outside the project tree.
$brain = Join-Path $env:USERPROFILE ".claude\shared-brain"
if (Test-Path (Join-Path $brain ".git")) { $repos += $brain }
$repos | ForEach-Object {
  $r = $_
  $b = git -C $r rev-parse --abbrev-ref HEAD
  $u = git -C $r remote get-url origin 2>$null
  $c = git -C $r rev-list --count "@{upstream}..HEAD" 2>$null
  if ($c -eq $null) { $c = "no upstream" }
  "$r | $b | $u | ahead=$c"
}
```

   `$env:USERPROFILE`, not `~`: PowerShell cmdlets expand `~` but `git -C` does
   not, and this scan hands every path to git.

   **The brain** (`~/.claude/shared-brain` -> private `user1gityup/shared-brain`,
   branch `main`) is ahead after almost every session: `brain-sync` commits what
   the agents wrote at each session start. Those commits are machine-made
   (`brain: <host> session changes`), carry no home paths, and go to a private
   repo, so they need the gatekeeper's normal checks and nothing more. On its
   very first push it has no upstream yet; push with `-u origin main`. See
   [[shared-memory-protocol]].

2. Invoke the `git-gatekeeper` subagent **once**, with every repo that is ahead
   listed in the prompt — path, branch, remote — plus the sentence "the user
   approved this push." The gatekeeper checks its prompt for that approval and
   refuses without it, and it cannot ask the user anything itself.
3. Relay its per-repo report back verbatim enough that the user sees what landed
   and what was skipped.

**Repos as of 2026-09-05** (re-scan, do not trust this list):
`billboard-platform` -> `user1gityup/digitalbillboard`; `deepseek-harness` ->
the private `user1gityup/lseekv1` (since 2026-09-17); `dsh-council-plugins` -> public `user1gityup/dshklv1`;
`gep-pivot` and `green-energy-platform` -> both `user1gityup/nrg` on different
branches, so two separate pushes; `free-claude-code` -> **upstream
`Alishahryar1/free-claude-code`, never push, always skip.** Added 2026-09-11:
`~/.claude/shared-brain` -> private `user1gityup/shared-brain`.

**Why:** the user wants one sentence to end a session, not a negotiation. The
value of a single gate is lost if reaching it costs five clarifying questions.

**How to apply:** see [[git-gatekeeper-agent]] for the division of labour,
[[git-push-method]] for the mechanics, and [[no-live-git-pushes]] — this cue is
the moment that policy is waiting for. Nothing else lifts the hold.
