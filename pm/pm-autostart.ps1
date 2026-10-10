# pm autostart + watchdog + ChatGPT check-in.
# Started at logon from the Startup folder (Shared-Agent-Listeners.cmd).
#  - Keeps the pm server up: starts it in LAN mode (PM_HOST=0.0.0.0, PM_TOKEN
#    from ~/.claude/pm-remote.env) whenever /api/bridge/health stops answering;
#    falls back to loopback mode if the env file has no token.
#  - Checks in on bridge messages addressed to claude-code (from ChatGPT or any
#    other agent) via the read-only list route, so nothing is marked delivered
#    or acked. New ones go to pm-data\chatgpt-inbox.log and a tray notification.
# One instance per user (named mutex). Log: pm-data\autostart.log.
param([int]$IntervalSeconds = 60, [switch]$Once)

$ErrorActionPreference = 'Continue'
$pmDir   = $PSScriptRoot
$dataDir = Join-Path $env:USERPROFILE '.claude\pm-data'
$envFile = Join-Path $env:USERPROFILE '.claude\pm-remote.env'
$logFile = Join-Path $dataDir 'autostart.log'
$inboxLog = Join-Path $dataDir 'chatgpt-inbox.log'
$stateFile = Join-Path $dataDir 'chatgpt-checkin.json'
$base = 'http://127.0.0.1:4480'
New-Item -ItemType Directory -Force $dataDir | Out-Null

$mutex = New-Object System.Threading.Mutex($false, 'Local\pm-autostart-watchdog')
if (-not $Once -and -not $mutex.WaitOne(0)) { exit 0 }

function Log($msg) { Add-Content -Path $logFile -Value ("{0:u} {1}" -f (Get-Date), $msg) -Encoding utf8 }

function Get-Health {
  try { Invoke-RestMethod "$base/api/bridge/health" -TimeoutSec 3 } catch { $null }
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
  while ((Get-Date) -lt $deadline) { if (Get-Health) { Log "pm started, $mode"; return $true }; Start-Sleep -Milliseconds 500 }
  Log "pm did not start within 20s - see $out"
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
while ($true) {
  $h = Get-Health
  if (-not $h) { Log 'pm down - starting'; if (Start-Pm) { $h = Get-Health } }
  if ($h) { CheckIn $h }
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSeconds
}
