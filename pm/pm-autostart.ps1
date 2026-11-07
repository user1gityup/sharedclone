# pm autostart + watchdog + ChatGPT check-in.
# Started at logon from the Startup folder (Shared-Agent-Listeners.cmd).
#  - Keeps the pm server up: starts it in LAN mode (PM_HOST=0.0.0.0, PM_TOKEN
#    from ~/.claude/pm-remote.env) whenever /api/bridge/health stops answering;
#    falls back to loopback mode if the env file has no token.
#  - A (re)start only counts as successful once readiness holds: health ok:true
#    AND a dispatcher tick inside the last 10s (CONTRACTS.md C7). Repeated
#    restart attempts back off 5s, 10s, 20s ... capped at 10 minutes, and the
#    backoff resets to 5s once a restart reaches readiness.
#  - Checks in on bridge messages addressed to claude-code (from ChatGPT or any
#    other agent) via the read-only list route, so nothing is marked delivered
#    or acked. New ones go to pm-data\chatgpt-inbox.log and a tray notification.
# One instance per machine (named mutex Global\pm-autostart-watchdog). -StartIfAbsent
# is the same mutex, checked non-blocking: a held mutex means a watchdog is
# already running and this exits without starting a second one; an unheld mutex
# means none is running, so it launches one detached and exits (used by the
# Gatekeeper start step to ensure the supervisor is up without ever duplicating it).
# Log: pm-data\autostart.log.
param([int]$IntervalSeconds = 60, [switch]$Once, [switch]$StartIfAbsent)

$ErrorActionPreference = 'Continue'
$pmDir   = $PSScriptRoot
# A boot-time S4U task runs before the user logs on, so no profile is loaded and
# USERPROFILE falls back to C:\Users\Default; pm (node homedir()) would then serve an
# empty db there. Pin the real profile from ProfileList by the token's user SID.
try {
  $sidStr = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $realProfile = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sidStr" -ErrorAction Stop).ProfileImagePath
  if ($realProfile -and (Test-Path $realProfile) -and $env:USERPROFILE -ne $realProfile) {
    $env:USERPROFILE = $realProfile
    $env:HOME = $realProfile
    $env:HOMEDRIVE = Split-Path $realProfile -Qualifier
    $env:HOMEPATH = $realProfile.Substring($env:HOMEDRIVE.Length)
  }
} catch {}
$dataDir = Join-Path $env:USERPROFILE '.claude\pm-data'
$envFile = Join-Path $env:USERPROFILE '.claude\pm-remote.env'
$logFile = Join-Path $dataDir 'autostart.log'
$inboxLog = Join-Path $dataDir 'chatgpt-inbox.log'
$stateFile = Join-Path $dataDir 'chatgpt-checkin.json'
$base = 'http://127.0.0.1:4480'
# Global, not Local: the boot task runs in session 0 and the logon Startup entry in
# the user's session; a Local mutex would let both run a watchdog.
$mutexName = 'Global\pm-autostart-watchdog'
$minBackoffSeconds = 5
$maxBackoffSeconds = 600
New-Item -ItemType Directory -Force $dataDir | Out-Null

function Log($msg) { Add-Content -Path $logFile -Value ("{0:u} {1}" -f (Get-Date), $msg) -Encoding utf8 }

# The session-0 boot task (S4U token) and the session-1 logon instance are the same
# user with different logon SIDs; the default DACL would lock one out of the other's
# mutex. Grant the user SID explicitly. If the mutex still cannot be opened, another
# watchdog owns it: callers treat $null as "held" (fail closed, never a duplicate).
function Open-WatchdogMutex {
  try {
    $sec = New-Object System.Security.AccessControl.MutexSecurity
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $sec.AddAccessRule((New-Object System.Security.AccessControl.MutexAccessRule($sid, 'FullControl', 'Allow')))
    $created = $false
    return New-Object System.Threading.Mutex($false, $mutexName, [ref]$created, $sec)
  } catch { return $null }
}

