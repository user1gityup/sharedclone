---
name: green-energy-platform-context
description: "SunShare green-energy partner app — why it exists, its deploy target, and the two-agent git arrangement with claudecode-11"
metadata: 
  node_type: memory
  type: project
  originSessionId: fbf48b7f-1711-4f9d-91ad-83afb325a793
  modified: 2026-08-21T16:38:33.984Z
---

`green-energy-platform` (product name **SunShare**) is a standalone Next.js app at
`~\Documents\claudecode\green-energy-platform`, built from the spec in
`~/Downloads/nrg.md`. Community-funded solar: hosts list unused roof/land, investors
fund the install, energy revenue splits between platform, host, and investors.

Sibling to `billboard-platform`, not part of it. Its own repo, database, and deploy.
Reuses billboard's patterns by copying, never by importing across repos.

**Deploy target (live and confirmed working):** https://66ifs.xyz on the same DreamHost
VPS (vps71503) as billboard, but under its **own** system user `dh_yeyqht` — NOT
billboard's `dh_b2edht`. GitHub remote `nrg.git`; Basic Auth with the same password as
billboard's iz3q.xyz. App port 3100; local MySQL container host port 3307 (billboard
uses 3000/3306). Server DB is **MySQL 8.0.41**, not MariaDB. GitHub secrets:
`DEPLOY_SSH_KEY` and `WEB_PASSWORD` (note: GitHub cannot rename a secret — a
wrongly-named one must be deleted and recreated).

**Never run `npm run db:seed` against production.** The seed creates
`admin@sunshare.test` / `password123` — a hardcoded admin credential visible in the
repo. `prisma/seed.js` now refuses (exit 1) when `NODE_ENV=production`; verified firing.
Create real admins by hand.

**Why:** user wanted to go live fast and work on logic locally while Claude built the
functional scaffolding, rather than stepping through a long incremental build.

**How to apply:** treat billboard-platform as the reference implementation for infra
decisions here. See [[dreamhost-deploy-constraints]] before touching deploy config.

## Git arrangement

A separate Claude session acts as **git lead** for both repos and is the only
one that commits or pushes. This session runs no git commands and pings the
lead at commit points.

Do NOT hardcode the lead's session name — it rotates (seen as claudecode-11,
then -99, then -e3, sometimes two live at once each believing they're lead).
Find the current one with `ListAgents` and confirm before relying on it; if two
appear, tell each about the other and let them settle it rather than relaying.

The lead owns `.github/workflows/deploy.yml` and `DEPLOY_SETUP.md`, runs
`npm run build`, and handles the GitHub secrets. Pushing to `main` fires the
live deploy, so a push is never routine.

## kWh rewards pivot (spec: ~/Documents/claudecode/deepseek_markdown_20260822_94e2d7.md)

Adds kWh loyalty credits + transaction-level AML. Corrections to the spec — the
document is unreliable on all of these:

- Claims TypeScript + shadcn/ui + PostgreSQL. Repo is **JavaScript, hand-rolled
  Tailwind, MySQL/MariaDB**. Only the emerald/teal/lime design note is right.
- Says remove KYC. **KYC is NOT being removed** — it stays. Identity verification is
  satisfied by **Stripe Connect onboarding**, not a custom review queue. AML here is
  transaction-risk monitoring sitting *alongside* KYC, never a replacement. Keep
  wallet sanctions screening (Stripe never sees a Solana address); skip name
  screening for Connect-verified users.
- Says Float for kWh fields. Use **Decimal** — balances are derived by summing the
  ledger, and float accumulation breaks reconciliation. Float is fine for riskScore.
- "Remove or archive Investment" -> **archive**. Dropping is unsafe: PayoutLine
  cascades from it, PayoutLine has no userId so Investment is the only path to a
  payee, and closeIfFullyFunded is the only FUNDING->FUNDED transition.

**Still open, do not build:** whether credits redeem for at most what a user paid in
(store credit) or can exceed it tracking platform performance (securities question).
Payout/conversion UI and any copy asserting redemption value are on hold.

**No outbound money movement exists anywhere in the repo** — no treasury keypair, no
signing, Stripe installed but never imported, nothing ever decrements a balance.
markPayoutPaid() only increments User.balanceUsd.

Work lives in a git worktree at Documents/claudecode/gep-pivot (branch
feat/kwh-rewards-pivot, own node_modules) to avoid sharing a tree with the peer.
See [[shared-workdir-collisions]].
