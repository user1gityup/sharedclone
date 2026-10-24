# Wyze/Frigate NVR — vmixer2o2 facts + user decisions
Claude Opus 5.5, 2026-10-15T00:30Z. pm T-25bb8b1f (vmixer pm), status blocked pending inputs. Swarm wf_335aa828-ffc stopped by user in discovery.

## Measured on vmixer2o2
- Docker Desktop 29.8.1, compose v5.5.1, WSL2. AutoStart=false. Only existing container: ecom-final-mysql (unless-stopped) — never touch.
- GPU GTX 1070 8 GB (cc 6.1), visible in Docker (`--gpus all` nvidia-smi OK). CPU Xeon E5-2695 v4 36 threads, RAM 128 GB. No Coral.
- Tailscale 1.104.1, vmixer2o2 = 100.72.119.57; Pixel 10 Pro on tailnet.
- LAN 10.0.0.0/24, host 10.0.0.244. Wyze OUI 80:48:2c hosts: .169 HL_CAM4 (Cam v4), .72 HL_BC (Bulb Cam), .253 (unnamed), .34 wyze_dbd (doorbell, no ping), .234 Wi-Fi Chime. No open TCP ports on cams (P2P only) → docker-wyze-bridge required.
- Ports in use: 135 139 445 2179 3080 4480 5040 5939 7680 8082 8091 + Hyper-V excluded 5357 8884 50000-50059 52585-54098 62787-63086.
- Disks: D NVMe 1.76 TB free (hot tier), E 3.7 TB empty SkyHawk HDD, G 3.4 TB free (Steam), C 1.6 TB free. No NAS, no SMB maps.
- Leftovers from stopped discovery: D:\nvr\ dir skeleton, docker network `nvr` (172.30.0.0/24), image debian:bookworm-slim.

## User decisions (00:30Z)
- Archive: NAS later. Interim archive = TBD (E: suggested); NAS path added when available.
- Retention: fill disk — ~7 d continuous on D:, archive until 90% full, oldest continuous pruned first, events kept longest.
- Cameras: original 4 only (2x Cam v4, Bulb Cam, Duo Cam). Doorbell/chime excluded. Second v4 + Duo not identified by name yet (.253 candidate).
- Notifications: both ntfy (self-hosted, via Tailscale) and Frigate web push.

## Still needed (ChatGPT/user gathering)
- Wyze account email + API key ID + API key (developer portal) → user puts in D:\nvr\config\wyze-bridge\.env; agents never type them. 2FA on?
- Camera names as in the Wyze app for all 4; is the Duo online?
- Interim archive drive while no NAS (E:?).

## ChatGPT camera Q1-Q6 (bridge seq 457-459, user-confirmed) - recorded 00:45Z by Claude Opus 5.5
- Inventory: 2x Wyze Cam v4, 1x Wyze Bulb Cam, 1x **Wyze Duo Cam Doorbell** (dual-lens video doorbell, NOT Duo Cam Pan).
- Doorbell is **battery only**: do not assume 24/7 streaming/RTSP/continuous recording; test what wyze-bridge supports (likely on-demand/event only), isolate it as BLOCKED/limited without holding up the other 3; no rewiring, paid features or firmware changes.
- **No microSD** in any camera: no SD backup/recording paths.
- All 4 online in the Wyze app: never reset or re-pair; test each stream independently.
- Auth hybrid: try safe local methods first; otherwise existing account + free developer API key. No raw credentials in pm, logs, brain, source or bridge.
- Max safe effort: test all free, legitimate options; ship working cameras; report each camera PASS/FAIL/BLOCKED with evidence. No firmware flashing or downgrades.
- Tiering must keep the native Frigate recordings DB intact.

## Credentials method (Claude Opus 5.5, tested)
- User enters them via D:\nvr\ENTER-WYZE-CREDS.cmd (also on the Desktop). Input is masked and stored DPAPI-encrypted (CurrentUser) in D:\nvr\secrets\wyze.clixml. Folder ACL: vMixer + SYSTEM only.
- GO-LIVE must dot-source D:\nvr\scripts\secrets\Import-WyzeCreds.ps1, which sets WYZE_EMAIL, WYZE_PASSWORD, API_ID and API_KEY in the process env only. Compose passes them by interpolation (environment: WYZE_EMAIL: ${WYZE_EMAIL}, etc.). inputs.env must NOT hold credentials, only camera names and ARCHIVE_ROOT.
