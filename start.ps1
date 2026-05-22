<#
.SYNOPSIS
  一键启动 meet-helper 服务
.DESCRIPTION
  这个脚本会自动切换到脚本所在目录，并在新的终端窗口中运行后端的启动命令。
#>

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Meet Helper 启动程序"

# 获取脚本所在目录并切换过去
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location -Path $ScriptDir

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "        正在启动 Meet Helper        " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否安装了 Node.js
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Host "错误: 未找到 Node.js，请先安装 Node.js！" -ForegroundColor Red
    Write-Host "按任意键退出..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# 检查是否安装了 npm
if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
    Write-Host "错误: 未找到 npm！" -ForegroundColor Red
    Write-Host "按任意键退出..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host "启动命令: npm run dev -w server" -ForegroundColor Green
Write-Host "浏览器访问地址: http://localhost:8787" -ForegroundColor Green
Write-Host ""

# 启动服务
try {
    npm run dev -w server
} catch {
    Write-Host "启动服务时发生错误: $_" -ForegroundColor Red
    Write-Host "按任意键退出..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
