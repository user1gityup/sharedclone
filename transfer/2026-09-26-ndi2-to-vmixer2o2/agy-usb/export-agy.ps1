# Copies this machine's Antigravity seat pool (profiles + registry) to a USB drive, for
# AGY-IMPORT-FROM-USB.cmd to load on vmixer2o2. Tokens go to the drive only: never the
# network, never the shared brain. Written by Claude Opus 5.5, 2026-09-26.
#
#   -Target <drive root or folder>   skip USB detection (used for testing)
param([string]$Target)

$ErrorActionPreference = 'Stop'
$src = Join-Path $HOME '.dsh\antigravity'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Fail([string]$msg) { Write-Host ""; Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }

function Find-UsbRoot {
  $letters = @()
  $letters += Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object { $_.DeviceID }
  try {
    $letters += Get-Disk -ErrorAction Stop | Where-Object { $_.BusType -eq 'USB' } |
      Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object { "$($_.DriveLetter):" }
  } catch { }
  $letters = @($letters | Where-Object { $_ -and $_ -ne $env:SystemDrive } | Sort-Object -Unique)
  if ($letters.Count -eq 0) { Fail 'No USB drive found. Plug the drive in and double-click again.' }
  if ($letters.Count -gt 1) {
    $marked = @($letters | Where-Object { Test-Path "$_\DSH-AGY-TRANSFER" })
    if ($marked.Count -eq 1) { return "$($marked[0])\" }
    Fail "More than one USB drive is plugged in ($($letters -join ', ')). Leave only the one to use."
  }
  return "$($letters[0])\"
}

if (-not (Test-Path (Join-Path $src 'accounts.json'))) { Fail "No Antigravity seat registry at $src\accounts.json" }
$root = if ($Target) { $Target } else { Find-UsbRoot }
if (-not (Test-Path $root)) { New-Item -ItemType Directory -Force $root | Out-Null }
$root = (Resolve-Path -LiteralPath $root).ProviderPath
$dest = Join-Path $root 'DSH-AGY-TRANSFER'
New-Item -ItemType Directory -Force (Join-Path $dest 'profiles') | Out-Null
Write-Host "Antigravity seats: $src  ->  $dest"

$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'language_server*' })
if ($running.Count) { Write-Host "Note: $($running.Count) Antigravity server(s) running; open files are retried, then skipped." }

$registry = Get-Content (Join-Path $src 'accounts.json') -Raw | ConvertFrom-Json
$manifest = @()
foreach ($seat in @($registry.seats)) {
  $from = Join-Path $src "profiles\$($seat.id)"
  if (-not (Test-Path $from)) { Write-Host "  $($seat.id): no profile folder, skipped"; continue }
  $to = Join-Path $dest "profiles\$($seat.id)"
  # daemon\ holds discovery files naming a pid on this machine; they mean nothing elsewhere.
  robocopy $from $to /MIR /XD daemon /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "copy of $($seat.id) failed (robocopy $LASTEXITCODE)" }
  $tokenRel = '.gemini\jetski-standalone-oauth-token'
  $srcTok = Join-Path $from $tokenRel
  $dstTok = Join-Path $to $tokenRel
  $hash = $null
  if (Test-Path $srcTok) {
    # The running seat daemon rewrites its token about hourly, so a rewrite can land mid-copy: re-copy and re-check.
    $ok = $false
    for ($try = 0; $try -lt 3 -and -not $ok; $try++) {
      if ($try -gt 0) { Start-Sleep -Seconds 2; Copy-Item -LiteralPath $srcTok -Destination $dstTok -Force }
      $hash = (Get-FileHash $srcTok -Algorithm SHA256).Hash
      $ok = (Test-Path $dstTok) -and (Get-FileHash $dstTok -Algorithm SHA256).Hash -eq $hash
    }
    if (-not $ok) { Fail "token for $($seat.id) did not copy intact" }
  }
  # \\?\ because profile trees nest past MAX_PATH under a deep target; robocopy copes, Get-ChildItem does not.
  $files = @(Get-ChildItem -LiteralPath "\\?\$to" -Recurse -File -Force)
  $manifest += [pscustomobject]@{
    id = $seat.id; label = $seat.label; addedAt = $seat.addedAt
    signedIn = [bool]$hash; tokenSha256 = $hash
    files = $files.Count; bytes = ($files | Measure-Object Length -Sum).Sum
  }
  Write-Host ("  {0,-6} {1,-14} {2,5} files" -f $seat.id, $(if ($hash) { 'signed in' } else { 'NOT signed in' }), $files.Count)
}
if (-not $manifest.Count) { Fail 'no seat profiles were copied' }

$utf8 = New-Object System.Text.UTF8Encoding $false
$doc = [pscustomobject]@{ exportedFrom = $env:COMPUTERNAME; exportedAt = (Get-Date).ToString('o'); seats = @($manifest) }
[IO.File]::WriteAllText((Join-Path $dest 'manifest.json'), ($doc | ConvertTo-Json -Depth 5), $utf8)

Copy-Item (Join-Path $here 'import-agy.ps1') (Join-Path $dest 'import-agy.ps1') -Force
Copy-Item (Join-Path $here 'AGY-IMPORT-FROM-USB.cmd') (Join-Path $root 'AGY-IMPORT-FROM-USB.cmd') -Force

$signed = @($manifest | Where-Object signedIn).Count
Write-Host ""
Write-Host "DONE: $($manifest.Count) seats on the drive ($signed signed in)." -ForegroundColor Green
Write-Host "Eject the drive, plug it into vmixer2o2, double-click AGY-IMPORT-FROM-USB.cmd on it."
exit 0
