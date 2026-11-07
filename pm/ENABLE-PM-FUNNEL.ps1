# ENABLE-PM-FUNNEL.ps1 - expose this host's pm /mcp/<chatgpt-token> path to ChatGPT through
# Tailscale Funnel on ONE port (-Port 443|8443|10000, default 8443). Funnel is per port, so the chosen port
# must serve nothing else: the script refuses before any change if it does.
#   1. chatgpt bridge token with scopes send,read,execute,auto,pm (reuses the one in chatgpt-mcp-url.txt
#      when its hash matches bridge-tokens.json, otherwise mints a new one)
#   2. restarts pm through DEPLOY-PM-UPDATE.ps1 so the token/scopes load
#   3. tailscale serve https:8443 /mcp/<tok> -> 127.0.0.1:4480, funnel 8443 on (one UAC prompt)
#   4. tests through the PUBLIC funnel ingress: tools/list has pm_* tools, pm_list_projects works,
#      port 443 is not public
#   5. writes the URL to pm-data\chatgpt-mcp-url.txt, copies it to the clipboard, reports to ndi2 claude-code
# -DryRun: read-only, prints the plan. -Off: removes the 8443 funnel/serve.
param([switch]$DryRun, [switch]$Off, [ValidateSet(443, 8443, 10000)][int]$Port = 8443)
$ErrorActionPreference = 'Stop'
$brain = Split-Path $PSScriptRoot -Parent
$home2 = Split-Path (Split-Path $brain -Parent) -Parent
$data = Join-Path $home2 '.claude\pm-data'
$pmDir = $PSScriptRoot
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
$port = $Port
$logFile = Join-Path $data 'funnel-setup.log'
function Log($m) { $l = "$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss'))Z $m"; Write-Host $l; if (-not $DryRun) { Add-Content -Path $logFile -Value $l -Encoding utf8 } }
$result = [ordered]@{ host = $env:COMPUTERNAME; steps = [ordered]@{} }
function Report($status) {
  $result.status = $status
  if ($DryRun) { return }
  $lines = @($result.steps.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" })
  $text = "ENABLE-PM-FUNNEL on $($env:COMPUTERNAME): $status`n" + ($lines -join "`n")
  $body = @{ type = 'message'; from = @{ agent = 'claude-code' }; to = @{ machine = 'vmixlaptop2x6'; agent = 'claude-code' }
    dedupe_key = "funnel-setup-$([guid]::NewGuid())"; body = @{ text = $text; funnel_setup = $result } } | ConvertTo-Json -Depth 6
  try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4480/api/bridge/messages' -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null; Log 'report sent to ndi2 claude-code' }
  catch { Log "report send failed: $($_.Exception.Message)" }
}
function Fail($m) { if ($script:tok) { $m = $m -replace [regex]::Escape($script:tok), '<tok>' }; Log "FAIL: $m"; $result.steps.fail = $m; Report 'FAIL'; Write-Host "`nFAILED: $m" -ForegroundColor Red; exit 1 }
function Sha256Hex($s) { -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($s)) | ForEach-Object { $_.ToString('x2') }) }

