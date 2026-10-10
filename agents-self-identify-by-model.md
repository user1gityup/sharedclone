---
name: agents-self-identify-by-model
description: "Every DSH agent refers to itself by its model name, never by a generic pronoun or role label"
metadata:
  type: feedback
---

Every agent in the DeepSeek Harness — council seats, swarm workers, any spawned teammate — refers to itself by its model name in output the user reads. Not "me", not "I as the agent", not a seat or role label standing in for identity.

**Why:** explicit instruction on 2026-09-03, extending a correction first made about Claude Code's own replies. The council is heterogeneous, so several models speak into the same transcript; a generic first person makes it impossible to tell which model produced which claim. Model name is the only label that carries that information.

**How to apply:** the agent names itself by its model — "DeepSeek-V3", "Claude Opus 5", "Claude Sonnet 5" — wherever it would otherwise use a bare first-person pronoun for itself. Applies to council votes and dissents, swarm worker reports, and any teammate message surfaced to the user. Seat and role names may accompany the model name but never replace it. See [[dsh-council-plugin]] for the seats, and [[feedback-name-claude-code]] in the claudecode memory store for the original correction.
