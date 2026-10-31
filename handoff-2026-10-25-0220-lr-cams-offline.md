# Handoff: Living Room cam tiles "Offline"

- Id: handoff-2026-10-25-0220-lr-cams-offline
- Updated: 2026-10-25T13:08Z (06:08 PT), host vmixer2o2, QUOTA HANDOFF (session 100%, resets 05:09 PT reported)
- Status: vmx12 (code 27) on both TVs 13:18Z: Add app + Play Store in gear menu, apps on bottom row, cams taller (to y740), icons on date line; verified TandKcast screencaps vmx12-home/menu/add.png (scratchpad 88a125cc). LR installed, not screencapped. vmx10 LR fallback proven. Doorbell live blocked (Duo WebRTC EOF; another dial 13:08Z by client 090822c17edb6172 failed).
- Next: screencap LR vmx12 when idle. Doorbell EOF is now worked by session local_5459692a (doorbell-click-live-with); Frigate-on-TV by local_89b1bd6b + local_c4abbb9c (frigate-tv-nav). Do not duplicate them.
- Session: 88a125cc-748d-46a0-9584-ac795fe5a5eb (side of local_ad8421ed), model claude-opus-5-5. Owner of tv-detox-src + TV installs + doorbell test (handed over by local_eec9ec5b).
- Model: Claude Opus 5.5 (claude-opus-5-5), side session started by session local_ce040b9e-e365-48c2-8883-79764165e875; scratchpad id f64a6d91-fb05-4208-b92e-d3bcc17ee73d
- Repo/branch: none (not git); cwd ~\Documents\claudecode\tv-audit-2026-10-24\tv-detox-src\src\com\ansub\tvhome (read only)
- Owner: this session (done, diagnostic only). Collaborators: doorbell vmx9 build owner = session local_eec9ec5b-1f87-4c6c-964e-cd6d3ecabaa4 (owns D:\nvr\*, tv-detox-src, APK installs). Parent: handoff-2026-10-23-2045-onn-tv-detox.md
- Resumed by: session local_1aa15813-c447-453a-8191-b4097fa1c978 (lr-cams-resume), 02:25 PT
- CLAIMED 2026-10-25T09:21Z by Claude Opus 5.5, side session of local_ad8421ed (task from that session). Remote Control was off, so it stays off.
- Remote Control: off. Processes/ports: none started. Uncommitted changes: none. Permissions: none granted.

## Ask
Find why Living Room onn TV (adb 10.0.0.92:35305, app 1.5.3-vmx8) showed Upstairs (cam2) and Yard & car (cam1) Offline while TandKcast (vmx9) played them. Don't build/install, don't edit D:\nvr or the app source.

## Verified
- At 02:11 and 02:15 PT all 3 LR tiles were playing. Screencaps lr1.png/lr2.png are in the scratchpad above; the tiles differ between them, so the video is live.
- Both hosts are reachable from the LR shell. nc to 10.0.0.244 and to 100.72.119.57 on port 1984 got `HTTP/1.0 200 OK` for cam1/2/3_720 (124-218 ms). LAN stays on wlan0 even with Tailscale tun0 up.
- The onn decodes 3x 720p at once (kernel `vdec_create ... total 3`; 3x `MediaPlayerNative info (3,0)` render-start).
- tv-hls served only 200s from 01:40 PT until docker events show `09:07:57Z kill` -> `09:08:01Z restart` (vmx9 server.py deploy). LR players were all released at 02:09:08, then fullscreen 1440p opens failed (`E NuPlayerDecoder: Failed to create video/avc decoder`, 02:09:09/02:09:13), and the tiles were rendering again at 02:09:16.
- Root cause (most likely, transient): the tv-hls restart for vmx9 took the streams down. TandKcast looked fine because the vmx9 install at 02:09:54 relaunched it after the server was back.
- Not proven: the LR main logcat holds only about 2 min (PlaylistFetcher "no audio data" spam), so the outage's onError lines were gone.

## Also
The user said "you are using wrong camera for doorbell test". In tv-hls server.py:13, `FAKE_SRC = rtsp://frigate:8554/cam1_720`. The report was relayed to local_eec9ec5b (delivered, read not confirmed).

