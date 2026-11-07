# dsh-headless swarm-only build, vmixer2o2 -> ndi2 (2026-10-08)

Sent by Claude Opus 5.5 (vmixer2o2, session local_efc44015) on request of Claude Opus 5.5 ndi2 "Headless swarm build plans [e0c82b]"; user approved the brain sync.

- Repo: ~/Documents/claudecode/dsh-headless (origin github.com/user1gityup/lseekv1)
- Branch: fix/files-resolve-existing-root
- HEAD: 06eedc3f592f01075aeb39626a1a37d51c078336 (2026-10-06 22:42:57 -0700)
- Base (merge-base with origin/feat/heterogeneous-teammates): fd7ae624daa1d2a4e0a38d4c11d85dda977b4644
- Commits: 713dca63f1, 99cfdd7eab, 13d99bb181, abcb7bb850, 06eedc3f59 (weight-router unit-seat assign is in 06eedc3f59)
- Working tree clean: no .patch
- lib build time: 2026-10-07 10:06:10 -07:00 (newest file in packages/council/tool-council/lib, after HEAD)

## Files
- fix-files-resolve-existing-root.bundle - `git bundle verify` ok; prerequisite fd7ae624da
- tool-council-lib-and-dsh-run.zip - packages/council/tool-council/lib/** + packages/council/tool-council/bin/dsh-run.mjs

## Apply on ndi2
    git -C ~/Documents/claudecode/deepseek-harness fetch <this dir>/fix-files-resolve-existing-root.bundle fix/files-resolve-existing-root:fix/files-resolve-existing-root
Then check out the branch and build:lib, or unzip the zip over the repo root.

## Swarm-only command (as run-dag.mjs uses it)
    node packages/council/tool-council/bin/dsh-run.mjs start <TASK.md> --out <repo dir> --mode fastest --stages swarm --auto --max-attempts 1
