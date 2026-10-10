---
name: handoff-2026-10-06-0820-lead-tool-live-data-and-jobs-query
description: Lead Intelligence wired to live store (uncommitted); now building a jobs+RFP skills query preset and launching it in the lead tool
metadata:
  type: project
---
Handoff: handoff-2026-10-06-0820-lead-tool-live-data-and-jobs-query.md
Updated: 2026-10-06 02:55 local (currency + full-page tables DONE, tests green, uncommitted)
Host: vmixlaptop2x6
Session: Claude Code desktop 09272378
Model: Claude Opus 5.5
Owner: Claude Opus 5.5 (vmixlaptop2x6, new session) CLAIMED 2026-10-06; state verified: 60e5607 + uncommitted files present, store skills-jobs-rfp.json present
Remote Control: off
Repo: ~/Documents/claudecode/billboard-platform (main = origin/main 60e5607 + all work below UNCOMMITTED)
Part 1 done (user approved): Leads/RFPs/dashboard/rfp-applications read live store via shared/lib/liveRecords.js (+useLiveStore.js); fake applications/desktop-agent-sessions deleted; leads/rfps.json -> dashboard/__tests__/fixtures; dashboard/preview/build-data.mjs. Tests were green (vitest 319, node 129). Commit+queue NOT yet approved by user.
Part 2 ask: "using the ChatGPT playbook logic (engine/presets/public-opportunities-us.playbook.md) create a job & RFP query from the skills observed here, launch it inside the lead tool, send me a link to the results".
Part 2 done (untested by suites):
- engine/adapters/providers/remote-jobs.js (Remotive, Remote OK, Jobicy keyless feeds; items typed lead via _record_type, listing_kind job); registered in adapters/api.js
- engine/index.js buildRecord: type = raw._record_type || preset.record_type
- engine/pipeline/opportunity-verification.js: job mode (no deadline; NO_POSTED_DATE/JOB_TOO_OLD; title lane or 2 lanes else OUT_OF_SCOPE; job_location_ok gate; location_open; lane JOB; decide JOB -> CONDITIONAL/GO/WATCH)
- engine/presets/skills-jobs-rfp.js (skill lanes: ai-agents, fullstack-js, maps-geospatial, data-scraping, energy-ev, commerce-signage, platform-infra secondary; SAM/Grants/NevadaEPro/OregonBuys + 3 job boards); registered in presets/index.js
- engine/cli/public-opportunities.js: --preset flag; non-default preset store = shared/data/<preset>.json
- Live run 08:22 UTC: exit 0, 232 raw, 49 qualified (34 RFP: 15 WATCH, 11 CONDITIONAL, 7 NEEDS_REVIEW, 1 PARTNER; 15 jobs: 2 GO, 7 WATCH, 6 CONDITIONAL), 179 NO_GO. Store written: lead-intelligence-platform/shared/data/skills-jobs-rfp.json. Chart: engine/skills-jobs-rfp-chart-2026-10-06.md. Fixtures saved: engine/fixtures/raw/skills-*.json.
Known issues: Jobicy query "ai" -> HTTP 400 and one failed query drops the whole board (make fetchLive skip a failed query; drop "ai" tag - llm/react/nodejs/typescript/gis/machine-learning all 200). OregonBuys 0 items. Jobs are few (Remotive 17, RemoteOK 8 raw).
Next: 1) fix Jobicy per-query tolerance, rerun live; 2) lead tool: leads-rfp/preview/server.mjs serve /api/opportunities?store=skills-jobs-rfp (+ refresh with --preset) and add a "Skills: jobs & RFPs" tab in preview app.js/index.html reusing renderOpportunities with a per-view store; 3) run engine tests (node --test engine/tests) + vitest (preset count/type tests may need skills-jobs-rfp); 4) preview_start lip-leads-rfp, browser-verify tab; 5) give user link http://localhost:5175/ (tab) and offer/publish an Artifact of the chart for a shareable link; 6) ask user to approve commit + queue of parts 1+2.
Do not: push; submit/apply to anything; bypass Cloudflare/paywalls; run seedNav on prod; exceed board API terms (link back + credit the board).

