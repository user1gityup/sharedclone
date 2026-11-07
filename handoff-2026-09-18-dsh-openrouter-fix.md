---
name: handoff-2026-09-18-dsh-openrouter-fix
description: DSH OpenRouter key stays on ndi2; pool machines use a token-gated relay with selectable exposure mode; relay core built and tested, mode/token tooling, client patch and brain-sync deny-list not built
metadata:
  type: project
---

# Handoff 2026-09-18: DSH OpenRouter key (no key on pool machines)

- Stable id: handoff-2026-09-18-dsh-openrouter-fix. Created ~01:30, updated 2026-09-18 ~02:05 (150k-context FINISH checkpoint).
- Owner: Claude Opus 5 (claude-opus-5), session local_434fba27-c63d-4fad-936c-01f622728ae1, host vmixlaptop2x6 (ndi2), claimed 2026-09-18 after resume; Remote Control ON. Prior owner session local_20e7d454 (finished at 150k).
- 2026-09-18 resume update: test_relay re-run 17/17 PASS. vMixer peer is now session claudecode-78 (bridge:session_016qU3zQyLoedeq7rBswc51V; claudecode-40 ended). It confirms the user chose LAN bind + firewall allow-list + per-machine token; vMixer has nothing on 8080 and waits for relay URL, ndi2 LAN IP and token location (reference only). In progress: writing .sync/openrouter-relay.mjs (TODO 1).
- Resume check: relay.py/proxy.py/__main__.py/test_relay.py and backups present as recorded; pid 26484 still the live old proxy; openrouter-relay.mjs and ~/.dsh/openrouter-relay/ not yet created.
- Collaborator: Claude Opus 5 on vmixer2o2, session claudecode-40 / local_91498d61, bridge `bridge:session_01Tts6AFpehsMptaiqyJizdg`. It is HOLDING (confirmed), with its own note handoff-2026-09-18-0133-dsh-openrouter-key.md. It waits for: the relay URL, and where vMixer's token is kept (not in plain text over the bridge). Then it repoints vMixer's providers, verifies, and removes the OPENROUTER_API_KEY ref from vMixer's .credentials.yaml, with ndi2's agreement.

## User's asks (exact)
1. "start remote control and prepare for a session with another agent to directly fix the dsh openrouter api"
2. "claude is the agent its called dsh openrouter api key and the key is missing the goal is to not have to share that with potential extended machines we add to the pool in the future"
3. Exposure answer: "LAN + token (Recommended)"
4. "actually build out several models so we can have something ready for future when not in same room" / "make it selectable". Meaning: exposure modes (loopback / LAN / tunnel / SSH) that can be chosen by selection, for when machines are not in the same room.

## How the key spreads today (root cause)
`.sync/brain-sync.mjs` `syncDshCredentials` (lines 1635-1675) seals every `refs:` entry of `~/.dsh/.credentials.yaml`, OPENROUTER_API_KEY included, into the brain's `dsh-credentials.enc`. Any machine holding `brain-secrets.key` pulls the raw key. vMixer already has it.

## DONE (verified)
- `Harness Build/openrouter_proxy/relay.py` (new). Contents:
  - `TokenStore` holds per-machine SHA-256 digests in JSON `{"machines":{"<host>":{"sha256":..., "revoked":bool}}}`. It reloads on mtime or size change, and keeps the last good set if the file is broken.
  - Middleware: `/health` is open. Loopback is trusted unless `--no-trust-loopback`. Everything else needs `Authorization: Bearer <token>` or `x-api-key`, else 401.
  - Pass-through `/openrouter/v1/{path}` to `https://openrouter.ai/api/v1`, streamed, with the server key swapped in. Blocks `keys`, `auth`, `credits/coinbase`.
- `proxy.py`: `from . import relay` plus `relay.from_environment(app, effective_key)` after the app is created.
- `__main__.py`: `--tokens FILE` and `--no-trust-loopback`. It refuses (exit 2) to bind a non-loopback host unless the tokens file holds at least one token. It sets env OPENROUTER_RELAY_TOKENS and OPENROUTER_RELAY_TRUST_LOOPBACK.
- `openrouter_proxy/test_relay.py`: **17/17 PASS** (`.venv-proxy\Scripts\python.exe -W ignore -m openrouter_proxy.test_relay`, exit 0). Covers auth, loopback trust, pass-through key swap, no client-token leak, blocked paths, revoke without restart, broken-file safety and strict-loopback.
- Backups: `openrouter_proxy/proxy.py.pre-relay-20260918-0145`, `__main__.py.pre-relay-20260918-0145`, `~/.dsh/openrouter-control.ps1.pre-relay-20260918-0145`, and an original brain-sync.mjs copy in the session scratchpad.
- NOT restarted: the live proxy is still pid 26484 on 127.0.0.1:8080 running the OLD code. The relay code is untested live.
- `Harness Build` is not a git repo, so there is nothing to commit there. The brain has only note edits.

