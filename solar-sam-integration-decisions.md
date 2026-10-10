---
name: solar-sam-integration-decisions
description: User-chosen decisions (2026-10-04, Q1-Q54 + research constraints) that turn the Solar SAM / Lead Intelligence plan into a build order; pm project solar-sam-integration WP0-WP7.
metadata:
  type: project
  author: Claude Opus 5.5
  created: 2026-10-04
---

Decisions the user made one question at a time on 2026-10-04 against the base plan
[[solar-sam-lead-intelligence-integration-plan]]. These override the base plan where they differ.
Grounded in code read that day: `green-energy-platform/lib/solar/assessment.js`,
`prisma/schema.prisma` (SolarAssessment.propertyId @unique), Lead Intel
`engine/pipeline/enrichment.js` (fixture lookup only, no persistence),
`shared/types/record.ts` (record-level source_url/source_agent only), root app
`src/services/prospectingService.js`. Python 3.14 on ndi2, PySAM not installed.

| # | Decision |
|---|---|
| Q1 | SAM lives in **SunShare first**, as a third AssessmentSource in `lib/solar/assessment.js`. Lead Intel calls SunShare later via API. |
| Q2 | Node spawns a **Python CLI** (`sam_worker.py`, JSON stdin/stdout, timeout) via child_process. **Dev/local on ndi2 first**; DreamHost VPS Python+PySAM check deferred. |
| Q3 | Add `SAM_PVWATTS` (and `SAM_PVSAMV1`) to AssessmentSource + new **SolarScenario** table (many per property: case, inputs hash, weather ref/hash, PySAM version, status, failure reason, outputs). SolarAssessment stays the headline row; existing readers untouched. |
| Q4 | Weather: **NSRDB Himawari**, cached per grid cell with dataset/version/grid point/distance/hash. Key in admin settings vault, server-side. WP0 confirms Manila coverage. |
| Q5 | SAM computes **energy + cash flow** (Utilityrate5 + Cashloan, PHP). model.js payback kept as a separately labeled baseline. |
| Q6 | Tariff: **scrape Meralco monthly** rate documents via Lead Intel's document-repository adapter. Missing/expired tariff = energy only, no cash flow. |
| Q7 | **Both**: Lead Intel gets its own DB, and SunShare gets an authenticated **ingest API + SolarTariff table**; Lead Intel pushes tariffs (later leads) to it. |
| Q8 | Lead Intel DB = **Prisma + MySQL**, separate database, same migrate.php/Json-not-String[]/@db.Text rules as SunShare. |
| Q9 | **Evidence table** in each DB (type tag, source URL, hash, locator, raw/normalized value, unit, method/version, model name, parent IDs); SAM-relevant fields (coords, area, tariff, weather) link to evidence; **isSynthetic** flag on every record, excluded from default counts. |
| Q10 | "All models": **Pvwattsv8 and Pvsamv1**, each conservative/base/optimistic, with Utilityrate5 -> Cashloan. Battery out of scope. Benchmark against a SAM-desktop-exported reference case. |
| Q11 | Pvsamv1 equipment: **pinned CEC module/inverter CSVs** (SAM release tag + hash) + admin shortlist of PH-market combos. |
| Q12 | Root location-prospecting app = **enrichment adapter** for Lead Intel (`/api/prospecting/evaluate`), results tagged as evidence; its kill-switches/quota breakers stay. |
| Q13 | **WP0 retests Lead Intel and fixes reproducing defects first** (score source, dedup, preset filter, route wiring). |
| Q14 | **pm tasks per WP; Claude Code builds sequentially**, one fresh session per WP. |

Build order: WP0 baseline -> WP1 SunShare schema (enum, SolarScenario, SolarTariff, Evidence) ->
WP2 PySAM worker + NSRDB -> WP3 SunShare SAM provider + cash flow -> WP4 Lead Intel Prisma DB + Evidence ->
WP5 Meralco tariff scraper + ingest API -> WP6 root-app enrichment adapter -> WP7 UI/scoring/proposal + acceptance tests.

## Q15-Q54 + research constraints (merged 2026-10-04, Claude Opus 5.5)

Source: [[solar-sam-integration-deepseek-review]] (sha256 e5b2e21b...b7aca). Full wording lives there; this is the build-binding summary.
Review status in that file: "decisions-frozen-pending-deepseek-review" (DeepSeek, then ChatGPT review before builds).

