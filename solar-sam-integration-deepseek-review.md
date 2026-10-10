---
name: solar-sam-integration-decisions-deepseek-review
description: Consolidated user decisions and technical research handoff for Solar SAM / Lead Intelligence integration. Prepared for DeepSeek review before Claude writes DSH WP0-WP7 runs.
metadata:
  type: project-review
  created: 2026-10-04
  status: decisions-frozen-pending-deepseek-review
  build_authority: none
---

# Solar SAM / Lead Intelligence Integration
## Consolidated Decisions + DeepSeek Review Handoff

## Purpose

This file consolidates the user's approved decisions for integrating the NLR System Advisor Model (SAM) / PySAM into the existing SunShare / `green-energy-platform`, Lead Intelligence, root prospecting app, and DSH Project Manager workflow.

This file is intended for **DeepSeek review and further consideration before Claude writes the sequential DSH build runs**.

### DeepSeek's job

Research and review only.

- Preserve all user decisions in this file.
- Do not silently replace them with preferred architecture.
- Identify concrete incompatibilities, technical blockers, risks, missing implementation choices, or incorrect assumptions.
- Verify current facts using primary sources where possible.
- Clearly separate:
  - verified facts
  - implementation assumptions
  - recommendations
  - unresolved questions
- Return actionable corrections that Claude can incorporate into WP0-WP7 run prompts.
- Do **not** build code.
- Do **not** launch agents.
- Do **not** modify repositories.
- Do **not** commit or push.

---

# 1. Existing Project Direction

SAM is to be incorporated while the energy platform is still in development.

The goal is not merely to add a customer calculator. SAM becomes a reusable engineering and financial modeling capability within the existing Solar platform and, after lead qualification, within the Solar Lead Intelligence workflow.

The production platform should use SAM/PySAM as a self-hosted calculation engine rather than depend on a paid external simulation API.

The existing SunShare, Lead Intelligence, root prospecting app, databases, authentication, permissions, DSH routing, and Project Manager workflows should be reused rather than rebuilt.

---

# 2. Original User Decisions — Q1-Q14

These decisions were already recorded in the authentic Shared Brain file `solar-sam-integration-decisions.md` and remain authoritative.

| # | Approved decision |
|---|---|
| Q1 | SAM lives in **SunShare first**, as a third AssessmentSource in `lib/solar/assessment.js`. Lead Intel calls SunShare later via API. |
| Q2 | Node spawns a **Python CLI** (`sam_worker.py`, JSON stdin/stdout, timeout) via `child_process`. **Dev/local on ndi2 first**; DreamHost VPS Python+PySAM check deferred. |
| Q3 | Add `SAM_PVWATTS` and `SAM_PVSAMV1` to AssessmentSource plus a new **SolarScenario** table allowing many scenarios per property: case, inputs hash, weather ref/hash, PySAM version, status, failure reason, outputs. `SolarAssessment` remains the headline row so existing readers remain untouched. |
| Q4 | Weather source: **NSRDB Himawari**, cached per grid cell with dataset/version/grid point/distance/hash. API key stays server-side in admin settings vault. WP0 confirms Manila coverage. |
| Q5 | SAM computes **energy + cash flow** using Utilityrate5 + Cashloan in PHP. Existing `model.js` payback remains separately labeled as a baseline. |
| Q6 | Tariff data: **scrape Meralco monthly rate documents** through Lead Intel's document-repository adapter. Missing/expired tariff means energy-only output and no formal cash-flow result. |
| Q7 | Use **both databases**: Lead Intel has its own DB; SunShare exposes an authenticated ingest API and a SolarTariff table. Lead Intel pushes tariffs, and later lead data, into SunShare. |
| Q8 | Lead Intel DB is **Prisma + MySQL**, separate from SunShare, following the same `migrate.php`, JSON-not-String[], and `@db.Text` rules. |
| Q9 | Add an **Evidence table in each DB** containing type tag, source URL, hash, locator, raw value, normalized value, unit, method/version, model name, parent IDs. SAM-relevant fields such as coordinates, area, tariff, and weather link to evidence. Every record has `isSynthetic`; synthetic records are excluded from default counts. |
| Q10 | Support **Pvwattsv8 and Pvsamv1**, each with conservative/base/optimistic scenarios, followed by Utilityrate5 -> Cashloan. Battery is out of scope. Benchmark against a SAM Desktop exported reference case. |
| Q11 | Pvsamv1 equipment uses **pinned CEC module/inverter CSVs** identified by SAM release tag + hash, plus an admin shortlist of Philippine-market combinations. |
| Q12 | Root location-prospecting app becomes an **enrichment adapter** for Lead Intel using `/api/prospecting/evaluate`; results are stored/tagged as evidence. Existing kill-switches and quota breakers stay. |
| Q13 | **WP0 first retests Lead Intel and fixes reproducing defects** before SAM work: score source, deduplication, preset filtering, and route wiring. |
| Q14 | Create **PM tasks per work package**. Claude Code builds sequentially with **one fresh session per WP**. |

