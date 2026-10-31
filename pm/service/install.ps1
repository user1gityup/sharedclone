# Registers the pm supervisor autostart Task Scheduler task (CONTRACTS.md C7).
#
# Task identity: CONTRACTS.md C7 does not spell out a literal task name, so this
# reuses the watchdog's named-mutex identifier ('pm-autostart-watchdog') in the
# Task Scheduler root path. disable.ps1 and rollback.ps1 must use the same
# $TaskName/$TaskPath pair for this script's task to be found by them.
#
# Trigger: At startup (system boot), not user logon. Principal: the current
# user with logon type S4U - "run whether logged on or not" WITHOUT a stored
# password (user choice 2026-10-13). S4U tasks cannot reach network shares;
# pm only serves its own port, so it does not need them. Registering still
# needs an elevated shell (one UAC click), never a password.
#
# Settings: no execution time limit (the default 72h would kill the watchdog),
# runs and keeps running on battery, restarts on failure.
#
# One-click: no required parameters. Idempotent: if the task already exists,
# the script no-ops (exit 0) instead of erroring or creating a duplicate;
# pass -Force to re-register (update) an existing task instead.
param(
  [string]$PmAutostartScript = (Join-Path $PSScriptRoot '..\pm-autostart.ps1'),
  [string]$PowerShellExePath = (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$TaskName = 'pm-autostart-watchdog'
$TaskPath = '\'

function Test-IsElevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

try {
  $resolvedAutostart = $null
  try {
    $resolvedAutostart = (Resolve-Path -LiteralPath $PmAutostartScript -ErrorAction Stop).Path
  } catch {
    Write-Error "pm-autostart.ps1 not found at expected path: $PmAutostartScript"
    exit 1
  }

  if (-not (Test-Path -LiteralPath $PowerShellExePath)) {
    Write-Error "powershell.exe not found at: $PowerShellExePath"
    exit 1
  }

  if (-not (Test-IsElevated)) {
    Write-Error "Not elevated. Registering a boot-time S4U task needs an administrator shell (UAC)."
    exit 1
  }

  $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue

  if ($existing -and -not $Force) {
    Write-Host "Task '$TaskName' already exists under '$TaskPath' - no-op (pass -Force to update it)."
    exit 0
  }

  $runAsUser = "$env:USERDOMAIN\$env:USERNAME"
  $taskArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $resolvedAutostart

  $action = New-ScheduledTaskAction -Execute $PowerShellExePath -Argument $taskArgs
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId $runAsUser -LogonType S4U -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew -StartWhenAvailable

  if ($existing) {
    Write-Host "Task '$TaskName' already exists. Updating it."
    Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false
  } else {
    Write-Host "Registering task '$TaskName' to run at startup as '$runAsUser' (S4U, no stored password)."
  }

  Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Description 'pm watchdog (pm-autostart.ps1) at boot, no sign-in needed' | Out-Null

  Write-Host "Task '$TaskName' registered under '$TaskPath': At startup, runs whether logged on or not (S4U), as '$runAsUser'."
  Write-Host "Action: `"$PowerShellExePath`" $taskArgs"
  exit 0
} catch {
  Write-Error "install.ps1 failed: $($_.Exception.Message)"
  exit 1
}
