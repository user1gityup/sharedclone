---
name: feedback_runs_on_vmixer
description: all DSH/council/swarm runs execute on vmixer2o2, never ndi2 - vmixer has the most RAM (user, 2026-10-16)
metadata:
  type: feedback
---
Every run (DSH council, swarm, pipeline) executes on vmixer2o2. Nothing runs on ndi2.

**Why:** user, 2026-10-16: "i want everything running on vmixer we don't need to run anything on ndi vmixer has the most ram".

**How to apply:** pm start launches DSH on the host whose pm server receives the call (pm/drivers/dsh.mjs, DSH_BASE default 127.0.0.1:3080), so a task held only in ndi2 pm runs on ndi2. Route run starts to vmixer's pm/DSH. Council-only runs are fine; the swarm roster is picked after the user selects a winning design. ndi2 stays code master for pm code ([[feedback_ndi2_is_code_master]]).
