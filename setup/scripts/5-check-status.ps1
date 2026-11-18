# Step 5 (any time): show whether everything is running. Changes nothing.
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = 'Continue'

$port = Get-AppPort
$apiKey = Get-EnvValue 'API_KEY'
$problems = 0

Write-Step 'App (PM2)'
if (Test-Command 'pm2.cmd') { & pm2.cmd ls } else { Write-Fail 'PM2 is not installed - run 1-install-tools.bat'; $problems++ }

Write-Step 'Local server'
$code = Get-HttpStatus "http://localhost:$port/health" 5
if ($code -eq 0) { Write-Fail "Nothing is answering on port $port - run 2-setup-app.bat or: pm2 logs whatsapp-api"; $problems++ }
else {
    $state = Get-SessionState $port $apiKey
    if ($state -eq 'READY') { Write-Ok "Server on port $port, WhatsApp linked (READY)" }
    else { Write-Warn "Server on port $port, but WhatsApp state is '$state' - run 2-setup-app.bat to scan the QR code"; $problems++ }
}

Write-Step 'Start at power-on'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { Write-Fail 'Not set up - run 4-autostart.bat'; $problems++ }
else {
    $info = $task | Get-ScheduledTaskInfo
    $trigger = ($task.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace '^MSFT_Task|Trigger$', '' }) -join ', '
    Write-Ok "Task found: trigger=$trigger, runs as $($task.Principal.UserId) ($($task.Principal.LogonType)), last run $($info.LastRunTime) result $($info.LastTaskResult)"
    if ($trigger -notmatch 'Boot') { Write-Warn 'It only starts after you sign in. Run 4-autostart.bat to start at power-on.' }
}

Write-Step 'Public URL (Tailscale Funnel)'
if (-not (Test-Path $TailscaleExe)) { Write-Fail 'Tailscale is not installed - run 1-install-tools.bat'; $problems++ }
else {
    & $TailscaleExe funnel status
    $url = Get-PublicUrl
    $code = if ($url) { Get-HttpStatus "$url/health" 15 } else { 0 }
    if ($code -eq 200) { Write-Ok "$url/health is reachable" }
    else { Write-Fail "Public URL '$url' answered $code - run 3-public-url.bat"; $problems++ }
}

Write-Host ''
if ($problems -eq 0) { Write-Ok 'Everything is running.' } else { Write-Warn "$problems problem(s) found - see above." }
