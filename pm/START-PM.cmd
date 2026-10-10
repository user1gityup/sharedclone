@echo off
rem Agent Project Manager: starts the server if it is not already running, then opens it.
setlocal
set "HERE=%~dp0"
rem The node redirect below writes into %USERPROFILE%\.claude\pm-data.
rem cmd resolves a redirect BEFORE launching the process, so if that
rem directory does not exist node never starts and no log is written.
rem Found on a fresh machine (vmixer2o2) 2026-10-05.
if not exist "%USERPROFILE%\.claude\pm-data" mkdir "%USERPROFILE%\.claude\pm-data"
powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:4480/api/health -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "pm server" /min cmd /c "node "%HERE%server.mjs" >> "%USERPROFILE%\.claude\pm-data\server.log" 2>&1"
  powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(15); while((Get-Date) -lt $d){ try { Invoke-RestMethod http://127.0.0.1:4480/api/health -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 300 } }; exit 1"
  if errorlevel 1 ( echo pm server did not start - see %USERPROFILE%\.claude\pm-data\server.log & pause & exit /b 1 )
)
start "" http://127.0.0.1:4480/
