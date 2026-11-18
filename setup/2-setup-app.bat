@echo off
title Step 2 - Set up the app and link WhatsApp
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\2-setup-app.ps1"
echo.
pause
