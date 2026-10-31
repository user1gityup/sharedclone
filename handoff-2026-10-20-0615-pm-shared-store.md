---
name: handoff-2026-10-20-0615-pm-shared-store
description: Design for one shared pm project/task store across vmixer2o2 and ndi2 - diff report done, design choice awaits user (HUB-ASK)
metadata:
  type: project
---
Id: 2026-10-20-0615-pm-shared-store
Updated: 2026-10-20 07:03Z
Host: vmixer2o2
Session: Claude Opus 5.5, side session of local_8310c8bc-2bc5-41c5-b459-723623efbe87
Remote Control: unknown (not changed)
Owner: Claude Opus 5.5 (vmixer2o2)
Ask: one shared pm project/task store for vmixer2o2 + ndi2; investigate, propose, build only after user picks
Status: LIVE + VERIFIED 2026-10-20 07:03Z. Both pms on sync code (vmixer pid 24588, ndi2 pid 1164 deployed by Remote for PM agent). ENABLE-PM-SYNC on vmixer PASS: 35 projects / 381 tasks match both ways, 0 missing; dup T-67ba9f12 archived + comment. Backups pm-data/backup-pre-sync-20261020-064031.db and -070258.db. Cosmetic: vmixer shows peer as vmixlaptop2x6 (first alias of 10.0.0.241 in bridge-peers.json). Built by 9 lanes; pm suite 309/0, e2e 6/6.

## Why they differ
Not a sync failure: nothing ever synced tasks. The 2026-10-12 replica.mjs pulls only
bridge mail (bridge.db: bridge_messages + token hashes). pm.db (projects, tasks,
comments, artifacts, events, runs, order_scopes, order_drafts) is per host.
pm-live.md names ndi2 as THE pm host; vmixer agents were meant to use PM_URL to ndi2,
but sessions on vmixer wrote to loopback 127.0.0.1:4480, so vmixer grew its own small pm.
No pm MCP server is registered on vmixer (~/.claude.json, ~/.codex/config.toml).

## Diff (fetched 2026-10-20 06:10Z via REST, read-only)
- ndi2 (http://10.0.0.241:4480, ~\.claude\pm-data\pm.db): 32 projects, 367 tasks (2026-09-16 .. 2026-10-19 12:48Z)
- vmixer (127.0.0.1:4480, ~\.claude\pm-data\pm.db): 3 projects, 14 tasks (2026-10-13 .. 2026-10-19 09:38Z)
- Shared task ids: 0. Shared project ids: 0. Shared source_ref: 0.
- Projects: vmixer `dsh-bridge` P-2106af0a (archived) has same NAME as ndi2 P-c4b7ecad (different id -> UNIQUE(name) clash on any merge).
  vmixer-only: `dsh-pm-uiux` P-f2186d57 (ndi2 equivalent: "DSH Project Manager — UI/UX Improvements" P-fb8f4161), `wyze-frigate-nvr` P-a637179e.
- vmixer tasks that DUPLICATE ndi2 tasks (identical title, different id) - 5:
  T-4e79abe6=T-21cf6af5, T-7a1fe5fa=T-48320e09, T-8038a9f3=T-e53eeb61, T-e47c04f8=T-c4a91808 (WS-2a..2d; vmixer ARCHIVED, ndi2 WAITING),
  T-67ba9f12=T-26b4ca91 (PM ordering UI samples; vmixer PAUSED, ndi2 WAITING)
- vmixer-ONLY tasks - 9: T-25bb8b1f Wyze/Frigate swarm build (WAITING); T-2b7172f0, T-d1598d85, T-08a996df, T-1bd000fd,
  T-4bddea60, T-51864820, T-ff3d69e4 = PM ordering backend S1..S7 (READY, but work is built + live per
  handoff-2026-10-18-pm-ordering-backend.md -> stale); T-bf8ca991 Optional Funnel for vmixer pm (READY, deferred).
- Order columns exist on both (sort_order/order_override/top_order), all NULL on both -> no manual order to merge yet.
- ndi2-only: everything else (362 tasks incl. ordering-related T-2163f729, T-a8fe2cbb).

## Hazards for any replication (from store.mjs/order-schema.mjs)
- projects.name UNIQUE; comments/artifacts/events use AUTOINCREMENT ints -> collide across hosts.
- claimNext/lease_until is a local atomic claim -> two writable copies can double-claim a task.
- order_scopes.rev is per-scope optimistic lock; two hosts reordering one scope need a winner rule.

## Options (ETAs estimated, not measured)
A. ndi2 = the one pm; vmixer pm proxies /api/projects|tasks|runs|events|order* to ndi2 (bridge stays local),
   plus one-time merge (below). One DB, order columns free, no conflict logic. Cost: vmixer pm writes fail
   while ndi2/LAN down. ~1.5 h build+test.
B. A + one-way read replica on vmixer (extend replica.mjs pattern: rev triggers on pm tables, pull
   changesSince incl. order cols + order_scopes rev). Reads survive ndi2 outage; writes still go to ndi2. ~3.5 h.
C. Two-way multi-master row replication (rev + origin per row, LWW, uuid ids for comments/artifacts/events,
   per-scope order winner, claim fencing). Works fully offline both sides; most code and most risk. ~7 h.
Merge (all options): import 9 vmixer-only tasks into ndi2 via REST with source_ref `vmixer:<old id>`
(ordering S1-S7 imported as COMPLETE or archived - user call), map projects
dsh-bridge->P-c4b7ecad, dsh-pm-uiux->P-fb8f4161, create wyze-frigate-nvr; 5 duplicates: keep ndi2 rows, add a
comment linking the vmixer id. vmixer pm.db left untouched (backup kept) - retired by proxy, never hand-edited.

## Next action
Wait for user's pick via hub (HUB-ASK sent as this session's final). Then build in pm/ (brain), tests,
HUB-ASK before any pm restart on either host. No push (gatekeeper at session end).
Do not: hand-edit pm.db; restart pm without HUB-ASK; push.
Scratch data: session scratchpad local-*.json / remote-*.json + diff.mjs (not in brain).

## Deploy order (needs user OK - restarts pm on both hosts)
1. Code reaches ndi2 only through git: gatekeeper push of the brain at session end, ndi2 brain-sync pull.
2. ENABLE-PM-SYNC.cmd on ndi2 (backup -> restart -> sync now -> verify), then on vmixer2o2 (same + archives dup T-67ba9f12).
   Dry run on vmixer today = FAIL/DIFF as expected (neither host serves /api/sync yet).
Known limits: claims/leases not fenced across hosts; whole-row newest-updated_at wins (concurrent edits of one task on both hosts: older lost); events/runs/runners/order_drafts stay local.
