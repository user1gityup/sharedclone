@echo off
rem Agent Project Manager, LAN-reachable: starts the server bound to every
rem interface (not just loopback), protected by a bearer token, so another
rem machine on the same LAN can run `cli.mjs` against it. Local (127.0.0.1)
rem callers on THIS machine still work token-free -- the server only requires
rem the token for a request whose remote address is not loopback.
rem
rem Reads PM_TOKEN from %USERPROFILE%\.claude\pm-remote.env (one KEY=VALUE
rem line per row; PM_URL in that same file just documents this machine's LAN
rem address for other machines' cli.mjs, it is not read here). Generate a
rem fresh file first if it does not exist yet:
rem   node -e "console.log('PM_URL=http://<this-machine-LAN-IP>:4480'); console.log('PM_TOKEN='+require('crypto').randomBytes(24).toString('hex'))" > "%USERPROFILE%\.claude\pm-remote.env"
rem
rem Opening this to the LAN also needs an inbound firewall allow rule for
rem TCP 4480 -- Windows Firewall blocks unsolicited inbound connections by
rem default and this script does not touch firewall rules (that is a
rem system-security change, left to whoever runs this). One-time, elevated:
rem   New-NetFirewallRule -DisplayName "pm (project manager) LAN" -Direction Inbound -Protocol TCP -LocalPort 4480 -Action Allow -Profile Private
setlocal enabledelayedexpansion
set "HERE=%~dp0"
set "ENVFILE=%USERPROFILE%\.claude\pm-remote.env"
if not exist "%ENVFILE%" (
  echo %ENVFILE% not found -- see the comment at the top of this file to create it.
  pause
  exit /b 1
)
for /f "usebackq tokens=1,* delims==" %%A in ("%ENVFILE%") do (
  if /i "%%A"=="PM_TOKEN" set "PM_TOKEN=%%B"
)
if "%PM_TOKEN%"=="" (
  echo PM_TOKEN not found in %ENVFILE%.
  pause
  exit /b 1
)
set "PM_HOST=0.0.0.0"
rem The node redirect below writes into %USERPROFILE%\.claude\pm-data.
rem cmd resolves a redirect BEFORE launching the process, so if that
rem directory does not exist node never starts and no log is written.
rem Found on a fresh machine (vmixer2o2) 2026-10-05.
if not exist "%USERPROFILE%\.claude\pm-data" mkdir "%USERPROFILE%\.claude\pm-data"
powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:4480/api/health -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "pm server (LAN)" /min cmd /c "node "%HERE%server.mjs" >> "%USERPROFILE%\.claude\pm-data\server.log" 2>&1"
  powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(15); while((Get-Date) -lt $d){ try { Invoke-RestMethod http://127.0.0.1:4480/api/health -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 300 } }; exit 1"
  if errorlevel 1 ( echo pm server did not start - see %USERPROFILE%\.claude\pm-data\server.log & pause & exit /b 1 )
  echo pm is up, bound to every interface, token required for non-loopback callers.
) else (
  echo pm is already running -- if it was started by plain START-PM.cmd it is loopback-only; stop it and rerun this script to switch it to LAN mode.
)