Approved build order:

`WP0 baseline -> WP1 SunShare schema -> WP2 PySAM worker + NSRDB -> WP3 SunShare SAM provider + cash flow -> WP4 Lead Intel Prisma DB + Evidence -> WP5 Meralco tariff scraper + ingest API -> WP6 root-app enrichment adapter -> WP7 UI/scoring/proposal + acceptance tests`

No commit or push is authorized by this document.

---

# 3. Additional User Decisions — Q15-Q54

## Weather, pricing, load estimation, tariffs, finance, equipment

| # | Approved decision |
|---|---|
| Q15 | **TMY + historical weather.** TMY is used for the standard estimate. Historical Himawari years are also simulated to show year-to-year variation. |
| Q16 | **Automatic public price research + admin-controlled PHP pricing database.** Retain source evidence and allow administrator overrides. |
| Q17 | When actual bills are unavailable, combine **building-based estimates + public energy data/industry benchmarks**. Label assumptions, sources, and confidence; replace with actual bills when available. |
| Q18 | Use current verified Meralco rates for formal financial proposals. Older verified rates may be used for **preliminary lead estimates only**, clearly labeled with date, age, and confidence. |
| Q19 | If tariff data is incomplete, automatically search additional official sources. If still incomplete, preliminary estimates may use defensible, clearly labeled assumptions, but **formal financial proposals are blocked** until required tariff components are verified. |
| Q20 | Verify Philippine net-metering eligibility using current rules. When ineligible, automatically evaluate **zero-export, self-consumption, or other applicable arrangements**. |
| Q21 | Research current Philippine taxes, incentives, financing rates, and depreciation. Preserve evidence. Official proposals use **administrator-approved values**; provisional lead estimates may use labeled assumptions. |
| Q22 | Equipment verification combines official manufacturer/CEC data, Philippine suppliers, **administrator input from Chinese manufacturers**, and **Alibaba-scraped supplier information where permitted**. Preserve evidence and require administrator approval/override controls. |
| Q23 | Benchmarking uses **exact configuration/input parity** with SAM Desktop and strict predefined numerical tolerances. Failed benchmarks block release. |
| Q24 | Cross-database transfer uses authenticated APIs plus encrypted connections, credential rotation, persistent delivery, automatic retries, deduplication, evidence preservation, and synchronization auditing. |
| Q25 | Qualified leads may receive **automatically generated preliminary proposals**, but administrators can edit assumptions, recalculate, approve formal proposals, and control delivery. |
| Q26 | Lead scoring combines financial potential, property suitability, lead quality, source confidence, and estimated conversion probability. Administrators can adjust weights and qualification thresholds. |
| Q27 | For missing property data, automatically seek more sources, then use clearly labeled estimates where appropriate. Track confidence per field, flag critical gaps, and prevent unverified values from appearing as confirmed facts in formal proposals. |
| Q28 | During development, synthetic data may be used freely throughout end-to-end workflows and should be **automatically removed before production**. Existing `isSynthetic` tagging remains required so cleanup and separation are reliable. |
| Q29 | Use **model-specific benchmark tolerances** for generation, utility billing, financing, and cash flow, established from validated SAM Desktop reference tests. |
| Q30 | Equipment price and supplier updates are **adaptive**: volatile pricing/availability is checked more frequently; stable specifications less frequently; stale data is rechecked when preparing proposals. |
| Q31 | Use TMY as the baseline. Simulate all available selected historical years and report low/high production separately. Keep equipment and financial assumptions independent of weather variation. |
| Q32 | **Dynamic scenario construction.** SAM + available evidence + agents automatically determine conservative/base/optimistic assumptions per property, while recording selected variables, sources, and confidence. Formal-proposal approval controls remain. |
| Q33 | Geographic coverage is **administrator-configurable by region/country**, with region-specific scraping sources, weather data, utility data, currencies, equipment, incentives, and regulations. |
| Q34 | For a new region, agents automatically discover/configure candidate regional data sources, preferring official government and utility sources. Administrators review uncertain/missing items before financial proposals are enabled. |
| Q35 | New-region lead sources are automatically discovered and tested, but administrators choose which sources to activate and set scraping schedules, quotas, and priorities. |

