---
name: handoff-dsh-model-choice
description: RESOLVED 2026-09-12 20:16 — DSH model choice for the OpenRouter free seat/provider (pin one free model or keep rolling) and the Codex seat (pick a GPT model); live in DSH, uncommitted
metadata:
  type: project
---

# Handoff: DSH model choice (OpenRouter free + Codex) — resolved

Claude Opus 5 (vmixlaptop2x6), 2026-09-12. Started 17:00, handed off at 98% quota ~17:25, finished after reset ~20:16.

## Ask
Select the rolling OpenRouter free route OR an individual free model directly; select between the Codex CLI's GPT models.

## What exists now
1. **Proxy** `~/Documents/Harness Build/openrouter_proxy` (runtime copy, no repo; mirrored to `dsh-council-plugins/proxies/openrouter-free`): a request's `model` other than `proxy-auto`/`auto`/empty pins that one model (retries it, never swaps). Ids outside the free pool, paid ones included, get HTTP 400 before any upstream call. `/v1/models` lists `proxy-auto` first, then each free model with name + context_length. Restart the proxy (`start-openrouter-proxy.ps1`) to load the change on a fresh process; the :8080 one running at 20:16 (PID 21148) already has it.
2. **tool-council**: CLI seats take `modelFlag`; Codex seat `openai` ships `-m` and no model, so Codex uses `~/.codex/config.toml` until one is chosen. `council.seats.<id>.model: ""` means the seat default. Host publishes `council.codexModels` from `~/.codex/models_cache.json` (visibility != hide) at boot.
3. **Council Budget panel**: model dropdown under OpenAI ("Codex default (config.toml)" + gpt-5.6-sol, gpt-6-astra, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5) and under OpenRouter Free ("Rolling free (auto-routed)" + free chat models from OpenRouter's public /models, same filter as the proxy).
4. **Model picker**: `~/.dsh/settings.yaml` `llm-pi-ai.providers.openrouter-free.models` = `proxy-auto` + 20 free models (backup `settings.yaml.pre-model-choice-172232`). The list is static and will go stale; the proxy's `/v1/models` is the source for refreshing it (DSH model settings can discover from it).

## Evidence
- vitest tool-council seats/council/codex-models/free-seat + all ui-council-budget: 11 files 131/131 exit 0. `tsc -b` host and client exit 0. `build:lib:host` and panel `tsdown` exit 0.
- Live proxy: auto 200; pinned `nvidia/nemotron-3.5-lightning:free` 200 served that id (streamed: 23/23 chunks); `openai/gpt-4o` 400 "not a free chat model in the pool".
- Live `codex exec -m gpt-5.5 --skip-git-repo-check`: exit 0, header `model: gpt-5.5`.
- Running DSH (PID 34368, started 19:52 after the 17:19 lib builds): panel shows both dropdowns with the lists above; model picker "OpenRouter Free" tab lists "Free (auto-routed free models)" and "NVIDIA: Nemotron 3.5 Lightning (free)". Choosing gpt-5.5 in the panel wrote `council.seats.openai.model: gpt-5.5`; choosing default again wrote `model: ""` (left at default).

## Not done / open
- Nothing committed, nothing pushed (no commit authorised). deepseek-harness files: tool-council `src/{seats.ts,index.ts,codex-models.ts}`, `tests/{seats,council,codex-models}.spec.ts`; ui-council-budget `src/client/{CouncilBudget.tsx,capacity.ts,locales.ts,CouncilBudget.module.css}`, `tests/seat-model.client.spec.tsx`. seats.ts/index.ts also hold other sessions' uncommitted journal and Stop-run work, so a commit must separate hunks. dsh-council-plugins: 4 proxy .py files + README.
- The :8080 proxy was started from this Claude Code session's background task and may stop with it; DSH's launcher does not start it.
