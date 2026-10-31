# DEPENDENCIES

Every imported package, for the host to turn into `package.json`. One row per
package.

## Build / runtime (installed)

| name | range | dependency / devDependency | why |
|---|---|---|---|
| next | ^15.1.6 | dependency | App-router web framework (pages, route handlers, middleware). |
| react | ^19.0.0 | dependency | UI library; peer of Next. |
| react-dom | ^19.0.0 | dependency | DOM renderer; peer of Next. |
| jose | ^5.9.6 | dependency | EdDSA / Ed25519 JWT verification against the users service JWKS (`src/lib/auth.ts`). |
| typescript | ^5.7.3 | devDependency | Type checking via `tsc --noEmit`. |
| @types/node | ^22.10.7 | devDependency | Node.js type definitions. |
| @types/react | ^19.0.7 | devDependency | React type definitions. |
| @types/react-dom | ^19.0.3 | devDependency | React DOM type definitions. |

## Database / seed path (optional; not required to build or run the demo)

The zero-credential storefront runs on `src/lib/catalog.ts` and sandbox drivers,
so these are only needed when wiring the real MySQL data model
(`prisma/schema.prisma`, `prisma/seed.ts`) in production.

| name | range | dependency / devDependency | why |
|---|---|---|---|
| @prisma/client | ^6.2.1 | dependency | Generated MySQL ORM client for `prisma/seed.ts` and the production data layer. |
| prisma | ^6.2.1 | devDependency | Schema, migration and `prisma generate` CLI. |
| tsx | ^4.19.2 | devDependency | Runs the TypeScript seed script `prisma/seed.ts`. |
