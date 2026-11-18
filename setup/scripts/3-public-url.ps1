# Step 3: make the API public on the internet with Tailscale Funnel.
. "$PSScriptRoot\common.ps1"

if (-not (Test-Path $TailscaleExe)) { Stop-Setup 'Tailscale is not installed. Run 1-install-tools.bat first.' }
$port = Get-AppPort

Write-Step 'Signing in to Tailscale'
$backend = ''
try { $backend = (& $TailscaleExe status --json | ConvertFrom-Json).BackendState } catch { }
if ($backend -eq 'Running') {
    Write-Ok 'Already signed in'
} else {
    Write-Host 'A sign-in link will appear below. Ctrl+click it (or copy it into your browser) and sign in.'
    Write-Host 'Use the same Tailscale account as your other laptop.'
    & $TailscaleExe login --unattended
    if ($LASTEXITCODE -ne 0) { Stop-Setup 'Tailscale sign-in did not finish. Run this file again.' }
    Write-Ok 'Signed in'
}

# Unattended mode keeps Tailscale (and Funnel) running when nobody is signed in to Windows.
& $TailscaleExe set --unattended
if ($LASTEXITCODE -eq 0) { Write-Ok 'Unattended mode on' }
else { Write-Warn 'Could not turn on unattended mode. Right-click the Tailscale tray icon > Settings > Run unattended.' }

Write-Step "Turning on Funnel for port $port"
Write-Host 'If Tailscale prints a link saying Funnel or HTTPS is not enabled, open it, click Enable,'
Write-Host 'then come back here - it continues by itself.'
& $TailscaleExe funnel --bg $port
if ($LASTEXITCODE -ne 0) { Stop-Setup 'Funnel could not be turned on. Read the message above, then run this file again.' }
& $TailscaleExe funnel status

$url = Get-PublicUrl
if (-not $url) { Stop-Setup 'Could not read this laptop''s Tailscale address.' }

Write-Step 'Testing the public address (the first time can take up to a minute)'
$code = 0
for ($i = 0; $i -lt 12 -and $code -ne 200; $i++) {
    $code = Get-HttpStatus "$url/health" 10
    if ($code -ne 200) { Start-Sleep -Seconds 5 }
}
if ($code -eq 200) { Write-Ok "$url/health is reachable" }
else { Write-Warn "$url/health answered $code. Wait a minute and run 5-check-status.bat." }

Write-Host ''
Write-Host "Your public URL: $url" -ForegroundColor Yellow
[IO.File]::WriteAllText((Join-Path $PSScriptRoot '..\PUBLIC_URL.txt'), $url)
Write-Ok 'Step 3 done. Next: double-click 4-autostart.bat'
