# Handoff: Wyze/Frigate NVR - ops workstream (backup, rollback, watchdog, autostart)
Handoff id: handoff-2026-10-14-1740-nvr-ops-workstream
Updated: 2026-10-14 17:43 (local, vmixer2o2)
Host: vmixer2o2 (Windows 10 Pro, PS 5.1 only, user vMixer non-elevated, filtered admin)
Session: headless Claude-only swarm worker, workstream "ops", session 039de765-3603-4ad2-a960-a3436c2ee518
Model: Claude Fable 5.1
Owner: Claude Fable 5.1 (ops); orchestrator = swarm script; pm task T-25bb8b1f (vmixer pm)
Repository: none (D:\nvr is not a git repo); brain project notes: shared-brain\projects\wyze-frigate-nvr\
Exact ask: pre-stage ops scripts so GO-LIVE.ps1 can take the NVR live in <10 min: scripts/ops/ (watchdog + user-level task installer, Docker Desktop autostart enable, backup-config.ps1, rollback.ps1), docs/RUNBOOK.md, docs/ws-ops-notes.md; test backup+rollback on the skeleton.
Facts file: shared-brain\projects\wyze-frigate-nvr\vmixer-facts.md (read first)
Verified so far: Docker 29.8.1/compose v5.5.1 up; only container ecom-final-mysql (never touch); network nvr exists (labels nvr.owner=discovery, not compose-managed); 'docker compose -p nvr down' works by project name with no files (exit 0, warning only); settings-store.json at %APPDATA%\Docker (UTF-8 no BOM, AutoStart=false); HKCU Run key 'Docker Desktop' already present; E:\nvr-archive exists empty; tar.exe, wscript.exe, nvidia-smi present; no pwsh 7.
Files written: D:\nvr\scripts\ops\_ops-common.ps1 (shared lib, done), D:\nvr\scripts\ops\backup-config.ps1 (done, untested yet)
Files still to write: rollback.ps1, watchdog.ps1, watchdog.settings.json, watchdog-launch.vbs, install-watchdog.ps1, uninstall-watchdog.ps1, enable-docker-autostart.ps1, ops-status.ps1, test-ops.ps1, D:\nvr\docs\RUNBOOK.md, D:\nvr\docs\ws-ops-notes.md
Design: backups -> <ARCHIVE_ROOT>\backups\config\nvr-config-<ts>[-label].zip + .manifest.json (tar.exe zip, sha256, excludes model_cache); rollback = pause watchdog, docker compose -p nvr down (no -v), pre-rollback snapshot, delete extras, tar -x, hash-verify, non-NVR container snapshot before/after must match; watchdog = scheduled task NVR-Watchdog (InteractiveToken, every 2 min, hidden via VBS), heals only label com.docker.compose.project=nvr, ntfy topic nvr-health via inputs.env NTFY_URL/NTFY_HEALTH_TOPIC/NTFY_TOKEN; autostart = edit settings-store.json AutoStart true (regex, UTF-8 no BOM, backup first), called by GO-LIVE not now.
Uncommitted changes: n/a (no repo)
Processes/ports: none started by ops
Permissions: writes limited to D:\nvr\scripts\ops, D:\nvr\logs\ops, D:\nvr\docs\RUNBOOK.md, D:\nvr\docs\ws-ops-notes.md, E:\nvr-archive\backups, scratchpad
Remote Control: off (headless worker)
Open questions: none blocking; GO-LIVE author must call enable-docker-autostart.ps1, backup-config.ps1 -Label go-live, install-watchdog.ps1 -RunNow, ops-status.ps1 -Strict -Wait 240
Next action: write rollback.ps1, then watchdog + installer + autostart + status + test harness; run test-ops.ps1 in a sandbox root; run real backup on D:\nvr; write docs; return StructuredOutput.
Do not repeat: do not run rollback.ps1 against the live D:\nvr while other workstreams write files (it deletes files not in the backup); do not register NVR-Watchdog for real (GO-LIVE does); do not flip Docker AutoStart now.
Signed: Claude Fable 5.1 (ops)
