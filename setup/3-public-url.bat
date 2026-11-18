@echo off
title Step 3 - Make it public (Tailscale Funnel)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\3-public-url.ps1"
echo.
pause
