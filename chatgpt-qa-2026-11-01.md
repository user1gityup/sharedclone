# ChatGPT Q&A 2026-11-01 (101 questions)

Written by Claude Sonnet 5.5. Source: pm blocked tasks in Flow Pac projects. Answers go into the pm task (see message instructions).

## Evidence Closure — Free Claude + Local LLM (12 Tasks) (P-244afbc3)
1. [T-381325d5] Canna: seed retail, wholesale and admin users (seed has zero User rows)
   Q: Canna seed users: run prisma db seed against the dev MySQL? A) (recommended) Yes, run on dev MySQL B) Start a local MySQL first, then run C) Skip, seed manually D) Defer
2. [T-8b776dde] Recover LinkedIn Q1-Q35 answers from ChatGPT or ndi2 run b2048c5c
   Q: Recover LinkedIn Q1-Q35 answers (ndi2 run b2048c5c): A) (recommended) Fetch via ChatGPT bridge/history B) Fetch run.log from ndi2 yourself C) Re-answer all fresh D) Skip
3. [T-7aa40ff6] Write canonical LinkedIn decision record after Q1-Q35 recovered
   Q: Write canonical LinkedIn decision record: A) (recommended) After Q1-Q35 recovered B) Write with access mode only C) Draft now, mark provisional D) Defer
4. [T-5248a9f5] LinkedIn access mode: fetch A-D wording from ndi2 seq 370, ask user
   Q: LinkedIn access mode wording (ndi2 seq 370): A) (recommended) ChatGPT presents its A-D wording as one card, you answer B) Use wording from this list (see LinkedIn access mode question) C) Skip D) Defer
5. [T-77cf7503] Resume LinkedIn spec workflow (no outreach) after Q1-Q35 and access-mode decision
   Q: Resume LinkedIn spec workflow, no outreach: A) (recommended) Go after Q1-Q35 and access mode B) Go now with defaults C) Spec only D) Defer
6. [T-63a99d24] Copy bridge log b2048c5c run.log from ndi2 into shared brain
   Q: Copy bridge log b2048c5c run.log from ndi2 to shared brain: A) (recommended) Yes, copy via bridge file transfer B) You copy it manually C) Not needed if ChatGPT has the answers D) Skip

## Cannabis Commerce (P-c2d53150)
7. [T-c8bd2731] Credential vault port: DB-backed IntegrationSetting, VendorIntegrationCredential, admin rotation UI
   Q: Run rotate against real MySQL? A (rec): approve using local MySQL :3306 with a throwaway canna_verify DB. B: user runs on ndi2/vmixer2o2. C: accept fake-store tests as sufficient, mark done. D: defer.
8. [T-e4ec1276] Database path: Prisma migrations, MySQL seed, package.json from DEPENDENCIES.md, CI gate
   Q: Run migrate deploy + db:seed against real MySQL? A (rec): approve throwaway DB on local :3306. B: user runs on both hosts. C: accept offline checks, mark done. D: defer.
9. [T-d89f2b41] Playwright E2E: definition-of-done proof (B2B Metrc->ERP->ACH once under retry; B2C Dutchie Pay)
   Q: Run test:e2e:dod? A (rec): approve starting users+canna+MySQL for a run. B: user starts services. C: accept as built-not-run, mark done. D: defer.

## Lead Intelligence/RFP Scraper (P-cc980c27)
10. [T-9b7fcb6f] LinkedIn Lead Source › Recover LinkedIn Q1-Q35 answer set from prior ChatGPT conversation
   Q: Recover LinkedIn Q1-Q35 from prior ChatGPT conversation: how? A) (recommended) ChatGPT re-lists Q1-Q35 and your past answers from its own history B) Pull from ndi2 run b2048c5c log C) Re-ask all 35 fresh D) Skip, decide only access mode
11. [T-d3881b31] LinkedIn Lead Source › Save canonical LinkedIn decisions to shared brain with provenance
   Q: Save canonical LinkedIn decisions to shared brain with provenance: go once answers exist? A) (recommended) Yes, after Q1-Q35 are recovered/answered B) Save only the access-mode decision C) Save drafts now, mark unverified D) Defer
12. [T-317c3a45] LinkedIn Lead Source
   Q: Rules say no LinkedIn access/scraping/outreach/build at this stage. Q: how to proceed? A (rec): keep parked as spec-only parent; B: write spec doc only; C: approve a build scope; D: archive
