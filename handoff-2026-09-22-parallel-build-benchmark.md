---
name: handoff-2026-09-22-parallel-build-benchmark
description: "User wants their next builds run in parallel by agents to produce a real Amdahl's-law benchmark (measured S, not estimated). Full scope now resolved: 3 repos (canna/commerce/users). Nothing built yet — next step is mapping the real task dependency graph, awaiting user go-ahead."
metadata:
  type: project
---

Stable id: handoff-2026-09-22-parallel-build-benchmark
Updated: 2026-09-22 16:50, host vmixlaptop2x6 (hostname; brain calls this machine ndi2), session dab7b48d-3d6f-4638-9daf-017b0fadac64, model Claude Opus 5.5. Remote Control: unknown/not checked.
Owner: Claude Opus 5.5 (claimed 16:50). Prior owner Claude Sonnet 5 session 3e7b9bfc (FINISH-NOW, 12.4h). No collaborating agents yet.

## Session 2 — Claude Opus 5.5, 2026-09-22 16:50 (CURRENT — read first)
- **User's exact ask:** "handoff-2026-09-22-parallel-build-benchmark.md; please resume with the planning phase i want to use dsh council and dsh swarm in the actual building process"
- This answers the open question below (yes, map the task graph) AND **reverses decision 4 of the baseline** ("parallel Agent-tool subagents, not DSH swarm"): the build itself must run through DSH council + DSH swarm (pipeline tool). Still PLANNING ONLY — no scaffolding, no repo dirs, no DSH pipeline runs until user says go.
- Verified 16:50: `users`/`canna`/`commerce` dirs do NOT exist; billboard-platform, green-energy-platform, `~\Downloads\members-only-wholesale-retail-network-FOCUSED-build-prompt.md` exist.
- Known risk carried in from brain: DSH pipeline has never completed a swarm that wrote code (dsh-runs.md 2026-09-21 05:26 "did not complete with a swarm that produced code"); swarm file-writing units need approved workspace staging + source roots (dsh-swarm-profiles.md); local-writer/submit_work route status per handoff-2026-09-18-0900-dsh-local-writer-route.md. Plan must include a DSH-readiness gate before the real build.
- In progress: mapping DSH build path (harness code) + portable code (billboard/green-energy) + task graph, via read-only workflow. Nothing written except this note.
- Next action if picked up cold: finish the read-only mapping, present plan, ask ONE question at a time (feedback_step_by_step_one_at_a_time).

**User's exact ask (original, garbled):** "work with the agent working on ,my next two builds in parellel so we can create the benchmarks we" — run the user's next builds with parallel agents to get a *measured* serial fraction (S) and real speedup, instead of the estimated S≈0.35–0.5 used for the billboard-platform baseline.

