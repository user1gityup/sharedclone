---
name: feedback_one_click_bundling
description: The user never does by hand what could be bundled - package every scriptable step into one click, test it, ship it, without asking
metadata:
  type: feedback
---

The user never wants to do manual work that could have been bundled. When a
task needs steps on the user's side - on this machine, on another machine, from
a USB drive - the agent packages every step that can be scripted into a single
double-click, or folds it into the one-click entry point that already exists
(for the vMixer migration that is `\clone\RUN-ALL.cmd`). The agent tests the
bundle, ships it to where the user will click it, and verifies the copy.

What reaches the user is one thing to click, plus only the steps no script can
perform - a physical action (moving a drive), a visual check in a GUI, a
credential only the user holds - each named as such. A list of commands, files
to copy, or scripts to run in order is not an acceptable handoff.

Raised 2026-09-11. The previous agent staged `JOIN-BRAIN.cmd` in `clone-bundle\`
and left the user a checklist (copy it to the drive, run it, then open a
session, then push), and never put it on the drive. The user asked for this to
be an agent-wide rule, with standing authority to do the bundling.

**Why:** manual steps cost the user time and a round trip of tokens each, and
steps split across files get skipped or run out of order. See
[[user-budget-parameters]].

**How to apply:** before handing over any procedure, ask which steps a script
could do. Bundle those without asking - this rule is the permission. Test the
bundle the way the user will run it (double-click, no arguments), then report
the one click and the residual human-only steps. Pushes still follow
[[git-gatekeeper-agent]] and [[no-live-git-pushes]]; this rule does not
authorise baking a push into a script. Related:
[[feedback_test_before_instructing_user]], [[nothing-without-permission]].
