---
name: handoff-2026-09-18-2112-dsh-down-vmixer
description: DSH not listening on 3080 on vMixer; user asked "can you fix dsh before we run out of quota"
metadata:
  type: project
---
- Id: handoff-2026-09-18-2112-dsh-down-vmixer. Created 2026-09-18 21:12. Host vmixer2o2. Session local_68758c98 ("Remote control startup"), Claude Opus 5 (claude-opus-5), Remote Control ON. Owner: this session; no collaborators.
- Repo: ~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates, HEAD 512bbabaaa (ahead 1 of origin), untracked packages/council/tool-council/src/optimize.ts (OpenClaw handoff's, not ours - leave).
- Ask: "can you fix dsh before we run out of quota". Quota 60% session / 27% week (hook cache stale).
- State at 21:12: 3080 refused (no listener). Up: llama router 127.0.0.1:8090 (pid 40636), fcc 0.0.0.0:8082 (pid 19004). No 8080.
- Done 21:14: DSH window had closed ~21:07 (no exit line in fcc-monitor.log, killed not finished; router 40636 + FCC 19004 survived). Relaunched via ~/.dsh/launch-dsh.cmd: 3080 200 after 80s, fcc-status monitorPid 8936 dshPid 33116, llama ready; UI loads, no console errors.
- Open: DSH chat on local llama fails "request (29166 tokens) exceeds the available context size (16384)" (was 23280 at 13:34; see handoff-2026-09-17-2110-llama-dsh-wiring FINISH 13:34 options a/b/c). Asked user which option.
- (superseded, see FINISH below)

## FINISH 2026-09-18 21:35 (Claude Opus 5, session local_68758c98, vmixer2o2, Remote Control ON) - 150k hook fired, no new scope
- User chose "Qwen3.6 to 48k" for local chat context.
- Done + verified:
  - D:\dev\tools\router-setup.ps1: `$ctxOverride = @{ 'Qwen3.6-35B-A3B-UD-Q4_K_M' = 49152 }` (rewrites -c in that model's args) + new `-WriteOnly` switch (write models.ini/ROUTER.cmd, no kill/start). Backup router-setup.ps1.pre-qwen48k-211649.
  - `router-setup.ps1 -WaitPid 0 -WriteOnly` exit 0; models.ini diff vs models.ini.pre-qwen48k-211649 = only header stamp + Qwen `c = 49152`.
  - ~/.dsh/settings.yaml line 100: Qwen3.6 contextWindow 49152 (backup settings.yaml.pre-qwen48k-211649).
  - Router: `llama-control.ps1 -Action stop` then `-Action start` (NOTE: `restart` is a no-op when healthy). New router pid 20912 (llama-owned.json). Direct chat: Qwen3.6 "Paris", n_ctx 49152 from /props, VRAM 7861/8192 MiB, 37 s cold.
- NOT fixed - root cause found: DSH UI chat on Qwen3.6 (session "Local llama DSH check", message "Qwen 48k check...") gets canceled. Router log (~/.dsh/llama-server.stderr.log): at 1:04 "models_max reached, request for name=lfm25-8b-a1b-Q5_K_M queued" -> Qwen instance exited -> lfm25 loaded -> Qwen reloaded; then "Connection handling canceled"; DSH shows "Retried model request (1/5)". So DSH sends a side request (likely title/summary/compaction or a secondary "small model" setting) to lfm25 while the main turn runs on Qwen; with --models-max 1 the swap kills the prefill. The 29k prefill also takes minutes (~50-80 t/s pp).
- NEXT (exact): find which DSH setting routes the side request to lfm25 (grep ~/.dsh/settings.yaml for lfm25 / small/title/fast model; the session's earlier model was lfm25 - may be the session's own previous model). Point it at the same model as the main turn or a non-local model; stop the running retry loop first (Stop generating in the UI, session "Local llama DSH check"). Then resend one chat and verify an answer. If DSH's own request timeout also cancels a ~6-10 min prefill, that is the next limit (check pi-ai timeout for llama-local).
- Running: DSH 3080 dshPid 33116 (monitor 8936), router 8090 pid 20912 (llama-control owned), FCC 8082 pid 19004. The UI turn may still be retrying (up to 5) and swapping models - harmless but busy GPU. Browser pane open on :3080.
- Uncommitted: brain notes only (auto-commit by brain-sync). router-setup.ps1 / models.ini / settings.yaml are local, not in any repo. Nothing committed, nothing pushed.
- Do not: use llama-control `restart` to apply preset changes; run router-setup without -WriteOnly (it taskkills all llama-server and bypasses the llama-control marker); hand-edit models.ini; blanket-taskkill llama-server.

## RESUME 2026-09-18 23:56 (Claude Opus 5, new Code session on vmixer2o2, Remote Control state unknown) - claimed ownership
- Verified live: 3080 pid 33116, 8090 pid 20912, 8082 pid 19004 (same as FINISH). No settings key routes to lfm25 (agent-default-model = llama-local Qwen3.6).
- Decoded session log (~/.dsh/sessions/--C-Users-vMixer-Documents-Harness~0020Build--/session-3f4c3b49-.../session.jsonl.zstd; multi-frame zstd, decode each 28b52ffd frame): session's first request/header was lfm25 (13:31). Turn 3 ran compaction first (compaction/end seq 36 "summarization truncated at the token cap") on the old lfm25 route - that is the lfm25 swap at router 1:04, not a title/side model setting. Qwen main request then failed "pi-ai stream idle timeout after 300000ms" (seq 42), llm/retry 1/5 started. Real blocker = 300 s pi-ai idle timeout vs multi-minute 29k prefill on GTX 1070.
- NEXT: find where the 300000 ms pi-ai stream idle timeout is set (harness llm-pi-ai package / settings), raise it for llama-local (or globally) via settings.yaml if a key exists; else start a fresh DSH session on Qwen (no lfm25 header) and retest. No repo edits yet.

## CLOSED 2026-09-19 00:10 (Claude Opus 5, vmixer2o2)
- Fix: ~/.dsh/settings.yaml llm-pi-ai.providers.llama-local gained `streamIdleTimeoutMs: 1800000` and `timeoutMs: 1800000` (backup settings.yaml.pre-idle-<HHMMSS>). Hot-reloaded, no DSH restart.
- Verified in DSH UI: new session "Idle-timeout check: capital of France?" on Local Qwen3.6 answered "Paris". Router: prompt eval 468.6 s / 23748 tokens (50.68 t/s), eval 32 tokens 10.88 t/s, no cancel. UI footer: LLM 8m6s, TTFT 8m3s.
- Remaining limit (not a bug): every local turn pays ~8 min prefill for the 23.7k-token DSH system prompt, cache hit 0%. Old session "Local llama DSH check" still has lfm25 route in its history; use new sessions.
