---
name: handoff-2026-10-25-1545-doorbell-click-live
description: Doorbell Duo click-live: TV backoff removed, wake root cause = cloud WebRTC has no Gwell wake; next try gwell-proxy via MODEL_OVERRIDES
metadata:
  type: project
---
Updated: 2026-10-26 19:08Z
Owner: SINGLE LEAD = Claude Opus 5.5 session local_a637dbaf (vmixer2o2, claimed 19:08Z; replaces 2f901f08 which did no edits). Verified 19:08Z: all nvr-* up; TK tvhome 1.5.5-vmx14 code 29 (dreaming); onn 1.5.4-vmx13 code 28, YouTube PLAYING (in use - not driven); fake-live absent. Host: vmixer2o2. Remote Control: off.
Ask (user): "eliminate the save battery time outs get dorbell cam click live working then lets move on to how we will handle motion and notifications". Relayed: step one = doorbell click in Frigate UI goes live; wire TV to the same path after.
Split: frigate-tv-app/frigate-tv-nav (local_89b1bd6b / local_c4abbb9c) own Frigate config + frigate-tv-src + tv-pair. This session owns poller.mjs, doorbell-go2rtc, nvr-wyze-bridge, nvr-doorbell-poller and tv-detox-src.
Done:
- poller.mjs: TV /live ignores the 30-min backoff (backoff now gates motion only); TV dial 25 s + one redial (TV_PREWARM_SEC 45); no 'resting' state; a failed TV dial is not re-dialed by pings.
  - bak poller.mjs.bak-20261025-0840; restarted 15:33Z.
- doorbell-go2rtc log level debug (bak .bak-20261025-0845); respawned.
- frigate-tv-app set cameras.doorbell.ui.dashboard false, so its UI stops probe-dialing the doorbell.
- changes.log has undo lines.
Proof: real doorbell fullscreen on TandKcast, tv-audit-2026-10-24\tk-door-REAL-fullscreen.png (15:35Z, OSD 08:35:58 PT, package-cam inset).
Wake record:
- OK: 15:34Z after 8.9 s; 15:42Z after ~3.5 s.
- FAIL: 15:06Z (motion); 15:37Z (cold OK) = go2rtc mp4 "websocket close 1006 unexpected EOF" at 60 s. The Wyze mars signaling gets no answer.
- ClientId reuse disproved (same ClientId worked 15:42).
Root-cause lead:
- The Duo is GW_DBD, a Gwell/IoTVideo device (TURN user turn@iotvideo).
- Bridge 4.5.0 streams it via cloud mars WebRTC, which has no wake step.
- The bundled /usr/local/bin/gwell-proxy does Gwell P2P CALLING (the normal battery wake). It only gets cameras the bridge flags is_gwell; a manual run gives "shim reports 0 Gwell cameras".
Next (exact):
1. Recreate the bridge with MODEL_OVERRIDES=HL_CAM4:is_webrtc=true;HL_BC:is_webrtc=true;GW_DBD:is_gwell=true.
   - Edit compose\wyze-bridge.yml after a bak.
   - Command: & D:\nvr\scripts\secrets\Import-WyzeCreds.ps1; docker compose -p nvr -f D:\nvr\compose\wyze-bridge.yml up -d wyze-bridge (the root compose fails).
2. Watch for "spawning gwell-proxy" and the RTSP stream it pushes (bridge go2rtc :8554/front_door?).
3. If live: point Frigate doorbell at it (tell frigate-tv-nav, their file) and test a Frigate UI click.
4. Then wire the poller/TV to it; prove with a TandKcast screencap.
5. Then motion/notification Q&A cards.
Do not repeat: the ClientId theory; the fake-live file (must stay absent); bridge root compose.

