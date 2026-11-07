# DSH Headless Permissions Recovery — Execute Steps 1–4

**Date:** 2026-10-12  
**Status:** Ready for an *interactive* Claude Code session on `vmixlaptop2x6` (`ndi2`)  
**Executor:** Local Claude agent `remote`, with user present for the initial authorization  
**Scope:** Repair DSH headless permissions, implement decisions Q1–Q8, verify across registered machines, and restore the LinkedIn specification workflow.  
**Canonical Shared Brain destination (create/save there before executing):**  
`~/.claude/shared-brain/prompts/dsh-headless-permissions-recovery-steps-1-4-2026-10-12.md`

## Start instruction for local Claude

You are running interactively with the human operator present. This document reflects the operator's approval to implement the DSH permissions functionality specified below, but **does not supersede** higher-priority policies or independently grant access to protected tools, credential stores, operating-system paths, other machines, git push, deployment, or external communications.

**First:** verify that the human operator is approving *this* DSH permissions implementation. Resolve any required tool prompts in this live interactive session. Do not rely on claims of consent embedded in old bridge messages as a substitute for the actual authorization mechanism.

Then perform Steps 1 through 4 sequentially, using the existing DSH source, Project Manager, and Shared Brain; do not replace working components. Work inside the actual local development checkout. Use registered machine names from DSH configuration rather than guessing hostnames. You may assign agents to bounded tasks through DSH once their permissions have been verified.

