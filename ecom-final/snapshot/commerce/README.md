# Commerce — Multi-Vendor Storefront

A complete standalone multi-vendor ecommerce storefront built with Next.js App Router, TypeScript, and Prisma (MySQL).

## Architecture

- **Authentication**: Verifies session tokens from the `users` service via EdDSA Ed25519 JWKS. Holds no signing key — verifier only.
- **Payments**: Four rails — Stripe Checkout, Stripe Connect (vendor payouts), Solana devnet (SOL/USDC), and manual ETH/BTC.
- **Mock mode**: All payment integrations default to sandbox mode when credentials are absent — the app starts and is clickable with zero configuration.

## Quick Start

```bash
npm install
cp config/env.example .env
# Edit .env with your DATABASE_URL at minimum
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts
npm run dev
```

Open http://localhost:3000.

## Running Tests

```bash
npm test
```

Tests use Node.js built-in test runner (`node --test --test-isolation=none`).

## Environment Variables

See `config/env.example`. Required:
- `DATABASE_URL` — MySQL connection string
- `USERS_JWKS_URL` — users-service JWKS endpoint
- `USERS_ISSUER` — expected JWT issuer
- `USERS_AUDIENCE` — expected JWT audience

All other variables (Stripe, Solana, object storage, SMTP) are optional — the app starts in sandbox mode without them.

## Build

```bash
npx tsc --noEmit
npm run build
```

Routes that read databases, cookies, or headers export `const dynamic = 'force-dynamic'` because the build has no database.
