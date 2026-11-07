---
name: dsh-bridge-auto-dispatch-report-2026-10-12
description: Implementation report for ChatGPT bridge seq 323 - automatic ChatGPT -> remote Claude dispatch
metadata:
  type: project
---
# DSH bridge auto-dispatch: implementation report

Claude Opus 5.5 [f0ec11] on vmixer2o2. ndi2 restart and enable by Claude Opus 5.5 [b44e7e] on ndi2, after the user confirmed. Date 2026-10-12.
Request: ndi2 bridge seq 323, id cd6e3b4e-25b0-4edf-a5eb-ee83c8de6cc8. Prompt saved verbatim at `prompts/dsh-bridge-auto-agent-dispatch-2026-10-12.md`.

## Root cause
- The workers in `pm/bridge/workers.mjs` only picked up messages for `claude-code` of type `submit`.
- A `message` to agent `remote` had no consumer. It stayed `queued` with 0 attempts.
- `bridge_run_claude` was the only path that created a submit.

## What changed (pm/bridge, in the brain repo; no push)
- **`dispatch.mjs` (new).** Runs inside the existing worker loop under the pm watchdog. It is configured by the `dispatch` key in `pm-data/bridge-policy.json`.
  - **What it picks up:** messages that are `queued`, not a replica, `type: message`, addressed to an agent in `dispatch.agents`, carrying `body.execution.requested === true`, and with `seq > after_seq`.
  - **Sender check:** the storing token and `from.agent` (and project) must match `dispatch.allow`.
  - **Claim:** creates a submit with id `<msg>.run` and dedupe key `dispatch-<msg>`, so one message can only ever start one run. It then acks the message as `dispatch@<machine>` and sends `status` with state CLAIMED.
  - **Refusal:** sends one `error` with state REFUSED. The message stays unacked for a person to read. `requires_approval: true` is also refused.
- **`workers.mjs`.** A dispatched run answers as the agent it was addressed to (`remote`). Body states: accept=RUNNING, then result=SUCCEEDED or error=FAILED/CANCELLED. The final reply has `reply_to` = the original message, so that message shows as responded.
- **`index.mjs`.** A message with `execution.requested` needs the `execute` scope when it is stored. `execution.permission_mode: auto` also needs `auto`. `/api/bridge/health` and `bridge_status` now include `dispatch`.
- **`cli.mjs`.** New `dispatch-enable [--agents remote] [--allow chatgpt] [--after-seq N]` and `dispatch-disable`. By default, enabling pins `after_seq` to the current highest seq, which guards against replaying the backlog.
- **`test.mjs`.** 6 new dispatch tests.

## Canonical send (ChatGPT -> remote)
```
bridge_send { to_machine: "vmixlaptop2x6", to_agent: "remote", type: "message", from_agent: "chatgpt",
  dedupe_key: "<unique>", project: "<project>",
  body: { execution: { requested: true, capability: "medium", task: "<what to do>" } } }
```
- **Optional `execution` fields:** `model`, `max_turns` (≤50), `permission_mode` (default/acceptEdits/auto; auto needs the auto scope), `requires_approval`.
- **Replies:** they go to chatgpt's mailbox with `correlation_id` = the message id. Read them with `bridge_thread {id}` or `bridge_inbox {agent:"chatgpt", unacked:true}`.

## Tests
- **vmixer:** `node --test bridge/test.mjs` 35/35 and `node --test test.mjs` 28/28.
- **ndi2:** 35/35 and 28/28 (reported by [b44e7e]).
- **Live smoke over LAN, 2026-10-12 13:40Z:** ndi2 pm pid 28980, with dispatch `after_seq 323` and allow chatgpt plus peer/e2e-smoke.

| Case | Outcome |
|---|---|
| exec direct (seq 324) | CLAIMED 13:40:42.185, RUNNING 13:40:42.375, SUCCEEDED 13:40:53.394. Model haiku, exit 0, text `SMOKE-OK-134041`. Message acked by dispatch@vmixlaptop2x6 and marked responded. |
| exec from vmixer (vmixer seq 124 -> ndi2 seq 331) | Forwarded. CLAIMED, then RUNNING, then SUCCEEDED `SMOKE-XM-OK-134041`. The replies were forwarded back and are stored on vmixer (seq 125-135). |
| plain message (328), ACK-OK (329) | Not launched; stayed queued. |
| spoofed from.agent chatgpt on the peer token (330) | REFUSED once: "sender chatgpt (token peer) is not in dispatch.allow". |
| Backlog | Not replayed. `backlog_not_replayed: 1`; dispatched 2, refused 1. |

**Not tested live:** timeout, retry exhaustion, full concurrency, explicit cancel. These rely on the existing submit path and its tests. Two concurrent runs, restart dedupe and FAILED are covered by unit tests.

## Behaviour notes and risks
- **Lost runs:** a run whose lease is lost becomes `uncertain`. As with any submit, it is never re-run automatically.
- **Push delivery:** ChatGPT sees results only when it next reads its inbox. Nothing pushes to an inactive chat.
- **Refusals:** a REFUSED reply goes to the sender's mailbox.
- **Seq 322 (LinkedIn):** addressed to `claude-code` with no execution intent. It was inspected only and never executed.
- **Rollback:** run `node bridge/cli.mjs dispatch-disable`. Nothing is dispatched while it is disabled.
- **Status:** live on ndi2 since 2026-10-12 12:24Z. Installed on vmixer but disabled there.
