---
name: handoff-2026-09-17-2110-llama-dsh-wiring
description: "2026-09-17 21:10 open, unclaimed: connect the local llama.cpp router (7 tuned GGUF models, D:\\dev\\tools\\launch\\ROUTER.cmd) to DSH as a provider and council seat so the user can pick them from DSH. Blocked first on a port clash: the llama router and DSH's openrouter-free proxy both use 127.0.0.1:8080"
metadata:
  type: project
---

**Handoff id:** llama-dsh-wiring · **Status:** open, not started · **Created:** 2026-09-17 21:10 local
**Claimed:** 2026-09-17 21:20 by Claude Opus 5 (claude-opus-5), Claude Code desktop session b025a0ef, vmixer2o2. State at claim: ctx-rerun pid 18784 alive, log last line 20:57 DeepSeek-Lite depth 32000 (100k depth in progress); 8080 = llama-server pid 3156 (bench), 8082 = python pid 13908 (FCC), 8090 free. Waiting on user answers to port + scope.
**Build gate (user, 21:21):** the other Claude instance that is updating the shared brain must check in with session b025a0ef before any build, so the work is not built on deprecated rules or code. Nothing gets built until that check-in happens and the user answers port + scope. Remote Control is on for this session (desktop id `local_e07f63b5-a865-4fde-89c9-b397796567a3`), so the lead-machine agent can reach it through Remote Control.
**ndi2 check-in received (22:0x):** ndi2 Claude Opus 5 (claudecode-50) sent `handoff-2026-09-17-2132-vmixer-llama-dsh-seat.md` (origin/main only; vMixer has only fetched, local is 3 ahead and 191 behind, dirty). Constraints from it:
- Do not edit seats.ts, roster.ts, route-swarm.ts or swarm.ts on 6787fa3e8c, because ndi2 has 6 unpushed router commits.
- Keep llama on loopback, because the probe sends the OpenRouter Bearer key.
- Commit locally and queue; never push.

The status reply was sent by SendMessage; delivery is not confirmed. SharedBrainListener.ps1 is NOT running on vMixer. Step 4 (the council seat) is deferred to ndi2's push; steps 1–3 and 5 stay in scope, pending the user's go.
**ndi2 answer (22:1x):**
- **Scope.** The seat waits for ndi2's 6 commits. vMixer does only the port move, the settings.yaml provider, launch control and measurement.
- **Port.** ndi2 agrees on 8090, loopback only; this still needs the user's go. The router must never take 8080, because the openrouter-free proxy is live there on ndi2.
- **Launch control.** Use llama-control.ps1 (start hidden, wait for /health, owned-pid file, stop by pid). Call it from fcc-session.cjs behind a flag, the same way ndi2 calls openrouter-control.ps1. Never use a blanket taskkill.
- **The later seat.** Start with ONE preset (DeepSeek-Lite or Qwen3.6). ndi2 will change the local-seat probe to GET /health or /v1/models, because a chat POST forces a 13–57 s swap, and will read `reasoning_content` when `content` is empty.
- **Measurement.** Once 8090 is up, measure seat-path tok/s for the chosen preset with a plain /v1/chat/completions call, plus the cold swap time. Write both into this note, and reply to ndi2 when 8090 answers.
- **Brain.** Keep the listener off until the gatekeeper merge. ndi2 suggests committing this note locally; that needs the user's go.
**Host:** vmixer2o2 · **Written by:** Claude Opus 5 (claude-opus-5), Claude Code desktop session c1018af5. That session also owns [[handoff-llama-cpp-moe-cache-setup]], which is still running benchmarks.
**Repos touched by this work:** `~/Documents/claudecode/deepseek-harness` (branch `feat/heterogeneous-teammates`), `~/.dsh/` (not a repo), `D:\dev\tools` (not a repo).

