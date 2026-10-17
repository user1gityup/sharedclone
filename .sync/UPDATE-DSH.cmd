@echo off
title Update DSH
REM One click. Syncs the shared brain, fast-forwards and rebuilds deepseek-harness, restarts DSH. Never pushes.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UPDATE-DSH.ps1" %*
if errorlevel 9009 (
  echo.
  echo   Windows PowerShell could not be started.
  pause
)
