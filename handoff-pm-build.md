---
name: handoff-pm-build
description: 2026-09-21 done, Claude Sonnet 5, ndi2 - MCP registered (Claude Code + Codex), Phase 3 DSH connector built+proven live (pm/connectors/dsh-connector.mjs), 36 brain-population tasks seeded across 5 new pm projects; Tailscale still blocked on user login; phases 4-5 deferred; see "2026-09-21 second session" below
metadata:
  type: project
---

# Handoff: pm - agent project manager v1

- Handoff id: `pm-build-2026-09-16`; written 2026-09-16 ~11:25 PDT, host vmixlaptop2x6 (ndi2 machine), session d076c585, Claude Opus 5 (claude-opus-5). Owner: Claude Opus 5. No other agent involved.
- **2026-09-21 update, Claude Sonnet 5, host ndi2, session (this Claude Code session, id not captured), model claude-sonnet-5.** Project: `~\.claude\shared-brain\pm` (no separate repo; part of shared-brain git repo). Owner of this update: Claude Sonnet 5.
- Ask (verbatim): "create a folder in shared brain called pm and build it there do what is most effecient to get it done asap let me know if its dsh or you". Answer given: built by Claude Opus 5 directly, not DSH (swarm reliability fixes P2, P4-P9 unbuilt).

## Built (verified)
- `pm/store.mjs` service layer on Node built-in `node:sqlite` (zero deps; deviation from plan's Postgres, chosen for speed and no install). Data `~/.claude/pm-data/pm.db`, outside git (`pm/.gitignore` ignores *.db).
- `pm/server.mjs` REST + UI + 15s lease reconciler, port 4480, loopback only unless PM_HOST + PM_TOKEN.
- `pm/cli.mjs` CLI and MCP stdio server (`node cli.mjs mcp`), one tool table, 14 tools.
- `pm/public/index.html` board, task panel, conflict merge box, instructions vs comments, history.
- `pm/test.mjs` `node --test test.mjs`: 10 pass 0 fail (attribution, 409 with rejected edit, contested claim, lease expiry -> uncertain, claim-next atomic, instruction ack, backup/drop/restore, 1000 tasks < 200 ms, REST, MCP stdio).
- Browser-verified in the pane: board renders, conflict box shows rejected edit after CLI change, instruction badge, claim moves card to in_progress. Test data wiped, DB reseeded clean.
- One click: `pm/START-PM.cmd` (starts if not running, waits for /api/health, opens browser), plus Desktop `Project Manager.cmd` calling it. Both run exit 0.
- Seeded: project `dsh-council-fixes` (P2, P4-P9, gatekeeper approval for user) and `pm` (phases 3-5, remote access, MCP registration).

## Not done / open
- Server not auto-started at login; runs only after the launcher. Process: node server.mjs on 4480.
- MCP not registered in Claude Code/Codex/DSH (persistent config - ask user).
- Remote multi-machine access not configured (Tailscale + PM_TOKEN).
- Plan phases 3 (DSH connector), 4 (machine runner), 5 (notifications) not built.
- Nothing committed by agent; brain-sync auto-commits pm/ source.

## Do not repeat
- Do not reintroduce Postgres/npm deps without a reason; v1 is dependency-free on purpose.
- Do not commit pm-data or *.db into the brain.

## 2026-09-21 session (Claude Sonnet 5) — QUOTA STOP at ~06:05, session hit 100% session quota (weekly 15%) almost immediately after start; per quota-handoff-protocol.md this note is written instead of continuing.

**User's ask (verbatim, combined task):** finish pm (MCP registration with Claude Code/Codex/DSH, remote access via Tailscale if already set up, Phase 3 DSH connector using pm's own seeded task descriptions as spec) AND separately populate pm with a task for every still-open handoff entry in MEMORY.md (title, source handoff file, exact next-action text pulled from that file, grouped into sensible pm project(s), skip anything `dsh-council-fixes` already covers).

