---
name: pnpm-corepack-eperm
description: On this machine corepack enable fails with EPERM; pnpm must be installed globally via npm
metadata:
  type: project
---

On this Windows machine, `corepack enable` fails with `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpx'` because the Node install lives in Program Files and the shell is not elevated. `corepack pnpm <cmd>` still works, but any build script that shells out to a bare `pnpm` will fail with "'pnpm' is not recognized".

**Why:** DeepSeek Harness's `scripts/build.ts` spawns `pnpm --filter ...` as a bare command, so corepack-only pnpm broke `build:web` even though the library stage succeeded.

**How to apply:** Install pnpm globally instead — `npm install -g pnpm@<version>` lands in `~\AppData\Roaming\npm`, which is already on PATH and needs no admin rights. Match the version in the repo's `packageManager` field.
