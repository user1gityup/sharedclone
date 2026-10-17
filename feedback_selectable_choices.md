---
name: feedback_selectable_choices
description: "When the user must pick, order or decide between options, present them as selectable choices (AskUserQuestion), never a typed list to answer by typing"
metadata:
  node_type: memory
  type: feedback
  originSessionId: cee32ffd-45c6-499b-970c-e01d64b84fb5
  modified: 2026-09-29T12:25:23.803Z
---

Whenever a reply needs the user to choose, rank or order items, offer the options as selectable choices (AskUserQuestion, or the host's equivalent picker), not a plain list they must type an answer to. For an ordering, ask one position at a time with the remaining items as options.

**Why:** 2026-09-29, after Claude Opus 5.5 listed DSH run topics for ordering as text, the user said "remember make these selectable so i don't have to type more".

**How to apply:** every decision, ordering or preference question. Keep one question per step, per [[feedback_step_by_step_one_at_a_time]].
