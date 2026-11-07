# vmixer2o2 — DSH headless permissions Step 3 matrix (2026-10-13)

Author: Claude Opus 5.5 (subagent, vmixer2o2). Live pm 127.0.0.1:4480, bridge.db `~\.claude\pm-data\bridge.db`.
"module-level" = node script against `:memory:` / temp-dir DBs and a temp brain, using the real pm modules and the real `permissions.mjs` wiring (`workerPermissions`), with a fake `claude` binary (script `step3-module.mjs` in the session scratchpad).
Nothing under `pm/` or bridge-policy edited; no DSH runs, no bridge messages, no reboot, no git. One pm restart: pid 51456 killed 02:50:16Z while `running:[]`; watchdog started pid 40824 at 02:50:22Z.

Live config facts: **`~/.claude/pm-data/bridge-policy.json` does not exist on vmixer2o2** (`GET /api/bridge/policy` returns only delivery defaults: no `headless_tools`, no `headless_deny`, no `dispatch`); `PM_BRAIN_COPY_DIR` unset; `BRIDGE_EXEC_ROOTS` unset; live `grants`, `approvals`, `role_assignments`, `notify_events`, `bridge_runs` tables existed and were empty before this test.

| # | Item | Command run | Result | Evidence |
|---|---|---|---|---|
| 1 | PM read | `node cli.mjs projects` | PASS | `P-2106af0a  dsh-bridge  0/4 done` |
| 2 | Broker write, each root | `node cli.mjs brain-write reports/permission-smoke/step3-root-reports.md …`, `prompts/step3-root-prompts.md`, `projects/step3-smoke/step3-root-projects.md` | PASS | each `"replaced": false, "sha256": "33af5f27…"` |
| 3 | Broker refusals | brain-write `rules/step3-x.md`, `reports/../step3-x.md`, `handoff-step3-x.md` (no / bogus approval_id), `…/step3-x.exe`, `projects/step3-x.md`, rewrite without sha, rewrite with bad sha | PASS | `path must be under reports/, prompts/, projects/<name>/…`; `path traversal refused`; `needs an approved handoff_write approval_id`; `only .md, .json or .txt`; `projects/ writes need projects/<name>/<file>`; `exists; read it and pass expected_sha256`; `changed since you read it; merge for review` (CONFLICT); all `"outcome":"refused"` in brain-write-audit.jsonl |
| 4 | Sandbox write / dual write with provenance | live: results of row 2; module: `brainWrite(…, {copyDir})` | NOT IMPLEMENTED (live) | live results carry no `copy` field: `PM_BRAIN_COPY_DIR` is not set for the CLI/MCP process, so no sandbox/repo copy is made. Module-level works: `{"copy":"reports/step3-a.md","header":"<!-- provenance: {\"actor\":\"claude-code\",\"model\":\"claude-opus-5-5\",\"run_id\":null,…"}` |
| 5 | Deny secrets | live: `curl /api/bridge/policy`; module: worker spawn log with temp policy | PASS (fixed) | Was FAIL: no live policy. 2026-10-13 Claude Opus 5.5 [eede39] installed ndi2 policy v3 (user: copy it; machine set to vmixer2o2; dispatch on, after_seq 295). Worker spawn against the live file: `{"deny_count":50,"deny_has_ssh":true,"deny_has_bash":true}` |
| 6 | Deny bare Read/Glob/Grep | same as 5 | PASS (fixed) | Was FAIL: no policy. Live spawn now `{"allow_count":14,"bare_read_granted":false}` (only mcp__pm tools) and Read/Glob/Grep/Edit/Write denied on secret paths; Bash/PowerShell denied |
| 7 | Deny non-allowlisted shell | module: spawn args | PASS (module-level) | `--disallowedTools …,Bash(*)` emitted from policy; live not exercisable without starting a run (forbidden) |
| 8 | Role baseline vs elevation | module: `resolveGrant` worker vs manager | NOT IMPLEMENTED (live) | module: `grant_role_manager_not_inherited null`, worker grant resolves. Live workers never call `resolveGrant` / C1 grants; tools come only from policy `headless_tools` (workers.mjs:116-124) |
| 9 | Grant revocation and expiry | module | PASS (module-level) | `grant_after_revoke null`; `grant_expired_31d null`; wildcard project refused (`'*' is not allowed`). Not enforced on live runs (row 8) |
| 10 | Offline peer fails closed | module: `resolveGrant({peers:['ndi2']})` | PASS (module-level) | unconfirmed → `null`; after `confirmReplication` → resolves. Not enforced live (row 8) |
| 11 | PERMISSION_REQUIRED → approve → same-session resume | module: real `workerPermissions` wiring + fake claude | PASS (module-level) | parked `{"state":"awaiting_approval","approval_status":"pending","kind":"permission_resume","scope_project":"bridge"}`; after `decideApproval(approved)`: `{"state":"completed","same_session":true,"resume_flag":true}` (`--resume <session>` in spawn log). Live NOT RUN (no runs allowed) |
| 12 | Resume refused unless approval is approved | module: resume submit with the still-**pending** approval_id | PASS (fixed) | Was FAIL: `{"state":"completed",...,"approval_status":"pending"}`. Fixed by dsh-sandbox 5ecc22c (workers.mjs `approvalValid`, fail-closed; permissions.mjs binds kind permission_resume + run_id + isApprovalValid), applied live, pm restarted (pid 16904). Re-run 2026-10-13 Claude Opus 5.5 [eede39]: `{"state":"awaiting_approval","same_session":true,"approval_status":"pending"}`; approved path still `completed`, same session |
| 13 | Indefinite pause survives a pm restart | live: `step3-park-live` run + approval created in bridge.db via lifecycle/approvals modules; pm server killed; watchdog restart | PASS | before: `{"state":"awaiting_approval","approval_id":"429fdc53-b08d-4d0f-a3a6-896d0cf0cef8","approval_status":"pending"}`; after restart (+8s, dispatcher tick 02:50:49Z): identical, `updated_at` unchanged `02:49:56.171Z` |
| 14 | One retry, then no second | module | PASS (module-level) | `{"state":"failed","retries":1}` after a second retry submit |
| 15 | No retry after a write | module (fake emits `Write` tool_use then exits 1) | PASS (module-level) | `{"wrote":1,"retries":0,"state":"failed"}` |
| 16 | Merge proposal on same-file edit | live: `node cli.mjs propose-merge reports/permission-smoke/step3-root-reports.md --base a --ours b --theirs c` | PASS | `"status": "proposed"`, diff `-b +c`, id `4a7ffc34-9094-4a98-b3fb-95932d374e88`; file not overwritten |
| 17 | pm notice for success / failure / cancel / park | module: `notify.list` after runs | PASS (module-level) | `["awaiting_approval","cancelled","completed","failed"]`; cancel → `cancelled`. Live `notify_events` = 0 (no runs) |
| 18 | Windows toast | code read: bridge/index.mjs:51 `workerPermissions(queue.db)` passes no toast | NOT IMPLEMENTED | injectable hook only; with an injected fn: `["awaiting_approval","cancelled","completed","failed"]`; no real toast connected live |
| 19 | Bridge-inbox fanout per terminal state | code read: same call passes no `bridgeInbox` | NOT IMPLEMENTED | `workerPermissions(db, { toast = null, bridgeInbox = null })` called with defaults |
| 20 | Reboot recovery | none | NOT RUN | reboot forbidden for this test; row 13 covers process restart only |
| 21 | MISSING_SOURCE vs denied | `grep -rn MISSING_SOURCE pm --include=*.mjs` | NOT IMPLEMENTED | no matches; no distinct MISSING_SOURCE result path exists |
| 22 | No backlog replay | live `GET /api/bridge/health`; `node bridge/test.mjs` | PASS | live `"dispatch":{"enabled":false,"after_seq":0,"backlog_not_replayed":0,"dispatched":0}`; suite test "dispatch: backlog before after_seq is not replayed; disabled dispatch runs nothing" passes |
| 23 | Worker/Client cannot approve | module: `decideApproval(…, {authorize: roles.assertAllowed('approve')})` | PASS (module-level) | worker `FORBIDDEN`, client `FORBIDDEN`; `allowedApprovalMethods` worker/client `[[],[]]` |
| 24 | Manager approves only within its grant | module | PASS (module-level) | in scope (p1) `approved`; out of scope (p2) `FORBIDDEN` |
| 25 | Role check wired into the live approval path | module: `decideApproval` as live wiring would call it (no `authorize`) | NOT IMPLEMENTED | identity `step3-nobody` with no role → `approved`; permissions.mjs never passes `authorize`, and no pm HTTP/CLI endpoint decides approvals at all |
| 26 | OTP single-use and expiry | module | PASS (module-level) | first use `approved`; reuse `INVALID_PROOF`; past TTL `EXPIRED` |
| 27 | Replayed approval link refused | module | PASS (module-level) | replayed token → `INVALID_PROOF` |
| 28 | ChatGPT-relayed decision never final | module `proof:{via:'chatgpt'}` | PASS (module-level) | status `pending_user_confirm` |
| 29 | ChatGPT-browser endpoints refused for non-designated roles at the API | live: `curl` /api/approvals, /api/grants, /api/roles, /api/notify, /api/bridge/settings → 404; /api/projects → 200 unauthenticated | NOT IMPLEMENTED | no role/identity check on pm HTTP. Module `assertAllowed('browser_control')`: worker/client/openclaw `FORBIDDEN`, admin and manager(p1) allowed |
| 30 | Kill pm → supervised restart | live kill of pid 51456 | PASS | autostart.log `19:50:21Z pm down - starting` / `19:50:22Z pm started, LAN`; health ok, new pid 40824 |
| 31 | Restart with capped backoff (5s→10m) | `grep backoff pm/pm-autostart.ps1` | NOT IMPLEMENTED (live) | live watchdog sleeps a fixed `$IntervalSeconds`/10s; backoff exists only in the uninstalled 2d draft |
| 32 | 2d: boot with no user logged on → pm + bridge healthy | none | NOT RUN | needs reboot + Task Scheduler install (forbidden) |
| 33 | 2d: power loss → queue intact, no replay | none | NOT RUN | needs power loss/reboot |
| 34 | 2d: Gatekeeper start with pm running → no duplicate | none | NOT RUN | 2d scripts not installed (forbidden) |
| 35 | 2d: disable script → nothing starts at boot | none | NOT RUN | install/disable forbidden; needs reboot |
| 36 | 2d: rollback restores logon Startup entry | none | NOT RUN | rollback not run (forbidden) |
| 37 | Existing suites stay green | `node --test` on the 8 module test files; `node bridge/test.mjs`; `node test.mjs` | PASS | 54/54, 35/35, 28/28 pass, 0 fail |

