@echo off
rem One click: open BOTH LAN-exposure paths in Windows Firewall, LocalSubnet only.
rem   A = the llama router itself, llama-server.exe on TCP 8090, API key required.
rem   B = the token-gated node relay, .sync/llama-relay.mjs on TCP 8091.
rem Each script asks for elevation itself (UAC), then prints what it changed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\shared-brain\relay\llama-router-firewall.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\shared-brain\relay\llama-relay-firewall.ps1"
pause
