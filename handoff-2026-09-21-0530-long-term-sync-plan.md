---
name: handoff-2026-09-21-0530-long-term-sync-plan
description: "Long-term plan for (1) vMixer full sync with ndi2, (2) ndi2 DSH council calling vMixer's local LLM without direct key passing, (3) a repeatable no-manual-fix clone process. Plan presented, user said \"go phase 1\"; phase 1 diagnosis done. Blocker: no vMixer Claude Code session exists/is reachable yet even with this session's Remote Control on. User is switching accounts/users so this session can see vMixer via Remote Control once on the same user — handoff written for that handoff-across-user-switch."
metadata: 
  node_type: memory
  type: project
  originSessionId: 25241252-50fa-4e32-8c82-022e4dea9d6b
  modified: 2026-09-22T09:00:45.018Z
---

- Handoff id: handoff-2026-09-21-0530-long-term-sync-plan (stable; update this note, do not duplicate).
- Updated 2026-09-21 (FINISH-NOW, 150k context). Host ndi2 (vmixlaptop2x6). Model Claude Sonnet 5. cwd `~\Documents\claudecode\deepseek-harness` (brain work in `~/.claude/shared-brain`). No collaborating agents in-process; a PEER session "DSH run failures audit" [b54759] is idle in the same harness working tree — it owns the one uncommitted file below, do not touch it. Remote Control off.

## Exact ask
"lets map out our long term plan for step one getting vmixer and this machine completely synced even if that means manually adding the keys via hard drive then after vmixer is completely synced i want to make sure that this machine can call local llm on vmixer via council in dsh and last i want a way to easily add more machines as clones without having all the issues we have had currently and i don't want to pass keys directly if possible"

Three ordered goals: (1) vMixer <-> ndi2 full sync, hard-drive key transfer acceptable as a one-time bootstrap; (2) ndi2's DSH council able to call vMixer's local LLM; (3) a repeatable clone process for future machines that avoids the friction seen so far, with keys never passed directly if it can be avoided.

