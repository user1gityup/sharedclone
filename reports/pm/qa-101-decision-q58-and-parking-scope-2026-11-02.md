# PM 101-question interview — Q58 & parking scope correction, 2026-11-02
Conflict-safe audited append-only Shared Brain update. The canonical `reports/pm/qa-101-progress-2026-11-01.md` has concurrent edits; do NOT replace until its latest complete contents can be read and merged by original PM task ID. All earlier PM Q1–Q57 decisions, earlier audited deltas, historical separate LinkedIn Q1–Q35 and Event Manager E1–E15/F1–F29, original task IDs/histories and independent privilege/migration, per-run, identity, code merge and deployment gates retained.

## Q58 of 101 = A — original task T-3e91fd6c
User explicitly confirmed A, PM comment **#1182**. Existing `scripts/ledger-backfill.ts` (c629e2c), earlier mocked/fixture-level balanced-book/idempotency/dry-run passes and base test 334/0 do NOT establish a real S6 DB result. Plan safe review of a bounded S6 ledger-backfill dry run after verifying exact target and read-only audit, restorable backup/snapshot, rollback, idempotence and reconciliation. User MUST separately approve credentials, shared database access, any dry-run execution that touches operational systems, and especially APPLY/WRITE of any pre-ledger order journal entries. An A choice is not permission to execute data writes or apply script automatically. Keep financial reconciliation, role/security, real vs simulated evidence, deployment and rollback gates. PM task remains unverified for actual backfill.

## Parking payment scope clarification — original task T-be2407f6
User explicitly corrected that **Google Pay is first**, and said **other payment methods MAY be integrated only where justified; no reason has yet been shown to require more than the two already discussed**. PM correction **#1183** supersedes overly broad obligation implied by earlier Parking Q57 notes #1180/#1181. **Google Pay remains priority #1 (PM #1181)**. GrabPay acceptance was the other named payment option in the discussion, retained as current two-method planning scope; precise separately ranked #2 from older messages could not be independently recovered, so do not invent an explicit ranked #2 beyond this. More methods (GCash, Maya, generic cards, cash/QR etc.) are optional extension capability under the earlier hybrid architecture, NOT automatic additional pilot integrations. Adding one requires a clear documented reason, support/eligibility in the Philippines, actual merchant and PSP capability, cost/UX/security case, and independent user consent. Processor selection vs customer-facing methods is different; don't force PayMongo or direct GrabPay without verification. Keep Grab Maps site listing separate from checkout. No account onboarding, merchant credentials, charges, live sender, site listing, deployment or code merge authorized by this note.

## Prior audited records and decision count
Prior guarded deltas exist at:
- `reports/pm/qa-101-decisions-q50-q52-2026-11-02.md` (Q50–52)
- `reports/pm/qa-101-decision-q53-2026-11-02.md`
- `reports/pm/qa-101-decision-q54-2026-11-02.md`
- `reports/pm/qa-101-decision-q55-2026-11-02.md`
- `reports/pm/qa-101-decision-q56-2026-11-02.md`
- `reports/pm/qa-101-decision-q57-reconciled-2026-11-02.md`
- `reports/pm/qa-101-q57-google-pay-priority-correction-2026-11-02.md`
This Q58 delta supersedes earlier Q57 descriptions insofar as they suggest unapproved extra payment-method build scope.

Confirmed PM Q1–Q56 as documented in preceding ledgers; Q57 historical Parking requirements applied without inventing an A/B/C/D PSP choice, Q58=A. 58 interview stages processed, 43 nominal stages remain. Repeated identical Q42/Q47 counted only once.

## Next distinct unasked blocker — proposed Q59
**T-1dc5640d Clean S6 test data from shared DB**. Actual cleanup not built; target shared DB writes would be destructive without approval. A separately approve snapshot + scoped shared DB access after review, but no immediate deletes; B use isolated local non-production MySQL test DB to prove cleanup/reconciliation without touching shared data; C defer; D drop. Preserve previous Q43 isolated S6 E2E test plan and Q58 financial ledger backfill separation. No production/shared DB modifications by Q&A alone.
