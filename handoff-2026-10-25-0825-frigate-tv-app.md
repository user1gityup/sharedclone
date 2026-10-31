---
name: handoff-2026-10-25-0825-frigate-tv-app
description: Frigate full app on both Google TVs - wrapper APK + QR sign-in; next = remote-only D-pad navigation (no cursor)
metadata:
  type: project
---
Id: handoff-2026-10-25-0825-frigate-tv-app
Updated: 2026-10-25 08:47 PT (15:47Z) Claude Opus 5.5 local_89b1bd6b - PAUSED (user moved me to doorbell lead)
Host: vmixer2o2
Session: local_1aa15813 (side session of lr-cams-offline local_ad8421ed)
Model: Claude Opus 5.5 (claude-opus-5-5)
Remote Control: off
Owner: CLAIMED 2026-10-25 15:33Z by Claude Opus 5.5 session local_89b1bd6b (side session of local_1aa15813). Live state verified 15:32Z: both TVs v1.1 code 2, nvr-tv-pair+nvr-frigate healthy, serve 443->8971, 8444->8973. Working: D-pad spatial nav v3 (ETA 16:35Z est) then recorded-event proof (ETA 17:05Z est). tvhome source/installs owned by local_ad8421ed - message it before touching tvhome source or installs (heads-up already sent about the app row).
Ask: full Frigate UI (live, recordings, review) usable on Living Room onn (10.0.0.92:35305) + TandKcast (adb-07281HFDD0BFH7-MlVrpA._adb-tls-connect._tcp); add to TV Detox; prove live + recorded event per TV with screencaps.
LATEST USER ASK (open, not started): "setup the app to run without a mouse, run via remote control". Replace or augment the cursor with real D-pad focus navigation: arrows move between Frigate's buttons/tiles, OK activates, visible focus ring.
User answers: Q1 = A own wrapper APK; Q2 = QR login flow; Q3 = B tailnet only. User confirmed "both work" (both TVs signed in).
Frigate: 0.18.1, auth on, session_length 86400; 8971 self-signed; tailnet https://vmixer2o2.tail0f662.ts.net/ (serve -> 8971); 5000 loopback only.
Decoders: onn hw AVC max 1920x1088; cam1/cam2 live + recordings 2560x1440 L5.0; cam3 640x360; Chromecast fine.
Verified:
- APK com.vmx.frigatetv 1.1 (code 2), src ~/Documents/claudecode/frigate-tv-src (build-win.ps1, own key.jks pass frigatetv123). Installed both TVs.
- App: D-pad cursor (arrows move, OK tap, edge wheel-scroll, Back, Menu toggles cursor); CH+/- and REW/FF page-scroll; viewport forced to 1280 CSS px (desktop layout, all 4 cams fit, screencap proof\onn-07-dashboard-grid.png); transparent video poster; WebView debugging on (CDP via adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>; helper %TMP%\cdp.mjs); on devices without hw 1440p sets idb-keyval keyval-store/keyval "<cam>-stream"=camN_720 (key from Frigate bundle).
- Login redirect: Frigate /login -> https://HOST:8444/tv QR page.
- tv-pair: D:\nvr\scripts\tv-pair\server.mjs, D:\nvr\compose\tv-pair.yml (nvr-tv-pair, 127.0.0.1:8973), tailscale serve --https=8444. Paired onn 15:18:51Z and TandKcast 15:23:02Z as admin (user's phone).
- Frigate config: cam1/cam2 live.streams {Main, 720p: camN_720}; restarted 15:20Z; BOMs stripped.
- onn LIVE PROOF: cam1 single view plays 1280x720, t advancing (proof\onn-08-live-cam1.png).
- TV Detox app row: YouTube, Netflix, Stremio, Frigate on both (onn screencap proof\onn-06-home-frigate-tile.png; TandKcast set while asleep, not screencapped).
Partial / next:
1. Remote-only navigation (user's latest ask): e.g. spatial navigation over focusable elements (button, a, [role=button], [tabindex], video tiles) with injected JS + focus outline; cursor optional (Menu toggles). Rebuild, bump versionCode 3, install both, test with adb input keyevent.
2. onn recorded-event test INCONCLUSIVE: /review?id=1792940760.247271-u9d1o1 landed on /review, video never started (no vod request); open the event by clicking it in Review instead. 1440p VOD likely fails on onn -> ask user: record 1080p vs Chromecast-only vs accept (not asked).
3. TandKcast proof screencaps (live + event) when idle and not watched.
4. session_length 24 h -> TVs re-pair daily if idle; maybe ask to raise.
5. pm task (not created yet).
Backups: config.yml.bak-20261025-082013, compose.yml.bak-20261025-081458, server.mjs.bak-*.
Undo: docker rm -f nvr-tv-pair; tailscale serve --https=8444 off; restore backups; docker restart nvr-frigate; adb uninstall com.vmx.frigatetv; app row intent without com.vmx.frigatetv (see changes.log).
Do not repeat: typing user's password (prohibited); Referrer-Policy no-referrer (breaks Origin check); PS Set-Content utf8 adds BOM.
PAUSE 15:47Z (Claude Opus 5.5, local_89b1bd6b): user made this session doorbell click-live lead (Q&A C); Frigate app work paused, nothing installed or built.
- Written, not built: frigate-tv-src\res\raw\spatnav.js (D-pad spatial nav: ring overlay, nearest-in-direction, layer trap, scroll panes; __ftv.move/ok/back/page/route). Proven on onn by live CDP inject only (candidate list correct on recording view). MainActivity not yet wired (plan: load raw JS onPageFinished+doUpdateVisitedHistory; arrows -> __ftv.move; OK -> __ftv.ok() coords -> real touch, showSoftInput if edit; Back -> Escape if __ftv.back() else goBack; cursor off by default, Menu toggles; CH+/- -> __ftv.page).
- NEW user asks (not started): (1) app must not stay live in background -> onStop load about:blank + remember URL, onStart reload; (2) "move 2nd cam to left side" = DOORBELL package-cam inset (user 16:32Z), handed to local_0e55275e; NOT the grid.
- onn was in active use 15:35Z (tvhome -> profile chooser): do not drive it while in use. Dev loop: headless Chrome on http://127.0.0.1:5000 (no auth) at 1280x720 + CDP (stopped).
