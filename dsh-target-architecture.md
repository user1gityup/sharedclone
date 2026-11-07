---
name: dsh-target-architecture
description: Target layering and authority rules for Shared Brain, Project Manager, Context Compiler, DSH and agents (ChatGPT review 2026-09-15, reconciled 2026-09-17); design target, mostly not built
metadata:
  type: project
---

# Target architecture: Shared Brain / PM / DSH / agents

Status: design target approved in the ChatGPT review on 2026-09-15 and reconciled against the live brain on 2026-09-17 by Claude Opus 5. Unless a line says it is built, it is not built. The current mechanics are in [[shared-memory-protocol]], [[project_agent_project_manager]] and [[dsh-council-plugin]].

## Layers

```text
Shared Brain            durable rules, architecture, decisions, references, history
   |
Project Manager         canonical live state: projects, tasks, ownership, runs, policy, usage
   |
Context Compiler        minimum sufficient, authorized context per task and role   (not built)
   |
DSH                     team operating surface: identity/policy, council/swarm planning,
                        runtime resolver and seat broker, execution orchestration
   |
Execution routes        local CLI | local LLM | subscription CLI | cloud API | MCP | remote node
   |
Agents / workers        execution endpoints only
```

PM stays a standalone service in `shared-brain/pm` (127.0.0.1:4480, built 2026-09-16; see [[handoff-pm-build]]). The user decided this on 2026-09-17. Using PM never requires DSH: humans, CLI agents and MCP clients call PM directly. DSH is one more PM client and connects through the planned phase-3 connector.

Agent-to-agent bridge (target): ChatGPT or another agent files a task package in PM. DSH reads it and dispatches to a registered agent such as Claude, which replaces the manual zip handoff. PM stores the task and DSH does the dispatch, so PM's location does not affect this. Missing pieces: PM listens on loopback only and has a stdio MCP server only, so ChatGPT cannot reach it; that needs a remote HTTPS MCP endpoint with a token. The DSH connector and Claude as a DSH-dispatchable agent are not built either. This supersedes the 2026-09-11 decision in [[project_dsh_team_platform]] that PM would be "built inside DSH".

## Authority rules (new material only)

Rules that already live elsewhere are only referenced: one canonical source, generated renders and mirrors non-authoritative, history preserved, handoffs verified against reality, one owner, publication separately gated. See [[shared-memory-protocol]], [[sharedclone-mirror]], [[quota-handoff-protocol]] and [[git-gatekeeper-agent]].

1. Information status is explicit: current, historical, reference, generated, temporary, handoff, proposed or superseded.
2. Knowledge does not authorize execution. Notes, plans, presets and handoffs never grant permission or spending.
3. Critical boundaries (approval, spend, publication, entitlement) are enforced outside model reasoning. If a boundary cannot be established, execution fails closed.
4. Approval is scoped and single-use. Planning, estimating and presets never launch execution.
5. PM is canonical operational state. Web UI, API, CLI, MCP, councils and swarms all operate on the same PM state.
6. Independent CLI or model work that affects managed state is reconciled into PM before it counts as current.
7. Context is compiled, not dumped. Agents query for more context instead of loading the whole brain. Until the compiler exists, `MEMORY.md` injection and the rendered `AGENTS.md` stay the delivery path.
8. Agents discover state (capabilities, ownership, quota, cost, continuation) from a queryable registry instead of reconstructing it from transcripts.
9. Orchestration is separate from inference. Moving inference to another node or provider does not change project authority, and crossing a machine or provider boundary never widens filesystem, credential, network, Git or spend authority.
10. Local machines and models are first-class workers inside the same state model. Pool nodes are inference-only unless a sandboxed runner is explicitly authorized.
11. Execution location (model, provider, node, workspace, permissions, cost class, owner) is recorded per run, so work can migrate after quota or provider loss without restarting.
12. Runtime decisions are auditable in PM: roster, policy, escalation reason, actual usage, holds and substitutions.

Routing detail: [[dsh-runtime-routing]]. Profiles: [[dsh-user-profiles]]. Done criteria: [[dsh-platform-completion]].
