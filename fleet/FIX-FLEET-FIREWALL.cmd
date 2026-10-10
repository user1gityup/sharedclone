@echo off
rem One click: allow the fleet services through this machine's firewall,
rem local subnet only. Prompts for administrator (UAC) and changes nothing
rem until that prompt is approved. Nothing else on the firewall is touched.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0FIX-FLEET-FIREWALL.ps1"
