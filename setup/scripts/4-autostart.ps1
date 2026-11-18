# Step 4: start the app automatically every time the laptop turns on (before anyone signs in),
# and stop the laptop from sleeping. Re-launches itself as administrator; the details of the
# signed-in user are passed along so the task runs as them, not as the admin account.
param(
    [switch]$Elevated,
    [string]$UserId,
    [string]$UserProfile,
    [string]$Pm2Cmd,
    [string]$NodeDir
)
. "$PSScriptRoot\common.ps1"

trap {
    Write-Fail $_
    if ($Elevated) { Read-Host 'Press Enter to close this window' }
    exit 1
}

if (-not $Elevated) {
    Assert-Command 'pm2.cmd' 'Run 1-install-tools.bat first.'
    Assert-Command 'node' 'Run 1-install-tools.bat first.'

    Write-Step 'Saving the list of running apps (pm2 save)'
    & pm2.cmd save
    if ($LASTEXITCODE -ne 0) { Stop-Setup 'pm2 save failed. Run 2-setup-app.bat first.' }

    $argList = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated',
        '-UserId', "`"$env:USERDOMAIN\$env:USERNAME`"",
        '-UserProfile', "`"$env:USERPROFILE`"",
        '-Pm2Cmd', "`"$((Get-Command pm2.cmd).Source)`"",
        '-NodeDir', "`"$(Split-Path (Get-Command node).Source)`""
    )
    Write-Step 'Asking for administrator permission - click Yes'
    try {
        $proc = Start-Process powershell.exe -Verb RunAs -ArgumentList $argList -Wait -PassThru
    } catch {
        Stop-Setup 'Administrator permission was refused. Run this file again and click Yes.'
    }
    if ($proc.ExitCode -ne 0) { Stop-Setup 'The administrator window reported a problem (see its messages). Run this file again.' }

    Write-Host ''
    Write-Ok 'Step 4 done. The app now starts by itself whenever the laptop turns on.'
    Write-Host 'Test it: restart the laptop, do NOT sign in, wait 2 minutes, then open your public URL /health on your phone.'
    Write-Host 'Anytime: double-click 5-check-status.bat'
    exit 0
}

# ---------- running as administrator from here ----------

function Stop-Setup([string]$Text) {
    Write-Fail $Text
    Read-Host 'Press Enter to close this window'
    exit 1
}

$pm2Home = Join-Path $UserProfile '.pm2'
$resurrectCmd = Join-Path $pm2Home 'pm2-resurrect.cmd'
if (-not (Test-Path (Join-Path $pm2Home 'dump.pm2'))) { Stop-Setup "No saved PM2 app list in $pm2Home. Run 2-setup-app.bat first." }

Write-Step 'Writing the startup script'
@(
    '@echo off',
    "set `"PM2_HOME=$pm2Home`"",
    "set `"PATH=$NodeDir;$(Split-Path $Pm2Cmd);%PATH%`"",
    "call `"$Pm2Cmd`" resurrect > `"$pm2Home\resurrect-task.log`" 2>&1"
) | Set-Content -Path $resurrectCmd -Encoding ASCII
Write-Ok $resurrectCmd

Write-Step "Creating the scheduled task '$TaskName' (runs at power-on as $UserId)"
$action = New-ScheduledTaskAction -Execute $resurrectCmd
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
# S4U: runs whether or not the user is signed in, without storing their password.
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Ok 'Scheduled task created'

Write-Step 'Stopping the laptop from sleeping'
& powercfg /change standby-timeout-ac 0
& powercfg /change standby-timeout-dc 0
& powercfg /change hibernate-timeout-ac 0
& powercfg /change hibernate-timeout-dc 0
Write-Ok 'Sleep and hibernate set to Never'
& powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
& powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
& powercfg /setactive SCHEME_CURRENT
if ($LASTEXITCODE -eq 0) { Write-Ok 'Closing the lid does nothing (keeps running)' }
else { Write-Warn 'Could not change the lid setting. Set it in Control Panel > Power Options.' }

Write-Host ''
Write-Ok 'All set. You can close this window.'
Read-Host 'Press Enter to close this window'
exit 0