**Baseline context (real, don't re-derive):**
1. `billboard-platform` (LeadForge), single-instance build: 19 sessions, 15 calendar dates, ~49.03 active hours (15-min-gap-capped), 9,861,549 output tokens, 473,901 new input, 6.27B cache-read, 39.4M cache-write. Script: `~\AppData\Local\Temp\claude\C--Users-ndi2-Documents-claudecode\14f21972-7568-47b7-af5f-d853788a6117\scratchpad\billboard-usage2.mjs` (session scratchpad — may not survive, rewrite if gone).
2. That build used one Claude Code instance, pre-council/pre-swarm.
3. Amdahl's Law framing already given to the user: Speedup(N)=1/(S+(1−S)/N), ceiling 1/S at N→∞. Estimated S≈0.35–0.5 for billboard's module shape. Offered to compute a *real* S for an upcoming build by mapping its actual dependency graph before starting — that offer is what this whole thread is resolving toward.
4. Mechanism decided: **parallel Agent-tool subagents** (not DSH swarm — swarm's end-to-end paid execution is still unverified per [[handoff-2026-09-22-dsh-swarm-power-estimate-question]]).

**Scope evolution this session (read in order — each step supersedes the last; final state is the "FINAL RESOLVED SCOPE" block below):**
1. Started as "two builds," assumed to be the cannabis+ecommerce adapter-lanes of the single combined platform in [[handoff-2026-09-22-0412-members-only-marketplace-platform]]. User corrected this: "cannabis is its own thing, ecommerce is its own thing" — i.e. NOT that platform's Vertical Adapter design, separate repos instead.
2. User then confirmed: two fully independent repos, each with its own DB, "completely separate things." Resolved the 04:12 handoff's 4 open items: launch state = **CA** (Metrc); cannabis retail POS = **Dutchie + Treez** (reconfirmed, unchanged from 04:12); wholesale/B2B ERP = **Distru + LeafLink** (reconfirmed, unchanged); Solana network = **devnet** (both sites still pre-launch/dev); cannabis payment processor = **Dutchie Pay + Treez Pay for B2C, crypto or ACH for B2B**.
3. User then raised a real 280E consideration: on the cannabis site, non-cannabis merch revenue must stay financially/data-separate from cannabis product revenue (280E disallows normal deductions for cannabis-trafficking revenue), but customers must NOT need two passwords for what feels like one store.
4. Resolved via a **shared identity/auth service**, extracted from billboard-platform's `lib/auth.js`/`lib/session.js`: single login/session/customer-record, trusted by both product-side repos, while catalog/inventory/POS-ERP/payments stay fully separate per repo/DB. User confirmed the shared login covers **all** storefronts, not just cannabis+merch.
5. Merch and the separately-discussed "ecommerce" vertical were **consolidated into one repo** (`commerce`) — user did not keep them separate. Final repo count is **three**.

**FINAL RESOLVED SCOPE (this is authoritative — build from this, not from steps 1–2 above):**
- **`canna`** — cannabis product storefront. Dutchie+Treez retail POS, Distru+LeafLink B2B/wholesale ERP, Metrc compliance (CA), payments = Dutchie Pay + Treez Pay (B2C), crypto or ACH (B2B).
- **`commerce`** — non-cannabis retail: merch + the general ecommerce vertical, combined into one repo. Reuses billboard-platform's Stripe + Solana(devnet) PaymentRequest engine.
- **`users`** — shared identity/auth/session service. Both `canna` and `commerce` trust its session token for single sign-on. This is a genuine **serial foundation dependency** — the one deliberate exception to "fork now, extract later." Build/stand up `users` first; `canna` and `commerce` proceed in parallel against it once it exists.
- Dependency graph for the Amdahl's-law measurement: **Phase 0 = `users` (serial) → Phase 1 = `canna` ∥ `commerce` (parallel)**.
- Repo names are chosen (`canna`, `commerce`, `users`) but **none of the three repos exist on disk yet** — nothing has been scaffolded, no `npm init`, no directories created.

**What is done:** nothing built or run yet. All scope/architecture clarified through five rounds of back-and-forth (AskUserQuestion + free-text) across this session. No code touched, no files created besides this handoff and its MEMORY.md/shared-agent-log.md entries.

**What is NOT yet resolved:**
- Whether "fork independently from billboard-platform" (my recommendation, which the user did not explicitly contest) is actually how `canna` and `commerce` should be scaffolded once `users` exists, versus some other reuse strategy for the non-auth parts. Treat as tentative, not confirmed.
- No task-graph mapping has actually been run yet — the Explore-agent method from the 04:12 session (reading real files in billboard-platform/green-energy-platform to find what's portable) has not been applied to `users`/`canna`/`commerce`.
- I asked the user "are you ready for [me to map the task dependency graph]?" and the FINISH-NOW quota trigger fired before they answered — **this exact question is still open, pick up there.**

**Exact next action:** Ask the user (again, if picking this up cold) whether to proceed with mapping the real task dependency graph for `users` → `canna` ∥ `commerce`, using Explore agents against `billboard-platform`/`green-energy-platform` to find what's portable into `users`'s auth/session code and into each storefront — this is analysis/planning only, not scaffolding, and produces the actual inputs needed to measure S. Per "nothing without permission" standing rule: do not scaffold any of the three repos, run `npm init`, create directories, or spawn build-executing subagents until the user explicitly says go on that separately.

**Do not repeat:**
- Don't re-run the billboard-platform token/time computation — the baseline numbers above are real and final.
- Don't fabricate a measured S — it must come from an actual run's transcripts, same method as the billboard script.
- Don't re-ask the resolved items: launch state (CA), POS/ERP vendors (Dutchie+Treez / Distru+LeafLink), Solana network (devnet), cannabis payment processor (Dutchie Pay+Treez Pay B2C, crypto/ACH B2B), repo names (canna/commerce/users), or whether ecommerce shares the login (yes, confirmed).
- Don't reintroduce the discarded "two independent repos, no shared identity" framing from step 2 above — it was superseded by the `users` shared-auth design in step 4.

**Verification:** none needed yet, nothing executed.

**Permissions / commit / push:** nothing to commit, nothing to push.
