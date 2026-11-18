# Shared helpers for the numbered setup files. Keep this file ASCII-only:
# Windows PowerShell 5.1 reads BOM-less scripts with the ANSI code page.

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile = Join-Path $RepoRoot '.env'
$TaskName = 'PM2 Resurrect (WhatsApp API)'
$TailscaleExe = 'C:\Program Files\Tailscale\tailscale.exe'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "[OK]   $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "[WARN] $Text" -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host "[FAIL] $Text" -ForegroundColor Red }

function Stop-Setup([string]$Text) {
    Write-Fail $Text
    exit 1
}

# Installers update PATH in the registry, not in already-open windows, so reload it.
function Update-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $extra = @("$env:APPDATA\npm", 'C:\Program Files\nodejs', 'C:\Program Files\Tailscale')
    $env:Path = (@($machine, $user) + $extra | Where-Object { $_ }) -join ';'
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Assert-Command([string]$Name, [string]$Hint) {
    if (-not (Test-Command $Name)) { Stop-Setup "$Name was not found. $Hint" }
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-EnvValue([string]$Key, [string]$Default = '') {
    if (-not (Test-Path $EnvFile)) { return $Default }
    foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($line -match "^\s*$Key\s*=\s*(.*)$") {
            $value = $Matches[1].Trim().Trim('"').Trim("'")
            if ($value) { return $value }
        }
    }
    return $Default
}

function Get-AppPort { return (Get-EnvValue 'PORT' '3000') }

# Returns the HTTP status code, or 0 when nothing answered.
function Get-HttpStatus([string]$Url, [int]$TimeoutSec = 10) {
    try {
        return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec).StatusCode
    } catch {
        $response = $_.Exception.Response
        if ($response) { return [int]$response.StatusCode }
        return 0
    }
}

function Get-SessionState([string]$Port, [string]$ApiKey) {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:$Port/api/session/status" -Headers @{ 'x-api-key' = $ApiKey } -TimeoutSec 10
        return [string]$r.data.state
    } catch {
        return ''
    }
}

function Get-PublicUrl {
    if (-not (Test-Path $TailscaleExe)) { return '' }
    try {
        $name = (& $TailscaleExe status --json | ConvertFrom-Json).Self.DNSName
        if ($name) { return 'https://' + $name.TrimEnd('.') }
    } catch { }
    return ''
}

Update-Path
