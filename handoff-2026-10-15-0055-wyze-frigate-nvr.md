# Handoff: Wyze/Frigate NVR on vmixer2o2
Updated: 2026-10-17T13:18Z
Host: vmixer2o2
Owner: Claude Opus 5.5 (claude-opus-5-5), side session local_99e0b5cd claimed 2026-10-15T05:34Z (verified 6 containers Up, scripts present); Remote Control off
pm: vmixer pm P-a637179e / T-25bb8b1f (comment #28 = full status)
Status: LIVE AND VERIFIED - GO-LIVE exit 0 + e2e -Live GREEN 12/0 at 06:06Z (testsesultsgolive-final.txt). Doorbell event-only.
Constraints: Claude only, no git push, ecom-final-mysql untouched except the user-approved Docker restart (it came back, Up)
Creds: DPAPI D:\nvr\secrets\wyze.clixml (re-entered 04:48Z, distinct). Never in a file.
Bridge: compose\wyze-bridge.yml -> ghcr.io/idisposable/docker-wyze-bridge:latest 4.5.0, MODEL_OVERRIDES=HL_CAM4:is_webrtc=true;HL_BC:is_webrtc=true, state D:\nvr\config\wyze-bridge-v4, host ports 5050(UI) 1985(go2rtc) 8564(RTSP). Old file: backup\wyze-bridge.yml.20261014-221318.bak
Why fork: V4 fw 4.52.17 blocks TUTK; Bulb HL_BC + Doorbell Duo GW_DBD unsupported by mrlt8 2.10.3. TUTK/host-net debugging is a dead end.
Frigate: config.yml go2rtc cam1=yard_and_car cam2=upstairs cam3=backyard_cam(640x360) doorbell=front_door; single input record+detect; model config\frigate\model_cache\yolo.onnx (yolov9-t-320)
Cameras: cam1 Yard and car PASS 2560x1440; cam2 Upstairs PASS 2560x1440; cam3 Backyard Cam PASS 640x360; doorbell Front door ALERT-ONLY since 2026-10-17 (Frigate camera disabled, on-demand)
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
Next: none required. Optional: GO-LIVE step 11 login via schannel (WARN 400), step 5 render script missing (WARN). No commits/push.
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
GAP (user decision): bridge 4.5.0 has no Wyze motion/ring event feed, so doorbell rings no longer reach ntfy; Wyze app push still works. Options: Wyze app only / build Wyze get_event_list -> ntfy cloud poller (no cam wake) / re-enable Frigate doorbell (drain returns).
Do not repeat: re-enabling doorbell in Frigate permanently; after any doorbell pull stops, restart nvr-wyze-bridge if front_door EOF warnings keep repeating every 60s.
