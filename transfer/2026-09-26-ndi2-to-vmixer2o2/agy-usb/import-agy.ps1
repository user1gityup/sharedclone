# Loads the Antigravity seat pool that export-agy.ps1 wrote to this USB drive into this
# machine's ~/.dsh/antigravity. Never overwrites a seat that is already signed in here;
# backs up the registry and any replaced unsigned profile first. Written by Claude Opus 5.5,
# 2026-09-26.
#
#   -Source <DSH-AGY-TRANSFER folder>   default: the folder this script sits in
#   -TargetRoot <antigravity root>      default: ~/.dsh/antigravity (override used for testing)
param([string]$Source, [string]$TargetRoot)

$ErrorActionPreference = 'Stop'
if (-not $Source) { $Source = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $TargetRoot) { $TargetRoot = Join-Path $HOME '.dsh\antigravity' }
$tokenRel = '.gemini\jetski-standalone-oauth-token'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Fail([string]$msg) { Write-Host ""; Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }
function Hash([string]$path) { if (Test-Path $path) { (Get-FileHash $path -Algorithm SHA256).Hash } else { $null } }

$manifestPath = Join-Path $Source 'manifest.json'
if (-not (Test-Path $manifestPath)) { Fail "no manifest.json in $Source - run AGY-EXPORT-TO-USB.cmd on ndi2 first" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
Write-Host "Antigravity seats from $($manifest.exportedFrom) ($($manifest.exportedAt))  ->  $TargetRoot"

# The drive must hold exactly what the export wrote before anything here is touched.
foreach ($s in @($manifest.seats)) {
  if (-not (Test-Path (Join-Path $Source "profiles\$($s.id)"))) { Fail "profile $($s.id) is missing on the drive" }
  if ($s.signedIn -and (Hash (Join-Path $Source "profiles\$($s.id)\$tokenRel")) -ne $s.tokenSha256) { Fail "token for $($s.id) on the drive is damaged; export again" }
}

$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'language_server*' })
if ($running.Count) { Write-Host "Note: $($running.Count) Antigravity server(s) running here; seats already signed in are not touched." }

New-Item -ItemType Directory -Force (Join-Path $TargetRoot 'profiles') | Out-Null
$regPath = Join-Path $TargetRoot 'accounts.json'
$seats = New-Object System.Collections.ArrayList
if (Test-Path $regPath) {
  Copy-Item $regPath "$regPath.pre-usb-import-$stamp"
  $text = [IO.File]::ReadAllText($regPath).TrimStart([char]0xFEFF)
  foreach ($e in @(($text | ConvertFrom-Json).seats)) {
    $h = [ordered]@{}
    foreach ($p in $e.PSObject.Properties) { $h[$p.Name] = $p.Value }
    [void]$seats.Add($h)
  }
}

$imported = 0
foreach ($s in @($manifest.seats)) {
  $dir = Join-Path $TargetRoot "profiles\$($s.id)"
  $existing = $seats | Where-Object { $_.id -eq $s.id } | Select-Object -First 1
  $existingDir = if ($existing -and $existing.geminiDir) { $existing.geminiDir } else { $dir }
  $here = Hash (Join-Path $existingDir $tokenRel)
  if ($here -and $here -eq $s.tokenSha256) { Write-Host "  $($s.id): already here, same account"; continue }
  if ($here) { Write-Host "  $($s.id): this machine already has its own signed-in $($s.id); left as is" -ForegroundColor Yellow; continue }
  # An unsigned seat replacing one already registered here gains nothing, and a re-run would pile up backups.
  if (-not $s.signedIn -and $existing) { Write-Host "  $($s.id): not signed in on either machine, already registered here; left as is"; continue }

  if (Test-Path $dir) { Rename-Item $dir "$($s.id).pre-usb-import-$stamp" }
  robocopy (Join-Path $Source "profiles\$($s.id)") $dir /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "copy of $($s.id) failed (robocopy $LASTEXITCODE)" }
  if ($s.signedIn -and (Hash (Join-Path $dir $tokenRel)) -ne $s.tokenSha256) { Fail "token for $($s.id) did not copy intact" }

  $entry = [ordered]@{ id = $s.id; label = $s.label; geminiDir = $dir; addedAt = $s.addedAt; importedFrom = $manifest.exportedFrom; importedAt = (Get-Date).ToString('o') }
  if ($existing) { $seats[$seats.IndexOf($existing)] = $entry } else { [void]$seats.Add($entry) }
  $imported++
  Write-Host ("  {0,-6} imported ({1})" -f $s.id, $(if ($s.signedIn) { 'signed in' } else { 'NOT signed in on ndi2 either' }))
}

[IO.File]::WriteAllText($regPath, (([ordered]@{ seats = @($seats) }) | ConvertTo-Json -Depth 6), $utf8)
$check = ([IO.File]::ReadAllText($regPath) | ConvertFrom-Json).seats
foreach ($s in @($manifest.seats)) { if (-not ($check | Where-Object { $_.id -eq $s.id })) { Fail "registry is missing $($s.id) after writing" } }

$agy = Join-Path $HOME '.dsh\bin\agy-profile.mjs'
if ((Test-Path $agy) -and (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""; Write-Host "Seat list as DSH reads it:"
  $env:DSH_ANTIGRAVITY_ROOT = $TargetRoot
  node $agy list
}
Write-Host ""
Write-Host "DONE: $imported seat(s) imported, registry backed up beside it." -ForegroundColor Green
exit 0