---

# 4. Lead Qualification Workflow — Q36-Q46

The user explicitly does **not** want SAM simulations or other resource-heavy enrichment to run before a lead is qualified.

## Q36 — Qualification first

Approved custom workflow:

1. Scraper discovers leads.
2. Build and display the lead list using readily available information.
3. User/team determines which leads are qualified.
4. For each qualified lead, ask what should happen next.
5. Only then may the system run extra research, SAM simulations, proposals, or other resource-intensive actions.

**No automatic SAM run merely because a lead was scraped.**

## Q37 — Available lead actions

Full workflow actions:

- Qualify
- Reject
- Request more information
- Save for later
- Mark duplicate
- Assign team member
- Request SAM analysis
- Initiate proposal

No resource-intensive action executes until selected/authorized.

## Q38 — Review UI

Use both:

- sortable/filterable table
- Kanban board
- detailed lead view
- view switching without losing state

## Q39 — Bulk actions

Support both individual and bulk decisions.

Resource-intensive actions, including batch SAM simulations, still require explicit approval.

## Q40 — New leads

New leads enter a **Pending Review** queue automatically.

Deduplicate against existing records.

Updates to an existing lead should be flagged without overwriting earlier qualification decisions.

## Q41 — Information before qualification

Collect all **readily available information** during initial scraping without launching additional resource-intensive research.

Show concise summaries with expandable detail and source evidence.

## Q42 — Qualification criteria

Use configurable checklists/criteria by region, industry, and lead type.

The final qualification decision remains with the user/team.

No automatic rejection and no resource-intensive analysis before qualification.

## Q43 — After qualification

Support both workflows:

- Immediate: ask the next step for that specific qualified lead.
- Batch: finish reviewing a lead list, then present the qualified leads together for next-step decisions.

No further processing until authorized.

## Q44 — Review persistence and handoff

Use both:

- automatic save/resume of review state, filters, selections, and decisions
- full decision history
- DSH Project Manager integration for multi-user and multi-machine handoff

## Q45 — Roles and permissions

Use both role-based access and DSH Project Manager control.

- DSH PM centrally manages assignments, roles, and access levels.
- SunShare and Lead Intelligence enforce permissions.
- Administrators retain override authority.
- Permissions apply across users, machines, and shared review sessions.

## Q46 — Single responsible owner per lead

DSH Project Manager owns lead assignment.

- Each lead has one responsible assigned user.
- Other users may view the lead but cannot edit it.
- Editing requires reassignment or administrator override.
- Ownership changes must be logged.