# WaitOne(0) on a mutex whose holder died throws AbandonedMutexException; that still means we own it now.
function Enter-WatchdogMutex($m) {
  if (-not $m) { return $false }
  try { return $m.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { return $true } catch { return $false }
}

if ($StartIfAbsent) {
  $probe = Open-WatchdogMutex
  if (Enter-WatchdogMutex $probe) {
    $probe.ReleaseMutex()
    $probe.Dispose()
    $self = if ($PSCommandPath) { $PSCommandPath } else { Join-Path $pmDir 'pm-autostart.ps1' }
    Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' `
      -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$self`"", '-IntervalSeconds', $IntervalSeconds
    Log "start-if-absent: mutex was free - launched a new watchdog"
  } else {
    if ($probe) { $probe.Dispose() }
    Log "start-if-absent: mutex already held - watchdog is already running, no action"
  }
  exit 0
}

$mutex = Open-WatchdogMutex
if (-not $Once -and -not (Enter-WatchdogMutex $mutex)) { exit 0 }

function Get-Health {
  try { Invoke-RestMethod "$base/api/bridge/health" -TimeoutSec 3 } catch { $null }
}

# C7 dispatcher-tick: health.dispatch.last_tick_at (set by dispatch.mjs on every
# tick that actually runs, at least every ~2s while the worker loop is alive).
# "Within 10s" means that timestamp is no more than 10s old relative to now.
function Test-DispatcherTick($health) {
  if (-not $health -or -not $health.dispatch -or -not $health.dispatch.last_tick_at) { return $false }
  try { $tickAt = [datetime]$health.dispatch.last_tick_at } catch { return $false }
  $ageSeconds = ((Get-Date).ToUniversalTime() - $tickAt.ToUniversalTime()).TotalSeconds
  return $ageSeconds -ge -10 -and $ageSeconds -le 10
}

function Test-Ready($health) {
  return [bool]($health -and $health.ok -and (Test-DispatcherTick $health))
}

function Start-Pm {
  $token = $null
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) { if ($line -match '^\s*PM_TOKEN\s*=\s*(.+)$') { $token = $Matches[1].Trim() } }
  }
  $server = Join-Path $pmDir 'server.mjs'
  $out = Join-Path $dataDir 'server.log'
  if ($token) { $env:PM_HOST = '0.0.0.0'; $env:PM_TOKEN = $token; $mode = 'LAN' }
  else { Remove-Item Env:PM_HOST -ErrorAction SilentlyContinue; $mode = 'loopback (no PM_TOKEN in pm-remote.env)' }
  Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList '/c', "node `"$server`" >> `"$out`" 2>&1"
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $h = Get-Health
    if (Test-Ready $h) { Log "pm started, $mode (health ok, dispatcher tick fresh)"; return $true }
    Start-Sleep -Milliseconds 500
  }
  Log "pm did not reach readiness (health ok + dispatcher tick within 10s) within 20s - see $out"
  return $false
}

function Notify($title, $text) {
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information
    $n.Visible = $true
    $n.ShowBalloonTip(10000, $title, $text, 'Info')
    Start-Sleep -Seconds 10
    $n.Dispose()
  } catch { Log "notify failed: $($_.Exception.Message)" }
}

function CheckIn($health) {
  $state = @{ last_seq = 0 }
  if (Test-Path $stateFile) { try { $state = Get-Content $stateFile -Raw | ConvertFrom-Json } catch {} }
  $first = -not (Test-Path $stateFile)
  # PS 5.1 hands a JSON array back as one object; the ForEach unrolls it.
  try { $msgs = @(Invoke-RestMethod "$base/api/bridge/messages?agent=claude-code&after=$($state.last_seq)&limit=200" -TimeoutSec 5 | ForEach-Object { $_ }) }
  catch { Log "check-in failed: $($_.Exception.Message)"; return }
  $new = @($msgs | Where-Object { $_.seq -gt $state.last_seq })
  foreach ($m in $new) {
    $text = if ($m.body.text) { $m.body.text } elseif ($m.body.prompt) { $m.body.prompt } else { ($m.body | ConvertTo-Json -Compress -Depth 5) }
    Add-Content -Path $inboxLog -Encoding utf8 -Value ("{0:u} seq {1} {2} from {3} [{4}] {5}: {6}" -f (Get-Date), $m.seq, $m.type, $m.from.agent, $m.state, $m.id, $text)
  }
  $cg = $health.pending.chatgpt
  $mine = $health.pending.'claude-code'
  $summary = "claude-code unacked $([int]$mine.unacked); chatgpt mailbox unacked $([int]$cg.unacked), overdue $([int]$cg.overdue), last connect $($cg.last_connect_at)"
  if ($new.Count) {
    $state.last_seq = ($new | ForEach-Object { [int]$_.seq } | Measure-Object -Maximum).Maximum
    $from = ($new | ForEach-Object { $_.from.agent } | Sort-Object -Unique) -join ', '
    Log "check-in: $($new.Count) new message(s) for claude-code from $from; $summary"
    $label = if ($first) { 'waiting' } else { 'new' }
    Notify 'pm bridge' "$($new.Count) $label message(s) for claude-code from $from. See pm-data\chatgpt-inbox.log"
  } elseif ($first) { Log "check-in: no messages for claude-code; $summary" }
  [pscustomobject]@{ last_seq = [int]$state.last_seq; checked_at = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content $stateFile -Encoding utf8
}

Log "watchdog start (pid $PID)"
$backoffSeconds = $minBackoffSeconds
while ($true) {
  $h = Get-Health
  if (-not $h) {
    Log 'pm down - starting'
    if (Start-Pm) {
      $h = Get-Health
      $backoffSeconds = $minBackoffSeconds
    } else {
      Log "restart backoff: waiting ${backoffSeconds}s before the next attempt"
      Start-Sleep -Seconds $backoffSeconds
      $backoffSeconds = [Math]::Min($backoffSeconds * 2, $maxBackoffSeconds)
    }
  }
  if ($h) { CheckIn $h }
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSeconds
}
