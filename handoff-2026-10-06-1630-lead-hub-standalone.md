---
name: handoff-2026-10-06-1630-lead-hub-standalone
description: Lead Intelligence hub split out of billboard-platform into its own repo; one server, 4 app feeds, no placeholders
metadata:
  type: project
---
Handoff: handoff-2026-10-06-1630-lead-hub-standalone.md
Updated: 2026-10-07 03:40 (Claude Opus 5.5: integration pass DONE, committed 1a211b9 + d02c4db local, no push)
Host: vmixlaptop2x6 | Session: Claude Code desktop e6e953d3 | Model: Claude Opus 5.5
Owner: Claude Opus 5.5 (vmixlaptop2x6, Claude Code desktop, resumed 2026-10-06 eve) | Remote Control: off
Ask (user, verbatim gist): lead app lives on its own, services all other apps; admins see leads+RFPs globally without logging into each app; fully functional, no placeholders, no dead links, real data.
User picks: own folder + own repo (URL/host not final -> all env-driven); NO login, loopback/LAN, writes loopback-only; serves billboard, green-energy, ecomm, skills; empty sections made real (start empty).
Repo: ~/Documents/claudecode/lead-intelligence (git init, local identity Beacon Dev, no remote). 4fc8a24 = copy of billboard feat/leadforge 5367bf8 LIP + leadforge core. Spec: BUILD-SPEC.md in repo root (the contract).
Baseline: node --test 140/140 (engine, vault, agent, monitor, rfp-apps, ui-lib); vitest 94/98 (4 React .jsx smoke fails - jsx trees to be removed per spec).
Audit (Explore): 5 servers no auth; answers-vault/server.mjs serves billboard parent repo incl .env over LAN (source copy still in billboard - not fixed there); port clash 5179; ~20 placeholders; no app/tenant field; real leads only 98 remote jobs, business-lead presets fixture-only.
billboard-platform untouched except earlier 5367bf8 on feat/leadforge. :5176 leadforge-leads-rfp preview still running.
Plan: phase 1 core agent (root server.mjs, unit api.mjs loader, appTag, review overlay, feeds, shell nav); phase 2 parallel unit agents (leads-rfp+dashboard+rfp-applications | answers-vault+desktop-agent+run-monitor | presets+sources); then browser verify all nav on one port, commit, no push.
Do not: push; touch billboard main checkout; show fixtures as data; real API spend.
DONE: 2590328 OSM leads (billboard 1038, energy 500, ecomm 500 live); a67410e EPERM rename retry; f2c1bde vault/agent/monitor real (62/62); 689e75a core hub :5180 (npm test 194+76 exit 0). Prelim refresh done: PO 285/69 live, skills 445/131, searches 4920/1237.
fc45e6b presets/sources/dashboard vanilla on live data (npm test 194+76 exit 0); C note handoff-2026-10-06-1700-lip-presets-sources-dashboard.md. Verified 17:45 on fresh server :5187: /api/apps 0.39s, /api/feed/all 0.08s, /dashboard/ /presets/ /sources/ 200. No agents running, no server left up.
NEXT = integration pass (one agent or session): nav-mount on B/C pages, remove leftovers (useLiveStore, shared/ui jsx, fixtures, types, NOTES), assign list from real owners, searches CLI honor LIP_DATA_DIR, delete run-monitor/server.mjs, commit shared/data stores?, delete leads-rfp/leads,rfps *.jsx + RecordWorkspace.jsx + tests/smoke.test.js (import deleted dashboard/shell), add #leads/<id> #rfps/<id> detail routes in leads-rfp (dashboard/lib/links.js uses them), C spec tests __tests__/*.spec.mjs not in node --test (wire into npm test), energy preset re-rank industrial first (user may want), full click-through + 375px, then send user http://localhost:5180/.
Was running (background subagents of session e6e953d3, all commit locally, never push, stage own files only):
- Phase1 core: root server.mjs :5180, unit api.mjs loader, appTag+apps.json, review overlay, /api/apps /api/feed/:app /api/records/:id, shell nav, app filter, bulk persist, rfp-applications persistence (added by message).
- 2A engine: OSM Overpass live business-lead provider + presets (lanes billboard-smb, energy-solar, ecommerce) + live prelim run each.
- 2B: answers-vault (real CRUD + file upload), desktop-agent sessions, run-monitor live from ~/.dsh + engine runs.
- 2C: presets + sources vanilla pages (overrides, real Run/Recrawl via CLI), dashboard live, .jsx removed.
- Prelim live refresh (bg shell): both presets + searches run --all, log data/prelim-run.log.
User ask 16:40: "add more real data with prelim runs, phase out placeholders now".
Integration DONE: 1a211b9 code (detail routes, /api/review/owners, CLI LIP_DATA_DIR, leftovers deleted, BUILD-SPEC), d02c4db shared/data stores. npm test exit 0 (node 196/196, vitest 76/76). Browser :5180 all 15 nav + 20 dashboard detail links, 1280 + 375px: 0 overflow, 0 404 (only a deliberate bogus-id probe), /.env /.git/config /data/review.json 404, /../x 400, non-loopback write 403 read 200. Server :5180 left running (preview lead-intelligence-hub).
Next: user answer on energy-solar-rooftops re-rank (industrial first, 48/500); LeadForge view still shows Makati fixture dry run (labelled) - spec says no fixtures as data, user call.
