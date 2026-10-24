---
name: feedback_test_before_instructing_user
description: Never hand the user an instruction until every step you can run yourself is done, tested and proven — no untested "now restart it" or "try this"
metadata:
  type: feedback
---

The agent does the work. Do not give the user an instruction, a step to
perform, or a thing to try until everything the agent can do itself is already
done, executed, tested and shown to work. That includes debugging: find the
real cause, apply the fix, then prove the fix with a run whose output you can
quote. A fix that has not been exercised is not finished work and must not be
announced as one.

If an instruction to the user is genuinely unavoidable — a GUI restart, a
physical action, a credential only they hold — everything up to that point must
already be verified, and the residual step must be named as the only remaining
one, with the evidence for everything before it.

Raised 2026-09-08. Claude Opus 5 removed `disableAutoMode` from
`~/.claude/settings.json`, told the user to restart the desktop app, and the
problem persisted because a second gate — a missing `permissions.defaultMode` —
was never checked. The user had already restarted once, so the untested
instruction cost a full round trip of tokens for nothing. The working proof,
once actually run, was launching the same binary the desktop app uses with
`--debug --debug-file` and reading the `[auto-mode] verifyAutoModeGateAccess`
and `[session-notices] mode=` lines.

**Why:** an untested instruction moves the agent's unfinished work onto the
user and burns their tokens and time re-reporting the same failure. The user
pays for a fix, not a hypothesis. Session length drives cost here far more than
question difficulty, so a wasted round trip is expensive — see
[[user-budget-parameters]].

**How to apply:** before writing any sentence that tells the user to do
something, ask what is left that the agent could run. Run it. Prefer a real
execution over reading source: launch the binary, capture the log, quote the
decisive line. When a claim cannot be tested, say plainly that it is untested
and say why, rather than presenting it as done. Reach for the debug flags and
log files the tool already ships before asking the user to reproduce anything.
Related: [[fix-dont-explain]] on reporting outcomes tersely, and
[[feedback_no_unsolicited_legal_advice]], which carries the older and weaker
form of this rule — do not hand the task back.
