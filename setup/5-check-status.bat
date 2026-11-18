@echo off
title Check status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\5-check-status.ps1"
echo.
pause
