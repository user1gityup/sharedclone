# Handoff: Wyze/Frigate NVR on vmixer2o2
Updated: 2026-10-18T20:25Z
Host: vmixer2o2
Owner: Claude Opus 5.5 (claude-opus-5-5), session 96577ae1 (side session of local_4bb59cf1), claimed 2026-10-18T06:05Z; Remote Control off; quota-handoff 20:25Z
pm: vmixer pm P-a637179e / T-25bb8b1f (#45 = poller build)
Status: LIVE: e2e 12/0 (06:21Z); nvr-doorbell-poller running (ring->ntfy, motion/ring->MQTT ON 60s); doorbell stream FAILS even awake (bridge GW_DBD WebRTC EOF)esultsgolive-final.txt). Doorbell event-only.
Constraints: Claude only, no git push, ecom-final-mysql untouched except the user-approved Docker restart (it came back, Up)
Creds: DPAPI D:\nvr\secrets\wyze.clixml (re-entered 04:48Z, distinct). Never in a file.
Bridge: compose\wyze-bridge.yml -> ghcr.io/idisposable/docker-wyze-bridge:latest 4.5.0, MODEL_OVERRIDES=HL_CAM4:is_webrtc=true;HL_BC:is_webrtc=true, state D:\nvr\config\wyze-bridge-v4, host ports 5050(UI) 1985(go2rtc) 8564(RTSP). Old file: backup\wyze-bridge.yml.20261014-221318.bak
Why fork: V4 fw 4.52.17 blocks TUTK; Bulb HL_BC + Doorbell Duo GW_DBD unsupported by mrlt8 2.10.3. TUTK/host-net debugging is a dead end.
Frigate: config.yml go2rtc cam1=yard_and_car cam2=upstairs cam3=backyard_cam(640x360) doorbell=front_door; single input record+detect; model config\frigate\model_cache\yolo.onnx (yolov9-t-320)
Cameras: cam1/cam2/cam3 PASS (5fps, recording); doorbell Front door: Frigate enabled in config, runtime OFF, toggled by poller; 0 frames (07:15Z window test)
GO-LIVE.ps1: plaintext .env fallback removed; API_ID/API_KEY exported in Step-Inputs; bridge probe /api/cameras + state=streaming. Last run exit 5: step 7 probe (fixed after run), 9 install scripts MISSING, 12 e2e.
e2e.ps1 (patched: DPAPI creds check, cam slot mapping): 7 PASS / 5 FAIL at 05:24Z
FAIL frigate_auth + tailscale: Win10 schannel rejects Frigate self-signed TLS on 8971 (in-container https 200); tailscale serve proxies http://127.0.0.1:8971 (https port) -> 400; should be https+insecure://
FAIL ntfy_event: config\ntfy\secrets passwords don't match ntfy user.db (401/403)
FAIL autostart: scripts\install-autostart/watchdog/storage-task.ps1 never delivered (ops versions exist under scripts\ops\)
FAIL compose_config: standalone e2e has no creds in env (passes inside GO-LIVE) - make the check dot-source Import-WyzeCreds
Frigate admin password: not captured (GO-LIVE step 11 WARN); set auth.reset_admin_password: true once to regenerate
Docker Desktop: HostNetworkingEnabled=true (05:00Z); not needed by the WebRTC path, harmless; backup D:\nvr\backup\docker-settings-store.*.json
Backups: D:\nvr\backup\ (GO-LIVE, e2e, frigate-config, wyze-bridge.yml)
Snapshots shown to user: ~/Documents/claudecode/nvr-snapshots/*.jpg
Next: on user go (given 20:2xZ, not started): debug bridge 4.5.0 GW_DBD WebRTC EOF (websocket close 1006, front_door); compare 10-14 working frame vs now; check bridge logs at debug level, Wyze signaling/KVS response, image update; fix, then re-run window test + :5050 tile
Do not repeat: hammering Wyze login; TUTK/host networking; mrlt8 bridge
Push: none
## 05:58Z run (Claude Opus 5.5, local_99e0b5cd)
Fixed: tailscale-serve.ps1 default https (+ scripts\apply-tailscale-serve.ps1 hook, GO-LIVE :443 regex); Frigate admin pw in config\access\frigate-admin.txt (reset flag removed); ntfy nvr-admin/phone/publisher resynced; scripts\install-autostart.ps1 + install-watchdog.ps1 wrappers (\NVR-Watchdog Ready); e2e compose_config imports DPAPI creds; e2e Invoke-Http + capture-frigate-admin login use Git OpenSSL curl (Frigate nginx TLS1.3-only, Win10 schannel cannot). Backups in D:\nvr\backup\.
e2e -Live 05:57Z: PASS containers, frigate_auth, detection, ntfy_event, storage_mover, tailscale, rollback, golive, compose_config. FAIL camera_fps + recordings (doorbell 0fps, battery), autostart (no NVR-Autostart task: classifier "Unauthorized Persistence" blocked registration; install-storage-task.ps1 also blocked).
06:00Z: user allowed scheduled tasks; \NVR-Autostart + \NVR\NVR Storage Tiering Ready; e2e autostart PASS.
06:03Z: user chose doorbell event-only: Get-EventOnlyCams in GO-LIVE Step-Streams + e2e camera_fps/recordings; e2e -Live GREEN 12/0.
06:06Z: GO-LIVE Invoke-Hook null ExitCode fixed ($p.Handle); GO-LIVE exit 0 LIVE AND VERIFIED.
06:12Z: frigate-notify template header no longer names placeholders; MQTT frigate-notify pw + ntfy publisher token rotated (old token revoked, 401); notify.ps1 ntfy pw sync fixed (stdin path left hashes wrong -> inherited env) + ndjson poll decode; notify -Verify all PASS; e2e 12/0.
## 2026-10-17 13:18Z doorbell alert-only (Claude Opus 5.5, side session of local_a59d0e4b)
Cause of ~1-day battery drain: Frigate ffmpeg watchdog re-pulled rtsp doorbell every ~60s; bridge go2rtc dialed Wyze cloud WebRTC to the doorbell each time. Bridge go2rtc then kept a consumer-less reconnect loop until restarted.
Fix: config\frigate\config.yml doorbell enabled:false, record continuous 0/motion 0, alerts+detections 30d (apply only while toggled on via Frigate UI / MQTT frigate/doorbell/enabled/set). tests\e2e.ps1 Get-ExpectedCameras counts disabled EVENT_ONLY_CAMS. compose\wyze-bridge.yml unchanged. Backups backup\*.20261017T130427Z.bak.
Restarted nvr-frigate + nvr-wyze-bridge once (auth restored from state file, no login).
Proof: 0 front_door dials 13:12:50-13:17:54Z (was 1/min); e2e -Live GREEN 12/0 (e2e-20261017-061621.json); GO-LIVE exit 0 LIVE AND VERIFIED (tests\results\golive-doorbell-alertonly-final-20261017T131620Z.txt). pm T-25bb8b1f #43.
DECIDED 2026-10-17 (user): doorbell rings via Wyze app push for now; Wyze get_event_list -> ntfy cloud poller to be built later (not started).
Option asked 13:40Z (not built): Wyze motion event (poller) -> MQTT frigate/doorbell/enabled/set ON ~60s -> Frigate records+detects that window -> OFF. On-demand live view via bridge UI :5050 / tailnet :10000 front_door untested since change.
Do not repeat: re-enabling doorbell in Frigate permanently; after any doorbell pull stops, restart nvr-wyze-bridge if front_door EOF warnings keep repeating every 60s.
## 2026-10-18 05:45Z claim (Claude Opus 5.5, side session of local_4c45ee81)
Claimed. Verified live: 6 containers Up (frigate/bridge healthy 17h, ecom-final-mysql Up untouched); Frigate API doorbell enabled=false, continuous 0, motion 0, mqtt on; 0 front_door bridge log lines in last 6h; tasks NVR-Autostart/NVR-Watchdog/NVR Storage Tiering Ready. Poller NOT built: awaiting user go (asked 05:45Z).
## 2026-10-18 06:05Z claim (Claude Opus 5.5, side session local_96577ae1 of local_4bb59cf1; prior owners local_99e0b5cd, local_3d13b15e archived, local_4c45ee81 idle)
Claimed. Verified live: 6 containers Up (frigate/bridge healthy 17h; ecom-final-mysql Up, untouched). e2e -Live -NoPublish GREEN 12/0 in 20.7s (tests\results\e2e-20261017-225558.json): cam1/cam2/cam3 5.1fps, 90-91 segs each, doorbell 0fps event-only. Frigate doorbell enabled=false, continuous 0d, motion 0d, alerts 30d. Bridge /api/cameras front_door GW_DBD fw 1.0.24.37 listed, last_seen 2026-10-17T13:12:55Z; go2rtc front_door producer idle (url only), 0 consumers; 0 front_door log lines since 13:12Z (no battery pulls). :5050 UI HTTP 200; doorbell live pull untested (would wake battery). pm T-25bb8b1f in_progress, #44 latest. Poller/MQTT toggle NOT built: awaiting user go.
## 2026-10-18 06:30Z doorbell poller BUILT (Claude Opus 5.5, local_96577ae1), user go 06:07Z
Built: scripts\doorbell\poller.mjs (node 22, no deps) + compose\doorbell.yml (service doorbell-poller, container nvr-doorbell-poller, included in compose.yml so autostart brings it up; creds via DPAPI env like the bridge). Own Wyze session in config\doorbell-poller\session.json (1 login 06:09Z; reuses it, refresh first, login gap 15 min). Polls get_event_list every 20 s. Ring (event_value 10 or 13) -> ntfy nvr-alerts "Doorbell ring" high, click :5050. Ring or motion (value 1) -> MQTT frigate/doorbell/enabled/set ON 60 s (max 300 s) then OFF. Startup/shutdown send OFF. --probe and --test-ring flags.
Frigate: doorbell enabled:true in config (0.18 refuses MQTT ON for a config-disabled camera: "Camera must be enabled in the config"), runtime OFF persists across restarts ("Restored runtime state: doorbell.enabled=OFF", verified on restart, 0 pulls); record motion 30 d, continuous 0 (motion-only). Retained MQTT OFF also set. Backups backup\*.20261018T060933Z.bak.
Verified: MQTT ON -> Frigate starts doorbell ffmpeg; OFF -> ffmpeg exits, state OFF, bridge consumers 0. test-ring -> ntfy 200 delivered (3 TEST messages sent 06:18-06:21Z). e2e -Live GREEN 12/0 (e2e-20261017-232154.json).
BLOCKED/FAIL: doorbell live stream while asleep: :5050 Front door tile 0x0 after 25 s, go2rtc frame.jpeg hangs 45 s, bridge "websocket close 1006 EOF" for front_door; the bridge restart (06:16Z, token refreshed, no login) did not fix it. Last good doorbell frame 2026-10-14 (nvr-snapshots\front_door.jpg). So ON windows may get 0 frames unless the doorbell is still awake right after the Wyze event. Background watch tests\results\doorbell-window-watch-*.txt records the first natural event window (up to 2 h).
Unverified: value 10 = ring is inferred (one value-10 event 2026-10-18 01:20Z, rest value 1); needs one real press. Snapshots not attached: Doorbell Duo URLs return 401 (signed-auth host).
## 2026-10-18 07:18Z window test RESULT (Claude Opus 5.5): FAIL
Real motion 07:14:54Z -> poller saw it 07:15:10Z (16 s) -> MQTT ON -> Frigate ffmpeg restarted every ~12 s, fps 0 all 60 s -> OFF 07:16:10Z; bridge front_door websocket EOF; 0 doorbell segments. Bridge idle after (consumers 0). Even awake, bridge 4.5.0 cannot stream the Doorbell Duo now. Poller ring->ntfy path is unaffected. Next options (user to pick): debug bridge GW_DBD WebRTC signaling (likely Wyze-side change since 10-14), or set MOTION_TOGGLE=0 to stop useless ON windows.
## 2026-10-18 20:45Z claim (Claude Opus 5.5, side session of local_c1060a60; prior owner local_96577ae1)
Claimed. Verified live: 7 containers Up (ecom-final-mysql untouched); poller windows firing; bridge front_door EOF every ~60 s during/after windows. Debugging now.
## 2026-10-18 20:55Z debug findings (Claude Opus 5.5, side session of local_c1060a60) - IN PROGRESS, not fixed
- Doorbell works: a fresh 2nd go2rtc (same binary, in bridge container, /tmp/g2dbg.yaml, ports 11984/18554/18889) pulled 1920x1080 frames at 20:27:13Z and 20:29:28Z (cold wake ~6 s; also via Frigate go2rtc chain). Frame: ~/Documents/claudecode/nvr-snapshots/front_door-20261018T2027Z.jpg
- Since 20:30Z every dial fails (main and fresh instances, after 6 min quiet too): Wyze mars wss opens, offer sent, NOTHING received, server drops at exactly 60 s (1006 EOF). Raw node replay (scratch replay.mjs) confirms: no frame from mars. Offers identical to working ones. ClientId unchanged (546395ba). Battery 98%, conn_state 1.
- Feedback loop found: each successful pull makes Wyze log a "motion" event -> poller opens a 60 s Frigate window -> more pulls. Needs a poller cooldown (ignore events within ~120 s after a window) - not built yet.
- Frigate go2rtc retries DESCRIBE every 5 s during a window; bridge keeps a pending producer up to 60 s per dial.
- Main go2rtc log level PATCHed to trace via API (reverts at next bridge restart; /tmp/go2rtc.yaml.bak in container).
- Hypotheses left: Wyze-side throttle on live sessions after the dial storm (upstream issue #147 "one frame after startup, never again"); needs a long quiet (>=30 min) retest.
## 2026-10-18 21:35Z cause found + fix in test (Claude Opus 5.5, d508df71)
- CAUSE: an unanswered/half-open Wyze dial makes the Doorbell Duo refuse new offers for a long time (6 min quiet: still dead; 30 min quiet: answer in 0.9 s + frame 21:24Z, nvr-snapshots\front_door-20261018T2124Z.jpg). Frigate ON windows leave dead RTSP clients on the bridge go2rtc, which re-dials Wyze every 60 s (the "EOF" loop) -> doorbell stays blocked + battery drain. Plus each real wake logs a Wyze motion event -> poller re-opens a window (feedback).
- FIX (scripts\doorbell\poller.mjs, backup backup\poller.mjs.20261018T205442Z.bak): prewarm = poller holds GET wyze-bridge:1984/api/stream.mp4?src=front_door; Frigate ON only after media arrives (PREWARM_SEC 25); on failure no Frigate ON + no dial for PREWARM_FAIL_BACKOFF_MIN 30; motion inside/<=COOLDOWN_SEC 120 after own window skipped; --test-window flag.
- State: poller paused 21:33-22:04Z for quiet, bridge restarted 21:33Z (clears loop); background test at 22:04Z (task b7wfuolq1 in session d508df71).
## 2026-10-18 22:20Z QUOTA-HANDOFF state (Claude Opus 5.5, session d508df71, side session of local_c1060a60) - NOT DONE
Owner: Claude Opus 5.5 d508df71 handing off (hook FINISH at 244k ctx). Remote Control: off. Push: none. Git: D:\nvr not a repo.
Verified: 22:04Z real-path test (poller prewarm via bridge MAIN go2rtc :1984, after 31 min quiet) -> offer unanswered, 60 s drop; poller correctly kept Frigate OFF + 30 min backoff (no re-dial loop). Score today: separate go2rtc instance 3 answers (20:27, 20:29, 21:24Z), bridge main go2rtc 0. Bridge signaling shim :5080 /internal/* is loopback-only (404 from other containers).
Written, NOT APPLIED (containers still old): 
- config\doorbell-go2rtc\go2rtc.yaml (front_door only; api :11984, rtsp :18554, webrtc :18889)
- scripts\doorbell\bridge-entrypoint.sh (starts that go2rtc in a respawn loop, then exec wyze-bridge)
- compose\wyze-bridge.yml: entrypoint /bin/sh /nvr-doorbell/bridge-entrypoint.sh + mounts ../scripts/doorbell:/nvr-doorbell:ro, ../config/doorbell-go2rtc:/doorbell-go2rtc:ro
- compose\doorbell.yml: BRIDGE_GO2RTC_URL http://wyze-bridge:11984
- config\frigate\config.yml go2rtc doorbell -> rtsp://wyze-bridge:18554/front_door
- scripts\doorbell\poller.mjs: prewarm hold (Frigate ON only after media), PREWARM_FAIL_BACKOFF_MIN 30, COOLDOWN_SEC 120 self-caused motion skip, --test-window. Running poller loaded the file at 22:04Z (has all of it; uses :1984 until recreated). In backoff until 22:34:37Z.
Backups: backup\{wyze-bridge.yml,doorbell.yml,frigate-config.yml}.20261018T2215Z.bak, backup\poller.mjs.20261018T205442Z.bak
Running state: 7 containers Up, ecom-final-mysql untouched; bridge restarted 21:33Z (main go2rtc log back to warn); Frigate doorbell runtime OFF; poller running.
Next (exact): PowerShell: & D:\nvr\scripts\secrets\Import-WyzeCreds.ps1; docker compose -p nvr -f D:\nvr\compose\compose.yml up -d wyze-bridge doorbell-poller (no Wyze login: state file); docker restart nvr-frigate; check docker exec nvr-wyze-bridge ps shows 2 go2rtc + curl 127.0.0.1:... via wget wyze-bridge:11984/api/streams; then keep doorbell quiet >=30 min (no dials) and run: docker exec nvr-doorbell-poller sh -c 'STATE_DIR=/tmp/tw node /app/poller.mjs --test-window' -> expect "prewarm: ... live", Frigate doorbell recordings (Frigate API /api/doorbell/recordings/summary or segments), OFF, :11984 consumers 0; then tests\e2e.ps1 -Live 12/0; then pm T-25bb8b1f comment (actor) + agent log.
If the dedicated instance also fails after quiet: fallback = set MOTION_TOGGLE=0 (rings-only) and report to user.
Do not repeat: pulling the doorbell repeatedly (each failed dial blocks it ~30 min); killing go2rtc mid-dial; frame.jpeg tests via bridge :1985 main.
Snapshots: ~/Documents/claudecode/nvr-snapshots/front_door-20261018T2027Z.jpg, front_door-20261018T2124Z.jpg
## 2026-10-19 09:32Z APPLIED + TESTED (Claude Opus 5.5, d508df71; user "Resume now" via hub local_af8ef06d)
Applied 09:28Z: compose up -d wyze-bridge doorbell-poller (no Wyze login; 2 go2rtc in bridge: pid main + /doorbell-go2rtc), Frigate restarted (doorbell runtime OFF restored).
Test: --test-window 09:29:52Z after ~11 h zero dials -> dedicated go2rtc offer unanswered, 60 s drop (mp4 EOF 09:30:52). Poller kept Frigate OFF, backoff 30 min, consumers 0, bridge idle. So neither quiet time nor main-vs-dedicated instance decides it; doorbell answered only 3x (10-18 20:27/20:29/21:24Z). Likely Wyze/doorbell-side (upstream #147).
e2e -Live GREEN 12/0 09:30Z (tests\results\e2e-20261019-023051.json). pm T-25bb8b1f comment posted. Ring->ntfy poller already live (since 10-18 06:30Z).
Status: doorbell live/motion recording NOT working; system safe (no dial loops; battery protected). Kept the dedicated go2rtc + poller prewarm (harmless, prevents the loop).
Next: user decision - leave rings-only (MOTION_TOGGLE=0 stops pointless dials), or watch upstream #147 / bridge update; no further pulls without a new idea.
## 2026-10-19 Status: DEFERRED by user 2026-10-19 (hub ledger Q7 "doorbell rings-only=later"). Motion windows left as is; no further doorbell dials/debug until user resumes. (Claude Opus 5.5, d508df71)
