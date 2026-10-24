---
name: shared-workdir-collisions
description: When another agent works the same directory, port separation is NOT isolation — .next, node_modules and generated clients are shared state
metadata:
  type: feedback
---

When a peer agent is actively working in the same project directory, choosing a
different **port** does not isolate you. I assumed it did, twice, and broke the
peer's environment both times in one session.

What is actually shared, and bit me:
- **`.next`** — two `next dev` servers in one directory clobber each other's
  build chunks. Symptom: `Cannot find module './vendor-chunks/<name>.js'` and
  spurious 500s, in BOTH servers. `next build` writes it too.
- **`node_modules` / generated Prisma client** — `npm ci`, `npm install`, and
  `prisma generate` rewrite it. On Windows a running server holds
  `query_engine-windows.dll.node` open, so this fails with `EPERM` and can
  disturb the peer's process. Note `npm ci --dry-run` still runs `postinstall`.

**Why:** these are silent, cross-process failures. The peer sees errors that
look like bugs in their own in-flight code, and can burn real time chasing a
phantom before anyone realises another agent caused it.

**How to apply:** before running anything that writes shared state in a
directory a peer is active in — dev server, build, install, codegen — either
ask them first, or work from an isolated copy (temp dir / separate worktree)
with its own `.next`. Read-only work (tests, direct DB scripts, reading files)
is safe. If you do collide, say so immediately and precisely rather than
letting them debug your mess — see [[green-energy-platform-context]] for the
git/resource protocol with that peer.
