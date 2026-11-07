@echo off
rem One click: apply the FCC keepalive fix on this host, test, restart FCC, prove it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0FIX-FCC-KEEPALIVE.ps1"
echo.
pause
