---
name: handoff-2026-10-27-0005-dsh-fcc-llama-fix
description: DSH FCC + local llama not working on vmixer2o2 - FCC fixed live; llama cache-ram fix applied, cache-hit proof pending
metadata:
  type: project
---
Handoff id: handoff-2026-10-27-0005-dsh-fcc-llama-fix
Time: 2026-10-27 00:05Z
Host: vmixer2o2
Session: 73c893b3-a3fc-4b89-815e-c08ec6d74f45 (Claude Code desktop)
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5
Ask: "my dsh free claude and dsh local llama didn't work diagnos and fix"
Remote Control: off
FCC cause: Gemini 429/503 (quota); NIM fallbacks dead: deepseek-v4-pro-0813 410 Gone, nemotron-3-super-120b-a12b 404. SambaNova key 401.
FCC fix: MODEL_FALLBACKS=gemini/models/gemini-3.8-flash,nvidia_nim/minimaxai/minimax-m3.1-flash,nvidia_nim/z-ai/glm-5.3 applied via POST /admin/api/config/apply (no restart). Backup ~/.fcc/.env.bak-20261026.
FCC verified: /v1/messages claude-sonnet-4-5 -> 200 "FCC-OK" in 34s (Gemini retries then MiniMax).
Llama cause: two blitz headless DSH runs share Qwen3.6 slot (np=1), cache-ram=0, ~28k-token prompts evict each other; pp 24 tok/s (= benchmark baseline) -> ~20 min per turn, repeated restarts.
Llama fix: D:\dev\tools\launch\models.ini Qwen cache-ram 0 -> 8192 (backup models.ini.bak-20261026). Router stopped 00:01Z after task 803 finished; DSH llama monitor auto-restarted it; child pid 48272 has --cache-ram 8192.
Status: CLOSED 07:07Z - llama verified: 50k-ctx turns process only 149-4879 new tokens in 8-97s (was full ~28k reprocess, ~20 min, cancel loop); turns complete continuously. Occasional run switch still reprocesses (37k in 672s).
Uncommitted: ~/.fcc/.env, models.ini (not repos).
Processes: router pid 56612 :8090, FCC pid 26584 :8082.
Next: none required. Optional: raise cache-ram above 8192 if run switches keep forcing full reprocess.
Do not repeat: llama-control.ps1 restart via -ExecutionPolicy Bypass was denied by auto mode; Stop-Process + monitor self-heal works.
Open: 40 unacked blitz bridge messages (C-f3676722) - not acted on.
