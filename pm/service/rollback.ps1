<#
.SYNOPSIS
    Rolls back DSH PM autostart from the Task Scheduler mechanism to the
    legacy logon Startup-folder shortcut.

.DESCRIPTION
    Companion to pm/service/install.ps1 (Task Scheduler 'At startup' task).
    Running this script:
      1. Recreates the original logon Startup-folder shortcut that launches
         pm-autostart.ps1, so the machine falls back to old logon-triggered
         autostart behavior.
      2. Removes the Task Scheduler autostart task it is rolling back from,
         so the two mechanisms never both fire.
    Idempotent: safe to run any number of times. Re-running after a rollback
    has already been applied makes no further changes and raises no error.
    One-click: invoking with no arguments does the full job. Parameters are
    provided only as an override, not a requirement.

.NOTE
    This script assumes the Task Scheduler task name and Task Scheduler path
    used by install.ps1 and disable.ps1 are 'pm-autostart-watchdog' and '\'
    respectively, which matches the existing named mutex in pm-autostart.ps1
    ('Local\pm-autostart-watchdog') minus the 'Local\' prefix. If install.ps1
    and disable.ps1 use different values, this script will not find the task
    to remove — reconcile at integration time.

.PARAMETER TaskName
    Name of the Task Scheduler task created by service/install.ps1, to be
    removed by this rollback. Default: "pm-autostart-watchdog".

.PARAMETER TaskPath
    Task Scheduler path of the task to remove. Default: '\' (root).

.PARAMETER StartupShortcutName
    File name of the .lnk to (re)create in the current user's Startup
    folder. Default: "pm-autostart-watchdog.lnk".

.PARAMETER PmAutostartScriptPath
    Full path to pm-autostart.ps1 that the restored Startup shortcut should
    launch. Default: pm-autostart.ps1 alongside this script's pm/ parent
    directory (pm/pm-autostart.ps1).

.EXAMPLE
    pwsh -File pm\service\rollback.ps1
    One-click rollback using all defaults.
#>

[CmdletBinding()]
param(
    [string]$TaskName = "pm-autostart-watchdog",
    [string]$TaskPath = "\",
    [string]$StartupShortcutName = "pm-autostart-watchdog.lnk",
    [string]$PmAutostartScriptPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "pm-autostart.ps1")
)

$ErrorActionPreference = "Stop"

function Write-Status {
    param([string]$Message)
    Write-Host "[rollback] $Message"
}

function Remove-AutostartTask {
    param([string]$Name, [string]$Path)

    $existing = $null
    try {
        $existing = Get-ScheduledTask -TaskName $Name -TaskPath $Path -ErrorAction SilentlyContinue
    } catch {
        $existing = $null
    }

    if (-not $existing) {
        Write-Status "Task Scheduler task '$Name' not present under '$Path' (already rolled back or never installed) - skipping removal."
        return
    }

    try {
        Unregister-ScheduledTask -TaskName $Name -TaskPath $Path -Confirm:$false -ErrorAction Stop
        Write-Status "Removed Task Scheduler task '$Name' from '$Path'."
    } catch {
        Write-Status "WARNING: failed to remove Task Scheduler task '$Name' from '$Path': $($_.Exception.Message)"
    }
}

function Restore-StartupShortcut {
    param(
        [string]$ShortcutName,
        [string]$TargetScript
    )

    $startupDir = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startupDir $ShortcutName

    if (-not (Test-Path -LiteralPath $TargetScript)) {
        Write-Status "WARNING: target script not found at '$TargetScript'. Creating shortcut anyway; verify the path before relying on it."
    }

    $workingDir = Split-Path -Parent $TargetScript

    $shell = New-Object -ComObject WScript.Shell
    try {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe")
        $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$TargetScript`""
        $shortcut.WorkingDirectory = $workingDir
        $shortcut.Description = "DSH PM autostart (legacy logon Startup entry, restored by rollback.ps1)"
        $shortcut.WindowStyle = 7  # minimized
        $shortcut.Save()
    } finally {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
    }

    Write-Status "Restored logon Startup shortcut at '$shortcutPath' -> pm-autostart.ps1."
}

Write-Status "Starting rollback to legacy logon Startup autostart."

Remove-AutostartTask -Name $TaskName -Path $TaskPath
Restore-StartupShortcut -ShortcutName $StartupShortcutName -TargetScript $PmAutostartScriptPath

Write-Status "Rollback complete. Logon Startup entry is active; Task Scheduler autostart task is removed."
Write-Status "Safe to re-run: re-running this script will not duplicate the Startup entry or error if already rolled back."