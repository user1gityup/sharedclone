@echo off
title Export agent history
REM One click. Syncs the shared brain, exports this machine's redacted agent history, scans, commits locally. Never pushes.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0EXPORT-HISTORY.ps1" %*
if errorlevel 9009 (
  echo.
  echo   Windows PowerShell could not be started.
  pause
)
