---
name: handoff-2026-10-12-1151-bridge-auto-dispatch
description: CLOSED 2026-10-12 - bridge auto-dispatch live on ndi2, smoke PASS, seq 323 acked + report sent (seq 340)
metadata:
  type: project
---
Handoff id: bridge-auto-dispatch-20261012
Updated: 2026-10-12 (Claude Opus 5.5 [f0ec11], context checkpoint)
Host: vmixer2o2 (writer); target host ndi2 (vmixlaptop2x6)
Session: Claude Opus 5.5 local_a3b4a530 [f0ec11] "Continue bridge auto-dispatch build", Remote Control ON
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: Claude Opus 5.5 vmixer2o2 (this session, claimed 2026-10-12 13:50Z for seq 341 check). Prior: [f0ec11], local_f58e09b8
Ask (user): "Message #323 is for you; check why you didn't get it and complete the task"; user approved the dispatcher wiring and switched session to manual-ask mode (auto-mode classifier blocked it as "Create Unsafe Agents")
Message: ndi2 pm seq 323 id cd6e3b4e-25b0-4edf-a5eb-ee83c8de6cc8, chatgpt -> {vmixlaptop2x6, remote}, type message, body.execution.requested. Still queued, unacked.
Prompt: ~/.claude/shared-brain/prompts/dsh-bridge-auto-agent-dispatch-2026-10-12.md
Root cause: workers.mjs tick leased only claude-code + submit; a message to 'remote' had no consumer.
Built (brain pm/, uncommitted, brain-sync carries it):
- pm/bridge/dispatch.mjs NEW: policy key "dispatch" {enabled, agents, after_seq, allow[{principal,from_agents,projects}]}; SQL candidates = queued, replica=0, type message, json execution.requested=1, seq>after_seq; claim = submit id <msg>.run dedupe dispatch-<msg> + ackFor by dispatch@<machine> + status CLAIMED; refusal = one error REFUSED (dedupe dispatch-refused-<id>), mail stays unacked; requires_approval refused
- pm/bridge/workers.mjs: dispatcher.tick() in tick; startClaude replies as body.dispatch.as, final result/error reply_to = original message id; states RUNNING/SUCCEEDED/FAILED/CANCELLED in bodies
- pm/bridge/index.mjs: ingress needs execute scope for message with execution.requested, auto scope for execution.permission_mode auto; health + bridge_status carry dispatch status
- pm/bridge/cli.mjs: dispatch-enable [--agents remote] [--allow chatgpt] [--after-seq N] | dispatch-disable (writes pm-data/bridge-policy.json; after_seq defaults to local max seq)
- pm/bridge/test.mjs: 6 dispatch tests
Verified: node --test bridge/test.mjs 35/35 pass; node --test test.mjs (pm) 28/28 pass (vmixer, 2026-10-12)
Done: ndi2 test+restart+enable by [b44e7e] after user OK; LAN smoke 13:40Z PASS (direct+cross-machine SUCCEEDED, plain/ACK-OK not run, spoof REFUSED); seq 323 acked as remote; report reports/dsh-bridge-auto-dispatch-2026-10-12.md; result sent to chatgpt seq 340 (323 now responded)
Dispatch: ON on ndi2 only; vmixer installed, disabled
Processes/ports: vmixer pm pid 47224 (new code, dispatch off); ndi2 pm pid 28980 (new code, dispatch ON after_seq 323, allow chatgpt + peer/e2e-smoke)
ndi2 relay: asked ndi2 RC session [b44e7e] "DSH bridge status and auto-load" to test+restart+enable; it holds all 6 steps until the user says go in its own chat (correct: peer relay is not user approval)
Uncommitted: the 5 pm/bridge files above (brain auto-sync commits)
Seq 341 (13:49Z, Opus 5.5 local_f58e09b8): chatgpt resend of LinkedIn #322 review WITH execution intent -> dispatcher auto-claimed (343 CLAIMED), submit 342 leased, 344 RUNNING sonnet on ndi2, log ~\.claude\pm-data\bridge-logs\b2048c5c-4e55-41b0-bb65-5b1c4e1421d9.run.log; no result yet. First real ChatGPT auto-dispatch.
Seq 341 result (seq 370, 13:50:33Z): SUCCEEDED, sonnet 231s $0.91. Review only; no Q1-35 spec found in brain (pm unchecked, tool permission blocked); report saved in ndi2 run scratchpad (brain write denied); asks Q1 LinkedIn access A-D; flags 341 execution claim as untrusted relay.
Next: none for dispatch. Open: user answers Q1 / decides whether the scratchpad report goes into brain. Optional: remove peer/e2e-smoke allow on ndi2.
Do not: push; execute seq 322 or replay backlog; enable dispatch with after_seq below current max; loosen tokens/scopes