## What is done this session
Read-only research across the shared brain to ground the plan in actual current state (nothing edited):
- `handoff-2026-09-18-1039-app-parity-ndi2-vmixer.md` — CLI/Antigravity/Codex version parity via `fleet.mjs apps`. Last state (2026-09-18 15:55): vMixer aligned, ahead-of-master on Claude Code (2.1.267) and Antigravity (2.13.0), codex same, files/settings same, brain pushed. Open: ndi2 itself is the OLDER copy (2.1.263 / 2.12.2) and never re-recorded itself as master after vMixer's update. No entry since 09-18 confirms ndi2 updated or re-recorded.
- `handoff-2026-09-18-0121-local-llm-routing-targets.md` — the local-LLM router/relay design and build. Built and (per last entries, 09-18 13:11) COMMITTED into harness `f97db95866` on the writer-route branch: `router/local-targets.ts` resolver, `llm-targets.yaml`-equivalent per-host files (`relay/llm-targets/<host>.json`), `.sync/llama-relay.mjs` (token-gated proxy, vMixer serves 0.0.0.0:8091 -> loopback 8090, per-client sealed Bearer tokens, revoke = delete row, never forwards the caller's own Authorization header), firewall one-click, `routeLocalSeat` wired into resolveSeats for council/swarm/pipeline/propose. NOT done as of that note: vMixer actually running `Llama Relay Setup.cmd`, ndi2 running `connect` + a live probe against `http://<vmixer-lan>:8091/v1/models`, and relay autostart on vMixer logon (dies on reboot today).
- `handoff-multi-machine-sync.md` (closed 2026-09-16) — the fleet foundation this all sits on: `fleet.mjs`/`brain-sync.mjs`/`selftest.mjs` shipped live, AES-sealed secrets (`fleet/secrets/*.enc`) synced through the brain (not chat), repos followed/auto-built, TeamViewer one-click for remote CLI logins added to the public plugin bundle. This is the existing "add a machine" backbone — it does NOT yet cover CLI account logins (Claude/Codex/Antigravity sign-in is still manual per machine, done remotely via TeamViewer) or app-version parity (that came later, see above) or local-LLM targets (also later).
- `handoff-2026-09-21-0218-dsh-run-failures-audit.md` — unrelated to this plan (CheaperInference seat + DSH swarm bug fixes); skimmed only far enough to confirm it does not touch sync/relay/clone. Not fully read (783 lines); irrelevant to this handoff.
- `feedback_ndi2_is_code_master.md` — standing rule: vMixer is a clone of ndi2, never an independent peer; ndi2's updates are never refused/reverted on vMixer; no vMixer-only divergence. This governs how the sync plan should be framed (ndi2 -> vMixer direction, not merge).
- `no-live-git-pushes.md`, CLAUDE.md gatekeeper rules — every step in the plan that touches git must route through the gatekeeper queue (`git-gatekeeper` agent locally, or the PowerShell gatekeeper / `queue-build.mjs` route), never a direct push, and only on the user's session-end cue.

## Not done
No plan has been presented to the user yet — this handoff was written mid-research per the standing 100k-context checkpoint rule. No files edited, no commands run beyond Read/Glob against the brain, no processes started, nothing committed.

## Exact next action
Synthesize the above into a 3-phase plan and present it in this same session:
1. **Phase 1 (finish the sync already in flight, don't restart it):** re-run/verify `fleet.mjs apps --master` on ndi2 (it's stale/behind vMixer), confirm vMixer's `apps` status part still matches, decide the hard-drive key path only for whatever secrets the AES-sealed brain channel can't carry (it already carries 5 secrets sealed — hard drive should be last resort / one-time bootstrap only, per the user's own "even if that means" phrasing, not the default channel).
2. **Phase 2 (local LLM via council):** finish the already-built llama relay — vMixer runs `Llama Relay Setup.cmd`, ndi2 runs `connect`, live probe `GET http://<vmixer-lan>:8091/v1/models` (200 with token, 401 without), add relay autostart on vMixer logon, then verify a real DSH council round actually picks the `llama-local`/vMixer seat via `routeLocalSeat`. This already satisfies "don't pass keys directly" — the relay never exposes the upstream, only per-client sealed Bearer tokens that can be revoked without touching llama-server itself.
3. **Phase 3 (repeatable clone-without-key-passing):** generalize the fleet/relay/secrets pattern that already exists (AES-sealed secrets over the brain, TeamViewer one-click for the one unavoidable manual step — CLI account login, per-client relay tokens for local LLM, `fleet.mjs apps` for version parity, `no-downgrade` rule already fixed) into a single documented/one-click "new machine" bootstrap, and name exactly which of the past failures (self-modification classifier blocks denying `fleet.mjs apps`/brain pull on vMixer, stale gatekeeper, CRLF one-click files, version downgrade bug — all in the 09-18 handoffs above) still need a standing fix so they don't recur on the next clone.

## Do not repeat
- Do not re-design the relay or fleet system from scratch — both exist and are committed/built; the gap is finishing rollout (vMixer-side execution + ndi2 catch-up), not design.
- Do not treat vMixer as a peer to negotiate with — per `feedback_ndi2_is_code_master.md`, sync flows ndi2 -> vMixer.
- Do not propose passing raw API keys/tokens through chat; the existing pattern (AES-sealed secrets over brain + per-client relay Bearer tokens) already avoids that and should be extended, not replaced.

## Session 2 (Claude Sonnet 5, ndi2, 2026-09-21) — user said "go phase 1"; diagnosis done, FINISH-NOW at 150k

User approved starting phase 1. This session ran read-only diagnostics only (no writes to app config, no git push, no secrets touched) to find the REAL current gap rather than trust the stale 09-18 notes.

### Verified live (quoted)

- Brain repo (`~/.claude/shared-brain`): `git status --porcelain` empty, `git rev-list --left-right --count HEAD...origin/main` = `0 0`. **Fully synced with origin, nothing to push.**
- `fleet/apps.json` (the recorded master target): `master: vmixlaptop2x6`, `claudeCode 2.1.263`, `antigravity 2.15.0`, `recorded: 2026-09-20T12:20:22.139Z`. So ndi2 WAS already re-recorded as master more recently than the 09-18 handoff knew (antigravity now shows current, not the stale 2.12.2) — that part of the old "open question" is stale, not still open.
- `node fleet.mjs apps --dry-run` on ndi2: reports `role: master`, live versions match the recorded target exactly (claudeCode 2.1.263, codex 0.153.4, antigravity 2.15.0). No local drift on ndi2 itself.
- `fleet/status/vmixer2o2.json`: last write `2026-09-18T21:10:44 -0700` (git log), JSON `seen: 2026-09-19T04:10:43Z`. **vMixer has not cycled/reported in about 2 days.** Its last known state: `claudeCode` ahead-of-master 2.1.267 (fine, no-downgrade rule holds), `antigravity` stuck `deferred-running` 2.13.0→2.15.0 (needs Antigravity.exe closed on vMixer to apply), secrets `fcc-.env` and `billboard-platform-.env.local` both `differs`, harness repo on vMixer at old head `512bbabaaa` (from before this week's DSH work).
- `deepseek-harness` on ndi2: branch `feat/heterogeneous-teammates`, HEAD `b43949011c9096626d87b69c63b1b8afa40120be`, `ahead 4` of `origin/feat/heterogeneous-teammates` (unpushed local commits — normal, gatekeeper-only push, holds until session end per standing rule), one modified file `packages/council/tool-council/src/index.ts` uncommitted — **this belongs to the peer session** (its DSH-fix-#2 work, per MEMORY.md "fix #2 CODE WRITTEN ... UNTESTED"), not touched.
- `ListAgents`: only one peer visible, the "DSH run failures audit" session on this same host. **No vMixer session is reachable from here** (Remote Control is off).

### The real phase-1 blocker (not what the plan assumed)

Everything on the ndi2 side is already clean and current. The gap is entirely on vMixer: it hasn't checked in for ~2 days, so its `apps`/secrets/repo drift cannot be confirmed or fixed from ndi2 alone — there is no live channel to it right now (Remote Control off, no reachable session, brain sync is pull-based so vMixer has to initiate). This is not fixable by running more commands on ndi2; it needs either (a) Remote Control turned on with a live vMixer session reachable via ListAgents, or (b) the user at the vMixer machine itself running its update cycle (its existing `UPDATE-DSH.cmd` / brain listener), or (c) Antigravity closed on vMixer so its deferred 2.13.0→2.15.0 update can apply.

### Not done

- Nothing pushed (harness stays 4 ahead, local only). Nothing committed by this session in the harness (the one uncommitted file is the peer's). No secrets reconciled — direction and authority not yet decided (ndi2's copies should flow to vMixer per the code-master rule, but which of the two "differs" secrets is actually newer was not checked, since that requires reading vMixer's live files, not ndi2's).
- Antigravity update on vMixer not applied (can't be, remotely, without a session there).
- vMixer has not been asked to check in yet this session — Remote Control is off and no channel exists; this needs the user's decision (turn Remote Control on, or act on vMixer directly) before it can move further.

### Exact next action

1. Ask the user: turn on Remote Control so a live vMixer session becomes reachable via ListAgents (fastest path to actually finish phase 1 from here), or confirm they'll run vMixer's existing `UPDATE-DSH.cmd` there themselves.
2. Once vMixer reports fresh (`fleet/status/vmixer2o2.json` `seen` within minutes, not days): diff the two `differs` secrets by content/mtime (not just the boolean flag) before deciding which direction to sync; confirm harness pulls vMixer up past `512bbabaaa` (after the gatekeeper pushes ndi2's 4 ahead commits at session end); confirm Antigravity closed/reopened on vMixer so `deferred-running` resolves to `same`.
3. Then move to phase 2 (turn on the already-built llama relay) per the original plan above.

### Do not repeat

- Do not re-run `fleet.mjs apps --master` on ndi2 — it is already correctly recorded as of 2026-09-20T12:20:22Z; re-running now would just re-timestamp an already-correct record.
- Do not touch `packages/council/tool-council/src/index.ts` in the harness working tree — owned by the peer "DSH run failures audit" session.
- Do not assume the 09-18 handoffs' "ndi2 is the stale master" framing is still true — it was corrected by a `--master` re-record since then; verify live before repeating that claim.

## Session 3 (Claude Sonnet 5, ndi2) — Remote Control turned on, still no vMixer session; user switching accounts

- This session's id: `local_370445f0-9f9c-49c2-ba41-f0206220d1be` (host ndi2/vmixlaptop2x6). Title "Multi-machine sync and LLM architecture" [db811d].
- User said Remote Control was on (their side); `ListAgents` showed nothing reachable. Ran `mcp__ccd_session_mgmt__list_sessions`: only one local session on ndi2 itself ("DSH run failures audit", `remoteControlActive: false`, not running) — **no vMixer session exists in the account's session list at all**, not just unreachable.
- Turned this session's own Remote Control on via `mcp__ccd_session_mgmt__set_remote_control(session_id: "self", enabled: true)` → confirmed `remoteControlState: "on"`. Re-checked `ListAgents` immediately after: still no reachable agents. So the blocker is not this session's Remote Control setting — it is that **no Claude Code session is currently open/running on the vMixer machine at all**.
- User's plan: they are switching users/accounts, after which — on the same account/user as vMixer's session — this session should be able to see vMixer via Remote Control/ListAgents. This note exists so that handoff survives that switch (and any session restart it causes).

### Exact next action for the receiving session (after the user switch)

1. Confirm you are Claude Sonnet 5 (or whichever model) on host ndi2, this same handoff id.
2. Run `ListAgents` and/or `mcp__ccd_session_mgmt__list_sessions` — look for a session whose host/title indicates vMixer (vmixer2o2). If Remote Control shows `remoteControlActive: true` on this session already, good; if not, `mcp__ccd_session_mgmt__set_remote_control(session_id: "self", enabled: true)` again (state may not persist across a session restart).
3. Once a vMixer session is reachable, message it (or read its state) to get it to run its brain-sync cycle / `UPDATE-DSH.cmd`, then re-check `fleet/status/vmixer2o2.json` in the brain for a fresh `seen` timestamp before doing anything else — the whole point is to stop reasoning from the ~2026-09-19T04:10 stale snapshot recorded in Session 2 above.
4. From there, resume the Session 2 "Exact next action" list (diff the two `differs` secrets before syncing direction, confirm harness catch-up, confirm Antigravity update applies), then move to phase 2 (turn on the already-built llama relay).

### Not done

- vMixer still not reached. No secrets, repo, or app-parity changes made this session. Nothing committed or pushed.

## Session 4 (Claude Opus 5, ndi2, 2026-09-21 ~16:40 local) — Remote Control on, a peer session IS now visible

- Session id `local_19a91cd1-16c5-4862-9011-85e1eac61d34`, title "Resume handoff and enable remote control" [dab213]. Host ndi2 (vmixlaptop2x6), cwd `~/Documents/claudecode`. Model Claude Opus 5. No collaborating in-process agents.
- User ask this session: "check the last saved handoff file created on this machine resume it turn on remote control to find the other agent". Newest handoff by mtime = this file (2026-09-21 09:33), so this is the one resumed.
- `mcp__ccd_session_mgmt__set_remote_control(self, true)` returned `{"remoteControlState":"on"}`.
- `ListAgents` now shows **one peer: "Remote control [c40e84]" · Remote Control · idle**. This is new versus Session 3, which saw no reachable peer at all — the user's account switch worked.
- `mcp__ccd_session_mgmt__list_sessions` (local-only view) lists just one local session ("Usage panel", `local_710858cd-...`, not running, remote control off). The peer therefore is NOT a local ndi2 session — it is reachable only over Remote Control, i.e. almost certainly the vMixer machine. **Not yet confirmed** — identity request sent, no reply at the time of writing.
- Sent to the peer (msg_id `7643d044-ecc7-46dd-8ffe-1539e1e577ec`): asked for `hostname` + cwd, brain repo `git status --porcelain` and `rev-list --left-right --count HEAD...origin/main`, and — if it is vmixer2o2 — to run its normal fleet/brain sync cycle so `fleet/status/vmixer2o2.json` gets a fresh `seen`, reporting the deferred Antigravity 2.13.0 -> 2.15.0 state and the two `differs` secrets (`fcc-.env`, `billboard-platform-.env.local`). Explicitly told it not to push.
- Note the Remote Control send route reports nothing back: "not confirmed read". The peer may hold the message for its own user's approval. Silence is not agreement.

### Exact next action
1. `ReadNotifications` / watch for the peer's reply. If nothing arrives, re-check `ListAgents` for whether it is still idle, and ask the user whether to drive vMixer directly instead.
2. On reply: confirm hostname is vmixer2o2, then re-read `~/.claude/shared-brain/fleet/status/vmixer2o2.json` and check `seen` is minutes-fresh, not the stale `2026-09-19T04:10:43Z`.
3. Then Session 2's list: diff the two `differs` secrets by content/mtime before choosing sync direction (ndi2 -> vMixer per `feedback_ndi2_is_code_master.md`), confirm harness on vMixer moves past `512bbabaaa` (needs ndi2's 4 unpushed commits through the gatekeeper at session end), confirm Antigravity closed/reopened there so `deferred-running` resolves.
4. Then phase 2 (llama relay rollout).

### Not done / unchanged this session
Nothing committed, nothing pushed, no secrets touched, no fleet command run that writes. harness still 4 ahead of `origin/feat/heterogeneous-teammates` with `packages/council/tool-council/src/index.ts` modified — still owned by the peer "DSH run failures audit" session, untouched.

### Session 4 continued (Claude Opus 5, ndi2) — PHASE 1 BLOCKER CLEARED by vmixer2o2

Peer confirmed: "Remote control [c40e84]" IS vmixer2o2 (Claude Opus 5 there, cwd ~/Documents/claudecode). User answered the three open items with "go on all 3"; secret direction answered separately via AskUserQuestion: fcc-.env = brain -> vMixer (take-secret), billboard-platform-.env.local = vMixer -> brain (reseal). vmixer2o2 executed on its own side (this session's relay SendMessage was denied by the auto-mode classifier — "Stage 2 classifier error"; the work happened anyway through vMixer's own user turn, and the outcomes match the user's answers exactly).

**Independently verified from ndi2 after `git fetch` (not taken on the peer's word):**
- `~/.claude/shared-brain`: `rev-list --left-right --count HEAD...origin/main` = `0 0`, `git status --porcelain` empty. ndi2 and origin level.
- `git show origin/main:fleet/status/vmixer2o2.json`: `seen 2026-09-21T17:26:03.296Z` — minutes-fresh, versus the 2026-09-19T04:10:43Z that blocked sessions 2-3. Listener is cycling on its own.
- Same file's secrets block: all five now `same` — `fcc-.env`, `billboard-platform-.env`, `billboard-platform-.env.local`, `billboard-platform-streaming-server-.env`, `green-energy-platform-.env.local`.
- **ndi2's own SharedBrainListener.ps1 does NOT need the timeout fix.** vMixer found its line 14 ran `--timeout 12000`, too short for a push, so every cycle since 2026-09-18 ended `publish=offline reason=spawnSync git ETIMEDOUT` and it synced but never published — that was the real cause of the 2-day staleness, not a missing check-in. It raised both its copies to 120000. On ndi2, `~/.claude/hooks/SharedBrainListener.ps1:14` and `.sync/SharedBrainListener.ps1:14` ALREADY read `--timeout 120000`, and the listener process is running here (1 match in the powershell command lines). Nothing to change on ndi2 — do not "apply" this fix here.

**Also reported by vmixer2o2 (its side, not verified from here):** Antigravity there is 2.15.1, ahead of the recorded master target 2.15.0, so the old `deferred-running 2.13.0->2.15.0` record was simply stale. `fleet.mjs take-secret` via the CLI is broken — "unsettled top-level await" at `fleet.mjs:793`, caused by the `await import` inside the non-async CLI main; call `takeSecret` from a module instead. FCC on 8082 there still needs a restart to load the restored keys. Its hourly `syncApps` will now merge `~/.codex/config.toml` on that machine.

**Harness state changed under us.** vMixer's gatekeeper found `512bbabaaa` was not an ancestor of origin, rebased, and pushed `e67a9f47b3..737ecb77e3` (`737ecb77e3 fix(council): turn thinking off for local llama seats`). ndi2 is therefore now **diverged: 4 ahead / 1 behind** `origin/feat/heterogeneous-teammates`. Not reconciled this session — no rebase or merge attempted, no push. ndi2's five gatekeeper queue entries are untouched and still open per vMixer.

**ndi2 harness working tree is dirtier than earlier in this session** — `git status --porcelain` now shows 8 entries: `packages/client/ui-claude-quota/src/client/ClaudeQuota.tsx`, `.../locales.ts`, `packages/council/tool-council/src/index.ts` (the untested DSH fix #2), `packages/quota/quota-claude/README.md`, `src/index.ts`, `src/reading.ts`, `tests/reading.spec.ts`, plus untracked `packages/council/tool-council/src/cheaperinference-budget.ts`. Earlier this session only `index.ts` was modified. Another session is writing in this same tree — do not commit or revert any of it without identifying the owner first.

### Exact next action (phase 1 is now done; this is phase 2 and cleanup)
1. Reconcile ndi2's harness divergence (4 ahead / 1 behind) against `737ecb77e3` — needs the working tree's owner identified first, since 8 files are dirty.
2. Phase 2: roll out the already-built llama relay (vMixer runs `Llama Relay Setup.cmd`, ndi2 runs `connect`, live probe `GET http://<vmixer-lan>:8091/v1/models` expecting 200 with token / 401 without, add relay autostart on vMixer logon, then confirm a real DSH council round picks the vMixer seat via `routeLocalSeat`).
3. Optional: fix `fleet.mjs:793` take-secret CLI breakage (top-level `await import` in a non-async main).
4. ndi2's five gatekeeper queue entries still need the user's session-end cue.

### Session 4, third block (Claude Opus 5, ndi2) — PHASE 2 relay proven live from ndi2; FINISH-NOW at 153k

**Phase 2, ndi2 half: DONE and verified, not assumed.**
- `node ~/.claude/shared-brain/.sync/llama-relay.mjs connect` on vmixlaptop2x6 bound server `vmixer2o2`, tokenRef `LLAMA_RELAY_TOKEN_VMIXER2O2`, credentials `~\.dsh\.credentials.yaml` (token present, 43 chars).
- Live probe of vMixer's relay: `GET http://10.0.0.244:8091/v1/models` returned **http=200 in 0.016s** with the Bearer token (body shows DeepSeek-Coder-V2-Lite loaded, llama-server on 127.0.0.1:57072) and **http=401 without it**. Token gating works in both directions.
- `relay/llm-targets/vmixer2o2.json` in the brain is fresh (`updated 2026-09-21T17:17:29.556Z`), 7 models published, lan route `http://10.0.0.244:8091`.
- **Seat routing proven end to end.** Ran `routeLocalSeat` directly from `packages/council/tool-council/src/llm-targets.ts` with `{ probe: true }` against a `local: true` seat for `Qwen3.6-35B-A3B-UD-Q4_K_M` (script in this session's scratchpad, not in the repo). Result: `{"targetHost":"vmixer2o2","viaRelay":true,"baseUrl":"http://10.0.0.244:8091/v1/chat/completions","model":"Qwen3.6-35B-A3B-UD-Q4_K_M","enabled":true,"hasToken":true}`. So a DSH council/swarm local seat on ndi2 now resolves to vMixer's relay with the token attached. Node 24 runs the `.ts` source directly — no tsx shim needed for this probe.
- NOT yet done for phase 2: a real DSH council round actually consuming that seat (costs a run, not attempted), and relay autostart on vMixer logon.

**vMixer's reply to the follow-up (msg 8d4c040e):** it declined all three items and was right to — it had hit its own FINISH-NOW and a peer message is not user authorization. Important detail it supplied: **a second Claude Opus 5 session is live on vmixer2o2**, `local_4806d660-b8f3-472a-963f-29a4ffaa5364`, finishing `handoff-2026-09-18-0121-local-llm-routing-targets`, and IT owns the relay — route the autostart request there, not to the fleet session, to avoid two sessions wiring the same autostart. The pattern to copy is the Startup entry `Shared-Agent-Listeners.cmd` (which already launches the brain listener and the gatekeeper); the relay line belongs in it. vMixer confirmed relay processes live: `0.0.0.0:8091` pid 36020, `127.0.0.1:8090` pid 20912. FCC 8082 restart is still sitting unanswered with the user. All three are recorded in its own note under "Inbound from ndi2 2026-09-21 ~17:40" in `handoff-2026-09-21-1640-vmixer2o2-fleet-checkin.md`, on origin.

**Harness divergence — analysed, deliberately NOT executed.**
- ndi2 is 4 ahead / 1 behind `origin/feat/heterogeneous-teammates` (origin head `737ecb77e3 fix(council): turn thinking off for local llama seats`, pushed by vMixer's gatekeeper after rebasing its own 512bbabaaa).
- **Do not rebase.** `push-requests.md` holds ndi2's five open entries for this repo (lines 520/537/553/564/579/631), and the gatekeeper verifies queued commits by `merge-base --is-ancestor`. A rebase rewrites those hashes and invalidates every one of them. A **merge** keeps them reachable and is the right reconciliation.
- The merge is safe on paper: `737ecb77e3` touches only `packages/council/tool-council/src/seats.ts` and `tests/reachability.spec.ts`, and **neither is dirty**, so no uncommitted work would be overwritten.
- The working tree now carries 13 entries (grew again during this session): modified `ui-claude-quota/src/client/{ClaudeQuota.tsx,locales.ts}`, `ui-council-budget/src/client/{CouncilBudget.module.css,CouncilBudget.tsx,locales.ts}`, `tool-council/src/index.ts` (the untested DSH fix #2), `quota-claude/{README.md,src/index.ts,src/reading.ts,tests/reading.spec.ts}`; untracked `ui-council-budget/tests/cheaper-budget.client.spec.tsx`, `tool-council/src/cheaperinference-budget.ts`, `tool-council/tests/cheaperinference-budget.spec.ts`. File mtimes cluster at 09:52-10:29 today, i.e. before this session started at ~16:35 — leftovers from earlier sessions, not a live writer. Nothing was committed, reverted or stashed.

### Exact next action
1. `git merge origin/feat/heterogeneous-teammates` in `~/Documents/claudecode/deepseek-harness` (merge, never rebase — see above). Expect no conflict with the dirty tree; verify with `git merge --no-commit --no-ff` first if cautious.
2. Finish DSH fix #2: vitest + `tsc --noEmit`, then the DEFAULT-profile regression test (the `economy`-profile test in `swarm-composition.spec.ts` does NOT cover the bug), then #10 / #5 / #4.
3. Relay autostart on vMixer: address session `local_4806d660-b8f3-472a-963f-29a4ffaa5364` on vmixer2o2, and add the relay line to `Shared-Agent-Listeners.cmd` there — needs the user's go, it was refused as peer-only authorization.
4. FCC 8082 restart on vMixer — still the user's unanswered call.
5. A real DSH council round that consumes the vMixer seat, to close phase 2 for real.
6. ndi2's five gatekeeper queue entries still await the user's session-end cue.

### Do not repeat
- Do not rebase this harness branch while those five queue entries are open.
- Do not ask vmixer2o2's fleet session for relay work — the relay belongs to the other session on that host.
- Do not treat the peer's reports as verified; everything above marked verified was re-checked from ndi2 after `git fetch`.

### Session 4, fourth block — relay owner's checklist completed; inference proven, not just connectivity

The relay-owning session on vmixer2o2 ("Local LLM routing targets", session 61986425) asked ndi2 to finish `handoff-2026-09-18-0121-local-llm-routing-targets`. All four of its steps are now green from ndi2:
- Step 1: both `relay/llm-targets/vmixer2o2.json` and the sealed `relay/llama-tokens/vmixer2o2/vmixlaptop2x6.enc` are present; brain 0/0 with origin.
- Step 2: `connect` already done earlier this session. The plaintext token has not been printed, logged or written anywhere — only its presence and length were checked.
- Step 3, the new part: **POST `http://10.0.0.244:8091/v1/chat/completions`** with the Bearer token, model `DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M`, `max_tokens 16` -> **http=200 in 1.46s**, `usage {"completion_tokens":16,"prompt_tokens":15,"total_tokens":31,"cached_tokens":9}`. Real inference across the LAN, not just a models listing. The model answered with prose instead of the one word asked for — model size, not transport. No timeouts anywhere, so the firewall rule and the subnet are both fine.
- Step 4: resolver already confirmed (previous block).
Reported back as msg `7f6bf164`. Note the peer is addressed as `Local LLM routing targets [556f9d]`, not by its session number — a send to the plain handoff name fails.

**A third peer appeared in `ListAgents` this session:** "Quota work account handoff [710612]", a busy Claude Desktop session started ~11 min ago. It is a plausible owner of the quota-claude / ui-claude-quota files dirty in the harness tree — identify it before anyone commits or reverts that work.

Phase 2 is now done apart from relay logon autostart on vMixer (owned by the relay session there, needs that machine's user) and a real DSH council round consuming the seat.

### Session 4, fifth block (Claude Opus 5, ndi2, session local_19a91cd1) — real DSH council round attempted; blocked by DSH #10 and #5, reproduced live. FINISH-NOW at 199k.

User's ask this stretch, verbatim: "do the part they said only you can do" — clarified by them to mean the real DSH council round on ndi2 consuming the vMixer llama seat (the one thing vMixer cannot prove from its side). Then "what is next", then "do this in a handoff to save tokens", which is what this block is.

**Config change made (the only write to config this session):** `~/.dsh/settings.yaml` line 371, council seat `llama-local` `enabled: false` -> `enabled: true`. Backup kept at `~/.dsh/settings.yaml.bak-20260921-104819`. The SECOND `llama-local` block at line 1705 (`kinds: []`, the swarm roster) was deliberately left at `enabled: false`. The live DSH host on 3080 picked the change up with no restart. The seat is still enabled — revert from the backup if that is not wanted.

**Proven:** the seat is genuinely in the live DSH roster. The council plan card prices it as `Local llama (vMixer): subscription, not metered`, beside Free Claude, Claude (work account), Kimi ~$0.0241, DeepSeek v4 ~$0.0278, OpenRouter Free; `Estimated metered total: ~$0.05 (basis: pricing)`.

**Blocked, and the block is our own catalogued bugs, now reproduced live in the UI:**
- Session A: after approval, the run failed with `Error: invalid arguments: missing required property "query"` — **failure mode #10 verbatim**. It then refused to resume: `Run 0d734919-a944-429b-92ae-8418576bcf66 cannot be amended: every seat in it answered — there is nothing to fill.` — **failure mode #5**, the stale plan pinning the gate.
- Session B (fresh session, to dodge #5): reached the approval gate, Approve pressed, then its own Send-go-to-run-it button used. It looped back to the same gate — `Stopped before drafting — nothing has been spent.` Pipeline idle after 5 turns.
- **No new run file was ever written.** Newest `~/.dsh/council-runs/*.json` is still the old CheaperInference run `0d734919`, `seatIds ['free-claude','kimi','deepseek','openrouter-free']`, `terminalState completed` — no llama seat in it, and its `query` is the old CheaperInference one. Do not mistake that file for our round.
- **Metered spend: $0.00.** Nothing drafted. Council budget still $0.024.

So phase 2 now stands at: transport proven (200 with token / 401 without / POST inference 200 in 1.46s), resolver proven (`routeLocalSeat` resolves to `http://10.0.0.244:8091/v1/chat/completions` with the token attached), seat proven present and priced in the live roster — and the drafting round itself cannot run until DSH #10 and #5 are fixed.

### Exact next action (the full ordered list, agreed with the user)
1. **DSH #10** — remove `required: true` from the `query` parameter on both the `council` tool (`packages/council/tool-council/src/index.ts:1129`) and the `swarm` tool (`:1546`). The fallback already exists (`settingsNow.pendingPlanQuery ?? args.query` at `:1285`, `pendingSwarmQuery` at `:1619-1621`) and `pipeline`'s `query` is already optional at `:1772` — the schema layer (`packages/core/tools/src/schema.ts:460-470`) rejects the call before that code runs. Add a test for a continuation call with empty/omitted query against stored state.
2. **DSH #5** — in `heldUnapproved`, council block `:1262-1295` and swarm block `:1580-1606`, compare `args.query` with `settingsNow.pendingPlanQuery`; a mismatch means treat it as a new question instead of re-serving the stale hold (today it waits out the 15-minute TTL at `src/approval.ts:36`). Mirror the fix in both blocks, test both.
3. **Finish #2** — the 2-line staging fix is already written and uncommitted at `index.ts:1626` and `:1953`. Run `pnpm vitest run packages/council/tool-council packages/client/ui-council-budget` from the repo root plus `tsc --noEmit`, quoting real counts and exit codes, then add the DEFAULT-profile regression test (no `swarmProfile` configured — the existing economy-profile test in `swarm-composition.spec.ts` does NOT cover the bug). Optional bundle-in: #4's message split at `:1844-1867`. `AGENTS.md` wants an Agent Note for #2 and #5.
4. **Re-run the council round** once 1-3 are in — same prompt shape, expect the `llama-local` seat to draft, ~$0.05 metered. That closes phase 2.
5. **Merge, never rebase** — `git merge origin/feat/heterogeneous-teammates` (`737ecb77e3`) in `~/Documents/claudecode/deepseek-harness`. It touches only `seats.ts` and `tests/reachability.spec.ts`, neither dirty, so no conflict with the working tree. A rebase would rewrite the commits that `push-requests.md` pins for ndi2's five open queue entries and invalidate all of them.
6. **Relay logon autostart on vmixer2o2** — owned by session `local_4806d660-b8f3-472a-963f-29a4ffaa5364` there, not the fleet session; pattern to copy is the Startup entry `Shared-Agent-Listeners.cmd`. Needs that machine's user, not ndi2's.
7. **FCC 8082 restart on vmixer2o2** — still the user's unanswered call from that machine's own report.
8. **Session-end cue** then `git-gatekeeper` pushes ndi2's five open harness queue entries.

### Open question for the user
The harness tree holds 13 uncommitted entries (`quota-claude`, `ui-claude-quota`, `ui-council-budget`, untracked `cheaperinference-budget.ts` plus its specs and `cheaper-budget.client.spec.tsx`), mtimes 09:52-10:29 today. A live Claude Desktop session, "Quota work account handoff [710612]", is the likely owner. Identify it before anyone commits or reverts that work.

### Do not repeat
- Do not read `council-runs/0d734919-*.json` as evidence about the llama seat — it is the old CheaperInference run.
- Do not rebase the harness branch while the five queue entries are open.
- Do not re-prove the relay: 200/401/POST-200 and the resolver result are recorded above and in the earlier blocks.
- Do not press Approve and then type "go" into the composer by hand — use the UI's own Send-go-to-run-it button; a typed "go" went in as an ordinary message the first time.
- Do not enable the second `llama-local` block at settings.yaml:1705 (swarm roster) unless swarm work is actually wanted there.

### Session 6 (Claude Opus 5, ndi2, session local_94ec39e1) — DSH #10 and #5 FIXED and tested; Remote Control on

Ask: "remote control on and resume this ~/.claude/shared-brain/handoff-2026-09-21-0530-long-term-sync-plan.md". Remote Control was turned on first (`set_remote_control self` -> `"remoteControlState":"on"`, session `local_94ec39e1-9ae6-4542-a40a-cb2d5ab52351`). Picked up at the previous block's ordered next-action list, items 1-2.

**Done, in `packages/council/tool-council/src/index.ts` (UNCOMMITTED):**
- **#10** — `required: true` dropped from `query` on both the `council` (now ~:1145) and `swarm` (now ~:1610) parameter schemas, descriptions updated to "Omit to continue a run already held at the approval gate". Every `args.query` use in both handlers now tolerates `undefined`: the amend-miss return, the held-plan/held-graph returns, `councilQuestion`, the `runSwarm` query, and `pendingPlanQuery` on issue (now stores `councilQuestion`, not the raw arg).
- **#5** — new module-scope helpers `normaliseQuestion` / `sameQuestion` (trim, lowercase, collapse whitespace) just above the council registration. `heldUnapproved` in BOTH blocks now also requires that the call carries no query, or one that normalises to the held question. A genuinely different question falls through to a fresh plan instead of being met with the stale hold.
- **New guard, both tools** — no query supplied AND nothing stored returns "Council — nothing to ask" / "Swarm - nothing to split" before a single seat is called.
- **New test file** `packages/council/tool-council/tests/gate-continuation.spec.ts`, 6 cases through the real Loader + tool registry (no paid calls): empty-query continuation for council and swarm, same-question-different-spacing re-serve, new-question-does-not-get-the-stale-hold for council and swarm, and the nothing-to-ask/nothing-to-split guard asserting `askSeat` was never called.

**Verified (real output, not assumed):**
- `node_modules/.bin/tsc --noEmit` -> exit 0 (tsc 6.0.3).
- `node_modules/.bin/vitest run packages/council/tool-council` -> **39 files, 643 tests passed**, exit 0 (this was before the new spec was added).
- `node_modules/.bin/vitest run packages/council/tool-council/tests/gate-continuation.spec.ts` -> **6 passed**, exit 0. Its console output shows the #5 fix working: the new question "Which cache?" now runs its own planning round instead of returning the plan held for "Which database?".

**Unchanged from the previous block:** the #2 staging fix is still in the tree at the two `proposalWorkspace` call sites (`profile === undefined ||` dropped) and still has no DEFAULT-profile regression test. The other 13 dirty entries (quota-claude, ui-claude-quota, ui-council-budget, cheaperinference-budget) were not touched and their owner is still unidentified. Nothing committed, nothing pushed, no Agent Note written yet.

### Exact next action
1. Add the DEFAULT-profile regression test for #2 (no `swarmProfile` configured, unit with `task.files`, `fileRoots` set -> staging happens; the existing economy-profile case in `swarm-composition.spec.ts` does not cover it), then re-run the full council suite + `tsc --noEmit`.
2. Write the Agent Note `AGENTS.md` requires for #2 and #5 (one combined note for this pass is acceptable, per sessions 9/11).
3. Re-run the real DSH council round with the `llama-local` seat — that closes phase 2. The live host on 3080 must be rebuilt/restarted onto this fixed code first, or it will reproduce #10 again.
4. `git merge origin/feat/heterogeneous-teammates` (`737ecb77e3`) — **merge, never rebase**, five queue entries pin the current commits.
5. Relay logon autostart on vmixer2o2 (session `local_4806d660...` owns it) and the FCC 8082 restart there — both need that machine's user.
6. Session-end cue, then `git-gatekeeper` pushes ndi2's five open harness queue entries.

### Do not repeat
- Do not re-apply #10 or #5; both are in the working tree and tested.
- Bash heredocs in this environment collapse `\` to `\`, so a JS regex or `'...
...'` written through one arrives broken. Write TypeScript with the Write tool, or build backslashes with `chr(92)` in Python.

### Session 6, second block (Claude Opus 5, ndi2) — #2 regression test written but RED for a harness reason; FINISH-NOW at 152k

New file `packages/council/tool-council/tests/swarm-default-profile.spec.ts` — one case: no `swarmProfile` configured, `autoApprove: true`, `fileRoots` set to the temp root, a decomposed unit carrying `files: ['answer.ts']`, asserting the report does NOT contain "Candidate files require" and that a staged `answer.ts` exists.

**It fails, and not on the assertion the fix is about.** Real output:
`{"isError":true,"error":{"message":"Approve workspace-write in this session and send exactly go before running a proposing round."}}` — so `expect(text).not.toContain('Candidate files require')` PASSED and `expect(text).toContain('ACCEPT: yes')` failed. `app.sandboxPolicy.approveWorkspaceWrites(session)` alone is not enough: the two-factor gate also wants a user turn of exactly `go`. `swarm-composition.spec.ts` does this with its `enter('go')` helper (the `agent/pre-step` waterfall with a `createUserMessage`), which this new spec does not have. **Fix the test, not the product**: copy that spec's `enter` helper and call `await enter('go')` after `approveWorkspaceWrites`, then re-run.

State of the tree at this checkpoint: `tsc --noEmit` exit 0 and the council suite 643/643 were measured BEFORE this red spec was added; `gate-continuation.spec.ts` is 6/6 green. Nothing committed, nothing pushed, no Agent Note yet. The red spec is uncommitted like everything else — do not commit it while it is red.

### Exact next action (supersedes the previous block's list at item 1)
1. Add the `enter('go')` helper to `swarm-default-profile.spec.ts`, re-run it, then re-run the whole council suite plus `tsc --noEmit` and quote real counts.
2. Agent Note for #2 and #5 (one combined note is acceptable).
3. Rebuild the live DSH host onto this code, then re-run the `llama-local` council round — that closes phase 2.
4. `git merge origin/feat/heterogeneous-teammates` (`737ecb77e3`) — merge, never rebase.
5. Relay logon autostart + FCC 8082 restart on vmixer2o2 (that machine's user).
6. Session-end cue, then `git-gatekeeper` pushes the five open queue entries.


### Session 7 (Claude Opus 5, ndi2, session local_84c94949-61e8-4756-b03c-a104054de6d4) - Remote Control on; #2 regression spec is now GREEN

Ask: "~/.claude/shared-brain/handoff-2026-09-21-0530-long-term-sync-plan.md turn on remote". Remote Control turned on first: `set_remote_control self` -> `{"sessionId":"local_84c94949-61e8-4756-b03c-a104054de6d4","remoteControlState":"on"}`. Then picked up the previous block's item 1.

**Item 1 is DONE, and the previous block's advice was stale.** `packages/council/tool-council/tests/swarm-default-profile.spec.ts` no longer needs an `enter('go')` helper: as it now stands in the tree it approves nothing at all and asserts the plain path never reaches the gate -
`expect(text).not.toContain('Candidate files require')`, `expect(text).not.toContain('Approve workspace-write')`, `expect(text).toContain('Swarm - done')`, `expect(text).toContain('export const answer = 4')`.
Real output, `node_modules/.bin/vitest run packages/council/tool-council/tests/swarm-default-profile.spec.ts`:
`Test Files  1 passed (1)` / `Tests  1 passed (1)`, duration 4.27s, and the report body printed `## Swarm - done` with the written `export const answer = 4`. So **do not add `enter('go')` to this spec** - that instruction in the "Session 6, second block" list is superseded.

State of the tree: unchanged from session 6 except this spec now passes. #10, #5 and #2 fixes all still UNCOMMITTED in `packages/council/tool-council/src/index.ts`; `gate-continuation.spec.ts` 6/6 from session 6; the 13 other dirty entries (quota-claude, ui-claude-quota, ui-council-budget, cheaperinference-budget) untouched, owner still unidentified. No Agent Note yet, nothing committed, nothing pushed. Stopped here on 100% session quota (resets 2026-09-21 14:00).

### Exact next action
1. Re-run the whole council suite plus `tsc --noEmit` with all three fixes and both new specs in the tree, and quote the real counts (the 643/643 and tsc 0 figures predate `swarm-default-profile.spec.ts`).
2. Agent Note for #2 and #5 (one combined note is acceptable).
3. Rebuild the live DSH host onto this code, then re-run the `llama-local` council round - that closes phase 2.
4. `git merge origin/feat/heterogeneous-teammates` (`737ecb77e3`) - merge, never rebase.
5. Relay logon autostart + FCC 8082 restart on vmixer2o2 (that machine's user).
6. Session-end cue, then `git-gatekeeper` pushes the five open queue entries.

### Do not repeat
- Do not add an `enter('go')` helper to `swarm-default-profile.spec.ts`; it is green without one.
- Do not re-apply #10, #5 or #2; all three are in the working tree.

### Session 6, third block (Claude Opus 5, ndi2, session local_94ec39e1) — #2 DISPROVED and reverted; Agent Note written; SESSION QUOTA 100%

User raised the ceiling ("you can work to 98% of quota continue and tell all agents here and remote the same"). Relayed to all four peers via SendMessage: "Local LLM routing targets [556f9d]", "Remote control [c40e84]" (both Remote Control, no read receipt on that route), "Resume handoff and enable remote control [dab213]" (this machine, queued). The fourth peer, "Show Claude Code usage panel [6eca6f]", is the usage-panel chip session and was not messaged. The session quota then hit 100% (resets 14:00 local), so this block is the stop.

**FAILURE MODE #2 IS MISDIAGNOSED. The two-line fix was reverted, with proof.**
- `runUnitContest` is the ONLY consumer of `writes`/`workRoot`, and `swarm.ts:543` calls it only when `options.profile !== undefined && options.profile !== 'user'`. In the DEFAULT profile the contest never runs, so "Candidate files require approved workspace staging and source roots" (`swarm-contest.ts:64`) cannot be reached there at all, and the staging the fix passed is consumed by nobody.
- Worse, the fix introduces a regression. `proposalWorkspace` (`index.ts:904`) THROWS `Approve workspace-write in this session and send exactly go before running a proposing round.` when an approved run lacks workspace-write. With the fix in place a plain swarm with `fileRoots` set now calls it and errors where it used to run.
- **Proved by experiment, not by reading.** With the fix re-applied, `swarm-default-profile.spec.ts` fails: `{"isError":true,"error":{"message":"Approve workspace-write in this session and send exactly go before running a proposing round."}}`. With it reverted, the same test passes. Both call sites (`index.ts:1685`, `:2012`) are back to `profile === undefined || parseRoots(live().fileRoots).length === 0 ? {} : proposalWorkspace(approved)`.
- The real trigger for the "Candidate files require" error is a CONTESTED unit (economy/fastest) with empty `fileRoots`, or a workspace that could not be resolved — not the profile. #2 needs re-diagnosing from that starting point, and #9's "very likely same root cause" claim inherits the doubt.

**Files now in the tree from this session (all UNCOMMITTED):**
- `packages/council/tool-council/src/index.ts` — #10 and #5 only; the #2 lines are back to their committed form.
- `packages/council/tool-council/tests/gate-continuation.spec.ts` — new, 6 cases.
- `packages/council/tool-council/tests/swarm-default-profile.spec.ts` — new, 1 case, now pinning the REVERT (no profile + roots + no workspace-write still runs).
- `.agents/notes/implemented/bug-fix/2026-09-21-council-gate-continuation.md` — new Agent Note covering #10, #5 and the rejected #2 change, in the English-only shape of the committed `2026-09-20-pipeline-routing-and-swarm-roots.md`.

**Verification, real numbers:** `tsc --noEmit` exit 0. Full council suite `vitest run packages/council/tool-council` -> **41 files, 650 tests passed**, exit 0 (an earlier run of the same suite failed `seats.spec.ts > keeps the context-file flag when the prompt moves to stdin`; it passes alone and passed on the clean re-run, so it is flaky and unrelated — my changes do not touch `seats.ts`). `verify-agent-note-format` reports 6 violations, all in `implemented/feature/2026-09-05-codex-quota-sidebar.md` and `implemented/feature/2026-09-08-antigravity-seats.md`, both pre-existing and committed; the new note is clean.

**Live state:** DSH host still PID 27800 on 3080, built from the OLD code, so it will still reproduce #10 until it is rebuilt (`~/.dsh/rebuild-dsh.cmd`, then `~/.dsh/launch-dsh.cmd`). `~/.dsh/settings.yaml:371` still has the `llama-local` council seat enabled (backup `settings.yaml.bak-20260921-104819`).

### Exact next action
1. `~/.dsh/rebuild-dsh.cmd` then relaunch, so the live host carries the #10/#5 fixes.
2. Re-run the council round with the `llama-local` seat (~$0.05 metered) — that closes phase 2.
3. `git merge origin/feat/heterogeneous-teammates` (`737ecb77e3`) — merge, never rebase; five queue entries pin the current commits.
4. Re-diagnose #2 from the contested path (`swarm-contest.ts:64` with empty `fileRoots`), not from the profile gate. Do NOT re-apply the reverted two-line change.
5. Relay logon autostart + FCC 8082 restart on vmixer2o2 — that machine's user.
6. Session-end cue, then `git-gatekeeper` pushes ndi2's five open queue entries.

### Do not repeat
- Do not re-apply the #2 `profile === undefined` removal; it is disproved and pinned by a test.
- Do not re-fix #10 or #5; both are in the tree and tested.
- Do not chase `seats.spec.ts > keeps the context-file flag when the prompt moves to stdin` as a regression; it is flaky under parallel load and green alone.

### Session 8 (Claude Sonnet 5, ndi2) — QUOTA STOP on arrival, nothing done

Ask, verbatim: "~/.claude/shared-brain/handoff-2026-09-21-0530-long-term-sync-plan.md turn on remote" (same ask as Session 7). This session's own `UserPromptSubmit` hook fired a 100%-session-quota FINISH-NOW notice before any tool call beyond reading this file. Per the standing checkpoint rule, no new work was started this turn: Remote Control was **not** turned on, `ListAgents` was not called, nothing was messaged to any peer. Session id not captured (no tool call that would have returned it was made). Host ndi2 (vmixlaptop2x6). Model Claude Sonnet 5.

State is exactly as Session 6's third block left it — see that block for full detail: #10 and #5 fixed and tested in `packages/council/tool-council/src/index.ts` (uncommitted), #2's two-line fix reverted and disproved with a pinning test, Agent Note written at `.agents/notes/implemented/bug-fix/2026-09-21-council-gate-continuation.md`, full suite 650/650 + tsc 0 last measured there, live DSH host on 3080 still built from the OLD code (PID 27800, needs `~/.dsh/rebuild-dsh.cmd` + relaunch), harness still 4 ahead / 1 behind `origin/feat/heterogeneous-teammates`, ndi2's five gatekeeper queue entries still open.

### Exact next action (unchanged from Session 6 third block — start here)
1. Turn Remote Control on for the receiving session (`mcp__ccd_session_mgmt__set_remote_control(session_id: "self", enabled: true)`), then `ListAgents` to find the vmixer2o2 / relay-owner peers again — they were live as of Session 6/7 but may have cycled since.
2. `~/.dsh/rebuild-dsh.cmd` then relaunch, so the live host carries the #10/#5 fixes.
3. Re-run the council round with the `llama-local` seat (~$0.05 metered) — that closes phase 2.
4. `git merge origin/feat/heterogeneous-teammates` (`737ecb77e3`) — merge, never rebase; five queue entries pin the current commits.
5. Re-diagnose #2 from the contested path (`swarm-contest.ts:64` with empty `fileRoots`), not from the profile gate. Do NOT re-apply the reverted two-line change.
6. Relay logon autostart + FCC 8082 restart on vmixer2o2 — that machine's user.
7. Session-end cue, then `git-gatekeeper` pushes ndi2's five open queue entries.

### Do not repeat
- Do not re-apply the #2 `profile === undefined` removal; disproved and pinned by a test (Session 6 third block).
- Do not re-fix #10 or #5; both are in the tree and tested.
- Do not assume Remote Control is already on for a fresh session; it was off on arrival this session and was never turned on.

## Session 9 (Claude Sonnet 5, ndi2) — DSH host rebuilt + relaunched; real council round attempted, blocked by OpenRouter balance (not a code bug)

- Host ndi2, cwd `~\Documents\claudecode\deepseek-harness`. Remote Control off (not touched this session). User authorized "hand the ten-bug-fix work to a separate agent, you do the host rebuild + council round" plus "commit as you go, never push" (for the separate agent's track).
- **Rebuild: DONE and verified.** `~/.dsh/.built-commit` was stale (`0e0208e2b9e0...`) vs HEAD `d532def97bdc56923f5e32efec662db98118fdd4`. Ran `node ~/.claude/shared-brain/.sync/fleet.mjs build` (the same routine `launch-dsh.cmd` calls) — `pnpm install` + `pnpm run build`, real exit code 0, marker now matches HEAD.
- **Relaunch: DONE and verified.** Stopped the old host (PID 13880, started 11:41, i.e. built before today's commit). Ran `~/.dsh/launch-dsh.cmd` in the background; `http://127.0.0.1:3080/` returned `200` after ~40s startup (FCC seats + health checks), new PID 22992.
- **Council round attempted via the live browser UI**, `council.enabled` seat roster including `llama-local` (confirmed still `enabled: true` at `~/.dsh/settings.yaml:371`). Used the same cheap "Connectivity check only... each seat reply with one short sentence naming its own exact model and host" prompt a prior session had queued (zero real work, minimal token spend by design), Council mode toggled on, sent.
- **Result: "Council — planning only / No seat could produce a plan" on every attempt**, followed by an Approve→"Send go to run it"→"replaced by a newer plan"→auto-reapproved loop (reproduces the exact loop pattern documented in the audit handoff's session 4, "Session B"). Tried Approve + the dedicated "Send 'go' to run it" UI button (not typed by hand) twice; looped both times, zero dollars spent either time ("nothing has been spent" shown both times).
- **Root cause found in the DSH host's own stdout log** (`launch-dsh.cmd`'s console), not guessed: every one of the three planning attempts printed
  ```
  COUNCIL — PLANNING ONLY
  Budget: remaining credit $0.44 is below the $0.50 floor; run refused
  ```
  **This is not one of the ten catalogued DSH bugs.** The pre-flight OpenRouter budget gate (`minBalanceUsd` floor, default $0.50, see `src/index.ts` `CouncilSettings`) is refusing every planning call outright because the account's OpenRouter balance ($0.44) is under the floor — before any seat, including `llama-local`, is ever asked anything. That refusal is what surfaces to the UI as "No seat could produce a plan", and the approve/go loop is a symptom of retrying a plan that can never succeed while the balance stays under the floor (each retry generates a new, equally-refused plan, which supersedes the one just approved).
  - I deliberately did **not** lower `minBalanceUsd` or top up the OpenRouter balance — both are the user's call (a live spend/config decision), not something to change unilaterally mid-diagnostic.
- **What IS proven, unaffected by this:** the `llama-local` seat is genuinely wired into the live roster and priced (`⚫ Local llama (vMixer): subscription, not metered` appears in the plan estimate every time), matching what session 4 of the audit handoff already proved via the resolver/transport probes. The remaining gap to a fully closed phase 2 is purely "get a plan to actually draft", which needs either (a) OpenRouter balance topped up above $0.50, (b) `minBalanceUsd` lowered (a real safety-floor change, ask first), or (c) confirmation that a plan can draft using only non-OpenRouter-priced seats (Free Claude, Claude work account, llama-local) — **not yet checked whether the budget gate is unconditional or only fires when a metered seat is in the roster; worth checking the gate's condition in `src/council.ts` before assuming (b)/(c) would even help.**

### Exact next action

1. **User decision needed**: top up OpenRouter balance above $0.50, or authorize a temporary/permanent `minBalanceUsd` change, before phase 2's "real round completes" can be proven. Until then, do not keep retrying via the UI — it will refuse identically every time and cost nothing but also prove nothing new.
2. Once balance/floor is resolved: re-run the same connectivity-check council round, confirm the `llama-local` seat actually drafts a reply (not just appears priced in the plan), and mark phase 2 fully closed.
3. Separately, a background agent (task id not recorded in this note — see the DSH-run-failures-audit handoff for its own session block) is working the eight still-open failure modes from that handoff in parallel; this session's finding (OpenRouter balance floor) is unrelated to that work and should not be confused with it.
4. Relay logon autostart + FCC 8082 restart on vmixer2o2 — still that machine's user, unchanged.
5. Session-end cue, then `git-gatekeeper` pushes the open harness queue entries (check `push-requests.md` for current state — may have grown if the background bug-fix agent has committed anything by then).

## Session 10 (Claude Sonnet 5, ndi2) — real live bug found and fixed (separate from the OpenRouter floor); merge done; live loop root-caused, not just observed

Ask, verbatim: "~/.claude/shared-brain/handoff-2026-09-21-0530-long-term-sync-plan.md turn on remote" then, after a false QUOTA STOP hook fired at the very start (checked live via `get_usage`: 12% of the 5-hour window, 20% weekly — not 100%; this session's quota hook has now false-alarmed at least twice in this handoff's history, see Session 8's note and this one), the user said "you have quota you are a different agent" and "turn on remote there is another agent on vmixer if you need them". Proceeded on verified real quota, not the hook text. Host ndi2 (vmixlaptop2x6), session `local_1b9428ef-d84f-4e8f-89f1-4a14ad6a360f`, Remote Control turned on (`set_remote_control self` → `"on"`). Did not know about Session 9's concurrent work until midway through (see below) — this session's own diagnosis was done independently via source reading and a live UI reproduction, then cross-checked against Session 9's note once found, and the two findings are complementary, not conflicting.

**Step 1 — merge done.** `git merge origin/feat/heterogeneous-teammates` (brings in `737ecb77e3`, which touches only `seats.ts` and `reachability.spec.ts`, neither dirty): trial-merged with `--no-commit --no-ff` first (clean, no conflicts), committed as `0e0208e2b9`. Verified after: `tsc --noEmit` exit 0, council suite 41 files / 651 tests passed (was 650 before the merge; the incoming commit added one). This was Session 9's exact-next-action item 4, done here before Session 9's note was found.

**Step 2 — DSH rebuild + relaunch, done twice more (see step 4).** First rebuild via `~/.dsh/rebuild-dsh.cmd` run through a piped/non-interactive shell **crashed the server immediately after startup** ("DSH exited with code -1") because `launch-dsh.cmd` expects a real interactive console (closing its window is how a person stops it) and got a closed stdin instead — the wrapper's own `exit /b 0` after the `call` swallowed the nonzero exit, so the background-task notification falsely reported success. Fixed by launching it as a detached console process instead: `Start-Process -FilePath "...\launch-dsh.cmd" -WindowStyle Minimized`, which stays up. **Worth recording as a standing note**: never pipe `launch-dsh.cmd`'s output into a non-interactive shell; always `Start-Process` it (or run it in a real terminal window).

**Step 3 — reproduced the live "approve → go → replaced by a newer plan" loop myself**, independently of Session 9, with council mode ON, using the same cheap connectivity-check prompt. Found a real, separate, verified bug via source reading, not guessing:

- [index.ts:1013-1025](packages/council/tool-council/src/index.ts) (pre-fix): the "`[council approved]`... call the council tool NOW with the plan's question as query" directive — the ONLY thing that tells the orchestrating model to reuse the stored question instead of the literal chat text — was wrapped in `if (live().councilMode !== true) { ... }`, on the claimed (and wrong) assumption that "CouncilMode already handles this directly". It does not: `COUNCIL_MODE_DIRECTIVE` (the generic council-mode instruction, unconditional) just says "call it now with the user's request as the query" for every turn, with no awareness of an approved-and-waiting plan. Since the UI's "Send 'go' to run it" button ([GateStrip.tsx:60](packages/client/ui-council-budget/src/client/GateStrip.tsx), `RUN_IT = 'go'`) sends the literal text "go", and council mode was ON, the orchestrator called `council` with `query: "go"` — which the already-shipped #5 fix (correctly) treats as a brand-new, non-matching question, discarding the just-approved plan and re-planning. Every retry repeated this.
- **Fix**: removed the `councilMode !== true` guard so this check runs unconditionally, same as the sibling swarm/propose-approved checks right above it which never had that guard.
- **Refined once more after live observation**: the first version of the fix said "with the plan's question as `query`" without stating what that question actually was, trusting the model to recall it from earlier context. Live-tested with the fix in place: the model's own "Think" text showed it genuinely couldn't reliably recall/reproduce the exact stored text and still mismatched. Changed the injected text to quote the exact stored `pendingPlanQuery` verbatim (JSON-stringified) and explicitly forbid paraphrasing/summarising/"go". Re-tested live: the model's next "Think" now reads "We need to call council with the exact stored text... So we call council with that query" and the tool call's `query` argument now matches exactly — confirmed by watching the transcript, not assumed.
- **New regression test**: `packages/council/tool-council/tests/council-mode-approved-gate.spec.ts` — boots the real Loader/tool registry (mocked seats, no network, no budget dependency at all), sets `councilMode: true` plus an approved-and-waiting plan, sends the literal `"go"` text through the real `agent/pre-step` hook, and asserts the injected directive is `[council approved]` (containing the exact stored question) rather than falling through to `[council mode]`. This test does NOT depend on any live API/budget state, so it is a clean, permanent proof of this specific fix independent of the OpenRouter-floor issue below.

**Step 4 — why the live loop still didn't fully close even with the fix verified working**: found Session 9's note (above) only after this. Session 9 independently root-caused the SAME symptom to a *different, compounding* cause: the DSH host's own stdout log shows every planning attempt printing `Budget: remaining credit $0.44 is below the $0.50 floor; run refused` — the pre-flight OpenRouter balance floor (`minBalanceUsd`, default $0.50) refuses planning outright, before any seat (including `llama-local`) is ever asked anything, regardless of whether the query passed in is correct. This means: even after my fix correctly routes the exact stored query on "go", the resulting `council` call still can't produce a real plan while the balance stays under the floor — it comes back `phase: 'plan'` with a **new, empty plan id** every time (because the planning attempt itself is refused, not because the query was wrong), which is what makes the UI show "replaced by a newer one" even on a correctly-targeted retry. **Both things are real and independently verified**: my directive fix (proven by a budget-independent unit test and by watching the live transcript show the correct query reach the tool) and Session 9's OpenRouter-floor finding (proven by the host's own log lines) are two different bugs in the same failure chain, not competing explanations.
- Did **not** touch `minBalanceUsd` or top up the OpenRouter balance — same restraint Session 9 already correctly exercised; it is the user's call.

**Step 5 — a third, unrelated file, not touched.** `packages/council/tool-council/tests/pipeline-advance-to-swarm.spec.ts` appeared in the working tree mid-session (untracked, mtime between this session's merge and its own fix work) — this is Session 9's "background agent... working the eight still-open failure modes in parallel" (failure mode #4), not mine. Its one test fails on a pre-existing bug in **its own** regex: `/council-plan:([0-9a-fA-F-]+)/` greedily captures the two `-` characters from the HTML comment's closing `-->` (since `-` is inside the character class), so the `issued` id it extracts and later writes into `approvedPlanId` carries a spurious trailing `--` that never matches the tool's own clean `pendingPlanId`. **Confirmed independent of my fix**: `git stash push -- packages/council/tool-council/src/index.ts` (reverting to the pre-fix, post-merge state) and re-running that one test reproduces the identical failure. Left untouched — it belongs to the concurrent background agent, not this session.

**Verification, real numbers (after both the merge and the directive fix, before the pipeline-advance-to-swarm.spec.ts file existed vs after are the same since it's unrelated):**
- `tsc --noEmit` → exit 0.
- `vitest run packages/council/tool-council` → **42 files passed, 1 failed** (the pre-existing, unrelated `pipeline-advance-to-swarm.spec.ts`), **652 passed, 1 failed** of 653 tests. My own new spec (`council-mode-approved-gate.spec.ts`) passes; the full merge-verification run before it existed was 41 files / 651 passed.
- DSH host rebuilt and relaunched twice more this session (once for the initial fix, once for the refined directive text) via the `Start-Process` method from step 2; currently live, PID 20548 (PIDs keep changing across relaunches/health-monitor cycles — verify by `curl http://127.0.0.1:3080/` → 200 and `~/.dsh/.built-commit` matching `git rev-parse HEAD`, not by PID number), `.built-commit` = HEAD `d532def97bdc56923f5e32efec662db98118fdd4` confirmed matching.

**Files now dirty (all UNCOMMITTED, this session's own):**
- `packages/council/tool-council/src/index.ts` — the councilMode-gate fix (on top of the already-committed #10/#5/#2-revert from Session 6, which landed in the `d532def97b` commit that was HEAD when this session started).
- `packages/council/tool-council/tests/council-mode-approved-gate.spec.ts` — new, 1 case, budget-independent regression test.
- `.agents/notes/implemented/bug-fix/2026-09-21-council-mode-approved-gate.md` — new Agent Note, written and verified.
- (`pipeline-advance-to-swarm.spec.ts` is also dirty but is NOT this session's file — do not commit or discard it.)

**Agent Note: DONE.** `.agents/notes/implemented/bug-fix/2026-09-21-council-mode-approved-gate.md` written, matching the `2026-09-20-pipeline-routing-and-swarm-roots.md` shape. `node_modules/.bin/tsx scripts/verify-agent-note-format.ts` run: the only violations reported are the same two pre-existing, already-committed ones Session 6 already noted (`implemented/feature/2026-09-05-codex-quota-sidebar.md`, `implemented/feature/2026-09-08-antigravity-seats.md`) — this session's note is clean.

### Exact next action
1. **User decision still needed** (unchanged from Session 9): top up the OpenRouter balance above $0.50, or authorize a `minBalanceUsd` change, before a real council round can actually draft and phase 2 can be marked fully closed end-to-end. Until then, do not keep retrying the live round — the budget floor refuses it identically every time regardless of any code fix.
2. Once the balance/floor is resolved: re-run the connectivity-check round one more time to confirm it now runs straight through on the first "go" (no loop) and the `llama-local` seat actually drafts a reply — that closes phase 2 for real, combining this session's fix with Session 9's diagnosis.
3. Commit this session's fix (`index.ts` + the new spec + the new Agent Note) once the user gives the word — same standing rule as every prior session's fixes in this file.
4. `git-gatekeeper` push once the user says the session is ending — harness is currently 6 ahead / 0 behind `origin/feat/heterogeneous-teammates` (confirmed via `git fetch` + `rev-list --left-right --count`); `push-requests.md` has grown to 706 lines, reflects prior queue entries plus whatever the background bug-fix agent has added.
5. Relay logon autostart + FCC 8082 restart on vmixer2o2 — still that machine's user, unchanged from every prior session.
6. Do NOT touch `pipeline-advance-to-swarm.spec.ts` — owned by the concurrent background bug-fix agent (failure mode #4); its failure is real but pre-existing and unrelated to anything in this session.

### Do not repeat
- Do not re-remove the `councilMode !== true` guard at index.ts — already removed and tested.
- Do not re-run `~/.dsh/rebuild-dsh.cmd` (or any launch script) through a piped/non-interactive shell — it crashes the server silently right after startup with a falsely-reported success. Use `Start-Process` (PowerShell) or a real terminal window.
- Do not mistake "Council — planning only / No seat could produce a plan" for a query-matching bug in isolation — check the DSH host's own stdout log for a budget-floor refusal line first; both causes can be present at once.
- Do not touch `minBalanceUsd` or the OpenRouter balance without the user's explicit go — this is the second session in a row to correctly decline to do so unilaterally.
- Do not touch `pipeline-advance-to-swarm.spec.ts` — not this session's file; its failure is confirmed pre-existing and unrelated (proven via `git stash`).

### Do not repeat
- Do not mistake "No seat could produce a plan" / the approve-go loop for a DSH code bug by itself — in this session it was the OpenRouter budget floor. Check the host's own console log (`launch-dsh.cmd` window / captured log) for the `Budget: ... run refused` line before assuming it is failure mode #6 from the audit handoff.
- Do not top up OpenRouter balance or change `minBalanceUsd` without asking — both are real financial/config decisions.

## Session 10 (Claude Sonnet 5, ndi2) — QUOTA STOP on arrival, nothing done

User's message was just the filename, then mid-turn "remote" (i.e. turn on Remote Control, same shorthand as sessions 6-8). This session's `UserPromptSubmit` hook fired a 100%-session-quota FINISH-NOW notice (week 30%, resets 2026-09-21 14:00) before any tool call beyond reading this file. Per the standing checkpoint rule, no new work was started: Remote Control was **not** turned on, `ListAgents` was not called, nothing was messaged to any peer, no DSH/git commands run. Session id not captured. Host ndi2 (vmixlaptop2x6). Model Claude Sonnet 5.

State is exactly as Session 9 left it — see that block for full detail: DSH host rebuilt + relaunched onto `d532def97b` (live, 3080 200), real council round blocked by OpenRouter balance $0.44 < $0.50 `minBalanceUsd` floor (not a code bug), `llama-local` seat proven priced in the live roster. Per the later session-14/15 log entries (see shared-agent-log.md), the DSH gate #10/#5 fixes and CheaperInference/claude-work UI work were since committed on ndi2 at `d532def97b` (6 ahead/0 behind origin, tree clean) — this session did not re-verify that independently, it is carried from the log only.

### Exact next action
1. Turn Remote Control on for the receiving session (`mcp__ccd_session_mgmt__set_remote_control(session_id: "self", enabled: true)`) — this was the user's actual ask this turn, deferred only because of the quota stop.
2. `ListAgents` to find vmixer2o2 / relay-owner peers again.
3. User decision still needed: top up OpenRouter balance above $0.50, or authorize a `minBalanceUsd` change, before the real council round can complete and close phase 2.
4. Once resolved: re-run the connectivity-check council round, confirm `llama-local` actually drafts.
5. Relay logon autostart + FCC 8082 restart on vmixer2o2 — that machine's user, unchanged.
6. Session-end cue, then `git-gatekeeper` pushes any open harness queue entries (check `push-requests.md` for current state).

### Do not repeat
- Do not assume Remote Control is already on for a fresh session; it was off on arrival this session.
- Do not re-attempt the council round without the balance/floor decision — it will refuse identically.

## Session 11 (Claude Sonnet 5, ndi2) — live state re-verified from disk (not notes); answered Session 9's open question about the budget gate; still blocked on the same user decision

Ask: "continue outstanding work from handoff". Remote Control not touched (not asked for this turn). Host ndi2, cwd `~\Documents\claudecode\deepseek-harness`. Did not trust the prior notes' claims — re-checked everything live.

**Verified live, exactly matching the last written state (nothing drifted):**
- `git fetch` + `git status --porcelain`: working tree has `packages/council/tool-council/src/index.ts` modified (the councilMode-gate fix) plus 3 untracked files — `.agents/notes/implemented/bug-fix/2026-09-21-council-mode-approved-gate.md`, `tests/council-mode-approved-gate.spec.ts`, and `tests/pipeline-advance-to-swarm.spec.ts` (confirmed still not this thread's file). HEAD `d532def97b`, `git rev-list --left-right --count HEAD...origin/feat/heterogeneous-teammates` = `6 0`. All exactly as Session 10/the log described — **still uncommitted, the user has not yet given the word to commit this specific fix**.
- `push-requests.md`: the harness queue entry (filed 2026-09-21T20:05:00Z, Head `d532def97b`, 6 commits) is still open, awaiting the user's review/push authorization — nothing actioned on it.
- DSH host: `curl http://127.0.0.1:3080/` → 200, live. `~/.dsh/settings.yaml:371` `llama-local` council seat still `enabled: true`; the swarm-roster block at :1705 still correctly `enabled: false`.
- **Fresh OpenRouter balance, read-only GET to `/v1/credits` (no spend, just the provider's own number):** purchased $12.00, used $11.5614, **remaining $0.4386** — still under the $0.50 `minBalanceUsd` floor. Not materially changed from Session 9's $0.44 reading; this is still the live blocker, re-confirmed rather than assumed stale.

**New finding, answers Session 9's open question directly.** Read `packages/council/tool-council/src/council.ts:902-928`: the OpenRouter budget gate (`judgeBudget`) is **unconditional** — it runs whenever `options.budget` is set (which it always is, `config.minBalanceUsd` defaults to `0.5` at `index.ts:575`), regardless of whether the active seat roster contains any OpenRouter-priced seat at all. This is structurally different from the CheaperInference wallet check three lines below it, which IS roster-aware (`walletSeat = active.find(seat => seat.apiKeyEnv === CHEAPERINFERENCE_KEY_ENV)`, skipped entirely when no such seat is active). So Session 9's option (c) — "confirm a plan can draft using only non-OpenRouter seats (Free Claude, Claude work, llama-local)" — **would not work today even though none of those three seats spend OpenRouter credit**, because the gate fires before roster composition is even considered. This is arguably a real gap (an all-non-OpenRouter roster is refused for an unrelated provider's balance), and a targeted fix mirroring the wallet check's pattern (only call `judgeBudget` when `active.some(seat => seat draws OpenRouter credit)`) would let the connectivity-check round draft for free without touching the balance or the floor. Not implemented — this is a policy-adjacent change to money-gating logic and needs the user's go, not a unilateral call.

### Exact next action — the actual decision now blocking phase 2, laid out for the user
Three ways to unblock the real council round, none yet chosen:
1. Top up the OpenRouter balance above $0.50 (real money).
2. Lower/override `minBalanceUsd` (weakens the safety floor itself, even temporarily).
3. Code fix: make the OpenRouter budget gate roster-aware like the wallet gate already is, so an all-non-OpenRouter roster (Free Claude / Claude work / llama-local) drafts for $0 — new option, found this session, not yet built.
Whichever is chosen, then: re-run the connectivity-check round, confirm `llama-local` actually drafts a reply (closes phase 2); commit the councilMode-gate fix + its spec + Agent Note once the user gives the word; `git-gatekeeper` push on session-end cue (the queue entry is already filed and waiting); relay logon autostart + FCC 8082 restart on vmixer2o2 still need that machine's user, unchanged from every prior session.

### Do not repeat
- Do not assume the OpenRouter balance has recovered — re-checked live this session, still $0.4386, still under floor.
- Do not touch `minBalanceUsd` or top up the balance without the user's explicit choice among the three options above.
- Do not touch `tests/pipeline-advance-to-swarm.spec.ts` — still not this thread's file.

### Session 11 continued — user chose "top up balance" (their own action, not mine) + authorized committing the councilMode-gate fix; committed; FINISH-NOW at 151k

User answered the AskUserQuestion: balance top-up will be done by the user themselves on openrouter.ai (I cannot make payments — told them plainly, per the standing prohibited-actions rule). Separately authorized committing the pending fix.

**Before committing, re-verified rather than trusted the last numbers:** `tsc --noEmit` → exit 0. `vitest run packages/council/tool-council` → **42 files passed, 1 failed (43 total)**, **652 passed, 1 failed (653 total)** — the 1 failure is the same pre-existing `tests/pipeline-advance-to-swarm.spec.ts` case (`AssertionError: expected ... not to contain 'cannot advance to swarm'`), confirmed still not this thread's file.

**Committed** `330c546de392ef4f9d48331c7be34c5379cc0403` "fix(council): unconditionally reuse approved plan question on go" — staged only the 3 files belonging to this fix (`packages/council/tool-council/src/index.ts`, `packages/council/tool-council/tests/council-mode-approved-gate.spec.ts`, `.agents/notes/implemented/bug-fix/2026-09-21-council-mode-approved-gate.md`), leaving `pipeline-advance-to-swarm.spec.ts` untracked and untouched. lefthook pre-commit (lint staged, whitespace, vendor manifest) passed. 3 files changed, 162 insertions(+), 11 deletions(-).

**Post-commit state:** `git status --porcelain` shows only the one untracked, not-ours file (`tests/pipeline-advance-to-swarm.spec.ts`). `git rev-list --left-right --count HEAD...origin/feat/heterogeneous-teammates` = **7 0** (was 6 0 before this commit). **Not yet filed to `push-requests.md`** — the existing open entry there (filed 2026-09-21T20:05:00Z, Head `d532def97b`, 6 commits) is now stale by one commit; superseding it is the very next action, deferred only because this FINISH-NOW hook fired immediately after the commit and the standing rule says start no new work once it fires.

### Exact next action
1. **File the superseding `push-requests.md` entry first** — same repo, new Head `330c546de3`, 7 commits (the prior 6 plus this session's fix), superseding the 20:05:00Z entry. This was about to happen when FINISH-NOW fired; do it before anything else next session.
2. Once the user has topped up OpenRouter above $0.50: re-run the connectivity-check council round, confirm `llama-local` actually drafts a reply — closes phase 2 for real.
3. Session-end cue, then `git-gatekeeper` pushes (queue entry will show 7 ahead once step 1 is done).
4. Relay logon autostart + FCC 8082 restart on vmixer2o2 — still that machine's user, unchanged from every prior session.

### Do not repeat
- Do not re-commit `index.ts`/`council-mode-approved-gate.spec.ts`/the Agent Note — already committed at `330c546de3`.
- Do not re-verify the OpenRouter balance by re-running the connectivity-check round before the user confirms the top-up happened — it will refuse identically until then.
- Do not touch `tests/pipeline-advance-to-swarm.spec.ts` — still not this thread's file, still the one pre-existing unrelated failure.

## Session 12 (Claude Sonnet 5, ndi2) — balance confirmed topped up; new CheaperInference tile built+shipped; live council round proven past both prior bugs; outcome of the actual draft not yet observed; FINISH-NOW at 296k

User said "updated" (balance topped up), re-verified live: OpenRouter `/v1/credits` now purchased $17.00, used $11.5614, **remaining $5.4386** — well above the $0.50 floor. Filed the superseding `push-requests.md` entry for `330c546de3` (see file, section dated 2026-09-21T21:15:00Z).

**Then the user reported a second, separate issue mid-turn: "dsh still doesn't have a cheapinference quota/budget tool."** Investigated live in the browser (localhost:3080): the CheaperInference budget data DID exist, but only buried inside the Council Budget flyout's capacity panel (`CHEAPERINFERENCE BUDGET` subsection), not as its own tile. Confirmed via the CheaperInference API directly (read-only GET, script-based, key never printed) that `/v1/account/balance` returns `403 insufficient_scope: "API key scope required: account:read."` while `/v1/models` returns 200 — the key is valid but was issued without the `account:read` scope on CheaperInference's own dashboard. **This is a provider-side account permission, not fixable in code**; told the user plainly I cannot grant it myself (it needs their login at CheaperInference to regenerate/edit the key's scopes).

**Security incident, self-caused, disclosed to the user in-turn:** while inspecting `~/.dsh/.credentials.yaml`, a `grep -in ... | sed` redaction command had its capture group hijacked by `grep -n`'s own line-number colon (matched before the real key's colon), so the **raw CheaperInference API key (`ci_live_...`) was printed unredacted into this session's tool output**. Recommended the user rotate that key immediately. No further raw-secret reads were done this session; all later CheaperInference checks used a script that extracts the key by exact variable-name regex and only ever prints response bodies, never the key.

**User's follow-up ask, verbatim:** "it needs its own budget/quota tool and it should have real numbers you have the api info already fix it then confirm if council swarm work with no issues i want to do building via dsh." Addressed the buildable half:

- **Built a standalone `CheaperInference` sidebar tile**, mirroring the existing `ClaudeQuota`/`CouncilBudget` `sidebar.region.action` pattern in the same `ui-council-budget` package (chose this over a new package: the data already lives in the `council` settings namespace this package already binds, so no new dependency/`cordis.patch.yml` wiring was needed). New file [CheaperInferenceQuota.tsx](packages/client/ui-council-budget/src/client/CheaperInferenceQuota.tsx), registered at `sidebar.region.action` order 2 (after `council-budget` at 1) in [index.ts](packages/client/ui-council-budget/src/client/index.ts). Added 3 new locale keys (`quota.triggerAria/triggerTooltip/panelTitle`, en+zh) to [locales.ts](packages/client/ui-council-budget/src/client/locales.ts). Reuses `CouncilBudget.module.css` classes directly — no new CSS file. Purely additive: the existing buried section in `CouncilBudget.tsx` was NOT touched or removed (both read/write the same fields, so they can't disagree).
- **Verified, not assumed**: `tsc --noEmit` (root, exit 0) and `tsc -p tsconfig.client.json --noEmit` (exit 0) both clean. `vitest run packages/client/ui-council-budget` → **8 files / 63 tests passed**, no regressions. Rebuilt via `node_modules/.bin/tsdown` directly in the package (plain `fleet.mjs build` / turbo did NOT pick up the new file — see Do-not-repeat below), confirmed the new registration string landed in `lib/client.js` before restarting. Relaunched the DSH host (`Start-Process`, never piped — per the standing rule below). **Live-verified in the browser**: the "CheaperInference" tile renders in the sidebar between Council Budget and OpenRouter Monitor, opens its own panel ("CheaperInference wallet: key lacks account:read", captured timestamp, Refresh button), and the Refresh button was clicked and observed to genuinely re-read (timestamp advanced from 4:11:51 PM to 4:12:31 PM, state cycled through "Reading…"). Screenshots taken, not just described.
- **Still not fixed, and cannot be from here**: the wallet number itself. That needs a CheaperInference key with `account:read` scope, which only the user can generate on CheaperInference's own dashboard (and given the rotation recommendation above, they'll be generating a new key anyway).

**Confirming "council/swarm work with no issues" — in progress, outcome not yet observed.** Opened a fresh session in the Harness Build workspace, sent the same low-cost connectivity-check prompt used throughout this whole saga, with Council mode on:
- First attempt: the orchestrator (Free - large tier, routed by FCC) sat in a tool call for 2m17s with output frozen at 126 tokens; aborted it as likely a slow/stuck free-tier call, not our bug (no assumption made either way, not written up as a finding).
- Second attempt, same prompt: **produced a real plan** (`council-plan:2f5aae83-...`), naming an actual seat ("Claude Sonnet 5 on host ndi2") rather than "No seat could produce a plan" — first time in this entire saga's history the OpenRouter floor has not blocked planning. Approved via the UI's own Approve button (not typed). Sent "go" via the composer (not the dedicated pipeline send-button, which does not appear for plain council mode — only "Send any message" was asked for, matching the UI's own instruction text). **Live-watched the fix work**: the injected directive rendered as `[council approved] ... Call the council tool NOW with query set to exactly this stored text, unchanged: "Connectivity check only...` and the model's own Think block confirmed it extracted that exact text before calling the tool — this is the Session 10 fix (`330c546de3`) working correctly in production, not just in the unit test. At the point this session hit FINISH-NOW (296k context), the round had just re-entered "Deep diving..." on the real drafting call; **the actual seat replies / final report were not yet observed** — genuinely unknown whether it completes cleanly, loops, or hits a different issue.

### Not done
- Whether the real drafting round actually completes and which seats answer — not observed, this session ran out of context budget mid-round. The DSH session is titled "Connectivity check only. No files," in the Harness Build workspace, visible in the sidebar session list, and can be reopened directly to see the outcome rather than re-running it (re-running risks another live spend for a round that may have already finished).
- Swarm was not tested at all this session — only council mode.
- CheaperInference wallet real numbers — blocked on the user regenerating a scoped key (and rotating the exposed one).
- The CheaperInferenceQuota tile changes are **UNCOMMITTED** (index.ts, locales.ts, and the new CheaperInferenceQuota.tsx) — not committed this session, no user go asked for yet.
- The superseded push-requests.md entry (Head `330c546de3`) has not been actioned by any gatekeeper — still awaiting the user's session-end cue.

### Exact next action
1. **Reopen the "Connectivity check only. No files," session** (created this session, in Harness Build workspace) and read what happened to the drafting round that was in flight at FINISH-NOW — do not re-send the prompt blind.
2. If it completed cleanly: phase 2 of the original long-term sync plan is finally closed for real. If it looped or errored: diagnose from the DSH host's own log/the session transcript, same method as every prior session in this file.
3. Get the user's go to commit the CheaperInferenceQuota tile (3 files: `CheaperInferenceQuota.tsx` new, `index.ts` and `locales.ts` modified), then test/typecheck already clean per above.
4. Test swarm mode once council is confirmed clean — the user explicitly asked for both.
5. Tell the user to rotate the CheaperInference key (exposed this session) and, while there, generate/attach `account:read` scope so the wallet tile shows real numbers.
6. Session-end cue, then `git-gatekeeper` pushes the queued harness commits (currently 7 ahead, entry filed for `330c546de3`; will grow by one more once the tile fix is committed).

### Do not repeat
- Do not run `node ~/.claude/shared-brain/.sync/fleet.mjs build` (or any turbo-driven build) expecting it to pick up a brand-new, not-yet-git-tracked file — it silently built successfully without including `CheaperInferenceQuota.tsx` (0 matches in the served bundle) until built directly via `node_modules/.bin/tsdown` inside the specific package directory. Always grep the served bundle (or `lib/client.js`) for a new symbol after a build that's supposed to include it, before trusting a green exit code.
- Do not grep a credentials file for a secret's name with `grep -n` piped into a `sed` redaction regex anchored on a bare colon — the line-number prefix's own colon can be matched first and leave the real value unredacted. Read secrets only through a script that extracts by exact key-name regex and never echoes the match.
- Do not assume "Deep diving..." stuck at a frozen token count for 2+ minutes is necessarily broken — the second identical attempt succeeded in ~25s. If it recurs, check the DSH host's own log before aborting.
- Do not re-test the OpenRouter floor — confirmed cleared, $5.4386 remaining.

## Session 13 (Claude Sonnet 5, ndi2) — QUOTA STOP on arrival, nothing done

User's message was just "go" (resume signal, presumably meaning "continue" after Session 12's handoff). This session's own context arrived already at 305k (carried forward, not a clean start) and the `UserPromptSubmit` hook fired FINISH-NOW immediately, before any tool call. Per the standing checkpoint rule, no new work was started: the "Connectivity check only. No files," session was NOT reopened, nothing was read, nothing was run. Host ndi2 (vmixlaptop2x6). Model Claude Sonnet 5. Session id not captured.

State is exactly as Session 12 left it — see that block for full detail and do not repeat any of its work. Note: MEMORY.md's index (re-read at this session's start) shows other agents/sessions have since touched related but separate handoffs (`handoff-2026-09-21-1715-cheaperinference-key-entry.md`, `handoff-2026-09-21-2300-vmixer-gatekeeper-entry-fix.md`, `handoff-2026-09-21-1814-dsh-vmixer-build-secrets-sync.md`) — worth reading those first in the next session, since the CheaperInference-key and gatekeeper-queue items this file already tracks may have moved forward elsewhere. In particular `handoff-2026-09-21-1715-cheaperinference-key-entry.md` (Claude Sonnet 5, ndi2) says the DSH budget tool code "already works... just needs a rescoped key entered via existing `Desktop\CheaperInference Key Setup.cmd`" — read that note before repeating this file's Session 12 investigation of the account:read scope gap.

### Exact next action (unchanged from Session 12 — start here)
1. Read `handoff-2026-09-21-1715-cheaperinference-key-entry.md` first — it may mean the user already ran the key-setup tool since Session 12, which would change what's still open on the CheaperInference wallet.
2. Reopen the "Connectivity check only. No files," session (Harness Build workspace) and read what happened to the drafting round that was in flight at Session 12's FINISH-NOW — do not re-send the prompt blind.
3. Get the user's go to commit the CheaperInferenceQuota tile (3 files, still uncommitted per Session 12).
4. Test swarm mode once council is confirmed clean.
5. Confirm the CheaperInference key rotation (flagged in Session 12) actually happened.
6. Session-end cue, then `git-gatekeeper` pushes the queued harness commits.

### Do not repeat
- Do not re-investigate the CheaperInference account:read scope gap before reading `handoff-2026-09-21-1715-cheaperinference-key-entry.md` — it may already be resolved or have a simpler fix (the existing `Desktop\CheaperInference Key Setup.cmd` tool) than assumed.
- Do not assume this session's high starting context (305k) means heavy work happened here — it is carried-forward context from Session 12; this session (13) did nothing new.

## Session 14 (Claude Sonnet 5, ndi2, session local_82fcd92c-df30-4cc1-88c3-0c1309a99a0a) — Remote Control on; harness/plugins/brain all confirmed fully synced; vmixer2o2 confirmed current via its own status file; ndi2's own DSH host rebuilt but NOT yet relaunched; FINISH-NOW at 151k

Ask, verbatim: "please continue this and turn on remote control coordinate the updates to dsh with vmixer". Host ndi2 (vmixlaptop2x6), cwd `~/Documents/claudecode/deepseek-harness`. This session's display name is "Remote control and dsh/vmixer sync [cee601]".

**Remote Control: ON.** `set_remote_control(self, true)` → `{"remoteControlState":"on"}`.

**Re-verified live, everything the prior 13 sessions were chasing is already synced (nothing drifted, nothing assumed from notes):**
- `deepseek-harness` (`feat/heterogeneous-teammates`): `git status --porcelain` clean (one pre-existing untracked file `tests/pipeline-advance-to-swarm.spec.ts`, still not this thread's), `rev-list --left-right --count HEAD...origin/...` = **0 0**. HEAD `333073034d` — this already includes all three commits Sessions 6-12 built (`d532def97b` gate fixes + CheaperInference wallet UI, `330c546de3` the councilMode-approved-gate fix, `333073034d` the CheaperInference sidebar tile). **All three are already on origin** — some gatekeeper (PowerShell or `git-gatekeeper`) pushed them between Session 12 and now; this session did not push anything.
- `dsh-council-plugins` (`main`): clean, **0 0** vs origin.
- `~/.claude/shared-brain` (`main`): clean, **0 0** vs origin — the `487471c` pm-remote-env secret-seal commit (filed as an open queue entry per `push-requests.md`) is already landed on origin too.
- `~/.claude/shared-brain/fleet/status/vmixer2o2.json`: `seen 2026-09-22T09:00:11Z`, checked against real UTC `2026-09-22T09:05:38Z` — **5 minutes fresh**, listener actively cycling. All 6 secrets `"same"` (including the new `pm-remote-env`). All repos `"current"`/0-behind except `free-claude-code` (19 behind, unrelated to this plan, not touched). **`dsh.head` on vmixer2o2 is already `333073034d70f2f0cf7a0749ed6202856a28680e` — byte-identical to ndi2's HEAD.** Antigravity there is `2.15.1` (ahead-of-master, fine per no-downgrade rule).
- **Conclusion: the "sync vMixer with ndi2" and "coordinate DSH build with vmixer" parts of this plan are, as of this check, already done** — vmixer2o2's own automated fleet/brain-sync listener got it there without needing a live interactive session. What's NOT confirmed is whether vmixer2o2's own DSH *host process* (port equivalent there) has been rebuilt/relaunched onto that checked-out code, vs just having the repo checked out — the status file only proves the repo/build marker, not a running process. Asked the peer (see below).

**Peer contact:** `ListAgents` initially showed only 3 ndi2-local sessions (cross-checked against `list_sessions` — all three have `cwd: ~\...`, confirmed NOT vmixer). After turning Remote Control on, a 4th peer appeared: **"Fleet checkin handoff [c7d301]" · Remote Control · idle** — not yet confirmed as vmixer2o2 (no session-list entry for it since it's on another machine/account link). Sent it msg `060aed95-4fa0-4d1c-b112-ac6186694a85`: asked it to confirm identity, shared the sync numbers above, and asked three open questions — (1) relay logon autostart for the llama relay (owned by a different vmixer-side session, `local_4806d660...`, per Session 4 — still pending?), (2) FCC 8082 restart on vmixer2o2 to pick up restored keys — still pending?, (3) has vmixer2o2's own DSH host actually rebuilt/relaunched onto `333073034d`, and has anyone there exercised the `llama-local` seat from that side. **No reply yet** — Remote Control sends report nothing back; silence is not agreement, per standing note.

**ndi2's own DSH host: rebuilt, NOT yet relaunched — this is the one concrete gap found this session.**
- Before this session: `~/.dsh/.built-commit` = `330c546de392ef4f9d48331c7be34c5379cc0403` — **one commit stale**, missing `333073034d` (the CheaperInference sidebar tile), even though the repo HEAD already had it.
- Ran `node ~/.claude/shared-brain/.sync/fleet.mjs build` (the same routine `launch-dsh.cmd` calls) from `~/Documents/claudecode/deepseek-harness` — real exit code **0** (quoted: `EXITCODE:0`), full output saved at `~\.claude\projects\C--Users-ndi2-Documents-claudecode\b8b90c8c-0fcd-488f-80ea-e68defa4018c\tool-results\btaycy31g.txt`. Verified after, not assumed: `.built-commit` now reads `333073034d70f2f0cf7a0749ed6202856a28680e`, matching `git rev-parse HEAD` exactly.
- **But the live host process was NOT restarted.** `Get-NetTCPConnection -LocalPort 3080` → PID **21104**, `StartTime 9/21/2026 4:10:52 PM` — this is the same old process from before this session, still serving the stale `330c546de3` build in memory. A build alone does not hot-swap the running server. **This is the exact half-finished state to pick up next**, not a false "done."

### Not done
- DSH host on ndi2 not relaunched onto the fresh build (PID 21104 still old).
- vmixer2o2 identity/status not confirmed by direct reply (message sent, pending).
- The "Connectivity check only. No files," DSH session (Harness Build workspace, from Session 12) whose drafting-round outcome was never observed — still not reopened, still unknown whether phase 2's real round completed, looped, or errored.
- Swarm mode still not tested end-to-end (per Session 12/13).
- CheaperInference wallet real numbers — still blocked on the user regenerating a key with `account:read` scope (per `handoff-2026-09-21-1715-cheaperinference-key-entry.md`); not checked again this session, no new information.
- Relay logon autostart + FCC 8082 restart on vmixer2o2 — status asked, not yet answered.
- Nothing committed or pushed this session (nothing needed committing — tree is clean apart from the pre-existing unrelated untracked test file).

### Exact next action
1. **Relaunch ndi2's DSH host** onto `333073034d`: stop PID 21104, then launch via PowerShell `Start-Process -FilePath "<path to>\launch-dsh.cmd" -WindowStyle Minimized` (never pipe through Bash/a non-interactive shell — see Do-not-repeat). Verify `curl http://127.0.0.1:3080/` → 200 and re-check `.built-commit` still matches HEAD after relaunch (in case HEAD moved).
2. Check for a reply from **"Fleet checkin handoff [c7d301]"** (`ListAgents`/inbox) — confirm it is vmixer2o2, read its answers on relay autostart / FCC restart / its own DSH host rebuild state, and fold them into this handoff.
3. Reopen the **"Connectivity check only. No files,"** session in the Harness Build workspace (created Session 12) and read what happened to the drafting round in flight at that session's FINISH-NOW — do not re-send the prompt blind, it may have already completed or spent money.
4. Test swarm mode once council is confirmed clean end-to-end.
5. Follow up with the user on CheaperInference key rotation/rescoping (flagged Session 12, still open).
6. Session-end cue, then re-check `push-requests.md` for any new entries before assuming nothing needs a gatekeeper push (as of this session, harness/plugins/brain are all 0 ahead/0 behind origin, i.e. nothing currently queued — but that can change if item 1-4 above produce new commits).

### Do not repeat
- Do not re-run `node ~/.claude/shared-brain/.sync/fleet.mjs build` — already done this session, exit 0, `.built-commit` confirmed matching HEAD `333073034d`.
- Do not re-verify harness/dsh-council-plugins/shared-brain sync status against origin — all three confirmed **0 ahead/0 behind** this session via live `git fetch`+`rev-list`, not from notes.
- Do not assume vmixer2o2 needs any repo/secret/build catch-up — its own status file (`seen` 5 min fresh) already shows every repo current and every secret `"same"`, dsh.head byte-identical to ndi2. The only open question is whether its *running host process* has picked up that build, and whether relay-autostart/FCC-restart happened — both asked, not yet answered.
- Do not pipe `launch-dsh.cmd` through Bash or any non-interactive shell — it crashes the server immediately after startup with a falsely-reported success (Session 10 finding, still true).
- Do not re-send the identity/status check to the Remote Control peer — already sent (`060aed95-4fa0-4d1c-b112-ac6186694a85`); wait for a reply or the user's steer before re-asking.

## Session 15 (Claude Sonnet 5, ndi2) — Remote Control on; ndi2's DSH host relaunch in progress; vmixer2o2 re-confirmed fresh; QUOTA HANDOFF checkpoint (110k context)

Ask, verbatim: "handoff-2026-09-21-0530-long-term-sync-plan.md, resume with remote control on". Host ndi2 (vmixlaptop2x6), session `local_4a90d7e4-b2db-4ca4-94db-c1a8efde7257` ("Long-term sync plan handoff [655ffb]"). Picked up exactly at Session 14's exact-next-action item 1.

**Remote Control: ON.** `set_remote_control(self, true)` → `{"remoteControlState":"on"}`.

**`ListAgents` peer set has changed since Session 14** — "Fleet checkin handoff [c7d301]" (the peer messaged in Session 14, presumed vmixer2o2) is **no longer listed**. Current peers: `Remote long-term sync plan [99b0c2]` (idle, 14h), `Launch remote control resume [c43f82]` (idle, 4h), `Vmixer Gatekeeper entry fix [461808]` (idle, 8h), `Resume handoff: DSH run failures audit [c86603]` (Remote Control, running). None of these names self-identify as vmixer2o2. `ReadNotifications` → no queued notifications, so no reply to Session 14's msg `060aed95-4fa0-4d1c-b112-ac6186694a85` arrived (that peer session may simply have ended without replying).

**vmixer2o2 re-confirmed fresh independently of any peer session** (read `~/.claude/shared-brain/fleet/status/vmixer2o2.json` directly, not asked over Remote Control): `seen 2026-09-22T09:08:33.334Z`, `reposCheckedAt 09:08:15Z` — minutes-fresh at read time. All 6 secrets `"same"`, all repos `"current"`/0-behind except the already-known-irrelevant `free-claude-code` (19 behind). `dsh.head 333073034d70f2f0cf7a0749ed6202856a28680e` — still byte-identical to ndi2's HEAD. **Sync question (phase 1 + coordination) stays answered**: nothing to do here, confirmed twice now (Session 14 and this session) via the listener's own status file, independent of any live peer reply.

**ndi2's own DSH host relaunch — DONE, verified.** Confirmed on arrival, exactly as Session 14 left it: `.built-commit` = `333073034d70f2f0cf7a0749ed6202856a28680e` (matches HEAD, already built), but `Get-NetTCPConnection -LocalPort 3080` still showed the same stale PID `21104` from Session 14 — the build was never hot-swapped into a running process. Stopped PID 21104 (`Stop-Process -Force`), then launched fresh via `Start-Process -FilePath "$env:USERPROFILE\.dsh\launch-dsh.cmd" -WindowStyle Minimized` (never piped through Bash — per the standing Session 10 rule). Background Bash wait (`until curl -sf http://127.0.0.1:3080/; do sleep 2; done`) completed, exit 0, "DSH host is up". Re-verified directly after: `Get-NetTCPConnection -LocalPort 3080` → new PID **9092**, `Listen`/`Established`; `.built-commit` still `333073034d70f2f0cf7a0749ed6202856a28680e`, matching HEAD. **ndi2's DSH host is now genuinely serving the current build** — this closes the one concrete gap Session 14 found.

### Not done
- The "Connectivity check only. No files," DSH session (Harness Build workspace, created Session 12) whose drafting-round outcome was never observed — still not reopened this session.
- Swarm mode still not tested end-to-end.
- CheaperInference wallet real numbers — still blocked on the user regenerating a key with `account:read` scope; not re-checked this session.
- Relay logon autostart + FCC 8082 restart on vmixer2o2 — status still not answered by any peer reply.
- Nothing committed or pushed this session.

### Exact next action
1. Reopen the "Connectivity check only. No files," session in the Harness Build workspace and read the drafting-round outcome from Session 12 — do not re-send the prompt blind.
2. Test swarm mode once council is confirmed clean end-to-end.
3. Follow up with the user on CheaperInference key rotation/rescoping (flagged Session 12, still open).
4. Session-end cue, then re-check `push-requests.md` for any new entries (harness/plugins/brain were 0 ahead/0 behind as of Session 14/15 — nothing currently queued unless items 1-2 above produce new commits).

### Do not repeat
- Do not re-verify vmixer2o2's sync state again this saga unless its `seen` timestamp goes stale (checked fresh in both Session 14 and this session, from the status file directly, not from a peer reply).
- Do not re-send an identity/status ping looking for "Fleet checkin handoff" — that peer is gone from `ListAgents`; if vmixer2o2 needs contacting again, send to whatever peer name is current at the time.
- Do not pipe `launch-dsh.cmd` through Bash or any non-interactive shell — Start-Process only (Session 10 finding).

