# FIX-GATEKEEPER.ps1 - install the current PowerShell gatekeeper on this machine.
#
# One click (FIX-GATEKEEPER.cmd). For a machine whose shared brain is stale,
# dirty or diverged, so brain-sync `install` never delivered the gatekeeper
# that skips other machines' queue requests (Host: line, Test-OtherMachine).
#   1. git fetch the shared brain's origin (working tree untouched)
#   2. copy Gatekeeper.ps1 and queue-build.mjs from origin/main into the
#      gatekeeper folder, backing up the old copies
#   3. parse the origin queue with -CheckOnly and show how many requests
#      belong to other machines
#   4. stop any running monitor and start one on the new script
#
# Never pushes, never commits, never touches the brain's working tree.
# ASCII only: a .ps1 without a BOM is read as ANSI.

param(
    [string]$Brain = (Join-Path $env:USERPROFILE '.claude\shared-brain'),
    [string]$GatekeeperDir = (Join-Path $env:USERPROFILE 'Documents\Codex\2026-09-07\can-you-check-the-agent-history\outputs\gatekeeper'),
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
# git prints UTF-8; the queue headings carry an em dash the gatekeeper matches on.
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$files = @('Gatekeeper.ps1', 'queue-build.mjs')
$code = 0

function Good([string]$m) { Write-Host "  [ok]   $m" -ForegroundColor Green }
function Bad ([string]$m) { Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Say ([string]$m) { Write-Host "  $m" }

function Git([string[]]$argv) {
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $out = & git.exe -c "safe.directory=$($Brain.Replace('\','/'))" -C $Brain @argv 2>&1
        return [pscustomobject]@{ code = $LASTEXITCODE; out = (($out | Out-String).TrimEnd()) }
    } finally { $ErrorActionPreference = $saved }
}

Write-Host ''
Write-Host "  Fix the PowerShell gatekeeper on $env:COMPUTERNAME" -ForegroundColor Cyan
Write-Host ''
try {
    if (-not (Test-Path (Join-Path $Brain '.git'))) { throw "no shared brain checkout at $Brain" }

    Say '--- 1. fetch shared brain origin ---'
    $r = Git @('fetch', '--quiet', 'origin', 'main')
    if ($r.code -ne 0) { throw "git fetch exit $($r.code): $($r.out)" }
    $rev = (Git @('rev-parse', '--short=10', 'origin/main')).out
    Good "origin/main at $rev"

    Say '--- 2. install gatekeeper files ---'
    New-Item -ItemType Directory -Force -Path $GatekeeperDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $utf8 = New-Object Text.UTF8Encoding($false)
    foreach ($f in $files) {
        $r = Git @('show', "origin/main:.sync/gatekeeper/$f")
        if ($r.code -ne 0) { throw "origin/main has no .sync/gatekeeper/$f" }
        $text = $r.out + "`n"
        if ($f -eq 'Gatekeeper.ps1' -and $text -notmatch 'function Test-OtherMachine') { throw 'origin Gatekeeper.ps1 lacks Test-OtherMachine; refusing to install' }
        $dest = Join-Path $GatekeeperDir $f
        if (Test-Path $dest) {
            $old = [IO.File]::ReadAllText($dest)
            if (($old -replace "`r`n", "`n").TrimEnd() -eq ($text -replace "`r`n", "`n").TrimEnd()) { Good "$f already current"; continue }
            Copy-Item -LiteralPath $dest -Destination "$dest.bak-$stamp" -Force
            Say "backed up old $f to $f.bak-$stamp"
        }
        [IO.File]::WriteAllText($dest, $text, $utf8)
        Good "installed $f"
    }
    $gk = Join-Path $GatekeeperDir 'Gatekeeper.ps1'

    Say '--- 3. check the queue ---'
    $queue = Join-Path $env:TEMP "push-requests-origin-$stamp.md"
    $r = Git @('show', 'origin/main:push-requests.md')
    if ($r.code -ne 0) { throw 'origin/main has no push-requests.md' }
    [IO.File]::WriteAllText($queue, $r.out + "`n", $utf8)
    $check = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $gk -CheckOnly -QueuePath $queue 2>&1 | Out-String
    Remove-Item -LiteralPath $queue -Force -ErrorAction SilentlyContinue
    if ($check -notmatch 'Queue parsed successfully') { throw "gatekeeper -CheckOnly failed: $($check.Trim())" }
    Good $check.Trim()

    Say '--- 4. restart the monitor ---'
    $monitors = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '[\\/"]Gatekeeper\.ps1' -and $_.CommandLine -notmatch 'CheckOnly' })
    if ($NoRestart) { Say "restart skipped (-NoRestart); $($monitors.Count) monitor(s) running" }
    else {
        foreach ($m in $monitors) {
            Stop-Process -Id $m.ProcessId -Force -ErrorAction SilentlyContinue
            Good "stopped old monitor $($m.ProcessId)"
        }
        $p = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$gk`"")
        Start-Sleep -Seconds 3
        if ($p.HasExited) { throw "new monitor exited at once (code $($p.ExitCode))" }
        Good "monitor $($p.Id) running the new script"
    }
    Write-Host ''
    Good 'gatekeeper fixed: requests filed on other machines are now left alone'
} catch {
    Bad $_.Exception.Message
    $code = 1
}
Write-Host ''
if (-not $env:FIX_GATEKEEPER_NO_PAUSE) { Read-Host '  Press Enter to close' | Out-Null }
exit $code
