---
name: dreamhost-deploy-constraints
description: "Hard-won DreamHost deploy constraints shared by billboard-platform and green-energy-platform — standalone mode, PHP migrations, MySQL-not-Postgres"
metadata: 
  node_type: memory
  type: project
  originSessionId: fbf48b7f-1711-4f9d-91ad-83afb325a793
  modified: 2026-08-21T16:38:40.195Z
---

Constraints discovered the painful way on the DreamHost deploy path. They apply to
both `billboard-platform` and `green-energy-platform`. Don't rediscover these.

**No `output: "standalone"` in next.config.js.** Production runs `next start` under
pm2 (no Docker in the live path). Standalone's static-asset serving is incompatible:
every `_next/static/*` request 400s in production while page HTML renders fine.
Billboard's Dockerfile still copies `.next/standalone` and is therefore broken
as-written — deliberately kept as vestigial, with a comment saying so.

**MySQL, never Postgres.** DreamHost doesn't offer Postgres. Billboard had to do a full
Postgres→MySQL migration mid-project. Consequences for schema design: no `String[]`
scalar lists (use `Json`), and give long free-text columns explicit `@db.Text` rather
than inheriting MySQL's VARCHAR(191) — an AES-256-GCM ciphertext of an API key
overflows 191 easily.

**Migrations run via `deploy/migrate.php`, not `prisma migrate deploy`.** Applies the
same `prisma/migrations/*/migration.sql` files over PDO MySQL, tracked in the same
`_prisma_migrations` table, so `prisma migrate dev` still works locally to generate
them. Originated because DreamHost *shared* hosting's sustained load made Node
unreliable to even start (`uv_thread_create` crashes). Kept on the VPS too, for
pipeline consistency.

**Node needs its thread pools capped** on the shared host:
`NODE_OPTIONS="--v8-pool-size=1" UV_THREADPOOL_SIZE=1`.

**Builds run on the GitHub Actions runner**, then rsync to the server — never build
on the host.

**Each domain may get its own DreamHost system user.** 66ifs.xyz landed under
`dh_yeyqht` while billboard's iz3q.xyz is `dh_b2edht` — don't assume a second site on
the same VPS shares the first one's user or home directory. Check by SSHing in.

**Servers here run MySQL 8** (confirmed 8.0.41 on vps71503), so Prisma returns `Json`
columns already parsed. Code still parses defensively for the MariaDB case, where
`JSON` is a LONGTEXT alias that reads back as a string.

**How to apply:** check these before changing next.config.js, the Dockerfile, the
Prisma datasource, or any deploy workflow in either repo. See
[[green-energy-platform-context]] for the second app's specifics.

## Verified against real MariaDB 10.11 (2026-08-22)

The whole deploy migration path was tested against a throwaway MariaDB 10.11
container, not just reasoned about:

- `deploy/migrate.php` replays all migrations cleanly from an empty database,
  and correctly SKIPS already-applied ones on re-run. Statement splitting works.
- `prisma migrate status` against MariaDB reports the schema up to date.
- **Prisma `Json` columns are `longtext` on MariaDB** (confirmed via
  `SHOW COLUMNS`) — but with Prisma 5.17 they still come back **already parsed
  as objects**, not strings. The common warning that MariaDB hands JSON back as
  a string did NOT reproduce at this version. Defensive read helpers are still
  worth keeping for older MariaDB (10.5/10.6) and for rejecting malformed
  values, but don't assert the string behaviour as fact.
- Deploy YAML gotcha worth not re-deriving: the nested heredocs work only
  because `run: |` block-scalar indent stripping puts the `HTACCESS`/`DEPLOY`
  terminators at column 0. Keep terminator indentation equal to the block's
  base indent or the heredoc silently swallows the rest of the script.
