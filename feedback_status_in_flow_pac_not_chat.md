---
name: feedback_status_in_flow_pac_not_chat
description: "Run/worker status goes into the Flow Pac page (meta/run), not chat; chat is one line"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 29c13029-7e4b-42b4-8a2b-01f7512e9d1a
  modified: 2026-11-01T18:14:04.703Z
---

Put build/run progress, per-worker results and ETAs into the Flow Pac page's data doc `meta/run` (https://claude.ai/artifact/HRcDgHV2YYrgfnZYnUXfdB). Do not write per-worker report bullets or tables in chat.

**Why:** user 2026-11-01: "i am asking for it to be built in a visual tool ...why ...to conserve tokens you keep doing the opposite". Long chat status costs tokens and duplicates the page.

**How to apply:** on each worker hand-back, run flow-pac/feed.mjs, set meta/run, and reply in one line: what changed plus set ETA (UTC/PT, duration, measured or estimated) and anything that needs the user. Also mark tasks in_progress in pm when workers start, or the page shows nothing running. Related: [[feedback_running_means_working]]

**Never hand-edit meta/run fields** (phase, mood, etas, message). Publish feed.mjs output unchanged: the page needs mood work|idle, and its header % must equal the arcade % (the settled one-number fix). Before publishing, render index.html locally with the new state and check #phase % == #axOverall. Subagent work shows as running via in_progress + lifecycle RUNNING + agent "Claude ..." touched in the last 2 h (feed.mjs, 11-01).
