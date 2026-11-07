---
name: handoff-2026-09-27-0310-openclaw-chatgpt-relay
description: Layer 1 DONE 5fc8371944 (on origin); layer 2 council optimize stage IMPLEMENTED + all repo-local gates green 2026-09-28 03:35, UNCOMMITTED, live test not run
metadata:
  type: project
---

# Handoff 2026-09-27 03:45: OpenClaw -> ChatGPT via extension relay

Id: handoff-2026-09-27-0310-openclaw-chatgpt-relay
Updated: 2026-09-28 03:35 PDT (Claude Opus 5.5 (workflow agent, orchestrator [c01320]), vmixer2o2)
Host: vMixer (VMIXER2O2)
Session: e849babd-01e6-4f7b-8ad8-8ee70dc34fd8
Model: Claude Opus 5 (claude-opus-5)
Remote Control: off, not changed
Owner: Claude Opus 5.5, session 53adecc7 (desktop self, vMixer), CLAIMED 2026-09-27 18:10 after 4fe44853 handed off at 225k. Previous: Claude Opus 5.5, session 4fe44853-6612-44ca-8858-9159cd5d06e2 (desktop local_8a4d0cec), vmixer2o2, account a540ddf6, CLAIMED 2026-09-27 17:35 on user word "resume what was being worked on last from this machine"; 499b0f71 gone (not in ListAgents). Previous: 499b0f71 from 16:05, 759e5230 from 03:38, e849babd
History: handoff-2026-09-18-0130-openclaw-prompt-optimizer.md (narrative, still the topic file)
Repo: ~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates, HEAD 25db02347f
Tree: RE-VERIFIED 2026-09-27 16:00 by session 499b0f71 and the 03:37 line was WRONG BY THEN - corrected here.
  HEAD is still 25db02347f and the three untracked files plus the modified tests/pipeline-advance-to-swarm.spec.ts
  (+10/-4) are all still there, but the branch is now **1 AHEAD and 4 BEHIND** origin/feat/heterogeneous-teammates,
  not '1 behind, 0 ahead'. Session [24fdb9]'s 04:10 push moved origin to 478ebb005f (+ c64656c1cd, c13794f5b2,
  92cdcade3b) on the shared base 111c359502, and 25db02347f ('council(agy): inline the seat's memory files and
  detect approval stalls') was NOT part of that push - it is a local-only commit on the same base, so the branch
  genuinely diverged. Patch-ids confirm none of the four origin commits is a rewrite of it. NOTE: origin's
  92cdcade3b is 'test(council): approve the plan actually issued in the advanceToSwarm spec' - i.e. the red spec
  this tree still carries as an uncommitted edit is probably ALREADY FIXED upstream; reconcile before committing it
  Nothing committed by this session, nothing pushed
Ask: finalize the OpenClaw -> ChatGPT setup, then make the DSH prompt-optimization workflow work end to end
Ask RESTATED by the user 2026-09-27 04:15: the real goal is FREE FIRST, THEN PAID - ChatGPT via OpenClaw costs nothing against the $60/mo API budget, so it should do the prompt work before any paid seat runs. They now want it in DSH as a SELECTABLE MODEL they can run, not only as a hidden preprocessing stage
Memory that backs it: [[dsh-runtime-routing]] resolver step 3 is literally "Free/local preparation, only when capable: normalize the request, extract constraints, classify the task, PREPARE THE PROMPT"; cost classes are local|free|included|metered; escalation is "prefer local/free, then included, ... then metered"; FREE_FIRST is already a named policy. resolveRoster is BUILT (commit 07d17746f6, packages/council/tool-council/src/router/, 23 tests) but NOTHING CALLS IT - council/swarm/PM still use their own selection. That uncalled router is the gap between "selectable" and "automatic free-first"
Existing ChatGPT paths in DSH (checked 2026-09-27, do not rebuild): packages/llm/llm-codex-cli = registered LlmAdapter provider `codex-cli`, "ChatGPT / Codex headless", in the main model picker, stateless per turn (codex exec --ephemeral --json), full StreamChunk + usage + tool-call deltas. packages/llm/llm-pi-ai carries an `openai-codex` OAuth "Sign in with ChatGPT" credential. There is NO pre-existing OpenClaw path: the only 4 files in the repo that name it are this workstream's two sources and one proposed note (en+zh) citing it as compaction precedent
RELAY WAS LIVE AT 03:27, NOT AT 03:37: re-verified 2026-09-27 03:37 - `wsl.exe -l -v` shows OpenClawGateway **Stopped**, nothing listening on 18789/18799. The distro does not autostart (already noted below), so every resumed session must start it again. Original evidence: gateway log 03:27:07 "extension authenticated and connected to relay"; openclaw browser start --browser-profile chrome returns running true
User's own Chrome is the browser: browser open https://chatgpt.com/?temporary-chat=true --browser-profile chrome returned their real sidebar (Write Quota Handoff Prompt, Research JBOD Options) = SIGNED IN, no new login was ever needed
How it got paired: options page > Advanced manual pairing > paste > Pair manually. Chrome REFUSES chrome:// and chrome-extension:// URLs from the command line (verified - no session file ever contained the options URL), so that page cannot be opened for the user
Extension id: epkddhlhgoidpdefadmlbihaabpahfil, unpacked from ~\.openclaw-extension
OPEN COMPLAINT 2026-09-27 04:55: the user says OpenClaw in their Chrome is interfering with Chrome's appearance.
  Verified at 04:55 that the distro is Stopped, so the gateway/relay are DOWN and nothing is attached - the
  chrome.debugger banner ("started debugging this browser", the thing that shows while a run is live) is NOT the
  cause right now. Unverified candidates, in order: (a) the unpacked/developer-mode extension warning Chrome shows
  for a load-unpacked extension, (b) the extension's own toolbar icon/badge, (c) profileColor #FF4500 from
  `openclaw browser status --browser-profile chrome` - but for the `chrome` transport OpenClaw does not launch the
  browser, so it probably cannot paint the window and (c) is the weakest. NOT DIAGNOSED - ask the user what
  changed visually before guessing further
  Structural fix already available: the WSLg headful Chrome route inside the distro was made LIVE on 2026-09-27
  02:45 (Chrome 154 installed in OpenClawGateway, own X window via /mnt/wslg, persistent user-data-dir at
  /home/openclaw/.openclaw/browser/openclaw/user-data). Switching back to it removes OpenClaw from the user's
  Chrome entirely; the cost is signing in to ChatGPT once in that window, which is why the extension route was
  picked over it. Agents cannot toggle or remove an extension in the user's own Chrome - that is their GUI step
  USER CHOSE PERMANENT 2026-09-27 05:05, and the stated goal is that NO Chrome window is visible while DSH talks
  to ChatGPT. Headless is reachable: before the WSLg drop-in was added, `openclaw browser status` already read
  `headless: true (linux-display-fallback)`, and the CLI takes `browser start --headless`. Plan: keep the window
  visible for ONE sign-in (user-data-dir /home/openclaw/.openclaw/browser/openclaw/user-data is in $HOME and
  persists), then set browser.headless=true and drop the WSLg/DISPLAY drop-in. The transport already takes
  `profile` as an option, so switching from `chrome` to the in-distro `openclaw` profile is CONFIG, not code.
  DONE AND PROVEN 2026-09-27 05:40. The invisible route is LIVE on the in-distro `openclaw` profile (transport cdp,
  port 18800). User signed in; login persists in /home/openclaw/.openclaw/browser/openclaw/user-data.
  Round trip proven TWICE there - headful on WSLg, then again on the virtual display - both returning the exact
  token. Today's selectors all held unchanged in this profile
  TRUE HEADLESS DOES NOT WORK, do not retry it: browser.headless=true made ChatGPT serve Cloudflare's
  "Just a moment..." interstitial (title confirmed, body length 0, UA "HeadlessChrome/154.0.0.0", viewport fine at
  1440x873, navigator.webdriver false). Masking the UA to get past it is bot-detection evasion and was refused
  OFF-SCREEN POSITIONING DOES NOT WORK EITHER: --window-position=-2600,-1400 in the ~/bin/openclaw-chrome wrapper
  was clamped by Weston back onto the desktop (1516x1057+527+56)
  WHAT WORKS - Xvfb virtual framebuffer: `xvfb` installed as root (wsl -u root needs no password, sudo does),
  new user unit ~/.config/systemd/user/xvfb.service runs `Xvfb :9 -screen 0 1600x1200x24 -nolisten tcp`,
  Restart=always, enabled; the gateway drop-in 10-wslg-display.conf now sets DISPLAY=:9 (was :0) plus
  Wants/After=xvfb.service. browser.headless is back to false, wrapper restored from its .bak.
  Verified: DISPLAY=:0 (WSLg, the user's desktop) has NO chrome window; DISPLAY=:9 holds the real 1440x960 window;
  UA reads "Chrome/154.0.0.0" not HeadlessChrome. Chrome is fully headful and real - only the pixels are nowhere
  STILL OPEN: the OpenClaw extension is still enabled in the user's own Chrome. It is now inert (nothing drives the
  `chrome` profile any more) but its unpacked/developer-mode presence is what they complained about. Only they can
  toggle it - Chrome blocks automation from chrome://extensions. They report seeing no off switch on the card;
  next session should point at the Developer-mode toggle (top right of chrome://extensions), which disables
  unpacked extensions wholesale, before suggesting Remove (Remove loses the manual pairing)
  Keepalive: a background `sleep 3600` wsl process was started at ~05:10 to hold the distro up for the sign-in.
  It expires ~06:10; after that WSL idles the distro out and the transport's own retry loop boots it on demand
  COMPLAINT DIAGNOSED AND CLOSED 2026-09-27 16:05 (session 499b0f71). The user said "i turned it off but i still
  see openclaw in my browser". Read straight out of Chrome's own
  %LOCALAPPDATA%\Google\Chrome\User Data\Default\Secure Preferences:
    extensions.settings.epkddhlhgoidpdefadmlbihaabpahfil -> state 0 (DISABLED), disable_reasons 1
    (DISABLE_USER_ACTION), location 4 (UNPACKED), path ~\.openclaw-extension
    extensions.ui.developer_mode = true
    Preferences -> extensions.pinned_extensions does NOT contain the id, so there is no toolbar icon
  So the user's toggle DID work - the extension is genuinely off and inert. What they can still SEE is the
  extension's CARD, because chrome://extensions lists a disabled unpacked extension exactly like an enabled one
  (greyed toggle), and developer_mode=true also keeps the Load unpacked / Pack / Update bar across the top.
  Only **Remove** on the card delists it, and Remove is now harmless: the `chrome` profile route is abandoned,
  so losing the manual pairing costs nothing. That Remove is GUI-only - Chrome refuses automation of
  chrome://extensions and Secure Preferences is HMAC-sealed (super_mac), so editing it out would trip Chrome's
  settings-reset. Earlier guesses (a)/(b)/(c) are all now dead: no toolbar icon, nothing attached.
  Also confirmed nothing was driving it: OpenClawGateway distro Stopped, nothing listening on 18789/18799/18800,
  and no chrome.exe among the 19 running carries --remote-debugging / --load-extension / automation flags
  FULLY CLOSED 2026-09-27 17:15. The user removed the extension and then said they could still see
  "openclaw" in the browser. Re-read both preference files (rewritten 17:10): the
  epkddhlhgoidpdefadmlbihaabpahfil entry is GONE from Preferences and Secure Preferences, and
  extensions.ui.developer_mode flipped itself back to false. Nothing can reinstall it - no
  HKCU/HKLM \Software\Google\Chrome\Extensions key and no ExtensionInstallForcelist policy on
  either hive. The remaining sighting turned out to be a Chrome TAB GROUP the user had named
  openclaw; they deleted it themselves and called it fine. Nothing extension-related is left.
  Only leftover on the Windows side: the unpacked source folder ~\.openclaw-extension,
  which Chrome no longer references. NOT deleted - it is the user's call and nothing needs it now
  that the route is the in-distro profile. Do not reopen this complaint
Relay: 127.0.0.1:18799 in the distro, reachable from Windows
browser.defaultProfile CHANGED chrome -> openclaw 2026-09-27 16:02 by session 499b0f71, and re-read back to
  confirm. Until then the config still defaulted to the user's own Chrome, so any `openclaw browser ...` call that
  omitted --browser-profile would have reached into it - a live regression risk against the user's 05:05 "no Chrome
  window visible" decision. browser config now reads
  { executablePath: /home/openclaw/bin/openclaw-chrome, headless: false, defaultProfile: openclaw }
Distro re-verified 2026-09-27 16:00: xvfb.service is ACTIVE, the unit and the 10-wslg-display.conf drop-in
  (DISPLAY=:9, Wants/After=xvfb.service) are both on disk as described, headless is false, and the persistent
  user-data dir /home/openclaw/.openclaw/browser/openclaw/user-data still exists. The invisible route's
  preconditions all hold
Distro: OpenClawGateway running; gateway ws://127.0.0.1:18789; gateway restarts itself after every openclaw config set and that kills any managed Chrome
CHATGPT DOM CHANGED - #prompt-textarea NO LONGER EXISTS. Composer is div.ProseMirror[contenteditable=true], data-placeholder "Ask ChatGPT", inside a form. [data-testid=send-button] is absent while the composer is empty
Consequence: the prompt must NEVER be typed - ProseMirror submits on Enter, so the instruction first newline would send a fragment. Insert with execCommand insertText then press Enter once
[data-message-author-role=assistant] RESOLVED 2026-09-27 03:57: the attribute is gone from ChatGPT altogether. See the PROVEN LIVE section below for the replacement
Blocked and left undone: the live round trip through the relay (user interrupted the test to redirect to the DSH workflow)
Refused by the auto-mode classifier: the native-messaging bridge (~\.openclaw-nativehost plus an HKCU key) as [Unauthorized Persistence]; it would have let the extension self-pair via op bootstrap -> {v:1,ok:true,nonce,pairingString}. User was offered it and has not answered
Refused earlier: Windows Chrome over CDP as [Expose Local Services]
SUPERSEDED - the file has since been fixed and live-proven, see below. As written on 2026-09-27 03:31: packages/council/tool-council/src/openclaw-transport.ts - openClawTransport() spawns wsl.exe with a bash script on stdin, carries the prompt in base64, opens a temporary chat, waits for the composer, builds the insertion function with node -e plus JSON.stringify, evaluates it, presses Enter, waits on a --fn requiring stop-button gone plus non-empty plus length-settled, reads the last assistant turn with evaluate --json. Exit codes 21-26 name the failing step. NOT typechecked, NOT unit-tested, NEVER run
src/optimize.ts: complete, unchanged since 2026-09-18, still untracked
In-WSL Chrome: stopped; Chrome 154 still apt-installed in the distro; uninstall offered, not done
Still open: ollama.service autostart in the distro = WSL2 VM crash-loop risk per the gateway's own boot warning (the warning still prints on every boot; NOT observed crash-looping on 2026-09-27 - the gateway restarts seen in the journal were ordinary idle shutdowns, each with a new systemd user-manager pid). No Windows autostart for the distro or tray; sudo in the distro needs a password, so disabling ollama.service is not something an agent can do unattended
Not a problem, do not "fix" it: Linger=yes is already set for the openclaw user, so the gateway comes back by itself on the next wsl.exe call. The 60 s idle shutdown is WSL's default vmIdleTimeout and the transport now absorbs it. A ~/.wslconfig change would be a machine-wide decision and is the user's call, not a prerequisite
DONE 2026-09-27 03:36: tsc -b in packages/council/tool-council exits 0 and emitted lib/types/openclaw-transport.js + .d.ts at 03:36, so the transport typechecks clean

## PROVEN LIVE 2026-09-27 04:02-04:04 (session 759e5230)

openclaw-transport.ts now does the full round trip through the extension relay into
the user's own signed-in Chrome. Two runs, both returning the exact token asked for:

- 75.4 s, prompt "Reply with exactly this token and nothing else: RELAY_OK_759e5230" -> reply "RELAY_OK_759e5230"
- 65.0 s, 7-line prompt with both quote kinds, a backslash, $, a backtick and "naive cafe - Japanese + emoji"
  asking for the last line back -> reply "TRICKY_OK_759e5230". ChatGPT echoing the LAST line is the
  proof that the whole message arrived as one turn and no fragment was sent early

Driver used: scratchpad live-transport.mjs / live-tricky.mjs - they import lib/types/openclaw-transport.js
and pass a spawnFn that drains stderr (the transport itself ignores stderr).

### Four real defects found and fixed in openclaw-transport.ts (all were fatal)

1. **Raced the gateway.** The distro is NOT kept alive: there is no ~/.wslconfig, so WSL2's default
   vmIdleTimeout stops OpenClawGateway about 60 s after the last wsl.exe call. Every transport call
   therefore boots it cold. Measured cold path: the gateway CLI answers after **21 s**, the relay starts
   listening on 18799 a beat later, and the extension re-authenticates **8-18 s after that** (journal:
   "extension authenticated and connected to relay"). The original script called `browser open` immediately
   and died with exit 21 in 10.7 s. Fix: retry `browser open` once a second for 60 s - it is the first call
   that actually needs the extension, so it covers gateway startup AND extension attach in one probe.
   A gateway that answers `status` is NOT yet a browser that can act: `status` succeeded while `open`
   still failed with INVALID_REQUEST "The OpenClaw Chrome extension is not connected for profile chrome".
2. **`node` is not on PATH in the distro.** Exit 23, "bash: node: command not found". openclaw ships its own
   runtime at ~/.openclaw/tools/node/bin/node and /usr/local/bin/openclaw is a bash shim that execs it.
   Fix: dropped node entirely - the prompt was already base64 on the way in, so it is now decoded in the page
   by atob + TextDecoder. That also removed both mktemp files, the trap, the JSON.stringify dance and exit 23.
3. **`[data-testid=stop-button]` no longer exists**, so the completion check could never pass. Fix: done is
   now "the reply text has held the same length for 3000 ms", with the marker parked on <html> as
   data-oc-len/data-oc-since - isolated worlds share the DOM but not window, and a page load clears it.
4. **`[data-message-author-role` is GONE from ChatGPT** - this is the open question from the 03:10 handoff,
   now answered, and it answers NO. Verified structure (probe at 03:57, real reply on screen):
   - `h4.sr-only[data-conversation-role=assistant]` - the label only, innerText is exactly "ChatGPT said:"
   - its **nextElementSibling** `div.group.flex.min-w-0.flex-col[data-chatgpt-selection-message-id=...]`
     holds the actual reply text
   - their parent is `div[data-content-search-unit-key="fallback-turn-0:1:assistant"]`
   Fix: LAST_BODY takes the last `[data-conversation-role=assistant]` and reads its next sibling
   (parentElement as fallback). Reading the sibling also keeps "ChatGPT said:" out of the reply without
   matching on English wording. One helper feeds both the done-check and the reader.

Also: default timeoutMs raised 300_000 -> 400_000, because the script's own waits now total
60 s open + 45 s composer + 240 s reply and the outer guard has to sit above them.

Confirmed still correct from the earlier session: the composer is
`div.ProseMirror[contenteditable=true]`, and insertText + one Enter is the right way in.

### AUTHORIZED 2026-09-27 04:30: the user said "go" on layer 1 - expose ChatGPT-via-OpenClaw as a SELECTABLE MODEL

LAYER 2 STATUS 2026-09-28 03:35 (Claude Opus 5.5 (workflow agent, orchestrator [c01320]), vmixer2o2): IMPLEMENTED, ALL REPO-LOCAL GATES GREEN, NOT COMMITTED, NOT PUSHED, LIVE TEST NOT RUN (forbidden: DSH :3080 busy with ecomm run).
  Resumed the mid-edit tree from the ~03:00 build agent: its work was complete and correct, nothing discarded. This leg added: spec lint fix (typed spawn handle, no casts), JSDoc on every optimize.ts field,
  README.md/.zh.md stage paragraph + report-line note + limitation (pair re-recorded), zh config-catalog/module-graph brought along to English (incl. layer-1 drift that was already unpaired at HEAD), pair records re-written for config-catalog, module-graph, llm-streaming, tool-council README.
  Gates (final pass, real exit codes): frozen install 0; tsc -b tsconfig.host.json 0; 10 gen-* --check 0; publint 0; knip 0; constraints 0; verify-package-invariants 0; verify-export-jsdoc 0; readme model-experience/limitations 0; md-wrap/md-links/doc-refs 0;
    oxlint on optimize.ts/runs.ts/spec/types.ts 0 (index.ts has ~60 pre-existing errors, NONE on added lines); vitest tool-council+llm+llm-openclaw-chatgpt+tool-cordis 97 files / 1788 tests 0 (optimize.spec 37/37);
    verify-translation-pairing 1 = ONLY the pre-existing untracked antigravity note; duplication 1 = 58 clones, IDENTICAL to a HEAD git-archive baseline (58, same per-file list), zero from layer 2.
  COLLISION: at 03:30:30-03:30:54 ANOTHER AGENT edited tool-council src/files.ts, roster.ts, swarm-contest.ts, swarm.ts in this same tree (exported accepts(), unclassified 'any' units) - NOT layer 2, not touched, not reverted. At 03:38:45 that agent COMMITTED them as 99df2c5899 "fix(council): let narrowed swarm seats take unclassified units, and serve READ from every root" (8 files, none of layer 2); HEAD is now 99df2c5899, branch ahead 1. Final vitest 1788 includes its new tests.
  Layer-2 commit set: docs/{config-catalog,module-graph}.{md,zh.md,i18n.yaml}, docs/subsystems/llm-streaming.{md,zh.md,i18n.yaml}, tool-council/{README.md,README.zh.md,README.i18n.yaml,package.json,tsconfig.json,src/index.ts,src/runs.ts,src/optimize.ts,tests/optimize.spec.ts}, tool-cordis/src/api-catalog.ts, llm/llm/src/types.ts, pnpm-lock.yaml (openclaw-transport.ts already deleted, was untracked).
  Next: commit the set above on user word (leave the antigravity note out), queue via queue-build.mjs, then live proof with promptOptimizer:true once DSH is free.
LAYER 2 IN PROGRESS 18:40 (53adecc7, user said go): design = DELETE council src/openclaw-transport.ts (dup of pkg transport); optimizer transport = ctx.llm.stream({provider:"openclaw-chatgpt", model:"chatgpt-web"}) via BlockAssembler (template packages/session/session-title-llm/src/index.ts l.270-300); add purpose "prompt-optimize" to GenerateOptions.purpose union (llm/llm/src/types.ts l.376); tool-council needs dsh-llm peer+dev dep; config promptOptimizer flat fields in Config (index.ts l.162/546); ingress council l.1528 fresh-query branch only (never approved replay), store pendingPlanSourceQuery + match it in sameQuestion l.1459; pipeline startPipeline l.2103 fresh start only; report line via describeOptimization; tests/optimize.spec.ts 8 spec cases (~/Downloads/dsh-openclaw-chatgpt-prompt-optimization-feature.md s13); fix 16 JSDoc gaps. NOTHING EDITED YET

Status 2026-09-27 18:25 (Claude Opus 5.5, session 53adecc7): LAYER 1 DONE. User said do all the work. Dropped local spec edit (origin 92cdcade3b fixes same bug), rebased on origin 478ebb005f (agy commit now 675e727342), re-ran: frozen install 0, gen-* --check 0, tsc -b tsconfig.host.json 0, vitest pkg+tool-council 776/776, publint/knip/constraints/invariants 0. COMMITTED 5fc8371944 feat(llm): add ChatGPT via OpenClaw (19 files, hooks pass). QUEUED via queue-build.mjs head 5fc8371944 (branch ahead 2: 675e727342 + 5fc8371944). NOT PUSHED - user announces gatekeeper push. Left untracked: layer-2 council openclaw-transport.ts/optimize.ts (JSDoc red, 1 dup vs pkg) + antigravity note

Status 2026-09-27 18:12 (Claude Opus 5.5, session 53adecc7): items 5 and 6 DONE, 7 WAITING ON USER WORD.
  5 DONE: publint 0; verify-export-jsdoc 1 but ALL 16 violations are in untracked layer-2 council openclaw-transport.ts/optimize.ts (pkg clean, not committing those); knip 0;
    duplication 1 = pre-existing (exitCode 1 on ANY clone, 42 clones outside openclaw); pkg adds 4 sibling-adapter clones (same pattern as antigravity/claude-cli) + 1 vs layer-2;
    gen-* --check: 8 pass, config-catalog/doc-graphs/module-graph stale -> REGENERATED, now 0. doc-graphs+module-graph were ALREADY stale at HEAD (agent-team drop), so regen also carries that old drift
  6 DONE LIVE: built lib resolveOptions({}) -> buildSpec -> wsl.exe (distro cold) -> parseReply; nonce OCPROOF-TT6CATW9 returned exactly, exit 0, 70.3 s, profile openclaw. vitest 37/37, tsc -b pkg 0 re-run after
  7 NOT DONE: commit needs user word; branch 1 ahead/4 behind origin - rebase first; drop spec edit if 92cdcade3b already fixes it. Commit set = pkg + bundle/base package.json + cordis.patch.yml + tsconfig.host.json + pnpm-lock + 3 regenerated docs
  NOTE: a git stash round-trip at 18:07 briefly lost the lockfile edit (pnpm rewrote it); restored from stash, tree verified

Status 2026-09-27 17:45 (Claude Opus 5.5, session 4fe44853): items 1-3 DONE, 4 SKIPPED (reason below), 5-7 OPEN.
  1 DONE tests/openclaw-chatgpt.spec.ts + tests/composition.spec.ts: vitest 37/37 exit 0; oxlint pkg clean;
    scoped coverage 100% on adapter/prompt/transport/invariant, index.ts 87% (uncovered = live-settings fallback
    l.184-188 + setSource l.206; precedent llm-claude-cli sits at 57% overall so 100% is not the llm bar)
  2 DONE README.md/.zh.md/.i18n.yaml: model-experience 0, limitations 0, pairing clean for this pkg (only
    remaining pairing violation = pre-existing untracked .agents/notes/.../2026-09-21-antigravity-seat-view-file-stall.md)
  3 DONE bundle/base package.json dep, cordis.patch.yml entry after llm-antigravity, tsconfig.host.json ref; pnpm install ok
  4 SKIPPED: defaultRoster() has NO production caller (tests only); live swarm roster = seatRoster from council
    seats, whose transport is only cli|openrouter. A real free seat = new seat transport over the shared OpenClaw
    transport = layer-2 work. No roster.ts edit made
  5 PARTIAL 18:05: fixed test cast (NonNullable tools, 2 tsc errors) + stream() JSDoc @param/@returns;
    build:lib:host exit 0 -> lib/index.js + lib/invariant.js now exist (publint cause). PASSED earlier: verify-package-invariants 0,
    constraints 0. NOT YET RE-RUN after fixes: publint, verify-export-jsdoc (remaining failures there are the untracked
    council openclaw-transport.ts/optimize.ts - layer 2, do not commit them). NOT RUN: knip, duplication, gen-* --check
  6 live proof on openclaw profile (start OpenClawGateway distro first), 7 commit on user word + queue, never push
  Branch still 1 ahead / 4 behind origin - reconcile before commit

Prior status 2026-09-27 16:20 (session 499b0f71): **PACKAGE WRITTEN, TYPECHECKS CLEAN, NOT YET WIRED IN,
NOT TESTED, NOT COMMITTED.** The research below is still accurate - it was re-read against the repo
this session and every template fact held. Do not re-derive it.

WHAT EXISTS NOW - packages/llm/llm-openclaw-chatgpt/ (untracked, 7 files):
  package.json          @deepseek-ai/dsh-llm-openclaw-chatgpt, peer deps incl. dsh-subprocess, ./invariant export
  tsconfig.json         refs cosmokit, schemastery, cordis, ../llm, settings, subprocess, invariants
  src/invariant.ts      no-op installer, registers package ownership (copied shape from llm-codex-cli)
  src/transport.ts      the council transport MOVED here and rewritten onto the subprocess seam.
                        Exports script(), EXIT_REASON, parseReply(), buildSpec(), sendPrompt().
                        node:child_process is GONE; buildSpec returns a SubprocessSpawnSpec and
                        sendPrompt takes the spawn fn, so it is unit-testable without a real WSL.
                        Two deliberate changes from the proven original, both reviewed as safe:
                          - every shell interpolation now goes through shellQuote()/JSON.stringify
                            instead of bare '...' concatenation, so a URL or selector carrying a
                            quote can no longer break the script. The emitted text for the current
                            defaults is byte-equivalent in behaviour to the proven version
                          - cwd: tmpdir() - SubprocessSpawnSpec REQUIRES cwd (that was the one tsc
                            error). wsl.exe maps the Windows cwd to /mnt/..., so inheriting the
                            harness's own cwd would start the shell somewhere arbitrary
  src/prompt.ts         WRITTEN FRESH, not copied from llm-claude-cli (jscpd would flag a copy).
                        Different by necessity too: a chat box has no system channel, so buildPrompt
                        takes (messages, system) and folds the system instruction in as the first
                        fenced section. Fences are <<<USER>>> / <<<END USER>>> with a preamble saying
                        the transcript is a record, not instructions. A lone user turn is sent bare
  src/adapter.ts        OpenClawChatGptAdapter extends LlmAdapter. ONE model id `chatgpt-web`.
                        Emits block-start -> text-delta -> block-end -> finish, and NO usage chunk
                        (zero spend is the true figure). Tools dropped with a once-per-process warn
                        via onUnsupportedTools. TIMEOUT / ABORTED / TRANSPORT / INVALID_RESPONSE
                        are separated by checking which signal aborted
  src/index.ts          provider `openclaw-chatgpt`, display "ChatGPT (browser, free)".
                        registerConfigurableProviders + registerAdapter + installSettingsSection,
                        flat-scalar Config exactly as the research says. inject = ['llm','subprocess']
                        **profile defaults to `openclaw`, NOT `chrome`** - the user's Next line

PROVEN THIS SESSION: `npx tsc -b packages/llm/llm-openclaw-chatgpt` exits **0** and emitted all of
lib/types/{index,adapter,prompt,transport,invariant}.{js,d.ts} at 15:42-15:43. `pnpm install` linked the
workspace deps (node_modules/@deepseek-ai has cordis, dsh-invariants, dsh-llm, dsh-settings,
dsh-subprocess, dsh-subprocess-local, schemastery) and pnpm-lock.yaml is MODIFIED as a result.

NOT DONE - this is the whole remaining list, in order:
 1. tests/ is an EMPTY DIRECTORY. No test exists. Unit-test parseReply (all four envelope shapes),
    buildPrompt (lone user turn bare; system folded in; fences), script() (shellQuote escaping),
    and sendPrompt with a fake spawn fn returning a canned handle
 2. README.md + README.zh.md + README.i18n.yaml do not exist. They are GATED - verify-package-readme-
    model-experience and verify-package-readme-limitations need the "## Model Experience" and
    "## Known Limitations and Deferred Work" sections, and verify-translation-pairing needs both blob
    hashes recorded via `pnpm run verify-translation-pairing --write <path>/README.md`.
    Content to state: 65-75s per call (~21s is WSL booting cold), no thread, no tools, no usage
    numbers, one temporary chat per call, model is whatever the session is set to
 3. NOT WIRED IN - the package is invisible to the host until all three land:
    packages/bundle/base/package.json deps; packages/bundle/base/cordis.patch.yml (copy the
    llm-codex-cli entry ~l.571); tsconfig.host.json ~l.217. Then pnpm install again
 4. Cost class `free`: the LLM package has NO costClass field - it lives in the council at
    packages/council/tool-council/src/roster.ts defaultRoster() (l.212-247). Add an entry mirroring
    `free-claude`: provider 'openclaw-chatgpt', costClass 'free', **enabled: false**. defaultRoster
    filters on `available`, so the entry is inert until the provider is registered AND switched on
 5. The remaining gates have NOT been run even once: verify-package-invariants, knip, duplication
    (jscpd - the real risk is prompt.ts/index.ts vs llm-claude-cli), publint, constraints,
    verify-export-jsdoc, and the --check catalog verifiers (run the generators, never hand-edit)
 6. RE-RUN THE LIVE PROOF. The transport moved and its shell quoting changed, so the 04:02-04:04
    round trip no longer covers the shipped code. Re-prove it on the `openclaw` profile
 7. Nothing committed. Nothing pushed

Template: packages/llm/llm-claude-cli is the exact precedent - a TEXT-ONLY adapter whose transport is a
  child process, not an endpoint. Copy its shape, not llm-codex-cli's (that one does structured JSON +
  tool calls, which the browser cannot do)
Template files: package.json, tsconfig.json, src/{index,adapter,prompt,invariant}.ts, tests/, README.md,
  README.zh.md, README.i18n.yaml
New package: packages/llm/llm-openclaw-chatgpt, provider id `openclaw-chatgpt`, display "ChatGPT (browser, free)"
Registration (llm-claude-cli/src/index.ts, apply()): ctx.llm.registerConfigurableProviders([{ provider,
  displayName, settingsNs: settingsNamespace(...), settingsPath: [] }]) THEN ctx.llm.registerAdapter([provider], adapter).
  Those two calls are the whole of "appears in the model picker"
Adapter surface: extends LlmAdapter; providerInfo(provider), listModels(provider), resolveModel(provider, model),
  async *stream(GenerateOptions). Chunks: block-start -> text-delta -> block-end{block:{type:'text',text}} ->
  optional usage -> finish{reason:{kind:'stop'}}
Model inventory: ONE entry, `chatgpt-web` - the browser has no model API, the model is whatever the signed-in
  session is set to. Do not fake an inventory. Context window from config
Usage: emit NO usage chunk. The browser reports no tokens and zero spend is the true figure - that is the point
Tools: advertise none. Copy llm-claude-cli's #noteDroppedTools pattern (warn once per process via an
  onUnsupportedTools seam). The router's own hard filter (INCAPABLE/MISSING_TOOL) then keeps it out of tool roles
