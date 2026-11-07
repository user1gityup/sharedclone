---
name: handoff-2026-09-30-2246-g2-leads-rfp-listing
description: G2 unit (Leads Workspace + RFP listing) mid-build in billboard-platform lead-intelligence-platform, session at 97% quota
metadata:
  type: project
---

Handoff: handoff-2026-09-30-2246-g2-leads-rfp-listing.md
Topic: DSH swarm G2 unit — Leads Workspace + RFP/Opportunity listing
Host: ndi2
Session: RUN-20260930-002 (DSH seat-cwd, model Claude Sonnet 5)
Repo: ~/Documents/claudecode/billboard-platform, branch docs/leadforge-council-prompt (uncommitted)
Updated: 2026-09-30 22:46

State: Found real platform root is `lead-intelligence-platform/` (not `lead-platform/` as the original brief said — other units already converged on this path, confirmed via existing dashboard/, shared/types, shared/fixtures). Tailwind content globs only cover app/**,components/** so NO Tailwind utility classes work inside lead-intelligence-platform/ — must use styled-jsx + --lip-* CSS vars (confirmed from dashboard/shell/AppShell.jsx).

Done this pass: lead-intelligence-platform/leads-rfp/src/lib/badges.js + tests/badges.test.js (score bands, status labels, currency/date formatters). Pre-existing from an earlier pass (kept, not touched): src/lib/filterSort.js, src/components/Toolbar.jsx, src/components/FilterPanel.jsx, tests/filterSort.test.js — NOTE Toolbar/FilterPanel currently use Tailwind dark: classes that WILL NOT RENDER (see constraint above) — still need rewriting to styled-jsx.

Next action: rewrite Toolbar.jsx + FilterPanel.jsx (styled-jsx, drop redundant theme toggle since AppShell's topbar already has one), then build RecordTable.jsx, RecordCard.jsx, BulkActionsBar.jsx, LeadDetailDrawer.jsx, leads/page.jsx, rfps/page.jsx (listing only, links to /rfps/[id] which G3 owns — do not build that route), README.md, and a file://-openable static preview under leads-rfp/preview/ (index.html+app.js+styles.css+data.js) mirroring the dashboard/preview/ pattern already shipped by G1 — embed leads.json/rfps.json fixture content inline in data.js (fetch() is blocked on file://).

Do not touch: anything under lead-intelligence-platform/rfp-detail or rfps/[id] (G3), dashboard/ (G1), answers-vault/ rfp-applications/ (other groups), package.json/lockfiles/.env/CI/prisma schema (host-commit rules).

No git push — commit only, append push-requests.md per standing policy. Session was at 97%/61%(week) quota when this was written; if this session ends here, the remaining files above are the todo list for the next session/agent.
