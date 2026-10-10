---
name: dsh-runtime-routing
description: Canonical DSH runtime routing and weight-router policy - resolver order, cost classes, escalation, routing policies, PM records; Task 02 builds it; not built
metadata:
  type: project
---

# DSH runtime routing and weight router

Status: the router itself is BUILT (2026-09-17, harness commit 07d17746f6, `packages/council/tool-council/src/router/`, 23 tests, oxlint and `tsc -b` clean). Nothing calls it yet: council, swarm and PM still use their own selection, and wiring them up is the next step. The rest of this note is still the design target. This note is the single canonical source for the resolver order. It supersedes the proposed runtime-routing, distributed-team-routing and weight-router-policy drafts and the resolver list in the 2026-09-15 team-platform amendment. Architecture: [[dsh-target-architecture]].

## What is built
`resolveRoster(roles, candidates, context)` returns assignments with their score factors, estimate, reason and escalation, plus every rejection with a code (INCAPABLE, MISSING_TOOL, CONTEXT_TOO_SMALL, UNAUTHORIZED, NOT_IN_ROSTER, UNAVAILABLE, QUOTA_EXHAUSTED, OVER_BUDGET, COST_CLASS_FORBIDDEN, LOCALITY_REQUIRED, LATENCY_RISK, NOT_INDEPENDENT) and the roles it could not fill. `buildRegistry(data)` is the seam: machine profiles override candidate throughput, queue depth and availability, so a measured hardware change reroutes work with no policy edit, while an unmeasured machine changes nothing. Cost scoring ranks local and free at 1, included at 0.6 because subscription quota is scarce and shared, and metered last by price. Steps 1-4 and 9-12 of the order below belong to the callers, not the router.

## Resolver order
1. Resolve the user, team and project access.
2. Create or update the PM task.
3. Free/local preparation, only when capable: normalize the request, extract constraints, classify the task, prepare the prompt.
4. Context Compiler builds the minimum permitted context.
5. Council/swarm planning outputs roles, capability requirements, acceptance criteria and a dependency graph. Model names are left out unless a policy pins them.
6. Hard filter: drop candidates that are incapable, unauthorized, outside the user/job policy, unavailable, quota-exhausted, over budget, on a forbidden node or missing required tools.
7. Apply any preassigned user/job roster.
8. Score only the remaining candidates.
9. Estimate and reserve usage (reserve, then settle).
10. Record the resolved plan in PM.
11. Pass the execution gate.
12. Launch, then write actual usage, results, holds, substitutions and continuation state back to PM.

Weights rank eligible candidates only. They never grant access. A substitute must meet the same role, capability, policy and permission requirements. Resolution happens as late as practical and is stored with the run.

## Cost classes
`local | free | included | metered`, which extends `CostClass` (see [[project_dsh_team_platform]]). `included` (Claude and Codex subscriptions) is scarce shared quota, not free, and needs the tightest per-user cap.

## Escalation
After filtering, prefer local/free, then included, then higher-value included or a specialized seat, then metered, then premium. A capability requirement can skip rungs: do not spend calls proving that an incapable tier fails.

Zero marginal cost does not by itself select local/free. Score it on estimated total completion time: throughput x context size, queue, retry risk, and the latency requirement. Escalate when an included route is materially better. vMixer's local LLM throughput is registry data ([[machines]]), not policy.

## Score inputs
Capability fit, expected quality, throughput, prompt/context size, estimated completion time, queue/load, marginal cost, entitlement class, locality/privacy, retry risk, quota headroom, latency need, independence/diversity (a reviewer must not be the coder), and prior evidence for the task class. Store the inputs and the reason, not chain-of-thought.

## Policies
`TOKEN_EFFICIENT` (production default), `FREE_FIRST`, `SUBSCRIPTION_FIRST`, `PAID_FASTEST`, `LOCAL_FIRST`, `FIXED_ROSTER`, `USER_JOB_PROFILE`.
`PAID_FASTEST` is a scoped override for the Tasks 04-07 build campaign only.

## Existing DSH behavior this must keep
- In economy mode, free agents execute and review stays paid ([[dsh-swarm-profiles]]).
- Plan quality is not traded for execution cost.
- A quota hold is resumable and journaled seat answers are replayed; faults are not parked as quota holds ([[dsh-pipeline-chain]]).
- Stage rosters are verified before any spend, and the run stops if they cannot be enforced.
- Approval stays unreachable from model-facing preset/config paths ([[dsh-council-plugin]]).
- One generalized seat broker handles leases, quota parking and replay ([[project_antigravity_seat_pool]]).

## PM run record
Before launch: task/run id, user/team/project, policy chain, job class, roles, resolved model/provider/node per role, cost class and reservation, approvals, dependencies, owner, escalation reason.
During and after: actual usage, stage progress, artifacts, failures versus holds, substitutions and migrations, verification, continuation, final disposition.
