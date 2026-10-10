param(
    [string]$QueuePath = "$env:USERPROFILE\.claude\shared-brain\push-requests.md",
    [switch]$CheckOnly,
    [string]$LocalTestRoot,
    [switch]$Once,
    [switch]$ReviewOnly
)

# Standalone, user-operated monitor. Never launch this from a denied agent action.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $PSScriptRoot 'state'
$gitExe = (Get-Command git.exe -ErrorAction Stop).Source
$testRoot = $null
if ($LocalTestRoot) {
    $testRoot = (Resolve-Path -LiteralPath $LocalTestRoot).Path
    $expectedQueue = Join-Path $testRoot 'queue.md'
    if ([IO.Path]::GetFullPath($QueuePath) -ne $expectedQueue) { throw 'Local test mode requires its isolated queue.md.' }
    $stateDir = Join-Path $testRoot 'state'
}
if ($Once -and -not $testRoot) { throw '-Once is reserved for the isolated local test.' }
if ($ReviewOnly -and -not $testRoot) { throw '-ReviewOnly is reserved for the isolated local test.' }

function Invoke-Git([string]$Repo, [string[]]$Arguments) {
    # Windows PowerShell represents native stderr as ErrorRecord objects,
    # including normal git progress; judge the process by its real exit code.
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $safeRepo = $Repo.Replace('\', '/')
        $result = & $gitExe -c "safe.directory=$safeRepo" -C $Repo @Arguments 2>&1
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    $message = ($result | Out-String).TrimEnd()
    if ($code -ne 0) { throw "git $($Arguments -join ' ') failed ($code):`n$message" }
    return $message
}

function Resolve-LocalRepoPath([string]$Repo) {
    if (-not [IO.Path]::IsPathRooted($Repo)) { throw 'Repository path must be absolute.' }
    if (Test-Path -LiteralPath $Repo) { return (Resolve-Path -LiteralPath $Repo).Path }
    $match = [regex]::Match($Repo, '^[A-Za-z]:[\\/]Users[\\/]([^\\/]+)([\\/].+)$', 'IgnoreCase')
    if (-not $match.Success) { throw "Repository path does not exist on this machine: $Repo" }
    $suffix = $match.Groups[2].Value.TrimStart('\\', '/')
    $candidate = Join-Path $env:USERPROFILE $suffix
    if (-not (Test-Path -LiteralPath $candidate) -or -not (Test-Path -LiteralPath (Join-Path $candidate '.git'))) {
        throw "Repository path does not exist on this machine: $Repo"
    }
    return (Resolve-Path -LiteralPath $candidate).Path
}

function Get-Fingerprint([string]$Text) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}

function Get-Requests([string]$Text) {
    # Ignore the example request above the marker. Queue prose is data, never code.
    $marker = $Text.IndexOf('<!-- REQUESTS BELOW THIS LINE.')
    if ($marker -lt 0) { throw 'Queue request marker is missing.' }
    $body = $Text.Substring($marker)
    foreach ($match in [regex]::Matches($body, '(?ms)^## ([^\r\n]+)\r?\n(.*?)(?=^## |\z)')) {
        $entry = $match.Value
        $heading = $match.Groups[1].Value
        # The entry template puts exactly one 'Filed:' line right after its own
        # '## ' heading; more than one means a heading-less request got merged
        # into this match (it was appended without its own '## ' line).
        $filedLines = @([regex]::Matches($entry, '(?m)^Filed: '))
        if ($filedLines.Count -gt 1) { throw "Corrupted queue entry under heading '$heading': $($filedLines.Count) 'Filed:' lines found, meaning a request missing its own '## ' heading is merged into it." }
        $statuses = @([regex]::Matches($entry, '(?m)^Status: ([^\r\n]+)'))
        if ($statuses.Count -eq 0 -or $statuses[-1].Groups[1].Value.Trim() -ne 'open') { continue }
        $parts = [regex]::Match($heading, '^(.+?) \u2014 (.+)$')
        if (-not $parts.Success) { throw "Invalid queue heading: $heading" }
        $remotePattern = '(?m)^Remote: ([a-zA-Z0-9_-]+) (https://github\.com/[^\s]+)'
        if ($testRoot) { $remotePattern = '(?m)^Remote: (origin) ([^\r\n]+)$' }
        $remoteLine = [regex]::Match($entry, $remotePattern)
        if (-not $remoteLine.Success) { throw "Expected named GitHub HTTPS remote in: $heading" }
        [pscustomobject]@{
            Repo = $parts.Groups[1].Value.Trim()
            Branch = $parts.Groups[2].Value.Trim()
            Remote = $remoteLine.Groups[1].Value
            Url = $remoteLine.Groups[2].Value.TrimEnd('/') -replace '\.git$', ''
            Entry = $entry
            Id = Get-Fingerprint $entry
            Head = [regex]::Match($entry, '(?m)^Head: ([0-9a-f]{40,64})\r?$').Groups[1].Value
            Host = [regex]::Match($entry, '(?m)^Host: ([^\s]+)').Groups[1].Value
            # A DSH writer worktree commits on its own branch and asks for a
            # fast-forward of the heading branch; empty for ordinary requests.
            SourceBranch = [regex]::Match($entry, '(?m)^Source-Branch: ([^\s]+)\r?$').Groups[1].Value
        }
    }
}

