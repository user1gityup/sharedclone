@echo off
rem One click: expose this host pm /mcp to ChatGPT via Tailscale Funnel on 8443 only, test, copy URL.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ENABLE-PM-FUNNEL.ps1" %*
echo.
pause
