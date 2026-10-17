# Disables the pm supervisor autostart Task Scheduler task (CONTRACTS.md C7).
# Draft only: this file is not run, registered or installed as part of ws-2d.
#
# Task identity: CONTRACTS.md C7 does not spell out a literal task name, so this
# reuses the existing named-mutex identifier from pm-autostart.ps1
# ('Local\pm-autostart-watchdog') minus the 'Local\' prefix, in the Task
# Scheduler root path. install.ps1 and rollback.ps1 must register/remove the
# same $TaskName/$TaskPath pair for this script to find the task.
#
# One-click: no required parameters. Idempotent: an already-disabled or
# missing task is not an error.
param()

$TaskName = 'pm-autostart-watchdog'
$TaskPath = '\'

$task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue

if (-not $task) {
  Write-Host "Task '$TaskName' not found under '$TaskPath' - nothing to disable."
  exit 0
}

if ($task.State -eq 'Disabled') {
  Write-Host "Task '$TaskName' is already disabled."
  exit 0
}

try {
  Disable-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop | Out-Null
  Write-Host "Task '$TaskName' disabled."
} catch {
  Write-Error "Failed to disable task '$TaskName': $($_.Exception.Message)"
  exit 1
}
