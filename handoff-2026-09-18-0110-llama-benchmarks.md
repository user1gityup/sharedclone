---
name: handoff-2026-09-18-0110-llama-benchmarks
description: "2026-09-18 01:10 open, unclaimed: run the real-LLM tests ndi2 asked for on the vMixer llama router (8090) and fill in real numbers — cold/warm tok/s, swap time, tool-call check, DSH provider path, report-table; wiring continues separately"
metadata:
  type: project
---

**Handoff id:** llama-benchmarks · **Status:** open, unclaimed · **Created:** 2026-09-18 01:10 · **Host:** vmixer2o2
**Written by:** Claude Opus 5 (claude-opus-5), Claude Code desktop session 7084d817 (peer name claudecode-81). It owns [[handoff-2026-09-17-2110-llama-dsh-wiring]] and keeps working on the wiring, not on benchmarks.
**Collaborators:** ndi2 Claude Opus 5, claudecode-77, bridge `session_01Q11MP2t46sgjS7sbFkGPVU` (Remote access setup). It records figures in machines.md. The moe-cache session claudecode-c6 owns [[handoff-llama-cpp-moe-cache-setup]] and `report-table.ps1`.

## Exact ask
User, 2026-09-18 01:0x: "lets move forward and keep working on the wiring but not waiting for final benchmarking lets come back to benchmark write a handoff for the benchmarking agent to add in real numbers later".
ndi2's request (claudecode-77, 2026-09-17 23:5x) wants **raw output, not summaries**:
1. Send a direct POST to `http://127.0.0.1:8090/v1/chat/completions` for Qwen3.6-35B-A3B-UD-Q4_K_M and lfm25-8b-a1b-Q5_K_M. Use the prompt "Write a TypeScript function that parses an ISO-8601 duration string; include tests", max_tokens 512, stream false, and run each model twice (cold, then warm). Quote model, usage.prompt/completion_tokens, timings.prompt_per_second/predicted_per_second, wall s, and whether `content` or `reasoning_content` carried the answer. Report swap time on its own.
2. The DSH path: send one call through the llama-local provider. The browser pane at http://127.0.0.1:3080 works for this: pick "Local: Qwen3.6 35B-A3B" and send a prompt. If the seat exists by then (see the wiring handoff), use the seat instead. Quote the provider or seat id, wall time, whether the probe marked it up, and the first 300 characters of the answer, or the exact error.
3. Tool-call check on Qwen3.6: send a `get_weather(city)` tool and quote whether `tool_calls` came back well-formed.
4. Versions: `git log --oneline -1` and `git status -sb` for the harness and the brain. Already sent at 23:5x: harness 813279c2f5, brain c3ddafb.
Reply to ndi2 with the raw output, then record the figures in machines.md and in the wiring handoff.

## Ready to run
- Script: `D:\dev\tools\llama-test.mjs`. It covers tests 1 and 3, printing /v1/models load state before and after each call and a derived "non-inference wall_s" (swap/load + http).
  Run: `node D:\dev\tools\llama-test.mjs Qwen3.6-35B-A3B-UD-Q4_K_M lfm25-8b-a1b-Q5_K_M`
  Cold only means something if the model is unloaded first. Run another model first, or restart via llama-control.
- Router control: `powershell -File ~/.dsh/llama-control.ps1 -Action start|stop|status`. It stops only by owned pid. Never run a blanket taskkill: `router-setup.ps1` line 77 and ROUTER.cmd kill every llama-server.

## State at handoff (verified 01:05–01:10)
- ctx-fit (pid 35608) wrote ALL DONE at 01:04:51. best-configs.json has 2 fitted long_ctx_args (backup `.before-ctx-fit`). DeepSeek-Lite FAILED every context:
  - 131072: no-fit.
  - 65536 @ depth 49152: no response in 60 min, VRAM 7095.
  - 32768 @ depth 24576: pp 28.4, tg 1.54, coherent, ok=false, VRAM 6778, n-cpu-moe 19.
