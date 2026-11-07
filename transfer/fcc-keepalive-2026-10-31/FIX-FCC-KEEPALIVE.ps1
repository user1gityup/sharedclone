# Applies the FCC stream-keepalive fix (vmixer2o2 commit 4c092b9 + b95e68c) to this
# host's FCC checkout, drops the EOL glm-5.3 fallback, tests, restarts FCC through
# ~/.dsh/fcc-control.ps1 and proves a tool-using request. Safe to re-run.
# Claude Opus 5.5, 2026-10-31.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$fcc = if ($env:FCC_DIR) { $env:FCC_DIR } else { Join-Path $env:USERPROFILE 'Documents\claudecode\free-claude-code' }
$control = Join-Path $env:USERPROFILE '.dsh\fcc-control.ps1'
$envFile = Join-Path $env:USERPROFILE '.fcc\.env'
$statusFile = Join-Path $here ("status-" + $env:COMPUTERNAME + ".txt")
$log = New-Object System.Collections.Generic.List[string]
function Say([string]$m) { $line = "$([DateTime]::UtcNow.ToString('u')) $m"; $log.Add($line); Write-Host $line }
function Finish([int]$code) { $log | Set-Content -LiteralPath $statusFile -Encoding utf8; Write-Host "`nStatus written to $statusFile"; exit $code }

try {
  Say "host=$env:COMPUTERNAME fcc=$fcc"
  if (-not (Test-Path -LiteralPath (Join-Path $fcc '.git'))) { Say "FAIL: no FCC checkout at $fcc"; Finish 1 }
  $patch = Join-Path $here 'fcc-keepalive.patch'
  $marker = Select-String -LiteralPath (Join-Path $fcc 'src\free_claude_code\api\response_streams.py') -Pattern 'ANTHROPIC_PING_FRAME' -Quiet
  if ($marker) {
    Say 'patch: already applied'
  } else {
    & git -C $fcc apply --3way --whitespace=nowarn $patch 2>&1 | ForEach-Object { Say "git: $_" }
    if ($LASTEXITCODE -ne 0) { Say 'FAIL: patch did not apply; checkout left as git reports above, FCC not restarted'; Finish 1 }
    Say 'patch: applied (uncommitted in working tree)'
  }

  if (Test-Path -LiteralPath $envFile) {
    $text = Get-Content -LiteralPath $envFile -Raw
    if ($text -match 'z-ai/glm-5\.3') {
      Copy-Item -LiteralPath $envFile -Destination "$envFile.bak-2026-10-31-glm53"
      $text = $text -replace ',?nvidia_nim/z-ai/glm-5\.3', ''
      $text = $text -replace 'MODEL_FALLBACKS=,', 'MODEL_FALLBACKS='
      [IO.File]::WriteAllText($envFile, $text)
      Say 'env: removed EOL nvidia_nim/z-ai/glm-5.3 (backup .env.bak-2026-10-31-glm53)'
    } else { Say 'env: no glm-5.3 entry' }
    # NIM MiniMax buffers a whole tool call; a large Write can exceed 600 s on a busy NIM.
    if (-not (Select-String -LiteralPath $envFile -Pattern '^PROVIDER_PROGRESS_TIMEOUT=' -Quiet)) {
      Add-Content -LiteralPath $envFile -Value 'PROVIDER_PROGRESS_TIMEOUT=1800'
      Say 'env: PROVIDER_PROGRESS_TIMEOUT=1800 added'
    } else { Say 'env: PROVIDER_PROGRESS_TIMEOUT already set' }
  }

  # Claude Code drops SSE ping before its 300 s chunk-idle watchdog sees it, so FCC
  # clients need a longer idle window while NIM buffers a large tool call.
  $clientHome = Join-Path $env:USERPROFILE '.dsh\free-claude-home'
  if (Test-Path -LiteralPath $clientHome) {
    $settingsPath = Join-Path $clientHome 'settings.json'
    $settings = if (Test-Path -LiteralPath $settingsPath) { Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    if (-not $settings.PSObject.Properties['env']) { $settings | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }
    foreach ($kv in @(@('CLAUDE_STREAM_IDLE_TIMEOUT_MS', '1800000'), @('CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK', '1'))) {
      $settings.env | Add-Member -NotePropertyName $kv[0] -NotePropertyValue $kv[1] -Force
    }
    [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    Say 'client: free-claude-home settings.json idle timeout 1800 s, no non-streaming fallback'
  }

  $python = Join-Path $fcc '.venv\Scripts\python.exe'
  Push-Location $fcc
  $tests = & $python -m pytest tests/api/test_response_streams.py tests/providers/test_streaming_errors.py -q -p no:cacheprovider 2>&1 | Select-Object -Last 2
  $testCode = $LASTEXITCODE
  Pop-Location
  $tests | ForEach-Object { Say "tests: $_" }
  if ($testCode -ne 0) {
    & git -C $fcc apply -R $patch 2>&1 | Out-Null
    Say 'FAIL: tests failed; patch reverted, FCC left running unchanged'; Finish 1
  }

  Say 'restart: stopping FCC via fcc-control.ps1'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $control -Action stop | ForEach-Object { Say "control: $_" }
  $port = Get-NetTCPConnection -LocalPort 8082 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($port) {
    # Started outside the controller; stop the listener and its python parent.
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($port.OwningProcess)"
    if ($p.CommandLine -match 'free_claude_code|fcc-server') {
      & taskkill.exe /PID $p.ParentProcessId /T /F 2>&1 | Out-Null
      & taskkill.exe /PID $p.ProcessId /T /F 2>&1 | Out-Null
      Start-Sleep -Seconds 2
      Say "restart: stopped unmanaged FCC pid $($p.ProcessId)"
    } else { Say "FAIL: port 8082 held by non-FCC process $($p.Name)"; Finish 1 }
  }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $control -Action start | ForEach-Object { Say "control: $_" }
  if ($LASTEXITCODE -ne 0) { Say 'FAIL: FCC did not become ready'; Finish 1 }

  $body = Join-Path $env:TEMP 'fcc-keepalive-probe.json'
  '{"model":"nvidia_nim/minimaxai/minimax-m3.1-flash","max_tokens":1024,"stream":true,"tools":[{"name":"Bash","description":"Run a shell command","input_schema":{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}}],"messages":[{"role":"user","content":"Use the Bash tool to run: echo hi"}]}' | Set-Content -LiteralPath $body -Encoding ascii
  $sse = & curl.exe -sN -m 300 http://127.0.0.1:8082/v1/messages -H 'x-api-key: freecc' -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' --data-binary "@$body" | Out-String
  $pings = ([regex]::Matches($sse, 'event: ping')).Count
  if ($sse -match '"stop_reason": "tool_use"' -and $sse -match 'message_stop') {
    Say "probe: PASS tool_use + message_stop (pings seen: $pings)"
  } else {
    Say ("probe: FAIL - last bytes: " + $sse.Substring([Math]::Max(0, $sse.Length - 300)))
    Finish 1
  }
  Say 'DONE: FCC fixed and restarted on this host'
  Finish 0
} catch {
  Say "FAIL: $($_.Exception.Message)"
  Finish 1
}