**Verified this session (read-only, nothing changed):**
- pm server is already running and healthy: `curl http://127.0.0.1:4480/api/health` → `{"ok":true,"db":"~\\.claude\\pm-data\\pm.db"}`. No restart was needed.
- Tailscale is installed (`C:\Program Files\Tailscale\tailscale.exe`) and the Windows service is RUNNING, but `tailscale status` returns `Logged out. Log in at: https://login.tailscale.com/a/18cca4ab389cae` — i.e. it is NOT actually connected to any tailnet. This is a login/auth action only the user can do (opening that URL and authenticating). Per the brief's own instruction ("If Tailscale isn't already configured, do NOT install or configure networking software yourself — stop and note it as an open question"), this counts as not-yet-configured. **Open question for the user: log in to Tailscale via the URL above (or confirm which existing tailnet/account to use), then pm's PM_HOST+PM_TOKEN wiring can be finished in one more short session.**
- Started (did not finish) checking how existing MCP servers are registered on this machine, to register pm's `node cli.mjs mcp` the same way. `~\.claude.json` exists and is large (global Claude Code config with a top-level `projects` map that can carry per-project `mcpServers`); `python3`/`python` are NOT on PATH on this machine (Microsoft Store alias stub only), so a planned `json.load` inspection of that file failed and was not redone with a Node one-liner before quota stopped. **Not yet confirmed: whether any project already has an `mcpServers` block to copy the pattern from, or whether a bare `.mcp.json` exists in any project root.** This must be re-checked (e.g. `node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.env.USERPROFILE+'/.claude.json','utf8')).projects,null,2))"` or similar, or `Get-Content` + `ConvertFrom-Json` in PowerShell) before writing any MCP registration.
- Confirmed shared-brain git working tree is clean (`git status --short` empty) before this note, on branch `main`, HEAD `e18f650 brain: vmixlaptop2x6 session changes`. Nothing was committed this session because nothing was changed.

**Not started at all:**
- Part A.1 MCP registration itself (blocked on the config-pattern check above).
- Part A.3 Phase 3 DSH connector — pm's own `pm` project tasks (phase descriptions) were not yet read via `node cli.mjs` to get the spec.
- Part A.4/5 (machine runner, notifications) — explicitly lower priority, not attempted.
- Part B entirely: no handoff files beyond the ones already read for this note were opened, no pm tasks were created via CLI/REST/MCP for any open handoff entry, no new pm project was created. `dsh-council-fixes` and `pm` remain the only two pm projects.
- `pm/test.mjs` was not re-run (no server/store/cli code was touched, so no regression risk, but it also was not verified fresh this session).

**Exact next action for the resuming agent:**
1. Re-verify pm health (`curl http://127.0.0.1:4480/api/health`) and re-run `node --test test.mjs` from `pm/` once before touching anything, to get a fresh baseline.
2. Resolve the MCP registration pattern (Node/PowerShell JSON read of `~\.claude.json`, and check for any project-root `.mcp.json`), then register pm's `node cli.mjs mcp` (absolute path `~\.claude\shared-brain\pm\cli.mjs`) the same way, plus check `~/.codex/` and `~/.dsh/` for an equivalent MCP config format and register there if the format is documented/reachable.
3. Read `pm`'s own seeded project tasks (`node cli.mjs` list/show against project `pm`) to get the real phase 3/4/5 spec text before writing any DSH-connector code.
4. Leave Tailscale alone until the user answers the open question above; do not attempt to run `tailscale login` or `tailscale up` non-interactively.
5. For Part B: go through `MEMORY.md`'s "## Shared operation" section top to bottom, open every handoff file whose one-line index entry is not explicitly DONE/CLOSED/resolved, pull the real "next action" text from inside that file (not the index line), and create one pm task per open item via `node cli.mjs` (never hand-edit `pm.db`), grouped into new project(s) distinct from `dsh-council-fixes`. There are roughly 30-40 such open entries in the current MEMORY.md (heavy duplication of the same handoff filenames across multiple index lines — the duplicates only need one pm task each, keyed by handoff filename).
6. After any code change to `server.mjs`/`store.mjs`/`cli.mjs`, re-run `node --test test.mjs` and quote the real pass/fail count before claiming anything works.
7. Commit locally only (shared-brain repo); if a push is warranted, append to `push-requests.md` in the existing format and say so — never run `git push`.
8. Refresh this file's frontmatter `description` and the MEMORY.md index line to reflect the new state once real progress is made, and append a signed `shared-agent-log.md` entry.

