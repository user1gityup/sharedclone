# UPDATE-DSH.ps1 - bring this machine's DSH up to what the other machines run.
#
# One click (UPDATE-DSH.cmd). In order:
#   1. shared brain: commit local notes, fetch, merge, reinstall its tooling
#      (saved runs, sealed credentials, rules, the PowerShell gatekeeper), then
#      align Claude Code, Codex and Antigravity with the master (fleet.mjs apps)
#      -- this step also syncs sealed secrets (fleet/secrets/*.enc) via
#      brain-sync.mjs's own syncSecretFiles call; nothing plaintext ever
#      passes through this script
#   2. deepseek-harness: fetch, fast-forward only, reinstall packages when the
#      lockfile changed, rebuild when the code changed
#   2b. dsh-council-plugins: fetch, fast-forward only (no build; it ships
#      scripts + docs, not a package)
#   3. restart the gatekeeper monitor if it is running an older script
#   4. start DSH on the new build
#
# Never pushes, never commits harness work, never discards local changes: a
# dirty or diverged checkout stops the update and says which files. Step 2b
# is non-fatal: a dirty/diverged/missing plugins checkout is reported and
# skipped rather than aborting the DSH update.
#
# ASCII only: a .ps1 without a BOM is read as ANSI.

param(
    [string]$Repo,
    [string]$PluginsRepo,
    [switch]$NoBrain,
    [switch]$NoBuild,
    [switch]$NoLaunch,
    [int]$Port = 3080
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Good([string]$m) { Write-Host "  [ok]   $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Bad ([string]$m) { Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Say ([string]$m) { Write-Host "  $m" }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$logDir = if (Test-Path $dshHome) { $dshHome } else { $env:TEMP }
$log = Join-Path $logDir 'UPDATE-DSH-LOG.txt'
Start-Transcript -Path $log -Force | Out-Null
$exitCode = 0

function Finish([int]$code) {
    Stop-Transcript | Out-Null
    Write-Host ''
    Write-Host "  Log: $log"
    if (-not $env:UPDATE_DSH_NO_PAUSE) { Read-Host '  Press Enter to close' | Out-Null }
    exit $code
}

# Runs a native command and returns its real exit code; output goes to the console and transcript.
function Run([string]$exe, [string[]]$argv, [string]$cwd) {
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        Push-Location $cwd
        & $exe @argv 2>&1 | ForEach-Object { Write-Host "    $_" }
        return $LASTEXITCODE
    } finally { Pop-Location; $ErrorActionPreference = $saved }
}

function GitOut([string]$cwd, [string[]]$argv) {
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $out = & git.exe -C $cwd @argv 2>$null
        return [pscustomobject]@{ code = $LASTEXITCODE; out = (($out | Out-String).Trim()) }
    } finally { $ErrorActionPreference = $saved }
}

Write-Host ''
Write-Host '===============================================================' -ForegroundColor Cyan
Write-Host "  Update DSH on $env:COMPUTERNAME"                                  -ForegroundColor Cyan
Write-Host '===============================================================' -ForegroundColor Cyan

# --- 1. shared brain ---------------------------------------------------------
Write-Host ''
Say '--- 1. shared brain ---'
$brainSync = Join-Path $env:USERPROFILE '.claude\shared-brain\.sync\brain-sync.mjs'
if ($NoBrain) { Say 'skipped (-NoBrain)' }
elseif (-not (Test-Path $brainSync)) { Warn 'no shared brain on this machine; skipped' }
else {
    $c = Run 'node' @($brainSync, 'start', '--timeout', '20000') $env:USERPROFILE
    if ($c -eq 0) { Good 'brain synced' } else { Warn "brain sync exit $c (DSH update continues)" }
    $c = Run 'node' @($brainSync, 'install') $env:USERPROFILE
    if ($c -eq 0) { Good 'brain tooling installed' } else { Warn "brain install exit $c" }
    # Claude Code, Codex and Antigravity: the master records its versions and settings, the others align.
    $fleet = Join-Path (Split-Path $brainSync) 'fleet.mjs'
    $c = Run 'node' @($fleet, 'apps') $env:USERPROFILE
    if ($c -eq 0) { Good 'apps aligned with the master' } else { Warn "apps sync exit $c" }
}

# --- 2. deepseek-harness -----------------------------------------------------
Write-Host ''
Say '--- 2. deepseek-harness ---'
if (-not $Repo) {
    $Repo = Join-Path $env:USERPROFILE 'Documents\claudecode\deepseek-harness'
    $launch = Join-Path $dshHome 'launch-dsh.cmd'
    if (Test-Path $launch) {
        $cd = Select-String -LiteralPath $launch -Pattern '^cd /d "(.+)"' | Select-Object -First 1
        if ($cd) { $Repo = $cd.Matches[0].Groups[1].Value }
    }
}
Say "checkout: $Repo"
if (-not (Test-Path (Join-Path $Repo '.git'))) { Bad 'not a git checkout'; Finish 1 }

$branch = (GitOut $Repo @('branch', '--show-current')).out
$upstream = GitOut $Repo @('rev-parse', '--abbrev-ref', '@{upstream}')
if (-not $branch -or $upstream.code -ne 0) { Bad "branch '$branch' has no upstream to update from"; Finish 1 }
Say "branch: $branch (tracks $($upstream.out))"