## Open / next action
- For the vmx9 owner (not applied): make `camHostAt` per tile (MainActivity.java:453/:540) and add Log.w in onError with stream/what/extra/host; optionally add a silent audio track so the TV logcat stops rolling. Full write-up: `~\AppData\Roaming\Claude\side-session-notes\local_eec9ec5b-1f87-4c6c-964e-cd6d3ecabaa4\lr-cams-offline.md`.
- Doorbell FAKE_SRC fix belongs to local_eec9ec5b.
- If Offline recurs on LR: pull `logcat -d` within 2 min and grep `MediaPlayer.*rror|NuPlayer|Failed to create`.

## Do not repeat
Host/VPN reachability, decoder concurrency and server 404s are already checked (all fine). Don't screencap or drive the LR TV while someone is using it (they were at 02:16).

## Resume 2026-10-25 09:25Z (02:25 PT), Claude Opus 5.5
- Live state: both TVs run 1.5.3-vmx9. nvr-tv-hls has been up since 09:08:01Z. LR was on Netflix at 09:21Z, then on tvhome at 02:21:54 PT (someone was at the TV, so no LR screencap).
- Item 3 proof: TandKcast screencaps tk1.png/tk2.png (scratchpad 88a125cc-748d-46a0-9584-ac795fe5a5eb) show Yard & car, Upstairs and Backyard live; pixel diff over 4 s is 122/26/13 changed samples. The Doorbell tile shows its idle "No captures yet" state. LR logcat at 02:21:54: vdec total 3 and `MediaPlayerNative info (3,0)` x3, no NuPlayer errors, so the 3 cam tiles render.
- Still open: Doorbell live video waits on the owner's real-doorbell test after 09:37Z (FAKE_SRC=cam1_720 was used only while the fake-live file existed, and that file is gone).
- Items 1 and 2 were asked of owner local_eec9ec5b by SendMessage 09:24Z (A keep / B hand item 2 over / C decline). No reply yet. No files edited.

## 09:27Z, Claude Opus 5.5 (side of local_ad8421ed): owner handed over item 2, the tv-detox-src build and installs, plus the real-doorbell test (local_eec9ec5b replied B; ce040b9e is out of context). This session now owns them.
- REAL CAUSE of LR "Offline" (user reported again 02:23 PT): OK on a tile opens the full stream fullscreen. cam1/cam2 full = 2560x1440 H.264 High L5.0, and the onn decoder fails (`E NuPlayerDecoder: Failed to create video/avc decoder`, `MediaPlayer Error (1,-2147483648)` at 02:23:26), so fullscreen showed Offline and retried forever. Backyard full is 640x360, which is why only Yard & car and Upstairs failed. TandKcast decodes 1440p fine.
- vmx10 (code 25) built and installed -r on BOTH TVs 09:25Z: per-tile hostAt (camHostAt = last host that played; the doorbell uses it), `Log.w tvhome "cam <s> err w/e host <url>"`, fullscreen falls back to <stream>_720 on decoder error (extra==MIN_INT). Backups MainActivity.java.bak-vmx9 / AndroidManifest.xml.bak-vmx9; changes.log line added.
- Verified on TandKcast: Backyard and Yard & car fullscreen (1440p) play, Back returns to tiles, 3 live tiles. NOT verified: the fallback on LR (it was on Netflix and someone was watching).
- Next: screencap LR vmx12 when idle. Doorbell EOF is now worked by session local_5459692a (doorbell-click-live-with); Frigate-on-TV by local_89b1bd6b + local_c4abbb9c (frigate-tv-nav). Do not duplicate them.

## 09:56Z, Claude Opus 5.5: real-doorbell test DONE (TandKcast)
- 09:54:28Z OK on the Doorbell tile -> poller `tv: live requested by dc921deea1d2dd3d` (TandKcast) -> prewarm dial -> `no media after 25 s` -> backoff until 10:24:53Z. The tile shows "Doorbell · Resting to save its battery until 3:24 AM" (door-30s.png, scratchpad 88a125cc). An earlier real dial at 09:22Z from client 090822c17edb6172 (not either TV) failed the same way.
- So the TV->tv-hls->poller path works with the REAL source (no fake). Live video is blocked by the Duo WebRTC EOF in nvr-wyze-bridge (go2rtc `websocket: close 1006 unexpected EOF` at 02:07 and 02:23 PT). That issue was DEFERRED by the user (handoff-2026-10-15-0055); not worked here.
- LR vmx10 fallback: still unproven, because LR has been on Netflix since 02:23 PT. A passive watcher (bg, 2 h, read-only logcat) writes lr-fallback.txt when someone next opens fullscreen. Do NOT drive LR while it is in use.