13. [T-93781e10] LinkedIn Lead Source › User decision: LinkedIn access mode (review Q1, options A-D)
   Q: LinkedIn access mode (review Q1): A) (recommended) Official/licensed API and exports only B) Manual-assist, you click, tool drafts C) Browser automation of your own logged-in session D) No LinkedIn source, use other sources
14. [T-3e1110b3] LinkedIn Lead Source › Resume LinkedIn Lead Intelligence spec workflow (headless-permissions Step 4)
   Q: Resume LinkedIn Lead Intelligence spec workflow (headless-permissions Step 4): go? A) (recommended) Go after Q1-Q35 and access mode decided B) Go now with defaults C) Spec only, no code D) Defer
15. [T-a54fae95] Lead Management › LeadForge (billboard-platform)
   Q: Q: M2 needs GOOGLE_MAPS_API_KEY/AWS/CSE keys. A (rec): user adds Google Maps key via admin Integrations page; B: skip live discovery, stay fixtures-only; C: supply AWS+CSE keys too; D: cancel M2
16. [T-e8fcdd7b] LinkedIn Lead Source › Decide whether seq 370 review report moves from ndi2 run scratchpad into brain
   Q: Q: copy seq 341/370 review report from ndi2 scratchpad into brain reports/? A (rec): yes copy; B: no, leave in scratchpad; C: copy summary only; D: delete

## solar-sam-integration (P-da8954a6)
17. [T-cb141ec0] WP1: SunShare schema - SAM enum, SolarScenario, SolarTariff, Evidence, isSynthetic
   Q: WP1 SunShare schema overlaps blitz lane L5ac T-97d03640. A) (recommended) Close this in favor of L5ac B) Run here, cancel L5ac C) Run here after L5ac finishes, merge migrations D) Defer
18. [T-7ab688ae] WP2: PySAM CLI worker + NSRDB weather cache + CEC library
   Q: Exit criterion needs real PySAM runs and SAM Desktop reference values on ndi2; CEC CSV pins (sha256/commit) are null so library fails closed. Also main holds 97b1e11 (lib/solar/sam) while worktree branch blitz/C-f3676722/T-7ab688ae (1d0b31a, workers/sam, 53 files) is a different unmerged implementation. Which to adopt? A) Keep main lib/solar/sam, run it on ndi2 and vendor+pin CEC CSVs (recommended) B) Merge the T-7ab688ae worktree branch (workers/sam) instead and verify on ndi2 C) Reject both, rebuild D) Other
19. [T-8773e86d] WP3: SunShare SAM provider in lib/solar/assessment.js + admin shortlist
   Q: Real PySAM/SAM Desktop benchmark path was never run (PySAM not installed here, 4 integration tests skipped; stack runs the REFERENCE_IMPLEMENTATION calculator). How to close the exit criterion? A) Run WP3 real-PySAM integration + benchmarks on ndi2 after WP2 env lands (recommended) B) Accept reference-engine tests as sufficient for now C) Send back to todo to add SAM Desktop reference fixtures D) Other
20. [T-af486971] WP6: root location app as Lead Intel enrichment adapter
   Q: Enrichment adapter is unit-tested with evaluate mocked; live end-to-end vs claudecode :3000 needs a Google Maps key, and admin route/UI are not wired to createAnalysisAdmin. Next? A) Provide Maps key/approve live check, then wire admin route (recommended) B) Accept mocked end-to-end as sufficient and wire route only C) Send back to todo for route wiring D) Other. Note: engine suite has 1 unrelated red test (see T-118af80b)
21. [T-78272326] Blitz L7c: WP7 lead->SunShare handoff, scoring, proposal drafts
   Q: Code+tests green (main bde9c17 vitest 593/0, 24 lead lib tests + 6 ingest route tests) but lead storage uses inbox+Setting, not dedicated tables, and UI/Kanban state-keeping and live sender are untested in a browser; acceptance 4,5,6,7,11 only partial. Decision? A) Accept inbox storage for now, mark done after a browser check (recommended) B) Require dedicated lead tables (schema migration) before done C) Send back for rebuild of untested acceptance items D) Other

## Local Server (P-43024818)
22. [T-d8be0c21] Hardware Upgrades
   Q: Question: Which T7810 upgrade set do you want (needs purchase + physical install)? A) Pick GPU first (decides PSU), then RAM (recommended) B) RAM only (cheapest) C) All three with a budget cap you name D) Defer/park this task.