**Do not repeat (added this session):** do not assume `python`/`python3` is available on this machine for quick JSON inspection — it is a Microsoft Store alias stub only; use Node (`node -e "..."`) or PowerShell `ConvertFrom-Json` instead.

## 2026-09-21 second session (Claude Sonnet 5, host ndi2) — combined task completed, fresh quota confirmed by user

A soft session-quota-stop hook fired again almost immediately (same as the prior session), but the user had explicitly confirmed twice beforehand that quota was fresh on this account and instructed not to stop for a soft hook warning without checking it applies to this account. Proceeded per that instruction; no hard tool-level quota error was ever hit. All of Part A items 1-3 and all of Part B were completed and verified this session.

### Part A — pm itself

1. **MCP registration.**
   - Claude Code: already DONE before this session started — `~/.claude.json` top-level `mcpServers.pm` = `{type:"stdio", command:"node", args:["~\\.claude\\shared-brain\\pm\\cli.mjs","mcp"]}`. Verified live this session: `claude mcp list` → `pm: node ~\.claude\shared-brain\pm\cli.mjs mcp - ✔ Connected`.
   - Codex: DONE this session. Added `[mcp_servers.pm]` (`command = 'node'`, `args = [cli.mjs, mcp]`) to `~/.codex/config.toml`, following the existing `[mcp_servers.node_repl]` pattern (the only prior mcp_servers entry on this machine). Backed up first as `config.toml.before-pm-mcp-20260921-060326`. Not yet exercised inside a live Codex session (needs a Codex restart to confirm the tool list picks it up) — low risk, syntax matches the existing working entry exactly.
   - DSH: checked `~/.dsh/settings.yaml` and `~/.dsh/AGENTS.md` recursively — no `mcpServers`/`mcp_servers` config format exists anywhere under `~/.dsh`. Not reachable/documented on this machine, so per the brief this was skipped rather than invented.

2. **Remote access (Tailscale).** Re-verified: `tailscale.exe status` still returns `Logged out. Log in at: https://login.tailscale.com/a/18cca4ab389cae`, unchanged from the prior session. This is a login/auth action only the user can do; left untouched per the brief's own instruction. `server.mjs` already supports `PM_HOST`+`PM_TOKEN` for remote binding once the user logs in — that wiring is a short follow-up, not started.

3. **Phase 3 — DSH connector.** Built `pm/connectors/dsh-connector.mjs`. The original phase 1-5 plan text (not present in the repo, but found embedded verbatim in `~/.dsh/settings.yaml` lines ~1490-1629, apparently a stored council-tool prompt/preset) plus pm's own seeded `pm` project task titles were used as the spec. The connector:
   - Reads real DSH council run artifacts from `~/.dsh/council-runs/<id>.json` (id, query, plan, seatIds, reviews, terminalState, quorumConfig — confirmed this is the live, currently-used run-record schema by inspecting 17 real files on disk).
   - Publishes/updates one pm task per run in a new project `dsh-council-runs`, mapping `terminalState` → pm status (`completed`→`review`, `partial`/`cancelled`→`blocked`, else `in_progress`), with the query+plan as the task body, a `run` artifact link back to the source file, and a review-vote-tally comment.
   - Is read-only against DSH and additive-only against pm (never authorizes, dispatches, or cancels anything) and is idempotent (a `dsh-run:<id>` marker in the task body lets re-syncs update in place instead of duplicating).
   - **Proven live**, not just written: `node connectors/dsh-connector.mjs sync-recent 3` against 3 real run files created project `dsh-council-runs` (`P-2ee0d5df`) with 3 tasks, correct status mapping (2 `completed`→`review`, 1 `partial`→`blocked`); re-running the same command updated those 3 tasks in place (rev 1→2, comment appended, still exactly 3 tasks/0 done) instead of duplicating.
   - Phase 4 (machine runner) and Phase 5 (notifications) explicitly deferred — lower priority per the brief, noted with a comment on their pm tasks (`T-869e0759`, `T-f06d8373`) rather than silently left.
   - Swarm-level (not just council query/plan/review) sync was not built — no separate DSH swarm-run artifact format was found in the time available; only the council tool's own run records are covered.

   The three pm-project tasks for these items (`T-06d91336` Phase 3, `T-2899baf7` MCP registration, `T-f45ba58a` Tailscale) were updated to `review`/`blocked` with the evidence above, via `node cli.mjs set`/`artifact`/`comment` — never by hand-editing `pm.db`.

