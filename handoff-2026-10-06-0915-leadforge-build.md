---
name: handoff-2026-10-06-0915-leadforge-build
description: Full LeadForge build in billboard-platform (user choice 2026-10-06); Milestone 0 budget model in progress on feat/leadforge worktree
metadata:
  type: project
---
Handoff: handoff-2026-10-06-0915-leadforge-build.md
Updated: 2026-10-06 16:20
Host: vmixlaptop2x6
Session: Claude Code desktop (new session, claimed 2026-10-06 from 31261f94)
Model: Claude Opus 5.5
Owner: Claude Opus 5.5 (vmixlaptop2x6) - CLAIMED 2026-10-06 by new session (verified e39bde4 clean, :3002 + pm :4480 up, 5175/5176 free); doing LeadForge tab in leads-rfp preview
Remote Control: off
Ask: user wants campaigns = full outreach flow; chose "Full LeadForge in billboard app" (spec LEADFORGE-COUNCIL-PROMPT.md, notes project_leadforge.md + reference_leadforge_api_findings.md). Supersedes lead-tool step 1 (handoff-2026-10-06-0820) for now.
Repo: ~/Documents/claudecode/billboard-platform, worktree .claude/worktrees/leadforge, branch feat/leadforge off main 3a61f5e (main ahead 2, queued, untouched). node_modules = junction to main's; .env.local copied.
Done (uncommitted, tested): leadforge/package.json (type module); leadforge/budget/{rates,estimator,ceiling,meter,index}.js; leadforge/__tests__/budget.test.js 11/11 (npx vitest run leadforge). Baseline reproduced: 72 Nearby + 715 Details, archetype total $0.16, metered sites $16.3, 10k metered $509.86.
M0 DONE + verified, COMMITTED 76bf2bc on feat/leadforge (local, not queued, not pushed): + app/api/leadforge/budget/route.js, app/(dashboard)/dashboard/leadforge/page.js, Sidebar "LeadForge budget" (Dashboards), leadforge/README-STANDALONE.md. vitest 331/331 exit 0 (x2). Browser on leadforge-dev :3002 (session launch.json, worktree cwd, --env-file=.env): GET 200 total $0.16 72/715, POST grabScrape 400, anon 403, Metered -> $17.60, 375px no overflow. Test admin JWT (riley@beacon.dev, 2h) in %TEMP%/lf-test-token.txt.
Then: milestones per prompt sec 10 (dry-run funnel on fixtures -> discovery 1 tile -> signals+scoring -> generator -> outreach dry-run -> arms/metrics). Nothing sent to a real business; real sends behind operator switch default off.
User picks (DECIDED): LGU Makati, vertical restaurants/cafes, offer = billboard ads with demo site as hook.
Do not: push; scrape Grab/FB/IG; cold DMs; real API calls without user OK; touch main checkout.
Next: fresh session (context >150k). USER ASK: show LeadForge results directly in the LEAD APP (Leads Workspace, no-login preview, lead-intelligence-platform/leads-rfp/preview, :5175) - NOT pm, NOT the login-gated billboard dashboard. Plan (nothing written yet): in the WORKTREE copy add GET /api/leadforge/dry-run to leads-rfp/preview/server.mjs (dynamic import ../../../leadforge/index.js + budget/index.js, run funnel on fixtures, ?target=N), new leadforge-view.js (stats, lane chips, prospects table, calls table, target input + Run; reuse lip-table/lip-chip/lip-btn/lip-page-title classes), app.js VIEWS.leadforge + loadAndRender branch, index.html tab "LeadForge (Makati)". Serve worktree copy on new port (e.g. 5176) via launch.json config in main .claude/launch.json; browser-verify, give user http://localhost:5176/#leadforge, commit on feat/leadforge. Do not touch main checkout code. M1 committed e39bde4; M2 live 1-tile user-approved but BLOCKED on API keys (no GOOGLE_MAPS_API_KEY/AWS/CSE in env or IntegrationSetting). pm restarted 23:12Z (bg node server.mjs), task T-e9e77d76 updated. leadforge-dev :3002 running. Test admin JWT re-signed in %TEMP%/lf-test-token.txt.
M1 (this session): leadforge/{schema.prisma.fragment,fixtures/makati-restaurants.js,sources/{fixtureSources,entity}.js,signals/{rules,ttl}.js,scoring/score.js,queue/funnel.js,index.js,__tests__/funnel.test.js}; app/api/leadforge/dry-run/route.js; dashboard/leadforge/dry-run/page.js; Sidebar link.
M0 CORRECTION (verified Google docs 2026-10-06): websiteUri/phone/hours/userRatingCount are Places ENTERPRISE (1,000 free/mo, $20/1k), not Pro; Review object has NO owner-reply field. rates.js detailsPro->detailsEnterprise, tests updated. 715 Details still fits free.

LEAD-APP TAB DONE (2026-10-06 16:20, Claude Opus 5.5): committed 5367bf8 on feat/leadforge (local, not queued, no push). leads-rfp/preview in worktree: server.mjs GET /api/leadforge/dry-run (no login), leadforge-view.js, tab "LeadForge (Makati)". Served by launch.json config leadforge-leads-rfp on :5176 (running). Browser-verified http://localhost:5176/#leadforge: 9 qualified/18 prospects/3 tiles at 500; target 3 -> Target reached; 375px no overflow; no console errors; leadforge vitest 27/27. Main checkout code untouched (only main .claude/launch.json gained the config).
Next: M2 1-tile live discovery, still BLOCKED on API keys (GOOGLE_MAPS_API_KEY etc.) - needs user.
