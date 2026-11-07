# Q56 duplicate detection - recommended merges (swarm-W23, Claude Opus 5.5, READ-ONLY)

Generated 2026-10-13 from a read-only pull of master pm on ndi2 (28 projects, 288 tasks), the vmixer local pm at 127.0.0.1:4480 (1 project, 4 tasks), and `git merge-base` in vmixer deepseek-harness. No pm writes made. **Every row needs user approval before anyone runs it (Q56).** Archiving the merged-in record is a separate Q55 recommendation and also needs approval.

Standard history-preservation method ("MOVE+LINK"): for each merged-in task, create or keep the target, add a comment on the target `Merged from <old id> (<old project>): <old status, checkpoint, source_ref, artifacts>`, copy artifacts with `artifact <target> <kind> <ref>`, then comment on the old task `Superseded by <target> in <project>`. The old record is never deleted or edited. Status changes or archiving only after approval (Q55).

## Recommended merges (11)

| # | keep id | merge-in ids | reason | history-preservation method |
|---|---|---|---|---|
| 1 | P-bce84b85 `pm` | P-0fb0126c `make pm function` | Empty project (0 tasks, no description) created 2026-10-03. Same scope as `pm` ("This app"). | No tasks to move. Comment on a pm umbrella task (e.g. T-34c6db4e) recording that P-0fb0126c was absorbed, with its creation date and creator. Archive P-0fb0126c after approval (Q55); do not delete it. |
| 2 | T-21cf6af5 (ndi2 P-c4b7ecad dsh-bridge, review) | T-4e79abe6 (vmixer local P-2106af0a, review) | Same task: "WS-2a grants + approvals + 2f browser roles (dsh-sandbox ws-2a)", same worktree/branch ws-2a. | MOVE+LINK across hosts. Copy the local task's comments, artifacts and run/session refs into a comment on T-21cf6af5. Comment on the local T-4e79abe6 `Superseded by T-21cf6af5 (ndi2 master)`. |
| 3 | T-48320e09 (ndi2 dsh-bridge, review) | T-7a1fe5fa (vmixer local, review) | Same task: WS-2b lifecycle + 2e notify, ws-2b. | Same as row 2. |
| 4 | T-e53eeb61 (ndi2 dsh-bridge, review) | T-8038a9f3 (vmixer local, review) | Same task: WS-2c outputs + merge, ws-2c. | Same as row 2. |
| 5 | T-c4a91808 (ndi2 dsh-bridge, review) | T-e47c04f8 (vmixer local, review) | Same task: WS-2d boot/Gatekeeper supervision draft, ws-2d. | Same as row 2. Once rows 2-5 are done, P-2106af0a on the vmixer local pm holds nothing that the master lacks. Retire it (Q55) and keep the local pm.db read-only as an audit copy. |
| 6 | P-cc980c27 `Lead Intelligence/RFP Scraper` | P-e1d78870 `linkedin-lead-intel` (T-0571ebb1, T-b54cf301, T-f5d165cb, T-87565e57, T-a469ac31) | Q24/Q48 make Lead Intelligence/RFP Scraper the one standalone lead project. linkedin-lead-intel is a spec workflow for the same product. **Caveat (user decides):** Q52 puts physical people and companies (LinkedIn contacts) in Contact Leads under P-fe6adf5a Event Contact CRM. If the LinkedIn spec is about contacts rather than opportunities, the target should be Event Contact CRM, cross-linked to Lead Intel. | MOVE per task: create each task in the target under a parent sub-task "Lead Intelligence/RFP Scraper › LinkedIn Lead Source" (body `Moved from <id> (linkedin-lead-intel)` + blockers + bridge seq refs 341/370 + run b2048c5c log path). Comment `Superseded by ...` on each old task. Keep all 4 blocked statuses, since they wait on the user. Archive the empty P-e1d78870 only after approval. |
| 7 | P-cc980c27 `Lead Intelligence/RFP Scraper` (under T-af9f057e Lead Management) | T-e9e77d76 LeadForge build (brain-projects, in_progress) | LeadForge (billboard-platform feat/leadforge, Makati business-lead funnel) is lead-generation work that belongs in the standalone lead project (Q24/Q48), not in the brain-projects mirror. | MOVE: new task "Lead Management › LeadForge (billboard-platform)" with `Parent: T-af9f057e`, `Moved from T-e9e77d76 (brain-projects)`, milestones M0 76bf2bc / M1 e39bde4 / M2 blocker (missing keys), owner, worktree and branch. Comment the supersede note on T-e9e77d76. Do not change its in_progress status until the owner session agrees. |
| 8 | T-932d6880 Git Delivery › deepseek-harness (push-queue) | T-0e17ae19 (head 478ebb005f), T-211d11c9 (head 9be7bd6375), T-37a750c9 (head 99df2c5899) | All 3 are blocked mirrors of push-requests.md entries for the same branch, feat/heterogeneous-teammates. Verified read-only: 478ebb005f and 9be7bd6375 are ancestors of origin 60db0a40e7, so both are already pushed. 99df2c5899 is not on origin: the user dropped it on 2026-09-28 for ndi2's fix 3dae333595 (push-requests.md line 856, entry closed 2026-09-29). Its leftover commit 253138f4d2 is superseded by T-932d6880's current state (ahead 1, e96ac5e311). T-0e17ae19 and T-211d11c9 also share an identical title. | MOVE+LINK: comment on T-932d6880 listing each old id, head SHA, filed time and its verified fate (pushed / dropped plus backup ref backup/pre-reconcile-20260929 = 9b4db91659). Comment `Superseded by T-932d6880` on each of the 3. Q55 archive recommendation for all 3 (deliverable verified on origin or user-dropped). |
| 9 | T-984cc99a "Continue RC + vmixer DSH fix" (live-sessions, blocked) | T-72806bbb (brain-handoffs-other, todo, title = handoff filename) | Handoff mirror duplicate. Both come from handoff-2026-09-27-2039-rc-vmixer-fix-dsh.md (one mirrored via session local_ff23e4e9, one via the file) and list the same 3 items left to the user. | MOVE+LINK: comment on T-984cc99a with T-72806bbb's source_ref (handoff file path, mtime). Comment the supersede note on T-72806bbb. Keep T-984cc99a's blocked status. |
| 10 | T-34c6db4e "Project Manager Completion" (pm, in_progress) | T-1e67aa7a (brain-handoffs-other, blocked; handoff-2026-09-28-0417-pm-completion-operational.md), T-7f508f03 (live-sessions, done; session local_ba748b7e) | Same work stream mirrored three times: the plan sharded-coalescing-bonbon, its handoff file, and its live session. | MOVE+LINK: comment on T-34c6db4e with each mirror's source_ref, checkpoint and next action. Comment the supersede note on both. T-7f508f03 stays done (session record). T-1e67aa7a's next action (brain-handoffs connector) is checked against current pm before it is closed. |
| 11 | T-b509ce30 "Handoff - DSH incomplete runs: audit then fix" (brain-handoffs-accounts-quota) | T-4baa0e27 "Second Claude seat: MERGED into DSH run-failures audit" | The merge is already declared in the source handoff and in T-4baa0e27's own body ("SUPERSEDED ... MERGED into handoff-2026-09-21-0218"). Only the pm link is missing. | Comment `Superseded by T-b509ce30` on T-4baa0e27, and a back-reference on T-b509ce30 (commit b43949011c). Q55 archive recommendation for T-4baa0e27. |