## 2026-10-06 08:40 UTC Claude Opus 5.5 (vmixlaptop2x6, new session) - Next 1-5 DONE
- remote-jobs.js: a failed query is skipped; board throws only if every query fails. Jobicy "ai" tag -> "machine-learning".
- Live rerun exit 0: 391 raw, 130 qualified (34 RFP, 96 jobs: Jobicy 81, Remotive 10, Remote OK 5), 257 NO_GO, collection_errors []. Store + chart + fixtures rewritten.
- Chart: job rows read "none (job, open until filled)" instead of "undefined (TIME UNCONFIRMED)".
- leads-rfp preview: server ?store=public-opportunities|skills-jobs-rfp (else 400), per-store refresh (--preset); app.js per-store state, new tab "Skills: jobs & RFPs (live)" with Kind filter (Jobs / RFPs), "via <board>" credit, "Open until filled", #<view> deep link.
- Tests: new engine/tests/skills-jobs-rfp.test.js (3); preset-id lists updated. node engine 132/132 real node tests, vitest 320/320.
- Browser: http://localhost:5175/#skills shows 130 live (34 RFP / 96 jobs filters OK), Public Opportunities tab 71 live, no console errors except deliberate 400 probe.
- Known: Jobicy row YipitData salary max $1.7M is the board's own data. OregonBuys still 0.
Part 3 ask (user chose): every RFP/job query is its own saved search with own store + rerun + edit; all 3 granularities (bundle, lane, per-term) + old presets migrated as "full" searches; build steps 1-6 everything (engine, migrate, server API, UI list/rerun/history, editor w/ dry run + before/after diff, tests+browser).
Part 3 DONE + TESTED: engine/searches/{catalog,index}.js, engine/cli/searches.js (migrate|list|run <id..>|--all|--dry-run|--def-file|--json), provider matched_terms tagging, http.js fetch cache, mergeRun dropped_by_edit, index.js opts.presetConfig. engine/tests/searches.test.js 8/8; engine node suite 71/71 (before searches test added).
Part 3 LIVE: migrate created 146 defs in shared/searches/ (2 full, 10 bundle, 15 lane, 119 term). run --all live exit 0, 0 errors, 19 searches 0 live; stores in shared/data/searches/<id>/{store.json,runs/}; full searches keep shared/data/public-opportunities.json + skills-jobs-rfp.json (backups of pre-run stores in %TEMP%/po-store-backup.json, sk-store-backup.json).
Part 3 WRITTEN, UNTESTED: leads-rfp/preview/server.mjs /api/searches (GET list, GET meta, GET/PUT :id, POST create/duplicate, POST :id/archive, POST :id/run[?dry=1], POST run-all {ids}; writes loopback-only; node --check ok). leads-rfp/preview/searches-view.js (list/detail/results/definition/run history+compare/editor w/ dry run) - NOT yet wired.
Part 3 LEFT: (a) app.js: import { initSearches, showSearches, render } from "./searches-view.js"; VIEWS.searches = { searches: true, title: "Saved searches" }; initial view = location.hash.slice(1).split("/")[0]; loadAndRender("searches") -> showSearches(hash id); render() -> if view searches call searches render; initSearches({contentRoot, escapeHtml, notify, formatDate, formatCurrency, isActive: () => state.view === "searches"}); switchView sets #searches. (b) index.html tab button data-view="searches" "Saved searches". (c) styles.css: .sv-group td (bold, surface-alt), .sv-def-row, .sv-src(--off), .sv-x, .sv-add, .sv-suggest-chip (button chip), .sv-cmp-grid (4 cols, wrap), .sv-cmp-list, .sv-errors (danger box), .sv-bad, .sv-h2, .sv-primary, .sv-row--open, .sv-form grid, .sv-lanes. (d) restart preview lip-leads-rfp (server.mjs changed), browser-verify list/detail/rerun one term search/edit+dry run+save/history compare/duplicate/archive, console clean. (e) full tests: node --test engine/tests/*.test.js + npx vitest run (from billboard-platform). (f) update README/CLAUDE notes briefly; ask user approval to commit + queue parts 1-3.
Known: sk-bundle-remote-gis-jobs 22 live mostly non-GIS (Jobicy tag noise; consider filters.lanes [maps-geospatial]).
Next: do Part 3 LEFT (a)-(f).

