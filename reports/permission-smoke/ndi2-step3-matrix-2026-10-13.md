# ndi2 (vmixlaptop2x6) — DSH headless permissions Step 3 matrix (2026-10-13)

Author: Claude Opus 5.5, desktop session local_643cab47, ndi2. Live pm 127.0.0.1:4480, bridge.db `~\.claude\pm-data\bridge.db`.
Same 37 rows as `vmixer-step3-matrix-2026-10-13.md`.

Code under test: brain `pm/` at b5cd9644 (vmixer2o2, 04:33Z), which includes the 5ecc22c resume gate plus access/approvals/grants/notify/service work.
Pre-test finding: the handoff named pm pid 14532 as live; it started 04:27Z, before b5cd9644 reached disk (mtime 04:42Z), so it ran stale code. pm was restarted to load the current code; that restart is row 30.
Restarts (all with `running:[]`, watchdog pm-autostart.ps1 pid 656): 14532 killed 04:58:17Z, then 6584 at 04:58:32Z; 6584 killed ~05:00:30Z, then 27068; 27068 killed 05:01:23Z, then 18120 (current).
Not done: no edits under `pm/` or `bridge-policy.json`, no DSH runs, no reboot, no 2d install, no git.

"suite" = covered by the module test suites run on this host against the same code (11 files: 84/84; bridge 35/35; root 28/28). Those rows were not re-run as separate scripts.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | PM read | PASS | `node cli.mjs projects` lists P-156b6698 and the other projects |
| 2 | Broker write, each root | PASS | reports/, prompts/, projects/step3-smoke/ each returned `"replaced": false`, sha256 `348f14b8…` |
| 3 | Broker refusals | PASS | `path must be under reports/…`; `path traversal refused`; `needs an approved handoff_write approval_id` (with no id and with a bogus id); `only .md, .json or .txt`; `projects/ writes need projects/<name>/<file>`; `exists; read it and pass expected_sha256`; `changed since you read it` (CONFLICT); all audited `outcome:refused` |
| 4 | Dual write with provenance | PASS (live) | Was NOT IMPLEMENTED on vmixer. Results now carry `copy`; `~\.claude\pm-data\brain-copy\reports\permission-smoke\ndi2-step3-reports.md` has a provenance header (actor, model claude-opus-5-5, sha256) |
| 5 | Deny secrets | PASS (policy) | ndi2 `bridge-policy.json` has 50 `headless_deny` entries, including ssh and Bash |
| 6 | Deny bare Read/Glob/Grep | PASS (policy) | 14 `headless_tools`; `Read` is not among them |
| 7 | Deny non-allowlisted shell | PASS (suite) | |
| 8 | Role baseline vs elevation | WIRED, live not run | Was NOT IMPLEMENTED. workers.mjs:133 now calls `resolveGrant` (permissions.mjs:46). It needs a run to exercise, and runs are forbidden |
| 9 | Grant revocation and expiry | PASS (suite) | grants.test.mjs |
| 10 | Offline peer fails closed | PASS (suite) | grants.test.mjs |
| 11 | PERMISSION_REQUIRED, approve, same-session resume | PASS (suite) | lifecycle/permissions tests. Live not run (no runs allowed) |
| 12 | Resume refused unless approved | PASS (suite) | `approvalValid` is present in live workers.mjs and permissions.mjs; forged-approval test passes |
| 13 | Indefinite pause survives a pm restart | PASS (live) | run `step3-ndi2-park`, approval `e0323e70-1c94-4c1f-81d6-4451f92ae7ac`: before the 05:01:23Z kill and 25s after restart, `awaiting_approval`, `pending`, `updated_at` unchanged at `05:01:22.331Z` |
| 14 | One retry, then no second | PASS (suite) | |
| 15 | No retry after a write | PASS (suite) | |
| 16 | Merge proposal on same-file edit | PASS (live) | `propose-merge` gave `status: proposed`, id `d3a23213-bd34-42be-97d1-83e3ffbf3884`, diff `-b +c`; file not overwritten |
| 17 | Notices for success, failure, cancel and park | PASS (suite) | notify.test.mjs |
| 18 | Windows toast | WIRED, live not run | Was NOT IMPLEMENTED. bridge/index.mjs:52 now passes `notifyFanout(queue)`. The toast goes to `notify-toast.jsonl`, and a native toast shows only with `PM_TOAST=1` |
| 19 | Bridge-inbox fanout | WIRED, live not run | Same wiring (permissions.mjs:76) |
| 20 | Reboot recovery | PASS (live) | user reboot 2026-10-13, boot 22:37:03 local. pm came up as pid 19188 (session 0, from the boot task) at 22:37:53; health ok, running 0, dispatched 0, backlog_not_replayed 0; bridge queue counts and rev 604 identical to before the reboot |
| 21 | MISSING_SOURCE vs denied | IMPLEMENTED (code) | workers.mjs:113 has a `MISSING_SOURCE` state; live not run |
| 22 | No backlog replay | PASS (live) | after restart, `dispatch: enabled true, after_seq 323, backlog_not_replayed 0, dispatched 0`, and the dispatcher ticked at 05:02:04Z |
| 23 | Worker/Client cannot approve | PASS (suite) | |
| 24 | Manager approves only within its grant | PASS (suite) | |
| 25 | Role check wired into the live approval path | PASS (live) | Was NOT IMPLEMENTED. `POST /api/bridge/approvals/e0323e70…/decide` with approver `step3-nobody` returned **403**; the same request over LAN 10.0.0.241 with no token returned **401**; the approval stayed `pending` |
| 26 | OTP single-use and expiry | PASS (suite) | |
| 27 | Replayed approval link refused | PASS (suite) | |
| 28 | ChatGPT-relayed decision never final | PASS (suite) | |
| 29 | Non-designated roles refused at the API | PASS (live, partial) | LAN `/api/projects` with no token returns **401**. Loopback `/api/projects` returns 200 by design (server.mjs:83, loopback has full access). Bridge-token principals are role-checked by `access.mjs authorizePm`; no token principal was tested |
| 30 | Kill pm, supervised restart | PASS (live) | 3 kills; the watchdog restarted pm within about 15s each time (autostart.log `pm down - starting` / `pm started, LAN` 21:58:32 local) |
| 31 | Restart with capped backoff | PASS (live + sandboxed copy) | 2026-10-13 05:40Z: the 2d pm-autostart.ps1 (vmixer transfer f9e66523) is applied live, with the mutex changed to `Global\`. A sandboxed copy (port 4499, failing fake server) logged backoff 5s, 10s, 20s. The task `\pm-autostart-watchdog` is installed: boot trigger, S4U (no password), no time limit, battery allowed. A manual task run (session 0) returned 0 and exited, because the session-1 watchdog (pid 31732) holds the Global mutex, so 1 watchdog remains |
| 32 | 2d boot: pm + bridge healthy without the logon session | PASS (live, partial) | the task ran at 22:37:26 and the watchdog (pid 3836, session 0) started pm in session 0. Auto-logon happened at 22:37:33, so a boot with no user signed in at all was not isolated |
| 34 | no duplicate watchdog | FAIL, then FIXED | after the reboot, the session-1 Startup watchdog (pid 4996) ran alongside session-0 pid 3836: the S4U-created Global mutex denied session 1 access (`Access ... denied`), and the constructor error did not stop the script. Fix in pm-autostart.ps1: the mutex grants the user SID explicitly (Open-WatchdogMutex), and an unopenable mutex counts as held (fail closed). Verified: the new code against the old session-0 mutex logs `mutex already held`; an explicit-DACL mutex opens from a second process with WaitOne False. 4996 was killed, leaving 1 watchdog. A cross-session rerun after the next boot is still pending |
| 33, 35, 36 | power loss, disable, rollback | NOT RUN | not exercised |
| 37 | Existing suites stay green | PASS | 84/84, 35/35, 28/28 |

## Counts
PASS 27 (12 live, 2 policy, 13 suite) · WIRED or IMPLEMENTED, live not run 4 (8, 18, 19, 21) · NOT IMPLEMENTED 0 · NOT RUN 6 (20, 32-36) · FAIL 0 — 37 rows (rows 32-36 count as 5).

## Fixed since vmixer's matrix
Rows 4, 8, 18, 19, 21 and 25 were NOT IMPLEMENTED on vmixer and are now wired in b5cd9644. The extra finding is also fixed: the CLI brain-write audit now records `"model":"claude-opus-5-5"`.

## Test rows left in live ndi2 bridge.db
- `bridge_runs` `step3-ndi2-park` (awaiting_approval, project `step3-smoke`) and its events.
- `approvals` `e0323e70-1c94-4c1f-81d6-4451f92ae7ac` (permission_resume, pending).
- merge proposal `d3a23213-bd34-42be-97d1-83e3ffbf3884`.

## Test files left
- brain: `reports/permission-smoke/ndi2-step3-reports.md`, `prompts/ndi2-step3-prompts.md`, `projects/step3-smoke/ndi2-step3-projects.md`
- copies of the same three files under `~\.claude\pm-data\brain-copy\`.

— Claude Opus 5.5
