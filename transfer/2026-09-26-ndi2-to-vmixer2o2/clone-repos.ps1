# Clone users / canna / commerce from the bundles beside this script.
# Layout matches ndi2: ~/Documents/claudecode/<repo> with origin = ~/.dsh/remotes/<repo>.git (bare).
# The bare remote is made first and the working repo is cloned from it, so origin is set by the clone.
# Safe to re-run: a repo already at the expected commit is left as is; anything unexpected stops the script.
param(
  [string]$HomeDir = $env:USERPROFILE,
  [string]$BundleDir = $PSScriptRoot,
  [string]$ResultDir = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'

$repos = @(
  @{ name = 'users';    sha = '6361a64fd6c49bc89dfdb045e9ea177a8adb3429595317515252c0ae706e5136'; head = '039842b0408200c225781bfa325af62b803292df' },
  @{ name = 'canna';    sha = '783edef4a9f98a980b8aee715f94c2653955330b07375edfd6542a06b823061d'; head = 'e54c91267cd9814bc95347f2310f4cc7aceec62a' },
  @{ name = 'commerce'; sha = '37f4ba871c6cbf0aad651abf7516277c9bdc7f254a2aaff89d6228472ce596a3'; head = '34701f74cd8db39376dbd610727cc125dc0eeda1' }
)

function Invoke-Git {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & git.exe @args 2>&1 | ForEach-Object { "$_" }
  $rc = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($rc -ne 0) { throw "git $($args -join ' ') failed (exit $rc):$($out -join ' | ')" }
  return (($out -join "`n").Trim())
}

function Same-Path([string]$a, [string]$b) {
  $na = ($a -replace '/', '\').TrimEnd('\').ToLowerInvariant()
  $nb = ($b -replace '/', '\').TrimEnd('\').ToLowerInvariant()
  return $na -eq $nb
}

$code = Join-Path $HomeDir 'Documents\claudecode'
$remotes = Join-Path $HomeDir '.dsh\remotes'
$results = @()
$failed = $false

foreach ($r in $repos) {
  $name = $r.name
  $bundle = Join-Path $BundleDir "$name.bundle"
  $bare = Join-Path $remotes "$name.git"
  $repo = Join-Path $code $name
  $res = [ordered]@{ repo = $name; status = ''; head = ''; aheadBehind = ''; porcelain = -1; origin = ''; detail = '' }
  try {
    if (-not (Test-Path -LiteralPath $bundle)) { throw "bundle not found: $bundle" }
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundle).Hash.ToLowerInvariant()
    if ($sha -ne $r.sha) { throw "bundle $name.bundle is damaged (sha256 $sha, expected $($r.sha))" }

    # Bare remote.
    if (Test-Path -LiteralPath $bare) {
      $bareMain = Invoke-Git --git-dir $bare rev-parse refs/heads/main
      if ($bareMain -ne $r.head) { throw "$bare already exists at $bareMain, expected $($r.head); left untouched" }
    } else {
      New-Item -ItemType Directory -Force -Path $remotes | Out-Null
      Invoke-Git clone --bare --quiet $bundle $bare | Out-Null
      Invoke-Git --git-dir $bare bundle verify $bundle | Out-Null
      Invoke-Git --git-dir $bare remote remove origin | Out-Null
    }

    # Working repo, cloned from the bare remote.
    if (Test-Path -LiteralPath $repo) {
      $have = Invoke-Git -C $repo rev-parse HEAD
      $url = Invoke-Git -C $repo remote get-url origin
      if ($have -ne $r.head -or -not (Same-Path $url $bare)) {
        throw "$repo already exists (HEAD $have, origin $url); expected HEAD $($r.head) and origin $bare; left untouched"
      }
      $res.status = 'already here'
    } else {
      New-Item -ItemType Directory -Force -Path $code | Out-Null
      Invoke-Git clone --quiet -b main $bare $repo | Out-Null
      $res.status = 'cloned'
    }
    Invoke-Git -C $repo config user.name 'user1gityup' | Out-Null
    Invoke-Git -C $repo config user.email 'info@420smoking.club' | Out-Null

    # Verify.
    $res.head = Invoke-Git -C $repo rev-parse HEAD
    $res.origin = Invoke-Git -C $repo remote get-url origin
    Invoke-Git -C $repo fetch --quiet origin | Out-Null
    $res.aheadBehind = (Invoke-Git -C $repo rev-list --left-right --count 'origin/main...HEAD') -replace '\s+', ' '
    $porc = Invoke-Git -C $repo status --porcelain
    $res.porcelain = @($porc -split "`n" | Where-Object { $_ -ne '' }).Count
    if ($res.head -ne $r.head) { throw "HEAD is $($res.head), expected $($r.head)" }
    if ($res.aheadBehind -ne '0 0') { throw "origin/main...HEAD is '$($res.aheadBehind)', expected '0 0'" }
    if ($res.porcelain -ne 0) { throw "working tree not clean ($($res.porcelain) lines)" }
    if (-not (Same-Path $res.origin $bare)) { throw "origin is $($res.origin), expected $bare" }
    Write-Host ("OK   {0,-9} {1}  {2}  origin 0/0" -f $name, $res.status, $res.head.Substring(0, 10))
  } catch {
    $failed = $true
    $res.status = 'FAILED'
    $res.detail = "$($_.Exception.Message)"
    Write-Host ("FAIL {0,-9} {1}" -f $name, $res.detail)
  }
  $results += [pscustomobject]$res
}

$out = [ordered]@{
  host = $env:COMPUTERNAME
  at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  ok = -not $failed
  codeDir = $code
  remotesDir = $remotes
  repos = $results
}
$json = $out | ConvertTo-Json -Depth 5
$resultFile = Join-Path $ResultDir ("clone-result-{0}.json" -f $env:COMPUTERNAME)
[System.IO.File]::WriteAllText($resultFile, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
if ($failed) { Write-Host "FAILED - see $resultFile"; exit 1 }
Write-Host "DONE - all three repos in $code, origins in $remotes"
exit 0
