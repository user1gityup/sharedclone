# One click: allow the fleet's own services through the Windows Firewall on
# THIS machine, for the local subnet only.
#
# Why this exists: ndi2 and vmixer2o2 sit on the same /24 and reach each other
# at layer 2 (ARP resolves both ways), but each host firewall drops the other's
# inbound traffic. Measured 2026-10-05: vmixer -> ndi2 pm:4480 works, while
# ndi2 -> vmixer everything is dropped and vmixer -> ndi2 3080/8082 are dropped.
# So ndi2 already has an inbound allow for 4480 and nothing else, and vmixer has
# none at all (its Ethernet adapter is on the Public profile).
#
# What it changes: adds ONE inbound allow rule for TCP 3080, 4480, 8082, 8091,
# scoped to RemoteAddress LocalSubnet, on the Private AND Public profiles.
# Scoping to LocalSubnet is what makes the Public profile acceptable here and is
# why this does NOT move any adapter from Public to Private - that would relax
# every other rule on the machine too.
#
# What it does NOT do: it touches no other rule, disables nothing, opens nothing
# to the internet, and changes no network profile.
#
# Run it with -Preview to see exactly what it would do without changing anything
# and without needing elevation.
param([switch]$Preview)

$ErrorActionPreference = 'Stop'
$RuleName = 'fleet pm/DSH/FCC/relay (LocalSubnet)'
$Ports    = '3080,4480,8082,8091'

function Show-Plan {
  ''
  "  Machine : $env:COMPUTERNAME"
  "  Rule    : $RuleName"
  "  Allow   : inbound TCP $Ports"
  '  Scope   : RemoteAddress LocalSubnet only (not the internet)'
  '  Profiles: Private, Public'
  '  Other rules, adapters and network profiles: untouched'
  ''
}

if ($Preview) {
  '  PREVIEW - nothing will be changed.'
  Show-Plan
  try {
    $existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction Stop
    "  A rule named '$RuleName' already exists (Enabled=$($existing.Enabled)). Running for real would replace it."
  } catch {
    "  Could not read existing rules ($($_.Exception.Message.Split([char]10)[0]))."
    '  That is expected without elevation; the real run is elevated and will check again.'
  }
  ''
  '  To apply it, double-click FIX-FLEET-FIREWALL.cmd and approve the UAC prompt.'
  ''
  exit 0
}

# Re-launch elevated if we are not already. This is the UAC prompt the user approves.
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  '  This needs administrator rights. Approving the UAC prompt re-runs it elevated...'
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"" `
    -Verb RunAs
  exit 0
}

'  Elevated. Applying:'
Show-Plan

Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue

New-NetFirewallRule `
  -DisplayName $RuleName `
  -Description 'Fleet services (pm 4480, DSH 3080, FCC 8082, llama relay 8091) reachable from the local subnet only. Added by shared-brain/fleet/FIX-FLEET-FIREWALL.ps1.' `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3080,4480,8082,8091 `
  -RemoteAddress LocalSubnet `
  -Profile Private,Public `
  -Action Allow | Out-Null

$r = Get-NetFirewallRule -DisplayName $RuleName
"  Created: $($r.DisplayName)  Enabled=$($r.Enabled)  Action=$($r.Action)  Profile=$($r.Profile)"
''
'  Done. Ask the other machine to probe these ports now; nothing else was changed.'
''
Read-Host '  Press Enter to close'