# Runs tailscale args elevated (one UAC prompt for the whole batch); returns combined output.
function Invoke-TsElevated([string[]]$commands) {
  $tmp = Join-Path $env:TEMP "ts-funnel-$PID"
  $lines = @('$ErrorActionPreference = ''Continue''')
  foreach ($c in $commands) { $lines += "& '$ts' $c *>&1 | Out-File -Append -Encoding utf8 '$tmp.out'; ""exit `$LASTEXITCODE"" | Out-File -Append -Encoding utf8 '$tmp.out'" }
  Set-Content -Path "$tmp.ps1" -Value $lines -Encoding utf8
  Remove-Item "$tmp.out" -ErrorAction SilentlyContinue
  try { Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$tmp.ps1" -Verb RunAs -WindowStyle Hidden -Wait }
  catch { Fail "UAC for tailscale refused: $($_.Exception.Message)" }
  $out = if (Test-Path "$tmp.out") { Get-Content "$tmp.out" -Raw } else { '' }
  Remove-Item "$tmp.ps1", "$tmp.out" -ErrorAction SilentlyContinue
  return $out
}
function Get-ServeJson { (& $ts serve status --json 2>$null | Out-String) | ConvertFrom-Json }

if (-not (Test-Path $ts)) { Fail "tailscale CLI not found at $ts" }
$self = (& $ts status --json | Out-String | ConvertFrom-Json).Self
$hostName = $self.DNSName.TrimEnd('.')
if (-not $hostName) { Fail 'tailscale has no DNS name (not logged in?)' }
$tsVer = [version](((& $ts version | Select-Object -First 1) -replace '[^0-9.].*$', '').Trim())
$newCli = $tsVer -ge [version]'1.52'
function TsOn($t)  { if ($newCli) { @("funnel --bg --https=$port --set-path=/mcp/$t http://127.0.0.1:4480/mcp/$t") } else { @("serve https:$port /mcp/$t http://127.0.0.1:4480/mcp/$t", "funnel $port on") } }
function TsOff($t) { if ($newCli) { @("funnel --https=$port --set-path=/mcp/$t off", "serve --https=$port --set-path=/mcp/$t off") } else { @("funnel $port off", "serve https:$port /mcp/$t http://127.0.0.1:4480/mcp/$t off") } }
function TsPortOff($p) { if ($newCli) { "funnel --https=$p off" } else { "funnel $p off" } }
Log "host $hostName, pm-data $data, tailscale $tsVer (new CLI: $newCli), dry-run=$DryRun"
$result.steps.host = $hostName

# Funnel is per port: refuse a port that already serves anything (other than our own /mcp mount).
function Get-ForeignHandlers {
  $sj0 = Get-ServeJson
  $web = $sj0.Web."${hostName}:$port"
  $tcp = $sj0.TCP."$port"
  $h = @(); if ($web) { $h = @($web.Handlers.PSObject.Properties.Name | Where-Object { $_ -notmatch '^/mcp/[A-Za-z0-9_-]{20,}/?$' }) }
  if ($tcp -and -not $tcp.HTTPS) { $h += "tcp:$port" }
  return ,$h
}
$foreign = Get-ForeignHandlers
if ($foreign.Count) { Fail "port $port already serves $($foreign -join ', ') - funnel on it would make that public. Pick a free port with -Port 443|8443|10000." }
Log "port $port is free of other handlers"
$funBefore = @((Get-ServeJson).AllowFunnel.PSObject.Properties | Where-Object { $_.Value } | ForEach-Object { $_.Name })

# ---- 1. token --------------------------------------------------------------
$urlFile = Join-Path $data 'chatgpt-mcp-url.txt'
$tokFile = Join-Path $data 'bridge-tokens.json'
$tok = $null
if (Test-Path $urlFile) {
  $u = (Get-Content $urlFile -Raw).Trim().TrimStart([char]0xFEFF)
  if ($u -match '/mcp/([A-Za-z0-9_-]{20,})') { $tok = $Matches[1] }
}
$entry = if (Test-Path $tokFile) { (Get-Content $tokFile -Raw | ConvertFrom-Json).tokens | Where-Object { $_.name -eq 'chatgpt' } } else { $null }
$reuse = $tok -and $entry -and ((Sha256Hex $tok) -eq $entry.sha256)

if ($Off) {
  if (-not $tok) { Fail 'no token in chatgpt-mcp-url.txt; nothing to remove' }
  if ($DryRun) { Log "would run: funnel $port off; serve https:$port /mcp/<tok> off"; exit 0 }
  $o = Invoke-TsElevated (TsOff $tok)
  Log "off: $o"; exit 0
}

$scopes = 'send,read,execute,auto,pm'
Log ("token: " + $(if ($reuse) { "reuse existing chatgpt token (hash matches), current scopes $($entry.scopes -join ',')" } elseif ($entry) { 'existing chatgpt token has no recoverable raw value - mint new' } else { 'no chatgpt token - mint new' }))
if ($DryRun) {
  Log "would set scopes $scopes, restart pm via DEPLOY-PM-UPDATE.ps1"
  Log "would run elevated: tailscale $((TsOn '<tok>') -join '; tailscale ')"
  Log "would test https://${hostName}:$port/mcp/<tok> through public DNS, assert no other port becomes public"
  $sj = Get-ServeJson
  Log "current AllowFunnel: $(($sj.AllowFunnel.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ', ')"
  Log "current serve ports: $(($sj.TCP.PSObject.Properties.Name) -join ',')"
  exit 0
}
# PS 5.1 + Stop turns node's stderr note into a terminating error (raw token lost): relax for native calls
$ErrorActionPreference = 'Continue'
Push-Location $pmDir
try {
  if ($reuse) {
    & node bridge/cli.mjs token-scopes chatgpt $scopes 2>&1 | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -ne 0) { Fail "token-scopes exit $LASTEXITCODE" }
  } else {
    $tok = (& node bridge/cli.mjs token-add chatgpt $scopes 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $tok -notmatch '^[A-Za-z0-9_-]{20,}$') { Fail "token-add failed (exit $LASTEXITCODE)" }
    Log '  minted new chatgpt token (hash stored in bridge-tokens.json)'
  }
} finally { Pop-Location }
$result.steps.token = $(if ($reuse) { 'reused, scopes set' } else { 'new token minted' })

