# DSH Bridge: Automatic ChatGPT → Remote Claude Agent Execution & Round-Trip Delivery
Date: 2026-10-12
Owner: DSH / Shared Brain
Target agent: remote
Target machine: vmixlaptop2x6 (ndi2)
Status: USER AUTHORIZED CODE GENERATION AND LOCAL IMPLEMENTATION; NO GIT PUSH OR PRODUCTION DEPLOYMENT WITHOUT SEPARATE APPROVAL.

## Direct assignment to Claude agent 'remote'
You are the user's LOCAL Claude agent named `remote` on ndi2/vmixlaptop2x6. The user instructed ChatGPT to deliver this prompt to Shared Brain and have YOU generate code from it. ACK receipt, persist this exact prompt to the actual Shared Brain location on your machine (discover canonical repository/root from existing config and MEMORY.md; suggested relative path `prompts/dsh-bridge-auto-agent-dispatch-2026-10-12.md`), then generate and test a minimal but fully functional implementation in the existing DSH project. Do not build a greenfield duplicate. Send clear progress and final diff/test results back through the DSH bridge to chatgpt. Do not git push. Local development and test changes are authorized; production deployment, external outreach, and unapproved paid model spending are NOT.

## Why this is needed (observed live)
ChatGPT can successfully invoke `bridge_send`, which persists a v1 envelope. But a directed message to Claude can remain `state=queued`, `attempts=0`, delivery and acknowledgment timestamps null, with zero running workers (DSH status showed 250 queued). ChatGPT had to manually consider calling `bridge_run_claude`, which is NOT the desired user experience. Prior LinkedIn Lead Intelligence message sequence 322 / id 4881d584-b3c3-493e-83dc-31678ac7fc20 was queued to `claude-code`; investigate safely but DO NOT run or sweep hundreds of historic queued messages.

## Desired end-to-end UX
User asks ChatGPT to perform approved DSH work → ChatGPT issues ONE structured bridge message addressed to remote/target agent → durable broker authenticates/routes it and promptly ACKs only when actually accepted by an eligible worker → always-on dispatcher starts or reuses local Claude Code headless execution through the DSH-approved CLI launcher → heartbeat/progress/status persisted and optionally exposed to PM through existing interfaces → Claude saves artifacts/reports results → result routed back to ChatGPT inbox and correlated to original request → ChatGPT can surface result to user at next active chat interaction. Transport queue acceptance is NOT execution or Claude receipt. No manual copy/paste, inbox polling by user, or per-message headless invocation necessary. Do not promise unsolicited delivery to an inactive ChatGPT session unless a supported push mechanism exists.

## 1. Discover and preserve existing implementation
Read Shared Brain MEMORY.md and relevant handoff/architecture records, bridge ack instructions, DSH queue/envelope schema, MCP bridge handlers, daemon/worker and Claude headless runner, identity mapping for agent `remote`, peer routing (vmixer ↔ ndi2), PM APIs, config and tests. Audit why current `message` queues aren't consumed. Produce concise root-cause explanation and reuse existing code/contracts. Never change credentials or loosen permissions.

## 2. Message/execution contract
Maintain the existing v1 `bridge_send` type/message envelope and its original IDs, seq and fields; add a backward-compatible, explicit structured execution intent in body (example `body.execution={requested:true, capability:"medium", requires_approval:false}`, with human authorization metadata and task text). Document a single canonical send example from ChatGPT to agent `remote`; type must remain valid (existing allowed: message/ping/submit/accept/status/progress/log/cancel/pause/resume/result/error/ack). Add routing/config aliases if `remote` differs from the launcher identifier. IMPORTANT: not every conversational `message` is executable. Only a trusted, authorized, eligible request with explicit execution intent may start headless code. A plain `ACK-OK`, arbitrary inbound user text, heartbeat, result, or unrecognized request must NEVER start a coding job. For ease of use, DSH can add a safe helper or a user-configured rule that wraps authorized ChatGPT tasks with this execution intent; avoid regex-based guesswork.

