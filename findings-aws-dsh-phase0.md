---
name: findings-aws-dsh-phase0
description: "Phase 0 findings report for the AWS/Kiro/Bedrock seat + quota manager spec. Read-only discovery on ndi2 plus live research, in the format the spec's DELIVERABLES section requires. Two findings cut the build roughly in half."
metadata:
  type: project
---

# AWS seat + quota manager — Phase 0 findings report

Claude Opus 5, session `local_d4e0630a-9515-485d-8689-1033ff1de919`, host **ndi2**, Remote Control ON.
Date 2026-09-27. Spec: [[spec-aws-dsh-seat-quota-manager]] (689 lines, md5 `53fcd44198026f8a6314fb29d50bdd83`), read in full.
Plan context: [[handoff-2026-09-27-1418-aws-seat-quota-manager]]. Read side: Claude Opus 5 `[55bc98]` on vmixer2o2.

This is the "short findings report" the spec's DELIVERABLES section asks for, in its own headings. No code written, no repo file touched, nothing provisioned, nothing spent.

## THE TWO FINDINGS THAT CHANGE THE BUILD

**1. Seat A cannot ship as a working seat. Kiro Free cannot run headless — by design, not by misconfiguration.**
Kiro headless mode authenticates *only* with an API key in `KIRO_API_KEY`, and API key authentication is available only to Kiro Pro, Pro+, Pro Max and Power subscribers. Kiro Free ($0, 50 credits/month) has no sanctioned unattended path. The spec's own instruction then applies verbatim: mark the seat `headless_unavailable`, do not silently consume paid Kiro capacity, do not fake headless operation, let the router fall through to `AWS_BEDROCK_HEADLESS`. Spec test 7 is the shipping state, not an edge case. This also resolves the spec's completion criterion "demonstrate one real DSH dispatch through the Amazon/Kiro/Q path **if legitimately supported**" — it is not, so that demonstration is satisfied by the detector correctly reporting unavailable.

**2. Bedrock has no free tier at all, ever.** So of the spec's four resource classes, only two can apply to Bedrock inference: `AWS_PROMOTIONAL_CREDIT` and `REAL_MONEY`. `PROVIDER_FREE` and `AWS_FREE_TIER` remain real and must still be tracked, but they describe other AWS services, never Bedrock tokens. The router must not be built to hope for a free Bedrock path.

## CURRENT AWS RESOURCES

Probed on ndi2, 2026-09-27, read-only:

| Item | State |
|---|---|
| `aws`, `kiro`, `kiro-cli`, `q`, `sam`, `cdk` | **all ABSENT** before this session |
| `~/.aws` | ABSENT |
| `AWS_*` environment variables | none set |
| `~/.kiro`, `~/.q`, `AppData/Local/Programs/kiro`, `AppData/Local/Amazon`, `C:\Program Files\Amazon` | all absent |
| AWS CLI v2 | **2.37.4 being installed now**, on the user's explicit go this session (winget `Amazon.AWSCLI`) |

vmixer2o2 reports the same bare state. **Correction to user decision 3's premise:** ndi2 was chosen as the build host because it "has the most complete credential set and the quota/budget tools work there." That is true of DSH's own credentials and quota tooling, and it remains the right host for the code. It is **not** true of AWS: neither host has any AWS account access. The AWS credential has to be created before Phase 1 can read a single real number, and creating it is the user's alone.

Harness checkout on ndi2 (the code master): HEAD `478ebb005fbcf49b10d37f29771b8ea53e8add76`, branch `feat/heterogeneous-teammates`, tree clean, 0 ahead / 0 behind `origin`. vmixer2o2's `25db02347f` is a different commit; nothing is to be built against it.

## FREE CAPACITY

