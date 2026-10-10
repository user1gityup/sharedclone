@echo off
rem Double-click on vmixer2o2 with the USB drive plugged in. Loads the Antigravity seats
rem that AGY-EXPORT-TO-USB.cmd wrote to this drive into %USERPROFILE%\.dsh\antigravity.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DSH-AGY-TRANSFER\import-agy.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