# ---- 2. restart pm ----------------------------------------------------------
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pmDir 'DEPLOY-PM-UPDATE.ps1')
if ($LASTEXITCODE -ne 0) { Fail "DEPLOY-PM-UPDATE.ps1 exit $LASTEXITCODE (see pm-data\deploy.log)" }
$result.steps.pm_restart = 'PASS'

# local check: token sees pm tools
$listBody = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
$hdr = @{ accept = 'application/json, text/event-stream' }
$local = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4480/mcp/$tok" -ContentType 'application/json' -Headers $hdr -Body $listBody -TimeoutSec 15
$localPm = @($local.result.tools | Where-Object { $_.name -like 'pm_*' }).Count
Log "local tools/list: $(@($local.result.tools).Count) tools, $localPm pm_*"
if ($localPm -lt 1) { Fail 'token loaded but no pm_* tools on loopback' }
$result.steps.local_tools = "$localPm pm tools"

# ---- 3. tailscale -----------------------------------------------------------
$o = Invoke-TsElevated (TsOn $tok)
Log ("tailscale: " + ($o -replace [regex]::Escape($tok), '<tok>' -replace '\s+', ' '))
$sj = Get-ServeJson
$fun = @($sj.AllowFunnel.PSObject.Properties | Where-Object { $_.Value } | ForEach-Object { $_.Name })
Log "funnel now on: $($fun -join ', ')"
function Undo { Invoke-TsElevated (TsOff $tok) | Out-Null; Log "rolled back funnel/serve on $port" }
$extra = @($fun | Where-Object { $_ -ne "${hostName}:$port" -and $funBefore -notcontains $_ })
if ($extra.Count) { Invoke-TsElevated @($extra | ForEach-Object { TsPortOff (($_ -split ':')[-1]) }) | Out-Null; Undo; Fail "funnel also turned on $($extra -join ', '); turned off and rolled back" }
if ($fun -notcontains "${hostName}:$port") { Undo; Fail "funnel on $port did not take: $o (tailnet policy needs nodeAttrs funnel for this node?)" }
$handlers = $sj.Web."${hostName}:$port".Handlers.PSObject.Properties.Name
if (@($handlers).Count -ne 1) { Undo; Fail "port $port serves more than the one /mcp path: $(@($handlers).Count) handlers" }
$result.steps.funnel = "on ${hostName}:$port, only /mcp/<tok>"