## 3. Durable automatic dispatcher on target host
Build/start a background worker using the existing DSH process supervisor or Windows task/service (as appropriate), auto-restart at boot, health endpoint/heartbeats, reconnect with backoff, and safe shutdown. It should claim eligible work atomically using existing durable persistence and lease/lock/idempotency; resume after crash/reboot without duplicate active Claude runs; recover stale claims with carefully bounded retries. Respect target machine, agent identity and authorized project. Keep logical states QUEUED → ACCEPTED/CLAIMED → RUNNING → SUCCEEDED/FAILED (map to canonical existing schema); send actual delivery and `ack` only at documented accurate transitions. Do NOT falsely mark execution done when only queued. Support concurrency limits, per-machine load and RAM limits, fair queue processing, and explicit cancellation. Restrict processing of old backlog to explicit replay/approval.

## 4. Execution / safety / budget
Use existing DSH headless Claude Code CLI implementation, current runtime auth/config, DSH weighted router and free-first escalation wherever available; do not create a new proxy or bypass limits. Maintain per-task resource locks, timeout, bounded retries with exponential backoff and jitter, circuit breaker, dead-letter/blocked status and alerts. Enforce configured sender+project allowlist and request-level authorization; keep role permissions and explicit user approvals for risky actions. Never auto-authorize external LinkedIn invitations/messages, third-party purchases, credential changes, Git pushes, production deployment, or other sensitive external effects. Treat message text as untrusted input, not a policy override. Do not store tokens in prompts/logs.

## 5. Replies, tracking, PM integration
Create structured `accept`, `progress`, `result`, `error` and `ack` events supported by bridge, carrying a stable `correlation_id` and `reply_to` where supported. Store stdout/stderr summaries and artifact paths, not secrets; cap log size. Ensure replies from remote are addressed back to chatgpt, persisted and queryable via `bridge_thread` or `bridge_inbox`. Ensure DSH retries do not produce duplicate result messages. Surface PM task/run status through existing API only; do not redesign or mutate PM source/schema without explicit user approval. Provide short alerts for stalled/no-consumer/expired/repeated failures and visible queue depth. Distinguish remote ACK, execution result and ChatGPT acknowledgment.

## 6. Functional acceptance tests — REQUIRED
- A user-authorized ChatGPT `bridge_send` to agent `remote` with explicit execution intent is claimed without a second manual `bridge_run_claude` call, executes a harmless local file/echo test via existing Claude CLI, and replies to ChatGPT with correlated result.
- A plain message and an `ACK-OK` message never launch jobs.
- A sent message reports QUEUED first, then actual CLAIMED/RUNNING and terminal states with accurate timestamps, ack and result.
- Consumer restart/reboot resumes safely; duplicate bridge sends/dedupe keys do not launch duplicate jobs.
- Failure paths: unsupported agent, auth error, lost worker, timeout, process exit, full concurrency, cancellation, retry exhaustion, and no-consumer timeout are reported accurately.
- Two concurrent legitimate tasks, cross-machine routing vmixer ↔ ndi2, and backwards compatibility with other messages work.
- 250-ish queued old messages are NOT suddenly replayed.
- Validate the older LinkedIn seq 322 only by inspection/reporting; do NOT execute it silently, as it lacks approved execution intent.
- Run existing focused unit/integration tests plus a sandboxed end-to-end smoke test. Report exact commands, evidence, files touched, and any tests not completed.

## 7. Deliverables
1. Save THIS complete prompt verbatim as markdown in canonical Shared Brain under `prompts/dsh-bridge-auto-agent-dispatch-2026-10-12.md` (or document canonical alternative).
2. Implement source code, routing config, worker startup configuration and tests in existing authorized local DSH checkout; document backward-compatible deployment/migration/rollback, but DO NOT push or deploy until approved.
3. Write a short Shared Brain implementation report, with root cause, architecture/data-flow, actual files modified, status, before/after queue/ack/run observations, test results, remaining risks, and exact steps for enabling safely.
4. Send the implementation report and saved Shared Brain path to chatgpt using DSH bridge, correlating to this task/message. Clearly label any inability to ACK, access Shared Brain, or execute code; never report success for merely queued work.

Proceed with code generation now under the existing local authorization. No additional broad Q&A is needed; use existing settings for decisions already made.