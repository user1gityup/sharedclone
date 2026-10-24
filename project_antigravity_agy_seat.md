---
name: project_antigravity_agy_seat
description: "Antigravity (agy) as a headless DSH seat: what is proven, the driver script that exists, and the four wiring steps still open"
metadata:
  node_type: memory
  type: project
  modified: 2026-09-08T00:00:00.000Z
---

## User amendment — 2026-09-08

The user explicitly replaced the earlier reduced-permissions requirement:
Antigravity agents should have the same task-scoped rights, permissions and
shared memory as Claude Code and Codex. The web-only and "these seats never
write" instructions below describe the superseded design, not current policy.
Read the shared CLAUDE.md rules, MEMORY.md, relevant notes and shared-agent-log.md;
use native tools for authorized work and update shared memory under the same
rules. Keep native approval controls, task scope, DSH staging gates and the
single-owner git push policy. This is not blanket permission for unrelated work.
The IDE owns native permission enforcement; a driver preamble cannot reproduce
Codex's sandbox. GPT-6 is implementing the amendment with --tools shared.

Started 2026-09-08 by Claude Opus 5. Handed to Codex/GPT unfinished at the
user's Claude quota limit. Phase 1 (the driver) is written and proven live;
phases 2-5 (DSH wiring) are untouched.

## What Antigravity actually exposes, measured not assumed

There is **no `agy` binary** on this machine and none inside the install tree.
The headless path is `language_server.exe agentapi`, at
`%LOCALAPPDATA%\Programs\antigravity\resources\bin\language_server.exe`. Its
three subcommands are `new-conversation`, `send-message`,
`get-conversation-metadata`.

`agentapi` is a **client**, not a server. It needs three environment
variables:

- `ANTIGRAVITY_LS_ADDRESS` — `127.0.0.1:<port>`
- `ANTIGRAVITY_CSRF_TOKEN` — read off the running server's command line
- `ANTIGRAVITY_PROJECT_ID` — omitting it fails with
  `project_id is required when providing project_env_config`;
  `outside-of-project` works and carries no workspace.

The running IDE's server listens on **two** loopback ports and only one speaks
gRPC. The wrong one fails with `error reading server preface: EOF` before
anything is billed, so trying both is safe and is what the driver does.

**Starting a second language server does not work.** Tried, with the IDE's own
argv plus `-headless=true`: every call returned
`UNAUTHENTICATED (code 401): Request is missing required authentication
credential`. The OAuth session belongs to the IDE. Attaching to the running
IDE is therefore the only mode, and it is also the mode that keeps DSH's rule
that the council never handles a seat's credentials. **The Antigravity IDE
must be running** for these seats to work.

## The Claude quota pool is NOT reachable headlessly

This contradicts the plan the work started from, so it is written down plainly.

The binary does contain Claude model ids (`claude-opus-4-5`, `claude-opus-4-6`,
`claude-opus-4-8`, `claude-sonnet-4-5`, `claude-sonnet-4-6`,
`claude-haiku-4-5`), so the IDE's own picker can spend the separate Claude
bucket. But `agentapi --model` takes a **tier**, and only three tiers resolve:
`flash_lite`, `flash`, `pro`. Thirteen other spellings were probed
(`claude`, `claude-sonnet-4-5`, `sonnet`, `opus`, `haiku`, `claude_sonnet`,
`claude_opus`, `gemini_pro`, `auto`, `default`, `fast`, `smart`, `bogus-model`)
and every one returned `no available models found for tier <x>`. The
`--profile` flag exists but no profiles are defined on this install.

So the "three independent agents on independent quota pools" design lands, for
now, as **three Gemini-tier seats on one Gemini pool**. That is still real
parallelism and still free, but it is one pool, not two. Anyone picking this
up should re-check whether a newer Antigravity exposes a Claude tier, or
whether the IDE sends a model name over a different RPC that `agentapi` does
not wrap.

## Measured latency and cost

Free. On the `flash` tier: 8.4s for a one-line answer, 10.6s with a refusal,
17.0s with one `view_file` round trip. `pro` was slower but was not timed
cleanly.

## The driver: `agy-headless.mjs`

Written, syntax-clean, proven live. Uncommitted at handoff.

`packages/council/tool-council/bin/agy-headless.mjs` in
`~/Documents/claudecode/deepseek-harness`, branch `feat/heterogeneous-teammates`.

It turns the async conversation API into the shape a DSH CLI seat needs:
prompt in on argv or stdin, answer out on stdout, exit code means something.

- Discovers the signed-in server by reading `language_server.exe`'s command
  line through PowerShell, then tries each of its loopback ports.
- Starts the conversation, then reads the answer out of the trajectory
  database at `~/.gemini/antigravity/conversations/<id>.db`, because
  `get-conversation-metadata` returns configuration and never the reply.
- The trajectory is protobuf with an unpublished schema, so it is walked
  generically and matched by field path. The three paths that matter, verified
  against real trajectories: assistant text at `.20.1` on `step_type` 15,
  user prompt at `.19.2` on `step_type` 14, tool call name at `.20.7.2` and
  its JSON arguments at `.20.7.3`. `step_payload` arrives as a decimal byte
  list, not a blob.
- A turn is finished when the last step is an assistant step and nothing has
  been written for `--quiet-ms` (default 4s). There is no terminal flag to
  read; both conditions are needed because an agent mid-tool-call is also
  quiet.
- Prompts are capped at 30000 characters: `agentapi` takes the prompt as one
  argv entry and Windows caps a command line at 32767. This is the same wall
  that once cost three CLI seats their vote at once. A council review prompt
  can exceed it, and this seat will fail loudly rather than silently truncate.

