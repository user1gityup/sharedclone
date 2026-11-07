# canna

A members-only cannabis retail (B2C) and wholesale (B2B) marketplace for
California, in one repository.

## What it is

- A storefront where retail customers browse a catalog, build a cart, and check
  out, and licensed wholesale buyers place bulk orders.
- Compliance-gated: every order runs a Metrc (California) check before release
  and writes a `ComplianceRecord` whether it passes or fails.
- Vendor vetting: applications capture a state licence number and are approved
  only after a manual licence-validity check.

## What it is not

- Not a shared platform and not an adapter layer. There is no core, no registry,
  no shared package. General merchandise lives in a separate `commerce` repo.
- Cannabis transaction data stays out of `commerce` by design.

## Authentication

Sessions are issued by a separate `users` service and verified here with its
public key over JWKS (`/.well-known/jwks.json`). This repo never mints tokens
and holds no signing key. Only EdDSA / Ed25519 is accepted; any other `alg` or
any non-OKP/Ed25519 JWK is rejected. Wholesale access additionally requires the
token's `amr` to show a satisfied second factor.

## Integrations

- POS: Dutchie and Treez, behind one interface.
- ERP: Distru and LeafLink, behind one interface.
- Compliance: Metrc, California, behind a `ComplianceDriver` interface.

## Payments

- Retail (B2C): Dutchie Pay and Treez Pay.
- Wholesale (B2B): crypto or ACH, plus invoiced/terms settlement.
- Deliberately not Stripe: card networks restrict cannabis.

## Local development

Requirements: Node.js 22+, and (for the database path only) a MySQL instance.

```bash
npm install
npx prisma generate
npm run dev        # http://localhost:3000
```

The app runs with zero credentials: every POS/ERP/compliance/payment driver uses
a sandbox when its key is absent, and the storefront shows a demo catalog from
`src/lib/catalog.ts` without a database. Recorded fixtures mean no live vendor
credentials are needed to run the tests.

### Environment

See `config/env.example`. Required in production: `DATABASE_URL`,
`APP_BASE_URL`, `USERS_JWKS_URL`, `USERS_ISSUER`, `USERS_AUDIENCE`, and
`INTEGRATION_VAULT_KEY` (the AES-256-GCM key that encrypts per-vendor
credentials in the database).

### Database (optional for the demo)

```bash
npx prisma generate
npx prisma db push     # create tables
npm run db:seed        # seed the demo catalog into MySQL
```

### Verify

```bash
npm run typecheck      # tsc --noEmit
npm run build          # next build (no database needed at build time)
npm test               # node --test
```

## Repository layout

```
app/                 Next.js app router: storefront pages and API routes
  api/               catalog, cart, checkout, auth verify, admin vendors
config/env.example   environment variables
prisma/schema.prisma MySQL data model
prisma/seed.ts       demo catalog seed (database path)
src/drivers/         POS, ERP, compliance, payment drivers (sandbox by default)
src/lib/             auth verifier, vault, units, order states, catalog, ...
src/types/           compliance and licence types
test/                node --test unit tests
```
