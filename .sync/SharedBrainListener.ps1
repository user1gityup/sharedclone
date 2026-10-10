param([int]$IntervalSeconds = 20)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'
$mutex = New-Object Threading.Mutex($false, 'Local\SharedBrainContinuousSync')
$owns = $false
try {
    try { $owns = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owns = $true }
    if (-not $owns) { exit 0 }
    $brain = Join-Path $env:USERPROFILE '.claude\shared-brain'
    $sync = Join-Path $brain '.sync\brain-sync.mjs'
    while ($true) {
        if (Test-Path -LiteralPath $sync) {
            & node $sync cycle --dir $brain --timeout 120000 *> (Join-Path $brain '.sync-state\listener-last.log')
        }
        Start-Sleep -Seconds ([Math]::Max(10, $IntervalSeconds))
    }
} finally {
    if ($owns) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
