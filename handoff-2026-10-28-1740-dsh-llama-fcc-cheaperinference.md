---
name: handoff-2026-10-28-1740-dsh-llama-fcc-cheaperinference
description: DSH local llama/FCC incident T-4546488d + CheaperInference in model list + push to both machines
metadata:
  type: project
---
Handoff id: handoff-2026-10-28-1740-dsh-llama-fcc-cheaperinference
Time: 2026-10-28 17:40Z
Host: vmixer2o2
Session: dbd8a919-7229-41fb-8d8f-a0323e9efcb5 (Claude Code desktop, "DSH local LLM and free Claude issues" [e02541])
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5
Remote Control: off
Ask: diagnose+fix DSH local llama and Free Claude (pm T-4546488d); add CheaperInference to agent/model list; push all fixes to both machines.
Llama cause: not broken; blitz run T-4dfa4288-A (pid 49308) holds the only Qwen slot (np=1), 50k prompt, ~74 min/turn at 5.6 t/s.
Llama fix: llama-local Qwen maxTokens: 8192 in ~/.dsh/settings.yaml (user approved). Backup settings.yaml.bak-llamacap-20261028. UNVERIFIED: next slot task must show max_tokens 8192 (curl 127.0.0.1:59850/slots), est 18:25Z.
FCC: working, 155s for a tiny reply (Gemini retries then fallbacks). No change made.
CheaperInference: provider (10 models) + council.extraSeats/seats ci-kimi enabled on vmixer; picker verified in browser; live test CI-OK $0.000002. Backup settings.yaml.bak-ci-provider-20261028.
ndi2: fleet/ADD-CHEAPERINFERENCE-TO-DSH.cmd + apply-cheaperinference-provider.mjs (idempotent, tested on copy). Not run on ndi2 - no route from vmixer; reaches ndi2 only once brain publishes.
Policy: live-settings-yaml guard in ~/.claude/rules/policy.json was set to ask twice for the approved edits and restored to block (verify it reads block). Another session narrowed its pathPattern to **/.dsh/settings.yaml; kept.
Push: deepseek-harness 6708d6fde6..c585614786 pushed by git-gatekeeper. Harness has another session's uncommitted llm-claude-cli work - untouched.
Brain: PUSHED 17:37Z (0/0 vs origin, fleet files in dc5aef734). Fixed core.bare=true + stale refs/remotes/origin/main.lock. Unresolved sidecar .sync-conflicts/ENABLE-PM-FUNNEL.ps1.from-remote.md (not this work, left).
pm: comment #1000 on T-4546488d with findings. Task not moved to REVIEW yet.
Open: ndi2 bridge remote agent last_seen 10-12 not investigated; ndi2 DSH not updated/rebuilt. ChatGPT replied via bridge seq 16188.
Next: on ndi2 (unseen 3 days) run fleet/ADD-CHEAPERINFERENCE-TO-DSH.cmd + harness pull/rebuild; verify llama 8192 cap on next slot task.
Do not repeat: settings.yaml paths in a Bash command trip the guard even for reads/comments; use Read/Grep or a file.
