# EXPORT-HISTORY.ps1 - put this machine's local-only agent history into the shared brain.
#
# One click (EXPORT-HISTORY.cmd). In order:
#   1. shared brain: commit local notes, fetch, merge (brain-sync start; never pushes)
#   2. export-history.mjs: history/<host>/ and system/<host>/, redacted, then scanned
#   3. commit "brain: <host> history export" with the brain's hooks on
#   4. verify the committed tree the way the pre-push gate does
#
# Never pushes. A scan hit or a failed check undoes the export and the commit.
#
# ASCII only: a .ps1 without a BOM is read as ANSI.

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Good([string]$m) { Write-Host "  [ok]   $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Bad ([string]$m) { Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Say ([string]$m) { Write-Host "  $m" }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$logDir = if (Test-Path $dshHome) { $dshHome } else { $env:TEMP }
$log = Join-Path $logDir 'EXPORT-HISTORY-LOG.txt'
Start-Transcript -Path $log -Force | Out-Null

function Finish([int]$code) {
    Stop-Transcript | Out-Null
    Write-Host ''
    Write-Host "  Log: $log"
    if (-not $env:EXPORT_HISTORY_NO_PAUSE) { Read-Host '  Press Enter to close' | Out-Null }
    exit $code
}

function Run([string]$exe, [string[]]$argv, [string]$cwd) {
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        Push-Location $cwd
        & $exe @argv 2>&1 | ForEach-Object { Write-Host "    $_" }
        return $LASTEXITCODE
    } finally { Pop-Location; $ErrorActionPreference = $saved }
}

function Capture([string]$exe, [string[]]$argv, [string]$cwd) {
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        Push-Location $cwd
        $out = & $exe @argv 2>$null
        return [pscustomobject]@{ code = $LASTEXITCODE; out = (($out | Out-String).Trim()) }
    } finally { Pop-Location; $ErrorActionPreference = $saved }
}

$brain = Join-Path $env:USERPROFILE '.claude\shared-brain'
$sync = Join-Path $brain '.sync\brain-sync.mjs'
$exporter = Join-Path $brain '.sync\export-history.mjs'
$hostName = $env:COMPUTERNAME.ToLower()

# A brain folder created by another Windows account (a restored clone) makes git refuse it
# as "dubious ownership". Trust this one repository for this process only, like the
# gatekeeper does; git and brain-sync.mjs inherit it. No global config is written.
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'safe.directory'
$env:GIT_CONFIG_VALUE_0 = $brain -replace '\\', '/'

# Put history/ and system/ back to the last commit; used on every failure after the export.
function Restore {
    [void](Capture 'git.exe' @('restore', '--staged', '--worktree', '--source=HEAD', '--', 'history', 'system') $brain)
    [void](Capture 'git.exe' @('clean', '-fdq', '--', 'history', 'system') $brain)
}

Write-Host ''
Write-Host '===============================================================' -ForegroundColor Cyan
Write-Host "  Export agent history from $env:COMPUTERNAME"                     -ForegroundColor Cyan
Write-Host '===============================================================' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Bad 'node is not on PATH'; Finish 1 }
if (-not (Test-Path (Join-Path $brain '.git'))) { Bad "no shared brain at $brain"; Finish 1 }
if (-not (Test-Path $exporter)) { Bad "exporter missing: $exporter"; Finish 1 }
$probe = Capture 'git.exe' @('rev-parse', '--verify', 'HEAD') $brain
if ($probe.code -ne 0) { Bad "git cannot read the brain at $brain (exit $($probe.code)) as $env:USERNAME"; Finish 1 }
Say "account: $env:USERNAME, brain: $brain"

# --- 1. sync -----------------------------------------------------------------
Write-Host ''
Say '--- 1. sync the brain ---'
$r = Capture 'node' @($sync, 'start', '--timeout', '20000') $env:USERPROFILE
if ($r.code -ne 0) { Bad "brain-sync start exit $($r.code)"; Finish 1 }
try { $state = $r.out | ConvertFrom-Json } catch { Bad "brain-sync start printed no JSON: $($r.out)"; Finish 1 }
if ($state.result -eq 'busy') { Bad 'another brain sync holds the lock; run this again in a minute'; Finish 1 }
if (@($state.conflicts).Count -gt 0) {
    Bad 'the merge from GitHub left conflicts; an agent must resolve them first:'
    @($state.conflicts) | ForEach-Object { Say "    $_" }
    Finish 1
}
if ($state.result -eq 'offline') { Warn "GitHub unreachable ($($state.reason)); exporting on the local brain" }
else { Good "brain sync: $($state.result)" }
$st = Capture 'git.exe' @('status', '--porcelain') $brain
if ($st.code -ne 0) { Bad "git status exit $($st.code)"; Finish 1 }
$dirty = $st.out
if ($dirty) {
    Bad 'the brain still has uncommitted changes after the sync; nothing exported:'
    $dirty -split "`r?`n" | Select-Object -First 20 | ForEach-Object { Say "    $_" }
    Finish 1
}

# --- 2. export ---------------------------------------------------------------
Write-Host ''
Say '--- 2. export and scan ---'
$c = Run 'node' @($exporter, $brain) $brain
if ($c -eq 2) { Restore; Bad 'the scan found a credential, key, e-mail or home path; export undone'; Finish 1 }
if ($c -ne 0) { Restore; Bad "exporter exit $c; export undone"; Finish 1 }
Good 'export written, scan clean'

# --- 3. commit ---------------------------------------------------------------
Write-Host ''
Say '--- 3. commit ---'
$add = Capture 'git.exe' @('add', '-A', '--', 'history', 'system') $brain
if ($add.code -ne 0) { Restore; Bad "git add exit $($add.code); export undone"; Finish 1 }
$diff = Capture 'git.exe' @('diff', '--cached', '--name-only') $brain
if ($diff.code -ne 0) { Restore; Bad "git diff exit $($diff.code); export undone"; Finish 1 }
$staged = $diff.out
if (-not $staged) { Good 'nothing changed since the last export' }
else {
    $n = @($staged -split "`r?`n").Count
    $c = Run 'git.exe' @('commit', '--quiet', '-m', "brain: $hostName history export") $brain
    if ($c -ne 0) { Restore; Bad "git commit exit $c; export undone"; Finish 1 }
    Good "committed $n files"

    # --- 4. verify -----------------------------------------------------------
    Write-Host ''
    Say '--- 4. verify the commit ---'
    # Prints one problem per line; exit 0 only when there are none.
    $js = "const u=await import('node:url');const m=await import(u.pathToFileURL(process.argv[2]).href);const p=m.verifyPublish(process.argv[1],'HEAD');p.forEach(x=>console.log(x));process.exit(p.length?3:0)"
    $v = Capture 'node' @('--input-type=module', '-e', $js, $brain, $sync) $brain
    if ($v.code -ne 0) {
        [void](Capture 'git.exe' @('reset', '--mixed', '--quiet', 'HEAD~1') $brain)
        Restore
        Bad "the publish check refused the commit (exit $($v.code)); commit and export undone:"
        $v.out -split "`r?`n" | Select-Object -First 20 | ForEach-Object { Say "    $_" }
        Finish 1
    }
    Good 'publish check clean'
}

Write-Host ''
$head = (Capture 'git.exe' @('rev-parse', '--short=10', 'HEAD') $brain).out
$ahead = (Capture 'git.exe' @('rev-list', '--count', 'origin/main..HEAD') $brain).out
Say "brain at $head, $ahead commits not yet on GitHub (this script never pushes)"
Finish 0