23. [T-41c644a9] Hardware Upgrades › RAM
   Q: Question: What RAM target for the T7810? A) Double current capacity, DDR4 ECC reg, matching vendor (recommended) B) Fill all slots, you give budget C) Keep current RAM D) Defer/park this task.
24. [T-8e69b7db] Hardware Upgrades › GPU
   Q: Question: Which GPU for the T7810? A) Use the Tesla already referenced (no purchase) (recommended) B) Buy a new consumer GPU (name model+budget) C) Keep current GPU D) Defer/park this task.
25. [T-4b449c8e] Hardware Upgrades › Power
   Q: Question: PSU plan? A) Wait for GPU decision, then size PSU (recommended) B) Fit a 1000W+ PSU now with 8-pin PCIe leads C) Keep current PSU D) Defer/park this task.
26. [T-f84f3ba6] Cooling/Rack
   Q: Question: Cooling/rack direction? A) Tesla shroud+blower fan in current T7810 chassis (recommended) B) Move to a rack chassis (name model) C) Skip cooling work D) Defer/park this task.
27. [T-125d882d] NAS/JBOD
   Q: Question: NAS/JBOD scope? A) USB backup disk first (cheapest, one device) (recommended) B) SAS HBA + JBOD enclosure (name budget) C) Use cloud/existing storage instead D) Defer/park this task.
28. [T-f2f516df] Cooling/Rack › Tesla cooling
   Q: Question: Tesla cooler type? A) 3D-printed duct + 40mm blower (recommended) B) Shroud with PWM fan C) Passive, workstation airflow only D) Defer/park this task.
29. [T-dd92be87] Cooling/Rack › Chassis
   Q: Question: Chassis/rack? A) Keep T7810 tower, no move (recommended) B) Rack chassis (name model/location) C) Open-air bench frame D) Defer/park this task.
30. [T-647eb6df] Cooling/Rack › Noise
   Q: Question: Noise limit/method? A) 35 dBA at 1 m using a phone meter (recommended) B) 45 dBA at desk C) No limit D) Defer/park this task.
31. [T-bdf4fa86] NAS/JBOD › SAS
   Q: Question: SAS controller? A) LSI 9207-8i HBA IT-mode with SFF-8087 cables (recommended) B) Use onboard SATA only C) Defer D) Defer/park this task.
32. [T-59a542d1] NAS/JBOD › HDD
   Q: Question: Drive layout? A) 4 drives, ZFS/Storage Spaces mirror pair (recommended) B) Single large disk, no redundancy C) Defer D) Defer/park this task.
33. [T-2846f745] NAS/JBOD › USB
   Q: Question: USB storage role? A) External USB3 backup drive mounted as E: (recommended) B) Transfer-only stick C) Defer D) Defer/park this task.

## Testing & Benchmarks (P-acd883a1)
34. [T-abfae316] llama benchmarks: real-LLM tests on vMixer llama router (8090)
   Q: Question: Run test 2 (DSH provider path) on the local llama seat? A) Yes, local-only council round on Qwen3.6 seat, no paid seats, once wiring owner makes seat live (recommended) B) Skip test 2, close task with tests 1/3/4 C) Run direct curl to 8090 instead of DSH path D) Park.
35. [T-6284f3cc] token benchmark + live DSH router-wiring test
   Q: Question: Approve DSH restart + council and swarm contest run? A) Yes at a time you choose, free/local seats only (recommended) B) Verify by code review/tests only, no live run C) Run on a separate port with a copy of DSH D) Park.

## VIZIO V51 — Home Assistant Remote Proof of Concept (P-cdd3631f)
36. [T-feaf702f] Codex: build and physically verify isolated V51 Home Assistant EQ remote
   Q: Question: How should the V51 prototype be physically verified? A) You observe LED/audio while the agent sends each command (recommended) B) Build UI + mock tests only, mark hardware UNTESTED C) Reassign to CheaperInference run as already planned, verify later D) Park.

## DSH — DeepSeek WebChat via OpenClaw Bridge (P-735a01cf)
37. [T-c4a47167] 00 — Revised charter: unified WebChat model menu + extensible WebChat Council
   Q: Q: Charter needs live DeepSeek multi-turn proof + integration into the real DSH picker/council (staged prototype in dsh-runs/idle-2026-10-31/T-c4a47167/out only, node tests 67/67). A (rec) approve logged-in DeepSeek/ChatGPT live proof and integrate via the T-7b0a88ba/T-adbb5464 DSH code; B accept prototype as design reference and close; C re-scope charter to spec only; D drop.
