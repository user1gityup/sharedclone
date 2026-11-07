# DSH FEATURE: AWS / AMAZON AI SEAT + FREE-TIER AND CREDIT ROUTER

Implement AWS as an additional provider/resource pool within DSH.

The objective is NOT simply to install Amazon software.

The objective is to make DSH automatically exploit all available Amazon/AWS free AI capacity and promotional credits while minimizing paid usage.

AWS resources must participate in the existing DSH router/weight system alongside local LLMs, Claude, Codex, and other seats.

Do not redesign DSH unnecessarily. First inspect the existing seat/provider abstraction, routing system, quota handling, machine identity system, and task lifecycle. Extend those systems.

---

# CORE DESIGN

Create two logically separate AWS seats.

## Seat A — AWS_FREE_AGENT

Purpose:

Use Amazon/Kiro/Q Developer free agent capacity before consuming AWS promotional dollars or paid provider quota.

Preferred current implementation:

Kiro CLI / Amazon Q Developer command-line entitlement.

Requirements:

- Detect whether `kiro-cli`, `q`, and `aws` are installed.
- Detect versions.
- Determine which Amazon CLI implementation is currently supported.
- Detect authentication state.
- Detect whether the account is Free, Q Developer Free, Q Developer Pro, Kiro Free, or another supported entitlement where possible.
- Do not assume the deprecated Amazon Q CLI is the preferred implementation merely because the `q` executable exists.
- Amazon's current Q CLI implementation has migrated to Kiro CLI.
- Maintain compatibility with the legacy `q` command where useful.

Test whether a logged-in Builder ID Free account can safely perform the DSH-required non-interactive workflow.

Do not bypass authentication restrictions.

If official unattended execution is not available for the detected Free account:

- mark the seat `interactive_only` or `headless_unavailable`;
- do not silently consume paid Kiro capacity;
- do not fake headless operation;
- automatically allow the router to consider AWS_BEDROCK_HEADLESS instead.

If legitimate headless execution is available:

Expose the seat through the normal DSH seat interface.

Example conceptual state:

```yaml
provider: aws
seat: aws_free_agent
engine: kiro_cli
execution: headless
cost_class: free_monthly
quota_type: credits
quota_remaining: X
machine_scope: configured
health: ready
```

Capture:

- task ID
- session ID
- originating DSH machine
- start/end timestamps
- model where exposed
- free credits/requests before task
- free credits/requests after task
- estimated units consumed
- files changed
- exit status
- stdout/stderr summary

Never assume one prompt equals one credit. Kiro credits may be fractional.

Use authoritative usage information when available.

Where no supported machine-readable quota API exists, maintain a DSH-side ledger based on actual dispatched jobs and reconcile it against the provider's reported usage when possible.

---

# Seat B — AWS_BEDROCK_HEADLESS

Create a second AWS seat for true programmatic/headless inference through Amazon Bedrock.

This seat represents AWS promotional-dollar-backed AI capacity.

It must be completely distinct from AWS_FREE_AGENT.

The router must understand:

```text
AWS_FREE_AGENT
    recurring provider free allowance

versus

AWS_BEDROCK_HEADLESS
    metered AWS service usage covered by promotional credits when eligible
```

Do not describe promotional credits as "free model requests."

They are dollar credits.

Use Bedrock's supported APIs rather than browser automation.

Design the Bedrock adapter so DSH can route among available models based on:

- task capability
- context length
- estimated input/output size
- latency
- model quality
- current model price
- remaining AWS credits
- credit expiration
- current free resources
- local/subscription quota availability

Support multiple Bedrock models rather than hardcoding one model.

At minimum investigate:

- Amazon Nova family
- Anthropic Claude models available through Bedrock
- suitable low-cost/open models available in Bedrock

Make model availability dynamic because AWS changes the Bedrock catalog.

---

# AWS RESOURCE / QUOTA MANAGER

Create an AWS resource accounting component integrated with the DSH Weight/Router.

Suggested logical name:

`AWSResourceManager`

It must distinguish four resource classes:

1. `PROVIDER_FREE`
   - Example: Kiro/Q monthly free capacity.

2. `AWS_FREE_TIER`
   - AWS services with ongoing or time-limited usage allowances.

3. `AWS_PROMOTIONAL_CREDIT`
   - Dollar-denominated AWS credits.

4. `REAL_MONEY`
   - Any usage that would create an uncovered charge.

DSH must NEVER treat these as equivalent.

---

# AUTHORITATIVE AWS BILLING DATA

Use AWS billing/free-tier APIs whenever possible.

Investigate and use the current APIs corresponding to:

- Billing `GetCredits`
- Billing `GetCreditAllocationHistory`
- Free Tier `GetFreeTierUsage`
- Free Tier `GetAccountPlanState`
- Free Tier `ListAccountActivities`
- Free Tier `GetAccountActivity` where available
- AWS Budgets
- Cost Explorer / current billing data
- AWS Price List APIs

Do not hardcode the user's AWS promotional-credit balance.

`GetCredits` should be used to determine data including:

- initial credit value
- remaining credit value
- start date
- expiration date
- credit status
- applicable AWS products/services
- estimated/exhaustion information where exposed

Credits may not apply to every product.

Before routing a paid AWS job, verify that the available credit actually applies to that service.

---

# FREE-TIER TRACKING

Use `GetFreeTierUsage` to discover free allowances dynamically.

For every discovered offer track:

- service
- operation
- region
- usage type
- free-tier type
- limit
- actual usage
- forecast usage
- percentage consumed
- percentage remaining

Do NOT maintain a static list as the source of truth.

AWS changes Free Tier offers.

Local metadata may cache the result but AWS remains authoritative.

---

# AWS CREDIT-EARNING ACTIVITIES

AWS can provide additional promotional credit for completing designated account activities.

Query the account's currently available activities rather than assuming fixed values.

Expose:

```yaml
aws_credit_activities:
  available:
  completed:
  credit_awarded:
  still_earnable:
```

Surface these to DSH but NEVER automatically create chargeable infrastructure merely to obtain a credit without an explicit cost/benefit check.

Examples presently documented by AWS include activities involving:

- EC2
- Bedrock
- AWS Budgets
- Lambda
- RDS

Treat the live account API as authoritative.

---

# HARD COST BOUNDARY

Add a configurable DSH policy:

```text
aws_real_money_allowed = false
```

Default it to FALSE.

When false:

DSH may use:

- provider free allowance
- AWS Free Tier allowance
- eligible AWS promotional credits

DSH must NOT intentionally create uncovered AWS charges.

Routing state should therefore be:

```text
FREE
    consume freely according to router policy

CREDIT_BACKED
    consume if expected benefit justifies promotional-credit burn

PAID_UNCOVERED
    block unless user explicitly changes policy
```

Before a credit-backed task starts, calculate estimated cost.

After completion, reconcile estimated cost with AWS billing/usage data when available.

---

# CREDIT EXPIRATION OPTIMIZATION

Credits that expire are wasting value if they remain unused.

Add expiration-aware weighting.

Example:

```text
if credit expires soon:
    increase AWS credit seat routing weight

if credit has substantial time remaining:
    prioritize recurring free resources first

if estimated task cost exceeds remaining eligible credit:
    do not launch without explicit authorization
```

Display:

```text
AWS CREDIT
Remaining: $XX.XX
Original: $XX.XX
Expires: YYYY-MM-DD
Days remaining: XX
Current burn rate: $X.XX/day
Projected unused at expiration: $XX.XX
```

DSH should try to maximize useful work from expiring credits without creating pointless usage simply to consume them.

---

# KIRO / Q FREE QUOTA

Track the free Amazon coding-agent allowance separately.

Current free offerings change, so query live state where possible.

Store:

```yaml
monthly_limit:
used:
remaining:
reset_date:
usage_percent:
provider_reported_balance:
dsh_observed_usage:
last_reconciled:
```

Kiro currently exposes usage information within its interfaces.

If no stable API exists, create an adapter rather than a brittle screen scraper.

Do not assume every agent task costs exactly one credit.

---

# ROUTING PRIORITY

Integrate these resources into the existing DSH weight system.

The general objective is:

```text
local/no-cost capability
    ↓
recurring free subscription/provider capacity
    ↓
expiring promotional credits
    ↓
already-paid subscription capacity
    ↓
additional paid API capacity
    ↓
uncovered real-money AWS usage only when explicitly allowed
```

Do not hardcode that exact order globally.

The existing router should still account for:

- quality required
- execution speed
- context requirement
- tool requirement
- model suitability
- remaining quota
- expiration
- task urgency
- machine availability
- expected monetary cost

AWS becomes another provider with multiple resource classes.

---

# AMAZON Q / KIRO GITHUB CAPACITY

Investigate Amazon Q Developer for GitHub.

AWS currently provides free limited feature-development and code-review capacity in the GitHub integration.

Determine whether this represents a useful additional DSH resource pool.

If useful, implement it as a distinct capability:

`AWS_Q_GITHUB`

Do NOT mix its allowance into Kiro/Q CLI usage unless AWS explicitly reports that they are the same quota.

Track them independently until proven otherwise.

Potential uses:

- code review
- issue-to-feature implementation
- PR review
- contained repository tasks

Respect the Shared Brain repository safety model.

Do not grant an AWS/GitHub agent write access to protected production repositories merely because the integration supports writing.

Use approved mirrors/scratch repositories where required by existing DSH policy.

---

# AWS AGENT TOOLKIT

Install/integrate the official Agent Toolkit for AWS where appropriate.

Current AWS tooling supports agents including:

- Codex
- Claude Code
- Kiro
- other MCP-compatible agents

Use it primarily to:

- provide current AWS documentation
- reduce AWS-related prompt/token waste
- expose AWS APIs through controlled MCP access
- enforce IAM permissions
- improve AWS automation accuracy
- provide auditable AWS actions

Do not give the toolkit unrestricted AWS permission.

Use least-privilege IAM.

Read-only billing visibility should be separated from infrastructure modification permissions.

---

# OTHER AI/FREE-CREDIT OPPORTUNITIES

