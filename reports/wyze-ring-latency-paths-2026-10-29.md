---
name: wyze-ring-latency-paths-2026-10-29
description: Owner-authorized options to cut Wyze doorbell ring latency on vmixer2o2 (own account/devices) - poll tightening, NotificationListener forward, direct FCM receiver
metadata:
  type: project
---
# Wyze doorbell ring latency — owner-authorized paths

Owner: Claude Opus 4.8, vmixer2o2, 2026-10-29. Account, doorbell, and poller are all the
user's own. This is API-usage optimization, not interception or account bypass.

## Current flow (verified against code + live containers)

`D:\nvr\scripts\doorbell\poller.mjs` polls the Wyze cloud `get_event_list` every
`POLL_SEC` (live = **20 s**, `compose\doorbell.yml`). On a detected ring/motion it fires
ntfy, opens a Frigate record window, and exposes the TV tile API.

Measured press -> poll ~12 s. Breakdown:
- Wyze server posts the event to `get_event_list` ~2-5 s after press (its own delay).
- Poller then catches it on the next poll tick: 0-20 s, avg ~10 s.
- TV overlay +1-3 s, fullscreen ~28 s.

So the dominant, fixable term is the **20 s poll interval**, not the network.

Containers live (all healthy): nvr-doorbell-poller, nvr-wyze-bridge, nvr-frigate,
nvr-tv-hls, nvr-ntfy, nvr-mosquitto.

## Path A — tighten the poll (fastest to ship, zero new parts)

Drop `POLL_SEC` 20 -> 5 (or 3). Worst-case detection 20 s -> 5 s, avg ~2.5 s.

- `get_event_list` is a **cloud metadata read**; it does NOT dial/wake the battery doorbell
  (only the go2rtc pull does — see poller comments). So no battery cost.
- Cost: 4x more cloud reads (~17k/day at 5 s). Reuses the existing access_token; no extra
  logins. Risk of Wyze rate-flagging at 5 s is low but nonzero; 5 s is a safe floor.
- Change is one env value + poller restart. Backup .env, undo line in changes.log.
- Net: ring detected in ~2-7 s total instead of ~12 s. No new failure modes.

## Path B — NotificationListener forward (true push, no API change)

A device already signed into the Wyze app (spare Android / old phone, always on LAN) runs an
Android NotificationListenerService (MacroDroid/Tasker rule, or a small APK) that reads the
Wyze doorbell notification Wyze already pushes to it, and POSTs to a new poller webhook
(reuse the `tvServer()` http listener — add `/push-ring`). Overlay fires ~1-3 s after press.

- No Wyze API/auth change, no RE, no secrets. Wyze push -> on-device read -> local webhook.
- Needs one always-on Android device with the Wyze app + the listener. That is the only cost.
- Poller change is additive (new route); existing poll stays as the fallback.

## Path C — direct FCM receiver (push with no spare device)

Receive the same FCM push the Wyze app gets, from a Node process on vmixer2o2, using Wyze's
FCM sender id and a push credential registered to the user's own account (the technique the
`python-firebase-messaging` based projects use). Removes the spare-device requirement of B.

- Most work, most fragile (breaks when Wyze rotates sender/app version). Needs owner-authorized
  discovery of the FCM sender id from the user's own app, then a registration tied to the
  user's own account. No account bypass, no other users' data, no packet interception.
- Hold this unless A+B are not enough.

## Recommendation

A now (1-line, instant win, no risk), then B for sub-5 s if the user wants a spare device
online. C only if both fall short.

## Boundaries (unchanged)

Own account/devices only. No account bypass, no third-party data, no secrets collection, no
packet interception. No change to the running poller or TVs without backup + undo line in
`tv-audit-2026-10-24\changes.log` and user OK. Ask before restarting Frigate. No git push.
