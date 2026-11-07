---
name: handoff-2026-09-24-0020-dsh-local-llm-context-overflow
description: DSH local-LLM turn failed with llama.cpp exceed_context_size_error (57390 > 49152); Qwen3.6 ctx raised 49152->65536 and DSH contextWindow synced, proven live with a 57549-token 200; DSH not yet relaunched
metadata:
  type: project
---

# Handoff 2026-09-24 00:20 — DSH local LLM context overflow

- **Handoff id:** handoff-2026-09-24-0020-dsh-local-llm-context-overflow
- **Updated:** 2026-09-25 01:40 local (vmixer2o2) — fix applied and proven; session ended on FINISH-NOW at 182k context. Resume pointer: `resume-vmixer2o2.md`.
- **Host:** VMIXER2O2 (user dir `~`) — the local-LLM node
- **Session:** local_e155a103-7d35-4ff7-80f4-114682b7edc0, Remote Control **ON** (turned on this session, as asked)
- **Model:** Claude Opus 5 (Claude Code, desktop app)
- **Repo:** `~/Documents/claudecode/deepseek-harness`, tip `56f2eddbf7` = `~/.dsh/.built-commit`, so the running DSH is this code. **Nothing in the repo was edited or committed this session.**
- **Owner:** Claude Opus 5, this session. A peer session wrote `handoff-2026-09-24-0015-vmixer2o2-openrouter-relaybase.md` 5 minutes earlier — different topic, no overlap.

## The user's exact ask

"please turn on remote and address the last dsh local llm run error" — the pasted failure:

```
This turn failed 400: {"code":400,"message":"request (57390 tokens) exceeds the available
context size (49152 tokens), try increasing it","type":"exceed_context_size_error",
"n_prompt_tokens":57390,"n_ctx":49152}
```

## Done, with evidence