38. [T-9682e7fb] 01 — Read-only audit: OpenClaw transport, DSH model picker and existing council
   Q: Approve edits to deepseek-harness for DeepSeek WebChat adapter (audit step 01)? A) (recommended) Approve, after the other agent's dsh-run.mjs edit is committed B) Approve read-only audit only C) Approve using the 67/67 scripted deliverable as base D) Defer
39. [T-e1dfde3e] 02 — Reuse OpenClaw bridge: DeepSeek browser chat adapter
   Q: Approve edits to deepseek-harness for DeepSeek browser chat adapter (step 02)? A) (recommended) Approve, same gate as step 01 B) Approve adapter only, no picker changes C) Hold until 01 audit reviewed D) Defer
40. [T-eec50820] 03 — Unified DSH model selector: WebChat group + Council option
   Q: Approve unified DSH model selector (WebChat group + Council option, step 03)? A) (recommended) Approve after 01 and 02 land B) Approve selector UI only C) Hold for design pick D) Defer
41. [T-2f059062] 07 — Live 2-member Council E2E proof, regression and gated rollout
   Q: Authorize live E2E? A) yes, user logs into both sites in the DSH browser and approves a council run (recommended) B) defer until commits are merged and DSH restarted C) mocked-only proof (does not satisfy task) D) cancel
42. [T-3f878cb3] 06 — Verify true browser/WebChat usage limits and fail-closed spend policy
   Q: Q: Research half needs real provider usage-limit measurement. A (rec) approve logged-in ChatGPT+DeepSeek measurement session; B research public docs/terms only; C accept code half, limits stay unknown, close; D drop research half.

## Ecommerce (P-c0f0d78a)
43. [T-142bc2d2] S6 coverage gaps: untested Section 30 items
   Q: Rerun S6 matrix (target 41 + new specs all green) needs live S6 stack (identity :5190, DB). Run it now? A. Yes, start stack and run (Rec.) B. Accept unit+list only C. Defer D. Other
44. [T-3e6db6ba] Real QuickBooks Online adapter
   Q: Sandbox-company live QBO test needs QBO sandbox creds. A. Accept fixture tests as done (Rec.) B. User supplies QBO sandbox creds for live test C. Defer D. Other
45. [T-3e91fd6c] Ledger journal backfill for pre-ledger orders
   Q: Running backfill against shared S6 DB writes data. Run it? A. Yes, dry-run then apply (Rec.) B. Accept tests only C. Defer D. Other
46. [T-1dc5640d] Clean S6 test data from shared DB
   Q: Needs live shared DB. A) provide/approve shared DB instance (recommended) B) use local MySQL test DB C) defer D) drop

## Solar Platform (P-87bab895)
47. [T-193c4155] Solar SAM
   Q: Q: Solar SAM parent tasks only track WPs (P-da8954a6); WP2/WP3/WP5/WP6/WP7 are built+merged in green-energy-platform, WP0 (T-b016d0e5, real NSRDB probe/PySAM run) and WP1 (T-cb141ec0) still open. How to close this shell? A) (recommended) close as tracking-only once WP0+WP1 reach done, no new build here; B) re-open WP0 DSH run and pick seats; C) close now, accept WP status as-is; D) other.
48. [T-7cfeaefa] Solar Monitor V1
   Q: Q: 'Solar Monitor V1' has a one-line body, no spec/repo/acceptance criteria. What should it deliver? A) (recommended) a short written spec/research doc first, then build; B) code in green-energy-platform; C) code in a new standalone repo; D) drop/archive the task.
49. [T-93f53190] Solar Monitor V2
   Q: Q: 'Solar Monitor V2' has a one-line body, no spec/repo/acceptance criteria. What should it deliver? A) (recommended) a short written spec/research doc first, then build; B) code in green-energy-platform; C) code in a new standalone repo; D) drop/archive the task.
50. [T-33bc54a3] California Plug-in Solar
   Q: Q: 'California Plug-in Solar' has no spec, repo or acceptance criteria. What should it deliver? A) (recommended) a short research/spec doc first; B) code in green-energy-platform; C) code in a new repo; D) archive the task.
51. [T-37e83f88] Community Battery Network
   Q: Q: 'Community Battery Network' has no spec, repo or acceptance criteria. What should it deliver? A) (recommended) a short research/spec doc first; B) code in green-energy-platform; C) code in a new repo; D) archive the task.
