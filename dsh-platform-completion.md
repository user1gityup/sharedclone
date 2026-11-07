---
name: dsh-platform-completion
description: Verification bar for calling the DSH team platform + PM integration done - seven behavioral demonstrations; applies to Tasks 04-07
metadata:
  type: project
---

# DSH team platform: completion bar

Adopted from the ChatGPT completion-criteria draft of 2026-09-15. Capability lists live in [[dsh-target-architecture]], [[dsh-runtime-routing]] and [[dsh-user-profiles]] and are not repeated here. Configuration or UI existing is not completion. These seven behaviors must be demonstrated:

1. Two user profiles get materially different UI and backend authorization.
2. A restricted profile is denied an unauthorized operation through a non-UI interface, not only by a hidden control.
3. A job-specific routing profile produces the required roster and rejects a disallowed substitute.
4. A dynamic run moves a role to another eligible provider when quota or capacity changes, without changing the role requirements.
5. A resumed run does not repeat successful paid work.
6. PM shows the intended roster, actual roster, usage, artifacts, verification and final result for the run.
7. An independent execution result is reconciled into managed state without becoming a competing authority.

Also still required: the two-factor single-use approval stays intact; model-facing config cannot express approval, entitlement, budget or paid seats; pool nodes stay inference-only; Git publication stays gated; policy failure fails closed.

Sequence: resume DSH work from its verified current state ([[handoff-2026-09-17-0216-dsh-all-live-pm-sync]]) and do not re-plan work that is already done.
