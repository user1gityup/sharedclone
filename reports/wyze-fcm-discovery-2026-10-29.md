---
name: wyze-fcm-discovery-2026-10-29
description: Owner-authorized FCM push identifiers from the user's Wyze APK (base.apk 3.6.7.694) - Path C step 1 for the instant-ring receiver
metadata:
  type: project
---
# Wyze FCM push discovery (owner-authorized)

Source: user-supplied official Wyze APK, com.hualai 3.6.7.694 (APKMirror bundle, base.apk),
statically decoded with apktool 2.10.0 (no install, no run). res/values/strings.xml.
Decoded by Claude Opus 4.8, vmixer2o2, 2026-10-29. User's own account/app.

## Push-routing identifiers (what the FCM receiver needs)

- FCM sender id (gcm_defaultSenderId): **738316279406**
- google_app_id: **1:738316279406:android:3c34a4366b9bad6d**
- project_id: **fir-test-d9f49**
- firebase_database_url: https://fir-test-d9f49.firebaseio.com
- default_web_client_id: 738316279406-...apps.googleusercontent.com
- google_api_key: PRESENT in strings.xml (app-embedded Firebase key) - NOT pasted here; read from
  the local decode if the FCM register call needs it. Treat as app config, not a user secret.

Local decode kept at (scratchpad, session-local):
...\scratchpad\wyze-apk\unpack\base-decoded\res\values\strings.xml
apktool jar: ...\scratchpad\tools\apktool.jar

## Still to discover before build (hand to the swarm)

1. The Wyze cloud **push-register endpoint**: how the app registers its FCM token with Wyze so
   doorbell pushes route to it (grep base.apk smali for register/push/fcm/device token; the
   poller already holds the app auth - access_token, phone_id - same session machinery).
2. The ring push payload shape (what field marks a doorbell ring vs motion).

## Build (Path C, after approval) - LOCAL + FREE models only, swarm, NO council

- Node process on vmixer2o2 registers an FCM client with sender 738316279406 (firebase-messaging
  lib) -> push token, registers token with Wyze cloud for the user's account, receives the ring
  push, POSTs to a NEW poller route /push-ring (additive; the 5 s poll stays as fallback).
- pm prepares the run; user picks every seat; pm never dispatches.

## Boundaries (unchanged)

Own account/app only. No account bypass, no third-party data, no secrets exfiltration, no packet
interception. No change to the running poller/TVs without backup + undo line in
tv-audit-2026-10-24\changes.log and user OK. Ask before restarting Frigate. No git push.
