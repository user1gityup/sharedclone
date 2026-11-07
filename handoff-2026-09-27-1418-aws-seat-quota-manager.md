---
name: handoff-2026-09-27-1418-aws-seat-quota-manager
description: "AWS/Kiro/Bedrock seat + free-tier and credit router for DSH: plan done, tooling installed on both hosts, ndi2 owns the build, vmixer2o2 is the read side"
metadata:
  type: project
---

# Handoff 2026-09-27 14:18: AWS seat + quota manager

Handoff id: aws-seat-quota-manager-2026-09-27
Status: active
Updated: 2026-09-27 14:45
Host: vmixer2o2 (user vMixer), Windows 10 Pro build 19045 - the clone; ndi2 is code master
Session: local_e79b79a4-eac2-41ea-a20e-143a7dcddac4 "AWS dashboard seat quota manager plan [55bc98]"
Model: Claude Opus 5
Remote Control: on
Owner: this session owns the PLAN and the read side only; it ends at FINISH-NOW, 237k context
Collaborating agent: Claude Opus 5, session local_d4e0630a "AWS seat build for DSH", host ndi2 (Windows 11 build 26200), Remote Control on - owns the BUILD
Exact ask: read the AWS seat spec, produce an implementation plan, await approvals
Spec: ~/.claude/shared-brain/spec-aws-dsh-seat-quota-manager.md (verbatim copy, 689 lines, md5 53fcd44198026f8a6314fb29d50bdd83); original in ~/Downloads on vmixer2o2 only
ndi2 Phase 0 findings report: ~/.claude/shared-brain/findings-aws-dsh-phase0.md
Repository: ~/Documents/claudecode/deepseek-harness, branch feat/heterogeneous-teammates
Repo state ndi2 (master, build here): HEAD 478ebb005f, clean, level with origin
Repo state vmixer2o2: HEAD 25db02347f, NOT current, 3 untracked from earlier unrelated sessions - never build against it; untouched by this session
Uncommitted by me: none. No repo edit, no commit, no push, no coordination-record claim by this session.

User decisions (one at a time, feedback_step_by_step_one_at_a_time):
1. AWS account exists with active promotional credits
2. Mirror the credential patterns DSH already uses; do not invent an AWS-specific one
3. Both patterns eventually; build on ndi2 first, vmixer2o2 receives later
4. Reach ndi2 by Remote Control
5. vmixer2o2 installs the same tooling ndi2 does, in parallel; credentials come later
6. To ndi2, verbatim: "install the seats and all features i will worry about billing etc later  billing is not within your scope" - answered to a question offering Kiro Pro at $20/mo. Both sessions read it as: install and build everything, BUY NOTHING; and as being about their payments, not an instruction to drop the credit/Free-Tier tracker. Surfaced to the user for correction rather than left silent.

Installed on vmixer2o2, both hash-verified, both mirroring ndi2 exactly:
aws 2.37.4 - winget -e --id Amazon.AWSCLI --version 2.37.4, installer hash verified, C:/Program Files/Amazon/AWSCLIV2/aws.exe, verified "aws-cli/2.37.4 Python/3.14.6 Windows/10 exe/AMD64" exit 0; winget v1.29.380
kiro-cli 2.24.1 - pinned MSI https://prod.download.cli.kiro.dev/stable/2.24.1/kiro-cli-x86_64-pc-windows-msvc.msi, sha256 650322e2eb495ce592984ae45f1a7de725ba59bbf42686fd70c040ba4459ccae, 199049216 bytes, msiexec /quiet /norestart exit 0
Not installed: q (permanently skipped - deprecated alias onto Kiro), sam, cdk. No WSL. Nothing authenticated: no ~/.aws, no AWS_* env, no KIRO_API_KEY.

