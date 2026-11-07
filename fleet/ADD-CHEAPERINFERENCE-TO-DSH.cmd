@echo off
rem Adds CheaperInference to the DSH agent/model list on this machine. Safe to run twice.
node "%USERPROFILE%\.claude\shared-brain\fleet\apply-cheaperinference-provider.mjs"
echo.
pause
