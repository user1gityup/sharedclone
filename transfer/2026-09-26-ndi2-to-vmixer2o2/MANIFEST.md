# Transfer ndi2 (vmixlaptop2x6) -> vmixer2o2, 2026-09-26

Written by Claude Opus 5.5, session cafe32. Owner note: handoff-2026-09-25-0355-canna-commerce-swarm-build-prep.md.
User decision: code moves as git bundles through the shared brain, no push.

| bundle | repo on ndi2 | main | sha256 | bytes |
|---|---|---|---|---|
| users.bundle | ~/Documents/claudecode/users | 039842b0408200c225781bfa325af62b803292df | 6361a64fd6c49bc89dfdb045e9ea177a8adb3429595317515252c0ae706e5136 | 7226 |
| canna.bundle | ~/Documents/claudecode/canna | e54c91267cd9814bc95347f2310f4cc7aceec62a | 783edef4a9f98a980b8aee715f94c2653955330b07375edfd6542a06b823061d | 7748 |
| commerce.bundle | ~/Documents/claudecode/commerce | 34701f74cd8db39376dbd610727cc125dc0eeda1 | 37f4ba871c6cbf0aad651abf7516277c9bdc7f254a2aaff89d6228472ce596a3 | 6636 |

Each is `git bundle create --all`, `git bundle verify` okay, and test-cloned on ndi2 with fsck clean.

On vmixer2o2, per repo: `git clone -b main <bundle> ~/Documents/claudecode/<repo>`, then make a local bare
origin (`git clone --bare` into `~/.dsh/remotes/<repo>.git`, `git remote set-url origin` to it, fetch,
set upstream) so queue-build sees 0/0, the same layout as ndi2.

**One click on vmixer2o2 (2026-09-27, Claude Opus 5.5 [c51745]):** double-click `CLONE-REPOS-ON-VMIXER.cmd` in this folder.
It checks each bundle's sha256, makes the bare origin in `~/.dsh/remotes/<repo>.git` first, clones the repo from it
(so origin is set by the clone), sets identity, and verifies HEAD / 0-0 / clean. Re-runs leave good repos as they are;
a damaged bundle or an unexpected existing dir stops that repo untouched. Writes `clone-result-<HOST>.json` here.
Tested on vmixlaptop2x6 in scratch: fresh 3/3 OK, re-run 3/3 "already here", damaged canna.bundle -> FAIL exit 1, nothing created for it.
clone-repos.ps1 sha256 f2b0d61140389e536e62c6c26ba3b67fde16e858d572b60f4d91e3268f52a1d2

**Harness bundle: NOT NEEDED.** vmixer2o2 rebased onto origin 111c359502 directly (HEAD 25db02347f, 2026-09-27).

~~**Harness bundle: NOT HERE YET.** Held until the CI-gates session commits on ndi2, so vmixer2o2 gets the
final harness. Range will be origin `f55855f248`..ndi2 harness HEAD (b1b6bd00fd at writing, plus CI commits).
vmixer2o2 must then reconcile its own unpushed `56f2eddbf7` against it.~~

Delete this folder once vmixer2o2 has cloned and verified all bundles.
