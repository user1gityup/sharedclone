@echo off
setlocal
title OpenRouter Relay
set "RELAY=node "%USERPROFILE%\.claude\shared-brain\.sync\openrouter-relay.mjs""
set "CONTROL=powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.dsh\openrouter-control.ps1""

:menu
echo.
echo  OpenRouter Relay  (key holder: 1-8, pool machine: 9-10)
echo   1  Status
echo   2  Mode: loopback  (relay off for other machines)
echo   3  Mode: lan       (same network, token + firewall allow-list)
echo   4  Mode: tunnel    (Tailscale 100.x, different networks)
echo   5  Mode: ssh       (loopback only, clients forward a port)
echo   6  Issue a token for a machine
echo   7  Revoke a machine's token
echo   8  Add an address to the firewall allow-list (then run relay-firewall.ps1 as admin)
echo   9  Connect this machine to the relay
echo  10  Disconnect this machine from the relay
echo   0  Exit
set "CHOICE="
set /p "CHOICE=Choose: "
if not defined CHOICE exit /b 0
if "%CHOICE%"=="1" ( %RELAY% status & goto menu )
if "%CHOICE%"=="2" ( call :mode loopback & goto menu )
if "%CHOICE%"=="3" ( call :mode lan & goto menu )
if "%CHOICE%"=="4" ( call :mode tunnel & goto menu )
if "%CHOICE%"=="5" ( call :mode ssh & goto menu )
if "%CHOICE%"=="6" ( set /p "HOST=Machine name: " & call %RELAY% issue %%HOST%% & goto menu )
if "%CHOICE%"=="7" ( set /p "HOST=Machine name: " & call %RELAY% revoke %%HOST%% & goto menu )
if "%CHOICE%"=="8" ( set /p "ADDR=IPv4 address or CIDR: " & call :allow & goto menu )
if "%CHOICE%"=="9" ( set /p "ROUTE=Route (lan, tunnel or ssh): " & call %RELAY% connect --route %%ROUTE%% & goto menu )
if "%CHOICE%"=="10" ( %RELAY% disconnect & goto menu )
if "%CHOICE%"=="0" exit /b 0
goto menu

:mode
%RELAY% mode %1
if errorlevel 1 exit /b 1
%CONTROL% reload
exit /b 0

:allow
%RELAY% allow %ADDR%
exit /b 0