**Kiro Free — present but unusable headless.** $0/month, 50 credits, open-weight models plus Claude Sonnet 4.5. Paid tiers: Pro $20 / 1,000 credits, Pro+ $40 / 2,000, Pro Max $100 / 5,000, Power $200 / 10,000, add-on credits $0.04 each. Headless invocation shape, for the detector to recognise: `kiro-cli chat --no-interactive --trust-all-tools "<prompt>"`, with `--trust-tools=<categories>`, `--agent <name>`, `--output-format stream-json`. Gated on `KIRO_API_KEY`, Pro and above.

**Amazon Q Developer — a closed door, not an alternative.** The Q Developer CLI was rebranded and auto-updated to Kiro CLI from 2025-11-24; the `amazon-q-developer-cli` repo is archived on security fixes only. New Q Developer Free Tier and Pro subscription creation was **blocked from 2026-05-15** — already past. IDE plugins and paid subscriptions reach end of support 2027-04-30. No new Q free entitlement can be created. The spec's instruction not to assume the legacy `q` binary is preferred is correct and now moot: on these hosts `q` does not exist, and where it does exist elsewhere it is a backward-compatible alias onto Kiro.

**AWS Free Tier (services) — real, and must stay dynamic.** `GetFreeTierUsage` (namespace `freetier-2023-09-07`) returns `freeTierUsages[]` with `service`, `operation`, `region`, `usageType`, `freeTierType`, `limit`, `unit`, `actualUsageAmount`, `forecastedUsageAmount`, `description`, plus `nextToken`; request takes an optional Cost-Explorer-style `filter` Expression (`And`/`Or`/`Not`/`Dimensions{Key,MatchOptions,Values}`), `maxResults` 1–1000, `nextToken`. Percentage consumed and remaining are derived, not returned — compute them. This confirms the spec's "do NOT maintain a static list as the source of truth."

**Amazon Bedrock — no free tier.** Confirmed: no permanent free tier and no dedicated free trial token grant. What new accounts get is promotional credit, which is dollars, not free requests — exactly the distinction the spec insists on.

**Q Developer for GitHub — unverified, do not count it.** No standalone free GitHub allowance could be confirmed against the Q end-of-support track. Track it as `unknown`, never fold it into Kiro/Q CLI usage (spec is explicit), and do not let the router treat it as capacity until AWS reports a number.

## PROMOTIONAL CREDIT CAPACITY

The APIs exist and are sufficient. No scraping needed.

**`GetCredits`** — namespace `billing-2023-09-07`. Request: `accountId` (required, 12-digit), `startDate` (**required**, past, not more than one year back, Unix epoch seconds), `endDate` (optional, not future, ≥ startDate, defaults to today), `payerAccountFlag` (optional; `true` from a management account aggregates the whole consolidated billing family). Response `credits[]` of `CreditData`, each carrying everything the spec asked for and more:

`creditId`, `creditType`, `applicationType`, `description`, `ruleName`, `accountId` · amounts `initialAmount`, `remainingAmount`, `estimatedAmount`, each `{currencyAmount, currencyCode}` · dates `startDate`, `endDate`, `exhaustDate` · status `creditStatus`, `creditConsoleVisibility` · **applicability `applicableProductNames`, `purchaseTypeApplications`, `costCategoryArn`** · sharing `creditSharingType`, `accountHasCreditSharingEnabled`, `shareableAccounts`.

Errors to map to the spec's "degrade to unknown, never to free": `AccessDeniedException` 400, `ThrottlingException` 400, `ValidationException` 400, `InternalServerException` 500.

**`GetAccountPlanState`** — namespace `freetier-2023-09-07`, no request parameters. Returns `accountId`, `accountPlanType` (`FREE|PAID`), `accountPlanStatus` (`NOT_STARTED|ACTIVE|EXPIRED`), `accountPlanRemainingCredits{amount,unit}`, `accountPlanExpirationDate`. The cheapest single call for the headline balance and expiry, and the clean source for a `CREDIT_EXPIRED` decision. **The peer's plan did not include this call — add it.**

