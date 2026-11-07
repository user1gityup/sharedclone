param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('start', 'stop', 'status', 'restart', 'owner')]
  [string]$Action,
  [int]$OwnerPid = 0,
  [string]$OwnerStarted = ''
)
$ErrorActionPreference = 'Stop'
# Shipped to every host by brain-sync (.sync/dsh), so no path here names one machine.
$FccDir = if ($env:FCC_DIR) { $env:FCC_DIR } else { Join-Path $env:USERPROFILE 'Documents\claudecode\free-claude-code' }
# /v1/models builds the model catalog lazily on its first call (measured cold: ~2.6s).
# A 2s probe aborted that build every time, so the catalog probe waits for it.
# A dead server still fails at once: the TCP connect is refused.
$CatalogTimeoutSec = 20
if ($env:FCC_CATALOG_TIMEOUT_SEC -match '^\d+$' -and [int]$env:FCC_CATALOG_TIMEOUT_SEC -gt 0) { $CatalogTimeoutSec = [int]$env:FCC_CATALOG_TIMEOUT_SEC }
$StartupDeadlineSec = 90
$MarkerPath = Join-Path $PSScriptRoot 'fcc-owned.json'
$LogPath = Join-Path $PSScriptRoot 'fcc-monitor.log'

function Write-Status([string]$Message) {
  Write-Output $Message
  Add-Content -LiteralPath $LogPath -Value "$([DateTime]::UtcNow.ToString('o')) $Message"
}
function Test-Ready {
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:8082/health' -TimeoutSec 2
    if ($health.status -ne 'healthy') { return $false }
    $models = Invoke-RestMethod 'http://127.0.0.1:8082/v1/models' -TimeoutSec $CatalogTimeoutSec
    return ($models.object -eq 'list' -and $null -ne $models.data -and @($models.data).Count -gt 0)
  } catch { return $false }
}
function Test-Port {
  $client = New-Object Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', 8082); return $true }
  catch { return $false }
  finally { $client.Dispose() }
}
function Stop-Owned {
  if (-not (Test-Path -LiteralPath $MarkerPath)) { return }
  $record = Get-Content -LiteralPath $MarkerPath -Raw | ConvertFrom-Json
  $ownedProcess = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
  if ($ownedProcess) {
    # Never kill a reused PID or a server started by somebody else.
    if ($ownedProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $record.started) {
      throw 'FCC ownership does not match the live process; refusing to stop it.'
    }
    & taskkill.exe /PID $record.pid /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the owned FCC process tree.' }
  }
  Remove-Item -LiteralPath $MarkerPath
}
function Start-Fcc {
  if (Test-Ready) { Write-Status 'Free Claude ready (health and model catalog verified).'; return $true }
  if (Test-Port) {
    Write-Status 'Free Claude unavailable: port 8082 is occupied but readiness failed. See fcc-server.stderr.log.'
    return $false
  }
  Stop-Owned
  $python = Join-Path $FccDir '.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $python)) { throw "FCC Python environment is missing: $python" }
  $env:FCC_OPEN_BROWSER = 'false'
  Write-Status "Starting Free Claude hidden; waiting up to $StartupDeadlineSec seconds for readiness."
  $child = Start-Process -FilePath $python -ArgumentList '-c', '"from free_claude_code.cli.entrypoints import serve; serve()"' -WorkingDirectory $FccDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'fcc-server.stdout.log') -RedirectStandardError (Join-Path $PSScriptRoot 'fcc-server.stderr.log')
  @{pid=$child.Id; started=$child.StartTime.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json | Set-Content -LiteralPath $MarkerPath
  $deadline = [DateTime]::UtcNow.AddSeconds($StartupDeadlineSec)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Ready) { Write-Status 'Free Claude ready (health and model catalog verified).'; return $true }
    if ($child.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  Stop-Owned
  Write-Status 'Free Claude unavailable: startup failed. See fcc-server.stderr.log and fcc-server.stdout.log.'
  return $false
}

if ($Action -eq 'owner') {
  $ownerProcess = Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue
  if ($ownerProcess -and $ownerProcess.StartTime.ToUniversalTime().Ticks.ToString() -eq $OwnerStarted) { exit 0 }
  exit 1
}
if ($Action -eq 'status') {
  if (Test-Ready) { Write-Output 'Free Claude ready (health and model catalog verified).'; exit 0 }
  Write-Output 'Free Claude unavailable.'
  exit 1
}
# Serialize starts/recovery/stop across launcher invocations.
$mutex = New-Object Threading.Mutex($false, 'Local\DSH-FreeClaude-Control')
$locked = $false
try {
  try { $locked = $mutex.WaitOne(($StartupDeadlineSec + $CatalogTimeoutSec + 5) * 1000) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Another FCC controller is busy.' }
  if ($Action -eq 'stop') { Stop-Owned; exit 0 }
  if ($Action -eq 'restart') {
    if (Test-Ready) { exit 0 }
    Stop-Owned
  }
  # Capture only the final boolean; emit status messages separately.
  $result = @(Start-Fcc)
  $result | Select-Object -SkipLast 1 | ForEach-Object { Write-Output $_ }
  if ($result[-1] -eq $true) { exit 0 }
  exit 1
} catch {
  Write-Status "Free Claude unavailable: $($_.Exception.Message)"
  exit 1
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
