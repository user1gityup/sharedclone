---
name: handoff-2026-09-22-dsh-swarm-power-estimate-question
description: "Handoff for a read-only Q&A session: whether user used swarm + paid seats, and an estimate of DSH council/swarm power vs one Claude Code or Codex instance"
metadata:
  type: project
---

Stable id: handoff-2026-09-22-dsh-swarm-power-estimate-question
Updated: 2026-09-22, host ndi2 (Documents\claudecode, not a git repo), session 14f21972-7568-47b7-af5f-d853788a6117, model Claude Sonnet 5.
Owner: Claude Sonnet 5 (ndi2). No collaborating agents.

**User's exact ask:** "based on all the info you have about dsh build and swarm can you tell me if i was using swarm paid seats using all my agents can you give me an estimate in how much more power dsh council and swarm gives me vs using just one instance of claude code or codex"

**Work done (read-only, nothing changed on disk):** Read [[dsh-council-plugin]], [[dsh-target-architecture]], [[dsh-user-profiles]], [[dsh-swarm-disabled]], [[user-budget-parameters]], [[dsh-runs]], `dsh-presets/dsh/cheaperinference-seat-budget.yaml`, and grepped `shared-agent-log.md` for swarm execution evidence.

**Findings used for the reply (not verified further, stated as-is to the user):**
- Seats as of last saved runs: claude (subscription/included), free-claude (free proxy), openai/codex (subscription/included), kimi + deepseek-v4-pro (OpenRouter, metered/paid), openrouter-free (free), agy-* Antigravity/Gemini seats (free tier), llama-local (local, free). Runs up to 11 seats at once (2026-09-19).
- `dsh-runs.md` entries only show council stats ("drafts X/Y; reviews Z; amendments 0") — no line format confirms a full paid swarm *execution* (task graph run to completion with real file writes), only that swarm's plan phase was verified once (2026-09-17, `runSwarm` plan phase + `probeSeatLive` dead-seat reroute test, harness 813279c2f5, not pushed).
- Swarm execution gate: shipped 2026-09-04 commit `2c041a7`, workers = council's own seats, two-factor approval, single-use, 15-min TTL. `agent-team`/`subagent-claude-code`/`subagent-free-claude` teammate paths stay `disabled: true` by design — swarm workers are NOT separate Claude Code subprocesses, they're the same seats used for council.
- No memory note found stating a specific dollar cost or token count for a completed swarm run; answered the "power estimate" qualitatively (parallel decomposition + cross-model council review vs single-instance serial work), not with a fabricated number.

**Not done / open:** did not grep individual `~/.dsh/council-runs/*.json` run files on disk for hard swarm-execution proof (only the brain's rollup line was checked) — if the user wants a definitive yes/no on "did a swarm actually execute paid work," that needs those JSON files read directly, e.g. via `pm/connectors/dsh-connector.mjs` or by hand.

**Do not repeat:** don't re-answer this from a stale index — MEMORY.md was truncated this session; the topic files above are the current source, not the index preview.

**Next action:** none pending; this was a single informational answer, not implementation work. No commit, no push.
