# Step 1: install Node.js, Git, Tailscale and PM2 (skips anything already installed).
. "$PSScriptRoot\common.ps1"

Write-Step 'Checking winget (Windows package manager)'
Assert-Command 'winget' 'Update "App Installer" from the Microsoft Store, then run this file again.'
Write-Ok 'winget found'

function Install-IfMissing([string]$Label, [scriptblock]$IsInstalled, [string]$WingetId) {
    Write-Step "Checking $Label"
    if (& $IsInstalled) {
        Write-Ok "$Label is already installed"
        return
    }
    Write-Host "Installing $Label... (click Yes if Windows asks for permission)"
    & winget install --id $WingetId --exact --accept-source-agreements --accept-package-agreements
    Update-Path
    if (& $IsInstalled) { Write-Ok "$Label installed" }
    else { Stop-Setup "$Label did not install. Restart the laptop and run this file again." }
}

Install-IfMissing 'Node.js' { Test-Command 'node' } 'OpenJS.NodeJS.LTS'
Install-IfMissing 'Git' { Test-Command 'git' } 'Git.Git'
Install-IfMissing 'Tailscale' { Test-Path $TailscaleExe } 'Tailscale.Tailscale'

$major = [int]((& node -v).TrimStart('v').Split('.')[0])
if ($major -lt 18) { Stop-Setup "Node.js $(& node -v) is too old; version 18 or newer is needed. Uninstall it and run this file again." }

Write-Step 'Checking PM2 (keeps the app running)'
if (Test-Command 'pm2.cmd') {
    Write-Ok 'PM2 is already installed'
} else {
    & npm.cmd install -g pm2
    Update-Path
    if (-not (Test-Command 'pm2.cmd')) { Stop-Setup 'PM2 did not install. Check the messages above.' }
    Write-Ok 'PM2 installed'
}

Write-Host ''
Write-Ok 'Step 1 done. Next: double-click 2-setup-app.bat'
