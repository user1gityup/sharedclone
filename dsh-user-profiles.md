---
name: dsh-user-profiles
description: DSH distributed-team identity, entitlement chain and profile-driven UI policy (admin/manager/worker/client); design target, not built
metadata:
  type: project
---

# DSH user profiles and entitlements

Status: design target, not built. It merges the proposed profile-policy and user-profile-access drafts (ChatGPT review, 2026-09-15). Identity comes from Beacon JWT plus a `DshRole` claim and revocable machine tokens, as already decided in [[project_dsh_team_platform]].

## Policy chain
Organization, then team, then user profile, then project membership and data scope, then job profile, then run approval. Each level can only narrow access. Widening past the user's ceiling needs an explicit authorized grant and never a model decision.

## Profile fields
Identity and org/team; DshRole; project memberships and data/artifact visibility; allowed job classes, tools, execution surfaces and council/swarm profiles; model/provider entitlements; preassigned routes by job class; usage limits per cost class (local/free/included/metered); spend and approval authority; admin visibility; UI capabilities; audit identity.

## Experience profiles
- Administrator: full PM and DSH control, including policy, routing and weights, providers and nodes, budgets and logs.
- Manager/power user: project and team management plus the orchestration controls that org policy grants.
- Worker: assigned tasks, inputs, allowed data, status and outputs. No council, swarm, routing, provider, budget or policy controls unless granted.
- Client: a narrow request-in, result-out window. No prompts, rosters, models, costs, internal state or other users' work.

Job routes such as "user B coding jobs use the free/local roster only" are policy. The resolver optimizes inside them and never escapes them ([[dsh-runtime-routing]]).

## Enforcement
- Hidden is not security. The server, tool, API, CLI and MCP layers reject restricted operations, including ones reached by guessing endpoints.
- User A cannot see user B's private tasks unless policy grants that scope.
- Model-facing tools cannot raise an entitlement or budget or assign a paid seat.
- Machine identities do not inherit a human UI role.
- Every launch records the effective policy used for routing and accounting.
- Profile limits apply to context retrieval too, not only to the UI.
