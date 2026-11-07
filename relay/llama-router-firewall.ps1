param([switch]$DryRun, [switch]$Remove)
# Inbound firewall rule for the llama ROUTER itself (option A of the LAN-exposure A/B):
# llama-server.exe bound to the LAN on TCP <port> (default 8090, or ~/.dsh/llama-lan.json),
# admitted from the local subnet only. The router refuses every request without the API key
# in ~/.dsh/llama-api-keys.txt, so the rule alone does not expose the GPU.
#
# Option B's rule (the node.exe relay on 8091) lives in llama-relay-firewall.ps1; both are
# applied by one double-click of "Llama LAN Firewall.cmd".
#
# A Windows "Block" rule for llama-server.exe (left by a dismissed firewall prompt) beats
# every allow rule, so inbound block rules for that binary are disabled, not deleted.
# Needs elevation; it re-launches itself elevated. -DryRun prints the plan only;
# -Remove deletes the rule.
$ErrorActionPreference = 'Stop'
$RuleName = 'DSH Llama Router (LAN)'
$LanConfigPath = Join-Path $env:USERPROFILE '.dsh\llama-lan.json'
$Exe = 'D:\dev\llama.cpp\build\bin\llama-server.exe'

$port = 8090
if (Test-Path -LiteralPath $LanConfigPath) {
  $config = Get-Content -LiteralPath $LanConfigPath -Raw | ConvertFrom-Json
  if ($config.port) { $port = [int]$config.port }
}
if (-not (Test-Path -LiteralPath $Exe)) { Write-Output "llama-server.exe not found at $Exe; the rule needs its full path."; exit 1 }

$blocks = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
  Where-Object { $_.Program -and ($_.Program -ieq $Exe) } |
  Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' })

if ($Remove) { Write-Output "Plan: remove rule '$RuleName'." }
else {
  Write-Output "Plan: rule '$RuleName' allows TCP $port inbound from LocalSubnet for $Exe."
  foreach ($rule in $blocks) { Write-Output "Plan: disable block rule '$($rule.DisplayName)' ($($rule.Name)) for $Exe." }
}
if ($DryRun) { exit 0 }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Remove) { $argList += '-Remove' }
  $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList $argList
  exit $process.ExitCode
}

Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if (-not $Remove) {
  New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -RemoteAddress LocalSubnet -Program $Exe -Profile Any | Out-Null
  foreach ($block in $blocks) { Disable-NetFirewallRule -Name $block.Name }
}
Write-Output 'Firewall now:'
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | ForEach-Object {
  $addresses = ($_ | Get-NetFirewallAddressFilter).RemoteAddress -join ', '
  Write-Output "  $($_.DisplayName): $($_.Action) TCP $port from $addresses"
}