function Test-OtherMachine($Request) {
    # The queue travels between machines with the shared brain; the commits a
    # request names exist only on the machine that filed it. Leave those alone.
    if ($testRoot) { return $false }
    if ($Request.Host) { return $Request.Host -ine $env:COMPUTERNAME }
    # Older requests carry no Host line; their path still names that machine's user folder.
    $user = [regex]::Match($Request.Repo, '^[A-Za-z]:[\\/]Users[\\/]([^\\/]+)', 'IgnoreCase')
    return $user.Success -and $user.Groups[1].Value -ine [IO.Path]::GetFileName($env:USERPROFILE) -and -not (Test-Path -LiteralPath $Request.Repo)
}

function Get-Review($Request) {
    $repo = Resolve-LocalRepoPath $Request.Repo
    Invoke-Git $repo @('check-ref-format', '--branch', $Request.Branch) | Out-Null
    $expectedBranch = $Request.Branch
    if ($Request.SourceBranch) {
        Invoke-Git $repo @('check-ref-format', '--branch', $Request.SourceBranch) | Out-Null
        if ($Request.SourceBranch -eq $Request.Branch) { throw 'Source-Branch must differ from the queued branch.' }
        $expectedBranch = $Request.SourceBranch
    }
    $branch = Invoke-Git $repo @('branch', '--show-current')
    if ($branch -ne $expectedBranch) { throw 'Current branch differs from the queued branch.' }
    $url = Invoke-Git $repo @('remote', 'get-url', '--push', $Request.Remote)
    if ($testRoot) {
        # Local mode cannot review or push any real project or network remote.
        if ($repo -ne (Join-Path $testRoot 'repo')) { throw 'Test repository must be the fixture repo.' }
        $expectedRemote = Join-Path $testRoot 'remote.git'
        if ($url -ne $expectedRemote -or $Request.Remote -ne 'origin') { throw 'Test destination must be the fixture bare repository.' }
        if ((Get-Item -LiteralPath $repo).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Test repository cannot be a junction.' }
        if ((Get-Item -LiteralPath $expectedRemote).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Test destination cannot be a junction.' }
    }
    if (($url.TrimEnd('/') -replace '\.git$', '') -ne $Request.Url) { throw 'Queued URL differs from the actual push remote.' }
    $statusArgs = @('status', '--porcelain')
    # Filing a request appends to the queue, and the queue lives in the shared
    # brain: pushing the brain would otherwise always find its own request dirty.
    $queueFull = [IO.Path]::GetFullPath($QueuePath)
    if ([IO.Path]::GetDirectoryName($queueFull) -eq $repo.TrimEnd('\')) { $statusArgs += @('--', '.', ":(exclude)$([IO.Path]::GetFileName($queueFull))") }
    if ((Invoke-Git $repo $statusArgs).Length -gt 0) { throw 'Working tree is not clean. Finish or isolate the current work first.' }
    $name = Invoke-Git $repo @('config', '--local', 'user.name')
    $email = Invoke-Git $repo @('config', '--local', 'user.email')
    if (-not $name -or -not $email) { throw 'Repository-local commit identity is required.' }
    # Read the destination directly, without changing refs before approval.
    $remoteLine = Invoke-Git $repo @('ls-remote', '--heads', $Request.Remote, "refs/heads/$($Request.Branch)")
    if (-not $remoteLine) { throw 'Remote branch does not exist. Initial branch publication requires separate review.' }
    $remoteSha = ($remoteLine -split '\s+')[0]
    # If the remote object is absent locally, request a normal fetch in the terminal.
    Invoke-Git $repo @('cat-file', '-e', "$remoteSha^{commit}") | Out-Null
    $head = Invoke-Git $repo @('rev-parse', 'HEAD')
    if ($Request.Head -and $Request.Head -ne $head) { throw 'HEAD differs from the commit pinned in the queue request.' }
    Invoke-Git $repo @('merge-base', '--is-ancestor', $remoteSha, $head) | Out-Null
    if ($head -eq $remoteSha) { throw 'Destination already matches HEAD; nothing to push.' }
    $commits = Invoke-Git $repo @('log', '--reverse', '--format=%h %an <%ae> %s', "$remoteSha..$head")
    $diff = Invoke-Git $repo @('diff', '--no-ext-diff', '--no-textconv', $remoteSha, $head, '--')
    [pscustomobject]@{ Repo=$repo; Head=$head; RemoteSha=$remoteSha; Text="Repository: $repo`r`nBranch: $branch`r`nPushes to: $($Request.Remote) refs/heads/$($Request.Branch)`r`nDestination: $url`r`nIdentity: $name <$email>`r`n`r`nQUEUED REQUEST`r`n$($Request.Entry)`r`nCOMMITS`r`n$commits`r`n`r`nDIFF (review before approving, especially public destinations)`r`n$diff" }
}

function Confirm-Review([string]$Text) {
    $form = New-Object Windows.Forms.Form
    $form.Text = 'Git gatekeeper - explicit push approval'
    $form.Width = 1000; $form.Height = 750
    $form.StartPosition = 'CenterScreen'
    $box = New-Object Windows.Forms.TextBox
    $box.Multiline = $true; $box.ReadOnly = $true; $box.ScrollBars = 'Both'
    $box.WordWrap = $false; $box.Dock = 'Fill'; $box.Text = $Text
    $bar = New-Object Windows.Forms.FlowLayoutPanel
    $bar.Dock = 'Bottom'; $bar.Height = 50
    $approve = New-Object Windows.Forms.Button
    $approve.Text = 'Approve push'; $approve.Width = 150
    $approve.DialogResult = [Windows.Forms.DialogResult]::OK
    $defer = New-Object Windows.Forms.Button
    $defer.Text = 'Defer'; $defer.Width = 100
    $defer.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $bar.Controls.Add($approve); $bar.Controls.Add($defer)
    $form.Controls.Add($box); $form.Controls.Add($bar)
    $form.CancelButton = $defer
    # No default approve button: Enter does not silently approve.
    try { return $form.ShowDialog() -eq [Windows.Forms.DialogResult]::OK }
    finally { $form.Dispose() }
}

function Write-Receipt($Request, [string]$Outcome, [string]$Detail) {
    $record = [ordered]@{ timestamp=[DateTime]::UtcNow.ToString('o'); requestId=$Request.Id; repo=$Request.Repo; branch=$Request.Branch; outcome=$Outcome; detail=$Detail; actor='User-operated gatekeeper (built by GPT-6)' }
    $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stateDir "$($Request.Id).json") -Encoding UTF8
    Write-Host "$Outcome`: $Detail"
}

if ($CheckOnly) {
    $items = @(Get-Requests ([IO.File]::ReadAllText($QueuePath)))
    $others = @($items | Where-Object { Test-OtherMachine $_ })
    Write-Output "Queue parsed successfully: $($items.Count) open request(s), $($others.Count) for another machine (left alone). No network calls or pushes performed."
    exit 0
}

if ($ReviewOnly) {
    # Isolated test: review every open request without a window or a push.
    $failed = 0
    foreach ($request in @(Get-Requests ([IO.File]::ReadAllText($QueuePath)))) {
        try { $review = Get-Review $request; Write-Output "REVIEW OK $($request.Branch) $($review.RemoteSha)..$($review.Head)" }
        catch { $failed++; Write-Output "REVIEW FAILED $($request.Branch): $($_.Exception.Message)" }
    }
    exit $failed
}

Add-Type -AssemblyName System.Windows.Forms
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$mutexName = 'Local\SharedUserGitGatekeeper'
if ($testRoot) { $mutexName += '-' + (Get-Fingerprint $testRoot) }
$mutex = New-Object Threading.Mutex($false, $mutexName)
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw 'Another gatekeeper monitor is already running.' }
    $seen = @{}
    Write-Host "Watching $QueuePath. Keep this terminal open. Ctrl+C stops monitoring."
    Write-Host 'No push occurs without approval. Deferred/failed requests retry after restarting the monitor.'
    while ($true) {
        try {
            $requests = @(Get-Requests ([IO.File]::ReadAllText($QueuePath)))
            foreach ($request in $requests) {
                if ($seen.ContainsKey($request.Id)) { continue }
                if (Test-OtherMachine $request) { $seen[$request.Id] = $true; continue }
                $seen[$request.Id] = $true
                $receiptPath = Join-Path $stateDir "$($request.Id).json"
                if (Test-Path -LiteralPath $receiptPath) {
                    $receipt = Get-Content -Raw -LiteralPath $receiptPath | ConvertFrom-Json
                    if ($receipt.outcome -eq 'pushed') { continue }
                }
                try {
                    $review = Get-Review $request
                    if (-not (Confirm-Review $review.Text)) { Write-Receipt $request 'deferred' 'User deferred; no push attempted.'; continue }
                    # Approval applies to this exact queue entry, HEAD, and destination state only.
                    $currentIds = @(Get-Requests ([IO.File]::ReadAllText($QueuePath)) | ForEach-Object { $_.Id })
                    if ($request.Id -notin $currentIds) { throw 'Queue entry changed after review.' }
                    $fresh = Get-Review $request
                    if ($fresh.Head -ne $review.Head -or $fresh.RemoteSha -ne $review.RemoteSha -or $fresh.Text -ne $review.Text) { throw 'Repository or destination changed after review; restart to review again.' }
                    if ($env:LEFTHOOK -eq '0' -or $env:LEFTHOOK_EXCLUDE -or $env:LEFTHOOK_COMMANDS -or $env:HUSKY -eq '0') { throw 'Hook-skipping environment detected. Start from a normal terminal.' }
                    $hookPath = Invoke-Git $review.Repo @('rev-parse', '--git-path', 'hooks/pre-push')
                    if (-not [IO.Path]::IsPathRooted($hookPath)) { $hookPath = Join-Path $review.Repo $hookPath }
                    if (-not (Test-Path -LiteralPath $hookPath)) { throw 'No pre-push hook found; this monitor requires the existing verification hook.' }
                    Write-Host 'Running push with existing hooks. The terminal may be quiet during typecheck.'
                    $timer = [Diagnostics.Stopwatch]::StartNew()
                    $result = Invoke-Git $review.Repo @('push', $request.Remote, "$($review.Head):refs/heads/$($request.Branch)")
                    Write-Host $result
                    $after = Invoke-Git $review.Repo @('ls-remote', '--heads', $request.Remote, "refs/heads/$($request.Branch)")
                    if (($after -split '\s+')[0] -ne $review.Head) { throw 'Push returned success but destination verification differs. Inspect the remote before retrying.' }
                    Write-Receipt $request 'pushed' "$($review.RemoteSha)..$($review.Head); verified remote; hooks enabled; $([math]::Round($timer.Elapsed.TotalSeconds,1)) seconds."
                    [Windows.Forms.MessageBox]::Show('Push completed and remote verified.', 'Git gatekeeper') | Out-Null
                } catch {
                    Write-Receipt $request 'failed' $_.Exception.Message
                    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Git gatekeeper - stopped this request') | Out-Null
                }
            }
        } catch { Write-Warning $_.Exception.Message }
        if ($Once) { break }
        Start-Sleep -Seconds 5
    }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
