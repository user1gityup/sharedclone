---
name: dshklv1-public-repo
description: What the public dshklv1 repo now ships beyond plugin source, and the three upstream packages its wiring diffs patch
metadata:
  type: project
---

`user1gityup/dshklv1` (local checkout `~/Documents/claudecode/dsh-council-plugins`) is no longer plugin source alone. As of 2026-09-08 it also carries:

- `proxies/openrouter-free/` — the free-model proxy, moved in from `~/Documents/Harness Build/openrouter_proxy`, which was committed to no repo at all. Its venv lives at `proxies/openrouter-free/.venv` and is gitignored.
- `scripts/` — a genericised copy of the `~/.dsh` launcher: `launch-dsh.cmd`, `dsh-session.cjs`, `proxy-control.ps1`, `rebuild-dsh.cmd`, `verify-seats.cmd/.mjs`, `install.ps1`, `dsh-env.example.cmd`. Machine paths come only from `scripts/dsh-env.cmd`, which is gitignored and written by `install.ps1`.
- `docs/ui-map.png` — an annotated UI figure built by CDP-driving headless Chrome against the live DSH at :3080. The build scripts are not committed; regenerating means redoing them.
- `integration/07` and `integration/08`.

**The wiring diffs patch three upstream packages, not one.** The repo's own README used to claim only `05-ui-sidebar` did. A clean-checkout build proved otherwise, and each failure was a build error, not a boot error:

| Diff | Upstream package | Without it |
|---|---|---|
| 05 | `client/ui-sidebar` | no `sidebar.region.action` slot for the budget and quota panels |
| 07 | `sandbox/sandbox-policy` | `tool-council/tests/staging.spec.ts` fails to typecheck — `approveWorkspaceWrites`/`revokeWorkspaceWrites` do not exist upstream |
| 08 | `client/ui-conversation` | four TS errors in `ui-council-budget`: `conversation.column.top` is not in the slot union |

**Why:** exporting plugin sources alone produced a repo that could not build for anyone else, because `tool-council` and `ui-council-budget` had grown dependencies on fork-local changes to upstream packages. Nothing catches that except building a stock checkout — the working fork always has the changes already.

**How to apply:** when re-syncing from the fork, do not stop at the leak scan. Create a worktree at the diffs' base commit (`b150a551b8`), apply every `integration/*.diff`, copy the seven packages in, and run `pnpm install && pnpm build` plus `pnpm vitest run` over those packages. Verified 2026-09-08: build exit 0 with 206 client artifacts, 39 test files, 522 passed 1 skipped. Note `proxy-control.ps1` must not have its output piped — the proxy it starts inherits the pipe and the call will not return. See [[deepseek-harness-fork]], [[free-claude-code-setup]], [[dsh-council-plugin]].