**Shape of the money.** New AWS accounts created after 2025-07-15 receive up to $200: $100 on sign-up and $100 across five guided activities, one of which is a Bedrock prompt. The free account plan expires after 6 months or when credits run out, whichever comes first. That 6-month clock is what makes the spec's expiration-aware weighting worth building rather than theoretical.

**The risk the spec named as test 12 is live, not hypothetical.** Bedrock bills under the Generative AI category, and a number of promotional and startup credit grants exclude that category *even while the balance still shows in the billing console*. AWS Activate credits are documented as usable on Bedrock including third-party models; other grants are not. Therefore: **never infer coverage from a non-zero balance.** Check `applicableProductNames` / `purchaseTypeApplications` for the specific service before every credit-backed dispatch, and reject with `CREDIT_NOT_APPLICABLE` otherwise. This one field is the difference between the spec's design working and the user being quietly billed.

## PAID / UNCOVERED CAPACITY

Bedrock inference is metered on every call; coverage is a separate question from cost. `aws_real_money_allowed = false` (default false, a validated cordis Config field — no hardcoded tunables) must gate it, enforced at the router's existing `UNAUTHORIZED` site in `filter.ts:93`, extended with `REAL_MONEY_BLOCKED`, `CREDIT_NOT_APPLICABLE`, `CREDIT_EXPIRED` alongside the current 12 `RejectionCode` values in `router/types.ts:151`.

Cheapest metered path for a first low-cost credit-backed test: Amazon Nova Micro, about $0.035 per million input tokens. Kiro add-on credits, if ever relevant, are $0.04 per credit on paid plans only.

## SERVICES WORTH USING

- **Bedrock inference through the adapter DSH already has.** `packages/llm/llm-pi-ai` carries the `amazon-bedrock` catalog route and `bedrock-converse-stream`; `@aws-sdk/client-bedrock-runtime@3.1048.0` is already installed; the installed pi-ai catalog holds 114 Bedrock model ids including `amazon.nova-micro/lite/pro-v1:0`, `nova-2-lite`, Claude on Bedrock with `us.`/`eu.`/`au.`/`global.` prefixes, and `deepseek.v3`/`r1`. **Write no new Bedrock adapter.** Bedrock's OpenAI-compatible Chat Completions endpoint additionally means a council seat with `transport: 'openrouter'` plus `baseUrl` and a credential reference reaches it with zero transport code (`seats.ts:24`, `:99`, `:136`). The credential slot already exists and is documented at `credentials-local/README.md:48` and `:52`.
- **The billing and free-tier read APIs** above: `GetCredits`, `GetAccountPlanState`, `GetFreeTierUsage`, plus Cost Explorer for post-run reconciliation and Price List for pre-flight estimates. All five SDK clients are **missing** from the checkout and must be added: `@aws-sdk/client-billing`, `client-freetier`, `client-cost-explorer`, `client-budgets`, `client-pricing`.

## SERVICES NOT WORTH USING

- **Kiro as a dispatchable seat** — blocked by tier, per finding 1. Build the detector, ship the seat `headless_unavailable`, spend nothing on it. Revisit only if the user chooses to pay $20/month, which is a separate decision and not assumed here.
- **Amazon Q Developer, in any form** — on the end-of-support track, new entitlements already closed since 2026-05-15.
- **Q Developer for GitHub** — unverified allowance; report only.
- **SageMaker AI, Textract, Nova Sonic, AgentCore** — the spec already says discovery report only, never provisioning. Nothing here changes that, and nothing should be stood up to prove it could be.

## RECOMMENDED ROUTING ORDER

Not hardcoded globally — expressed as router weights and hard filters, as the spec requires:

