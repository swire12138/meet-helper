@echo off
chcp 65001 >nul
title 启动 Meet Helper
echo 正在调用 PowerShell 脚本启动服务...
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File ".\start.ps1"
pause
