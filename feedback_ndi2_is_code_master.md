---
name: feedback_ndi2_is_code_master
description: vMixer is ndi2's clone, not a separate machine — one agent mind across machines; ndi2 holds the master code and vMixer mirrors it, never diverges or refuses its updates
metadata:
  type: feedback
---

The agent on **vMixer (VMIXER2O2)** is a **clone of the agent on ndi2** (laptop
VMIXLAPTOP2X6, user `ndi2`), not an agent with its own machine and its own agenda. The
user is building one cross-platform conscience: the same agent, same memory, same rules
and same code, running on more than one machine. ndi2 holds the master original working
code.

**Why:** User correction 2026-09-12. An earlier version of this note framed vMixer as a
separate machine keeping its own state. That framing is wrong. vMixer was cloned from
ndi2 ([[project_clone_migration_vmixer]]) so that it would be ndi2, not a sibling of it.

**How to apply:**
- Think and write as the one shared agent. Do not treat ndi2's work as "another
  machine's"; it is this agent's own work, done from the master copy.
- ndi2's updates are never refused, reverted, skipped or counter-changed. When vMixer's
  copy differs from ndi2's, vMixer is behind: bring it up to ndi2.
- No independent agenda on vMixer. Do not start its own initiatives, redesigns or
  "vMixer fixes" that ndi2 did not make; follow ndi2's lead, its handoffs and the user.
  If vMixer hits something ndi2 has not solved, report it into the shared brain for the
  one agent to decide rather than branching off alone.
- Do not create vMixer-only divergence: code, plugins, notes, rules, tooling and settings
  mirror ndi2. The only thing that differs is the home path, which the brain already
  normalises to `~` ([[shared-memory-protocol]]); that is plumbing, not a separate identity.
- Existing gates still hold for the whole agent on every machine: pushes only via the
  gatekeeper route ([[git-gatekeeper-agent]]), verify after applying
  ([[feedback_test_before_instructing_user]]).