## Client-side facts found (no harness code change needed)
- Council seats `kimi`, `deepseek` and `openrouter-free` use transport `openrouter`. The key comes from `resolveOpenRouterKey({variable: config.apiKeyEnv})` (tool-council/src/credentials.ts, index.ts:976 and others), and `council.apiKeyEnv` is configurable (index.ts:429).
- Per-seat `council.seats.<id>.baseUrl` override exists (index.ts:111, :426). The openrouter-free default is `http://127.0.0.1:8080/v1/chat/completions` (seats.ts:290).
- llm-pi-ai honours `baseURL` on built-in providers (provider.ts:147 `spec.baseURL ?? base.baseUrl`).
- settings.yaml: provider `openrouter` has `apiKeyEnv: OPENROUTER_API_KEY` (line 6); provider `openrouter-free` has `baseURL http://127.0.0.1:8080/v1` (line 25) and `apiKeyEnv: OPENROUTER_API_KEY` (line 90); `agent-default-model` is openrouter `deepseek/deepseek-v4-pro`.
- The `yaml@2.9.0` package is in deepseek-harness `node_modules/.pnpm`. Use its Document API so settings.yaml comments survive.
- Not covered yet: web-search-cli `openRouterKeyEnv` (packages/web/web-search-cli/src/index.ts:172, :697) calls OpenRouter directly. Check whether it takes a base URL.

## Resume session progress (Claude Opus 5, local_434fba27, 2026-09-18)
- DONE TODO 3 (deny-list): `.sync/brain-sync.mjs` now has `export const LOCAL_ONLY_REFS` (OPENROUTER_API_KEY, OPENROUTER_RELAY_TOKEN), filtered from local refs, from the opened blob (dropped on next seal) and from sidecars; `sealCredentials`, `openCredentials`, `writeCredentialRefs` exported. `.sync/selftest.mjs` section 8 rewritten (shareable ref SEARCH_API_KEY carries the rotation test; new checks: never sealed, legacy blob key dropped). `node .sync/selftest.mjs` = **222/222 PASS**, exit 0. Pre-edit copy: session scratchpad `brain-sync.mjs.pre-denylist`. Uncommitted.
- WRITTEN, UNTESTED TODO 1: `.sync/openrouter-relay.mjs` (mode/issue/revoke/allow/list/status/publish/connect/disconnect; connect patches settings.yaml via yaml@2.9.0 Document API found in deepseek-harness node_modules/.pnpm, records prior values in ~/.dsh/openrouter-relay/connect-restore.json). Needs a scratch test (fake dshHome/brain/claudeHome, copy of real settings.yaml, check diff is only the 8 edited paths) before any real run.
- Live proxy: pid 26484 is a child of pid 7072, which matches `~/.dsh/openrouter-owned.json`, so the control script can stop it. Note: control `restart` exits early when healthy; a mode change needs a `reload` action that always stops the owned tree and restarts.
- vMixer peer: claudecode-78 at `bridge:session_016qU3zQyLoedeq7rBswc51V`. Wants relay URL, ndi2 LAN IP, token location (reference only).
- vMixer LAN IPv4 = 10.0.0.244 (Ethernet /24, gw 10.0.0.1, DHCP not static, so the allow-list needs updating if it changes; ignore 172.17.224.1 WSL and 172.17.176.1 Default Switch). At live step: `allow 10.0.0.244`. vMixer holds its key until connect + DSH probe pass.
- Live LAN bind (0.0.0.0:8080) was blocked by the auto-mode classifier ("Expose Local Services") and awaits explicit user approval.
- User 2026-09-18: "can you run this in background and handoff" - remaining TODOs handed to a background subagent from this session.
- **User APPROVED the live LAN bind** 2026-09-18 ~02:30: asked "Approve the LAN bind?", user answered "go". The next session may run mode lan + issue vmixer2o2 + allow 10.0.0.244 + control reload + live 401/200/403 checks without asking again. Firewall rule is still the user's own double-click.
- 02:30 scratch test ran (`node <scratchpad>/relay-test.mjs`, scratchpad = ~\AppData\Local\Temp\claude\C--Users-ndi2-Documents-claudecode\36bb3b46-1958-49eb-b75a-77aa1892cb54\scratchpad): **16/18 PASS**. FAIL `connect: only edited lines differ` (1492 changed) and FAIL `disconnect: settings.yaml byte-identical`. Cause: the yaml Document API round trip in `editSettings` does not keep the file byte for byte. Fix decided, not written: replace `loadYaml`/`editSettings` in `.sync/openrouter-relay.mjs` (lines ~215-265, and the doc callbacks in connect ~285 and disconnect) with a surgical line editor. For each settingsEdits path, walk the block mappings by indentation. Replace an existing leaf's value text in place. Insert a missing leaf directly under its parent header, at the child indent. Record the raw prior value text, or null when absent. Disconnect then writes the raw text back, or deletes the inserted line, so the file comes back byte-identical. Note that `openrouter-free` also appears under a second map near line 1394 (kinds), so every lookup must be scoped to its parent path. Rerun the scratch test until 18/18.