---

# 5. Lead Reassignment, Analysis Approval, Suppliers, Proposals — Q47-Q54

| # | Approved decision |
|---|---|
| Q47 | **C + D.** Administrators can manually reassign leads. DSH identifies stalled/inactive assignments and recommends reassignment. Administrators also define configurable reassignment rules by team, region, workload, inactivity, or other policy. DSH should not silently change ownership unless an administrator-configured rule explicitly allows that behavior. |
| Q48 | **C.** Administrators define authorization thresholds for SAM analyses/proposal actions. Authorized users may approve/run actions within those limits; higher-risk/out-of-policy actions require administrator approval. |
| Q49 | **C.** Alibaba/supplier information is stored as reference evidence; it is not accepted directly as final purchasing/pricing truth. Administrator approval is required before use in official pricing/proposals. |
| Q50 | **Custom clarification.** Supplier/manufacturer pricing and verification should be **administrator-approved through email evidence**. Alibaba generally does not provide the final negotiated price; Alibaba listings are lead/reference data, not final price authority. Preserve supplier communications/quotes as evidence. |
| Q51 | **C.** System prepares the proposal; administrator reviews/approves and sends it. |
| Q52 | **C + D with admin configuration.** The platform supports both approval-required follow-ups and fully automatic follow-ups. Administrators configure templates, appearance/content, timing, and whether a follow-up sequence is automatic or approval-gated. |
| Q53 | **C.** When regional settings/sources conflict, the system recommends a resolution based on evidence/confidence; an administrator confirms the decision. |
| Q54 | **C.** Evidence storage includes source links, snapshots/copies where allowed, extraction notes, and timestamps. This supplements the structured Evidence tables and hashes already required in Q9. |

---

# 6. Technical Research Findings That Must Be Carried Into the Build

These are research corrections/constraints, not replacements for the user's decisions.

## 6.1 Python 3.14 / PySAM

Current research found that `NLR-PySAM 8.0.0` has CPython 3.14 wheels for supported platforms, including Windows x64.

Target development environment on `ndi2` remains Python 3.14.

Required WP0 verification:

- create isolated environment
- pin the intended PySAM version
- import PySAM successfully
- execute a minimal reference model
- record Python, PySAM, SAM, and SSC versions

Do not downgrade Python merely by assumption.

## 6.2 Correct SAM execution chain

The approved models remain:

- `Pvwattsv8`
- `Pvsamv1`
- `Utilityrate5`
- `Cashloan`

Research indicates the complete SAM configuration should account for the **Grid** module between generation and downstream utility/financial calculations.

Reference parity should be built from official SAM Desktop exported inputs/configurations rather than manually guessing the large set of interdependent model values.

Where a Desktop reference configuration includes other configuration-specific modules such as a load estimator, the benchmark must either reproduce that module or explicitly replace it with an equivalent known load input and document the difference.

## 6.3 PHP economics

The user chose native PHP economics.

Requirements:

- all monetary inputs must use PHP consistently
- do not silently retain US-dollar defaults
- do not silently retain US tax/incentive assumptions
- project cost, financing, tax, incentives, O&M, replacement costs, tariffs, and other financial values need evidence or clearly labeled provisional assumptions
- persist `currencyCode = PHP` for Philippine scenarios
- keep existing `model.js` payback as a separately labeled baseline

## 6.4 Manila / NSRDB Himawari

Himawari is the selected source.

Use:

- TMY for standard/base economics
- historical data for year-to-year production variation

WP0 must still confirm a real Manila request and store:

- requested coordinates
- actual returned grid coordinates
- distance
- dataset/version
- time basis/timezone
- selected weather year or TMY identifier
- file/content hash
- missing-data indicators
- retrieved timestamp

Cache by dataset/grid identity/version and content hash rather than only customer coordinates.

## 6.5 Meralco tariffs

