---
name: handoff-2026-10-19-0920-dsh-local-llama-down
description: DSH local llama (8090) down since 09-30 because brain-sync dropped the llama hook from fcc-session.cjs; hook restored in shipped copy, router up, Qwen PASS
metadata:
  type: project
---
Handoff id: handoff-2026-10-19-0920-dsh-local-llama-down
Updated: 2026-10-19 12:40Z
Host: vmixer2o2
Model: Claude Opus 5.5 (claude-opus-5-5), Claude Code desktop
Status: DONE except one untested path
Ask: "local llm dsh not working please assess and fix"
Cause: brain-sync.mjs ships .sync/dsh/fcc-session.cjs into ~/.dsh (DSH_SHIPPED_FILES); 09-30 copy lacked the llama-control start/monitor hook, so 8090 never started after 09-30 while agent-default-model = llama-local Qwen3.6.
Fix: shared-brain/.sync/dsh/fcc-session.cjs re-adds llama start (not awaited), monitor (name 'Local llama', writes llama-status.json) and stop; guarded by existence of ~/.dsh/llama-control.ps1 and skipped in --watch mode. Same file installed to ~/.dsh/fcc-session.cjs (diff clean).
Verified: node --check OK; llama-control.ps1 start/status exit 0; Qwen3.6 chat LOCAL-OK (cold 65 s, 6 tok/s); streamed + Bearer request OK; VRAM 7912/8192 MiB; 8090 /health 200 at 09:20Z.
Launch path: PROVEN - DSH relaunch 2026-10-19T04:41Z auto-started llama (04:41:35Z ready, router pid 5756); llama-status.json ready:true 12:36Z.
Restart for OpenClaw 08:09Z build: handed to session "DSH GUI multi-run lanes (resumed)" per hub; not this session.
Uncommitted: shared-brain .sync/dsh/fcc-session.cjs (brain sync commits it). No repo edits.
Next action: none; DSH restart owned by DSH GUI multi-run lanes session.
Do not repeat: do not edit only ~/.dsh/fcc-session.cjs; brain-sync overwrites it from .sync/dsh.
Resume pointer: NOT replaced - resume-vmixer2o2.md is owned by active DSH GUI multi-run session (c46ed5).
