# Start every local service this fleet machine owns, then publish what is
# actually listening into the shared brain so the other machine can find it
# without anybody guessing an IP address.
#
# Host-agnostic on purpose: resolves every path from $env:USERPROFILE, never
# from a hardcoded C:\Users\<name>. Idempotent - a service already listening
# is left alone.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

$brain = Join-Path $env:USERPROFILE '.claude\shared-brain'
$dsh   = Join-Path $env:USERPROFILE '.dsh'
$host_ = $env:COMPUTERNAME.ToLower()

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  $t = $c.ConnectAsync('127.0.0.1', $p)
  $ok = $t.Wait(1200) -and $c.Connected
  $c.Close()
  return $ok
}

$report = @{}

# --- pm (project manager), LAN mode -----------------------------------
# START-PM-LAN.cmd redirects node's output into ~\.claude\pm-data\server.log.
# cmd resolves that redirect BEFORE launching node, so on a machine where
# pm-data does not exist yet the redirect fails, node never starts, and no
# log is written at all - a silent failure that points at a log that cannot
# exist. Found on vmixer2o2 2026-10-05. Create the directory first.
$pmData = Join-Path $env:USERPROFILE '.claude\pm-data'
if (-not (Test-Path $pmData)) { New-Item -ItemType Directory -Path $pmData -Force | Out-Null }

if (Test-Port 4480) {
  $report['pm'] = 'already running'
} else {
  $pmLan = Join-Path $brain 'pm\START-PM-LAN.cmd'
  $pmAny = Join-Path $brain 'pm\START-PM.cmd'
  if (Test-Path $pmLan)      { cmd /c "`"$pmLan`"" | Out-Null }
  elseif (Test-Path $pmAny)  { cmd /c "`"$pmAny`"" | Out-Null }
  $report['pm'] = if (Test-Port 4480) { 'started' } else { 'FAILED - see ~\.claude\pm-data\server.log' }
}

# --- FCC (Free Claude Code proxy) -------------------------------------
if (Test-Port 8082) {
  $report['fcc'] = 'already running'
} else {
  $fcc = Join-Path $dsh 'fcc-control.ps1'
  if (Test-Path $fcc) { & $fcc start | Out-Null }
  $report['fcc'] = if (Test-Port 8082) { 'started' } else { 'FAILED - no fcc-control.ps1 or it did not come up' }
}

# --- DSH ---------------------------------------------------------------
if (Test-Port 3080) {
  $report['dsh'] = 'already running'
} else {
  $launch = Join-Path $dsh 'launch-dsh.cmd'
  if (Test-Path $launch) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$launch`"" -WindowStyle Minimized
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline -and -not (Test-Port 3080)) { Start-Sleep -Milliseconds 500 }
  }
  $report['dsh'] = if (Test-Port 3080) { 'started' } else { 'FAILED - launch-dsh.cmd missing or build not present' }
}

# --- publish real endpoints into the brain -----------------------------
# The stale 10.0.0.244 in relay/llm-targets is exactly the failure this fixes:
# whatever address this machine actually holds right now is what gets written.
$ips = @(Get-NetIPAddress -AddressFamily IPv4 |
          Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
          ForEach-Object { [pscustomobject]@{ ip = $_.IPAddress; nic = $_.InterfaceAlias } })

$listening = @{}
foreach ($svc in @{ pm = 4480; dsh = 3080; fcc = 8082; llama = 8090; relay = 8091 }.GetEnumerator()) {
  $listening[$svc.Key] = [bool](Test-Port $svc.Value)
}

$out = [pscustomobject]@{
  host      = $host_
  at        = (Get-Date).ToUniversalTime().ToString('o')
  addresses = $ips
  ports     = @{ pm = 4480; dsh = 3080; fcc = 8082; llama = 8090; relay = 8091 }
  listening = $listening
  startup   = $report
}

$dir = Join-Path $brain 'fleet\endpoints'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$out | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dir "$host_.json") -Encoding utf8

''
"  $host_ services"
"  " + ('-' * (($host_.Length) + 9))
foreach ($k in $report.Keys) { "   {0,-5} {1}" -f $k, $report[$k] }
''
'  reachable at: ' + (($ips | ForEach-Object { $_.ip }) -join ', ')
'  published to: fleet\endpoints\' + $host_ + '.json (the other machine reads this instead of guessing an IP)'
''