Monthly tariff documents must be normalized into a structured tariff model.

Do not treat a single headline all-in rate as equivalent to all utility billing behavior.

The implementation must distinguish, where applicable:

- import energy charges
- generation charges
- transmission/distribution components
- fixed charges
- demand charges
- TOU schedules
- taxes/other components
- net-metering export compensation
- carry-forward/credit rules
- customer class
- effective month
- source publication/version

Formal financial proposals require verified, sufficiently complete tariff data.

Preliminary lead estimates may use older or incomplete-but-defensible data only under the labeling/approval rules in Q18-Q19.

## 6.6 Net metering and alternatives

Do not assume every system qualifies for Philippine net metering.

Eligibility must be checked against current rules.

When ineligible, the system should evaluate applicable alternatives such as:

- zero export
- self-consumption
- other region-approved arrangements

The exact rule set must be region-specific and evidence-backed.

## 6.7 Pinned CEC equipment

For `Pvsamv1`:

- pin module/inverter CSVs to an exact SAM release
- store release tag/commit if available
- store file hashes
- preserve manufacturer/model IDs
- validate electrical compatibility
- maintain a separate administrator-approved local-market shortlist

CEC presence does not prove:

- Philippine availability
- local certification
- current price
- warranty terms
- supplier reliability

Those require separate evidence.

## 6.8 Chinese manufacturer + Alibaba data

Alibaba is a discovery/reference source, not final-price authority.

Expected workflow:

1. scraper discovers supplier/product listing
2. capture listing evidence, MOQ/specification claims, supplier identity, and timestamp
3. administrator or approved process contacts supplier/manufacturer
4. final negotiated quotation arrives through email or another approved documentary channel
5. administrator approves the quote
6. quote becomes approved pricing evidence with its validity period and source
7. pricing can then be used in formal proposal assumptions

DeepSeek should evaluate how best to model quote validity, supplier identity, quote revisions, shipping/incoterms, duties/taxes, warranty, and currency conversion without changing the approved admin-approval rule.

## 6.9 Benchmarks

Use real SAM Desktop exported reference cases.

At minimum benchmark:

- PVWatts generation
- Pvsamv1 generation
- Grid behavior
- Utilityrate5 billing
- Cashloan financial results
- conservative/base/optimistic scenario construction
- PHP financial mapping

Use strict **model-specific tolerances** as approved in Q29.

Benchmark failures block release of the affected model path.

## 6.10 Partial failure behavior

If a PV calculation succeeds but tariff/finance fails:

- preserve valid generation results
- mark utility/finance stage incomplete/failed
- do not fabricate cash-flow values
- expose the reason
- retain stage-level evidence/status

## 6.11 Evidence and provenance

Maintain structured evidence in both databases.

Evidence/provenance should be capable of storing:

- evidence type
- source URL
- source publication date
- retrieval timestamp
- content hash
- snapshot/archive reference where legally/technically permitted
- locator/page/section
- raw value
- normalized value
- unit/currency
- extraction method + version
- model/software version
- parent object IDs
- verification status
- confidence
- `isSynthetic`

Important distinction:

- `MODELED` != `SYNTHETIC`
- modeled results may be based on real evidence
- synthetic records are fabricated test/development data

## 6.12 Cross-database ingest

Lead Intelligence and SunShare remain separate databases.

Required properties:

- versioned authenticated payloads
- stable external IDs
- idempotency keys
- deduplication
- durable retry/delivery
- acknowledgement of accepted source/version
- synchronization audit
- immutable source evidence
- explicit ownership/organization identity
- synthetic flag propagation
- replay protection/credential rotation

Use an outbox/inbox or equivalent durable-delivery pattern unless DeepSeek identifies a better implementation compatible with the decisions.

---

# 7. Approved Lead-to-Proposal Operating Protocol

