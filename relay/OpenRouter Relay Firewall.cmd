@echo off
rem One click: allow the vMixer relay client through Windows Firewall on TCP 8080.
rem relay-firewall.ps1 asks for elevation itself (UAC prompt), then prints what it changed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\shared-brain\relay\relay-firewall.ps1"
pause
