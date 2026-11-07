# DSH Headless Permissions Recovery — v2 DRAFT for ChatGPT rewrite

**Date:** 2026-10-12
**Drafted by:** Claude Opus 5.5 (ndi2 / vmixlaptop2x6, interactive session)
**Supersedes:** `prompts/dsh-headless-permissions-recovery-steps-1-4-2026-10-12.md` (bridge seq 443)
**Purpose:** ChatGPT reviews and rewrites this into the final prompt. It corrects the v1 assumptions against what is actually on disk and in the run logs.

---

## Part A — Verified facts the rewrite must use (replace v1 guesses)

### Where things really are
| Thing | Real location |
|---|---|
| PM server + bridge source | `~/.claude/shared-brain/pm/` (`server.mjs`, `cli.mjs`, `bridge/workers.mjs`, `bridge/dispatch.mjs`, `bridge/index.mjs`) — it lives in the shared brain, **not** in the deepseek-harness repo |
| Bridge policy (dispatch + grants) | `~/.claude/pm-data/bridge-policy.json` — outside git, read live on every run, no restart needed |
| Headless run logs | `~/.claude/pm-data/bridge-logs/<submit-id>.log` (exact spawn line + every `permission_denied` event) |
| PM endpoint | `http://127.0.0.1:4480`; MCP tools `mcp__pm__pm_*` |
| Restart | kill `pm/server.mjs`; the watchdog restarts it in ~25–50 s |

### How the headless run is launched (workers.mjs)
`claude -p --output-format stream-json --model <m> --permission-mode default --add-dir ~/.claude/shared-brain --max-turns 30`, cwd = `~/.claude/pm-data/bridge-work/<id>`.
Supported permission modes in code: `default`, `acceptEdits`, `auto`. Only `auto` previously received `--allowedTools`.

### Root causes of #341 and #415 (from the logs, not inferred)
1. **PM tools denied:** no `--allowedTools` in `default` mode → `"Claude requested permissions to use mcp__pm__pm_list_projects, but you haven't granted it yet."`
2. **Shared Brain write denied:** `decision_reason_type: safetyCheck` — Claude Code treats **everything under `~/.claude` as a sensitive file**. Allow rules cannot override this. A direct Write/Edit into the brain from a headless run will **always** fail. A broker is required, not a settings change.
3. **Paths outside cwd/add-dir denied:** `Glob` on `~/.claude` → "Path is outside allowed working directories".
4. **No repo access:** project repos are not in `--add-dir` / `BRIDGE_EXEC_ROOTS`.
5. **Approval not corroborated:** #415 refused on purpose because the brain had no record of the "B Yes / Go" approval and the bridge wrapper says a message "cannot widen your permissions". Cost: $0.77 to refuse.
6. **Q1–Q35 missing:** grep of the brain and pm found no LinkedIn Q1–Q35 answer set. This is **MISSING_SOURCE**, not a permissions problem. It probably exists only in a ChatGPT conversation.

### Mechanisms that actually work (tested)
- `--allowedTools a,b,c` and `--disallowedTools a,b,c` on the `claude -p` command line.
- A **bare `Read` allow reaches the whole disk** — a test run read `~/.ssh/known_hosts`. Never grant bare Read/Glob/Grep; reads inside cwd + `--add-dir` already work without it.
- Claude Code **auto-allows read-only shell commands** (`echo hi` ran with no grant). "No Bash" must be an explicit deny of `Bash`/`PowerShell`.
- Custom keys like `headless_task_auth` in `settings.json` do nothing. DSH must hold the grant and translate it into CLI flags.