## Counts
PASS 23 (10 live, 13 module-level) · FAIL 0 · NOT IMPLEMENTED 8 · NOT RUN 6 — 37 rows.

## Extra finding
- brain-write audit records `"model":null` for CLI writes even with `PM_MODEL=claude-opus-5-5` set (audit lines 02:47:24Z): the CLI does not pass the model through to `brainWrite`.

## Test rows left in live bridge.db (prefixed step3-)
- `bridge_runs` id `step3-park-live` (awaiting_approval, project `step3-smoke`) and its `bridge_run_events` rows.
- `approvals` id `429fdc53-b08d-4d0f-a3a6-896d0cf0cef8` (permission_resume, requested_by `step3-smoke@claude-opus-5-5`, scope.project `step3-smoke`, run_id `step3-park-live`, pending).

## Test files left in the live brain
- `reports/permission-smoke/step3-root-reports.md`, `prompts/step3-root-prompts.md`, `projects/step3-smoke/step3-root-projects.md` (30 bytes each).

— Claude Opus 5.5

## Re-run 2026-10-13 04:34Z - Claude Opus 5.5 [0e3b9e] after the NOT IMPLEMENTED build
dsh-sandbox integrate fa45449 applied live (live == sandbox except held pm-autostart.ps1; backup ~/.claude/pm-data/backup-pm-pre-fa45449). Live suites 28/28, 35/35, 84/84. pm restarted via watchdog with running:[]: pid 16904 -> 14080, health ok after 22s, dispatch unchanged (enabled, after_seq 295).