1. local / no-cost capability (existing local targets)
2. recurring free subscription capacity already in DSH (Claude, Codex seats)
3. AWS Free Tier allowance, where a task actually maps to a covered service — **never Bedrock tokens**
4. AWS promotional credit, weighted **up** as `accountPlanExpirationDate` / credit `endDate` approaches, and only after `applicableProductNames` confirms the service is covered
5. already-paid subscription capacity
6. additional paid API capacity
7. uncovered real-money AWS usage — **blocked** unless `aws_real_money_allowed` is explicitly true

## WHAT IS STILL BLOCKED, AND ON WHOM

- **The user, and only the user:** create AWS programmatic access (an IAM identity with billing-read separated from inference permissions). Until that exists, every number in Phase 1 is unreadable and no Bedrock call can be made. Neither host has any AWS credential today.
- **The user, one open design decision (not to be taken by any agent):** whether to add a coverage axis `'free' | 'credit' | 'uncovered'` to `Candidate`/`RoutingContext` and leave `RoutingCostClass` alone, or add a `'credit'` cost class. Both this session and the vmixer2o2 session independently recommend the coverage axis: `Assignment.estimatedUsd` (`types.ts:197`, documented "Zero for local, free and included") already states the meter honestly, so *who pays the meter* is a genuinely separate fact, and a new cost class would churn every `assertNever` switch across estimates, roster and swarm for no added truth.
- **Ownership:** the DSH coordination record ([[handoff-2026-09-22-2130-dsh-swarm-readiness-gate-commerce]]) still names Claude Opus 5.5 `local_d1aa2550` on vmixlaptop2x6 as owner and records HEAD `812ae0a35e` / 10 ahead of `f55855f248`. Both are stale — origin has moved to `478ebb005f` and the tree is clean. Whoever takes the build must correct that block, not append to it. No ownership claimed by this session yet.
- **Unrelated, flagged so it is not lost:** the vmixer2o2 checkout carries three untracked files (`openclaw-transport.ts`, `optimize.ts`, one agent note) from earlier sessions. Nobody currently owns them and nobody has checked whether they hold work that should come back.

## THE HARDEST REMAINING ITEM

Nothing in DSH reserves quota **before** dispatch — `packages/council/tool-council/src/quota-hold.ts` parks a run only after exhaustion. Spec tests 19 (multiple machines on one AWS seat) and 20 (concurrent dispatch double-spending the same quota) require a new atomic, fleet-aware reservation ledger. That is the single largest piece of genuinely new work in the whole spec, and it is worth sizing before Phase 1 starts rather than discovering it in Phase 3.

## GATE TAX

`packages/*/*/src` is under a per-file 100% coverage gate, plus runtime invariants, bilingual `README.md`/`README.zh.md` pairs, `verify-export-jsdoc`, knip, workspace constraints, config and client catalogs, third-party notices, and an Agent Note per non-trivial change. This is why the plan proposes **two** new packages (`packages/quota/quota-aws`, `packages/client/ui-aws-quota`, shaped after `quota-antigravity` and `ui-antigravity-quota`) rather than eight.

## SOURCES

- [Amazon Q Developer end-of-support announcement](https://aws.amazon.com/blogs/devops/amazon-q-developer-end-of-support-announcement/)
- [Upgrade to Kiro — Amazon Q Developer](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/upgrade-to-kiro.html)
- [Headless mode — Kiro CLI docs](https://kiro.dev/docs/cli/headless/)
- [Kiro pricing](https://kiro.dev/pricing/)
- [GetCredits — AWS Billing and Cost Management](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html)
- [GetFreeTierUsage — AWS Billing and Cost Management](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_freetier_GetFreeTierUsage.html)
- [GetAccountPlanState — AWS Billing and Cost Management](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_freetier_GetAccountPlanState.html)
- [API compatibility — Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html)
- [AWS Activate credits now accepted for third-party models on Amazon Bedrock](https://aws.amazon.com/blogs/startups/aws-activate-credits-now-accepted-for-third-party-models-on-amazon-bedrock/)
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
