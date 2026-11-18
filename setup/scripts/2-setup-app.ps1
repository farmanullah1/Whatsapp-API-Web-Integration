# Step 2: install packages, create .env, start the app with PM2 and link WhatsApp.
. "$PSScriptRoot\common.ps1"

$hint = 'Run 1-install-tools.bat first.'
Assert-Command 'node' $hint
Assert-Command 'npm.cmd' $hint
Assert-Command 'pm2.cmd' $hint
Set-Location $RepoRoot

Write-Step 'Installing packages (npm install) - this can take a few minutes'
& npm.cmd install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { Stop-Setup 'npm install failed. Check your internet connection and run this file again.' }
Write-Ok 'Packages installed'

Write-Step 'Preparing settings (.env)'
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $RepoRoot '.env.example') $EnvFile
    $lines = [IO.File]::ReadAllLines($EnvFile) | ForEach-Object { if ($_ -match '^PORT=') { 'PORT=3100' } else { $_ } }
    [IO.File]::WriteAllLines($EnvFile, [string[]]$lines)
    Write-Ok 'Created .env from .env.example (PORT=3100)'
} else {
    Write-Ok '.env already exists - keeping your settings'
}

$apiKey = Get-EnvValue 'API_KEY'
if ($apiKey.Length -lt 16 -or $apiKey -like 'change-me*') {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $apiKey = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $lines = [IO.File]::ReadAllLines($EnvFile) | ForEach-Object { if ($_ -match '^\s*API_KEY\s*=') { "API_KEY=$apiKey" } else { $_ } }
    [IO.File]::WriteAllLines($EnvFile, [string[]]$lines)
    Write-Ok 'Generated a new API key'
}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot '..\API_KEY.txt'), $apiKey)
$port = Get-AppPort

Write-Step 'Starting the app with PM2'
& pm2.cmd startOrRestart ecosystem.config.js --update-env
if ($LASTEXITCODE -ne 0) { Stop-Setup 'PM2 could not start the app. Run: pm2 logs whatsapp-api' }
& pm2.cmd save
Write-Ok 'App started and saved in PM2'

Write-Step "Waiting for the server on port $port"
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
    if ((Get-HttpStatus "http://localhost:$port/health" 3) -ne 0) { $up = $true } else { Start-Sleep -Seconds 2 }
}
if (-not $up) { Stop-Setup 'The server did not start. Run: pm2 logs whatsapp-api' }
Write-Ok 'Server is up'

Write-Step 'Linking WhatsApp'
$state = Get-SessionState $port $apiKey
if ($state -eq 'READY') {
    Write-Ok 'WhatsApp is already linked'
} else {
    $qrUrl = "http://localhost:$port/api/session/qr?api_key=$apiKey"
    for ($i = 0; $i -lt 30 -and (Get-HttpStatus $qrUrl 5) -ne 200; $i++) { Start-Sleep -Seconds 2 }
    Write-Host 'A QR code is opening in your browser.'
    Write-Host 'On your phone: WhatsApp > Settings > Linked devices > Link a device, then scan it.'
    Write-Host 'If the code expires, refresh the browser page.'
    Start-Process $qrUrl
    Write-Host 'Waiting for the scan (up to 5 minutes)...'
    for ($i = 0; $i -lt 100 -and $state -ne 'READY'; $i++) {
        Start-Sleep -Seconds 3
        $state = Get-SessionState $port $apiKey
    }
    if ($state -ne 'READY') { Stop-Setup "WhatsApp is not linked yet (state: $state). Run this file again to get a new QR code." }
    Write-Ok 'WhatsApp linked'
}

Write-Host ''
Write-Host "Your API key: $apiKey" -ForegroundColor Yellow
Write-Host 'It is also saved in setup\API_KEY.txt. Keep it private.'
Write-Ok 'Step 2 done. Next: double-click 3-public-url.bat'
