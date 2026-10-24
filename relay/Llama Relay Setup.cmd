@echo off
setlocal
title Llama Relay Setup
rem One click on the GPU host (vMixer): token for ndi2, publish the target record,
rem firewall rule for TCP 8091 from the local subnet (UAC prompt), then start the relay.
rem The llama router on 127.0.0.1:8090 must already be running (llama-control).
set "RELAY=%USERPROFILE%\.claude\shared-brain\.sync\llama-relay.mjs"
echo [1/3] Tokens and target record
node "%RELAY%" setup vmixlaptop2x6
if errorlevel 1 goto failed
echo [2/3] Firewall (approve the UAC prompt)
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\shared-brain\relay\llama-relay-firewall.ps1"
if errorlevel 1 goto failed
echo [3/3] Relay starting in its own window
start "Llama Relay" /min node "%RELAY%" serve
timeout /t 3 /nobreak >nul
node "%RELAY%" status
echo.
echo Done. Commit and push the brain so other machines see relay\llm-targets and their tokens.
pause
exit /b 0
:failed
echo Setup stopped: see the error above.
pause
exit /b 1
