@echo off
rem One click: continue the newest quota handoff from another account under THIS account.
rem Pulls the brain (no push), preserves this account's own active sessions, claims the
rem handoff and opens one Claude Code window per handed-off session. Re-running continues
rem an interrupted restore. Pass a handoff id to pick one; set CLAUDE_CONFIG_DIR for a second account.
node "%~dp0brain-sync.mjs" start >nul 2>&1
node "%~dp0quota-guard.mjs" resume %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
