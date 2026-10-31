---
name: handoff-2026-09-18-0731-dsh-vmixer-sync-secrets
description: User reports DSH out of sync on all updates and secrets on vMixer; new ask received at a 155k-context FINISH, not started; diagnose in a fresh session
metadata:
  type: project
---

# Handoff 2026-09-18 07:31: DSH out of sync + vMixer secrets

- Stable id: handoff-2026-09-18-0731-dsh-vmixer-sync-secrets. Created 2026-09-18 07:31 local.
- Host vmixlaptop2x6 (ndi2). Written by Claude Opus 5 (claude-opus-5), session local_434fba27-c63d-4fad-936c-01f622728ae1, Remote Control ON. That session had passed 155k context (FINISH), so it started no work on this ask.
- Owner: unclaimed. The next Claude Code session claims it.
- Collaborator: Claude Opus 5 on vMixer (vmixer2o2), session claudecode-78, bridge `bridge:session_016qU3zQyLoedeq7rBswc51V`. It is holding for the OpenRouter relay.

## User's ask (exact)
"dsh is out of sync on all updates and the secrets on vmixer"

## Known state (verify before acting; nothing below re-checked at 07:31)
- handoff-2026-09-18-0121-local-llm-routing-targets records a requested gatekeeper push+pull sync that was NOT run: brain +16/-13, harness +1 (83dcec25f1), fcc -79. This is the likely cause of "out of sync on all updates".
- handoff-2026-09-18-dsh-openrouter-fix has uncommitted brain changes: `.sync/brain-sync.mjs` (deny-list LOCAL_ONLY_REFS: OPENROUTER_API_KEY and OPENROUTER_RELAY_TOKEN no longer sealed or pulled), `.sync/selftest.mjs` (222/222), and the new `.sync/openrouter-relay.mjs` (untested, scratch test 16/18).
  - Secrets impact: once the deny-list lands and runs, vMixer no longer receives OPENROUTER_API_KEY through `dsh-credentials.enc`, and the next seal drops it from the blob. vMixer keeps its local copy until the relay is live. Other refs still sync.
- Secrets travel through `.sync/brain-sync.mjs` `syncDshCredentials` (brain `dsh-credentials.enc`, key `~/.claude/brain-secrets.key`), run at DSH launch via `brain-sync.mjs dsh` and at session start. On vMixer, check `~/.dsh/.credentials-sync.json` and `.credentials.yaml` names only (never values), and whether its brain key opens the blob (`findBrainKey` result `opens`).
- DSH build sync: `.built-commit` in `~/.dsh`, the fleet `.sync/fleet.mjs`, the Desktop UPDATE-DSH.cmd (handoff-dsh-two-machines).

## Exact next action
1. On ndi2, run `git status`/`git log @{u}..` for the brain, deepseek-harness, dsh-council-plugins and free-claude-code, plus `~/.dsh/.built-commit` against harness HEAD. List what is unpushed or unpulled.
2. Ask vMixer (claudecode-78) over the bridge for the same list: HEADs, `.built-commit`, credential ref NAMES present or missing, and the `brain-sync.mjs status` output.
3. Report the gap to the user. Pushes go only through the gatekeeper and only on the user's session-ending cue, per CLAUDE.md. Commit the relay/deny-list brain changes only if the user authorises it.

## Claimed 2026-09-18 by Claude Opus 5, session local_29f35317 (Remote Control ON)
ndi2 state, verified by `git fetch` + rev-list:
- brain main 113d7a7, 0/0 with origin, clean. The deny-list (LOCAL_ONLY_REFS in `.sync/brain-sync.mjs`) and `.sync/openrouter-relay.mjs` already went out in the auto "session changes" commits, so vMixer stops receiving OPENROUTER_API_KEY in the blob from its next sync. The relay itself is still unverified.
- harness feat/heterogeneous-teammates 83dcec25f1, 0/0, clean. `~/.dsh/.built-commit` = 813279c2f5, one commit behind HEAD (83dcec25f1, the llama seat). The live ndi2 DSH is stale.
- dsh-council-plugins main 4d52673, ahead 1, never pushed (TeamViewer one-click).
- free-claude-code main d93631e, behind 79, not pulled.
- vMixer replied (Claude Opus 5, vmixer2o2, session local_b14d780c, peer name now "OpenRouter key handoff [9f73be]", formerly claudecode-78):
  - brain 0b1097b, 27 behind origin e912620, 6 dirty (MEMORY.md, shared-agent-log.md, three handoff notes modified, handoff-2026-09-18-0133-dsh-openrouter-key.md untracked). Last brain-sync 08:31Z merged.
  - harness 83dcec25f1 0/0; untracked packages/council/tool-council/src/optimize.ts (OpenClaw session). `~/.dsh/.built-commit` MISSING, so its build state is unknown.
  - plugins 2892eae = origin; fcc 8ac3c6c = origin.
  - Credential refs: FCC_DSH_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY; brain key opens blob. It keeps OPENROUTER_API_KEY on purpose until the relay passes `connect --route lan` there. Code read (not run): `syncDshCredentials` filters LOCAL_ONLY_REFS out of `local` before planExchange, so its sync neither seals nor deletes that local ref.