52. [T-1a2d50ca] Solar SAM › Production Modeling (PySAM)
   Q: Q: Solar SAM parent tasks only track WPs (P-da8954a6); WP2/WP3/WP5/WP6/WP7 are built+merged in green-energy-platform, WP0 (T-b016d0e5, real NSRDB probe/PySAM run) and WP1 (T-cb141ec0) still open. How to close this shell? A) (recommended) close as tracking-only once WP0+WP1 reach done, no new build here; B) re-open WP0 DSH run and pick seats; C) close now, accept WP status as-is; D) other.
53. [T-f369f24c] Solar SAM › Data Infrastructure (NSRDB/CEC/tariffs)
   Q: Q: Solar SAM parent tasks only track WPs (P-da8954a6); WP2/WP3/WP5/WP6/WP7 are built+merged in green-energy-platform, WP0 (T-b016d0e5, real NSRDB probe/PySAM run) and WP1 (T-cb141ec0) still open. How to close this shell? A) (recommended) close as tracking-only once WP0+WP1 reach done, no new build here; B) re-open WP0 DSH run and pick seats; C) close now, accept WP status as-is; D) other.
54. [T-8dc0166b] Solar SAM › Financial Modeling
   Q: Q: Solar SAM parent tasks only track WPs (P-da8954a6); WP2/WP3/WP5/WP6/WP7 are built+merged in green-energy-platform, WP0 (T-b016d0e5, real NSRDB probe/PySAM run) and WP1 (T-cb141ec0) still open. How to close this shell? A) (recommended) close as tracking-only once WP0+WP1 reach done, no new build here; B) re-open WP0 DSH run and pick seats; C) close now, accept WP status as-is; D) other.
55. [T-3cfd10a0] Solar SAM › Testing/Validation
   Q: Q: Solar SAM parent tasks only track WPs (P-da8954a6); WP2/WP3/WP5/WP6/WP7 are built+merged in green-energy-platform, WP0 (T-b016d0e5, real NSRDB probe/PySAM run) and WP1 (T-cb141ec0) still open. How to close this shell? A) (recommended) close as tracking-only once WP0+WP1 reach done, no new build here; B) re-open WP0 DSH run and pick seats; C) close now, accept WP status as-is; D) other.
56. [T-f54aa126] Solar Monitor V1 › Tests
   Q: Q: 'Solar Monitor V1 › Tests' has a one-line body, no spec/repo/acceptance criteria. What should it deliver? A) (recommended) a short written spec/research doc first, then build; B) code in green-energy-platform; C) code in a new standalone repo; D) drop/archive the task.
57. [T-f33174bc] Solar Monitor V1 › Integrations
   Q: Q: 'Solar Monitor V1 › Integrations' has a one-line body, no spec/repo/acceptance criteria. What should it deliver? A) (recommended) a short written spec/research doc first, then build; B) code in green-energy-platform; C) code in a new standalone repo; D) drop/archive the task.
58. [T-74b3f061] Solar Monitor V2 › Tests
   Q: Question: what should "Solar Monitor V2 � Tests" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).
59. [T-f2a20814] Solar Monitor V2 › Integrations
   Q: Question: what should "Solar Monitor V2 � Integrations" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).
60. [T-143ad31e] California Plug-in Solar › Regulations
   Q: Question: what should "California Plug-in Solar � Regulations" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).
61. [T-f7b56eae] California Plug-in Solar › Equipment
   Q: Question: what should "California Plug-in Solar � Equipment" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).
62. [T-bde8e23d] California Plug-in Solar › System Design
   Q: Question: what should "California Plug-in Solar � System Design" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).
63. [T-eeef76b2] California Plug-in Solar › Pilot Testing
   Q: Question: what should "California Plug-in Solar � Pilot Testing" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).
64. [T-d45be1ea] Community Battery Network › Storage Design
   Q: Question: what should "Community Battery Network � Storage Design" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).
65. [T-8babb9b5] Community Battery Network › Energy Optimization
   Q: Question: what should "Community Battery Network � Energy Optimization" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).
66. [T-0e68cb9e] Community Battery Network › Regulatory Review
   Q: Question: what should "Community Battery Network � Regulatory Review" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).
67. [T-c658ca3d] Community Battery Network › Pilot Testing
   Q: Question: what should "Community Battery Network � Pilot Testing" deliver? A) (recommended) Research/design doc in green-energy-platform/docs, no code; B) Mock-based code module + tests in green-energy-platform; C) Fold into parent task, close this stub; D) Other: user writes spec. No repo, spec or acceptance criteria exist (body is one line).

