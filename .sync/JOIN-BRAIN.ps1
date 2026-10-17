<#
.SYNOPSIS
  One click: put this machine's shared brain on the shared git history.

.DESCRIPTION
  Every machine has its own copy of ~/.claude/shared-brain. This joins this
  machine's copy to the private repository the others share, so notes written
  anywhere reach every machine at their next session start.

    1. Checks git and node, and that GitHub answers for the private repository
       (a sign-in window may appear the first time).
    2. Joins:
         - no brain here yet      -> clone it into place
         - a brain, not a repo    -> back it up beside itself, merge it with the
                                     shared history (three-way, against the
                                     snapshot every machine was cloned from)
         - already joined         -> just sync
    3. Installs what must match on every machine: the session-start hook that
       syncs the brain, and the git gatekeeper's instructions for pushing it.
    4. Runs the brain's self-test (no network, no push).
    5. Says what is left: pushing this machine's notes, which goes through the
       git gatekeeper like every other repository.

  It never pushes. Running it again is safe.

  Logged to JOIN-BRAIN-LOG.txt beside this script.
#>
[CmdletBinding()]
param(
  [string]$Remote = 'https://github.com/user1gityup/shared-brain.git',
  # For testing: a brain directory other than ~/.claude/shared-brain.
  [string]$BrainDir,
  # For testing: a ~/.claude other than the real one, for install.
  [string]$ClaudeHome,
  # For testing: skip the closing Enter prompt.
  [switch]$NoPrompt
)
$ErrorActionPreference = 'Stop'

# Not $PSScriptRoot in a parameter default: Windows PowerShell 5.1 leaves it empty there.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $BrainDir) { $BrainDir = Join-Path $env:USERPROFILE '.claude\shared-brain' }
if (-not $ClaudeHome) { $ClaudeHome = Join-Path $env:USERPROFILE '.claude' }

$log = Join-Path $here 'JOIN-BRAIN-LOG.txt'
try { Start-Transcript -LiteralPath $log -Force | Out-Null } catch {}

function Say([string]$m) { Write-Host "  $m" }
function Ok([string]$m) { Write-Host "  [ok]   $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Bad([string]$m) { Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Finish([int]$code) {
  Write-Host ''
  Write-Host "  Full log: $log" -ForegroundColor DarkGray
  try { Stop-Transcript | Out-Null } catch {}
  if (-not $NoPrompt) { Write-Host ''; Read-Host '  Press Enter to close' | Out-Null }
  exit $code
}
trap {
  Write-Host ''
  Bad "stopped: $($_.Exception.Message)"
  Write-Host "  at line $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())" -ForegroundColor DarkGray
  Finish 1
}

# git writes progress to stderr; under 'Stop' Windows PowerShell 5.1 turns that
# into a terminating error. Run native commands with it relaxed, judge by exit code.
function Run-Native([scriptblock]$block) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $block 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $prev }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($out -join "`n") }
}

Write-Host ''
Write-Host '===============================================================' -ForegroundColor Cyan
Write-Host '  Join the shared brain' -ForegroundColor Cyan
Write-Host '===============================================================' -ForegroundColor Cyan
Write-Host ''
Say "machine   $env:COMPUTERNAME ($env:USERNAME)"
Say "brain     $BrainDir"
Say "remote    $Remote"
Write-Host ''

# ---------------------------------------------------------------------------
Write-Host '  1 of 5 - tools and access' -ForegroundColor Cyan
foreach ($tool in 'git', 'node') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Bad "$tool is not on PATH. Run FINISH first."; Finish 2 }
}
Ok "git $((Run-Native { git --version }).Out -replace 'git version ', ''), node $((Run-Native { node --version }).Out)"
$probe = Run-Native { git ls-remote $Remote refs/heads/main }
if ($probe.Code -ne 0 -or -not $probe.Out) {
  Bad 'GitHub did not answer for the shared brain repository.'
  Say ($probe.Out -split "`n" | Select-Object -Last 2) -join ' '
  Say 'Sign in to GitHub (SIGN-IN.cmd does it), then run this again.'
  Finish 2
}
$remoteHead = ($probe.Out -split '\s+')[0]
Ok "GitHub answers; shared history is at $($remoteHead.Substring(0, 10))"

