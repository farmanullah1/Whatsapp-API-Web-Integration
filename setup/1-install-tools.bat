@echo off
title Step 1 - Install tools
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\1-install-tools.ps1"
echo.
pause