1. **Remote Control on** — `set_remote_control` returned `{"remoteControlState":"on"}`.
2. **Blamed the right model.** 49152 belongs to **Qwen3.6-35B-A3B-UD-Q4_K_M** and nothing else: `models.ini` had `c = 49152` for it (every other preset is 16384) and `~/.dsh/settings.yaml` declared `contextWindow: 49152` for the same id under `llm-pi-ai.providers.llama-local`.
3. **`models.ini` raised to `c = 65536`** (`D:\dev\tools\launch\models.ini`, backup `models.ini.pre-qwen64k-20260924*`). Bench history justifies it: Qwen3.6 is the only local model that loads at c=131072 on this 8 GB GTX 1070; 49152 was a speed choice (25.4 t/s vs 10.8 t/s at 131072).
4. **Router restarted and serving the new size** — `--ctx-size 65536` now appears in the Qwen args from `GET /v1/models`. Note `llama-control.ps1 -Action restart` is a **no-op while the router is healthy** (`if (Test-Ready) { exit 0 }` — a deliberate race guard for the monitor's recover path), so the restart had to be `stop` then `start`. Left as is.
5. **`~/.dsh/settings.yaml` `contextWindow: 49152 → 65536`** for that model (backup `settings.yaml.pre-ctx65k-20260924*`). `brain-sync.mjs` only owns saved-run chunks and credentials in that file, so the edit will not be reverted by the 20 s sync tick.
6. **Qwen loads at the new size:** `nvidia-smi` shows **7852 / 8192 MiB** used with the model resident — only ~340 MiB free, close to the spill line that cost gpt-oss half its throughput on 2026-09-23. Watch the measured rate before trusting it.

## Live proof — PASSED

`ctx-proof3.mjs` (background `bpofatvfj`, scratchpad; sizing over fetch, completion over curl so no
client timeout can cut the prefill):

```
{"step":"sized","promptTokens":57531,"agentsMdTokens":23829}
{"step":"request","status":200,"seconds":938.47,
 "usage":{"prompt_tokens":57549,"completion_tokens":2,"total_tokens":57551},
 "timings":{"prompt_n":57549,"prompt_ms":938172,"prompt_per_second":61.34,
             "predicted_per_second":7.12},
 "content":"OK"}
```

**A 57,549-token prompt — larger than the 57,390 that failed — now returns 200 with content.** The
same request at c=49152 was refused in milliseconds by request validation. Cost of the size:
**938 s (15.6 min) of prefill at 61.3 tok/s**, decode 7.1 tok/s. DSH's `timeoutMs`/
`streamIdleTimeoutMs` of 1,800,000 ms covers that; a plain `fetch` does not (undici cuts at 300 s).
VRAM held at **7,934 / 8,192 MiB** through the run, no crash.

**The number that explains the failure:** `~/.dsh/AGENTS.md` alone tokenizes to **23,829 tokens** —
49% of the old 49,152 window, gone before a single message. Add tool schemas, memory digest and the
system prompt and the fixed envelope leaves almost nothing for conversation, which is why the turn
overflowed and why compaction (conversation-surface only) could never have rescued it.

Two earlier attempts failed on my own client, not the server, and are only worth avoiding: attempt 1
(`b6glv2m8k`) hit undici's 300 s `UND_ERR_HEADERS_TIMEOUT` mid-prefill; attempts 2 and 3
(`buse08qbq`, `bhms2l15c`) hit `ECONNRESET` from `node:http` on the ~150 KB tokenize body, both
before and after the slot went idle, so the reset is a client-side artefact, not slot contention.

## Open / not addressed

- **Why compaction did not save the turn.** `llm/src/error.ts:EXCEEDS_MODEL_CONTEXT` does match this
  wording by reading, and `llm-pi-ai/src/stream.ts:mapStopReason` checks overflow *before*
  `classifyPiAiError` turns `400` into INVALID_REQUEST, so `CONTEXT_WINDOW_EXCEEDED` should have
  reached `compaction-basic/src/index.ts:183`. Not executed, so not proven. The likely reason it
  could not recover: compaction only shrinks the conversation surface, never the fixed envelope
  (system prompt + `~/.dsh/AGENTS.md`, **measured 23,829 tokens** + tool schemas). A too-large
  envelope is unrepairable by compaction — the harness says as much in its own API catalog text.
- **DSH has not re-read the new `contextWindow`.** No settings watcher exists in the harness, so it
  applies at the next DSH launch. DSH web is live as PID **35424** (`apps/cli/src/bin.ts web`);
  it was deliberately **not** restarted, because the user may have work open in it.
- The 46% gap between DSH's estimate and llama's real count (it let 57,390 tokens go out under a
  0.8 × 49,152 = 39,321 threshold) is unexplained and is the thing most likely to bite again.

## Do not repeat

- Do not grep all of `~/.dsh` + `D:\dev\tools` for the error text — ran >120 s, found nothing.
- Do not hunt for DSH session transcripts under `~/.dsh` or the repo; none exist (only the stale
  `storages/session_projcache.json`).
- Do not use `llama-control.ps1 -Action restart` to apply a preset change; it exits 0 when healthy.

## Exact next action

1. Relaunch DSH (web PID 35424, port 3080 answering 200) **after asking the user**, so it re-reads
   `contextWindow: 65536`. Until then DSH still believes the window is 49152.
2. Add the measured c=65536 row to [[machines]] for Qwen3.6: prefill 61.3 tok/s at 57.5k, decode
   7.1 tok/s, 7,934/8,192 MiB, load 40 s — next to the existing c=49152 (25.4 t/s) and c=131072
   (10.8 t/s) rows.
3. Decide what to do about the 23,829-token `~/.dsh/AGENTS.md` envelope. That is the real ceiling
   on local seats: it is ~36% of the new window before any conversation. A local-seat-specific
   short rules render would buy back more than any ctx increase, and would cost no throughput.
   **User's call — do not trim their rules file unasked.**
4. Only if throughput matters more than headroom: c=57344 or `ctk/ctv q4_0` would claw back VRAM.