| # | Result now | Evidence |
|---|---|---|
| 4 | PASS (live) | `PM_MODEL=claude-opus-5-5 node cli.mjs brain-write reports/permission-smoke/step3-dualwrite-live.md ...` -> result `copy` field; `~/.claude/pm-data/brain-copy/reports/permission-smoke/step3-dualwrite-live.md` starts `<!-- provenance: {"actor":"Claude Opus 5.5","model":"claude-opus-5-5",...} -->`. Extra finding fixed: audit line now `"model":"claude-opus-5-5"` |
| 8 | PASS (module-level); wired live | workers `resolveGrant` (permissions.mjs: project or 'bridge', role worker, agent claude-code then remote, host) unions grant tools/deny with policy and logs `grant <id>` / `grant none (policy only)`; denied tools dropped from the allow list. bridge/grant-sources.test.mjs 8/8. Live run NOT RUN (no runs allowed); live grants table empty -> policy only |
| 18 | PASS (module-level); wired live | createBridge passes notifyFanout: toast -> `~/.claude/pm-data/notify-toast.jsonl`, native toast only with PM_TOAST=1 (off on vmixer). fanout-copy.test.mjs |
| 19 | PASS (module-level); wired live | bridgeInbox queues one `status` notice from `pm` to the run owner per terminal/parking state (deduped; never to claude-code/node). fanout-copy.test.mjs 11/11 |
| 21 | PASS (module-level) | body.sources: outside exec roots -> `SOURCE_DENIED` (checked first), absent -> `MISSING_SOURCE`; both before quota/router/run record, no spawn. Live submit NOT RUN (no runs) |
| 25 | PASS (live) | `POST /api/bridge/approvals/429fdc53.../decide` approver step3-nobody pm_ui -> `{"error":"step3-nobody may not approve this scope","code":"FORBIDDEN"}`; approval still `pending`. access.test.mjs 10/10 (worker/client 403, admin approves, manager in-scope only, token principal -> pending_user_confirm) |
| 29 | PASS (live + module) | live: unknown bearer on `/api/projects` -> 401, loopback 200, proxied challenge -> 401; module: chatgpt token with no role -> 403, client GET 200/POST 403, worker POST actor forced to `chatgpt`. Live role_assignments empty (no roles seeded: admin identity not named by the user) |
| 31 | NOT IMPLEMENTED (unchanged) | watchdog backoff lives in the held 2d draft |

Counts now: PASS 30 (13 live, 17 module-level) · FAIL 0 · NOT IMPLEMENTED 1 (row 31, 2d held) · NOT RUN 6 - 37 rows.
New test file in the live brain: `reports/permission-smoke/step3-dualwrite-live.md` (+ its brain-copy).
