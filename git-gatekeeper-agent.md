---
name: git-gatekeeper-agent
description: One agent owns every git push on this machine; all other agents commit locally and hand off to it
metadata:
  type: feedback
---

**One agent pushes. Everyone else commits locally and hands off.**

The `git-gatekeeper` subagent is defined at `~/.claude/agents/git-gatekeeper.md`
(global, so it is available from every project directory). Created 2026-09-05 at
the user's request.

Rules for every other agent, session, council seat, and swarm worker - Codex
included, since 2026-09-05:

- Commit locally as much as useful. **Never run `git push` yourself.**
- Append a request to `shared-brain/push-requests.md` in the format documented
  at the top of that file: repo path, branch, remote, commit subjects,
  `Status: open`, and your model name.
- Say plainly what you committed and that it is queued, then stop. That is the
  handoff. Never ask the user to approve a push - approval is the user telling a
  Claude Code session that the session is ending, and that session hands the
  queue over.
- Only the gatekeeper closes a request, by editing its `Status:` line.

The SessionStart hook counts open requests and tells every Claude Code session
how many are waiting, so a handoff filed by Codex or a seat is not something
anyone has to remember to check.

Agents that physically cannot push still file here: the council's CLI seats run
with `--allowedTools WebSearch,WebFetch,Read,Glob,Grep`, so they have no shell
at all. The Codex seat is the one that can, which is why its own rules file
carries the prohibition explicitly.

What the gatekeeper does: checks branch, remote, and per-repo commit identity;
`git fetch` then `git rev-list --left-right --count "@{upstream}...HEAD"` to see
divergence; `git merge-tree --write-tree` to detect real conflicts before
touching anything; runs the push through the PowerShell tool and waits out the
pre-push gate; verifies `0 0` afterwards and reports what landed.

What it refuses: pushing without approval in its prompt, `--force`,
`--force-with-lease`, `--no-verify`, discarding anyone's uncommitted work, and
resolving another agent's merge conflicts unsupervised.

**Why:** several agents share these working directories, so an unsupervised push
from any one of them can race another's commits or ship half-finished work. A
single owner makes divergence and conflicts something one agent checks properly,
once, instead of something every agent half-checks. It also concentrates the
mechanics — PowerShell-only, the 105-second pre-push build — in one place.

**How to apply:** see [[git-push-method]] for the mechanics the gatekeeper
relies on, [[no-live-git-pushes]] for when a push is allowed at all, and
[[agents-self-identify-by-model]] — the gatekeeper reports under its model name.

**Claude quota exception (authorized 2026-09-07):** GPT-6 may act as the sole git-gatekeeper, including running git push and closing queue entries, only when a current Claude quota-limit message confirms Claude is out of quota. Record the evidence timestamp and stated reset time before acting. This allowance ends at the stated reset time or when Claude becomes available again, whichever comes first. If quota status is uncertain, do not push. Keep all existing verification checks, hooks, session-ending requirements, and single-agent push ownership. This exception overrides Claude-only and Codex-never-push wording wherever it appears; it does not override tool permissions or approval gates.

## Shared gatekeeper queue handoff (authorized 2026-09-07)

The independently user-operated PowerShell gatekeeper is an authorized push owner. While it is running, agents submit requests and do not push concurrently. It requires human approval for each exact reviewed push, preserves hooks, and needs no model quota. This is the explicit exception to earlier wording reserving every push to a Claude subagent; agent-side runtime permissions still apply.

When the user requests that completed work be queued, an authorized local agent reviews the changes, runs appropriate checks, commits the finished work, then invokes the shared queue helper with the absolute repository path, its model name, and a one-line validation report:

`node "~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/queue-build.mjs" "<absolute repo path>" "<model name>" "<checks actually run>"`

The helper requires a clean checkout, a matching origin/upstream and pending commits. It pins HEAD, deduplicates requests, and appends to the existing shared push-requests.md queue; it never builds, commits, or pushes. The gatekeeper displays the request, actual commits and diff for human approval. Read its JSON receipts under the same outputs/gatekeeper/state directory before reporting success. A queue entry alone is not a successful push. Use only existing permissions; never submit a denied operation through this route to escape a sandbox or approval gate.

DSH API agents must use their approved in-workspace staging route. Stage work after workspace-write approval plus go; do not write the shared queue or launch a host helper from that API path. An authorized local agent later reviews, applies, validates and commits the staged batch, then queues the commit using the helper. A successful build alone is neither a commit nor push authorization. No automatic pipeline callback is installed or implied.
