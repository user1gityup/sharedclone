@echo off
title Join the shared brain
REM One click. Joins this machine's ~/.claude/shared-brain to the shared history. Never pushes.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0JOIN-BRAIN.ps1" %*
if errorlevel 9009 (
  echo.
  echo   Windows PowerShell could not be started.
  pause
)