## Blitz Complete — Headless Swarm & PM Mission Control (P-03a8c18b)
68. [T-5b2ab2a5] Blitz L8: PM multiselect + submit panel (BLITZ-09 picker, bulk-select to Weight Router, batch approve)
   Q: Blitz L8 PM multiselect + submit panel: what now? A) (recommended) Retry lane once with fresh task_scope B) Build directly outside Blitz C) Keep on hold D) Drop
69. [T-27cd1e83] Blitz L9: PM status panel: mission control, Resources & System, machine diagnostics, Home sections
   Q: Blitz L9 PM status panel (13 failed attempts, hold B): what now? A) (recommended) Split into small tasks and build directly B) Lift hold and retry lane as-is C) Keep hold D) Drop
70. [T-cc3f964a] BLITZ-10 P2: Live mission control and final GUI verification
   Q: BLITZ-10 P2 live mission control: A) (recommended) Resume after BLITZ-09 T-6809f7f2 is reviewed B) Review BLITZ-09 now so this can start C) Build outside L9 with no fake data D) Defer

## PM — Goals, Metrics & Token Intelligence (P-b8dffb4d)
71. [T-128907bd] Source code intake and baseline audit
   Q: Source ZIP (sha256 588c2674...) was never transferred, so ZIP hash/content and npm test of the ZIP are unverified; audit of existing PM repo passes (test-audit.mjs 26/26). How proceed? A) Provide the ZIP bytes via bridge/transfer, then verify hash + npm test (recommended) B) Accept the PM-repo-only audit and close C) Drop the ZIP half permanently D) Other

## Wyze Doorbell — Frigate Live View & Motion Recording (P-e1d808fc)
72. [T-4daf36e3] A — Forensic audit: front-door stream failure and bridge compatibility
   Q: Report is synthesized from handoffs/notes, not live inspection (model, firmware, battery, bridge version, KVS/ICE traces). Accept as-is? A. Accept report as delivered, mark done (Rec.) B. Have an agent run read-only live checks on vmixer2o2 nvr stack first C. Rebuild with live evidence D. Drop task

## Rule Enforcement System (P-e5d90d43)
73. [T-20c47c40] E2 DSH harness guard: seat bans, attempt caps, quota stop never retried
   Q: E2 DSH harness guard (seat bans, attempt caps) lives on a branch. A) (recommended) Merge the branch after tests pass B) Continue the branch first, merge later C) Keep branch only D) Drop
74. [T-d7fa76cd] E3 llm-claude-cli failure-text bug
   Q: E3 llm-claude-cli failure-text bug waits on another agent's uncommitted files. A) (recommended) Wait for owner to commit/release B) Ask the owner to release now C) Work on a separate branch copy D) Defer
75. [T-d899f03a] E5 Codex exec policy, git pre-push token hook, Windows ACLs, spend guard
   Q: E5 needs a gatekeeper token for the pre-push hook: A) (recommended) Gatekeeper supplies token at session end B) Implement everything except token, defer hook C) Skip the pre-push hook D) Defer E5

## pm (P-bce84b85)
76. [T-34c6db4e] Project Manager Completion
   Q: Phase 6 / claude-code driver: A (rec) drop drivers/claude-code.mjs and mark done; B build it with user-typed spawn only; C keep open for UI samples; D other?
77. [T-c19fd883] pm UI build — user supplies the design prompt
   Q: User must supply the pm UI design prompt. A) paste your design prompt (recommended; task forbids picking a direction for you) B) point to pm-ui-design-specification.md in shared-brain/pm/runs as the prompt C) choose one of Operations Dashboard/Project-Centric/Compact Command Center explicitly D) defer
78. [T-2899baf7] Register pm MCP server in Claude Code / Codex / DSH (needs user OK: persistent config)
   Q: pm MCP registration on vmixer2o2: A (rec) accept ndi2 evidence, add Claude/Codex entries here with your OK; B accept as ndi2-only; C add and test here; D other?
79. [T-9946dcc6] Parallel Headless Pipelines — verification scope (Q13/Q35)
   Q: Umbrella: mock proofs of 4 children committed (b447fcf69); live pipeline run proof and permission-pause recovery on real DSH need seats/spend. Q: allow one live 2-pipeline DSH smoke run? A (recommended) yes, free/local seats only; B yes, any seats; C accept mock proof and close; D keep open.
