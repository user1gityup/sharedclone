param([switch]$DryRun)
# Inbound firewall rule for the OpenRouter relay on the key holder.
#
# Reads ~/.dsh/openrouter-relay/config.json (written by openrouter-relay.mjs):
#   lan     TCP <port> from the `allow` list only (or the local /24 when empty)
#   tunnel  TCP <port> from 100.64.0.0/10 (Tailscale)
#   loopback / ssh   no inbound rule; any old relay rule is removed
# The proxy runs under the base interpreter named in the venv's pyvenv.cfg. A
# Windows "Block" rule for that interpreter beats every allow rule, so those
# block rules are disabled (not deleted); inbound traffic is still denied by
# default and only the relay rule admits anything.
# Needs elevation; it re-launches itself elevated. -DryRun prints the plan only.
$ErrorActionPreference = 'Stop'
$RuleName = 'DSH OpenRouter Relay'
$ConfigPath = Join-Path $env:USERPROFILE '.dsh\openrouter-relay\config.json'
$VenvCfg = Join-Path $env:USERPROFILE 'Documents\Harness Build\.venv-proxy\pyvenv.cfg'

$config = if (Test-Path -LiteralPath $ConfigPath) { Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{ mode = 'loopback'; port = 8080; allow = @() } }
$port = [int]$config.port
$python = $null
if (Test-Path -LiteralPath $VenvCfg) {
  $home_ = (Get-Content -LiteralPath $VenvCfg | Where-Object { $_ -match '^\s*home\s*=' } | Select-Object -First 1) -replace '^\s*home\s*=\s*', ''
  if ($home_) { $python = Join-Path $home_.Trim() 'python.exe' }
}

$remote = switch ($config.mode) {
  'lan' {
    if (@($config.allow).Count -gt 0) { @($config.allow) } else { 'LocalSubnet' }
  }
  'tunnel' { '100.64.0.0/10' }
  default { $null }
}
$blocks = @()
if ($python) {
  $blocks = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
    Where-Object { $_.Program -and ($_.Program -ieq $python) } |
    Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' })
}

Write-Output "Relay mode: $($config.mode), port $port, interpreter: $python"
if ($null -eq $remote) { Write-Output "Plan: remove rule '$RuleName' (no inbound access in this mode)." }
else { Write-Output "Plan: rule '$RuleName' allows TCP $port inbound from $($remote -join ', ')." }
foreach ($rule in $blocks) { Write-Output "Plan: disable block rule '$($rule.DisplayName)' ($($rule.Name)) for $python." }
if ($DryRun) { exit 0 }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
  exit $process.ExitCode
}

Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($null -ne $remote) {
  $rule = @{ DisplayName = $RuleName; Direction = 'Inbound'; Action = 'Allow'; Protocol = 'TCP'; LocalPort = $port; RemoteAddress = $remote; Profile = 'Any' }
  if ($python) { $rule.Program = $python }
  New-NetFirewallRule @rule | Out-Null
  foreach ($block in $blocks) { Disable-NetFirewallRule -Name $block.Name }
}
Write-Output 'Firewall updated:'
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | ForEach-Object {
  $addresses = ($_ | Get-NetFirewallAddressFilter).RemoteAddress -join ', '
  Write-Output "  $($_.DisplayName): $($_.Action) TCP $port from $addresses"
}
Write-Output ''
Read-Host 'Press Enter to close'
