# One-click pm two-way sync cutover on this machine (double-click ENABLE-PM-SYNC.cmd).
# Runs on vmixer2o2 or ndi2; safe to rerun.
#  1. Preflight: sync-schema.mjs + sync.mjs present, server.mjs wires the sync routes.
#  2. Backup the live db (POST /api/backup) to pm-data\backup-pre-sync-<stamp>.db.
#  3. Restart local pm the DEPLOY-PM-UPDATE.ps1 way (stop the 4480 listener, the
#     pm-autostart.ps1 watchdog brings it back) unless the running pm already serves
#     /api/sync/status; wait for health + dispatcher tick + /api/sync/status 200.
#  4. POST /api/sync/now, poll /api/sync/status up to 60s until every peer is ok.
#  5. Verify project and task ids local vs each peer (url+token from bridge-peers.json,
#     token never printed). Waits up to 60s for the peer's own pull to converge.
#  6. vmixer2o2 only, after PASS: archive duplicate task T-67ba9f12 (if not ARCHIVED).
# -DryRun: step 1 and a read-only step 5 only (no backup, restart, sync or archive).
# -ForceRestart: restart pm even if it already serves /api/sync/status.
# Log: pm-data\sync-enable.log. Exit 0 only on PASS.
param([switch]$DryRun, [switch]$ForceRestart)

$ErrorActionPreference = 'Continue'
$pmDir   = $PSScriptRoot
$dataDir = Join-Path $env:USERPROFILE '.claude\pm-data'
$log     = Join-Path $dataDir 'sync-enable.log'
$base    = 'http://127.0.0.1:4480'
$actor   = @{ 'x-pm-actor' = 'enable-pm-sync'; 'x-pm-model' = 'claude-opus-5.5' }
$dupTask = 'T-67ba9f12'
$dupNote = 'duplicate of ndi2 T-26b4ca91 (pm sync cutover)'
New-Item -ItemType Directory -Force $dataDir | Out-Null
function Log($m) { $l = "{0:u} {1}" -f (Get-Date).ToUniversalTime(), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding utf8 }
function Fail($m) { Log "FAIL: $m"; Log 'RESULT: FAIL'; exit 1 }

$machine = if ($env:PM_MACHINE) { $env:PM_MACHINE } else { $env:COMPUTERNAME.ToLower() }
$aliasGroups = @(@('ndi2', 'vmixlaptop2x6'), @('vmixer2o2', 'vmixer'))
$myNames = @($machine)
foreach ($g in $aliasGroups) { if ($g -contains $machine) { $myNames += $g } }
$myNames = @($myNames | Sort-Object -Unique)
$isVmixer = [bool]($myNames -contains 'vmixer2o2')
Log "enable-pm-sync start on $machine (names: $($myNames -join ',')) dryRun=$([bool]$DryRun)"

# ---- 1. preflight ------------------------------------------------------------
$missing = @('sync-schema.mjs', 'sync.mjs', 'server.mjs') | Where-Object { -not (Test-Path (Join-Path $pmDir $_)) }
if ($missing) { Fail "code not here yet - brain pull needed (missing: $($missing -join ', '))" }
# server.mjs mounts the /api/sync routes from sync.mjs (syncRoutes); the paths themselves live in sync.mjs.
$serverWired = Select-String -Path (Join-Path $pmDir 'server.mjs') -Pattern "/api/sync|syncRoutes\(" -Quiet
$syncRoutes  = Select-String -Path (Join-Path $pmDir 'sync.mjs') -Pattern "/api/sync" -SimpleMatch -Quiet
if (-not ($serverWired -and $syncRoutes)) { Fail 'code not here yet - brain pull needed (server.mjs does not mount /api/sync)' }
Log 'preflight ok: sync-schema.mjs, sync.mjs, server.mjs /api/sync wiring present'

# ---- helpers -------------------------------------------------------------------
function Get-Local($path, $timeout = 10) { Invoke-RestMethod "$base$path" -Headers $actor -TimeoutSec $timeout }
function Post-Local($path, $body, $timeout = 30) {
  Invoke-RestMethod "$base$path" -Method Post -Headers $actor -ContentType 'application/json' -Body (ConvertTo-Json $body -Depth 5 -Compress) -TimeoutSec $timeout
}
function Get-Peer($peer, $path) {
  $h = @{}
  if ($peer.token) { $h.Authorization = "Bearer $($peer.token)" }
  Invoke-RestMethod "$($peer.url)$path" -Headers $h -TimeoutSec 10
}
function Test-SyncStatus { try { Get-Local '/api/sync/status' 5 | Out-Null; $true } catch { $false } }
function Get-Ids($getter) {
  # PS 5.1 hands a JSON array back as one object; ForEach unrolls it.
  $p = @(& $getter '/api/projects' | ForEach-Object { $_ } | ForEach-Object { $_.id })
  $t = @(& $getter '/api/tasks?limit=5000' | ForEach-Object { $_ } | ForEach-Object { $_.id })
  [pscustomobject]@{ projects = $p; tasks = $t }
}

