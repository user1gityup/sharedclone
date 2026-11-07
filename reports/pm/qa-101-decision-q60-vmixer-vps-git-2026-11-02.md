# PM 101-question interview — Q60 Parking local-to-VPS deployment decision
Append-only conflict-safe Shared Brain decision, 2026-11-02. Preserve the newer concurrent canonical ledger `reports/pm/qa-101-progress-2026-11-01.md`; DO NOT overwrite or claim merged with canonical without reading and reviewing latest content. PM original comment **#1185** on task **T-cdbb8b03**.

## User-confirmed custom Q60 of 101
- Parking pilot runtime **LOCAL on vmixer FIRST**; not ndi2, Fly.io, Render or an assumed VPS provider.
- **Deploy to VPS LATER**, only when URL/host endpoint **AND Git repository/remote details** are provided/confirmed and independently scoped VPS deployment access and approval obtained. Do not invent URL, remote, branch or hosting provider.
- Completion handoff must also provide actual Git repo/remote URL, commit SHA/tag, branch, relevant deployment revision, documented reproducible vmixer→VPS release process, rollback and relevant verified tests. Never expose tokens/credentials.
- Prior base Parking task T-bf279623 was marked done with local app port :4600, commit f731288 and reported 29/29 tests. These are historical evidence, not current runtime check. Confirm port/service/DB/auth and vmixer resource isolation before any live operations.
- Running/starting local app, changing Windows startup, ports, firewall/Tailscale, credentials/DB, Git remote/push, CI, VPS setup, public DNS/TLS, payments or deployment requires independent user authorization and security/rollback review. A plan choice does not execute or deploy.
- Preserve Parking user priorities Google Pay #1, GrabPay as second method discussed, extras optional only with demonstrated need and approval (PM corrections #1181/#1183); keep actual processor decision separate.
- Preserve original Parking PM project P-b150c82a, task T-cdbb8b03, previous preliminary/base tasks T-e66fe030/T-bf279623, historical Parking Q1–Q12 and all earlier 101-interview Q1–Q59 decisions, LinkedIn Q1–Q35 and Event Manager E1–E15/F1–F29. Distinct per-run, account, spending, QA, code merge and production release gates.

## Audit continuity
Q58=A: ledger dry-run first PM #1182, no shared DB writes; Parking payment scope PM #1183. Q59=B: local isolated S6 cleanup PM #1184, no shared DB modifications. Guarded Shared Brain decision files prior Q50–Q59 remain untouched. Q60 custom two-stage deployment is confirmed, not a literal selection of outdated A/B/C/D options.

## Next distinct question Q61
PM original task **T-ff91600e** Acceptance tests, rollout gates and verified PM/DSH integration: outstanding **PM UI design Q1** selection. A Operations Dashboard, B Project-Centric, C Compact Command Center, D defer design-dependent edits. Preserve historical Q2=A Q3=D Q4=C Q5=C Q6=D Q7=D in this separate PM UX interview; don't infer Q1=B from the PM-101 interview's unrelated Q1=B. No selection-dependent changes or release without approval.
