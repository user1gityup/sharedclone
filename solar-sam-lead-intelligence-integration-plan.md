---
name: solar-sam-lead-intelligence-integration-plan
description: Development integration plan for Solar Lead Intelligence using NLR SAM SDK / PySAM within the existing SunShare and DSH Lead Intelligence workflows.
metadata:
  type: project
  author: GPT-6
  created: 2026-10-04
  status: planning-only-source-reconciliation-incomplete
---

# Solar Lead Intelligence powered by NLR SAM SDK / PySAM

## Scope, authorization and source status

Extend the existing `green-energy-platform` (SunShare) and the existing DSH / Shared Brain Lead Intelligence scraping protocol. Reuse current Solar, discovery, adapters, normalization, qualification, sources, applications, answer library, document vault and run-monitor components. Do not rebuild either platform or create a competing lead system.

**We are still in development. No live customer data exist for this integration.** Public records can support development discovery and enrichment; they are not customers, verified interest, signed projects, measured electricity use or actual operating results. Synthetic fixtures are test data. Simulated outputs remain modeled estimates even when their weather or location inputs are real.

This document records the scope described by the user's current request, grounded in inspected local code and protocols. The referenced conversation is **Open Source Government Funded**, ID `6ac20d46-802c-83e8-8166-257725ca95ec`. Its reader returned message reference markers rather than the assistant prose, including messages `743230b7-c180-4c98-8ef5-1609fbdf89cf`, `0db13838-9b67-4480-8c5e-91240e4185dc`, `26718bf7-f4ac-430a-9df1-3aa1cbffb219` and `985d0351-d105-4bfa-9fa4-eb79421962b0`. Consequently, exact preservation of every substantive detail of those answers is **unverified**. No missing text, historical vote, selected implementation detail or previous result is invented here. Proposed contracts below are implementation guidance, not claims that those contracts already exist or were separately approved in the inaccessible answers.

Authorization for this delivery covers the Markdown plan and its authentic Shared Brain save. It does not launch DSH workers, install dependencies, crawl customer systems, change application code, migrate databases, commit, push or deploy.

## Existing components inspected

| Component | Actual location / existing behavior | Integration boundary |
| --- | --- | --- |
| SunShare | `~/Documents/claudecode/green-energy-platform` | Retain the existing Next.js JavaScript application and Prisma/MySQL model. |
| Solar orchestration | `lib/solar/assessment.js` | Existing Google Solar building-insights path and latitude/area fallback return one assessment shape. Extend orchestration with a clearly identified SAM provider. |
| Solar arithmetic | `lib/solar/model.js` | Preserve existing pure yield and financial calculations as a labeled fallback and comparison baseline. |
| Solar storage | `prisma/schema.prisma`: `Property`, `SolarAssessment`, `AssessmentSource`, `Project`, `EnergyReading` | Current assessment sources are `GOOGLE_SOLAR` and `MODELED`; a SAM source/version contract needs an additive design and migration in later authorized work. Never place estimates in measured `EnergyReading` records. |
| Lead Intelligence | `~/Documents/claudecode/billboard-platform/lead-intelligence-platform` | Reuse the existing self-contained platform at its current temporary home. No repository relocation is required for this plan. |
| Shared contracts | `shared/types/record.ts`, `workspace.ts`, `presets.ts`, `sources.ts` | Extend `UniversalRecord` and its `RfpRecord` extension instead of forking them. Preserve answer provenance and unknown/flagged states. |
| Discovery / RFP engine | `engine/`, including `engine/pipeline/rfp-pipeline.js` | Add Solar enrichment stages and use the existing RFP progression and injection points. |
| Sources and presets | `sources/`, `presets/`, `engine/presets`, `shared/fixtures` | Extend the source registry and real engine preset configuration. Existing UI edits and re-crawl actions are prototype in-memory behavior, not durable crawling. |
| Proposal and operations | `rfp-applications/`, `answers-vault/`, `run-monitor/`, `desktop-agent/`, `dashboard/`, `leads-rfp/` | Surface the same persisted evidence, simulation state and scoring across existing workspaces. |

