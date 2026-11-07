---
name: handoff-2026-10-31-0650-llama-fcc-seat-holdout
description: pm T-4546488d - free-claude held out by 20s DSH probe (fixed 205cfbbf14), llama 70k prompt overflow open
metadata:
  type: project
---
Handoff id: handoff-2026-10-31-0650-llama-fcc-seat-holdout
Time: 2026-10-31 06:50Z. Host: vmixer2o2. Model: Claude Opus 5.5 (claude-opus-5-5).
Session: side session of local_8328e5e0 (idle-flow review). Remote Control: off.
Owner 2026-10-31 15:13Z: Claude Opus 5.5 (side session local_1ce89694 child, vmixer2o2) claimed; verified router 22496, slot n_ctx 65536, FCC 35052, DSH web 31564 live before edits.
Ask: pm T-4546488d - local LLM + Free Claude not responding via DSH/PM; root-cause, fix, prove one live call per seat.
Live 06:35Z: llama router pid 22496 :8090 (Qwen child :59634, ctx 65536, idle); FCC pid 35052 :8082 (start 10-30 18:50Z). Both up.
Cause 1 (fixed): DSH probeSeatLive gave free seats 20s for one token; FCC measured 30-50s (retries free NIM/Gemini) -> free-claude "held out" of every run (x15 in D:\nvr\scripts\doorbell\push\RUN-20261030-00{2,3}.out.log).
Fix: deepseek-harness 205cfbbf14 (feat/heterogeneous-teammates, LOCAL, not queued): SeatConfig.probeTimeoutMs, free-claude 120000. Tests 938/938, tsc clean. tool-council lib rebuilt alone via `npx tsdown --env.DSH_BUILD_FACE host -F @deepseek-ai/dsh-tool-council` (backup lib/index.js.bak-probefix-20261031; diff = only this change). lib is untracked build output.
Proof 06:45-06:46Z (lib resolveSeats + src probeSeatLive/askSeat): llama probe 81ms PASS, "SEAT-OK llama-local" 5.4s; free-claude probe 34.9s PASS, "SEAT-OK free-claude" 4.8s.
Cause 2 (FIXED 15:16Z, ctx raised): RUN-20261030-003 planning prompt 70969 tok > llama n_ctx 65536 -> HTTP 400 exceed_context_size_error. No DSH per-seat context guard. User pick: raise ctx in D:\dev\tools\launch\models.ini (VRAM/reload) vs DSH guard that skips/trims a local seat.
Caution: NIM 429s if FCC probed back-to-back (my rapid test 06:40Z). Normal one probe per run is fine.
Not done: full DSH pipeline run / PM-invoke layer not exercised; running DSH web pid 31564 holds old lib until restart; ndi2 untouched.
Other sessions' uncommitted harness work untouched: dsh-run.mjs, llm-claude-cli/*, quota-contract/.
pm: comment + checkpoint/next_action on T-4546488d (status left in_progress).
User decision (2026-10-31): "Raise llama ctx" - raise Qwen3.6-35B ctx-size above 65536 (target >=131072) in D:\dev\tools\launch\models.ini. Not started: quota-handoff stop (8.6 h session, 92% week).
Done 15:16-15:43Z (Claude Opus 5.5): models.ini Qwen c 65536->131072 (backup models.ini.bak-ctx-20261031; KV stays q8_0, the real value, not q4). Router reloaded via llama-control stop/start -> pid 46472 :8090, child :56410; /health ok, /slots n_ctx 131072, VRAM 7624-7739/8192 MiB.
Proof: 72,772-token prompt via lib resolveSeats + src routeLocalSeat/askSeat -> "PASSPHRASE=CTX-PROOF-71K-ORCHID" in 843.6s (test-only cap 2700000; 32,768 tokens reused from cache). Script: scratchpad big-prompt.mts.
Seat cap (FIXED 18:18Z): user pick "C. Raise to 30 min, large only". f8afd43a98 (LOCAL, not queued): SeatConfig.largePromptChars/largeTimeoutMs + seatCallCap; llama-local >=60000 chars -> 1800000ms, else 600000. 940/940, tsc clean. lib rebuilt via `tsc -p packages/council/tool-council` then `tsdown -F` (tsdown bundles lib/types; without tsc emit it rebuilds old code). Backup lib/index.js.bak-largecap-20261031.
Live (real config): normal 'NORMAL-OK llama-local' 7.9s @600s; cold 72,660-token 'KEYWORD=LARGECAP-1800-HERON' 1520.3s @1800s. Scripts: scratchpad cap-live.mts.
Pending: DSH web 31564 not restarted (10 runs RUN-20261031-017..026 live 18:19Z); killing web makes fcc-session.cjs stop FCC/llama/cluster; relaunch = ~/.dsh/launch-dsh.cmd. Router now pid 43756 (restarted 17:53Z to clear an abandoned prefill). pm T-4546488d rev 6.
User pick 2026-10-31: "C. Raise to 30 min, large only" - llama-local seat timeout 1800 s for runs flagged large, 600 s for all others. Relayed to child local_8985d44d to implement.
FCC EOL 21:44Z (reported by session 168a45d8, not re-verified here): POST :8082/v1/messages -> 410 after ~36 s; NIM "z-ai/glm-5.3 reached end of life 2026-10-28". 10 runs (RUN-20261031-017, 020-022, 024-029, lane fcc-only) hold free-claude out. CheaperInference 402 insufficient_balance 21:46Z. User ask (relayed): "Remap FCC model".
Next: remap FCC opus/sonnet/haiku to a live free NIM model, prove one-token /v1/messages 200, resume the 10 runs, refresh Flow Pac (see handoff-2026-10-31-0555-flow-pac-idle-resolution.md); then restart DSH web; queue 205cfbbf14 + f8afd43a98 at session end.
Do not repeat: repo-wide build:lib would rebuild another session's uncommitted llm-claude-cli; use tsc -p tool-council + tsdown -F. llama does not cancel abandoned requests; a timed-out big call blocks the slot until router restart.
Side finding: runs 001-013 failed 15:23-15:44Z on llm-openclaw-chatgpt (page closed / composer), not llama/FCC.