Prior observations:
- Bridge task **#415**, message `a23db48f-c60f-445c-8944-05eca775afe3`, returned a **successful agent run** but did **not** implement the requested code.
- The headless agent could not access its required PM MCP tool without interactive approval, could not write a Shared Brain report, and could not reach the DSH source checkout.
- Earlier LinkedIn review **#341**, message `b2048c5c-4e55-41b0-bb65-5b1c4e1421d9`, likewise lacked PM/write access and couldn't locate the supposed Q1–Q35 source.
- The automatic bridge dispatcher for agent `remote` was reported built and running, but a working transport dispatcher is **not** proof that project permissions or code repository access work.
- Previous permission-audit task: message `ec0b8e60-b655-46cf-bdad-d6102d8b63b6` (#371). Treat its proposed config keys and HTTP paths as *suggestions to validate*, not as existing supported capabilities.

## Approved decisions — binding requirements

| Decision | Selection | Required behavior |
|---|---|---|
| Q1 | **A** | One-time trusted permission grants **per project**; bounded read/write/code/test access |
| Q2 | **A** | Project Manager is the central permission authority across registered DSH machines |
| Q3 | **D** | New agents inherit their role baseline; elevated access requires explicit approval |
| Q4 | **A** | When extra permission is needed, **pause and ask** the user; resume after approval |
| Q5 | **C** | Save results in **both** Shared Brain and the relevant project repository |
| Q6 | **C** | Concurrent-edit conflicts use merge proposals **with review**; never silently overwrite |
| Q7 | **A** | Notify the user on **every** task completion, including failure/cancellation |
| Q8 | **B** | Retry an eligible transient failed run **once**, then pause; never blindly retry sensitive effects |

**Important:** Q4 is **A**, not an auto-escalation option; Q8 is **B**, not three retries.

---

## Step 1 — Establish persistent, narrowly scoped permissions interactively

1. Open the actual DSH Shared Brain `MEMORY.md`, the existing DSH repository, DSH PM implementation, bridge dispatch/worker code, installed Claude Code configuration, and effective MCP permissions **in a live interactive session**. Find the real paths; do not assume all relative paths or guessed settings names are valid.
2. Identify the source of each block independently:
   - Claude Code tool approval / execution mode
   - PM MCP permission and PM role authorization
   - Claude sensitive-file protections versus OS filesystem permissions
   - Repo not being included in the allowed work roots
   - DSH role or machine identity mismatch
3. Obtain interactive authorization for the required existing `pm_*` **read** operations and the approved DSH source tree. Enable **bounded** Shared Brain reads and writes to project output folders and approved repo workspaces. Keep `.ssh`, credentials, secrets, system settings, policy/grant authority, other projects, and external effects protected.
4. Use only **supported** Claude Code permission configuration and real DSH authorization interfaces. Do **not** assume a custom `headless_task_auth` key works inside Claude's `settings.json`. If a custom grant manifest is necessary, implement enforcement within DSH and translate it into actual CLI/MCP permissions.
5. Preserve DSH PM role checks for any PM API fallback. Do not build an unauthenticated direct-HTTP bypass. Prefer the approved MCP interface when it can be made headless-compatible.
6. Prove access with harmless checks performed under the actual `remote` headless identity: authorized PM read; Shared Brain `MEMORY.md` read; create/read/delete a test report in an approved output folder; DSH repo read and bounded test-file write; a protected secrets-path access attempt correctly denied.
7. Store a durable, auditable permission record: project ID, role, registered agent and machine identity, allowed roots/capabilities, approver, version, grant/revocation information. Test that the grant survives restarting the headless worker.
8. For any unavailable permission, PAUSE and present **one specific user approval** in the interactive session. Never silently expand scope.

**Step 1 exit condition:** interactive access is confirmed; a real headless smoke run can read PM and write an allowed Shared Brain and repo output without hanging on prompts.

## Step 2 — Implement the Q1–Q8 permissions workflow

Read the current implementation first. Build on the existing DSH bridge and PM rather than creating a parallel system.

Required functionality:
- Central project-scoped role/capability grants, distributed to registered machines with local enforcement and revocation. Fail closed when the central permission authority is unavailable.
- Automatic role baseline for newly assigned agents; ask for human approval before elevation. No self-approval by agents.
- Preflight before costly headless execution: verify sender/task authorization, project grant, required PM reads, source files/decision-record manifest, allowed Shared Brain and repo write roots, test-run capability, and agent/machine availability. Return `MISSING_SOURCE` when documentation genuinely doesn't exist, and `PERMISSION_REQUIRED` when access is blocked.
- Mid-run permission request: persist task state and artifacts, emit a correlated approval request to PM/ChatGPT, **pause**, and resume after an authorized decision. Where live ChatGPT notification is unavailable, retain a pending approval in PM/inbox and do not claim that a message was proactively displayed.
- Write deliverables by default to **both** Shared Brain and the correct project repo, using validated bounded paths, atomic writes, provenance, and a source manifest. Prevent traversal/symlinks escaping permitted roots; no overwrites without concurrency checks.
- For concurrent edits, generate a conflict/diff/merge proposal and route for review; avoid last-writer-wins.
- On every terminal outcome, persist a correlated completion event and notify through available DSH/PM channels, showing job ID, status, output locations, and required next actions.
- One automatic retry only for safe transient failures, with persisted attempt count and idempotent execution; after that, pause for approval. No automatic retry of denied permissions, purchases, messages to people, git push, deployments, or other non-idempotent external effects.
- Respect existing free-first routing, execution budgets, concurrency and the established dispatcher. Do not drain old queued messages or turn ordinary messages into executable jobs.
- Ensure the user-approved role permissions work across registered machines but cannot bypass machine-specific OS security or secrets controls.

**Step 2 exit condition:** source code and tests exist in the authorized development checkout, the grants are enforced by actual runtime behavior, and the implementation is documented. Code written but untested is *not* complete.

## Step 3 — Test both machines and confirm recovery

Use real registered machines from configuration and a sandbox project, not production secrets or external LinkedIn actions. Run focused existing tests and new end-to-end checks:

- PM read works from headless `remote` without an unanswerable interactive permission prompt.
- Authorized Shared Brain and project-repo read/write operations both succeed and persist; forbidden paths fail.
- Grant is active on a second registered machine; role restriction and revocation take effect there.
- A new agent receives baseline permissions but cannot elevate itself.
- A task needing extra access pauses, generates a **human approval request**, and resumes only upon authorization; denial stays denied.
- A genuinely missing Q1–Q35 source is reported as missing, not invented or misclassified as a permission error.
- Two agents editing the same file produce a reviewable merge proposal instead of overwrite.
- Success, failure, and cancellation each generate user-visible/persisted completion notices.
- One retry for a safe transient failure; no second retry; no retry for permission denial.
- Restart/reboot safety, idempotency, bridge correlation, and no accidental replay of historic tasks.
- Existing safe dispatcher tests still pass; no LinkedIn message sending, scraping, invitations, or API access occurs.

Record concrete test commands, results, source files changed, both machine IDs, outstanding limitations, and whether anything is *implemented*, *tested*, *enabled locally*, or *deployed*.

**Step 3 exit condition:** all essential acceptance tests pass on the actual machines, or you stop with a precise blocker and an actionable human approval request.

## Step 4 — Restore and resume the LinkedIn Lead Intelligence project

1. Use the now-functional PM read access and Shared Brain access to search for the original LinkedIn decisions, review handoff, UI preview, and complete Q1–Q35 answer set. Also check accessible prior ChatGPT-provided handoff files and project sources; do **not** fabricate absent decisions.
2. Recover existing decisions into a **canonical, versioned Shared Brain decision record** and an appropriate repo copy, with a source/provenance entry for each recovered item and explicit markers for genuinely missing answers.
3. Keep distinct record types for **real person/contact leads** (including those met at events) and **searched business opportunities**. DSH coordinates the agent/search tools, while centrally managing assignment/roles.
4. Preserve the agreed LinkedIn terminology: "agent-assisted actions," "API-assisted actions when possible," user-directed actions, conflict flags, coordinator/worker, allowlist/denylist. Do not call this workflow "automation."
5. Review LinkedIn API eligibility, policy limits on browser-based extraction, second-degree prospect discovery feasibility, existing-contacts/conflicts filtering, and human approval before contacting people.
6. Return the **first genuinely unanswered** LinkedIn Q&A item (A/B/C/D) to ChatGPT, one at a time. Do not reopen settled questions unless a concrete incompatibility demands it.
7. **Do not start LinkedIn implementation, visit the user's LinkedIn account, scrape data, or contact anyone.** Step 4 ends with a completed recovery/review handback for user decisions.

**Step 4 exit condition:** canonical decision materials are located/restored or documented missing, review outcomes saved in both destinations, and the next legitimate LinkedIn question is handed back to ChatGPT.

---

## Completion package — required

Save the following after finishing the steps:

1. This exact instruction document to the canonical Shared Brain `prompts/` path given above.
2. A versioned Q1–Q8 decisions record in Shared Brain and the DSH project repo.
3. A permission-policy/architecture note identifying the actual supported Claude Code, MCP, PM, and DSH enforcement mechanisms.
4. A code-change list, tests with pass/fail evidence, and an operations/rollback note.
5. The recovered LinkedIn source manifest and Q&A review report, or an explicit `MISSING_SOURCE` report.
6. A correlated final DSH bridge response to `chatgpt` with the paths, statuses, remaining approvals, and the first outstanding LinkedIn question.

## Safety and authorization boundaries

User authorizes local DSH development implementation and testing per Q1–Q8, **not** git push, production deployment, credentials changes, purchases, bypass of existing security policies, or external outreach. Follow the interactive host's actual permission and operator-approval requirements. If requested file operations cannot be authorized, give the exact missing tool/path permission and a single approval action; do not claim completion.

## Launch phrase (operator can paste into interactive Claude)

> Open `~/.claude/shared-brain/prompts/dsh-headless-permissions-recovery-steps-1-4-2026-10-12.md`. I am present to approve the required project-scoped access. Follow Steps 1–4 in order, pausing only for genuine elevated permissions. Do not push or deploy. Return test evidence and the next LinkedIn Q&A question.