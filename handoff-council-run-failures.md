# Handoff — failures in the saved "app appearance" council run (2026-09-06)

Written by Claude Opus 5 for whichever agent picks this up next (Codex included).
Repo: `~\Documents\claudecode\deepseek-harness`. Nothing is committed.

## What the run showed

Session log: `~/.dsh/sessions/--C-Users-ndi2-Documents-Harness~0020Build--/session-b244a44c-99c0-423f-83a7-c39b862250a7/session.jsonl.zstd`
(multi-frame zstd — split on the magic bytes `28 B5 2F FD` and decode each frame;
`zstdDecompressSync` returns only the 204-byte header line otherwise).

Stage 1 was clean. Stage 2 carried four seat failures:

| Where | Seat | Error |
|---|---|---|
| Answers | Claude | `timed out after 180000ms` (no output at all) |
| Reviews and votes | Claude, Free Claude, OpenAI | `spawn ENAMETOOLONG` |

Plus a scoring defect visible in "Sources checked": Free Claude and OpenAI were each
scored down 20% for citing `http://localhost:3080` — the URL the question itself named.
The fetch failed with `no usable web provider is registered`, which is this host's
configuration rather than a dead link.

## What is already fixed and verified

All three in `packages/council/tool-council/`:

1. **ENAMETOOLONG** — `src/seats.ts`. Every CLI seat passed the prompt as one argv
   entry. A review prompt carries every seat's full draft and passed 32767 characters,
   the Windows command-line limit, so all three CLI seats failed at once in the same
   phase. `askCliSeat` now measures the command line (`commandLineLength`) against
   `ARGV_LIMIT` (24000 on win32, 96000 elsewhere) and, when over, delivers the prompt
   on stdin instead: `runOnce` takes an `input`, opens stdio[0] as a pipe, writes and
   closes it (so `codex exec` still sees EOF rather than an open pipe), and the new
   `SeatConfig.stdinPromptArg` says what replaces the `{prompt}` entry — `-` for
   `codex exec`, nothing for `claude -p`, which reads stdin when no prompt argument
   follows. The context-file flag still rides on argv.
2. **Claude seat timeout** — `src/seats.ts`. The `claude` seat now carries
   `timeoutMs: 420_000`, matching the free seat. The run default of 180s killed it
   mid-draft on a 30-source prompt; the same model on the free proxy needed 130s.
3. **localhost scored as a dead link** — `src/verify.ts`. Loopback and `.local`/
   `.localhost` hosts are now `unchecked` (`unverifiable()`), and a seam failure
   carrying a `WEB_PROVIDER_*` code is `unchecked` too (`seamUnusable()`), so neither
   costs a seat 20% in the tally.

Verified: 315 tests pass in `packages/council/tool-council/tests` (8 new, across the
new `tests/seats.spec.ts` and `tests/verify.spec.ts`); `tsc -b tsconfig.host.json`
exits 0; `tsdown --env.DSH_BUILD_FACE host --filter @deepseek-ai/dsh-tool-council`
rebuilt `lib/index.js`, and the compiled artifact contains `stdinPromptArg`,
`ARGV_LIMIT` and both `timeoutMs: 42e4` literals. The profile symlink
`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-council` already resolves to that
freshly built file, so no relinking is needed.

`tests/verify.spec.ts` had a test asserting the claude seat has no timeout of its own;
it now asserts the opposite, with the hosted seats (kimi, deepseek) still on the run
default.

## What is left

1. **Restart the DSH host before rerunning.** It was still listening on port 3080
   (PID 12736 at the time of writing) with the pre-fix code loaded. Council code loads
   at boot, so the rerun proves nothing until the host restarts.
2. **Do not commit blindly.** Another agent has concurrent uncommitted work in this
   tree (`ui-codex-quota`, `quota-codex`, `ui-conversation` per the shared agent log).
   Commit only `packages/council/tool-council/src/seats.ts`, `src/verify.ts`,
   `tests/seats.spec.ts`, `tests/verify.spec.ts` by path. No pushes — append to
   `push-requests.md` and let git-gatekeeper handle it.
3. **Open, not done:** the council's `openai` seat runs `codex exec` without
   `-c tools.web_search=true`, so it answers from training data and cites nothing.
   The web-search-cli lane already learned this. Not touched here, because it was not
   one of the reported failures and it changes what the seat costs.
4. **Watch on the rerun:** the claude seat can now hold a round for up to 7 minutes
   before it is declared failed. If it times out again at 420s, the seat is hanging
   rather than merely slow, and the next thing to check is whether it is being handed
   the repo's own instruction files (it should be running in `~/.dsh/seat-cwd`).