```text
DISCOVER SOURCES
      |
      v
SCRAPE READILY AVAILABLE DATA
      |
      v
NORMALIZE + DEDUPLICATE
      |
      v
PENDING REVIEW LEAD LIST
      |
      +--> Table View
      +--> Kanban View
      +--> Detail + Evidence
      |
      v
USER / ASSIGNED REVIEWER QUALIFIES LEAD
      |
      +--> Reject
      +--> More Info
      +--> Save Later
      +--> Duplicate
      +--> Assign/Reassign
      |
      v
QUALIFIED
      |
      v
ASK NEXT ACTION
      |
      +--> Additional Research
      +--> SAM Analysis
      +--> Proposal
      +--> Assignment
      +--> Hold
      |
      v
AUTHORIZED RESOURCE-INTENSIVE WORK
      |
      v
SAM + TARIFF + FINANCIAL MODELING
      |
      v
PRELIMINARY PROPOSAL
      |
      v
ADMIN / AUTHORIZED APPROVAL
      |
      v
SEND + CONFIGURED FOLLOW-UP
```

Key policy:

**The system does not spend SAM/modeling/research resources simply because a lead was scraped. Qualification happens first.**

---

# 8. Sequential Claude Build Order — WP0-WP7

DeepSeek should review this exact order, not rewrite it unless it finds a concrete dependency conflict.

## WP0 — Baseline / compatibility / defect reproduction

- reproduce and fix existing Lead Intelligence defects first:
  - score source
  - deduplication
  - preset filter
  - route wiring
- verify Python 3.14 + pinned PySAM locally on ndi2
- verify Manila Himawari API coverage
- prepare/export SAM Desktop benchmark cases
- record environment/version matrix

Exit: existing baseline works and reference environment is proven.

## WP1 — SunShare schema

- AssessmentSource enum additions
- SolarScenario
- SolarTariff
- Evidence
- synthetic/provenance fields
- preserve `SolarAssessment` headline row and existing readers

Exit: migration and regression tests pass.

## WP2 — PySAM worker + weather

- JSON stdin/stdout CLI
- safe process spawning
- timeout/failure handling
- structured errors
- version/correlation fields
- NSRDB/Himawari adapter + cache
- Grid module support
- reference-generation parity for PVWatts + Pvsamv1

Exit: engineering outputs match reference tolerances.

## WP3 — SunShare SAM provider + utility/finance

- `SAM_PVWATTS`
- `SAM_PVSAMV1`
- Grid -> Utilityrate5 -> Cashloan
- PHP financial assumptions
- tariff validation gates
- preserve existing `model.js` baseline
- stage-level partial failures

Exit: six scenario paths execute reproducibly and finance is blocked when required tariff evidence is invalid.

## WP4 — Lead Intelligence Prisma DB + Evidence

- separate MySQL database
- persistent leads
- evidence/provenance
- deduplication
- synthetic tagging
- qualification workflow state
- assignment/ownership state
- decision history

Exit: lead records and review state persist correctly.

## WP5 — Meralco scraper + cross-DB ingest

- monthly Meralco source documents
- tariff normalization
- source completeness validation
- authenticated ingest
- durable delivery/retries
- idempotency/dedup
- sync audit
- evidence transfer

Exit: a verified tariff version is reproducibly ingested once and linked to evidence.

## WP6 — Root prospecting enrichment adapter

- use existing `/api/prospecting/evaluate`
- preserve kill switches
- preserve quota breakers
- return/store enrichment as evidence
- no expensive enrichment before approved workflow step

Exit: controlled enrichment passes end-to-end.

## WP7 — UI / scoring / proposals / acceptance

- pending-review table
- Kanban
- detail/evidence views
- configurable qualification checklist
- one-owner lead assignment
- DSH PM ownership integration
- individual/bulk actions
- explicit SAM/proposal authorization
- scenario results
- evidence/confidence disclosure
- preliminary proposals
- admin approval/send workflow
- configurable automatic or approval-gated follow-up
- end-to-end acceptance tests
- synthetic-data cleanup gate before production