# ---- 4. public test ----------------------------------------------------------
$ip = $null
for ($i = 0; $i -lt 40 -and -not $ip; $i++) {
  # DoH, not Resolve-DnsName: on a tailnet node Tailscale answers port-53 queries itself with the 100.x IP
  try {
    $doh = Invoke-RestMethod -Uri "https://cloudflare-dns.com/dns-query?name=$hostName&type=A" -Headers @{ accept = 'application/dns-json' } -TimeoutSec 10
    $ip = @($doh.Answer | Where-Object { $_.type -eq 1 -and $_.data -notmatch '^100\.' } | ForEach-Object { $_.data }) | Select-Object -First 1
  } catch { $ip = $null }
  if (-not $ip) { Start-Sleep -Seconds 5 }
}
if (-not $ip) { Fail "$hostName has no public DNS after 200s" }
Log "public DNS $hostName -> $ip"
$url = "https://${hostName}:$port/mcp/$tok"
$call = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pm_list_projects","arguments":{}}}'
# PS 5.1 strips embedded double quotes from native args, so curl reads the JSON bodies from files.
$listFile = Join-Path $env:TEMP "funnel-list-$PID.json"; $callFile = Join-Path $env:TEMP "funnel-call-$PID.json"
[IO.File]::WriteAllText($listFile, $listBody); [IO.File]::WriteAllText($callFile, $call)
$pub = $null
for ($i = 0; $i -lt 12; $i++) {
  $pub = & curl.exe -s -m 20 --resolve "${hostName}:${port}:$ip" -X POST $url -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d $listBody
  if ($pub -match 'pm_create_project') { break }
  Start-Sleep -Seconds 10
}
if ($pub -notmatch 'pm_create_project') { Undo; Fail "public tools/list via funnel ingress did not return pm tools: $(($pub | Out-String) -replace [regex]::Escape($tok), '<tok>')" }
$pc = & curl.exe -s -m 20 --resolve "${hostName}:${port}:$ip" -X POST $url -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d $call
if ($pc -notmatch '"result"' -or $pc -match '"isError":true') { Undo; Fail "public pm_list_projects failed: $(($pc | Out-String).Substring(0, [Math]::Min(300, ($pc | Out-String).Length)))" }
Log 'public tools/list + pm_list_projects PASS'
$others = @((Get-ServeJson).TCP.PSObject.Properties.Name | Where-Object { $_ -ne "$port" -and $funBefore -notcontains "${hostName}:$_" })
foreach ($op in $others) {
  $code = & curl.exe -s -m 10 -o NUL -w '%{http_code}' --resolve "${hostName}:${op}:$ip" "https://${hostName}:$op/"
  Log "public :$op -> '$code' (expect 000 = not reachable)"
  if ($code -ne '000') { Undo; Fail "port $op answers publicly (HTTP $code)" }
}
$result.steps.public_test = "tools/list has pm tools, pm_list_projects ok, ports $($others -join ',') not public"

# ---- 5. hand-off ---------------------------------------------------------------
[IO.File]::WriteAllText($urlFile, $url, (New-Object Text.UTF8Encoding $false))
try { Set-Clipboard -Value $url; $result.steps.clipboard = 'URL copied' } catch { $result.steps.clipboard = 'clipboard failed' }
Log 'PASS - connector URL written to chatgpt-mcp-url.txt and copied to clipboard'
Report 'PASS'
Write-Host "`nPASS. The ChatGPT connector URL is on the clipboard (also in $urlFile)." -ForegroundColor Green
Write-Host 'In ChatGPT: Settings > Apps & Connectors > Create/Add connector, paste the URL, no auth, then start a new chat.'
exit 0