Build a discovery/report component rather than blindly provisioning these services.

Evaluate at least:

## SageMaker AI

Detect currently available Free Tier/trial usage.

Potential DSH uses:

- model benchmarking
- model evaluation
- inference experiments
- preprocessing
- small training experiments
- serverless inference testing

Do not run expensive persistent endpoints merely because promotional credit exists.

## Amazon Bedrock

Evaluate:

- Nova models
- Claude through Bedrock
- embeddings
- model evaluation
- prompt optimization
- intelligent routing
- batch inference
- Knowledge Bases
- speech models
- image/multimodal capabilities

DSH already has its own router.

Do not replace DSH routing with Bedrock routing without benchmarking them against each other.

## Document AI

Evaluate Amazon Textract for Shared Brain/document ingestion when free-tier capacity exists.

Possible flow:

```text
document
→ Textract
→ structured text/metadata
→ Shared Brain ingestion pipeline
```

## Voice AI

Evaluate Amazon Nova Sonic / appropriate AWS speech services for a DSH hands-free voice interface.

This should be an optional capability and not part of the initial critical path.

## AgentCore

Evaluate but do NOT make it an initial dependency.

DSH already provides orchestration.

Only adopt AgentCore components when they solve a demonstrated problem better or more cheaply than the existing DSH implementation.

---

# DASHBOARD / STATUS OUTPUT

Add an AWS section to the DSH quota/resource status.

Example:

```text
AWS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Kiro Free
Status: READY
Monthly: 12.35 / 50 used
Remaining: 37.65
Reset: YYYY-MM-DD
Headless: YES/NO

AWS Promotional Credits
Remaining: $173.42
Expires: YYYY-MM-DD
Days Remaining: 142

Free Tier
Lambda: 8% used
SQS: 2% used
SageMaker Serverless: 31% used
...

Bedrock
Status: CREDIT-BACKED
Estimated available inference value: dynamic
Real-money fallback: BLOCKED

Q GitHub
Status: AVAILABLE
Remaining allowance: known/unknown

Credit Activities
Completed: X
Available: X
Potential additional credit: $XX
```

---

# MACHINE / DSH INTEGRATION

Respect DSH machine identity.

An AWS account/provider seat is not automatically equivalent to a physical DSH machine.

Keep separate concepts for:

- execution provider
- account/seat
- originating physical machine
- workspace
- session
- task

Do not break the existing origin-machine/session-resume behavior.

AWS jobs may be dispatched from VMixer, NDI, or future machines while still belonging to one AWS provider seat.

The result must be returned to the originating DSH task/session.

---

# SECURITY

Create separate IAM scopes.

Billing/quota monitor should preferably need only read permissions such as those required for:

- Free Tier usage
- credit information
- budgets
- cost information
- price information

The coding/agent seat should receive only the AWS service permissions its task actually requires.

Do not give billing-monitor credentials infrastructure-admin rights.

Do not store secrets in the repository.

Use existing DSH secret/credential management.

---

# TESTING

Build automated tests for:

1. CLI not installed.
2. Legacy `q` installed.
3. Current Kiro installed.
4. Logged out.
5. Builder ID Free.
6. Paid Kiro/API-key mode.
7. Headless unsupported.
8. Headless supported.
9. Kiro monthly allowance exhausted.
10. AWS promotional credits available.
11. Credits expired.
12. Credits do not apply to requested AWS service.
13. Free Tier resource remains.
14. Free Tier exhausted but promotional credit remains.
15. Promotional credit exhausted.
16. Real-money AWS disabled.
17. Billing API unavailable.
18. Temporary AWS API/network failure.
19. Multiple DSH machines accessing the same AWS seat.
20. Concurrent dispatch attempting to double-spend the same quota.

Quota reservations must be concurrency-safe.

---

# DELIVERABLES

Produce:

- AWS seat/provider adapter
- Kiro/Q capability detector
- Bedrock headless provider
- AWSResourceManager
- Free Tier tracker
- promotional-credit tracker
- AWS credit-activity tracker
- price/cost estimator
- hard real-money spending gate
- router/weight integration
- AWS quota status display
- configuration documentation
- least-privilege IAM policy examples
- tests
- implementation notes
- migration notes if existing DSH provider interfaces must change

Also produce a short findings report showing:

```text
CURRENT AWS RESOURCES
FREE CAPACITY
PROMOTIONAL CREDIT CAPACITY
PAID/UNCOVERED CAPACITY
SERVICES WORTH USING
SERVICES NOT WORTH USING
RECOMMENDED ROUTING ORDER
```

Do not provision expensive resources during development simply to demonstrate that they can be provisioned.

Use harmless read-only discovery first.

Before implementation is considered complete, demonstrate one real DSH dispatch through the Amazon/Kiro/Q path if legitimately supported and one low-cost Bedrock test through the AWS credit-backed path.

The final design should allow the DSH router to answer, before every AWS task:

- "Is there a free way to perform this?"
- "If not, is there an expiring AWS credit-backed way?"
- "What will this task approximately cost?"
- "Will that cost be covered?"
- "Is another existing DSH seat more economical?"
