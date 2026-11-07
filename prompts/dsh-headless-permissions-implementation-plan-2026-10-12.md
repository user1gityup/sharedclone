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

---

# Amendment v2 (2026-10-13, Claude Opus 5.5) — bridge seq 496, 497, 498
Prior version preserved as `dsh-headless-permissions-implementation-plan-2026-10-12.v1.md`. All Q1–Q8 / E1–E17 decisions, the seq 494 correction, Step 0, the 2a/2b/2c worktrees and interactive integration stand unchanged. Seats: the existing DSH router prefers subscription/Codex seats; no zero-cost guarantee is claimed.

## E7 — RESOLVED (seq 498), not an open question
All three approval methods are accepted: (A) a pm-issued one-time code entered in ChatGPT; (B) direct confirmation in the authenticated pm UI or an interactive Claude session; (C) an authenticated secure approval link from pm. **pm decides** which methods each user/role may use, under the existing role policy (Admin / Manager / Worker / Client, per `dsh-user-profiles.md`); a user cannot pick a weaker route. Only designated human approvers grant elevated access; others may request but not approve; Managers only within granted controls; Workers/Clients never inherit approval powers. Requirements: identity binding, short-lived challenges, replay resistance, a durable pm approval record, and audit. A bridge token or browser cookie never proves consent. Existing role assignments come from pm/brain; none are invented. → Goes into workstream **2a**.

## Verified current startup topology (ndi2, read 2026-10-13)
- **One process, not many daemons:** `pm/server.mjs` hosts the pm API **and** the whole bridge in-process (`createBridge`: queue, dispatcher, headless workers, peer forwarder/replica). "Required services" therefore = this process + its supervisor.
- **Supervisor:** `pm/pm-autostart.ps1` (watchdog, named mutex single-instance, restarts when `/api/bridge/health` fails, logs to `pm-data/autostart.log`, already writes a tray notification for new claude-code mail).
- **Launched at user logon, not boot:** from `Startup\Shared-Agent-Listeners.cmd`, together with `SharedBrainListener.ps1` and `Gatekeeper.ps1`; there is also a `Gatekeeper Startup Watcher.lnk`. No scheduled task or Windows service exists for pm or the gatekeeper.
- Gatekeeper is a separate PowerShell process; it does not start pm today.

## Workstream 2d — Boot/Gatekeeper service orchestration (seq 497 §A) — PLAN ONLY
- Move the pm supervisor from the logon Startup folder to an OS supervisor that runs at boot without desktop login (Windows Task Scheduler "At startup", run whether the user is logged on or not, as the same user), keeping the existing mutex guard, health check and restart; add capped backoff (e.g. 5s→10m) and a readiness probe (`/api/bridge/health` + a dispatcher tick).
- Gatekeeper start/stop also ensures the pm supervisor is running (start-if-absent, never a duplicate).
- The queue is already durable (SQLite) and `dispatch.after_seq` prevents backlog replay; tests must prove both survive power loss.
- The pm browser UI opens only for an interactive signed-in authorized user, never on headless-only hosts.
- Deliver: install / disable / rollback scripts (one click each), the same on vmixer2o2. **Not installed until approved.**
- Owns: `pm/pm-autostart.ps1`, new `pm/service/*.ps1`; no overlap with 2a–2c. Needs an interactive session (Task Scheduler registration may need elevation) → sandbox drafts it, install is interactive.

## Workstream 2e — pm-first notifications (seq 497 §B), extends 2b
pm is the system of record for: accepted / claimed / running / permission pause / request / approval / rejection / retry / complete / failed / cancelled, bridge offline / no-consumer / stall, machine health. Each event is scoped by identity, role, project, machine and owner; dedupe; read / unread / ack / dismiss; escalation and reassignment; persists across reboot; replicated as authorized. Shown in a role-filtered pm UI; optional fan-out to the ChatGPT bridge inbox and a Windows toast on ndi2 (E14=B, reusing the watchdog's tray code). Non-ChatGPT pm users get project events without any ChatGPT account. No promise of proactive messages to an inactive ChatGPT chat. Owns: new `pm/notify.mjs` plus a store table; 2b emits events through the `CONTRACTS.md` interface.

## Workstream 2f — Server-enforced ChatGPT-browser security (seq 497 §C), extends 2a
Only designated human roles may use the ChatGPT-in-browser integration, browser control/sessions, bridge actions/settings and sensitive scopes — enforced on the pm API, not just hidden in the UI. Identity-bound scoped grants with revocation; no sharing of browser cookies/sessions/tokens across users; no secrets in logs. OpenClaw = a browser-control client acting for an authorized human (seq 494), not an agent, seat or principal.

## Phases (seq 496/497 §D)
- **Phase 1 (current):** this plan — Q1–Q8 / E1–E17 permissions (2a–2c), boot/Gatekeeper supervision (2d), pm-first notifications (2e), browser-role security (2f), cross-machine tests. No pm backlog mixed in.
- **Phase 2:** finish pm setup — project roles, single-owner assignments, task source manifests, grants, notifications/dashboards, approvals, seat routing; test pm infrastructure.
- **Phase 3:** pm-tracked test of OpenClaw driving a headless ChatGPT browser → ChatGPT bridge → pm → agents (identity/session, role visibility, login/session handling, round-trip/ACKs, permissions, audit/notifications).
- **Phase 4:** inventory pending pm tasks, check dependencies/budgets/permissions, assign agents, run eligible tasks in parallel via DSH with approval checkpoints. The backlog never starts automatically.
- **pm task status:** a Phase 3 OpenClaw test task is **not yet registered** in pm (registration is a pm write; not done from a planning message).

## Added acceptance tests (Step 3)
Boot with no user logged in → pm + bridge healthy; kill pm → restart with backoff; power-loss simulation → queue intact, no replay; Gatekeeper start with pm running → no duplicate; disable script → nothing starts at boot; rollback restores the logon Startup entry. Role tests: Worker/Client cannot approve; a Manager can approve only within its grant; a one-time code is single-use and expires; a replayed approval link is refused; the ChatGPT-browser endpoints are refused for non-designated roles at the API; toast + bridge inbox + pm event for each terminal state.

## Decisions on Amendment v2 questions (bridge seq 500, 2026-10-13)
1. **2d install target = A:** Windows Task Scheduler task "At startup", running as the existing ndi2 account whether or not the user is logged on. Registration stores the Windows password: that entry is the user's own step, done once in the interactive install. The logon Startup entry stays as the fallback until the boot task passes its tests.
2. **OpenClaw test task = B:** register it in pm after the Phase 2 pm setup, not now. Still unregistered.
3. **vmixer2o2 = B:** configure and test boot startup on ndi2 and vmixer2o2 independently in Phase 1, each host on its own, before any cross-machine operation tests.

No open questions remain for Phase 1 planning. Next: Step 0 (interactive), on the user's go.
