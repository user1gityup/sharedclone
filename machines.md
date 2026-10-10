---
name: machines
description: Machine performance registry read by the weight router - per-host role, local LLM throughput, cost class; values re-measured after hardware changes
metadata:
  type: reference
---

# Machine registry

Router input data for [[dsh-runtime-routing]]. When hardware changes, update the numbers here and do not change the policy.

## vmixer (VMIXER2O2)
- Role: local execution node; hosts the headless CLIs.
- Hardware (confirmed by nvidia-smi on 2026-09-17, vMixer Claude Opus 5): one NVIDIA GeForce GTX 1070 with 8192 MiB VRAM (driver 561.17) and 127.9 GB system RAM. The 2026-09-11 entry of "at least 32 GB VRAM" was wrong. The MoE presets keep their experts in pinned host RAM, which is how the 35B models fit in 8 GB. The 64 GB VRAM target in [[project_dsh_team_platform]] is a plan, not current hardware.
- Local LLM throughput: measured 2026-09-17 ~22:30 by the vMixer Claude Opus 5 through the llama.cpp router at 127.0.0.1:8090 (c=16384, `--models-max 1`, one short chat per model; this was not a DSH seat-path run). Figures are decode tok/s, with load plus first chat time in brackets: lfm25-8b-a1b-Q5_K_M 77.5 (14 s); gpt-oss-20b-MXFP4 25.3 (23 s); Qwen3.6-35B-A3B-UD-Q4_K_M 20.8-21.5 (52 s); Ornith-1.5-35B-A3B-APEX-MTP-I-Compact 20.8 (46 s); gemma-4-26B-A4B-it-Q4_0 18.2 (28 s); NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Q4_K_M 16.8 (31 s); DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M 15.8 (12 s). Tuned bench runs were higher (Qwen3.6 25.4, DeepSeek 27.4, lfm25 85.4). Only one model is loaded at a time. A longer seat-path run is still to come.
- Tuned bench (vMixer, 2026-09-17, c=16384; raw files in D:\dev\llama.cpp\bench6\, summary in handoff-2026-09-17-2110-llama-dsh-wiring.md). Figures are decode gen/code tok/s and pp8k prefill tok/s: Qwen3.6 25.4/21.4, pp 81; Ornith 26.4/25.5, pp 88; gemma-4 18.7/27.7, pp 319; gpt-oss 26.0/26.1, pp 159; DeepSeek-Lite 27.4/13.8, pp 70; lfm25 85.4/85.5, pp 1844; Nemotron 24.4/24.8, pp 242. Long context: only Qwen3.6 stays usable at 131072 (10.8/9.9/7.9 tok/s at 8k/32k/100k); gemma-4 holds to about 32k; gpt-oss and DeepSeek-Lite collapse past 8k. There are no quality, tool-call or JSON scores; only a temp-0 coherence gate, which all 7 pass. Router pick: Qwen3.6 as the coding worker (cold load 52 s, 8k prefill about 100 s, so the seat timeout must be 420 s or more), lfm25 as the cheap summarizer once `reasoning_content` is read, Nemotron as the fallback, DeepSeek-Lite skipped.
- Router verify through 8090 (vMixer, 2026-09-18 01:06-01:07): decode tok/s Qwen3.6 19.97, Ornith 19.31. ctx-fit (2026-09-18): DeepSeek-Coder-V2-Lite Q4_K_M did not fit at c131072; at c65536 (load VRAM 7095 MB, --n-cpu-moe 25) a 49152-deep request gave no response in 60 min, so it is unusable there. Seat-path figures are still deferred to handoff-2026-09-18-0110-llama-benchmarks.md.
- Cold/warm and tool-call on the 8090 router (vMixer Claude Opus 5, 2026-09-18 01:13; ISO-8601 TS prompt, max_tokens 512, stream false; raw output in D:/dev/llama.cpp/bench6/ndi2-test-0112.txt): Qwen3.6-35B-A3B cold 67.6 s (41.0 s load), warm 25.9 s, decode 20.4/20.0 tok/s; lfm25-8b-a1b cold 22.0 s (15.5 s swap from Qwen), warm 6.2 s, decode 80.7/83.6 tok/s; Qwen swap back from lfm 41.3 s. Both models spent all 512 tokens in `reasoning_content` and returned an empty `content` (finish length). With `chat_template_kwargs:{enable_thinking:false}`, Qwen3.6 put 1698 chars of code into `content` at 20.4 tok/s, so the seat must disable thinking, raise max_tokens, or read `reasoning_content`. Qwen3.6 tool call: well-formed, `get_weather {"city":"Manila"}` with finish_reason tool_calls.
- Cost class: local.
- Routing note: score on estimated total completion time, not zero cost alone.

## vmixlaptop2x6 (ndi2)
- Role: dev box and code master ([[feedback_ndi2_is_code_master]]); not a pool node.
- Hardware (2026-09-11): RTX 3050 Laptop 4 GB VRAM, 8 GB RAM; no local LLM runtime.