# Peers: bridge-peers.json minus this host's names, one per distinct url (as sync.mjs does).
$peersFile = if ($env:BRIDGE_PEERS) { $env:BRIDGE_PEERS } else { Join-Path $dataDir 'bridge-peers.json' }
$peers = @()
if (Test-Path $peersFile) {
  try { $raw = Get-Content $peersFile -Raw | ConvertFrom-Json } catch { Fail "bridge-peers.json unreadable: $($_.Exception.Message)" }
  $seen = @{}
  foreach ($prop in $raw.PSObject.Properties) {
    if ($myNames -contains $prop.Name -or -not $prop.Value.url) { continue }
    $url = ([string]$prop.Value.url).TrimEnd('/')
    if ($seen.ContainsKey($url)) { continue }
    $seen[$url] = $true
    $peers += [pscustomobject]@{ name = $prop.Name; url = $url; token = $prop.Value.token }
  }
}
if (-not $peers.Count) { Fail "no peer in $peersFile for this host - nothing to sync with" }
Log "peers: $(($peers | ForEach-Object { "$($_.name)=$($_.url)" }) -join ', ')"

# ---- 5. verify (shared by -DryRun) -----------------------------------------------
function Compare-WithPeers([int]$waitSeconds) {
  $deadline = (Get-Date).AddSeconds($waitSeconds)
  while ($true) {
    $allOk = $true
    $lines = @()
    try { $local = Get-Ids ${function:Get-Local} } catch { Log "local pm read failed: $($_.Exception.Message)"; return $false }
    foreach ($peer in $peers) {
      try { $remote = Get-Ids { param($p) Get-Peer $peer $p } } catch { $lines += "peer $($peer.name): read failed: $($_.Exception.Message)"; $allOk = $false; continue }
      $peerSync = try { Get-Peer $peer '/api/sync/status' | Out-Null; 'on' } catch { 'off' }
      $pMissLocal = @($remote.projects | Where-Object { $local.projects -notcontains $_ }).Count
      $pMissPeer  = @($local.projects | Where-Object { $remote.projects -notcontains $_ }).Count
      $tMissLocal = @($remote.tasks | Where-Object { $local.tasks -notcontains $_ }).Count
      $tMissPeer  = @($local.tasks | Where-Object { $remote.tasks -notcontains $_ }).Count
      $same = ($pMissLocal + $pMissPeer + $tMissLocal + $tMissPeer) -eq 0
      if (-not $same) { $allOk = $false }
      $lines += ("peer {0}: projects local {1} / peer {2}, tasks local {3} / peer {4}; missing here p{5} t{6}, missing on peer p{7} t{8}; peer sync {9} -> {10}" -f `
        $peer.name, $local.projects.Count, $remote.projects.Count, $local.tasks.Count, $remote.tasks.Count, $pMissLocal, $tMissLocal, $pMissPeer, $tMissPeer, $peerSync, $(if ($same) { 'MATCH' } else { 'DIFF' }))
    }
    if ($allOk -or (Get-Date) -ge $deadline) { foreach ($l in $lines) { Log $l }; return $allOk }
    Start-Sleep -Seconds 5
  }
}

if ($DryRun) {
  $sync = if (Test-SyncStatus) { 'local pm already serves /api/sync/status' } else { 'local pm does NOT serve /api/sync yet (restart needed)' }
  Log "dry-run: $sync"
  $ok = Compare-WithPeers 0
  Log "dry-run done - nothing backed up, restarted, synced or archived"
  Log "RESULT: $(if ($ok) { 'PASS' } else { 'FAIL' }) (read-only comparison)"
  if ($ok) { exit 0 } else { exit 1 }
}

# ---- 2. backup -------------------------------------------------------------------
try { Get-Local '/api/health' 5 | Out-Null } catch { Fail 'local pm not answering /api/health - cannot back up before cutover' }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$dest = Join-Path $dataDir "backup-pre-sync-$stamp.db"
try { Post-Local '/api/backup' @{ dest = $dest } 120 | Out-Null } catch { Fail "backup request failed: $($_.Exception.Message)" }
$bk = Get-Item $dest -ErrorAction SilentlyContinue
if (-not $bk -or $bk.Length -le 0) { Fail "backup file $dest missing or empty" }
Log "backup ok: $dest ($($bk.Length) bytes)"

# ---- 3. restart (DEPLOY-PM-UPDATE.ps1 logic) --------------------------------------
function Get-PmPids { @(Get-NetTCPConnection -LocalPort 4480 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) }
if ((Test-SyncStatus) -and -not $ForceRestart) {
  Log 'running pm already serves /api/sync/status - restart skipped (use -ForceRestart to force)'
} else {
  $old = Get-PmPids
  foreach ($procId in $old) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Log "pm pid $procId needs elevation - asking UAC for taskkill"
      try { Start-Process -FilePath taskkill.exe -ArgumentList '/F', '/PID', $procId -Verb RunAs -WindowStyle Hidden -Wait } catch { Fail "elevated taskkill of pm pid $procId refused: $($_.Exception.Message)" }
    }
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { Fail "pm pid $procId still running after stop" }
  }
  Log "stopped pm pid(s): $($old -join ',')"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pmDir 'pm-autostart.ps1') -StartIfAbsent | Out-Null
  $deadline = (Get-Date).AddSeconds(150)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $new = @(Get-PmPids | Where-Object { $old -notcontains $_ })
    try { $h = Invoke-RestMethod "$base/api/bridge/health" -TimeoutSec 3 } catch { $h = $null }
    if ($new.Count -and $h -and $h.ok -and $h.dispatch.last_tick_at -and (Test-SyncStatus)) {
      Log "pm ready: new pid $($new -join ','), dispatcher tick $($h.dispatch.last_tick_at), /api/sync/status 200"
      $ready = $true
      break
    }
  }
  if (-not $ready) { Fail 'pm did not come back with /api/sync/status within 150s - see pm-data\autostart.log and server.log' }
}
try { Get-Local '/api/health' 5 | Out-Null } catch { Fail '/api/health not answering after restart' }

# ---- 4. sync now + poll status ------------------------------------------------------
try { Post-Local '/api/sync/now' @{} 120 | Out-Null } catch { Log "sync/now returned error (continuing to poll): $($_.Exception.Message)" }
$deadline = (Get-Date).AddSeconds(60)
$st = $null
while ($true) {
  try { $st = Get-Local '/api/sync/status' 5 } catch { $st = $null }
  $sp = @($st.peers | ForEach-Object { $_ })
  if ($sp.Count -and -not @($sp | Where-Object { $_.ok -ne $true }).Count) { break }
  if ((Get-Date) -ge $deadline) {
    foreach ($p in $sp) { Log "sync peer $($p.peer): ok=$($p.ok) after=$($p.after) err=$($p.last_error)" }
    Fail 'sync peers not all ok within 60s'
  }
  Start-Sleep -Seconds 3
}
foreach ($p in $sp) { Log "sync peer $($p.peer): ok, cursor $($p.after), last_ok $($p.last_ok_at), totals $(ConvertTo-Json $p.totals -Compress)" }
Log "local sync counter chg=$($st.chg)"

# ---- 5. verify ------------------------------------------------------------------------
if (-not (Compare-WithPeers 60)) { Fail 'project/task ids differ between this host and a peer after 60s' }
Log 'verify PASS: projects and tasks match every peer'

# ---- 6. vmixer2o2: archive duplicate task ---------------------------------------------
if ($isVmixer) {
  $t = $null
  try { $t = Get-Local "/api/tasks/$dupTask" } catch { Log "dup task $dupTask not found locally ($($_.Exception.Message)) - nothing to archive" }
  if ($t) {
    if ($t.lifecycle -eq 'ARCHIVED') {
      Log "dup task $dupTask already ARCHIVED - no action"
    } else {
      try {
        $r = Post-Local "/api/tasks/$dupTask/archive" @{ note = $dupNote } 60
        Log "dup task $dupTask archived (was $($t.lifecycle), now $($r.lifecycle))"
      } catch { Fail "archive of $dupTask failed: $($_.Exception.Message)" }
      $has = @($t.comments | ForEach-Object { $_ } | Where-Object { $_.body -eq $dupNote }).Count
      if (-not $has) {
        try { Post-Local "/api/tasks/$dupTask/comments" @{ body = $dupNote } | Out-Null; Log "comment added to $dupTask" } catch { Fail "comment on $dupTask failed: $($_.Exception.Message)" }
      }
    }
  }
}

Log 'RESULT: PASS'
exit 0