### Part B — brain population

Re-read `MEMORY.md` fresh (per the brief's concurrent-edit warning) immediately before enumerating. Went through every line under "## Shared operation", excluded anything whose index line literally said DONE/CLOSED/closed/resolved, and deduplicated the many repeated links to the same handoff filename (a handful of files — e.g. `handoff-2026-09-18-0900-dsh-local-writer-route.md`, `handoff-2026-09-18-0731-dsh-vmixer-sync-secrets.md`, `handoff-2026-09-17-2132-vmixer-llama-dsh-seat.md` — are indexed 3-4 times each from sequential session updates). That left **36 distinct open handoff files**. For each one, opened the actual file and pulled its real, current "Exact next action"/"Next action" text (not the one-line index summary, which is often stale relative to the file's own later updates).

Created 5 new pm projects (thematic grouping, since 36 flat tasks in one project would be unusable): `brain-handoffs-accounts-quota` (7 tasks), `brain-handoffs-dsh-council-swarm` (10), `brain-handoffs-network-relay` (5), `brain-handoffs-hardware-llama` (5), `brain-handoffs-other` (9) = 36 tasks total, via `node cli.mjs` REST calls (a one-off script, not hand-edited SQL). Each task body starts with `source-handoff:<filename>` and contains the real next-action text pulled from the file, plus enough context (what's done, what's blocked, do-not-repeat notes) to act without re-reading the source file. Explicitly cross-referenced and skipped anything already covered by the existing `dsh-council-fixes` project (P2/P4-P9) — e.g. the `dsh-all-live-pm-sync` task notes that P5/P7 are already tracked there and only lists the genuinely uncovered remainder (agent3 deadlines/UI, agent2 permissions, vMixer sync).

Not included, deliberately: `handoff-pm-build.md` itself (this file — it's tracked by the existing `pm` pm-project, not duplicated); anything whose index line said closed/DONE/resolved even if a minor loose end remained in the file text (e.g. `handoff-multi-machine-sync.md` says "closed: ... only vMixer status check left" — treated as closed per the literal index label, per the brief's own status-word rule).

### Verified this session

- `curl http://127.0.0.1:4480/api/health` → `{"ok":true,"db":"...pm.db"}` before and after all changes; server was never restarted (didn't need to be).
- `node --test test.mjs` from `pm/`: **10 pass, 0 fail** — run three times across this session (baseline, after adding the connector, after seeding brain tasks), same result each time.
- `pm/connectors/dsh-connector.mjs` proven live against real DSH data, not just written (see Phase 3 above).
- `git status --short` in `~/.claude/shared-brain` is clean after this session — the brain-sync auto-commit hook picked up `pm/connectors/dsh-connector.mjs` and all the new pm task data lives in `pm.db` (outside git, as designed) on its own, with no manual commit needed. Confirmed the "brain-sync auto-commits pm/" claim from the original 2026-09-16 handoff is still true.
- Nothing was pushed. No push was warranted by this session's own work (pm/connectors is a new file under the auto-committing brain repo, not a separate push-worthy change); the Codex `config.toml` edit is a local machine config file, not part of any git repo, so no push question applies to it either.

### Not done / still open

- Tailscale login (user-only action, per above).
- Codex MCP registration not exercised inside a live Codex session yet (needs restart to confirm; config syntax matches the one proven-working entry on this machine).
- pm Phase 4 (machine runner) and Phase 5 (notifications) — not built, explicitly deferred.
- pm server not auto-started at login — unchanged from the original handoff, still runs only via the launcher.
- The 36 newly-seeded `brain-handoffs-*` pm tasks are records of already-existing open work elsewhere (DSH harness, vMixer, llama benchmarking, etc.) — none of that underlying work was done by this session; only the pm bookkeeping for it.

### Do not repeat (added this session)

- Do not re-litigate MCP registration for Claude Code — it is done and `claude mcp list` proves it connects.
- Do not re-search for a DSH-native mcpServers config format — confirmed absent from `~/.dsh` this session; nothing changed there.
- Do not hand-edit `pm.db` for brain-population tasks — always go through `node cli.mjs`/REST/MCP so attribution and history stay correct.
