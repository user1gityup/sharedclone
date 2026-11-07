---
name: deepseek-harness-fork
description: The user's two DSH repos — a private working fork and a public-safe plugin repo — and which identity each uses
metadata:
  type: project
---

The user (GitHub: `user1gityup`) runs DeepSeek Harness (`dsh`) from a source checkout at `~\Documents\claudecode\deepseek-harness`. Installed 2026-08-25. There are **two** repos, and they are not interchangeable:

1. **Private working fork** — `user1gityup/lseekv1` (moved from `user1gityup/deepseek-harness`, which now answers "Repository not found"; origin repointed 2026-09-17), default branch `master`. Full upstream history (13,148 commits) plus one commit of the user's own. Remotes: `upstream` -> `deepseek-ai/deepseek-harness`, `origin` -> the fork. Commits authored as `info@420smoking.club`. Contains local Windows paths in `packages/client/ui-openrouter-monitor/README.md`. Private, and the user is fine with that.

2. **Shareable plugin repo** — `user1gityup/dshklv1`, branch `main`, local checkout at `~\Documents\claudecode\dsh-council-plugins`. Created 2026-08-29. Standalone: the five plugin packages (source only) plus `integration/` diffs for host wiring, one commit, no upstream history. Authored as `user1gityup@users.noreply.github.com`. Audited clean — no keys, emails, or absolute paths.

**Why:** The user wanted something they could share without exposing keys or personal data, while keeping the private fork as the working checkout. A standalone plugin repo was chosen over mirroring 13k commits because the plugins are the part that is actually theirs, and a small surface can be fully audited.

**How to apply:** Develop in the private fork. When shipping changes to the public one, re-export from the fork's committed tree (`git archive`), re-strip commit headers from any regenerated diffs, and re-run the leak scan for `sk-`/`ghp_`/`AKIA`/`ndi2`/`420smoking`/`C:\Users` before pushing. Never push the working fork's identity to `dshklv1`. `gh` is not installed on this machine, so the user must create repos and set visibility themselves. See [[pnpm-corepack-eperm]] for the build gotcha and [[no-live-git-pushes]] for push timing.
