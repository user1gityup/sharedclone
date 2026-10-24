---
name: handoff-2026-10-05-0030-aws-bedrock-seat-auth
description: "AWS seat auth: Bedrock key + aws login done, credit covers Bedrock, but new-account on-demand quotas are 0; support case pending user submit. Seat still disabled."
metadata:
  type: project
---

# Handoff: AWS Bedrock seat authentication

Handoff id: aws-bedrock-seat-auth-20261005-0030
Updated: 2026-10-05 00:30 local. Host vmixlaptop2x6, user ndi2. Model: Claude Opus 5.5 (Claude Code desktop).
Ask: run ~/Downloads/dsh-aws-seat-auth-troubleshooting.md (investigate why the AWS seat is not signed in, fix, verify).
Remote Control: off. No repo commits. No push.

## Verified
- Root cause of "not signed in": no AWS credential ever existed on this host (kiro-cli whoami "Not logged in";
  aws sts NoCredentials; no ~/.aws; KIRO_API_KEY / AWS_BEARER_TOKEN_BEDROCK unset). Status reporting was correct.
- Kiro seat stays off: Free tier cannot run headless (needs KIRO_API_KEY, Pro+). User chose Bedrock route.
- AWS_BEARER_TOKEN_BEDROCK now set (User env, 132 chars, via ~/Documents/claudecode/SET-BEDROCK-KEY.cmd).
  Free check GET bedrock.us-east-1/foundation-models -> 200.
- `aws login` done: default profile = account 136825752608 **root** credentials.
- GetAccountPlanState: FREE/ACTIVE, $100 remaining, plan expires 2027-03-15. GetCredits: "AWS Free Tier"
  promotion ENABLED, $100, ends 2027-09-14, applicableProductNames include Amazon Bedrock and
  AmazonBedrockFoundationModels.
- Account verification finished (403 "being verified" gone by 00:11).

## Blocker
- bedrock-runtime /openai/v1/chat/completions: amazon.nova-micro-v1:0 -> 404 model_not_found (endpoint does not
  serve Nova; seats.ts aws-bedrock model must change, e.g. openai.gpt-oss-20b-1:0, or use Converse).
- openai.gpt-oss-20b-1:0 -> 429 "Too many tokens per day": every on-demand quota applied at 0 (4/147 non-zero,
  Jamba RPM/TPM only). Codes L-CFA4FA0D, L-E118F160, L-D2912E70, L-036E14D8, L-AF7F0545 = 0, not adjustable.
- Fix = AWS Support service-limit case. ~/Documents/claudecode/OPEN-BEDROCK-QUOTA-CASE.cmd copies case text and
  opens the form; USER must paste + Submit. Not yet confirmed submitted.

## Next action
After AWS raises quotas: one gpt-oss-20b test call (max_tokens 32); change aws-bedrock model off nova-micro
(user approval for repo edit); set council.seats.aws-bedrock.enabled: true in ~/.dsh/settings.yaml; relaunch DSH
so it sees the user env var; confirm seat shows authenticated; confirm quota-aws reads credits.
Do not repeat: Nova Micro on the OpenAI endpoint; Service Quotas increase API (not adjustable).
