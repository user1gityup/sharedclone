@echo off
rem Double-click on ndi2 with the USB drive plugged in. Copies the Antigravity seat pool
rem to the drive, plus AGY-IMPORT-FROM-USB.cmd to double-click on vmixer2o2.
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\shared-brain\transfer\2026-09-26-ndi2-to-vmixer2o2\agy-usb\export-agy.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
