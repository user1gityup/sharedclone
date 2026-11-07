---
name: handoff-2026-10-15-0925-pm-review-user-notes
description: PM UI/UX P-fb8f4161 - run T-67ba9f12 produced 0 samples because the write gate never opened (go sent as dialog answer); seats never called; PAUSED
metadata:
  type: project
---
Id: handoff-2026-10-15-0925-pm-review-user-notes
Updated: 2026-10-18T00:00Z
Host: vmixer2o2
Session: side session of local_21732447 (seat probes), released 13:03Z on quota-handoff trigger (26.6h, approval wait 10:25Z->13:00Z); prior: side session local_21732447
Probes (10-16/17, Claude Opus 5.5, tiny prompt "Reply with exactly: OK", DSH argv, cwd ~/.dsh/seat-cwd, script scratchpad probe.mjs): ci-kimi PASS 4.2s HTTP 200 "OK" (key NOT in process env; DSH loads CHEAPERINFERENCE_API_KEY from ~/.dsh/.credentials.yaml); openai PASS 7.7s "OK" (codex 0.153.4, gpt-6-astra, read-only sandbox); claude-fable exit 0 18.8s but OFF-TASK: SessionStart brain hook fires in seat-cwd, model answered with bridge/handoff summary + "What is the task?" instead of OK -> seat prompts get hijacked by hook context (likely why fable/claude reply without files); agy-gemini-pro NOT PROBED (stopped by quota trigger). Rerun NOT started (user 10:50Z: no new run).
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5, side session local_21732447
Ask: ndi2 T-26b4ca91 comment #281 (user-approved): 6 working samples = 3 hybrid styles + 3 hybrid-with-arrows styles; guides = Run B claude-sonnet-5 hybrid.html (layout) + Run A claude drag.html (move highlight); Q1-Q3 = D; user: claude seat only, headless
Record: ndi2 pm T-26b4ca91 (P-fb8f4161) has comment #280 pointing to mirror; do NOT start the ndi2 prepare
Run task: vmixer pm T-67ba9f12 PAUSED; DSH run 0ab5bd19 stopped 05:41:47Z by watcher at cap (user rule: 10-min cap, no rerun); seat flags restored; session session-d14ad146-f741-4bc8-aae6-d628bc546a5b
Prepared: stages sample,select; council agy-gemini-pro,cheaperinference(deepseek-v4-pro),ci-kimi(kimi-k3),openai,claude,claude-fable = 6 seats x 3 = 18 samples; swarm none; cwd ~/Documents/claudecode/dsh-runs/pm-ui-samples-T-67ba9f12 (samples land in .dsh-staging/<seat>/)
Request: produce-only/no-voting header; inline PM context, no READ (one call per seat); drag/numbered/hybrid.html; 270s per call, <10 min run; no reruns
DSH settings (~/.dsh/settings.yaml, backups pre-t26b-*, pre-cikimi-*): enabled agy-gemini-pro, cheaperinference model deepseek-v4-pro, claude-fable; extraSeats.ci-kimi; timeoutMs back to 600000; NEW council.seatTimeoutCeilingMs 270000 (clear to 0 after run)
pm code: actions.mjs missingRoster - named stages without swarm need no swarm roster; test added; 30/30 + all *.test.mjs green; deployed vmixer (brain commit 8a6cc9fb, not pushed); reaches ndi2 at next push+deploy
Memory: feedback_runs_on_vmixer.md + index line
Harness (deepseek-harness feat/heterogeneous-teammates, UNCOMMITTED): seats.ts new builtin claude-fable (main account, --model claude-fable-5-1; probe FABLE-OK) + setSeatTimeoutCeiling (seat own cap was overriding council timeoutMs - the 270s cap never applied before); index.ts seatTimeoutCeilingMs config, set per stage; capacity.ts roster; tests; tsc 0, council+budget vitest 1008/1008. claude-work account out of credits. DSH restarted (pid 35116), web bundle not rebuilt.
Result: DIAGNOSED 09:41Z. 0 samples = sandbox gate never opened, no seat ever called. Journal: 04:49:30 pipeline -> "Error: Approve workspace-write in this session and send exactly go before running a proposing round."; agent then asked via ask_user_question; 05:31:18 /permission workspace-write -> "Send exactly go... Until then this session stays read-only"; 05:31:30 go arrived as ask_user_question answer {custom:"go"} = tool result, not a user message; sandbox-policy/src/index.ts:138-140 only opens on last source.kind===user message === go -> mode stayed read-only; 05:32:13 pipeline same error in 143ms (tool-council index.ts:1065); 05:32-05:37 FCC claude-sonnet-4 stream idle timeout 300000ms, retry, 05:39:02 turn ended with text telling user to send go. .dsh-staging never created; run dir empty. seatTimeoutCeilingMs 270s irrelevant (no seat ran).
Rerun risk: DSH quota-hold (pipeline.ts ~417) re-runs an unfinished stage; if run lands held, pm stop it
Bridge: 59 unacked for claude-code incl seq 548/549 OCTEST; not acted on
Remote Control: off
Uncommitted: brain edits (auto-synced); ~/.dsh/settings.yaml edits (not in git)
Next: user decides: rerun with guide file contents inlined (no READ) or split 6 files over 2 calls; diagnose claude seat reply from council journal first
Fix options: (a) after /permission workspace-write, user types go as a plain chat message, not in the ask dialog, then pipeline; (b) harness: forbid ask_user_question for the go gate in the policy prompt, or accept a go answer to a gate question as confirmation; (c) pm driver headless gap: pm/driver sends /permission workspace-write + a user-sourced go message before the pipeline prompt. Any rerun needs user word.
Rerun: 2 reruns ran from other sessions (staging 2e9db8fb 09:58Z, 047b0e01 10:03Z; DSH last stopped d6a2342f); 12 html: cheaperinference 3+3, claude 3+3; agy-gemini-pro, ci-kimi, openai, claude-fable 0. User 10:50Z: no new run.
Gallery: dsh-runs/pm-ui-samples-T-67ba9f12/gallery.html served by launch.json pm-samples-gallery (npx http-server :5199), all 12 iframes render. DSH select stage not reachable: both runs stopped, select only runs inside a live pipeline (tool-council index.ts:2508). Probe session session-aa74d758 idle, read-only.
Brief: mirrored verbatim to vmixer T-67ba9f12 as instruction #42; ChatGPT replied seq 551, Claude ack seq 552
Launch: DSH run 6023e8fe sample stage 03:06-03:13Z (460s): 0 files. Pipeline report: "claude - replied without proposing any file" (staging b747055a empty). Likely cause: request told seat to READ two guide files first; seat replied/asked instead of writing. stopped 03:19Z via pm driver dsh.stop (pm CLI refused: task PAUSED); roster restored; session 17a7d51e turn cancelled.
Parallel: backend ordering S1-S7 READY on vMixer pm; owned by Code-tab session local_a1f0a701 (pm-ordering-backend), waiting on user swarm seat pick for wave 1 (S1,S2,S5)
Do not repeat: Q56 merges; 60 decisions; parallel-401 theory. No push.
