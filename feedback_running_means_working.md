---
name: feedback-running-means-working
description: "Running" on any status page or report means a live process is doing the work right now, never "touched recently"
metadata:
  type: feedback
---
"Running" means work is actually happening now: a live DSH/pm run, a live process, or an agent turn in progress. A recent pm edit, a task left in RUNNING lifecycle, or a run file that says running with a dead pid is not running. Applies from 2026-10-31 on, to every page, report and status update.

**Why:** Flow Pac showed 8 flows "running" while all 29 runs that day had died (user, 2026-10-31: "running means working").
**How to apply:** check pid liveness or a run's own state before writing "running"; otherwise say idle, blocked or failed, and why. Flow Pac's feed.mjs does this (statusOf). Pairs with [[feedback-one-click-bundling]] and the ETA rule: a running item always carries an ETA marked measured or estimated.