Key findings, evidence-backed - do not re-derive:
Kiro RUNS ON WINDOWS 10 build 19045 - "kiro-cli-chat 2.24.1", exit 0. The "Windows 11" support claim is documentation only; the MSI performs no OS version check.
Kiro install path is NOT the one the installer prints. No C:/Program Files/Kiro-Cli on a non-elevated install; it fell back per-user to %LOCALAPPDATA%/Kiro-Cli/kiro-cli.exe (332,622,008 bytes). Add/Remove Programs shows "Kiro CLI" 2.24.1.0 with InstallLocation EMPTY. The detector must resolve by PATH, then %LOCALAPPDATA%/Kiro-Cli, then %ProgramFiles%/Kiro-Cli. The binary self-reports as "kiro-cli-chat", not "kiro-cli".
Kiro Free CANNOT run headless - headless needs KIRO_API_KEY, and API key authentication is available only to Kiro Pro, Pro+, Pro Max and Power subscribers. Flags --no-interactive plus --trust-all-tools or --trust-tools; a non-empty initial instruction must arrive as argv or piped stdin; no mid-session input. Reached independently by both sessions. Seat A ships headless_unavailable with cause "entitlement" and lights up automatically if KIRO_API_KEY ever appears. Spec test 7 is the shipping state.
Bedrock has NO free tier, ever - only AWS_PROMOTIONAL_CREDIT and REAL_MONEY apply to Bedrock inference, which makes it the only headless AWS path.
Bedrock inference ALREADY SHIPS via llm-pi-ai: amazon-bedrock route, bedrock-converse-stream, SigV4/AWS_PROFILE/bearer, 114 model ids including Nova, Claude-on-Bedrock and DeepSeek; @aws-sdk/client-bedrock-runtime 3.1048.0 already installed. Do not write a new adapter.
A council seat with transport 'openrouter' + baseUrl + apiKeyEnv needs ZERO transport code for an OpenAI-compatible Bedrock endpoint. credentials-local README already carries the llm-pi-ai/amazon-bedrock record.
Missing and must be added: client-freetier, client-billing, client-cost-explorer, client-budgets, client-pricing. Missing and hardest: nothing reserves quota BEFORE dispatch (spec tests 19, 20).
Entitlement is NOT a named hard filter - the gate rides on RejectionCode UNAUTHORIZED at filter.ts:93, and the new codes attach at that site.
Spec test 12 is a LIVE risk: Bedrock bills under Generative AI and several credit grants exclude that category while the balance still displays. Derive coverage from GetCredits applicableProductNames / purchaseTypeApplications per service per dispatch; where coverage cannot be established confidently, REFUSE the dispatch rather than assume it.
Add GetAccountPlanState to Phase 1 - cheapest headline balance call and the clean CREDIT_EXPIRED source.
The DSH coordination record handoff-2026-09-22-2130 is STALE (still names owner local_d1aa2550, HEAD 812ae0a35e, origin f55855f248). ndi2 corrects that block when it claims the checkout.

Open question (the user's): Phase 3 router shape - a coverage axis ('free' | 'credit' | 'uncovered') on Candidate/RoutingContext, recommended by both sessions, versus a new 'credit' cost class.
Next action: nothing is owed by this host. ndi2 claims the checkout and builds on 478ebb005f. A successor here answers re-verification requests only.
Do not repeat: do not re-probe for AWS CLIs; do not build a Bedrock adapter; do not build against 25db02347f; do not trust the 09-22 record's repo figures; do not hardcode the Kiro path; do not buy a Kiro subscription.

-- Claude Opus 5, vmixer2o2

## Session 2 - 2026-09-27, read side claimed and re-verified

Owner of the read side: Claude Opus 5, host vmixer2o2, session ff5ac231-6724-4f6c-96d9-fb10dc777509.
Claimed after verifying every claim about THIS host against live state. Nothing edited, nothing built, no commit, no push. ndi2 still owns the build.

Re-verified live, all PASS:
- Host is vmixer2o2, Windows 10 Pro build 19045.
- aws 2.37.4 - `aws --version` at C:/Program Files/Amazon/AWSCLIV2/aws.exe returns "aws-cli/2.37.4 Python/3.14.6 Windows/10 exe/AMD64", exit 0.
- kiro 2.24.1 - %LOCALAPPDATA%/Kiro-Cli/kiro-cli.exe, 332,622,008 bytes, self-reports "kiro-cli-chat 2.24.1", exit 0. Confirmed again that it RUNS on build 19045 and that C:/Program Files/Kiro-Cli does not exist, so the per-user fallback path and the "kiro-cli-chat" self-report both stand for the detector.
- Nothing authenticated: no ~/.aws, no AWS_* env, no KIRO_API_KEY. Unchanged.
- Spec copy intact: spec-aws-dsh-seat-quota-manager.md, 689 lines, md5 53fcd44198026f8a6314fb29d50bdd83 - byte-identical to the recorded hash.
- findings-aws-dsh-phase0.md present, 15,509 bytes.
- Build base reachable from here: origin/feat/heterogeneous-teammates = 478ebb005f, matching what ndi2 builds on.

Two corrections to this note's own repo block:
1. The working tree here is NOT just "3 untracked". There is also a MODIFIED tracked file, packages/council/tool-council/tests/pipeline-advance-to-swarm.spec.ts (+10/-4). The same omission was caught in the 09-27 04:07 log entry against a different handoff; it is a recurring blind spot when describing this checkout.
2. "NOT current" understates it - this checkout has DIVERGED, not merely fallen behind. HEAD 25db02347f is 1 ahead / 4 behind origin. 25db02347f ("council(agy): inline the seat's memory files and detect approval stalls") exists ONLY here and is on no remote. Behind by 478ebb005f, c64656c1cd, c13794f5b2, 92cdcade3b. A successor must not treat this checkout as a stale copy of origin that a fast-forward would fix.
   Note for whoever eventually reconciles it: origin's 92cdcade3b is "test(council): approve the plan actually issued in the advanceToSwarm spec" - the same spec file that is modified uncommitted here, so that local edit is plausibly already superseded upstream. NOT verified as identical, and deliberately not touched.

Next action: unchanged - nothing is owed by this host. Stand by as the read side, answer ndi2's re-verification requests against this checkout, never edit it, never build against 25db02347f.

-- Claude Opus 5, vmixer2o2, session ff5ac231
