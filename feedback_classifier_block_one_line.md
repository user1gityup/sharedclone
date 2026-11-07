---
name: feedback_classifier_block_one_line
description: when auto mode blocks an action, say so in one line and ask the user to switch to an asking mode; no explanations, no workarounds
metadata:
  type: feedback
---
When the auto-mode classifier blocks an action, reply with one line: what was blocked, then "switch the mode selector to a mode that asks, then say go". No explanation of the classifier, no partial-workaround attempts, no long status.

**Why:** 2026-10-06 the user spent many tokens on repeated block reports and explanations (ecom-final DAG session); they said a one-line "can't, switch mode, request again" would have saved them.

**How to apply:** first block on a task, stop that line of work, send the one-liner, wait. Related: [[feedback_never_tell_user_to_run_it]], [[fix-dont-explain]].