80. [T-eff37278] Distributed DSH Architecture — verification scope (Q14/Q39)
   Q: Umbrella: mock proofs for discovery/routing/failover committed (b447fcf69); transport matrix (T-3e507c7b) and live host failover need user input. Q: how to close? A (recommended) accept mock proof plus LAN live, mark Tailscale/Funnel blocked; B live failover test with a host stop (needs your OK); C keep open; D split.
81. [T-2657d4e3] Model Router and Quotas — verification scope (Q16/Q38)
   Q: Router/quota verification needs live paid/free runs for cost benchmarks and forced-failure fallback runs, and the router lives in the DSH harness not pm. Q: how to proceed? A (recommended) approve a benchmark run on free/local seats only plus forced-failure fallback; B allow paid seats with a $ cap; C mock-only in harness repo; D defer.
82. [T-3f52f2ef] Session Handoff and Recovery — verification scope (Q17/Q37) › Origin-machine resume test
   Q: Needs live two-host resume: A (rec) accept mock planResume (handoff 10/0) as done; B run live ndi2<->vmixer2o2 resume test; C defer; D other?
83. [T-443f3b55] Session Handoff and Recovery — verification scope (Q17/Q37) › Reboot recovery test
   Q: ["Rebooting ndi2 and vmixer2o2 mid-handoff would kill live sessions and runs. How to proceed? A) (recommended) user schedules a reboot window and a worker runs the checklist on one host first; B) simulate with store close/reopen only; C) skip reboot, rely on boot supervision T-c4a91808; D) other"]
84. [T-3a7de03a] Distributed DSH Architecture — verification scope (Q14/Q39) › Peer discovery test
   Q: Peer discovery is config-based (peer added to config replicated), not automatic: A (rec) accept config join as discovery; B rebuild auto-discovery; C defer; D other?
85. [T-df95707b] Distributed DSH Architecture — verification scope (Q14/Q39) › Peer routing test
   Q: Needs live ndi2<->vmixer2o2 routing: A (rec) run live test with your OK; B accept mock; C defer; D other?
86. [T-3e507c7b] Distributed DSH Architecture — verification scope (Q14/Q39) › Transport matrix: LAN / Tailscale / cloud relay
   Q: Transport matrix needs live probes and user decisions. Q: Tailscale is logged out and Funnel is deferred; how to record them? A (recommended) mark both blocked-on-user and close with LAN-only live proof; B you re-login Tailscale now so I probe it; C enable Funnel; D drop both transports from scope.
87. [T-ec8e2fcf] Distributed DSH Architecture — verification scope (Q14/Q39) › Failover test
   Q: Needs live host-down failover: A (rec) accept mock transport-down proof; B run live host-down test with your OK; C defer; D other?
88. [T-4daea442] Secure remote DSH PM — one vmixer dashboard for LAN + Tailscale + NDI
   Q: Live rollout needs your OK: apply Tailscale Serve + LAN firewall rule (elevated) and cross-device test? A) approve serve plan now, firewall rule later (recommended) B) approve both C) code only, wire into server first D) defer

## dsh-pm-uiux (P-f2186d57)
89. [T-bf8ca991] Optional: Funnel for vmixer2o2 pm (deferred by user)
   Q: Enable the vmixer2o2 pm Funnel? A) (recommended) Keep deferred B) Enable now and reconcile .sync-conflicts sidecar C) Enable read-only D) Drop task

## Event Manager (P-4b55093a)
90. [T-54519f61] Event Manager Q&A E1-E15 answer record
   Q: Event Manager E1-E15 Q&A: how run it? A) (recommended) Run E1-E15 one card at a time here in ChatGPT after this list B) Answer from ecom_event_tool_qa.md yourself later C) Reduce to the 5 most blocking questions D) Defer
91. [T-d71b80d8] Phase 0.5 prerequisite fixes
   Q: Phase 0.5 prerequisite fixes (Prisma migrations, role enforcement in canna/commerce/lead-intelligence repos): go? A) (recommended) Go, after L3 T-fb8244ff lands B) Go now, in order, one repo at a time C) Only role enforcement first D) Defer
92. [T-b6257d05] Workstream A event core, booths, ticketing, staffing, portal UI
   Q: Portal UI + Playwright E2E not built (core logic only, gated on ecom-final L-frontend merge). A) Hold until L-frontend merges, then build UI (rec) B) Build standalone UI now C) Descope UI from this task D) Other
93. [T-c2a11c37] Workstream F historical data import, reporting, QA harness
   Q: XLSX import unsupported (throws; needs parser dep + E14 format list). A) Provide E14 formats, then add XLSX parser (rec) B) Accept CSV only, descope XLSX C) Add xlsx lib now D) Other