Existing Solar code computes annual kWh with the platform's own model even in its Google building-insights path. Google-derived roof information must not be described as meter-measured generation. SAM is an additional simulation provider, not a reason to rename current modeled outputs as observed production.

The Shared Brain review note dated 2026-10-02 reports engine/UI score disagreement, deduplication and preset filtering issues, missing route wiring and incomplete test results. Those are historical review findings, not current retest results. Recheck relevant issues before integrating; this document neither fixes them nor claims the build is green.

## Architecture and data flow

```text
Existing scraping preset + source registry + DSH run
  -> discovery
  -> source extraction and raw document capture
  -> normalization, entity resolution and deduplication
  -> NSRDB / OpenEI / GIS enrichment
  -> validated SAM input case
  -> server-side PySAM / SSC simulation job
  -> technical and commercial qualification / scoring
  -> existing lead store and workspace
  -> assessment / proposal / RFP or grant application draft

Field-level evidence, source snapshots, assumptions and run IDs
  accompany every transformation and every displayed claim.
```

Use a thin application adapter to a Python PySAM worker; keep native SSC computation off the browser and out of long-running page requests. Worker hosting, queue and transport are choices to resolve against existing project infrastructure before implementation, not assumed services already installed. The SDK exposes SSC for custom applications; PySAM supplies the Python interface. [SAM SDK](https://sam.nlr.gov/software-development-kit-sdk.html), [PySAM documentation](https://nrel-pysam.readthedocs.io/en/main/).

Give jobs stable IDs, input fingerprints, model versions, stage state, timestamps and failure reasons. Validate requests before execution; use bounded concurrency, timeouts and idempotent retries. Cache only when input, weather, tariff and model fingerprints match. Preserve failed jobs and diagnostics without substituting fabricated successful output. API keys remain server-side and are excluded from logs, fixtures and Shared Brain notes.

### 1. Discovery

Extend existing presets for commercial roofs, industrial facilities, warehouses, institutions, schools, hospitals, agricultural sites, energy buyers and public Solar opportunities. Configure geography, organization types, keywords, exclusions, source priority, crawl frequency, maximum depth, documents, extraction fields and follow-up actions through the existing preset vocabulary. Geographic scope and target segments must be configured rather than inferred from a test fixture.

Use existing adapters for public websites, directories, procurement portals, search, sitemaps, RSS, APIs, PDF repositories, browser capture and CSV import. A public organization is only a discovered prospect. Keep site owners, occupants, utility accounts, procurement issuers and funding bodies as separate roles.

### 2. Source extraction

Capture source URL, title, publisher, retrieval time, published/updated date where available, document version and a content hash. Extract organization, site address, available contact information, roof/land clues, procurement scope, deadlines, eligibility, budget, technical requirements, attachments and amendment references. Associate claims with page, section or text spans. OCR or browser extraction failure leaves a flagged gap; document filenames alone are not sufficient evidence of the full requirements.

### 3. Normalization and deduplication

Normalize organization/site identities, addresses, coordinates, units, currencies and dates with timezone information. Preserve original values and conversion steps. Separate one organization with multiple sites from duplicate observations of one site. Resolve duplicates using corroborating identifiers, address, website and phone where available; do not merge unrelated branches or treat missing websites as a shared identity. Preserve conflicting source values and their resolution status.

### 4. NSRDB / OpenEI / GIS enrichment

**NSRDB:** query datasets available for the coordinates, then retrieve a suitable weather/resource file. Store dataset name/version, grid point, distance from site, period, interval, timezone, units, request parameters and file hash. Check GHI/DNI/DHI, temperature, wind, missing records and interval compatibility before SAM execution. Identify TMY versus a particular historical year. Historical resource data do not predict a guaranteed future year. The current developer documentation lists multiple regional datasets; its older Philippines endpoint is deprecated in favor of Himawari data. Confirm actual coordinate coverage instead of using a US dataset by default. [NSRDB API documentation](https://developer.nlr.gov/docs/solar/nsrdb/).

**OpenEI:** obtain candidate utility-rate information where appropriate and supported, with tariff identifier, utility, effective dates, schedules, charges and export assumptions. Verify the tariff against the site and use authoritative local utility documents where OpenEI is unavailable or inappropriate. A candidate match is not a confirmed customer tariff. No actual bill or interval load profile exists unless separately supplied and verified. The OpenEI page returned HTTP 429 during preparation; no fresh tariff or successful API retrieval is claimed. Reference to validate during implementation: [OpenEI Utility Rate Database](https://openei.org/wiki/Utility_Rate_Database).

**GIS:** add source-backed parcel/building footprint, land use, roof/land area and available shading/context layers. Keep coordinates and geometry accuracy explicit. A footprint is not usable roof area; subtract or assume setbacks, obstructions and layout constraints transparently. Imagery does not establish ownership, structural suitability, roof condition, electrical capacity, interconnection approval or willingness to buy.

If enrichment is unavailable, store `missing`, `unsupported`, `stale` or `failed` with the reason. Run an explicitly assumed screening case only when sufficient inputs exist; otherwise withhold simulation. Never silently exchange real weather for synthetic weather.

### 5. SAM simulation

Start with an appropriately configured PVWatts screening case for sparse prospects and progress to detailed PV (`Pvsamv1`) cases when geometry, module/inverter and site information support them. Select modules and compatible configurations from the pinned PySAM release; do not assume desktop SAM recalculations occur automatically after editing exported inputs. Use exported reference cases to verify defaults and variable dependencies. Battery or dispatch modeling is a later conditional case requiring its own input evidence.

Proposed job request fields: lead/site ID, scenario ID, module/configuration, schema version, coordinates, weather reference/hash, DC capacity, layout/orientation, equipment, loss assumptions, load/tariff references where applicable, economics and field evidence IDs. Proposed result fields: status, annual/monthly generation, time-series reference when calculated, system size, relevant modeled financial outputs, warnings, assumptions, input/output hashes, PySAM/SSC versions and execution log reference. Unsupported or uncomputed metrics remain absent/null with a reason.

Separate energy simulation from customer bill savings and project finance. Compute savings only with an explicit load/tariff/export case. Select a financial model matching the business arrangement; expose the distinction between the existing simple annual-return/payback calculations and SAM cash-flow outputs. Avoid double-counting revenue, incentive amounts, energy credits or avoided costs between models.

### 6. Qualification and scoring

Retain existing qualification infrastructure. Add separate Solar technical fit, commercial fit, data confidence, procurement/grant eligibility and next-action dimensions. Inputs may include usable area estimate, modeled system capacity, resource, potential self-consumption, sector, geography, explicit procurement intent, timing, evidence quality and unresolved constraints. All weights, thresholds and exclusions are versioned preset settings, not invented historical decisions.

Keep commercial attractiveness separate from confidence. Missing consumption, ownership, structural or tariff evidence cannot earn a verified-positive criterion. Unknown eligibility stays unknown; unmet requirements can block progression. Store criterion, input evidence IDs, points, weight, explanation and score version. Dashboard, lead details and proposal use the same stored score and population rather than separately hardcoded fixture numbers.

### 7. Lead database and proposal

Persist the normalized lead, source relationships, enrichment records, scenario jobs, results, score breakdown and workflow status in the existing lead storage integration. Durable persistence is an acceptance requirement, not a claim that the present fixture-based screens already provide it. Keep one lead identity, with linked site and assessment IDs across platform boundaries; use an explicit adapter/API rather than importing private database code across the separate repositories.

Do not automatically create a customer, funded project or operational project from a prospect. When an authorized customer project is established later, link it to existing `Property`, `SolarAssessment` and `Project` records. Keep scenario history outside the current one-assessment-per-property overwrite pattern through a minimal additive schema design, while preserving current readers and Decimal storage semantics.

Generate a draft containing opportunity/site description, source-backed facts, scenarios, estimated capacity and generation, economics only where supported, assumptions, confidence, missing evidence and next validation step. Include citations, dates, versions and traceable supporting documents. Never invent certifications, registrations, past performance, customer endorsements, funding approval, savings or completed installations.

## Distinct workflows

| Workflow | Discovery and analysis | Output / gate |
| --- | --- | --- |
| Prospecting | Public businesses/sites -> normalization -> resource/GIS enrichment -> assumed screening simulation -> fit and confidence | Ranked prospect and internal outreach/proposal draft. Public listing is not interest; discovery does not authorize sending messages. |
| RFP / procurement | Opportunity and amendments -> complete documents -> extracted requirements -> verified company eligibility -> site/scope simulation -> response evidence | Existing application workflow: discovered, documents collected, requirements extracted, eligibility analyzed, qualification scored, answer-library matched, response generated, documents assembled, application prepared, desktop-agent handoff. Unknown answers remain unanswered/flagged. No automatic submission. |
| Grants / incentives | Funding notice -> geography/recipient/project eligibility -> dates, match requirements, eligible costs -> conditional technical/economic scenarios | Separate funding opportunity linked to a project/prospect. Award amount is conditional until verified; do not treat a grant as a purchase RFP or guaranteed revenue. |
| Customer project | Later authorized onboarding -> actual site survey, equipment, bills/load and confirmed tariff -> detailed model -> reviewed proposal | Existing Solar assessment/project lifecycle. Development uses clearly labeled synthetic customer cases; no current live customer case is claimed. Later measured production remains separate from forecasts. |

Reuse answer library and document vault provenance for RFP/grant facts. Match only verified organizational evidence. Each workflow has its own readiness state and required evidence; an attractive Solar forecast cannot establish bidding eligibility.

## Development data and evidence contract

Maintain two explicitly separated datasets: captured real public evidence and synthetic development fixtures. Neither is live customer data. A synthetic organization's weather may use real public resource data, but its identity, load and economics remain synthetic/assumed. Label mixed cases per field as well as per record. Never manufacture public URLs or documents to make fixtures appear real.

The following evidence tags are proposed additions to the existing provenance contract, subject to reconciliation with recovered prior-answer terminology:

| Tag | Meaning |
| --- | --- |
| `PUBLIC_SOURCE` | Captured public document/data with source and retrieval evidence; does not verify every conclusion drawn from it. |
| `SYNTHETIC_TEST` | Invented fixture for development, clearly excluded from real prospect reporting. |
| `DERIVED` | Deterministic calculation or normalization linked to its inputs and transformation version. |
| `ASSUMED` | Explicit chosen/default scenario input with reason and range. |
| `MODELED_SAM` | Successfully computed SAM scenario, never observed production. |
| `VERIFIED_CUSTOMER` | Later actual customer-provided/verified fact; unused for current development records. |
| `UNKNOWN` / `CONFLICTING` | Missing or incompatible evidence requiring resolution. |

Keep evidence type separate from verification status (`unverified`, `corroborated`, `verified`, `stale`, `rejected`). Proposed provenance fields include evidence ID, source/document ID, URL, publisher, capture time, applicable period, hash, locator, raw value, normalized value, unit, extraction method and version, exact acting model, confidence and parent evidence IDs. Simulation provenance adds scenario assumptions, weather/tariff hashes and software versions. Source observations are retained rather than overwritten by later model output.

Fixtures cover complete records, sparse sites, no tariff/load, non-US coverage, multi-site organizations, duplicates, conflicting sources, stale tariffs, zero revenue, missing weather, failed simulations, amended RFPs and unknown grant/company eligibility. Use fixed local captures for deterministic tests; separate credentialed public API smoke tests from offline gates.

## SAM assumptions and limits

Record all defaults: usable-area fraction, capacity sizing, module/inverter choice, tilt, azimuth convention, mounting, DC/AC ratio, shading, soiling, wiring, availability, degradation, weather basis, load profile, tariff, export compensation, capital cost, O&M, replacement, financing, discount/escalation, currency and any conditional incentive. Distinguish values extracted from evidence from defaults. Do not silently reuse US economics for Philippine sites.

Show conservative/base/optimistic sensitivity cases with documented changed inputs, not unsupported probability claims. Do not label a range P50/P90 without an appropriate uncertainty method. Avoid applying the same shading/loss derate twice. Preserve null/non-finite payback semantics when a scenario earns no revenue. Emissions/tree equivalents are derived estimates requiring their own conversion-factor provenance.

SAM does not discover leads, scrape documents, establish roof engineering suitability, confirm tariffs, approve interconnection, verify company qualifications or guarantee performance. Public weather is spatially and temporally bounded; GIS may be incomplete. Accuracy is limited by the inputs. No modeled savings, generation, payback, score, customer conversion or grant result has been generated or verified in this planning task.

## DSH parallel build work packages — future authorized implementation

Prepare work in pm against current task ownership and existing run state. The user selects council/swarm seats for each run; no roster is inferred or carried over. Preserve the current two-factor approval mechanism and spend controls. A stale historical run authorization does not authorize this integration's execution. Amend stalled runs in place. The packages below describe a future parallel build, not launched agents.

| Package | Scope and ownership boundary | Acceptance evidence |
| --- | --- | --- |
| WP0: integration inventory/contracts | Reconcile recovered proposal, existing schema and baseline defects; define additive contracts and fixture namespace | Concrete file map, baseline test results, backward-compatible contract review, documented source gaps. |
| WP1: Solar discovery/extraction | Extend existing adapters/presets and document capture | Real public capture retains URL/hash/span; synthetic source visibly labeled; geography/exclusion tests pass. |
| WP2: normalization/provenance | Extend existing shared contracts and entity resolution | Unit/currency/date conversion, duplicates, multi-site identity and conflicting evidence pass; no competing record types. |
| WP3: enrichment | NSRDB resource, tariff and GIS adapters behind existing stage interfaces | Coordinate coverage, timestamps, hashes, missing/stale/unsupported cases, interval/unit validation and offline captures pass. |
| WP4: PySAM worker | Version-pinned cases, validation, job execution, diagnostics and cache | Pinned reference-case comparison, reproducible inputs/outputs, failure and timeout behavior, invalidation on input/version change. |
| WP5: SunShare assessment bridge | Extend current assessment orchestration and additive persistence | Legacy source behavior preserved, modeled source visible, scenarios linked without damaging prior records, null payback supported. |
| WP6: scoring/workflows/proposals | Existing qualification, applications, library and vault | One stored score across screens; unknown qualifications remain unresolved; distinct prospect/RFP/grant/customer progression. |
| WP7: UI/operations/integration review | Existing dashboard, workspaces and monitor; end-to-end wiring | Persistent jobs/results visible after refresh; citations and synthetic labels survive export; monitor reports actual state. |

WP0 establishes contracts before dependent implementation. WP1/WP3/WP4 can then proceed against those contracts while WP2 owns shared types. WP5/WP6 consume settled contracts; WP7 integrates completed slices. One owner edits shared contracts and migrations to avoid collisions. Parallel packages within one approved run do not imply multiple concurrent global DSH pipelines. Require per-package files, exact model attribution, actual test exit status and residual gaps. Do not commit or push under this document's authorization.

## Acceptance tests and completion criteria

1. **Legacy regression:** Existing Solar fallback and Google building-insights cases still return compatible assessment values; existing Lead/RFP contracts and workflows continue to load. Identify and resolve attributable failures before claiming a passing integration.
2. **Full prospect chain:** A captured public site travels through discovery, extraction, normalization, enrichment, SAM, qualification, durable lead storage and draft proposal. Every displayed factual claim resolves to evidence; simulation fields resolve to a job. No record becomes a customer by this chain.
3. **Synthetic isolation:** Development identities and load profiles stay labeled in storage, filters, dashboards and exports. Synthetic leads are excluded from real public prospect counts by default. Real weather does not remove synthetic identity labels.
4. **Source fidelity:** Changed source documents produce new versions; repeated identical captures do not duplicate leads. OCR failures and unavailable pages remain visible. RFP amendment/deadline changes invalidate affected readiness decisions.
5. **Enrichment correctness:** Unsupported location, missing weather, wrong units/intervals, expired tariff and GIS uncertainty produce explicit statuses. Philippines cases select appropriate supported datasets; there is no silent geographic substitution.
6. **Simulation benchmark:** Run a fixed SAM-exported/reference case against the pinned PySAM/SSC configuration. Agree metric-specific numeric tolerances before judging the comparison; save actual outputs, versions and differences. Monthly generation reconciles with annual totals where comparable. Do not assert exact binary equality across unpinned environments.
7. **Job robustness:** Duplicate requests, worker failure, timeout, retry and changed-input cache keys behave predictably; failed jobs cannot emit success or populate proposals with invented outputs.
8. **Financial integrity:** No load/tariff means no verified bill savings. Conditional grants are scenario assumptions. Zero-revenue payback remains null/unbounded with explanation. Units, currencies and Decimal persistence survive round trips.
9. **Qualification integrity:** Missing evidence reduces confidence or blocks required readiness. A SAM result cannot turn an unknown company qualification into met. Scores and counts agree between engine, workspace and dashboard.
10. **Workflow separation:** One fixture per prospect, RFP, grant and synthetic customer case reaches its correct draft state. Unknown answers are flagged, not generated as facts; submission/outreach requires separate authorization.
11. **UI persistence/provenance:** Refresh does not erase authorized persisted preset/source edits or completed jobs; re-crawl invokes real engine work rather than only a toast. Users can inspect source, assumptions, model version and missing inputs from the existing screens.
12. **Delivery evidence:** Record build/test command exit codes, date, commit/worktree or file state, actual public API smoke outcomes and untested areas. Offline tests do not prove live API access. A plan, fixture screenshot or successful simulation alone is not end-to-end acceptance.

Implementation is complete only when the integrated artifact passes these gates and evidence is reviewable. This delivery is the plan; none of these future tests is reported as executed.

## Shared Brain destination and delivery boundary

Authentic destination inspected: `~/.claude/shared-brain/`. It is an ordinary local directory, and its configured origin is `https://github.com/user1gityup/shared-brain.git`. Relevant context read: `MEMORY.md`, `shared-agent-log.md`, `pm-live.md`, `project_green_energy_platform.md`, `sharedclone-mirror.md`, Lead Intelligence preparation notes and the 2026-10-02 headless-builds review. pm was queried before reconstructing project state; Solar search returned no matching task, and Lead Intelligence preparation/handoff tasks are marked done. Historical checkpoint fields are not treated as current implementation proof.

Save this file at the authentic Shared Brain root under the exact name `solar-sam-lead-intelligence-integration-plan.md`, index it as a project plan with the source-reconciliation gap, and append a signed delivery log after a verified save. This is a local Shared Brain save; it does not imply a GitHub upload, remote synchronization or gatekeeper push.

`github.com/user1gityup/sharedclone` is the disposable, non-authoritative, one-way read-only mirror. Do not edit it, use it as a write destination or claim that a mirror change uploads to Shared Brain. If runtime write permission is refused, preserve the workspace Markdown deliverable and report that exact blocker. Verify matching file hashes after any successful copy.
