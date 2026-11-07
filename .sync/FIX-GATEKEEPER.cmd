@echo off
rem One click: install the current PowerShell gatekeeper from the shared brain's origin.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0FIX-GATEKEEPER.ps1" %*
exit /b %ERRORLEVEL%