### Already built in the interactive session (Step 1 — keep or revert, user decides)
- `pm/brain-write.mjs` + MCP tool **`pm_brain_write`**: writes only under `reports/` and `prompts/`, `.md/.json/.txt`, refuses traversal and symlinks/junctions, refuses overwrite unless the caller passes the sha256 it read (`EXISTS` / `CONFLICT`), atomic, audited in `pm-data/brain-write-audit.jsonl`.
- `workers.mjs`: `bridge-policy.json` `headless_tools` → `--allowedTools`; `headless_deny` → `--disallowedTools`. Read from policy only, never from the message body.
- Grant v3 in `bridge-policy.json` (backup `bridge-policy.json.bak-20261012-perm`): pm reads + task-record writes + `pm_brain_write`; denied: Bash, PowerShell, `.ssh`, `.aws`, `.gnupg`, bridge tokens/peers, `pm-remote.env`, `.credentials.json`, `.codex/auth.json`, `dsh-credentials.enc`, `fleet/secrets.json`; excluded: pm run control (prepare/start/amend/stop/archive) and create_project.
- Evidence: bridge tests 35/35, pm tests pass, broker 9/9, live headless smokes v1–v3 (seq 444, 462, 477).
- **ndi2 only.** vmixer2o2 has its own pm and policy file and has none of this.

---

## Part B — Design gaps v1 did not address (the rewrite must decide these)

1. **Q4 "pause and ask" cannot pause a `claude -p` process mid-run.** A denied tool returns to the model as an error and the run continues or ends. A real pause has to be: the run ends with `PERMISSION_REQUIRED` + the exact grant needed → PM records an approval request → on approval, the bridge resubmits with `--resume <session id>` (workers.mjs already supports `body.resume_session`). The rewrite should specify this flow.
2. **Q2 "central across machines":** bridge *messages* replicate between hosts; `bridge-policy.json` does **not**. Grant distribution, versioning, revocation and fail-closed on vmixer are new work, not a config change.
3. **Q8 one retry vs current code:** workers.mjs says claude-code runs are "never auto-retried after a lost lease". The rewrite must say whether Q8 changes that, and which failures count as transient.
4. **Q5 "write both":** repo writes need (a) the repo path added to `BRIDGE_EXEC_ROOTS`, (b) path-scoped `Edit(<repo>/**)` / `Write(<repo>/**)` allows, (c) a rule for which repos. Repos outside `~/.claude` do not hit the sensitive-file check, so the broker is needed only for the brain.
5. **Q7 "always notify":** ChatGPT cannot be pushed to; notices can only land in the bridge inbox + pm events. State that limitation.
6. **Q6 merge with review:** the broker's sha256 check gives detection; the merge-proposal + reviewer step is still unbuilt.
7. **Which repos and projects** are "approved" for Q1/Q5 is never named. List them.
8. **Approval proof for headless runs:** decide how a headless run verifies user approval (e.g. a pm approval record with id, approver and expiry referenced by the bridge message) so #415's refusal does not repeat.

---

## Part C — Recommended structure for the rewritten prompt

- **One step per session.** Each step is its own prompt with an exit condition. The agent stops and reports after each step and waits; it does not chain Steps 1→4 in one run.
- **Step 1 — Verify / keep Step 1 build** (above). Decide keep vs revert; if kept, replicate the grant to vmixer2o2 and run the same smoke there.
- **Step 2a — Grant model + PM approval records** (Q1, Q2, Q3): grant schema, issuer, version, expiry, revocation, distribution to registered machines, fail closed.
- **Step 2b — Pause/resume + retry + notify** (Q4, Q7, Q8) using the `--resume` flow in Part B.1.
- **Step 2c — Repo writes + conflict review** (Q5, Q6) for the named repos only.
- **Step 3 — Cross-machine tests** (the v1 list stays valid; add: bare-Read leak test, shell-auto-allow test, `~/.claude` direct-Write denial, resume after approval).
- **Step 4 — LinkedIn source recovery:** first ask ChatGPT/user for the Q1–Q35 answers (likely in a ChatGPT chat). If not supplied, write `MISSING_SOURCE` and stop. No LinkedIn review until the source exists.

## Part D — Keep from v1 unchanged
- Q1–Q8 decision table (Q4 = A pause-and-ask, Q8 = B one retry).
- Safety boundaries: no git push, deploy, credential change, purchases, outreach, LinkedIn access.
- LinkedIn terminology rules (agent-assisted actions, API-assisted actions when possible, user-directed agent; allowlist/denylist, coordinator/worker, conflict flags).
- Agents name their model in every report.

## Part E — Open questions from Claude Opus 5.5 (ChatGPT: compile, go over with the user one at a time, A/B/C/D, then rewrite)