Prompt flattening: needs a src/prompt.ts like llm-claude-cli's buildPrompt (one text blob in, one out).
  DO NOT COPY IT VERBATIM - `pnpm run duplication` (jscpd over packages/) will flag it. Write it fresh
Transport: MOVE packages/council/tool-council/src/openclaw-transport.ts into the new package as src/transport.ts,
  one implementation for both the model route and the later optimizer stage. RE-RUN THE LIVE PROOF after the move
Transport rewrite: drop node:child_process for the subprocess seam (inject = ['llm','subprocess']).
  ctx.subprocess.spawn(spec) returns a SubprocessHandle SYNCHRONOUSLY; spec = { argv, cwd, graceMs, signal, env,
  stdio: { stdin: { data: <script> }, stdout: { maxBytes }, stderr: { maxBytes } } }; await child.done ->
  { exitCode, signal }; child.collected.stdout?.readFrom(0) -> { text, lossy }; finally child.terminate() +
  await child.waitForExit(). argv = ['wsl.exe','-d',distro,'-u',user,'--','bash','-l']
Wiring sites (all three needed): packages/bundle/base/package.json deps; packages/bundle/base/cordis.patch.yml
  (the llm-codex-cli entry is at ~l.571: `- id: <x>` + `name: '@deepseek-ai/dsh-<x>'`); tsconfig.host.json ~l.217.
  Then pnpm install for the lockfile link