## User "go" on ndi2 fixes (updated same session)
- DSH rebuild DONE: `fleet.mjs build` exit 0, "fleet: DSH build built", `~/.dsh/.built-commit` = 83dcec25f1. A running DSH host keeps old server code until restarted (not restarted).
- FCC pull DONE: `git pull --ff-only` exit 0, now 8ac3c6c, 0/0. Deps NOT synced: `uv sync --frozen` fails, "Required uv version `>=0.12.13` does not match the running version `0.12.9`" (uv at ~/AppData/Roaming/Python/Python314/Scripts/uv.exe, pip-installed). Running proxy pid 12448 on :8082 is still the old code from .venv. Next = user go to update uv (`python -m pip install -U uv`), then `uv sync --frozen`, then restart fcc-server.
- Plugins 4d52673: already in push-requests.md (open, filed 2026-09-16, same head). Nothing re-queued.
- Remaining on vMixer: brain 27 behind + 6 dirty (its next brain-sync merges), no `.built-commit` there.

## Claimed 2026-09-18 08:45 by Claude Opus 5, session local_e879d7e9 (Remote Control ON). User ask: "continue with other agent via remote complete update"
- ndi2 verified 08:46: brain a325a79 0/0, harness 83dcec25f1 0/0, plugins 4d52673 ahead 1 (queued), fcc 8ac3c6c 0/0, `.built-commit` 83dcec25f1.
- uv updated 0.12.9 -> 0.12.16 (pip). fcc: `fcc-control.ps1 -Action stop`, `uv sync --frozen` exit 0 (21s, venv rebuilt, 106 packages), `-Action start` "Free Claude ready"; :8082 pid 24916, /health 200.
  - Quirk: `uv sync --check` always says "Would replace project environment": managed python dir `cpython-3.14.0-...` reports 3.14.7. Harmless for fcc-control (runs .venv python directly) but any `uv run`/`uv sync` will rebuild the venv and fails while the proxy runs.
- DSH host restart: old launch-dsh.cmd tree (cmd 24920, fcc-session 11620, DSH 12412) killed, launch-dsh.cmd relaunched 08:53 (cmd 4676). Verified 08:56: DSH pid 29344 on :3080, GET / 200; FCC pid 24916 on :8082.
- vMixer (peer "Remote control seek agent update", bridge session_01QMQnsg8hsc8RdCrT3hnGQg, Claude Opus 5 local_f4e7f2e9) reported: brain merged a325a79, HEAD 1613b43 ahead 4 (its notes, unpushed); `.built-commit` 83dcec25f1; harness/plugins/fcc = origin; refs FCC_DSH_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY; DSH pid 17880 still old process. Sent it: update uv, fcc stop/sync/start, restart DSH, report pids + health. Reply pending.
- vMixer reply ~09:00: BLOCKED by its auto-mode classifier on three actions: kill DSH/fcc tree ("Interfere With Workloads"), replace ~/.local/bin/uv.exe (uv 0.12.11 standalone, no self-update receipt; 0.12.16 staged in its scratchpad), write a one-click restart script. Nothing stopped: DSH 3080 pid 17880 old, fcc 8082 pid 13908 old deps. Brain 9f297bc ahead 5. Waits on the vMixer user's approval there; ndi2 must not relay or retry these actions.
- vMixer DONE after user approval there (reported by Claude Opus 5 local_f4e7f2e9): old tree killed, `uv sync --frozen` with scratchpad uv 0.12.16 exit 0 (fcc 6.2.39), DSH relaunched pid 12732 :3080 200, fcc pid 19004 :8082 /health 200, llama :8090 pid 23412, `.built-commit` 83dcec25f1. System ~/.local/bin/uv.exe still 0.12.11 (replacement not approved). Brain ahead 6, unpushed.
- UPDATE COMPLETE on both machines. Remaining: relay (other handoff); gatekeeper push of vMixer brain ahead 6 + ndi2 plugins 4d52673 on the session-end cue; vMixer system uv upgrade if the user approves.
- Relay not on origin (no relay/openrouter-relay.json, no relay/tokens/vmixer2o2.enc); vMixer keeps OPENROUTER_API_KEY until then. Out of scope here (handoff-2026-09-18-dsh-openrouter-fix).
- Next: confirm ndi2 3080 returns 200; read vMixer reply; gatekeeper push of vMixer brain ahead-4 + plugins 4d52673 only on the user's session-ending cue.

## Do not repeat / cautions
- Never print credential values. The classifier blocks credential materialisation.
- Do not push from a worker agent. Do not copy the OpenRouter key to vMixer by hand.
