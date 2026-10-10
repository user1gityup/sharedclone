@echo off
rem One click on vmixer2o2: clones users / canna / commerce from the bundles in this folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0clone-repos.ps1" %*
set rc=%errorlevel%
pause
exit /b %rc%
