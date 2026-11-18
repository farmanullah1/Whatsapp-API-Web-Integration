@echo off
title Step 4 - Start automatically at power-on
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\4-autostart.ps1"
echo.
pause