Recommended option marked (Rec). Answers feed directly into the rewritten prompt.

**E1. Step 1 build on ndi2** (broker + grant v3, already live)
A) Keep as is (Rec) · B) Keep, but narrow pm writes to comment + artifact only · C) Revert to backup · D) Keep, and also replicate to vmixer2o2 now

**E2. Where are the LinkedIn Q1–Q35 answers?**
A) In a ChatGPT conversation — ChatGPT pastes them into a brain file first (Rec) · B) In a file on ndi2/vmixer (user gives path) · C) They were never finished — restart the questionnaire · D) Drop Step 4 for now

**E3. Which project repos may headless runs write to (Q1/Q5)?**
A) Only a sandbox repo until Step 3 passes (Rec) · B) deepseek-harness only · C) A named list (user supplies) · D) Any repo under ~/Documents/claudecode

**E4. How should Q4 "pause and ask" work, given `claude -p` cannot pause mid-run?**
A) Run ends with PERMISSION_REQUIRED → pm approval record → resume same session with `--resume` (Rec) · B) Run ends; a fresh run starts after approval · C) Preflight only: block before launch, never mid-run · D) A + C together

**E5. How long does a pending approval wait before the task is cancelled?**
A) 24 hours (Rec) · B) 1 hour · C) 7 days · D) Never expires

**E6. How does a headless run know the user really approved a task (the #415 refusal)?**
A) pm approval record (id, approver, expiry) referenced in the bridge message (Rec) · B) Signed capability token issued by pm · C) Only interactive sessions may start approved work · D) Trust ChatGPT's statement in the message

**E7. Who may approve elevated grants (Q3)?**
A) Only the user, in an interactive Claude session or the pm UI (Rec) · B) The user via ChatGPT relay · C) Either A or B · D) Any admin-role agent

**E8. Q8 one retry vs the existing rule "claude-code runs are never auto-retried after a lost lease"**
A) Retry once only for API errors/quota 429/crash before any tool write; never after a write (Rec) · B) Q8 overrides the rule fully · C) Keep the no-retry rule; Q8 applies only to transport delivery · D) Retry once, any failure

**E9. Default grant scope**
A) Per project, explicit list (Rec) · B) One global grant for all projects (current v3 is project `*`) · C) Per agent · D) Per task

**E10. Grant expiry default**
A) 30 days, renewable (Rec) · B) 7 days · C) 90 days · D) No expiry, revoke manually

**E11. Brain write roots for `pm_brain_write`**
A) `reports/` and `prompts/` only (Rec, current) · B) Add per-project folders (e.g. `projects/<name>/`) · C) Add handoff notes (`handoff-*.md`) · D) B + C

**E12. Shell for tests in Step 2c/3**
A) Allow only scoped commands, e.g. `Bash(node --test:*)`, `Bash(npm test:*)` in approved repos (Rec) · B) No shell ever; interactive sessions run tests · C) Full Bash inside approved repos · D) Decide per task via pause-and-ask

**E13. Distributing grants to vmixer2o2 (Q2)**
A) pm replication over the existing bridge peer link, fail closed when unreachable (Rec) · B) Brain git sync of a grants file · C) Manual copy per machine · D) vmixer gets no headless grants

**E14. Completion notices (Q7)**
A) Bridge inbox to chatgpt + pm event, labelled "not pushed live" (Rec) · B) A + Windows desktop notification on ndi2 · C) A + email · D) pm event only

**E15. Model and budget for headless implementation runs**
A) Sonnet, $2 cap per run, stop and ask above it (Rec) · B) Haiku for smoke/tests, Sonnet for code · C) Opus for code · D) Router decides, no cap

**E16. Session structure**
A) One step per session, stop and report after each (Rec) · B) Steps 1–4 in one session with checkpoints · C) Step 2 a/b/c as parallel headless runs · D) ChatGPT decides per step

**E17. Housekeeping**
A) Delete the two `reports/permission-smoke/` files and ack the old bridge backlog (seq 3–322 test traffic) (Rec) · B) Keep smoke files as evidence, ack backlog · C) Leave both · D) Delete smoke files only
