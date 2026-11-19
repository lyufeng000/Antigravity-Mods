@echo off
chcp 65001 >nul
setlocal
title Antigravity 六补丁一键恢复工具

echo ========================================================
echo   Antigravity 六补丁一键恢复工具 (汉化/周额度/菜单/Tokens/周期表/中文标题)
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js 环境，请确认 node 已加入 PATH。
  pause
  exit /b 1
)

node "%~dp0repatch-all.mjs" %*
if errorlevel 1 (
  echo.
  echo [失败] 补丁预检或执行未通过，请查看上方报错信息。
  pause
  exit /b 1
)

echo.
pause