## 2026-10-06 Claude Opus 5.5 (vmixlaptop2x6, new session) CLAIMED Part 3 LEFT (a)-(f)
Verified: HEAD 60e5607, parts 1-3 uncommitted as listed, 146 search defs, searches-view.js present+unwired (no "searches" in app.js/index.html/styles.css), preview pid 33820 on 5175 runs old server.mjs.
## 2026-10-06 02:20 local Claude Opus 5.5 (vmixlaptop2x6) - Part 3 LEFT (a)-(e) DONE, (f) README done
- app.js/index.html/styles.css wired: tab "Saved searches", #searches and #searches/<id> deep links, initSearches ctx as specced; sv-* styles added (+ responsive cmp grid).
- Stale preview pid 33820 stopped; lip-leads-rfp restarted via preview_start (new server.mjs).
- Browser-verified: list 146, detail deep link, rerun sk-term-grants-gov-geospatial (run history 2), duplicate -> editor, add suggested term, dry run (2 would be live, diff shown), save as v2 w/ note (version history), rerun copy (run history + Compare), archive (ARCHIVED/Restore), back + tab switching; console clean. Test copy deleted afterwards.
- Fix: Grants.gov + NSF records had no currency -> values rendered as PHP. Added currency "USD" in engine/adapters/providers/grants-gov.js + nsf.js; verified $ on rerun. Existing stores keep old records until their next rerun.
- Tests: node --test engine/tests/*.test.js 71/71, npx vitest run 320/320 (exit 0 both).
- README: Saved searches bullet in lead-intelligence-platform/README.md.
Next: user approval to commit + queue parts 1-3 (nothing committed). Optional: rerun --all to refresh currency on stored grant rows.
- 2026-10-06 Claude Opus 5.5: committed eef2854 (parts 1-3) on billboard-platform main, queued to gatekeeper (queued:true). Not pushed. Handoff complete pending push.
- 02:45 Claude Opus 5.5: CURRENT: currency fixed in all stores (po preset carry_raw_fields + "currency"; run --all x2, 0 errors, 0 rows missing currency) - UNCOMMITTED. User asked results full-page, no frame: styles.css (:has(.lip-opp-table) no max-width/frame, wrap, sticky th at --lip-topbar-h), app.js ResizeObserver sets --lip-topbar-h, searches-view.js foundBy() folds >3 terms. In progress: still ~90px horizontal overflow at 1024px; browser had cached app.js. Next: hard-reload, fit columns, verify 1024+375, tests, commit+queue (user approved commit+queue for this work stream).
- 02:55 Claude Opus 5.5: DONE+verified: full-page result tables (no frame/width cap, Fit merged into Type/decision, Found by folds >3 terms, sticky header at --lip-topbar-h, <=760px rows become labelled cards, tabs wrap). 0 horizontal overflow at 1024 and 375 on saved/opportunities/skills tabs; console clean. node 71/71, vitest 320/320. Uncommitted (5 code files + 438 refreshed store files); commit+queue awaits user yes.
- 03:00 Claude Opus 5.5: committed 3a61f5e (currency + full-page tables), queued (supersedes eef2854 request, same branch). Not pushed.
## 2026-10-06 03:15 Claude Opus 5.5 - NEW SCOPE DECIDED, NOT STARTED (context >150k, fresh session)
User ask: "build out campaigns via the scraping web build method" + "no way to create a new search". Audit (read-only) found:
- "Campaign" defined nowhere in specs/brain; "scraping web build method" phrase nowhere. Spec now at dsh-presets/lead-intel/platform.yaml (Downloads copy gone); S9 Presets / S10 Sources (:31,:36-37) closest.
- New search EXISTS (Saved searches > "New search") but locked to bases skills-jobs-rfp/public-opportunities-us and their 7 fixed sources; no custom URL/site, no lead presets, no schedule (engine/searches/index.js:93-120).
- generic-web/sitemap/rss/browser adapters are fixture-only (engine/adapters/generic-web.js:27-29 etc); Manila/General Web/Custom presets fixture-only.
- S9 presets/page.jsx + S10 sources/page.jsx: Next pages, no route/server, in-memory only. Units 5174/5177/5178/5179/5181 not running.
USER CHOICE: campaign = FULL OUTREACH FLOW (search group + targets + contact lists + per-lead outreach status, find -> contact).
Implied build order (not yet approved by user): 1 live generic-web/sitemap adapter + "custom URL/site" source in New search; 2 lead presets as saved-search bases; 3 campaign model (searches[], schedule, targets) + store + /api/campaigns + Campaigns tab in 5175; 4 contacts list + outreach status pipeline per lead (no sending of messages without explicit per-action user approval); 5 scheduler.
Next: fresh session - confirm build order/scope with user (one question), then build step 1.

## 2026-10-06 Claude Opus 5.5 (vmixlaptop2x6, new session) CLAIMED campaigns scope
Verified: main 3a61f5e ahead 2 of origin, tree clean, 5175 listening pid 28236. Next: user confirms build order, then step 1.
USER APPROVED build order 1-5 as proposed. Step 1 in progress (Claude Opus 5.5, session 31261f94).
User asked mid-session: find brain outreach flow for Manila businesses via Grab, make sure campaign run is built. Found: LeadForge (project_leadforge.md, reference_leadforge_api_findings.md, billboard-platform LEADFORGE-COUNCIL-PROMPT.md on branch docs/leadforge-council-prompt). Spec only: no leadforge/ code on any branch; DSH preset leadforge/council-run exists, no run recorded. Open: city, vertical, what is sold. Awaiting user choice on how it maps to campaigns. Step 1 not started (read-only so far).
USER CHOSE: Full LeadForge in billboard app (council-prompt build, Milestone 0 budget model first). Supersedes lead-tool step 1 for now.
