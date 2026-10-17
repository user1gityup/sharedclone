# DSH Headless Permissions — Implementation Plan

**Date:** 2026-10-12 · **Author:** Claude Opus 5.5 (ndi2, interactive)
**Implements:** `prompts/dsh-headless-permissions-recovery-FINAL-E1-E17-2026-10-12.md` (ChatGPT, bridge seq 492)
**Execution:** headless swarm, no council. Seats: Claude subscription and/or Codex only (no paid API seats).

## Added decisions (user, after FINAL)
- **Seats:** parallel runs use only Claude subscription and Codex seats, so they cost nothing per run. This replaces the E15 "no cap" concern.
- **Sandbox (E3):** `~/Documents/claudecode/dsh-sandbox`, a new local git repo holding a copy of `shared-brain/pm` only (no brain notes, no `dsh-credentials.enc` or `fleet/secrets.json`), no remote. The sandbox has to be outside `~/.claude`, because headless runs can never edit under `~/.claude` (safetyCheck).
- **Integration:** an interactive Claude session reviews each workstream diff and applies it to the live `~/.claude/shared-brain/pm`. Headless runs never touch live pm or `bridge-policy.json`.

## Built vs unbuilt
| Item | State |
|---|---|
| `pm_brain_write` broker (reports/, prompts/) | built, tested ndi2 |
| `headless_tools` / `headless_deny` → CLI flags | built, tested ndi2 |
| Grant v3 (project `*`) | live ndi2; to be replaced (E9) |
| Everything in 2a/2b/2c, vmixer | unbuilt |

## Step 0 — Interactive setup (Claude Opus 5.5, before the swarm)
1. Create the `dsh-sandbox` repo from `shared-brain/pm` at its current state; commit the baseline.
2. Create worktrees `ws-2a`, `ws-2b`, `ws-2c` (branches of the same name).
3. Write `CONTRACTS.md` in the baseline: the shared interfaces fixed in advance (grant record schema, approval record schema, run-state names, broker root list), so the workstreams don't need each other's code.
4. Grant v4 in `bridge-policy.json` for the swarm: the per-workstream cwd is its worktree; allow `Edit`/`Write` scoped to `dsh-sandbox/**`, `Bash(node --test:*)` and `Bash(node bridge/test.mjs:*)` and `Bash(node test.mjs:*)` only (E12), plus the pm read tools; keep `headless_deny`. Add the sandbox to `BRIDGE_EXEC_ROOTS`. Restart pm, then run a smoke test before the swarm.
5. pm: one task per workstream, `prepare` only; the user picks the seats.

## Step 2 — Parallel workstreams (no file overlap)
| WS | Files it owns in the sandbox | Delivers |
|---|---|---|
| 2a grants + approvals | `grants.mjs` (new), `approvals.mjs` (new), store migration for grant/approval tables, tests | schema project/role/agent/host/issuer/version/expiry 30d/revocation; approval record id/approver/scope/validity/audit; E7 approval paths; peer replication of grants with fail-closed (E13); replaces project `*` (E9) |
| 2b lifecycle | `bridge/workers.mjs`, `bridge/dispatch.mjs`, `bridge/lifecycle.mjs` (new), tests | PERMISSION_REQUIRED end → approval request → `--resume` same session (E4); paused tasks never expire (E5); SESSION_UNAVAILABLE without silent restart; one safe retry before any write (E8); completion notices: bridge inbox + pm event + Windows toast (E14) |
| 2c outputs + merge | `brain-write.mjs`, `cli.mjs` (tool table only), `merge.mjs` (new), tests | broker roots + `projects/<name>/` + approved `handoff-*.md` (E11); dual write brain + sandbox repo with provenance (E5/Q5); conflict → merge proposal → reviewer (Q6) |

Dependency: all three depend only on `CONTRACTS.md`. 2b calls the 2a functions through the contract (stubbed until merge).

## Integration (interactive)
Merge `ws-2a` → `ws-2b` → `ws-2c` in the sandbox, run the full suites, review the diff, apply to live pm, restart pm, smoke test.

## Step 3 — Test matrix (ndi2 + vmixer2o2)
PM read; broker writes in each root + refusals; sandbox write; denies for secrets, bare Read/Glob/Grep and non-allowlisted shell; role baseline vs elevation; grant revocation and expiry on both hosts; offline peer fails closed; PERMISSION_REQUIRED → approve → same-session resume; indefinite pause survives a pm restart; one retry, then no second; no retry after a write; merge proposal on a same-file edit; notices for success/failure/cancel incl. the Windows toast; reboot recovery; MISSING_SOURCE vs denied; no backlog replay. Record each command and PASS/FAIL.

## Rollback
Live pm: `git -C ~/.claude/shared-brain` revert of the applied pm commit. Policy: restore `bridge-policy.json.bak-20261012-perm` (pre-Step-1) or the per-version backup made before each grant change. Sandbox: delete the folder.

## Step 4
LinkedIn: ChatGPT supplies the Q1–Q35 source from the prior conversation, or the step returns MISSING_SOURCE. No LinkedIn access.

## Open concern (sent to ChatGPT)
E7 "ChatGPT relay with verified user identity": the bridge can only prove a message came with the `chatgpt` token, not that the user typed it. A relay needs a second factor, e.g. a pm UI confirm click, or a one-time code shown in pm and typed back by the user in ChatGPT. Proposed default: a relayed approval stays `pending_user_confirm` until it is confirmed in pm or an interactive Claude session.

## Correction from user (bridge seq 494, 2026-10-13) — ChatGPT relay path
- Path: authorized user → authenticated ChatGPT browser session (possibly driven headlessly by a browser-control client such as OpenClaw) → ChatGPT DSH bridge → pm/dispatcher → target agent.
- OpenClaw is **not** a separate agent, seat, principal, role, transport, identity or pm connector. No OpenClaw-specific grant.
- Authority comes from the pm-verified user approval (E6/E7), never from holding a browser cookie or the bridge token. Audit records which user/session and browser-control channel started the action where that is knowable.
- Keep server-side role checks on who may use ChatGPT-in-browser (headless included), session segregation, and no browser credentials exposed to other pm users.
- Pending: the "PM + Gatekeeper startup, notifications, roles/security, cross-machine supervision" amendment that seq 494 corrects never arrived on the bridge; it will be merged here once ChatGPT resends it.
