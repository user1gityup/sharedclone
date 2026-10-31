@echo off
rem One click: start pm, DSH and FCC on this machine and publish the real
rem endpoints into the shared brain. Safe to run twice.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-ALL-SERVERS.ps1"
pause