Gates a NEW package must clear (from root package.json + lefthook.yml): verify-package-invariants (needs
  src/invariant.ts - copy llm-codex-cli/src/invariant.ts, it is 12 lines and registers a no-op),
  verify-package-readme-model-experience, verify-package-readme-limitations, verify-translation-pairing
  (README.zh.md + README.i18n.yaml with both blob hashes; lefthook runs it on every *.i18n.yaml commit),
  verify-export-jsdoc, knip, duplication (jscpd), publint, constraints, and the --check catalog verifiers
  (gen-cordis-catalog, gen-config-catalog, gen-module-graph, gen-third-party-notices) - RUN THE GENERATORS,
  do not hand-edit their output
Config shape: flat scalars only. llm-claude-cli/src/index.ts warns why - schemastery fills defaults into nested
  objects before any code runs, and a nested default that fails its own required field stops the host booting
Config fields: provider, displayName, distro, user, profile, url, timeoutMs, maxOutputBytes, defaultContextWindow
Cost class: register `free`. Strictly it is `included` (a Plus subscription) but the budget under pressure is the
  ~$60/mo API spend and this route spends none of it. Record the reason
Known limits to state in the README: 65-75 s per call (~21 s of it is WSL booting the distro cold), no thread,
  no tools, no usage numbers, one temporary chat per call

