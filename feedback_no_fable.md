---
name: feedback_no_fable
description: never use Claude Fable (claude-fable seat / claude-fable-5-1) for any run, seat pick or recommendation (user, 2026-10-23)
metadata:
  type: feedback
---
Do not use Claude Fable anywhere: no `claude-fable` DSH seat, no `claude-fable-5-1` model, not as a recommended option in seat Q&A cards.

**Why:** user, 2026-10-23, after the 5-task parallel run: "lets not use fable in further in the future".

**How to apply:** keep `council.seats.claude-fable` and `swarmRoster.claude-fable` disabled in ~/.dsh/settings.yaml; leave Fable out of seat-pick options. Related: [[feedback_dsh_seat_policy]].