Exit: reproducible lead -> qualification -> authorized analysis -> proposal -> approval workflow.

---

# 9. Questions DeepSeek Should Specifically Investigate

All user-level choices identified so far are resolved through Q54. DeepSeek should therefore focus on **implementation-level gaps** rather than asking preference questions already answered.

Investigate:

1. Is `NLR-PySAM 8.0.0` still the correct pinned package/version for Python 3.14 and SAM 2026.7.3/SSC 308?
2. What exact module chain and shared-data strategy is required for:
   - Pvwattsv8 -> Grid -> Utilityrate5 -> Cashloan
   - Pvsamv1 -> Grid -> Utilityrate5 -> Cashloan
3. Which SAM Desktop reference configurations are best for Philippine residential and commercial parity tests?
4. What exact Himawari dataset/API identifiers should be pinned for:
   - TMY
   - historical 2016-2020
5. Does the NSRDB/Himawari API provide a stable grid identifier we can use directly, or should one be derived?
6. Which Meralco primary documents contain the complete monthly components required for residential and commercial modeling?
7. Can Utilityrate5 exactly model current Meralco net-metering rollover/export-credit behavior? If not, what minimal adapter is required without breaking the approved SAM chain?
8. What current Philippine rules apply to:
   - net metering
   - zero export
   - system-size limits
   - taxes
   - incentives
   - commercial vs residential treatment
9. What official Philippine sources should be preferred for those rules?
10. What exact CEC module/inverter files ship with the selected SAM release, and how should their release/hash be pinned?
11. How should Philippine supplier availability/certification be modeled separately from CEC electrical validity?
12. What fields are required for Chinese manufacturer/email quotation evidence:
   - quote ID
   - validity
   - MOQ
   - Incoterms
   - shipping
   - duties
   - payment terms
   - warranty
   - certification
   - currency/FX
13. What numerical tolerances should be used per SAM output family based on reproducible floating-point behavior rather than arbitrary percentages?
14. What exact payload/version/idempotency contract is appropriate for Lead Intel -> SunShare ingest?
15. How should evidence snapshots be retained legally and technically for sites that restrict copying while still preserving hashes, locators, and provenance?
16. What production-cleanup mechanism can guarantee synthetic development records are removed without deleting real derived records?
17. Does the approved dynamic conservative/base/optimistic agent selection require a deterministic policy/version record so the same scenario can be reproduced later?
18. How should DSH Project Manager identity/ownership map into SunShare and Lead Intel authorization without creating conflicting permission authorities?
19. Which follow-up communications can be automatic by region and which require policy/consent checks before activation?
20. Identify any WP0-WP7 dependency that would make the approved sequence impossible. Do not reorder merely for preference.

---

# 10. Required DeepSeek Output

Return:

## A. Feasibility verdict
- viable
- viable with corrections
- blocked

## B. Verified facts
Use current primary sources and links.

## C. Concrete corrections
Only changes required for correctness, compatibility, security, reproducibility, or regulatory accuracy.

## D. Remaining implementation-level questions
Do not repeat Q1-Q54.

## E. WP0-WP7 annotations
For each WP:
- prerequisites
- exact outputs
- acceptance tests
- blockers
- handoff information needed by the next WP

## F. DSH run-writing notes for Claude
Do not write the runs yet unless explicitly asked. Instead provide the constraints Claude must preserve when writing them.

---

# 11. Authority Rules

1. User decisions Q1-Q54 override prior suggestions wherever they differ.
2. Do not silently replace the approved architecture.
3. A primary-source incompatibility should be reported explicitly, with the smallest corrective change proposed.
4. Keep the sequential WP0-WP7 build model.
5. One fresh Claude Code session per WP.
6. No code changes, commits, pushes, or agent runs are authorized by this file.
7. The next step after DeepSeek review is to return the reviewed/corrected decision package to ChatGPT, then have Claude write the DSH runs.