# Git refuses to touch a repository owned by another account, which is what a
# ~/.claude owned by BUILTIN\Administrators looks like to it. The join would
# fail part way - safely: it restores its backup and exits - so check first and
# hand over the one command that clears it. That command changes this user's
# global git config, so it is theirs to run, not this script's.
# Hit on VMIXER2O2, 2026-09-12.
# Say what to do about it, wherever it surfaces, and whether that was fatal.
function Explain-Ownership([string]$text) {
  if ($text -notmatch 'dubious ownership') { return $false }
  Write-Host ''
  Bad 'Git will not touch this brain: the folder is owned by another account.'
  Say 'Run this once, then start this again:'
  Write-Host ''
  Write-Host "    git config --global --add safe.directory `"$($BrainDir -replace '\\', '/')`"" -ForegroundColor Cyan
  Write-Host ''
  Say 'It only tells git to trust this one folder. Nothing is taken over, no'
  Say 'permission is changed, and your notes are untouched either way.'
  return $true
}

# A ~/.claude owned by BUILTIN\Administrators is another account as far as git
# is concerned. This catches it before anything is touched - but only when the
# brain is already a repository. On a brain that is not one yet, git raises it
# from inside the join instead (`git remote add` is where VMIXER2O2 hit it on
# 2026-09-12), so every failure below is checked for it too.
if (Test-Path -LiteralPath (Join-Path $BrainDir '.git')) {
  $ownership = Run-Native { git -C $BrainDir status --porcelain }
  if ($ownership.Code -ne 0 -and (Explain-Ownership $ownership.Out)) { Finish 2 }
}
Write-Host ''

# ---------------------------------------------------------------------------
Write-Host '  2 of 5 - join' -ForegroundColor Cyan
$sync = Join-Path $BrainDir '.sync\brain-sync.mjs'
$result = $null
if (Test-Path -LiteralPath (Join-Path $BrainDir '.git')) {
  Ok 'already joined - syncing'
  $r = Run-Native { node $sync start --dir $BrainDir --timeout 30000 }
  if ($r.Code -ne 0) {
    Bad "sync failed: $($r.Out)"
    if (Explain-Ownership $r.Out) { Finish 2 }
    Finish 1
  }
  $result = $r.Out | ConvertFrom-Json
  Say "sync: $($result.result)"
} elseif (-not (Test-Path -LiteralPath $BrainDir)) {
  Say 'no brain on this machine yet - cloning the shared one'
  $r = Run-Native { git clone -q $Remote $BrainDir }
  if ($r.Code -ne 0) { Bad "clone failed: $($r.Out)"; Finish 1 }
  $r = Run-Native { node $sync start --dir $BrainDir --timeout 30000 }
  $result = $r.Out | ConvertFrom-Json
  Ok 'cloned'
} else {
  # Join from a fresh copy of the tooling, so the merge runs the version that
  # matches the shared history rather than whatever may be lying around.
  $seed = Join-Path $env:TEMP ("brain-seed-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $r = Run-Native { git clone -q $Remote $seed }
  if ($r.Code -ne 0) { Bad "could not fetch the shared history: $($r.Out)"; Finish 1 }
  Say 'merging this machine''s notes into the shared history (a backup is taken first)'
  $r = Run-Native { node (Join-Path $seed '.sync\brain-sync.mjs') join --dir $BrainDir --remote $Remote }
  try { [IO.Directory]::Delete($seed, $true) } catch {}
  if ($r.Code -ne 0) {
    Bad "join failed - the brain was restored exactly as it was: $($r.Out)"
    if (Explain-Ownership $r.Out) { Finish 2 }
    Finish 1
  }
  $result = $r.Out | ConvertFrom-Json
  Ok "joined; this machine's brain was backed up to $($result.backup)"
}
$conflicts = @($result.conflicts)
if ($conflicts.Count -gt 0) {
  Warn "$($conflicts.Count) note(s) were changed on both machines. Both versions are kept:"
  foreach ($c in $conflicts) { Say "  $($c.note)  <- the other machine's copy is $($c.sidecar)" }
  Say 'The next Claude session here will be told, and asked to merge them.'
}
Write-Host ''

# ---------------------------------------------------------------------------
Write-Host '  3 of 5 - install the session hook and the gatekeeper instructions' -ForegroundColor Cyan
$r = Run-Native { node $sync install --dir $BrainDir --claude-home $ClaudeHome }
if ($r.Code -ne 0) { Bad "install failed: $($r.Out)"; Finish 1 }
$inst = $r.Out | ConvertFrom-Json
if ($inst.changes.Count -eq 0) { Ok 'already installed' } else { foreach ($c in $inst.changes) { if ($c -like 'WARNING*') { Warn $c } else { Say $c } }; Ok 'installed' }
Write-Host ''

# ---------------------------------------------------------------------------
Write-Host '  4 of 5 - self-test' -ForegroundColor Cyan
$r = Run-Native { node (Join-Path $BrainDir '.sync\selftest.mjs') }
$tally = ($r.Out -split "`n" | Where-Object { $_ -match '=== \d+/\d+ passed ===' } | Select-Object -Last 1)
if ($r.Code -eq 0) { Ok ($tally.Trim('= ')) } else { Bad "self-test: $($tally.Trim('= '))"; ($r.Out -split "`n" | Where-Object { $_ -match 'FAIL' }) | ForEach-Object { Say $_ }; Finish 1 }
Write-Host ''

# ---------------------------------------------------------------------------
Write-Host '  5 of 5 - what is left' -ForegroundColor Cyan
$counts = (Run-Native { git -C $BrainDir rev-list --left-right --count '@{upstream}...HEAD' }).Out -split '\s+'
$ahead = [int]$counts[-1]
if ($ahead -gt 0) {
  Say "This machine has $ahead brain commit(s) the other machines have not received."
  Say 'They go out through the git gatekeeper, like every other repository:'
  Say '  in a Claude Code session on this machine, say "ok let''s push the updates".'
  Say 'The push-cue scan includes the brain, and the gatekeeper knows how to push it.'
} else {
  Ok 'nothing to push - this machine and the shared history match'
}
Write-Host ''
Write-Host '  Joined.' -ForegroundColor Green
Finish 0