$dirty = (GitOut $Repo @('status', '--porcelain', '--untracked-files=no')).out
if ($dirty) {
    Bad 'the checkout has uncommitted changes; nothing was touched:'
    $dirty -split "`r?`n" | Select-Object -First 20 | ForEach-Object { Say "    $_" }
    Finish 1
}

$c = Run 'git.exe' @('-C', $Repo, 'fetch', '--quiet', ($upstream.out -split '/')[0]) $Repo
if ($c -ne 0) { Bad "git fetch exit $c - cannot reach the remote"; Finish 1 }
$counts = ((GitOut $Repo @('rev-list', '--left-right', '--count', '@{upstream}...HEAD')).out -split '\s+')
$behind = [int]$counts[0]; $ahead = [int]$counts[1]
$before = (GitOut $Repo @('rev-parse', 'HEAD')).out
Say "behind $behind, ahead $ahead, at $($before.Substring(0,10))"

$changed = $false
if ($behind -gt 0 -and $ahead -gt 0) {
    Bad 'this checkout and the remote have diverged; it needs a merge by an agent. Nothing was touched.'
    Finish 1
} elseif ($behind -gt 0) {
    $c = Run 'git.exe' @('-C', $Repo, 'merge', '--ff-only', '@{upstream}') $Repo
    if ($c -ne 0) { Bad "fast-forward failed (exit $c)"; Finish 1 }
    $after = (GitOut $Repo @('rev-parse', 'HEAD')).out
    Good "updated $($before.Substring(0,10)) -> $($after.Substring(0,10))"
    (GitOut $Repo @('log', '--format=%h %s', "$before..$after")).out -split "`r?`n" | ForEach-Object { Say "    $_" }
    $changed = $true
    $lockChanged = (GitOut $Repo @('diff', '--name-only', $before, $after, '--', 'pnpm-lock.yaml')).out
} else {
    Good 'already at the remote'
}

if ($changed -and -not $NoBuild) {
    $pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $pnpm) { Bad 'pnpm.cmd not found on PATH; cannot build'; Finish 1 }
    if ($lockChanged) {
        Say 'pnpm-lock.yaml changed: pnpm install --frozen-lockfile'
        $c = Run $pnpm @('install', '--frozen-lockfile') $Repo
        if ($c -ne 0) { Bad "pnpm install exit $c"; Finish 1 }
        Good 'packages installed'
    }
    Say 'pnpm run build (several minutes; quiet stretches are normal)'
    $c = Run $pnpm @('run', 'build') $Repo
    if ($c -ne 0) { Bad "pnpm run build exit $c - DSH was not restarted onto a broken build"; Finish 1 }
    Good 'build exit 0'
    # The launcher's fleet build step compares HEAD with this marker; a fresh build here is current.
    try {
        New-Item -ItemType Directory -Force -Path $dshHome | Out-Null
        [IO.File]::WriteAllText((Join-Path $dshHome '.built-commit'), "$((GitOut $Repo @('rev-parse', 'HEAD')).out)`n")
    } catch { Warn "could not record the built commit: $($_.Exception.Message)" }
} elseif ($changed) { Say 'build skipped (-NoBuild)' }

# --- 3. gatekeeper monitor ---------------------------------------------------
Write-Host ''
Say '--- 3. gatekeeper monitor ---'
$gkScript = Join-Path $env:USERPROFILE 'Documents\Codex\2026-09-07\can-you-check-the-agent-history\outputs\gatekeeper\Gatekeeper.ps1'
$monitors = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'Gatekeeper\.ps1' -and $_.CommandLine -notmatch 'CheckOnly' })
if (-not (Test-Path $gkScript)) { Say 'no PowerShell gatekeeper on this machine' }
elseif ($monitors.Count -eq 0) { Say 'monitor not running; the watcher starts it with the next agent' }
else {
    $written = (Get-Item $gkScript).LastWriteTime
    foreach ($m in $monitors) {
        if ($m.CreationDate -lt $written) {
            Stop-Process -Id $m.ProcessId -Force -ErrorAction SilentlyContinue
            Good "stopped monitor $($m.ProcessId) (older than Gatekeeper.ps1); the watcher restarts it when DSH starts"
        } else { Good "monitor $($m.ProcessId) already runs the current script" }
    }
}

# --- 4. DSH ------------------------------------------------------------------
Write-Host ''
Say '--- 4. DSH ---'
function Test-Listening { [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) }
$launcher = Join-Path $dshHome 'launch-dsh.cmd'
if ($NoLaunch) { Say 'launch skipped (-NoLaunch)' }
elseif (-not (Test-Path $launcher)) { Warn "no launcher at $launcher" }
else {
    if (Test-Listening) {
        if (-not $changed) { Good "DSH already running on port $Port and nothing changed"; Finish 0 }
        Warn "DSH is running the old build on port $Port."
        Write-Host '  Close the DSH window. This continues on its own once it has stopped.' -ForegroundColor Yellow
        while (Test-Listening) { Start-Sleep -Seconds 2 }
        Good 'DSH stopped'
    }
    Start-Process -FilePath $launcher -WorkingDirectory $dshHome
    $deadline = (Get-Date).AddMinutes(3)
    while (-not (Test-Listening) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
    if (Test-Listening) { Good "DSH is up on port $Port" } else { Bad "DSH did not start listening on port $Port within 3 minutes - see its window"; $exitCode = 1 }
}

Write-Host ''
$final = (GitOut $Repo @('rev-parse', '--short=10', 'HEAD')).out
Say "harness now at $final on $branch"
Finish $exitCode
