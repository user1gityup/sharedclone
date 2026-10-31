---
name: blitz-website-lane-plan-2026-10-25
description: User-approved trimmed lane plan for the 14-project website blitz (42 tasks -> lanes), roster B fast mode
metadata:
  type: project
---
# Website blitz lane plan (user-approved 2026-10-25 ~20:45Z)

Approved by user in chat: "Apply the trimmed plan (23 lanes) with the speed-ups: flattened waves, 6 parallel
builders, Sonnet for the 11 standalone lanes and Opus for the 12 group lanes. Merge the review branch and restart
pm; dispatch stays off until my final go." Scope = PM Top order 1-14; 42 dispatchable tasks (repo map:
scratchpad blitz-repo-map.json, copy summarized here). Close 6 tasks (below).

Engine limit found: one repo per dispatched task. So each "build once, copy to other folder" group = a primary
lane + a small copy lane in the second repo (copy lane depends on primary). Tell the user this in one line.

## Lanes (role: O = builder-opus, S = builder-sonnet). Repo base: commerce/canna/users build/ecom-final;
## green-energy-platform main; billboard-platform main (lead-intelligence-platform subdir); shared-brain main.
- L1  O canna   G1 adapter kit: ERP T-1bafd7a1, POS T-19ed31f3, vault T-c8bd2731. Reuse canna src/drivers/{erp,pos}.ts, canna src/lib/vault.ts, staging canna/.dsh-staging/fdd2585c (driver tests), commerce src/lib/{settings,crypto}.ts, billboard lib/settings.js
- L1c S commerce shipping adapters T-44fc04ef on the L1 kit. deps L1
- L2  O commerce G2 application model + admin queue T-ab66b0e9. Reuse commerce (wholesale)/wholesale/apply, canna src/lib/vendorApplications.ts, staging canna c9821007, 7be89d89
- L2c O canna vendor licence app T-305b5218 + B2B buyer flow T-cfcb2228. deps L2, L3
- L3  O canna   G3 compliance gap-fill T-631e73b7 + FIX failing test/checkout-wiring.test.ts:311 (purchase limit). canna src/lib/compliance/* already exists
- L3c S commerce age_gate cookie Secure T-c0e0b5ec (no deps)
- L4  O commerce G4 admin shell + ledger admin T-9307c7ee. Reuse billboard lib/nav, lib/notifications/dispatch.js, admin notifications page; commerce src/lib/notifications.ts; staging commerce storefront-shell 5c16297f
- L4c O canna storefront pages, notification centre, role nav T-54e09dfc. deps L4, L3. Reuse staging canna-nav-visibility, canna-notification-dispatch
- L5a O billboard(lead-intel) Evidence/isSynthetic + Prisma persistence T-a03ce747
- L5ac S green-energy-platform SunShare schema T-cb141ec0 (copy Evidence model). deps L5a
- L5b O canna Prisma migrations/MySQL seed T-e4ec1276. deps L3. Reuse staging canna-db-client, canna-schema-additions
- L6a O shared-brain pm record module: T-af9f057e, T-8b68240c, T-d0ab1b37, T-d9cf422d. Reuse pm roles.mjs, approvals
- L6b O shared-brain CRM: T-a9bf1b8f, T-c0654b62, T-21886e52. deps L6a
- L7  O billboard(lead-intel) scoring + pending review T-b7807854. deps L5a
- L7c O green-energy-platform WP7 T-bbc16438. deps L7, L5ac
- L8  O shared-brain multiselect/submit panel: T-6809f7f2, T-7f3ea863 (also batch-approve button)
- L9  O shared-brain status panel: T-cc3f964a, T-a73df977, T-163b105e, T-a8fe2cbb (reuse /api/blitz/monitor)
- L10 O commerce Playwright harness T-142bc2d2
- L10c O canna Playwright DoD T-d89f2b41. deps L10, L3
Standalone S (tag existing task meta.blitz): T-f498358e commerce, T-d1ce086c commerce, T-d71b80d8 canna (deps L3),
T-bf6f4f2c shared-brain, T-43da7fd2 lead-intel, T-0b8c0d89 lead-intel, T-7ab688ae GEP, T-8773e86d GEP,
T-f5067d6f GEP, T-afad3290 shared-brain, T-ff91600e shared-brain.
Close (status done, comment why): T-b9d3d3c2 (done, canna 16bd3aa), T-de3ac44a (done, pushed), T-e7415368 (replaced
by groups), T-d665fd6d (note), T-2163f729 + T-26b4ca91 (ordering/drag-drop live).

## Brief rules for every lane body (builders: Read/Edit/Write only, Bash DENIED by bridge-policy)
- Do NOT use Bash/PowerShell or run tests (a denied tool parks the run AWAITING_APPROVAL). pm commits your changes.
- Reuse sources are COPIED to ~\Documents\claudecode\blitz-runs\_reuse\<lane>\ (read there; never edit source repos).
- Work only inside the task worktree. Never push. Include acceptance criteria in body (Codex verifies against them).
- Lane task meta: {blitz:{repo:<abs path>, role:'builder-opus'|'builder-sonnet', depends_on:[task ids], covers:[orig ids], coding:true}}.
  Tag meta BEFORE requesting approvals (scope_hash includes the task).
- pm API: POST /api/tasks {project_id,title,body,meta,actor}; PATCH /api/tasks/:id {rev,actor,...}; statuses todo/in_progress/review/blocked/uncertain/done.
