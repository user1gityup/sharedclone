---
name: handoff-2026-10-23-2045-onn-tv-detox
description: onn Google TV (10.0.0.92) audit + TV Detox home, Button Mapper, weather-on-clock build
metadata:
  type: project
---
Id: handoff-2026-10-23-2045-onn-tv-detox
Updated: 2026-10-23 20:58 PT (03:58Z 10-24) - FINISH (context 247k)
Host: vmixer2o2
Session: 764bc242-287f-487e-aee2-ce49a74c2556 (Claude Code desktop, Code tab)
Model: Claude Opus 5.5 (claude-opus-5-5)
Owner: CLAIMED 2026-10-24 by Claude Opus 5.5 side session (parent local_e14667cf); claims re-verified live (4 disabled, tvhome/surfshark/homebutton installed, a11y flar2.homebutton/a.i on, launcherx+setupwraith enabled). Prior: Claude Opus 5.5; ChatGPT originated (bridge seq 572), reports sent seq 573-577
Remote Control: off
Ask: remove Top picks; TV Detox home with only YouTube, Netflix, Tailscale, Stremio, Surfshark; Home button opens it (Button Mapper, user Q1=A); weather on the clock (user chose B = code change + rebuild)
Device: onn Full HD Streaming Device (onn_2k_gtv), Android 14, adb 10.0.0.92:35305 (paired; mDNS blocked on LAN)
adb: winget Google.PlatformTools 37.0.1 at %LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.PlatformTools_*\platform-tools\adb.exe (not on PATH in this shell)
Verified: audit baseline; disabled play.games, youtube.tvmusic, feedback, printspooler (checks PASS); TV Detox com.ansub.tvhome installed safe mode (launcherx ON); app list set; Surfshark installed + tiled (screenshot)
Partial: Button Mapper 4.09 (flar2.homebutton) installed by user; accessibility enabled via adb (flar2.homebutton/a.i). Add Buttons needs a PHYSICAL Home press on remote (adb-injected HOME bypasses capture). Then set Home action -> launch app TV Detox (com.ansub.tvhome)
Verified 10-24 03:13 PT: Apps only mode ON (user set it); 9 unselected apps disable-user (hulu, tubi, instagram, ytunplugged, haystack, appletv, cbs, espn, wbd) -> row = Netflix, YouTube, Stremio, Surfshark, tailscale + Button Mapper (kept until Home map done). Screens appsonly1/2.png. Hero banner carousel is Google's, not removable. Nav helper: tv-audit-2026-10-24\ui.ps1
Partial 10-24 (user OK'd downloads): JDK17 installed (%LOCALAPPDATA%\Programs\Microsoft\jdk-17.0.10.7-hotspot); SDK installing to %LOCALAPPDATA%\Android\Sdk (cmdline-tools + platforms;android-34 + build-tools;34.0.0). Source copied to tv-audit-2026-10-24\tv-detox-src and EDITED (uncommitted vs 2ac1ee6): INTERNET perm, activity-alias .Launch (LAUNCHER, label TV Detox), weather TextView under clock (Open-Meteo, default Sacramento, --es weather "lat,lon"). SDK licenses: user said A (accept) 10-24, then paused to ask a question before the run; licenses NOT yet accepted, platform/build-tools NOT installed. Not yet built. New key != release key -> must uninstall old tvhome first, then re-send app list.
Files: ~\Documents\claudecode\tv-audit-2026-10-24\ (raw audit, PLAN.md, changes.log with undo cmds, step.ps1, screenshots)
Uncommitted: none (no repo)
Processes: adb server on vmixer :5037
Permissions/state left: TV Wireless debugging ON (user said keep); vmixer Windows Firewall Public+Private OFF (user turned off; agent must not change)
Open questions: weather location (screensaver suggested Sacramento); Button Mapper may need accessibility grant on TV
Button Mapper 10-24: HOME captured, Customize ON, single tap=Default. BLOCKER: TV Detox manifest has HOME category only (no LAUNCHER/LEANBACK_LAUNCHER) so Button Mapper app list lacks it; Public intent = broadcast only. Fix = add LEANBACK_LAUNCHER to tvhome manifest in the weather rebuild, then map single tap -> TV Detox. Toolchain absent (no java, no SDK); download permission asked 10-24.
Next (old): user presses Home in Button Mapper Add Buttons, map -> TV Detox; then weather B: install JDK17+SDK, Open-Meteo by clock, build, reinstall (re-apply app list: youtube.tv,netflix.ninja,tailscale.ipn,stremio.one,surfshark.vpnclient.android)
Undo: undo.sh 10.0.0.92:35305 (tv-detox clone); pm enable <pkg> per changes.log
Do not repeat: GOOGLE_TV=1 / disabling launcherx or setupwraith (boot-loop risk, wireless-only recovery)