| # | Decision |
|---|---|
| Q15/Q31 | TMY = baseline; also simulate all selected historical Himawari years, report low/high separately; equipment/finance independent of weather. |
| Q16 | Auto public price research + admin PHP pricing DB with evidence + overrides. |
| Q17/Q27 | No bills -> building estimate + public benchmarks, labeled, per-field confidence; critical gaps flagged; unverified values never shown as confirmed in formal proposals. |
| Q18/Q19 | Formal proposals need current verified Meralco components; old/incomplete tariff only for labeled preliminary estimates; auto-search more official sources first. |
| Q20 | Check PH net-metering eligibility; if ineligible evaluate zero-export / self-consumption / other. |
| Q21 | Taxes, incentives, financing, depreciation researched with evidence; formal = admin-approved values. |
| Q22/Q49/Q50 | Equipment: CEC + manufacturer + PH suppliers + admin input from Chinese manufacturers + Alibaba (reference only). Final price = admin-approved emailed quote stored as evidence. |
| Q23/Q29 | Benchmark at exact input parity with SAM Desktop exports; model-specific tolerances (generation, billing, finance, cash flow); failure blocks release of that model path. |
| Q24 | Cross-DB: authenticated APIs, TLS, credential rotation, durable delivery, retries, dedup, audit. |
| Q25/Q51 | Qualified leads may get auto preliminary proposals; admin edits/recalcs/approves and sends. |
| Q26 | Lead score = financial potential + suitability + lead quality + source confidence + conversion probability; admin weights/thresholds. |
| Q28 | Synthetic data free in dev; auto-removed before production (isSynthetic required). |
| Q30 | Adaptive refresh: volatile prices often, stable specs rarely, stale rechecked at proposal time. |
| Q32 | Dynamic per-property conservative/base/optimistic, variables+sources+confidence recorded. |
| Q33-Q35 | Region/country admin-configurable (sources, weather, utility, currency, equipment, incentives, rules); agents discover candidate sources, admin reviews and activates/schedules. |
| Q36-Q43 | **Qualification first.** Scrape readily available data only -> Pending Review queue (dedup; updates flagged, never overwrite decisions) -> table + Kanban + detail views -> actions Qualify/Reject/More info/Later/Duplicate/Assign/Request SAM/Initiate proposal, individual + bulk -> configurable checklists, human decides, no auto-reject. **No SAM or heavy research until a qualified lead's next step is authorized.** Immediate and batch next-step flows. |
| Q44-Q46 | Review state autosaved + full decision history; pm owns assignment/roles; apps enforce permissions; one responsible owner per lead, others read-only, ownership changes logged, admin override. |
| Q47 | Admin manual reassignment; pm flags stalled leads and recommends; auto-reassign only under admin-configured rules. |
| Q48 | Admin-defined authorization thresholds for SAM/proposal actions; out-of-policy needs admin. |
| Q52 | Follow-ups: admin configures templates/timing and automatic vs approval-gated. |
| Q53 | Regional conflicts: system recommends from evidence, admin confirms. |
| Q54 | Evidence also keeps snapshots where allowed, extraction notes, timestamps. |

Research constraints (review section 6):
- NLR-PySAM 8.0.0 has CPython 3.14 Windows wheels; stay on 3.14, pin, import, run a minimal model, record Python/PySAM/SAM/SSC versions.
- Chain is Pvwattsv8|Pvsamv1 -> **Grid** -> Utilityrate5 -> Cashloan; build configs from SAM Desktop exports, document any load-module substitution.
- PHP throughout, `currencyCode = PHP`, no silent US defaults (cost, tax, incentives, O&M).
- NSRDB record: requested + returned grid coords, distance, dataset/version, timezone, year/TMY id, hash, missing-data flags, retrieved time; cache by dataset/grid/version/hash.
- Meralco tariff structured: generation, transmission/distribution, fixed, demand, TOU, taxes, export compensation, carry-forward, class, effective month, publication version. No single all-in rate.
- CEC pin: release tag/commit + hashes + IDs + electrical compatibility; CEC presence != PH availability/price/warranty.
- Partial failure: keep valid generation, mark utility/finance stage failed with reason, never fabricate cash flow.
- MODELED != SYNTHETIC.
- Cross-DB: versioned payloads, stable external IDs, idempotency keys, outbox/inbox, acks, audit, synthetic-flag propagation, replay protection.

Q14 superseded 2026-10-05 (user): **each WP is built as a DSH run written by Claude** (user picks seats per run). Review gate waived: **start WP0 now**; DeepSeek/ChatGPT review output folded in when it arrives.

No commit/push authorized by this note.
