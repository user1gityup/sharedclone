---
name: handoff-2026-10-05-0640-lead-scraper-public-opportunities
description: Public-opps live store + Leads preview tab done and queued (f619a71); Next.js mount (page + API + admin refresh + nav migration) written, uncommitted, untested in Next because dev server ran out of RAM
metadata:
  type: project
---
Handoff: handoff-2026-10-05-0640-lead-scraper-public-opportunities.md
Updated: 2026-10-05 09:40 UTC (all items fixed, 60e5607 queued)
Host: vmixlaptop2x6
Session: Claude Code desktop e6e38378 (prior: e5f29d87)
Model: Claude Opus 5.5
Owner: Claude Opus 5.5 (session claiming 2026-10-05, vmixlaptop2x6) - claimed; state verified: branch, 2 commits ahead of origin/main by 4, uncommitted files as listed, no dev server, 156 MB free RAM
Remote Control: off
Repo: ~/Documents/claudecode/billboard-platform, branch docs/leadforge-council-prompt (tracks origin)
Ask (user): playbook preset (done) -> live Opportunities place in Leads (done in preview) -> push live to git + billboard (iz3q.xyz) for multi-user testing.
User decisions: commit whole lead-intelligence-platform incl. live store; root untracked files "fix and include"; billboard = mount in Next with admin-only refresh; merge branch to main locally and queue main.
Committed + queued (NOT pushed): 5314fe4 lead-intelligence-platform/ (engine window expansion, re-recorded fixtures, store/opportunity-store.js + tests, leads-rfp preview tab, /shared/ui served); f619a71 DEPENDENCIES.md, PRISMA-CHANGES.md, config/env.example, .gitignore ignores .env*.pre-brain-sync-*. queue-build.mjs -> queued true, head f619a71.
Verified: engine node --test 54/54; vitest leads-rfp+presets 46/46; tsc presets.ts 0; preview :5175 tab browser-tested (71 live, 2nd refresh 0 new/0 changed/0 closed).
Uncommitted (written this session, NOT tested in Next):
- lib/publicOpportunities.js (live store at LIP_OPPORTUNITY_STORE or ~/.lip-data/public-opportunities.json, seeded from committed copy because deploy rsync --delete would wipe an in-tree store; background single-flight engine refresh)
- app/api/opportunities/route.js (GET, any signed-in user, canRefresh for ADMIN)
- app/api/admin/opportunities/refresh/route.js (POST, getCurrentAdmin, 202)
- app/(dashboard)/dashboard/opportunities/page.js (link-first table, stat cards, filters, admin Refresh live, polls every 5 s)
- components/dashboard/Sidebar.js FALLBACK_NAV + prisma/seedNav.js: "Public opportunities" in Metrics
- prisma/migrations/20261005090000_add_public_opportunities_nav/migration.sql: INSERT ... SELECT into Metrics, idempotent. Proven on local MySQL (:3306 docker billboard-platform-db-1): inserts once, rerun no-op.
Local DB side effects: migration applied locally; prisma/seedNav.js run locally (local nav was empty; now 11 sections).
Blocker: machine had 175-300 MB free RAM; next dev threw ERR_MEMORY_ALLOCATION_FAILED and hung compiling /api/opportunities. .next/cache (526 MB) deleted to retry. Dev server stopped; no preview running.
Test tokens: %TEMP%/lip-test-tokens.json holds 1 h local JWTs (admin + AD_BUYER, dev fallback secret) for cookie beacon_session; re-mint if expired (signSession in lib/auth.js, dev secret fallback).
Next: with RAM free, start preview billboard-dev, test GET /api/opportunities (401 anon, buyer canRefresh false, admin true), POST refresh (buyer 403, admin 202 then poll), page in browser; then commit, merge branch into main locally, queue main via gatekeeper helper.
Do not: push directly; run seedNav on prod (it deleteMany's nav); start a DSH run; submit anything; bypass Cloudflare.
Open: chart item 2 (render/opportunity-chart.js <40-row explanation, lane distribution); window expansion branch never exercised live (30-day window gave 71).
Push queue: push-requests.md has the earlier request plus f619a71.

## Update 2026-10-05 08:55 UTC — Claude Opus 5.5 (vmixlaptop2x6, claiming session)
Next mount TESTED and committed: a91de1e on docs/leadforge-council-prompt; main fast-forwarded locally to a91de1e (ahead origin/main 5); queue-build.mjs -> queued true, head a91de1e. NOT pushed.
Verified on next dev :3001 with local MySQL: GET /api/opportunities anon 401 / buyer 200 canRefresh false / admin 200 true; POST refresh anon+buyer 403, admin 202, 2nd POST started:false (single-flight); browser page as admin renders 71 live, Refresh live button ran a live run (34 s, ok, 71/0 new/0 changed/0 closed); anon page 307 -> /login; no console errors.
Fixed: vitest picked up 13 LIP node:test files (exit 1) -> excluded in vitest.config.js; vitest 313/313, node --test 123/123.
Local env issue (NOT fixed, classifier refused secret-store write): .env.local line 2 DATABASE_URL is a stale postgresql:// URL overriding .env's mysql one, so plain `npm run dev` 500s on any DB call. Workaround launch config billboard-dev-mysql (node --env-file=.env next dev -p 3001) in ~/Documents/claudecode/.claude/launch.json.
Next: user says session ending -> gatekeeper pushes main (a91de1e) + branch; then deploy to iz3q.xyz and run the nav migration there (never seedNav on prod). Open items unchanged: chart item 2, window expansion never exercised live.

## Update 2026-10-05 09:20 UTC — Claude Opus 5.5 ("fix all issues")
60e5607 on main (branch docs/leadforge-council-prompt moved to it), queued head 60e5607, NOT pushed. Closed: chart item 2 (decision/pipeline/confidence/lane summary, shortfall explanation, type+confidence per row, portal_index_only seeds listed); window expansion now tested (tests/window-expansion.test.js, collection stubbed to fixtures, 4/4); dashboard layout min-w-0 fixes page widening to 1760px at 800px viewport. vitest 313/313, node --test 129/129.
Still open: .env.local line 2 stale postgresql DATABASE_URL — classifier refused the write twice [Secret-Store Writes]; user must edit it or allow it. Push, prod deploy + nav migration wait for session end.