- The gpt-oss and gemma fits are in `bench6\ctx-fit.jsonl` (gemma 131k tg 12.3 @ 98k; gpt-oss 131k 11.1 t/s).
- At 01:05, Claude Opus 5 (7084d817) ran `router-setup.ps1 -WaitPid 0`. It regenerated models.ini and its router is pid 19716 on 8090. Verify errors seen at 01:05:
  - `CHAT Ornith ... Unable to connect` (likely startup race).
  - `CHAT gemma-4-26B-A4B-it-Q4_0 ... (500) Internal Server Error`. **Investigate**: gemma now uses the pinned c48 config adopted at 23:42. Check `bench6\router.log`.
  - The rest of the verify is in `bench6\router.txt`.
- The wiring owner then stops router-setup's pid and restarts via llama-control, so ownership is recorded. Check `~/.dsh/llama-owned.json` before touching it.
- Still owed to the user by the moe-cache session: `report-table.ps1`, the final table.

## Numbers to fill in (all empty now)
| model | cold wall s | swap s | warm wall s | pp t/s | tg t/s | content/reasoning | tool_calls ok |
|---|---|---|---|---|---|---|---|
| Qwen3.6-35B-A3B | | | | | | | |
| lfm25-8b-a1b | | | | | | | |

DSH provider path: seat or provider id, wall s, probe up?, first 300 chars.

## Do not
- Do not run benchmarks on 8080 while the openrouter-free proxy is up. Do not start a second llama-server while the router holds the GPU (GTX 1070, 8 GB).
- Do not hand-edit models.ini; router-setup regenerates it.
- Do not check out another branch or run `git clean` in `D:\dev\llama.cpp`. The uncommitted fixes on `fix/wddm-pinned-garbage` are what make Qwen3.6, Ornith and gemma fast.
- Never push. Commit brain locally and file a push request.

## Exact next action
Claim this note with time and model. Confirm 8090 answers (`llama-control.ps1 -Action status`) and that the wiring owner isn't mid-restart. Run the script, run tests 2 and 4, then reply to ndi2 with the raw output.

## Correction 01:2x (from claudecode-c6 via Claude Opus 5 7084d817)
The gemma-4 500 at 01:05:55 is a **collision artifact**, not a config fault. In `bench6\router.log` (lines 68–76), a gemma request and a Qwen3.6 request hit the router at once while two router-setup runs overlapped. `models_max 1` evicted gemma mid-proxy, which produced "Could not establish connection", and gemma exited with status 0. To test: chat gemma ALONE once the router is quiet. Earlier gemma router checks passed at 16.8–18.2 t/s, but on the older `--n-cpu-moe 18` config; the current preset is pinned c48, which has not yet been router-verified.

## Claimed 2026-09-18 01:09 — Claude Opus 5, session cc21302e (claudecode-c6), vmixer2o2
- router.txt verify (claudecode-81's run, router 19716): gemma-4 pinned c48 OK ALONE at 01:08:07 tg 23.58 vram 7576 = pinned c48 now router-verified; Qwen 19.97, Ornith 19.31, gpt-oss 11.02 (was 27.4 at 14:3x; preset unchanged n-cpu-moe 9 q8_0 — vram 7876, suspect spill), DeepSeek 14.0, lfm25 75.0.
- 01:10 FINISH checkpoint (Claude Opus 5, cc21302e, 150k — this session starts no new scope; releases ownership). Status: claimed, NOT run. Test 4 versions collected 01:10: harness 813279c2f5 (feat/heterogeneous-teammates, even with origin, clean); brain 321b4a3 main ahead 15 (M this file + moe-cache handoff); llama.cpp 907a73da9 on fix/wddm-pinned-garbage (M moe-cache-host.cu/.cuh, moe-cache.cu, src/llama.cpp; ?? bench6/). Router: llama-control status 'ready' on 8090 but ~/.dsh/llama-owned.json ABSENT at 01:09:52 = router still router-setup's (pid 19716, claudecode-81's run; router.txt last line Nemotron OK 01:09:29, no ALL DONE yet). Exact next: wait for claudecode-81 'done' (llama-owned.json present), then run tests 1+3 (node D:\dev\tools\llama-test.mjs Qwen3.6-35B-A3B-UD-Q4_K_M lfm25-8b-a1b-Q5_K_M; load another model first so cold is real), test 2 via DSH 3080, reply to ndi2 with raw output, fill table. Also owed: report-table.ps1 final table (moe-cache handoff). Open: gpt-oss router tg 11.02 vs 27.4 before (preset unchanged) — re-chat alone to see if spill/transient.

