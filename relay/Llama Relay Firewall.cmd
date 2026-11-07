@echo off
rem One click: allow the llama relay through Windows Firewall on TCP 8091 (LocalSubnet only).
rem llama-relay-firewall.ps1 asks for elevation itself (UAC prompt), then prints what it changed.
rem The relay itself is already running; this only opens the port to the LAN.
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\shared-brain\relay\llama-relay-firewall.ps1"
pause
