param([switch]$DryRun, [switch]$Remove)
# Inbound firewall rule for the llama relay (.sync/llama-relay.mjs) on a GPU host.
#
# Admits TCP <port> (default 8091, or ~/.dsh/llama-relay/config.json) from the
# local subnet only, for node.exe only. The llama router itself (8090) stays
# loopback and gets no rule. A Windows "Block" rule for node.exe (left by a
# dismissed firewall prompt) beats every allow rule, so inbound block rules for
# that node.exe are disabled, not deleted.
# Needs elevation; it re-launches itself elevated. -DryRun prints the plan only;
# -Remove deletes the rule.
$ErrorActionPreference = 'Stop'
$RuleName = 'DSH Llama Relay'
$ConfigPath = Join-Path $env:USERPROFILE '.dsh\llama-relay\config.json'

$port = 8091
if (Test-Path -LiteralPath $ConfigPath) {
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  if ($config.port) { $port = [int]$config.port }
}
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Output 'node.exe not found on PATH; the rule needs its full path.'; exit 1 }

$blocks = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
  Where-Object { $_.Program -and ($_.Program -ieq $node) } |
  Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' })

if ($Remove) { Write-Output "Plan: remove rule '$RuleName'." }
else {
  Write-Output "Plan: rule '$RuleName' allows TCP $port inbound from LocalSubnet for $node."
  foreach ($rule in $blocks) { Write-Output "Plan: disable block rule '$($rule.DisplayName)' ($($rule.Name)) for $node." }
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
  New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -RemoteAddress LocalSubnet -Program $node -Profile Any | Out-Null
  foreach ($block in $blocks) { Disable-NetFirewallRule -Name $block.Name }
}
Write-Output 'Firewall now:'
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | ForEach-Object {
  $addresses = ($_ | Get-NetFirewallAddressFilter).RemoteAddress -join ', '
  Write-Output "  $($_.DisplayName): $($_.Action) TCP $port from $addresses"
}
