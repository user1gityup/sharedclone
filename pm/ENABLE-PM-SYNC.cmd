@echo off
rem One click: back up pm, restart it on the sync code, sync with peers, verify, (vmixer2o2) archive dup T-67ba9f12.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ENABLE-PM-SYNC.ps1" %*
echo.
pause
