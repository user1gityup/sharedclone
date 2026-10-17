# One-click pm code deploy on this machine (double-click DEPLOY-PM-UPDATE.cmd).
#  1. brain-sync start: commit local brain changes, fetch, merge origin.
#  2. Run both pm suites (pm/test.mjs, pm/bridge/test.mjs); stop on any failure.
#  3. Stop the running pm server; the watchdog (pm-autostart.ps1) restarts it.
#     If no watchdog is running, start one with -StartIfAbsent.
#  4. Wait for readiness (health ok + fresh dispatcher tick) on the new pid.
#  5. Verify the reply-as-ack fix is in the loaded queue.mjs.
# Log: pm-data\deploy.log. Exit code 0 only when every step passed.
$ErrorActionPreference = 'Continue'
$pmDir   = $PSScriptRoot
$brain   = Split-Path $pmDir -Parent
$dataDir = Join-Path $env:USERPROFILE '.claude\pm-data'
$log     = Join-Path $dataDir 'deploy.log'
New-Item -ItemType Directory -Force $dataDir | Out-Null
function Log($m) { $l = "{0:u} {1}" -f (Get-Date).ToUniversalTime(), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding utf8 }
function Fail($m) { Log "FAIL: $m"; exit 1 }

Log "deploy start on $env:COMPUTERNAME"

$sync = & node (Join-Path $brain '.sync\brain-sync.mjs') start 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Fail "brain-sync start exit $LASTEXITCODE`n$sync" }
Log "brain-sync ok: $(git -C $brain log --oneline -1)"

if (-not (Select-String -Path (Join-Path $pmDir 'bridge\queue.mjs') -Pattern 'ChatGPT answers with correlation_id' -Quiet)) {
  Fail 'queue.mjs lacks the reply-as-ack fix after sync'
}

Push-Location $pmDir
foreach ($t in 'test.mjs', 'bridge\test.mjs') {
  $out = & node $t 2>&1 | Out-String
  $code = $LASTEXITCODE
  $tail = ($out.Trim() -split "`n" | Select-Object -Last 3) -join ' | '
  if ($code -ne 0) { Pop-Location; Fail "$t exit $code : $tail" }
  Log "$t pass: $tail"
}
Pop-Location

# Find pm by its port 4480 listener: a pm started by the session-0 boot task hides its
# CommandLine from this session, so a CommandLine match finds nothing. Stopping that pm
# needs elevation (access denied otherwise): fall back to one UAC-elevated taskkill.
function Get-PmPids { @(Get-NetTCPConnection -LocalPort 4480 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) }
$old = Get-PmPids
foreach ($procId in $old) {
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
    Log "pm pid $procId needs elevation - asking UAC for taskkill"
    try { Start-Process -FilePath taskkill.exe -ArgumentList '/F', '/PID', $procId -Verb RunAs -WindowStyle Hidden -Wait } catch { Fail "elevated taskkill of pm pid $procId refused: $($_.Exception.Message)" }
  }
  if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { Fail "pm pid $procId still running after stop" }
}
Log "stopped pm pid(s): $($old -join ',')"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pmDir 'pm-autostart.ps1') -StartIfAbsent | Out-Null

$deadline = (Get-Date).AddSeconds(150)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  $new = @(Get-PmPids | Where-Object { $old -notcontains $_ })
  try { $h = Invoke-RestMethod 'http://127.0.0.1:4480/api/bridge/health' -TimeoutSec 3 } catch { $h = $null }
  if ($new.Count -and $h -and $h.ok -and $h.dispatch.last_tick_at) {
    Log "pm ready: new pid $($new -join ','), dispatcher tick $($h.dispatch.last_tick_at)"
    Log 'deploy PASS'
    exit 0
  }
}
Fail 'pm did not come back ready within 150s - see pm-data\autostart.log and server.log'