## FINISH checkpoint 2026-09-17 22:36 (Claude Opus 5, session b025a0ef, vmixer2o2): read this first
The 150k-context hook fired. This session started no new scope after it.
- **LIVE NOW:** the llama router listens on **127.0.0.1:8090**, pid 18060 (started 22:34:44), and is owned by `~/.dsh/llama-control.ps1`. `llama-owned.json` holds pid 18060 and started 639253064843707584. `llama.enabled` has been created. `/health` returns `{"status":"ok"}`, and `/v1/models` lists all 7 presets with `status.value` "unloaded". llama-control `start` ran end to end: exit 0, ready in 5.4 s. Nothing listens on 8080 now; the openrouter-free proxy is not running on vMixer.
- **Port move is done:**
  - `router-setup.ps1` defaults to `$Port = 8090`, and its header was updated. The parse check reports 0 errors.
  - `ROUTER.cmd` points at 8090.
  - Backups: `router-setup.ps1.pre-port8090-<time>` and `launch\ROUTER.cmd.pre-port8090-<time>`.
  - The old 8080 router, pid 16300 (router-setup's), was stopped with `taskkill /PID 16300 /T`. Its child processes 16080 and 4680 went with it.
- **Measured through the router (router-setup verify, 22:30–22:33, c=16384, one plain chat each).** Cold means load plus first chat.

  | Model | Cold (s) | tg (t/s) |
  |---|---|---|
  | Qwen3.6 | 52 (56 on the second pass) | 20.8 / 21.5 |
  | Ornith | 46 | 20.8 |
  | gemma-4 | 28 | 18.2 |
  | gpt-oss | 23 | 25.3 |
  | DeepSeek-Lite | 12 | 15.8 |
  | lfm25 | 14 | 77.5 |
  | Nemotron | 31 | 16.8 |

  These are short-prompt figures, with a small token count per call. A dedicated seat-path tok/s measurement (longer generation on 8090) is still to do.
- **NOT DONE:**
  1. **settings.yaml provider.** The backup `settings.yaml.pre-llama-local-223456` exists, but the provider has NOT been added. Add it under `llm-pi-ai.providers`, after the `openrouter-free` block (line 22–90) and before `agent-default-model`:
     ```yaml
         llama-local:
           displayName: Local llama (vMixer GTX 1070)
           api: openai-completions
           baseURL: http://127.0.0.1:8090/v1
           models:
             - {id: Qwen3.6-35B-A3B-UD-Q4_K_M, name: "Local: Qwen3.6 35B-A3B", contextWindow: 16384}
             # ... all 7 ids, contextWindow 16384
     ```
     `apiKeyEnv` is optional in the schema (`llm-pi-ai/src/config.ts:308`, not `.required()`), so leave it out. Then check that the DSH picker lists the 7, and send one chat each. Watch gpt-oss and lfm25: their text comes back in `reasoning_content`.
  2. **Seat-path tok/s.** Measure DeepSeek-Lite and Qwen3.6 on 8090 with max_tokens ~256, then reply to ndi2 (bridge `session_01LSVuzCJpFnr45YzEbvE5oT`) with: 8090 answers, the table above, and the seat-path figures.
  3. **Live DSH launch test** of the new fcc-session.cjs llama wiring: start and stop with DSH. The stop path with a real marker is still untested.
  4. **Commit brain.** The user authorised local brain commits.
- **Coordination:** the moe-cache follow-up (aux-alias fix #2 rebuild, long-ctx fit) must stop the router first. Run `llama-control.ps1 -Action stop`, not Get-Process kill, so the marker stays consistent; the router-setup rerun now lands on 8090. Recorded in [[handoff-llama-cpp-moe-cache-setup]].

- **GPU confirmed 22:4x (nvidia-smi):** one NVIDIA GeForce GTX 1070, 8192 MiB VRAM, driver 561.17, with 127.9 GB system RAM. This is not the 32 GB VRAM that ndi2's machines.md listed. ndi2 has recorded 8090, llama-control and the figures in machines.md; the local seat probe is to be GET /v1/models. ndi2's gatekeeper is pushing the 6 harness commits and will message when origin has them, so the vMixer gatekeeper can pull.
## Current state (updated 2026-09-17 22:20, Claude Opus 5, session b025a0ef, owner)
- **User go (22:15):** build all four of: port 8090, launch control, settings.yaml provider, measurement. Commit all the work to the shared brain locally, so other agents and later DSH swarms can pick it up. Never push. The council seat (step 4) waits for ndi2's 6 router commits.
- **Done:** brain commit 2a308be, local only. It holds this note, the moe-cache checkpoints and the agent-log entries. The brain is 4 ahead and 191 behind origin; the gatekeeper does the merge. The listener stays off until then.
- **Built (22:08, not yet live-tested):**
  - `~/.dsh/llama-control.ps1`, as designed in step 2 below.
  - `~/.dsh/fcc-session.cjs` now does four things: `createMonitor` takes a `label`; `llama('start')` runs after FCC starts without blocking DSH; a llama monitor tick runs every 30 s and writes `llama` into `fcc-status.json`; `llama('stop')` runs in `finish()`. Watch mode (`--watch`) leaves llama alone.
  - Backup: `fcc-session.cjs.pre-llama-local-20260917-220759`.
  - Verified so far: `node --check` passes, the label monitor unit call passes, and all four actions exit 0 while disabled (no `llama.enabled` flag, no marker left behind).
- **Still to do:** the port move, `llama.enabled`, the provider and the measurement. They wait for ctx-rerun (pid 18784) to write `ALL DONE`. Its step at `ctx-rerun.ps1:129` runs `router-setup.ps1 -WaitPid 0`, and that starts the router on **8080**, the default `$Port`.
- **Build design (after ALL DONE):**
  1. Change the `router-setup.ps1` param default to `$Port = 8090`, along with its header comment. Change the generated line in `ROUTER.cmd` from 8080 to 8090. Stop the 8080 router by its pid (the process router-setup launched), never with a blanket taskkill.
  2. Add `~/.dsh/llama-control.ps1`, a copy of the fcc-control.ps1 shape:
     - Actions start, stop, status, restart.
     - Runs `D:\dev\llama.cpp\build\bin\llama-server.exe --models-preset D:\dev\tools\launch\models.ini --models-max 1 --host 127.0.0.1 --port 8090` hidden, with CUDA 12.6 bin on PATH.
     - Ready means `/health` answers and `/v1/models` is non-empty.
     - Records ownership in `llama-owned.json` and stops only by that pid plus its start ticks.
     - The start is skipped when `~/.dsh/llama.enabled` does not exist.
     - Calls come from `fcc-session.cjs`: start next to FCC, stop in `finish()`.
  3. Back up settings.yaml as `settings.yaml.pre-llama-local-<time>`, then add provider `llama-local` under `llm-pi-ai.providers`: `openai-completions`, `http://127.0.0.1:8090/v1`, the 7 models, `contextWindow: 16384`.
  4. Measure seat-path tok/s for DeepSeek-Coder-V2-Lite and Qwen3.6 with a plain `/v1/chat/completions` call at 16k, plus the cold swap time. Write the figures here and reply to ndi2 (bridge session_01LSVuzCJpFnr45YzEbvE5oT).
- **Coordinate:** session c1018af5 owns the moe-cache work. After ALL DONE it posts the final table and asks the user about the aux-alias rebuild, which also stops the router. Check that session's handoff before stopping the 8080 router.

## Exact ask
User, 2026-09-17: "can you write a handoff for another agent to work on wiriing llama with dsh so we can easily run this models with our current system".
This note is the handoff. **Nothing has been built yet.** The receiving agent confirms the scope below with the user before writing anything. Rule: [[nothing-without-permission]].

## Goal
The user can pick any of the 7 local models from DSH, both as a chat/agent model and as a council seat. The llama router starts on its own when DSH starts (the same way FCC does), and the right model loads on demand.

## Verified facts (checked 2026-09-17 21:05–21:10)
### The llama side
- **Router launcher:** `D:\dev\tools\launch\ROUTER.cmd`. It puts CUDA 12.6 `bin` on PATH, runs `taskkill /IM llama-server.exe /F` (this kills **every** llama-server, benchmark runs included), and then starts `D:\dev\llama.cpp\build\bin\llama-server.exe --models-preset D:\dev\tools\launch\models.ini --models-max 1 --host 127.0.0.1 --port 8080`.
- **Model presets:** `models.ini` has one section per GGUF basename. The client selects a model by putting that section name in the request's `model` field. `--models-max 1` keeps one model loaded at a time, so a request for a different model unloads the current one and loads the new one.
- **Generated file:** `models.ini` is written by `D:\dev\tools\router-setup.ps1` from `D:\dev\llama.cpp\bench6\best-configs.json`. Any hand edit is overwritten the next time router-setup runs. Edit best-configs.json, or the generator, instead.
- **The 7 model ids** (section names), with tuned decode speed and the load/first-chat time measured through the router (bench6\router.txt, 14:3x):
  - `lfm25-8b-a1b-Q5_K_M` — 85 t/s, 13 s
  - `DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M` — 27 t/s
  - `Ornith-1.5-35B-A3B-APEX-MTP-I-Compact` — 26 t/s
  - `gpt-oss-20b-MXFP4` — 26 t/s
  - `Qwen3.6-35B-A3B-UD-Q4_K_M` — 25 t/s, 57 s
  - `NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Q4_K_M` — 24 t/s, 28 s
  - `gemma-4-26B-A4B-it-Q4_0` — 19 t/s
  All 7 returned "Paris" through the router, and swapping back to an earlier model worked.
- **Context:** every preset has `c = 16384`. Long-context launchers exist (`launch\*-longctx.cmd`), but they are single-model servers, not router presets. Most of them use q8_0 KV, which makes decode collapse at depth. See the handoff above: re-point them to q4_0 before offering them.
- **Reasoning output:** gpt-oss and lfm25 put their answers in `reasoning_content`. A DSH client that reads only `content` may see an empty reply. Test this.
- **Hardware limit:** GTX 1070 8 GB. Only one model fits in VRAM, and every preset already runs at 7–8 GB. Two local council seats with different models would force a reload on every turn, costing 13–57 s each. Two seats on the same model run one after the other (`np = 1`).
- **Not verified:** what the router's `/v1/models` returns (preset names? load state?). Check this before writing the DSH model list.

### The DSH side
- **Providers:** `~/.dsh/settings.yaml` under `llm-pi-ai.providers`. The OpenAI-compatible pattern to copy is `openrouter-free`: `api: openai-completions`, `baseURL: http://127.0.0.1:8080/v1`, a static `models:` list with `id`, `name` and `contextWindow`. The FCC provider shows the same pattern with `openai-responses`. Providers hot-reload with no restart ([[free-claude-code-setup]]). Settings backups are named `settings.yaml.pre-<change>-<time>`; follow that convention.
- **Council seats:** hard-coded in `deepseek-harness/packages/council/tool-council/src/seats.ts`. Seat `openrouter-free` (around line 271) uses `transport: 'openrouter'` with `baseUrl: 'http://127.0.0.1:8080/v1/chat/completions'`, `model: 'proxy-auto'`, `free: true`, `timeoutMs: 420_000`. Adding a local seat means adding the same kind of entry. `SeatId` is `string` in `colors.ts`, so a new id needs no type change (colours for non-builtin seats come from `sgrFor`). Seats are enabled or disabled in `settings.yaml` under `council.seats.<id>.enabled`.
- **Startup:** `~/.dsh/launch-dsh.cmd` starts and stops FCC through `~/.dsh/fcc-control.ps1`. That script checks readiness (`/health` plus a nonempty `/v1/models`), records ownership in `fcc-owned.json` so it only stops a proxy it started itself, and a monitor script `fcc-session.cjs` restarts FCC if it dies. Nothing starts the llama router or the openrouter-free proxy today.
- **Build traps:** read [[dsh-harness-gotchas]] and [[project_dsh_profile_plugin_install]] before rebuilding DSH. `~/.dsh/rebuild-dsh.cmd` exists.

## BLOCKER 1: port 8080 clash (decide first)
- DSH's `openrouter-free` provider **and** its council seat both point at `127.0.0.1:8080`. That port belongs to the Python free-model proxy (`dsh-council-plugins/proxies/openrouter-free`, started with `start-openrouter-proxy.ps1`; see [[handoff-dsh-model-choice]]).
- The llama router also binds 8080. At 21:05, 8080 was held by llama-server pid 3156, a ctx-rerun benchmark. **The `openrouter-free` seat is enabled in settings.yaml**, so any council run right now sends `proxy-auto` to llama-server and fails that seat.
- **Recommendation (the user decides):** move the llama router to **127.0.0.1:8090** and give 8080 back to the openrouter proxy.
  - `router-setup.ps1` already takes `-Port`.
  - `ROUTER.cmd` hard-codes 8080 because it is generated. Change the generator's default, or the generated line.
  - The benchmark scripts (`bench-one.ps1`, `bench-tune.ps1`, `ctx-rerun.ps1`, `fix-spec.ps1`) also hard-code 8080. They are one-off benchmark tools and can stay on 8080 as long as the router moves. Just never run a benchmark while the openrouter proxy is up.

## BLOCKER 2: benchmarks still running
- `ctx-rerun.ps1` (pid 18784) owns the GPU and port 8080 until its log `D:\dev\llama.cpp\bench6\ctx-rerun.txt` says `ALL DONE`. At 21:03 it was on DeepSeek-Lite at 100k context, capped at about 22:27. After it finishes, it reruns router-setup, which **restarts the router on 8080** and regenerates models.ini.
- Do not start the router, run ROUTER.cmd, rebuild `llama-server.exe`, or edit the bench/router scripts until that happens. The owner session posts the final table and then asks the user about the aux-alias rebuild (fix #2), which would also stop the router.

## Proposed plan (confirm with the user, then build in this order)
1. **Move the port.** Router to 8090: run router-setup with `-Port 8090` or change its default, then regenerate ROUTER.cmd. Verify with `/health` on 8090 and the openrouter proxy back on 8080.
2. **Start and stop control.** Add `~/.dsh/llama-control.ps1`, modelled on `fcc-control.ps1`: start ROUTER.cmd hidden, wait for `/health`, record ownership in `llama-owned.json` (pid plus start ticks), and stop only a router this script started. Call it from `launch-dsh.cmd` next to the FCC calls, behind an on/off flag, because the router holds pinned RAM (up to 64 GB) and 8 GB of VRAM. **Do not use ROUTER.cmd's blanket `taskkill`** for stopping. Stop by pid instead.
3. **DSH provider.** Add `llm-pi-ai.providers.llama-local` to settings.yaml, after taking a backup: `api: openai-completions`, `baseURL: http://127.0.0.1:8090/v1`, models = the 7 section names, `contextWindow: 16384`. No key; check whether the provider schema needs a dummy `apiKeyEnv`, as the other entries have one. Check that DSH's picker lists all 7 and that one chat per model works, including the `reasoning_content` models.
4. **Council seat** (a harness code change, needs a DSH rebuild). Add a `llama-local` seat in `seats.ts`: `transport: 'openrouter'`, `baseUrl` on 8090 `/v1/chat/completions`, a default model (suggest `Qwen3.6-35B-A3B-UD-Q4_K_M` for quality or `lfm25` for speed; the user picks), `free: true`, `timeoutMs: 420_000` or more (a cold load takes up to 57 s before generation starts), `enabled: false` by default. Check whether the council panel's per-seat model picker can choose among the 7. Add a test next to the existing seat tests.
5. **One-click check.** A Desktop `.cmd` that starts the router if it is down, sends one chat per model, and prints OK/FAIL with t/s. This follows [[feedback_one_click_bundling]].

## Do not / watch out
- The deepseek-harness working tree has uncommitted changes from another session: `packages/council/tool-council/bin/agy-profile.mjs` and `tests/agy-profile.test.mjs`. Leave them alone and don't commit them with this work ([[feedback_shared_workdir_collisions]]).
- Commit only after the user says so. Never push; use the gatekeeper queue ([[git-gatekeeper-agent]], [[push-requests]]).
- Don't enable a local seat by default, and don't put two local seats in one council run (VRAM thrash).
- Don't hand-edit models.ini (it is regenerated).
- The pinned-memory fix that makes the Qwen3.6 and Ornith presets fast is **uncommitted** on llama.cpp branch `fix/wddm-pinned-garbage` (patch copy `D:\dev\llama.cpp\wddm-pinned-fix.patch`). Don't check out another branch or run `git clean` in `D:\dev\llama.cpp`.

## Exact next action for the receiving agent
Claim ownership here with a timestamp and model name. Check that ctx-rerun has finished (`ALL DONE` in `bench6\ctx-rerun.txt`, pid 18784 gone). Check what holds 8080 and 8082 (`Get-NetTCPConnection -LocalPort 8080,8082 -State Listen`). Then ask the user two things: (a) the port choice, with 8090 recommended, and (b) which steps 1–5 to build.

— Claude Opus 5
- 22:45 (Claude Opus 5): llama-DSH owner note — llama-cpp-moe-cache owner plans aux-alias rebuild + long-ctx refit after ctx-rerun ALL DONE; holds GPU/:8080 for hours. Coordinate before moving the router (see handoff-llama-cpp-moe-cache-setup.md 22:45 block).

## Benchmark results for ndi2 (compiled 2026-09-17 22:5x, Claude Opus 5, session b025a0ef)
Sources on vMixer: D:\dev\llama.cpp\bench6\
- `best-configs.json`: tuned 16k configs. Updated 22:29; tuning ran 09-17 02:00–14:30, using `tune.jsonl` (14:23), `results.jsonl` (02:24) and `maxvram.jsonl` (03:13).
- `fix-spec.txt` / `fix-spec.jsonl`: ngram speculative decoding test, 14:28–14:37.
- `ctx-rerun.txt` / `ctx-rerun.jsonl`: long-context runs at 131072, 14:38–22:33.
- `router.txt`: router verify runs at 14:3x and 22:29–22:33.

**16k tuned (c=16384, np=1).** gen = decode on a prose prompt, code = decode on a code prompt, pp8k = prefill tok/s on an 8k prompt. Load = cold load plus first chat through the router at 22:3x. Router tg = decode on that short chat.

| model | gen | code | pp8k | VRAM MiB | KV | experts off-GPU | load s | router tg |
|---|---|---|---|---|---|---|---|---|
| Qwen3.6-35B-A3B-UD-Q4_K_M | 25.4 | 21.4 | 80.9 | 7992 | q8_0 | pinned host cache 65536 MB, cache 72 | 52 | 20.8 |
| Ornith-1.5-35B-A3B-APEX-MTP-I-Compact | 26.4 | 25.5 | 88.3 | 7996 | q8_0 | pinned host cache 65536 MB, cache 104 | 46 | 20.8 |
| gemma-4-26B-A4B-it-Q4_0 (+ngram spec) | 18.7 (21.3 spec) | 27.7 (30.6 spec) | 319.1 | 7814 | q8_0 | n-cpu-moe 18 | 28 | 18.2 |
| gpt-oss-20b-MXFP4 | 26.0 | 26.1 | 158.9 | 8034 | q8_0 | n-cpu-moe 9 | 23 | 25.3 |
| DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M | 27.4 | 13.8 | 70.3 | 7998 | q4_0 | n-cpu-moe 11 | 12 | 15.8 |
| lfm25-8b-a1b-Q5_K_M (+ngram spec) | 85.4 | 85.5 | 1843.9 | 6458 | q8_0 | none | 14 | 77.5 |
| NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Q4_K_M | 24.4 | 24.8 | 241.6 | 8024 | q4_0 | n-cpu-moe 39 | 31 | 16.8 |

**Long context at 131072 (ctx-rerun), measured at depth 8k / 32k / 100k.** tg = decode tok/s, pp = prefill tok/s.

| model | KV | 8k tg / pp | 32k tg / pp | 100k tg / pp | VRAM max | verdict |
|---|---|---|---|---|---|---|
| Qwen3.6 | q8_0 | 10.8 / 54 | 9.9 / 52 | 7.9 / 46 | 8003 | the only one usable at 100k |
| gemma-4 | q8_0 | 6.5 / 41 | 3.9 / 24 | timed out | – | – |
| gemma-4 | q4_0 | 17.8 / 199 | 16.7 / 119 | 0.43 / 20 | 8001 | stable to ~32k |
| gpt-oss | q8_0 | 4.4 / 87 | 1.6 / 61 | 0.56 / 23 | 8026 | collapses; q4_0 not run |
| DeepSeek-Lite | q4_0 (tuned) | 4.4 / 63 | 1.1 / 21 | hit the 90-min cap | – | not usable long |

- Ornith, lfm25 and Nemotron already had long-ctx args from earlier runs: Ornith 131072 q8_0, lfm25 128000 q8_0, Nemotron 131072 q4_0. Their depth figures are in [[handoff-llama-cpp-moe-cache-setup]], not in ctx-rerun.
- The moe-cache owner's current theory for the collapses: the long-ctx args reuse the 16k GPU placement, so the 131k KV cache spills past 8 GB into WDDM shared memory. A fit pass is planned; see that handoff.
- **Largest stable context:**
  - Qwen3.6: 131072 at about 8 t/s, VRAM 8003 MiB, pinned host cache up to 65536 MB.
  - gemma-4: about 32k at q4_0.
  - Every other model: plan on 16384 until the fit pass runs.

**Quality.** Only a coherence gate was run: temp-0 prose and code prompts plus a "capital of France" chat, checked for garbage or repetition. All 7 pass at 16k.
- NO coding, tool-call/JSON or reasoning benchmark with scores exists on vMixer.

**Failures seen:**
- gpt-oss and lfm25 answer into `reasoning_content`; results.txt lines start with "[reasoning]". A `content`-only client sees an empty reply.
- Pinned-host MoE on gpt-oss and gemma-4 fails with "auxiliary_alias_not_identity". The root cause is found (aux-alias fix #2, not yet applied), so those two run with n-cpu-moe instead.
- The Qwen3.6 and Ornith fast path depends on the UNCOMMITTED llama.cpp branch fix/wddm-pinned-garbage.
- The ctx-rerun script reports a timed-out depth as a PowerShell null-method "error" (script bug).
- No OOM at 16k; every preset sits at 7.7–8.0 GB.
- Template/tool-call breakage was not tested.

**Recommendation for the first seat (Claude Opus 5):**
- **Coding worker: Qwen3.6-35B-A3B.** It is the only preset that holds up at depth (7.9 t/s at 100k), has 25 t/s decode and answers into plain `content`.
  - Cost: 52 s cold load and slow prefill (81 t/s, so an 8k prompt takes about 100 s). Set the seat timeout to 420 s or more.
- **Cheap summarizer: lfm25.** 85 t/s decode, 1844 t/s prefill and a 14 s load, but it only works once the seat reads `reasoning_content`.
- **Fallback if prefill dominates:** Nemotron (242 t/s prefill, 24 t/s decode, 31 s load).
- **Skip for now:** DeepSeek-Lite (13.8 t/s on code, collapses at depth).
## Pending peer requests (2026-09-17 23:0x, Claude Opus 5, session b025a0ef, FINISH at 175k: nothing below has been run)
- **Harness origin:** ndi2 says `feat/heterogeneous-teammates` is on origin (lseekv1) at 813279c2f5, confirmed by a gatekeeper receipt. Seat work can now be based on it, after a fetch.
- **Gatekeeper fix:** ndi2 Claude Opus 5 (session 95f8f455, bridge `session_01KacQWkTATZGquhiaPuqt8N`) reports that the vMixer PowerShell gatekeeper is the pre-09-13 script, so every ndi2 request fails with "Cannot find path". The fix is `.sync/FIX-GATEKEEPER.ps1` on brain origin, since de7c656. Taken from git show and run with `FIX_GATEKEEPER_NO_PAUSE=1`, it:
  - replaces Gatekeeper.ps1 and queue-build.mjs in the Codex outputs\gatekeeper folder, keeping `.bak` copies;
  - runs `-CheckOnly`;
  - restarts the monitor hidden.

  Expected output: "3 open request(s), 3 for another machine (left alone)". Afterwards, check that exactly one powershell process has `\Gatekeeper.ps1` in its command line, created after the run, and that no new failed receipts appear. Reply to that bridge with the full output.
  **Needs the user's go**, because it replaces and restarts the push gatekeeper. The peer also said to ask first.
## Claim 2026-09-17 23:43 (Claude Opus 5, claude-opus-5, Claude Code desktop session 7084d817, vmixer2o2)
New owner; b025a0ef retired at FINISH. Verified at claim: 8090 free (router stopped, `llama-owned.json` absent, `llama.enabled` present); 8080 = ctx-fit llama-server pid 36456 (DeepSeek-Lite 131k) under ctx-fit.ps1 pid 35608, owned by the moe-cache session; 8082 FCC pid 13908; 3080 DSH pid 17880. `llama-local` not yet in settings.yaml. Plan: add provider now (config only, no GPU); router start, picker/chat checks and seat-path tok/s wait for ctx-fit to finish. Gatekeeper fix (pending peer request) still needs user go.
- 23:44 (Claude Opus 5, 7084d817): **provider added.** `llm-pi-ai.providers.llama-local` inserted before `agent-default-model` in `~/.dsh/settings.yaml`: openai-completions, `http://127.0.0.1:8090/v1`, 7 ids = models.ini section names, contextWindow 16384, no apiKeyEnv. Backup `settings.yaml.pre-llama-local-234415`. Validated with yaml@2.9.0 parse: 7 models, baseURL correct. Picker/chat checks not run yet (router down; ctx-fit holds GPU). Remote Control on for this session (peer name claudecode-81).
- 23:5x PREPARE checkpoint (Claude Opus 5, 7084d817, 100k context): Remote Control on (peer name claudecode-81). Asked ndi2 session "Remote access setup" for missing files, sorted into three buckets: (a) on origin, pull; (b) local on ndi2, needs push; (c) not in git, paste. No reply yet. Harness vMixer is 56fc59878d, 15 behind origin 813279c2f5, dirty (agy-profile.mjs plus its test belong to another session; do not commit them). Brain fc677e8, ahead 10, uncommitted edits to this note and the moe-cache note. **Next:** once the moe-cache session restarts the router on 8090 after ctx-fit (pid 35608): check the picker lists llama-local, send one chat per model, measure seat-path tok/s (DeepSeek-Lite, Qwen3.6, max_tokens 256), reply to ndi2, run the live DSH start/stop test, commit brain locally. Gatekeeper fix still needs the user's go.
- 2026-09-18 00:5x PREPARE checkpoint (Claude Opus 5, 7084d817, 120k): **Pulls done.** Brain merged origin 081affe as c3ddafb, now ahead 12, and a push request is still to be filed. Harness fast-forwarded to 813279c2f5, clean. The other session's agy-profile WIP is in stash@{0} and `~/Documents/claudecode/deepseek-harness-agy-profile-wip-20260918.patch`; it is not reapplied, because origin changed the same files. **ndi2 request (claudecode-77, bridge session_01Q11MP2t46sgjS7sbFkGPVU):** raw test output. Test 4 (versions) is sent. Tests 1–3 wait for ctx-fit pid 35608: cold/warm chats on Qwen3.6 + lfm25 at max_tokens 512, a Qwen tool-call test, and a DSH provider-path chat through the browser pane at :3080. Script: scratchpad `llama-test.mjs`; run it with `node llama-test.mjs Qwen3.6-35B-A3B-UD-Q4_K_M lfm25-8b-a1b-Q5_K_M`. Start the router with `~/.dsh/llama-control.ps1 -Action start` only after ctx-fit exits. ctx-fit is still running at 00:47: DeepSeek c65536 depth 49152 gave no response in 60 min (VRAM 7095/7136, n-cpu-moe 25).

## FINISH checkpoint 2026-09-18 (Claude Opus 5, claude-opus-5, session 7084d817 / peer claudecode-81, vmixer2o2): read this first
Hook fired at 151k context, so no new scope was started. **User ask (01:0x):** "lets move forward and keep working on the wiring but not waiting for final benchmarking lets come back to benchmark write a handoff for the benchmarking agent to add in real numbers later". Benchmarks were split out to [[handoff-2026-09-18-0110-llama-benchmarks]] (unclaimed). This note carries the **wiring** only.

**Done (verified):**
- The `llama-local` provider is in `~/.dsh/settings.yaml` (backup `settings.yaml.pre-llama-local-234415`), and a yaml@2.9.0 parse shows 7 models. The DSH picker has not been checked.
- Harness fast-forwarded to origin 813279c2f5 and is clean. The other session's agy-profile WIP is in stash@{0} plus `~/Documents/claudecode/deepseek-harness-agy-profile-wip-20260918.patch`. It was not reapplied because origin changed the same files; whoever owns agy-profile decides.
- The brain merged origin 081affe (c3ddafb). Local commits since then: 745fe1d, plus this checkpoint commit. It is ahead of origin, and **no push request has been filed yet** (ndi2 asked for one).
- Remote Control is on. Peers: ndi2 claudecode-77 (bridge `session_01Q11MP2t46sgjS7sbFkGPVU`), and the moe-cache session claudecode-c6 (cc21302e, which holds report-table).

**Half-done (processes and ports):**
- **router-setup.ps1 -WaitPid 0**, started by this session at 01:05:27, is still running verify: powershell pid 33036, router llama-server pid 19716 on **8090**. Results so far: Qwen3.6 OK (61 s, 19.97 t/s) and Ornith OK (56 s, 19.31). The earlier errors were collisions with claudecode-c6's overlapping run (pid 26668, now gone). models.ini was regenerated at 01:05:28 from post-ctx-fit best-configs.
- **Next owner, first:** wait for pid 33036 to exit (router.txt ends with its summary). Stop pid 19716 **by pid** (`taskkill /PID 19716 /T`), run `powershell -File ~/.dsh/llama-control.ps1 -Action start`, and check `llama-owned.json` plus `/health`. Then tell claudecode-c6 "router done" (it is waiting and will not touch router-setup or llama-control until then).

**Seat design (approved by the user: "keep working on the wiring"; ndi2 to-do items a–d, on 813279c2f5).** Not started, no code written. All work is in `packages/council/tool-council/src/seats.ts`:
1. Add `readonly local?: boolean | undefined` to `SeatConfig`, with a doc comment: served by this machine's GPU, never sent the OpenRouter key, probed without a chat, routed as cost class `local`.
2. In `askOpenRouterSeat` (around line 776), drop the `Authorization` header when `seat.local === true`.
3. In `probeSeatLive` (around line 1018), when `seat.local`, do a GET on `baseUrl` with `/chat/completions` replaced by `/models`, with no auth. Fail on a non-2xx response or when `data[].id` lacks `seat.model`. Never POST a chat, because that forces a model swap of 13–57 s.
4. In the SSE reader (around line 1192) and `readWholeBody` (around line 1104), also read `reasoning_content`, since llama.cpp uses that key where OpenRouter uses `reasoning`.
5. Add a `DEFAULT_SEATS` entry after `openrouter-free` (around line 290): `id: 'llama-local'`, `name: 'Local llama (vMixer)'`, `transport: 'openrouter'`, `baseUrl: 'http://127.0.0.1:8090/v1/chat/completions'`, `model: 'Qwen3.6-35B-A3B-UD-Q4_K_M'`, `free: true`, `local: true`, `timeoutMs: 600_000`, `idleMs: 300_000` (prefill of 8k tokens takes about 100 s at 81 t/s with no bytes sent), `enabled: false`.
6. Routing: `route-swarm.ts:93` passes `worker.costClass`. The router already understands `candidate.local === true` (`router/resolve.ts:33`, `registry.ts:83`). Set `local: true` on the candidate when the seat is local; leave roster.ts CostClass alone (as `free`).
7. Tests in `tests/reachability.spec.ts`, using the existing `stubEndpoint` helper:
   - the local probe does a GET on /models and never a POST;
   - a missing model fails the probe;
   - no Authorization header is sent to a local seat;
   - `reasoning_content` is read (free-seat.spec.ts has a fetch `capture()` helper).
8. Verify: `tsc -b` exit 0 and the council suite green (540 before). Rebuild live DSH with `build:lib:host` (see [[dsh-harness-gotchas]]), enable `council.seats.llama-local.enabled` in settings.yaml only for the test, run one council round, then set it back to disabled. Commit locally, run queue-build.mjs, never push.

**Also still open:**
- The DSH picker shows llama-local, plus one chat through DSH.
- The live DSH start/stop test of the fcc-session.cjs llama wiring (the stop path with a real marker is untested).
- A brain push request.
- The gatekeeper fix (`.sync/FIX-GATEKEEPER.ps1`) needs the user's go.

**Do not:**
- Do not run a blanket taskkill: router-setup.ps1:77 and ROUTER.cmd kill every llama-server.
- Do not run two router-setups at once.
- Do not commit the agy-profile stash with this work.
- Never push.

## Claim 2026-09-18 01:11 (Claude Opus 5, claude-opus-5, Claude Code desktop, vmixer2o2)
New owner; 7084d817 retired at FINISH. Verified at claim: router-setup 33036 exited (verify 7/7 OK, gemma 36 s 23.6 t/s), router 19716 gone, 8090/8080 free, 8082 FCC 13908, 3080 DSH 17880, llama.enabled present, no llama-owned.json. Harness clean at 813279c2f5. Next: llama-control start, notify claudecode-c6, then seat items 1-8.
- 01:15 PREPARE checkpoint (Claude Opus 5, session claudecode-f3, 105k hook): router started by llama-control, pid 4252, marker written, /health ok; claudecode-c6 told 'router done'. Seat items 1, 2 and 5 are edited in seats.ts, uncommitted: the SeatConfig.local field, no Bearer when local, and the DEFAULT_SEATS llama-local entry. Items 3, 4, 6, 7 and 8 remain. Harness branch feat/heterogeneous-teammates at 813279c2f5, dirty only with seats.ts.
- 01:40 (Claude Opus 5, claudecode-f3): **Seat items 1-7 DONE**, harness commit 83dcec25f1 (local, on 813279c2f5): SeatConfig.local, no Bearer when local, GET /v1/models probe, reasoning_content read (SSE + whole body), DEFAULT_SEATS llama-local (Qwen3.6, 600s/300s idle, off), route-swarm candidate local:true, panel roster entry + model picker over the 7 presets (LOCAL_LLAMA_MODELS in ui-council-budget capacity.ts). Checks: tsc -b 0; council + ui-council-budget vitest 593/593; live vs 8090: probe 66 ms (no swap), lfm25 14.4 s 'Paris' via reasoning_content, Qwen3.6 41 s cold 'Paris', missing model -> 'does not list model'. Router pid 4252 under llama-control. **NOT DONE (item 8 tail):** live DSH rebuild (build:lib:host) + one council round with the seat enabled; DSH picker check of llama-local provider; fcc-session.cjs live start/stop. User asked for a full gatekeeper push+pull sync 01:3x.

## FINISH checkpoint 2026-09-18 01:55 (Claude Opus 5, claude-opus-5, session claudecode-f3 / desktop local_3a0344ed, vmixer2o2): read this first
The hook fired at 153k context. No new scope was started after it.

**Done and verified:**
- The seat is committed and PUSHED. Harness commit 83dcec25f1 is on origin lseekv1 feat/heterogeneous-teammates. git-gatekeeper (Claude Sonnet 5) ran the pre-push gate and it exited 0. Before the push: tsc -b 0 and vitest 593/593. Live test against 8090: the probe answered in 66 ms with no swap; lfm25 took 14 s and Qwen3.6 41 s, and both answered "Paris".
- Full gatekeeper sync at 01:4x:
  - brain pushed, now at 9019ca4, 0/0;
  - free-claude-code fast-forwarded 79 commits, to 8ac3c6cd;
  - plugins, green-energy, billboard and gep-pivot are in sync;
  - the 3 open push-requests belong to ndi2 and were left alone.
- The router runs as pid 4252 under llama-control, on 127.0.0.1:8090.
- Remote Control is on for this session.

**Peer finding (claudecode-ed, benchmark session):**
- At max_tokens 512, Qwen3.6 and lfm25 spend every token in reasoning_content and leave content "".
- With chat_template_kwargs: {enable_thinking:false}, Qwen puts its answer in content at 20.4 t/s.
- The council sends max_tokens 16000 (DEFAULT_MAX_OUTPUT_TOKENS). A thinking draft should therefore reach content, but when it runs out of tokens the seat falls back to raw reasoning text.
- **Next fix, decision:** send chat_template_kwargs:{enable_thinking:false} in askOpenRouterSeat when seat.local. The alternative is a per-seat option. Add a test and commit locally.
- Other peer findings: Qwen tool_calls are well-formed; cold load is 41 s and warm is 25.9 s per 512 tokens.
- **DSH UI bug:** the expired Pipeline panel sits above the model-picker menu, so a click on "Local: Qwen3.6" fell through to the panel and sent "Restart the pipeline..." twice on GPT-5.6-Sol. The picker also will not switch an existing session to Local Qwen. Not fixed, and it needs its own task.

**Still open (item 8 tail):**
1. Rebuild live DSH (build:lib:host, see dsh-harness-gotchas).
2. Enable council.seats.llama-local.enabled for one council round, then set it back to disabled.
3. Check that the DSH picker lists the llama-local provider, with one chat through it.
4. Run the live start/stop test of the fcc-session.cjs llama wiring.
5. Apply the enable_thinking fix above.

**Do not:**
- Do not run a blanket taskkill of llama-server.
- Stop the router only with llama-control.ps1 -Action stop.
- Do not commit the agy-profile stash@{0}.
- Never push outside the gatekeeper.
- 13:12 (Claude Opus 5, claudecode-f3, Remote Control ON): user 'push all outstanding / pull what you don't have' - git-gatekeeper (Claude Sonnet 5) synced all 7 repos to 0/0: brain pushed 1d5404b..8acd423 (0 conflicts); harness 83dcec25f1 unchanged, untracked optimize.ts (OpenClaw session) + stashes untouched; others already in sync; FCC now pid 19004 on 8082. Only open push-request is ndi2's plugins 4d52673 (other host). Seat NEXT items unchanged (see 01:55 FINISH).

## Claim + PREPARE 2026-09-18 13:15 (Claude Opus 5, claude-opus-5, desktop session local_0bc05eeb, vmixer2o2, Remote Control ON)
New owner; claudecode-f3 retired. Verified at claim: router 127.0.0.1:8090 pid 23412 under llama-control (llama-owned.json pid 23412, started 639253441440317745), /health ok, llama.enabled present; 8082 FCC pid 19004; 3080 DSH pid 12732; 8080 free. Harness feat/heterogeneous-teammates at 83dcec25f1, behind origin 1, untracked optimize.ts (OpenClaw session, not ours); stash@{0} agy WIP untouched. Brain behind 4, dirty (this note + agent log). User asks this session: "push to gatekeeper" (all repos handed to git-gatekeeper), "activate remote" (done). Item 8 tail (1-5 in 01:55 FINISH) not started. Next after the gatekeeper run: enable_thinking:false fix for local seats in askOpenRouterSeat + test, then DSH rebuild + one council round with the seat enabled.
- 13:20 (Claude Opus 5, local_0bc05eeb): gatekeeper (Claude Sonnet 5) sync done: brain pushed 7609246..2d87f30 0/0 (its own log line left uncommitted by design); harness ff 83dcec25f1..f97db95866 (writer-route + local-targets from e762f7), 0/0, optimize.ts + stashes untouched; other repos 0/0; open push-request = vmixlaptop2x6 plugins 4d52673 (other host). Session archived by user; item 8 tail (1-5) still NOT started. Next owner: base seat work on f97db95866 (local-targets may now own the seat baseUrl - read handoff-2026-09-18-0121-local-llm-routing-targets first), then enable_thinking:false fix + test, DSH rebuild, one council round.

## Claim 2026-09-18 13:22 (Claude Opus 5, claude-opus-5, Claude Code desktop, vmixer2o2)
New owner; local_0bc05eeb retired. Verified at claim: router 8090 pid 23412 = llama-owned.json, /health ok, llama.enabled present; 8082 FCC 19004; 3080 DSH 12732; 8080 free. Harness at f97db95866 = origin, only untracked optimize.ts (not ours), stashes untouched. Brain ff to origin db0b1f9, dirty only this note + agent log. Read local-llm-routing-targets: routeLocalSeat now wired in index.ts (routedSeats); seat baseUrl on vMixer still resolves loopback 8090. Next: enable_thinking:false for local seats + test.

## FINISH checkpoint 2026-09-18 13:34 (Claude Opus 5, claude-opus-5, Claude Code desktop, vmixer2o2): read this first
150k hook fired; no new scope started after it. Remote Control not toggled this session.
**Done and verified:**
- **enable_thinking fix:** harness commit **512bbabaaa** (on f97db95866, ahead 1): `askOpenRouterSeat` sends `chat_template_kwargs:{enable_thinking:false}` only when `seat.local`; test "turns thinking off for a local seat only" in tests/reachability.spec.ts (stub now records bodies). vitest tool-council 596/596, tsc -b 0, lint 0. Live 8090: Qwen3.6 content "Paris", reasoning 0 tokens, 34 s cold; lfm25 template ignores the flag (278 reasoning chars) but content still "Paris", 79.6 t/s. **Push request filed by hand** in push-requests.md (queue-build.mjs refused: untracked optimize.ts belongs to the OpenClaw session, left alone).
- **DSH rebuilt** by `fleet.mjs build` exit 0, `.built-commit` = 512bbabaaa; UI shows build 512bbab.
- **fcc-session llama START path live-verified:** router stopped with `llama-control -Action stop` (marker removed), then launch-dsh.cmd (launcher cmd pid 20388, monitor pid 18708, DSH pid 23428 on 3080) started the router itself: pid 40636, llama-owned.json written, /health ok, fcc-status.json `llama.ready: true`.
- **DSH picker:** "Local llama (vMixer GTX 1070)" tab lists all 7 "Local: ..." models; selecting LFM2.5 sticks.
- **Defect fixed (config):** DSH chat failed "No API key for provider: llama-local" (pi-ai demands a key). Added `apiKeyEnv: LLAMA_RELAY_TOKEN_VMIXER2O2` to the llama-local provider (backup `settings.yaml.pre-llama-apikey-133218`) and `LLAMA_RELAY_TOKEN_VMIXER2O2: loopback-no-auth` to `~/.dsh/.credentials.yaml` (backup `.credentials.yaml.pre-llama-ref-133218`). Same ref name the llama relay's `connect` writes on ndi2; brain-sync keeps LLAMA_RELAY_TOKEN_* local-only; loopback llama-server ignores the header. Retry got past auth.
**Open finding, needs user decision:** DSH agent chat on a local model fails: `request (23280 tokens) exceeds the available context size (16384 tokens)`. DSH's base prompt (system + AGENTS.md + tools) is 23,280 tokens; every router preset is c=16384. Options: (a) raise router presets to 32k+ in best-configs.json / router-setup.ps1 (costs decode speed and VRAM; ctx-fit data in handoff-llama-cpp-moe-cache-setup), (b) keep local models as council seats only (seat path sends just the question, fits 16k), (c) slim AGENTS.md/system prompt for local providers. Not asked yet.
**NOT DONE:**
1. One council round with the seat on: add `llama-local: {enabled: true}` under `council.seats` (after openrouter-free, ~line 157-160 of settings.yaml; enabled seats now deepseek, free-claude, kimi, openrouter-free), set the DSH session model to a non-local one (lfm25 is selected in session "Local llama DSH check"), turn Council mode on, ask one short question, confirm the llama-local seat answers, then set it back / remove it.
2. fcc-session llama STOP path: end DSH pid 23428 (finish() runs on the DSH child's exit) and confirm router pid 40636 gone + llama-owned.json removed; then relaunch DSH (launch-dsh.cmd) so the user has it back.
3. Ask the user the context question above.
4. Gatekeeper push of 512bbabaaa + brain on the session-end cue.
**Processes/ports left running:** DSH 3080 pid 23428 (monitor 18708, launcher 20388), router 8090 pid 40636 owned by llama-control, FCC 8082 pid 19004. Browser pane open on :3080.
**Do not:** blanket-taskkill llama-server; commit optimize.ts or the agy stash; push outside the gatekeeper; hand-edit models.ini.
- 13:36 (Claude Opus 5, desktop session local_3fe88e56, vmixer2o2): Remote Control turned ON at user request; next owner turns it on first.