## Possible merges - user review, lower confidence (3)

| # | keep id | merge-in ids | reason | history-preservation method |
|---|---|---|---|---|
| 12 | T-2fbe5cc4 DSH Integration › AWS seat + quota manager, build side | T-00b07d90 DSH Integration › Continue AWS seat multi-account build | Both are swarm moves today (from T-5539a722 and T-dca4206e). They track one work stream with the same next unit (quota-aws src/sdk.ts adapter, Leg 13 of handoff-2026-09-27-1440). One is the handoff file, the other the paused ndi2 session local_56c4b14f. | MOVE+LINK: copy T-00b07d90's session id and test counts (98/98, 17/17, 935/935) into a comment on T-2fbe5cc4. Comment the supersede note on T-00b07d90. |
| 13 | T-df6c31fc handoff-2026-09-28-0630-dsh-as-harness-both-hosts.md (brain-handoffs-other) | T-c19fd883 pm UI build (pm) | Partial overlap only: T-c19fd883 is item 6 of that handoff. **Recommend NO merge.** Instead add a cross-link comment on each, since T-c19fd883 is a real sub-scope and the mirror is the umbrella. | Cross-link comments only. |
| 14 | T-4df505db Handoff - CheaperInference swarm failure | T-616749af DSH council 9d86397e run record | Same incident (2026-09-20 CheaperInference swarm failure). T-616749af is the council-run record that investigated it. **Recommend link, not merge**, because run records are evidence (Q58). | Cross-link comment on both, plus `artifact T-4df505db run 9d86397e-38be-4329-bc3f-bbb6aafa6bda`. |

## Checked, not duplicates (no action)

- **The 3 "DSH Integration" parents** (T-941cd0e9 AWS, T-ff1e2233 Nonprofit, T-bf6f4f2c Lead Intel) share a title but cover different scopes in different projects. They are intentional per-project sub-areas.
- **Today's swarm-created projects** (AWS/Cloud Worker Expansion, Bonsai Connector, Cannabis Commerce, Distributed GPU Pooling, Event Contact CRM, Event Manager, Kimi Local LLM, Lead Intelligence/RFP Scraper, Local Server, Nonprofit AI Credits, Solar Platform, Testing & Benchmarks): no project duplicates another.
  - Kimi and Bonsai are separate by Q47.
  - Event Contact CRM and Lead Intel are separate by Q52.
  - Cannabis Commerce (0 tasks) and ecom-final are separate by Q50. ecom-final is the Ecommerce build (users/commerce/canna inspections), so cross-link it later rather than merge.
- **Solar Platform › Solar SAM (T-193c4155 and its 4 sub-tasks) vs project solar-sam-integration WP0-WP7:** the scopes overlap. T-193c4155 states that the WPs deliberately stay in P-da8954a6 (Q8/Q11/Q43), so no merge. Optional later: fold P-da8954a6 under Solar Platform once WP7 closes.
- **Swarm "Moved from" tasks:**
  - T-5539a722→T-2fbe5cc4
  - T-dca4206e→T-00b07d90
  - T-ccbe2f2d→T-abfae316
  - T-47fa0ae0→T-6284f3cc
  - T-267d1f99→T-3db47ed3
  - T-324d4327→T-6f6aa44e

  These are sanctioned moves, not duplicates. Each old task should carry its `Superseded by` comment from the moving worker; that is not verified here. No old task was moved twice.
- **Fuzzy matches that are not duplicates:** T-53f181f3 vs T-baa4d461 cite different handoffs (manual routine vs automatic quota handoff). T-a667bf0a vs T-6b1d54d7 only share a referenced file.
- **Shared-brain MEMORY.md index** has duplicate index lines (dsh-sandbox swarm vmixer ×2, DSH headless perms ×2, Bridge replication ×2, pm bridge autostart ×2, Ecom subagent lanes ×2, pm + tools launch ×2). These are brain index lines, not pm records, and were reported only.

Created by swarm-W23 (Claude Opus 5.5). Decision: Q56 (Q55 for archive follow-ups).