## 2026-09-18 ~09:30 update: Claude Opus 5, session local_e879d7e9 (Remote Control ON), host ndi2. Claimed; stopped at 152k-context FINISH
- User ask: "vmixer says its waiting on you to complete". vMixer (Claude Opus 5, local_f4e7f2e9, peer "Remote control seek agent update", bridge:session_01QMQnsg8hsc8RdCrT3hnGQg; the claudecode-78 / session_016q bridge is gone) waits ONLY for relay/openrouter-relay.json + relay/tokens/vmixer2o2.enc on brain origin, with ndi2 relay live on LAN 8080 (token-gated, 10.0.0.244 allowed, firewall rule on). Then it runs brain-sync, `connect --route lan`, a DSH probe, and removes its key only after the probe passes.
- NEXT ACTION step 1 DONE: `.sync/openrouter-relay.mjs` now edits settings.yaml line by line (`locate`/`setLeaf`/`restoreLeaf`, scoped to parent blocks; inserts missing leaves under their parent header; restore record stores the raw text after the colon, or null for an inserted leaf). The yaml package and `loadYaml`/`--harness` lookup are no longer used. Scratch test **20/20 PASS**, exit 0: `~\AppData\Local\Temp\claude\C--Users-ndi2-Documents-claudecode\56aa0bb3-3e22-464b-a8ab-5f79fa508160\scratchpad\relay-test.mjs`. The old "same line count" check was replaced by a multiset diff (3 replaced + 5 inserted leaves on the real settings.yaml: council.apiKeyEnv and the three seat baseUrl leaves do not exist yet), a YAML parse checking all 8 paths, and a parsed-equality check of everything else. Disconnect is byte-identical.
- Uncommitted brain change: `.sync/openrouter-relay.mjs`. Nothing live touched: proxy pid 26484 still on 127.0.0.1:8080, old code; no ~/.dsh/openrouter-relay/, no relay/ dir.
- Resume from NEXT ACTION step 2 (fold the 20-check test into selftest.mjs as section 12; selftest is 817 lines, summary at line 815).