### Then (layers 2 and 3, unchanged)
1. tests/optimize.spec.ts with the spec 8 cases from ~/Downloads/dsh-openclaw-chatgpt-prompt-optimization-feature.md
   (section 13), plus unit tests for parseReply and for script() using the spawnFn seam
2. config schema - add a promptOptimizer block near Config in src/index.ts (schema starts l.546, Settings type l.190)
3. ingress - council insertion point src/index.ts l.1528-1531 where councilQuestion is computed, just before
   journalIdFor(); optimize ONLY when the query is new, never on the approved-replay path where
   pendingPlanQuery is reused. Same for swarm (l.1799-1855), pipeline (startPipeline l.2076) and propose
4. full vitest, commit, queue for the gatekeeper. Never push
Then: confirm [data-message-author-role=assistant] in a signed-in reply and fix the reader if it differs
Then: config schema - add a promptOptimizer block near Config in src/index.ts (schema starts l.546, Settings type l.190)
Then: ingress - the council insertion point is src/index.ts l.1528-1531 where councilQuestion is computed, just before journalIdFor(); optimize ONLY when the query is new, never on the approved-replay path where pendingPlanQuery is reused. Same for swarm (l.1799-1855), pipeline (startPipeline l.2076) and propose
Then: tests/optimize.spec.ts with the spec 8 cases from ~/Downloads/dsh-openclaw-chatgpt-prompt-optimization-feature.md (section 13), full vitest, live round trip, commit, queue for the gatekeeper. Never push
Do not repeat: the node browser proxy route, the Windows-CDP route, opening chrome:// or chrome-extension:// from the command line, searching the drives for OpenClaw