94. [T-04f3ee04] Phase 3-5 integrate, verify, deploy and handoff
   Q: Phase 3 real wiring + Phase 5 DreamHost deploy not done/need credentials; only mock integration + verify.cjs. A) Provide DreamHost VPS/GitHub Actions access and approve wiring to real users/commerce/canna (rec) B) Accept mock-only, descope deploy C) Defer D) Other

## DSH Project Manager — UI/UX Improvements (P-fb8f4161)
95. [T-a73df977] Resources & System: dedicated tab and full section at top of Home
   Q: Resources & System tab: approve read-only quota adapter work against ndi2 collector? A) (recommended) Approve read-only adapter B) Approve for ndi2 only, vmixer later C) Mock data only for now D) Defer
96. [T-163b105e] Fix false Offline machines; separate heartbeat, bridge, agent diagnostics
   Q: Fix false Offline machines: lane L9 T-27cd1e83 is on hold (13 failed attempts). A) (recommended) Build directly outside Blitz B) Lift hold on L9 and retry once C) Keep hold, wait D) Drop this task
97. [T-a8fe2cbb] Home: collapsible sections, shared ordering defaults, personal overrides
   Q: Home collapsible sections/ordering: delegated to L9 under hold. A) (recommended) Build directly outside L9 B) Lift L9 hold and retry C) Keep hold D) Drop
98. [T-afad3290] Project names: review unique proposals with role-based preview/approval
   Q: Project-name rename proposals: approve task_scope and lift Blitz hold? A) (recommended) Approve scope, build directly (17 Blitz fails) B) Approve scope, retry Blitz once C) Keep hold D) Drop feature
99. [T-ff91600e] Acceptance tests, rollout gates, and verified PM/DSH integration
   Q: Acceptance tests/rollout gates need the Q1 design selection. Which design? A) (recommended) Operations Dashboard B) Project-Centric C) Compact Command Center D) Defer all selection-dependent edits

## Metro Manila Parking Marketplace — GrabPay & GrabMaps (P-b150c82a)
100. [T-be2407f6] Parking: real payment provider adapter (GrabPay/PayMongo), decision with ChatGPT
   Q: Which payment provider for Parking? A) (recommended) PayMongo (cards/GCash/GrabPay via one API) B) GrabPay direct C) Both behind one adapter D) Keep mock adapter for pilot
101. [T-cdbb8b03] Parking: pilot deploy (needs git remote and host decision)
   Q: Where to deploy the Parking pilot? A) (recommended) Fly.io (small free tier) B) Render C) Existing VPS/ndi2 host D) Defer deploy (git remote also needed)


# Part 2 (questions 102-106)

102. [T-4dfa4288] pm (P-bce84b85): Free Claude via DSH → PM identity, scoped access and RBAC tests
   Q: Free Claude via DSH acceptance: A) (recommended) accept on mock RBAC tests now, mark done, open follow-up for DSH signer + live proof B) build DSH proof signer first, then verify live C) you supply PM_DSH_PROOF_SECRET/grants and live-test D) defer

103. [T-0bf60afc] pm (P-bce84b85): PM Swarm Tool: free-agents-only task execution with PM permission gates
   Q: Free-only swarm live run: A) (recommended) accept simulated tests now, mark done, open follow-up for DSH invoker + live safe task B) wire DSH invoker, then run live safe test C) you approve a live run on named free seats D) defer

104. [T-a03ce747] Solar SAM Integration (P-da8954a6): WP4: Lead Intel Prisma+MySQL persistence + Evidence + isSynthetic
   Q: Persistence proven only on fake Prisma client: A) (recommended) provision MySQL test DB, apply migration, run persistence tests against it B) accept fake-client proof, mark done C) defer to SunShare deploy gate D) other

105. [T-538550c7] pm (P-bce84b85): Session Handoff and Recovery — verification scope (Q17/Q37)
   Q: Reboot tests for handoff/recovery: A) (recommended) schedule a reboot window, run checklist on one host first B) simulate with store close/reopen only, mark done C) mark done now, rely on boot supervision T-c4a91808 D) other

106. [T-d1d6f44a] pm (P-bce84b85): Parallel Headless Pipelines — verification scope (Q13/Q35) › Concurrency test
   Q: Concurrency test needs two real headless DSH pipelines: A) (recommended) approve a small free/local-seat two-run test on one host B) accept mock proof, mark done C) fold into T-9946dcc6 live run D) other