## 2026-09-18 update: Claude Opus 5, session local_356eaeb6 (Remote Control ON), host ndi2. Claimed.
- Verified on claim: openrouter-relay.mjs (17313 B, 09:08) present; no relay/ dir, no ~/.dsh/openrouter-relay/; owned proxy pid 7072 per openrouter-owned.json. Brain auto-commits "brain: vmixlaptop2x6 session changes" already hold the .sync edits (git status clean).
- Agreed file split with peer "Handoff message restatement" (Claude Opus 5, local_2ddeb3b1, local-writer route): it owns deepseek-harness council src + queue-build.mjs + ~/.claude/CLAUDE.md; this session owns brain .sync/*, relay/*, ~/.dsh/openrouter-*, Harness Build/openrouter_proxy/*. Only the 8080 proxy gets restarted here, never DSH 3080.
- vMixer peer now "Remote control seek agent update" (local_f4e7f2e9).
- Step 2 DONE: selftest section 12 (21 relay checks on a synthetic settings.yaml with a decoy block, missing leaves, an inline comment, CRLF) -> `node .sync/selftest.mjs` **243/243 PASS**, exit 0.
- Step 3 DONE: ~/.dsh/openrouter-control.ps1 reads openrouter-relay/config.json (host, port, tokens, trustLoopback) and passes --host/--tokens/--no-trust-loopback; new `reload` action (stop owned tree, wait for port, start). Backup `openrouter-control.ps1.pre-reload-20260918`. Parser 0 errors. The classifier blocked the host-flag edit once; the user re-approved "Go" this session.
- Step 5 DONE (live): mode lan, issue vmixer2o2 (relay/tokens/vmixer2o2.enc), allow 10.0.0.244, `openrouter-control.ps1 reload` exit 0. The proxy now listens on 0.0.0.0:8080, owned pid 25428, child C:\Python314\python.exe 26740. ndi2 LAN IP is **10.0.0.241** (Wi-Fi, Public profile). Live check (scratchpad live-check.mjs, token opened in-process, never printed): **8/8 PASS**. no-token 401, wrong-token 401, token 200 on /v1/models and /openrouter/v1/models, /openrouter/v1/keys 403, x-api-key 200, loopback no-token 200.
- Step 4 PARTIAL: `relay/OpenRouter Relay.cmd` menu (status, mode + reload, issue, revoke, allow, connect, disconnect). Tested (status then exit, no hang after the empty-input fix) and copied to ~\Desktop (hash equal). `relay/relay-firewall.ps1` (elevates itself, -DryRun works) was written. The dry run plans an allow rule for TCP 8080 from 10.0.0.244 on program C:\Python314\python.exe, and disables the 2 inbound **Block** rules "Python" for C:\python314\python.exe. Those block rules currently stop vMixer. The `OpenRouter Relay Firewall.cmd` wrapper was BLOCKED by the classifier, so it is not written. The firewall step is the user's: run relay-firewall.ps1 elevated.
- Step 6 PARTIAL: vMixer peer "Remote control seek agent update" (bridge:session_01QMQnsg8hsc8RdCrT3hnGQg) was told the URL, results and the two open gates: (1) relay/ files must reach brain origin via gatekeeper push on the user's session-end cue, and (2) the firewall. It will not connect until both clear.
- NEXT: after the user runs the firewall step, test from vMixer (it curls http://10.0.0.241:8080/health, expects 200). After the gatekeeper push, vMixer runs brain-sync + `connect --route lan` + DSH probe, then drops its key. Rotating the OpenRouter key stays the user's call.
- Rollback: `node .sync/openrouter-relay.mjs mode loopback` then `openrouter-control.ps1 reload`.
- FINISH checkpoint (151k context), Claude Opus 5 local_356eaeb6. Brain at main...origin/main in sync (a gatekeeper push happened; vMixer, now session local_8e685080 at bridge:session_01EyzApCXj2kAeFt9YR7ZDXo "Handoff notes", has pulled relay/openrouter-relay.json and vmixer2o2.enc). The relay still listens on 0.0.0.0:8080 (pid 26740). No "DSH OpenRouter Relay" firewall rule exists, so relay-firewall.ps1 has not been run. vMixer confirms that TCP to 10.0.0.241:8080 fails while 8082 answers. vMixer is told to hold.
- EXACT NEXT ACTION for the next session: confirm the rule exists (`Get-NetFirewallRule -DisplayName 'DSH OpenRouter Relay'`) and that the Python Block rules are disabled. Ask vMixer to curl http://10.0.0.241:8080/health (expect 200) and /v1/models without a token (expect 401). Then send "gates clear" to vMixer's "Handoff notes" peer. vMixer then runs connect --route lan, the DSH probe, and drops its key.

## 2026-09-18 update: Claude Opus 5, session 2a108d2e (host ndi2). Claimed.
- Verified on claim: no 'DSH OpenRouter Relay' rule; both inbound Block rules 'Python' still enabled; 0.0.0.0:8080 listening, pid 26740; loopback /health 200; 10.0.0.241:8080/v1/models with no token returns 401 locally. relay-firewall.ps1 -DryRun plans: allow TCP 8080 from 10.0.0.244 on C:\Python314\python.exe, and disable the 2 Python block rules.
- Wrote `relay/OpenRouter Relay Firewall.cmd` (calls relay-firewall.ps1, which raises UAC itself). Copied it to ~\Desktop (hash equal). It was not run, because firewall changes belong to the user.
- NEXT: the user double-clicks Desktop `OpenRouter Relay Firewall.cmd`. Then run the line-74 checks and send "gates clear" to vMixer.
- DONE: the user ran the firewall one-click. Verified: rule 'DSH OpenRouter Relay' Allow, TCP 8080, from 10.0.0.244, program C:\Python314\python.exe, Profile Any; both Python Block rules Enabled=False. Remote Control is ON (session local_34a1db7e). Sent "gates clear" and the curl checks to vMixer peer "Handoff notes" [a4c8b2]; delivered, no reply yet.
- NEXT: vMixer replies with /health 200 and no-token /v1/models 401, then connect --route lan, the DSH probe, and dropping its key. After that, close this handoff. Rotating the OpenRouter key is the user's call.
- vMixer (local_8e685080) reported that the gates pass, but /openrouter/v1 returned a gzip body with no Content-Encoding header, so JSON parsing failed. It ran disconnect (settings.yaml restored) and kept its key.
- FIXED: relay.py passthrough now uses aiter_bytes() instead of aiter_raw(). Backups: relay.py.pre-gzip-20260918 and test_relay.py.pre-gzip-20260918. test_relay has a new gzip check and is 18/18 PASS. The new check fails against the old code (verified on a scratch copy). The proxy was reloaded, pid 22600. Live LAN check 7/7 PASS (scratchpad live-check-gzip.mjs; the paid models and chat responses parse). Sent "openrouter route fixed" to vMixer.
- User 2026-09-18, mid-turn: "update all the settings and keys to match thsi machine there". Scope unclear: copying ndi2's OPENROUTER_API_KEY to vMixer would undo this handoff's goal. Question asked; not acted on yet.
- RELAY GOAL DONE (vMixer local_8e685080 report): connect --route lan exit 0; free and paid probes 200 and parse; wrong token 401; DSH probe PASS for deepseek, kimi (socket probe only) and openrouter-free. OPENROUTER_API_KEY removed from vMixer's .credentials.yaml (1 line); re-probe PASS; DSH 3080 200. vMixer refs now: FCC_DSH_API_KEY, DEEPSEEK_API_KEY, OPENROUTER_RELAY_TOKEN. Left for the user: 3 ~/.dsh/.credentials.yaml.pre-* backups on vMixer still hold the key (deleting them is the user's call), and key rotation.
- User answer: "Settings + shareable keys". vMixer's DSH settings and shareable keys should mirror ndi2; OPENROUTER_API_KEY stays relay-only. Step 1: ndi2 fingerprint (scratchpad dsh-fingerprint.mjs, digests only; ndi2-fp-config.txt) sent to vMixer, asking for the differing paths, whether each key digest matches, and whether its FCC uses FCC_DSH_API_KEY. Awaiting reply. Then: send the non-secret differing blocks over the bridge. Any key whose value differs goes by a sealed brain blob, which needs a gatekeeper push.
- vMixer reply: FCC_DSH_API_KEY and DEEPSEEK_API_KEY digests MATCH, so no key work is needed. vMixer also deleted its 3 .credentials.yaml.pre-* backups with the user's go, so OPENROUTER_API_KEY is fully gone from vMixer. 3 non-relay blocks differ: council.seats.claude (vMixer enabled true, ndi2 false), council.swarmRoster (claude lacks an enabled line; openrouter-free is off with empty kinds), and agent-default-model (vMixer flash_lite, ndi2 gemini-flash). observedCliTokensPerWeek is a measured value and is kept. llama-local exists only on vMixer and is kept. Sent the 3 ndi2 blocks, verbatim, over the bridge with the target digests. Awaiting vMixer's apply, re-fingerprint, DSH 200 and seat probe.
- PARITY DONE (vMixer local_8e685080; the user approved there after a classifier block): the 3 digests now match ndi2 (seats.claude 56bf5d6c902c, swarmRoster ab39d98a6c5d, agent-default-model 4cb9d5fa94c9). Kept: observedCliTokensPerWeek, llama-local, relay token, relay edits. Backup ~/.dsh/settings.yaml.pre-parity-2026-09-18T17-27-37-211Z on vMixer. DSH 3080 200, not restarted. Seat probe after parity: openrouter-free PASS (800 ms); deepseek and kimi PASS (socket probe only).
- FINISH checkpoint at 150k context: Claude Opus 5, session local_34a1db7e, host ndi2, Remote Control ON. Relay goal and settings parity are COMPLETE. Nothing uncommitted in git. Harness Build is not a repo; the relay.py and test_relay.py edits are live, with .pre-gzip-20260918 backups. Relay proxy is pid 22600 on 0.0.0.0:8080. Scratch scripts are in the session scratchpad 2a108d2e: live-check-gzip.mjs and dsh-fingerprint.mjs.
- EXACT NEXT ACTION (optional follow-up): a later vMixer session re-runs dsh-fingerprint.mjs to confirm the 3 digests still match after DSH quota writes. If DSH overwrote them, re-apply them with DSH stopped. After that, close this handoff. OpenRouter key rotation is the user's call. Open: (1) re-fingerprint vMixer later, because a running DSH might overwrite the edits from memory; (2) OpenRouter key rotation is the user's call. vMixer is at its context limit; its note is handoff-2026-09-18-0133-dsh-openrouter-key.md.

## NEXT ACTION (exact, in order) - supersedes older ordering below
1. Replace editSettings with the surgical line editor described above, then run the scratch test until it passes 18/18.
2. Add it as selftest section 12 and run `node .sync/selftest.mjs` until every check passes (before this, 222/222).
3. Change openrouter-control.ps1: read config.json and pass --host, --tokens and --no-trust-loopback; add a `reload` action; leave `restart` unchanged. Back it up first.
4. Write the menu one-click `OpenRouter Relay.cmd` and the one-click `OpenRouter Relay Firewall.cmd`, which self-elevates. Put them in shared-brain/relay/ and ~\Desktop.
5. Run the live steps (user approved them): `mode lan`, `issue vmixer2o2`, `allow 10.0.0.244`, then `openrouter-control.ps1 reload`. Verify that `http://<ndi2 LAN IP>:8080/v1/models` returns 401 with no token and 200 with the token, that `/openrouter/v1/models` returns 200, and that `/openrouter/v1/keys` returns 403. Load the token inside the script and never print it. Check loopback without a token still returns 200. On failure, go back to `mode loopback` and reload.
6. Send vMixer (bridge:session_016qU3zQyLoedeq7rBswc51V) the relay URL, ndi2's LAN IP and the reference `shared-brain/relay/tokens/vmixer2o2.enc`. vMixer then pulls the brain, runs `connect --route lan`, runs the DSH probe, and only after that removes its key.
- Uncommitted brain changes: .sync/brain-sync.mjs, .sync/selftest.mjs, .sync/openrouter-relay.mjs (new), notes. No commit authorised yet; no push.
- Processes: live proxy pid 7072 -> 26484 on 127.0.0.1:8080, old code, untouched.
- 2026-09-18 02:27 Claude Opus 5 (subagent of local_434fba27): STOPPED at 99% session quota (resets 04:50) by the quota-handoff hook, before running anything. Read openrouter-relay.mjs and the brain-sync.mjs exports (findBrainKey, openCredentials, sealCredentials, writeCredentialRefs are all exported). WROTE, NOT RUN: scratch test `~\AppData\Local\Temp\claude\C--Users-ndi2-Documents-claudecode\36bb3b46-1958-49eb-b75a-77aa1892cb54\scratchpad\relay-test.mjs`. It uses fake dshHome/brain/claudeHome in the OS tmpdir, a copy of the real settings.yaml, dummy creds and key `5a`x32. It checks mode lan/ssh, issue (seal + sha256), revoke, list, allow, publish, connect (diff <= 8 lines), reconnect over tunnel, and disconnect (byte-identical). No file was edited: openrouter-relay.mjs, selftest.mjs and openrouter-control.ps1 are unchanged. No relay/ dir or Desktop .cmd exists, and nothing live was touched. Risk to check first: `doc.toString({lineWidth:0})` may reformat unrelated lines in the 85 KB settings.yaml. If the diff check fails, switch connect/disconnect to a surgical line edit.
- Resume subagent task (unchanged):
  1. Run the scratch test (`node <scratchpad>\relay-test.mjs`), fix relay bugs, fold the test into selftest.mjs as section 12, then run `node .sync/selftest.mjs` and require all PASS (was 222/222).
  2. openrouter-control.ps1: read config.json and pass --host/--tokens/--no-trust-loopback, and add a `reload` action. Back up first; verify only with a parser check plus `status`.
  3. Write relay\`OpenRouter Relay.cmd` (menu) and `OpenRouter Relay Firewall.cmd` (self-elevating, do not run). Copy both to ~\Desktop, which is the real Desktop; there is no OneDrive Desktop.
  4. Update this note, the index line and the log.
  - Never run start/stop/restart/reload, never bind non-loopback, never run `mode lan` on the real ~/.dsh, never touch the firewall, no commit or push, never print token values.

## TODO (exact next actions, in order)
1. **Mode and token tool** `shared-brain/.sync/openrouter-relay.mjs`. It lives in the brain so every machine has it.
   - Server commands:
     - `mode <loopback|lan|tunnel|ssh>` writes `~/.dsh/openrouter-relay/config.json` `{mode, port:8080}`. Host is 127.0.0.1 for loopback and ssh, 0.0.0.0 for lan and tunnel.
     - `issue <host>` creates a 32-byte token, stores its digest in `~/.dsh/openrouter-relay/tokens.json`, and seals the token to `shared-brain/relay/tokens/<host>.enc` with the brain key. This needs `export` added to `sealCredentials`/`openCredentials` in brain-sync.mjs.
     - `revoke <host>`, `list`, `status`.
     - Publish non-secret `shared-brain/relay/openrouter-relay.json`: `{keyHolder:"vmixlaptop2x6", port, mode, routes:{lan:"http://<LAN IPv4>:8080", tunnel:"http://<100.x Tailscale IP>:8080", ssh:"http://127.0.0.1:18080 via ssh -L"}}`.
   - Client commands:
     - `connect [--route lan|tunnel|ssh]` opens own `relay/tokens/<host>.enc` and writes `OPENROUTER_RELAY_TOKEN` into local `.credentials.yaml`. It then patches settings.yaml:
       - `llm-pi-ai.providers.openrouter` gets `baseURL <route>/openrouter/v1` and `apiKeyEnv OPENROUTER_RELAY_TOKEN`.
       - `openrouter-free` gets `baseURL <route>/v1` and `apiKeyEnv OPENROUTER_RELAY_TOKEN`.
       - `council.apiKeyEnv` becomes `OPENROUTER_RELAY_TOKEN`.
       - `council.seats.openrouter-free.baseUrl` becomes `<route>/v1/chat/completions`.
       - `council.seats.{deepseek,kimi}.baseUrl` becomes `<route>/openrouter/v1/chat/completions`.
       - Back up first.
     - `disconnect` restores.
     - "Selectable": the route switches with one argument. Add Desktop `OpenRouter Relay.cmd`, a numbered menu for mode, issue, revoke and connect.
2. **openrouter-control.ps1**: read `config.json` for host and mode; pass `--host`, `--tokens`, and `--no-trust-loopback` in ssh mode. Keep 127.0.0.1 in `Test-Ready`.
3. **brain-sync deny-list**: in `syncDshCredentials`, never seal or pull `OPENROUTER_API_KEY` or `OPENROUTER_RELAY_TOKEN`, and drop them from the blob on the next seal. Update selftest.mjs:522-543, which currently asserts the key travels. Run `node .sync/selftest.mjs`.
4. **Firewall**: this is a security setting, so the user runs it. Ship a one-click elevated `.cmd` that adds an inbound rule for TCP 8080, scoped to the LAN subnet (lan mode) or 100.64.0.0/10 (tunnel mode). The Python venv exe may already have a rule; check with `Get-NetFirewallApplicationFilter`.
5. **Live test**: switch to lan mode, then `issue vmixer2o2`, then restart the proxy via the control script. From ndi2, curl the LAN IP with no token and expect 401; with the token expect 200 on `/v1/models` and `/openrouter/v1/models`. Then tell the collaborator the relay URL and that the token is at `shared-brain/relay/tokens/vmixer2o2.enc`, then ask it to run `connect --route lan` and verify a council seat. Only after that, remove the key from vMixer and consider rotating the OpenRouter key, which is the user's call.

## Permissions and blocks
- The auto-mode classifier blocks reading or printing credential values ("Credential Materialization"). Do not print tokens or keys. Scripts must handle them internally.
- Firewall changes are for the user only.
- No push. Commit the brain `.sync` changes only if the user authorises it.

## Do not repeat
- Do not copy openrouter-control.ps1 to vMixer to run a key-holding proxy there.
- Do not print credential file values.