## The sandbox problem, and what was actually done about it

**The Antigravity agent has live, pre-approved `view_file`, `write_to_file`
and `run_command`.** Proven: a probe with no workspace read an arbitrary file
outside any project and the trajectory recorded the permission decision as
`allow`. Its full tool list is `view_file, run_command, manage_task,
send_message, schedule, invoke_subagent, define_subagent, manage_subagents,
write_to_file, replace_file_content, generate_image, read_url_content,
search_web, find_by_name, grep_search, list_dir, ask_question,
mcp_gemini-api-docs_*, list_resources, read_resource`.

Those tools run **inside the user's own IDE process**, so nothing DSH passes
can take them away. The restriction is enforced at both ends of the turn
instead, per the user's rule that new tools do not get to do as they please:

- a `--tools` policy preamble names every forbidden tool and gives the DSH
  file protocol instead — the seat ends its answer with
  `REQUEST-FILE: <path>` and the host resolves it;
- the finished trajectory is audited for tool calls, and a violation throws,
  discarding the answer rather than returning it.

The policies are `web` (network tools only: `read_url_content`, `search_web`,
the two MCP doc tools), `read` (those plus read-only file tools), `any` (no
audit), and `shared` (native parity, no audit). The driver shipped with `web`
as the default and that is what this section describes; **the seats now run
`shared` by the user's confirmed decision** — see "The permission question,
settled" below. `web` and `read` still work and still audit.

**Verified live:** with the default policy, a prompt explicitly ordering
`view_file` on a real path came back with
`I cannot directly access local files using view_file under the current
council operating rules.` followed by a `REQUEST-FILE:` line, and the
trajectory recorded `tools: []`. The preamble is what prevents; the audit is
what detects. An audit that runs after a read cannot undo it — this is a
detector, not a sandbox, and should be described that way.

## Status — all five phases landed 2026-09-09

Phase 1 (the driver) by Claude Opus 5; phases 2-5 by GPT-6, in the same
checkout, on `feat/heterogeneous-teammates`. **Uncommitted at the time of
writing.**

- **Audit proven.** `tests/agy-headless.test.mjs` builds synthetic trajectory
  steps and asserts `auditTools` flags `view_file` + `write_to_file` under
  `web`, `write_to_file` alone under `read`, and nothing under `shared`.
  `policyPreamble`, `auditTools` and `toolCallsFrom` are exported now, so
  the file is both a CLI and a module.
- **Three seats in `seats.ts`**: `agy-flash-lite`, `agy-flash`, `agy-pro`.
  `command: 'node'`, `promptOnStdin: true`, `free: true`,
  `nativeWebSearch: true`, `contextFileFlag: '--context-file'`,
  `timeoutMs: 420_000`, `enabled: false`. A `.cmd` shim cannot be the seat
  command: Node's CVE-2024-27980 fix refuses to spawn one with `shell: false`.
- **Installed** by `scripts/install-agy-headless.mjs` to `~/.dsh/bin/`, which
  is the path the seats resolve, plus an `agy.cmd` shim there for the user's
  own headless use.
- **Web-search fan-out** via `src/research-seats.ts` and the `nativeWebSearch`
  seat flag. The point, in the user's words: Antigravity has internet, so it
  should carry search traffic and stop one agent being the bottleneck.
  `webMaxResults` is 0 because OpenRouter bills per result
  (see [[dsh-council-plugin]]); a seat that searches for free changes that sum.

## The permission question, settled

The user was asked directly on 2026-09-09, because the amendment at the top of
this note contradicted an instruction given in another session, and confirmed:
**the amendment stands, keep `shared`.** The three seats run with native tool
parity — `write_to_file` and `run_command` included — enforced by the IDE's
own approval prompts rather than by this driver. The `web` and `read`
policies still exist and still audit; they are simply not what the seats use.

Say this plainly wherever it comes up: `shared` disables the audit. The
driver's preamble is guidance to a model, never a sandbox, and it cannot
reproduce what Codex's sandbox does. What actually holds the line for these
seats is Antigravity's own approval UI and the DSH staging and push gates.

## Verified 2026-09-09 (Claude Opus 5)

- The installed driver, on the exact path `seats.ts` names, with the prompt on
  stdin and `--tools shared`: answered in 10.3s on the `flash` tier,
  `tools: []`, `policy: "shared"`.
- `pnpm --config.verify-deps-before-run=false exec vitest run` over
  `tool-council` + `ui-council-budget`: **32 files, 447 tests, 0 failures**
  (was 27/423 before this work).
- `pnpm run typecheck` **exits 2**, on one error that belongs to the quota
  package, not the seats:
  `packages/quota/quota-antigravity/tests/composition.spec.ts(25,31): error
  TS2352` — a single `as` cast onto `context.loader.internal` that needs
  `as unknown as`. It blocks pushes tree-wide, because the pre-push hook
  typechecks everything (see [[reference_git_push_method]]). Reported to the
  session that owns that package; not fixed here, because it is not this
  work's file.

**Environment trap:** a plain `pnpm run <x>` in this repo dies before the
command runs, with `[install-lefthook] stale Lefthook installer lock
".git\dsh-lefthook-install.lock"`. `--config.verify-deps-before-run=false`
gets past it without touching the lock.

## Still open

- The Claude quota pool, above — still unreachable headlessly. Recheck when
  Antigravity updates.
- The typecheck error, until the quota package's owner clears it.
- Nothing is committed and nothing is pushed.

See [[dsh-council-plugin]], [[dsh-swarm-profiles]], [[nothing-without-permission]].
