---
name: handoff-2026-10-31-0650-llama-fcc-seat-holdout
description: pm T-4546488d - free-claude held out by 20s DSH probe (fixed 205cfbbf14), llama 70k prompt overflow open
metadata:
  type: project
---
Handoff id: handoff-2026-10-31-0650-llama-fcc-seat-holdout
Time: 2026-10-31 06:50Z. Host: vmixer2o2. Model: Claude Opus 5.5 (claude-opus-5-5).
Session: side session of local_8328e5e0 (idle-flow review). Remote Control: off.
Ask: pm T-4546488d - local LLM + Free Claude not responding via DSH/PM; root-cause, fix, prove one live call per seat.
Live 06:35Z: llama router pid 22496 :8090 (Qwen child :59634, ctx 65536, idle); FCC pid 35052 :8082 (start 10-30 18:50Z). Both up.
Cause 1 (fixed): DSH probeSeatLive gave free seats 20s for one token; FCC measured 30-50s (retries free NIM/Gemini) -> free-claude "held out" of every run (x15 in D:\nvr\scripts\doorbell\push\RUN-20261030-00{2,3}.out.log).
Fix: deepseek-harness 205cfbbf14 (feat/heterogeneous-teammates, LOCAL, not queued): SeatConfig.probeTimeoutMs, free-claude 120000. Tests 938/938, tsc clean. tool-council lib rebuilt alone via `npx tsdown --env.DSH_BUILD_FACE host -F @deepseek-ai/dsh-tool-council` (backup lib/index.js.bak-probefix-20261031; diff = only this change). lib is untracked build output.
Proof 06:45-06:46Z (lib resolveSeats + src probeSeatLive/askSeat): llama probe 81ms PASS, "SEAT-OK llama-local" 5.4s; free-claude probe 34.9s PASS, "SEAT-OK free-claude" 4.8s.
Cause 2 (OPEN): RUN-20261030-003 planning prompt 70969 tok > llama n_ctx 65536 -> HTTP 400 exceed_context_size_error. No DSH per-seat context guard. User pick: raise ctx in D:\dev\tools\launch\models.ini (VRAM/reload) vs DSH guard that skips/trims a local seat.
Caution: NIM 429s if FCC probed back-to-back (my rapid test 06:40Z). Normal one probe per run is fine.
Not done: full DSH pipeline run / PM-invoke layer not exercised; running DSH web pid 31564 holds old lib until restart; ndi2 untouched.
Other sessions' uncommitted harness work untouched: dsh-run.mjs, llm-claude-cli/*, quota-contract/.
pm: comment + checkpoint/next_action on T-4546488d (status left in_progress).
Next: user picks llama overflow route; restart DSH web to load lib; queue 205cfbbf14 via gatekeeper at session end.
Do not repeat: repo-wide build:lib would rebuild another session's uncommitted llm-claude-cli; use the -F filter.
