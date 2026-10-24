---
name: handoff-2026-09-29-1240-headless-dsh-gateless-runs
description: DSH runs driven from the CLI (dsh --profile headless) with autoApprove on; PM UI run in flight at council stage; Lead Intel then Ecomm next
metadata:
  type: project
---

Handoff id: H-20260929-vmixlaptop2x6-006
Status: CLAIMED 2026-09-29 12:45 UTC by Claude Opus 5.5, session 465a41f9 (ndi2, desktop). Prior session cee32ffd not reachable via ListAgents (no live peers).
Claim finding: PM run process was dead at claim (journal last write 12:42:30Z, no "=== exit" line, no node process) - killed with the prior session. Runner now has DSH_RESUME=1 mode (continue pipeline, no restart, no query); relaunched detached via Win32_Process.Create at 12:46:36Z so it survives session exit.
13:01Z: resume finished council (7 journaled answers reused) but swarm failed "Approve workspace-write in this session and send exactly go" - headless sessions pinned read-only by permission defaultPreset: read-only + sandbox-policy requireWriteConfirmation (no UI to confirm). Fixed in USER profile only (~/.dsh/profiles/headless/cordis.patch.yml): sandbox-policy requireWriteConfirmation false (confinedOnly kept), permission preset `headless` (workspace-write, approval never) as default. Smoke: ok.txt written, exit 0. PM resumed again ~13:10Z.
2026-09-29 20:03Z (Claude Opus 5.5, desktop session this chat): 13:08 swarm failed - free candidates staged 0 files, escalation went to claude-work = weekly limit (resets Oct 3 16:00 PDT). 13:42 resume crashed EPERM watch settings.yaml.lock (DSH web pid 32128 also writes settings). User ordered: claude seat on (main acct, 13% week), claude-work/kimi/cheaperinference off, openrouter-free added to swarm; paid = deepseek + codex, free do grunt work (feedback_dsh_seat_policy.md). Backup settings.yaml.pre-seat-policy-20260929-095056. NEW supervisor pm-ui-samples/queue-headless.cjs (detached pid 31768) runs PM(resume) -> 6 ecomm design runs -> lead-intel (last, stops at select gate); rotates failing seats via set-seats.cjs; status/log in pm-ui-samples/headless-queue/. Ecomm FINAL builds not queued (need user's design picks). run-headless.cjs now passes submit_to and supports DSH_LOG_DIR.
Harness bundle change (uncommitted): only agent-memory disable in packages/bundle/headless/cordis.patch.yml. The write-gate relaxation is deliberately NOT in the bundle (user decision).
Updated: 2026-09-29 12:40 UTC / 05:40 PDT
Host: vmixlaptop2x6 (ndi2)  Session: cee32ffd-45c6-499b-970c-e01d64b84fb5 (desktop, account 8aa17a70)  Model: Claude Opus 5.5
Remote Control: off in this session
Continues: local_3d3ecb7b (account a540ddf6, weekly limit, resets Oct 3 16:00 PDT) - plan agreed there: gate-free window, free+paid, budget $20

## Ask
Run all outstanding DSH work from the COMMAND LINE ONLY (no browser), with approval gates removed, in the user's order:
1. Project manager (pm/ui-samples)  2. Lead Intelligence (lead-intel/platform)  3. Ecomm (users/canna/commerce design + final builds).
User wants the PM samples PRESENTED IN CHAT when done. After headless is proven: commit the headless fix into the harness and queue it for the gatekeeper AND the public repo (dshklv1).

## Done and verified
- Archived this account's 6 open desktop sessions.
- ~/.dsh/settings.yaml: council.autoApprove=true; writer.repos += users/canna/commerce (target main); pipelineId cleared (parked lead-intel run abandoned). Backup: ~/.dsh/settings.yaml.pre-headless-autoapprove-20260929-053138. Only other diff = YAML flow-array reflow.
- Headless boot bug: dsh-base loads agent-memory, which waits on storageDomain that only web-app provides -> "1 entry did not activate". Fixed at PROFILE level: ~/.dsh/profiles/headless/cordis.patch.yml disables agent-memory. Smoke task then exit 0.
- Runner: ~/Documents/claudecode/pm-ui-samples/run-headless.cjs <presetId> <outDir> [stages]. Refuses if autoApprove off; writes QUERY.md, spawns apps/cli/lib/bin.js --profile headless with cwd=outDir (fixes the old wrong-write-root defect), logs to outDir/run.log.
- PM run launched 12:38:31Z, pipelineId f3863fc0-020f-40aa-9245-c13baf288cd4, stage council, stages council,swarm, mode economy. First council stage passed with no gate.

## Not yet proven
- Whether the swarm stage completes headless and the driver writes the 3 HTML samples into pm-ui-samples/. Not done at handoff.
- Lead Intel uses SWARM_SELECT_BUILD: its `select` stage needs the user's keep/pass per sample; autoApprove does not remove it. Present each sample to the user with selectable keep/pass.
- Ecomm presets pass submit_to canna/users/commerce -> host commits on a fresh branch + push queue (not pushed). Run each from its repo dir as outDir.

## 20:40Z state (Claude Opus 5.5): QUEUE STOPPED, nothing completed
Root cause (from journal ~/.dsh/council-runs/journal/f3863fc0-....jsonl): free seats DO produce design-spec.md content but none emit the `WRITE: <path>` + fence header that parseWriteRequests (tool-council/src/writes.ts:114) needs -> 0 staged files -> unit fails regardless of seat. free-claude: bare markdown doc; openrouter-free: "design-spec.md" line then fence; agy-*: write in their own IDE and reply "completed". Escalation to openai then hit "seat overall deadline exceeded after 180000ms". Seat rotation cannot fix this. Queue pids 31768/34748/18996 killed by me. pipelineId f3863fc0 still at stage swarm (resumable).
USER DECISION: lenient parser. Plan: in writes.ts/swarm-contest.ts produce(), when the unit names exactly one file and no WRITE block parsed, accept (a) a line that is just the target path followed by a fence, else (b) the single largest fenced block, else (c) the whole reply, as that file; keep the outside-target-list guard. Mind inner ``` fences in markdown bodies. Raise the swarm unit timeout for large single-file units (find where 180000 is set). Add spec tests, tsc, rebuild lib, verify in built lib/, then `node pm-ui-samples/queue-headless.cjs 0` detached (Win32_Process Create). Reset status.json strikes first (delete headless-queue/status.json).
COLLISION: session local_7fc95456 (AWS seat build, RC on) is editing/building tool-council right now - SendMessage it before touching tool-council; do not commit over its tree.

## Next action
Implement the lenient parser per the plan above (coordinate with local_7fc95456), then rerun the queue; present PM samples A/B/C in chat when DONE.
After proven: move the agent-memory disable into packages/bundle/headless/cordis.patch.yml (or add storage-domain to headless bundle), test, commit, queue via gatekeeper helper for harness and dshklv1.
At window end: restore autoApprove (from backup or set false), verify.

## Do not
Push; run two pipelines at once; restart the PM run while in flight; leave autoApprove on after the window.