## 2026-10-25 15:55Z Claude Opus 5.5 (session local_89b1bd6b) - NEW LEAD (user Q&A "C. Replace doorbell lead"); old lead local_a637dbaf + worker local_5459692a stopped, handovers in side-session-notes\local_89b1bd6b-...\doorbell-{lead-handover,worker-state}.md
- User picked A (native Gwell wake). RESULT: NOT POSSIBLE with bridge 4.5.0. MODEL_OVERRIDES GW_DBD:is_gwell=true applied, but the bridge logged "GWELL_ENABLED=true but no OG-style Gwell cameras discovered; skipping gwell-proxy" - spawn uses CameraInfo.IsGwellP2P (OG GW_GC1/GW_GC2), not is_gwell. Override reverted.
- wyze-bridge.yml cleaned (ctrl-char comment + duplicate entrypoint/volume lines removed; compose config now validates). Backup wyze-bridge.yml.bak-20261025-085001. Bridge recreated 15:50Z + 15:55Z; cam1/2/3 5.1 fps; doorbell woke on restart, back to 0 fps 15:53Z.
- Poller: motion window at 15:48Z skipped by backoff until 16:07:56Z (motion only; TV /live ignores it).
- NEXT (needs user pick): B = fresh-producer redial (second go2rtc stream alias, same source, used for the 25 s redial) + Frigate doorbell source #timeout=40; or stop.
## 16:03Z Claude Opus 5.5 (local_89b1bd6b) - B DONE (NVR side proven, TV not yet)
- poller.mjs resetStream(): on the TV redial, DELETE+PUT front_door on doorbell go2rtc :11984 (runtime; 400 = yaml ro, change still applies) -> real fresh dial; Frigate keeps pulling front_door. Alias stream approach FAILED (doorbell refuses a 2nd concurrent session) and was removed.
- Frigate doorbell source rtsp://wyze-bridge:18554/front_door#timeout=40. Backups *.bak-20261025-085512 (poller, frigate config, go2rtc.yaml).
- Cold test 16:00:26Z: first dial hung 25 s, reset redial live 5.4 s, Frigate fps 6.14 at +45 s. User also went live from TV 15:52:38Z (12.3 s, first dial).
- NEW USER ASKS -> owned by session local_0e55275e (doorbell-alerts-bulb, started 16:05Z). Mockups shown to user 16:10Z: ring alert A corner live window (rec), B full-screen takeover, C banner snapshot; screensaver wakes then same alert; push-to-talk mic; Bulb light button in tvhome fullscreen + under Backyard in Frigate TV app. User picks 16:20Z: Q1 A corner live window, Q2 A research talk then push-to-talk, Q3 A light button both places (forwarded): (1) real ring test + what TV shows while watching a show / in screensaver (today: nothing on TV, phone ntfy only; needs overlay/PiP design); (2) doorbell two-way "calling" from the remote; (3) Bulb Cam (backyard_cam, HL_BC) light on/off from its fullscreen view in tvhome AND inside Frigate (TV app overlay or Frigate UI).
- TV proof of a cold click still open (do not drive a TV in use).
## 16:09Z Claude Opus 5.5 (session local_c4abbb9c... side session, task from local_89b1bd6b) - CLAIMED for the 3 new user asks (ring alert over other apps, two-way talk research, Bulb Cam light)
- Verified live 16:08Z: all nvr-* containers up/healthy; poller log matches 16:00:26Z cold test (reset redial live 5.4 s); both TVs tvhome 1.5.3-vmx12 code 27 + frigatetv 1.1; onn idle (HDMI source lost screen), TandKcast dreaming; no media playing.
- Next tvhome build must be vmx13+ (code 28+).
- 16:34Z user clarified "2nd cam to left" = doorbell package-cam inset (burned into stream bottom-right) -> relayed to local_0e55275e; home-grid reorder (vmx13) built then reverted, never installed; Frigate cam order unchanged.
## 16:50Z Claude Opus 5.5 (side session of local_c4abbb9c) - progress
- User: "already answered all these questions" -> no more Q&A cards; take the recommended option. Q1 = A corner overlay.
- Ask 1 BUILT: tvhome 1.5.4-vmx13 code 28 on both TVs (src DoorbellWatch.java: FGS polls /doorbell/status.json every 4 s, new ring -> TYPE_APPLICATION_OVERLAY top-right, /live pings, HLS muted, hides at 60 s; skipped when Home in front or TV off). appops SYSTEM_ALERT_WINDOW allow on both. Test hook: am start-foreground-service -n com.ansub.tvhome/.DoorbellWatch --es test cam3. Proof over screensaver: tv-audit-2026-10-24\tk-overlay-test-dream.png. Backups *.bak-vmx12. Real-ring watcher armed (scratchpad ring-watch.sh -> tv-audit-2026-10-24\ring-proof\). onn was Asleep: not proven there.
- Latency: past rings logged 7.7-20 s after event_ts (POLL_SEC 20). Proposal: POLL_SEC 4-5 + TV poll 4 s -> ~6-10 s.
- Ask 3: bridge 4.5.0 has NO control API (routes: cameras/{name}/record|snapshot|restart, discover, streams, webrtc). Wyze cloud set_property P1056 on HL_BC returns SUCCESS but no change. device_params has spotlight_status=0 -> next try iot3 run-action/spotlight.
- Ask 2: not started.
## CURRENT STATE 16:55Z Claude Opus 5.5 (ring-alert side session 73bf2ba0, side of local_c4abbb9c) - quota FINISH checkpoint, stopped
- User answers (relayed by local_89b1bd6b): Q1 A corner live window bottom-right + PAUSE the show (resume on close = my default, unconfirmed); OK fullscreen, Back close, 60 s auto. Q2 A research talk-back then push-to-talk (hold remote voice button). Q3 A light button in BOTH tvhome Backyard fullscreen and Frigate TV app under Backyard. Inset: move Duo package-cam inset to bottom-left via a Wyze property. User said "already answered all these questions": no more Q&A cards, take the recommended option.
- tvhome source = 1.5.5-vmx14 code 29: DoorbellWatch.java (FGS, 4 s status poll, ring -> focusable TYPE_APPLICATION_OVERLAY bottom-right, pause via AudioManager media key if isMusicActive, Back=dismiss+resume+/stop, OK=MainActivity --ez doorbell true, FLAG_TURN_SCREEN_ON + Wake activity when dreaming or nothing playing), MainActivity: DoorbellWatch.start, homeInFront, openDoorbellIfAsked, Backyard (cam3) fullscreen light pill (OK toggles via /doorbell/light). MainActivity was accidentally truncated 16:50Z and rebuilt from MainActivity.java.bak-vmx12 + edits; builds clean.
- Installed: TandKcast = latest vmx14 (light pill build, UNTESTED on screen; tvhome left open on TK 16:54Z). onn = vmx13 (old overlay top-right); onn woke 16:36Z, maybe in use -> install tv-audit-2026-10-24	vhome-vmx14.apk when idle + appops already allow.
- Proven: overlay over TK screensaver + over Google TV home, bottom-right with hints (tk-overlay-v2-wake.png, tk-overlay-v3.png). Back closes. NOT proven: dream wake (Wake activity didn't end dream 16:42Z; FLAG_TURN_SCREEN_ON added, untested - cannot start a dream from adb), pause/resume, OK->doorbell fullscreen, real ring.
- NVR: poller.mjs + tv-hls server.py: GET /doorbell/light[?on=1|0] -> Wyze /v2/auto/run_action HL_BC floodlight_on/off (wyzeapy's call). Returns SUCCESS; effect NOT visible in daylight and cloud readback never changes -> verify at dusk (sunset ~01:10Z) by eye or night frame. Backups *.bak-20261025-094916. Light left OFF.
- Inset: GW_DBD classic API has only P1,P3,P5,P8,P20,P22,P30,P1018,P1020 - no PiP position; Duo settings live in Gwell cloud/P2P. Likely only step: user moves it once in the Wyze app (Duo settings), which also moves it in our stream.
- Talk RESULT 17:03Z (motion live): doorbell go2rtc producer webrtc/wyze medias = video recv, audio recvonly PCMU/8000 AND "audio, sendonly, PCMU/8000" -> a talk-back channel exists (ring-proofront_door-medias.json). Not yet tested whether the Duo plays pushed audio (test: go2rtc /api/streams?dst=front_door&src=<8k PCMU clip> during a live window). Earlier notes: Duo supports two-way talk; doorbell go2rtc 1.9.14 webrtc #format=wyze; unknown if it exposes an audio backchannel. talk-probe.sh (bg bmq0762oi) dumps /api/streams?src=front_door medias to tv-audit-2026-10-24
ing-proofront_door-medias.json on the next live. Remotes: onn "Onn-Remote", Chromecast Remote; both TVs list AUDIO_DEVICE_IN_BUILTIN_MIC (remote voice via HAL) but voice key is owned by Assistant (katniss) - app access to mic/key unproven.
- REAL RING 19:56:28Z (user pressed): poller saw it 19:56:46Z (+18 s, POLL_SEC 20). TandKcast showed the bottom-right ring window by 19:57:04Z (ring-proof	k-ring-195733.png), auto-closed by 19:58:00Z. BUT video never came ("Waking the doorbell..."): poller logged "window skipped (ring): doorbell backoff until 20:23:08Z" (a failed motion prewarm at 19:53 set the 30-min backoff and it also blocks rings) CORRECTION: the overlay's /live did reach the poller at 19:56:50Z and dialed (TV path ignores backoff); first dial got no media in 25 s, the fresh redial also failed at 45 s -> the doorbell did not answer the cloud WebRTC dial right after a ring (likely busy with the ring/phone push session). Next: retry dials longer after a ring, and let rings bypass the backoff anyway. Window showed although tvhome was in front on TK (homeInFront guard not effective). onn was Asleep (skipped, by design). ntfy snapshot not attached (HTTP 401) - new bug. Watchers finished; re-arm for the next test.
- Ring watcher bg bko8pklhk (scratchpad ring-watch.sh) screencaps both TVs into ring-proof\ on the next real RING. Both bg jobs die with this session: re-arm.
- Latency: past rings 7.7-20 s after event_ts with POLL_SEC 20 (doorbell.yml). Pending user yes/no on POLL_SEC 5.
- Frigate TV app light button: not started (frigate-tv-src, owned by local_89b1bd6b family; native wrapper should call http://<nvr>:1984/doorbell/light from Java, not the https WebView).
- Next (exact): 0) poller: why the dial fails right after a ring (retry longer), ring bypasses backoff, ntfy snapshot 401; 1) on TK, verify Backyard light pill (open tvhome, focus Backyard tile, OK, screencap, OK again); 2) install vmx14 on onn when idle; 3) re-arm ring-watch.sh + talk-probe.sh; ask user to press the doorbell; 4) Frigate TV app light button (vmx build of com.vmx.frigatetv); 5) dusk light proof; 6) talk feasibility report from medias json.