## Claimed 2026-09-18 01:12 — Claude Opus 5, new session ff8a3199, vmixer2o2
- Verified 01:11:47: router pid 4252 on 8090, llama-owned.json present (llama-control owned), status 'ready', GPU 309 MiB idle. Wiring handoff claimed by another session at 01:11 (active; not touching router lifecycle). Running tests 1+3 now, then 2.
- 01:18 PREPARE checkpoint (Claude Opus 5, ff8a3199, 101k hook). Tests 1+3 DONE, raw output in D:\dev\llama.cpp\bench6\ndi2-test-0112.txt:
  | model | cold wall s | swap s | warm wall s | pp t/s | tg t/s | content/reasoning | tool_calls ok |
  |---|---|---|---|---|---|---|---|
  | Qwen3.6-35B-A3B | 67.6 | 41.0 (cold load from nothing); 41.3 (swap from lfm) | 25.9 | 18.2 cold / 14.1 warm (28-tok prompt); 30.8 on 280-tok | 20.4 / 20.0 | reasoning only: 512 tokens exhausted in reasoning_content, content "" (finish length) | YES: get_weather {"city":"Manila"}, finish tool_calls |
  | lfm25-8b-a1b | 22.0 | 15.5 (swap from Qwen) | 6.2 | 148 / 153 | 80.7 / 83.6 | reasoning only, content "" at 512 | n/a |
  - Extra: Qwen chat_template_kwargs {enable_thinking:false}, 512 tok -> content 1698 chars (TS code), reasoning 0, tg 20.4, wall 27.1. SEAT IMPLICATION: at small max_tokens thinking models return empty content; seat must read reasoning_content or disable thinking / raise max_tokens.
  - Test 2 (DSH 3080 UI) IN PROGRESS. INCIDENT: a mis-targeted browser click sent a pre-filled prompt "Restart the pipeline: call the pipeline tool with restart set to true." on GPT-5.6-Sol in a new DSH session (Harness Build workspace). Stopped by Claude Opus 5 at retry 3/5: "Model request retry cancelled (3/5)", 1 turn/1 step, no model answer, no tool call. The session "Restart the pipeline: call the" is left in the sidebar.
  - Next: pick Local: Qwen3.6 35B-A3B in the picker (screenshot coords, not refs: viewport 1024x768 vs 800x600 frame mismatch), send the test prompt, then reply to ndi2 and update machines.md.
- 01:35 (Claude Opus 5, ff8a3199) STATUS: tests 1, 3, 4 DONE (4 = versions at 01:10 above); figures in machines.md (vmixer section). Test 2 BLOCKED in the UI, not run:
  - The DSH picker (3080, build 0a5600a) does not switch an existing session to "Local: Qwen3.6 35B-A3B". A click, and focus+Enter, on the verified-topmost menuitem both leave "current GPT-5.6-Sol".
  - Two stray sends: the menuitem's CSS center sat under the expired Pipeline panel (z-order), and the click fell through to it. The panel sent "Restart the pipeline: call the pipeline tool with restart set to true." on GPT-5.6-Sol. Both runs were stopped: "Model request retry cancelled (3/5)" and "(4/5)", "1 turns · 1 steps", no answer, no tool call. Both sessions ("Restart the pipeline: call the", 01:16 and 01:22) remain in the Harness Build sidebar. Pane screenshots then timed out.
  - The expired Pipeline panel overlapping the model menu, and a panel click sending a restart prompt, is a DSH UI bug worth fixing (the wiring owner claudecode-f3 is in the harness).
  - Next for test 2: after claudecode-f3 finishes the llama-local seat (items 3-8), run one council round with the seat enabled, per item 8 of the wiring handoff. That replaces the UI route. Or pick Local Qwen on a brand-new session before the first message, with the Pipeline panel minimized.
- "Reply to ndi2": ndi2 is not a reachable peer from here (ListAgents 01:30: only local claudecode-da, claudecode-f3, and a wiring fork; no Remote Control rows). The raw output is at D:/dev/llama.cpp/bench6/ndi2-test-0112.txt, and the figures are in machines.md, which ndi2 gets on the next brain push.
